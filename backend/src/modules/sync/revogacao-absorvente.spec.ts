import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../../db/schema';
import { SyncService } from './sync.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

// REVOGAÇÃO É ABSORVENTE (ERR-235). 14/10/2026: o presidente revogou o "PDV1" na nuvem às 21h22;
// às 23h19 ele foi usado no modo local (cada uso renova o updated_at no servidor da loja) e às
// 23h23 o servidor, ao voltar, enviou o cadastro dele — na nuvem o PDV1 ficou ativo de novo, com o
// segredo de volta e sem nenhum registro de reativação. O LWW comparava a LINHA inteira.
// Agora, nos DOIS sentidos: uma cópia "ativa" nunca desfaz uma revogação; só um pareamento NOVO,
// feito depois dela ("Trocar máquina" → código → o PC pareia), reativa. Postgres real.
const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('revogacao-absorvente.spec: sem TEST_PG_URL — PULADO');

jest.setTimeout(60_000);

const RAIZ = join(__dirname, '..', '..', '..');
const minutos = (m: number) => new Date(Date.now() + m * 60_000);

descrever('revogação absorvente — a nuvem recebendo da loja (push)', () => {
  let pool: Pool;
  let svc: SyncService;
  const q = (s: string, p: any[] = []) => pool.query(s, p);
  const T = randomUUID();
  const SERVIDOR = randomUUID();
  const ctx = () => ({ tenantId: T, unidadeId: null, equipamentoId: SERVIDOR, token: 'tok-servidor' });

  const terminal = async (o: { revogadoEm?: Date | null; pareadoEm?: Date | null } = {}) => {
    const id = randomUUID();
    await q(
      `insert into equipamento (id, tenant_id, tipo, nome, token, ativo, revogado_em, pareado_em, segredo_hash, updated_at)
       values ($1,$2,'pdv','PDV1',$3,$4,$5,$6,$7, now() - interval '1 hour')`,
      [id, T, 'tok-' + id, !o.revogadoEm, o.revogadoEm ?? null, o.pareadoEm ?? null, o.revogadoEm ? null : 'hash-antigo'],
    );
    return id;
  };
  // A cópia que a loja manda: o mesmo terminal, "ativo", com updated_at MAIS NOVO.
  const daLoja = (id: string, extra: Record<string, any> = {}) => ({
    id, tipo: 'pdv', nome: 'PDV1', token: 'tok-' + id, ativo: true, revogado_em: null,
    pareado_em: minutos(-120), pareamento_codigo: null, segredo_hash: 'hash-antigo',
    updated_at: minutos(0).toISOString(), ...extra,
  });
  const enviar = (linha: any) => svc.push(ctx() as any, [{ tabela: 'equipamento', linhas: [linha] } as any]);
  const ler = async (id: string) =>
    (await q('select ativo, revogado_em, segredo_hash, nome from equipamento where id = $1', [id])).rows[0];

  beforeAll(async () => {
    pool = new Pool({ connectionString: URL_PG });
    svc = new SyncService(drizzle(pool, { schema }) as any);
    await q(`insert into empresa (id, nome) values ($1, 'teste revogacao')`, [T]);
    await q(`insert into equipamento (id, tenant_id, tipo, nome, token) values ($1,$2,'servidor_local','Servidor',$3)`,
      [SERVIDOR, T, 'tok-servidor-' + SERVIDOR]);
  });
  afterAll(async () => {
    if (!pool) return;
    await q('delete from sync_push_lock where equipamento_id = $1', [SERVIDOR]).catch(() => undefined);
    await q('delete from equipamento where tenant_id = $1', [T]).catch(() => undefined);
    await q('delete from empresa where id = $1', [T]).catch(() => undefined);
    await pool.end();
  });

  it('o caso do PDV1: revogado na nuvem, a loja manda "ativo" e mais novo → segue revogado', async () => {
    const id = await terminal({ revogadoEm: minutos(-60), pareadoEm: minutos(-120) });
    await enviar(daLoja(id));
    const r = await ler(id);
    expect(r.ativo).toBe(false);
    expect(r.revogado_em).not.toBeNull();
    expect(r.segredo_hash).toBeNull();
  });

  it('pareado de novo DEPOIS da revogação (Trocar máquina) → a cópia da loja vale', async () => {
    const id = await terminal({ revogadoEm: minutos(-60), pareadoEm: minutos(-120) });
    await enviar(daLoja(id, { pareado_em: minutos(-5), segredo_hash: 'hash-novo' }));
    const r = await ler(id);
    expect(r.ativo).toBe(true);
    expect(r.revogado_em).toBeNull();
    expect(r.segredo_hash).toBe('hash-novo');
  });

  it('a loja revogou e a nuvem não → a revogação da loja sobe', async () => {
    const id = await terminal();
    await enviar(daLoja(id, { ativo: false, revogado_em: minutos(-1), segredo_hash: null }));
    expect((await ler(id)).revogado_em).not.toBeNull();
  });

  it('terminal ativo dos dois lados: o LWW de sempre (a mudança da loja entra)', async () => {
    const id = await terminal();
    await enviar(daLoja(id, { nome: 'PDV do delivery' }));
    expect((await ler(id)).nome).toBe('PDV do delivery');
  });
});

// O mesmo lado do SERVIDOR DA LOJA (pull e restore do sync-daemon). O daemon é um script ESM com
// efeitos ao carregar; a regra mora numa função própria (`condicaoSobrescrever`), avaliada aqui a
// partir do TEXTO do arquivo — é exatamente o SQL que o daemon monta.
function condicaoDoDaemon(): (tabela: string, cols: Set<string>) => string {
  // Sem o \r do Windows: o recorte procura o fim da função pela linha "}".
  const fonte = readFileSync(join(RAIZ, 'edge', 'sync-daemon.mjs'), 'utf8').replace(/\r\n/g, '\n');
  const trecho = (inicio: string) => {
    const i = fonte.indexOf(inicio);
    if (i < 0) throw new Error(`não achei "${inicio}" no sync-daemon.mjs`);
    return fonte.slice(i, fonte.indexOf('\n}\n', i) + 3);
  };
  const q = fonte.match(/^const q = .*$/m)?.[0];
  const terminais = fonte.match(/^const ESTADOS_TERMINAIS = .*$/m)?.[0];
  if (!q || !terminais) throw new Error('sync-daemon.mjs mudou: q / ESTADOS_TERMINAIS não encontrados');
  return new Function(`${q}\n${terminais}\n${trecho('function condicaoSobrescrever(')}\nreturn condicaoSobrescrever;`)();
}

descrever('revogação absorvente — o servidor da loja recebendo da nuvem (pull)', () => {
  let pool: Pool;
  const q = (s: string, p: any[] = []) => pool.query(s, p);
  let condicao: string;

  // Uma tabela com o nome "equipamento" num schema próprio: a regra olha o nome da tabela.
  const esquema = `teste_revogacao_${Date.now()}`;
  const colunas = ['id', 'nome', 'ativo', 'revogado_em', 'pareado_em', 'pareamento_codigo', 'updated_at'];
  const aplicar = (linha: any) =>
    q(
      `insert into equipamento (${colunas.join(',')}) values ($1,$2,$3,$4,$5,$6,$7)
       on conflict (id) do update set ${colunas.filter((c) => c !== 'id').map((c) => `${c}=excluded.${c}`).join(',')}${condicao}`,
      colunas.map((c) => linha[c] ?? null),
    );
  const local = async (o: Record<string, any>) => {
    const id = randomUUID();
    await aplicar({ id, nome: 'PDV1', ativo: true, ...o });
    return id;
  };
  const ler = async (id: string) => (await q('select ativo, revogado_em, nome from equipamento where id = $1', [id])).rows[0];

  beforeAll(async () => {
    pool = new Pool({ connectionString: URL_PG, options: `-c search_path=${esquema}` });
    await q(`create schema ${esquema}`);
    await q(`create table equipamento (id uuid primary key, nome text, ativo boolean, revogado_em timestamptz,
             pareado_em timestamptz, pareamento_codigo text, updated_at timestamptz)`);
    condicao = condicaoDoDaemon()('equipamento', new Set(colunas));
  });
  afterAll(async () => {
    if (!pool) return;
    await q(`drop schema if exists ${esquema} cascade`).catch(() => undefined);
    await pool.end();
  });

  it('revogado na nuvem, a cópia local "mais nova" (terminal em uso) → a revogação desce mesmo assim', async () => {
    const id = await local({ updated_at: minutos(0), pareado_em: minutos(-120) });
    await aplicar({ id, nome: 'PDV1', ativo: false, revogado_em: minutos(-60), pareado_em: minutos(-120), updated_at: minutos(-60) });
    const r = await ler(id);
    expect(r.ativo).toBe(false);
    expect(r.revogado_em).not.toBeNull();
  });

  it('revogado aqui, a nuvem manda uma cópia ativa antiga → segue revogado', async () => {
    const id = await local({ ativo: false, revogado_em: minutos(-10), pareado_em: minutos(-120), updated_at: minutos(-10) });
    await aplicar({ id, nome: 'PDV1', ativo: true, pareado_em: minutos(-120), updated_at: minutos(0) });
    expect((await ler(id)).revogado_em).not.toBeNull();
  });

  it('"Trocar máquina" na nuvem (código novo) → reativa aqui', async () => {
    const id = await local({ ativo: false, revogado_em: minutos(-10), pareado_em: minutos(-120), updated_at: minutos(-10) });
    await aplicar({ id, nome: 'PDV1', ativo: true, pareamento_codigo: '123456', updated_at: minutos(0) });
    expect((await ler(id)).revogado_em).toBeNull();
  });

  it('o LWW de sempre continua: linha da nuvem mais velha não sobrescreve a local', async () => {
    const id = await local({ nome: 'local mais novo', updated_at: minutos(0) });
    await aplicar({ id, nome: 'nuvem antiga', ativo: true, updated_at: minutos(-30) });
    expect((await ler(id)).nome).toBe('local mais novo');
  });

  it('a regra só vale para equipamento (outras tabelas: o LWW de sempre)', () => {
    const outra = condicaoDoDaemon()('produto', new Set(colunas));
    expect(outra).toBe(' where "produto".updated_at < excluded.updated_at');
  });
});
