import 'reflect-metadata';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Global, INestApplication, Module } from '@nestjs/common';
import { APP_GUARD, NestFactory } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { DRIZZLE } from '../../db/drizzle.module';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { repetirNaCorridaDeCatalogo } from '../../common/corrida-de-catalogo';
import { CfThrottlerGuard } from '../../common/cf-throttler.guard';
import { CloudOnlyGuard } from '../../common/cloud-only.guard';
import { IntegracaoApiModule } from './integracao-api.module';
import { IntegracaoTokenService } from './integracao-token.service';
import { AutorizacaoLojaService } from './autorizacao-loja.service';
import { clienteAutorizacao } from './autorizacao-loja';
import { CarimbadorIntegracaoService } from './carimbador-integracao.service';
import { CatalogoIntegracaoService } from './catalogo-integracao.service';
import { ProducaoIntegracaoService } from './producao-integracao.service';
import type { IntegracaoCtxData } from './integracao-token.guard';

/* eslint-disable @typescript-eslint/no-explicit-any */

// API DE INTEGRAÇÃO PARA O FAROL (mig 315 — contrato em docs/integracao-farol.md), contra o Postgres
// real e por HTTP (Nest com os guards globais de produção).
//
// O banco do CI é montado como servidor de loja (EDGE_MODE=true): as migrations só da nuvem (295,
// 296, 297, 299, 303 e 315) não existem nele. Elas sobem num schema SÓ DESTE TESTE, na frente do
// `public`; as tabelas em que a 296 põe gatilho (pedido_externo, comanda, comanda_item, cliente) são
// CÓPIAS nesse schema, sem chave estrangeira (LIC-088/ERR-109): as outras specs, no mesmo banco,
// nunca disparam os gatilhos daqui. O catálogo (produto, ficha, adicionais…) é o do `public`, com
// empresas só desta spec. O carimbador roda SÓ nas empresas desta spec (V32).
//
// O que se prova:
//   • o escopo de cada rota (403), o token revogado (401) e que o token do Farol não lê vendas;
//   • o retrato do catálogo e o das fichas, campo a campo;
//   • NENHUM campo de dinheiro nas duas respostas, com o cadastro cheio de preço e custo (ERR-166);
//   • a loja A não lê a loja B, nem a outra empresa; a empresa de uma loja só lê tudo;
//   • a versão: igual → "nada mudou"; preço mudou → a mesma; conteúdo mudou → outra;
//   • o mesmo número de consultas com 4 produtos e com 500 produtos e 2.000 opções;
//   • a autorização pela loja do Farol: as três leituras de uma vez, sem nada para ligar ou desligar;
//   • o token do Farol NÃO liga o carimbador das vendas (carga, fila, reconciliação);
//   • a fila de produção (fase 2): a janela, o pedido e o item campo a campo, as escolhas com o id
//     fixo da opção, SEM o cliente, a mesa, a senha, o motivo do cancelamento e sem valores; a loja
//     do token; a versão; e três consultas com 5 pedidos ou com 300.

const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('integracao-farol.http.spec: sem TEST_PG_URL — PULADO');

jest.setTimeout(180_000);

const MIGS = join(__dirname, '..', '..', '..', '..', 'database', 'migrations');
const mig = (n: string) => readFileSync(join(MIGS, n), 'utf8');
const semFkCompartilhada = (s: string) =>
  s.replace(/\s+references\s+(empresa|unidade)\s*\(\s*id\s*\)(\s+on\s+delete\s+cascade)?/gi, '');
// (`comanda_item_complemento` não tem gatilho: é cópia porque, no banco, aponta para `comanda_item` —
// e a fila de produção lê as escolhas do item da venda, que aqui é a cópia.)
const FONTES = ['pedido_externo', 'comanda', 'comanda_item', 'comanda_item_complemento', 'cliente', 'cupom', 'cupom_uso'];
const ESCOPOS_FAROL = ['catalogo.ler', 'fichas.ler', 'producao.ler'];

// Valores de dinheiro do cadastro deste teste: nenhum pode aparecer em resposta nenhuma.
const DINHEIRO = ['123.45', '67.89', '45.67', '9.87', '34.56', '88.88', '31.5'];
const NOME_DE_DINHEIRO = /pre[cç]o|custo|margem|cmv|valor|markup|delta|centavo|venda/i;

/** Todo nome de campo de um JSON, em qualquer profundidade. */
function nomesDosCampos(v: unknown, achados = new Set<string>()): Set<string> {
  if (Array.isArray(v)) for (const x of v) nomesDosCampos(x, achados);
  else if (v && typeof v === 'object') {
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      achados.add(k);
      nomesDosCampos(x, achados);
    }
  }
  return achados;
}

descrever('API de integração — Farol (catálogo e fichas, sem preço nem custo)', () => {
  const SCHEMA = `teste_integracao_farol_${process.pid}_${Date.now()}`;
  const pool = new Pool({ connectionString: URL_PG, options: `-c search_path=${SCHEMA},public`, max: 6 });
  const db = drizzle(pool) as any;
  const registros: any[] = [];
  const auditoria = { registrar: async (e: any) => void registros.push(e) } as unknown as AuditoriaService;
  const tokensSvc = new IntegracaoTokenService(db, auditoria);
  const autorizacao = new AutorizacaoLojaService(db, auditoria, tokensSvc);
  const empresas: string[] = [];
  const q = (s: string, p: any[] = []) => pool.query(s, p).then((r) => r.rows);
  const dist = { sub: randomUUID(), nome: 'Diretoria Teste', perfil: 'diretoria' };
  const edgeOriginal = process.env.EDGE_MODE;
  const envOriginal = {
    segredo: process.env.INTEGRACAO_FAROL_CLIENT_SECRET,
    volta: process.env.INTEGRACAO_FAROL_REDIRECT_URIS,
  };
  let app: INestApplication;
  let base = '';
  let carimbador: CarimbadorIntegracaoService;

  @Global()
  @Module({
    providers: [{ provide: DRIZZLE, useValue: db }, { provide: AuditoriaService, useValue: auditoria }],
    exports: [DRIZZLE, AuditoriaService],
  })
  class InfraTeste {}

  @Module({
    imports: [InfraTeste, ThrottlerModule.forRoot([{ ttl: 60000, limit: 600 }]), IntegracaoApiModule],
    providers: [
      { provide: APP_GUARD, useClass: CfThrottlerGuard },
      { provide: APP_GUARD, useClass: CloudOnlyGuard },
    ],
  })
  class AppTeste {}

  const chamar = (caminho: string, token: string) => fetch(`${base}${caminho}`, { headers: { authorization: `Bearer ${token}` } });
  const ler = async (caminho: string, token: string) => {
    const r = await chamar(caminho, token);
    return { status: r.status, corpo: (await r.json()) as any };
  };

  // ───────────────────────────── montagem dos dados ─────────────────────────────

  /** Insere uma linha e devolve o id. As colunas são as do banco. */
  async function ins(tabela: string, linha: Record<string, unknown>): Promise<string> {
    const colunas = Object.keys(linha);
    const [r] = await q(
      `insert into ${tabela} (${colunas.join(', ')}) values (${colunas.map((_, i) => `$${i + 1}`).join(', ')}) returning id`,
      colunas.map((c) => linha[c]),
    );
    return r.id as string;
  }

  async function empresa(nome: string, lojas: string[]) {
    const [e] = await q(`insert into empresa (nome) values ($1) returning id`, [`${nome} ${randomUUID().slice(0, 6)}`]);
    empresas.push(e.id);
    const ids: string[] = [];
    for (const [i, l] of lojas.entries()) {
      const [u] = await q(
        `insert into unidade (tenant_id, nome, tipo, created_at) values ($1, $2, $3, now() - make_interval(mins => $4)) returning id`,
        [e.id, l, i === 0 ? 'matriz' : 'filial', 100 - i],
      );
      ids.push(u.id);
    }
    const [f] = await q(`insert into funcao (tenant_id, nome, categoria) values ($1, 'Presidência', 'presidente') returning id`, [e.id]);
    const [c] = await q(`insert into colaborador (tenant_id, nome, funcao_id) values ($1, $2, $3) returning id`, [
      e.id,
      `Presidente ${nome}`,
      f.id,
    ]);
    return { tenant: e.id as string, lojas: ids, presidente: c.id as string };
  }

  type Emp = { tenant: string; lojas: string[]; presidente: string };

  async function emitir(e: Emp, loja: string, cliente: string, escopos: string[]) {
    const r = await tokensSvc.emitir(
      { tenantId: e.tenant, unidadeId: loja, cliente, autorizadoPor: e.presidente, escopos, evidencia: 'autorização por escrito (teste)' },
      dist,
    );
    return r as { id: string; token: string };
  }

  const ctxDe = (e: Emp, loja: string, lojaUnica = false): IntegracaoCtxData => ({
    tokenId: randomUUID(),
    tenantId: e.tenant,
    unidadeId: loja,
    abrangencia: 'loja',
    lojaUnica,
    escopos: ESCOPOS_FAROL as any,
    cliente: 'farol',
    autorizadoPor: e.presidente,
    prefixo: 'rgm_it_teste',
  });

  let A: Emp;
  let B: Emp;
  let D: Emp;
  let tA1 = '';
  let tA2 = '';
  let tB1 = '';
  let tD1 = '';
  let tLiameA1 = '';
  const id: Record<string, string> = {};

  /** O cadastro da empresa A: cheio de preço e custo de propósito. */
  async function cadastroDaA() {
    const t = A.tenant;
    const [a1, a2] = A.lojas;
    id.catLanches = await ins('categoria_produto', { tenant_id: t, nome: 'Lanches', ordem: 1 });
    id.catBurgers = await ins('categoria_produto', { tenant_id: t, nome: 'Burgers', parent_id: id.catLanches, ordem: 2 });
    id.catBebidas = await ins('categoria_produto', { tenant_id: t, nome: 'Bebidas', ordem: 3, ativo: false });
    await ins('categoria_produto', { tenant_id: t, nome: 'Apagada', ordem: 0, deleted_at: new Date().toISOString() });

    id.setorChapa = await ins('setor', { tenant_id: t, unidade_id: a1, nome: 'Chapa' });
    id.setorMontagem = await ins('setor', { tenant_id: t, unidade_id: a1, nome: 'Montagem' });
    id.setorA2 = await ins('setor', { tenant_id: t, unidade_id: a2, nome: 'Cozinha da filial' });

    id.itemPao = await ins('item_estoque', { tenant_id: t, nome: 'Pão brioche', unidade_medida: 'unidade', custo_medio: '34.56' });
    id.itemQueijo = await ins('item_estoque', { tenant_id: t, nome: 'Queijo prato', unidade_medida: 'kg', custo_medio: '34.56' });
    id.itemCebola = await ins('item_estoque', { tenant_id: t, nome: 'Cebola roxa', unidade_medida: 'kg', custo_medio: '34.56' });
    id.itemBacon = await ins('item_estoque', { tenant_id: t, nome: 'Bacon fatiado', unidade_medida: 'kg', custo_medio: '34.56' });
    id.itemCaixa = await ins('item_estoque', { tenant_id: t, nome: 'Caixa de lanche', unidade_medida: 'unidade', custo_medio: '34.56' });
    // 1 kg de queijo = 50 fatias: a ficha fala em fatia, o estoque guarda em kg.
    await ins('item_conversao', { tenant_id: t, item_id: id.itemQueijo, unidade_de: 'kg', fator: '50', unidade_para: 'fatia' });

    id.fichaBlend = await ins('ficha_tecnica', {
      tenant_id: t, nome: 'Blend da casa', categoria: 'base', rendimento: '10', rendimento_unidade: 'kg', preco_venda: '88.88',
    });
    id.fichaOvo = await ins('ficha_tecnica', { tenant_id: t, nome: 'Ovo frito', categoria: 'base', rendimento: '1', ativo: false });
    id.fichaXb = await ins('ficha_tecnica', {
      tenant_id: t, nome: 'X-Burger', categoria: 'lanche', rendimento: '1', rendimento_unidade: 'porção',
      porcao_tamanho: '1', porcao_unidade: 'unidade', setor_id: id.setorMontagem, preco_venda: '123.45',
    });
    id.fichaA2 = await ins('ficha_tecnica', { tenant_id: t, unidade_id: a2, nome: 'Só da filial', rendimento: '1' });
    await ins('ficha_tecnica', { tenant_id: t, nome: 'Ficha apagada', rendimento: '1', deleted_at: new Date().toISOString() });

    const ing = (ordem: number, linha: Record<string, unknown>) =>
      ins('ficha_ingrediente', { tenant_id: t, ficha_id: id.fichaXb, ordem, custo_unitario: '45.67', ...linha });
    await ing(0, { item_id: id.itemPao, insumo_nome: 'Pão brioche', quantidade: '1', unidade: 'unidade' });
    await ing(1, { sub_ficha_id: id.fichaBlend, insumo_nome: 'Blend da casa', quantidade: '0.12', unidade: 'kg' });
    // 2 fatias gravadas como 0,04 kg (a unidade do estoque).
    await ing(2, { item_id: id.itemQueijo, insumo_nome: 'Queijo prato', quantidade: '0.04', unidade: 'fatia' });
    id.ingCebola = await ing(3, { item_id: id.itemCebola, insumo_nome: 'Cebola roxa', quantidade: '0.01', unidade: 'kg', fator_correcao: '1.2' });
    await ing(4, { item_id: id.itemCaixa, insumo_nome: 'Caixa de lanche', quantidade: '1', unidade: 'unidade', somente_delivery: true });
    await ing(5, { insumo_nome: 'Sal', quantidade: '2', unidade: 'g' });
    await ing(6, { item_id: id.itemBacon, insumo_nome: 'Ingrediente apagado', quantidade: '9', unidade: 'kg', deleted_at: new Date().toISOString() });

    id.pXb = await ins('produto', {
      tenant_id: t, codigo: 'XB', nome: 'X-Burger', descricao: 'Pão, blend e queijo', categoria_id: id.catBurgers, ficha_id: id.fichaXb,
      tipo: 'variavel', preco_venda: '123.45', preco_custo: '67.89', vai_para_producao: true, setor_producao_id: id.setorMontagem,
      tempo_preparo_min: 12,
    });
    id.pRefri = await ins('produto', {
      tenant_id: t, codigo: 'REF', nome: 'Refrigerante lata', categoria_id: id.catBebidas, tipo: 'simples', preco_venda: '9.87',
      preco_custo: '67.89', vai_para_producao: false,
    });
    id.pCombo = await ins('produto', { tenant_id: t, codigo: 'CMB', nome: 'Combo da casa', tipo: 'combo', preco_venda: '123.45' });
    id.pParado = await ins('produto', { tenant_id: t, nome: 'X-Parado', tipo: 'simples', preco_venda: '123.45', ativo: false });
    id.pSoA1 = await ins('produto', { tenant_id: t, unidade_id: a1, nome: 'Só da matriz', tipo: 'simples', preco_venda: '123.45' });
    id.pSoA2 = await ins('produto', { tenant_id: t, unidade_id: a2, nome: 'Só da filial', tipo: 'simples', preco_venda: '123.45' });
    await ins('produto', { tenant_id: t, nome: 'Produto apagado', tipo: 'simples', preco_venda: '123.45', deleted_at: new Date().toISOString() });

    id.vSimples = await ins('produto_variacao', { tenant_id: t, produto_id: id.pXb, nome: 'Simples', codigo: 'XB-S', preco_venda: '123.45', fator_ficha: '1' });
    id.vDuplo = await ins('produto_variacao', { tenant_id: t, produto_id: id.pXb, nome: 'Duplo', codigo: 'XB-D', preco_venda: '123.45', fator_ficha: '2' });
    await ins('produto_variacao', {
      tenant_id: t, produto_id: id.pXb, nome: 'Variação apagada', preco_venda: '123.45', deleted_at: new Date().toISOString(),
    });

    await ins('produto_combo_item', { tenant_id: t, combo_produto_id: id.pCombo, componente_produto_id: id.pXb, quantidade: '1' });
    await ins('produto_combo_item', { tenant_id: t, combo_produto_id: id.pCombo, componente_produto_id: id.pRefri, quantidade: '2' });

    // Adicionais: uma etapa reutilizável materializada e um grupo de retirar, do editor antigo.
    id.opBacon = await ins('opcao', { tenant_id: t, nome: 'Bacon', codigo_pdv: 'AD-BAC', tipo: 'insumo', item_id: id.itemBacon, preco_custo: '67.89' });
    id.opOvo = await ins('opcao', { tenant_id: t, nome: 'Ovo', codigo_pdv: 'AD-OVO', tipo: 'ficha', ficha_id: id.fichaOvo, preco_custo: '67.89' });
    id.opRefri = await ins('opcao', { tenant_id: t, nome: 'Refrigerante', codigo_pdv: 'AD-REF', tipo: 'simples', produto_ref_id: id.pRefri });
    id.opPonto = await ins('opcao', { tenant_id: t, nome: 'Ponto da carne', tipo: 'simples' });
    id.etapa = await ins('complemento', { tenant_id: t, nome: 'Adicionais', min: 0, max: 3 });
    id.gAdicionais = await ins('complemento_grupo', {
      tenant_id: t, produto_id: id.pXb, nome: 'Adicionais', tipo: 'adicionar', min: 0, max: 3, ordem: 0, origem_complemento_id: id.etapa,
    });
    const op = (ordem: number, linha: Record<string, unknown>) =>
      ins('complemento_opcao', { tenant_id: t, grupo_id: id.gAdicionais, ordem, preco_delta: '9.87', ...linha });
    id.coBacon = await op(0, { nome: 'Bacon', codigo_pdv: 'AD-BAC', item_id: id.itemBacon, quantidade: '0.02', origem_opcao_id: id.opBacon });
    id.coOvo = await op(1, { nome: 'Ovo', codigo_pdv: 'AD-OVO', origem_opcao_id: id.opOvo });
    id.coRefri = await op(2, { nome: 'Refrigerante', codigo_pdv: 'AD-REF', produto_ref_id: id.pRefri, origem_opcao_id: id.opRefri });
    id.coPonto = await op(3, { nome: 'Ponto da carne', origem_opcao_id: id.opPonto });
    await op(4, { nome: 'Opção apagada', codigo_pdv: 'AD-X', deleted_at: new Date().toISOString() });
    id.gRetirar = await ins('complemento_grupo', { tenant_id: t, produto_id: id.pXb, nome: 'Retirar', tipo: 'remover', min: 0, ordem: 1 });
    id.coSemCebola = await ins('complemento_opcao', {
      tenant_id: t, grupo_id: id.gRetirar, nome: 'Sem cebola', codigo_pdv: 'RM-CEB', ficha_ingrediente_id: id.ingCebola, ordem: 0,
    });
    const gApagado = await ins('complemento_grupo', {
      tenant_id: t, produto_id: id.pXb, nome: 'Grupo apagado', tipo: 'adicionar', ordem: 2, deleted_at: new Date().toISOString(),
    });
    await ins('complemento_opcao', { tenant_id: t, grupo_id: gApagado, nome: 'Opção de grupo apagado', codigo_pdv: 'AD-Y', ordem: 0 });
  }

  beforeAll(async () => {
    delete process.env.EDGE_MODE; // a API é da NUVEM
    await pool.query(`create schema ${SCHEMA}`);
    for (const t of FONTES) await pool.query(`create table ${SCHEMA}.${t} (like public.${t} including all)`);
    // O índice único do código do cupom com o NOME de produção (o `like` gera outro) — como na spec dos cupons.
    // A leitura passa pela definição dos índices, que pode correr com o `drop schema` de outra spec (ERR-194).
    for (const x of await repetirNaCorridaDeCatalogo(() =>
      q(`select indexname from pg_indexes where schemaname = $1 and tablename = 'cupom' and indexdef ilike '%upper(codigo)%'`, [SCHEMA]),
    )) {
      await pool.query(`drop index ${SCHEMA}.${x.indexname}`);
    }
    await pool.query(`create unique index uq_cupom_tenant_codigo on ${SCHEMA}.cupom (tenant_id, upper(codigo))`);
    await pool.query(`create trigger trg_bump_updated_at before update on ${SCHEMA}.cupom for each row execute function public.bump_updated_at()`);
    // Cada arquivo é uma transação só (o DDL e a conferência), e a conferência da 295, da 298 e da 303 lê objetos
    // dos schemas das specs vizinhas: em paralelo dá "could not open relation" ou impasse (ERR-194). Idempotentes:
    // o ajudante roda de novo.
    const aplicar = (sqlDaMigration: string) => repetirNaCorridaDeCatalogo(() => pool.query(sqlDaMigration));
    await aplicar(semFkCompartilhada(mig('295_integracao_token_loja.sql')));
    await aplicar(mig('296_integracao_versao_vendas.sql'));
    await aplicar(mig('297_pedido_externo_comanda_idx.sql'));
    const r298 = (await aplicar(mig('298_integracao_cupons.sql'))) as unknown as any[];
    const falhas298 = r298[r298.length - 1].rows.filter((l: any) => l.ok !== true).map((l: any) => l.objeto);
    if (falhas298.length) throw new Error(`conferência da 298 falhou: ${falhas298.join(', ')}`);
    await aplicar(mig('299_pedido_origem.sql'));
    await aplicar(semFkCompartilhada(mig('303_integracao_autorizacao.sql')));
    // A 315, como vai para a nuvem — e a conferência dela, linha a linha.
    const r315 = (await aplicar(mig('315_integracao_farol.sql'))) as unknown as any[];
    const conferencia = r315[r315.length - 1].rows;
    expect(conferencia).toHaveLength(4);
    if (conferencia.some((l: any) => !l.ok)) throw new Error(`conferência da 315: ${JSON.stringify(conferencia)}`);
    // E de novo: tem de ser idempotente.
    await aplicar(mig('315_integracao_farol.sql'));

    const [fk] = await q(
      `select count(*)::int n from pg_constraint c join pg_namespace s on s.oid = c.connamespace
        where s.nspname = $1 and c.contype = 'f'
          and c.confrelid in ('public.empresa'::regclass, 'public.unidade'::regclass)`,
      [SCHEMA],
    );
    if (fk.n) throw new Error('o schema do teste não pode apontar para empresa/unidade compartilhadas (LIC-088)');
    const [gat] = await q(
      `select count(*)::int n from pg_trigger g join pg_class c on c.oid = g.tgrelid join pg_namespace s on s.oid = c.relnamespace
        where g.tgname like 'trg_integracao_%' and s.nspname = 'public'`,
    );
    if (gat.n) throw new Error('a 296 não pode ter posto gatilho nas tabelas compartilhadas');

    app = await NestFactory.create(AppTeste, { logger: false });
    app.setGlobalPrefix('api/v1');
    await app.listen(0, '127.0.0.1');
    base = `http://127.0.0.1:${(app.getHttpServer().address() as any).port}/api/v1`;
    carimbador = app.get(CarimbadorIntegracaoService);

    A = await empresa('Empresa A', ['A1 matriz', 'A2 filial']);
    B = await empresa('Empresa B', ['B1']);
    D = await empresa('Empresa D', ['D1 única', 'D2 fechada']);
    await cadastroDaA();
    await ins('produto', { tenant_id: B.tenant, nome: 'Produto da B', tipo: 'simples', preco_venda: '123.45' });
    // Empresa de UMA loja (a outra fechou): um produto da rede, um da loja e um da loja que fechou.
    await ins('produto', { tenant_id: D.tenant, nome: 'D da rede', tipo: 'simples', preco_venda: '123.45' });
    await ins('produto', { tenant_id: D.tenant, unidade_id: D.lojas[0], nome: 'D da loja', tipo: 'simples', preco_venda: '123.45' });
    await ins('produto', { tenant_id: D.tenant, unidade_id: D.lojas[1], nome: 'D da loja antiga', tipo: 'simples', preco_venda: '123.45' });
    await q(`update unidade set deleted_at = now() where id = $1`, [D.lojas[1]]);

    tA1 = (await emitir(A, A.lojas[0], 'farol', ESCOPOS_FAROL)).token;
    tA2 = (await emitir(A, A.lojas[1], 'farol', ESCOPOS_FAROL)).token;
    tB1 = (await emitir(B, B.lojas[0], 'farol', ESCOPOS_FAROL)).token;
    tD1 = (await emitir(D, D.lojas[0], 'farol', ESCOPOS_FAROL)).token;
    tLiameA1 = (await emitir(A, A.lojas[0], 'liame', ['pedidos.ler', 'cupons.ler'])).token;
  });

  afterAll(async () => {
    await app?.close();
    if (edgeOriginal === undefined) delete process.env.EDGE_MODE;
    else process.env.EDGE_MODE = edgeOriginal;
    if (envOriginal.segredo === undefined) delete process.env.INTEGRACAO_FAROL_CLIENT_SECRET;
    else process.env.INTEGRACAO_FAROL_CLIENT_SECRET = envOriginal.segredo;
    if (envOriginal.volta === undefined) delete process.env.INTEGRACAO_FAROL_REDIRECT_URIS;
    else process.env.INTEGRACAO_FAROL_REDIRECT_URIS = envOriginal.volta;
    if (empresas.length) await pool.query('delete from empresa where id = any($1::uuid[])', [empresas]);
    await pool.query(`drop schema if exists ${SCHEMA} cascade`);
    await pool.end();
  }, 120_000);

  // ───────────────────────────── escopo e token ─────────────────────────────

  describe('quem lê o quê', () => {
    it('o console emite o token do Farol só com os três escopos dele, e sempre por loja', async () => {
      await expect(emitir(A, A.lojas[0], 'farol', ['catalogo.ler', 'pedidos.ler'])).rejects.toThrow(/não vale para o Farol: pedidos\.ler/);
      await expect(
        tokensSvc.emitir({ tenantId: A.tenant, cliente: 'farol', autorizadoPor: A.presidente, escopos: ESCOPOS_FAROL, evidencia: 'teste de emissão' }, dist),
      ).rejects.toThrow(/unidadeId/);
      await expect(emitir(A, A.lojas[0], 'liame', ['catalogo.ler'])).rejects.toThrow(/não vale para o Liame: catalogo\.ler/);
      const p: any = await tokensSvc.painelEmpresa(A.tenant);
      expect(p.clientes).toEqual(
        expect.arrayContaining([{ chave: 'farol', rotulo: 'Farol', abrangencia: 'loja', escopos: ESCOPOS_FAROL }]),
      );
    });

    it('a loja do token do Farol: os três escopos, e nada de venda', async () => {
      const r = await ler('/integracao/loja', tA1);
      expect(r.status).toBe(200);
      expect(r.corpo.loja_id).toBe(A.lojas[0]);
      expect(r.corpo.escopos).toEqual(ESCOPOS_FAROL);
      for (const rota of ['/integracao/pedidos', '/integracao/cupons', '/integracao/clientes', '/integracao/cupons/usos']) {
        const v = await chamar(rota, tA1);
        expect([rota, v.status]).toEqual([rota, 403]);
        expect((await v.json()).type).toMatch(/escopo-insuficiente$/);
      }
    });

    it('o token de outro aplicativo (Liame) não lê o catálogo nem as fichas', async () => {
      for (const rota of ['/integracao/catalogo', '/integracao/fichas']) {
        const r = await ler(rota, tLiameA1);
        expect([rota, r.status]).toEqual([rota, 403]);
        expect(r.corpo.detail).toMatch(/não tem o escopo/);
        expect(JSON.stringify(r.corpo)).not.toContain('X-Burger');
      }
    });

    it('cada rota confere o SEU escopo: quem tem só o catálogo não lê as fichas, e o contrário', async () => {
      const soCatalogo = (await emitir(B, B.lojas[0], 'farol', ['catalogo.ler'])).token;
      expect((await chamar('/integracao/catalogo', soCatalogo)).status).toBe(200);
      const semFichas = await ler('/integracao/fichas', soCatalogo);
      expect([semFichas.status, semFichas.corpo.detail]).toEqual([403, 'Este token não tem o escopo fichas.ler.']);
      await q(`update integracao_token_loja set revogado_em = now() where tenant_id = $1 and escopos = '{catalogo.ler}'`, [B.tenant]);

      const soFichas = (await emitir(B, B.lojas[0], 'farol', ['fichas.ler'])).token;
      expect((await chamar('/integracao/fichas', soFichas)).status).toBe(200);
      const semCatalogo = await ler('/integracao/catalogo', soFichas);
      expect([semCatalogo.status, semCatalogo.corpo.detail]).toEqual([403, 'Este token não tem o escopo catalogo.ler.']);
      await q(`update integracao_token_loja set revogado_em = now() where tenant_id = $1 and escopos = '{fichas.ler}'`, [B.tenant]);
    });

    it('sem token, ou com token que não existe: 401', async () => {
      expect((await fetch(`${base}/integracao/catalogo`)).status).toBe(401);
      expect((await chamar('/integracao/fichas', `rgm_it_${randomBytes(32).toString('base64url')}`)).status).toBe(401);
    });
  });

  // ───────────────────────────── o catálogo ─────────────────────────────

  describe('GET /integracao/catalogo', () => {
    it('o retrato da loja: categorias, setores e produtos — os da loja e os da rede', async () => {
      const { status, corpo } = await ler('/integracao/catalogo', tA1);
      expect(status).toBe(200);
      expect(corpo.atualizado).toBe(true);
      expect(corpo.versao).toMatch(/^[0-9a-f]{32}$/);
      expect(corpo.loja_id).toBe(A.lojas[0]);
      expect(Number.isNaN(Date.parse(corpo.gerado_em))).toBe(false);
      expect(Object.keys(corpo).sort()).toEqual(['atualizado', 'categorias', 'gerado_em', 'loja_id', 'produtos', 'setores', 'versao']);

      // categorias: por ordem; a apagada não sai, a inativa sai marcada
      expect(corpo.categorias).toEqual([
        { id: id.catLanches, nome: 'Lanches', categoria_pai_id: null, ordem: 1, ativo: true },
        { id: id.catBurgers, nome: 'Burgers', categoria_pai_id: id.catLanches, ordem: 2, ativo: true },
        { id: id.catBebidas, nome: 'Bebidas', categoria_pai_id: null, ordem: 3, ativo: false },
      ]);
      // setores: só os da loja do token
      expect(corpo.setores).toEqual([
        { id: id.setorChapa, nome: 'Chapa' },
        { id: id.setorMontagem, nome: 'Montagem' },
      ]);
      // produtos: por nome; o apagado e o da outra loja não saem; o inativo sai marcado
      expect(corpo.produtos.map((p: any) => p.nome)).toEqual(['Combo da casa', 'Refrigerante lata', 'Só da matriz', 'X-Burger', 'X-Parado']);
      expect(corpo.produtos.find((p: any) => p.nome === 'X-Parado').ativo).toBe(false);
    });

    it('o produto, campo a campo: variações, adicionais (o que acrescentam e o que retiram) e combo', async () => {
      const { corpo } = await ler('/integracao/catalogo', tA1);
      const xb = corpo.produtos.find((p: any) => p.id === id.pXb);
      expect(xb).toEqual({
        id: id.pXb,
        codigo: 'XB',
        nome: 'X-Burger',
        descricao: 'Pão, blend e queijo',
        tipo: 'variavel',
        unidade_medida: 'un',
        categoria_id: id.catBurgers,
        vai_para_producao: true,
        setor_producao_id: id.setorMontagem,
        tempo_preparo_min: 12,
        ficha_id: id.fichaXb,
        ativo: true,
        // por nome; a apagada não sai
        variacoes: [
          { id: id.vDuplo, nome: 'Duplo', codigo: 'XB-D', fator_ficha: 2, ativo: true },
          { id: id.vSimples, nome: 'Simples', codigo: 'XB-S', fator_ficha: 1, ativo: true },
        ],
        combo: [],
        adicionais: [
          {
            id: id.gAdicionais,
            etapa_id: id.etapa,
            nome: 'Adicionais',
            tipo: 'adicionar',
            min: 0,
            max: 3,
            obrigatorio: false,
            ordem: 0,
            opcoes: [
              {
                id: id.coBacon, opcao_id: id.opBacon, nome: 'Bacon', codigo: 'AD-BAC', ordem: 0, informativa: false,
                acrescenta: { tipo: 'insumo', insumo_id: id.itemBacon, nome: 'Bacon fatiado', quantidade_estoque: 0.02, unidade_estoque: 'kg' },
                retira: null,
              },
              {
                id: id.coOvo, opcao_id: id.opOvo, nome: 'Ovo', codigo: 'AD-OVO', ordem: 1, informativa: false,
                acrescenta: { tipo: 'ficha', ficha_id: id.fichaOvo },
                retira: null,
              },
              {
                id: id.coRefri, opcao_id: id.opRefri, nome: 'Refrigerante', codigo: 'AD-REF', ordem: 2, informativa: false,
                acrescenta: { tipo: 'produto', produto_id: id.pRefri },
                retira: null,
              },
              // sem código PDV: é só uma observação
              { id: id.coPonto, opcao_id: id.opPonto, nome: 'Ponto da carne', codigo: null, ordem: 3, informativa: true, acrescenta: null, retira: null },
            ],
          },
          {
            id: id.gRetirar,
            etapa_id: null,
            nome: 'Retirar',
            tipo: 'remover',
            min: 0,
            max: null,
            obrigatorio: false,
            ordem: 1,
            opcoes: [
              {
                id: id.coSemCebola, opcao_id: null, nome: 'Sem cebola', codigo: 'RM-CEB', ordem: 0, informativa: false,
                acrescenta: null,
                retira: { insumo_id: id.itemCebola, sub_ficha_id: null, nome: 'Cebola roxa' },
              },
            ],
          },
        ],
      });

      const combo = corpo.produtos.find((p: any) => p.id === id.pCombo);
      expect(combo.tipo).toBe('combo');
      expect([...combo.combo].sort((a: any, b: any) => a.quantidade - b.quantidade)).toEqual([
        { produto_id: id.pXb, quantidade: 1 },
        { produto_id: id.pRefri, quantidade: 2 },
      ]);
      const refri = corpo.produtos.find((p: any) => p.id === id.pRefri);
      expect([refri.vai_para_producao, refri.ficha_id, refri.setor_producao_id, refri.tempo_preparo_min]).toEqual([false, null, null, null]);
    });

    it('o ingrediente que a opção retira continua dito depois de a ficha ser salva de novo', async () => {
      // Salvar a ficha apaga (com data) as linhas e grava outras: a opção segue apontando para a linha antiga.
      await q(`update ficha_ingrediente set deleted_at = now() where id = $1`, [id.ingCebola]);
      try {
        const { corpo } = await ler('/integracao/catalogo', tA1);
        const sem = corpo.produtos.find((p: any) => p.id === id.pXb).adicionais[1].opcoes[0];
        expect(sem.retira).toEqual({ insumo_id: id.itemCebola, sub_ficha_id: null, nome: 'Cebola roxa' });
      } finally {
        await q(`update ficha_ingrediente set deleted_at = null where id = $1`, [id.ingCebola]);
      }
    });
  });

  // ───────────────────────────── as fichas ─────────────────────────────

  describe('GET /integracao/fichas', () => {
    it('as fichas da loja e da rede, com os ingredientes na ordem — a quantidade como foi informada e a do estoque', async () => {
      const { status, corpo } = await ler('/integracao/fichas', tA1);
      expect(status).toBe(200);
      expect(Object.keys(corpo).sort()).toEqual(['atualizado', 'fichas', 'gerado_em', 'loja_id', 'versao']);
      // por nome; a apagada e a da outra loja não saem; a inativa sai marcada
      expect(corpo.fichas.map((f: any) => [f.nome, f.ativo])).toEqual([
        ['Blend da casa', true],
        ['Ovo frito', false],
        ['X-Burger', true],
      ]);
      expect(corpo.fichas.find((f: any) => f.id === id.fichaXb)).toEqual({
        id: id.fichaXb,
        nome: 'X-Burger',
        categoria: 'lanche',
        rendimento: 1,
        rendimento_unidade: 'porção',
        porcao_tamanho: 1,
        porcao_unidade: 'unidade',
        setor_id: id.setorMontagem,
        ativo: true,
        ingredientes: [
          {
            ordem: 0, insumo_id: id.itemPao, sub_ficha_id: null, nome: 'Pão brioche',
            quantidade: 1, unidade: 'unidade', quantidade_estoque: 1, unidade_estoque: 'unidade', fator_correcao: 1, so_delivery: false,
          },
          // sub-receita: sem item do estoque, a quantidade sai como está
          {
            ordem: 1, insumo_id: null, sub_ficha_id: id.fichaBlend, nome: 'Blend da casa',
            quantidade: 0.12, unidade: 'kg', quantidade_estoque: 0.12, unidade_estoque: null, fator_correcao: 1, so_delivery: false,
          },
          // 0,04 kg no banco = 2 fatias (1 kg = 50 fatias)
          {
            ordem: 2, insumo_id: id.itemQueijo, sub_ficha_id: null, nome: 'Queijo prato',
            quantidade: 2, unidade: 'fatia', quantidade_estoque: 0.04, unidade_estoque: 'kg', fator_correcao: 1, so_delivery: false,
          },
          {
            ordem: 3, insumo_id: id.itemCebola, sub_ficha_id: null, nome: 'Cebola roxa',
            quantidade: 0.01, unidade: 'kg', quantidade_estoque: 0.01, unidade_estoque: 'kg', fator_correcao: 1.2, so_delivery: false,
          },
          // a embalagem: só no pedido que sai da loja
          {
            ordem: 4, insumo_id: id.itemCaixa, sub_ficha_id: null, nome: 'Caixa de lanche',
            quantidade: 1, unidade: 'unidade', quantidade_estoque: 1, unidade_estoque: 'unidade', fator_correcao: 1, so_delivery: true,
          },
          // insumo escrito à mão
          {
            ordem: 5, insumo_id: null, sub_ficha_id: null, nome: 'Sal',
            quantidade: 2, unidade: 'g', quantidade_estoque: 2, unidade_estoque: null, fator_correcao: 1, so_delivery: false,
          },
        ],
      });
      expect(corpo.fichas.find((f: any) => f.id === id.fichaBlend).rendimento).toBe(10);
    });
  });

  // ───────────────────────────── sem dinheiro ─────────────────────────────

  describe('nenhum campo de dinheiro', () => {
    it('o cadastro tem preço, custo e meta de CMV — e nada disso sai, nem com outro nome', async () => {
      // O teste só vale se o dinheiro está mesmo no banco.
      const [banco] = await q(
        `select (select count(*) from produto where tenant_id = $1 and preco_venda > 0)::int as precos,
                (select count(*) from produto where tenant_id = $1 and preco_custo > 0)::int as custos,
                (select count(*) from ficha_ingrediente where tenant_id = $1 and custo_unitario > 0)::int as custos_ficha,
                (select count(*) from complemento_opcao where tenant_id = $1 and preco_delta > 0)::int as deltas,
                (select count(*) from item_estoque where tenant_id = $1 and custo_medio > 0)::int as medios`,
        [A.tenant],
      );
      expect(Object.values(banco).every((n) => Number(n) > 0)).toBe(true);

      for (const [rota, token] of [['/integracao/catalogo', tA1], ['/integracao/fichas', tA1], ['/integracao/catalogo', tA2], ['/integracao/fichas', tA2]]) {
        const { status, corpo } = await ler(rota, token);
        expect(status).toBe(200);
        const campos = [...nomesDosCampos(corpo)];
        expect(campos.length).toBeGreaterThan(8);
        expect([rota, campos.filter((c) => NOME_DE_DINHEIRO.test(c))]).toEqual([rota, []]);
        // (sem o carimbo de hora: os milésimos dele podem coincidir com um dos valores)
        const texto = JSON.stringify({ ...corpo, gerado_em: null });
        expect([rota, DINHEIRO.filter((v) => texto.includes(v))]).toEqual([rota, []]);
      }
    });
  });

  // ───────────────────────────── a loja ─────────────────────────────

  describe('a loja vem do token', () => {
    it('a filial vê o que é dela e o que é da rede — não o que é só da matriz; e os setores são os dela', async () => {
      const cat = (await ler('/integracao/catalogo', tA2)).corpo;
      expect(cat.loja_id).toBe(A.lojas[1]);
      expect(cat.produtos.map((p: any) => p.nome)).toEqual(['Combo da casa', 'Refrigerante lata', 'Só da filial', 'X-Burger', 'X-Parado']);
      expect(cat.setores).toEqual([{ id: id.setorA2, nome: 'Cozinha da filial' }]);
      // o setor do cadastro do produto é o da matriz: o id sai, mesmo sem estar na lista de setores desta loja
      expect(cat.produtos.find((p: any) => p.id === id.pXb).setor_producao_id).toBe(id.setorMontagem);
      const fichas = (await ler('/integracao/fichas', tA2)).corpo;
      expect(fichas.fichas.map((f: any) => f.nome)).toEqual(['Blend da casa', 'Ovo frito', 'Só da filial', 'X-Burger']);
    });

    it('a outra empresa não vê nada da A — nem pedindo outra loja por parâmetro', async () => {
      for (const rota of ['/integracao/catalogo', `/integracao/catalogo?unidade_id=${A.lojas[0]}&loja_id=${A.lojas[0]}&tenant_id=${A.tenant}`]) {
        const { status, corpo } = await ler(rota, tB1);
        expect(status).toBe(200);
        expect(corpo.loja_id).toBe(B.lojas[0]);
        expect(corpo.produtos.map((p: any) => p.nome)).toEqual(['Produto da B']);
        expect(JSON.stringify(corpo)).not.toContain('X-Burger');
      }
      const fichas = (await ler(`/integracao/fichas?loja_id=${A.lojas[0]}`, tB1)).corpo;
      expect(fichas.fichas).toEqual([]);
    });

    it('empresa de uma loja só: lê tudo o que é da empresa, com ou sem loja no cadastro', async () => {
      const { corpo } = await ler('/integracao/catalogo', tD1);
      expect(corpo.produtos.map((p: any) => p.nome)).toEqual(['D da loja', 'D da loja antiga', 'D da rede']);
    });
  });

  // ───────────────────────────── a versão ─────────────────────────────

  describe('a versão do retrato', () => {
    it('com a versão em dia a resposta é só "nada mudou"; mudou o preço, a versão é a mesma; mudou o conteúdo, é outra', async () => {
      const primeiro = (await ler('/integracao/catalogo', tA1)).corpo;
      const emDia = await ler(`/integracao/catalogo?versao=${primeiro.versao}`, tA1);
      expect(emDia.corpo).toEqual({ versao: primeiro.versao, atualizado: false });

      // Preço e custo não estão no retrato: mudá-los não é mudança para quem lê.
      await q(`update produto set preco_venda = 88.88, preco_custo = 88.88 where id = $1`, [id.pXb]);
      await q(`update complemento_opcao set preco_delta = 88.88 where id = $1`, [id.coBacon]);
      expect((await ler(`/integracao/catalogo?versao=${primeiro.versao}`, tA1)).corpo).toEqual({ versao: primeiro.versao, atualizado: false });

      // O nome mudou: versão nova, e o retrato inteiro de novo.
      await q(`update produto set nome = 'X-Burger da casa' where id = $1`, [id.pXb]);
      try {
        const depois = (await ler(`/integracao/catalogo?versao=${primeiro.versao}`, tA1)).corpo;
        expect(depois.atualizado).toBe(true);
        expect(depois.versao).not.toBe(primeiro.versao);
        expect(depois.produtos.find((p: any) => p.id === id.pXb).nome).toBe('X-Burger da casa');
      } finally {
        await q(`update produto set nome = 'X-Burger', preco_venda = 123.45, preco_custo = 67.89 where id = $1`, [id.pXb]);
        await q(`update complemento_opcao set preco_delta = 9.87 where id = $1`, [id.coBacon]);
      }
      // Desfeita a mudança, a versão volta a ser a primeira: ela é do conteúdo, não da hora.
      expect((await ler('/integracao/catalogo', tA1)).corpo.versao).toBe(primeiro.versao);

      // Versão que não tem a cara de uma, ou de outra loja: o retrato inteiro.
      for (const v of ['lixo', '', 'A'.repeat(32), (await ler('/integracao/catalogo', tA2)).corpo.versao]) {
        expect((await ler(`/integracao/catalogo?versao=${v}`, tA1)).corpo.atualizado).toBe(true);
      }
    });

    it('nas fichas: o custo do ingrediente não muda a versão; a quantidade muda', async () => {
      const primeiro = (await ler('/integracao/fichas', tA1)).corpo;
      await q(`update ficha_ingrediente set custo_unitario = 88.88 where ficha_id = $1`, [id.fichaXb]);
      await q(`update ficha_tecnica set preco_venda = 88.88, meta_cmv = 40 where id = $1`, [id.fichaXb]);
      expect((await ler(`/integracao/fichas?versao=${primeiro.versao}`, tA1)).corpo).toEqual({ versao: primeiro.versao, atualizado: false });

      await q(`update ficha_ingrediente set quantidade = 0.06 where ficha_id = $1 and insumo_nome = 'Queijo prato'`, [id.fichaXb]);
      try {
        const depois = (await ler(`/integracao/fichas?versao=${primeiro.versao}`, tA1)).corpo;
        expect(depois.atualizado).toBe(true);
        expect(depois.versao).not.toBe(primeiro.versao);
        const queijo = depois.fichas.find((f: any) => f.id === id.fichaXb).ingredientes[2];
        expect([queijo.quantidade, queijo.unidade, queijo.quantidade_estoque]).toEqual([3, 'fatia', 0.06]);
      } finally {
        await q(`update ficha_ingrediente set quantidade = 0.04, custo_unitario = 45.67 where ficha_id = $1 and insumo_nome = 'Queijo prato'`, [id.fichaXb]);
        await q(`update ficha_ingrediente set custo_unitario = 45.67 where ficha_id = $1`, [id.fichaXb]);
        await q(`update ficha_tecnica set preco_venda = 123.45, meta_cmv = 31.5 where id = $1`, [id.fichaXb]);
      }
    });
  });

  // ───────────────────────────── escala ─────────────────────────────

  describe('escala', () => {
    it('sete consultas no catálogo e três nas fichas — com 5 produtos ou com 500 produtos e 2.000 opções', async () => {
      let consultas = 0;
      const contador = { execute: (x: any) => (consultas++, db.execute(x)) };
      const svc = new CatalogoIntegracaoService(contador as any);

      const pequeno: any = await svc.catalogo(ctxDe(A, A.lojas[0]));
      expect([pequeno.produtos.length, consultas]).toEqual([5, 7]);
      consultas = 0;
      await svc.fichas(ctxDe(A, A.lojas[0]));
      expect(consultas).toBe(3);

      const E = await empresa('Empresa E', ['E1']);
      await q(`insert into produto (tenant_id, nome, preco_venda) select $1, 'Produto ' || lpad(g::text, 3, '0'), 123.45 from generate_series(1, 500) g`, [E.tenant]);
      await q(
        `insert into complemento_grupo (tenant_id, produto_id, nome, tipo)
         select p.tenant_id, p.id, 'Adicionais', 'adicionar' from produto p where p.tenant_id = $1`,
        [E.tenant],
      );
      await q(
        `insert into complemento_opcao (tenant_id, grupo_id, nome, codigo_pdv, ordem)
         select g.tenant_id, g.id, 'Opção ' || n, 'C' || n, n from complemento_grupo g cross join generate_series(1, 4) n
          where g.tenant_id = $1`,
        [E.tenant],
      );
      consultas = 0;
      const grande: any = await svc.catalogo(ctxDe(E, E.lojas[0], true));
      const opcoes = grande.produtos.reduce((n: number, p: any) => n + p.adicionais.reduce((m: number, g: any) => m + g.opcoes.length, 0), 0);
      expect([grande.produtos.length, opcoes, consultas]).toEqual([500, 2000, 7]);
    });
  });

  // ───────────────────────────── a autorização pela loja ─────────────────────────────

  describe('a página "Autorizar o Farol"', () => {
    const SEGREDO = randomBytes(36).toString('base64url');
    const VOLTA = 'http://localhost:4010/v1/regem/retorno';
    const novoPedido = () => {
      const verificador = randomBytes(48).toString('base64url');
      return {
        verificador,
        pedido: {
          cliente: 'farol',
          redirect_uri: VOLTA,
          state: randomBytes(18).toString('base64url'),
          code_challenge: createHash('sha256').update(verificador, 'ascii').digest('base64url'),
          code_challenge_method: 'S256',
        },
      };
    };
    const presidente = (e: Emp) => ({ colaboradorId: e.presidente, tenantId: e.tenant, categoria: 'presidente', nome: 'Presidente' }) as any;

    it('sem o segredo no ambiente a página diz que ainda não está disponível; o endereço de volta padrão é o do Farol', async () => {
      delete process.env.INTEGRACAO_FAROL_CLIENT_SECRET;
      delete process.env.INTEGRACAO_FAROL_REDIRECT_URIS;
      expect(clienteAutorizacao('farol', {})).toEqual({
        chave: 'farol',
        rotulo: 'Farol',
        redirectUris: ['https://api.monitorfarol.com.br/v1/regem/retorno'],
        segredo: null,
      });
      const { pedido } = novoPedido();
      await expect(
        autorizacao.pedido(presidente(A), { ...pedido, redirect_uri: 'https://api.monitorfarol.com.br/v1/regem/retorno' }),
      ).rejects.toThrow(/ainda não está disponível/);
    });

    it('o presidente autoriza as três leituras de uma vez — não há o que ligar ou desligar — e o Farol troca o código pelo token da loja', async () => {
      process.env.INTEGRACAO_FAROL_CLIENT_SECRET = SEGREDO;
      process.env.INTEGRACAO_FAROL_REDIRECT_URIS = VOLTA;
      const { pedido, verificador } = novoPedido();

      const pagina: any = await autorizacao.pedido(presidente(A), pedido);
      expect(pagina.situacao).toBe('ok');
      expect(pagina.cliente).toEqual({
        chave: 'farol',
        rotulo: 'Farol',
        descricao: 'Auditoria da operação por câmera · lê o cardápio, as fichas e a fila da cozinha',
        site: 'app.monitorfarol.com.br',
      });
      expect(pagina.sempre.map((e: any) => e.chave)).toEqual(ESCOPOS_FAROL);
      expect(pagina.opcionais).toEqual([]);
      expect(pagina.lojas.map((l: any) => l.id)).toEqual(A.lojas);

      // O corpo NÃO leva `custo` nem `cupom` (as chaves do Liame): no Farol não existem.
      const { redirect } = await autorizacao.autorizar(presidente(A), { ...pedido, lojas: [A.lojas[1]] });
      const volta = new URL(redirect);
      expect(`${volta.origin}${volta.pathname}`).toBe(VOLTA);
      expect(volta.searchParams.get('state')).toBe(pedido.state);
      const codigo = volta.searchParams.get('code') as string;
      expect(codigo).toMatch(/^rgm_ac_/);

      const troca: any = await autorizacao.trocar({
        client_id: 'farol', client_secret: SEGREDO, code: codigo, code_verifier: verificador, redirect_uri: VOLTA,
      });
      expect(troca.lojas).toHaveLength(1);
      expect(troca.lojas[0]).toMatchObject({ loja_id: A.lojas[1], loja_nome: 'A2 filial', escopos: ESCOPOS_FAROL });
      const novo = troca.lojas[0].token as string;
      expect(novo).toMatch(/^rgm_it_/);

      // O token novo lê; o que a loja tinha com o Farol parou de valer na troca (401), e o da matriz segue.
      expect((await ler('/integracao/catalogo', novo)).corpo.loja_id).toBe(A.lojas[1]);
      expect((await chamar('/integracao/catalogo', tA2)).status).toBe(401);
      expect((await chamar('/integracao/catalogo', tA1)).status).toBe(200);
      tA2 = novo;

      // O código não vale duas vezes; e com o segredo errado nem é olhado.
      await expect(
        autorizacao.trocar({ client_id: 'farol', client_secret: SEGREDO, code: codigo, code_verifier: verificador, redirect_uri: VOLTA }),
      ).rejects.toMatchObject({ tipo: 'autorizacao-invalida' });
      const outro = novoPedido();
      const r2 = await autorizacao.autorizar(presidente(A), { ...outro.pedido, lojas: [A.lojas[1]] });
      await expect(
        autorizacao.trocar({
          client_id: 'farol', client_secret: `${SEGREDO}x`, code: new URL(r2.redirect).searchParams.get('code'),
          code_verifier: outro.verificador, redirect_uri: VOLTA,
        }),
      ).rejects.toMatchObject({ tipo: 'cliente-invalido' });
      // Nem o código, nem o token, nem o segredo foram para a auditoria.
      const auditado = JSON.stringify(registros);
      expect([auditado.includes(codigo), auditado.includes(novo), auditado.includes(SEGREDO)]).toEqual([false, false, false]);
    });

    it('em "Aplicativos conectados" o Farol aparece com a descrição dele, e revogar corta na chamada seguinte', async () => {
      const tela: any = await autorizacao.aplicativos(presidente(A));
      const farol = tela.aplicativos.find((a: any) => a.cliente === 'farol');
      expect(farol).toMatchObject({
        rotulo: 'Farol',
        descricao: 'Auditoria da operação por câmera · lê o cardápio, as fichas e a fila da cozinha',
        abrangencia: 'loja',
        ativos: 2,
      });
      const daFilial = farol.acessos.find((a: any) => a.ativo && a.lojaId === A.lojas[1]);
      expect(daFilial.escopos).toEqual(ESCOPOS_FAROL);
      expect((await chamar('/integracao/fichas', tA2)).status).toBe(200);
      await autorizacao.revogar(presidente(A), daFilial.id);
      expect((await chamar('/integracao/fichas', tA2)).status).toBe(401);
      expect((await chamar('/integracao/catalogo', tA2)).status).toBe(401);
    });
  });

  // ───────────────────────────── o carimbador das vendas ─────────────────────────────

  describe('o acesso do Farol não liga a cópia das vendas', () => {
    const fila = (t: string) => q(`select recurso from integracao_mudanca where tenant_id = $1`, [t]);
    const versoes = (t: string) => q(`select recurso from integracao_versao where tenant_id = $1`, [t]);
    const carga = (t: string) => q(`select feita_em::text as feita_em from integracao_carga where tenant_id = $1`, [t]);
    const cargaCupons = (t: string) => q(`select feita_em::text as feita_em from integracao_carga_cupom where tenant_id = $1`, [t]);
    const cupom = (t: string, loja: string, codigo: string) =>
      q(`insert into cupom (tenant_id, unidade_id, codigo, tipo, valor) values ($1, $2, $3, 'valor', 1)`, [t, loja, codigo]);
    const comanda = (t: string, loja: string) =>
      ins('comanda', {
        tenant_id: t, unidade_id: loja, status: 'fechada', aberta_em: new Date().toISOString(), fechada_em: new Date().toISOString(),
        total: '50', taxa_servico_pct: '0', aberta_por_id: randomUUID(),
      });

    it('empresa só com o Farol: sem carga de vendas; o que o gatilho anota sai da fila sem virar versão; a reconciliação não a pega', async () => {
      const F = await empresa('Empresa F', ['F1']);
      await comanda(F.tenant, F.lojas[0]); // venda e cupom de antes do token: nada anota
      await cupom(F.tenant, F.lojas[0], 'ANTESDOTOKEN');
      expect(await fila(F.tenant)).toEqual([]);
      await emitir(F, F.lojas[0], 'farol', ESCOPOS_FAROL);

      expect(await carimbador.fazerCargas({ tenantIds: [F.tenant] })).toBe(0);
      expect(await carimbador.fazerCargasCupons({ tenantIds: [F.tenant] })).toBe(0);
      // A busca das pendentes nem traz a empresa: nenhuma linha de controle nasce. (Se trouxesse, ela seria
      // olhada a cada 5 s para sempre — e, com o limite de 10 por ciclo, tomaria a vez de quem tem carga a fazer.)
      expect(await carga(F.tenant)).toEqual([]);
      expect(await cargaCupons(F.tenant)).toEqual([]);
      // nem chamando a carga da empresa direto (é ela que confere de novo, com a linha travada)
      expect(await carimbador.carregarEmpresa(F.tenant)).toBe(0);
      expect(await carimbador.carregarCuponsEmpresa(F.tenant)).toBe(0);
      expect((await carga(F.tenant)).map((c) => c.feita_em)).toEqual(['-infinity']);
      expect((await cargaCupons(F.tenant)).map((c) => c.feita_em)).toEqual(['-infinity']);
      expect(await fila(F.tenant)).toEqual([]);

      // O gatilho da 296 não olha o escopo: a venda nova entra na fila…
      await comanda(F.tenant, F.lojas[0]);
      expect((await fila(F.tenant)).length).toBeGreaterThan(0);
      // …e o ciclo a tira de lá sem carimbar.
      const ciclo = await carimbador.ciclo({ tenantIds: [F.tenant] }, 30_000);
      expect(ciclo.descartadas).toBeGreaterThan(0);
      expect([ciclo.cargas, ciclo.consumidas, ciclo.carimbadas]).toEqual([0, 0, 0]);
      expect(await fila(F.tenant)).toEqual([]);
      expect(await versoes(F.tenant)).toEqual([]);

      const rec = await carimbador.reconciliar({ tenantIds: [F.tenant] });
      expect(rec.enfileiradas).toBe(0);
      expect(await fila(F.tenant)).toEqual([]);
    });

    it('empresa com o Liame: tudo como antes — carga, fila consumida, versão criada; o Farol entrar depois não refaz a carga', async () => {
      const L = await empresa('Empresa L', ['L1']);
      await comanda(L.tenant, L.lojas[0]);
      await cupom(L.tenant, L.lojas[0], 'DALIAME');
      await emitir(L, L.lojas[0], 'liame', ['pedidos.ler', 'cupons.ler']);
      expect(await carimbador.fazerCargas({ tenantIds: [L.tenant] })).toBe(1);
      expect(await carimbador.fazerCargasCupons({ tenantIds: [L.tenant] })).toBe(1);
      const [feita] = await carga(L.tenant);
      const [feitaCupons] = await cargaCupons(L.tenant);
      expect([feita.feita_em, feitaCupons.feita_em]).not.toContain('-infinity');
      const ciclo = await carimbador.ciclo({ tenantIds: [L.tenant] }, 30_000);
      expect([ciclo.descartadas, ciclo.consumidas]).toEqual([0, 2]);
      expect((await versoes(L.tenant)).map((v) => v.recurso).sort()).toEqual(['cupom', 'venda']);

      // O Farol é autorizado depois: token novo, mas não é dele a carga — nem a das vendas, nem a dos cupons.
      await emitir(L, L.lojas[0], 'farol', ESCOPOS_FAROL);
      expect(await carimbador.fazerCargas({ tenantIds: [L.tenant] })).toBe(0);
      expect(await carimbador.fazerCargasCupons({ tenantIds: [L.tenant] })).toBe(0);
      expect(await carimbador.carregarEmpresa(L.tenant)).toBe(0);
      expect(await carimbador.carregarCuponsEmpresa(L.tenant)).toBe(0);
      expect(await carga(L.tenant)).toEqual([feita]);
      expect(await cargaCupons(L.tenant)).toEqual([feitaCupons]);
      // A venda nova da empresa que tem os dois continua sendo carimbada.
      await comanda(L.tenant, L.lojas[0]);
      const depois = await carimbador.ciclo({ tenantIds: [L.tenant] }, 30_000);
      expect(depois.descartadas).toBe(0);
      expect(depois.consumidas).toBeGreaterThan(0);

      // O Liame sai e fica só o Farol: daí em diante, o que entrar na fila é descartado.
      await q(`update integracao_token_loja set revogado_em = now() where tenant_id = $1 and cliente = 'liame'`, [L.tenant]);
      await comanda(L.tenant, L.lojas[0]);
      const soFarol = await carimbador.ciclo({ tenantIds: [L.tenant] }, 30_000);
      expect(soFarol.descartadas).toBeGreaterThan(0);
      expect(soFarol.consumidas).toBe(0);
    });

    it('onze empresas só com o Farol não tomam a vez da carga de quem lê vendas (o ciclo pega dez por vez)', async () => {
      const soFarol: string[] = [];
      for (let i = 0; i < 11; i++) {
        const e = await empresa(`Empresa só Farol ${i}`, ['Loja']);
        await emitir(e, e.lojas[0], 'farol', ESCOPOS_FAROL);
        soFarol.push(e.tenant);
      }
      const V = await empresa('Empresa com vendas', ['V1']);
      await comanda(V.tenant, V.lojas[0]);
      await emitir(V, V.lojas[0], 'liame', ['pedidos.ler']);
      // Uma chamada só: a empresa que lê vendas é carregada já nela.
      expect(await carimbador.fazerCargas({ tenantIds: [...soFarol, V.tenant] })).toBe(1);
      expect((await carga(V.tenant)).map((c) => c.feita_em)).not.toContain('-infinity');
      const controle = await q(`select count(*)::int as n from integracao_carga where tenant_id = any($1::uuid[])`, [soFarol]);
      expect(controle[0].n).toBe(0);
    });

    it('empresa SEM token ativo: o que tinha ficado na fila é carimbado, como sempre foi', async () => {
      const S = await empresa('Empresa S', ['S1']);
      const t = await emitir(S, S.lojas[0], 'liame', ['pedidos.ler']);
      await carimbador.fazerCargas({ tenantIds: [S.tenant] });
      await comanda(S.tenant, S.lojas[0]);
      await q(`update integracao_token_loja set revogado_em = now() where id = $1`, [t.id]);
      const ciclo = await carimbador.ciclo({ tenantIds: [S.tenant] }, 30_000);
      expect([ciclo.descartadas, ciclo.consumidas]).toEqual([0, 1]);
    });
  });

  // ───────────────────────────── a fila de produção (fase 2) ─────────────────────────────

  describe('GET /integracao/producao', () => {
    const ha = (min: number) => new Date(Date.now() - min * 60_000).toISOString();
    // Do cliente e de quem cancelou: nada disto pode aparecer na resposta.
    const DO_CLIENTE = ['Maria Cliente', '12345678901', 'Mesa 12', 'IF-8842', 'desistiu'];
    const NOME_DO_CLIENTE = /cliente|cpf|telefone|email|endere|mesa|senha|motivo|^obs$/i;
    const semHoras = (corpo: unknown) => JSON.stringify(corpo).replace(/\d{4}-\d\d-\d\dT[\d:.]+Z/g, '');
    const pp: Record<string, string> = {};
    let ci1 = '';
    let kA2 = ''; // o token da filial emitido AQUI: o do começo da spec foi trocado pelo teste da página de autorização

    /** Um pedido de produção com os itens (cada item: a linha da fila e, se houver, o item da venda). */
    async function pedido(tenant: string, loja: string | null, linha: Record<string, unknown>, itens: Record<string, unknown>[] = []) {
      const idPedido = await ins('producao_pedido', {
        tenant_id: tenant, unidade_id: loja, destino_tipo: 'kds', origem: 'balcao', status: 'recebido', criado_em: ha(5), updated_at: ha(5), ...linha,
      });
      for (const i of itens) {
        await ins('producao_pedido_item', { tenant_id: tenant, pedido_id: idPedido, descricao: 'Item', quantidade: '1', status: 'ok', ...i });
      }
      return idPedido;
    }

    beforeAll(async () => {
      const t = A.tenant;
      const [a1, a2] = A.lojas;
      kA2 = (await emitir(A, a2, 'farol', ESCOPOS_FAROL)).token;
      // A venda (a comanda fica com o cliente, a mesa e o total: nada disso é lido pela rota).
      const comanda = await ins('comanda', {
        tenant_id: t, unidade_id: a1, status: 'aberta', mesa: 'Mesa 12', cliente: 'Maria Cliente', cpf: '12345678901', total: '123.45',
      });
      ci1 = await ins('comanda_item', {
        tenant_id: t, comanda_id: comanda, produto_id: id.pXb, variacao_id: id.vDuplo, ficha_id: id.fichaXb,
        descricao: 'X-Burger · Duplo', quantidade: '2', preco_unitario: '67.89', observacao: 'bem passado', created_at: ha(10),
      });
      const ci2 = await ins('comanda_item', {
        tenant_id: t, comanda_id: comanda, produto_id: id.pSoA1, descricao: 'Só da matriz', quantidade: '1', preco_unitario: '67.89', created_at: ha(9),
      });
      // As escolhas, uma linha por escolha: o bacon foi pedido duas vezes.
      const escolha = (ordem: number, linha: Record<string, unknown>) =>
        ins('comanda_item_complemento', { tenant_id: t, comanda_item_id: ci1, tipo: 'adicionar', preco_delta: '9.87', created_at: ha(10 - ordem / 100), ...linha });
      await escolha(0, { opcao_id: id.coBacon, nome: 'Bacon', item_id: id.itemBacon, quantidade: '0.02' });
      await escolha(1, { opcao_id: id.coBacon, nome: 'Bacon', item_id: id.itemBacon, quantidade: '0.02' });
      await escolha(2, { opcao_id: id.coOvo, nome: 'Ovo' });
      await escolha(3, { opcao_id: id.coRefri, nome: 'Refrigerante', produto_ref_id: id.pRefri });
      await escolha(4, { opcao_id: id.coPonto, nome: 'Ponto da carne' });
      await escolha(5, { opcao_id: id.coSemCebola, tipo: 'remover', nome: 'Sem cebola', ficha_ingrediente_id: id.ingCebola, preco_delta: '0' });

      pp.preparo = await pedido(
        t, a1,
        {
          // (sem `comanda_id`: no banco ele aponta para a `comanda` de verdade, e a deste teste é a cópia; a rota não o lê)
          numero: 41, origem: 'mesa', mesa: 'Mesa 12', senha: 7, consumo: 'local', status: 'preparo', setor_id: id.setorMontagem,
          tempo_preparo_min: 12, criado_em: ha(10), iniciado_em: ha(8), updated_at: ha(8),
        },
        [
          { comanda_item_id: ci1, descricao: 'X-Burger · Duplo', quantidade: '2', complementos_texto: '+ 2x Bacon · + Ovo · sem Sem cebola', observacao: 'bem passado' },
          { comanda_item_id: ci2, descricao: 'Só da matriz', quantidade: '1' },
        ],
      );
      // Do canal, pronto há meia hora, alterado depois de entrar: um item saiu da venda (a linha da venda foi apagada).
      pp.pronto = await pedido(
        t, a1,
        {
          numero: 42, origem: 'delivery', plataforma: 'iFood', senha_plataforma: 'IF-8842', consumo: 'viagem', status: 'pronto', obs: 'ALTERADO',
          criado_em: ha(50), iniciado_em: ha(45), pronto_em: ha(30), updated_at: ha(30),
        },
        [
          { comanda_item_id: randomUUID(), descricao: 'Batata média', quantidade: '1', status: 'removido' },
          { descricao: 'Milk-shake do canal', quantidade: '3', observacao: 'sem chantilly' },
        ],
      );
      pp.cancelado = await pedido(t, a1, {
        numero: 43, status: 'cancelado', obs: 'cliente desistiu', criado_em: ha(40), cancelado_em: ha(15), updated_at: ha(15),
      });
      // Fora da janela: entregue há 3 h; pronto há 3 h (loja que não usa "entregue"); parado em "recebido" há 30 h; e o que foi para a impressora.
      pp.entregueAntigo = await pedido(t, a1, { numero: 30, status: 'entregue', criado_em: ha(240), pronto_em: ha(200), entregue_em: ha(180), updated_at: ha(180) });
      pp.prontoAntigo = await pedido(t, a1, { numero: 31, status: 'pronto', criado_em: ha(240), pronto_em: ha(190), updated_at: ha(190) });
      pp.paradoAntigo = await pedido(t, a1, { numero: 5, status: 'recebido', criado_em: ha(30 * 60), updated_at: ha(30 * 60) });
      // …e outro parado há 30 h que foi mexido há 1 h (o sincronismo o trouxe de novo): continua fora — a conta é pela criação.
      pp.paradoMexido = await pedido(t, a1, { numero: 6, status: 'recebido', criado_em: ha(30 * 60), updated_at: ha(60) });
      pp.impressora = await pedido(t, a1, { numero: 44, destino_tipo: 'impressora' });
      // Ficou pronto há 3 h e foi cancelado há 20 min (ninguém veio buscar): ENTRA — vale o que aconteceu por último.
      pp.canceladoTarde = await pedido(t, a1, {
        numero: 29, status: 'cancelado', criado_em: ha(250), pronto_em: ha(185), cancelado_em: ha(20), updated_at: ha(20),
      });
      // Da filial, e um sem loja (da rede).
      pp.filial = await pedido(t, a2, { numero: 1, criado_em: ha(4), updated_at: ha(4) }, [{ descricao: 'Só da filial', quantidade: '1' }]);
      pp.semLoja = await pedido(t, null, { numero: 2, criado_em: ha(3), updated_at: ha(3) });
      // A empresa de uma loja só: um pedido com loja e um sem.
      pp.dComLoja = await pedido(D.tenant, D.lojas[0], { numero: 1, criado_em: ha(6), updated_at: ha(6) });
      pp.dSemLoja = await pedido(D.tenant, null, { numero: 2, criado_em: ha(5), updated_at: ha(5) });
    });

    it('a fila da loja: os pedidos em produção e os concluídos ou cancelados das últimas 2 horas, na ordem em que entraram', async () => {
      const { status, corpo } = await ler('/integracao/producao', tA1);
      expect(status).toBe(200);
      expect(corpo.versao).toMatch(/^[0-9a-f]{32}$/);
      expect([corpo.atualizado, corpo.loja_id]).toEqual([true, A.lojas[0]]);
      // entraram: o cancelado há pouco (mesmo pronto há 3 h), o pronto, o cancelado, o da matriz em preparo e o da
      // rede — nesta ordem (a de chegada)
      expect(corpo.pedidos.map((p: any) => [p.id, p.numero, p.status])).toEqual([
        [pp.canceladoTarde, 29, 'cancelado'],
        [pp.pronto, 42, 'pronto'],
        [pp.cancelado, 43, 'cancelado'],
        [pp.preparo, 41, 'preparo'],
        [pp.semLoja, 2, 'recebido'],
      ]);
      const ids = corpo.pedidos.map((p: any) => p.id);
      for (const fora of [pp.entregueAntigo, pp.prontoAntigo, pp.paradoAntigo, pp.paradoMexido, pp.impressora, pp.filial]) {
        expect(ids).not.toContain(fora);
      }
    });

    it('o pedido e os itens, campo a campo: produto, variação, escolhas (com o id fixo da opção) e observação', async () => {
      const corpo = (await ler('/integracao/producao', tA1)).corpo;
      const p = corpo.pedidos.find((x: any) => x.id === pp.preparo);
      expect({ ...p, itens: undefined, criado_em: typeof p.criado_em, iniciado_em: typeof p.iniciado_em }).toEqual({
        id: pp.preparo, numero: 41, origem: 'mesa', canal: null, consumo: 'local', status: 'preparo', setor_id: id.setorMontagem,
        tempo_preparo_min: 12, alterado: false, criado_em: 'string', iniciado_em: 'string', pronto_em: null, entregue_em: null,
        cancelado_em: null, itens: undefined,
      });
      expect(new Date(p.iniciado_em).getTime()).toBeGreaterThan(new Date(p.criado_em).getTime());
      expect(p.itens).toHaveLength(2);
      const [xb, simples] = p.itens;
      expect({ ...xb, id: typeof xb.id, adicionais: undefined }).toEqual({
        id: 'string', produto_id: id.pXb, ficha_id: id.fichaXb,
        variacao: { id: id.vDuplo, nome: 'Duplo', codigo: 'XB-D', fator_ficha: 2 },
        descricao: 'X-Burger · Duplo', quantidade: 2, observacao: 'bem passado', removido: false,
        adicionais_texto: '+ 2x Bacon · + Ovo · sem Sem cebola', adicionais: undefined,
      });
      // Uma linha por escolha na venda; aqui as repetições viram `vezes`.
      expect(xb.adicionais).toEqual([
        {
          tipo: 'adicionar', opcao_id: id.opBacon, nome: 'Bacon', vezes: 2,
          acrescenta: { tipo: 'insumo', insumo_id: id.itemBacon, nome: 'Bacon fatiado', quantidade_estoque: 0.02, unidade_estoque: 'kg' },
          retira: null,
        },
        { tipo: 'adicionar', opcao_id: id.opOvo, nome: 'Ovo', vezes: 1, acrescenta: { tipo: 'ficha', ficha_id: id.fichaOvo }, retira: null },
        { tipo: 'adicionar', opcao_id: id.opRefri, nome: 'Refrigerante', vezes: 1, acrescenta: { tipo: 'produto', produto_id: id.pRefri }, retira: null },
        { tipo: 'adicionar', opcao_id: id.opPonto, nome: 'Ponto da carne', vezes: 1, acrescenta: null, retira: null },
        {
          tipo: 'remover', opcao_id: null, nome: 'Sem cebola', vezes: 1, acrescenta: null,
          retira: { insumo_id: id.itemCebola, sub_ficha_id: null, nome: 'Cebola roxa' },
        },
      ]);
      expect({ ...simples, id: 'x' }).toEqual({
        id: 'x', produto_id: id.pSoA1, ficha_id: null, variacao: null, descricao: 'Só da matriz', quantidade: 1, observacao: null,
        removido: false, adicionais_texto: null, adicionais: [],
      });
    });

    it('pedido do canal, alterado: o item que saiu da venda fica dito como removido; o item sem par na venda sai só com o texto', async () => {
      const corpo = (await ler('/integracao/producao', tA1)).corpo;
      const p = corpo.pedidos.find((x: any) => x.id === pp.pronto);
      expect([p.origem, p.canal, p.consumo, p.alterado, p.pronto_em === null, p.entregue_em]).toEqual(['delivery', 'iFood', 'viagem', true, false, null]);
      expect(p.itens.map((i: any) => [i.descricao, i.quantidade, i.removido, i.produto_id, i.variacao, i.observacao, i.adicionais])).toEqual(
        expect.arrayContaining([
          ['Batata média', 1, true, null, null, null, []],
          ['Milk-shake do canal', 3, false, null, null, 'sem chantilly', []],
        ]),
      );
      const c = corpo.pedidos.find((x: any) => x.id === pp.cancelado);
      expect([c.status, c.cancelado_em === null, c.alterado, c.itens]).toEqual(['cancelado', false, false, []]);
    });

    it('sem o cliente, a mesa, a senha, o motivo do cancelamento e sem valores — nem com outro nome', async () => {
      // O teste só vale se isso tudo está mesmo no banco.
      const [banco] = await q(
        `select (select count(*) from comanda where tenant_id = $1 and cliente is not null and cpf is not null and total > 0)::int as comandas,
                (select count(*) from comanda_item where tenant_id = $1 and preco_unitario > 0)::int as precos,
                (select count(*) from comanda_item_complemento where tenant_id = $1 and preco_delta > 0)::int as deltas,
                (select count(*) from producao_pedido where tenant_id = $1 and (mesa is not null or senha is not null or senha_plataforma is not null))::int as senhas,
                (select count(*) from producao_pedido where tenant_id = $1 and status = 'cancelado' and obs is not null)::int as motivos`,
        [A.tenant],
      );
      expect(Object.values(banco).every((n) => Number(n) > 0)).toBe(true);

      for (const token of [tA1, kA2]) {
        const { status, corpo } = await ler('/integracao/producao', token);
        expect(status).toBe(200);
        const campos = [...nomesDosCampos(corpo)];
        expect(campos.length).toBeGreaterThan(20);
        expect(campos.filter((c) => NOME_DE_DINHEIRO.test(c) || NOME_DO_CLIENTE.test(c))).toEqual([]);
        // (sem as horas: os milésimos delas podem coincidir com um dos valores)
        const texto = semHoras(corpo);
        expect([...DINHEIRO, ...DO_CLIENTE].filter((v) => texto.includes(v))).toEqual([]);
      }
    });

    it('a loja vem do token: a filial vê os dela e os da rede; outra empresa, nada; a empresa de uma loja só, todos', async () => {
      const filial = (await ler('/integracao/producao', kA2)).corpo;
      expect([filial.loja_id, filial.pedidos.map((p: any) => p.id)]).toEqual([A.lojas[1], [pp.filial, pp.semLoja]]);
      expect(filial.pedidos[0].itens.map((i: any) => i.descricao)).toEqual(['Só da filial']);

      for (const rota of ['/integracao/producao', `/integracao/producao?unidade_id=${A.lojas[0]}&loja_id=${A.lojas[0]}&tenant_id=${A.tenant}`]) {
        const { status, corpo } = await ler(rota, tB1);
        expect([status, corpo.loja_id, corpo.pedidos]).toEqual([200, B.lojas[0], []]);
      }
      const unica = (await ler('/integracao/producao', tD1)).corpo;
      expect(unica.pedidos.map((p: any) => p.id)).toEqual([pp.dComLoja, pp.dSemLoja]);
    });

    it('pede o escopo dela: quem tem só o catálogo e as fichas não lê a fila; o Liame também não; sem token, 401', async () => {
      const semFila = await emitir(B, B.lojas[0], 'farol', ['catalogo.ler', 'fichas.ler']);
      const negado = await ler('/integracao/producao', semFila.token);
      expect([negado.status, negado.corpo.detail]).toEqual([403, 'Este token não tem o escopo producao.ler.']);
      const liame = await ler('/integracao/producao', tLiameA1);
      expect([liame.status, JSON.stringify(liame.corpo).includes('X-Burger')]).toEqual([403, false]);
      expect((await fetch(`${base}/integracao/producao`)).status).toBe(401);
      // e o contrário: quem tem só a fila não lê o catálogo
      const soFila = await emitir(B, B.lojas[0], 'farol', ['producao.ler']);
      expect((await ler('/integracao/producao', soFila.token)).status).toBe(200);
      expect((await ler('/integracao/catalogo', soFila.token)).status).toBe(403);
      await q(`update integracao_token_loja set revogado_em = now() where id = any($1::uuid[])`, [[semFila.id, soFila.id]]);
    });

    it('a versão: em dia, só "nada mudou"; mudou o preço do item, a mesma; o pedido avançou, outra', async () => {
      const primeiro = (await ler('/integracao/producao', tA1)).corpo;
      expect((await ler(`/integracao/producao?versao=${primeiro.versao}`, tA1)).corpo).toEqual({ versao: primeiro.versao, atualizado: false });

      // Preço não está no retrato: mudá-lo não é mudança para quem lê.
      await q(`update comanda_item set preco_unitario = 88.88 where id = $1`, [ci1]);
      await q(`update comanda_item_complemento set preco_delta = 88.88 where comanda_item_id = $1 and nome = 'Bacon'`, [ci1]);
      expect((await ler(`/integracao/producao?versao=${primeiro.versao}`, tA1)).corpo).toEqual({ versao: primeiro.versao, atualizado: false });

      // A cozinha deu o pedido como pronto: versão nova, e o retrato inteiro.
      await q(`update producao_pedido set status = 'pronto', pronto_em = now() where id = $1`, [pp.preparo]);
      try {
        const depois = (await ler(`/integracao/producao?versao=${primeiro.versao}`, tA1)).corpo;
        expect([depois.atualizado, depois.versao === primeiro.versao]).toEqual([true, false]);
        const p = depois.pedidos.find((x: any) => x.id === pp.preparo);
        expect([p.status, typeof p.pronto_em]).toEqual(['pronto', 'string']);
      } finally {
        await q(`update producao_pedido set status = 'preparo', pronto_em = null where id = $1`, [pp.preparo]);
        await q(`update comanda_item set preco_unitario = 67.89 where id = $1`, [ci1]);
        await q(`update comanda_item_complemento set preco_delta = 9.87 where comanda_item_id = $1 and nome = 'Bacon'`, [ci1]);
      }
      expect((await ler('/integracao/producao', tA1)).corpo.versao).toBe(primeiro.versao);
      // A versão do catálogo não serve aqui, nem a de outra loja.
      for (const v of ['lixo', (await ler('/integracao/catalogo', tA1)).corpo.versao, (await ler('/integracao/producao', kA2)).corpo.versao]) {
        expect((await ler(`/integracao/producao?versao=${v}`, tA1)).corpo.atualizado).toBe(true);
      }
    });

    it('o produto foi salvo de novo depois da venda: a variação e a escolha continuam ditas, com o id fixo da opção', async () => {
      // Salvar o produto regrava variações e opções: as linhas antigas ficam, apagadas.
      await q(`update produto_variacao set deleted_at = now() where id = $1`, [id.vDuplo]);
      await q(`update complemento_opcao set deleted_at = now() where id = $1`, [id.coBacon]);
      try {
        const corpo = (await ler('/integracao/producao', tA1)).corpo;
        const xb = corpo.pedidos.find((x: any) => x.id === pp.preparo).itens[0];
        expect(xb.variacao).toEqual({ id: id.vDuplo, nome: 'Duplo', codigo: 'XB-D', fator_ficha: 2 });
        expect([xb.adicionais[0].opcao_id, xb.adicionais[0].vezes]).toEqual([id.opBacon, 2]);
      } finally {
        await q(`update produto_variacao set deleted_at = null where id = $1`, [id.vDuplo]);
        await q(`update complemento_opcao set deleted_at = null where id = $1`, [id.coBacon]);
      }
    });

    it('escala: três consultas — com 5 pedidos ou com 300 pedidos, 1.200 itens e 2.400 escolhas', async () => {
      let consultas = 0;
      const contador = { execute: (x: any) => (consultas++, db.execute(x)) };
      const svc = new ProducaoIntegracaoService(contador as any);
      const pequeno: any = await svc.producao(ctxDe(A, A.lojas[0]));
      expect([pequeno.pedidos.length, consultas]).toEqual([5, 3]);

      const F = await empresa('Empresa F', ['F1']);
      const comanda = await ins('comanda', { tenant_id: F.tenant, unidade_id: F.lojas[0], status: 'aberta' });
      await q(
        `insert into producao_pedido (tenant_id, unidade_id, destino_tipo, origem, status, numero, criado_em, updated_at)
         select $1, $2, 'kds', 'balcao', 'recebido', g, now() - make_interval(secs => 3000 - g), now() - make_interval(secs => 3000 - g)
           from generate_series(1, 300) g`,
        [F.tenant, F.lojas[0]],
      );
      await q(
        `insert into comanda_item (tenant_id, comanda_id, descricao, quantidade, preco_unitario)
         select $1, $2, 'Item ' || g, 1, 67.89 from generate_series(1, 1200) g`,
        [F.tenant, comanda],
      );
      await q(
        `insert into producao_pedido_item (tenant_id, pedido_id, comanda_item_id, descricao, quantidade, status)
         select p.tenant_id, p.id, c.id, c.descricao, 1, 'ok'
           from (select id, tenant_id, row_number() over (order by numero) as n from producao_pedido where tenant_id = $1) p
           join (select id, descricao, ((row_number() over (order by descricao) - 1) / 4 + 1) as n from comanda_item where tenant_id = $1) c on c.n = p.n`,
        [F.tenant],
      );
      await q(
        `insert into comanda_item_complemento (tenant_id, comanda_item_id, tipo, nome, preco_delta, quantidade)
         select c.tenant_id, c.id, 'adicionar', 'Escolha ' || n, 9.87, 1 from comanda_item c cross join generate_series(1, 2) n where c.tenant_id = $1`,
        [F.tenant],
      );
      consultas = 0;
      const grande: any = await svc.producao(ctxDe(F, F.lojas[0], true));
      const itens = grande.pedidos.reduce((n: number, p: any) => n + p.itens.length, 0);
      const escolhas = grande.pedidos.reduce((n: number, p: any) => n + p.itens.reduce((m: number, i: any) => m + i.adicionais.length, 0), 0);
      expect([grande.pedidos.length, itens, escolhas, consultas]).toEqual([300, 1200, 2400, 3]);
    });
  });
});
