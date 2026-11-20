import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../../db/schema';
import { ROLES_KEY } from '../../auth/roles.decorator';
import { CLOUD_ONLY as CLOUD_ONLY_KEY } from '../../common/cloud-only.decorator';
import { comTravaDaEmpresa, migrationJaCriada, repetirNaCorridaDeCatalogo } from '../../common/corrida-de-catalogo';
import { hojeISO, somarDias } from '../../common/data';
import { CLOUD_ONLY_MODULES } from '../../edge-manifest';
import { AniversarioService } from '../aniversario/aniversario.service';
import { ClubeController, ClubePublicoController } from './clube.controller';
import { ClubeService, PREMIOS_MAX } from './clube.service';
import { ClubeSurpresaService } from './clube-surpresa.service';
import { ClubeDesculpasService } from './clube-desculpas.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

// O CLUBE DE RECOMPRA — a base (fase A0, mig 471), contra o Postgres real: a configuração (padrão sem linha, só as colunas
// que mudaram — V82, toda recusa antes de gravar — V86, nenhuma ferramenta liga antes da fase), o catálogo de prêmios
// (produto da empresa, o limite, excluir só esconde e não sai em uso), a auditoria e os papéis de cada rota (RBAC no
// servidor). As tabelas são só da nuvem: o teste aplica a 471 (o banco do CI é o de uma loja).
const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('clube-pg.spec: sem TEST_PG_URL — PULADO');
jest.setTimeout(90_000);

const MIG = (arq: string) => join(__dirname, '../../../../database/migrations', arq);
const papeis = (metodo: keyof ClubeController) => Reflect.getMetadata(ROLES_KEY, ClubeController.prototype[metodo]);

describe('as rotas do clube: quem lê e quem muda (RBAC no servidor)', () => {
  it('a classe: presidente e gerente leem; cada rota que muda é só do presidente', () => {
    expect(Reflect.getMetadata(ROLES_KEY, ClubeController)).toEqual(['presidente', 'gerente']);
    expect(papeis('painel')).toBeUndefined(); // vale o da classe
    for (const m of ['produtos', 'salvarConfig', 'criarPremio', 'editarPremio', 'excluirPremio', 'salvarGatilhoEntregue', 'salvarGatilhoReclamacao'] as const)
      expect(papeis(m)).toEqual(['presidente']);
  });
  it('a página do pedido (`/r/…`): as duas rotas do prêmio são públicas pelo token e só da nuvem', () => {
    for (const m of ['premio', 'revelar'] as const) {
      expect(Reflect.getMetadata('__guards__', ClubePublicoController.prototype[m])).toBeUndefined();
      expect(Reflect.getMetadata(CLOUD_ONLY_KEY, ClubePublicoController.prototype[m])).toBe(true);
    }
    expect(Reflect.getMetadata('__guards__', ClubePublicoController)).toBeUndefined();
  });
  it('o módulo é só da nuvem (não sobe no servidor da loja)', () => {
    expect(CLOUD_ONLY_MODULES).toContain('ClubeModule');
  });
});

descrever('clube de recompra — a base (Postgres)', () => {
  const pool = new Pool({ connectionString: URL_PG });
  const db = drizzle(pool, { schema }) as any;
  const q = async (s: string, p: any[] = []) => (await pool.query(s, p)).rows;
  const auditados: any[] = [];
  const svc = new ClubeService(db, { registrar: async (e: any) => void auditados.push(e) } as any);
  const empresas: string[] = [];

  const aplicar = (arq: string) =>
    repetirNaCorridaDeCatalogo(async () => {
      const c = await pool.connect();
      try {
        await c.query('begin');
        if (!(await migrationJaCriada(c, arq))) await c.query(comTravaDaEmpresa(readFileSync(MIG(arq), 'utf8')));
        await c.query('commit');
      } catch (e) {
        await c.query('rollback').catch(() => {});
        throw e;
      } finally {
        c.release();
      }
    });
  const empresa = async (nome: string) => {
    const [{ id }] = await q(`insert into empresa (nome) values ($1) returning id`, [nome]);
    empresas.push(id);
    return id as string;
  };
  const produto = async (t: string, nome: string, ativo = true) =>
    (await q(`insert into produto (tenant_id, nome, ativo) values ($1, $2, $3) returning id`, [t, nome, ativo]))[0].id as string;
  const presidente = (t: string) => ({ tenantId: t, colaboradorId: null, categoria: 'presidente' }) as any;

  beforeAll(async () => {
    delete process.env.EDGE_MODE; // como NUVEM
    await aplicar('471_clube_de_recompra_base.sql');
  });
  beforeEach(() => {
    auditados.length = 0;
  });
  afterAll(async () => {
    for (const t of ['clube_premio', 'clube_config', 'produto'])
      await q(`delete from ${t} where tenant_id = any($1::uuid[])`, [empresas]).catch(() => {});
    await q(`delete from empresa where id = any($1::uuid[])`, [empresas]).catch(() => {});
    await pool.end();
  });

  it('sem linha: tudo desligado, só a surpresa pronta para ligar, sem prêmios, só as travas nas regras', async () => {
    const T = await empresa('teste clube padrão');
    const p = await svc.painel(T);
    expect(p.config).toMatchObject({ surpresaAtivo: false, albumAtivo: false, metaAtivo: false, surpresaForma: 'raspadinha', albumSelos: 4, minimo: 30 });
    expect(p.prontas).toEqual({ surpresa: true, album: false, meta: false });
    expect(p.gatilhos).toEqual({ entregue: { ativo: false, premioId: null, desde: null }, reclamacao: { ativo: false, premios: [], limite: 'mes1', quem: 'gerencia' } });
    expect(p.premios).toEqual([]);
    expect(p.regras[0]).toContain('Não há sorteio');
  });

  it('o prêmio: cria, edita, a descrição e o produto da empresa (o de outra empresa e o inativo não)', async () => {
    const T = await empresa('teste clube prêmios');
    const O = await empresa('teste clube outra empresa');
    const batata = await produto(T, 'Batata média');
    const inativo = await produto(T, 'Combo antigo', false);
    const deOutra = await produto(O, 'Batata da outra');
    let lista = await svc.criarPremio(presidente(T), { nome: 'Batata grátis', tipo: 'produto', produtoId: batata, validadeDias: 7 });
    expect(lista).toHaveLength(1);
    expect(lista[0]).toMatchObject({ tipo: 'produto', produtoNome: 'Batata média', descricao: 'Batata média grátis · vale 7 dias', emUso: [] });
    for (const id of [inativo, deOutra])
      await expect(svc.criarPremio(presidente(T), { nome: 'X', tipo: 'produto', produtoId: id, validadeDias: 7 })).rejects.toThrow(
        'O produto escolhido não está ativo nesta empresa.',
      );
    lista = await svc.editarPremio(presidente(T), lista[0].id, { nome: '15% off', tipo: 'percentual', valor: 15, teto: 20, minimo: 30, validadeDias: 15 });
    expect(lista[0]).toMatchObject({ nome: '15% off', tipo: 'percentual', produtoId: null, descricao: '15% de desconto, até R$ 20 · em pedido a partir de R$ 30 · vale 15 dias' });
    // o prêmio de outra empresa não se edita daqui
    const [{ id: alheio }] = await q(`insert into clube_premio (tenant_id, nome, tipo, valor) values ($1, 'Alheio', 'valor', 5) returning id`, [O]);
    await expect(svc.editarPremio(presidente(T), alheio, { nome: 'Meu', tipo: 'valor', valor: 5, validadeDias: 7 })).rejects.toThrow('Prêmio não encontrado.');
    await expect(svc.excluirPremio(presidente(T), alheio)).rejects.toThrow('Prêmio não encontrado.');
    expect(auditados.map((a) => a.acao)).toEqual(['clube_premio_criado', 'clube_premio_alterado']);
    // o banco também recusa o que não cabe (o `check` da 471)
    await expect(q(`insert into clube_premio (tenant_id, nome, tipo, valor) values ($1, 'Ruim', 'percentual', 150)`, [T])).rejects.toThrow(/ck_clube_premio_tipo/);
  });

  it('a configuração: salva só o que mudou (V82), os prêmios citados existem, e nada liga antes da fase', async () => {
    const T = await empresa('teste clube config');
    const O = await empresa('teste clube config outra');
    const [p1] = await svc.criarPremio(presidente(T), { nome: 'Frete grátis', tipo: 'fretegratis', validadeDias: 7 });
    const [deOutra] = await svc.criarPremio(presidente(O), { nome: 'Da outra', tipo: 'valor', valor: 5, validadeDias: 7 });
    auditados.length = 0;
    const c = await svc.salvarConfig(presidente(T), { surpresaForma: 'roleta', minimo: 40, albumPremios: [p1.id], metaNiveis: [{ pedidos: 3, premios: [p1.id] }] });
    expect(c).toMatchObject({ surpresaForma: 'roleta', minimo: 40, albumPremios: [p1.id], metaNiveis: [{ pedidos: 3, premios: [p1.id] }], albumSelos: 4 });
    expect(auditados.map((a) => a.detalhe.campo).sort()).toEqual(['albumPremios', 'metaNiveis', 'minimo', 'surpresaForma']);
    // o outro escritor da linha (os gatilhos da próxima fase) não é tocado por este salvar
    await q(`update clube_config set surpresa_gatilhos = '{"entregue": {"ativo": true}}' where tenant_id = $1`, [T]);
    await svc.salvarConfig(presidente(T), { albumSelos: 6 });
    expect((await q(`select surpresa_gatilhos from clube_config where tenant_id = $1`, [T]))[0].surpresa_gatilhos).toEqual({ entregue: { ativo: true } });
    // o mesmo valor não regrava nem audita
    auditados.length = 0;
    await svc.salvarConfig(presidente(T), { albumSelos: 6, minimo: 40 });
    expect(auditados).toEqual([]);
    // recusas antes de gravar (V86): prêmio de outra empresa, ferramenta que ainda não existe
    await expect(svc.salvarConfig(presidente(T), { minimo: 10, albumPremios: [deOutra.id] })).rejects.toThrow('Um dos prêmios escolhidos não existe mais');
    await expect(svc.salvarConfig(presidente(T), { minimo: 10, albumAtivo: true })).rejects.toThrow('O álbum de selos ainda não pode ser ligado');
    expect((await svc.config(T)).minimo).toBe(40);
    // desligar sempre pode (sem mudança, não grava)
    expect((await svc.salvarConfig(presidente(T), { metaAtivo: false })).metaAtivo).toBe(false);
  });

  it('excluir só esconde e não sai o prêmio em uso; o limite de prêmios', async () => {
    const T = await empresa('teste clube excluir');
    const [p1, p2] = await (async () => {
      await svc.criarPremio(presidente(T), { nome: 'Um', tipo: 'valor', valor: 5, validadeDias: 7 });
      return svc.criarPremio(presidente(T), { nome: 'Dois', tipo: 'valor', valor: 10, validadeDias: 7 });
    })();
    await svc.salvarConfig(presidente(T), { albumPremios: [p1.id] });
    expect((await svc.premios(T)).find((p) => p.id === p1.id)?.emUso).toEqual(['Álbum de selos']);
    await expect(svc.excluirPremio(presidente(T), p1.id)).rejects.toThrow('Este prêmio está em uso em: Álbum de selos.');
    const lista = await svc.excluirPremio(presidente(T), p2.id);
    expect(lista.map((p) => p.nome)).toEqual(['Um']);
    expect((await q(`select excluido_em is not null as saiu from clube_premio where id = $1`, [p2.id]))[0].saiu).toBe(true);
    // o excluído não pode ser escolhido de novo
    await expect(svc.salvarConfig(presidente(T), { albumPremios: [p2.id] })).rejects.toThrow('Um dos prêmios escolhidos não existe mais');
    // o limite do catálogo
    await q(
      `insert into clube_premio (tenant_id, nome, tipo, valor) select $1, 'Lote ' || g, 'valor', 1 from generate_series(1, $2::int) g`,
      [T, PREMIOS_MAX - 1],
    );
    await expect(svc.criarPremio(presidente(T), { nome: 'Demais', tipo: 'valor', valor: 1, validadeDias: 7 })).rejects.toThrow(`no máximo ${PREMIOS_MAX} prêmios`);
  });

  it('os produtos da gaveta: os ativos desta empresa, em ordem de nome', async () => {
    const T = await empresa('teste clube produtos');
    const O = await empresa('teste clube produtos outra');
    await produto(T, 'Refrigerante');
    await produto(T, 'Batata');
    await produto(T, 'Velho', false);
    await produto(O, 'Da outra');
    expect((await svc.produtos(T)).map((p) => p.nome)).toEqual(['Batata', 'Refrigerante']);
  });
});

// O PRÊMIO SURPRESA (fase A1, mig 474), contra o Postgres real, num ESQUEMA PRÓPRIO (como a spec da volta): as tabelas só
// da nuvem que ele lê (o cupom pessoal da 357, o clube da 471 e da 474) e uma cópia do `pedido_externo` com o
// `rastreio_token` (210, só da nuvem) nascem no esquema do teste — nenhum DDL em tabela quente do banco que o CI divide
// (ERR-451). `empresa`, `cliente`, `cupom` e `cupom_uso` são as de sempre.
const MIGS = join(__dirname, '../../../../database/migrations');
const semFkCompartilhada = (s: string) => s.replace(/\s+references\s+(empresa|unidade|cliente|cupom)\s*\(\s*id\s*\)(\s+on\s+delete\s+cascade)?/gi, '');

descrever('clube — o prêmio surpresa pelo pedido entregue (Postgres)', () => {
  const SCHEMA = `teste_clube_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
  let admin: Pool;
  let pool: Pool;
  let db: any;
  let clube: ClubeService;
  let surpresa: ClubeSurpresaService;
  let aniversario: AniversarioService;
  const auditados: any[] = [];
  const empresas: string[] = [];
  const q = async (s: string, p: any[] = []) => (await pool.query(s, p)).rows;
  const presidente = (t: string) => ({ tenantId: t, colaboradorId: null, categoria: 'presidente' }) as any;

  beforeAll(async () => {
    delete process.env.EDGE_MODE; // como NUVEM
    admin = new Pool({ connectionString: URL_PG });
    await admin.query(`create schema ${SCHEMA}`);
    pool = new Pool({ connectionString: URL_PG, options: `-c search_path=${SCHEMA},public` });
    await pool.query(`
      create table ${SCHEMA}.pedido_externo (like public.pedido_externo including defaults);
      alter table ${SCHEMA}.pedido_externo add column if not exists rastreio_token text;`);
    for (const [arq, linhas] of [
      ['356_relacionamento_automaticas.sql', 5],
      ['357_aniversario_do_cliente.sql', 5],
      ['474_clube_premio_surpresa.sql', 4],
    ] as [string, number][]) {
      if (arq.startsWith('474')) await pool.query(semFkCompartilhada(readFileSync(join(MIGS, '471_clube_de_recompra_base.sql'), 'utf8')));
      const r: any = await repetirNaCorridaDeCatalogo(() => pool.query(semFkCompartilhada(readFileSync(join(MIGS, arq), 'utf8'))));
      const conf = (Array.isArray(r) ? r[r.length - 1] : r).rows as { objeto: string; ok: boolean }[];
      if (conf.length !== linhas || conf.some((l) => !l.ok)) throw new Error(`conferência da ${arq}: ${JSON.stringify(conf)}`);
    }
    db = drizzle(pool, { schema });
    clube = new ClubeService(db, { registrar: async (e: any) => void auditados.push(e) } as any);
    surpresa = new ClubeSurpresaService(db, clube);
    aniversario = new AniversarioService(db);
  });
  beforeEach(() => {
    auditados.length = 0;
  });
  afterAll(async () => {
    await pool?.end();
    if (!admin) return;
    for (const t of empresas) {
      await admin.query(`delete from cupom_uso where tenant_id = $1`, [t]).catch(() => {});
      await admin.query(`delete from cupom where tenant_id = $1`, [t]).catch(() => {});
      await admin.query(`delete from cliente where tenant_id = $1`, [t]).catch(() => {});
    }
    await admin.query(`drop schema if exists ${SCHEMA} cascade`).catch(() => {});
    for (const t of empresas) await admin.query(`delete from empresa where id = $1`, [t]).catch(() => {});
    await admin.end();
  });

  const empresa = async (nome: string) => {
    const [{ id }] = await q(`insert into empresa (nome) values ($1) returning id`, [nome]);
    empresas.push(id);
    return id as string;
  };
  const cliente = async (t: string, nome: string, telefone: string | null) =>
    (await q(`insert into cliente (tenant_id, nome, telefone) values ($1, $2, $3) returning id`, [t, nome, telefone]))[0].id as string;
  /** Um pedido; `antes` = minutos antes de agora em que foi concluído (o padrão, −1: um minuto À FRENTE — o relógio do banco
   * pode estar um pouco atrás do da API, e o pedido tem de cair depois do "desde" gravado ao ligar). */
  const pedido = async (t: string, cli: string, o: { canal?: string; total?: number; status?: string; antes?: number } = {}) => {
    const token = randomUUID().replace(/-/g, '');
    const [{ id }] = await q(
      `insert into pedido_externo (tenant_id, canal, tipo, itens, total, status, cliente_nome, cliente_telefone, client_ref, cliente_id,
                                   concluido_em, rastreio_token)
       values ($1, $2, 'entrega', '[]'::jsonb, $3, $4, 'Cliente', '21987660000', $5, $6, now() - make_interval(mins => $7::int), $8)
       returning id`,
      [t, o.canal ?? 'cardapio', o.total ?? 50, o.status ?? 'concluido', randomUUID(), cli, o.antes ?? -1, token],
    );
    return { id: String(id), token };
  };
  /** A empresa com o clube: o prêmio surpresa ligado (roleta), três prêmios e o gatilho "Pedido entregue" com o de 15%. */
  const lojaComClube = async (nome: string) => {
    const T = await empresa(nome);
    await clube.criarPremio(presidente(T), { nome: 'Frete grátis', tipo: 'fretegratis', validadeDias: 7 });
    await clube.criarPremio(presidente(T), { nome: 'R$ 5 off', tipo: 'valor', valor: 5, validadeDias: 7 });
    const lista = await clube.criarPremio(presidente(T), { nome: '15% off', tipo: 'percentual', valor: 15, teto: 20, minimo: 30, validadeDias: 15 });
    const quinze = lista.find((p) => p.nome === '15% off')!;
    await clube.salvarConfig(presidente(T), { surpresaAtivo: true, surpresaForma: 'roleta', minimo: 40 });
    // os pedidos concluídos ANTES de ligar não ganham: o "desde" é gravado ao ligar
    return { T, quinze };
  };
  const ligarEntregue = async (T: string, premioId: string) => clube.salvarGatilhoEntregue(presidente(T), { ativo: true, premioId });

  it('ligar o gatilho: precisa do prêmio, não aceita produto grátis nem o de outra empresa; grava o "desde" e audita', async () => {
    const { T, quinze } = await lojaComClube('teste surpresa gatilho');
    const O = await empresa('teste surpresa gatilho outra');
    const [deOutra] = await clube.criarPremio(presidente(O), { nome: 'Da outra', tipo: 'valor', valor: 5, validadeDias: 7 });
    const [{ id: produtoId }] = await q(`insert into produto (tenant_id, nome, ativo) values ($1, 'Batata', true) returning id`, [T]);
    const produto = (await clube.criarPremio(presidente(T), { nome: 'Batata grátis', tipo: 'produto', produtoId, validadeDias: 7 })).find(
      (p) => p.nome === 'Batata grátis',
    )!;
    auditados.length = 0;
    await expect(clube.salvarGatilhoEntregue(presidente(T), { ativo: true })).rejects.toThrow('Escolha o prêmio');
    await expect(ligarEntregue(T, produto.id)).rejects.toThrow('O produto grátis no prêmio surpresa chega numa próxima entrega');
    await expect(ligarEntregue(T, deOutra.id)).rejects.toThrow('O prêmio escolhido não existe mais');
    expect(auditados).toEqual([]); // nenhuma recusa gravou nada (V86)
    const antes = Date.now();
    const g = await ligarEntregue(T, quinze.id);
    expect(g.entregue).toMatchObject({ ativo: true, premioId: quinze.id });
    expect(Date.parse(g.entregue.desde!)).toBeGreaterThanOrEqual(antes - 1000);
    expect(auditados.map((a) => a.acao)).toEqual(['clube_gatilho_alterado']);
    // o mesmo de novo não regrava nem muda o "desde"
    auditados.length = 0;
    expect((await ligarEntregue(T, quinze.id)).entregue.desde).toBe(g.entregue.desde);
    expect(auditados).toEqual([]);
    // o prêmio do gatilho não vira produto grátis nem sai da lista
    await expect(
      clube.editarPremio(presidente(T), quinze.id, { nome: '15% off', tipo: 'produto', produtoId, validadeDias: 7 }),
    ).rejects.toThrow('Este prêmio está no prêmio surpresa');
    await expect(clube.excluirPremio(presidente(T), quinze.id)).rejects.toThrow('Prêmio surpresa · pedido entregue');
    // o outro escritor do jsonb (a configuração) não apaga o gatilho (V82)
    await clube.salvarConfig(presidente(T), { minimo: 45 });
    expect((await clube.gatilhos(T)).entregue).toMatchObject({ ativo: true, premioId: quinze.id });
    // desligar zera o "desde"; ligar de novo grava outro
    expect((await clube.salvarGatilhoEntregue(presidente(T), { ativo: false })).entregue).toMatchObject({ ativo: false, desde: null, premioId: quinze.id });
    const painel = await clube.painel(T);
    expect(painel.regras.some((r) => r.startsWith('Prêmio surpresa:'))).toBe(false);
    await ligarEntregue(T, quinze.id);
    expect((await clube.painel(T)).regras[0]).toBe(
      'Prêmio surpresa: todo pedido entregue pelo cardápio online ou pelo WhatsApp a partir de R$ 45 dá uma roleta com o prêmio "15% off".',
    );
  });

  it('a rotina dá UM prêmio por pedido do Regem entregue depois de ligar, a partir do mínimo, com o cupom pessoal', async () => {
    const { T, quinze } = await lojaComClube('teste surpresa rotina');
    const ana = await cliente(T, 'Ana Souza', '21987661001');
    const semTelefone = await cliente(T, 'Sem Telefone', null);
    const antigo = await pedido(T, ana, { antes: 30 }); // concluído antes de ligar
    await ligarEntregue(T, quinze.id);
    const bom = await pedido(T, ana, {});
    const outroBom = await pedido(T, ana, { status: 'entregue', total: 40 });
    const pouco = await pedido(T, ana, { total: 39.9 });
    const ifood = await pedido(T, ana, { canal: 'ifood' });
    const cancelado = await pedido(T, ana, { status: 'cancelado' });
    const andando = await pedido(T, ana, { status: 'em_preparo' });
    const anonimo = await pedido(T, semTelefone, {});
    // outra empresa sem clube: nada
    const O = await empresa('teste surpresa sem clube');
    const deOutra = await pedido(O, await cliente(O, 'Bia', '21987661002'), {});

    // duas réplicas da API ao mesmo tempo: um direito por pedido, nunca dois
    const outra = new ClubeSurpresaService(db, clube);
    const [a, b] = await Promise.all([surpresa.darPeloEntregue(), outra.darPeloEntregue()]);
    expect(a + b).toBe(2);
    expect(await surpresa.darPeloEntregue()).toBe(0); // idempotente
    const direitos = await q(`select * from clube_direito where tenant_id = any($1::uuid[]) order by ref`, [[T, O]]);
    expect(direitos.map((d: any) => d.ref).sort()).toEqual([bom.id, outroBom.id].sort());
    for (const nao of [antigo, pouco, ifood, cancelado, andando, anonimo, deOutra]) expect(direitos.some((d: any) => d.ref === nao.id)).toBe(false);
    const d = direitos.find((x: any) => x.ref === bom.id);
    expect(d).toMatchObject({
      cliente_id: ana,
      chave_telefone: '21987661001',
      ferramenta: 'surpresa',
      gatilho: 'entregue',
      premio_id: quinze.id,
      premio_nome: '15% off',
      premio_descricao: '15% de desconto, até R$ 20 · em pedido a partir de R$ 30 · vale 15 dias',
      forma: 'roleta',
      revelado_em: null,
    });
    expect(d.codigo).toMatch(/^[A-Za-z0-9_-]{22}$/);
    // o cupom pessoal: o prêmio, uso único, a validade do prêmio, só da Ana
    const [cp] = await q(
      `select c.*, r.cliente_id as regra_cliente, r.chave_telefone as regra_chave, r.origem
         from cupom c join cupom_regra r on r.cupom_id = c.id where c.id = $1`,
      [d.cupom_id],
    );
    expect(cp).toMatchObject({ tenant_id: T, tipo: 'percentual', ativo: true, max_usos: 1, max_por_cliente: 1, regra_cliente: ana, regra_chave: '21987661001', origem: null });
    expect(cp.codigo).toMatch(/^CLUBE[A-Z2-9]{5}$/);
    expect([Number(cp.valor), Number(cp.teto_desconto), Number(cp.minimo)]).toEqual([15, 20, 30]);
    const validade = cp.validade instanceof Date ? cp.validade.toISOString().slice(0, 10) : String(cp.validade).slice(0, 10);
    expect([somarDias(hojeISO(), 14), somarDias(hojeISO(), 15)]).toContain(validade); // o fuso do banco × o da operação
    // o banco recusa um segundo direito do mesmo pedido (o índice único)
    await expect(
      q(
        `insert into clube_direito (tenant_id, chave_telefone, gatilho, ref, premio_nome, premio_descricao, forma, codigo, valido_ate)
         values ($1, 'x', 'entregue', $2, 'x', 'x', 'roleta', $3, current_date)`,
        [T, bom.id, randomUUID().replace(/-/g, '')],
      ),
    ).rejects.toThrow(/uq_clube_direito_ref/);
    // a surpresa desligada para de dar na hora
    await clube.salvarConfig(presidente(T), { surpresaAtivo: false });
    await pedido(T, ana, {});
    expect(await surpresa.darPeloEntregue()).toBe(0);
  });

  it('a página do pedido: antes de revelar não diz o prêmio; revelar mostra o cupom e a fatia; Sua conta só mostra depois', async () => {
    const { T, quinze } = await lojaComClube('teste surpresa revelar');
    const ana = await cliente(T, 'Ana Lima', '21987662001');
    await ligarEntregue(T, quinze.id);
    const ped = await pedido(T, ana, {});
    const semPremio = await pedido(T, ana, { total: 10 });
    await surpresa.darPeloEntregue();

    // antes: tem, roleta com as três fatias, sem o prêmio
    const antes = await surpresa.doPedido(ped.token);
    expect(antes).toMatchObject({ tem: true, forma: 'roleta', revelado: false, premio: null, fatia: null });
    if (!antes.tem) throw new Error('sem prêmio');
    expect([...antes.fatias].sort()).toEqual(['15% off', 'Frete grátis', 'R$ 5 off']);
    expect(antes.regras.some((r) => r.includes('Não há sorteio'))).toBe(true);
    // Sua conta: o cupom fechado não aparece; aparece "para revelar" com o link da página do pedido
    expect(await aniversario.presentesDoCliente(T, ana)).toEqual([]);
    expect(await aniversario.premiosParaRevelar(T, ana)).toEqual([
      { forma: 'roleta', validoAte: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/), link: `/r/${ped.token}` },
    ]);

    // revelar: o prêmio, o código do cupom e a fatia onde a roleta para
    const depois = await surpresa.revelar(ped.token);
    if (!depois.tem || !depois.premio) throw new Error('não revelou');
    expect(depois.premio).toMatchObject({ nome: '15% off', usado: false, vencido: false });
    expect(depois.premio.codigo).toMatch(/^CLUBE/);
    expect(depois.fatias[depois.fatia!]).toBe('15% off');
    const [{ revelado_em: em }] = await q(`select revelado_em from clube_direito where ref = $1`, [ped.id]);
    expect(em).not.toBeNull();
    // revelar de novo devolve o mesmo e não muda a hora
    const deNovo = await surpresa.revelar(ped.token);
    expect(deNovo.tem && deNovo.premio?.codigo).toBe(depois.premio.codigo);
    expect((await q(`select revelado_em from clube_direito where ref = $1`, [ped.id]))[0].revelado_em).toEqual(em);
    expect((await surpresa.doPedido(ped.token)) as any).toMatchObject({ revelado: true, premio: { codigo: depois.premio.codigo } });
    // Sua conta: agora o cupom aparece, marcado como do clube, com o teto na descrição
    expect(await aniversario.presentesDoCliente(T, ana)).toEqual([
      {
        codigo: depois.premio.codigo,
        origem: 'clube',
        descricao: '15% de desconto, até R$ 20 em pedido acima de R$ 30',
        validade: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      },
    ]);
    expect(await aniversario.premiosParaRevelar(T, ana)).toEqual([]);
    // usado: a página diz
    const [{ id: cupomId }] = await q(`select cupom_id as id from clube_direito where ref = $1`, [ped.id]);
    await q(`insert into cupom_uso (tenant_id, cupom_id, cliente_id, telefone) values ($1, $2, $3, '21987662001')`, [T, cupomId, ana]);
    expect(((await surpresa.doPedido(ped.token)) as any).premio.usado).toBe(true);

    // o pedido sem prêmio e o token que não existe
    expect(await surpresa.doPedido(semPremio.token)).toEqual({ tem: false });
    await expect(surpresa.revelar(semPremio.token)).rejects.toThrow('Este pedido não tem prêmio para revelar.');
    await expect(surpresa.doPedido('nao-existe')).rejects.toThrow('Pedido não encontrado.');
    await expect(surpresa.doPedido('../;drop')).rejects.toThrow('Pedido não encontrado.');
  });

  // ───────────── A1b: o prêmio de desculpas pelo caso do Atendimento ─────────────
  const caso = async (t: string, o: { telefone?: string | null; canal?: string; cliente?: string } = {}) =>
    String(
      (
        await q(`insert into atendimento_chamado (tenant_id, tipo, cliente, telefone, canal, mensagem) values ($1, 'humano', $2, $3, $4, 'veio sem a batata') returning id`, [
          t,
          o.cliente ?? 'Ana',
          o.telefone === undefined ? '5521987663101' : o.telefone,
          o.canal ?? 'whatsapp',
        ])
      )[0].id,
    );
  const quem = (t: string, perfil = 'gerente') => ({ tenantId: t, perfil, colaboradorId: null });
  /** A loja com o clube e o gatilho da reclamação ligado (os dois prêmios de desconto liberados, 1 por mês, gerência). */
  const lojaComDesculpas = async (nome: string, envios: any[], falhar = false) => {
    const { T } = await lojaComClube(nome);
    const lista = await clube.premios(T);
    const liberados = lista.filter((p) => p.tipo !== 'produto').map((p) => p.id);
    await clube.salvarGatilhoReclamacao(presidente(T), { ativo: true, premios: liberados });
    const provedores = {
      enviar: async (t: string, numero: string, texto: string, por: string | null) => {
        if (falhar) throw new Error('fora da janela de 24 h');
        envios.push({ t, numero, texto, por });
      },
    };
    const desculpas = new ClubeDesculpasService(db, clube, surpresa, provedores as any, { registrar: async (e: any) => void auditados.push(e) } as any);
    return { T, lista, desculpas };
  };

  it('o gatilho da reclamação: recusa sem prêmio, com produto grátis e o de outra empresa; não apaga o do pedido entregue', async () => {
    const { T, quinze } = await lojaComClube('teste desculpas gatilho');
    const O = await empresa('teste desculpas outra');
    const [deOutra] = await clube.criarPremio(presidente(O), { nome: 'Da outra', tipo: 'valor', valor: 5, validadeDias: 7 });
    const [{ id: produtoId }] = await q(`insert into produto (tenant_id, nome, ativo) values ($1, 'Refri', true) returning id`, [T]);
    const refri = (await clube.criarPremio(presidente(T), { nome: 'Refri grátis', tipo: 'produto', produtoId, validadeDias: 7 })).find((p) => p.nome === 'Refri grátis')!;
    await ligarEntregue(T, quinze.id);
    auditados.length = 0;
    await expect(clube.salvarGatilhoReclamacao(presidente(T), { ativo: true })).rejects.toThrow('Escolha ao menos um prêmio');
    await expect(clube.salvarGatilhoReclamacao(presidente(T), { ativo: true, premios: [refri.id] })).rejects.toThrow('O produto grátis no prêmio surpresa');
    await expect(clube.salvarGatilhoReclamacao(presidente(T), { ativo: true, premios: [deOutra.id] })).rejects.toThrow('não existe mais');
    expect(auditados).toEqual([]);
    const g = await clube.salvarGatilhoReclamacao(presidente(T), { ativo: true, premios: [quinze.id], limite: 'mes2', quem: 'atendimento' });
    expect(g.reclamacao).toEqual({ ativo: true, premios: [quinze.id], limite: 'mes2', quem: 'atendimento' });
    expect(g.entregue).toMatchObject({ ativo: true, premioId: quinze.id }); // o outro gatilho do mesmo jsonb fica (V82)
    expect(auditados.map((a) => a.acao)).toEqual(['clube_gatilho_alterado']);
    expect((await clube.premios(T)).find((p) => p.id === quinze.id)?.emUso).toEqual(['Prêmio surpresa · pedido entregue', 'Prêmio surpresa · reclamação']);
  });

  it('o prêmio de desculpas: quem pode, o caso do iFood, o cupom e a mensagem com o link; um por caso e o limite por cliente', async () => {
    const envios: any[] = [];
    const { T, desculpas } = await lojaComDesculpas('teste desculpas mandar', envios);
    const c1 = await caso(T, { cliente: 'Ana Reis' });
    let e = await desculpas.estado(quem(T), c1);
    expect(e).toMatchObject({ mostrar: true, disponivel: true, motivo: null, cliente: 'Ana Reis', limite: '1 por mês', recebidos: 0, dado: null });
    expect(e.premios.map((p) => p.nome).sort()).toEqual(['15% off', 'Frete grátis', 'R$ 5 off']);
    // a execução não manda (o presidente escolheu gerente e supervisão); o caso do iFood não ganha
    expect((await desculpas.estado(quem(T, 'execucao'), c1)).motivo).toContain('gerente e supervisão');
    await expect(desculpas.mandar(quem(T, 'execucao'), c1, { premioId: e.premios[0].id })).rejects.toThrow('gerente e supervisão');
    const doIfood = await caso(T, { canal: 'ifood', telefone: '08007070000' });
    expect((await desculpas.estado(quem(T), doIfood)).motivo).toContain('o iFood e a 99 não aceitam');
    // recusas antes de gravar: prêmio fora da lista, mensagem longa
    await expect(desculpas.mandar(quem(T), c1, { premioId: randomUUID() })).rejects.toThrow('Escolha um dos prêmios da lista.');
    await expect(desculpas.mandar(quem(T), c1, { premioId: e.premios[0].id, mensagem: 'x'.repeat(301) })).rejects.toThrow('no máximo 300');
    expect(await q(`select 1 from clube_direito where tenant_id = $1`, [T])).toHaveLength(0);

    // manda: a Ana não tinha cadastro — nasce; o cupom é dela; a mensagem leva o link pessoal
    const frete = e.premios.find((p) => p.nome === 'Frete grátis')!;
    auditados.length = 0;
    const r = await desculpas.mandar(quem(T), c1, { premioId: frete.id, mensagem: 'Desculpe pela batata!' });
    expect(r).toMatchObject({ premio: 'Frete grátis', enviado: true, motivoEnvio: null });
    expect(r.link).toMatch(/\/p\/[A-Za-z0-9_-]{22}$/);
    expect(envios).toEqual([{ t: T, numero: '5521987663101', texto: `Desculpe pela batata!\n\n🎁 Toque para revelar o seu prêmio: ${r.link}`, por: null }]);
    const [d] = await q(`select * from clube_direito where tenant_id = $1 and gatilho = 'reclamacao'`, [T]);
    expect(d).toMatchObject({ ref: c1, chave_telefone: '21987663101', premio_nome: 'Frete grátis', forma: 'roleta', revelado_em: null });
    const [cli] = await q(`select id, nome, telefone from cliente where id = $1`, [d.cliente_id]);
    expect(cli).toMatchObject({ nome: 'Ana Reis', telefone: '21987663101' });
    const [cp] = await q(`select c.tipo, r.cliente_id from cupom c join cupom_regra r on r.cupom_id = c.id where c.id = $1`, [d.cupom_id]);
    expect(cp).toMatchObject({ tipo: 'fretegratis', cliente_id: d.cliente_id });
    expect(auditados.map((a) => [a.acao, a.entidadeId])).toEqual([['clube_premio_desculpas', c1]]);
    // o mesmo caso não ganha de novo; a gaveta mostra o que foi dado
    e = await desculpas.estado(quem(T), c1);
    expect(e).toMatchObject({ disponivel: false, dado: { premio: 'Frete grátis', link: r.link } });
    await expect(desculpas.mandar(quem(T), c1, { premioId: frete.id })).rejects.toThrow('Este caso já recebeu');
    // outro caso da mesma Ana (o número com outro formato): o limite de 1 por mês
    const c2 = await caso(T, { telefone: '(21) 98766-3101' });
    expect((await desculpas.estado(quem(T), c2)).motivo).toContain('já recebeu o limite');
    await expect(desculpas.mandar(quem(T), c2, { premioId: frete.id })).rejects.toThrow('já recebeu o limite');
    expect(await q(`select 1 from clube_direito where tenant_id = $1`, [T])).toHaveLength(1);

    // Sua conta: "para revelar" pelo link pessoal; o link revela e o cupom aparece
    const codigo = String(d.codigo);
    expect(await aniversario.premiosParaRevelar(T, d.cliente_id)).toEqual([{ forma: 'roleta', validoAte: expect.any(String), link: `/p/${codigo}` }]);
    const antes = await surpresa.doLink(codigo);
    expect(antes).toMatchObject({ tem: true, forma: 'roleta', revelado: false, premio: null, loja: 'teste desculpas mandar' });
    const depois = await surpresa.revelarPeloLink(codigo);
    expect(depois).toMatchObject({ revelado: true, premio: { nome: 'Frete grátis', usado: false } });
    expect(await aniversario.premiosParaRevelar(T, d.cliente_id)).toEqual([]);
    expect((await aniversario.presentesDoCliente(T, d.cliente_id)).map((p) => p.origem)).toEqual(['clube']);
    await expect(surpresa.doLink('curto')).rejects.toThrow('Prêmio não encontrado.');
    await expect(surpresa.doLink('A'.repeat(22))).rejects.toThrow('Prêmio não encontrado.');
  });

  it('dois casos do mesmo cliente ao mesmo tempo: o limite vale (só um ganha); a mensagem que não sai deixa o prêmio', async () => {
    const envios: any[] = [];
    const { T, desculpas, lista } = await lojaComDesculpas('teste desculpas corrida', envios);
    await cliente(T, 'Bia', '21987663201');
    const [c1, c2] = [await caso(T, { telefone: '5521987663201' }), await caso(T, { telefone: '21987663201' })];
    const premioId = lista.find((p) => p.nome === 'R$ 5 off')!.id;
    const r = await Promise.allSettled([desculpas.mandar(quem(T), c1, { premioId }), desculpas.mandar(quem(T), c2, { premioId })]);
    expect(r.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    expect(String((r.find((x) => x.status === 'rejected') as PromiseRejectedResult).reason?.message)).toContain('já recebeu o limite');
    expect(await q(`select 1 from clube_direito where tenant_id = $1`, [T])).toHaveLength(1);
    // a Bia já tinha cadastro: o prêmio é desse cadastro (nenhum novo)
    expect(await q(`select 1 from cliente where tenant_id = $1`, [T])).toHaveLength(1);

    // o WhatsApp não mandou (fora das 24 h): o prêmio fica e a tela recebe o link para mandar de outro jeito
    const outros: any[] = [];
    const { T: T2, desculpas: d2, lista: l2 } = await lojaComDesculpas('teste desculpas sem envio', outros, true);
    const c3 = await caso(T2, { telefone: '5521987663301' });
    const s = await d2.mandar(quem(T2), c3, { premioId: l2.find((p) => p.nome === 'R$ 5 off')!.id });
    expect(s).toMatchObject({ enviado: false, motivoEnvio: expect.stringContaining('mande o link de outro jeito') });
    expect(await q(`select 1 from clube_direito where tenant_id = $1`, [T2])).toHaveLength(1);
    // o gatilho desligado esconde o botão
    await clube.salvarGatilhoReclamacao(presidente(T2), { ativo: false });
    expect(await d2.estado(quem(T2), await caso(T2))).toMatchObject({ mostrar: false, disponivel: false });
  });
});
