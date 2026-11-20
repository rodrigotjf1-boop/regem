import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Pool, type PoolClient } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { assinarCliente } from '../cliente/cliente-token';
import { expurgarFunil, expurgarInteracoes, lerInteracoes, metaDoFunil, normalizarTermo, oQueOlha, registrarInteracoes } from './interacoes-do-cardapio';
import { sql } from 'drizzle-orm';
import { SEGMENTOS_DO_PERFIL } from '../../common/segmentos-do-perfil';
import { gravarPrivacidade } from './privacidade-do-cliente';
import { paraOCliente } from './para-o-cliente';
import { PerfilClienteService } from './perfil-cliente.service';

const MIG = (n: string) => join(__dirname, '..', '..', '..', '..', 'database', 'migrations', n);
const semFkCompartilhada = (s: string) =>
  s.replace(/\s+references\s+(empresa|unidade|cliente|cupom)\s*\(\s*id\s*\)(\s+on\s+delete\s+cascade)?/gi, '');

/* eslint-disable @typescript-eslint/no-explicit-any */

describe('os cliques do cardápio (sem banco)', () => {
  it('a busca normalizada e o lote lido sem recusar: o torto fica de fora', () => {
    expect(normalizarTermo('  AÇAÍ   na\tTigela ')).toBe('açaí na tigela');
    expect(normalizarTermo('a')).toBeNull();
    expect(normalizarTermo(42)).toBeNull();
    const id = randomUUID();
    const l = lerInteracoes({
      sessao: 'abc123xyz',
      eventos: [
        { tipo: 'produto_aberto', produtoId: id, ms: 4200 },
        { tipo: 'produto_aberto', produtoId: id, ms: 99_999_999 }, // tempo absurdo: fica, sem o tempo
        { tipo: 'produto_adicionado', produtoId: 'nao-e-uuid' },
        { tipo: 'clicou_no_banner', produtoId: id },
        { tipo: 'busca', termo: 'Vegano', resultados: 0 },
      ],
    });
    expect(l.sessao).toBe('abc123xyz');
    expect(l.eventos).toEqual([
      { tipo: 'produto_aberto', produto_id: id, ms: 4200, termo: null, resultados: null },
      { tipo: 'produto_aberto', produto_id: id, ms: null, termo: null, resultados: null },
      { tipo: 'busca', produto_id: null, ms: null, termo: 'vegano', resultados: 0 },
    ]);
    expect(lerInteracoes({ sessao: 'x', eventos: [{ tipo: 'busca', termo: 'pizza' }] }).sessao).toBeNull();
    expect(lerInteracoes({ sessao: 'abc123xyz', eventos: Array.from({ length: 40 }, () => ({ tipo: 'busca', termo: 'pizza' })) }).eventos).toHaveLength(25);
  });

  it('o meta do funil: objeto de até 1.000 letras; o resto vira nulo', () => {
    expect(metaDoFunil({ total: 42.5, itens: 3 })).toBe('{"total":42.5,"itens":3}');
    expect(metaDoFunil({ texto: 'x'.repeat(2000) })).toBeNull();
    expect(metaDoFunil('texto solto')).toBeNull();
    expect(metaDoFunil([1, 2])).toBeNull();
    expect(metaDoFunil(null)).toBeNull();
  });
});

// F4 do plano do perfil do cliente (mig 466), contra o Postgres: só com o módulo ligado; anônimo por padrão; o cliente só
// com a prova e o "sim" das recomendações; produto de outra empresa fora; a limpeza dos 90 dias; a Saúde da base.
const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('interacoes-pg.spec: sem TEST_PG_URL — PULADO');

descrever('os cliques do cardápio (Postgres)', () => {
  jest.setTimeout(120_000);
  // As tabelas só da nuvem (459 e 466) num schema SÓ DESTE TESTE, sem chave estrangeira para as compartilhadas (LIC-088);
  // cada teste numa transação desfeita, só com DML (o DDL fica no beforeAll — ERR-539).
  const SCHEMA = `teste_clique_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
  const admin = new Pool({ connectionString: URL_PG });
  const pool = new Pool({ connectionString: URL_PG, options: `-c search_path=${SCHEMA},public` });
  const segredoAntes = process.env.JWT_SECRET;
  beforeAll(async () => {
    if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 16) process.env.JWT_SECRET = 'segredo-de-teste-dos-cliques-1';
    await admin.query(`create schema ${SCHEMA}`);
    for (const m of ['196_cardapio_evento.sql', '459_perfil_do_cliente.sql', '463_cliente_evento_sensibilidade.sql', '466_cardapio_interacao.sql']) await pool.query(semFkCompartilhada(readFileSync(MIG(m), 'utf8')));
  }, 60_000);
  afterAll(async () => {
    if (segredoAntes === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = segredoAntes;
    await pool.end();
    await admin.query(`drop schema if exists ${SCHEMA} cascade`).catch(() => {});
    await admin.end();
  }, 60_000);

  async function naTransacao(f: (c: PoolClient, q: (s: string, p?: any[]) => Promise<any[]>) => Promise<void>) {
    const c = await pool.connect();
    try {
      await c.query('begin');
      await f(c, (s, p = []) => c.query(s, p).then((r) => r.rows));
    } finally {
      await c.query('rollback').catch(() => {});
      c.release();
    }
  }
  async function loja(q: (s: string, p?: any[]) => Promise<any[]>, ligado: boolean) {
    const t = (await q(`insert into empresa (nome) values ('teste cliques') returning id`))[0].id as string;
    const token = `tok-${randomUUID()}`;
    await q(`insert into cardapio_config (tenant_id, token, ativo) values ($1,$2,true)`, [t, token]);
    if (ligado) await q(`insert into modulo_ativacao (tenant_id, unidade_id, modulo, ativo) values ($1, null, 'perfil_cliente', true)`, [t]);
    const produto = (await q(`insert into produto (tenant_id, nome) values ($1,'Costela BBQ') returning id`, [t]))[0].id as string;
    return { t, token, produto };
  }

  it('módulo desligado: nada é gravado; ligado: grava anônimo; o produto de outra empresa fica fora', () =>
    naTransacao(async (c, q) => {
      const db = drizzle(c as any);
      const off = await loja(q, false);
      expect(await registrarInteracoes(db, off.token, { sessao: 'sessao01', eventos: [{ tipo: 'produto_aberto', produtoId: off.produto, ms: 5000 }] })).toEqual({ gravadas: 0 });
      const on = await loja(q, true);
      const r = await registrarInteracoes(db, on.token, {
        sessao: 'sessao02',
        eventos: [
          { tipo: 'produto_aberto', produtoId: on.produto, ms: 12000 },
          { tipo: 'produto_adicionado', produtoId: on.produto },
          { tipo: 'produto_aberto', produtoId: off.produto, ms: 3000 }, // de outra empresa
          { tipo: 'busca', termo: 'Açaí', resultados: 0 },
        ],
      });
      expect(r).toEqual({ gravadas: 3 });
      expect(await q(`select tipo, cliente_id, termo from cardapio_interacao where tenant_id = $1 order by id`, [on.t])).toEqual([
        { tipo: 'produto_aberto', cliente_id: null, termo: null },
        { tipo: 'produto_adicionado', cliente_id: null, termo: null },
        { tipo: 'busca', cliente_id: null, termo: 'açaí' },
      ]);
      expect(await q(`select count(*)::int as n from cardapio_interacao where tenant_id = $1`, [off.t])).toEqual([{ n: 0 }]);
      // Cardápio que não existe: nada, e sem erro.
      expect(await registrarInteracoes(db, `tok-${randomUUID()}`, { sessao: 'sessao02', eventos: [{ tipo: 'busca', termo: 'pizza' }] })).toEqual({ gravadas: 0 });
    }));

  it('o cliente só entra com a prova (token do código) E o "sim" das recomendações — e só dali em diante', () =>
    naTransacao(async (c, q) => {
      const db = drizzle(c as any);
      const on = await loja(q, true);
      const ana = (await q(`insert into cliente (tenant_id, nome, telefone) values ($1,'Ana','21988880001') returning id`, [on.t]))[0].id as string;
      const clienteToken = assinarCliente(ana, on.t);
      const ev = (ms: number) => ({ sessao: 'sessao03', clienteToken, eventos: [{ tipo: 'produto_aberto', produtoId: on.produto, ms }] });
      await registrarInteracoes(db, on.token, ev(1000)); // ainda sem o "sim": anônimo
      await q(`insert into cliente_escolha (tenant_id, cliente_id, escolha, valor, origem) values ($1,$2,'recomendacoes',true,'cardapio_perfil')`, [on.t, ana]);
      await registrarInteracoes(db, on.token, ev(2000)); // com o "sim": dela
      await registrarInteracoes(db, on.token, { ...ev(2500), clienteToken: `${clienteToken}x` }); // token adulterado: anônimo
      // O token de uma empresa não serve no cardápio de OUTRA.
      const outra = await loja(q, true);
      await registrarInteracoes(db, outra.token, { sessao: 'sessao04', clienteToken, eventos: [{ tipo: 'produto_aberto', produtoId: outra.produto, ms: 3000 }] });
      expect(await q(`select ms, cliente_id from cardapio_interacao where tenant_id = $1 order by id`, [on.t])).toEqual([
        { ms: 1000, cliente_id: null },
        { ms: 2000, cliente_id: ana },
        { ms: 2500, cliente_id: null },
      ]);
      expect(await q(`select cliente_id from cardapio_interacao where tenant_id = $1`, [outra.t])).toEqual([{ cliente_id: null }]);
      // Desligou as recomendações: volta a ser anônimo.
      await q(`insert into cliente_escolha (tenant_id, cliente_id, escolha, valor, origem) values ($1,$2,'recomendacoes',false,'cardapio_perfil')`, [on.t, ana]);
      await registrarInteracoes(db, on.token, ev(3000));
      expect(await q(`select cliente_id from cardapio_interacao where tenant_id = $1 and ms = 3000`, [on.t])).toEqual([{ cliente_id: null }]);
    }));

  it('F4b · o que olha (pontos com meia-vida) e o "viu e não pediu" — a mesma régua na ficha, na aba e na contagem', () =>
    naTransacao(async (c, q) => {
      const db = drizzle(c as any);
      const on = await loja(q, true);
      const u = (await q(`insert into unidade (tenant_id, nome) values ($1,'Loja') returning id`, [on.t]))[0].id as string;
      const prod = async (nome: string) => (await q(`insert into produto (tenant_id, nome) values ($1,$2) returning id`, [on.t, nome]))[0].id as string;
      const [costela, combo, pudim] = [on.produto, await prod('Combo família'), await prod('Pudim')];
      const ana = (await q(`insert into cliente (tenant_id, nome, telefone) values ($1,'Ana','21977770001') returning id`, [on.t]))[0].id as string;
      const bia = (await q(`insert into cliente (tenant_id, nome, telefone) values ($1,'Bia','21977770002') returning id`, [on.t]))[0].id as string;
      for (const id of [ana, bia])
        await q(`insert into cliente_escolha (tenant_id, cliente_id, escolha, valor, origem) values ($1,$2,'recomendacoes',true,'cardapio_perfil')`, [on.t, id]);
      const ev = (cliente: string, sessao: string, eventos: any[]) =>
        registrarInteracoes(db, on.token, { sessao, clienteToken: assinarCliente(cliente, on.t), eventos });
      // Ana: a Costela aberta 2 vezes (uma com 12 s) e não pedida; o Combo no carrinho; o Pudim aberto 2 vezes e PEDIDO depois.
      await ev(ana, 'visita01', [
        { tipo: 'produto_aberto', produtoId: costela, ms: 12000 },
        { tipo: 'produto_adicionado', produtoId: combo },
        { tipo: 'produto_aberto', produtoId: pudim, ms: 2000 },
      ]);
      await ev(ana, 'visita02', [
        { tipo: 'produto_aberto', produtoId: costela, ms: 3000 },
        { tipo: 'produto_aberto', produtoId: pudim, ms: 2000 },
      ]);
      await q(
        `insert into pedido_externo (tenant_id, unidade_id, canal, external_id, display_id, cliente_nome, tipo, status, itens, total, cliente_id, criado_em)
         values ($1,$2,'cardapio_web',$3,'1','Ana','entrega','concluido',$4::jsonb,20,$5, clock_timestamp())`,
        [on.t, u, randomUUID(), JSON.stringify([{ produtoId: pudim, descricao: 'Pudim', quantidade: 1 }]), ana],
      );
      // Bia: a Costela aberta 1 vez só (não chega a "viu e não pediu").
      await ev(bia, 'visita03', [{ tipo: 'produto_aberto', produtoId: costela, ms: 4000 }]);

      const olha = await oQueOlha(db, on.t, ana);
      expect(olha.desde).not.toBeNull();
      expect(olha.itens).toEqual([
        { produtoId: combo, nome: 'Combo família', pontos: 4, viuNaoPediu: false },
        { produtoId: costela, nome: 'Costela BBQ', pontos: 3, viuNaoPediu: true },
        { produtoId: pudim, nome: 'Pudim', pontos: 2, viuNaoPediu: false },
      ]);
      // A aba e a contagem: só a Ana.
      const naAba: any = await db.execute(sql`select c.id from cliente c where c.tenant_id = ${on.t}::uuid ${SEGMENTOS_DO_PERFIL.perfil_olhou.cond}`);
      expect(naAba.rows.map((r: any) => r.id)).toEqual([ana]);
      expect((await new PerfilClienteService(db as any).resumo(on.t)).olharam).toBe(1);

      // Desligou as recomendações: os cliques dela voltam a ser anônimos na hora (a soma da loja continua).
      await gravarPrivacidade(db, { tenantId: on.t, id: ana }, { origem: 'cardapio_perfil', escolhas: [{ escolha: 'recomendacoes', valor: false }], declarado: [] });
      expect(await q(`select count(*)::int as n from cardapio_interacao where cliente_id = $1`, [ana])).toEqual([{ n: 0 }]);
      expect(await q(`select count(*)::int as n from cardapio_interacao where tenant_id = $1`, [on.t])).toEqual([{ n: 6 }]);
      expect((await oQueOlha(db, on.t, ana)).itens).toEqual([]);
      // "Não quero ser analisado" com as recomendações ligadas: o clique novo também não se liga a ela.
      await q(`insert into cliente_escolha (tenant_id, cliente_id, escolha, valor, origem) values ($1,$2,'nao_analisar',true,'cardapio_perfil')`, [on.t, bia]);
      await ev(bia, 'visita04', [{ tipo: 'produto_aberto', produtoId: costela, ms: 4000 }]);
      expect(await q(`select count(*)::int as n from cardapio_interacao where cliente_id = $1`, [bia])).toEqual([{ n: 1 }]);
    }));

  it('F8 · o cardápio para o cliente: o de sempre (dos pedidos), "você viu" e a ordem das categorias (só com o "sim")', () =>
    naTransacao(async (c, q) => {
      const db = drizzle(c as any);
      const on = await loja(q, true);
      const cat = async (nome: string) => (await q(`insert into categoria_produto (tenant_id, nome) values ($1,$2) returning id`, [on.t, nome]))[0].id as string;
      const [burgers, doces] = [await cat('Burgers'), await cat('Sobremesas')];
      const prod = async (nome: string, categoria: string, codigo: string | null = null) =>
        (await q(`insert into produto (tenant_id, nome, categoria_id, codigo) values ($1,$2,$3,$4) returning id`, [on.t, nome, categoria, codigo]))[0].id as string;
      const xbacon = await prod('X-Bacon da casa', burgers, '10');
      const costela = await prod('Costela da casa', burgers);
      const pudim = await prod('Pudim', doces);
      const ana = (await q(`insert into cliente (tenant_id, nome, telefone) values ($1,'Ana','21966660011') returning id`, [on.t]))[0].id as string;
      const ct = assinarCliente(ana, on.t);
      await q(`insert into cliente_perfil (cliente_id, tenant_id, confianca, camadas) values ($1,$2,'media',$3::jsonb)`, [
        ana, on.t, JSON.stringify({ gosto: { de_sempre: { nome: 'X-Bacon da casa', pedidos: 5, chave: '10' } } }),
      ]);
      const VAZIO = { deSempre: null, voceViu: [], ordemCategorias: [] };

      // Sem as recomendações: só o de sempre (vem dos pedidos), achado pelo código PDV.
      expect(await paraOCliente(db, on.token, ct)).toEqual({ deSempre: xbacon, voceViu: [], ordemCategorias: [] });
      // Sem prova, com token de outra empresa ou cardápio desconhecido: nada.
      expect(await paraOCliente(db, on.token, undefined)).toEqual(VAZIO);
      expect(await paraOCliente(db, on.token, `${ct}x`)).toEqual(VAZIO);
      const outra = await loja(q, true);
      expect(await paraOCliente(db, outra.token, ct)).toEqual(VAZIO);
      expect(await paraOCliente(db, `tok-${randomUUID()}`, ct)).toEqual(VAZIO);

      // Com o "sim": a Costela aberta 2 vezes e não pedida → "você viu"; o Pudim no carrinho pesa mais → Sobremesas primeiro.
      await q(`insert into cliente_escolha (tenant_id, cliente_id, escolha, valor, origem) values ($1,$2,'recomendacoes',true,'cardapio_perfil')`, [on.t, ana]);
      await registrarInteracoes(db, on.token, {
        sessao: 'visita21', clienteToken: ct,
        eventos: [
          { tipo: 'produto_aberto', produtoId: costela, ms: 3000 },
          { tipo: 'produto_aberto', produtoId: costela, ms: 3000 },
          { tipo: 'produto_adicionado', produtoId: pudim },
        ],
      });
      expect(await paraOCliente(db, on.token, ct)).toEqual({ deSempre: xbacon, voceViu: [costela], ordemCategorias: [doces, burgers] });

      // O de sempre sem chave (perfil antigo): pelo nome igual.
      await q(`update cliente_perfil set camadas = $2::jsonb where cliente_id = $1`, [ana, JSON.stringify({ gosto: { de_sempre: { nome: 'x-bacon da casa ', pedidos: 5 } } })]);
      expect((await paraOCliente(db, on.token, ct)).deSempre).toBe(xbacon);

      // "Não quero ser analisado": nada (nem o de sempre). Módulo desligado: nada.
      await q(`insert into cliente_escolha (tenant_id, cliente_id, escolha, valor, origem) values ($1,$2,'nao_analisar',true,'cardapio_perfil')`, [on.t, ana]);
      expect(await paraOCliente(db, on.token, ct)).toEqual(VAZIO);
      await q(`insert into cliente_escolha (tenant_id, cliente_id, escolha, valor, origem) values ($1,$2,'nao_analisar',false,'cardapio_perfil')`, [on.t, ana]);
      await q(`update modulo_ativacao set ativo = false where tenant_id = $1 and modulo = 'perfil_cliente'`, [on.t]);
      expect(await paraOCliente(db, on.token, ct)).toEqual(VAZIO);
    }));

  it('Saúde da base · o resumo em frases e o dado de cada camada (pedidos diretos; iFood fora)', () =>
    naTransacao(async (c, q) => {
      const db = drizzle(c as any);
      const on = await loja(q, true);
      const u = (await q(`insert into unidade (tenant_id, nome) values ($1,'Loja') returning id`, [on.t]))[0].id as string;
      const cli = async (nome: string, tel: string) =>
        (await q(`insert into cliente (tenant_id, nome, telefone) values ($1,$2,$3) returning id`, [on.t, nome, tel]))[0].id as string;
      const pedido = (cliente: string, em: string, canal = 'cardapio_web') =>
        q(
          `insert into pedido_externo (tenant_id, unidade_id, canal, external_id, display_id, cliente_nome, tipo, status, itens, total, cliente_id, criado_em)
           values ($1,$2,$3,$4,'1','x','entrega','concluido','[]'::jsonb,50,$5, ${em})`,
          [on.t, u, canal, randomUUID(), cliente],
        );
      const INI_ANT = `((date_trunc('month', now() at time zone 'America/Sao_Paulo') - interval '1 month') at time zone 'America/Sao_Paulo')`;
      const [ana, bia, caio, duda, eva, ifo] = [
        await cli('Ana', '21900000001'), await cli('Bia', '21900000002'), await cli('Caio', '21900000003'),
        await cli('Duda', '21900000004'), await cli('Eva', '21900000005'), await cli('Ivo', '21900000006'),
      ];
      await pedido(ana, 'now()'); // nova este mês, 1 pedido
      await pedido(bia, 'now()'); await pedido(bia, 'now()'); // nova este mês, já fez o 2º
      await pedido(caio, INI_ANT); await pedido(caio, INI_ANT); // novo no mesmo pedaço do mês passado, com o 2º
      await pedido(duda, INI_ANT); // novo no mês passado, sem o 2º
      await pedido(eva, "now() - interval '100 days'"); await pedido(eva, 'now()'); // voltou depois de 60 dias
      await pedido(ifo, 'now()', 'ifood'); // iFood não conta

      const fabi = await cli('Fabi', '21900000007');
      const gabi = await cli('Gabi', '21900000008');
      const hugo = await cli('Hugo', '21900000009');
      await q(
        `insert into cliente_perfil (cliente_id, tenant_id, pedidos_diretos, intervalo_dias, ultimo_pedido_em, faixa_habitual, confianca, camadas) values
           ($1,$4,5,7, now() - interval '20 days','noite','media',$5::jsonb),
           ($2,$4,3,20, now() - interval '10 days',null,'media','{}'::jsonb),
           ($3,$4,9,7, now() - interval '120 days','noite','alta','{}'::jsonb)`,
        [fabi, gabi, hugo, on.t, JSON.stringify({ reclamacoes: { grupos: [{ motivo: 'atraso', nome: 'atraso', vezes: 1 }] } })],
      );
      await q(
        `insert into cliente_evento_sensibilidade (cliente_id, tipo, tenant_id, rr, prob, pedidos, esperado, dias_com_pedido, selo)
         values ($1,'feriado',$2,2.1,0.95,6,2.5,4,true)`,
        [fabi, on.t],
      );
      await q(`insert into cardapio_interacao (tenant_id, sessao, cliente_id, tipo, termo, resultados) values ($1,'sessao09',$2,'busca','pizza',3)`, [on.t, gabi]);

      const s: any = await new PerfilClienteService(db as any).saude(on.t);
      expect(s.frase).toEqual({
        novos: 2, novos2o: 1, novosAnt: 2, novos2oAnt: 1, voltaram: 1,
        semanaisSumidos: 1, semanaisComReclamacao: 1, sumiuDias: 15,
      });
      // Ativos = pediram em 90 dias (Fabi e Gabi; o Hugo não); pede ≥ 3; quando ≥ 4 com a faixa; move = selo; olha = cliques.
      expect(s.dado).toEqual({ ativos: 2, pede: 2, quando: 1, move: 1, olha: 1, visitasComCliques30d: 1 });
      expect(s.reclamacoes).toEqual({ porMotivo: [{ nome: 'atraso', vezes: 1, clientes: 1 }], repetidos: 0 });
    }));

  it('Saúde da base · os itens da estreia que fazem voltar e os que levam a sumir (30 estreias ou mais)', () =>
    naTransacao(async (c, q) => {
      const db = drizzle(c as any);
      const on = await loja(q, true);
      const u = (await q(`insert into unidade (tenant_id, nome) values ($1,'Loja') returning id`, [on.t]))[0].id as string;
      // Um grupo de clientes: a estreia (60 dias atrás) com os itens; os "voltam" fazem o 2º pedido 10 dias depois.
      const grupo = async (prefixo: string, n: number, itens: string[], voltam: number, estreia = "now() - interval '60 days'") => {
        const ids = (await q(
          `insert into cliente (tenant_id, nome, telefone)
           select $1, $2 || g, '219' || $3 || lpad(g::text, 5, '0') from generate_series(1, $4::int) g returning id`,
          [on.t, prefixo, String(prefixo.charCodeAt(0)), n],
        )).map((r: any) => r.id as string);
        const json = JSON.stringify(itens.map((d) => ({ descricao: d, quantidade: 1 })));
        await q(
          `insert into pedido_externo (tenant_id, unidade_id, canal, external_id, display_id, cliente_nome, tipo, status, itens, total, cliente_id, criado_em)
           select $1, $2, 'cardapio_web', gen_random_uuid()::text, '1', 'x', 'entrega', 'concluido', $3::jsonb, 50, id, ${estreia}
             from unnest($4::uuid[]) id`,
          [on.t, u, json, ids],
        );
        await q(
          `insert into pedido_externo (tenant_id, unidade_id, canal, external_id, display_id, cliente_nome, tipo, status, itens, total, cliente_id, criado_em)
           select $1, $2, 'cardapio_web', gen_random_uuid()::text, '2', 'x', 'entrega', 'concluido', '[]'::jsonb, 50, id, (${estreia}) + interval '10 days'
             from unnest($3::uuid[]) id`,
          [on.t, u, ids.slice(0, voltam)],
        );
      };
      await grupo('A', 30, ['Smash duplo', 'Batata'], 12); // Smash 12/30 = 40%
      await grupo('B', 30, ['Costela BBQ', 'Batata', 'Salada da casa'], 3); // Costela e Salada 3/30; Batata 15/60 = 25%
      await grupo('C', 5, ['Wrap de frango'], 0); // menos de 30 estreias: fora da lista, dentro da média
      await grupo('D', 30, ['Pastel'], 30, "now() - interval '10 days'"); // estreia recente: a janela de 30 dias não fechou

      const s: any = await new PerfilClienteService(db as any).saude(on.t);
      expect(s.itens).toEqual({
        estreias: 65,
        voltaram: 15,
        minimo: 30,
        voltam: [
          { nome: 'Smash duplo', estreias: 30, voltaram: 12 },
          { nome: 'Batata', estreias: 60, voltaram: 15 },
          { nome: 'Costela BBQ', estreias: 30, voltaram: 3 },
        ],
        somem: [{ nome: 'Salada da casa', estreias: 30, voltaram: 3 }],
      });
    }));

  it('Saúde da base · cliques e respostas somados sem pessoa (30 dias); a limpeza apaga o que passou de 90 dias', () =>
    naTransacao(async (c, q) => {
      const db = drizzle(c as any);
      const on = await loja(q, true);
      await registrarInteracoes(db, on.token, {
        sessao: 'sessao05',
        eventos: [
          { tipo: 'busca', termo: 'açaí', resultados: 0 },
          { tipo: 'busca', termo: 'costela', resultados: 1 },
          { tipo: 'produto_aberto', produtoId: on.produto, ms: 8000 },
        ],
      });
      await registrarInteracoes(db, on.token, { sessao: 'sessao06', eventos: [{ tipo: 'busca', termo: 'Açaí', resultados: 0 }] });
      await q(`insert into cardapio_interacao (tenant_id, sessao, tipo, termo, resultados, em) values ($1,'velha01','busca','pastel',0, now() - interval '91 days')`, [on.t]);
      const ana = (await q(`insert into cliente (tenant_id, nome, telefone) values ($1,'Ana','21988880002') returning id`, [on.t]))[0].id as string;
      const bia = (await q(`insert into cliente (tenant_id, nome, telefone) values ($1,'Bia','21988880003') returning id`, [on.t]))[0].id as string;
      await q(`insert into cliente_declarado (tenant_id, cliente_id, chave, valor, origem) values ($1,$2,'gostaria','["Açaí","Doces"]'::jsonb,'cardapio_perfil'), ($1,$3,'gostaria','["Açaí"]'::jsonb,'cardapio_perfil')`, [on.t, ana, bia]);
      await q(`insert into cliente_perfil (cliente_id, tenant_id, confianca, camadas) values ($1,$2,'media',$3::jsonb), ($4,$2,'baixa',$5::jsonb)`, [
        ana, on.t, JSON.stringify({ reclamacoes: { grupos: [{ motivo: 'atraso', nome: 'atraso', vezes: 2 }] } }),
        bia, JSON.stringify({ reclamacoes: { grupos: [{ motivo: 'atraso', nome: 'atraso', vezes: 1 }, { motivo: 'frio', nome: 'chegou frio', vezes: 1 }] } }),
      ]);

      const s: any = await new PerfilClienteService(db as any).saude(on.t);
      // A busca de 91 dias atrás não entra; "açaí" foi buscado em 2 visitas, sem resultado; "costela" achou.
      expect(s.buscas).toEqual([{ termo: 'açaí', vezes: 2, pessoas: 2 }]);
      expect(s.abertos).toEqual([{ produto_id: on.produto, nome: 'Costela BBQ', abriram: 1, carrinho: 0 }]);
      expect(s.gostaria).toEqual([{ opcao: 'Açaí', n: 2 }, { opcao: 'Doces', n: 1 }]);
      expect(s.reclamacoes).toEqual({ porMotivo: [{ nome: 'atraso', vezes: 3, clientes: 2 }, { nome: 'chegou frio', vezes: 1, clientes: 1 }], repetidos: 1 });
      expect(s.dado.visitasComCliques30d).toBe(2);

      // Outra empresa não vê nada desta; nenhum bloco falhou (todos lidos, mesmo vazios).
      const outra = await loja(q, true);
      const vazio: any = await new PerfilClienteService(db as any).saude(outra.t);
      expect(vazio).toEqual({
        frase: { novos: 0, novos2o: 0, novosAnt: 0, novos2oAnt: 0, voltaram: 0, semanaisSumidos: 0, semanaisComReclamacao: 0, sumiuDias: 15 },
        itens: { estreias: 0, voltaram: 0, minimo: 30, voltam: [], somem: [] },
        gostaria: [], reclamacoes: { porMotivo: [], repetidos: 0 }, buscas: [], abertos: [],
        dado: { ativos: 0, pede: 0, quando: 0, move: 0, olha: 0, visitasComCliques30d: 0 },
      });

      expect(await expurgarInteracoes(db)).toBeGreaterThanOrEqual(1);
      expect(await q(`select sessao from cardapio_interacao where tenant_id = $1 and sessao = 'velha01'`, [on.t])).toEqual([]);
      expect(await q(`select count(*)::int as n from cardapio_interacao where tenant_id = $1`, [on.t])).toEqual([{ n: 4 }]);

      // O funil (mig 196): sai só o que passou de 400 dias (o relatório lê até 365).
      await q(
        `insert into cardapio_evento (tenant_id, token, sessao, tipo, criado_em) values
           ($1,$2,'s1','view_menu', now() - interval '401 days'), ($1,$2,'s2','view_menu', now() - interval '364 days'), ($1,$2,'s3','pedido', now())`,
        [on.t, on.token],
      );
      expect(await expurgarFunil(db)).toBe(1);
      expect(await q(`select sessao from cardapio_evento where tenant_id = $1 order by sessao`, [on.t])).toEqual([{ sessao: 's2' }, { sessao: 's3' }]);
    }));
});
