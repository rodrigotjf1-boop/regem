import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../../db/schema';
import { EquipamentoService } from '../equipamento/equipamento.service';
import { comTravaDaEmpresa, repetirNaCorridaDeCatalogo } from '../../common/corrida-de-catalogo';
import { PonteChatGuard, type PonteCtx } from './ponte-chat.guard';
import { PonteChatService } from './ponte-chat.service';
import { CHAMEI_A_EQUIPE } from './robo-do-chat';

/* eslint-disable @typescript-eslint/no-explicit-any */

// O ROBÔ NO CHAT DO iFOOD E DA 99 (ponte do chat, Etapa 3), contra o Postgres real, pelo caminho de verdade: a ponte
// entrega a fala do cliente (`receber`) e o robô decide — responde o "cadê meu pedido?" com o dado do pedido (sem caso),
// chama a equipe no resto (o caso nasce com o resumo dele, e o cliente recebe "já chamei a equipe" uma vez), fica quieto
// com o caso aberto e não faz nada no agradecimento. As tabelas da ponte são só da nuvem: o teste aplica as migrations,
// com a trava da empresa na frente (ERR-377).
const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('robo-do-chat-pg.spec: sem TEST_PG_URL — PULADO');
jest.setTimeout(120_000);

const MIG = (arq: string) => join(__dirname, '../../../../database/migrations', arq);

descrever('o robô no chat do iFood e da 99 (Postgres)', () => {
  const pool = new Pool({ connectionString: URL_PG });
  const db = drizzle(pool, { schema }) as any;
  const q = async (s: string, p: any[] = []) => (await pool.query(s, p)).rows;
  const equipamentos = new EquipamentoService(db, { registrar: async () => {} } as any);
  const ponte = new PonteChatService(db, { emit: () => undefined } as any, { horaPrevistaDoPedido: async () => '20h32' } as any);
  const guarda = new PonteChatGuard(equipamentos);
  const T = randomUUID();
  let loja: string;
  let ana: string;
  let delivery: { id: string; segredo: string };

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
  const entrar = async (p: { id: string; segredo: string }): Promise<PonteCtx> => {
    const req: any = { headers: { 'x-terminal-id': p.id, 'x-terminal-secret': p.segredo } };
    await guarda.canActivate({ switchToHttp: () => ({ getRequest: () => req }) } as any);
    return req.ponteChat;
  };
  const ajustar = (ligada: boolean, robo: boolean) =>
    q(
      `insert into robo_config (tenant_id, chat_ponte_ligada, chat_robo_responde) values ($1, $2, $3)
       on conflict (tenant_id) do update set chat_ponte_ligada = $2, chat_robo_responde = $3`,
      [T, ligada, robo],
    );
  async function pedido(ext: string, o: { status?: string; tipo?: string; raw?: any; minAtras?: number } = {}) {
    return (
      await q(
        `insert into pedido_externo (tenant_id, unidade_id, canal, external_id, display_id, numero, tipo, status, cliente_nome, total, raw, despachado_em)
         values ($1, $2, 'ifood', $3, '4821', (floor(random()*90000)+10000)::int, $4, $5, 'MARIA SILVA', 50, $6::jsonb,
                 case when $5 = 'despachado' then now() - make_interval(mins => $7::int) end) returning id`,
        [T, loja, ext, o.tipo ?? 'entrega', o.status ?? 'despachado', JSON.stringify(o.raw ?? {}), o.minAtras ?? 5],
      )
    )[0].id as string;
  }
  let n = 0;
  const fala = async (ext: string, texto: string, autor = 'cliente') =>
    ponte.receber(await entrar(delivery), { mensagens: [{ canal: 'ifood', id: `rb-${++n}-${randomUUID().slice(0, 6)}`, pedido: { externo: ext }, cliente: 'Maria S.', autor, texto }] });
  const doRobo = (ext: string) =>
    q(`select texto, estado from chat_plataforma_msg where tenant_id = $1 and pedido_externo = $2 and autor = 'robo' order by criado_em, id`, [T, ext]).then((r) =>
      r.map((x: any) => x.texto),
    );
  const casosDo = (ext: string) => q(`select * from atendimento_chamado where tenant_id = $1 and tipo = 'chat' and detalhe #>> '{chat,chave}' = $2 order by criado_em`, [T, `ext:${ext}`]);

  beforeAll(async () => {
    delete process.env.EDGE_MODE; // como NUVEM
    for (const m of ['342_robo_pausa_e_config.sql', '366_ponte_do_chat.sql']) await aplicar(m);
    await q(`insert into empresa (id, nome) values ($1, 'teste robô do chat')`, [T]);
    [{ id: loja }] = await q(`insert into unidade (tenant_id, nome) values ($1, 'Loja A') returning id`, [T]);
    [{ id: ana }] = await q(`insert into colaborador (tenant_id, nome, unidade_id, status) values ($1, 'Ana', $2, 'ativo') returning id`, [T, loja]);
    const criado = await equipamentos.criar(T, ana, 'gerente', { tipo: 'ponte_chat', nome: 'Ponte do delivery', unidadeId: loja } as any);
    const { codigo } = await equipamentos.gerarCodigo(T, criado.id, ana, 'gerente');
    const p = await equipamentos.parearPorCodigo(codigo, 'PC delivery', 'ponte_chat');
    delivery = { id: p.terminalId as string, segredo: p.segredo as string };
  });
  beforeEach(async () => {
    delete process.env.EDGE_MODE;
    await ajustar(true, true);
  });
  afterAll(async () => {
    delete process.env.EDGE_MODE;
    for (const tab of ['atendimento_chamado', 'chat_plataforma_msg', 'chat_ponte', 'robo_config', 'pedido_externo', 'equipamento', 'colaborador', 'unidade'])
      await q(`delete from ${tab} where tenant_id = $1`, [T]).catch(() => {});
    await q(`delete from empresa where id = $1`, [T]).catch(() => {});
    await pool.end();
  });

  it('responde o "cadê" com o dado do pedido, sem caso; a 3ª pergunta na hora chama a equipe ("já chamei" uma vez); depois fica quieto', async () => {
    await pedido('r-a', { status: 'despachado', minAtras: 5 });
    expect(await fala('r-a', 'Cadê meu pedido?')).toMatchObject({ recebidas: 1, casosNovos: 0, roboRespondeu: 1 });
    expect(await fala('r-a', 'Já saiu?')).toMatchObject({ casosNovos: 0, roboRespondeu: 1 });
    let ditos = await doRobo('r-a');
    expect(ditos).toHaveLength(2);
    for (const d of ditos) expect(d).toMatch(/^Oi, Maria! Seu pedido saiu às \d{2}h\d{2} e chega por volta das 20h32\.$/);
    expect(await casosDo('r-a')).toHaveLength(0);
    // a 3ª na mesma hora: é de uma pessoa
    expect(await fala('r-a', 'Vai demorar?')).toMatchObject({ casosNovos: 1, roboRespondeu: 0 });
    const [caso] = await casosDo('r-a');
    expect(caso).toMatchObject({ status: 'aberto', prioridade: 'normal', mensagem: 'Vai demorar?' });
    expect(caso.detalhe.robo).toMatchObject({ motivo: 'Perguntou de novo pelo pedido (o robô já respondeu)', quer: 'Vai demorar?', jaFez: 'Avisou o cliente no chat que chamou a equipe da loja' });
    ditos = await doRobo('r-a');
    expect(ditos.slice(2)).toEqual([CHAMEI_A_EQUIPE]);
    // com o caso aberto, o robô fica quieto: a fala soma no caso e nada sai dele
    expect(await fala('r-a', 'Alô?')).toMatchObject({ casosNovos: 0, casosSomados: 1, roboRespondeu: 0 });
    expect(await doRobo('r-a')).toHaveLength(3);
  });

  it('o entregador da plataforma: acompanhar pelo app; a retirada pronta: já pode retirar', async () => {
    await pedido('r-b', { status: 'despachado', raw: { delivery: { deliveredBy: 'IFOOD' } } });
    await fala('r-b', 'Cadê meu pedido?');
    expect(await doRobo('r-b')).toEqual(['Oi, Maria! Seu pedido já saiu com o entregador do iFood. Dá para acompanhar pelo app do iFood.']);
    await pedido('r-d', { status: 'pronto', tipo: 'retirada' });
    await fala('r-d', 'Já está pronto? Que horas posso pegar?');
    expect(await doRobo('r-d')).toEqual(['Oi, Maria! Seu pedido está pronto: já pode retirar na loja.']);
  });

  it('reclamação com raiva: o caso nasce URGENTE com o resumo do robô, e o cliente recebe "já chamei a equipe"', async () => {
    await pedido('r-e', { status: 'despachado' });
    expect(await fala('r-e', 'Cadê meu pedido? Isso é um absurdo')).toMatchObject({ casosNovos: 1, roboRespondeu: 0 });
    const [caso] = await casosDo('r-e');
    expect(caso.prioridade).toBe('urgente');
    expect(caso.detalhe.robo).toMatchObject({ humor: 'chateado', motivo: 'Mensagem no chat do iFood' });
    expect(await doRobo('r-e')).toEqual([CHAMEI_A_EQUIPE]);
    // com o caso aberto, nem o "cadê" (que ele saberia responder) faz o robô falar: a equipe está na conversa
    expect(await fala('r-e', 'Cadê meu pedido?')).toMatchObject({ casosNovos: 0, casosSomados: 1, roboRespondeu: 0 });
    expect(await doRobo('r-e')).toEqual([CHAMEI_A_EQUIPE]);
  });

  it('agradecimento: nada (nem resposta, nem caso); pedido entregue que "não chegou": chama a equipe', async () => {
    await pedido('r-f', { status: 'despachado' });
    expect(await fala('r-f', 'Obrigada!')).toMatchObject({ recebidas: 1, casosNovos: 0, roboRespondeu: 0 });
    expect(await doRobo('r-f')).toEqual([]);
    expect(await casosDo('r-f')).toHaveLength(0);
    await pedido('r-g', { status: 'entregue' });
    expect(await fala('r-g', 'Ainda não chegou')).toMatchObject({ casosNovos: 1, roboRespondeu: 0 });
    expect((await casosDo('r-g'))[0].detalhe.robo.motivo).toBe('Perguntou pelo pedido (o robô não tem como dizer)');
  });

  it('o robô desligado: a Etapa 2 (o caso nasce, nada sai do robô); a fala da loja nunca aciona o robô', async () => {
    await ajustar(true, false);
    await pedido('r-h', { status: 'despachado' });
    const r = await fala('r-h', 'Cadê meu pedido?');
    expect(r).toMatchObject({ casosNovos: 1 });
    expect(r).not.toHaveProperty('roboRespondeu');
    expect(await doRobo('r-h')).toEqual([]);
    expect((await casosDo('r-h'))[0].detalhe.robo).toBeUndefined();
    await ajustar(true, true);
    await pedido('r-i', { status: 'despachado' });
    expect(await fala('r-i', 'Cadê meu pedido?', 'loja')).toMatchObject({ recebidas: 1, casosNovos: 0, roboRespondeu: 0 });
    expect(await doRobo('r-i')).toEqual([]);
  });
});
