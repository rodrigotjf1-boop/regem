import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../../db/schema';
import { comTravaDaEmpresa } from '../../common/corrida-de-catalogo';
import { MENSAGEM_DA_PAUSA_PADRAO, montarMensagemDaPausa } from '../../common/pausa-do-canal';
import { PausaDoCanalService } from '../delivery/pausa-do-canal.service';
import { PausaNoAtendimentoService } from './pausa-no-atendimento.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

// A PAUSA NO ATENDIMENTO contra o Postgres real (F3, migs 394 e 395): com o cardápio digital pausado, a 1ª mensagem do
// cliente ao atendente recebe a mensagem pronta pelo Regem (pela porta das respostas do robô) e não vai ao robô; uma vez por
// cliente em cada pausa; Direct e Messenger sem o negrito; a mensagem da loja vence a padrão; estender não avisa de novo,
// pausar de novo avisa; envio segurado = vai ao robô; duas mensagens juntas = um aviso. A 395 é só da nuvem: o teste a
// aplica (duas vezes: idempotente) no banco do CI, que é o de uma loja.
const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('pausa-no-atendimento-pg.spec: sem TEST_PG_URL — PULADO');
jest.setTimeout(120_000);

const MIGRATION = join(__dirname, '../../../../database/migrations', '395_pausa_aviso_ao_cliente.sql');

descrever('pausa no atendimento (Postgres)', () => {
  const pool = new Pool({ connectionString: URL_PG });
  const db = drizzle(pool, { schema }) as any;
  const q = async (s: string, p: any[] = []) => (await pool.query(s, p)).rows;
  const auditoria = { registrar: async () => undefined } as any;
  const pausas = new PausaDoCanalService(db, auditoria);
  const enviados: any[] = [];
  let segurar = false;
  const resposta = {
    responderDoRegem: jest.fn(async (p: any) => {
      if (segurar) return { ok: true, enviado: false, motivo: 'conversa_pausada' };
      enviados.push(p);
      return { ok: true, enviado: true, enviados: ['texto'] };
    }),
  } as any;
  const porteiro = new PausaNoAtendimentoService(db, resposta);
  const empresas: string[] = [];

  async function aplicar() {
    const c = await pool.connect();
    try {
      await c.query('begin');
      await c.query(comTravaDaEmpresa(readFileSync(MIGRATION, 'utf8')));
      await c.query('commit');
    } catch (e) {
      await c.query('rollback').catch(() => {});
      throw e;
    } finally {
      c.release();
    }
  }

  async function loja(modelo: string | null = null) {
    const t = (await q(`insert into empresa (nome) values ('teste pausa no atendimento') returning id`))[0].id as string;
    empresas.push(t);
    const token = `tk-${randomUUID()}`;
    await q(
      `insert into cardapio_config (tenant_id, unidade_id, token, ativo, aberto, modo, pausa_mensagem) values ($1, null, $2, true, true, 'mesa', $3)`,
      [t, token, modelo],
    );
    const gestor: any = { tenantId: t, colaboradorId: randomUUID(), categoria: 'gerente', nome: 'Rodrigo' };
    const msg = (de: string, extra: any = {}) => ({
      // Texto neutro por padrão (F4: "quero pedir" depois da mensagem pronta já pede o áudio — os casos da F4 dizem o texto).
      provedor: 'cloud', tenantId: t, cardapioToken: token, phoneNumberId: '123456789', de, nome: 'ANA PAULA', tipo: 'text', texto: 'boa noite', ...extra,
    });
    return { t, token, gestor, msg };
  }

  beforeAll(async () => {
    await aplicar();
    await aplicar(); // idempotente
  });
  beforeEach(() => {
    enviados.length = 0;
    segurar = false;
    resposta.responderDoRegem.mockClear();
  });
  afterAll(async () => {
    if (empresas.length) {
      for (const t of ['pausa_aviso_cliente', 'pausa_canal', 'cardapio_config'])
        await pool.query(`delete from ${t} where tenant_id = any($1::uuid[])`, [empresas]).catch(() => {});
      await pool.query('delete from empresa where id = any($1::uuid[])', [empresas]).catch(() => {});
    }
    await pool.end();
  });

  it('sem pausa, a mensagem vai ao robô', async () => {
    const { msg } = await loja();
    expect(await porteiro.decidir(msg('5521999990001'))).toBe('segue');
    expect(resposta.responderDoRegem).not.toHaveBeenCalled();
  });

  it('com a pausa: a 1ª mensagem do cliente recebe a mensagem pronta (formatada, com o nome) e não vai ao robô; a 2ª vai', async () => {
    const { t, gestor, msg } = await loja();
    const estado = await pausas.pausar(gestor, null, { canais: ['cardapio'], motivo: 'pedidos', tempo: { minutos: 30 } });
    const p = estado.canais[0].pausa!;
    expect(await porteiro.decidir(msg('5521999990002'))).toBe('respondido');
    expect(enviados).toEqual([
      {
        instancia: undefined,
        phoneNumberId: '123456789',
        para: '5521999990002',
        texto: montarMensagemDaPausa(MENSAGEM_DA_PAUSA_PADRAO, { nome: 'Ana', frase: p.frase, volta: p.volta }),
      },
    ]);
    expect(enviados[0].texto).toContain('Oi, Ana! Estamos com *muitos pedidos agora* e pausamos');
    const [l] = await q(`select mensagens, avisado_em from pausa_aviso_cliente where tenant_id = $1`, [t]);
    expect(l.mensagens).toBe(1);
    expect(l.avisado_em).not.toBeNull();
    expect(await porteiro.decidir(msg('5521999990002'))).toBe('segue');
    expect(enviados).toHaveLength(1);
    // Outro cliente na mesma pausa: avisado também.
    expect(await porteiro.decidir(msg('5521999990003', { nome: null }))).toBe('respondido');
    expect(enviados[1].texto).toContain('Oi! Estamos com *muitos pedidos agora*');
  });

  it('Direct e Messenger: a mensagem vai sem o negrito, pela chave da conversa', async () => {
    const { gestor, msg } = await loja();
    await pausas.pausar(gestor, null, { canais: ['cardapio'], motivo: 'cozinha', tempo: { minutos: 15 } });
    expect(await porteiro.decidir(msg('ig:777', { provedor: 'instagram', phoneNumberId: null, instancia: 'ig:111' }))).toBe('respondido');
    expect(await porteiro.decidir(msg('fb:888', { provedor: 'messenger', phoneNumberId: null, instancia: 'fb:222' }))).toBe('respondido');
    expect(enviados.map((e) => [e.instancia, e.para])).toEqual([['ig:111', 'ig:777'], ['fb:222', 'fb:888']]);
    for (const e of enviados) {
      expect(e.texto).not.toContain('*');
      expect(e.texto).toContain('Estamos com um problema na cozinha');
    }
  });

  it('a conversa de teste, o chat do iFood/99 e o comentário ficam de fora', async () => {
    const { gestor, msg } = await loja();
    await pausas.pausar(gestor, null, { canais: ['cardapio'], motivo: 'pedidos', tempo: { minutos: 15 } });
    expect(await porteiro.decidir(msg('teste:abc'))).toBe('segue');
    expect(await porteiro.decidir(msg('chat:abc'))).toBe('segue');
    expect(await porteiro.decidir(msg('5521999990004', { instancia: 'cm:999' }))).toBe('segue');
    expect(resposta.responderDoRegem).not.toHaveBeenCalled();
  });

  it('a mensagem que a loja escreveu vence a padrão', async () => {
    const { gestor, msg } = await loja('Oi, {nome}! {motivo}. Voltamos {volta}. 🙏');
    await pausas.pausar(gestor, null, { canais: ['cardapio'], motivo: 'energia', tempo: { minutos: 15 } });
    expect(await porteiro.decidir(msg('5521999990005'))).toBe('respondido');
    // perto da meia-noite a volta é "amanhã às" (ERR-434)
    expect(enviados[0].texto).toMatch(/^Oi, Ana! Estamos \*sem energia ou internet\*\. Voltamos (amanhã )?às \*\d\d:\d\d\*\. 🙏$/);
  });

  it('estender é a mesma pausa (não avisa de novo); pausar de novo é outra (avisa)', async () => {
    const { gestor, msg } = await loja();
    await pausas.pausar(gestor, null, { canais: ['cardapio'], motivo: 'pedidos', tempo: { minutos: 15 } });
    expect(await porteiro.decidir(msg('5521999990006'))).toBe('respondido');
    await pausas.estender(gestor, null, 'cardapio', 10);
    expect(await porteiro.decidir(msg('5521999990006'))).toBe('segue');
    await new Promise((r) => setTimeout(r, 15));
    await pausas.pausar(gestor, null, { canais: ['cardapio'], motivo: 'entregador', tempo: { minutos: 30 } });
    expect(await porteiro.decidir(msg('5521999990006'))).toBe('respondido');
    expect(enviados[1].texto).toContain('Estamos *sem entregador no momento*');
  });

  it('a resposta segurada (conversa com uma pessoa) vai ao robô; tenant errado no token também', async () => {
    const { gestor, msg } = await loja();
    await pausas.pausar(gestor, null, { canais: ['cardapio'], motivo: 'pedidos', tempo: { minutos: 15 } });
    segurar = true;
    expect(await porteiro.decidir(msg('5521999990007'))).toBe('segue');
    segurar = false;
    const outra = await loja();
    expect(await porteiro.decidir({ ...outra.msg('5521999990008'), tenantId: (await loja()).t })).toBe('segue');
  });

  it('duas mensagens juntas do mesmo cliente: UM aviso', async () => {
    const { gestor, msg } = await loja();
    await pausas.pausar(gestor, null, { canais: ['cardapio'], motivo: 'pedidos', tempo: { minutos: 15 } });
    const r = await Promise.all([porteiro.decidir(msg('5521999990009')), porteiro.decidir(msg('5521999990009'))]);
    expect(r.sort()).toEqual(['respondido', 'segue']);
    expect(enviados).toHaveLength(1);
  });

  // ── F4 (mig 396): o áudio quando o cliente insiste ──────────────────────────────────────────────────────────────
  it('F4: quem já recebeu a mensagem e insiste vai ao robô pedindo ÁUDIO — uma vez; quem só concorda, texto', async () => {
    const { t, gestor, msg } = await loja();
    await pausas.pausar(gestor, null, { canais: ['cardapio'], motivo: 'pedidos', tempo: { minutos: 15 } });
    expect(await porteiro.decidir(msg('5521999990010'))).toBe('respondido');
    expect(await porteiro.decidir(msg('5521999990010', { texto: 'Ah ok, às 21:40 eu peço então' }))).toBe('segue');
    expect(await porteiro.decidir(msg('5521999990010', { texto: 'Mas não dá pra fazer agora? Pago no Pix' }))).toBe('falar');
    expect(await porteiro.decidir(msg('5521999990010', { texto: 'não entendi' }))).toBe('segue'); // um áudio por pausa
    const [l] = await q(`select mensagens, falado_em from pausa_aviso_cliente where tenant_id = $1`, [t]);
    expect(l.mensagens).toBe(4);
    expect(l.falado_em).not.toBeNull();
  });

  it('F4: no Direct e no Messenger, com o áudio desligado na loja, ou sem a mensagem pronta ter saído: texto', async () => {
    const a = await loja();
    await pausas.pausar(a.gestor, null, { canais: ['cardapio'], motivo: 'pedidos', tempo: { minutos: 15 } });
    expect(await porteiro.decidir(a.msg('ig:901', { provedor: 'instagram', phoneNumberId: null, instancia: 'ig:1' }))).toBe('respondido');
    expect(await porteiro.decidir(a.msg('ig:901', { provedor: 'instagram', phoneNumberId: null, instancia: 'ig:1', texto: 'mas não dá agora?' }))).toBe('segue');

    const b = await loja();
    await q(`update cardapio_config set pausa_audio = false where tenant_id = $1`, [b.t]);
    await pausas.pausar(b.gestor, null, { canais: ['cardapio'], motivo: 'pedidos', tempo: { minutos: 15 } });
    expect(await porteiro.decidir(b.msg('5521999990011'))).toBe('respondido');
    expect(await porteiro.decidir(b.msg('5521999990011', { texto: 'mas não dá agora?' }))).toBe('segue');

    const c = await loja();
    await pausas.pausar(c.gestor, null, { canais: ['cardapio'], motivo: 'pedidos', tempo: { minutos: 15 } });
    segurar = true; // a 1ª foi segurada (conversa com uma pessoa): não houve mensagem pronta, não há "insistiu"
    expect(await porteiro.decidir(c.msg('5521999990012'))).toBe('segue');
    segurar = false;
    expect(await porteiro.decidir(c.msg('5521999990012', { texto: 'mas não dá agora?' }))).toBe('segue');
  });

  it('F4: duas mensagens insistindo juntas: UM áudio', async () => {
    const { gestor, msg } = await loja();
    await pausas.pausar(gestor, null, { canais: ['cardapio'], motivo: 'pedidos', tempo: { minutos: 15 } });
    expect(await porteiro.decidir(msg('5521999990013'))).toBe('respondido');
    const r = await Promise.all([
      porteiro.decidir(msg('5521999990013', { texto: 'quero agora' })),
      porteiro.decidir(msg('5521999990013', { texto: 'mas não dá mesmo assim?' })),
    ]);
    expect(r.sort()).toEqual(['falar', 'segue']);
  });
});
