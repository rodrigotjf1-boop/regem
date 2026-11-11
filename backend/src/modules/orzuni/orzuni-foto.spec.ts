import { readFileSync } from 'fs';
import { join } from 'path';
import { randomBytes } from 'crypto';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { ConflictException } from '@nestjs/common';
import * as schema from '../../db/schema';
import { cifrar } from '../../common/cifra-segredo';
import { comTravaDaEmpresa, repetirNaCorridaDeCatalogo } from '../../common/corrida-de-catalogo';
import { ConferenciaService } from '../conferencia/conferencia.service';
import { OrzuniFotoService } from './orzuni-foto.service';
import {
  LIMITE_FOTO_IFOOD,
  chaveDaFoto,
  dataUriDaFoto,
  ehQuadrada,
  medidaDaImagem,
  problemaDaFoto,
} from './orzuni-foto.regras';

/* eslint-disable @typescript-eslint/no-explicit-any */

// "MANDAR ESTA FOTO AO iFOOD" (R3 F6b): as regras da foto (medida pelos bytes, 8 MB, quadrada, 300 px, data-URI, chave)
// sem banco; o serviço inteiro contra Postgres (TEST_PG_URL) com uma porta do Orzuni e um DMS ID falsos — a permissão
// `catalogo.escrever` da ligação, o produto no iFood com código, a foto pública, a chamada `item_foto_definir` com o
// data-URI e a chave pelo conteúdo, e cada recusa com a frase (antes de chamar, quando dá).

const MIG = (n: string) => join(__dirname, '..', '..', '..', '..', 'database', 'migrations', n);
const MCP = 'https://orzuni.exemplo.test/v1/mcp';
const ENV = {
  ORZUNI_LIGADO: 'true',
  ORZUNI_MCP_URL: MCP,
  DMS_ID_EMISSOR: 'https://id.exemplo.test/oidc',
  HUB_APLICATIVO: 'app-regem-teste',
  HUB_SEGREDO: 'segredo-de-teste-1234567',
};

/** Um PNG só com o cabeçalho (o que a medida lê) e um pouco de corpo. */
function png(largura: number, altura: number, corpo = 64): Buffer {
  const b = Buffer.alloc(33 + corpo);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.writeUInt32BE(13, 8);
  b.write('IHDR', 12, 'latin1');
  b.writeUInt32BE(largura, 16);
  b.writeUInt32BE(altura, 20);
  return b;
}
/** Um JPEG mínimo: SOI, um APP0 e o SOF0 com a medida. */
function jpeg(largura: number, altura: number): Buffer {
  const app0 = Buffer.from([0xff, 0xe0, 0x00, 0x10, ...Buffer.from('JFIF\0'), 1, 1, 0, 0, 1, 0, 1, 0, 0]);
  const sof = Buffer.alloc(19);
  sof.writeUInt16BE(0xffc0, 0);
  sof.writeUInt16BE(17, 2);
  sof[4] = 8;
  sof.writeUInt16BE(altura, 5);
  sof.writeUInt16BE(largura, 7);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app0, sof, Buffer.from([0xff, 0xd9])]);
}

describe('as regras da foto ao iFood (sem banco)', () => {
  it('a medida sai dos bytes: PNG e JPEG; outra coisa (ou cortada) = null', () => {
    expect(medidaDaImagem(png(400, 400))).toEqual({ tipo: 'png', largura: 400, altura: 400 });
    expect(medidaDaImagem(jpeg(640, 600))).toEqual({ tipo: 'jpeg', largura: 640, altura: 600 });
    expect(medidaDaImagem(Buffer.from('GIF89a……'))).toBeNull();
    expect(medidaDaImagem(png(400, 400).subarray(0, 20))).toBeNull();
    expect(medidaDaImagem(jpeg(640, 600).subarray(0, 12))).toBeNull();
  });
  it('serve: até 8 MB, JPG/PNG, quadrada (folga de 2%), 300 px de lado ou mais — cada recusa com a frase', () => {
    expect(problemaDaFoto({ tipo: 'png', largura: 800, altura: 800 }, 1000)).toBeNull();
    expect(problemaDaFoto({ tipo: 'jpeg', largura: 800, altura: 815 }, 1000)).toBeNull();
    expect(ehQuadrada(800, 830)).toBe(false);
    expect(problemaDaFoto({ tipo: 'png', largura: 800, altura: 600 }, 1000)).toMatch(/800 × 600 px e o iFood pede foto quadrada/);
    expect(problemaDaFoto({ tipo: 'png', largura: 200, altura: 200 }, 1000)).toMatch(/pede 300 px de lado ou mais/);
    expect(problemaDaFoto(null, 1000)).toMatch(/não é JPG nem PNG/);
    expect(problemaDaFoto({ tipo: 'png', largura: 800, altura: 800 }, LIMITE_FOTO_IFOOD + 1)).toMatch(/8,0 MB e o iFood aceita até 8 MB/);
  });
  it('o data-URI e a chave: a mesma foto dá a mesma chave (8–100 caracteres); outra foto, outra chave', () => {
    const a = png(400, 400);
    expect(dataUriDaFoto({ tipo: 'png', largura: 400, altura: 400 }, a)).toBe(`data:image/png;base64,${a.toString('base64')}`);
    const k = chaveDaFoto('p1', a);
    expect(k).toBe(chaveDaFoto('p1', Buffer.from(a)));
    expect(k).not.toBe(chaveDaFoto('p1', png(401, 401)));
    expect(k).not.toBe(chaveDaFoto('p2', a));
    expect(k.length).toBeGreaterThanOrEqual(8);
    expect(k.length).toBeLessThanOrEqual(100);
  });
});

const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('orzuni-foto.spec: sem TEST_PG_URL — PULADO');
jest.setTimeout(180_000);

descrever('"Mandar esta foto ao iFood" (Postgres real, porta falsa)', () => {
  const pool = new Pool({ connectionString: URL_PG });
  const db = drizzle(pool, { schema }) as any;
  const foto = new OrzuniFotoService(db);
  const auditados: any[] = [];
  const conferencia = new ConferenciaService(db, { registrar: async (e: any) => void auditados.push(e) } as any, undefined, undefined, foto);
  const empresas: string[] = [];
  const q = (s: string, p: any[] = []) => pool.query(s, p).then((r) => r.rows);
  const envAntes: Record<string, string | undefined> = {};

  type Chamada = { ferramenta: string; args: any; ligacao: string | null };
  let chamadas: Chamada[] = [];
  let responder: (c: Chamada) => any = () => ({ structuredContent: { situacao: 'aplicado', repetido: false, foto: true }, content: [] });
  const json = (status: number, corpo: any) => new Response(JSON.stringify(corpo), { status, headers: { 'content-type': 'application/json' } });
  foto.buscar = (async (url: any, init: any) => {
    const u = String(url);
    if (u === `${ENV.DMS_ID_EMISSOR}/token`) return json(200, { access_token: 'token-de-teste', expires_in: 3600 });
    if (u === MCP) {
      const corpo = JSON.parse(String(init?.body ?? '{}'));
      const c: Chamada = { ferramenta: corpo.params?.name, args: corpo.params?.arguments, ligacao: new Headers(init?.headers ?? {}).get('dms-ligacao') };
      chamadas.push(c);
      return json(200, { jsonrpc: '2.0', id: corpo.id, result: responder(c) });
    }
    throw new Error(`endereço inesperado no teste: ${u}`);
  }) as typeof fetch;
  // As fotos "públicas" do teste (o endereço do cadastro → os bytes).
  const fotos = new Map<string, Buffer>();
  foto.baixar = async (url: string) => (fotos.has(url) ? new Response(new Uint8Array(fotos.get(url) as Buffer), { status: 200 }) : new Response('', { status: 404 }));

  beforeAll(async () => {
    for (const k of [...Object.keys(ENV), 'SEGREDOS_CHAVE', 'EDGE_MODE']) envAntes[k] = process.env[k];
    Object.assign(process.env, ENV);
    delete process.env.EDGE_MODE;
    if (!process.env.SEGREDOS_CHAVE) process.env.SEGREDOS_CHAVE = randomBytes(32).toString('base64');
    // As tabelas do Orzuni são só da nuvem: as mesmas migrations, na mesma ordem, da spec da fila (o banco do CI é dividido
    // entre as specs — uma lista mais curta trocaria a função do gatilho no meio da outra, ERR-273). Trava `empresa`
    // primeiro (ERR-377).
    for (const n of ['370_orzuni_envio.sql', '371_orzuni_ocultar_pausa.sql', '399_onde_vende_sem_ocultar_no_ifood.sql',
      '400_orzuni_nome_descricao_codigo.sql', '403_opcao_pausa_por_canal.sql', '406_ligar_produto_ao_app.sql'])
      await repetirNaCorridaDeCatalogo(() => pool.query(comTravaDaEmpresa(readFileSync(MIG(n), 'utf8'))));
  });

  afterAll(async () => {
    for (const [k, v] of Object.entries(envAntes)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    if (empresas.length) {
      for (const t of ['orzuni_envio', 'orzuni_ligacao', 'produto', 'categoria_produto', 'entitlement', 'unidade'])
        await pool.query(`delete from ${t} where tenant_id = any($1::uuid[])`, [empresas]).catch(() => {});
      await pool.query('delete from empresa where id = any($1::uuid[])', [empresas]).catch(() => {});
    }
    await pool.end();
  }, 120_000);

  beforeEach(() => {
    chamadas = [];
    auditados.length = 0;
    responder = () => ({ structuredContent: { situacao: 'aplicado', repetido: false, foto: true }, content: [] });
  });

  const SEGREDO = `dms_lg_orzuni_${randomBytes(18).toString('base64url')}`;
  async function loja(permissoes: string[]) {
    const t = (await q(`insert into empresa (nome) values ('teste orzuni foto') returning id`))[0].id as string;
    empresas.push(t);
    const u = (await q(`insert into unidade (tenant_id, nome) values ($1, 'Loja 1') returning id`, [t]))[0].id as string;
    await q(`insert into entitlement (id, tenant_id, modulo, ativo) values (md5('entitlement' || $1 || 'ifood_pelo_orzuni')::uuid, $2, 'ifood_pelo_orzuni', true)`, [t, t]);
    await q(`insert into orzuni_ligacao (tenant_id, unidade_id, segredo_cifrado, prefixo, permissoes) values ($1, $2, $3, 'dms_lg_orzuni_teste', $4::jsonb)`, [
      t,
      u,
      cifrar(SEGREDO),
      JSON.stringify(permissoes),
    ]);
    const cat = (await q(`insert into categoria_produto (tenant_id, nome) values ($1, 'Lanches') returning id`, [t]))[0].id as string;
    const produto = async (extra: Record<string, any> = {}) => {
      const cols = { tenant_id: t, nome: 'X-Foto', codigo: 'F-1', categoria_id: cat, preco_venda: 30, no_ifood: true, ...extra };
      const k = Object.keys(cols);
      return (await q(`insert into produto (${k.join(',')}) values (${k.map((_, i) => `$${i + 1}`).join(',')}) returning id`, Object.values(cols)))[0]
        .id as string;
    };
    return { t, u, produto };
  }
  const COM = ['catalogo.ler', 'catalogo.escrever', 'preco.escrever', 'status.escrever'];

  it('sem `catalogo.escrever` na ligação: recusa com a frase, sem chamar o Orzuni nem baixar a foto', async () => {
    const l = await loja(['catalogo.ler', 'preco.escrever', 'status.escrever', 'loja.escrever']);
    fotos.set('https://fotos.exemplo.test/sem-perm.png', png(400, 400));
    const p = await l.produto({ imagem_ref: 'https://fotos.exemplo.test/sem-perm.png' });
    const r = await foto.mandar(l.t, l.u, p);
    expect(r).toMatchObject({ ok: false, status: 409, chamou: false });
    expect((r as any).motivo).toMatch(/não tem a permissão de editar o cardápio do iFood \(catalogo\.escrever\)/);
    expect(chamadas).toHaveLength(0);
  });

  it('com a permissão: `item_foto_definir` com o código, o data-URI e a chave pelo conteúdo; a ligação da loja vai junto', async () => {
    const l = await loja(COM);
    const bytes = png(800, 800, 2048);
    fotos.set('https://fotos.exemplo.test/x.png', bytes);
    const p = await l.produto({ imagem_ref: 'https://fotos.exemplo.test/x.png' });
    const r = await foto.mandar(l.t, l.u, p);
    expect(r).toMatchObject({ ok: true, resultado: 'aplicado', repetido: false, frase: 'A foto de "X-Foto" foi para o iFood.' });
    expect(chamadas.map((c) => c.ferramenta)).toEqual(['item_foto_definir']);
    expect(chamadas[0].args).toEqual({ codigo_pdv: 'F-1', imagem: `data:image/png;base64,${bytes.toString('base64')}`, chaveIdempotencia: chaveDaFoto(p, bytes) });
    expect(chamadas[0].ligacao).toBe(SEGREDO);
    // A porta disse "repetido" (o mesmo clique de novo): a frase diz que já tinha ido.
    responder = () => ({ structuredContent: { situacao: 'aplicado', repetido: true, foto: true }, content: [] });
    expect(await foto.mandar(l.t, l.u, p)).toMatchObject({ ok: true, repetido: true, frase: 'Esta foto já tinha ido ao iFood em "X-Foto".' });
    expect(chamadas[1].args.chaveIdempotencia).toBe(chamadas[0].args.chaveIdempotencia);
  });

  it('a foto que não serve não sai: não quadrada, pequena, grande demais, não JPG/PNG, ainda local, sem foto, fora do iFood', async () => {
    const l = await loja(COM);
    const caso = async (url: string | null, bytes: Buffer | null, extra: Record<string, any> = {}) => {
      if (url && bytes) fotos.set(url, bytes);
      const p = await l.produto({ imagem_ref: url, codigo: `F-${Math.random().toString(36).slice(2, 8)}`, ...extra });
      return foto.mandar(l.t, l.u, p);
    };
    expect(await caso('https://fotos.exemplo.test/ret.jpg', jpeg(800, 600))).toMatchObject({ ok: false, status: 409, motivo: expect.stringMatching(/quadrada/) });
    expect(await caso('https://fotos.exemplo.test/peq.png', png(200, 200))).toMatchObject({ ok: false, motivo: expect.stringMatching(/300 px/) });
    expect(await caso('https://fotos.exemplo.test/gif.gif', Buffer.from('GIF89a-nao-serve'))).toMatchObject({ ok: false, motivo: expect.stringMatching(/não é JPG nem PNG/) });
    expect(await caso('https://fotos.exemplo.test/grande.png', Buffer.concat([png(800, 800), Buffer.alloc(LIMITE_FOTO_IFOOD)]))).toMatchObject({
      ok: false,
      motivo: expect.stringMatching(/até 8 MB/),
    });
    expect(await caso('/api/v1/publico/midia/x.png', null)).toMatchObject({ ok: false, motivo: expect.stringMatching(/só no servidor da loja/) });
    expect(await caso(null, null)).toMatchObject({ ok: false, motivo: expect.stringMatching(/não tem foto no Regem/) });
    expect(await caso('https://fotos.exemplo.test/fora.png', png(800, 800), { no_ifood: false })).toMatchObject({
      ok: false,
      motivo: expect.stringMatching(/não está no iFood com código PDV/),
    });
    expect(await caso('https://fotos.exemplo.test/sumiu.png', null)).toMatchObject({ ok: false, status: 503 });
    expect(chamadas).toHaveLength(0);
  });

  it('o iFood sem o item (pdv_inexistente): a frase manda criar no Gestor; pela conferência vira 409 e fica na auditoria', async () => {
    const l = await loja(COM);
    fotos.set('https://fotos.exemplo.test/sem-item.png', png(600, 600));
    const p = await l.produto({ imagem_ref: 'https://fotos.exemplo.test/sem-item.png', codigo: 'NAO-EXISTE' });
    responder = () => ({
      isError: true,
      content: [{ type: 'text', text: 'Não há item com esse código PDV no iFood.' }],
      structuredContent: { situacao: 'nao_encontrado', codigo: 'pdv_inexistente' },
    });
    const ator = { id: null, perfil: 'presidente' } as any;
    await expect(conferencia.mandarFotoAoIfood(l.t, l.u, { produtoId: p }, ator)).rejects.toThrow(ConflictException);
    await expect(conferencia.mandarFotoAoIfood(l.t, l.u, { produtoId: p }, ator)).rejects.toThrow(/não tem item com o código NAO-EXISTE: crie-o no Gestor de Pedidos/);
    expect(auditados.map((a) => [a.acao, a.detalhe.resultado, a.detalhe.canal])).toEqual([
      ['mandou_foto_ao_ifood', 'recusado', 'ifood'],
      ['mandou_foto_ao_ifood', 'recusado', 'ifood'],
    ]);
    // Imagem grande recusada pela porta (o teto dela) e porta fora do ar: frases próprias.
    responder = () => ({ isError: true, content: [{ type: 'text', text: 'grande' }], structuredContent: { situacao: 'recusado', codigo: 'imagem_grande' } });
    expect(await foto.mandar(l.t, l.u, p)).toMatchObject({ ok: false, status: 409, motivo: expect.stringMatching(/passa de 8 MB/) });
    // O pedido sem o produto: 400 antes de tudo.
    await expect(conferencia.mandarFotoAoIfood(l.t, l.u, {}, ator)).rejects.toThrow(/Escolha o produto/);
  });
});
