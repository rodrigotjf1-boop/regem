import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../../db/schema';
import { hojeISO, somarDias } from '../../common/data';
import { CashbackService } from '../cashback/cashback.service';
import { FidelidadeService } from '../fidelidade/fidelidade.service';
import { CardapioService } from './cardapio.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

// O DESTINO E O PERÍODO DO BANNER (fase B3 do `docs/plano-clube-e-banner.md`; mig 482) — contra Postgres (TEST_PG_URL),
// pelas portas de verdade: `setBanners` (a tela de Banners) e `menu` (o cardápio público).

const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('banner-destino-pg.spec: sem TEST_PG_URL — PULADO');
jest.setTimeout(120_000);

descrever('o destino e o período do banner (Postgres)', () => {
  const pool = new Pool({ connectionString: URL_PG });
  const db = drizzle(pool, { schema }) as any;
  const eventos = { emit: () => true } as any;
  const auditoria = { registrar: async () => undefined } as any;
  const cardapio = new CardapioService(db, {} as any, {} as any, {} as any, new FidelidadeService(db), new CashbackService(db), eventos, {} as any, auditoria);
  const empresas: string[] = [];
  const q = (s: string, p: any[] = []) => pool.query(s, p).then((r) => r.rows);
  const IMG = 'https://exemplo.com/banner.jpg';

  beforeAll(async () => {
    for (const t of ['edge_status', 'edge_heartbeat'])
      await pool
        .query(`create table if not exists ${t} (id uuid primary key default gen_random_uuid(), tenant_id uuid, unidade_id uuid, recebido_em timestamptz not null default now())`)
        .catch((e: any) => {
          if (!['23505', '42P07'].includes(e?.code)) throw e;
        });
  });
  afterAll(async () => {
    if (empresas.length) {
      for (const t of ['banner', 'cardapio_config', 'unidade']) await pool.query(`delete from ${t} where tenant_id = any($1::uuid[])`, [empresas]).catch(() => {});
      await pool.query(`delete from vaga_pagina where tenant_id = any($1::uuid[])`, [empresas]).catch(() => {});
      await pool.query('delete from empresa where id = any($1::uuid[])', [empresas]).catch(() => {});
    }
    await pool.end();
  });

  async function loja() {
    const t = (await q(`insert into empresa (nome) values ('teste banner destino') returning id`))[0].id as string;
    empresas.push(t);
    const u = (await q(`insert into unidade (tenant_id, nome) values ($1,'Loja de teste') returning id`, [t]))[0].id as string;
    const token = `tk-${randomUUID()}`;
    await q(`insert into cardapio_config (tenant_id, unidade_id, token, ativo, modo) values ($1,$2,$3,true,'retirada')`, [t, u, token]);
    return { t, u, token };
  }

  it('toda recusa antes de apagar: o destino e o período errados não mexem nos banners de hoje', async () => {
    const l = await loja();
    await cardapio.setBanners(l.t, l.u, [{ imagemRef: IMG, link: 'clube:premios' }]);
    await expect(
      cardapio.setBanners(l.t, l.u, [
        { imagemRef: IMG, link: 'vagas' },
        { imagemRef: IMG, link: 'http://sem-https.com' },
      ]),
    ).rejects.toThrow('Banner 2: o link externo precisa começar com https://.');
    await expect(cardapio.setBanners(l.t, l.u, [{ imagemRef: IMG, apareceDe: '2026-12-10', apareceAte: '2026-12-01' }])).rejects.toThrow(
      'Banner 1: "até" vem antes de "aparece de".',
    );
    const ficou = await q(`select link from banner where tenant_id = $1`, [l.t]);
    expect(ficou).toEqual([{ link: 'clube:premios' }]);
  });

  it('o cardápio público só mostra o banner no período; "vagas" vira o endereço da página de vagas da loja', async () => {
    const l = await loja();
    const hoje = hojeISO();
    const lista = await cardapio.setBanners(l.t, l.u, [
      { imagemRef: IMG, titulo: 'Clube', link: 'clube:premios', apareceDe: somarDias(hoje, -1), apareceAte: somarDias(hoje, 5) },
      { imagemRef: IMG, titulo: 'Vagas', link: 'vagas' },
      { imagemRef: IMG, titulo: 'Futuro', link: 'https://exemplo.com/promo', apareceDe: somarDias(hoje, 2) },
    ]);
    expect(lista.map((b: any) => [b.link, b.apareceDe, b.apareceAte])).toEqual([
      ['clube:premios', somarDias(hoje, -1), somarDias(hoje, 5)],
      ['vagas', null, null],
      ['https://exemplo.com/promo', somarDias(hoje, 2), null],
    ]);
    // A página de vagas é só da nuvem (mig 389): com ela ligada, o link leva o código; sem a tabela, o banner fica sem ação.
    const [{ existe }] = await q(`select to_regclass('vaga_pagina') is not null as existe`);
    const codigo = `vagas${randomUUID().slice(0, 8)}`;
    if (existe) await q(`insert into vaga_pagina (tenant_id, unidade_id, codigo, ligada) values ($1,$2,$3,true)`, [l.t, l.u, codigo]);
    const m: any = await cardapio.menu(l.token);
    expect(m.banners).toEqual([
      { imagemRef: IMG, titulo: 'Clube', link: 'clube:premios' },
      { imagemRef: IMG, titulo: 'Vagas', link: existe ? `vagas:${codigo}` : null },
    ]);
    // a página desligada: o banner de vagas fica sem ação
    if (existe) {
      await q(`update vaga_pagina set ligada = false where tenant_id = $1`, [l.t]);
      const m2: any = await cardapio.menu(l.token);
      expect(m2.banners[1]).toEqual({ imagemRef: IMG, titulo: 'Vagas', link: null });
    }
  });

  it('B2 (mig 485): o texto por cima e a descrição gravam, voltam na lista e chegam ao cardápio; vazio não vai', async () => {
    const l = await loja();
    const lista = await cardapio.setBanners(l.t, l.u, [
      { imagemRef: IMG, textoTitulo: '  Sextou   com bacon ', textoChamada: 'Duplo bacon', descricao: 'Hambúrguer duplo', feitoComIa: true },
      { imagemRef: IMG, titulo: 'Sem texto', textoTitulo: '   ' },
    ]);
    expect(lista.map((b: any) => [b.textoTitulo, b.textoChamada, b.descricao, b.feitoComIa])).toEqual([
      ['Sextou com bacon', 'Duplo bacon', 'Hambúrguer duplo', true],
      [null, null, null, false],
    ]);
    const m: any = await cardapio.menu(l.token);
    expect(m.banners).toEqual([
      { imagemRef: IMG, titulo: null, link: null, textoTitulo: 'Sextou com bacon', textoChamada: 'Duplo bacon', descricao: 'Hambúrguer duplo' },
      { imagemRef: IMG, titulo: 'Sem texto', link: null },
    ]);
  });

  it('mig 487: o GIF grava, volta na lista e chega ao cardápio ao lado da imagem parada; sem GIF, o campo não vai', async () => {
    const l = await loja();
    const GIF_DO_BANNER = 'https://midia.exemplo.test/storage/v1/object/public/midia/t/b.gif';
    const lista = await cardapio.setBanners(l.t, l.u, [
      { imagemRef: IMG, imagemAnimadaRef: ` ${GIF_DO_BANNER} ` },
      { imagemRef: IMG, imagemAnimadaRef: '' },
    ]);
    expect(lista.map((b: any) => b.imagemAnimadaRef)).toEqual([GIF_DO_BANNER, null]);
    const m: any = await cardapio.menu(l.token);
    expect(m.banners[0]).toEqual({ imagemRef: IMG, titulo: null, link: null, imagemAnimadaRef: GIF_DO_BANNER });
    expect(m.banners[1]).toEqual({ imagemRef: IMG, titulo: null, link: null });
  });

  it('mig 487: o que não é um GIF por https é recusado antes de apagar os banners de hoje', async () => {
    const l = await loja();
    await cardapio.setBanners(l.t, l.u, [{ imagemRef: IMG, textoTitulo: 'Fica' }]);
    for (const torto of ['http://midia.exemplo.test/b.gif', 'https://midia.exemplo.test/b.png', 'javascript:alert(1)//.gif', `https://m.test/${'x'.repeat(500)}.gif`]) {
      await expect(cardapio.setBanners(l.t, l.u, [{ imagemRef: IMG, imagemAnimadaRef: torto }])).rejects.toThrow('Banner 1: a animação precisa ser um GIF');
    }
    expect(await q(`select texto_titulo from banner where tenant_id = $1`, [l.t])).toEqual([{ texto_titulo: 'Fica' }]);
  });

  it('B2: o texto longo demais é recusado antes de apagar os banners de hoje', async () => {
    const l = await loja();
    await cardapio.setBanners(l.t, l.u, [{ imagemRef: IMG, textoTitulo: 'Fica' }]);
    await expect(cardapio.setBanners(l.t, l.u, [{ imagemRef: IMG, textoTitulo: 'x'.repeat(61) }])).rejects.toThrow('Banner 1: o título passa de 60 letras.');
    await expect(cardapio.setBanners(l.t, l.u, [{ imagemRef: IMG, descricao: 'x'.repeat(201) }])).rejects.toThrow('Banner 1: o texto para leitor de tela passa de 200 letras.');
    expect(await q(`select texto_titulo from banner where tenant_id = $1`, [l.t])).toEqual([{ texto_titulo: 'Fica' }]);
  });

  it('o período que já passou some do cardápio; o banner desligado também', async () => {
    const l = await loja();
    const hoje = hojeISO();
    await cardapio.setBanners(l.t, l.u, [
      { imagemRef: IMG, titulo: 'Passou', apareceAte: somarDias(hoje, -1) },
      { imagemRef: IMG, titulo: 'Desligado', ativo: false },
      { imagemRef: IMG, titulo: 'Hoje', apareceDe: hoje, apareceAte: hoje },
    ]);
    const m: any = await cardapio.menu(l.token);
    expect(m.banners.map((b: any) => b.titulo)).toEqual(['Hoje']);
  });
});
