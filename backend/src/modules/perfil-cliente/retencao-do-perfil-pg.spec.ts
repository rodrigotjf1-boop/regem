import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Pool, PoolClient } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { REGRAS_DO_PERFIL } from './calculo-do-perfil';
import { PerfilClienteService } from './perfil-cliente.service';
import { expurgarPerfisVencidos } from './retencao-do-perfil';

/* eslint-disable @typescript-eslint/no-explicit-any */

// O PRAZO DE 12 MESES DO PERFIL (§3.5 do plano), contra o Postgres real. As tabelas só da nuvem sobem num schema SÓ DESTE
// TESTE, sem chave estrangeira para as compartilhadas (LIC-088); a transação do teste só tem DML e é desfeita no fim.
const RAIZ = join(__dirname, '..', '..', '..', '..');
const MIGS = join(RAIZ, 'database', 'migrations');
const semFkCompartilhada = (s: string) =>
  s.replace(/\s+references\s+(empresa|unidade|cliente|cupom)\s*\(\s*id\s*\)(\s+on\s+delete\s+cascade)?/gi, '');

describe('a política de privacidade diz o prazo do código (ERR-137)', () => {
  it('o número de meses da regra aparece no texto público', () => {
    const politica = readFileSync(join(RAIZ, 'frontend', 'src', 'app', 'privacidade', 'page.tsx'), 'utf8').replace(/\s+/g, ' ');
    expect(politica).toContain(`Depois de ${REGRAS_DO_PERFIL.retencaoMeses} meses sem pedido direto`);
  });
});

const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('retencao-do-perfil-pg.spec: sem TEST_PG_URL — PULADO');

descrever('perfil do cliente — o prazo de 12 meses (Postgres)', () => {
  jest.setTimeout(120_000);
  const SCHEMA = `teste_retencao_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
  const admin = new Pool({ connectionString: URL_PG });
  const pool = new Pool({ connectionString: URL_PG, options: `-c search_path=${SCHEMA},public` });

  beforeAll(async () => {
    await admin.query(`create schema ${SCHEMA}`);
    for (const arq of ['459_perfil_do_cliente.sql', '463_cliente_evento_sensibilidade.sql', '466_cardapio_interacao.sql'])
      await pool.query(semFkCompartilhada(readFileSync(join(MIGS, arq), 'utf8')));
  }, 60_000);
  afterAll(async () => {
    await pool.end();
    await admin.query(`drop schema if exists ${SCHEMA} cascade`).catch(() => {});
    await admin.end();
  }, 60_000);

  async function base(c: PoolClient) {
    const q = (s: string, p: any[] = []) => c.query(s, p).then((r) => r.rows);
    const t = (await q(`insert into empresa (nome) values ('teste prazo do perfil') returning id`))[0].id as string;
    const u = (await q(`insert into unidade (tenant_id, nome) values ($1,'Loja') returning id`, [t]))[0].id as string;
    let tel = 0;
    const cliente = async (nome: string) =>
      (await q(`insert into cliente (tenant_id, nome, telefone) values ($1,$2,$3) returning id`, [t, nome, `2199${String(++tel).padStart(7, '0')}`]))[0]
        .id as string;
    const pedido = (cl: string, meses: number, canal = 'cardapio', status = 'concluido') =>
      q(
        `insert into pedido_externo (tenant_id, unidade_id, canal, external_id, display_id, cliente_nome, tipo, status, itens, total,
           cliente_id, criado_em)
         values ($1,$2,$3,$4,'1','Cliente','entrega',$5,'[{"descricao":"X-Bacon","quantidade":1}]'::jsonb,50,$6,
                 now() - make_interval(months => $7::int))`,
        [t, u, canal, randomUUID(), status, cl, meses],
      );
    // O perfil gravado numa volta antiga: o módulo pode estar desligado e ele nunca mais foi recalculado.
    const perfil = (cl: string, meses: number) =>
      q(
        `insert into cliente_perfil (cliente_id, tenant_id, ultimo_pedido_em, calculado_em)
         values ($1,$2, now() - make_interval(months => $3::int), now() - interval '2 days')`,
        [cl, t, meses],
      );
    const sensibilidade = (cl: string) =>
      q(
        `insert into cliente_evento_sensibilidade (cliente_id, tipo, tenant_id, rr, prob, pedidos, esperado, dias_com_pedido)
         values ($1,'feriado',$2,1.5,0.9,3,1,3)`,
        [cl, t],
      );
    const declarado = (cl: string, meses: number, chave = 'alergia') =>
      q(
        `insert into cliente_declarado (tenant_id, cliente_id, chave, valor, origem, atualizado_em)
         values ($1,$2,$3,'"amendoim"'::jsonb,'cardapio_perfil', now() - make_interval(months => $4::int))`,
        [t, cl, chave, meses],
      );
    const escolha = (cl: string) =>
      q(`insert into cliente_escolha (tenant_id, cliente_id, escolha, valor, origem) values ($1,$2,'recomendacoes',false,'cardapio_perfil')`, [t, cl]);
    const conta = async (tabela: string, cl: string) =>
      Number((await q(`select count(*)::int as n from ${tabela} where cliente_id = $1`, [cl]))[0].n);
    return { q, t, cliente, pedido, perfil, sensibilidade, declarado, escolha, conta };
  }

  /** O `db` do serviço na transação do teste (a `transaction` do serviço roda na mesma, que é desfeita no fim). */
  const dbDoTeste = (c: PoolClient): any => {
    const db: any = drizzle(c as any);
    db.transaction = (f: (tx: any) => Promise<any>) => f(db);
    return db;
  };

  async function naTransacao(f: (c: PoolClient) => Promise<void>) {
    const c = await pool.connect();
    try {
      await c.query('begin');
      await f(c);
    } finally {
      await c.query('rollback');
      c.release();
    }
  }

  it('o cálculo não refaz o perfil de quem passou do prazo e mantém quem está dentro', () =>
    naTransacao(async (c) => {
      const b = await base(c);
      const dentro = await b.cliente('Dentro do prazo');
      const fora = await b.cliente('Fora do prazo');
      await b.pedido(dentro, 11);
      await b.pedido(fora, 13);
      await b.perfil(fora, 13);
      const r = await new PerfilClienteService(dbDoTeste(c)).calcularEmpresa(b.t);
      expect(r.clientes).toBe(1);
      expect(await b.conta('cliente_perfil', dentro)).toBe(1);
      expect(await b.conta('cliente_perfil', fora)).toBe(0);
    }));

  it('a limpeza apaga o perfil vencido com o módulo desligado e guarda cadastro, pedidos e a prova das escolhas', () =>
    naTransacao(async (c) => {
      const b = await base(c);
      const velho = await b.cliente('Velho');
      await b.pedido(velho, 13);
      await b.perfil(velho, 13);
      await b.sensibilidade(velho);
      await b.declarado(velho, 13);
      await b.escolha(velho);

      expect(await expurgarPerfisVencidos(dbDoTeste(c))).toEqual({ perfis: 1, sensibilidades: 1, declarados: 1 });
      for (const tabela of ['cliente_perfil', 'cliente_evento_sensibilidade', 'cliente_declarado'])
        expect(await b.conta(tabela, velho)).toBe(0);
      expect(await b.conta('cliente_escolha', velho)).toBe(1);
      expect(await b.conta('pedido_externo', velho)).toBe(1);
      expect((await b.q(`select count(*)::int as n from cliente where id = $1`, [velho]))[0].n).toBe(1);
      // Idempotente.
      expect(await expurgarPerfisVencidos(dbDoTeste(c))).toEqual({ perfis: 0, sensibilidades: 0, declarados: 0 });
    }));

  it('só pedido direto e não cancelado segura o prazo', () =>
    naTransacao(async (c) => {
      const b = await base(c);
      const voltou = await b.cliente('Voltou a pedir');
      const soIfood = await b.cliente('Agora só pelo iFood');
      const soCancelou = await b.cliente('Só cancelou');
      for (const cl of [voltou, soIfood, soCancelou]) {
        await b.pedido(cl, 13);
        await b.perfil(cl, 13);
      }
      await b.pedido(voltou, 1);
      await b.pedido(soIfood, 1, 'ifood');
      await b.pedido(soCancelou, 1, 'cardapio', 'cancelado');

      expect((await expurgarPerfisVencidos(dbDoTeste(c))).perfis).toBe(2);
      expect(await b.conta('cliente_perfil', voltou)).toBe(1);
      expect(await b.conta('cliente_perfil', soIfood)).toBe(0);
      expect(await b.conta('cliente_perfil', soCancelou)).toBe(0);
    }));

  it('o que o cliente contou conta o prazo da última atualização ou do último pedido', () =>
    naTransacao(async (c) => {
      const b = await base(c);
      const contouAgora = await b.cliente('Contou há 1 mês, nunca pediu');
      const contouAntesPediuAgora = await b.cliente('Contou há 2 anos, pediu há 1 mês');
      const contouAntes = await b.cliente('Contou há 2 anos, sem pedido');
      await b.declarado(contouAgora, 1);
      await b.declarado(contouAntesPediuAgora, 24);
      await b.pedido(contouAntesPediuAgora, 1);
      await b.declarado(contouAntes, 24);

      expect((await expurgarPerfisVencidos(dbDoTeste(c))).declarados).toBe(1);
      expect(await b.conta('cliente_declarado', contouAgora)).toBe(1);
      expect(await b.conta('cliente_declarado', contouAntesPediuAgora)).toBe(1);
      expect(await b.conta('cliente_declarado', contouAntes)).toBe(0);
    }));

  it('a ficha diz "perfil apagado" e não confunde com quem só pediu pelo iFood', () =>
    naTransacao(async (c) => {
      const b = await base(c);
      const velho = await b.cliente('Velho');
      const soIfood = await b.cliente('Só iFood');
      await b.pedido(velho, 13);
      await b.pedido(soIfood, 1, 'ifood');
      await b.q(`update cliente set total_pedidos = 1 where id = any($1::uuid[])`, [[velho, soIfood]]);
      const servico = new PerfilClienteService(dbDoTeste(c));
      expect((await servico.ficha(b.t, velho)).situacao).toBe('perfil_apagado');
      expect((await servico.ficha(b.t, soIfood)).situacao).toBe('so_plataforma');
    }));
});
