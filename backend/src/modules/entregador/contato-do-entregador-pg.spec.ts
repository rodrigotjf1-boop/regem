import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../../db/schema';
import { EntregadorService } from './entregador.service';
import { comTravaDaEmpresa, repetirNaCorridaDeCatalogo } from '../../common/corrida-de-catalogo';
import * as geocodeMod from '../../common/geocode';

/* eslint-disable @typescript-eslint/no-explicit-any */

// O ENTREGADOR E O CLIENTE (pedido do dono, 09/11/2026), do lado do EntregadorService, contra o Postgres de verdade (V6):
//  • a lista do app traz COMO LIGAR (iFood: central + localizador; 99: celular com "+"), se o pedido tem o chat da
//    plataforma, se o WhatsApp da loja vale para o cliente (99 só com o ajuste) e a última fala do cliente no chat;
//  • "compartilhar minha posição": a posição do toque; sem ela, a última do GPS (10 min); sem nenhuma, recusa;
//  • a cerca de 70 m: iFood/99 SEM a posição no pedido só procura no mapa o endereço com rua e número.
const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('contato-do-entregador-pg.spec: sem TEST_PG_URL — PULADO');
jest.setTimeout(90_000);

const MIG = (arq: string) => join(__dirname, '../../../../database/migrations', arq);

descrever('o entregador e o cliente: ligação, chat, WhatsApp e posição (Postgres)', () => {
  const pool = new Pool({ connectionString: URL_PG });
  const db = drizzle(pool, { schema }) as any;
  const q = async (s: string, p: any[] = []) => (await pool.query(s, p)).rows;
  let ligado99 = false;
  const posicoes: any[] = [];
  const delivery: any = {
    cliente99Ligado: async () => ligado99,
    avisarPosicaoDoEntregador: async (_t: string, id: string, pos: any) => {
      posicoes.push({ id, pos });
      return { saiu: true };
    },
  };
  const chegadas: string[] = [];
  const avisosDoChat: any = { enfileirarChegando: async (_t: string, id: string) => (chegadas.push(id), 'enfileirado') };
  const ultimas = new Map<string, { texto: string; em: string }>();
  const chat: any = { ultimasDoCliente: async () => ultimas };
  const svc: any = new EntregadorService(db, delivery, {} as any, undefined, avisosDoChat, chat);
  const T = randomUUID();
  let carlos: string;
  const eu = () => ({ tenantId: T, colaboradorId: carlos, funcaoNome: 'Entregador', categoria: 'execucao', nome: 'Carlos' }) as any;

  beforeAll(async () => {
    delete process.env.EDGE_MODE; // como NUVEM
    for (const arq of ['201_entregador_chegada.sql', '222_entregador_posicao_latest.sql'])
      await repetirNaCorridaDeCatalogo(() => pool.query(comTravaDaEmpresa(readFileSync(MIG(arq), 'utf8'))));
    await q(`insert into empresa (id, nome) values ($1, 'teste contato do entregador')`, [T]);
    [{ id: carlos }] = await q(`insert into colaborador (tenant_id, nome, status) values ($1, 'Carlos Moto', 'ativo') returning id`, [T]);
  });
  beforeEach(async () => {
    ligado99 = false;
    posicoes.length = 0;
    chegadas.length = 0;
    ultimas.clear();
    await q(`delete from pedido_externo where tenant_id = $1`, [T]);
  });
  afterAll(async () => {
    jest.restoreAllMocks();
    for (const tab of ['entregador_chegada', 'entregador_posicao', 'pedido_externo', 'cardapio_config', 'colaborador'])
      await q(`delete from ${tab} where tenant_id = $1`, [T]).catch(() => {});
    await q(`delete from empresa where id = $1`, [T]).catch(() => {});
    await pool.end();
  });

  async function pedido(o: { canal: string; tel: string; raw: any; rua?: string | null; numero?: string | null }) {
    const [{ id }] = await q(
      `insert into pedido_externo (tenant_id, canal, display_id, cliente_nome, cliente_telefone, tipo, itens, total, status, raw, entregador_id,
                                   endereco_rua, endereco_numero, endereco_bairro, endereco, despachado_em)
       values ($1,$2,'4821','MARIA SILVA',$3,'entrega','[]'::jsonb,50,'despachado',$4::jsonb,$5,$6,$7,'Penha',$8, now()) returning id`,
      [T, o.canal, o.tel, JSON.stringify(o.raw), carlos, o.rua ?? null, o.numero ?? null, [o.rua, o.numero, 'Penha'].filter(Boolean).join(', ')],
    );
    return id as string;
  }

  it('a lista do app: como ligar, o chat da plataforma, o WhatsApp da loja e a última fala do cliente no chat', async () => {
    const ifood = await pedido({
      canal: 'ifood',
      tel: '08007050000',
      raw: { delivery: { deliveredBy: 'MERCHANT' }, customer: { phone: { number: '08007050000', localizer: '12345678', localizerExpiration: '2026-11-10T02:30:00Z' } } },
    });
    const n99 = await pedido({ canal: '99food', tel: '+55 21987654321', raw: { delivery_type: 2 } });
    const card = await pedido({ canal: 'cardapio', tel: '21987654321', raw: {} });
    ultimas.set(ifood, { texto: 'Estou descendo', em: '2026-11-09T23:00:00.000Z' });
    let lista = await svc.pedidos(eu());
    const de = (id: string) => lista.find((p: any) => p.id === id);
    expect(de(ifood)).toMatchObject({
      ligacao: { tipo: 'central', numero: '08007050000', localizador: '12345678' },
      chatDaPlataforma: true,
      whatsappCliente: false, // iFood nunca (ERR-342)
      ultimaNoChat: { texto: 'Estou descendo' },
    });
    expect(de(n99)).toMatchObject({ ligacao: { tipo: 'direto', numero: '+5521987654321' }, chatDaPlataforma: true, whatsappCliente: false, ultimaNoChat: null });
    expect(de(card)).toMatchObject({ ligacao: { tipo: 'direto', numero: '21987654321' }, chatDaPlataforma: false, whatsappCliente: true });
    // a logo da loja só no pedido do cardápio; sem logo cadastrada, nenhuma (o app usa a do Regem)
    expect(de(card).logoDaLoja).toBeNull();
    await q(`insert into cardapio_config (tenant_id, token, ativo, logo_ref) values ($1,$2,true,'https://exemplo.supabase.co/storage/v1/object/public/midia/logo.png')`, [T, `tk-${randomUUID()}`]);
    lista = await svc.pedidos(eu());
    expect(lista.find((p: any) => p.id === card).logoDaLoja).toBe('https://exemplo.supabase.co/storage/v1/object/public/midia/logo.png');
    expect(lista.find((p: any) => p.id === ifood).logoDaLoja).toBeNull();
    // com o ajuste da 99 ligado, o "não consigo falar" e a posição valem para o cliente da 99
    ligado99 = true;
    lista = await svc.pedidos(eu());
    expect(lista.find((p: any) => p.id === n99).whatsappCliente).toBe(true);
    expect(lista.find((p: any) => p.id === ifood).whatsappCliente).toBe(false);
  });

  it('compartilhar minha posição: a do toque; sem ela, a última do GPS; sem nenhuma, recusa; pedido de outro, recusa', async () => {
    const id = await pedido({ canal: 'cardapio', tel: '21987654321', raw: {} });
    expect(await svc.compartilharPosicao(eu(), id, { lat: -22.83, lng: -43.28, precisao: 12 })).toEqual({ ok: true });
    expect(posicoes.at(-1)).toEqual({ id, pos: { lat: -22.83, lng: -43.28, precisao: 12 } });
    await expect(svc.compartilharPosicao(eu(), id, null)).rejects.toThrow('Não consegui pegar a sua posição');
    await q(
      `insert into entregador_posicao (colaborador_id, tenant_id, lat, lng, atualizado_em) values ($1,$2,-22.84,-43.29, now())
       on conflict (colaborador_id) do update set lat = -22.84, lng = -43.29, atualizado_em = now()`,
      [carlos, T],
    );
    expect(await svc.compartilharPosicao(eu(), id, { lat: 'x' })).toEqual({ ok: true });
    expect(posicoes.at(-1)).toEqual({ id, pos: { lat: -22.84, lng: -43.29 } });
    await expect(svc.compartilharPosicao({ ...eu(), colaboradorId: randomUUID() }, id, { lat: 1, lng: 1 })).rejects.toThrow('não está atribuído a você');
  });

  it('a cerca de 70 m no iFood/99 sem a posição no pedido: só procura no mapa o endereço com rua e número', async () => {
    const procurados: string[] = [];
    jest.spyOn(geocodeMod, 'geocode').mockImplementation(async (end: string) => {
      procurados.push(end);
      return { lat: -22.83, lng: -43.28 };
    });
    svc.configPagamento = async () => ({ raioChegadaM: 70 });
    const semNumero = await pedido({ canal: 'ifood', tel: '08007050000', raw: { delivery: { deliveredBy: 'MERCHANT' } }, rua: 'Rua Guaíba', numero: null });
    const completo = await pedido({ canal: 'ifood', tel: '08007050000', raw: { delivery: { deliveredBy: 'MERCHANT' } }, rua: 'Rua Guaíba', numero: '375' });
    const daPlataforma = await pedido({ canal: '99food', tel: '+55 21987654321', raw: { delivery_type: 2, receive_address: { poi_lat: -22.83, poi_lng: -43.28, coordinate_type: 'wgs84' } } });
    await svc.checarChegada(eu(), -22.83, -43.28);
    // o incompleto não foi procurado e não avisa; o completo foi procurado e avisou; o da 99 usou a posição do pedido
    expect(procurados).toEqual(['Rua Guaíba, 375, Penha']);
    expect(chegadas.sort()).toEqual([completo, daPlataforma].sort());
    expect((await q(`select lat from entregador_chegada where pedido_id = $1`, [semNumero]))[0]).toEqual({ lat: null });
  });
});
