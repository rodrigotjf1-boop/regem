import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../../db/schema';
import { ROLES_KEY } from '../../auth/roles.decorator';
import { comTravaDaEmpresa, migrationJaCriada, repetirNaCorridaDeCatalogo } from '../../common/corrida-de-catalogo';
import { CLOUD_ONLY_MODULES } from '../../edge-manifest';
import { ClubeController } from './clube.controller';
import { ClubeService, PREMIOS_MAX } from './clube.service';

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
    for (const m of ['produtos', 'salvarConfig', 'criarPremio', 'editarPremio', 'excluirPremio'] as const) expect(papeis(m)).toEqual(['presidente']);
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

  it('sem linha: tudo desligado, nada pronto para ligar, sem prêmios, só as travas nas regras', async () => {
    const T = await empresa('teste clube padrão');
    const p = await svc.painel(T);
    expect(p.config).toMatchObject({ surpresaAtivo: false, albumAtivo: false, metaAtivo: false, surpresaForma: 'raspadinha', albumSelos: 4, minimo: 30 });
    expect(p.prontas).toEqual({ surpresa: false, album: false, meta: false });
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
    await expect(svc.salvarConfig(presidente(T), { minimo: 10, surpresaAtivo: true })).rejects.toThrow('O prêmio surpresa ainda não pode ser ligado');
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
