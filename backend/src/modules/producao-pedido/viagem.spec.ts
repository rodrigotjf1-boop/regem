import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../../db/schema';
import { FiscalService } from '../fiscal/fiscal.service';
import { VendasService } from '../vendas/vendas.service';
import { MARCA_VIAGEM, ProducaoPedidoService } from './producao-pedido.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

// "COMER AQUI / VIAGEM" DE PONTA A PONTA — contra Postgres (TEST_PG_URL), com os serviços de verdade.
//
// Decisão do dono (09/10/2026): a cozinha vê "VIAGEM" no cartão e no ALTO da via impressa; vale
// para o balcão e para o totem.
//
// O que se media antes (ERR-214): a venda do totem gravava `comanda.consumo = 'viagem'` e NINGUÉM
// lia — o pedido de produção (de onde o cartão da cozinha e a via leem) não tinha a coluna. O
// cliente escolhia "para viagem" e a cozinha recebia um pedido igual ao de quem come no local.
//
// Cada teste confere o que a COZINHA recebe: a coluna do pedido de produção (o cartão do KDS lê
// dela) e o texto da via que foi para a fila da impressora.

const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('viagem.spec: sem TEST_PG_URL — PULADO');
jest.setTimeout(120_000);

descrever('comer aqui / viagem chega à cozinha: pedido de produção e via impressa (Postgres real)', () => {
  const pool = new Pool({ connectionString: URL_PG });
  const db = drizzle(pool, { schema }) as any;
  const auditoria = { registrar: async () => undefined } as any;
  const eventos = { emit: () => true } as any;
  const fiscal = new FiscalService(db, auditoria);
  const producao = new ProducaoPedidoService(db, auditoria, eventos);
  const vendas = new VendasService(db, auditoria, eventos, producao, fiscal, {} as any);
  const empresas: string[] = [];
  const q = (s: string, p: any[] = []) => pool.query(s, p).then((r) => r.rows);
  const edgeOriginal = process.env.EDGE_MODE;

  beforeAll(async () => {
    delete process.env.EDGE_MODE; // como NUVEM
    for (const t of ['edge_status', 'edge_heartbeat'])
      await pool
        .query(
          `create table if not exists ${t} (id uuid primary key default gen_random_uuid(),
             tenant_id uuid, unidade_id uuid, recebido_em timestamptz not null default now())`,
        )
        .catch((e: any) => {
          if (!['23505', '42P07'].includes(e?.code)) throw e;
        });
  });
  afterAll(async () => {
    if (edgeOriginal !== undefined) process.env.EDGE_MODE = edgeOriginal;
    if (empresas.length) {
      for (const t of ['impressao_job', 'producao_pedido', 'lancamento_caixa', 'movimento_estoque', 'comanda', 'caixa_sessao',
        'equipamento', 'produto', 'categoria_produto', 'colaborador', 'funcao', 'unidade'])
        await pool.query(`delete from ${t} where tenant_id = any($1::uuid[])`, [empresas]).catch(() => {});
      await pool.query('delete from empresa where id = any($1::uuid[])', [empresas]).catch(() => {});
    }
    await pool.end();
  }, 120_000);

  // Loja com caixa aberto, um lanche que VAI PARA A PRODUÇÃO, a impressora padrão da cozinha e um totem.
  async function loja() {
    const t = (await q(`insert into empresa (nome) values ('teste viagem') returning id`))[0].id as string;
    empresas.push(t);
    const u = (await q(`insert into unidade (tenant_id, nome) values ($1,'Loja de teste') returning id`, [t]))[0].id as string;
    const funcao = (await q(`insert into funcao (tenant_id, nome, categoria) values ($1,'Presidente','presidente') returning id`, [t]))[0].id as string;
    const ator = (await q(`insert into colaborador (tenant_id, nome, funcao_id) values ($1,'Pessoa de teste',$2) returning id`, [t, funcao]))[0].id as string;
    await q(`insert into caixa_sessao (tenant_id, unidade_id, status, origem, aberta_por_id) values ($1,$2,'aberta','pdv',$3)`, [t, u, ator]);
    const categoria = (await q(`insert into categoria_produto (tenant_id, nome) values ($1,'Categoria de teste') returning id`, [t]))[0].id as string;
    const lanche = (await q(
      `insert into produto (tenant_id, codigo, nome, categoria_id, preco_venda, vai_para_producao, controla_estoque)
       values ($1,'VG1','Lanche de teste',$2,'20.00',true,false) returning id`,
      [t, categoria],
    ))[0].id as string;
    await q(`insert into equipamento (tenant_id, unidade_id, tipo, nome, token, ativo, faz_producao, padrao) values ($1,$2,'impressora','Cozinha de teste',$3,true,true,true)`, [t, u, randomUUID()]);
    const totem = (await q(`insert into equipamento (tenant_id, unidade_id, tipo, nome, token, ativo) values ($1,$2,'totem','Totem de teste',$3,true) returning id`, [t, u, randomUUID()]))[0].id as string;
    return { t, u, ator, lanche, totem };
  }
  const noBalcao = (l: any, consumo?: string, mesa?: string) =>
    vendas.vendaBalcao(l.t, l.ator, 'presidente', { itens: [{ produtoId: l.lanche, quantidade: 1 }], forma: 'dinheiro', unidadeId: l.u, consumo, mesa } as any, null) as Promise<any>;
  const noTotem = (l: any, consumo?: string) =>
    vendas.venderTotem(l.t, { unidadeId: l.u, equipamentoId: l.totem }, { idempotencyKey: randomUUID(), itens: [{ codigoPdv: 'VG1', quantidade: 1 }], pagamentos: [{ forma: 'credito', valor: 20 }], plataforma: 'GoGeM Totem', consumo } as any) as Promise<any>;
  // O que a cozinha recebe de uma venda: a marca no pedido de produção e as linhas da via.
  async function naCozinha(comandaId: string) {
    const [cmd] = await q(`select consumo from comanda where id = $1`, [comandaId]);
    const [ped] = await q(`select id, consumo, origem, mesa from producao_pedido where comanda_id = $1`, [comandaId]);
    const vias = await q(`select conteudo from impressao_job where comanda_id = $1 and via = 'producao' order by criado_em`, [comandaId]);
    return { comanda: cmd?.consumo ?? null, pedido: ped, vias: vias.map((v: any) => String(v.conteudo).split('\n')) };
  }

  it('balcão para viagem: a marca vai para a comanda, para o pedido de produção e abre a via impressa', async () => {
    const l = await loja();
    const r = await noBalcao(l, 'viagem');
    const c = await naCozinha(r.comandaId);
    expect(c.comanda).toBe('viagem');
    expect(c.pedido).toMatchObject({ consumo: 'viagem', origem: 'balcao', mesa: null });
    expect(c.vias).toHaveLength(1);
    expect(c.vias[0].slice(0, 3)).toEqual(['*** PRODUCAO ***', MARCA_VIAGEM, expect.stringMatching(/^>>> SENHA .+ <<<$/)]);
    expect(MARCA_VIAGEM).toBe('*** VIAGEM ***'); // o texto que o dono aprovou
    expect(c.vias[0].join('\n')).toContain('1x Lanche de teste');
  });

  it('sem a marca, ou "comer aqui", a via sai como sempre saiu (sem a linha de viagem)', async () => {
    const l = await loja();
    const semMarca = await naCozinha((await noBalcao(l)).comandaId);
    expect(semMarca.comanda).toBeNull();
    expect(semMarca.pedido.consumo).toBeNull();
    expect(semMarca.vias[0].slice(0, 2)).toEqual(['*** PRODUCAO ***', expect.stringMatching(/^>>> SENHA /)]);
    expect(semMarca.vias[0]).not.toContain(MARCA_VIAGEM);

    const local = await naCozinha((await noBalcao(l, 'local')).comandaId);
    expect(local.pedido.consumo).toBe('local');
    expect(local.vias[0]).not.toContain(MARCA_VIAGEM);

    // com mesa a via continua dizendo a mesa (e nada de viagem)
    const mesa = await naCozinha((await noBalcao(l, undefined, '12')).comandaId);
    expect(mesa.pedido).toMatchObject({ consumo: null, origem: 'mesa', mesa: '12' });
    expect(mesa.vias[0].join('\n')).toContain('MESA 12');
    expect(mesa.vias[0]).not.toContain(MARCA_VIAGEM);
  });

  it('totem para viagem: o que já era gravado na comanda passa a chegar à cozinha (ERR-214)', async () => {
    const l = await loja();
    const r = await noTotem(l, 'viagem');
    const c = await naCozinha(r.comandaId);
    expect(c.comanda).toBe('viagem'); // isto já acontecia
    expect(c.pedido).toMatchObject({ consumo: 'viagem', origem: 'totem' }); // isto não: a coluna não existia
    expect(c.vias).toHaveLength(1);
    expect(c.vias[0][1]).toBe(MARCA_VIAGEM);

    const aqui = await naCozinha((await noTotem(l, 'local')).comandaId);
    expect(aqui.pedido.consumo).toBe('local');
    expect(aqui.vias[0]).not.toContain(MARCA_VIAGEM);
  });

  it('via gerada no servidor da loja (venda que desceu da nuvem): lê a marca do pedido de produção', async () => {
    const l = await loja();
    const r = await noBalcao(l, 'viagem');
    await q(`delete from impressao_job where comanda_id = $1`, [r.comandaId]); // na loja a via ainda não existe
    const n = await producao.materializarProducaoLocal(l.t, r.comandaId);
    expect(n).toBeGreaterThan(0);
    const c = await naCozinha(r.comandaId);
    expect(c.vias).toHaveLength(1);
    expect(c.vias[0].slice(0, 2)).toEqual(['*** PRODUCAO ***', MARCA_VIAGEM]);
  });

  it('loja com a via personalizada (perfil de campos): a marca entra por cima, centralizada e em destaque', () => {
    const perfil = { campos: [
      { key: 'senha', visivel: true, negrito: true, alinhamento: 'centro' },
      { key: 'mesa', visivel: false, negrito: false, alinhamento: 'esquerda' },
      { key: 'itens', visivel: true, negrito: false, alinhamento: 'esquerda' },
    ] };
    const itens = [{ descricao: 'Lanche de teste', quantidade: 2 }];
    const via = (consumo: string | null) => ((producao as any).renderTicket({ senha: 7, senhaPrefixo: 'B', consumo }, itens, 3, { perfil, cabecalho: 'Loja de teste' }) as string).split('\n');
    const viagem = via('viagem');
    expect(viagem[0]).toBe(`@CBD ${MARCA_VIAGEM}`); // antes do cabeçalho da loja e de qualquer campo do perfil
    expect(viagem[1]).toBe('@C Loja de teste');
    expect(viagem.join('\n')).toContain('2x Lanche de teste');
    for (const c of ['local', null]) expect(via(c).join('\n')).not.toContain('VIAGEM');
    expect(via(null)[0]).toBe('@C Loja de teste');
  });

  it('via que só sai quando a cozinha avança o pedido (adiada): o contexto leva a marca gravada no pedido', async () => {
    const l = await loja();
    const r = await noBalcao(l, 'viagem');
    const [ped] = await q(`select * from producao_pedido where comanda_id = $1`, [r.comandaId]);
    // KDS da loja com "imprime ao avançar" para o status "preparo", apontando para a impressora da cozinha
    const [imp] = await q(`select id from equipamento where tenant_id = $1 and tipo = 'impressora'`, [l.t]);
    const [setor] = await q(`insert into setor (tenant_id, unidade_id, nome) values ($1,$2,'Cozinha de teste') returning id`, [l.t, l.u]);
    await q(`insert into equipamento (tenant_id, unidade_id, tipo, nome, token, ativo, setor_id, imprime_ao_avancar, imprime_no_status, impressora_destino_id) values ($1,$2,'kds','KDS de teste',$3,true,$4,true,'preparo',$5)`, [l.t, l.u, randomUUID(), setor.id, imp.id]);
    await q(`delete from impressao_job where comanda_id = $1`, [r.comandaId]);
    const visto: any[] = [];
    const original = (producao as any).renderTicket.bind(producao);
    (producao as any).renderTicket = (ctx: any, ...resto: any[]) => { visto.push(ctx); return original(ctx, ...resto); };
    try {
      await (producao as any).imprimirNaEtapa(l.t, { id: ped.id, unidadeId: l.u, comandaId: r.comandaId, setorId: setor.id, destinoEquipamentoId: null, senha: ped.senha, origem: ped.origem, plataforma: null, senhaPlataforma: null, mesa: null, numero: ped.numero, consumo: ped.consumo }, 'preparo');
    } finally {
      (producao as any).renderTicket = original;
    }
    expect(visto).toHaveLength(1);
    expect(visto[0].consumo).toBe('viagem');
    await q(`delete from setor where id = $1`, [setor.id]).catch(() => {});
  });
});
