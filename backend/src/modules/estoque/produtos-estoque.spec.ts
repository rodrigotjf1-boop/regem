import { randomUUID } from 'node:crypto';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../../db/schema';
import { escreverXlsx } from '../../common/escrever-planilha';
import { lerXlsx } from '../cliente/ler-xlsx';
import { EstoqueService } from './estoque.service';
import { ProdutosPlanilhaService } from './produtos-planilha.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

// CADASTRO DE PRODUTOS DO ESTOQUE — contra Postgres (TEST_PG_URL): unidade da lista fechada,
// nome que não se repete (inclusive com duas gravações ao mesmo tempo), vários setores
// (mig 307), exclusão com as travas, ajuste pelo saldo contado e importação/exportação.

const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
jest.setTimeout(60_000);

descrever('produtos do estoque (Postgres real)', () => {
  const empresas: string[] = [];
  let pool: Pool;
  let db: any;
  const auditoria = { registrar: jest.fn().mockResolvedValue(undefined) };
  const q = async (s: string, p: any[] = []) => (await pool.query(s, p)).rows;
  const estoque = () => new (EstoqueService as any)(db, auditoria) as EstoqueService;
  const planilha = () => new (ProdutosPlanilhaService as any)(db, estoque(), auditoria) as ProdutosPlanilhaService;
  const ator = { colaboradorId: undefined, categoria: 'gerente' };

  async function empresa() {
    const id = randomUUID();
    await q(`insert into empresa (id, nome) values ($1, $2)`, [id, `Estoque teste ${id.slice(0, 6)}`]);
    empresas.push(id);
    return id;
  }
  const loja = async (t: string, nome: string) =>
    (await q(`insert into unidade (tenant_id, nome) values ($1, $2) returning id`, [t, nome]))[0].id as string;
  const setor = async (t: string, u: string, nome: string) =>
    (await q(`insert into setor (tenant_id, unidade_id, nome) values ($1, $2, $3) returning id`, [t, u, nome]))[0].id as string;
  const fornecedor = async (t: string, nome: string) =>
    (await q(`insert into fornecedor (tenant_id, nome) values ($1, $2) returning id`, [t, nome]))[0].id as string;
  const item = async (t: string) => q(`select * from item_estoque where tenant_id = $1 order by created_at, nome`, [t]);
  const saldo = async (id: string) =>
    Number(
      (
        await q(
          `select coalesce(sum(case tipo when 'entrada' then quantidade when 'saida' then -quantidade else quantidade end), 0) as s
             from movimento_estoque where item_id = $1`,
          [id],
        )
      )[0].s,
    );

  beforeAll(async () => {
    pool = new Pool({ connectionString: URL_PG });
    db = drizzle(pool, { schema });
  });
  afterAll(async () => {
    for (const id of empresas) {
      for (const tabela of [
        'movimento_estoque', 'ficha_ingrediente', 'ficha_tecnica', 'produto', 'opcao', 'item_conversao',
        'item_fornecedor', 'item_estoque_unidade', 'item_estoque', 'categoria_item', 'fornecedor', 'setor', 'unidade',
      ]) {
        await q(`delete from ${tabela} where tenant_id = $1`, [id]);
      }
      await q(`delete from empresa where id = $1`, [id]);
    }
    await pool.end();
  });

  // ── unidade de medida ──────────────────────────────────────────────────────────────────
  it('unidade: grava a da lista ("L" → litro), recusa a inventada e não deixa nada pela metade', async () => {
    const t = await empresa();
    const s = estoque();
    const a = await s.createItem(t, { nome: '  Suco   de teste ', unidadeMedida: 'L', conversoes: [{ unidadeDe: 'caixa', fator: 12, unidadePara: 'L' }] } as any);
    expect(a).toMatchObject({ nome: 'Suco de teste', unidadeMedida: 'litro' });
    expect(await q(`select unidade_de, unidade_para, fator::float8 as fator from item_conversao where item_id = $1`, [a.id])).toEqual([
      { unidade_de: 'caixa', unidade_para: 'litro', fator: 12 },
    ]);
    const semUnidade = await s.createItem(t, { nome: 'Sal de teste' } as any);
    expect(semUnidade.unidadeMedida).toBe('unidade');

    await expect(s.createItem(t, { nome: 'Outro de teste', unidadeMedida: 'bandejinha' } as any)).rejects.toThrow(BadRequestException);
    await expect(
      s.createItem(t, { nome: 'Outro de teste', unidadeMedida: 'kg', conversoes: [{ unidadeDe: 'saquinho', fator: 2, unidadePara: 'kg' }] } as any),
    ).rejects.toThrow(/Conversão.*"saquinho"/);
    await expect(
      s.createItem(t, { nome: 'Outro de teste', unidadeMedida: 'kg', conversoes: [{ unidadeDe: 'kg', fator: 2, unidadePara: 'quilo' }] } as any),
    ).rejects.toThrow(/duas unidades são "kg"/);
    expect((await item(t)).map((i) => i.nome).sort()).toEqual(['Sal de teste', 'Suco de teste']); // nada do recusado ficou

    // editar com unidade inventada: recusa e mantém a conversão que existia
    await expect(
      s.updateItem(t, a.id, { nome: 'Suco de teste', conversoes: [{ unidadeDe: 'garrafão', fator: 5, unidadePara: 'litro' }] } as any),
    ).rejects.toThrow(BadRequestException);
    expect(await q(`select count(*)::int as n from item_conversao where item_id = $1`, [a.id])).toEqual([{ n: 1 }]);
    const editado = await s.updateItem(t, a.id, { nome: 'Suco de teste', unidadeMedida: 'cx' } as any);
    expect(editado.unidadeMedida).toBe('caixa');
  });

  // ── nome repetido ──────────────────────────────────────────────────────────────────────
  it('nome: recusa o repetido sem olhar maiúscula, acento e espaço; outra empresa e produto excluído não contam', async () => {
    const t = await empresa();
    const outra = await empresa();
    const s = estoque();
    const a = await s.createItem(t, { nome: 'Açúcar de Teste', unidadeMedida: 'kg' } as any);
    await expect(s.createItem(t, { nome: '  acucar   DE teste ', unidadeMedida: 'kg' } as any)).rejects.toThrow(ConflictException);
    await expect(s.createItem(t, { nome: 'açúcar-de-teste', unidadeMedida: 'saco' } as any)).rejects.toThrow(/Já existe um produto com este nome: "Açúcar de Teste"/);
    expect(await item(t)).toHaveLength(1);
    await expect(s.createItem(outra, { nome: 'Açúcar de Teste', unidadeMedida: 'kg' } as any)).resolves.toMatchObject({ nome: 'Açúcar de Teste' });
    await expect(s.createItem(t, { nome: '   ', unidadeMedida: 'kg' } as any)).rejects.toThrow(/Dê um nome/);

    await s.removerItem(t, a.id, null, ator);
    await expect(s.createItem(t, { nome: 'açúcar de teste', unidadeMedida: 'kg' } as any)).resolves.toMatchObject({ nome: 'açúcar de teste' });
  });

  it('nome: produto exclusivo de uma loja só esbarra na própria loja e no cadastro compartilhado', async () => {
    const t = await empresa();
    const a = await loja(t, 'Loja A');
    const b = await loja(t, 'Loja B');
    const s = estoque();
    await s.createItem(t, { nome: 'Gelo de teste', unidadeMedida: 'saco' } as any, a);
    await expect(s.createItem(t, { nome: 'Gelo de teste', unidadeMedida: 'saco' } as any, b)).resolves.toBeTruthy(); // outra loja: pode
    await expect(s.createItem(t, { nome: 'gelo de teste', unidadeMedida: 'saco' } as any, a)).rejects.toThrow(ConflictException);
    await expect(s.createItem(t, { nome: 'GELO DE TESTE', unidadeMedida: 'saco' } as any, null)).rejects.toThrow(ConflictException); // compartilhado esbarra em todos
    await s.createItem(t, { nome: 'Copo de teste', unidadeMedida: 'pacote' } as any, null); // compartilhado
    await expect(s.createItem(t, { nome: 'copo de teste', unidadeMedida: 'pacote' } as any, b)).rejects.toThrow(ConflictException);
  });

  it('nome: duas gravações ao mesmo tempo — a segunda ESPERA a primeira e é recusada', async () => {
    const t = await empresa();
    const s = estoque();
    // 1ª gravação: transação aberta, com a trava do cadastro e a linha ainda invisível para os outros.
    const c = await pool.connect();
    let estado = 'esperando';
    let noMeio = '';
    let segunda: Promise<unknown> = Promise.resolve();
    try {
      await c.query('begin');
      await c.query(`select pg_advisory_xact_lock(hashtext($1), 1)`, [t]);
      await c.query(`insert into item_estoque (tenant_id, nome, unidade_medida) values ($1, 'Manteiga de teste', 'kg')`, [t]);
      segunda = s.createItem(t, { nome: 'manteiga de teste', unidadeMedida: 'kg' } as any).then(
        () => (estado = 'gravou'),
        (e) => (estado = e instanceof ConflictException ? 'recusada' : `erro: ${e?.message}`),
      );
      await new Promise((r) => setTimeout(r, 600));
      noMeio = estado;
      await c.query('commit');
    } finally {
      c.release(); // solta a conexão mesmo se algo falhar — senão a suíte fica pendurada
    }
    await segunda;
    expect(noMeio).toBe('esperando'); // sem a trava, ela teria passado pela conferência e gravado
    expect(estado).toBe('recusada');
    expect(await item(t)).toHaveLength(1);
  });

  it('nome: editar só confere quando o nome MUDA (o repetido antigo segue editável)', async () => {
    const t = await empresa();
    const s = estoque();
    const a = await s.createItem(t, { nome: 'Arroz de teste', unidadeMedida: 'kg' } as any);
    const b = await s.createItem(t, { nome: 'Feijão de teste', unidadeMedida: 'kg' } as any);
    await expect(s.updateItem(t, b.id, { nome: 'arroz DE teste' } as any)).rejects.toThrow(ConflictException);
    await expect(s.updateItem(t, a.id, { nome: 'ARROZ de teste', estoqueMinimo: 4 } as any)).resolves.toMatchObject({ nome: 'ARROZ de teste', estoqueMinimo: '4' });
    // dois produtos com o mesmo nome, de antes desta regra (gravados direto no banco)
    const [d1] = await q(`insert into item_estoque (tenant_id, nome, unidade_medida) values ($1, 'Cobertura de teste', 'pote') returning id`, [t]);
    await q(`insert into item_estoque (tenant_id, nome, unidade_medida) values ($1, 'Cobertura de teste', 'pote')`, [t]);
    await expect(s.updateItem(t, d1.id, { nome: 'Cobertura de teste', estoqueMinimo: 2 } as any)).resolves.toMatchObject({ estoqueMinimo: '2' });
    await expect(s.updateItem(t, d1.id, { nome: 'Cobertura de teste 2' } as any)).resolves.toMatchObject({ nome: 'Cobertura de teste 2' });
    await expect(s.updateItem(t, d1.id, { nome: 'Cobertura de teste' } as any)).rejects.toThrow(ConflictException); // voltar a repetir: não
  });

  // ── setores ────────────────────────────────────────────────────────────────────────────
  it('setores: vários por produto (o 1º é o principal), o campo antigo mexe só no principal, e setor alheio é recusado', async () => {
    const t = await empresa();
    const u = await loja(t, 'Loja única');
    const [dep, camara, bar] = [await setor(t, u, 'Depósito'), await setor(t, u, 'Câmara fria'), await setor(t, u, 'Bar')];
    const f1 = await fornecedor(t, 'Atacado de teste');
    const f2 = await fornecedor(t, 'Distribuidora de teste');
    const s = estoque();
    const a = await s.createItem(t, { nome: 'Refri de teste', unidadeMedida: 'fardo', setorIds: [camara, dep, camara, bar], fornecedorIds: [f2, f1] } as any);
    expect(a).toMatchObject({ setorId: camara, setoresExtras: [dep, bar] });
    const ler = async () => (await s.listItens(t, true, null)).find((i: any) => i.id === a.id);
    expect(await ler()).toMatchObject({
      setorIds: [camara, dep, bar], setorNomes: ['Câmara fria', 'Depósito', 'Bar'],
      fornecedorIds: expect.arrayContaining([f1, f2]), fornecedorNomes: expect.arrayContaining(['Atacado de teste', 'Distribuidora de teste']),
    });
    expect((await ler()).fornecedorIds[0]).toBe(f2); // o principal vem primeiro

    // tela antiga (servidor de loja ainda sem esta versão): manda só `setorId`
    await s.updateItem(t, a.id, { nome: 'Refri de teste', setorId: bar } as any);
    expect((await ler()).setorIds).toEqual([bar, dep]); // principal trocou; extras mantidos, sem repetir o Bar
    // sem nenhum dos dois campos: não mexe
    await s.updateItem(t, a.id, { nome: 'Refri de teste', estoqueMinimo: 3 } as any);
    expect((await ler()).setorIds).toEqual([bar, dep]);
    // lista vazia: tira todos
    await s.updateItem(t, a.id, { nome: 'Refri de teste', setorIds: [] } as any);
    expect(await ler()).toMatchObject({ setorId: null, setorIds: [], setorNomes: [] });

    // setor de outra empresa e setor excluído
    const outra = await empresa();
    const alheio = await setor(outra, await loja(outra, 'Loja alheia'), 'Setor alheio');
    await expect(s.updateItem(t, a.id, { nome: 'Refri de teste', setorIds: [dep, alheio] } as any)).rejects.toThrow(/Setor de estoque não encontrado/);
    await expect(s.createItem(t, { nome: 'Novo de teste', unidadeMedida: 'kg', setorId: alheio } as any)).rejects.toThrow(BadRequestException);
    await s.updateItem(t, a.id, { nome: 'Refri de teste', setorIds: [dep, bar] } as any);
    await q(`update setor set deleted_at = now() where id = $1`, [dep]);
    expect(await ler()).toMatchObject({ setorIds: [bar], setorNomes: ['Bar'] }); // o excluído não aparece
  });

  // ── movimento ──────────────────────────────────────────────────────────────────────────
  it('ajuste pelo saldo CONTADO: o servidor grava a diferença; contou e bateu não lança nada', async () => {
    const t = await empresa();
    const s = estoque();
    const a = await s.createItem(t, { nome: 'Farinha de teste', unidadeMedida: 'kg' } as any);
    await s.createMovimento(t, { itemId: a.id, tipo: 'entrada', quantidade: 0.1 } as any, null, ator);
    await s.createMovimento(t, { itemId: a.id, tipo: 'entrada', quantidade: 0.2 } as any, null, ator);
    // 0,1 + 0,2 em ponto flutuante dá 0,30000000000000004 — a conta é do banco, em numeric
    await expect(s.createMovimento(t, { itemId: a.id, tipo: 'ajuste', saldoContado: 0.3 } as any, null, ator)).resolves.toEqual({ id: null, semMudanca: true });
    expect(await q(`select count(*)::int as n from movimento_estoque where item_id = $1`, [a.id])).toEqual([{ n: 2 }]);

    const mv: any = await s.createMovimento(t, { itemId: a.id, tipo: 'ajuste', saldoContado: 5, motivo: 'contagem' } as any, null, ator);
    expect(mv).toMatchObject({ tipo: 'ajuste', quantidade: '4.7', motivo: 'contagem' });
    expect(await saldo(a.id)).toBe(5);
    await s.createMovimento(t, { itemId: a.id, tipo: 'ajuste', saldoContado: 1.25 } as any, null, ator);
    expect(await saldo(a.id)).toBe(1.25);
    // ajuste pela diferença (como sempre foi) continua valendo
    await s.createMovimento(t, { itemId: a.id, tipo: 'ajuste', quantidade: -0.25 } as any, null, ator);
    expect(await saldo(a.id)).toBe(1);

    for (const ruim of [
      { tipo: 'entrada', quantidade: 0 }, { tipo: 'entrada', quantidade: -2 }, { tipo: 'saida', quantidade: -1 },
      { tipo: 'ajuste', quantidade: 0 }, { tipo: 'saida' },
    ])
      await expect(s.createMovimento(t, { itemId: a.id, ...ruim } as any, null, ator)).rejects.toThrow(BadRequestException);
    expect(await saldo(a.id)).toBe(1);
  });

  it('ajuste pelo saldo contado numa empresa de duas lojas: a conta é com o saldo DA LOJA', async () => {
    const t = await empresa();
    const a = await loja(t, 'Loja A');
    const b = await loja(t, 'Loja B');
    const s = estoque();
    const it = await s.createItem(t, { nome: 'Óleo de teste', unidadeMedida: 'litro' } as any, null); // compartilhado
    await s.createMovimento(t, { itemId: it.id, tipo: 'entrada', quantidade: 10 } as any, a, ator);
    await s.createMovimento(t, { itemId: it.id, tipo: 'entrada', quantidade: 4 } as any, b, ator);
    await s.createMovimento(t, { itemId: it.id, tipo: 'ajuste', saldoContado: 7 } as any, a, ator);
    const porLoja = await q(
      `select unidade_id, sum(case tipo when 'entrada' then quantidade when 'saida' then -quantidade else quantidade end)::float8 as s
         from movimento_estoque where item_id = $1 group by unidade_id`,
      [it.id],
    );
    expect(Object.fromEntries(porLoja.map((r: any) => [r.unidade_id, r.s]))).toEqual({ [a]: 7, [b]: 4 });
  });

  // ── exclusão ───────────────────────────────────────────────────────────────────────────
  it('excluir: recusa com saldo, em ficha técnica ou ligado ao cardápio — dizendo qual; liberado, marca e some das listas', async () => {
    const t = await empresa();
    const s = estoque();
    auditoria.registrar.mockClear();
    const a = await s.createItem(t, { nome: 'Queijo de teste', unidadeMedida: 'kg' } as any);
    await s.createMovimento(t, { itemId: a.id, tipo: 'entrada', quantidade: 11.6 } as any, null, ator);
    const [ficha] = await q(`insert into ficha_tecnica (tenant_id, nome) values ($1, 'X-teste') returning id`, [t]);
    await q(`insert into ficha_ingrediente (tenant_id, ficha_id, item_id, insumo_nome, quantidade) values ($1, $2, $3, 'Queijo de teste', 0.05)`, [t, ficha.id, a.id]);
    const [prod] = await q(`insert into produto (tenant_id, nome, item_id) values ($1, 'Queijo avulso de teste', $2) returning id`, [t, a.id]);

    const exame = await s.exclusaoDoItem(t, a.id, null);
    expect(exame.pode).toBe(false);
    expect(exame.motivos).toEqual([
      'tem 11,6 kg em estoque',
      'é ingrediente de uma ficha técnica (X-teste)',
      'está ligado ao cardápio (Queijo avulso de teste)',
    ]);
    await expect(s.removerItem(t, a.id, null, ator)).rejects.toThrow(ConflictException);
    await expect(s.removerItem(t, a.id, null, ator)).rejects.toThrow(/"Queijo de teste" não pode ser excluído agora: tem 11,6 kg em estoque;.*ficha técnica.*cardápio.*Zere o saldo/);
    expect((await item(t))[0].deleted_at).toBeNull();

    // resolve um por um: cada trava some sozinha
    await s.createMovimento(t, { itemId: a.id, tipo: 'ajuste', saldoContado: 0 } as any, null, ator);
    expect((await s.exclusaoDoItem(t, a.id, null)).motivos).toHaveLength(2);
    await q(`update ficha_tecnica set deleted_at = now() where id = $1`, [ficha.id]); // ficha excluída não trava
    expect((await s.exclusaoDoItem(t, a.id, null)).motivos).toEqual(['está ligado ao cardápio (Queijo avulso de teste)']);
    await q(`update produto set item_id = null where id = $1`, [prod.id]);
    expect(await s.exclusaoDoItem(t, a.id, null)).toMatchObject({ pode: true, motivos: [] });

    const antes = new Date((await item(t))[0].updated_at).getTime();
    await new Promise((r) => setTimeout(r, 20));
    await expect(s.removerItem(t, a.id, null, ator)).resolves.toEqual({ ok: true });
    const depois = (await item(t))[0];
    expect(depois.deleted_at).not.toBeNull();
    expect(new Date(depois.updated_at).getTime()).toBeGreaterThan(antes); // é por aqui que o sync leva a exclusão
    expect(await s.listItens(t, true, null)).toEqual([]);
    expect(await q(`select count(*)::int as n from movimento_estoque where item_id = $1`, [a.id])).toEqual([{ n: 2 }]); // histórico fica
    expect(auditoria.registrar).toHaveBeenCalledWith(expect.objectContaining({ acao: 'item_excluido', entidadeId: a.id, detalhe: { nome: 'Queijo de teste' } }));
    // já excluído: não existe mais para ninguém
    await expect(s.removerItem(t, a.id, null, ator)).rejects.toThrow(/não encontrado/);
    await expect(s.removerItem(await empresa(), a.id, null, ator)).rejects.toThrow(/não encontrado/);
  });

  it('excluir: saldo que se anula entre lojas ainda trava; e a loja não exclui cadastro compartilhado', async () => {
    const t = await empresa();
    const a = await loja(t, 'Loja A');
    const b = await loja(t, 'Loja B');
    const s = estoque();
    const comp = await s.createItem(t, { nome: 'Guardanapo de teste', unidadeMedida: 'pacote' } as any, null);
    await s.createMovimento(t, { itemId: comp.id, tipo: 'entrada', quantidade: 5 } as any, a, ator);
    await s.createMovimento(t, { itemId: comp.id, tipo: 'ajuste', quantidade: -5 } as any, b, ator); // total 0, mas A tem 5 e B deve 5
    expect((await s.exclusaoDoItem(t, comp.id, null)).motivos).toEqual(['tem saldo em 2 lojas (0 pacote no total)']);

    const livre = await s.createItem(t, { nome: 'Canudo de teste', unidadeMedida: 'pacote' } as any, null);
    expect(await s.exclusaoDoItem(t, livre.id, a)).toMatchObject({ pode: false, motivos: ['é um cadastro compartilhado entre as lojas'] });
    await expect(s.removerItem(t, livre.id, a, ator)).rejects.toThrow(/compartilhado entre as lojas.*todas as lojas/);
    await expect(s.removerItem(t, livre.id, null, ator)).resolves.toEqual({ ok: true });
    // produto exclusivo da loja A: a loja B nem o enxerga
    const daA = await s.createItem(t, { nome: 'Pano de teste', unidadeMedida: 'unidade' } as any, a);
    await expect(s.removerItem(t, daA.id, b, ator)).rejects.toThrow(/não encontrado/);
    await expect(s.removerItem(t, daA.id, a, ator)).resolves.toEqual({ ok: true });
  });

  // ── importar / exportar ────────────────────────────────────────────────────────────────
  const ENVIO = {
    arquivo: 'estoque_de_teste.xlsx',
    itens: [
      { nome: 'Cebolinha de teste', unidadeMedida: 'und', categoria: 'Insumos', estoqueMinimo: 2, custo: 5.49, quantidade: 3 },
      { nome: 'Alface de teste', unidadeMedida: 'saco', categoria: 'RESFRIADOS', estoqueMinimo: 8, custo: 11.12, quantidade: 0 },
      { nome: 'Bisnaga de teste', unidadeMedida: 'bisnaga', categoria: 'insumos', estoqueMinimo: null, custo: null, quantidade: 22 },
      { nome: 'tomate DE teste', unidadeMedida: 'kg', categoria: 'Insumos' }, // já existe no cadastro
      { nome: 'cebolinha de teste', unidadeMedida: 'und' }, // repetido dentro do envio
      { nome: 'Sem categoria de teste', unidadeMedida: 'cx' },
    ],
  };

  it('importar: grava só o novo, cria a categoria uma vez, lança o saldo inicial como ajuste — e repetir o envio não duplica', async () => {
    const t = await empresa();
    const s = estoque();
    const p = planilha();
    await s.createItem(t, { nome: 'Tomate de teste', unidadeMedida: 'kg' } as any);
    await s.createCategoria(t, { nome: 'Resfriados' });
    auditoria.registrar.mockClear();

    const r = await p.importar(t, ENVIO, null, ator);
    expect(r).toEqual({
      criados: 4,
      jaExistiam: ['tomate DE teste', 'cebolinha de teste'],
      categoriasCriadas: ['Insumos'], // "Resfriados" já existia (com outra caixa); "insumos" é a mesma
      comSaldo: 2,
    });
    const itens = await q(
      `select i.nome, i.unidade_medida, i.estoque_minimo::float8 as min, i.custo_medio::float8 as custo, c.nome as categoria
         from item_estoque i left join categoria_item c on c.id = i.categoria_item_id
        where i.tenant_id = $1 and i.deleted_at is null order by i.nome`,
      [t],
    );
    expect(itens).toEqual([
      { nome: 'Alface de teste', unidade_medida: 'saco', min: 8, custo: 11.12, categoria: 'Resfriados' },
      { nome: 'Bisnaga de teste', unidade_medida: 'bisnaga', min: 0, custo: 0, categoria: 'Insumos' },
      { nome: 'Cebolinha de teste', unidade_medida: 'unidade', min: 2, custo: 5.49, categoria: 'Insumos' },
      { nome: 'Sem categoria de teste', unidade_medida: 'caixa', min: 0, custo: 0, categoria: null },
      { nome: 'Tomate de teste', unidade_medida: 'kg', min: 0, custo: 0, categoria: null },
    ]);
    expect(await q(`select count(*)::int as n from categoria_item where tenant_id = $1`, [t])).toEqual([{ n: 2 }]);
    const movs = await q(
      `select i.nome, m.tipo, m.quantidade::float8 as qtd, m.custo_unitario::float8 as custo, m.motivo
         from movimento_estoque m join item_estoque i on i.id = m.item_id where m.tenant_id = $1 order by i.nome`,
      [t],
    );
    expect(movs).toEqual([
      { nome: 'Bisnaga de teste', tipo: 'ajuste', qtd: 22, custo: null, motivo: 'Saldo inicial (importação de planilha)' },
      { nome: 'Cebolinha de teste', tipo: 'ajuste', qtd: 3, custo: 5.49, motivo: 'Saldo inicial (importação de planilha)' },
    ]);
    expect(auditoria.registrar).toHaveBeenCalledTimes(1);
    expect(auditoria.registrar).toHaveBeenCalledWith(
      expect.objectContaining({ acao: 'itens_importados', detalhe: expect.objectContaining({ criados: 4, jaExistiam: 2, categoriasCriadas: 1, comSaldoInicial: 2, arquivo: 'estoque_de_teste.xlsx' }) }),
    );

    // o mesmo envio de novo (duplo clique, "tentar de novo"): nada entra, nada é lançado
    auditoria.registrar.mockClear();
    const de_novo = await p.importar(t, ENVIO, null, ator);
    expect(de_novo).toMatchObject({ criados: 0, categoriasCriadas: [], comSaldo: 0 });
    expect(de_novo.jaExistiam).toHaveLength(6);
    expect(await q(`select count(*)::int as n from item_estoque where tenant_id = $1`, [t])).toEqual([{ n: 5 }]);
    expect(await q(`select count(*)::int as n from movimento_estoque where tenant_id = $1`, [t])).toEqual([{ n: 2 }]);
    expect(auditoria.registrar).not.toHaveBeenCalled();
  });

  it('importar: um item ruim recusa o envio INTEIRO (nada gravado), com a frase que diz qual', async () => {
    const t = await empresa();
    const p = planilha();
    const com = (extra: any) => ({ itens: [{ nome: 'Bom de teste', unidadeMedida: 'kg' }, extra] });
    await expect(p.importar(t, com({ nome: 'Ruim de teste', unidadeMedida: 'bandejinha' }), null, ator)).rejects.toThrow(/Produto "Ruim de teste".*"bandejinha"/);
    await expect(p.importar(t, com({ nome: '  ', unidadeMedida: 'kg' }), null, ator)).rejects.toThrow(/Produto 2: sem nome/);
    await expect(p.importar(t, com({ nome: 'Ruim de teste', unidadeMedida: 'kg', custo: -1 }), null, ator)).rejects.toThrow(/custo inválido/);
    await expect(p.importar(t, com({ nome: 'Ruim de teste', unidadeMedida: 'kg', quantidade: 'muito' }), null, ator)).rejects.toThrow(/quantidade inválido/);
    await expect(p.importar(t, { itens: [] }, null, ator)).rejects.toThrow(/Nenhum produto/);
    await expect(p.importar(t, {}, null, ator)).rejects.toThrow(BadRequestException);
    expect(await item(t)).toEqual([]);
  });

  it('importar numa empresa de duas lojas: sem loja escolhida e com saldo é recusado antes de gravar; na loja, o produto e o saldo são dela', async () => {
    const t = await empresa();
    const a = await loja(t, 'Loja A');
    await loja(t, 'Loja B');
    const p = planilha();
    const envio = { itens: [{ nome: 'Mostarda de teste', unidadeMedida: 'gl', quantidade: 3 }] };
    await expect(p.importar(t, envio, null, ator)).rejects.toThrow(/Escolha a loja/);
    expect(await item(t)).toEqual([]);
    // sem saldo, em "todas": entra como cadastro compartilhado
    await expect(p.importar(t, { itens: [{ nome: 'Ketchup de teste', unidadeMedida: 'gl' }] }, null, ator)).resolves.toMatchObject({ criados: 1 });
    await expect(p.importar(t, envio, a, ator)).resolves.toMatchObject({ criados: 1, comSaldo: 1 });
    expect((await item(t)).map((i) => [i.nome, i.unidade_id, i.unidade_medida])).toEqual(
      expect.arrayContaining([['Ketchup de teste', null, 'galão'], ['Mostarda de teste', a, 'galão']]),
    );
    expect(await q(`select unidade_id, quantidade::float8 as q from movimento_estoque where tenant_id = $1`, [t])).toEqual([{ unidade_id: a, q: 3 }]);
  });

  it('prévia: lê o Excel, compara com o que a pessoa enxerga e NÃO grava', async () => {
    const t = await empresa();
    const s = estoque();
    await s.createItem(t, { nome: 'Tomate de teste', unidadeMedida: 'kg' } as any);
    const excluido = await s.createItem(t, { nome: 'Pepino de teste', unidadeMedida: 'kg' } as any);
    await s.removerItem(t, excluido.id, null, ator);
    const arquivo = escreverXlsx([
      ['ID', 'Produto', 'Quantidade', 'Unidade', 'Último preço', 'Preço médio', 'Estoque mínimo', 'Categorias'],
      [1, 'tomate de teste', 2, 'kg', 9, 9, 0, 'INSUMOS'],
      [2, 'pepino de teste', 1, 'kg', 4, 4, 0, 'INSUMOS'], // o excluído não conta: é novo
      [3, 'tomate de teste italiano', 1, 'cx', 30, 30, 1, 'INSUMOS'],
    ]);
    const previa = await planilha().previa(t, arquivo, 'estoque.xlsx', null);
    expect(previa).toMatchObject({ arquivo: 'estoque.xlsx', formato: 'alochefia', resumo: { total: 3, iguais: 1, novos: 1, parecidos: 1 } });
    expect(previa.linhas.map((l) => [l.nome, l.situacao])).toEqual([
      ['tomate de teste', 'igual'], ['pepino de teste', 'novo'], ['tomate de teste italiano', 'parecido'],
    ]);
    expect(await q(`select count(*)::int as n from item_estoque where tenant_id = $1 and deleted_at is null`, [t])).toEqual([{ n: 1 }]);
    await expect(planilha().previa(t, Buffer.alloc(0), '', null)).rejects.toThrow(/Escolha o arquivo/);
    await expect(planilha().previa(t, Buffer.from('Código;Valor\n1;2\n'), 'x.csv', null)).rejects.toThrow(BadRequestException);
  });

  it('exportar: Excel e CSV do que a pessoa enxerga; só os ids pedidos; custo só para quem pode ver', async () => {
    const t = await empresa();
    const s = estoque();
    const p = planilha();
    const a = await s.createItem(t, { nome: 'Refri de teste', unidadeMedida: 'fardo', estoqueMinimo: 5, conversoes: [{ unidadeDe: 'fardo', fator: 12, unidadePara: 'unidade' }] } as any);
    const b = await s.createItem(t, { nome: 'Queijo de teste', unidadeMedida: 'kg', estoqueMinimo: 2 } as any);
    await q(`update item_estoque set custo_medio = 39.9 where id = $1`, [a.id]);
    await s.createMovimento(t, { itemId: a.id, tipo: 'entrada', quantidade: 3 } as any, null, ator);

    const x = await p.exportar(t, true, null, 'xlsx');
    expect(x).toMatchObject({ mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', produtos: 2 });
    expect(x.filename).toMatch(/^produtos-estoque-\d{4}-\d{2}-\d{2}\.xlsx$/);
    const tabela = lerXlsx(Buffer.from(x.base64, 'base64'));
    expect(tabela[0].slice(0, 7)).toEqual(['Produto', 'Categoria', 'Unidade', 'Estoque mínimo', 'Saldo', 'Custo médio', 'Valor em estoque']);
    expect(tabela.slice(1).map((l) => l.slice(0, 7))).toEqual([
      ['Queijo de teste', '', 'kg', '2', '0', '0', '0'],
      ['Refri de teste', '', 'fardo', '5', '3', '39.9', '119.7'],
    ]);
    expect(tabela[2][9]).toBe('1 fardo = 12 unidade');

    const semFinanceiro = lerXlsx(Buffer.from((await p.exportar(t, false, null, 'xlsx')).base64, 'base64'));
    expect(semFinanceiro[0]).not.toContain('Custo médio');
    expect(semFinanceiro.flat()).not.toContain('39.9');

    const csv = await p.exportar(t, true, null, 'csv', [b.id, 'id-que-nao-existe']);
    expect(csv).toMatchObject({ produtos: 1, mime: 'text/csv;charset=utf-8' });
    const texto = Buffer.from(csv.base64, 'base64').toString('utf8');
    expect(texto.split('\r\n')[1]).toMatch(/^Queijo de teste;;kg;2;0;/);

    await expect(p.exportar(t, true, null, 'pdf')).rejects.toThrow(/Formato de arquivo desconhecido/);
    await expect(p.exportar(t, true, null, 'xlsx', [])).rejects.toThrow(/Nenhum produto/);
    await expect(p.exportar(await empresa(), true, null, 'xlsx')).rejects.toThrow(/Nenhum produto/);
  });
});
