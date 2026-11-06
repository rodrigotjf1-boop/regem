import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../../db/schema';
import { IfoodAvaliacoesPoller } from '../integracoes/ifood/ifood-avaliacoes.poller';
import { IfoodService } from '../integracoes/ifood/ifood.service';
import { AvaliacaoIfoodService } from './avaliacao-ifood.service';
import { ChatIfoodService } from './chat-ifood.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

// O token do iFood sem rede (o teste da V82): a chamada de token devolve um de mentira e é anotada.
const tokensPedidos: string[] = [];
jest.mock('../../common/fetch-externo', () => ({
  fetchExterno: async (url: string) => {
    tokensPedidos.push(url);
    return { ok: true, status: 200, json: async () => ({ accessToken: 'tk-de-mentira', expiresIn: 21600 }), text: async () => '' };
  },
}));

// AS AVALIAÇÕES DO iFOOD NA CENTRAL (06/11/2026), contra o Postgres real, com o iFood de mentira: a rotina abre o caso da
// avaliação que pede uma pessoa (uma vez só), resolve o que a loja respondeu pelo Portal do Parceiro, não derruba nada com
// o módulo não liberado; a resposta da gestão vai ao iFood (texto, uma só, as recusas dele com a mensagem certa); o ajuste
// nasce desligado e a renovação do token não apaga o ajuste (V82).
const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('avaliacao-ifood-pg.spec: sem TEST_PG_URL — PULADO');
jest.setTimeout(60_000);

const PEDIDO = 'aaaaaaaa-1111-2222-3333-444444444444';
const rev = (id: string, o: Record<string, unknown> = {}) => ({
  id,
  score: 2,
  comment: 'A pizza chegou fria',
  customerName: 'Luiza F.',
  createdAt: new Date().toISOString(),
  status: 'NOT_REPLIED',
  order: { id: PEDIDO, shortId: '4511' },
  replies: [],
  questions: [{ title: 'Entrega', answers: [{ title: 'Ruim' }] }],
  ...o,
});

descrever('avaliações do iFood na central (Postgres)', () => {
  let pool: Pool;
  let db: any;
  const T = randomUUID();
  let gerente: string;
  const avisos: any[] = [];
  const auditoria: any[] = [];
  const respostas: any[] = [];
  let lista: any = { ok: true, status: 200, itens: [] };
  let respostaIfood: any = { ok: true, status: 201, codigo: null, mensagem: null };
  const ig = { id: 'ig-1', tenantId: T, unidadeId: null, merchantId: 'm-1', config: { atendimentoIfood: { avaliacoes: true } } } as any;
  const ifood: any = {
    integracoesAtivas: async () => [ig],
    integracaoDoTenant: async () => ig,
    avaliacoes: async () => lista,
    responderAvaliacao: async (...a: any[]) => {
      respostas.push(a);
      return respostaIfood;
    },
  };
  const eventos = { emit: (n: string, p: any) => void avisos.push({ n, p }) } as any;
  let poller: IfoodAvaliacoesPoller;
  let svc: AvaliacaoIfoodService;
  const q = async (s: string, p: any[] = []) => (await pool.query(s, p)).rows;
  const caso = async (reviewId: string) => (await q(`select * from atendimento_chamado where tenant_id = $1 and externo_id = $2`, [T, `avaliacao:${reviewId}`]))[0];
  const gerenteUser = () => ({ tenantId: T, colaboradorId: gerente, categoria: 'gerente' }) as any;

  beforeAll(async () => {
    pool = new Pool({ connectionString: URL_PG });
    db = drizzle(pool, { schema });
    poller = new IfoodAvaliacoesPoller(db, ifood, eventos);
    svc = new AvaliacaoIfoodService(db, ifood, eventos, { registrar: async (e: any) => void auditoria.push(e) } as any);
    await q(`insert into empresa (id, nome) values ($1, 'teste avaliações ifood')`, [T]);
    const [{ id: funcao }] = await q(`insert into funcao (tenant_id, nome, categoria) values ($1,'Gerente','gerente') returning id`, [T]);
    [{ id: gerente }] = await q(`insert into colaborador (tenant_id, nome, funcao_id) values ($1,'Ana gerente',$2) returning id`, [T, funcao]);
    await q(
      `insert into pedido_externo (tenant_id, canal, external_id, display_id, tipo, itens, total, status, cliente_nome)
       values ($1, 'ifood', $2, '4511', 'entrega', '[]', 76.9, 'concluido', 'Luiza F.')`,
      [T, PEDIDO],
    );
  });
  afterAll(async () => {
    if (!pool) return;
    for (const t of ['atendimento_chamado', 'pedido_externo', 'integracao', 'colaborador', 'funcao'])
      await q(`delete from ${t} where tenant_id = $1`, [T]).catch(() => {});
    await q(`delete from empresa where id = $1`, [T]).catch(() => {});
    await pool.end();
  });
  beforeEach(() => {
    avisos.length = 0;
    auditoria.length = 0;
    respostas.length = 0;
    respostaIfood = { ok: true, status: 201, codigo: null, mensagem: null };
  });

  it('a rotina: abre o caso da avaliação que pede uma pessoa (ligado ao pedido, nota 2 urgente), uma vez só', async () => {
    lista = {
      ok: true,
      status: 200,
      itens: [rev('r-1'), rev('r-boa', { score: 5, comment: '' }), rev('r-respondida', { replies: [{ from: 'MERCHANT', text: 'Obrigado' }] }), { semId: true }],
    };
    expect(await poller.daLoja(ig)).toEqual({ lidas: 4, abertos: 1, resolvidos: 0, recusado: null });
    const c = await caso('r-1');
    expect(c).toMatchObject({ tipo: 'avaliacao', canal: 'ifood', prioridade: 'urgente', pedido_numero: '4511', cliente: 'Luiza F.', mensagem: 'A pizza chegou fria', status: 'aberto' });
    expect(c.pedido_id).toBeTruthy();
    expect(c.detalhe.avaliacao).toMatchObject({ id: 'r-1', nota: 2, perguntas: [{ pergunta: 'Entrega', resposta: 'Ruim' }] });
    expect(await caso('r-boa')).toBeUndefined();
    expect(avisos.map((a) => a.n)).toEqual(['atendimento.novo']);
    // De novo (o iFood devolve a mesma lista): nada novo.
    expect(await poller.daLoja(ig)).toMatchObject({ abertos: 0 });
    expect((await q(`select count(*)::int as n from atendimento_chamado where tenant_id = $1`, [T]))[0].n).toBe(1);
  });

  it('a loja respondeu pelo Portal do Parceiro: o caso aberto se resolve com isso na próxima volta', async () => {
    lista = { ok: true, status: 200, itens: [rev('r-2')] };
    await poller.daLoja(ig);
    lista = { ok: true, status: 200, itens: [rev('r-2', { status: 'REPLIED', replies: [{ from: 'MERCHANT', text: 'Obrigado!' }] })] };
    expect(await poller.daLoja(ig)).toMatchObject({ resolvidos: 1 });
    expect(await caso('r-2')).toMatchObject({ status: 'resolvido', decisao: 'respondida_no_ifood' });
    expect(avisos.some((a) => a.n === 'atendimento.mudou')).toBe(true);
  });

  it('o módulo de avaliações não liberado (403): não derruba nada nem abre caso', async () => {
    lista = { ok: false, status: 403, itens: [] };
    expect(await poller.daLoja(ig)).toEqual({ lidas: 0, abertos: 0, resolvidos: 0, recusado: 403 });
  });

  it('a gestão responde: o texto vai ao iFood, o caso se resolve, a auditoria anota; uma resposta só', async () => {
    lista = { ok: true, status: 200, itens: [rev('r-3')] };
    await poller.daLoja(ig);
    const c = await caso('r-3');
    await expect(svc.responder(gerenteUser(), c.id, { texto: '   ' })).rejects.toThrow('Escreva a resposta da loja.');
    await expect(svc.responder(gerenteUser(), c.id, { texto: 'x'.repeat(301) })).rejects.toThrow('no máximo 300');
    expect(respostas).toHaveLength(0);
    const r: any = await svc.responder(gerenteUser(), c.id, { texto: '  Luiza, sentimos muito pela pizza fria.  ' });
    expect(r).toMatchObject({ ok: true, resposta: { texto: 'Luiza, sentimos muito pela pizza fria.', por: 'Ana gerente', porId: gerente } });
    expect(respostas).toEqual([[ig, 'r-3', 'Luiza, sentimos muito pela pizza fria.']]);
    expect(await caso('r-3')).toMatchObject({ status: 'resolvido', decisao: 'respondida', resolvido_por_id: gerente });
    expect(auditoria).toEqual([expect.objectContaining({ acao: 'respondeu_avaliacao_ifood', detalhe: expect.objectContaining({ avaliacao: 'r-3', nota: 2 }) })]);
    await expect(svc.responder(gerenteUser(), c.id, { texto: 'De novo, outra resposta.' })).rejects.toThrow('já foi respondida');
    expect(respostas).toHaveLength(1);
  });

  it('as recusas do iFood: publicada/já respondida (409/422), texto fora da regra (400, com a mensagem dele), não liberado (403)', async () => {
    lista = { ok: true, status: 200, itens: [rev('r-4')] };
    await poller.daLoja(ig);
    const c = await caso('r-4');
    respostaIfood = { ok: false, status: 422, codigo: 'ALREADY_PUBLISHED', mensagem: 'review published' };
    await expect(svc.responder(gerenteUser(), c.id, { texto: 'Obrigado pela avaliação!' })).rejects.toThrow('não aceita mais resposta');
    respostaIfood = { ok: false, status: 400, codigo: 'INVALID', mensagem: 'text must have between 10 and 300 characters' };
    await expect(svc.responder(gerenteUser(), c.id, { texto: 'Valeu' })).rejects.toThrow('text must have between 10 and 300 characters');
    respostaIfood = { ok: false, status: 403, codigo: null, mensagem: null };
    await expect(svc.responder(gerenteUser(), c.id, { texto: 'Obrigado pela avaliação!' })).rejects.toThrow('não liberou');
    expect(await caso('r-4')).toMatchObject({ status: 'aberto' }); // nada saiu: o caso segue aberto
    // vindo do servidor da loja (quem respondeu foi conferido lá)
    respostaIfood = { ok: true, status: 201, codigo: null, mensagem: null };
    const r: any = await svc.responderVindoDaLoja(T, { chamadoId: c.id, texto: 'Obrigado pela avaliação!', atorId: gerente, atorNome: 'Ana gerente' });
    expect(r.resposta).toMatchObject({ por: 'Ana gerente', porId: gerente });
    expect(auditoria.at(-1)).toMatchObject({ origem: 'servidor_local' });
  });

  it('o ajuste "Avaliações do iFood na fila" nasce desligado; a renovação do token não o apaga (V82)', async () => {
    const [linha] = await q(
      `insert into integracao (tenant_id, canal, ativo, merchant_id, client_id, client_secret, config)
       values ($1, 'ifood', true, 'm-1', 'cli', 'seg', '{}'::jsonb) returning id`,
      [T],
    );
    const chat = new ChatIfoodService(db);
    expect((await chat.ajustes(T)).ajusteIfood).toMatchObject({ avaliacoes: false });
    const real = new IfoodService(db);
    // A integração lida ANTES de a tela ligar o ajuste (a cópia em memória não tem a chave).
    const [integ] = (await real.integracoesAtivas()).filter((x) => x.tenantId === T);
    await chat.salvarAjustes({ tenantId: T, colaboradorId: gerente, categoria: 'gerente' } as any, { avaliacoes: true });
    await expect(chat.salvarAjustes({ tenantId: T, colaboradorId: gerente } as any, { avaliacoes: 'sim' })).rejects.toThrow();
    // A renovação do token com a cópia velha: a chave dele entra, o ajuste fica.
    await (real as any).token(integ);
    expect(tokensPedidos.length).toBeGreaterThan(0);
    const [cfg] = await q(`select token, config from integracao where id = $1`, [linha.id]);
    expect(cfg.token).toBe('tk-de-mentira');
    expect(cfg.config.atendimentoIfood).toMatchObject({ avaliacoes: true });
    expect(Number(cfg.config.tokenExp)).toBeGreaterThan(Date.now());
    expect((await chat.ajustes(T)).ajusteIfood).toMatchObject({ avaliacoes: true });
  });
});
