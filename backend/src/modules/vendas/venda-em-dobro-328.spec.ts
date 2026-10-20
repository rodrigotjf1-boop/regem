import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../../db/schema';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { FiscalService } from '../fiscal/fiscal.service';
import { ProducaoPedidoService } from '../producao-pedido/producao-pedido.service';
import { VendasService } from './vendas.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

// Migration 328 — desfaz as vendas em DOBRO dos pedidos de canal aceitos pela nuvem E pelo servidor
// da loja (ERR-251): de 07 a 20/10/2026, 178 comandas a mais (R$ 8.365,96). Contra o Postgres real,
// com as vendas criadas pelo `venderExterno` (como em produção) e a auditoria pelo AuditoriaService:
//  • a sobra (comanda D fechada que nenhum pedido aponta, com UMA gêmea apontada por pedido da Anota Aí
//    ou do iFood) é cancelada, a entrada no caixa ganha o estorno com a data da venda e a produção sai;
//  • a gêmea e tudo o que não é sobra com certeza fica como está;
//  • a auditoria continua a corrente da empresa (o `verificarCadeia` do serviço confere);
//  • rodar de novo não muda nada.
// O critério da migration é do banco inteiro: ela roda numa transação que é DESFEITA no fim, para nunca
// mexer nos dados das specs que rodam em paralelo.
const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('venda-em-dobro-328.spec: sem TEST_PG_URL — PULADO');

const ARQUIVO = join(__dirname, '..', '..', '..', '..', 'database', 'migrations', '328_desfazer_vendas_em_dobro.sql');
const MOTIVO = 'Venda em dobro: o pedido foi aceito pela nuvem e pelo servidor da loja (ERR-251). Desfeita pela migration 328.';
const uuidDoMd5 = (s: string) => {
  const h = createHash('md5').update(s).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
};

describe('migration 328 (arquivo)', () => {
  const texto = readFileSync(ARQUIVO, 'utf8');
  it('é só da nuvem e passa pela trava do Supabase (nada de drop, truncate ou delete — ERR-225)', () => {
    expect(texto.split('\n')[0].trim()).toBe('-- @cloud-only');
    expect(texto).not.toMatch(/\bdrop\b|\btruncate\b|^\s*delete\b/im);
    expect(texto).toContain(MOTIVO);
  });
});

descrever('migration 328: desfaz as vendas em dobro (ERR-251)', () => {
  jest.setTimeout(120_000);
  const pool = new Pool({ connectionString: URL_PG });
  const db = drizzle(pool, { schema }) as any;
  const semAuditoria = { registrar: async () => undefined } as any;
  const eventos = { emit: () => true } as any;
  const fiscal = new FiscalService(db, semAuditoria);
  const producao = new ProducaoPedidoService(db, semAuditoria, eventos);
  const vendas = new VendasService(db, semAuditoria, eventos, producao, fiscal, {} as any);
  const auditoria = new AuditoriaService(db);
  const sql328 = readFileSync(ARQUIVO, 'utf8');
  const q = (s: string, p: any[] = []) => pool.query(s, p).then((r) => r.rows);
  let t = '';
  let u = '';
  let produtoId = '';

  // Uma venda de canal como o aceite cria (comanda D fechada, item, produção e a entrada no caixa),
  // com a hora e a data colocadas dentro (ou fora) do período da migration.
  async function venda(cliente: string, preco: number, criadaEm: string, dataDoCaixa: string) {
    const r = await vendas.venderExterno(t, null, {
      unidadeId: u,
      cliente,
      forma: 'online',
      origem: 'delivery',
      plataforma: 'anotaai',
      itens: [{ produtoId, descricao: 'Lanche de teste', quantidade: 1, precoUnitario: preco }],
    });
    await q('update comanda set created_at = $2::timestamptz where id = $1', [r.comandaId, criadaEm]);
    await q('update lancamento_caixa set data = $2::date where comanda_id = $1', [r.comandaId, dataDoCaixa]);
    return r.comandaId as string;
  }
  async function pedido(canal: string, comandaId: string) {
    const [p] = await q(
      `insert into pedido_externo (tenant_id, unidade_id, canal, external_id, display_id, cliente_nome, tipo, status, itens, total, comanda_id)
       values ($1,$2,$3,$4,'1234','Cliente de teste','entrega','confirmado','[]'::jsonb, 0, $5) returning id`,
      [t, u, canal, randomUUID(), comandaId],
    );
    return p.id as string;
  }
  const cli = (nome: string) => `${nome} ${randomUUID().slice(0, 8)}`;

  const v: Record<string, string> = {};
  beforeAll(async () => {
    // A venda roda como NUVEM, e a produção pergunta se o servidor da loja está ligado (`edgeAtivo`), lendo a
    // `edge_heartbeat` — só da nuvem; o banco do CI é de loja. Em paralelo, quem perde a corrida do
    // `create table if not exists` recebe 23505/42P07 — é "já existe" (ERR-128).
    await pool
      .query(
        `create table if not exists edge_heartbeat (id uuid primary key default gen_random_uuid(),
           tenant_id uuid, unidade_id uuid, recebido_em timestamptz not null default now())`,
      )
      .catch((e: any) => {
        if (!['23505', '42P07'].includes(e?.code)) throw e;
      });
    t = (await q(`insert into empresa (nome) values ('teste migration 328') returning id`))[0].id;
    u = (await q(`insert into unidade (tenant_id, nome) values ($1,'Loja') returning id`, [t]))[0].id;
    produtoId = (await q(
      `insert into produto (tenant_id, codigo, nome, preco_venda, vai_para_producao) values ($1,'D328','Lanche de teste','37.40',true) returning id`,
      [t],
    ))[0].id;

    // Anota Aí aceito duas vezes: a gêmea (ligada ao pedido) e a sobra, 40 s depois.
    const ana = cli('Ana');
    v.gemeaA = await venda(ana, 37.4, '2026-10-17 20:00:00-03', '2026-10-17');
    v.sobraA = await venda(ana, 37.4, '2026-10-17 20:00:40-03', '2026-10-17');
    v.pedidoA = await pedido('anotaai', v.gemeaA);
    // iFood aceito duas vezes, a sobra 5 min ANTES da gêmea.
    const bia = cli('Bia');
    v.sobraB = await venda(bia, 52.9, '2026-10-16 21:10:00-03', '2026-10-16');
    v.gemeaB = await venda(bia, 52.9, '2026-10-16 21:15:00-03', '2026-10-16');
    v.pedidoB = await pedido('ifood', v.gemeaB);

    // O que NÃO pode mudar:
    v.semGemea = await venda(cli('Caio'), 18, '2026-10-18 19:00:00-03', '2026-10-18'); // comanda solta, sem pedido parecido
    const dani = cli('Dani'); // a gêmea é do cardápio próprio (fora do escopo medido: Anota Aí e iFood)
    v.gemeaCardapio = await venda(dani, 25, '2026-10-18 19:30:00-03', '2026-10-18');
    v.sobraCardapio = await venda(dani, 25, '2026-10-18 19:31:00-03', '2026-10-18');
    await pedido('cardapio', v.gemeaCardapio);
    const edu = cli('Edu'); // duas gêmeas possíveis: não dá para saber qual é a sobra
    v.gemeaE1 = await venda(edu, 30, '2026-10-19 20:00:00-03', '2026-10-19');
    v.gemeaE2 = await venda(edu, 30, '2026-10-19 20:02:00-03', '2026-10-19');
    v.ambigua = await venda(edu, 30, '2026-10-19 20:01:00-03', '2026-10-19');
    await pedido('anotaai', v.gemeaE1);
    await pedido('anotaai', v.gemeaE2);
    const fabi = cli('Fabi'); // fora do período (setembro)
    v.gemeaSet = await venda(fabi, 41, '2026-09-25 20:00:00-03', '2026-09-25');
    v.sobraSet = await venda(fabi, 41, '2026-09-25 20:00:30-03', '2026-09-25');
    await pedido('anotaai', v.gemeaSet);
    const gil = cli('Gil'); // total diferente: não é a mesma venda
    v.gemeaTotal = await venda(gil, 44, '2026-10-17 21:00:00-03', '2026-10-17');
    v.totalDiferente = await venda(gil, 45, '2026-10-17 21:00:20-03', '2026-10-17');
    await pedido('anotaai', v.gemeaTotal);

    // A corrente da auditoria da empresa já tem registros antes da migration.
    await auditoria.registrar({ tenantId: t, atorId: null, atorPerfil: 'presidente', tipo: 'venda', acao: 'teste_antes', detalhe: { n: 1 } });
    await auditoria.registrar({ tenantId: t, atorId: null, atorPerfil: 'presidente', tipo: 'venda', acao: 'teste_antes', detalhe: { n: 2 } });
  });
  afterAll(async () => {
    for (const tb of ['producao_pedido', 'pedido_externo', 'lancamento_caixa', 'comanda', 'produto', 'unidade'])
      await pool.query(`delete from ${tb} where tenant_id = $1`, [t]).catch(() => {});
    await pool.end();
  }, 120_000);

  it('cancela a sobra, estorna a entrada com a data da venda, tira a produção e continua a corrente da auditoria; a segunda vez não muda nada', async () => {
    const cli0 = await pool.connect();
    try {
      await cli0.query('begin');
      const nada = async (s: string, p: any[] = []) => (await cli0.query(s, p)).rows;
      const resultado: any = await cli0.query(sql328);
      const conferencia = (Array.isArray(resultado) ? resultado[resultado.length - 1] : resultado).rows[0];
      expect(Number(conferencia.elos_quebrados)).toBe(0);
      expect(Number(conferencia.canceladas)).toBe(Number(conferencia.auditadas));

      const situacao = async (id: string) => (await nada('select status, motivo_cancelamento from comanda where id = $1', [id]))[0];
      for (const id of [v.sobraA, v.sobraB]) expect(await situacao(id)).toEqual({ status: 'cancelada', motivo_cancelamento: MOTIVO });
      for (const id of [v.gemeaA, v.gemeaB, v.semGemea, v.gemeaCardapio, v.sobraCardapio, v.gemeaE1, v.gemeaE2, v.ambigua, v.gemeaSet, v.sobraSet, v.gemeaTotal, v.totalDiferente])
        expect((await situacao(id)).status).toBe('fechada');

      // Estorno: saída na mesma forma, com a data da venda (não a de hoje), fora de sessão, id tirado da entrada.
      const [entradaA] = await nada(`select id, valor from lancamento_caixa where comanda_id = $1 and tipo = 'entrada'`, [v.sobraA]);
      const estornos = await nada(
        `select id, tipo, categoria, forma, valor, to_char(data, 'YYYY-MM-DD') as data, sessao_id, estorno_de, descricao
           from lancamento_caixa where comanda_id = $1 and tipo = 'saida'`,
        [v.sobraA],
      );
      expect(estornos).toEqual([{
        id: uuidDoMd5('regem:328:estorno:' + entradaA.id), tipo: 'saida', categoria: 'estorno', forma: 'online',
        valor: entradaA.valor, data: '2026-10-17', sessao_id: null, estorno_de: entradaA.id, descricao: 'Estorno · venda em dobro (ERR-251)',
      }]);
      const [estornoB] = await nada(`select to_char(data, 'YYYY-MM-DD') as data, valor from lancamento_caixa where comanda_id = $1 and tipo = 'saida'`, [v.sobraB]);
      expect(estornoB).toEqual({ data: '2026-10-16', valor: '52.90' });
      const outros = await nada(`select count(*)::int as n from lancamento_caixa where tenant_id = $1 and tipo = 'saida' and comanda_id <> all($2::uuid[])`, [t, [v.sobraA, v.sobraB]]);
      expect(outros[0].n).toBe(0);

      // Produção: a da sobra sai da fila; a da gêmea fica.
      const prod = async (id: string) => (await nada('select status, obs from producao_pedido where comanda_id = $1', [id])).map((x) => x.status);
      expect(await prod(v.sobraA)).toEqual(['cancelado']);
      expect(await prod(v.gemeaA)).toEqual(['recebido']);
      expect((await nada('select obs from producao_pedido where comanda_id = $1', [v.sobraB]))[0].obs).toBe(MOTIVO);

      // Auditoria: uma linha por sobra, na corrente da empresa (depois das 2 que já existiam), com a gêmea e o pedido.
      const aud = await nada(
        `select seq, actor_tipo, actor_perfil, origem, entidade_tipo, entidade_id, detalhe from audit_log
          where tenant_id = $1 and acao = 'desfez_venda_em_dobro' order by seq`,
        [t],
      );
      expect(aud.map((a) => [a.seq, a.entidade_id])).toEqual([[3, v.sobraB], [4, v.sobraA]]);
      expect(aud[1]).toMatchObject({ actor_tipo: 'distribuicao', actor_perfil: 'servico', origem: 'migracao', entidade_tipo: 'comanda' });
      expect(aud[1].detalhe).toEqual({ motivo: MOTIVO, comandaGemeaId: v.gemeaA, pedidoExternoId: v.pedidoA, valor: '37.40', migration: '328' });
      const cadeia = await new AuditoriaService(drizzle(cli0 as any, { schema }) as any).verificarCadeia(t);
      expect(cadeia).toEqual({ ok: true, total: 4, quebras: [] });

      // De novo: nada a desfazer — nem estorno, nem auditoria a mais.
      const conta = async () => (await nada(
        `select (select count(*) from lancamento_caixa where tenant_id = $1 and tipo = 'saida')::int as estornos,
                (select count(*) from audit_log where tenant_id = $1)::int as auditoria`,
        [t],
      ))[0];
      const antes = await conta();
      await cli0.query(sql328);
      expect(await conta()).toEqual(antes);
    } finally {
      await cli0.query('rollback').catch(() => {});
      cli0.release();
    }
  });
});
