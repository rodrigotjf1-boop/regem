import { randomUUID } from 'node:crypto';
import { BadRequestException } from '@nestjs/common';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../../db/schema';
import { hojeISO, somarDias } from '../../common/data';
import { periodoDaConsulta } from '../../common/periodo';
import { LoteService } from '../recebimento/lote.service';
import { RecebimentoService } from '../recebimento/recebimento.service';
import { VistoriaController } from '../vistoria/vistoria.controller';
import { VistoriaService } from '../vistoria/vistoria.service';
import { DesperdicioController } from './desperdicio.controller';
import { DesperdicioService } from './desperdicio.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

// LISTAS DE HISTÓRICO DO ESTOQUE — contra Postgres (TEST_PG_URL): desperdício, vistoria e
// recebimento cortados por período NO BANCO; motivo do desperdício em lista fechada; quem
// registrou a vistoria; categoria do produto na lista de lotes (Validades).

const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
jest.setTimeout(60_000);

descrever('listas de histórico do estoque (Postgres real)', () => {
  const empresas: string[] = [];
  let pool: Pool;
  let db: any;
  const q = async (s: string, p: any[] = []) => (await pool.query(s, p)).rows;
  const hoje = hojeISO();
  const ha = (dias: number) => somarDias(hoje, -dias);
  const periodo = (dias: number) => periodoDaConsulta(ha(dias), hoje);

  async function empresa() {
    const id = randomUUID();
    await q(`insert into empresa (id, nome) values ($1, $2)`, [id, `Listas teste ${id.slice(0, 6)}`]);
    empresas.push(id);
    return id;
  }
  const pessoa = async (t: string, nome: string) =>
    (await q(`insert into colaborador (tenant_id, nome) values ($1, $2) returning id`, [t, nome]))[0].id as string;
  const usuario = (t: string, colaboradorId?: string): any => ({ tenantId: t, categoria: 'gerente', colaboradorId });

  beforeAll(async () => {
    pool = new Pool({ connectionString: URL_PG });
    db = drizzle(pool, { schema });
  });
  afterAll(async () => {
    for (const id of empresas) {
      for (const tabela of [
        'movimento_estoque', 'desperdicio', 'vistoria', 'recebimento_item', 'recebimento', 'lote',
        'item_estoque', 'categoria_item', 'fornecedor', 'colaborador',
      ]) {
        await q(`delete from ${tabela} where tenant_id = $1`, [id]);
      }
      await q(`delete from empresa where id = $1`, [id]);
    }
    await pool.end();
  });

  // ── desperdício ────────────────────────────────────────────────────────────────────────
  it('desperdício: o período corta pela DATA no banco; sem período vem tudo; outra empresa não aparece', async () => {
    const t = await empresa();
    const outra = await empresa();
    const s = new DesperdicioService(db);
    for (const [descricao, dias] of [['Antigo de teste', 40], ['Do mês de teste', 10], ['De hoje de teste', 0]] as [string, number][])
      await s.create(t, { descricao, data: ha(dias) } as any);
    await s.create(outra, { descricao: 'De outra empresa', data: hoje } as any);

    const nomes = async (p?: any) => (await s.findAll(usuario(t), null, p)).map((d: any) => d.descricao).sort();
    expect(await nomes()).toEqual(['Antigo de teste', 'De hoje de teste', 'Do mês de teste']);
    expect(await nomes(periodo(30))).toEqual(['De hoje de teste', 'Do mês de teste']);
    expect(await nomes(periodo(7))).toEqual(['De hoje de teste']);
    expect(await nomes(periodoDaConsulta(ha(40), ha(10)))).toEqual(['Antigo de teste', 'Do mês de teste']); // as duas pontas entram
    expect(await nomes(periodoDaConsulta(undefined, ha(20)))).toEqual(['Antigo de teste']);
    expect(await nomes(periodoDaConsulta(somarDias(hoje, 1), somarDias(hoje, 5)))).toEqual([]);
  });

  it('desperdício: a rota só aceita motivo da lista — e grava o da lista; a lista mostra o antigo que corresponde', async () => {
    const t = await empresa();
    const quem = await pessoa(t, 'Carla de teste');
    const s = new DesperdicioService(db);
    const rota = new DesperdicioController(s);

    expect(rota.motivos()).toEqual({ motivos: ['Validade', 'Preparo', 'Queda', 'Transporte', 'Outro'] });
    expect(() => rota.create(usuario(t, quem), null, { descricao: 'Pão de teste', motivo: 'forno' } as any)).toThrow(BadRequestException);
    expect(await q(`select count(*)::int as n from desperdicio where tenant_id = $1`, [t])).toEqual([{ n: 0 }]);

    await rota.create(usuario(t, quem), null, { descricao: 'Pão de teste', motivo: ' QUEIMOU ' } as any);
    await rota.create(usuario(t, quem), null, { descricao: 'Sem motivo de teste', motivo: '  ' } as any);
    await rota.create(usuario(t, quem), null, { descricao: 'Nem veio de teste' } as any);
    // o que já existia de antes da lista: gravado direto, como a perda por etiqueta e o texto livre faziam
    await q(`insert into desperdicio (tenant_id, descricao, motivo) values ($1, 'Etiqueta de teste', 'validade'), ($1, 'Livre de teste', 'forno')`, [t]);

    expect(await q(`select descricao, motivo from desperdicio where tenant_id = $1 order by descricao`, [t])).toEqual([
      { descricao: 'Etiqueta de teste', motivo: 'validade' },
      { descricao: 'Livre de teste', motivo: 'forno' },
      { descricao: 'Nem veio de teste', motivo: null },
      { descricao: 'Pão de teste', motivo: 'Preparo' },
      { descricao: 'Sem motivo de teste', motivo: null },
    ]);
    const lista = await rota.findAll(usuario(t), null);
    expect(Object.fromEntries(lista.map((d: any) => [d.descricao, d.motivo]))).toEqual({
      'Etiqueta de teste': 'Validade', // reconhecido
      'Livre de teste': 'forno', // texto livre antigo: sai como está
      'Nem veio de teste': null,
      'Pão de teste': 'Preparo',
      'Sem motivo de teste': null,
    });
    expect(lista.find((d: any) => d.descricao === 'Pão de teste')).toMatchObject({ registradoPorNome: 'Carla de teste' });

    // custo (base do valor da perda): só para quem tem "ver valores em R$"
    const [it] = await q(`insert into item_estoque (tenant_id, nome, unidade_medida, custo_medio) values ($1, 'Queijo de teste', 'kg', 20) returning id`, [t]);
    await q(`insert into movimento_estoque (tenant_id, item_id, tipo, quantidade) values ($1, $2, 'entrada', 10)`, [t, it.id]);
    await rota.create(usuario(t, quem), null, { descricao: 'Queijo de teste vencido', itemId: it.id, quantidade: 2, motivo: 'validade' } as any);
    const custoDe = async (u: any) => (await rota.findAll(u, null)).find((d: any) => d.descricao === 'Queijo de teste vencido')?.custoUnitario;
    expect(Number(await custoDe({ ...usuario(t), permissoes: { ver_financeiro: true } }))).toBe(20);
    expect(await custoDe(usuario(t))).toBeNull();
    expect(await custoDe({ ...usuario(t), permissoes: { ver_financeiro: false } })).toBeNull();
    // a rota valida o período antes de consultar
    expect(() => rota.findAll(usuario(t), null, '07/10/2026')).toThrow(/AAAA-MM-DD/);
  });

  // ── vistoria ───────────────────────────────────────────────────────────────────────────
  it('vistoria: grava quem registrou (da sessão) e a lista traz o nome; a antiga, sem dono, vem nula; período no banco', async () => {
    const t = await empresa();
    const quem = await pessoa(t, 'Ana de teste');
    const s = new VistoriaService(db);
    const rota = new VistoriaController(s);

    const nova: any = await rota.create(usuario(t, quem), null, { tipo: 'abertura', observacao: 'Tudo em ordem' } as any);
    expect(nova.colaboradorId).toBe(quem);
    await q(`insert into vistoria (tenant_id, tipo, data, observacao) values ($1, 'fechamento', $2, 'Antiga de teste')`, [t, ha(45)]);
    await s.create(t, { tipo: 'padrao', data: ha(12), observacao: 'Do mês de teste' } as any, null, quem);

    const todas = await rota.findAll(usuario(t), null);
    expect(Object.fromEntries(todas.map((v: any) => [v.observacao, v.registradoPorNome]))).toEqual({
      'Tudo em ordem': 'Ana de teste',
      'Do mês de teste': 'Ana de teste',
      'Antiga de teste': null,
    });
    expect((await rota.findAll(usuario(t), null, ha(30), hoje)).map((v: any) => v.observacao).sort()).toEqual(['Do mês de teste', 'Tudo em ordem']);
    expect((await rota.findAll(usuario(t), null, ha(7), hoje)).map((v: any) => v.observacao)).toEqual(['Tudo em ordem']);
    expect(() => rota.findAll(usuario(t), null, hoje, ha(3))).toThrow(/depois do fim/);
    // outra empresa não enxerga
    expect(await rota.findAll(usuario(await empresa()), null)).toEqual([]);
  });

  // ── recebimento ────────────────────────────────────────────────────────────────────────
  it('recebimento: período pela data, com a contagem de itens e de divergências de cada um', async () => {
    const t = await empresa();
    const [forn] = await q(`insert into fornecedor (tenant_id, nome) values ($1, 'Atacado de teste') returning id`, [t]);
    const [it] = await q(`insert into item_estoque (tenant_id, nome, unidade_medida) values ($1, 'Farinha de teste', 'kg') returning id`, [t]);
    const receb = async (dias: number, nota: string, linhas: string[]) => {
      const [r] = await q(`insert into recebimento (tenant_id, fornecedor_id, data, nota_ref) values ($1, $2, $3, $4) returning id`, [t, forn.id, ha(dias), nota]);
      for (const divergencia of linhas)
        await q(`insert into recebimento_item (tenant_id, recebimento_id, item_id, qtd_esperada, qtd_recebida, divergencia) values ($1, $2, $3, 5, 5, $4)`, [t, r.id, it.id, divergencia]);
    };
    await receb(50, 'NF antiga', ['ok']);
    await receb(9, 'NF do mês', ['ok', 'falta', 'ok']);
    await receb(0, 'NF de hoje', ['ok', 'ok']);

    const s = new (RecebimentoService as any)(db, { registrar: jest.fn() }, { emit: jest.fn() }) as RecebimentoService;
    const resumo = async (p?: any) => (await s.findAll(t, null, p)).map((r: any) => [r.notaRef, r.itens, r.divergencias, r.fornecedorNome]);
    expect(await resumo()).toEqual([
      ['NF de hoje', 2, 0, 'Atacado de teste'],
      ['NF do mês', 3, 1, 'Atacado de teste'],
      ['NF antiga', 1, 0, 'Atacado de teste'],
    ]);
    expect((await resumo(periodo(30))).map((r) => r[0])).toEqual(['NF de hoje', 'NF do mês']);
    expect((await resumo(periodo(7))).map((r) => r[0])).toEqual(['NF de hoje']);
    expect((await resumo(periodoDaConsulta(ha(60), ha(9)))).map((r) => r[0])).toEqual(['NF do mês', 'NF antiga']);
  });

  // ── lotes (Validades) ──────────────────────────────────────────────────────────────────
  it('lotes: a lista traz o produto e a categoria dele; categoria excluída não aparece', async () => {
    const t = await empresa();
    const [cat] = await q(`insert into categoria_item (tenant_id, nome) values ($1, 'Laticínios de teste') returning id`, [t]);
    const [comCat] = await q(`insert into item_estoque (tenant_id, nome, unidade_medida, categoria_item_id) values ($1, 'Queijo de teste', 'kg', $2) returning id`, [t, cat.id]);
    const [semCat] = await q(`insert into item_estoque (tenant_id, nome, unidade_medida) values ($1, 'Sal de teste', 'kg') returning id`, [t]);
    await q(`insert into lote (tenant_id, item_id, quantidade, validade) values ($1, $2, 4.2, $3), ($1, $4, 10, null)`, [t, comCat.id, somarDias(hoje, 2), semCat.id]);

    const s = new LoteService(db);
    const ler = async () => (await s.listar(t, null)).map((l: any) => [l.itemNome, l.itemId, l.categoriaNome, l.quantidade]);
    expect(await ler()).toEqual([
      ['Queijo de teste', comCat.id, 'Laticínios de teste', 4.2],
      ['Sal de teste', semCat.id, null, 10], // sem validade vai para o fim
    ]);
    await q(`update categoria_item set deleted_at = now() where id = $1`, [cat.id]);
    expect((await ler())[0]).toEqual(['Queijo de teste', comCat.id, null, 4.2]);
  });
});
