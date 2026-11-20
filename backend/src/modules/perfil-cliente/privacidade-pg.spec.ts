import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { lerPedidoDePrivacidade } from './escolhas-do-cliente';
import { gravarPrivacidade, lerPrivacidade } from './privacidade-do-cliente';

const MIG_459 = join(__dirname, '..', '..', '..', '..', 'database', 'migrations', '459_perfil_do_cliente.sql');
const semFkCompartilhada = (s: string) =>
  s.replace(/\s+references\s+(empresa|unidade|cliente|cupom)\s*\(\s*id\s*\)(\s+on\s+delete\s+cascade)?/gi, '');

/* eslint-disable @typescript-eslint/no-explicit-any */

// F1c do plano do perfil do cliente: as escolhas do cliente (sempre um "sim" clicado — D15) e o que ele conta (D14).
describe('lerPedidoDePrivacidade — só entra o que veio, nada vira "sim" por omissão', () => {
  it('lê as escolhas e o que o cliente conta', () => {
    const p = lerPedidoDePrivacidade({
      origem: 'cardapio_entrada',
      escolhas: { recomendacoes: true, maior_de_18: true },
      declarado: { time: '  Flamengo ', gostaria: ['Açaí', 'Sem lactose', 'açaí', 'Café da manhã'], respostas_curtas: true },
    });
    expect(p.origem).toBe('cardapio_entrada');
    expect(p.escolhas).toEqual([{ escolha: 'recomendacoes', valor: true }, { escolha: 'maior_de_18', valor: true }]);
    // A dieta ("sem lactose") não vai para o perfil da pessoa (D14).
    expect(p.declarado).toEqual([
      { chave: 'time', valor: 'Flamengo' },
      { chave: 'respostas_curtas', valor: true },
      { chave: 'gostaria', valor: ['Açaí', 'açaí', 'Café da manhã'] },
    ]);
  });

  it('recusa escolha desconhecida, valor que não é verdadeiro/falso, alergia sem o "guardar" e corpo vazio', () => {
    expect(() => lerPedidoDePrivacidade({ escolhas: { tudo: true } })).toThrow(/desconhecida/);
    expect(() => lerPedidoDePrivacidade({ escolhas: { recomendacoes: 'sim' } })).toThrow(/verdadeiro ou falso/);
    expect(() => lerPedidoDePrivacidade({ declarado: { alergia: 'camarão' } })).toThrow(/guardarAlergia/);
    expect(lerPedidoDePrivacidade({ declarado: { alergia: 'camarão' }, guardarAlergia: true }).declarado).toEqual([
      { chave: 'alergia', valor: 'camarão' },
    ]);
    expect(() => lerPedidoDePrivacidade({})).toThrow(/Nada para salvar/);
    expect(() => lerPedidoDePrivacidade({ origem: 'whatsapp_falso', escolhas: { recomendacoes: true } })).toThrow(/Origem/);
  });
});

const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('privacidade-pg.spec: sem TEST_PG_URL — PULADO');

descrever('gravar e ler a privacidade (Postgres)', () => {
  jest.setTimeout(120_000);
  // As tabelas só da nuvem (459) num schema SÓ DESTE TESTE, sem chave estrangeira para as compartilhadas (LIC-088): a
  // transação do teste só tem DML — DDL com a trava da empresa dentro dela é o risco do ERR-539 (deadlock com as outras suítes no banco dividido).
  const SCHEMA = `teste_perfil_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
  const admin = new Pool({ connectionString: URL_PG });
  const pool = new Pool({ connectionString: URL_PG, options: `-c search_path=${SCHEMA},public` });
  beforeAll(async () => {
    await admin.query(`create schema ${SCHEMA}`);
    await pool.query(semFkCompartilhada(readFileSync(MIG_459, 'utf8')));
    await pool.query(semFkCompartilhada(readFileSync(MIG_459.replace('459_perfil_do_cliente', '463_cliente_evento_sensibilidade'), 'utf8')));
    // A 466 (os cliques): desligar as recomendações devolve os cliques ao anônimo (F4b).
    await pool.query(semFkCompartilhada(readFileSync(MIG_459.replace('459_perfil_do_cliente', '466_cardapio_interacao'), 'utf8')));
  }, 60_000);
  afterAll(async () => {
    await pool.end();
    await admin.query(`drop schema if exists ${SCHEMA} cascade`).catch(() => {});
    await admin.end();
  }, 60_000);

  it('grava a escolha só quando muda, apaga o perfil no "não analisar" e atualiza/apaga o que o cliente contou', async () => {
    const c = await pool.connect();
    try {
      await c.query('begin');
      const q = (s: string, p: any[] = []) => c.query(s, p).then((r) => r.rows);
      const t = (await q(`insert into empresa (nome) values ('teste privacidade') returning id`))[0].id as string;
      const id = (await q(`insert into cliente (tenant_id, nome, telefone) values ($1,'Ana','21966660001') returning id`, [t]))[0].id as string;
      await q(`insert into cliente_perfil (cliente_id, tenant_id) values ($1,$2)`, [id, t]);
      const db = drizzle(c as any);
      const cli = { tenantId: t, id };
      // Nunca respondeu: a entrada do cardápio pergunta.
      expect((await lerPrivacidade(db, t, id)).jaRespondeu).toBe(false);

      // "Continuar sem marcar" na entrada grava o "não" com a origem — e a entrada não pergunta de novo.
      const outro = (await q(`insert into cliente (tenant_id, nome, telefone) values ($1,'Bia','21966660002') returning id`, [t]))[0].id as string;
      await gravarPrivacidade(db, { tenantId: t, id: outro }, lerPedidoDePrivacidade({
        origem: 'cardapio_entrada', escolhas: { recomendacoes: false, atendimento_personalizado: false, maior_de_18: false },
      }));
      expect(await q(`select escolha, valor, origem from cliente_escolha where cliente_id = $1 order by escolha`, [outro])).toEqual([
        { escolha: 'atendimento_personalizado', valor: false, origem: 'cardapio_entrada' },
        { escolha: 'maior_de_18', valor: false, origem: 'cardapio_entrada' },
        { escolha: 'recomendacoes', valor: false, origem: 'cardapio_entrada' },
      ]);
      expect(await lerPrivacidade(db, t, outro)).toMatchObject({ jaRespondeu: true, escolhas: { recomendacoes: false } });

      await gravarPrivacidade(db, cli, lerPedidoDePrivacidade({ escolhas: { recomendacoes: true }, declarado: { time: 'Flamengo' } }));
      await gravarPrivacidade(db, cli, lerPedidoDePrivacidade({ escolhas: { recomendacoes: true }, declarado: { time: 'Vasco' } }));
      expect(await q(`select escolha, valor, origem from cliente_escolha where cliente_id = $1`, [id])).toEqual([
        { escolha: 'recomendacoes', valor: true, origem: 'cardapio_perfil' },
      ]);
      const [txt] = await q(`select texto from cliente_escolha where cliente_id = $1`, [id]);
      expect(txt.texto).toMatch(/^Recomendações do meu jeito .*\(textos de 2026-11-19\)$/);

      await q(`insert into cliente_evento_sensibilidade (cliente_id, tipo, tenant_id, rr, prob, pedidos, esperado, dias_com_pedido, selo)
               values ($1,'dinheiro',$2,1.8,0.95,6,3.2,4,true)`, [id, t]);
      await gravarPrivacidade(db, cli, lerPedidoDePrivacidade({ escolhas: { nao_analisar: true }, declarado: { time: null } }));
      expect(await q(`select 1 from cliente_perfil where cliente_id = $1`, [id])).toEqual([]);
      // O que move o cliente (mig 463) sai junto, na hora.
      expect(await q(`select 1 from cliente_evento_sensibilidade where cliente_id = $1`, [id])).toEqual([]);
      const estado = await lerPrivacidade(db, t, id);
      expect(estado.escolhas).toEqual({ recomendacoes: true, atendimento_personalizado: false, nao_analisar: true, maior_de_18: false });
      expect(estado.ativo).toBe(false); // o módulo nasce desligado: o cardápio não mostra a seção
      expect(estado.declarado).toEqual({});

      await gravarPrivacidade(db, cli, lerPedidoDePrivacidade({ escolhas: { recomendacoes: false } }));
      expect((await lerPrivacidade(db, t, id)).escolhas.recomendacoes).toBe(false);
      expect(await q(`select count(*)::int as n from cliente_escolha where cliente_id = $1 and escolha = 'recomendacoes'`, [id])).toEqual([{ n: 2 }]);
    } finally {
      await c.query('rollback');
      c.release();
    }
  });
});
