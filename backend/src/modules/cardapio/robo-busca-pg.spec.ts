import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../../db/schema';
import { CardapioService } from './cardapio.service';
import { procurarNoCardapio } from './robo-busca';

/* eslint-disable @typescript-eslint/no-explicit-any */

// OS INGREDIENTES DA FICHA PARA A BUSCA DO ROBÔ (Fase 5, F2) contra o Postgres real: a consulta recursiva desce nas
// sub-receitas, deixa de fora as linhas de embalagem (delivery/balcão) e as apagadas, e devolve o que cada combo leva.
const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('robo-busca-pg.spec: sem TEST_PG_URL — PULADO');

jest.setTimeout(60_000);

descrever('busca do robô — ingredientes da ficha (Postgres)', () => {
  let pool: Pool;
  let svc: CardapioService;
  const T = randomUUID();
  const TOKEN = `robo-busca-${randomUUID().slice(0, 8)}`;
  const id = () => randomUUID();
  const P = { smash: id(), trio: id(), coca: id(), semFicha: id() };
  const F = { smash: id(), molho: id() };
  const I = { bacon: id(), carne: id() };
  const q = async (s: string, p: any[] = []) => (await pool.query(s, p)).rows;

  beforeAll(async () => {
    pool = new Pool({ connectionString: URL_PG });
    const u: any = {};
    svc = new CardapioService(drizzle(pool, { schema }) as any, u, u, u, u, u, u, u);
    await q(`insert into empresa (id, nome) values ($1, 'teste busca do robô')`, [T]);
    await q(`insert into cardapio_config (tenant_id, token, ativo) values ($1, $2, true)`, [T, TOKEN]);
    await q(`insert into item_estoque (id, tenant_id, nome) values ($1, $3, 'Bacon em cubos'), ($2, $3, 'Carne bovina moída')`, [I.bacon, I.carne, T]);
    await q(`insert into ficha_tecnica (id, tenant_id, nome) values ($1, $3, 'Smash da casa'), ($2, $3, 'Molho especial')`, [F.smash, F.molho, T]);
    // Sub-receita: o molho leva o bacon.
    await q(`insert into ficha_ingrediente (tenant_id, ficha_id, item_id, insumo_nome) values ($1, $2, $3, 'Bacon em cubos')`, [T, F.molho, I.bacon]);
    await q(
      `insert into ficha_ingrediente (tenant_id, ficha_id, item_id, sub_ficha_id, insumo_nome, somente_delivery, somente_balcao, deleted_at) values
         ($1, $2, $3, null, 'Carne bovina moída', false, false, null),
         ($1, $2, null, $4, 'Molho especial', false, false, null),
         ($1, $2, null, null, 'Caixa kraft delivery', true, false, null),
         ($1, $2, null, null, 'Sachê de ketchup balcão', false, true, null),
         ($1, $2, null, null, 'Cebola roxa', false, false, now())`,
      [T, F.smash, I.carne, F.molho],
    );
    await q(
      `insert into produto (id, tenant_id, nome, ficha_id) values ($1, $5, 'Smash da Casa', $6), ($2, $5, 'Trio Smash', null),
         ($3, $5, 'Coca lata', null), ($4, $5, 'X Simples', null)`,
      [P.smash, P.trio, P.coca, P.semFicha, T, F.smash],
    );
    await q(
      `insert into produto_combo_item (tenant_id, combo_produto_id, componente_produto_id) values ($1, $2, $3), ($1, $2, $4)`,
      [T, P.trio, P.smash, P.coca],
    );
  });
  afterAll(async () => {
    if (!pool) return;
    await q(`delete from produto_combo_item where tenant_id = $1`, [T]).catch(() => {});
    await q(`delete from produto where tenant_id = $1`, [T]).catch(() => {});
    await q(`delete from ficha_ingrediente where tenant_id = $1`, [T]).catch(() => {});
    await q(`delete from ficha_tecnica where tenant_id = $1`, [T]).catch(() => {});
    await q(`delete from item_estoque where tenant_id = $1`, [T]).catch(() => {});
    await q(`delete from cardapio_config where tenant_id = $1`, [T]).catch(() => {});
    await q(`delete from empresa where id = $1`, [T]).catch(() => {});
    await pool.end();
  });

  it('desce na sub-receita, tira embalagem e linha apagada; o combo diz o que leva', async () => {
    const { ingredientes, componentes } = await svc.dadosDaBuscaDoRobo(TOKEN);
    const smash = ingredientes.get(P.smash)!;
    expect(smash).toBeDefined();
    for (const w of ['bacon', 'cubo', 'carne', 'molho', 'especial']) expect(smash.has(w)).toBe(true);
    for (const w of ['caixa', 'kraft', 'sache', 'ketchup', 'cebola']) expect(smash.has(w)).toBe(false);
    expect(ingredientes.has(P.semFicha)).toBe(false); // sem ficha: a busca usa a descrição
    expect(componentes.get(P.trio)?.sort()).toEqual([P.smash, P.coca].sort());
  });

  it('de ponta a ponta: "tem hambúrguer com bacon?" acha o Smash pela sub-receita e o Trio pelo combo', async () => {
    const dados = await svc.dadosDaBuscaDoRobo(TOKEN);
    const menu = {
      categorias: [{ id: 'c1', nome: 'Hambúrgueres' }],
      produtos: [
        { id: P.smash, nome: 'Smash da Casa', precoVenda: 29, categoriaId: 'c1', descricao: 'O nosso smash', grupos: [] },
        { id: P.trio, nome: 'Trio Smash', precoVenda: 39, categoriaId: 'c1', descricao: 'Smash + coca', grupos: [] },
        { id: P.semFicha, nome: 'X Simples', precoVenda: 18, categoriaId: 'c1', descricao: 'Pão, carne e queijo', grupos: [] },
      ],
    };
    const r: any = procurarNoCardapio(menu, 'tem hambúrguer com bacon?', { ...dados, linkDoProduto: (x) => svc.linkDoProduto(TOKEN, x) });
    expect(r.levam.map((x: any) => x.nome).sort()).toEqual(['Smash da Casa', 'Trio Smash']);
    expect(r.levam.find((x: any) => x.nome === 'Smash da Casa').porque).toBe('ficha');
    expect(r.levam[0].link).toContain(`/c/${TOKEN}?produto=`);
    expect(JSON.stringify(r)).not.toMatch(/cubos|kraft|moída/);
  });

  it('token de outra loja não enxerga esta ficha', async () => {
    const outro = randomUUID();
    const tokenOutro = `robo-busca-${randomUUID().slice(0, 8)}`;
    await q(`insert into empresa (id, nome) values ($1, 'outra')`, [outro]);
    await q(`insert into cardapio_config (tenant_id, token, ativo) values ($1, $2, true)`, [outro, tokenOutro]);
    try {
      const { ingredientes, componentes } = await svc.dadosDaBuscaDoRobo(tokenOutro);
      expect(ingredientes.size).toBe(0);
      expect(componentes.size).toBe(0);
    } finally {
      await q(`delete from cardapio_config where tenant_id = $1`, [outro]);
      await q(`delete from empresa where id = $1`, [outro]);
    }
  });
});
