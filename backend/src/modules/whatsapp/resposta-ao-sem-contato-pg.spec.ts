import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../../db/schema';
import { EntregadorService } from '../entregador/entregador.service';
import {
  JANELA_DA_RESPOSTA_MIN,
  TEXTO_RESPOSTA_RECEBIDA,
  pedidoEsperandoResposta,
  portaoDaRespostaAoSemContato,
  registrarConfirmacao,
} from './resposta-ao-sem-contato';

/* eslint-disable @typescript-eslint/no-explicit-any */

// A RESPOSTA DO CLIENTE AO "ENTREGADOR SEM CONTATO" (Onda 0, 01/11/2026): o aviso pede "responda esta mensagem" e a
// resposta caía no robô, sem chegar a ninguém. Agora a mensagem do cliente com um pedido a caminho e o "sem contato"
// enviado há pouco vira chamado urgente do pedido (a equipe vê, o robô cala, o entregador vê no app), e o cliente recebe
// uma confirmação por aviso. Tudo pela chave do telefone: o pedido guarda sem o 55, a conversa chega com.
const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('resposta-ao-sem-contato-pg.spec: sem TEST_PG_URL — PULADO');
jest.setTimeout(60_000);

const TEL_DA_CONVERSA = '5521987654321';

descrever('resposta ao "entregador sem contato" (Postgres)', () => {
  const pool = new Pool({ connectionString: URL_PG });
  const db = drizzle(pool, { schema }) as any;
  const q = async (s: string, p: any[] = []) => (await pool.query(s, p)).rows;
  const emitidos: any[] = [];
  const emitir = (ev: string, dados: any) => void emitidos.push({ ev, dados });
  const empresas: string[] = [];

  afterAll(async () => {
    if (empresas.length) {
      for (const t of ['atendimento_chamado', 'pedido_envio', 'pedido_externo', 'colaborador'])
        await pool.query(`delete from ${t} where tenant_id = any($1::uuid[])`, [empresas]).catch(() => {});
      await pool.query('delete from empresa where id = any($1::uuid[])', [empresas]).catch(() => {});
    }
    await pool.end();
  });

  async function empresa() {
    const t = (await q(`insert into empresa (nome) values ('teste resposta sem contato') returning id`))[0].id as string;
    empresas.push(t);
    return t;
  }
  /** Um pedido de entrega (telefone sem o 55), com o entregador, e o "sem contato" enviado há `minutos`. */
  async function pedidoComAviso(t: string, o: { status?: string; minutos?: number | null; resultado?: string; telefone?: string } = {}) {
    const [c] = await q(`insert into colaborador (tenant_id, nome) values ($1,'Carlos Moto') returning id`, [t]);
    const [p] = await q(
      `insert into pedido_externo (tenant_id, canal, display_id, cliente_nome, cliente_telefone, tipo, itens, total, status, entregador_id, despachado_em)
       values ($1,'cardapio','81','Rodrigo Teste',$2,'entrega','[]'::jsonb,30,$3,$4, now() - interval '20 minutes') returning id`,
      [t, o.telefone ?? '21987654321', o.status ?? 'despachado', c.id],
    );
    if (o.minutos !== null)
      await q(
        `insert into pedido_envio (tenant_id, pedido_id, destino, acao, resultado, criado_em)
         values ($1,$2,'cliente_whatsapp','sem_contato',$3, now() - make_interval(mins => $4))`,
        [t, p.id, o.resultado ?? 'enviado', o.minutos ?? 2],
      );
    return { pedidoId: p.id as string, entregadorId: c.id as string };
  }
  const portao = (t: string, texto: string, telefone = TEL_DA_CONVERSA) =>
    portaoDaRespostaAoSemContato(db, emitir, { tenantId: t, unidadeId: null, telefone, nome: 'Rodrigo', texto });
  const chamados = (t: string) => q(`select * from atendimento_chamado where tenant_id = $1 order by criado_em`, [t]);

  it('a resposta vira chamado URGENTE ligado ao pedido; o cliente recebe uma confirmação; a 2ª mensagem soma ao chamado sem repetir', async () => {
    const t = await empresa();
    const { pedidoId } = await pedidoComAviso(t);
    emitidos.length = 0;
    const r1 = await portao(t, 'Estou descendo, 2 minutos');
    expect(r1).toEqual({ tratou: true, responder: TEXTO_RESPOSTA_RECEBIDA, pedidoId });
    await registrarConfirmacao(db, t, pedidoId, 'enviado');
    let [ch] = await chamados(t);
    expect(ch).toMatchObject({ tipo: 'outro', prioridade: 'urgente', status: 'aberto', pedido_id: pedidoId, pedido_numero: '81' });
    expect(ch.mensagem).toBe('O cliente respondeu ao "entregador sem contato": Estou descendo, 2 minutos');
    expect(emitidos.map((e) => e.ev)).toEqual(['atendimento.novo']);

    const r2 = await portao(t, 'O portão é o azul');
    expect(r2).toEqual({ tratou: true, responder: null, pedidoId }); // já confirmado para este aviso
    const todos = await chamados(t);
    expect(todos).toHaveLength(1);
    [ch] = todos;
    expect(ch.mensagem.split('\n')).toEqual([
      'O cliente respondeu ao "entregador sem contato": Estou descendo, 2 minutos',
      'O cliente respondeu ao "entregador sem contato": O portão é o azul',
    ]);
  });

  it('um "sem contato" NOVO depois da confirmação: o cliente recebe a confirmação de novo', async () => {
    const t = await empresa();
    const { pedidoId } = await pedidoComAviso(t, { minutos: 10 });
    await portao(t, 'oi');
    await q(`insert into pedido_envio (tenant_id, pedido_id, destino, acao, resultado, criado_em) values ($1,$2,'cliente_whatsapp','sem_contato_resposta','enviado', now() - interval '9 minutes')`, [t, pedidoId]);
    await q(`insert into pedido_envio (tenant_id, pedido_id, destino, acao, resultado) values ($1,$2,'cliente_whatsapp','sem_contato','enviado')`, [t, pedidoId]);
    expect((await portao(t, 'agora sim')).responder).toBe(TEXTO_RESPOSTA_RECEBIDA);
  });

  it(`não é resposta: sem aviso, aviso com mais de ${JANELA_DA_RESPOSTA_MIN} min, aviso que não saiu, pedido entregue, outro telefone`, async () => {
    const t = await empresa();
    await pedidoComAviso(t, { minutos: null }); // sem "sem contato"
    expect(await portao(t, 'oi')).toEqual({ tratou: false, responder: null });
    const t2 = await empresa();
    await pedidoComAviso(t2, { minutos: JANELA_DA_RESPOSTA_MIN + 5 });
    expect((await portao(t2, 'oi')).tratou).toBe(false);
    const t3 = await empresa();
    await pedidoComAviso(t3, { resultado: 'nao_enviado' });
    expect((await portao(t3, 'oi')).tratou).toBe(false);
    const t4 = await empresa();
    await pedidoComAviso(t4, { status: 'entregue' });
    expect((await portao(t4, 'oi')).tratou).toBe(false);
    const t5 = await empresa();
    await pedidoComAviso(t5);
    expect((await portao(t5, 'oi', '5521911112222')).tratou).toBe(false);
    for (const x of [t, t2, t3, t4, t5]) expect(await chamados(x)).toEqual([]);
  });

  it('o telefone casa pela chave: com e sem o 55, com e sem o nono dígito', async () => {
    const t = await empresa();
    await pedidoComAviso(t, { telefone: '(21) 98765-4321' });
    expect(await pedidoEsperandoResposta(db, t, '552187654321')).toMatchObject({ numero: '81', jaConfirmado: false });
    expect(await pedidoEsperandoResposta(db, t, '21987654321')).not.toBeNull();
  });

  it('o app do entregador vê a resposta (na lista e na rota própria); outro entregador não', async () => {
    const t = await empresa();
    const { pedidoId, entregadorId } = await pedidoComAviso(t);
    await portao(t, 'Estou descendo');
    await portao(t, 'Portão azul');
    const svc = new EntregadorService(db, {} as any, {} as any);
    const eu: any = { tenantId: t, colaboradorId: entregadorId, funcaoNome: 'Entregador', categoria: 'execucao' };
    expect(await svc.respostaDoCliente(eu, pedidoId)).toEqual({
      respostaDoCliente: { texto: 'Estou descendo\nPortão azul', em: expect.any(String) },
    });
    const [daLista] = await svc.pedidos(eu);
    expect(daLista.respostaDoCliente?.texto).toBe('Estou descendo\nPortão azul');
    await expect(svc.respostaDoCliente({ ...eu, colaboradorId: randomUUID() }, pedidoId)).rejects.toThrow('não está atribuído a você');
    // Resolvido o chamado, a resposta sai do app.
    await q(`update atendimento_chamado set status = 'resolvido' where tenant_id = $1`, [t]);
    expect(await svc.respostaDoCliente(eu, pedidoId)).toEqual({ respostaDoCliente: null });
  });
});
