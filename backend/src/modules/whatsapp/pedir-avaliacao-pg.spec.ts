import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { sql } from 'drizzle-orm';
import * as schema from '../../db/schema';
import { PedirAvaliacaoProcessor } from './pedir-avaliacao.processor';
import { TEXTO_PADRAO, lerAvaliacao, textoDaAvaliacao } from './pedir-avaliacao';
import { WhatsappProvedorService } from './whatsapp-provedor.service';
import { repetirNaCorridaDeCatalogo } from '../../common/corrida-de-catalogo';
import { hojeISO } from '../../common/data';

/* eslint-disable @typescript-eslint/no-explicit-any */

// "PEDIR AVALIAÇÃO NO GOOGLE" DEPOIS DA ENTREGA (mig 365), contra o Postgres real: quem pode receber (a conversa aberta já
// na consulta — ERR-360), as regras da loja ("só sem problema", "a partir do Nº pedido", "de novo depois de N dias só a
// quem não tocou"), quem saiu das mensagens, a equipe na conversa, UMA mensagem por pedido e por cliente por dia (duas
// réplicas), o toque no link, o plano pelo índice e o ajuste. As tabelas do robô são só da nuvem: o teste aplica as
// migrations (o banco do CI é o de uma loja); a lista de exclusão do marketing (mig 226, que altera tabelas que o banco da
// loja não tem) sobe num schema SÓ DESTE TESTE, sem FK para tabela compartilhada (LIC-088).
const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('pedir-avaliacao-pg.spec: sem TEST_PG_URL — PULADO');
jest.setTimeout(120_000);

const MIG = (arq: string) => join(__dirname, '../../../../database/migrations', arq);
const LINK = 'https://g.page/r/CabcDEF123/review';
const OUTRO_LINK = 'https://search.google.com/local/writereview?placeid=ChIJoutro';
const PUB = 'https://api.teste.regem/api/v1';
const NO_PEDIDO = '21987654321'; // o pedido guarda sem o 55
const NA_CONVERSA = '5521987654321'; // a conversa, com
const CHAVE = '21987654321';

descrever('"pedir avaliação" depois da entrega (Postgres)', () => {
  const SCHEMA = `teste_aval_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
  const admin = new Pool({ connectionString: URL_PG });
  const pool = new Pool({ connectionString: URL_PG, options: `-c search_path=${SCHEMA},public` });
  const db = drizzle(pool, { schema }) as any;
  const q = async (s: string, p: any[] = []) => (await pool.query(s, p)).rows;
  const enviados: { t: string; para: string; texto: string }[] = [];
  let falhar = false;
  const cloud: any = {
    enviarTexto: async (t: string, para: string, texto: string) => {
      if (falhar) throw new Error('a Meta recusou');
      enviados.push({ t, para, texto });
    },
  };
  const rotina = new PedirAvaliacaoProcessor(db, cloud);
  const auditados: any[] = [];
  const auditoria = { registrar: async (a: any) => void auditados.push(a) } as any;
  const ajustes = new WhatsappProvedorService(db, auditoria, {} as any, {} as any);
  const empresas: string[] = [];
  const pubAntes = process.env.PUBLIC_API_BASE;

  const aplicar = (arq: string) =>
    repetirNaCorridaDeCatalogo(async () => {
      const c = await admin.connect();
      try {
        await c.query('begin');
        const r: any = await c.query(readFileSync(MIG(arq), 'utf8'));
        await c.query('commit');
        return r;
      } catch (e) {
        await c.query('rollback').catch(() => {});
        throw e;
      } finally {
        c.release();
      }
    });

  beforeAll(async () => {
    delete process.env.EDGE_MODE; // como NUVEM
    process.env.PUBLIC_API_BASE = PUB;
    await repetirNaCorridaDeCatalogo(() => admin.query(readFileSync(MIG('215_whatsapp_mensagem.sql'), 'utf8')));
    for (const m of ['342_robo_pausa_e_config.sql', '347_aviso_de_atraso.sql', '352_conferir_entrega.sql']) await aplicar(m);
    const r = await aplicar('365_pedir_avaliacao.sql');
    const conf = (Array.isArray(r) ? r[r.length - 1] : r).rows as { objeto: string; ok: boolean }[];
    if (conf.length !== 6 || conf.some((l) => !l.ok)) throw new Error(`conferência da 365: ${JSON.stringify(conf)}`);
    await admin.query(`create schema ${SCHEMA}`);
    await admin.query(`
      create table ${SCHEMA}.marketing_optout (
        id uuid primary key default gen_random_uuid(), tenant_id uuid not null, telefone text not null,
        cliente_id uuid, motivo text, criado_em timestamptz not null default now());
      create unique index on ${SCHEMA}.marketing_optout (tenant_id, telefone);`);
  });
  beforeEach(() => {
    enviados.length = 0;
    auditados.length = 0;
    falhar = false;
  });
  afterAll(async () => {
    if (pubAntes === undefined) delete process.env.PUBLIC_API_BASE;
    else process.env.PUBLIC_API_BASE = pubAntes;
    await pool.end();
    if (empresas.length) {
      for (const t of ['avaliacao_pedida', 'pedido_aviso_atraso', 'pedido_envio', 'atendimento_chamado', 'robo_pausa', 'robo_config', 'whatsapp_mensagem', 'pedido_externo', 'cliente', 'cardapio_config'])
        await admin.query(`delete from ${t} where tenant_id = any($1::uuid[])`, [empresas]).catch(() => {});
      await admin.query('delete from empresa where id = any($1::uuid[])', [empresas]).catch(() => {});
    }
    await admin.query(`drop schema if exists ${SCHEMA} cascade`).catch(() => {});
    await admin.end();
  });

  type Loja = { provedor?: string; ativa?: boolean; link?: string | null; soSemProblema?: boolean; aPartirDo?: number; deNovoDias?: number };
  /** A loja: API oficial (ou não), com o pedido de avaliação ligado e o link (ou não). Tempo de entrega 40 min, tolerância 10. */
  async function loja(o: Loja = {}) {
    const t = (await q(`insert into empresa (nome) values ('teste pedir avaliação') returning id`))[0].id as string;
    empresas.push(t);
    const provedor = o.provedor ?? 'cloud';
    await q(
      `insert into cardapio_config (tenant_id, token, ativo, robo_ativo, provedor, wa_cloud_phone_id, tempo_entrega_min) values ($1,$2,true,true,$3,$4,40)`,
      [t, `tk-${randomUUID()}`, provedor, provedor === 'cloud' ? `pn-${randomUUID().slice(0, 8)}` : null],
    );
    await q(
      `insert into robo_config (tenant_id, aviso_atraso_tolerancia_min, avaliacao_ativa, avaliacao_link, avaliacao_so_sem_problema,
                                avaliacao_a_partir_do, avaliacao_de_novo_dias)
       values ($1, 10, $2, $3, $4, $5, $6)`,
      [t, o.ativa ?? true, o.link === undefined ? LINK : o.link, o.soSemProblema ?? true, o.aPartirDo ?? 2, o.deNovoDias ?? 60],
    );
    return t;
  }
  /** O cadastro do cliente com N pedidos (o `total_pedidos` que a entrada de pedidos mantém). */
  async function cliente(t: string, o: { telefone?: string; pedidos?: number; saiu?: boolean } = {}) {
    return (
      await q(`insert into cliente (tenant_id, nome, telefone, total_pedidos, opt_out_marketing) values ($1,'Renata Lima',$2,$3,$4) returning id`, [
        t,
        o.telefone ?? NO_PEDIDO,
        o.pedidos ?? 3,
        o.saiu ?? false,
      ])
    )[0].id as string;
  }
  type Pedido = { min?: number; duracao?: number; canal?: string; tipo?: string; status?: string; telefone?: string; clienteId?: string | null; agendado?: boolean };
  /** O pedido concluído há `min` minutos (padrão 60), que levou `duracao` minutos da entrada à entrega (padrão 30: no prazo). */
  async function pedido(t: string, o: Pedido = {}) {
    const min = o.min ?? 60;
    const duracao = o.duracao ?? 30;
    return (
      await q(
        `insert into pedido_externo (tenant_id, canal, external_id, numero, tipo, status, cliente_nome, cliente_telefone, cliente_id, total,
                                     criado_em, concluido_em, agendamento)
         values ($1,$2,$3,(floor(random()*90000)+10000)::int,$4,$5,'Renata Lima',$6,$7,50,
                 now() - make_interval(mins => $8::int + $9::int), now() - make_interval(mins => $8::int), $10)
         returning id`,
        [
          t,
          o.canal ?? 'cardapio',
          `e2e-${randomUUID()}`,
          o.tipo ?? 'entrega',
          o.status ?? 'concluido',
          o.telefone ?? NO_PEDIDO,
          o.clienteId ?? null,
          min,
          duracao,
          o.agendado ? new Date(Date.now() - (min + duracao) * 60_000) : null,
        ],
      )
    )[0].id as string;
  }
  /** O cliente escreveu à loja há `horas` horas (a janela da Meta), pelo número `tel` (como a Meta manda). */
  const escreveu = (t: string, tel = NA_CONVERSA, horas = 1) =>
    q(`insert into whatsapp_mensagem (tenant_id, telefone, direcao, tipo, texto, criado_em) values ($1,$2,'entrada','text','oi', now() - make_interval(hours => $3))`, [
      t,
      tel,
      horas,
    ]);
  /** Loja + cliente recorrente + pedido entregue no prazo + conversa aberta. */
  async function cenario(l: Loja = {}, p: Pedido = {}, c: { pedidos?: number; saiu?: boolean } = {}) {
    const t = await loja(l);
    const clienteId = await cliente(t, c);
    const id = await pedido(t, { clienteId, ...p });
    await escreveu(t);
    return { t, id, clienteId };
  }
  const decisao = async (pedidoId: string) =>
    (await q(`select id, resultado, motivo, link, chave_telefone, to_char(dia, 'YYYY-MM-DD') as dia, tocou_em from avaliacao_pedida where pedido_id = $1`, [pedidoId]))[0] ?? null;
  const meus = (t: string) => enviados.filter((e) => e.t === t);
  /** Um pedido de avaliação antigo deste cliente (outro pedido), para a memória da regra. */
  const historico = (t: string, o: { resultado?: string; dias?: number; tocou?: boolean; chave?: string }) =>
    q(
      `insert into avaliacao_pedida (tenant_id, pedido_id, chave_telefone, resultado, link, dia, criado_em, tocou_em)
       values ($1, $2, $3, $4, $5, (now() - make_interval(days => $6))::date, now() - make_interval(days => $6), $7)`,
      [t, randomUUID(), o.chave ?? CHAVE, o.resultado ?? 'enviado', LINK, o.dias ?? 10, o.tocou ? new Date() : null],
    );

  it('quem pode receber: entrega dos canais da loja, entregue há 40 min a 12 h, com a conversa ABERTA (ERR-360) — nunca iFood nem 99', async () => {
    const t = await loja();
    const clienteId = await cliente(t);
    const ok = await pedido(t, { clienteId });
    await escreveu(t);
    const ifood = await pedido(t, { canal: 'ifood' });
    const n99 = await pedido(t, { canal: '99food' });
    const retirada = await pedido(t, { tipo: 'retirada' });
    const cedo = await pedido(t, { min: 20 });
    const tarde = await pedido(t, { min: 13 * 60 });
    const aCaminho = await pedido(t, { status: 'despachado' });
    const semConversa = await pedido(t, { telefone: '21911112222' }); // o cliente nunca escreveu à loja
    const conversaVelha = await pedido(t, { telefone: '21933334444' });
    await escreveu(t, '5521933334444', 30); // escreveu há 30 h: fora da janela
    const sem9 = await pedido(t, { telefone: '21988000001' });
    await escreveu(t, '552188000001'); // a Meta manda o celular SEM o nono dígito
    const jaDecidido = await pedido(t);
    await q(`insert into avaliacao_pedida (tenant_id, pedido_id, chave_telefone, resultado, motivo, dia) values ($1,$2,$3,'nao_enviado','teve_problema',current_date)`, [
      t,
      jaDecidido,
      CHAVE,
    ]);
    const desligada = await cenario({ ativa: false });
    const semLink = await cenario({ link: null });
    const qr = await cenario({ provedor: 'evolution' });

    const lista = await rotina.candidatos();
    const ids = lista.map((c) => c.id);
    expect(ids).toContain(ok);
    expect(lista.find((c) => c.id === ok)).toMatchObject({ para: NA_CONVERSA, chave: CHAVE, pedidosDoCliente: 3, teveProblema: false });
    expect(lista.find((c) => c.id === sem9)?.para).toBe('552188000001');
    for (const fora of [ifood, n99, retirada, cedo, tarde, aCaminho, semConversa, conversaVelha, jaDecidido, desligada.id, semLink.id, qr.id])
      expect(ids).not.toContain(fora);
  });

  it('manda UMA vez, pelo número da conversa, com o link do Regem; o toque anota uma vez e leva ao link da loja', async () => {
    const { t, id: p } = await cenario();
    expect(await rotina.pedir()).toBeGreaterThanOrEqual(1);
    const d = await decisao(p);
    expect(d).toMatchObject({ resultado: 'enviado', motivo: null, link: LINK, chave_telefone: CHAVE, dia: hojeISO(), tocou_em: null });
    expect(meus(t)).toEqual([{ t, para: NA_CONVERSA, texto: textoDaAvaliacao(TEXTO_PADRAO, 'Renata Lima', `${PUB}/publico/avaliacao/${d.id}`) }]);
    expect(meus(t)[0].texto).toContain('Obrigado pelo pedido, Renata!');
    await rotina.pedir();
    expect(meus(t)).toHaveLength(1); // a volta seguinte não repete

    expect(await rotina.destinoDoToque(d.id)).toBe(LINK);
    const primeiro = (await decisao(p)).tocou_em;
    expect(primeiro).not.toBeNull();
    expect(await rotina.destinoDoToque(d.id)).toBe(LINK);
    expect((await decisao(p)).tocou_em).toEqual(primeiro); // o segundo toque não regrava
    // a loja trocou o link: vai o de agora; a loja tirou o link: vai o que foi na mensagem
    await q(`update robo_config set avaliacao_link = $2 where tenant_id = $1`, [t, OUTRO_LINK]);
    expect(await rotina.destinoDoToque(d.id)).toBe(OUTRO_LINK);
    await q(`update robo_config set avaliacao_link = null where tenant_id = $1`, [t]);
    expect(await rotina.destinoDoToque(d.id)).toBe(LINK);
    // id que não vale
    expect(await rotina.destinoDoToque('nao-e-um-id')).toBeNull();
    expect(await rotina.destinoDoToque(randomUUID())).toBeNull();
  });

  it('"só pedidos sem problema": atrasou, aviso de atraso, caso de problema ou cancelamento, "Tive um problema"/"Não chegou" → não manda', async () => {
    const atrasou = await cenario({}, { duracao: 60 }); // 60 min > 40 prometidos + 10 de tolerância
    const avisou = await cenario();
    await q(`insert into pedido_aviso_atraso (pedido_id, tenant_id) values ($1,$2)`, [avisou.id, avisou.t]);
    const erro = await cenario();
    await q(`insert into atendimento_chamado (tenant_id, tipo, telefone, status, pedido_id) values ($1,'erro',$2,'resolvido',$3)`, [erro.t, NA_CONVERSA, erro.id]);
    const cancelou = await cenario();
    await q(`insert into atendimento_chamado (tenant_id, tipo, telefone, status, pedido_id) values ($1,'cancelamento',$2,'resolvido',$3)`, [
      cancelou.t,
      NA_CONVERSA,
      cancelou.id,
    ]);
    const reclamou = await cenario();
    const naoChegou = await cenario();
    for (const [c, motivo] of [
      [reclamou, 'problema'],
      [naoChegou, 'nao_chegou'],
    ] as const)
      await q(
        `insert into pedido_envio (tenant_id, pedido_id, destino, acao, resultado, motivo, servidor) values ($1,$2,'cliente_whatsapp','conferir_entrega_resposta','enviado',$3,'nuvem')`,
        [c.t, c.id, motivo],
      );
    const outroCaso = await cenario(); // caso "humano" resolvido, sem ser de problema: não conta
    await q(`insert into atendimento_chamado (tenant_id, tipo, telefone, status, pedido_id, resolvido_em) values ($1,'humano',$2,'resolvido',$3, now() - interval '3 hours')`, [
      outroCaso.t,
      NA_CONVERSA,
      outroCaso.id,
    ]);
    const agendado = await cenario({}, { duracao: 300, agendado: true }); // pedido agendado não "atrasa"
    const todos = await cenario({ soSemProblema: false }, { duracao: 60 }); // "todos os pedidos": manda mesmo atrasado

    await rotina.pedir();
    for (const c of [atrasou, avisou, erro, cancelou, reclamou, naoChegou]) {
      expect(await decisao(c.id)).toMatchObject({ resultado: 'nao_enviado', motivo: 'teve_problema' });
      expect(meus(c.t)).toEqual([]);
    }
    for (const c of [outroCaso, agendado, todos]) {
      expect(await decisao(c.id)).toMatchObject({ resultado: 'enviado' });
      expect(meus(c.t)).toHaveLength(1);
    }
  });

  it('a partir do Nº pedido do cliente (o cadastro): antes dele não manda; "1º pedido" = todos', async () => {
    const primeiro = await cenario({}, {}, { pedidos: 1 });
    const segundo = await cenario({}, {}, { pedidos: 2 });
    const semCadastro = await loja();
    const p = await pedido(semCadastro, { clienteId: null });
    await escreveu(semCadastro);
    const todos = await loja({ aPartirDo: 1 });
    const pTodos = await pedido(todos, { clienteId: null });
    await escreveu(todos);

    await rotina.pedir();
    expect(await decisao(primeiro.id)).toMatchObject({ resultado: 'nao_enviado', motivo: 'antes_do_pedido_minimo' });
    expect(await decisao(p)).toMatchObject({ resultado: 'nao_enviado', motivo: 'antes_do_pedido_minimo' });
    expect(await decisao(segundo.id)).toMatchObject({ resultado: 'enviado' });
    expect(await decisao(pTodos)).toMatchObject({ resultado: 'enviado' });
  });

  it('a memória do cliente: quem tocou nunca mais recebe; quem recebeu há menos de N dias espera; depois, recebe de novo', async () => {
    const tocou = await cenario();
    await historico(tocou.t, { dias: 300, tocou: true });
    const recente = await cenario();
    await historico(recente.t, { dias: 10 });
    const antigo = await cenario();
    await historico(antigo.t, { dias: 61 });
    const naoEnviado = await cenario(); // "não mandei" há 10 dias não conta como recebido
    await historico(naoEnviado.t, { dias: 10, resultado: 'nao_enviado' });
    const deNovo180 = await cenario({ deNovoDias: 180 });
    await historico(deNovo180.t, { dias: 100 });
    const outraLoja = await cenario(); // o histórico de OUTRA empresa com o mesmo número não conta
    await historico(tocou.t, { dias: 5, chave: CHAVE }); // (na empresa do "tocou", não na outra)

    await rotina.pedir();
    expect(await decisao(tocou.id)).toMatchObject({ resultado: 'nao_enviado', motivo: 'ja_tocou_no_link' });
    expect(await decisao(recente.id)).toMatchObject({ resultado: 'nao_enviado', motivo: 'pedido_recente' });
    expect(await decisao(deNovo180.id)).toMatchObject({ resultado: 'nao_enviado', motivo: 'pedido_recente' });
    expect(await decisao(antigo.id)).toMatchObject({ resultado: 'enviado' });
    expect(await decisao(naoEnviado.id)).toMatchObject({ resultado: 'enviado' });
    expect(await decisao(outraLoja.id)).toMatchObject({ resultado: 'enviado' });
  });

  it('dois pedidos do mesmo cliente na mesma volta: UM pedido de avaliação (o outro fica "pedido_recente")', async () => {
    const { t, id: p1, clienteId } = await cenario({}, { min: 90 });
    const p2 = await pedido(t, { clienteId, min: 60 });
    await rotina.pedir();
    expect(meus(t)).toHaveLength(1);
    expect(await decisao(p1)).toMatchObject({ resultado: 'enviado' });
    expect(await decisao(p2)).toMatchObject({ resultado: 'nao_enviado', motivo: 'pedido_recente' });
  });

  it('duas réplicas: com a mesma lista, UMA mensagem; cada uma com um pedido do mesmo cliente, também UMA (índice do dia)', async () => {
    const a = await cenario();
    const lista = (await rotina.candidatos()).filter((c) => c.tenantId === a.t);
    const r1 = new PedirAvaliacaoProcessor(db, cloud);
    const r2 = new PedirAvaliacaoProcessor(db, cloud);
    (r1 as any).candidatos = async () => lista;
    (r2 as any).candidatos = async () => lista;
    await Promise.all([r1.pedir(), r2.pedir()]);
    expect(meus(a.t)).toHaveLength(1);

    const b = await cenario({}, { min: 90 });
    const p2 = await pedido(b.t, { clienteId: b.clienteId, min: 60 });
    const dois = (await rotina.candidatos()).filter((c) => c.tenantId === b.t);
    expect(dois.map((c) => c.id).sort()).toEqual([b.id, p2].sort());
    (r1 as any).candidatos = async () => [dois[0]];
    (r2 as any).candidatos = async () => [dois[1]];
    await Promise.all([r1.pedir(), r2.pedir()]);
    expect(meus(b.t)).toHaveLength(1);
    const ds = [await decisao(b.id), await decisao(p2)];
    expect(ds.map((d) => d.resultado).sort()).toEqual(['enviado', 'nao_enviado']);
    expect(ds.find((d) => d.resultado === 'nao_enviado').motivo).toBe('pedido_recente');
  });

  it('quem pediu para não receber mensagens (SAIR ou a marca do cadastro): não manda', async () => {
    const sair = await cenario();
    await q(`insert into marketing_optout (tenant_id, telefone, motivo) values ($1, '552187654321', 'palavra_chave')`, [sair.t]); // sem o 9
    const marca = await cenario({}, {}, { saiu: true });
    await rotina.pedir();
    expect(await decisao(sair.id)).toMatchObject({ resultado: 'nao_enviado', motivo: 'saiu_das_mensagens' });
    expect(await decisao(marca.id)).toMatchObject({ resultado: 'nao_enviado', motivo: 'saiu_das_mensagens' });
    expect([...meus(sair.t), ...meus(marca.t)]).toEqual([]);
  });

  it('com alguém da equipe na conversa (caso aberto): não manda e não decide — tenta na volta seguinte', async () => {
    const { t, id } = await cenario();
    await q(`insert into atendimento_chamado (tenant_id, tipo, telefone, status) values ($1,'humano',$2,'aberto')`, [t, NA_CONVERSA]);
    await rotina.pedir();
    expect(meus(t)).toEqual([]);
    expect(await decisao(id)).toBeNull();
  });

  it('a Meta recusou: fica "falhou", não manda de novo — e não segura o próximo pedido do cliente no mesmo dia', async () => {
    const { t, id, clienteId } = await cenario({}, { min: 90 });
    falhar = true;
    await rotina.pedir();
    expect(await decisao(id)).toMatchObject({ resultado: 'falhou', motivo: 'a Meta recusou' });
    falhar = false;
    await rotina.pedir();
    expect(meus(t)).toEqual([]);
    const p2 = await pedido(t, { clienteId, min: 60 });
    await rotina.pedir();
    expect(await decisao(p2)).toMatchObject({ resultado: 'enviado' });
    expect(meus(t)).toHaveLength(1);
  });

  it('ERR-360: 210 pedidos de quem não escreveu à loja não tomam a vez — o pedido mais novo, com a conversa aberta, sai', async () => {
    const t = await loja({ aPartirDo: 1 });
    await q(
      `insert into pedido_externo (tenant_id, canal, external_id, numero, tipo, status, cliente_nome, cliente_telefone, total, criado_em, concluido_em)
       select $1, 'cardapio', 'e2e-' || gen_random_uuid(), 100000 + g, 'entrega', 'concluido', 'Sem Conversa', '2197' || lpad(g::text, 7, '0'), 50,
              now() - interval '5 hours', now() - interval '4 hours' - make_interval(secs => g)
         from generate_series(1, 210) g`,
      [t],
    );
    const novo = await pedido(t, { min: 60 });
    await escreveu(t);
    expect((await rotina.candidatos()).map((c) => c.id)).toContain(novo);
    await rotina.pedir();
    expect(await decisao(novo)).toMatchObject({ resultado: 'enviado' });
    expect(meus(t)).toHaveLength(1);
  });

  it('o plano: a conversa (cada forma do número na condição do índice), a memória do cliente e os casos do pedido pelo ÍNDICE (LIC-113)', async () => {
    await admin.query('analyze whatsapp_mensagem, avaliacao_pedida, atendimento_chamado');
    const explicar = async (consulta: any) => {
      const c = await pool.connect();
      try {
        await c.query('begin');
        // Sem varredura sequencial: se a tabela ainda aparece nela, é porque NÃO há caminho pelo índice.
        await c.query('set local enable_seqscan = off');
        const r: any = await drizzle(c).execute(sql`explain ${consulta}`);
        return (r.rows ?? r).map((l: any) => l['QUERY PLAN']).join('\n') as string;
      } finally {
        await c.query('rollback').catch(() => {});
        c.release();
      }
    };
    // A consulta inteira: a conversa de cada pedido pelo índice das mensagens, com as FORMAS do número na condição dele
    // (não "a empresa inteira e filtra depois").
    expect(await explicar(PedirAvaliacaoProcessor.consulta())).toMatch(/Index Scan using whatsapp_mensagem_tenant_tel_idx[^\n]*\n[^\n]*Index Cond: .*telefone = ANY/);
    // As buscas de cada pedido. Com a tabela pequena (como aqui), o Postgres prefere ler a tabela uma vez e guardar num
    // hash; com ela grande, usa o índice. Aqui se prova que o caminho pelo índice EXISTE para cada uma.
    const t = randomUUID();
    for (const busca of [
      sql`select 1 from atendimento_chamado c where c.pedido_id = ${randomUUID()}::uuid and c.tenant_id = ${t}::uuid and c.tipo in ('erro', 'cancelamento')`,
      sql`select 1 from avaliacao_pedida a where a.tenant_id = ${t}::uuid and a.chave_telefone = ${CHAVE} and a.tocou_em is not null`,
      sql`select max(a.criado_em) from avaliacao_pedida a where a.tenant_id = ${t}::uuid and a.chave_telefone = ${CHAVE} and a.resultado = 'enviado'`,
      sql`select 1 from avaliacao_pedida a where a.pedido_id = ${randomUUID()}::uuid`,
    ])
      expect(await explicar(busca)).not.toMatch(/Seq Scan/);
  });

  it('o ajuste: nasce desligado; ligar exige o link; grava SÓ o que a tela mandou (V16); vai à auditoria; o mês conta', async () => {
    const t = (await q(`insert into empresa (nome) values ('teste ajuste avaliação') returning id`))[0].id as string;
    empresas.push(t);
    const ator: any = { tenantId: t, colaboradorId: null, categoria: 'gerente' };
    expect((await ajustes.roboConfig(t)).avaliacao).toMatchObject({
      ativa: false,
      link: null,
      texto: TEXTO_PADRAO,
      depoisMin: 40,
      soSemProblema: true,
      aPartirDo: 2,
      deNovoDias: 60,
      doMes: { enviados: 0, tocaram: 0 },
      opcoes: { depoisMin: [20, 40, 60, 120], aPartirDo: [1, 2, 3, 4, 5], deNovoDias: [30, 60, 90, 180] },
      textoPadrao: TEXTO_PADRAO,
    });
    await expect(ajustes.salvarAvaliacao(ator, { ativa: true })).rejects.toThrow(/Cole o link/);
    const r = await ajustes.salvarAvaliacao(ator, { ativa: true, link: LINK });
    expect(r.avaliacao).toMatchObject({ ativa: true, link: LINK });
    expect(auditados.map((a) => a.acao)).toEqual(['pedir_avaliacao_ligado']);
    expect(auditados[0].detalhe).toEqual({ ativa: { de: false, para: true }, link: { de: null, para: LINK } });
    await ajustes.salvarAvaliacao(ator, { depoisMin: 60 });
    expect(auditados.map((a) => a.acao)).toEqual(['pedir_avaliacao_ligado', 'pedir_avaliacao_alterado']);
    expect((await ajustes.roboConfig(t)).avaliacao).toMatchObject({ ativa: true, link: LINK, depoisMin: 60 });

    // Outra tela grava o link ENQUANTO esta salva os dias: os dias não desfazem o link (só a coluna mandada é gravada).
    const comCorrida = new Proxy(db, {
      get(alvo, nome) {
        if (nome !== 'execute') return Reflect.get(alvo, nome);
        return async (consulta: any) => {
          const texto = alvo.dialect.sqlToQuery(consulta).sql as string;
          if (texto.includes('insert into robo_config (tenant_id, avaliacao_ativa'))
            await pool.query(`update robo_config set avaliacao_link = $2 where tenant_id = $1`, [t, OUTRO_LINK]);
          return alvo.execute(consulta);
        };
      },
    });
    const ajustesComCorrida = new WhatsappProvedorService(comCorrida, auditoria, {} as any, {} as any);
    await ajustesComCorrida.salvarAvaliacao(ator, { deNovoDias: 90 });
    expect((await lerAvaliacao(db, t)).link).toBe(OUTRO_LINK);
    expect((await lerAvaliacao(db, t)).deNovoDias).toBe(90);
    // o texto igual ao padrão é guardado vazio (o padrão pode mudar depois)
    await ajustes.salvarAvaliacao(ator, { texto: 'Avalie a gente: {link}' });
    await ajustes.salvarAvaliacao(ator, { texto: TEXTO_PADRAO });
    expect((await q(`select avaliacao_texto from robo_config where tenant_id = $1`, [t]))[0].avaliacao_texto).toBeNull();

    // o mês: enviados deste mês e toques deste mês (mesmo de mensagem do mês passado)
    for (const [resultado, dias, tocou] of [
      ['enviado', 0, false],
      ['enviado', 0, true],
      ['enviado', 40, true],
      ['enviado', 40, false],
      ['nao_enviado', 0, false],
    ] as [string, number, boolean][])
      await q(
        `insert into avaliacao_pedida (tenant_id, pedido_id, chave_telefone, resultado, dia, criado_em, tocou_em)
         values ($1, $2, $3, $4, (now() - make_interval(days => $5))::date, now() - make_interval(days => $5), $6)`,
        [t, randomUUID(), `219${String(Math.random()).slice(2, 10)}`, resultado, dias, tocou ? new Date() : null],
      );
    expect((await lerAvaliacao(db, t)).doMes).toEqual({ enviados: 2, tocaram: 2 });
  });
});
