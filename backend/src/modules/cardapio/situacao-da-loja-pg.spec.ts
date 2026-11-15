import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../../db/schema';
import { Food99Service } from '../integracoes/food99/food99.service';
import { CardapioService } from './cardapio.service';
import { RoboConsultasController } from './robo-consultas.controller';

/* eslint-disable @typescript-eslint/no-explicit-any */

// A LOJA ESTÁ ATENDENDO AGORA? — contra Postgres (TEST_PG_URL), pelos caminhos de verdade: o aviso `shopStatus` da 99
// (`Food99Service.processarWebhook`) grava a situação na integração; o `CardapioService.situacaoConferida` (o que o
// `consultar_loja` do atendente usa) lê a 99, a pausa do Regem e o servidor da loja — e só o que já está no banco.

const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('situacao-da-loja-pg.spec: sem TEST_PG_URL — PULADO');
jest.setTimeout(120_000);

const LOJA99 = `loja-${randomUUID().slice(0, 8)}`;
const SENHA = 'senha-do-robo-de-teste';
const PID = `PID-CONF-${randomUUID().slice(0, 8)}`;
const aviso = (data: Record<string, unknown>, ts: number) =>
  JSON.stringify({ app_id: 123, app_shop_id: LOJA99, type: 'shopStatus', timestamp: ts, data });

descrever('a loja está atendendo agora? (Postgres)', () => {
  const pool = new Pool({ connectionString: URL_PG });
  const db = drizzle(pool, { schema }) as any;
  const q = async (s: string, p: any[] = []) => (await pool.query(s, p)).rows;
  const T = randomUUID();
  let U: string;
  let token: string;
  let edgeTemEquipamento = false;
  const food99 = new Food99Service(db, {} as any, { emit: () => true } as any);
  const cardapio = new CardapioService(db, {} as any, {} as any, {} as any, {} as any, {} as any, { emit: () => true } as any, {} as any);
  const sign = process.env.FOOD99_REQUIRE_SIGN;
  const senhaAntes = process.env.BOT_RESOLVER_SECRET;
  const config = async () => (await q(`select config from integracao where tenant_id = $1 and canal = '99food'`, [T]))[0].config;

  beforeAll(async () => {
    process.env.FOOD99_REQUIRE_SIGN = 'false'; // o teste não assina o aviso (a assinatura tem os seus testes)
    process.env.BOT_RESOLVER_SECRET = SENHA; // a senha do robô de teste (o consultar_loja pela rota)
    delete process.env.EDGE_MODE;
    // `edge_status` é só da nuvem: o banco do CI (de loja) não tem — cria a forma mínima, como as outras specs.
    await pool
      .query(`create table if not exists edge_status (id uuid primary key default gen_random_uuid(), tenant_id uuid, unidade_id uuid, recebido_em timestamptz not null default now())`)
      .catch((e: any) => {
        if (!['23505', '42P07'].includes(e?.code)) throw e;
      });
    edgeTemEquipamento = (await q(`select 1 from information_schema.columns where table_name = 'edge_status' and column_name = 'equipamento_id'`)).length > 0;
    await q(`insert into empresa (id, nome) values ($1, 'teste loja conferida')`, [T]);
    [{ id: U }] = await q(`insert into unidade (tenant_id, nome) values ($1, 'Loja de teste') returning id`, [T]);
    token = `tk-${randomUUID()}`;
    await q(`insert into cardapio_config (tenant_id, unidade_id, token, ativo, modo, wa_cloud_phone_id) values ($1,$2,$3,true,'retirada',$4)`, [T, U, token, PID]);
    await q(
      `insert into integracao (tenant_id, canal, ativo, merchant_id, client_id, client_secret, config) values ($1,'99food',true,$2,'app','segredo','{"tokenExp":1}')`,
      [T, LOJA99],
    );
  });
  afterAll(async () => {
    if (sign === undefined) delete process.env.FOOD99_REQUIRE_SIGN;
    else process.env.FOOD99_REQUIRE_SIGN = sign;
    if (senhaAntes === undefined) delete process.env.BOT_RESOLVER_SECRET;
    else process.env.BOT_RESOLVER_SECRET = senhaAntes;
    for (const t of ['edge_status', 'pausa_canal', 'integracao', 'cardapio_config', 'unidade'])
      await q(`delete from ${t} where tenant_id = $1`, [T]).catch(() => {});
    await q(`delete from empresa where id = $1`, [T]).catch(() => {});
    await pool.end();
  });
  beforeEach(async () => {
    await q(`delete from pausa_canal where tenant_id = $1`, [T]);
    await q(`delete from edge_status where tenant_id = $1`, [T]);
    await q(`update integracao set config = '{"tokenExp":1}'::jsonb where tenant_id = $1`, [T]);
  });
  const batida = (minutosAtras: number) =>
    edgeTemEquipamento
      ? q(`insert into edge_status (equipamento_id, tenant_id, unidade_id, recebido_em) values (gen_random_uuid(), $1, $2, now() - ($3 || ' minutes')::interval)`, [T, U, String(minutosAtras)])
      : q(`insert into edge_status (tenant_id, unidade_id, recebido_em) values ($1, $2, now() - ($3 || ' minutes')::interval)`, [T, U, String(minutosAtras)]);

  it('o aviso shopStatus grava a situação; um aviso mais velho não desfaz o mais novo; outras chaves ficam', async () => {
    const agora = Math.floor(Date.now() / 1000);
    expect(await food99.processarWebhook(aviso({ biz_status: 2, sub_biz_status: 3 }, agora))).toEqual({ errno: 0, errmsg: 'ok' });
    let c = await config();
    expect(c.tokenExp).toBe(1); // V82: só a chave dela
    expect(c.situacaoDaLoja).toMatchObject({ estado: 'fechada', fonte: 'aviso', em: new Date(agora * 1000).toISOString() });
    await food99.processarWebhook(aviso({ biz_status: 1, sub_biz_status: 1 }, agora - 60)); // chegou atrasado
    c = await config();
    expect(c.situacaoDaLoja.estado).toBe('fechada');
    await food99.processarWebhook(aviso({ biz_status: 1, sub_biz_status: 1 }, agora + 60));
    expect((await config()).situacaoDaLoja.estado).toBe('aberta');
  });

  it('a quinta sem luz: a 99 desconectada e o servidor da loja sem sinal → fechada (com o cardápio "aberto")', async () => {
    await food99.processarWebhook(aviso({ biz_status: 1, sub_biz_status: 4 }, Math.floor(Date.now() / 1000)));
    await batida(25);
    const s = await cardapio.situacaoConferida(token, true);
    expect(s).toMatchObject({ veredito: 'fechada', servidorDaLoja: 'sem_sinal', motivo: 'um imprevisto na loja' });
  });

  it('pela rota do consultar_loja (o que o atendente lê): a 99 fechada dentro do horário → abertaAgora false', async () => {
    const rota = new RoboConsultasController(cardapio);
    const antes: any = await rota.loja(undefined, PID, undefined, SENHA);
    expect(antes.abertaAgora).toBe(true); // sem horário cadastrado o cardápio está aberto
    expect(antes.situacaoConferida).toMatchObject({ veredito: 'aberta', canais: [] });
    await food99.processarWebhook(aviso({ biz_status: 2, sub_biz_status: 3 }, Math.floor(Date.now() / 1000)));
    const depois: any = await rota.loja(undefined, PID, undefined, SENHA);
    expect(depois.abertaAgora).toBe(false);
    expect(depois.proximaAbertura).toBeNull();
    expect(depois.situacaoConferida).toMatchObject({ veredito: 'fechada', canais: [{ nome: '99', situacao: 'fechada' }] });
    expect(depois.situacaoConferida.comoResponder).toContain('Nunca diga que estamos abertos');
  });

  it('a 99 aberta: aberta; o cardápio fechado pelo horário não muda nada', async () => {
    await food99.processarWebhook(aviso({ biz_status: 1, sub_biz_status: 1 }, Math.floor(Date.now() / 1000)));
    await batida(1);
    expect((await cardapio.situacaoConferida(token, true)).veredito).toBe('aberta');
    expect((await cardapio.situacaoConferida(token, false)).veredito).toBeNull();
  });

  it('situação da 99 com mais de 12 h não conta; sem aplicativo e o servidor sem sinal → incerta', async () => {
    const velha = new Date(Date.now() - 13 * 3_600_000).toISOString();
    await q(`update integracao set config = config || jsonb_build_object('situacaoDaLoja', jsonb_build_object('estado','fechada','em',$2::text)) where tenant_id = $1`, [T, velha]);
    await batida(30);
    const s = await cardapio.situacaoConferida(token, true);
    expect(s.veredito).toBe('incerta');
    expect(s.canais).toEqual([]);
  });

  it('a pausa do Regem no iFood e na 99 fecha; a que falhou no canal não conta', async () => {
    const ate = new Date(Date.now() + 20 * 60_000).toISOString();
    await q(`insert into pausa_canal (id, tenant_id, unidade_id, canal, ate, motivo, externo_situacao) values (gen_random_uuid(),$1,$2,'ifood',$3,'energia','aplicada')`, [T, U, ate]);
    await q(`insert into pausa_canal (id, tenant_id, unidade_id, canal, ate, motivo, externo_situacao) values (gen_random_uuid(),$1,$2,'food99',$3,'energia','erro')`, [T, U, ate]);
    let s = await cardapio.situacaoConferida(token, true);
    expect(s.veredito).toBe('fechada');
    expect(s.canais.map((c) => c.nome)).toEqual(['iFood']); // a da 99 falhou lá: a 99 segue aberta (não se sabe dela)
    expect(s.motivo).toBe('Sem energia ou internet');
    // A 99 diz que está aberta: um aplicativo aberto basta.
    await food99.processarWebhook(aviso({ biz_status: 1, sub_biz_status: 1 }, Math.floor(Date.now() / 1000)));
    s = await cardapio.situacaoConferida(token, true);
    expect(s.veredito).toBe('aberta');
  });

  it('a rotina relê o detalhe só quando falta ou passou de 6 h; a falha não repete na volta seguinte', async () => {
    const ig: any = (await food99.integracoesAtivas()).find((x: any) => x.tenantId === T);
    let leituras = 0;
    let resposta: any = null;
    (food99 as any).shopDetail = async () => {
      leituras++;
      return resposta;
    };
    const agora = new Date();
    expect(await food99.atualizarSituacaoSeVelha(ig, agora)).toBeNull(); // falhou (null) — e marcou a tentativa
    resposta = { biz_status: 2, sub_biz_status: 5 };
    expect(await food99.atualizarSituacaoSeVelha(ig, new Date(agora.getTime() + 60_000))).toBeNull(); // menos de 30 min
    expect(leituras).toBe(1);
    const depois = new Date(agora.getTime() + 31 * 60_000);
    expect((await food99.atualizarSituacaoSeVelha(ig, depois))?.estado).toBe('fora_do_horario');
    expect((await config()).situacaoDaLoja).toMatchObject({ estado: 'fora_do_horario', fonte: 'leitura' });
    expect(await food99.atualizarSituacaoSeVelha(ig, new Date(depois.getTime() + 3_600_000))).toBeNull(); // fresca: nem tenta
    expect(leituras).toBe(2);
  });
});
