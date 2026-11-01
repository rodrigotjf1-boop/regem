import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../../db/schema';
import { DeliveryService } from './delivery.service';
import { repetirNaCorridaDeCatalogo } from '../../common/corrida-de-catalogo';

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
  // O WhatsApp por QR (Evolution) da loja: o "sem contato" sai por ele quando a loja não é da oficial (Bloco 3).
  const qr = { enviar: async (_t: string, numero: string, texto: string) => void saidas.push({ como: 'qr', para: numero, texto }) } as any;
  // Os opcionais do construtor na ordem: openDelivery, cardapioWeb, ifood, food99, anotaai, gogemAviso, auditoria, oficial, qr.
  const svc: any = new (DeliveryService as any)(db, {}, {}, {}, {}, { emit: () => true }, { flashPedidos: () => undefined },
    undefined, undefined, undefined, undefined, undefined, undefined, undefined, oficial, qr);
  const empresas: string[] = [];
  const antes = { cardapio: process.env.CARDAPIO_PUBLIC_URL, otp: process.env.OTP_WEBHOOK_URL };

  beforeAll(async () => {
    process.env.CARDAPIO_PUBLIC_URL = 'https://app.dmsregem.com';
    delete process.env.OTP_WEBHOOK_URL;
    // De novo quando o DDL corre com o de outra spec no mesmo banco (ERR-194).
    await repetirNaCorridaDeCatalogo(() => pool.query(readFileSync(MIG_215, 'utf8')));
    for (const s of [...daTabelaDeModelos('227_whatsapp_template.sql'), ...daTabelaDeModelos('236_whatsapp_template_evento.sql')])
      await repetirNaCorridaDeCatalogo(() => pool.query(s));
    // Só da nuvem: o "compartilhar meu contato" do entregador.
    await repetirNaCorridaDeCatalogo(() => pool.query(readFileSync(MIG('208_entregador_preferencia.sql'), 'utf8')));
  });
  beforeEach(() => {
    saidas.length = 0;
  });
  afterAll(async () => {
    if (antes.cardapio !== undefined) process.env.CARDAPIO_PUBLIC_URL = antes.cardapio;
    else delete process.env.CARDAPIO_PUBLIC_URL;
    if (antes.otp !== undefined) process.env.OTP_WEBHOOK_URL = antes.otp;
    if (empresas.length) {
      for (const t of ['whatsapp_mensagem', 'whatsapp_template', 'pedido_envio', 'pedido_notificacao', 'pedido_externo', 'entregador_preferencia', 'colaborador', 'cardapio_config'])
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

  // Bloco 5 (01/11/2026, ERR-341): o "estou chegando" do entregador ia ao n8n com a "janela aberta" medida pela
  // igualdade do telefone (sem × com o 55) — nunca casava, e o cliente da loja oficial não recebia o aviso.
  it('"estou chegando" na loja oficial: na janela, o texto (o entregador só se ele autorizou); fora, o modelo aprovado; Evolution, o n8n', async () => {
    const pedidoNoBanco = async (t: string) =>
      (
        await q(
          `insert into pedido_externo (tenant_id, canal, display_id, cliente_nome, cliente_telefone, tipo, itens, total, status)
           values ($1,'cardapio','70','Rodrigo Teste','21987654321','entrega','[]'::jsonb,30,'despachado') returning id`,
          [t],
        )
      )[0].id as string;
    const t = await loja('cloud');
    await conversa(t, 1);
    const id = await pedidoNoBanco(t);
    expect(await svc.avisarChegada(t, id, { nome: 'Carlos', telefone: '21911112222' })).toEqual({ saiu: true });
    expect(saidas).toEqual([
      { como: 'texto', para: '5521987654321', texto: '*Pedido chegando*\nSeu pedido #70 está chegando! 🛵 O entregador Carlos (21911112222) está a poucos minutos daí.' },
    ]);
    saidas.length = 0;
    await svc.avisarChegada(t, id, { nome: null, telefone: null }); // o entregador não autorizou o contato
    expect(saidas[0].texto).toBe('*Pedido chegando*\nSeu pedido #70 está chegando! 🛵 O entregador está a poucos minutos daí.');

    // Fora da janela de 24 h: sem o modelo, não sai e diz por quê; com o modelo aprovado, o modelo com o primeiro nome.
    saidas.length = 0;
    const t2 = await loja('cloud');
    await conversa(t2, 30);
    const id2 = await pedidoNoBanco(t2);
    expect(await svc.avisarChegada(t2, id2, { nome: null, telefone: null })).toMatchObject({ saiu: false, motivo: expect.stringContaining('sem modelo aprovado') });
    expect(saidas).toEqual([]);
    await modelo(t2, 'pedido_chegando', 'chegando');
    expect(await svc.avisarChegada(t2, id2, { nome: null, telefone: null })).toEqual({ saiu: true });
    // (o rastreio do pedido vai junto, mas só entra num modelo com botão de rastreio — o "chegando" não tem)
    expect(saidas).toEqual([expect.objectContaining({ como: 'modelo', para: '5521987654321', nome: 'pedido_chegando', idioma: 'pt_BR', params: ['Rodrigo'] })]);

    // Loja na Evolution: nada pela oficial — o entregador segue pelo n8n, como sempre.
    saidas.length = 0;
    const t3 = await loja('evolution');
    expect(await svc.avisarChegada(t3, await pedidoNoBanco(t3), { nome: null, telefone: null })).toBeNull();
    expect(saidas).toEqual([]);
  });

  // Bloco 3 (01/11/2026): o entregador não consegue falar com o cliente — o app do entregador ou o painel.
  describe('"não consigo falar com o cliente"', () => {
    /** Um pedido de entrega a caminho, com o entregador (que autorizou ou não mostrar o contato) e o rastreio. */
    async function emRota(t: string, opts: { compartilha?: boolean; canal?: string; status?: string } = {}) {
      const [c] = await q(`insert into colaborador (tenant_id, nome, telefone) values ($1,'Carlos Moto','21911112222') returning id`, [t]);
      if (opts.compartilha != null)
        await q(`insert into entregador_preferencia (colaborador_id, tenant_id, compartilha_contato) values ($1,$2,$3)`, [c.id, t, opts.compartilha]);
      return (
        await q(
          `insert into pedido_externo (tenant_id, canal, display_id, cliente_nome, cliente_telefone, tipo, itens, total, status, entregador_id, entregador_nome, rastreio_token)
           values ($1,$2,'81','Rodrigo Teste','21987654321','entrega','[]'::jsonb,30,$3,$4,'Carlos Moto','rt-81') returning id`,
          [t, opts.canal ?? 'cardapio', opts.status ?? 'despachado', c.id],
        )
      )[0].id as string;
    }

    it('loja oficial, na janela: o texto com o botão de onde ele está; o contato só se o entregador autorizou', async () => {
      const t = await loja('cloud');
      await conversa(t, 1);
      expect(await svc.avisarSemContato(t, await emRota(t, { compartilha: true }))).toEqual({ saiu: true });
      expect(saidas).toEqual([
        {
          como: 'link',
          para: '5521987654321',
          corpo:
            '*O entregador está tentando falar com você*\nO entregador Carlos Moto está com o seu pedido #81 e não conseguiu falar com você. O telefone dele é 21911112222. Responda esta mensagem para combinar a entrega.',
          url: 'https://app.dmsregem.com/r/rt-81',
          rotulo: 'Ver onde ele está',
        },
      ]);
      saidas.length = 0;
      await svc.avisarSemContato(t, await emRota(t)); // sem a preferência: não autorizou
      expect(saidas[0].corpo).toBe(
        '*O entregador está tentando falar com você*\nO entregador está com o seu pedido #81 e não conseguiu falar com você. Responda esta mensagem para combinar a entrega.',
      );
    });

    it('loja oficial, fora da janela: o modelo pedido_sem_contato (sem modelo, não sai e diz por quê)', async () => {
      const t = await loja('cloud');
      await conversa(t, 30);
      const id = await emRota(t, { compartilha: true });
      expect(await svc.avisarSemContato(t, id)).toMatchObject({ saiu: false, motivo: expect.stringContaining('sem modelo aprovado') });
      await modelo(t, 'pedido_sem_contato', 'sem_contato');
      expect(await svc.avisarSemContato(t, id)).toEqual({ saiu: true });
      expect(saidas).toEqual([{ como: 'modelo', para: '5521987654321', nome: 'pedido_sem_contato', idioma: 'pt_BR', params: ['Rodrigo'], rastreio: 'rt-81' }]);
    });

    it('loja com o WhatsApp por QR: o Regem manda o texto pela Evolution, com o link (o n8n não trata este aviso)', async () => {
      const t = await loja('evolution');
      expect(await svc.avisarSemContato(t, await emRota(t))).toEqual({ saiu: true });
      expect(saidas).toEqual([
        {
          como: 'qr',
          para: '5521987654321',
          texto:
            '*O entregador está tentando falar com você*\nO entregador está com o seu pedido #81 e não conseguiu falar com você. Responda esta mensagem para combinar a entrega.\n\nVeja onde ele está: https://app.dmsregem.com/r/rt-81',
        },
      ]);
    });

    it('pedido que não está a caminho, ou de outro canal (iFood, 99): recusa — e o "estou chegando" também não vai ao cliente do iFood', async () => {
      const t = await loja('cloud');
      await conversa(t, 1);
      await expect(svc.avisarSemContato(t, await emRota(t, { status: 'pronto' }))).rejects.toThrow('não está a caminho');
      await expect(svc.avisarSemContato(t, await emRota(t, { canal: 'ifood' }))).rejects.toThrow('outro canal');
      expect(await svc.avisarChegada(t, await emRota(t, { canal: '99food' }), { nome: null, telefone: null })).toMatchObject({
        saiu: false,
        motivo: expect.stringContaining('outro canal'),
      });
      expect(saidas).toEqual([]);
    });
  });
});
