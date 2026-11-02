import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../../db/schema';
import { chaveTelefone } from '../../common/telefone-chave';
import { LembreteDoCarrinhoProcessor, textoDoLembrete } from './lembrete-do-carrinho.processor';
import { WhatsappProvedorService } from '../whatsapp/whatsapp-provedor.service';
import { repetirNaCorridaDeCatalogo } from '../../common/corrida-de-catalogo';

/* eslint-disable @typescript-eslint/no-explicit-any */

// O LEMBRETE DO PEDIDO QUE FICOU PELA METADE NO ROBÔ (mig 349, Onda 0 de 01/11/2026): nasce desligado; ligado, o
// cliente que parou com itens no carrinho do robô há mais de 30 min (e menos de 3 h), com a loja aberta e a conversa sem
// atendente, recebe UMA mensagem. As tabelas são só da nuvem: o teste aplica as migrations (o banco do CI é o de uma loja).
const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('lembrete-do-carrinho-pg.spec: sem TEST_PG_URL — PULADO');
jest.setTimeout(90_000);

const MIG = (arq: string) => join(__dirname, '../../../../database/migrations', arq);
const CELULAR = '5521987654321';

descrever('lembrete do pedido parado no robô (Postgres)', () => {
  const pool = new Pool({ connectionString: URL_PG });
  const db = drizzle(pool, { schema }) as any;
  const q = async (s: string, p: any[] = []) => (await pool.query(s, p)).rows;
  const enviados: any[] = [];
  const evolution: any = { enviar: async (t: string, para: string, texto: string) => void enviados.push({ via: 'qr', t, para, texto }) };
  const cloud: any = { enviarTexto: async (t: string, para: string, texto: string) => void enviados.push({ via: 'oficial', t, para, texto }) };
  let aberta = true;
  const cardapio: any = { lojaAbertaAgora: () => aberta };
  const rotina = new LembreteDoCarrinhoProcessor(db, cardapio, evolution, cloud);
  const auditados: any[] = [];
  const ajustes = new WhatsappProvedorService(db, { registrar: async (a: any) => void auditados.push(a) } as any, {} as any, {} as any);
  const empresas: string[] = [];

  /** Uma migration numa transação só — de novo quando o DDL corre com o de outra spec no mesmo banco (ERR-194). */
  const aplicar = (arq: string) =>
    repetirNaCorridaDeCatalogo(async () => {
      const c = await pool.connect();
      try {
        await c.query('begin');
        await c.query(readFileSync(MIG(arq), 'utf8'));
        await c.query('commit');
      } catch (e) {
        await c.query('rollback').catch(() => {});
        throw e;
      } finally {
        c.release();
      }
    });

  beforeAll(async () => {
    delete process.env.EDGE_MODE; // como NUVEM
    await repetirNaCorridaDeCatalogo(() => pool.query(readFileSync(MIG('215_whatsapp_mensagem.sql'), 'utf8')));
    for (const m of ['342_robo_pausa_e_config.sql', '344_robo_carrinho.sql', '345_robo_carrinho_conducao.sql', '347_aviso_de_atraso.sql', '349_lembrete_do_carrinho.sql'])
      await aplicar(m);
  });
  beforeEach(() => {
    enviados.length = 0;
    aberta = true;
  });
  afterAll(async () => {
    if (empresas.length) {
      for (const t of ['robo_carrinho', 'robo_pausa', 'robo_config', 'atendimento_chamado', 'whatsapp_mensagem', 'cardapio_config'])
        await pool.query(`delete from ${t} where tenant_id = any($1::uuid[])`, [empresas]).catch(() => {});
      await pool.query('delete from empresa where id = any($1::uuid[])', [empresas]).catch(() => {});
    }
    await pool.end();
  });

  /** A loja com o robô ligado, o lembrete ligado (ou não) e o provedor. */
  async function loja(o: { provedor?: string; lembrete?: boolean; roboAtivo?: boolean } = {}) {
    const t = (await q(`insert into empresa (nome) values ('teste lembrete do carrinho') returning id`))[0].id as string;
    empresas.push(t);
    await q(`insert into cardapio_config (tenant_id, token, ativo, robo_ativo, provedor) values ($1,$2,true,$3,$4)`, [
      t,
      `tk-${randomUUID()}`,
      o.roboAtivo ?? true,
      o.provedor ?? 'evolution',
    ]);
    await q(`insert into robo_config (tenant_id, lembrete_carrinho) values ($1,$2)`, [t, o.lembrete ?? true]);
    return t;
  }
  /** O carrinho do robô parado há `min` minutos. */
  async function carrinho(t: string, o: { min?: number; itens?: number; status?: string } = {}) {
    const itens = Array.from({ length: o.itens ?? 2 }, (_, i) => ({ linha: i + 1, produtoId: randomUUID(), quantidade: 1 }));
    return (
      await q(
        `insert into robo_carrinho (tenant_id, telefone, telefone_chave, cliente_nome, itens, status, atualizado_em)
         values ($1,$2,$3,'Rodrigo Teste',$4::jsonb,$5, now() - make_interval(mins => $6)) returning id`,
        [t, CELULAR, chaveTelefone(CELULAR), JSON.stringify(itens), o.status ?? 'aberto', o.min ?? 40],
      )
    )[0].id as string;
  }
  const lembradoEm = async (id: string) => (await q(`select lembrado_em from robo_carrinho where id = $1`, [id]))[0].lembrado_em;
  const meus = (t: string) => enviados.filter((e) => e.t === t);

  it('o texto: o primeiro nome e a quantidade, sem pressão', () => {
    expect(textoDoLembrete('Rodrigo Teste', 2)).toBe('Oi, Rodrigo! Seu pedido ainda está aqui comigo 🛒 (2 itens). Quer que eu finalize? É só responder por aqui.');
    expect(textoDoLembrete(null, 1)).toBe('Oi! Seu pedido ainda está aqui comigo 🛒 (1 item). Quer que eu finalize? É só responder por aqui.');
  });

  it('carrinho parado há 40 min (QR): UMA mensagem pela via da loja; a volta seguinte não repete', async () => {
    const t = await loja();
    const id = await carrinho(t);
    await rotina.lembrar();
    expect(meus(t)).toEqual([{ via: 'qr', t, para: CELULAR, texto: textoDoLembrete('Rodrigo Teste', 2) }]);
    expect(await lembradoEm(id)).not.toBeNull();
    enviados.length = 0;
    await rotina.lembrar();
    expect(meus(t)).toEqual([]);
  });

  it('não lembra: lembrete desligado, robô desligado, sem itens, parado há pouco ou há muito, pedido já registrado, loja fechada, conversa com atendente', async () => {
    const desligado = await loja({ lembrete: false });
    await carrinho(desligado);
    const semRobo = await loja({ roboAtivo: false });
    await carrinho(semRobo);
    const vazio = await loja();
    await carrinho(vazio, { itens: 0 });
    const recente = await loja();
    await carrinho(recente, { min: 10 });
    const antigo = await loja();
    await carrinho(antigo, { min: 4 * 60 });
    const registrado = await loja();
    await carrinho(registrado, { status: 'registrado' });
    const comAtendente = await loja();
    await carrinho(comAtendente);
    await q(`insert into atendimento_chamado (tenant_id, tipo, telefone, status) values ($1,'humano',$2,'aberto')`, [comAtendente, CELULAR]);
    await rotina.lembrar();
    for (const t of [desligado, semRobo, vazio, recente, antigo, registrado, comAtendente]) expect(meus(t)).toEqual([]);

    // Loja fechada: não lembra e NÃO marca — quando abrir (ainda dentro das 3 h), lembra.
    const fechada = await loja();
    const id = await carrinho(fechada);
    aberta = false;
    await rotina.lembrar();
    expect(meus(fechada)).toEqual([]);
    expect(await lembradoEm(id)).toBeNull();
    aberta = true;
    await rotina.lembrar();
    expect(meus(fechada)).toHaveLength(1);
  });

  it('API oficial: só com a conversa parada há 30 min e dentro da janela de 24 h', async () => {
    const conversa = (t: string, direcao: string, min: number) =>
      q(`insert into whatsapp_mensagem (tenant_id, telefone, direcao, texto, criado_em) values ($1,$2,$3,'oi', now() - make_interval(mins => $4))`, [t, CELULAR, direcao, min]);
    const ok = await loja({ provedor: 'cloud' });
    await carrinho(ok);
    await conversa(ok, 'entrada', 45);
    const falando = await loja({ provedor: 'cloud' });
    await carrinho(falando);
    await conversa(falando, 'entrada', 45);
    await conversa(falando, 'saida', 5); // o robô respondeu há 5 min: a conversa está andando
    const foraDaJanela = await loja({ provedor: 'cloud' });
    await carrinho(foraDaJanela);
    await conversa(foraDaJanela, 'entrada', 25 * 60);
    await rotina.lembrar();
    expect(meus(ok)).toEqual([{ via: 'oficial', t: ok, para: CELULAR, texto: textoDoLembrete('Rodrigo Teste', 2) }]);
    expect(meus(falando)).toEqual([]);
    expect(meus(foraDaJanela)).toEqual([]);
  });

  it('o ajuste: nasce desligado; liga e desliga só com sim ou não; cada mudança na auditoria', async () => {
    const t = (await q(`insert into empresa (nome) values ('teste ajuste do lembrete') returning id`))[0].id as string;
    empresas.push(t);
    const ator: any = { tenantId: t, colaboradorId: randomUUID(), categoria: 'gerente' };
    expect(await ajustes.roboConfig(t)).toMatchObject({ lembreteCarrinho: false, avisoAtraso: false });
    expect(await ajustes.salvarRoboConfig(ator, { lembreteCarrinho: true })).toMatchObject({ lembreteCarrinho: true, avisoAtraso: false, pausaMinutos: 60 });
    expect(await ajustes.salvarRoboConfig(ator, { avisoAtraso: true })).toMatchObject({ lembreteCarrinho: true, avisoAtraso: true });
    await expect(ajustes.salvarRoboConfig(ator, { lembreteCarrinho: 'talvez' })).rejects.toThrow('lembreteCarrinho');
    expect(await ajustes.salvarRoboConfig(ator, { lembreteCarrinho: 'false' })).toMatchObject({ lembreteCarrinho: false });
    expect(auditados.filter((a) => a.tenantId === t).map((a) => a.acao)).toEqual([
      'lembrete_carrinho_ligado',
      'aviso_atraso_ligado',
      'lembrete_carrinho_desligado',
    ]);
  });
});
