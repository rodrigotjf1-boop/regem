import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../../db/schema';
import { registrarSaida } from '../../common/consentimento-marketing';
import { CampanhaService } from '../campanha/campanha.service';
import { fichaDoContrato, sqlFichasContato } from '../integracao-api/contato-integracao';
import {
  definirNoPerfil,
  escolhaNoCheckout,
  frasesPromocoes,
  lojaFazCampanha,
  promocoesDaLoja,
  promocoesDoPerfil,
} from './promocoes-cardapio';

/* eslint-disable @typescript-eslint/no-explicit-any */

// PROMOÇÕES PELO WHATSAPP NO CARDÁPIO (mockup aprovado em 01/10/2026), contra o Postgres real.
//
// O banco do CI é montado como servidor de loja: a lista de exclusão (226), o histórico (300), os
// tokens (295), a fila da integração (296) e os números de WhatsApp (225) são só da nuvem. Sobem
// num schema SÓ DESTE TESTE, na frente do `public`; as tabelas em que a 296 e a 302 põem gatilho
// são CÓPIAS nesse schema, sem chave estrangeira (LIC-088) — as outras specs nunca os disparam.
const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('promocoes-cardapio.spec: sem TEST_PG_URL — PULADO');

jest.setTimeout(120_000);

const MIGS = join(__dirname, '..', '..', '..', '..', 'database', 'migrations');
const mig = (n: string) => readFileSync(join(MIGS, n), 'utf8');
const semFkCompartilhada = (s: string) =>
  s.replace(/\s+references\s+(empresa|unidade|cliente)\s*\(\s*id\s*\)(\s+on\s+delete\s+cascade)?/gi, '');
const FONTES = ['pedido_externo', 'comanda', 'comanda_item', 'cliente', 'cliente_endereco'];

describe('as frases (as mesmas na tela e no registro)', () => {
  it('com o nome da loja, sem artigo (serve para "Cantina" e para "Bar")', () => {
    const f = frasesPromocoes('  Cantina   da Praça ');
    expect(f.frase).toBe('Receber promoções de Cantina da Praça pelo WhatsApp');
    expect(f.ligado).toBe('Você recebe as promoções de Cantina da Praça neste número. Para sair, desligue aqui ou responda SAIR.');
    expect(f.apoio).toMatch(/^Desmarque se não quiser\./);
  });

  it('sem nome público (ou o padrão "Cardápio"): "desta loja"', () => {
    expect(frasesPromocoes(null).frase).toBe('Receber promoções desta loja pelo WhatsApp');
    expect(frasesPromocoes('Cardápio').frase).toBe('Receber promoções desta loja pelo WhatsApp');
  });
});

descrever('promoções pelo WhatsApp no cardápio (Postgres real)', () => {
  const SCHEMA = `teste_promocoes_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
  const empresas: string[] = [];
  let admin: Pool;
  let pool: Pool;
  let db: any;
  let campanhas: CampanhaService;
  const q = async (s: string, p: any[] = []) => (await pool.query(s, p)).rows;

  async function empresa(campanha: 'whatsapp' | 'regemcast' | 'nenhuma') {
    const id = randomUUID();
    await admin.query(`insert into empresa (id, nome) values ($1, $2)`, [id, `teste promoções ${id.slice(0, 6)}`]);
    empresas.push(id);
    if (campanha === 'whatsapp') {
      await q(`insert into whatsapp_numero (tenant_id, papel, provedor, status) values ($1, 'marketing', 'cloud', 'conectado')`, [id]);
    } else if (campanha === 'regemcast') {
      await tokenCast(id);
    }
    return id;
  }
  const tokenCast = (tenant: string, escopos = '{pedidos.ler,clientes.telefone.ler,clientes.ler}') =>
    q(
      `insert into integracao_token_loja (tenant_id, unidade_id, cliente, prefixo, token_hash, escopos, autorizado_por,
                                         autorizado_por_nome, autorizado_via)
       values ($1, null, 'regemcast', 'rgm_it_teste', $2, $3, $4, 'Presidente', 'console_distribuicao') returning id`,
      [tenant, `hash-${randomUUID()}`, escopos, randomUUID()],
    );
  const cliente = async (tenant: string, nome: string, telefone: string, optOut = false) =>
    (await q(`insert into cliente (tenant_id, nome, telefone, opt_out_marketing) values ($1, $2, $3, $4) returning id`, [
      tenant,
      nome,
      telefone,
      optOut,
    ]))[0].id as string;
  const eventos = (tenant: string) =>
    q(`select acao, origem, texto, telefone_chave, cliente_id from marketing_consentimento where tenant_id = $1 order by em, id`, [tenant]);
  const lista = (tenant: string) => q(`select telefone, motivo from marketing_optout where tenant_id = $1 order by criado_em`, [tenant]);
  const marca = async (id: string) => (await q(`select opt_out_marketing as m from cliente where id = $1`, [id]))[0].m as boolean;
  const ficha = async (id: string) => fichaDoContrato(((await db.execute(sqlFichasContato([id]))) as any).rows[0]);

  beforeAll(async () => {
    admin = new Pool({ connectionString: URL_PG });
    await admin.query(`create schema ${SCHEMA}`);
    pool = new Pool({ connectionString: URL_PG, options: `-c search_path=${SCHEMA},public`, max: 4 });
    for (const t of FONTES) await pool.query(`create table ${SCHEMA}.${t} (like public.${t} including all)`);
    // A lista de exclusão como a 226 cria e os números de WhatsApp como a 225 cria (só as tabelas).
    await pool.query(`
      create table ${SCHEMA}.marketing_optout (
        id uuid primary key default gen_random_uuid(), tenant_id uuid not null, telefone text not null,
        cliente_id uuid, motivo text, criado_em timestamptz not null default now());
      create unique index on ${SCHEMA}.marketing_optout (tenant_id, telefone);
      create table ${SCHEMA}.whatsapp_numero (
        id uuid primary key default gen_random_uuid(), tenant_id uuid not null, unidade_id uuid,
        papel text not null, provedor text not null default 'evolution', numero text,
        status text not null default 'desconectado');`);
    await pool.query(semFkCompartilhada(mig('295_integracao_token_loja.sql')));
    await pool.query(mig('296_integracao_versao_vendas.sql'));
    for (const n of ['300_marketing_consentimento.sql', '302_integracao_regemcast.sql']) {
      const conf: any = await pool.query(semFkCompartilhada(mig(n)));
      const linhas = (Array.isArray(conf) ? conf[conf.length - 1] : conf).rows;
      if (!linhas.length || linhas.some((l: any) => !l.ok)) throw new Error(`conferência da ${n}: ${JSON.stringify(linhas)}`);
    }
    const [gat] = await q(
      `select count(*)::int n from pg_trigger g join pg_class c on c.oid = g.tgrelid join pg_namespace s on s.oid = c.relnamespace
        where g.tgname like 'trg_integracao_%' and s.nspname = 'public'`,
    );
    if (gat.n) throw new Error('as migrations do teste não podem ter posto gatilho nas tabelas compartilhadas');
    db = drizzle(pool, { schema });
    campanhas = new CampanhaService(db, {} as any, {} as any, {} as any);
  });

  afterAll(async () => {
    await pool?.end();
    if (!admin) return;
    if (empresas.length) await admin.query(`delete from empresa where id = any($1::uuid[])`, [empresas]).catch(() => {});
    await admin.query(`drop schema if exists ${SCHEMA} cascade`);
    await admin.end();
  });

  describe('a loja manda promoção?', () => {
    it('sem RegemCast e sem WhatsApp conectado: não — o cardápio não pergunta nada', async () => {
      const T = await empresa('nenhuma');
      await q(`insert into whatsapp_numero (tenant_id, papel, status) values ($1, 'principal', 'desconectado')`, [T]);
      expect(await lojaFazCampanha(db, T)).toBe(false);
      expect(await promocoesDaLoja(db, T, 'Cantina da Praça')).toBeNull();
      expect(await escolhaNoCheckout(db, { tenantId: T, lojaNome: 'Cantina', telefone: '21999998888', clienteId: null, marcada: true })).toBe(
        'loja_nao_pergunta',
      );
      expect(await eventos(T)).toEqual([]);
    });

    it('WhatsApp conectado no Regem: sim, com as frases que a tela mostra', async () => {
      const T = await empresa('whatsapp');
      expect(await promocoesDaLoja(db, T, 'Cantina da Praça')).toEqual({
        frase: 'Receber promoções de Cantina da Praça pelo WhatsApp',
        apoio: 'Desmarque se não quiser. Para sair depois, responda SAIR ou desligue no seu Perfil.',
      });
    });

    it('RegemCast ligado: sim; token revogado ou sem clientes.ler: não', async () => {
      const T = await empresa('nenhuma');
      const [t] = await tokenCast(T, '{pedidos.ler}');
      expect(await lojaFazCampanha(db, T)).toBe(false);
      await q(`update integracao_token_loja set escopos = '{pedidos.ler,clientes.ler}' where id = $1`, [t.id]);
      expect(await lojaFazCampanha(db, T)).toBe(true);
      await q(`update integracao_token_loja set revogado_em = now() where id = $1`, [t.id]);
      expect(await lojaFazCampanha(db, T)).toBe(false);
    });

    it('sem a tabela (banco de loja, migration faltando): não pergunta e não derruba o cardápio', async () => {
      const T = await empresa('whatsapp');
      await pool.query(`alter table ${SCHEMA}.whatsapp_numero rename to whatsapp_numero_fora`);
      try {
        expect(await lojaFazCampanha(db, T)).toBe(false);
      } finally {
        await pool.query(`alter table ${SCHEMA}.whatsapp_numero_fora rename to whatsapp_numero`);
      }
    });
  });

  describe('a caixinha do checkout', () => {
    let T: string;
    beforeAll(async () => {
      T = await empresa('regemcast');
    });

    it('enviada como vem (marcada): entra na lista de promoções, com a origem que conta como foi', async () => {
      const ana = await cliente(T, 'Ana', '21999998888');
      const p = { tenantId: T, lojaNome: 'Cantina da Praça', telefone: '(21) 99999-8888', clienteId: ana, marcada: true };
      expect(await escolhaNoCheckout(db, p)).toBe('aceite');
      expect(await eventos(T)).toEqual([
        {
          acao: 'aceite',
          origem: 'cardapio_checkout_marcada',
          texto: 'Receber promoções de Cantina da Praça pelo WhatsApp',
          telefone_chave: '21999998888',
          cliente_id: ana,
        },
      ]);
      expect(await lista(T)).toEqual([]);
      // o próximo pedido (outro aparelho, a caixinha de novo) não duplica
      expect(await escolhaNoCheckout(db, { ...p, telefone: '5521999998888' })).toBe('ja_respondido');
      expect(await eventos(T)).toHaveLength(1);
      // e o RegemCast recebe a origem "já vinha marcada"
      expect(await ficha(ana)).toMatchObject({
        opt_out: { ativo: false },
        aceite_marketing: { aceito: true, origem: 'cardapio_checkout_marcada', texto: 'Receber promoções de Cantina da Praça pelo WhatsApp' },
      });
    });

    it('quem pediu para sair continua fora: o checkout não confirma o telefone', async () => {
      const bia = await cliente(T, 'Bia', '21977776666');
      await registrarSaida(db, { tenantId: T, telefone: '552177776666', origem: 'whatsapp', motivo: 'palavra_chave' }); // SAIR, sem o 9
      expect(await escolhaNoCheckout(db, { tenantId: T, lojaNome: 'Cantina', telefone: '21977776666', clienteId: bia, marcada: true })).toBe(
        'continua_fora',
      );
      expect((await lista(T)).map((l: any) => l.telefone)).toEqual(['2177776666']);
      expect((await eventos(T)).filter((e: any) => e.telefone_chave === '21977776666').map((e: any) => e.acao)).toEqual(['saida']);
      // quem a loja marcou no painel também continua fora
      const caio = await cliente(T, 'Caio', '21966665555', true);
      expect(await escolhaNoCheckout(db, { tenantId: T, lojaNome: 'Cantina', telefone: '21966665555', clienteId: caio, marcada: true })).toBe(
        'continua_fora',
      );
      expect(await marca(caio)).toBe(true);
    });

    it('desmarcada: "não quero" — lista de exclusão, marca do cadastro e fora da campanha do Regem', async () => {
      const duda = await cliente(T, 'Duda', '21955554444');
      const gemea = await cliente(T, 'Duda (cadastro antigo, sem o 9)', '2155554444'); // fixo: a chave NÃO casa
      const antes = (await campanhas.previa(T, 'todos')).total;
      expect(await escolhaNoCheckout(db, { tenantId: T, lojaNome: 'Cantina da Praça', telefone: '21955554444', clienteId: duda, marcada: false })).toBe(
        'recusa',
      );
      expect((await lista(T)).find((l: any) => l.telefone === '21955554444')).toMatchObject({ motivo: 'cardapio_checkout' });
      expect(await marca(duda)).toBe(true);
      expect(await marca(gemea)).toBe(false);
      expect((await campanhas.previa(T, 'todos')).total).toBe(antes - 1);
      expect(await escolhaNoCheckout(db, { tenantId: T, lojaNome: 'Cantina da Praça', telefone: '21955554444', clienteId: duda, marcada: false })).toBe(
        'ja_respondido',
      );
      expect(await ficha(duda)).toMatchObject({
        opt_out: { ativo: true, origem: 'cardapio_checkout' },
        aceite_marketing: { aceito: false, origem: 'cardapio_checkout' },
      });
    });

    it('telefone que não é telefone: nada a registrar', async () => {
      expect(await escolhaNoCheckout(db, { tenantId: T, lojaNome: 'Cantina', telefone: '', clienteId: null, marcada: true })).toBe('sem_telefone');
    });
  });

  describe('a chave do Perfil', () => {
    let T: string;
    beforeAll(async () => {
      T = await empresa('whatsapp');
    });

    it('aparece LIGADA para quem nunca respondeu e não pediu para sair', async () => {
      const edu = await cliente(T, 'Edu', '21944443333');
      expect(await promocoesDoPerfil(db, { tenantId: T, id: edu, telefone: '21944443333' }, 'Cantina da Praça')).toEqual({
        ativo: true,
        desde: null,
        respondeu: false,
        ligado: 'Você recebe as promoções de Cantina da Praça neste número. Para sair, desligue aqui ou responda SAIR.',
        desligado: 'Pronto: você não recebe mais promoções desta loja. Já avisamos quem envia as mensagens.',
        fora: 'Você não recebe promoções desta loja. Ligue aqui para voltar a receber.',
      });
    });

    it('desligar vale na hora (lista + marca + fila da integração); ligar de novo é o "sim" do cliente', async () => {
      const fabi = await cliente(T, 'Fabi', '21933332222');
      await tokenCast(T); // RegemCast ligado: a saída tem de entrar na fila da integração
      const c = { tenantId: T, id: fabi, telefone: '21933332222' };
      const p = { tenantId: T, clienteId: fabi, telefone: '21933332222', lojaNome: 'Cantina da Praça' };
      await q(`delete from integracao_mudanca where tenant_id = $1`, [T]);

      expect(await definirNoPerfil(db, { ...p, ativo: false })).toEqual({ ativo: false, mudou: true });
      expect(await promocoesDoPerfil(db, c, 'Cantina da Praça')).toMatchObject({ ativo: false, respondeu: true, desde: null });
      expect((await lista(T)).find((l: any) => l.telefone === '21933332222')).toMatchObject({ motivo: 'cardapio_perfil' });
      expect(await marca(fabi)).toBe(true);
      expect(await ficha(fabi)).toMatchObject({ opt_out: { ativo: true, origem: 'cardapio_perfil' } });
      // quem envia fica sabendo: a ficha do cliente entrou na fila que o RegemCast lê
      expect(await q(`select 1 from integracao_mudanca where tenant_id = $1 and recurso = 'contato' and recurso_id = $2 limit 1`, [T, fabi])).toHaveLength(1);
      // repetir não grava de novo
      expect(await definirNoPerfil(db, { ...p, ativo: false })).toEqual({ ativo: false, mudou: false });

      expect(await definirNoPerfil(db, { ...p, ativo: true })).toEqual({ ativo: true, mudou: true });
      expect(await lista(T)).toEqual([]);
      expect(await marca(fabi)).toBe(false);
      const depois = await promocoesDoPerfil(db, c, 'Cantina da Praça');
      expect(depois).toMatchObject({ ativo: true, respondeu: true });
      expect(depois?.desde).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect((await eventos(T)).filter((e: any) => e.cliente_id === fabi).map((e: any) => `${e.acao}:${e.origem}`)).toEqual([
        'recusa:cardapio_perfil',
        'aceite:cardapio_perfil',
      ]);
      expect(await ficha(fabi)).toMatchObject({ opt_out: { ativo: false }, aceite_marketing: { aceito: true, origem: 'cardapio_perfil' } });
      expect(await definirNoPerfil(db, { ...p, ativo: true })).toEqual({ ativo: true, mudou: false });
    });

    it('quem saiu pelo WhatsApp (SAIR, sem o 9) vê a chave desligada — e ligar tira da lista em todas as formas', async () => {
      const gabi = await cliente(T, 'Gabi', '21987654321');
      await registrarSaida(db, { tenantId: T, telefone: '552187654321', origem: 'whatsapp', motivo: 'palavra_chave' });
      const c = { tenantId: T, id: gabi, telefone: '21987654321' };
      expect(await promocoesDoPerfil(db, c, 'Cantina')).toMatchObject({ ativo: false, respondeu: true });
      await definirNoPerfil(db, { tenantId: T, clienteId: gabi, telefone: '21987654321', lojaNome: 'Cantina', ativo: true });
      expect(await lista(T)).toEqual([]);
      expect(await promocoesDoPerfil(db, c, 'Cantina')).toMatchObject({ ativo: true });
    });

    it('quem a loja marcou no painel vê a chave desligada; ligar derruba a marca', async () => {
      const hugo = await cliente(T, 'Hugo', '21922221111', true);
      const c = { tenantId: T, id: hugo, telefone: '21922221111' };
      expect(await promocoesDoPerfil(db, c, 'Cantina')).toMatchObject({ ativo: false });
      await definirNoPerfil(db, { tenantId: T, clienteId: hugo, telefone: '21922221111', lojaNome: 'Cantina', ativo: true });
      expect(await marca(hugo)).toBe(false);
    });
  });
});
