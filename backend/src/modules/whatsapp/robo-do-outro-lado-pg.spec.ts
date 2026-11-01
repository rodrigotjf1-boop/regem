import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../../db/schema';
import { MARCA_DO_CHAMADO, caladoPorRobo, conversaRecenteOficial, portaoDoRoboDoOutroLado } from './robo-do-outro-lado';
import { repetirNaCorridaDeCatalogo } from '../../common/corrida-de-catalogo';

/* eslint-disable @typescript-eslint/no-explicit-any */

// O PORTÃO DO ROBÔ DO OUTRO LADO contra o Postgres real (Bloco 4 do plano de 31/10/2026): a conversa gravada da API
// oficial (`whatsapp_mensagem`, mig 215 — só nuvem: o teste aplica o arquivo), o chamado que abre (ou o aberto do mesmo
// número que recebe a mensagem), a marca que segura o robô calado e o "resolver" que devolve a conversa ao robô.
const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('robo-do-outro-lado-pg.spec: sem TEST_PG_URL — PULADO');
jest.setTimeout(60_000);

const MIG_215 = join(__dirname, '../../../../database/migrations/215_whatsapp_mensagem.sql');
const MENU = 'Olá! Escolha uma opção:\n1 - Pedidos\n2 - Financeiro\n3 - Falar com um atendente';

descrever('robô do outro lado (Postgres)', () => {
  const pool = new Pool({ connectionString: URL_PG });
  const db = drizzle(pool, { schema }) as any;
  const q = async (s: string, p: any[] = []) => (await pool.query(s, p)).rows;
  const T = randomUUID();
  const CEL = '5521987651234'; // celular: o nono dígito vale (ERR-134)
  const eventos: any[] = [];
  const emitir = (ev: string, p: any) => eventos.push({ ev, p });

  /** Uma mensagem gravada `s` segundos atrás (pela hora do banco, como o webhook grava). */
  const gravar = (direcao: 'entrada' | 'saida', texto: string, s: number, tel = CEL) =>
    q(`insert into whatsapp_mensagem (tenant_id, telefone, direcao, tipo, texto, criado_em) values ($1,$2,$3,'text',$4, now() - make_interval(secs => $5))`, [
      T,
      tel,
      direcao,
      texto,
      s,
    ]);
  const portao = async (tel = CEL) =>
    portaoDoRoboDoOutroLado(db, emitir, { tenantId: T, unidadeId: null, telefone: tel, nome: 'Fornecedor X', conversa: await conversaRecenteOficial(db, T, tel) });

  beforeAll(async () => {
    // De novo quando o DDL corre com o de outra spec no mesmo banco (ERR-194).
    await repetirNaCorridaDeCatalogo(() => pool.query(readFileSync(MIG_215, 'utf8')));
    await repetirNaCorridaDeCatalogo(() => pool.query(readFileSync(MIG_215, 'utf8'))); // idempotente
    await q(`insert into empresa (id, nome) values ($1, 'teste robô do outro lado')`, [T]);
  });
  beforeEach(async () => {
    eventos.length = 0;
    await q(`delete from atendimento_chamado where tenant_id = $1`, [T]);
    await q(`delete from whatsapp_mensagem where tenant_id = $1`, [T]);
  });
  afterAll(async () => {
    await q(`delete from atendimento_chamado where tenant_id = $1`, [T]).catch(() => {});
    await q(`delete from whatsapp_mensagem where tenant_id = $1`, [T]).catch(() => {});
    await q(`delete from empresa where id = $1`, [T]).catch(() => {});
    await pool.end();
  });

  it('a conversa de uma pessoa passa: o robô responde e nada é aberto', async () => {
    await gravar('entrada', 'oi, quero pedir um x-bacon', 120);
    await gravar('saida', 'Claro! Quer no trio?', 115);
    await gravar('entrada', 'não entendi sua mensagem', 60);
    const r = await portao();
    expect(r).toMatchObject({ calar: false, abriuChamado: false });
    expect(await q(`select count(*)::int as n from atendimento_chamado where tenant_id = $1`, [T])).toEqual([{ n: 0 }]);
  });

  it('o menu automático que volta: cala, abre UM chamado com a marca, e as próximas mensagens seguem caladas até resolver', async () => {
    await gravar('entrada', MENU, 90);
    await gravar('saida', 'Oi! Sou o atendimento da loja, como posso ajudar?', 88);
    await gravar('entrada', MENU, 2);
    const r = await portao();
    expect(r).toMatchObject({ calar: true, abriuChamado: true, avaliacao: { robo: true, sinais: ['texto_automatico', 'repeticao'] } });
    const chamados = await q(`select tipo, prioridade, status, telefone, cliente, mensagem from atendimento_chamado where tenant_id = $1`, [T]);
    expect(chamados).toHaveLength(1);
    expect(chamados[0]).toMatchObject({ tipo: 'outro', prioridade: 'normal', status: 'aberto', telefone: CEL, cliente: 'Fornecedor X' });
    expect(chamados[0].mensagem.startsWith(MARCA_DO_CHAMADO)).toBe(true);
    expect(eventos.map((e) => e.ev)).toEqual(['atendimento.novo']);

    // A próxima mensagem dele (mesmo sem sinal novo): calada pela marca, sem abrir outro chamado.
    await gravar('entrada', 'ok', 1);
    expect(await portao()).toMatchObject({ calar: true, abriuChamado: false });
    // O mesmo número sem o nono dígito também (a chave do telefone).
    expect(await caladoPorRobo(db, T, '552187651234')).toBe(true);
    expect(await q(`select count(*)::int as n from atendimento_chamado where tenant_id = $1`, [T])).toEqual([{ n: 1 }]);

    // Resolver o chamado devolve a conversa ao robô (a conversa nova, de uma pessoa, passa).
    await q(`update atendimento_chamado set status = 'resolvido', resolvido_em = now() where tenant_id = $1`, [T]);
    await q(`delete from whatsapp_mensagem where tenant_id = $1`, [T]);
    await gravar('entrada', 'oi, era eu mesmo, quero fazer um pedido', 1);
    expect(await portao()).toMatchObject({ calar: false });
  });

  it('com um chamado aberto do mesmo número, a mensagem vai junto nele (não abre outro) e a marca vale', async () => {
    await q(`insert into atendimento_chamado (tenant_id, tipo, telefone, mensagem, status) values ($1,'humano','21987651234','quer falar com alguém','aberto')`, [T]);
    await gravar('saida', 'Oi!', 10);
    await gravar('entrada', 'Olá! Esta é uma mensagem automática. Em breve retornaremos o seu contato.', 9);
    await gravar('saida', 'Como posso ajudar?', 5);
    await gravar('entrada', 'Olá! Esta é uma mensagem automática. Em breve retornaremos o seu contato.', 4);
    expect(await portao()).toMatchObject({ calar: true, abriuChamado: true });
    const chamados = await q(`select tipo, mensagem from atendimento_chamado where tenant_id = $1`, [T]);
    expect(chamados).toHaveLength(1);
    expect(chamados[0].tipo).toBe('humano');
    expect(chamados[0].mensagem).toContain('quer falar com alguém');
    expect(chamados[0].mensagem).toContain(MARCA_DO_CHAMADO);
    expect(await caladoPorRobo(db, T, CEL)).toBe(true);
  });
});
