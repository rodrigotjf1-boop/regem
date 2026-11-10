import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../../db/schema';
import { ChatDoEntregadorService, PREFIXO_DO_ENTREGADOR } from './chat-do-entregador.service';
import { comTravaDaEmpresa, repetirNaCorridaDeCatalogo } from '../../common/corrida-de-catalogo';

/* eslint-disable @typescript-eslint/no-explicit-any */

// O ENTREGADOR CONVERSA COM O CLIENTE PELO CHAT DO iFOOD E DA 99 (pedido do dono, 09/11/2026). Contra o Postgres de verdade
// (V6): a mensagem entra na fila de saída da ponte (`chat_plataforma_msg`, mig 366) como a da equipe, com o id do
// entregador; o reenvio com o mesmo id do app não duplica (V24); toda recusa vem antes de gravar (V86); a conversa mostra
// quem falou do ponto de vista dele. As tabelas do chat são só da nuvem: o teste aplica as migrations (o banco do CI é o
// de uma loja). A ponte é de mentira (ligada? quem envia?).
const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('chat-do-entregador-pg.spec: sem TEST_PG_URL — PULADO');
jest.setTimeout(90_000);

const MIG = (arq: string) => join(__dirname, '../../../../database/migrations', arq);

descrever('o chat do entregador com o cliente do iFood e da 99 (Postgres)', () => {
  const pool = new Pool({ connectionString: URL_PG });
  const db = drizzle(pool, { schema }) as any;
  const q = async (s: string, p: any[] = []) => (await pool.query(s, p)).rows;
  const ponte = { ligada: true, envia: true };
  const ponteFalsa: any = {
    ligada: async () => ponte.ligada,
    quemRespondePeloCanal: async () => (ponte.envia ? 'pc-1' : null),
  };
  const auditados: any[] = [];
  const chat = new ChatDoEntregadorService(db, ponteFalsa, { registrar: async (r: any) => void auditados.push(r) } as any);
  const T = randomUUID();
  let carlos: string;
  let outro: string;
  const eu = () => ({ tenantId: T, colaboradorId: carlos, funcaoNome: 'Entregador', categoria: 'execucao', nome: 'Carlos' }) as any;

  beforeAll(async () => {
    delete process.env.EDGE_MODE; // como NUVEM
    for (const arq of ['342_robo_pausa_e_config.sql', '366_ponte_do_chat.sql', '367_chat_ordem_e_indices.sql'])
      await repetirNaCorridaDeCatalogo(() => pool.query(comTravaDaEmpresa(readFileSync(MIG(arq), 'utf8'))));
    await q(`insert into empresa (id, nome) values ($1, 'teste chat do entregador')`, [T]);
    [{ id: carlos }] = await q(`insert into colaborador (tenant_id, nome, status) values ($1, 'Carlos Moto', 'ativo') returning id`, [T]);
    [{ id: outro }] = await q(`insert into colaborador (tenant_id, nome, status) values ($1, 'Outro Moto', 'ativo') returning id`, [T]);
  });
  beforeEach(() => {
    ponte.ligada = true;
    ponte.envia = true;
    auditados.length = 0;
  });
  afterAll(async () => {
    for (const tab of ['chat_plataforma_msg', 'pedido_externo', 'colaborador'])
      await q(`delete from ${tab} where tenant_id = $1`, [T]).catch(() => {});
    await q(`delete from empresa where id = $1`, [T]).catch(() => {});
    await pool.end();
  });

  async function pedido(o: { canal?: string; raw?: any; status?: string; entregador?: string | null } = {}) {
    const canal = o.canal ?? 'ifood';
    const ext = `ext-${randomUUID().slice(0, 8)}`;
    const raw = o.raw ?? (canal === 'ifood' ? { delivery: { deliveredBy: 'MERCHANT' } } : canal === '99food' ? { delivery_type: 2 } : {});
    const [{ id }] = await q(
      `insert into pedido_externo (tenant_id, canal, external_id, display_id, cliente_nome, tipo, itens, total, status, raw, entregador_id)
       values ($1,$2,$3,'4821','MARIA SILVA','entrega','[]'::jsonb,50,$4,$5::jsonb,$6) returning id`,
      [T, canal, ext, o.status ?? 'despachado', JSON.stringify(raw), o.entregador === undefined ? carlos : o.entregador],
    );
    return { id: id as string, ext };
  }

  it('envia: entra na fila da ponte como a da equipe, com o id do entregador e o "Entregador: " na frente', async () => {
    const { id, ext } = await pedido();
    const r = await chat.enviar(eu(), id, { texto: '  Estou na portaria, pode descer?  ' });
    expect(r).toMatchObject({ ok: true, estado: 'pendente', saiAgora: true });
    const [m] = await q(`select * from chat_plataforma_msg where id = $1`, [r.id]);
    expect(m).toMatchObject({
      canal: 'ifood',
      pedido_id: id,
      pedido_externo: ext,
      pedido_numero: '4821',
      direcao: 'saida',
      autor: 'equipe',
      autor_id: carlos,
      estado: 'pendente',
      texto: `${PREFIXO_DO_ENTREGADOR}Estou na portaria, pode descer?`,
    });
    // a auditoria guarda quem, o canal e o tamanho — não o texto
    expect(auditados).toEqual([expect.objectContaining({ acao: 'entregador_escreveu_no_chat', origem: 'app_entregador', detalhe: { canal: 'ifood', mensagemId: r.id, letras: 'Estou na portaria, pode descer?'.length } })]);
  });

  it('o reenvio com o mesmo id do app não duplica (a resposta diz que é a mesma)', async () => {
    const { id } = await pedido({ canal: '99food' });
    const idCliente = randomUUID();
    const a = await chat.enviar(eu(), id, { texto: 'Cheguei', idCliente });
    const b = await chat.enviar(eu(), id, { texto: 'Cheguei', idCliente });
    expect(a.id).toBe(idCliente);
    expect(b).toMatchObject({ ok: true, id: idCliente, repetida: true });
    expect(await q(`select count(*)::int as n from chat_plataforma_msg where pedido_id = $1`, [id])).toEqual([{ n: 1 }]);
    // o id de outro entregador não serve para "ver" a mensagem dele
    const deOutro = await pedido({ entregador: outro });
    await expect(
      chat.enviar({ ...eu(), colaboradorId: outro }, deOutro.id, { texto: 'oi', idCliente }),
    ).rejects.toThrow('Não foi possível enviar');
  });

  it('as recusas vêm antes de gravar: vazio, longo, contato proibido, não é dele, não está a caminho, ponte desligada, outro canal', async () => {
    const { id } = await pedido();
    await expect(chat.enviar(eu(), id, { texto: '   ' })).rejects.toThrow('Escreva a mensagem');
    await expect(chat.enviar(eu(), id, { texto: 'x'.repeat(300) })).rejects.toThrow('cabem até');
    await expect(chat.enviar(eu(), id, { texto: 'me chama no 21 98765-4321' })).rejects.toThrow('O iFood proíbe');
    await expect(chat.enviar(eu(), (await pedido({ entregador: outro })).id, { texto: 'oi' })).rejects.toThrow('não está atribuído a você');
    await expect(chat.enviar(eu(), (await pedido({ status: 'pronto' })).id, { texto: 'oi' })).rejects.toThrow('não está a caminho');
    await expect(chat.enviar(eu(), (await pedido({ canal: 'cardapio' })).id, { texto: 'oi' })).rejects.toThrow('não é do iFood nem da 99');
    await expect(chat.enviar(eu(), (await pedido({ raw: { delivery: { deliveredBy: 'IFOOD' } } })).id, { texto: 'oi' })).rejects.toThrow('entregador do iFood');
    await expect(chat.enviar({ ...eu(), funcaoNome: 'Caixa' }, id, { texto: 'oi' })).rejects.toThrow('Apenas entregadores');
    ponte.ligada = false;
    await expect(chat.enviar(eu(), id, { texto: 'oi' })).rejects.toThrow('não está ligado nesta loja');
    expect(await q(`select count(*)::int as n from chat_plataforma_msg where pedido_id = $1`, [id])).toEqual([{ n: 0 }]);
    // ligada mas nenhum PC enviando agora: entra na fila e o app avisa que ainda não saiu
    ponte.ligada = true;
    ponte.envia = false;
    expect(await chat.enviar(eu(), id, { texto: 'oi' })).toMatchObject({ ok: true, saiAgora: false });
  });

  it('a conversa: as falas do pedido em ordem, do ponto de vista do entregador (cliente / você / loja), sem o prefixo', async () => {
    const { id, ext } = await pedido();
    const grava = (direcao: string, autor: string, texto: string, autorId: string | null, seg: number, porExterno = false) =>
      q(
        `insert into chat_plataforma_msg (tenant_id, canal, pedido_id, pedido_externo, direcao, autor, autor_id, texto, estado, criado_em)
         values ($1,'ifood',$2,$3,$4,$5,$6,$7,$8, now() - make_interval(secs => $9::int))`,
        [T, porExterno ? null : id, ext, direcao, autor, autorId, texto, direcao === 'entrada' ? 'recebida' : 'enviada', seg],
      );
    await grava('saida', 'aviso', 'Seu pedido saiu para entrega!', null, 50);
    await grava('saida', 'equipe', `${PREFIXO_DO_ENTREGADOR}Estou chegando`, carlos, 40);
    await grava('entrada', 'cliente', 'Ok, estou descendo', null, 30, true); // ligada só pelo id do pedido na plataforma
    await grava('saida', 'equipe', 'Obrigado pela preferência', outro, 20);
    const c = await chat.conversa(eu(), id);
    expect(c.canal).toBe('ifood');
    expect(c.ponte).toEqual({ ligada: true, responde: true });
    expect(c.mensagens.map((m) => [m.de, m.texto])).toEqual([
      ['loja', 'Seu pedido saiu para entrega!'],
      ['voce', 'Estou chegando'],
      ['cliente', 'Ok, estou descendo'],
      ['loja', 'Obrigado pela preferência'],
    ]);
    await expect(chat.conversa({ ...eu(), colaboradorId: outro }, id)).rejects.toThrow('não está atribuído a você');
  });

  it('a última fala do cliente por pedido (a lista do app marca "o cliente escreveu"), só iFood e 99', async () => {
    const a = await pedido();
    const b = await pedido({ canal: 'cardapio' });
    await q(
      `insert into chat_plataforma_msg (tenant_id, canal, pedido_id, direcao, autor, texto, estado, criado_em)
       values ($1,'ifood',$2,'entrada','cliente','primeira','recebida', now() - interval '2 minutes'),
              ($1,'ifood',$2,'entrada','cliente','segunda','recebida', now() - interval '1 minute')`,
      [T, a.id],
    );
    const m = await chat.ultimasDoCliente(T, [
      { id: a.id, canal: 'ifood' },
      { id: b.id, canal: 'cardapio' },
    ]);
    expect([...m.keys()]).toEqual([a.id]);
    expect(m.get(a.id)?.texto).toBe('segunda');
  });
});
