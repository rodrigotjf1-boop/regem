import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../../db/schema';
import { DeliveryService } from './delivery.service';
import { AvisoDa99Processor } from './aviso-da-99.processor';
import { comTravaDaEmpresa, repetirNaCorridaDeCatalogo } from '../../common/corrida-de-catalogo';

/* eslint-disable @typescript-eslint/no-explicit-any */

// O CLIENTE DA 99 PELO WHATSAPP DA LOJA + A POSIÇÃO DO ENTREGADOR (pedido do dono, 09/11/2026; mig 388). Contra o
// Postgres de verdade (V6), com o DeliveryService de verdade e o WhatsApp de mentira (oficial e QR):
//  • a 99 só recebe com o ajuste ligado, só na ENTREGA DA LOJA; o iFood nunca (ERR-342); o cardápio, sempre;
//  • o "saiu" da 99 sai uma vez só por pedido (a rotina marca antes de mandar — V24/V42), só para o que saiu há pouco;
//  • na oficial, o cliente da 99 que nunca falou com a loja recebe o MODELO no celular que a 99 mandou;
//  • a posição do entregador: na janela, o link do mapa; fora dela, o modelo do "sem contato"; pelo QR, o link escrito.
// As tabelas das conversas, dos modelos, do ajuste e da marca são só da nuvem: o teste aplica as migrations (o banco do CI
// é o de uma loja).
const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('cliente-da-99-whatsapp-pg.spec: sem TEST_PG_URL — PULADO');
jest.setTimeout(90_000);

const MIG = (arq: string) => join(__dirname, '../../../../database/migrations', arq);
const daTabelaDeModelos = (arq: string) =>
  readFileSync(MIG(arq), 'utf8')
    .split(';')
    .map((s) => s.trim())
    .filter((s) => /whatsapp_template/.test(s) && !/alter table campanha/i.test(s));

descrever('o cliente da 99 pelo WhatsApp da loja e a posição do entregador (Postgres)', () => {
  const pool = new Pool({ connectionString: URL_PG });
  const db = drizzle(pool, { schema }) as any;
  const q = async (s: string, p: any[] = []) => (await pool.query(s, p)).rows;
  const saidas: any[] = [];
  const oficial = {
    enviarTexto: async (_t: string, para: string, texto: string) => void saidas.push({ como: 'texto', para, texto }),
    enviarLink: async (_t: string, para: string, corpo: string, url: string, rotulo: string) => void saidas.push({ como: 'link', para, corpo, url, rotulo }),
    enviarTemplate: async (_t: string, para: string, nome: string, _idioma: string, params: string[], opts: any) =>
      void saidas.push({ como: 'modelo', para, nome, params, rastreio: opts?.rastreio ?? null }),
    enviarOpcoes: async () => undefined,
  } as any;
  const qr = { enviar: async (_t: string, numero: string, texto: string) => void saidas.push({ como: 'qr', para: numero, texto }) } as any;
  const svc: any = new (DeliveryService as any)(db, {}, {}, {}, {}, { emit: () => true }, { flashPedidos: () => undefined },
    undefined, undefined, undefined, undefined, undefined, undefined, undefined, oficial, qr);
  const rotina = new AvisoDa99Processor(db, svc);
  const empresas: string[] = [];
  const antes = { cardapio: process.env.CARDAPIO_PUBLIC_URL, edge: process.env.EDGE_MODE };

  const aplicar = (texto: string) => repetirNaCorridaDeCatalogo(() => pool.query(comTravaDaEmpresa(texto)));
  beforeAll(async () => {
    process.env.CARDAPIO_PUBLIC_URL = 'https://app.dmsregem.com';
    delete process.env.EDGE_MODE; // como NUVEM
    for (const arq of ['215_whatsapp_mensagem.sql', '208_entregador_preferencia.sql', '342_robo_pausa_e_config.sql', '388_cliente_da_99_pelo_whatsapp.sql'])
      await aplicar(readFileSync(MIG(arq), 'utf8'));
    for (const s of [...daTabelaDeModelos('227_whatsapp_template.sql'), ...daTabelaDeModelos('236_whatsapp_template_evento.sql')]) await aplicar(s);
  });
  beforeEach(() => {
    saidas.length = 0;
  });
  afterAll(async () => {
    if (antes.cardapio !== undefined) process.env.CARDAPIO_PUBLIC_URL = antes.cardapio;
    else delete process.env.CARDAPIO_PUBLIC_URL;
    if (antes.edge !== undefined) process.env.EDGE_MODE = antes.edge;
    if (empresas.length) {
      for (const t of ['pedido_aviso_99', 'robo_config', 'whatsapp_mensagem', 'whatsapp_template', 'pedido_envio', 'pedido_notificacao', 'pedido_externo', 'entregador_preferencia', 'colaborador', 'cardapio_config'])
        await pool.query(`delete from ${t} where tenant_id = any($1::uuid[])`, [empresas]).catch(() => {});
      await pool.query('delete from empresa where id = any($1::uuid[])', [empresas]).catch(() => {});
    }
    await pool.end();
  });

  async function loja(provedor: 'cloud' | 'evolution', cliente99: boolean | null) {
    const t = (await q(`insert into empresa (nome) values ('teste cliente da 99') returning id`))[0].id as string;
    empresas.push(t);
    await q(`insert into cardapio_config (tenant_id, token, ativo, provedor, wa_cloud_phone_id) values ($1,$2,true,$3,$4)`, [
      t,
      `tk-${randomUUID()}`,
      provedor,
      `ph-${randomUUID().slice(0, 12)}`,
    ]);
    if (cliente99 !== null) await q(`insert into robo_config (tenant_id, cliente_99_whatsapp) values ($1,$2)`, [t, cliente99]);
    return t;
  }
  const modelo = (t: string, nome: string, evento: string) =>
    q(`insert into whatsapp_template (tenant_id, nome, evento, status, categoria, corpo) values ($1,$2,$3,'aprovado','UTILITY','Oi {{1}}!')`, [t, nome, evento]);
  const conversa = (t: string, horasAtras = 0) =>
    q(`insert into whatsapp_mensagem (tenant_id, telefone, direcao, texto, criado_em) values ($1,'5521987654321','entrada','oi', now() - make_interval(hours => $2))`, [
      t,
      horasAtras,
    ]);
  /** Um pedido a caminho: a 99 manda "+55 21…"; o cardápio guarda sem o 55. `raw` decide quem entrega. */
  async function pedido(t: string, o: { canal?: string; raw?: any; status?: string; minAtras?: number; tel?: string } = {}) {
    const canal = o.canal ?? '99food';
    return (
      await q(
        `insert into pedido_externo (tenant_id, canal, display_id, cliente_nome, cliente_telefone, tipo, itens, total, status, rastreio_token, raw, despachado_em, codigo_entrega)
         values ($1,$2,'436004','Suelen Teste',$3,'entrega','[]'::jsonb,30,$4,$5,$6::jsonb, now() - make_interval(mins => $7::int), $8) returning id`,
        [
          t,
          canal,
          o.tel ?? (canal === '99food' ? '+55 21987654321' : '21987654321'),
          o.status ?? 'despachado',
          `rt-${randomUUID().slice(0, 8)}`,
          JSON.stringify(o.raw ?? (canal === '99food' ? { delivery_type: 2 } : {})),
          o.minAtras ?? 2,
          canal === 'cardapio' ? '4821' : null,
        ],
      )
    )[0].id as string;
  }
  const rastreioDe = async (id: string) => `https://app.dmsregem.com/r/${(await q(`select rastreio_token from pedido_externo where id = $1`, [id]))[0].rastreio_token}`;

  it('quem pode receber: o cardápio sempre; a 99 só na entrega da loja e com o ajuste; o iFood e a entrega da 99, nunca', () => {
    expect(DeliveryService.podeFalarPeloWhatsapp({ canal: 'cardapio' }, false)).toBe(true);
    expect(DeliveryService.podeFalarPeloWhatsapp({ canal: '99food', raw: { delivery_type: 2 } }, false)).toBe(false);
    expect(DeliveryService.podeFalarPeloWhatsapp({ canal: '99food', raw: { delivery_type: 2 } }, true)).toBe(true);
    expect(DeliveryService.podeFalarPeloWhatsapp({ canal: '99food', raw: { delivery_type: 1 } }, true)).toBe(false);
    expect(DeliveryService.podeFalarPeloWhatsapp({ canal: '99food', tipo: 'retirada', raw: { delivery_type: 2 } }, true)).toBe(false);
    expect(DeliveryService.podeFalarPeloWhatsapp({ canal: 'ifood', raw: { delivery: { deliveredBy: 'MERCHANT' } } }, true)).toBe(false);
    expect(DeliveryService.podeFalarPeloWhatsapp({ canal: 'anotaai' }, true)).toBe(false);
  });

  it('o "saiu" da 99 na loja oficial: o cliente nunca falou com a loja → o modelo aprovado no celular da 99, uma vez só', async () => {
    const t = await loja('cloud', true);
    await modelo(t, 'pedido_saiu_entrega', 'saiu_entrega');
    const id = await pedido(t);
    expect(await rotina.avisarOsQueSairam()).toBeGreaterThanOrEqual(1);
    expect(saidas).toEqual([{ como: 'modelo', para: '5521987654321', nome: 'pedido_saiu_entrega', params: ['Suelen'], rastreio: expect.stringMatching(/^rt-/) }]);
    // a marca foi gravada ANTES do envio: a próxima volta não manda de novo
    saidas.length = 0;
    await rotina.avisarOsQueSairam();
    expect(saidas).toEqual([]);
    expect(await q(`select evento from pedido_aviso_99 where pedido_id = $1`, [id])).toEqual([{ evento: 'saiu_entrega' }]);
  });

  it('o "saiu" da 99 na janela de 24 h: o texto com o botão do rastreio e o lembrete do código do app da 99', async () => {
    const t = await loja('cloud', true);
    await conversa(t, 1);
    const id = await pedido(t);
    await rotina.avisarOsQueSairam();
    expect(saidas).toEqual([
      {
        como: 'link',
        para: '5521987654321',
        corpo:
          '*Saiu para entrega*\nSeu pedido #436004 saiu para entrega! 🛵 Acompanhe a chegada pelo botão abaixo.\n🔑 Na entrega, informe ao entregador o código que aparece no app da 99.',
        url: await rastreioDe(id),
        rotulo: 'Acompanhar entrega',
      },
    ]);
  });

  it('o "saiu" da 99 pelo WhatsApp por QR: o texto com o link escrito no fim', async () => {
    const t = await loja('evolution', true);
    const id = await pedido(t);
    await rotina.avisarOsQueSairam();
    expect(saidas).toEqual([
      {
        como: 'qr',
        para: '5521987654321',
        texto: `*Saiu para entrega*\nSeu pedido #436004 saiu para entrega! 🛵 Acompanhe a chegada pelo link abaixo.\n🔑 Na entrega, informe ao entregador o código que aparece no app da 99.\n\nAcompanhe aqui: ${await rastreioDe(id)}`,
      },
    ]);
  });

  it('a rotina não pega: ajuste desligado (ou sem linha), entrega da 99, iFood, retirada, saiu há mais de 10 min, sem modelo não marca dois', async () => {
    const desligada = await loja('evolution', false);
    await pedido(desligada);
    const semLinha = await loja('evolution', null);
    await pedido(semLinha);
    const t = await loja('evolution', true);
    await pedido(t, { raw: { delivery_type: 1 } }); // o entregador é da 99: a 99 avisa
    await pedido(t, { canal: 'ifood', raw: { delivery: { deliveredBy: 'MERCHANT' } }, tel: '08007050000' });
    await pedido(t, { minAtras: 20 });
    await pedido(t, { status: 'pronto' });
    const ids = (await rotina.pedidosQueSairam()).filter((p) => [desligada, semLinha, t].includes(p.tenantId));
    expect(ids).toEqual([]);
    await rotina.avisarOsQueSairam();
    expect(saidas.filter((s) => s.texto?.includes('436004'))).toEqual([]);
  });

  it('a posição do entregador: na janela, o link do mapa da posição do toque; fora dela, o modelo do "sem contato"', async () => {
    const t = await loja('cloud', false);
    await conversa(t, 1);
    const id = await pedido(t, { canal: 'cardapio' });
    expect(await svc.avisarPosicaoDoEntregador(t, id, { lat: -22.8291234, lng: -43.2851234 })).toEqual({ saiu: true });
    expect(saidas).toEqual([
      {
        como: 'link',
        para: '5521987654321',
        corpo:
          '*O entregador está perto de você*\nO entregador está com o seu pedido #436004 perto do endereço e não está encontrando o local. Veja onde ele está pelo botão abaixo e responda esta mensagem para ajudar.\n🔑 Não esqueça do código 4821 para liberar o pedido.',
        url: 'https://www.google.com/maps/search/?api=1&query=-22.829123,-43.285123',
        rotulo: 'Ver onde ele está',
      },
    ]);
    // fora da janela: o modelo do "sem contato" (o botão abre o rastreio, que mostra o entregador ao vivo)
    const t2 = await loja('cloud', false);
    await conversa(t2, 30);
    const id2 = await pedido(t2, { canal: 'cardapio' });
    saidas.length = 0;
    expect(await svc.avisarPosicaoDoEntregador(t2, id2, { lat: -22.8, lng: -43.2 })).toMatchObject({ saiu: false, motivo: expect.stringContaining('sem modelo aprovado') });
    await modelo(t2, 'pedido_sem_contato', 'sem_contato');
    expect(await svc.avisarPosicaoDoEntregador(t2, id2, { lat: -22.8, lng: -43.2 })).toEqual({ saiu: true });
    expect(saidas).toEqual([{ como: 'modelo', para: '5521987654321', nome: 'pedido_sem_contato', params: ['Suelen'], rastreio: expect.stringMatching(/^rt-/) }]);
  });

  it('a posição e o "sem contato" ao cliente da 99: só com o ajuste ligado; o iFood nunca; pelo QR, o link do mapa escrito', async () => {
    const desligada = await loja('evolution', false);
    // a recusa diz onde ligar — o caminho do menu (shell.tsx: Delivery › Configurações) e a aba (config-panel: Robô de atendimento) (V65)
    await expect(svc.avisarPosicaoDoEntregador(desligada, await pedido(desligada), { lat: -22.8, lng: -43.2 })).rejects.toThrow(
      'Delivery › Configurações › Robô de atendimento',
    );
    await expect(svc.avisarSemContato(desligada, await pedido(desligada))).rejects.toThrow('cliente da 99');
    await expect(
      svc.avisarPosicaoDoEntregador(desligada, await pedido(desligada, { canal: 'ifood', raw: { delivery: { deliveredBy: 'MERCHANT' } }, tel: '08007050000' }), { lat: 1, lng: 1 }),
    ).rejects.toThrow('outro canal');
    const t = await loja('evolution', true);
    expect(await svc.avisarPosicaoDoEntregador(t, await pedido(t), { lat: -22.8, lng: -43.2 })).toEqual({ saiu: true });
    expect(saidas).toEqual([
      {
        como: 'qr',
        para: '5521987654321',
        texto:
          '*O entregador está perto de você*\nO entregador está com o seu pedido #436004 perto do endereço e não está encontrando o local. Veja onde ele está pelo link abaixo e responda esta mensagem para ajudar.\n🔑 Na entrega, informe ao entregador o código que aparece no app da 99.\n\nVeja onde ele está: https://www.google.com/maps/search/?api=1&query=-22.800000,-43.200000',
      },
    ]);
    saidas.length = 0;
    expect(await svc.avisarSemContato(t, await pedido(t))).toEqual({ saiu: true });
    expect(saidas[0]).toMatchObject({ como: 'qr', para: '5521987654321', texto: expect.stringContaining('app da 99') });
  });

  it('o "chegando" da 99: com o ajuste desligado não sai (quem chama cai no chat); ligado, pela via da loja, sem link', async () => {
    const desligada = await loja('evolution', false);
    expect(await svc.avisarChegadaDa99(desligada, await pedido(desligada), { nome: null, telefone: null })).toMatchObject({ saiu: false });
    expect(saidas).toEqual([]);
    const t = await loja('evolution', true);
    expect(await svc.avisarChegadaDa99(t, await pedido(t), { nome: 'Carlos', telefone: null })).toEqual({ saiu: true });
    expect(saidas).toEqual([
      {
        como: 'qr',
        para: '5521987654321',
        texto:
          '*Pedido chegando*\nSeu pedido #436004 está chegando! 🛵 O entregador Carlos está a poucos minutos daí.\n🔑 Na entrega, informe ao entregador o código que aparece no app da 99.',
      },
    ]);
    // na oficial, sem conversa e sem o modelo "chegando" aprovado: não sai e diz por quê
    const oficialSemModelo = await loja('cloud', true);
    saidas.length = 0;
    expect(await svc.avisarChegadaDa99(oficialSemModelo, await pedido(oficialSemModelo), { nome: null, telefone: null })).toMatchObject({
      saiu: false,
      motivo: expect.stringContaining('nunca escreveu para a loja e não há modelo aprovado'),
    });
    expect(saidas).toEqual([]);
  });
});
