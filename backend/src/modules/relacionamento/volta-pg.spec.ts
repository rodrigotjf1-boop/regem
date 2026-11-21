import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../../db/schema';
import { repetirNaCorridaDeCatalogo } from '../../common/corrida-de-catalogo';
import { hojeISO, somarDias } from '../../common/data';
import { agoraNaOperacao, janelaDoInicioDoMes } from './relacionamento';
import { MODELO_VOLTA_CUPOM, MODELO_VOLTA_LEMBRETE, RelacionamentoService } from './relacionamento.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

// "SENTIMOS SUA FALTA" (Onda 3 · PR 4, mig 358), contra o Postgres real: quem é chamado (N dias sem pedir, a janela de 30
// dias da 1ª chamada, o mínimo de pedidos, quem saiu, só iFood/99, caso aberto no Atendimento, a frequência com as
// campanhas), as tentativas (a 2ª 60 dias depois, o pedido novo zera), o que muda depois de separado (voltou a pedir, caso
// aberto), o cupom pessoal, os modelos da API oficial, o "Quem voltou" e o clique com o cupom.
// O banco do CI é o de uma loja: as tabelas só da nuvem sobem num schema SÓ DESTE TESTE (LIC-088).
const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('volta-pg.spec: sem TEST_PG_URL — PULADO');
jest.setTimeout(120_000);

const MIGS = join(__dirname, '..', '..', '..', '..', 'database', 'migrations');
const semFkCompartilhada = (s: string) => s.replace(/\s+references\s+(empresa|unidade|cliente|cupom)\s*\(\s*id\s*\)(\s+on\s+delete\s+cascade)?/gi, '');
const semana = () => [0, 1, 2, 3, 4, 5, 6].map((dia) => ({ dia, ativo: true, abre: '18:00', fecha: '23:00' }));
const naJanela = () => ({ dia: agoraNaOperacao().dia, hhmm: '17:05' });

descrever('sentimos sua falta (Postgres)', () => {
  const SCHEMA = `teste_volta_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
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
    for (const [arq, linhas] of [
      ['356_relacionamento_automaticas.sql', 5],
      ['357_aniversario_do_cliente.sql', 5],
      ['358_sentimos_sua_falta.sql', 2],
      ['459_perfil_do_cliente.sql', 4],
    ] as [string, number][]) {
      const r: any = await repetirNaCorridaDeCatalogo(() => pool.query(semFkCompartilhada(readFileSync(join(MIGS, arq), 'utf8'))));
      const conf = (Array.isArray(r) ? r[r.length - 1] : r).rows as { objeto: string; ok: boolean }[];
      if (conf.length !== linhas || conf.some((l) => !l.ok)) throw new Error(`conferência da ${arq}: ${JSON.stringify(conf)}`);
    }
    // A coluna "pelo ritmo" (mig 464, F7 parte 2 do perfil do cliente).
    await pool.query(readFileSync(join(MIGS, '464_relacionamento_volta_pelo_ritmo.sql'), 'utf8'));
    // O "Início do mês" (F7 parte 4c): o aceite clicado (300), o selo (463) e a coluna + a trava (486).
    for (const arq of ['300_marketing_consentimento.sql', '463_cliente_evento_sensibilidade.sql', '486_automatica_inicio_mes.sql'])
      await repetirNaCorridaDeCatalogo(() => pool.query(semFkCompartilhada(readFileSync(join(MIGS, arq), 'utf8'))));
    db = drizzle(pool, { schema });
  });

  afterAll(async () => {
    await pool?.end();
    if (!admin) return;
    for (const t of empresas) {
      await admin.query(`delete from modulo_ativacao where tenant_id = $1`, [t]).catch(() => {});
      await admin.query(`delete from cupom_uso where tenant_id = $1`, [t]).catch(() => {});
      await admin.query(`delete from cupom where tenant_id = $1`, [t]).catch(() => {});
      await admin.query(`delete from atendimento_chamado where tenant_id = $1`, [t]).catch(() => {});
      await admin.query(`delete from pedido_externo where tenant_id = $1`, [t]).catch(() => {});
      await admin.query(`delete from cliente where tenant_id = $1`, [t]).catch(() => {});
      await admin.query(`delete from cardapio_config where tenant_id = $1`, [t]).catch(() => {});
      await admin.query(`delete from empresa where id = $1`, [t]).catch(() => {});
    }
    await admin.query(`drop schema if exists ${SCHEMA} cascade`);
    await admin.end();
  });

  async function empresa(ajustes: Record<string, unknown> = {}) {
    const [{ id: t }] = (await admin.query(`insert into empresa (nome) values ('Teste volta') returning id`)).rows;
    empresas.push(t);
    const token = `tok-${randomUUID().slice(0, 12)}`;
    await admin.query(
      `insert into cardapio_config (tenant_id, unidade_id, token, ativo, nome_publico, horarios) values ($1, null, $2, true, 'Burger da Praça', $3::jsonb)`,
      [t, token, JSON.stringify(semana())],
    );
    const a: Record<string, unknown> = { volta_ativo: true, ...ajustes };
    const cols = Object.keys(a);
    await q(`insert into relacionamento_config (tenant_id, ${cols.join(', ')}) values ($1, ${cols.map((_, i) => `$${i + 2}`).join(', ')})`, [t, ...cols.map((k) => a[k])]);
    return { t, token };
  }
  /** Cliente com `pedidos` pedidos, o último há `dias` dias (pelo cardápio ou só pela 99). */
  async function cliente(t: string, nome: string, tel: string, dias: number, o: { pedidos?: number; canal?: string } = {}) {
    const pedidos = o.pedidos ?? 3;
    const [{ id }] = (
      await admin.query(
        `insert into cliente (tenant_id, nome, telefone, ultimo_pedido_em, total_pedidos) values ($1,$2,$3, now() - make_interval(days => $4::int), $5) returning id`,
        [t, nome, tel, dias, pedidos],
      )
    ).rows;
    await admin.query(
      `insert into pedido_externo (tenant_id, canal, tipo, itens, total, status, cliente_nome, cliente_telefone, client_ref, cliente_id, criado_em)
       values ($1,$2,'entrega','[]'::jsonb,50,'concluido',$3,$4,$5,$6, now() - make_interval(days => $7::int))`,
      [t, o.canal ?? 'cardapio', nome, tel, randomUUID(), id, dias],
    );
    return id as string;
  }
  function automaticas(provedor: 'evolution' | 'cloud' = 'evolution', falhar = false) {
    const saidas: any[] = [];
    const numeros = { resolver: async () => (provedor === 'cloud' ? { provedor: 'cloud', phoneId: 'PH-MKT', instancia: null } : { provedor: 'evolution', instancia: 'mkt-1' }) };
    const cloud = {
      enviarTemplate: async (_t: string, para: string, nome: string, _i: string, params: string[], opts: any) => {
        if (falhar) throw new Error('a Meta recusou o envio');
        saidas.push({ como: 'modelo', para, nome, params, opts });
      },
      atualizarModelo: async () => undefined,
    };
    const whatsapp = { enviarPorInstancia: async (_t: string, _i: string, para: string, texto: string) => void saidas.push({ como: 'qr', para, texto }) };
    return { svc: new RelacionamentoService(db, numeros as any, cloud as any, whatsapp as any), saidas };
  }
  const envios = (t: string) => q(`select * from relacionamento_envio where tenant_id = $1 order by criado_em, chave_telefone`, [t]);

  it('quem é chamado: N dias sem pedir (até N + 30 na 1ª chamada), o mínimo de pedidos e quem fica fora', async () => {
    const { t } = await empresa({ volta_min_pedidos: 2 });
    await cliente(t, 'Paulo Reis', '21987660001', 31, { pedidos: 4 });
    await cliente(t, 'Sara Melo', '21987660002', 33, { pedidos: 2 });
    await cliente(t, 'Lia Gomes', '21987660003', 35, { pedidos: 1 }); // 1 pedido: o mínimo é 2
    await cliente(t, 'Igor Vaz', '21987660004', 75); // sumiu há mais tempo: fica para as campanhas
    await cliente(t, 'Teresa Alves', '21987660005', 10); // ainda não
    const nico = await cliente(t, 'Nico Prado', '21987660006', 35);
    await admin.query(`insert into atendimento_chamado (tenant_id, tipo, canal, prioridade, telefone, status) values ($1,'humano','whatsapp','normal','5521987660006','aberto')`, [t]);
    await cliente(t, 'Fábio Nunes', '21987660007', 35);
    await q(`insert into marketing_optout (tenant_id, telefone) values ($1, '552187660007')`, [t]); // SAIR sem o nono dígito
    await cliente(t, 'Nina Lima', '21987660008', 35, { canal: '99food' });
    await cliente(t, 'Caio Tavares', '21987660009', 35);
    await q(`insert into campanha_envio (tenant_id, telefone, status, enviado_em) values ($1,'5521987660009','enviado', now() - interval '3 days')`, [t]);

    const { svc, saidas } = automaticas('evolution');
    const p: any = await svc.painel(t, naJanela());
    expect(p.volta.previa.lista.map((x: any) => x.nome)).toEqual(['Paulo R.', 'Sara M.']); // quem sumiu há menos tempo primeiro
    expect(p.volta.previa.lista[0].detalhe).toBe('31 dias sem pedir · 4 pedidos');
    expect(await svc.rodarEmpresa(t, naJanela())).toEqual({ separados: 2, enviados: 1 });
    expect(saidas[0].para).toBe('5521987660001');
    expect(saidas[0].texto).toContain('Oi, Paulo! Faz um tempo que você não pede na Burger da Praça. Para matar a saudade: R$ 8 de desconto em pedido acima de R$ 30, até');
    expect(saidas[0].texto).toMatch(/Cupom: VOLTA[A-Z2-9]{5}/);
    expect(saidas[0].texto).toContain('responda SAIR');
    expect(nico).toBeTruthy();
  });

  it('as tentativas: a 2ª sai 60 dias depois da 1ª, se não pediu no meio; o pedido novo zera; nunca mais de 2', async () => {
    const { t } = await empresa();
    const rafa = await cliente(t, 'Rafa Souza', '21987661001', 95); // 1ª há 62 dias: vai a 2ª
    const bia = await cliente(t, 'Bia Reis', '21987661002', 95); // 1ª há 30 dias: ainda não
    const duda = await cliente(t, 'Duda Lins', '21987661003', 150); // já teve as 2
    // O DIA é o da operação (`hojeISO()`, fuso da loja), como o serviço grava — nunca o `current_date` do banco, que no
    // CI é UTC: das 21h à meia-noite de Brasília o UTC já é o dia seguinte e a conferência não achava a linha (ERR-354, V46).
    const hoje = hojeISO();
    const tentativa = async (cli: string, tel: string, n: number, diasAtras: number) =>
      q(
        `insert into relacionamento_envio (tenant_id, tipo, chave_telefone, referencia, telefone, cliente_id, dia, status, enviado_em, oferta)
         select $1, 'volta', $2, to_char((c.ultimo_pedido_em at time zone 'America/Sao_Paulo')::date, 'YYYY-MM-DD') || '#' || $3::text, $2, c.id,
                $6::date - $4::int, 'enviado', now() - make_interval(days => $4::int), true
           from cliente c where c.id = $5`,
        [t, tel, String(n), diasAtras, cli, hoje],
      );
    await tentativa(rafa, '21987661001', 1, 62);
    await tentativa(bia, '21987661002', 1, 30);
    await tentativa(duda, '21987661003', 1, 120);
    await tentativa(duda, '21987661003', 2, 61);
    const { svc } = automaticas('evolution');
    expect((await svc.rodarEmpresa(t, naJanela())).separados).toBe(1);
    const [nova] = await q(`select referencia, status from relacionamento_envio where tenant_id = $1 and cliente_id = $2 and dia = $3::date`, [t, rafa, hoje]);
    expect(nova.referencia).toMatch(/#2$/);
    expect(bia && duda).toBeTruthy(); // a Bia (60 dias ainda não) e a Duda (já teve as 2) ficaram fora

    // O Gil foi chamado num ciclo antigo (há 70 dias), PEDIU DE NOVO (há 35 dias) e sumiu outra vez: as tentativas zeram —
    // é a 1ª chamada do ciclo novo (a referência é o dia do pedido novo, "#1"), não a 2ª do antigo.
    const gil = await cliente(t, 'Gil Rocha', '21987661004', 110);
    await tentativa(gil, '21987661004', 1, 70);
    await q(`update cliente set ultimo_pedido_em = now() - interval '35 days' where id = $1`, [gil]);
    const outro = automaticas('evolution');
    expect((await outro.svc.rodarEmpresa(t, naJanela())).separados).toBe(1);
    const doGil = await q(`select referencia from relacionamento_envio where tenant_id = $1 and cliente_id = $2 order by criado_em desc limit 1`, [t, gil]);
    expect(doGil[0].referencia).toBe(`${somarDias(hojeISO(), -35)}#1`);
  });

  it('depois de separado: quem voltou a pedir ou abriu caso no Atendimento não recebe', async () => {
    const { t } = await empresa();
    const paulo = await cliente(t, 'Paulo Reis', '21987662001', 31);
    await cliente(t, 'Sara Melo', '21987662002', 33);
    const { svc, saidas } = automaticas('cloud');
    await q(`insert into whatsapp_template (tenant_id, nome, categoria, status) values ($1,$2,'MARKETING','aprovado')`, [t, MODELO_VOLTA_CUPOM]);
    const a = await svc.ajustes(t);
    expect(await svc.separarVolta(t, hojeISO(), a)).toBe(2);
    await q(`update cliente set ultimo_pedido_em = now() where id = $1`, [paulo]); // voltou sozinho
    await admin.query(`insert into atendimento_chamado (tenant_id, tipo, canal, prioridade, telefone, status) values ($1,'humano','whatsapp','normal','21987662002','aberto')`, [t]);
    const pronto = await svc.prontidao(t, 'volta', a);
    expect(await svc.mandar(t, hojeISO(), a, pronto, 'volta')).toBe(0);
    expect(saidas).toHaveLength(0);
    expect((await envios(t)).map((e: any) => [e.status, e.motivo]).sort()).toEqual([
      ['fora', 'caso aberto no Atendimento'],
      ['fora', 'voltou a pedir'],
    ]);
    expect(await q(`select 1 from cupom where tenant_id = $1`, [t])).toHaveLength(0); // nenhum cupom à toa
  });

  it('API oficial: com cupom, o modelo com o presente e o cupom no botão; sem, o lembrete; "Quem voltou" e o clique com o cupom', async () => {
    const { t, token } = await empresa();
    const paulo = await cliente(t, 'Paulo Reis', '21987663001', 31);
    await q(`insert into whatsapp_template (tenant_id, nome, categoria, status) values ($1,$2,'MARKETING','aprovado')`, [t, MODELO_VOLTA_CUPOM]);
    const { svc, saidas } = automaticas('cloud');
    expect(await svc.rodarEmpresa(t, naJanela())).toEqual({ separados: 1, enviados: 1 });
    expect(saidas[0]).toMatchObject({ nome: MODELO_VOLTA_CUPOM, para: '5521987663001' });
    expect(saidas[0].params.slice(0, 2)).toEqual(['Paulo', 'R$ 8 de desconto em pedido acima de R$ 30']);
    expect(saidas[0].params[2]).toBe(`${somarDias(hojeISO(), 7).slice(8, 10)}/${somarDias(hojeISO(), 7).slice(5, 7)}`);
    const codigo = saidas[0].opts.cupom;
    expect(codigo).toMatch(/^VOLTA[A-Z2-9]{5}$/);
    const [cp] = await q(`select c.id, r.origem, r.cliente_id from cupom c join cupom_regra r on r.cupom_id = c.id where c.codigo = $1`, [codigo]);
    expect(cp).toMatchObject({ origem: 'volta', cliente_id: paulo });

    // Ele volta 2 dias depois, com o cupom.
    const [env] = await envios(t);
    await q(`update relacionamento_envio set enviado_em = now() - interval '2 days' where id = $1`, [env.id]);
    const [ped] = (
      await admin.query(
        `insert into pedido_externo (tenant_id, canal, tipo, itens, total, status, cliente_nome, cliente_telefone, client_ref, cliente_id, criado_em)
         values ($1,'cardapio','entrega','[]'::jsonb,64.9,'concluido','Paulo Reis','21987663001',$2,$3, now()) returning id`,
        [t, randomUUID(), paulo],
      )
    ).rows;
    await q(`insert into cupom_uso (tenant_id, cupom_id, cliente_id, telefone, pedido_id) values ($1,$2,$3,'21987663001',$4)`, [t, cp.id, paulo, ped.id]);
    // Uma mensagem mais antiga (20 dias): o pedido de hoje veio DEPOIS dos 7 dias dela — não conta como "voltou" por ela.
    await q(
      `insert into relacionamento_envio (tenant_id, tipo, chave_telefone, referencia, telefone, cliente_id, dia, status, enviado_em, oferta)
       values ($1,'volta',$2,'antiga#1',$2,$3,$4::date - 20,'enviado', now() - interval '20 days', true)`,
      [t, env.chave_telefone, paulo, hojeISO()], // o dia da operação, não o do banco (ERR-354)
    );
    expect(await svc.quemVoltou(t, 'volta')).toEqual([{ nome: 'Paulo R.', detalhe: 'pediu 2 dias depois · R$ 64,90 · usou o cupom' }]);
    expect(await svc.resultado(t, 'volta')).toMatchObject({ mensagens: 2, voltaram: 1, valor: 64.9, cupons: 1 });
    const antes = process.env.CARDAPIO_PUBLIC_URL;
    process.env.CARDAPIO_PUBLIC_URL = 'https://app.exemplo';
    try {
      expect(await svc.destinoDoClique(env.id)).toBe(`https://app.exemplo/c/${token}?cupom=${codigo}`);
    } finally {
      if (antes === undefined) delete process.env.CARDAPIO_PUBLIC_URL;
      else process.env.CARDAPIO_PUBLIC_URL = antes;
    }
    await expect(svc.quemVoltou(t, 'outro')).rejects.toThrow('desconhecida');

    const { t: t2 } = await empresa({ volta_presente: 'nada' });
    await cliente(t2, 'Sara Melo', '21987663002', 31);
    await q(`insert into whatsapp_template (tenant_id, nome, categoria, status) values ($1,$2,'MARKETING','aprovado')`, [t2, MODELO_VOLTA_LEMBRETE]);
    const outro = automaticas('cloud');
    await outro.svc.rodarEmpresa(t2, naJanela());
    expect(outro.saidas[0]).toMatchObject({ nome: MODELO_VOLTA_LEMBRETE, params: ['Sara'] });
    expect(await q(`select 1 from cupom where tenant_id = $1`, [t2])).toHaveLength(0);
  });

  it('uma oferta por dia: o aniversário ainda na fila (pelo QR sai 1 por minuto) segura o "sentimos sua falta" da mesma pessoa', async () => {
    // O Xavier faz aniversário hoje E não pede há 35 dias: é candidato das duas. A Ana (aniversário ontem) sai primeiro;
    // o aniversário do Xavier fica na fila — e o "sentimos sua falta" não pode separá-lo também (seriam 2 ofertas no dia).
    const { t } = await empresa({ aniversario_ativo: true });
    const hoje = hojeISO();
    const ontem = somarDias(hoje, -1);
    const ana = await cliente(t, 'Ana Prado', '21987664001', 3);
    const xavier = await cliente(t, 'Xavier Lins', '21987664002', 35);
    for (const [id, data] of [
      [ana, ontem],
      [xavier, hoje],
    ])
      await q(
        `insert into cliente_aniversario (cliente_id, tenant_id, dia, mes, informado_em, origem) values ($1,$2,$3,$4, now() - interval '60 days', 'perfil')`,
        [id, t, Number(data.slice(8, 10)), Number(data.slice(5, 7))],
      );
    const { svc, saidas } = automaticas('evolution');
    await svc.rodarEmpresa(t, naJanela()); // separa os dois aniversários e manda o da Ana; o do Xavier fica na fila
    await svc.rodarEmpresa(t, naJanela()); // manda o do Xavier
    await svc.rodarEmpresa(t, naJanela());
    expect(saidas.map((s) => s.para)).toEqual(['5521987664001', '5521987664002']);
    expect(saidas.every((s) => s.texto.startsWith('Parabéns, '))).toBe(true);
    expect((await envios(t)).filter((e: any) => e.tipo === 'volta' && e.cliente_id === xavier)).toHaveLength(0);
  });

  it('a prévia: as vagas do dia descontam o aniversário, que sai antes (o limite é de todas juntas)', async () => {
    const { t } = await empresa({ aniversario_ativo: true, max_por_dia: 10 });
    const hoje = hojeISO();
    for (let i = 0; i < 3; i++) {
      const id = await cliente(t, `Aniversariante ${i}`, `2198766600${i}`, 3);
      await q(
        `insert into cliente_aniversario (cliente_id, tenant_id, dia, mes, informado_em, origem) values ($1,$2,$3,$4, now() - interval '60 days', 'perfil')`,
        [id, t, Number(hoje.slice(8, 10)), Number(hoje.slice(5, 7))],
      );
    }
    for (let i = 0; i < 12; i++) await cliente(t, `Sumido ${i}`, `219876661${String(i).padStart(2, '0')}`, 31 + i);
    const { svc } = automaticas('evolution');
    const p: any = await svc.painel(t, naJanela());
    expect(p.volta.previa).toMatchObject({ total: 12, vagas: 7 });
    expect(p.cashback.previa).toMatchObject({ total: 0, vagas: 10 });

    // O limite corta: ficam os que sumiram há MENOS tempo (31 a 40 dias); os de 41 e 42 ficam para os próximos dias.
    const a = await svc.ajustes(t);
    expect(await svc.separarVolta(t, hojeISO(), a)).toBe(10);
    const nomes = (await q(`select c.nome from relacionamento_envio e join cliente c on c.id = e.cliente_id where e.tenant_id = $1 and e.tipo = 'volta'`, [t])).map((x: any) => x.nome);
    expect(nomes).not.toContain('Sumido 10');
    expect(nomes).not.toContain('Sumido 11');
  });

  it('falhou o envio: a linha vira falha com o motivo e o cupom criado fica desligado', async () => {
    const { t } = await empresa();
    await cliente(t, 'Paulo Reis', '21987667001', 31);
    await q(`insert into whatsapp_template (tenant_id, nome, categoria, status) values ($1,$2,'MARKETING','aprovado')`, [t, MODELO_VOLTA_CUPOM]);
    const { svc } = automaticas('cloud', true);
    expect(await svc.rodarEmpresa(t, naJanela())).toEqual({ separados: 1, enviados: 0 });
    expect((await envios(t)).map((e: any) => [e.status, e.motivo])).toEqual([['falha', 'a Meta recusou o envio']]);
    expect(await q(`select ativo from cupom where tenant_id = $1`, [t])).toEqual([{ ativo: false }]);
  });

  it('na hora de mandar, confere de novo: campanha que saiu depois da separação segura a oferta', async () => {
    const { t } = await empresa();
    await cliente(t, 'Paulo Reis', '21987665001', 31);
    const { svc, saidas } = automaticas('evolution');
    const a = await svc.ajustes(t);
    expect(await svc.separarVolta(t, hojeISO(), a)).toBe(1);
    await q(`insert into campanha_envio (tenant_id, telefone, status, enviado_em) values ($1,'5521987665001','enviado', now())`, [t]);
    const pronto = await svc.prontidao(t, 'volta', a);
    expect(await svc.mandar(t, hojeISO(), a, pronto, 'volta')).toBe(0);
    expect(saidas).toHaveLength(0);
    expect((await envios(t)).map((e: any) => [e.status, e.motivo])).toEqual([['fora', 'recebeu outra oferta nos últimos 7 dias']]);
    expect(await q(`select 1 from cupom where tenant_id = $1`, [t])).toHaveLength(0);
  });

  it('pelo ritmo (F7 parte 2, mig 464): o semanal com 12 dias, o mensal ainda não, quem não tem ritmo pelos dias fixos; módulo desligado = como antes', async () => {
    const perfil = (t: string, id: string, intervalo: number | null, pedidos: number) =>
      q(`insert into cliente_perfil (cliente_id, tenant_id, intervalo_dias, pedidos_diretos) values ($1,$2,$3,$4)`, [id, t, intervalo, pedidos]);
    const montar = async (moduloLigado: boolean) => {
      const { t } = await empresa({ volta_pelo_ritmo: true });
      if (moduloLigado) await admin.query(`insert into modulo_ativacao (tenant_id, modulo, ativo) values ($1,'perfil_cliente',true)`, [t]);
      await perfil(t, await cliente(t, 'Ana Semanal', '21987669001', 12), 7, 6); // 12 > 1,5 × 7 → chamada
      await perfil(t, await cliente(t, 'Bruno Mensal', '21987669002', 20), 30, 5); // 20 < 45 → ainda não
      await perfil(t, await cliente(t, 'Carla Nova', '21987669003', 31, { pedidos: 1 }), null, 1); // sem ritmo: 31 > 30 → chamada
      await cliente(t, 'Davi Recente', '21987669004', 10, { pedidos: 1 }); // sem ritmo e sem perfil: 10 < 30
      await perfil(t, await cliente(t, 'Eli Sumido', '21987669005', 80), 7, 6); // passou da janela (11 + 30): campanhas
      return t;
    };
    const { svc } = automaticas('evolution');
    const ligado: any = await svc.painel(await montar(true), naJanela());
    expect(ligado.perfilLigado).toBe(true);
    expect(ligado.ajustes.voltaPeloRitmo).toBe(true);
    expect(ligado.volta.previa.lista.map((x: any) => x.nome)).toEqual(['Ana S.', 'Carla N.']);
    // Módulo desligado: a opção não vale — os 30 dias fixos de sempre (a Ana, com 12, fica fora; o Bruno, com 20, também).
    const desligado: any = await svc.painel(await montar(false), naJanela());
    expect(desligado.perfilLigado).toBe(false);
    expect(desligado.volta.previa.lista.map((x: any) => x.nome)).toEqual(['Carla N.']);
    expect(desligado.inicioMes).toBeNull();
    expect(ligado.inicioMes.publico).toEqual({ comSelo: 0, comAceite: 0 });
  });

  // ─── "Início do mês" (F7 parte 4c, mig 486) ──────────────────────────────────────────────────────────────────────────
  const comSelo = (t: string, id: string) =>
    q(`insert into cliente_evento_sensibilidade (cliente_id, tipo, tenant_id, rr, prob, pedidos, esperado, dias_com_pedido, selo)
       values ($1,'dinheiro',$2,2,0.95,6,3,3,true)`, [id, t]);
  const aceitou = (t: string, tel: string, origem = 'cardapio_perfil') =>
    q(`insert into marketing_consentimento (tenant_id, telefone, telefone_chave, acao, origem) values ($1,$2,regem_telefone_chave($2),'aceite',$3)`, [t, tel, origem]);
  const ligarPerfil = (t: string) => admin.query(`insert into modulo_ativacao (tenant_id, modulo, ativo) values ($1,'perfil_cliente',true)`, [t]);
  /** Um pedido no meio do mês de operação de `mes`, sem depender da hora em que o teste roda. */
  const pediuNoMes = (id: string, mes: string) =>
    admin.query(`update cliente set ultimo_pedido_em = ($2 || '-01 12:00')::timestamp at time zone 'America/Sao_Paulo' where id = $1`, [id, mes]);

  it('a 486 pode rodar de novo e, fora do Regem, para na guarda sem mudar nada', async () => {
    const texto = readFileSync(join(MIGS, '486_automatica_inicio_mes.sql'), 'utf8');
    const r: any = await pool.query(texto);
    expect((Array.isArray(r) ? r[r.length - 1] : r).rows).toEqual([{ ok: true }]);
    const vazio = `${SCHEMA}_vazio`;
    await admin.query(`create schema ${vazio}`);
    const c = await admin.connect();
    try {
      await c.query(`set search_path to ${vazio}`);
      await expect(c.query(texto)).rejects.toThrow(/A 486 é do Regem/);
    } finally {
      await c.query('reset search_path').catch(() => {});
      c.release();
      await admin.query(`drop schema if exists ${vazio} cascade`);
    }
  });

  it('início do mês: só o selo + o aceite clicado + sem pedido no mês, e uma vez por mês', async () => {
    const { t } = await empresa({ volta_ativo: false, inicio_mes_ativo: true });
    await ligarPerfil(t);
    const mes = hojeISO().slice(0, 7);
    const dia = `${mes}-01`;
    const ana = await cliente(t, 'Ana Recebe', '21987668001', 40);
    await comSelo(t, ana);
    await aceitou(t, '21987668001');
    await aceitou(t, '21987668002', 'cardapio_perfil'); // sem selo
    await cliente(t, 'Bia Semselo', '21987668002', 40);
    await comSelo(t, await cliente(t, 'Caio Marcada', '21987668003', 40));
    await aceitou(t, '21987668003', 'cardapio_checkout_marcada'); // a caixa que já vinha marcada não é aceite (D15)
    await comSelo(t, await cliente(t, 'Davi Saiu', '21987668004', 40));
    await aceitou(t, '21987668004');
    await q(`insert into marketing_optout (tenant_id, telefone) values ($1,'5521987668004')`, [t]);
    const eva = await cliente(t, 'Eva Pediu', '21987668005', 40);
    await comSelo(t, eva);
    await aceitou(t, '21987668005');
    await pediuNoMes(eva, mes);
    await comSelo(t, await cliente(t, 'Fabio Ifood', '21987668006', 40, { canal: 'ifood' }));
    await aceitou(t, '21987668006');
    await comSelo(t, await cliente(t, 'Gil Caso', '21987668007', 40));
    await aceitou(t, '21987668007');
    await admin.query(`insert into atendimento_chamado (tenant_id, tipo, canal, prioridade, telefone, status) values ($1,'humano','whatsapp','normal','5521987668007','aberto')`, [t]);

    const { svc, saidas } = automaticas('evolution');
    const a = await svc.ajustes(t);
    expect(await svc.separarInicioMes(t, dia, a)).toBe(1);
    expect(await svc.separarInicioMes(t, dia, a)).toBe(0);
    const pronto = await svc.prontidao(t, 'inicio_mes', a);
    expect(await svc.mandar(t, dia, a, pronto, 'inicio_mes')).toBe(1);
    expect(saidas).toHaveLength(1);
    expect(saidas[0].para).toBe('5521987668001');
    expect(saidas[0].texto).toContain('Oi, Ana! Mês novo na Burger da Praça.');
    const [e] = await envios(t);
    expect({ tipo: e.tipo, status: e.status, referencia: e.referencia, oferta: e.oferta }).toEqual({ tipo: 'inicio_mes', status: 'enviado', referencia: mes, oferta: true });
    // Outro dia da mesma janela: a referência (o mês) não deixa repetir.
    expect(await svc.separarInicioMes(t, `${mes}-02`, a)).toBe(0);
  });

  it('início do mês: confere de novo na hora de mandar (pediu, tirou o aceite, abriu caso)', async () => {
    const { t } = await empresa({ volta_ativo: false, inicio_mes_ativo: true });
    await ligarPerfil(t);
    const mes = hojeISO().slice(0, 7);
    const dia = `${mes}-01`;
    const ids: string[] = [];
    for (const [nome, tel] of [['Hugo Pediu', '21987667001'], ['Iara Tirou', '21987667002'], ['Joao Caso', '21987667003']]) {
      const id = await cliente(t, nome, tel, 40);
      ids.push(id);
      await comSelo(t, id);
      await aceitou(t, tel);
    }
    const { svc, saidas } = automaticas('evolution');
    const a = await svc.ajustes(t);
    expect(await svc.separarInicioMes(t, dia, a)).toBe(3);
    await pediuNoMes(ids[0], mes);
    await q(`insert into marketing_consentimento (tenant_id, telefone, telefone_chave, acao, origem, em)
             values ($1,'21987667002',regem_telefone_chave('21987667002'),'recusa','cardapio_perfil', now() + interval '1 second')`, [t]);
    await admin.query(`insert into atendimento_chamado (tenant_id, tipo, canal, prioridade, telefone, status) values ($1,'humano','whatsapp','normal','5521987667003','aberto')`, [t]);
    const pronto = await svc.prontidao(t, 'inicio_mes', a);
    // Pelo QR sai uma por minuto: cada passada trata uma linha.
    for (let i = 0; i < 3; i += 1) expect(await svc.mandar(t, dia, a, pronto, 'inicio_mes')).toBe(0);
    expect(saidas).toHaveLength(0);
    const motivos = (await envios(t)).map((x: any) => `${x.status}: ${x.motivo}`).sort();
    expect(motivos).toEqual(['fora: caso aberto no Atendimento', 'fora: já pediu neste mês', 'fora: tirou o aceite das ofertas']);
  });

  it('início do mês: a tela mostra o público real; a rotina usa o modelo da Meta e só sai na janela', async () => {
    const { t } = await empresa({ volta_ativo: false, inicio_mes_ativo: true });
    await ligarPerfil(t);
    await q(`insert into whatsapp_template (tenant_id, nome, status, categoria) values ($1,'inicio_mes','aprovado','MARKETING')`, [t]);
    const ana = await cliente(t, 'Ana Modelo', '21987666001', 40);
    await comSelo(t, ana);
    await aceitou(t, '21987666001');
    await comSelo(t, await cliente(t, 'Bruno Semaceite', '21987666002', 40));
    const { svc, saidas } = automaticas('cloud');
    const p: any = await svc.painel(t, naJanela());
    expect(p.inicioMes.publico).toEqual({ comSelo: 2, comAceite: 1 });
    expect(p.inicioMes.previa.total).toBe(1);
    expect(p.inicioMes.previa.lista.map((x: any) => x.nome)).toEqual(['Ana M.']);
    expect(p.inicioMes.pronto).toBe(true);
    const { valendo } = janelaDoInicioDoMes(hojeISO());
    const r = await svc.rodarEmpresa(t, naJanela());
    expect(r.separados).toBe(valendo ? 1 : 0);
    expect(saidas).toHaveLength(valendo ? 1 : 0);
    if (valendo) expect({ nome: saidas[0].nome, params: saidas[0].params }).toEqual({ nome: 'inicio_mes', params: ['Ana'] });
  });
});
