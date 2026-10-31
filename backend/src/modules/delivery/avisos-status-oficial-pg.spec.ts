import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../../db/schema';
import { DeliveryService } from './delivery.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

// OS AVISOS DE STATUS NA LOJA COM A API OFICIAL (ERR-337, 31/10/2026): a conferência "o cliente já conversou?" comparava
// o telefone do pedido (sem o 55) com o da conversa (com o 55) por igualdade — nunca casava, e NENHUM aviso (confirmado,
// saiu, cancelado…) saía por WhatsApp. Agora o próprio Regem manda pelo número oficial, achando a conversa pela CHAVE do
// telefone: na janela de 24 h, o texto; fora dela, o modelo aprovado; sem modelo ou sem conversa, só no cardápio. A
// tabela das conversas é só da nuvem: o teste aplica a 215 (o banco do CI é o de uma loja).
const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('avisos-status-oficial-pg.spec: sem TEST_PG_URL — PULADO');
jest.setTimeout(60_000);

const MIG = (arq: string) => join(__dirname, '../../../../database/migrations', arq);
const MIG_215 = MIG('215_whatsapp_mensagem.sql');
// Os modelos (227 + 236) também são só da nuvem. A 227 mexe ainda na `campanha`, que o banco de loja não tem: daqui só
// os comandos da `whatsapp_template`.
const daTabelaDeModelos = (arq: string) =>
  readFileSync(MIG(arq), 'utf8')
    .split(';')
    .map((s) => s.trim())
    .filter((s) => /whatsapp_template/.test(s) && !/alter table campanha/i.test(s));

descrever('avisos de status pela API oficial (Postgres)', () => {
  const pool = new Pool({ connectionString: URL_PG });
  const db = drizzle(pool, { schema }) as any;
  const q = async (s: string, p: any[] = []) => (await pool.query(s, p)).rows;
  const saidas: any[] = [];
  const oficial = {
    enviarTexto: async (_t: string, para: string, texto: string) => void saidas.push({ como: 'texto', para, texto }),
    enviarLink: async (_t: string, para: string, corpo: string, url: string, rotulo: string) => void saidas.push({ como: 'link', para, corpo, url, rotulo }),
    enviarTemplate: async (_t: string, para: string, nome: string, idioma: string, params: string[], opts: any) =>
      void saidas.push({ como: 'modelo', para, nome, idioma, params, rastreio: opts?.rastreio ?? null }),
  } as any;
  // Os opcionais do construtor na ordem: openDelivery, cardapioWeb, ifood, food99, anotaai, gogemAviso, auditoria, oficial.
  const svc: any = new (DeliveryService as any)(db, {}, {}, {}, {}, { emit: () => true }, { flashPedidos: () => undefined },
    undefined, undefined, undefined, undefined, undefined, undefined, undefined, oficial);
  const empresas: string[] = [];
  const antes = { cardapio: process.env.CARDAPIO_PUBLIC_URL, otp: process.env.OTP_WEBHOOK_URL };

  beforeAll(async () => {
    process.env.CARDAPIO_PUBLIC_URL = 'https://app.dmsregem.com';
    delete process.env.OTP_WEBHOOK_URL;
    await pool.query(readFileSync(MIG_215, 'utf8'));
    for (const s of [...daTabelaDeModelos('227_whatsapp_template.sql'), ...daTabelaDeModelos('236_whatsapp_template_evento.sql')]) await pool.query(s);
  });
  beforeEach(() => {
    saidas.length = 0;
  });
  afterAll(async () => {
    if (antes.cardapio !== undefined) process.env.CARDAPIO_PUBLIC_URL = antes.cardapio;
    else delete process.env.CARDAPIO_PUBLIC_URL;
    if (antes.otp !== undefined) process.env.OTP_WEBHOOK_URL = antes.otp;
    if (empresas.length) {
      for (const t of ['whatsapp_mensagem', 'whatsapp_template', 'pedido_envio', 'cardapio_config'])
        await pool.query(`delete from ${t} where tenant_id = any($1::uuid[])`, [empresas]).catch(() => {});
      await pool.query('delete from empresa where id = any($1::uuid[])', [empresas]).catch(() => {});
    }
    await pool.end();
  });

  async function loja(provedor: 'cloud' | 'evolution') {
    const t = (await q(`insert into empresa (nome) values ('teste avisos de status') returning id`))[0].id as string;
    empresas.push(t);
    await q(`insert into cardapio_config (tenant_id, token, ativo, provedor, wa_cloud_phone_id) values ($1,$2,true,$3,$4)`, [
      t,
      `tk-${randomUUID()}`,
      provedor,
      `ph-${randomUUID().slice(0, 12)}`,
    ]);
    return t;
  }
  const conversa = (t: string, horasAtras = 0) =>
    q(`insert into whatsapp_mensagem (tenant_id, telefone, direcao, texto, criado_em) values ($1,'5521987654321','entrada','oi', now() - make_interval(hours => $2))`, [
      t,
      horasAtras,
    ]);
  const modelo = (t: string, nome: string, evento: string) =>
    q(`insert into whatsapp_template (tenant_id, nome, evento, status, categoria, corpo) values ($1,$2,$3,'aprovado','UTILITY','Oi {{1}}!')`, [t, nome, evento]);
  // O pedido guarda o telefone SEM o 55; a conversa da API oficial, COM.
  const pedido = (status: string, extra: Record<string, unknown> = {}) => ({
    id: randomUUID(),
    canal: 'cardapio',
    tipo: 'entrega',
    status,
    clienteNome: 'Rodrigo Teste',
    clienteTelefone: '21987654321',
    displayId: '66',
    numero: 27,
    total: 30,
    ...extra,
  });

  it('o caso do teste: cancelado, cliente conversou há pouco → o texto sai pelo número oficial, sem quem autorizou', async () => {
    const t = await loja('cloud');
    await conversa(t);
    await svc.enviarAvisoStatus(t, pedido('cancelado', { motivoCancelamento: 'Cancelamento solicitado pelo cliente (autorizado por Fulano Gerente)' }));
    expect(saidas).toEqual([
      { como: 'texto', para: '5521987654321', texto: '*Pedido cancelado*\nSeu pedido #66 foi cancelado. Motivo: Cancelamento solicitado pelo cliente.' },
    ]);
  });

  it('saiu para entrega, na janela: vai com o botão "Acompanhar entrega" (o rastreio do pedido)', async () => {
    const t = await loja('cloud');
    await conversa(t, 2);
    await svc.enviarAvisoStatus(t, pedido('despachado', { rastreioToken: 'rt-123' }));
    expect(saidas).toEqual([
      expect.objectContaining({ como: 'link', para: '5521987654321', url: 'https://app.dmsregem.com/r/rt-123', rotulo: 'Acompanhar entrega' }),
    ]);
  });

  it('fora da janela de 24 h: o modelo aprovado do evento, com o primeiro nome; sem modelo, não sai por WhatsApp', async () => {
    const t = await loja('cloud');
    await conversa(t, 30);
    await modelo(t, 'pedido_saiu_entrega', 'saiu_entrega');
    await svc.enviarAvisoStatus(t, pedido('despachado', { rastreioToken: 'rt-9' }));
    expect(saidas).toEqual([{ como: 'modelo', para: '5521987654321', nome: 'pedido_saiu_entrega', idioma: 'pt_BR', params: ['Rodrigo'], rastreio: 'rt-9' }]);
    saidas.length = 0;
    await svc.enviarAvisoStatus(t, pedido('confirmado')); // sem modelo aprovado de "confirmado"
    expect(saidas).toEqual([]);
  });

  it('cliente que nunca escreveu, ou status sem aviso: nada pelo WhatsApp', async () => {
    const t = await loja('cloud');
    await svc.enviarAvisoStatus(t, pedido('confirmado'));
    expect(saidas).toEqual([]);
    await conversa(t);
    await svc.enviarAvisoStatus(t, pedido('novo'));
    expect(saidas).toEqual([]);
  });

  it('loja na Evolution: segue pelo n8n, como sempre (o Regem não manda pela oficial)', async () => {
    const t = await loja('evolution');
    await conversa(t);
    await svc.enviarAvisoStatus(t, pedido('cancelado'));
    expect(saidas).toEqual([]);
  });
});
