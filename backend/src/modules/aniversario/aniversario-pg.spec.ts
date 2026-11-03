import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { sql } from 'drizzle-orm';
import * as schema from '../../db/schema';
import { repetirNaCorridaDeCatalogo } from '../../common/corrida-de-catalogo';
import { hojeISO, somarDias } from '../../common/data';
import { aniversarioValendoEntre, semanaDe, sqlAniversarioEntre } from '../../common/aniversario';
import { assinarCliente } from '../cliente/cliente-token';
import { CardapioService } from '../cardapio/cardapio.service';
import { CampanhaService } from '../campanha/campanha.service';
import { RelacionamentoService, MODELO_ANIV_PARABENS, MODELO_ANIV_PRESENTE } from '../relacionamento/relacionamento.service';
import { agoraNaOperacao } from '../relacionamento/relacionamento';
import { AniversarioService } from './aniversario.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

// O ANIVERSÁRIO (Onda 3 · PR 3, mig 357), contra o Postgres real:
//   • a regra em SQL dá o MESMO que a regra em JS nos mesmos casos (carência no limite, 29/02, virada do ano — V74);
//   • o cadastro com a PROTEÇÃO: o cliente informa e corrige UMA vez; a loja corrige com o motivo; tudo na auditoria;
//   • o cupom pessoal (só o dono — pelo token de Sua conta no cardápio, pelo número no robô) e o "só aniversariantes"
//     (a semana do aniversário valendo; uma vez a cada 12 meses), passando pelo cardápio de verdade;
//   • a automática: quem ganha (carência, 12 meses de pedido, 12 meses de presente, saiu, a janela), o cupom criado só na
//     hora de mandar, o texto do QR e o modelo da API oficial, o clique que já aplica o cupom; a prévia com o motivo;
//   • a campanha "aniversariantes desta semana".
// O banco do CI é o de uma loja: as tabelas só da nuvem sobem num schema SÓ DESTE TESTE (LIC-088).
const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('aniversario-pg.spec: sem TEST_PG_URL — PULADO');
jest.setTimeout(120_000);

const MIGS = join(__dirname, '..', '..', '..', '..', 'database', 'migrations');
const semFkCompartilhada = (s: string) => s.replace(/\s+references\s+(empresa|unidade|cliente|cupom)\s*\(\s*id\s*\)(\s+on\s+delete\s+cascade)?/gi, '');
const semana = () => [0, 1, 2, 3, 4, 5, 6].map((dia) => ({ dia, ativo: true, abre: '18:00', fecha: '23:00' }));
const naJanela = () => ({ dia: agoraNaOperacao().dia, hhmm: '17:05' });
const diaMes = (iso: string) => ({ dia: Number(iso.slice(8, 10)), mes: Number(iso.slice(5, 7)) });

descrever('aniversário — regra, proteção, cupom e automática (Postgres)', () => {
  const SCHEMA = `teste_aniv_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
  let admin: Pool;
  let pool: Pool;
  let db: any;
  const empresas: string[] = [];
  const q = async (s: string, p: any[] = []) => (await pool.query(s, p)).rows;
  const segredoAntes = process.env.JWT_SECRET;

  beforeAll(async () => {
    if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 16) process.env.JWT_SECRET = 'segredo-de-teste-do-aniversario-1';
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
    // A 356, a 357 e a 358: a rotina e o painel leem as três.
    for (const [arq, linhas] of [
      ['356_relacionamento_automaticas.sql', 5],
      ['357_aniversario_do_cliente.sql', 5],
      ['358_sentimos_sua_falta.sql', 2],
    ] as [string, number][]) {
      const r: any = await repetirNaCorridaDeCatalogo(() => pool.query(semFkCompartilhada(readFileSync(join(MIGS, arq), 'utf8'))));
      const conf = (Array.isArray(r) ? r[r.length - 1] : r).rows as { objeto: string; ok: boolean }[];
      if (conf.length !== linhas || conf.some((l) => !l.ok)) throw new Error(`conferência da ${arq}: ${JSON.stringify(conf)}`);
    }
    db = drizzle(pool, { schema });
  });

  afterAll(async () => {
    if (segredoAntes === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = segredoAntes;
    await pool?.end();
    if (!admin) return;
    for (const t of empresas) {
      await admin.query(`delete from cupom_uso where tenant_id = $1`, [t]).catch(() => {});
      await admin.query(`delete from cupom where tenant_id = $1`, [t]).catch(() => {});
      await admin.query(`delete from pedido_externo where tenant_id = $1`, [t]).catch(() => {});
      await admin.query(`delete from cliente where tenant_id = $1`, [t]).catch(() => {});
      await admin.query(`delete from cardapio_config where tenant_id = $1`, [t]).catch(() => {});
      await admin.query(`delete from empresa where id = $1`, [t]).catch(() => {});
    }
    await admin.query(`drop schema if exists ${SCHEMA} cascade`);
    await admin.end();
  });

  async function empresa(ajustes: Record<string, unknown> = {}) {
    const [{ id: t }] = (await admin.query(`insert into empresa (nome) values ('Teste aniversário') returning id`)).rows;
    empresas.push(t);
    const token = `tok-${randomUUID().slice(0, 12)}`;
    await admin.query(
      `insert into cardapio_config (tenant_id, unidade_id, token, ativo, nome_publico, horarios) values ($1, null, $2, true, 'Burger da Praça', $3::jsonb)`,
      [t, token, JSON.stringify(semana())],
    );
    const a: Record<string, unknown> = { aniversario_ativo: true, ...ajustes };
    const cols = Object.keys(a);
    await q(`insert into relacionamento_config (tenant_id, ${cols.join(', ')}) values ($1, ${cols.map((_, i) => `$${i + 2}`).join(', ')})`, [t, ...cols.map((k) => a[k])]);
    return { t, token };
  }
  /** Cliente com pedido pelo cardápio (ou só pela 99), pediu há `diasPedido` dias; com aniversário informado há `diasInformado`. */
  async function cliente(t: string, nome: string, tel: string, aniv: { iso?: string; dia?: number; mes?: number; diasInformado?: number } | null, o: { canal?: string; diasPedido?: number } = {}) {
    const diasPedido = o.diasPedido ?? 20;
    const [{ id }] = (
      await admin.query(`insert into cliente (tenant_id, nome, telefone, ultimo_pedido_em) values ($1,$2,$3, now() - make_interval(days => $4::int)) returning id`, [t, nome, tel, diasPedido])
    ).rows;
    await admin.query(
      `insert into pedido_externo (tenant_id, canal, tipo, itens, total, status, cliente_nome, cliente_telefone, client_ref, cliente_id, criado_em)
       values ($1,$2,'entrega','[]'::jsonb,50,'concluido',$3,$4,$5,$6, now() - make_interval(days => $7::int))`,
      [t, o.canal ?? 'cardapio', nome, tel, randomUUID(), id, diasPedido],
    );
    if (aniv) {
      const { dia, mes } = aniv.iso ? diaMes(aniv.iso) : { dia: aniv.dia as number, mes: aniv.mes as number };
      await q(
        `insert into cliente_aniversario (cliente_id, tenant_id, dia, mes, informado_em, origem) values ($1,$2,$3,$4, now() - make_interval(days => $5::int), 'perfil')`,
        [id, t, dia, mes, aniv.diasInformado ?? 60],
      );
    }
    return id as string;
  }

  function automaticas(provedor: 'evolution' | 'cloud' = 'evolution') {
    const saidas: any[] = [];
    const numeros = { resolver: async () => (provedor === 'cloud' ? { provedor: 'cloud', phoneId: 'PH-MKT', instancia: null } : { provedor: 'evolution', instancia: 'mkt-1' }) };
    const cloud = {
      enviarTemplate: async (_t: string, para: string, nome: string, _i: string, params: string[], opts: any) => void saidas.push({ como: 'modelo', para, nome, params, opts }),
      atualizarModelo: async () => undefined,
      garantirModeloRelacionamento: async () => 'pendente',
    };
    const whatsapp = { enviarPorInstancia: async (_t: string, _i: string, para: string, texto: string) => void saidas.push({ como: 'qr', para, texto }) };
    return { svc: new RelacionamentoService(db, numeros as any, cloud as any, whatsapp as any), saidas };
  }

  it('a regra em SQL dá o mesmo que em JS: carência no limite, 29/02 e a virada do ano (V74)', async () => {
    const { t } = await empresa();
    const casos = [
      { nome: 'limite exato', dia: 20, mes: 11, informado: '2026-10-21T15:00:00Z' }, // vale desde 20/11
      { nome: 'um dia antes', dia: 20, mes: 11, informado: '2026-10-22T15:00:00Z' }, // vale desde 21/11
      { nome: 'informado à noite', dia: 20, mes: 11, informado: '2026-10-22T01:30:00Z' }, // 21/10 22h30 em SP: vale desde 20/11
      { nome: '29 de fevereiro', dia: 29, mes: 2, informado: '2026-01-01T15:00:00Z' },
      { nome: '31 de dezembro', dia: 31, mes: 12, informado: '2026-01-01T15:00:00Z' },
      { nome: '2 de janeiro', dia: 2, mes: 1, informado: '2026-01-01T15:00:00Z' },
      { nome: '2 de janeiro recente', dia: 2, mes: 1, informado: '2026-12-10T15:00:00Z' },
    ];
    const ids: Record<string, any> = {};
    for (const c of casos) {
      const [{ id }] = (await admin.query(`insert into cliente (tenant_id, nome, telefone) values ($1,$2,$3) returning id`, [t, c.nome, `2198${Math.floor(Math.random() * 1e7)}`])).rows;
      await q(`insert into cliente_aniversario (cliente_id, tenant_id, dia, mes, informado_em, origem) values ($1,$2,$3,$4,$5,'perfil')`, [id, t, c.dia, c.mes, c.informado]);
      ids[id] = c;
    }
    const janelas = [
      ['2026-11-15', '2026-11-21'],
      ['2026-11-20', '2026-11-20'],
      ['2027-02-27', '2027-03-01'],
      ['2026-12-27', '2027-01-02'],
      ['2026-12-28', '2027-01-03'],
    ];
    for (const [desde, ate] of janelas) {
      const r: any = await db.execute(sql`select c.id from cliente c where c.tenant_id = ${t}::uuid ${sqlAniversarioEntre(desde, ate)}`);
      const peloSql = new Set(((r.rows ?? r) as any[]).map((x) => x.id));
      for (const [id, c] of Object.entries(ids)) {
        const peloJs = aniversarioValendoEntre({ dia: c.dia, mes: c.mes, informadoEm: c.informado }, desde, ate) !== null;
        expect(`${desde}..${ate} ${c.nome}: ${peloSql.has(id)}`).toBe(`${desde}..${ate} ${c.nome}: ${peloJs}`);
      }
    }
  });

  it('o cliente informa e corrige UMA vez; a pergunta da confirmação só com a automática ligada; "Agora não" não pergunta de novo', async () => {
    const { t } = await empresa();
    const marina = await cliente(t, 'Marina Lopes', '21987650001', null);
    const auditados: any[] = [];
    const svc = new AniversarioService(db, { registrar: async (e: any) => void auditados.push(e) } as any);
    expect((await svc.paraOCliente(t, marina)).perguntar).toBe(true);
    await svc.peloCliente(t, marina, { dia: 5, mes: 11, origem: 'confirmacao' });
    let e = await svc.doCliente(t, marina);
    expect(e).toMatchObject({ dia: 5, mes: 11, origem: 'confirmacao', correcoesCliente: 0, podeCorrigir: true });
    expect((await svc.paraOCliente(t, marina)).perguntar).toBe(false);
    await svc.peloCliente(t, marina, { dia: 5, mes: 11 }); // a mesma data: nada muda
    expect((await svc.doCliente(t, marina))?.correcoesCliente).toBe(0);
    await svc.peloCliente(t, marina, { dia: 6, mes: 11, origem: 'perfil' });
    e = await svc.doCliente(t, marina);
    expect(e).toMatchObject({ dia: 6, mes: 11, correcoesCliente: 1, podeCorrigir: false });
    await expect(svc.peloCliente(t, marina, { dia: 7, mes: 11 })).rejects.toThrow('já corrigiu a data uma vez');
    expect(auditados.map((a) => a.acao)).toEqual(['cliente_informou_aniversario', 'cliente_corrigiu_aniversario']);
    expect(auditados[1].detalhe).toMatchObject({ de: '5 de novembro', para: '6 de novembro' });

    const paulo = await cliente(t, 'Paulo Reis', '21987650002', null);
    await svc.agoraNao(t, paulo);
    expect((await svc.paraOCliente(t, paulo)).perguntar).toBe(false);
    await svc.peloCliente(t, paulo, { dia: 1, mes: 3 }); // o Perfil continua aceitando
    expect((await svc.doCliente(t, paulo))?.dia).toBe(1);
    await q(`update relacionamento_config set aniversario_ativo = false where tenant_id = $1`, [t]);
    const julia = await cliente(t, 'Júlia Melo', '21987650003', null);
    expect((await svc.paraOCliente(t, julia)).perguntar).toBe(false); // automática desligada: não pergunta
  });

  it('a loja anota sem motivo; para TROCAR, só com o motivo — e fica na auditoria com quem, de, para e o motivo', async () => {
    const { t } = await empresa();
    const marina = await cliente(t, 'Marina Lopes', '21987650001', null);
    const auditados: any[] = [];
    const svc = new AniversarioService(db, { registrar: async (e: any) => void auditados.push(e) } as any);
    const gerente: any = { tenantId: t, colaboradorId: null, categoria: 'gerente' };
    await svc.pelaLoja(gerente, marina, { dia: 5, mes: 11 });
    await expect(svc.pelaLoja(gerente, marina, { dia: 6, mes: 11, motivo: '' })).rejects.toThrow('Escreva o motivo');
    const r = await svc.pelaLoja(gerente, marina, { dia: 6, mes: 11, motivo: 'o cliente mostrou o documento' });
    expect(r).toMatchObject({ dia: 6, mes: 11, origem: 'loja', podeCorrigirCliente: true });
    expect(auditados.map((a) => a.acao)).toEqual(['loja_anotou_aniversario', 'loja_corrigiu_aniversario']);
    expect(auditados[1].detalhe).toEqual({ de: '5 de novembro', para: '6 de novembro', motivo: 'o cliente mostrou o documento' });
    await expect(svc.pelaLoja({ ...gerente, tenantId: (await empresa()).t }, marina, { dia: 1, mes: 1 })).rejects.toThrow('Cliente não encontrado');
  });

  it('o cupom pessoal só vale para o dono (token no cardápio, número no robô); "só aniversariantes": a semana valendo, uma vez em 12 meses', async () => {
    const { t, token } = await empresa();
    const hoje = hojeISO();
    const marina = await cliente(t, 'Marina Lopes', '21987650001', { iso: hoje, diasInformado: 60 });
    const paulo = await cliente(t, 'Paulo Reis', '21987650002', { iso: hoje, diasInformado: 10 }); // carência: não vale
    const aniversario = new AniversarioService(db);
    const cardapio = new (CardapioService as any)(db, {}, {}, {}, {}, {}, { emit: () => true }, {}, undefined, undefined, aniversario) as CardapioService;
    const [pessoal] = await q(`insert into cupom (tenant_id, codigo, tipo, valor, ativo, max_usos) values ($1,'NIVERAAAAA','valor','10',true,1) returning id`, [t]);
    await q(`insert into cupom_regra (cupom_id, tenant_id, cliente_id, chave_telefone, origem) values ($1,$2,$3,'21987650001','aniversario')`, [pessoal.id, t, marina]);
    const daMarina = assinarCliente(marina, t);
    const doPaulo = assinarCliente(paulo, t);
    expect(await cardapio.validarCupomPublico(token, 'niveraaaaa', 50, '21987650001', { clienteToken: daMarina })).toMatchObject({ valido: true, desconto: 10 });
    expect(await cardapio.validarCupomPublico(token, 'NIVERAAAAA', 50, '21987650001', { clienteToken: doPaulo })).toMatchObject({ valido: false, motivo: 'Este cupom é pessoal e não é seu.' });
    expect((await cardapio.validarCupomPublico(token, 'NIVERAAAAA', 50, '21987650001')).motivo).toMatch(/entre em Sua conta/); // telefone digitado não prova
    expect(await cardapio.validarCupomPublico(token, 'NIVERAAAAA', 50, '5521987650001', { telefoneVerificado: true })).toMatchObject({ valido: true });
    expect(await cardapio.validarCupomPublico(token, 'NIVERAAAAA', 50, '21987650002', { telefoneVerificado: true })).toMatchObject({ valido: false });

    const [loja] = await q(`insert into cupom (tenant_id, codigo, tipo, valor, ativo) values ($1,'NIVERSEMANA','percentual','15',true) returning id`, [t]);
    await q(`insert into cupom_regra (cupom_id, tenant_id, so_aniversariantes) values ($1,$2,true)`, [loja.id, t]);
    expect(await cardapio.validarCupomPublico(token, 'NIVERSEMANA', 100, undefined, { clienteToken: daMarina })).toMatchObject({ valido: true, desconto: 15 });
    expect((await cardapio.validarCupomPublico(token, 'NIVERSEMANA', 100, undefined, { clienteToken: doPaulo })).motivo).toMatch(/30 dias ou mais/);
    expect((await cardapio.validarCupomPublico(token, 'NIVERSEMANA', 100, '21987650001')).motivo).toMatch(/entre em Sua conta/);
    await q(`insert into cupom_uso (tenant_id, cupom_id, cliente_id, telefone) values ($1,$2,$3,'21987650001')`, [t, loja.id, marina]);
    expect((await cardapio.validarCupomPublico(token, 'NIVERSEMANA', 100, undefined, { clienteToken: daMarina })).motivo).toMatch(/últimos 12 meses/);

    // As listas: o pessoal some da loja e do público; o "só aniversariantes" aparece marcado na lista da loja.
    const daLoja: any[] = await cardapio.listarCupons(t);
    expect(daLoja.map((c) => [c.codigo, c.soAniversariantes])).toEqual([['NIVERSEMANA', true]]);
    const publico: any = await (cardapio as any).promosPublico(token);
    expect(publico.cupons.map((c: any) => c.codigo)).toEqual(['NIVERSEMANA']);
    await expect(cardapio.criarCupom(t, null, { codigo: 'niveraaaaa', tipo: 'valor', valor: 5 })).rejects.toThrow('presente pessoal');
    await expect(cardapio.criarCupom(t, null, { codigo: 'X1', valor: 5, soAniversariantes: true, somenteNovos: true })).rejects.toThrow('não se combina');
    const novo: any = await cardapio.criarCupom(t, null, { codigo: 'aniver20', tipo: 'percentual', valor: 20, soAniversariantes: true });
    expect(novo.soAniversariantes).toBe(true);
    expect((await aniversario.regraDoCupom(novo.id))?.soAniversariantes).toBe(true);
  });

  it('a automática: quem ganha passa pela proteção; o cupom pessoal nasce na hora de mandar; o clique já aplica o cupom', async () => {
    const { t, token } = await empresa();
    const hoje = hojeISO();
    const marina = await cliente(t, 'Marina Lopes', '21987650001', { iso: hoje }); // hoje: ganha
    await cliente(t, 'Rita Souza', '21987650002', { iso: somarDias(hoje, -2) }); // 2 dias atrás (loja fechada): ganha
    await cliente(t, 'Rui Prado', '21987650003', { iso: hoje, diasInformado: 10 }); // informou há 10 dias: ano que vem
    await cliente(t, 'Fábio Nunes', '21987650004', { iso: hoje });
    await q(`insert into marketing_optout (tenant_id, telefone) values ($1, '5521987650004')`, [t]); // saiu
    await cliente(t, 'Bia Reis', '21987650005', { iso: hoje }, { diasPedido: 400 }); // não pede há 12 meses
    const caio = await cliente(t, 'Caio Tavares', '21987650006', { iso: hoje });
    await q(`update cliente_aniversario set ultimo_presente_em = now() - interval '100 days' where cliente_id = $1`, [caio]); // já ganhou
    await cliente(t, 'Igor Vaz', '21987650007', { iso: somarDias(hoje, 5) }); // daqui a 5 dias: fora da janela de hoje
    await cliente(t, 'Nina Lima', '21987650008', { iso: hoje }, { canal: '99food' }); // só pela 99

    const { svc, saidas } = automaticas('evolution');
    // A prévia (próximos 7 dias) com o motivo de cada um.
    const previa = await svc.previaAniversario(t, await svc.ajustes(t));
    const motivos = Object.fromEntries(previa.lista.map((x: any) => [x.nome, x.detalhe.replace(/^\d\d\/\d\d · /, '')]));
    expect(motivos['Marina L.']).toBe('cupom R$ 10 de desconto em pedido acima de R$ 40');
    expect(motivos['Igor V.']).toBe('cupom R$ 10 de desconto em pedido acima de R$ 40');
    expect(motivos['Rui P.']).toMatch(/fica para o ano que vem \(menos de 30 dias\)$/);
    expect(motivos['Fábio N.']).toBe('pediu para sair: não recebe');
    expect(motivos['Bia R.']).toBe('não pede há mais de 12 meses');
    expect(motivos['Caio T.']).toBe('já ganhou presente nos últimos 12 meses');
    expect(motivos['Nina L.']).toBe('só pediu pelo iFood ou pela 99');
    expect(motivos['Rita S.']).toBeUndefined(); // passou: fora dos próximos 7 dias

    expect(await svc.rodarEmpresa(t, naJanela())).toEqual({ separados: 2, enviados: 1 });
    expect(await svc.rodarEmpresa(t, naJanela())).toEqual({ separados: 0, enviados: 1 });
    expect(await svc.rodarEmpresa(t, naJanela())).toEqual({ separados: 0, enviados: 0 });
    expect(saidas.map((s) => s.para).sort()).toEqual(['5521987650001', '5521987650002']);
    const daMarina = saidas.find((s) => s.para === '5521987650001');
    expect(daMarina.texto).toContain('Parabéns, Marina! 🎉 Para comemorar, a Burger da Praça te dá R$ 10 de desconto em pedido acima de R$ 40, até');
    expect(daMarina.texto).toMatch(/Cupom: NIVER[A-Z2-9]{5}/);
    expect(daMarina.texto).toContain('responda SAIR');

    const cupons = await q(`select c.codigo, c.tipo, c.valor::float8 as valor, c.minimo::float8 as minimo, c.max_usos, c.validade, r.cliente_id, r.origem
                              from cupom c join cupom_regra r on r.cupom_id = c.id where c.tenant_id = $1 order by c.codigo`, [t]);
    expect(cupons).toHaveLength(2);
    const doDela = cupons.find((c: any) => c.cliente_id === marina);
    expect(doDela).toMatchObject({ tipo: 'valor', valor: 10, minimo: 40, max_usos: 1, origem: 'aniversario' });
    expect(String(doDela.validade instanceof Date ? doDela.validade.toISOString() : doDela.validade).slice(0, 10)).toBe(somarDias(hoje, 7));
    expect(daMarina.texto).toContain(`Cupom: ${doDela.codigo}`);
    const [{ ultimo_presente_em }] = await q(`select ultimo_presente_em from cliente_aniversario where cliente_id = $1`, [marina]);
    expect(ultimo_presente_em).not.toBeNull();

    const [env] = await q(`select id from relacionamento_envio where tenant_id = $1 and cliente_id = $2`, [t, marina]);
    const antes = process.env.CARDAPIO_PUBLIC_URL;
    process.env.CARDAPIO_PUBLIC_URL = 'https://app.exemplo';
    try {
      expect(await svc.destinoDoClique(env.id)).toBe(`https://app.exemplo/c/${token}?cupom=${doDela.codigo}`);
    } finally {
      if (antes === undefined) delete process.env.CARDAPIO_PUBLIC_URL;
      else process.env.CARDAPIO_PUBLIC_URL = antes;
    }
    const presentes = await new AniversarioService(db).presentesDoCliente(t, marina);
    expect(presentes).toEqual([{ codigo: doDela.codigo, origem: 'aniversario', descricao: 'R$ 10 de desconto em pedido acima de R$ 40', validade: somarDias(hoje, 7) }]);
  });

  it('API oficial: o modelo com o presente (nome, presente, até quando e o cupom no botão); sem presente, o dos parabéns e nenhum cupom', async () => {
    const { t } = await empresa();
    const hoje = hojeISO();
    await cliente(t, 'Marina Lopes', '21987650001', { iso: hoje });
    await q(`insert into whatsapp_template (tenant_id, nome, categoria, status) values ($1,$2,'MARKETING','aprovado'), ($1,$3,'MARKETING','aprovado')`, [t, MODELO_ANIV_PRESENTE, MODELO_ANIV_PARABENS]);
    const { svc, saidas } = automaticas('cloud');
    expect(await svc.rodarEmpresa(t, naJanela())).toEqual({ separados: 1, enviados: 1 });
    expect(saidas[0]).toMatchObject({ como: 'modelo', nome: MODELO_ANIV_PRESENTE, para: '5521987650001' });
    expect(saidas[0].params.slice(0, 2)).toEqual(['Marina', 'R$ 10 de desconto em pedido acima de R$ 40']);
    expect(saidas[0].opts.cupom).toMatch(/^NIVER[A-Z2-9]{5}$/);
    expect(saidas[0].opts.phoneId).toBe('PH-MKT');

    const { t: t2 } = await empresa({ aniversario_presente: 'nada' });
    const nina = await cliente(t2, 'Nina Lima', '21987650009', { iso: hoje });
    await q(`insert into whatsapp_template (tenant_id, nome, categoria, status) values ($1,$2,'MARKETING','aprovado')`, [t2, MODELO_ANIV_PARABENS]);
    const outro = automaticas('cloud');
    await outro.svc.rodarEmpresa(t2, naJanela());
    expect(outro.saidas[0]).toMatchObject({ nome: MODELO_ANIV_PARABENS, params: ['Nina'] });
    expect(await q(`select 1 from cupom where tenant_id = $1`, [t2])).toHaveLength(0);
    const [{ ultimo_presente_em }] = await q(`select ultimo_presente_em from cliente_aniversario where cliente_id = $1`, [nina]);
    expect(ultimo_presente_em).toBeNull(); // parabéns não é presente: o dos 12 meses fica livre
  });

  it('o envio falhou: a linha volta como falha e o cupom pessoal fica desligado (ninguém usa presente que não chegou)', async () => {
    const { t } = await empresa();
    const marina = await cliente(t, 'Marina Lopes', '21987650001', { iso: hojeISO() });
    const numeros = { resolver: async () => ({ provedor: 'evolution', instancia: 'mkt-1' }) };
    const whatsapp = {
      enviarPorInstancia: async () => {
        throw new Error('o WhatsApp recusou');
      },
    };
    const svc = new RelacionamentoService(db, numeros as any, {} as any, whatsapp as any);
    expect(await svc.rodarEmpresa(t, naJanela())).toEqual({ separados: 1, enviados: 0 });
    const [env] = await q(`select status, motivo, cupom_id from relacionamento_envio where tenant_id = $1`, [t]);
    expect(env).toMatchObject({ status: 'falha', motivo: 'o WhatsApp recusou', cupom_id: null });
    const cupons = await q(`select ativo from cupom where tenant_id = $1`, [t]);
    expect(cupons).toEqual([{ ativo: false }]);
    const [{ ultimo_presente_em }] = await q(`select ultimo_presente_em from cliente_aniversario where cliente_id = $1`, [marina]);
    expect(ultimo_presente_em).toBeNull();
  });

  it('a campanha "aniversariantes desta semana" usa a mesma regra', async () => {
    const { t } = await empresa();
    const { inicio } = semanaDe(hojeISO());
    await cliente(t, 'Marina Lopes', '21987650001', { iso: inicio }); // domingo desta semana, valendo
    await cliente(t, 'Rui Prado', '21987650003', { iso: inicio, diasInformado: 5 }); // carência
    await cliente(t, 'Igor Vaz', '21987650007', { iso: somarDias(inicio, 7) }); // a semana que vem
    const campanhas = new CampanhaService(db, {} as any, {} as any, {} as any);
    expect((await campanhas.previa(t, 'aniversario_semana')).total).toBe(1);
  });
});
