import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../../db/schema';
import { comTravaDaEmpresa, repetirNaCorridaDeCatalogo } from '../../common/corrida-de-catalogo';
import { FUSO_OPERACAO } from '../../common/data';
import { EquipamentoService } from './equipamento.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

// A PONTE DO CHAT EM EQUIPAMENTOS (peça 6 do protótipo de conexão), contra o Postgres real: a lista de equipamentos da
// nuvem leva, em cada aparelho `ponte_chat` ativo, o PC onde ela roda (o nome do Windows que ela manda no sinal), o sinal,
// os logins, o papel escolhido e o papel de AGORA por canal conectado — a MESMA regra da faixa do Atendimento e da fila de
// saída (`quemResponde`, entre as pontes da mesma loja) — e o movimento de HOJE (o dia da operação, não o da sessão). No
// servidor da loja a linha vem sem `ponte` (as tabelas são da nuvem). As tabelas da ponte são só da nuvem: o teste aplica as
// migrations, com a trava da empresa na frente (ERR-377).
const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('ponte-nos-pcs-pg.spec: sem TEST_PG_URL — PULADO');
jest.setTimeout(120_000);

const MIG = (arq: string) => join(__dirname, '../../../../database/migrations', arq);

descrever('Equipamentos: a ponte do chat no PC certo, com o papel de agora (Postgres)', () => {
  const pool = new Pool({ connectionString: URL_PG });
  const db = drizzle(pool, { schema }) as any;
  const q = async (s: string, p: any[] = []) => (await pool.query(s, p)).rows;
  const svc = new EquipamentoService(db, { registrar: async () => undefined } as any);
  const T = randomUUID();
  const L1 = randomUUID();
  const L2 = randomUUID();
  const modoAntes = process.env.EDGE_MODE;
  const ids: Record<string, string> = {};

  const aplicar = (arq: string) =>
    repetirNaCorridaDeCatalogo(async () => {
      const c = await pool.connect();
      try {
        await c.query('begin');
        await c.query(comTravaDaEmpresa(readFileSync(MIG(arq), 'utf8')));
        await c.query('commit');
      } catch (e) {
        await c.query('rollback').catch(() => {});
        throw e;
      } finally {
        c.release();
      }
    });
  /** Um aparelho ponte_chat pareado (com segredo) e, se `sinal`, o último sinal de vida dele (`chat_ponte`). */
  async function ponte(
    nome: string,
    o: { unidade?: string | null; ativo?: boolean; criadaMinAtras: number; sinal?: { papel?: string; maquina: string; minAtras: number; ifood?: boolean; n99?: boolean } },
  ) {
    const id = randomUUID();
    await q(
      `insert into equipamento (id, tenant_id, unidade_id, tipo, nome, token, segredo_hash, ativo, created_at)
       values ($1, $2, $3, 'ponte_chat', $4, $5, 'hash-de-teste', $6, now() - make_interval(mins => $7))`,
      [id, T, o.unidade === undefined ? L1 : o.unidade, nome, `tok-${id}`, o.ativo ?? true, o.criadaMinAtras],
    );
    if (o.sinal)
      await q(
        `insert into chat_ponte (equipamento_id, tenant_id, unidade_id, plataformas, papel, versao, maquina, visto_em)
         values ($1, $2, $3, $4::jsonb, $5, '0.4.0', $6, now() - make_interval(mins => $7))`,
        [
          id,
          T,
          o.unidade === undefined ? L1 : o.unidade,
          JSON.stringify({ ifood: { logado: o.sinal.ifood ?? false }, '99food': { logado: o.sinal.n99 ?? false } }),
          o.sinal.papel ?? 'auto',
          o.sinal.maquina,
          o.sinal.minAtras,
        ],
      );
    ids[nome] = id;
    return id;
  }
  const msg = (ponteId: string, direcao: string, estado: string, quando: string) =>
    q(
      `insert into chat_plataforma_msg (tenant_id, unidade_id, canal, pedido_externo, direcao, autor, texto, estado, ponte_id, criado_em)
       values ($1, $2, 'ifood', 'pedido-x', $3, $4, 'Oi', $5, $6, ${quando})`,
      [T, L1, direcao, direcao === 'entrada' ? 'cliente' : 'robo', estado, ponteId],
    );
  const lista = async () => {
    const r = (await svc.listar(T)) as any[];
    return Object.fromEntries(r.filter((e) => e.tipo === 'ponte_chat').map((e) => [e.nome, e]));
  };

  beforeAll(async () => {
    delete process.env.EDGE_MODE; // como NUVEM
    for (const m of ['342_robo_pausa_e_config.sql', '366_ponte_do_chat.sql', '367_chat_ordem_e_indices.sql', '368_ponte_pausada.sql']) await aplicar(m);
    await q(`insert into empresa (id, nome) values ($1, 'teste ponte nos pcs')`, [T]);
    await q(`insert into unidade (id, tenant_id, nome) values ($1, $3, 'Loja 1'), ($2, $3, 'Loja 2')`, [L1, L2, T]);
    await q(`insert into robo_config (tenant_id, chat_ponte_ligada) values ($1, true)`, [T]);
    await q(`insert into integracao (tenant_id, canal, ativo, config) values ($1, 'ifood', true, '{}'::jsonb)`, [T]);
    const d = await ponte('Ponte do delivery', { criadaMinAtras: 30, sinal: { papel: 'principal', maquina: 'CX-DELIVERY', minAtras: 0, ifood: true } });
    const s = await ponte('Ponte do servidor', { criadaMinAtras: 60, sinal: { maquina: 'SERVIDOR-MB', minAtras: 1, ifood: true } });
    await ponte('Ponte do caixa', { criadaMinAtras: 20 }); // pareada e sem sinal ainda
    await ponte('Ponte revogada', { ativo: false, criadaMinAtras: 90, sinal: { maquina: 'VELHO', minAtras: 0, ifood: true } });
    await ponte('Ponte da loja 2', { unidade: L2, criadaMinAtras: 10, sinal: { maquina: 'CAIXA-2', minAtras: 0, ifood: true } });
    await ponte('Ponte sem loja', { unidade: null, criadaMinAtras: 5, sinal: { papel: 'reserva', maquina: 'NOTEBOOK', minAtras: 0, ifood: true } });
    // O movimento: hoje (o dia da OPERAÇÃO) e a de ontem às 23:30 no relógio da loja, que não conta.
    const inicioDeHoje = `(date_trunc('day', now() at time zone '${FUSO_OPERACAO}') at time zone '${FUSO_OPERACAO}')`;
    await msg(d, 'entrada', 'recebida', `greatest(${inicioDeHoje} + interval '1 minute', now() - interval '2 minutes')`);
    await msg(d, 'entrada', 'recebida', `greatest(${inicioDeHoje} + interval '2 minutes', now() - interval '1 minute')`);
    await msg(d, 'saida', 'enviada', 'now()');
    await msg(d, 'saida', 'falhou', 'now()'); // não saiu: não conta como enviada
    await msg(d, 'entrada', 'recebida', `${inicioDeHoje} - interval '30 minutes'`);
    await msg(s, 'entrada', 'recebida', 'now()');
  });
  afterAll(async () => {
    if (modoAntes === undefined) delete process.env.EDGE_MODE;
    else process.env.EDGE_MODE = modoAntes;
    for (const tab of ['chat_plataforma_msg', 'chat_ponte', 'robo_config', 'integracao', 'equipamento', 'unidade'])
      await q(`delete from ${tab} where tenant_id = $1`, [T]).catch(() => {});
    await q(`delete from empresa where id = $1`, [T]).catch(() => {});
    await pool.end();
  });
  beforeEach(() => {
    delete process.env.EDGE_MODE;
  });

  it('cada ponte com o PC, o sinal, os logins e o papel de agora: a principal responde, a outra viva fica de reserva, a sem sinal fica fora', async () => {
    const p = await lista();
    expect(p['Ponte do delivery'].ponte).toMatchObject({
      maquina: 'CX-DELIVERY',
      versao: '0.4.0',
      viva: true,
      logado: { ifood: true, '99food': false },
      papel: 'principal',
      ligada: true,
      canais: { ifood: 'responde' },
      hoje: { recebidas: 2, enviadas: 1 },
    });
    expect(p['Ponte do delivery'].ponte.canais).not.toHaveProperty('99food'); // a 99 não está conectada
    expect(p['Ponte do delivery'].ponte.hoje.ultimaEm).not.toBeNull();
    expect(p['Ponte do servidor'].ponte).toMatchObject({ maquina: 'SERVIDOR-MB', viva: true, canais: { ifood: 'reserva' }, hoje: { recebidas: 1, enviadas: 0 } });
    expect(p['Ponte do caixa'].ponte).toMatchObject({ maquina: null, vistoEm: null, viva: false, canais: { ifood: 'fora' }, hoje: { recebidas: 0, enviadas: 0, ultimaEm: null } });
    expect(p['Ponte revogada'].ponte).toBeUndefined(); // revogada: fora da conta (e da lista da ponte)
    // por loja: a da loja 2 responde lá, sem disputar com a principal da loja 1; a sem loja disputa com todas (a principal vence)
    expect(p['Ponte da loja 2'].ponte.canais).toEqual({ ifood: 'responde' });
    expect(p['Ponte sem loja'].ponte.canais).toEqual({ ifood: 'reserva' });
  });

  it('a principal parou de dar sinal: a reserva viva passa a responder e a principal fica fora (a mesma regra da fila de saída)', async () => {
    await q(`update chat_ponte set visto_em = now() - interval '5 minutes' where equipamento_id = $1`, [ids['Ponte do delivery']]);
    try {
      const p = await lista();
      expect(p['Ponte do delivery'].ponte).toMatchObject({ viva: false, canais: { ifood: 'fora' } });
      // na loja 1 sobram a do servidor (auto) e a sem loja (reserva): a automática vem antes da reserva
      expect(p['Ponte do servidor'].ponte.canais).toEqual({ ifood: 'responde' });
      expect(p['Ponte sem loja'].ponte.canais).toEqual({ ifood: 'reserva' });
    } finally {
      await q(`update chat_ponte set visto_em = now() where equipamento_id = $1`, [ids['Ponte do delivery']]);
    }
  });

  it('pausada no PC (mig 368): vem com a hora, não responde nem é reserva; a seguinte responde', async () => {
    const pausada = await q(`update chat_ponte set pausada_em = now() - interval '3 minutes' where equipamento_id = $1 returning pausada_em`, [ids['Ponte do delivery']]);
    try {
      const p = await lista();
      expect(p['Ponte do delivery'].ponte).toMatchObject({ viva: true, logado: { ifood: true }, canais: { ifood: 'fora' } });
      expect(p['Ponte do delivery'].ponte.pausadaEm).toBe(new Date(pausada[0].pausada_em).toISOString());
      expect(p['Ponte do servidor'].ponte).toMatchObject({ pausadaEm: null, canais: { ifood: 'responde' } });
      expect(p['Ponte sem loja'].ponte.canais).toEqual({ ifood: 'reserva' });
      // a reserva pausada também sai da conta: a sem loja (reserva) pausada vira "fora"
      await q(`update chat_ponte set pausada_em = now() where equipamento_id = $1`, [ids['Ponte sem loja']]);
      expect((await lista())['Ponte sem loja'].ponte.canais).toEqual({ ifood: 'fora' });
    } finally {
      await q(`update chat_ponte set pausada_em = null where equipamento_id = any($1::uuid[])`, [[ids['Ponte do delivery'], ids['Ponte sem loja']]]);
    }
  });

  it('a 99 conectada entra na conta (ninguém logado nela: todas fora); a ponte desligada nos ajustes vem marcada', async () => {
    await q(`insert into integracao (tenant_id, canal, ativo, config) values ($1, '99food', true, '{}'::jsonb)`, [T]);
    await q(`update robo_config set chat_ponte_ligada = false where tenant_id = $1`, [T]);
    try {
      const p = await lista();
      expect(p['Ponte do delivery'].ponte.canais).toEqual({ ifood: 'responde', '99food': 'fora' });
      expect(p['Ponte do servidor'].ponte.canais).toEqual({ ifood: 'reserva', '99food': 'fora' });
      expect(p['Ponte do delivery'].ponte.ligada).toBe(false);
      // a 99 "só lendo" (4a): lê o chat da 99, mas não envia — papel "lendo" (nem responde nem é reserva); sem sinal, fora
      await q(`update chat_ponte set plataformas = jsonb_set(plataformas, '{99food}', '{"logado": false, "lendo": true}') where tenant_id = $1`, [T]);
      const l = await lista();
      expect(l['Ponte do delivery'].ponte.canais).toEqual({ ifood: 'responde', '99food': 'lendo' });
      expect(l['Ponte do servidor'].ponte.canais).toEqual({ ifood: 'reserva', '99food': 'lendo' });
      expect(l['Ponte do caixa'].ponte.canais['99food']).toBe('fora'); // nunca deu sinal
    } finally {
      await q(`update chat_ponte set plataformas = jsonb_set(plataformas, '{99food}', '{"logado": false}') where tenant_id = $1`, [T]);
      await q(`delete from integracao where tenant_id = $1 and canal = '99food'`, [T]);
      await q(`update robo_config set chat_ponte_ligada = true where tenant_id = $1`, [T]);
    }
  });

  it('no servidor da loja a lista vem sem a ponte (as tabelas dela são da nuvem)', async () => {
    process.env.EDGE_MODE = 'true';
    const p = await lista();
    expect(Object.keys(p)).toContain('Ponte do delivery');
    for (const e of Object.values(p)) expect((e as any).ponte).toBeUndefined();
  });
});
