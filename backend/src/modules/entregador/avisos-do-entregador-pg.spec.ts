import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../../db/schema';
import { comTravaDaEmpresa, repetirNaCorridaDeCatalogo } from '../../common/corrida-de-catalogo';
import { avisarEntregador, avisarPelaMensagemDoCliente } from '../../common/aviso-ao-entregador';
import { DeliveryService } from '../delivery/delivery.service';
import { EntregadorService } from './entregador.service';
import { AvisosDoEntregadorService } from './avisos-do-entregador.service';
import { AvisarOEntregadorService } from '../atendimento/avisar-o-entregador.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

// OS AVISOS AO ENTREGADOR (mig 391; pedido do dono, 10/11/2026), contra o Postgres de verdade (V6):
//  • o automático — o cliente pergunta pelo pedido ou reclama de demora (pelo telefone, como o WhatsApp manda) com o
//    pedido a caminho: um aberto por pedido e motivo (índice único — V24); fora: sem entregador, retirada, entregador da
//    plataforma, pedido que não saiu, servidor da loja;
//  • o do atendimento — pelo caso, também depois da entrega (até 12 h); as recusas antes de gravar (V86);
//  • o app — os avisos abertos dele com o pedido, "vi", a resposta pelo canal do pedido (chat do iFood/99; WhatsApp da
//    loja no cardápio), uma vez só; sem sair, o texto volta para o WhatsApp do entregador;
//  • "Minhas entregas" — o mesmo filtro dos ganhos.
// A tabela é só da nuvem: o teste aplica a 391 (o banco do CI é o de uma loja). O chat da plataforma e o WhatsApp são de
// mentira (o que sairia fica anotado).
const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('avisos-do-entregador-pg.spec: sem TEST_PG_URL — PULADO');
jest.setTimeout(90_000);

const MIG = (arq: string) => join(__dirname, '../../../../database/migrations', arq);

descrever('os avisos ao entregador (Postgres)', () => {
  const pool = new Pool({ connectionString: URL_PG });
  const db = drizzle(pool, { schema }) as any;
  const q = async (s: string, p: any[] = []) => (await pool.query(s, p)).rows;
  const noChat: any[] = [];
  let chatFalha: Error | null = null;
  const chat: any = {
    enviar: async (_u: any, id: string, dto: any, opcoes: any) => {
      if (chatFalha) throw chatFalha;
      noChat.push({ id, texto: dto.texto, idCliente: dto.idCliente, depoisDaEntrega: opcoes?.depoisDaEntrega === true });
      return { ok: true };
    },
  };
  const peloQr: any[] = [];
  const qr = { enviar: async (_t: string, numero: string, texto: string) => void peloQr.push({ numero, texto }) } as any;
  const delivery: any = new (DeliveryService as any)(db, {}, {}, {}, {}, { emit: () => true }, { flashPedidos: () => undefined },
    undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, qr);
  const entregador: any = new EntregadorService(db, delivery, {} as any);
  const avisos = new AvisosDoEntregadorService(db, entregador, chat, delivery, { emit: () => true } as any);
  const atendimento = new AvisarOEntregadorService(db, { emit: () => true } as any);
  const T = randomUUID();
  let carlos: string;
  let outro: string;
  let ana: string;
  const eu = (id = carlos) => ({ tenantId: T, colaboradorId: id, funcaoNome: 'Entregador', categoria: 'execucao', nome: 'Carlos' }) as any;
  const antes = { edge: process.env.EDGE_MODE, cardapio: process.env.CARDAPIO_PUBLIC_URL };

  beforeAll(async () => {
    delete process.env.EDGE_MODE; // como NUVEM
    process.env.CARDAPIO_PUBLIC_URL = 'https://app.dmsregem.com';
    await repetirNaCorridaDeCatalogo(() => pool.query(comTravaDaEmpresa(readFileSync(MIG('391_avisos_ao_entregador.sql'), 'utf8'))));
    // A marca do acerto do entregador (mig 207, só da nuvem): "Minhas entregas" e os ganhos deixam de fora o já acertado.
    await repetirNaCorridaDeCatalogo(() =>
      pool.query(comTravaDaEmpresa('alter table pedido_externo add column if not exists entregador_fechamento_id uuid')),
    );
    await q(`insert into empresa (id, nome) values ($1, 'teste avisos ao entregador')`, [T]);
    await q(`insert into cardapio_config (tenant_id, token, ativo, provedor) values ($1,$2,true,'evolution')`, [T, `tk-${randomUUID()}`]);
    [{ id: carlos }] = await q(`insert into colaborador (tenant_id, nome, status) values ($1, 'Carlos Moto', 'ativo') returning id`, [T]);
    [{ id: outro }] = await q(`insert into colaborador (tenant_id, nome, status) values ($1, 'Outro Moto', 'ativo') returning id`, [T]);
    [{ id: ana }] = await q(`insert into colaborador (tenant_id, nome, status) values ($1, 'Ana Atendente', 'ativo') returning id`, [T]);
  });
  beforeEach(() => {
    noChat.length = 0;
    peloQr.length = 0;
    chatFalha = null;
  });
  afterAll(async () => {
    if (antes.edge !== undefined) process.env.EDGE_MODE = antes.edge;
    else delete process.env.EDGE_MODE;
    if (antes.cardapio !== undefined) process.env.CARDAPIO_PUBLIC_URL = antes.cardapio;
    else delete process.env.CARDAPIO_PUBLIC_URL;
    for (const tab of ['entregador_aviso', 'atendimento_chamado', 'pedido_envio', 'pedido_notificacao', 'pedido_externo', 'cardapio_config', 'colaborador'])
      await q(`delete from ${tab} where tenant_id = $1`, [T]).catch(() => {});
    await q(`delete from empresa where id = $1`, [T]).catch(() => {});
    await pool.end();
  });

  let n = 80;
  async function pedido(o: { canal?: string; raw?: any; status?: string; tipo?: string; entregador?: string | null; concluidoHaHoras?: number; tel?: string } = {}) {
    const canal = o.canal ?? 'cardapio';
    const status = o.status ?? 'despachado';
    const concluido = o.concluidoHaHoras != null ? `now() - make_interval(hours => ${o.concluidoHaHoras})` : 'null';
    const [{ id }] = await q(
      `insert into pedido_externo (tenant_id, canal, display_id, numero, cliente_nome, cliente_telefone, tipo, itens, total, status, raw,
                                   entregador_id, despachado_em, entregue_em, concluido_em, rastreio_token)
       values ($1,$2,$3,$4,'Maria Silva',$5,$6,'[]'::jsonb,50,$7,$8::jsonb,$9, now() - interval '10 minutes', ${concluido}, ${concluido}, $10) returning id`,
      [T, canal, String(++n), n, o.tel ?? '21987654321', o.tipo ?? 'entrega', status, JSON.stringify(o.raw ?? {}),
       o.entregador === undefined ? carlos : o.entregador, `rt-${randomUUID().slice(0, 8)}`],
    );
    return id as string;
  }
  const doPedido = (id: string) => q(`select * from entregador_aviso where pedido_id = $1 order by criado_em`, [id]);
  const IFOOD_LOJA = { delivery: { deliveredBy: 'MERCHANT' } };

  it('o automático pelo WhatsApp: perguntou pelo pedido / reclamou da demora com ele a caminho — um aberto por motivo', async () => {
    const id = await pedido();
    // o telefone da conversa vem com o 55; o pedido guarda sem
    expect(await avisarPelaMensagemDoCliente(db, { tenantId: T, telefone: '5521987654321', texto: 'Cadê meu pedido?' })).toMatchObject({ estado: 'avisado' });
    expect(await avisarPelaMensagemDoCliente(db, { tenantId: T, telefone: '5521987654321', texto: 'Já saiu?' })).toMatchObject({ estado: 'ja_avisado' });
    expect(await avisarPelaMensagemDoCliente(db, { tenantId: T, telefone: '5521987654321', texto: 'tá demorando demais' })).toMatchObject({ estado: 'avisado' });
    expect(await avisarPelaMensagemDoCliente(db, { tenantId: T, telefone: '5521987654321', texto: 'obrigado' })).toBeNull();
    const linhas = await doPedido(id);
    expect(linhas.map((a: any) => [a.origem, a.motivo, a.colaborador_id, a.texto])).toEqual([
      ['robo', 'onde_esta', carlos, 'Cadê meu pedido?'],
      ['robo', 'demora', carlos, 'tá demorando demais'],
    ]);
    // no servidor da loja não faz nada (a mensagem chega na nuvem de qualquer jeito)
    process.env.EDGE_MODE = 'true';
    try {
      expect(await avisarPelaMensagemDoCliente(db, { tenantId: T, telefone: '21987654321', texto: 'cadê?' })).toBeNull();
    } finally {
      delete process.env.EDGE_MODE;
    }
  });

  it('fora do aviso: sem entregador, retirada, entregador do iFood, pedido que não saiu; o atendimento até 12 h depois da entrega', async () => {
    const r = (pedidoId: string, origem: 'robo' | 'atendimento' = 'robo') => avisarEntregador(db, { tenantId: T, pedidoId, origem, motivo: 'onde_esta' });
    expect(await r(await pedido({ entregador: null }))).toEqual({ estado: 'fora' });
    expect(await r(await pedido({ tipo: 'retirada' }))).toEqual({ estado: 'fora' });
    expect(await r(await pedido({ canal: 'ifood', raw: { delivery: { deliveredBy: 'IFOOD' } } }))).toEqual({ estado: 'fora' });
    expect(await r(await pedido({ status: 'pronto' }))).toEqual({ estado: 'fora' });
    // depois da entrega: o automático não, o atendimento sim (até 12 h)
    const entregue = await pedido({ status: 'concluido', concluidoHaHoras: 2 });
    expect(await r(entregue)).toEqual({ estado: 'fora' });
    expect(await r(entregue, 'atendimento')).toMatchObject({ estado: 'avisado' });
    expect(await r(await pedido({ status: 'concluido', concluidoHaHoras: 13 }), 'atendimento')).toEqual({ estado: 'fora' });
    // pedido de outra empresa: fora
    expect(await avisarEntregador(db, { tenantId: randomUUID(), pedidoId: entregue, origem: 'atendimento', motivo: 'outro' })).toEqual({ estado: 'fora' });
  });

  it('o app: os avisos abertos DELE com o pedido; "vi"; a resposta pelo chat do iFood, uma vez só; depois, o robô avisa de novo', async () => {
    const id = await pedido({ canal: 'ifood', raw: IFOOD_LOJA, tel: '08007050000' });
    const [{ id: avisoId }] = [await avisarEntregador(db, { tenantId: T, pedidoId: id, origem: 'robo', motivo: 'demora', texto: 'demorando' })] as any;
    const meus = await avisos.meus(eu());
    const a = meus.find((x: any) => x.id === avisoId)!;
    expect(a).toMatchObject({ origem: 'robo', motivo: 'demora', rotulo: 'O cliente está reclamando da demora', texto: 'demorando', depoisDaEntrega: false });
    expect(a.pedido).toMatchObject({ id, canal: 'ifood', chatDaPlataforma: true });
    expect((await avisos.meus(eu(outro))).some((x: any) => x.id === avisoId)).toBe(false);
    await avisos.visto(eu(), avisoId);
    expect((await doPedido(id))[0].visto_em).not.toBeNull();
    await expect(avisos.visto(eu(outro), avisoId)).rejects.toThrow('Aviso não encontrado');

    const r1 = await avisos.responder(eu(), avisoId, { acao: 'a_caminho' });
    expect(r1).toMatchObject({ ok: true, saiu: true, por: 'chat' });
    expect(noChat).toEqual([{ id, texto: expect.stringMatching(/^Seu pedido #\d+ está a caminho! 🛵/), idCliente: expect.any(String), depoisDaEntrega: false }]);
    const [linha] = await doPedido(id);
    expect(linha).toMatchObject({ resposta: 'a_caminho', resposta_saiu: true });
    // de novo (o app reenviou): devolve a primeira, nada mais sai
    expect(await avisos.responder(eu(), avisoId, { acao: 'cheguei' })).toMatchObject({ jaRespondido: true, resposta: 'a_caminho' });
    expect(noChat).toHaveLength(1);
    expect((await avisos.meus(eu())).some((x: any) => x.id === avisoId)).toBe(false);
    // respondido o aviso, a próxima reclamação avisa de novo
    expect(await avisarEntregador(db, { tenantId: T, pedidoId: id, origem: 'robo', motivo: 'demora' })).toMatchObject({ estado: 'avisado' });
    await expect(avisos.responder(eu(), avisoId, { acao: 'voar' })).rejects.toThrow('Resposta inválida');
  });

  it('cardápio: o WhatsApp da loja leva a resposta; depois da entrega, "voltando com o que faltou"; o chat que falha devolve o texto', async () => {
    const entregue = await pedido({ status: 'concluido', concluidoHaHoras: 1 });
    const av = await avisarEntregador(db, { tenantId: T, pedidoId: entregue, origem: 'atendimento', motivo: 'faltou_item', texto: 'levar 1 Coca 2 L' });
    const [aberto] = (await avisos.meus(eu())).filter((x: any) => x.id === av.id);
    expect(aberto).toMatchObject({ depoisDaEntrega: true, texto: 'levar 1 Coca 2 L', rotulo: 'Faltou item no pedido' });
    expect(await avisos.responder(eu(), av.id!, { acao: 'a_caminho' })).toMatchObject({ saiu: true, por: 'whatsapp_loja' });
    expect(peloQr).toEqual([
      {
        numero: '5521987654321',
        texto: expect.stringMatching(/^\*O entregador está voltando\*\nO entregador está voltando com o que faltou no seu pedido #\d+\. 🛵$/),
      },
    ]);
    // iFood com a ponte fora: não sai, e o texto volta para o app oferecer o WhatsApp do entregador
    const ifood = await pedido({ canal: 'ifood', raw: IFOOD_LOJA, tel: '08007050000' });
    const av2 = await avisarEntregador(db, { tenantId: T, pedidoId: ifood, origem: 'robo', motivo: 'onde_esta' });
    chatFalha = new Error('O chat com o cliente pela plataforma não está ligado nesta loja.');
    const r = await avisos.responder(eu(), av2.id!, { acao: 'cheguei' });
    expect(r).toMatchObject({ ok: true, saiu: false, motivo: expect.stringContaining('não está ligado'), texto: expect.stringMatching(/^O entregador chegou com o seu pedido #\d+!/) });
    expect((await doPedido(ifood))[0]).toMatchObject({ resposta: 'cheguei', resposta_saiu: false });
    // "ligou" só registra
    const av3 = await avisarEntregador(db, { tenantId: T, pedidoId: ifood, origem: 'robo', motivo: 'demora' });
    expect(await avisos.responder(eu(), av3.id!, { acao: 'ligou' })).toMatchObject({ ok: true, saiu: null });
  });

  it('o caso do Atendimento: quem entrega, os avisos com o que ele fez; avisar com motivo e recado; as recusas antes de gravar', async () => {
    const id = await pedido();
    const [{ id: caso }] = await q(`insert into atendimento_chamado (tenant_id, tipo, pedido_id, mensagem) values ($1,'outro',$2,'cadê?') returning id`, [T, id]);
    let s = await atendimento.situacaoNaEmpresa(T, caso);
    expect(s).toMatchObject({ entregador: { id: carlos, nome: 'Carlos Moto' }, podeAvisar: true, porQueNao: null, avisos: [] });
    expect(s.motivos.map((m) => m.valor)).toEqual(['onde_esta', 'demora', 'faltou_item', 'faltou_troco', 'outro']);
    await expect(atendimento.avisarNaEmpresa(T, caso, { motivo: 'xyz' }, { id: ana, perfil: 'gerente' }, 'web')).rejects.toThrow('Escolha o motivo');
    await expect(atendimento.avisarNaEmpresa(T, caso, { motivo: 'outro', nota: 'x'.repeat(301) }, { id: ana, perfil: 'gerente' }, 'web')).rejects.toThrow('cabe em 300');
    expect(await atendimento.avisarNaEmpresa(T, caso, { motivo: 'faltou_troco', nota: 'Levar R$ 10 de troco' }, { id: ana, perfil: 'gerente' }, 'web')).toMatchObject({ ok: true });
    s = await atendimento.situacaoNaEmpresa(T, caso);
    expect(s.avisos).toEqual([
      expect.objectContaining({ origem: 'atendimento', motivo: 'faltou_troco', rotulo: 'Faltou o troco', texto: 'Levar R$ 10 de troco', enviadoPor: 'Ana Atendente', resposta: null }),
    ]);
    // o entregador responde no app: o caso vê
    await avisos.responder(eu(), s.avisos[0].id, { acao: 'a_caminho' });
    expect((await atendimento.situacaoNaEmpresa(T, caso)).avisos[0]).toMatchObject({ resposta: 'a_caminho', respostaSaiu: true });
    // caso resolvido: não avisa mais
    await q(`update atendimento_chamado set status = 'resolvido' where id = $1`, [caso]);
    await expect(atendimento.avisarNaEmpresa(T, caso, { motivo: 'outro' }, { id: ana, perfil: 'gerente' }, 'web')).rejects.toThrow('já foi resolvido');
    // pedido sem entregador pelo app: o bloco nem aparece
    const semEntregador = await pedido({ entregador: null });
    const [{ id: caso2 }] = await q(`insert into atendimento_chamado (tenant_id, tipo, pedido_id) values ($1,'outro',$2) returning id`, [T, semEntregador]);
    expect(await atendimento.situacaoNaEmpresa(T, caso2)).toMatchObject({ entregador: null, podeAvisar: false });
    await expect(atendimento.avisarNaEmpresa(T, caso2, { motivo: 'outro' }, { id: ana, perfil: 'gerente' }, 'web')).rejects.toThrow('entregador pelo app');
  });

  it('"Minhas entregas": as entregas do período que compõem os ganhos — dele, entregues/concluídas, não acertadas', async () => {
    entregador.perfilDeEntregador = async () => ({ periodicidade: 'dia' });
    await q(`delete from pedido_externo where tenant_id = $1`, [T]);
    const a = await pedido({ status: 'entregue', concluidoHaHoras: 0 });
    const b = await pedido({ status: 'concluido', concluidoHaHoras: 0 });
    await pedido({ status: 'concluido', concluidoHaHoras: 0, entregador: outro });
    await pedido({ status: 'despachado' });
    const acertado = await pedido({ status: 'concluido', concluidoHaHoras: 0 });
    await q(`update pedido_externo set entregador_fechamento_id = gen_random_uuid() where id = $1`, [acertado]);
    const r = await entregador.entregas(eu());
    expect(r.periodicidade).toBe('dia');
    expect(r.entregas.map((e: any) => e.id).sort()).toEqual([a, b].sort());
    expect(r.entregas.find((e: any) => e.id === a)).toMatchObject({ status: 'entregue', canal: 'cardapio', cliente: 'Maria Silva', taxaCentavos: 0 });
    await expect(entregador.entregas({ ...eu(), funcaoNome: 'Caixa' })).rejects.toThrow('Apenas entregadores');
  });
});
