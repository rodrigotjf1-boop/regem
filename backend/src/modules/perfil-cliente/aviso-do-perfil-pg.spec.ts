import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Pool, type PoolClient } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { assinarCliente } from '../cliente/cliente-token';
import { retirarPerfisSemAviso, TEXTO_DO_AVISO, VERSAO_DO_AVISO } from './aviso-do-perfil';
import { cartaoDaEquipe } from './cartao-da-equipe';
import { cartaoDoCliente } from './cartao-do-cliente';
import { lerPedidoDePrivacidade } from './escolhas-do-cliente';
import { registrarInteracoes } from './interacoes-do-cardapio';
import { paraOCliente } from './para-o-cliente';
import { PerfilClienteService } from './perfil-cliente.service';
import { gravarPrivacidade, lerPrivacidade } from './privacidade-do-cliente';

/* eslint-disable @typescript-eslint/no-explicit-any */

// O PERFIL SÓ ABRE DEPOIS DO AVISO (ERR-562). As tabelas só da nuvem sobem num schema SÓ DESTE TESTE, sem chave estrangeira
// para as compartilhadas (LIC-088); cada teste roda numa transação desfeita, só com DML (ERR-539).
const MIGS = join(__dirname, '..', '..', '..', '..', 'database', 'migrations');
const semFkCompartilhada = (s: string) =>
  s.replace(/\s+references\s+(empresa|unidade|cliente|cupom)\s*\(\s*id\s*\)(\s+on\s+delete\s+cascade)?/gi, '');

describe('a resposta ao aviso no corpo da chamada', () => {
  it('"continuou" basta sozinho e não vira nenhuma escolha', () => {
    expect(lerPedidoDePrivacidade({ avisoPerfil: 'continuou' })).toEqual({
      origem: 'cardapio_perfil',
      escolhas: [],
      declarado: [],
      avisoPerfil: 'continuou',
    });
  });

  it('"recusou" vira "não quero ser analisado", mesmo que o corpo diga o contrário', () => {
    const p = lerPedidoDePrivacidade({ avisoPerfil: 'recusou', escolhas: { nao_analisar: false, maior_de_18: true } });
    expect(p.escolhas).toEqual([{ escolha: 'maior_de_18', valor: true }, { escolha: 'nao_analisar', valor: true }]);
  });

  it('recusa resposta desconhecida', () => {
    expect(() => lerPedidoDePrivacidade({ avisoPerfil: 'talvez' })).toThrow(/aviso inválida/);
  });
});

const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('aviso-do-perfil-pg.spec: sem TEST_PG_URL — PULADO');

descrever('o perfil só abre depois do aviso (Postgres)', () => {
  jest.setTimeout(120_000);
  const SCHEMA = `teste_aviso_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
  const admin = new Pool({ connectionString: URL_PG });
  const pool = new Pool({ connectionString: URL_PG, options: `-c search_path=${SCHEMA},public` });
  const antes = {
    regra: process.env.PERFIL_SO_COM_AVISO,
    paraVoce: process.env.PERFIL_CARDAPIO_PARA_VOCE,
    segredo: process.env.JWT_SECRET,
  };
  const restaurar = (k: string, v: string | undefined) => {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  };

  beforeAll(async () => {
    process.env.PERFIL_CARDAPIO_PARA_VOCE = '1';
    if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 16) process.env.JWT_SECRET = 'segredo-de-teste-do-aviso-1';
    await admin.query(`create schema ${SCHEMA}`);
    for (const m of [
      '196_cardapio_evento.sql',
      '356_relacionamento_automaticas.sql',
      '459_perfil_do_cliente.sql',
      '463_cliente_evento_sensibilidade.sql',
      '466_cardapio_interacao.sql',
      '481_lembrete_viu_na_conversa.sql',
      '488_cliente_aviso_perfil.sql',
    ])
      await pool.query(semFkCompartilhada(readFileSync(join(MIGS, m), 'utf8')));
  }, 60_000);
  beforeEach(() => {
    process.env.PERFIL_SO_COM_AVISO = '1';
  });
  afterAll(async () => {
    restaurar('PERFIL_SO_COM_AVISO', antes.regra);
    restaurar('PERFIL_CARDAPIO_PARA_VOCE', antes.paraVoce);
    restaurar('JWT_SECRET', antes.segredo);
    await pool.end();
    await admin.query(`drop schema if exists ${SCHEMA} cascade`).catch(() => {});
    await admin.end();
  }, 60_000);

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
      await c.query('rollback').catch(() => {});
      c.release();
    }
  }

  async function base(c: PoolClient) {
    const q = (s: string, p: any[] = []) => c.query(s, p).then((r) => r.rows);
    const t = (await q(`insert into empresa (nome) values ('teste aviso do perfil') returning id`))[0].id as string;
    const u = (await q(`insert into unidade (tenant_id, nome) values ($1,'Loja') returning id`, [t]))[0].id as string;
    const token = `tok-${randomUUID()}`;
    await q(`insert into cardapio_config (tenant_id, token, ativo) values ($1,$2,true)`, [t, token]);
    await q(`insert into modulo_ativacao (tenant_id, unidade_id, modulo, ativo) values ($1, null, 'perfil_cliente', true)`, [t]);
    let tel = 0;
    const cliente = async (nome: string) =>
      (await q(`insert into cliente (tenant_id, nome, telefone) values ($1,$2,$3) returning id`, [t, nome, `2198${String(++tel).padStart(7, '0')}`]))[0]
        .id as string;
    /** Três pedidos do mesmo item: dá "o de sempre" no perfil. */
    const pedidos = async (cl: string, total: number, canal = 'anotaai') => {
      for (const dias of [3, 10, 17])
        await q(
          `insert into pedido_externo (tenant_id, unidade_id, canal, external_id, display_id, cliente_nome, tipo, status, itens, total,
             cliente_id, criado_em)
           values ($1,$2,$3,$4,'1','Cliente','entrega','concluido','[{"descricao":"X-Bacon","quantidade":1}]'::jsonb,$5,$6,
                   now() - make_interval(days => $7::int))`,
          [t, u, canal, randomUUID(), total, cl, dias],
        );
    };
    const avisar = (cl: string, resposta = 'continuou') =>
      q(`insert into cliente_aviso_perfil (tenant_id, cliente_id, versao, texto, resposta, origem)
         values ($1,$2,'teste','texto do teste',$3,'cardapio_entrada')`, [t, cl, resposta]);
    /** Um perfil gravado antes da regra (com "o de sempre"). */
    const perfilAntigo = (cl: string) =>
      q(`insert into cliente_perfil (cliente_id, tenant_id, ultimo_pedido_em, calculado_em, camadas)
         values ($1,$2, now(), now(), '{"gosto":{"de_sempre":{"nome":"X-Bacon","pedidos":3,"chave":"x-bacon"}}}'::jsonb)`, [cl, t]);
    const alergia = (cl: string) =>
      q(`insert into cliente_declarado (tenant_id, cliente_id, chave, valor, origem) values ($1,$2,'alergia','"amendoim"'::jsonb,'cardapio_perfil')`, [t, cl]);
    const conta = async (tabela: string, cl: string) =>
      Number((await q(`select count(*)::int as n from ${tabela} where cliente_id = $1`, [cl]))[0].n);
    return { q, t, u, token, cliente, pedidos, avisar, perfilAntigo, alergia, conta };
  }

  it('com a regra desligada nada muda: calcula todos, não lê nem grava o aviso', () =>
    naTransacao(async (c) => {
      delete process.env.PERFIL_SO_COM_AVISO;
      const b = await base(c);
      const db = dbDoTeste(c);
      const ana = await b.cliente('Ana');
      await b.pedidos(ana, 50);
      expect((await new PerfilClienteService(db).calcularEmpresa(b.t)).clientes).toBe(1);
      expect((await lerPrivacidade(db, b.t, ana)).avisoPerfil).toBeNull();
      await gravarPrivacidade(db, { tenantId: b.t, id: ana }, lerPedidoDePrivacidade({ avisoPerfil: 'continuou' }));
      expect(await b.conta('cliente_aviso_perfil', ana)).toBe(0);
    }));

  it('o cálculo só grava quem viu o aviso, e os números da loja continuam vindo de todos os pedidos', () =>
    naTransacao(async (c) => {
      const b = await base(c);
      const db = dbDoTeste(c);
      const servico = new PerfilClienteService(db);
      const avisada = await b.cliente('Avisada');
      const semAviso = await b.cliente('Sem aviso');
      await b.pedidos(avisada, 50);
      await b.pedidos(semAviso, 200);

      delete process.env.PERFIL_SO_COM_AVISO;
      expect((await servico.calcularEmpresa(b.t)).clientes).toBe(2);
      const [antes] = await b.q(`select ticket_ajustado from cliente_perfil where cliente_id = $1`, [avisada]);

      process.env.PERFIL_SO_COM_AVISO = '1';
      await b.avisar(avisada);
      // Em transação o `now()` é o mesmo: a linha antiga precisa estar no passado para a volta tirá-la.
      await b.q(`update cliente_perfil set calculado_em = now() - interval '1 hour' where tenant_id = $1`, [b.t]);
      expect((await servico.calcularEmpresa(b.t)).clientes).toBe(1);
      expect(await b.conta('cliente_perfil', semAviso)).toBe(0);
      const [depois] = await b.q(`select ticket_ajustado from cliente_perfil where cliente_id = $1`, [avisada]);
      expect(depois.ticket_ajustado).toBe(antes.ticket_ajustado);
    }));

  it('tirar de uso apaga o perfil e devolve os cliques ao anônimo; pedidos, cadastro e alergia ficam', () =>
    naTransacao(async (c) => {
      const b = await base(c);
      const db = dbDoTeste(c);
      const avisada = await b.cliente('Avisada');
      const semAviso = await b.cliente('Sem aviso');
      for (const cl of [avisada, semAviso]) {
        await b.pedidos(cl, 50);
        await b.perfilAntigo(cl);
        await b.q(`insert into cliente_evento_sensibilidade (cliente_id, tipo, tenant_id, rr, prob, pedidos, esperado, dias_com_pedido)
                   values ($1,'feriado',$2,1.5,0.9,3,1,3)`, [cl, b.t]);
        await b.q(`insert into cardapio_interacao (tenant_id, sessao, cliente_id, tipo) values ($1,'sessao01',$2,'busca')`, [b.t, cl]);
      }
      await b.alergia(semAviso);
      await b.avisar(avisada);

      expect(await retirarPerfisSemAviso(db)).toMatchObject({ perfis: 1, sensibilidades: 1, cliques: 1 });
      expect(await b.conta('cliente_perfil', semAviso)).toBe(0);
      expect(await b.conta('cliente_evento_sensibilidade', semAviso)).toBe(0);
      expect(await b.conta('cardapio_interacao', semAviso)).toBe(0);
      expect(await b.conta('cliente_declarado', semAviso)).toBe(1);
      expect(await b.conta('pedido_externo', semAviso)).toBe(3);
      expect((await b.q(`select count(*)::int as n from cliente where id = $1`, [semAviso]))[0].n).toBe(1);
      for (const tabela of ['cliente_perfil', 'cliente_evento_sensibilidade', 'cardapio_interacao'])
        expect(await b.conta(tabela, avisada)).toBe(1);
      expect(await retirarPerfisSemAviso(db)).toEqual({ perfis: 0, sensibilidades: 0, cliques: 0 });
    }));

  it('a resposta guarda o texto do servidor, não duplica e o "não quero" apaga o perfil', () =>
    naTransacao(async (c) => {
      const b = await base(c);
      const db = dbDoTeste(c);
      const ana = await b.cliente('Ana');
      const bia = await b.cliente('Bia');
      expect((await lerPrivacidade(db, b.t, ana)).avisoPerfil).toEqual({ versao: VERSAO_DO_AVISO, texto: TEXTO_DO_AVISO, visto: false });

      const continuar = lerPedidoDePrivacidade({ origem: 'cardapio_entrada', avisoPerfil: 'continuou', texto: 'texto forjado' });
      await gravarPrivacidade(db, { tenantId: b.t, id: ana }, continuar);
      await gravarPrivacidade(db, { tenantId: b.t, id: ana }, continuar);
      expect(await b.q(`select versao, texto, resposta, origem from cliente_aviso_perfil where cliente_id = $1`, [ana])).toEqual([
        { versao: VERSAO_DO_AVISO, texto: TEXTO_DO_AVISO, resposta: 'continuou', origem: 'cardapio_entrada' },
      ]);
      expect((await lerPrivacidade(db, b.t, ana)).avisoPerfil?.visto).toBe(true);

      await b.pedidos(bia, 50);
      await b.perfilAntigo(bia);
      await gravarPrivacidade(db, { tenantId: b.t, id: bia }, lerPedidoDePrivacidade({ origem: 'cardapio_entrada', avisoPerfil: 'recusou' }));
      expect(await b.conta('cliente_perfil', bia)).toBe(0);
      expect((await lerPrivacidade(db, b.t, bia)).escolhas.nao_analisar).toBe(true);
      expect((await new PerfilClienteService(db).ficha(b.t, bia)).situacao).toBe('nao_analisar');
    }));

  it('sem o aviso, o robô e a equipe recebem só o que o cliente contou', () =>
    naTransacao(async (c) => {
      const b = await base(c);
      const db = dbDoTeste(c);
      const semAviso = await b.cliente('Sem aviso');
      await b.perfilAntigo(semAviso);
      await b.alergia(semAviso);
      const robo = await cartaoDoCliente(db, b.t, semAviso);
      expect(robo?.deSempre).toBeUndefined();
      expect(robo?.cuidados?.[0]).toContain('amendoim');
      const equipe = await cartaoDaEquipe(db, b.t, semAviso);
      expect(equipe?.deSempre).toBeUndefined();
      expect(equipe?.cuidados?.[0]).toContain('amendoim');

      await b.avisar(semAviso);
      expect((await cartaoDoCliente(db, b.t, semAviso))?.deSempre).toContain('X-Bacon');
      expect((await cartaoDaEquipe(db, b.t, semAviso))?.deSempre).toBe('X-Bacon');
    }));

  it('a ficha diz que espera o aviso e abre o perfil depois dele', () =>
    naTransacao(async (c) => {
      const b = await base(c);
      const db = dbDoTeste(c);
      const servico = new PerfilClienteService(db);
      const ana = await b.cliente('Ana');
      await b.pedidos(ana, 50);
      await b.perfilAntigo(ana);
      const antes = await servico.ficha(b.t, ana);
      expect(antes.situacao).toBe('aguardando_aviso');
      expect(antes.perfil).toBeNull();
      expect(await b.conta('cliente_perfil', ana)).toBe(0);
      await b.avisar(ana);
      const depois = await servico.ficha(b.t, ana);
      expect(depois.situacao).toBe('com_perfil');
      expect(depois.perfil?.pedidos_diretos).toBe(3);
    }));

  it('sem o aviso, o clique fica anônimo e o cardápio não personaliza', () =>
    naTransacao(async (c) => {
      const b = await base(c);
      const db = dbDoTeste(c);
      const ana = await b.cliente('Ana');
      await b.perfilAntigo(ana);
      const clienteToken = assinarCliente(ana, b.t);
      const clique = { sessao: 'sessao02', clienteToken, eventos: [{ tipo: 'busca', termo: 'pizza', resultados: 1 }] };
      await registrarInteracoes(db, b.token, clique);
      expect(await b.conta('cardapio_interacao', ana)).toBe(0);
      expect(await paraOCliente(db, b.token, clienteToken)).toEqual({ deSempre: null, voceViu: [], ordemCategorias: [] });

      await b.avisar(ana);
      await registrarInteracoes(db, b.token, clique);
      expect(await b.conta('cardapio_interacao', ana)).toBe(1);
    }));
});
