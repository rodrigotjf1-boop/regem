import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../../db/schema';
import { DeliveryService } from './delivery.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

// O CÓDIGO DE ENTREGA NA LOJA COM A API OFICIAL sai pelo PRÓPRIO Regem (decisão do dono, 31/10/2026 — ERR-332): pelo n8n
// ele saía pela Evolution, o eco voltava pela coexistência e pausava o robô logo depois do pedido. Dentro da janela de
// 24 h vai pelo número oficial, para o número em que o cliente conversa (com o 55), com o MESMO nº do pedido do resumo;
// fora dela não sai por WhatsApp (o cliente vê o código no acompanhamento). A tabela das conversas é só da nuvem: o
// teste aplica a 215 (o banco do CI é o de uma loja).
const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('codigo-entrega-oficial-pg.spec: sem TEST_PG_URL — PULADO');
jest.setTimeout(60_000);

const MIG_215 = join(__dirname, '../../../../database/migrations/215_whatsapp_mensagem.sql');

descrever('código de entrega pela API oficial (Postgres)', () => {
  const pool = new Pool({ connectionString: URL_PG });
  const db = drizzle(pool, { schema }) as any;
  const q = async (s: string, p: any[] = []) => (await pool.query(s, p)).rows;
  const enviados: { para: string; texto: string }[] = [];
  const oficial = { enviarTexto: async (_t: string, para: string, texto: string) => void enviados.push({ para, texto }) } as any;
  // Os opcionais do construtor na ordem: openDelivery, cardapioWeb, ifood, food99, anotaai, gogemAviso, auditoria, oficial.
  const svc: any = new (DeliveryService as any)(db, {}, {}, {}, {}, { emit: () => true }, { flashPedidos: () => undefined },
    undefined, undefined, undefined, undefined, undefined, undefined, undefined, oficial);
  const empresas: string[] = [];
  const antes = process.env.OTP_WEBHOOK_URL;

  beforeAll(async () => {
    delete process.env.OTP_WEBHOOK_URL;
    await pool.query(readFileSync(MIG_215, 'utf8'));
    await pool.query(readFileSync(MIG_215, 'utf8')); // idempotente
  });
  beforeEach(() => {
    enviados.length = 0;
  });
  afterAll(async () => {
    if (antes !== undefined) process.env.OTP_WEBHOOK_URL = antes;
    if (empresas.length) {
      for (const t of ['whatsapp_mensagem', 'pedido_envio', 'cardapio_config'])
        await pool.query(`delete from ${t} where tenant_id = any($1::uuid[])`, [empresas]).catch(() => {});
      await pool.query('delete from empresa where id = any($1::uuid[])', [empresas]).catch(() => {});
    }
    await pool.end();
  });

  async function loja(provedor: 'cloud' | 'evolution') {
    const t = (await q(`insert into empresa (nome) values ('teste código de entrega') returning id`))[0].id as string;
    empresas.push(t);
    // O número oficial é único entre as lojas (índice único): um por loja de teste.
    await q(`insert into cardapio_config (tenant_id, token, ativo, provedor, wa_cloud_phone_id) values ($1,$2,true,$3,$4)`, [
      t,
      `tk-${randomUUID()}`,
      provedor,
      `ph-${randomUUID().slice(0, 12)}`,
    ]);
    return t;
  }
  // O pedido guarda o telefone SEM o 55; a conversa da API oficial, COM (a conferência da janela casa os dois).
  const pedido = { id: randomUUID(), canal: 'cardapio', tipo: 'entrega', codigoEntrega: '5114', clienteTelefone: '21987654321', displayId: '65', numero: 26 };
  const aviso = () => (DeliveryService as any).avisoDoCodigo(pedido);

  it('janela aberta: sai pelo número oficial, para o número da conversa, com o nº do resumo', async () => {
    const t = await loja('cloud');
    await q(`insert into whatsapp_mensagem (tenant_id, telefone, direcao, texto) values ($1,'5521987654321','entrada','Pode registrar')`, [t]);
    expect(await svc.enviarCodigoDeEntrega(t, pedido, aviso())).toEqual({ saiu: true });
    expect(enviados).toEqual([{ para: '5521987654321', texto: '🔑 Guarde o código de entrega do seu pedido nº 65: *5114*\nInforme este código ao entregador quando ele chegar.' }]);
  });

  it('fora da janela de 24 h: não sai por WhatsApp (e diz o motivo)', async () => {
    const t = await loja('cloud');
    await q(`insert into whatsapp_mensagem (tenant_id, telefone, direcao, texto, criado_em) values ($1,'5521987654321','entrada','oi', now() - interval '25 hours')`, [t]);
    const r = await svc.enviarCodigoDeEntrega(t, pedido, aviso());
    expect(r).toMatchObject({ saiu: false });
    expect(r.motivo).toMatch(/fora da janela de 24 h/);
    expect(enviados).toEqual([]);
  });

  it('loja na Evolution: o código segue pelo n8n, como sempre (o Regem não manda pela oficial)', async () => {
    const t = await loja('evolution');
    await q(`insert into whatsapp_mensagem (tenant_id, telefone, direcao, texto) values ($1,'5521987654321','entrada','oi')`, [t]);
    const r = await svc.enviarCodigoDeEntrega(t, pedido, aviso());
    expect(r.saiu).toBe(false); // sem endereço do n8n neste banco
    expect(enviados).toEqual([]);
  });
});
