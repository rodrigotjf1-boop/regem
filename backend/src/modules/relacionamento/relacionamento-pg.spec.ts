import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../../db/schema';
import { repetirNaCorridaDeCatalogo } from '../../common/corrida-de-catalogo';
import { hojeISO } from '../../common/data';
import { agoraNaOperacao } from './relacionamento';
import { MODELO_CASHBACK, RelacionamentoService } from './relacionamento.service';
import { CashbackService } from '../cashback/cashback.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

// AS AUTOMÁTICAS — CASHBACK VENCENDO (Onda 3 · PR 2, mig 356), contra o Postgres real: quem entra na lista (saldo,
// vencimento, quem saiu, só iFood/99, já avisado, chave do telefone), a rotina no horário (separa uma vez, manda devagar
// pelo QR, a trava de "uma mensagem por vencimento"), o limite do dia, quem sai depois de separado, o saldo que mudou, a
// API oficial (modelo aprovado e a categoria que a Meta deu) e o clique do "Ver meu saldo".
//
// O banco do CI é o de uma loja: a 356 e as tabelas só da nuvem que a regra lê (lista de exclusão, envios de campanha,
// modelos) sobem num schema SÓ DESTE TESTE, na frente do `public`, sem FK para tabela compartilhada (LIC-088).
const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('relacionamento-pg.spec: sem TEST_PG_URL — PULADO');
jest.setTimeout(120_000);

const MIGS = join(__dirname, '..', '..', '..', '..', 'database', 'migrations');
const semFkCompartilhada = (s: string) => s.replace(/\s+references\s+(empresa|unidade|cliente|cupom)\s*\(\s*id\s*\)(\s+on\s+delete\s+cascade)?/gi, '');
const DIA = 86_400_000;
const semana = (abre = '18:00') => [0, 1, 2, 3, 4, 5, 6].map((dia) => ({ dia, ativo: true, abre, fecha: '23:00' }));
/** Às 17:05 de hoje (1 h antes de abrir às 18:00 = 17:00: dentro da janela). */
const naJanela = () => ({ dia: agoraNaOperacao().dia, hhmm: '17:05' });

descrever('automáticas — cashback vencendo (Postgres)', () => {
  const SCHEMA = `teste_autom_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
  let admin: Pool;
  let pool: Pool;
  let db: any;
  const empresas: string[] = [];
  const q = async (s: string, p: any[] = []) => (await pool.query(s, p)).rows;

  beforeAll(async () => {
    admin = new Pool({ connectionString: URL_PG });
    await admin.query(`create schema ${SCHEMA}`);
    pool = new Pool({ connectionString: URL_PG, options: `-c search_path=${SCHEMA},public` });
    await pool.query(`
      create table ${SCHEMA}.marketing_optout (
        id uuid primary key default gen_random_uuid(), tenant_id uuid not null, telefone text not null,
        cliente_id uuid, motivo text, criado_em timestamptz not null default now());
      create table ${SCHEMA}.campanha_envio (
        id uuid primary key default gen_random_uuid(), campanha_id uuid, tenant_id uuid not null, cliente_id uuid,
        telefone text not null, status text not null default 'pendente', enviado_em timestamptz);
      create table ${SCHEMA}.whatsapp_template (
        id uuid primary key default gen_random_uuid(), tenant_id uuid not null, nome text not null, idioma text not null default 'pt_BR',
        categoria text not null default 'MARKETING', status text not null default 'rascunho', motivo_rejeicao text);`);
    // A 356 (as automáticas) e a 357 (o aniversário: o painel e a rotina leem as duas).
    for (const arq of ['356_relacionamento_automaticas.sql', '357_aniversario_do_cliente.sql']) {
      const r: any = await repetirNaCorridaDeCatalogo(() => pool.query(semFkCompartilhada(readFileSync(join(MIGS, arq), 'utf8'))));
      const conf = (Array.isArray(r) ? r[r.length - 1] : r).rows as { objeto: string; ok: boolean }[];
      if (conf.length !== 5 || conf.some((l) => !l.ok)) throw new Error(`conferência da ${arq}: ${JSON.stringify(conf)}`);
    }
    db = drizzle(pool, { schema });
  });

  afterAll(async () => {
    await pool?.end();
    if (!admin) return;
    for (const t of empresas) {
      await admin.query(`delete from pedido_externo where tenant_id = $1`, [t]).catch(() => {});
      await admin.query(`delete from cashback_movimento where tenant_id = $1`, [t]).catch(() => {});
      await admin.query(`delete from cashback_saldo where tenant_id = $1`, [t]).catch(() => {});
      await admin.query(`delete from cliente where tenant_id = $1`, [t]).catch(() => {});
      await admin.query(`delete from cardapio_config where tenant_id = $1`, [t]).catch(() => {});
      await admin.query(`delete from empresa where id = $1`, [t]).catch(() => {});
    }
    await admin.query(`drop schema if exists ${SCHEMA} cascade`);
    await admin.end();
  });

  /** Uma empresa com a loja aberta todo dia das 18 às 23 e os clientes do cenário do protótipo. */
  async function empresa(ajustes: Record<string, unknown> = {}) {
    const [{ id: t }] = (await admin.query(`insert into empresa (nome) values ('Teste automáticas') returning id`)).rows;
    empresas.push(t);
    const token = `tok-${randomUUID().slice(0, 12)}`;
    await admin.query(
      `insert into cardapio_config (tenant_id, unidade_id, token, ativo, nome_publico, horarios) values ($1, null, $2, true, 'Burger da Praça', $3::jsonb)`,
      [t, token, JSON.stringify(semana())],
    );
    const a = { cashback_ativo: true, ...ajustes };
    const cols = Object.keys(a);
    await q(
      `insert into relacionamento_config (tenant_id, ${cols.join(', ')}) values ($1, ${cols.map((_, i) => `$${i + 2}`).join(', ')})`,
      [t, ...cols.map((k) => (a as any)[k])],
    );
    return { t, token };
  }
  /** Cliente com pedido (canal), saldo e vencimento em `dias`. `telSaldo` = como o saldo guardou o número. */
  async function cliente(t: string, nome: string, tel: string, saldo: number, dias: number, o: { canal?: string; telSaldo?: string; semPedido?: boolean } = {}) {
    const [{ id }] = (await admin.query(`insert into cliente (tenant_id, nome, telefone) values ($1,$2,$3) returning id`, [t, nome, tel])).rows;
    if (!o.semPedido)
      await admin.query(
        `insert into pedido_externo (tenant_id, canal, tipo, itens, total, status, cliente_nome, cliente_telefone, client_ref, cliente_id, criado_em)
         values ($1,$2,'entrega','[]'::jsonb,40,'concluido',$3,$4,$5,$6, now() - interval '20 days')`,
        [t, o.canal ?? 'cardapio', nome, tel, randomUUID(), id],
      );
    if (saldo > 0) {
      await admin.query(`insert into cashback_movimento (tenant_id, telefone, tipo, delta, origem) values ($1,$2,'valor',$3,'credito')`, [t, o.telSaldo ?? tel, String(saldo)]);
      await admin.query(
        `update cashback_saldo set expira_em = now() + make_interval(days => $3::int) + interval '2 hours' where tenant_id = $1 and telefone = $2 and tipo = 'valor'`,
        [t, o.telSaldo ?? tel, dias],
      );
    }
    return id as string;
  }

  type Saida = { como: string; para: string; texto?: string; nome?: string; params?: string[]; opts?: any };
  function servico(provedor: 'evolution' | 'cloud' = 'evolution') {
    const saidas: Saida[] = [];
    const auditados: any[] = [];
    const numeros = {
      resolver: async () => (provedor === 'cloud' ? { provedor: 'cloud', phoneId: 'PH-1', instancia: null } : { provedor: 'evolution', instancia: 'loja-1' }),
    };
    const cloud = {
      enviarTemplate: async (_t: string, para: string, nome: string, _i: string, params: string[], opts: any) => void saidas.push({ como: 'modelo', para, nome, params, opts }),
      atualizarModelo: async () => undefined,
      garantirModeloRelacionamento: async () => 'pendente',
    };
    const whatsapp = { enviarPorInstancia: async (_t: string, _i: string, para: string, texto: string) => void saidas.push({ como: 'qr', para, texto }) };
    const svc = new RelacionamentoService(db, numeros as any, cloud as any, whatsapp as any, { registrar: async (e: any) => void auditados.push(e) } as any);
    return { svc, saidas, auditados };
  }
  const envios = (t: string) => q(`select * from relacionamento_envio where tenant_id = $1 order by vence_em, criado_em`, [t]);

  /** O cenário: entram Marina (vence em 2 dias) e Teresa (vence em 1 dia, saldo guardado com o 55); o resto fica fora. */
  async function cenario(t: string) {
    const marina = await cliente(t, 'Marina Lopes', '21987650001', 12.4, 2);
    await cliente(t, 'Paulo Reis', '21987650002', 3, 2); // saldo abaixo de R$ 5
    await cliente(t, 'Júlia Melo', '21987650003', 20, 6); // vence fora dos 3 dias
    await cliente(t, 'Caio Tavares', '21987650004', 9, 2);
    await q(`insert into marketing_optout (tenant_id, telefone) values ($1, '552187650004')`, [t]); // SAIR sem o nono dígito
    await cliente(t, 'Renata Souza', '21987650005', 9, 2, { canal: '99food' }); // só pela 99: telefone da plataforma
    await cliente(t, 'Bruno Dias', '21987650008', 9, 2);
    await admin.query(`update cliente set opt_out_marketing = true where tenant_id = $1 and telefone = '21987650008'`, [t]);
    const teresa = await cliente(t, 'Teresa Alves', '21987650007', 21.75, 1, { telSaldo: '5521987650007' });
    await cliente(t, 'Sem Pedido', '21987650009', 9, 2, { semPedido: true }); // nunca pediu: não é cliente da loja
    return { marina, teresa };
  }

  it('a prévia: só quem vence dentro dos dias, com saldo, que recebe e que pediu fora do iFood/99 — um por telefone', async () => {
    const { t } = await empresa();
    await cenario(t);
    const { svc } = servico();
    const p: any = await svc.painel(t);
    expect(p.ajustes).toMatchObject({ cashbackAtivo: true, cashbackDiasAntes: 3, cashbackSaldoMin: 5, maxPorDia: 30, horario: 'antes_de_abrir' });
    expect(p.envioHoje).toEqual({ antes_de_abrir: '17:00', ao_abrir: '18:00' });
    expect(p.cashback.pronto).toBe(true);
    expect(p.cashback.previa.total).toBe(2);
    expect(p.cashback.previa.lista.map((x: any) => x.nome)).toEqual(['Teresa A.', 'Marina L.']);
    expect(p.cashback.previa.lista[1].detalhe).toMatch(/^R\$ 12,40 · vence \d\d\/\d\d$/);
    expect(p.cashback.resultado).toEqual({ mensagens: 0, cliques: 0, voltaram: 0, valor: 0, cupons: 0 });
  });

  it('fora do horário não separa nada; no horário separa UMA vez e manda devagar pelo QR, sem repetir', async () => {
    const { t } = await empresa();
    await cenario(t);
    const { svc, saidas } = servico('evolution');
    expect(await svc.rodarEmpresa(t, { dia: agoraNaOperacao().dia, hhmm: '16:30' })).toEqual({ separados: 0, enviados: 0 });
    expect(await envios(t)).toHaveLength(0);

    expect(await svc.rodarEmpresa(t, naJanela())).toEqual({ separados: 2, enviados: 1 }); // QR: 1 por minuto
    expect(saidas).toHaveLength(1);
    expect(saidas[0].para).toBe('5521987650007'); // quem vence antes primeiro
    expect(saidas[0].texto).toContain('Oi, Teresa! Seu cashback de R$ 21,75 na Burger da Praça vence em');
    expect(saidas[0].texto).toContain('/publico/relacionamento/r/');
    expect(saidas[0].texto).toContain('responda SAIR');
    expect(await svc.rodarEmpresa(t, naJanela())).toEqual({ separados: 0, enviados: 1 });
    expect(saidas.map((s) => s.para)).toEqual(['5521987650007', '5521987650001']);
    expect(await svc.rodarEmpresa(t, naJanela())).toEqual({ separados: 0, enviados: 0 });

    // Outro servidor (sem a memória deste), no mesmo dia: a trava é o índice único — nada novo.
    const outro = servico('evolution');
    expect(await outro.svc.rodarEmpresa(t, naJanela())).toEqual({ separados: 0, enviados: 0 });
    const linhas = await envios(t);
    expect(linhas.map((l: any) => l.status)).toEqual(['enviado', 'enviado']);
    expect(linhas[1]).toMatchObject({ tipo: 'cashback', chave_telefone: '21987650001', oferta: false });
    expect(Number(linhas[1].valor)).toBeCloseTo(12.4, 2);
    // Avisados deste vencimento: a prévia não os conta de novo.
    expect((await svc.painel(t)).cashback.previa.total).toBe(0);
  });

  it('o limite do dia vale para todas as automáticas juntas', async () => {
    const { t } = await empresa({ max_por_dia: 10 });
    await cenario(t);
    for (let i = 0; i < 9; i += 1)
      await q(`insert into relacionamento_envio (tenant_id, tipo, chave_telefone, referencia, telefone, dia, status) values ($1,'volta',$2,'x',$2,$3::date,'enviado')`, [
        t,
        `2199999000${i}`,
        hojeISO(),
      ]);
    const { svc } = servico();
    expect((await svc.rodarEmpresa(t, naJanela())).separados).toBe(1);
  });

  it('quem sai depois de separado não recebe; quem usou o saldo ou ganhou de novo (o vencimento mudou), também não', async () => {
    const { t } = await empresa();
    await cenario(t);
    const { svc, saidas } = servico('cloud');
    await q(`insert into whatsapp_template (tenant_id, nome, categoria, status) values ($1, $2, 'UTILITY', 'aprovado')`, [t, MODELO_CASHBACK]);
    const a = await svc.ajustes(t);
    expect(await svc.separarCashback(t, hojeISO(), a, false)).toBe(2);
    await q(`insert into marketing_optout (tenant_id, telefone) values ($1, '5521987650001')`, [t]); // Marina saiu
    await admin.query(`update cashback_saldo set expira_em = expira_em + interval '30 days' where tenant_id = $1 and telefone = '5521987650007'`, [t]); // Teresa ganhou de novo
    const pronto = await svc.prontidaoCashback(t);
    expect(await svc.mandar(t, hojeISO(), a, pronto)).toBe(0);
    expect(saidas).toHaveLength(0);
    expect((await envios(t)).map((l: any) => [l.status, l.motivo])).toEqual([
      ['fora', 'o vencimento mudou'],
      ['fora', 'pediu para sair'],
    ]);

    // Outra empresa: a Teresa usou o saldo (ficou abaixo do mínimo) depois de separada.
    const { t: t2 } = await empresa();
    await cenario(t2);
    await q(`insert into whatsapp_template (tenant_id, nome, categoria, status) values ($1, $2, 'UTILITY', 'aprovado')`, [t2, MODELO_CASHBACK]);
    expect(await svc.separarCashback(t2, hojeISO(), a, false)).toBe(2);
    await admin.query(`insert into cashback_movimento (tenant_id, telefone, tipo, delta, origem) values ($1, '5521987650007', 'valor', '-20', 'resgate')`, [t2]);
    expect(await svc.mandar(t2, hojeISO(), a, await svc.prontidaoCashback(t2))).toBe(1); // só a Marina
    expect((await envios(t2)).map((l: any) => [l.chave_telefone, l.status, l.motivo])).toEqual([
      ['21987650007', 'fora', 'usou o saldo'],
      ['21987650001', 'enviado', null],
    ]);
  });

  it('Sua conta › Benefícios: o saldo do cliente diz quando vence (e nada quando já venceu)', async () => {
    const { t } = await empresa();
    await cliente(t, 'Marina Lopes', '21987650001', 12.4, 2);
    const cashback = new CashbackService(db);
    const r: any = await cashback.saldoCliente(t, '21987650001');
    expect(r.valor).toBeCloseTo(12.4, 2);
    expect(Math.round((new Date(r.valorVenceEm).getTime() - Date.now()) / DIA)).toBe(2);
    await admin.query(`update cashback_saldo set expira_em = now() - interval '1 hour' where tenant_id = $1`, [t]);
    const vencido: any = await cashback.saldoCliente(t, '21987650001');
    expect(vencido.valor).toBe(0);
    expect(vencido.valorVenceEm).toBeNull();
  });

  it('API oficial: só com o modelo aprovado; manda o modelo com nome, saldo, data e o envio no botão', async () => {
    const { t } = await empresa();
    await cenario(t);
    const { svc, saidas } = servico('cloud');
    expect(await svc.rodarEmpresa(t, naJanela())).toEqual({ separados: 0, enviados: 0 }); // sem modelo
    await q(`insert into whatsapp_template (tenant_id, nome, categoria, status) values ($1, $2, 'UTILITY', 'pendente')`, [t, MODELO_CASHBACK]);
    expect((await svc.painel(t)).cashback.motivo).toBe('o modelo está pendente na Meta');
    await q(`update whatsapp_template set status = 'aprovado' where tenant_id = $1`, [t]);
    const outro = servico('cloud');
    expect(await outro.svc.rodarEmpresa(t, naJanela())).toEqual({ separados: 2, enviados: 2 });
    expect(outro.saidas[0]).toMatchObject({ como: 'modelo', para: '5521987650007', nome: MODELO_CASHBACK });
    expect(outro.saidas[0].params?.[0]).toBe('Teresa');
    expect(outro.saidas[0].params?.[1]).toBe('R$ 21,75');
    expect(outro.saidas[0].params?.[2]).toMatch(/^\d\d\/\d\d$/);
    const linhas = await envios(t);
    expect(outro.saidas[0].opts).toMatchObject({ envioId: linhas[0].id, phoneId: 'PH-1' });
    expect(saidas).toHaveLength(0);
  });

  it('se a Meta classificou o aviso como marketing, ele respeita "uma oferta a cada N dias" (somando as campanhas)', async () => {
    const { t } = await empresa();
    await cenario(t);
    await q(`insert into whatsapp_template (tenant_id, nome, categoria, status) values ($1, $2, 'MARKETING', 'aprovado')`, [t, MODELO_CASHBACK]);
    await q(`insert into campanha_envio (tenant_id, telefone, status, enviado_em) values ($1, '5521987650001', 'enviado', now() - interval '2 days')`, [t]);
    const { svc } = servico('cloud');
    const p: any = await svc.painel(t);
    expect(p.cashback.previa.lista.map((x: any) => x.nome)).toEqual(['Teresa A.']);
    await svc.rodarEmpresa(t, naJanela());
    expect((await envios(t)).map((l: any) => [l.chave_telefone, l.oferta])).toEqual([['21987650007', true]]);
  });

  it('o que ficou separado num dia anterior sem sair volta a valer; dia sem loja aberta não manda', async () => {
    const { t } = await empresa();
    await cenario(t);
    const ontem = new Date(Date.now() - DIA).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
    await q(
      `insert into relacionamento_envio (tenant_id, tipo, chave_telefone, referencia, telefone, dia, status, vence_em)
       select $1, 'cashback', '21987650001', to_char((expira_em at time zone 'America/Sao_Paulo')::date, 'YYYY-MM-DD'), '21987650001', $2::date, 'pendente', expira_em
         from cashback_saldo where tenant_id = $1 and telefone = '21987650001'`,
      [t, ontem],
    );
    const { svc } = servico();
    expect((await svc.rodarEmpresa(t, naJanela())).separados).toBe(2);
    await admin.query(`update cardapio_config set horarios = '[]'::jsonb where tenant_id = $1`, [t]);
    const fechado = servico();
    expect(await fechado.svc.rodarEmpresa(t, naJanela())).toEqual({ separados: 0, enviados: 0 });
  });

  it('salvar: confere tudo antes, grava só o que mudou e deixa na auditoria', async () => {
    const { t } = await empresa();
    const { svc, auditados } = servico();
    const user: any = { tenantId: t, colaboradorId: null, categoria: 'gerente' };
    await expect(svc.salvar(user, { maxPorDia: 40 })).rejects.toThrow('10, 20, 30, 50 ou 100');
    await svc.salvar(user, { maxPorDia: 30, cashbackDiasAntes: 5 }); // 30 já era: só o 5 muda
    expect(await svc.ajustes(t)).toMatchObject({ maxPorDia: 30, cashbackDiasAntes: 5 });
    expect(auditados).toHaveLength(1);
    expect(auditados[0]).toMatchObject({ acao: 'ajustou_automaticas', detalhe: { de: { cashbackDiasAntes: 3 }, para: { cashbackDiasAntes: 5 } } });
    await svc.salvar(user, { cashbackDiasAntes: 5 });
    expect(auditados).toHaveLength(1); // nada mudou, nada grava
    // empresa sem linha ainda: o salvar cria
    const { t: t2 } = await empresa();
    await q(`delete from relacionamento_config where tenant_id = $1`, [t2]);
    await svc.salvar({ ...user, tenantId: t2 }, { cashbackAtivo: true });
    expect((await svc.ajustes(t2)).cashbackAtivo).toBe(true);
  });

  it('o clique do "Ver meu saldo": marca uma vez e leva a Sua conta › Benefícios do cardápio da loja', async () => {
    const { t, token } = await empresa();
    await cenario(t);
    const { svc } = servico();
    await svc.rodarEmpresa(t, naJanela());
    const [e] = await envios(t);
    const antes = process.env.CARDAPIO_PUBLIC_URL;
    process.env.CARDAPIO_PUBLIC_URL = 'https://app.exemplo';
    try {
      expect(await svc.destinoDoClique(e.id)).toBe(`https://app.exemplo/c/${token}?conta=beneficios`);
      const [{ clicou_em: primeiro }] = await q(`select clicou_em from relacionamento_envio where id = $1`, [e.id]);
      expect(primeiro).not.toBeNull();
      await svc.destinoDoClique(e.id);
      const [{ clicou_em: depois }] = await q(`select clicou_em from relacionamento_envio where id = $1`, [e.id]);
      expect(new Date(depois).getTime()).toBe(new Date(primeiro).getTime());
      expect(await svc.destinoDoClique('exemplo')).toBe('https://app.exemplo'); // o exemplo que a Meta abre na análise
      expect(await svc.destinoDoClique(randomUUID())).toBe('https://app.exemplo');
      expect((await svc.resultado(t, 'cashback')).cliques).toBe(1);
    } finally {
      if (antes === undefined) delete process.env.CARDAPIO_PUBLIC_URL;
      else process.env.CARDAPIO_PUBLIC_URL = antes;
    }
  });
});
