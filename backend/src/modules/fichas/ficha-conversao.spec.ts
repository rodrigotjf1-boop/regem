import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../../db/schema';
import { EstoqueService } from '../estoque/estoque.service';
import { VendasService } from '../vendas/vendas.service';
import { FichasService } from './fichas.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

// CONVERSÃO DE UNIDADE NA FICHA TÉCNICA — contra Postgres (TEST_PG_URL).
// Decisão do dono (08/10/2026): o bacon é comprado e guardado em kg, 1 kg = 72 fatias; a ficha do
// lanche leva "2 fatias". A linha é GRAVADA na unidade do estoque (0,02778 kg, a R$ 36 o kg) e
// devolvida como a pessoa informou (2 unidade, a R$ 0,50). Quem baixa (venda) e quem custeia
// (custo da ficha) continua lendo a tabela como sempre — por isso estes testes olham os três:
// o que ficou gravado, o que a tela recebe e o que a VENDA baixa.

const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
jest.setTimeout(60_000);

descrever('ficha técnica com unidade convertida (Postgres real)', () => {
  const empresas: string[] = [];
  let pool: Pool;
  let db: any;
  let fichas: FichasService;
  let estoque: EstoqueService;
  let vendas: VendasService;
  const q = async (s: string, p: any[] = []) => (await pool.query(s, p)).rows;

  async function empresa() {
    const id = randomUUID();
    await q(`insert into empresa (id, nome) values ($1, $2)`, [id, `Conversão teste ${id.slice(0, 6)}`]);
    empresas.push(id);
    return id;
  }
  async function produto(t: string, nome: string, unidade: string, custo: number, conversoes: [string, number, string][] = []) {
    const [{ id }] = await q(`insert into item_estoque (tenant_id, nome, unidade_medida, custo_medio) values ($1, $2, $3, $4) returning id`, [t, nome, unidade, custo]);
    for (const [de, fator, para] of conversoes)
      await q(`insert into item_conversao (tenant_id, item_id, unidade_de, fator, unidade_para) values ($1, $2, $3, $4, $5)`, [t, id, de, fator, para]);
    return id as string;
  }
  const linhaGravada = async (fichaId: string, itemId: string) =>
    (await q(`select quantidade::float8 as quantidade, custo_unitario::float8 as custo, unidade from ficha_ingrediente where ficha_id = $1 and item_id = $2 and deleted_at is null`, [fichaId, itemId]))[0];
  // O que a VENDA baixaria ao vender `porcoes` desta ficha (a rotina de verdade, sem mudança).
  async function baixaDaVenda(t: string, fichaId: string, porcoes: number) {
    const consumo = new Map<string, number>();
    await (vendas as any).acumularFicha(db, t, fichaId, porcoes, consumo, new Set());
    return consumo;
  }

  beforeAll(async () => {
    pool = new Pool({ connectionString: URL_PG });
    db = drizzle(pool, { schema });
    fichas = new FichasService(db);
    estoque = new (EstoqueService as any)(db, { registrar: jest.fn().mockResolvedValue(undefined) }) as EstoqueService;
    vendas = new (VendasService as any)(db) as VendasService;
  });
  afterAll(async () => {
    for (const id of empresas) {
      for (const tabela of ['ficha_ingrediente', 'ficha_tecnica', 'item_conversao', 'item_estoque']) await q(`delete from ${tabela} where tenant_id = $1`, [id]);
      await q(`delete from empresa where id = $1`, [id]);
    }
    await pool.end();
  });

  it('2 fatias de um bacon em kg (1 kg = 72): grava 0,02778 kg; a tela recebe 2 unidade; a venda baixa 0,02778 kg', async () => {
    const t = await empresa();
    const bacon = await produto(t, 'Bacon de teste', 'kg', 36, [['kg', 72, 'unidade']]);
    const f: any = await fichas.create(t, {
      nome: 'Lanche de teste',
      rendimento: 1,
      ingredientes: [{ insumoNome: 'Bacon de teste', itemId: bacon, quantidade: 2, unidade: 'unidade', custoUnitario: 0.5 }],
    } as any);

    const gravada = await linhaGravada(f.id, bacon);
    expect(gravada.quantidade).toBeCloseTo(2 / 72, 10); // unidade do estoque
    expect(gravada.custo).toBeCloseTo(36, 8); // custo por kg
    expect(gravada.unidade).toBe('unidade'); // a escolha da pessoa

    const [linha] = f.ingredientes;
    expect(Number(linha.quantidade)).toBe(2);
    expect(Number(linha.custoUnitario)).toBe(0.5);
    expect(linha).toMatchObject({ unidade: 'unidade', unidadeEstoque: 'kg' });
    expect(linha.quantidadeEstoque).toBeCloseTo(2 / 72, 10);
    expect(linha.fatorUnidade).toBeCloseTo(1 / 72, 12);
    expect(f.custoTotal).toBe(1); // 2 fatias × R$ 0,50 = 0,02778 kg × R$ 36

    expect((await baixaDaVenda(t, f.id, 1)).get(bacon)).toBeCloseTo(2 / 72, 10);
    expect((await baixaDaVenda(t, f.id, 36)).get(bacon)).toBeCloseTo(1, 9); // 36 lanches = 72 fatias = 1 kg
  });

  it('fardo de 12 a R$ 36: 1 unidade na ficha custa R$ 3 e baixa 1/12 de fardo', async () => {
    const t = await empresa();
    const refri = await produto(t, 'Refrigerante de teste', 'fardo', 36, [['fardo', 12, 'unidade']]);
    const f: any = await fichas.create(t, {
      nome: 'Combo de teste',
      rendimento: 1,
      ingredientes: [{ insumoNome: 'Refrigerante de teste', itemId: refri, quantidade: 1, unidade: 'unidade', custoUnitario: 3 }],
    } as any);
    expect((await linhaGravada(f.id, refri)).quantidade).toBeCloseTo(1 / 12, 10);
    expect(f.custoTotal).toBe(3);
    expect((await baixaDaVenda(t, f.id, 12)).get(refri)).toBeCloseTo(1, 9); // 12 vendas = 1 fardo
  });

  it('na unidade do estoque, sem produto ligado ou com unidade que o produto não tem: nada muda', async () => {
    const t = await empresa();
    const bacon = await produto(t, 'Bacon de teste', 'kg', 36, [['kg', 72, 'unidade']]);
    const queijo = await produto(t, 'Queijo de teste', 'kg', 40);
    const f: any = await fichas.create(t, {
      nome: 'Sem conversão de teste',
      rendimento: 1,
      ingredientes: [
        { insumoNome: 'Bacon de teste', itemId: bacon, quantidade: 0.05, unidade: 'kg', custoUnitario: 36 },
        { insumoNome: 'Queijo de teste', itemId: queijo, quantidade: 0.03, unidade: 'fatia', custoUnitario: 40 }, // "fatia" não é unidade do queijo
        { insumoNome: 'Tempero avulso', quantidade: 1, unidade: 'grama', custoUnitario: 0.1 }, // escrito à mão: a unidade vem da lista (09/10/2026)
      ],
    } as any);
    expect((await linhaGravada(f.id, bacon)).quantidade).toBe(0.05);
    expect((await linhaGravada(f.id, queijo)).quantidade).toBe(0.03);
    expect(f.ingredientes.map((i: any) => [Number(i.quantidade), i.fatorUnidade])).toEqual([[0.05, 1], [0.03, 1], [1, 1]]);
    expect(f.custoTotal).toBe(3.1); // 0,05×36 + 0,03×40 + 0,10
  });

  it('abrir e salvar a ficha várias vezes não muda a quantidade gravada', async () => {
    const t = await empresa();
    const bacon = await produto(t, 'Bacon de teste', 'kg', 36, [['kg', 72, 'unidade']]);
    let f: any = await fichas.create(t, {
      nome: 'Ida e volta de teste',
      rendimento: 1,
      ingredientes: [{ insumoNome: 'Bacon de teste', itemId: bacon, quantidade: 3, unidade: 'unidade', custoUnitario: 0.5 }],
    } as any);
    const primeira = (await linhaGravada(f.id, bacon)).quantidade;
    for (let i = 0; i < 4; i++) {
      // a tela devolve o que recebeu
      f = await fichas.update(t, f.id, {
        ingredientes: f.ingredientes.map((l: any) => ({
          insumoNome: l.insumoNome, itemId: l.itemId, quantidade: Number(l.quantidade), unidade: l.unidade,
          fatorCorrecao: Number(l.fatorCorrecao), custoUnitario: Number(l.custoUnitario),
        })),
      } as any);
    }
    expect((await linhaGravada(f.id, bacon)).quantidade).toBeCloseTo(primeira, 12);
    expect(Number(f.ingredientes[0].quantidade)).toBe(3);
    expect(f.custoTotal).toBe(1.5);
  });

  it('mudar a conversão do produto (72 → 60 fatias por kg): a ficha continua com 2 fatias, que passam a pesar mais', async () => {
    const t = await empresa();
    const bacon = await produto(t, 'Bacon de teste', 'kg', 36, [['kg', 72, 'unidade']]);
    const outro = await produto(t, 'Bacon de outra ficha', 'kg', 36, [['kg', 72, 'unidade']]);
    const f: any = await fichas.create(t, {
      nome: 'Conversão que muda de teste',
      rendimento: 1,
      ingredientes: [
        { insumoNome: 'Bacon de teste', itemId: bacon, quantidade: 2, unidade: 'unidade', custoUnitario: 0.5 },
        { insumoNome: 'Bacon de outra ficha', itemId: outro, quantidade: 2, unidade: 'unidade', custoUnitario: 0.5 },
      ],
    } as any);

    const r: any = await estoque.updateItem(t, bacon, { conversoes: [{ unidadeDe: 'kg', fator: 60, unidadePara: 'unidade' }] } as any);
    expect(r.fichasAjustadas).toBe(1);
    expect((await linhaGravada(f.id, bacon)).quantidade).toBeCloseTo(2 / 60, 10);
    expect((await linhaGravada(f.id, bacon)).custo).toBeCloseTo(36, 8); // o custo do kg não mudou
    expect((await linhaGravada(f.id, outro)).quantidade).toBeCloseTo(2 / 72, 10); // outro produto: intocado

    const depois: any = await fichas.getOne(t, f.id);
    const linha = depois.ingredientes.find((l: any) => l.itemId === bacon);
    expect(Number(linha.quantidade)).toBe(2); // o que a pessoa informou
    expect(Number(linha.custoUnitario)).toBeCloseTo(0.6, 10); // R$ 36 ÷ 60
    expect((await baixaDaVenda(t, f.id, 1)).get(bacon)).toBeCloseTo(2 / 60, 10);

    // salvar o produto sem mexer na conversão não regrava nada
    const r2: any = await estoque.updateItem(t, bacon, { conversoes: [{ unidadeDe: 'kg', fator: 60, unidadePara: 'unidade' }] } as any);
    expect(r2.fichasAjustadas).toBe(0);
    const r3: any = await estoque.updateItem(t, bacon, { estoqueMinimo: 2 } as any);
    expect(r3.fichasAjustadas).toBe(0);
  });

  it('tirar a conversão do produto: a baixa da ficha não muda; a linha passa a ser mostrada em kg', async () => {
    const t = await empresa();
    const bacon = await produto(t, 'Bacon de teste', 'kg', 36, [['kg', 72, 'unidade']]);
    const f: any = await fichas.create(t, {
      nome: 'Sem a conversão de teste',
      rendimento: 1,
      ingredientes: [{ insumoNome: 'Bacon de teste', itemId: bacon, quantidade: 2, unidade: 'unidade', custoUnitario: 0.5 }],
    } as any);
    const antes = (await baixaDaVenda(t, f.id, 1)).get(bacon)!;

    const r: any = await estoque.updateItem(t, bacon, { conversoes: [] } as any);
    expect(r.fichasAjustadas).toBe(1);
    const gravada = await linhaGravada(f.id, bacon);
    expect(gravada.unidade).toBe('kg');
    expect(gravada.quantidade).toBeCloseTo(2 / 72, 10);
    expect((await baixaDaVenda(t, f.id, 1)).get(bacon)).toBeCloseTo(antes, 12);
    const depois: any = await fichas.getOne(t, f.id);
    expect(Number(depois.ingredientes[0].quantidade)).toBeCloseTo(2 / 72, 10);
    expect(depois.custoTotal).toBe(1); // o custo da ficha também não mudou
  });

  // MEDIDAS FIXAS (pedido do dono, 12/10/2026): kg e grama, litro e ml o sistema converte sozinho.
  it('produto em kg SEM conversão: 30 grama na ficha gravam 0,03 kg, custam o do kg ÷ 1000 e a venda baixa 0,03 kg', async () => {
    const t = await empresa();
    const queijo = await produto(t, 'Queijo de teste', 'kg', 40);
    const oleo = await produto(t, 'Óleo de teste', 'litro', 10);
    const f: any = await fichas.create(t, {
      nome: 'Em grama de teste',
      rendimento: 1,
      ingredientes: [
        { insumoNome: 'Queijo de teste', itemId: queijo, quantidade: 30, unidade: 'grama', custoUnitario: 0.04 },
        { insumoNome: 'Óleo de teste', itemId: oleo, quantidade: 50, unidade: 'ml', custoUnitario: 0.01 },
      ],
    } as any);

    const gravada = await linhaGravada(f.id, queijo);
    expect(gravada.quantidade).toBeCloseTo(0.03, 12); // unidade do estoque
    expect(gravada.custo).toBeCloseTo(40, 8); // custo por kg
    expect(gravada.unidade).toBe('grama'); // a escolha da pessoa
    expect((await linhaGravada(f.id, oleo)).quantidade).toBeCloseTo(0.05, 12);

    const linha = f.ingredientes.find((l: any) => l.itemId === queijo);
    expect(Number(linha.quantidade)).toBe(30);
    expect(Number(linha.custoUnitario)).toBe(0.04);
    expect(linha).toMatchObject({ unidade: 'grama', unidadeEstoque: 'kg', fatorUnidade: 0.001 });
    expect(f.custoTotal).toBe(1.7); // 30 g × R$ 0,04 + 50 ml × R$ 0,01

    const baixa = await baixaDaVenda(t, f.id, 100); // 100 vendas = 3 kg de queijo e 5 litros de óleo
    expect(baixa.get(queijo)).toBeCloseTo(3, 9);
    expect(baixa.get(oleo)).toBeCloseTo(5, 9);

    // salvar o produto (a tela manda as conversões de novo, vazias) não regrava a linha nem troca a unidade
    const r: any = await estoque.updateItem(t, queijo, { conversoes: [] } as any);
    expect(r.fichasAjustadas).toBe(0);
    expect(await linhaGravada(f.id, queijo)).toMatchObject({ unidade: 'grama' });
  });

  it('guardado em caixa, "1 caixa = 6 kg" e "1 porção = 30 grama": 2 porções gravam 0,01 caixa; a caixa passa a ter 12 kg e a linha acompanha', async () => {
    const t = await empresa();
    const molho = await produto(t, 'Molho de teste', 'caixa', 120, [['caixa', 6, 'kg'], ['porção', 30, 'grama']]);
    const f: any = await fichas.create(t, {
      nome: 'Em porção de teste',
      rendimento: 1,
      ingredientes: [{ insumoNome: 'Molho de teste', itemId: molho, quantidade: 2, unidade: 'porção', custoUnitario: 0.6 }],
    } as any);

    const gravada = await linhaGravada(f.id, molho);
    expect(gravada.quantidade).toBeCloseTo(0.01, 12); // 2 × 30 g = 0,06 kg = 0,01 caixa
    expect(gravada.custo).toBeCloseTo(120, 8); // custo por caixa
    expect(gravada.unidade).toBe('porção');
    const [linha] = f.ingredientes;
    expect(Number(linha.quantidade)).toBe(2);
    expect(Number(linha.custoUnitario)).toBe(0.6); // R$ 120 a caixa de 200 porções
    expect(linha.fatorUnidade).toBeCloseTo(0.005, 12);
    expect(f.custoTotal).toBe(1.2);
    expect((await baixaDaVenda(t, f.id, 100)).get(molho)).toBeCloseTo(1, 9); // 100 vendas = 200 porções = 1 caixa

    // a caixa passa a ter 12 kg: as mesmas 2 porções (60 g) viram 0,005 caixa
    const r: any = await estoque.updateItem(t, molho, {
      conversoes: [{ unidadeDe: 'caixa', fator: 12, unidadePara: 'kg' }, { unidadeDe: 'porção', fator: 30, unidadePara: 'grama' }],
    } as any);
    expect(r.fichasAjustadas).toBe(1);
    expect((await linhaGravada(f.id, molho)).quantidade).toBeCloseTo(0.005, 12);
    const depois: any = await fichas.getOne(t, f.id);
    expect(Number(depois.ingredientes[0].quantidade)).toBe(2);
    expect(Number(depois.ingredientes[0].custoUnitario)).toBeCloseTo(0.3, 9); // R$ 120 a caixa de 400 porções
  });

  it('linha de sub-receita não é convertida', async () => {
    const t = await empresa();
    const bacon = await produto(t, 'Bacon de teste', 'kg', 36, [['kg', 72, 'unidade']]);
    const sub: any = await fichas.create(t, {
      nome: 'Sub-receita de teste',
      rendimento: 4,
      ingredientes: [{ insumoNome: 'Bacon de teste', itemId: bacon, quantidade: 8, unidade: 'unidade', custoUnitario: 0.5 }],
    } as any);
    const pai: any = await fichas.create(t, {
      nome: 'Prato de teste',
      rendimento: 1,
      ingredientes: [{ insumoNome: 'Sub-receita de teste', subFichaId: sub.id, quantidade: 1, unidade: 'unidade' }],
    } as any);
    expect(Number(pai.ingredientes[0].quantidade)).toBe(1);
    expect(pai.ingredientes[0].fatorUnidade).toBe(1);
    expect(pai.custoTotal).toBe(1); // 1 porção da sub-receita = 8 fatias ÷ 4 = 2 fatias = R$ 1,00
    expect((await baixaDaVenda(t, pai.id, 1)).get(bacon)).toBeCloseTo(2 / 72, 10);
  });
});
