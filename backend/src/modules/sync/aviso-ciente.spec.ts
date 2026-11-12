import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../../db/schema';
import { SyncService } from './sync.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

// O "CIENTE" DO AVISO DO KDS NÃO SE DESFAZ PELO SINCRONISMO (mig 412, V60). O aviso guardado (`alerta_kds`) sobe e desce;
// o "Ciente" é dado numa tela de um lado e tem de valer nos dois. O sincronismo é última-escrita-vence pela data e os
// relógios são diferentes: sem a regra, a cópia sem "Ciente" mais nova apagaria o "Ciente", e o "Ciente" com a data mais
// velha não chegaria. Postgres real — o push (sync.service) e o pull (sync-daemon, `condicaoSobrescrever`).
const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('aviso-ciente.spec: sem TEST_PG_URL — PULADO');

jest.setTimeout(60_000);

const RAIZ = join(__dirname, '..', '..', '..');

descrever('"Ciente" do aviso do KDS — a nuvem recebendo da loja (push)', () => {
  let pool: Pool;
  let svc: SyncService;
  const q = (s: string, p: any[] = []) => pool.query(s, p).then((r) => r.rows);
  const T = randomUUID();
  const SERVIDOR = randomUUID();
  const ctx = () => ({ tenantId: T, unidadeId: null, equipamentoId: SERVIDOR, token: 'tok-servidor' });
  // Cria o aviso na nuvem (com ou sem "Ciente") com a data de meia hora atrás e manda a cópia da loja.
  async function caso(aquiCiente: boolean, daLojaCiente: boolean, data: 'nova' | 'velha', origemDaLoja = 'da loja') {
    const id = randomUUID();
    await q(`insert into alerta_kds (id, tenant_id, titulo, origem, ciente_em, ciente_por_nome) values ($1,$2,'Trocar o óleo','da nuvem',$3,$4)`, [
      id,
      T,
      aquiCiente ? new Date(Date.now() - 1_800_000) : null,
      aquiCiente ? 'Ana (nuvem)' : null,
    ]);
    await q(`begin; select set_config('regem.sync','on',true);
             update alerta_kds set updated_at = now() - interval '30 minutes' where id = '${id}'; commit;`);
    const linha = JSON.parse(JSON.stringify((await q('select * from alerta_kds where id = $1', [id]))[0]));
    const quando = data === 'nova' ? new Date() : new Date(Date.now() - 3_600_000);
    await svc.push(ctx() as any, [
      {
        tabela: 'alerta_kds',
        linhas: [
          {
            ...linha,
            origem: origemDaLoja,
            ciente_em: daLojaCiente ? new Date(Date.now() - 3_600_000).toISOString() : null,
            ciente_por_nome: daLojaCiente ? 'Bruno (loja)' : null,
            updated_at: quando.toISOString(),
          },
        ],
      } as any,
    ]);
    return (await q('select origem, ciente_em, ciente_por_nome from alerta_kds where id = $1', [id]))[0];
  }

  beforeAll(async () => {
    pool = new Pool({ connectionString: URL_PG });
    svc = new SyncService(drizzle(pool, { schema }) as any);
    const tem = (await q(`select to_regclass(current_schema() || '.alerta_kds') is not null as ok`))[0].ok;
    if (!tem) await pool.query(readFileSync(join(RAIZ, '..', 'database', 'migrations', '412_alerta_kds.sql'), 'utf8'));
    await q(`insert into empresa (id, nome) values ($1, 'teste ciente do aviso')`, [T]);
    await q(`insert into equipamento (id, tenant_id, tipo, nome, token) values ($1,$2,'servidor_local','Servidor',$3)`, [SERVIDOR, T, 'tok-servidor-' + SERVIDOR]);
  });
  afterAll(async () => {
    if (!pool) return;
    await q('delete from sync_push_lock where equipamento_id = $1', [SERVIDOR]).catch(() => undefined);
    await q('delete from alerta_kds where tenant_id = $1', [T]).catch(() => undefined);
    await q('delete from equipamento where tenant_id = $1', [T]).catch(() => undefined);
    await q('delete from empresa where id = $1', [T]).catch(() => undefined);
    await pool.end();
  });

  it('o "Ciente" dado na loja vale aqui mesmo com a data mais velha (relógio atrasado)', async () => {
    expect(await caso(false, true, 'velha')).toMatchObject({ ciente_por_nome: 'Bruno (loja)' });
  });

  it('a cópia SEM "Ciente" da loja, mesmo mais nova, não apaga o "Ciente" daqui', async () => {
    const r = await caso(true, false, 'nova');
    expect(r.ciente_por_nome).toBe('Ana (nuvem)');
    expect(r.ciente_em).not.toBeNull();
  });

  it('sem "Ciente" dos dois lados: o LWW de sempre (a mais nova entra, a mais velha não)', async () => {
    expect((await caso(false, false, 'nova', 'nova da loja')).origem).toBe('nova da loja');
    expect((await caso(false, false, 'velha', 'velha da loja')).origem).toBe('da nuvem');
  });
});

// O lado do SERVIDOR DA LOJA (pull e restore do sync-daemon): a regra mora em `condicaoSobrescrever`, avaliada aqui a
// partir do TEXTO do arquivo — é exatamente o SQL que o daemon monta (como em alteracao-decidida.spec).
function condicaoDoDaemon(): (tabela: string, cols: Set<string>) => string {
  const fonte = readFileSync(join(RAIZ, 'edge', 'sync-daemon.mjs'), 'utf8').replace(/\r\n/g, '\n');
  const i = fonte.indexOf('function condicaoSobrescrever(');
  if (i < 0) throw new Error('não achei condicaoSobrescrever no sync-daemon.mjs');
  const funcao = fonte.slice(i, fonte.indexOf('\n}\n', i) + 3);
  const q = fonte.match(/^const q = .*$/m)?.[0];
  const terminais = fonte.match(/^const ESTADOS_TERMINAIS = .*$/m)?.[0];
  if (!q || !terminais) throw new Error('sync-daemon.mjs mudou: q / ESTADOS_TERMINAIS não encontrados');
  return new Function(`${q}\n${terminais}\n${funcao}\nreturn condicaoSobrescrever;`)();
}

descrever('"Ciente" do aviso do KDS — o servidor da loja recebendo da nuvem (pull)', () => {
  let pool: Pool;
  const q = (s: string, p: any[] = []) => pool.query(s, p).then((r) => r.rows);
  let condicao: string;
  const esquema = `teste_aviso_ciente_${Date.now()}`;
  const aplicar = (linha: any) =>
    q(
      `insert into alerta_kds (id, origem, ciente_em, updated_at) values ($1,$2,$3,$4)
       on conflict (id) do update set origem = excluded.origem, ciente_em = excluded.ciente_em,
                                      updated_at = excluded.updated_at${condicao}`,
      [linha.id, linha.origem, linha.ciente_em, linha.updated_at],
    );
  const ler = async (id: string) => (await q('select origem, ciente_em from alerta_kds where id = $1', [id]))[0];

  beforeAll(async () => {
    pool = new Pool({ connectionString: URL_PG, options: `-c search_path=${esquema}` });
    await q(`create schema ${esquema}`);
    await q(`create table alerta_kds (id uuid primary key, origem text, ciente_em timestamptz, updated_at timestamptz)`);
    condicao = condicaoDoDaemon()('alerta_kds', new Set(['id', 'origem', 'ciente_em', 'updated_at']));
  });
  afterAll(async () => {
    if (!pool) return;
    await q(`drop schema if exists ${esquema} cascade`).catch(() => undefined);
    await pool.end();
  });

  it('o "Ciente" dado aqui não se desfaz por uma cópia da nuvem sem ele, mesmo mais nova', async () => {
    const id = randomUUID();
    await aplicar({ id, origem: 'aqui', ciente_em: new Date(Date.now() - 3_600_000), updated_at: new Date(Date.now() - 3_600_000) });
    await aplicar({ id, origem: 'nuvem', ciente_em: null, updated_at: new Date() });
    expect((await ler(id)).ciente_em).not.toBeNull();
  });

  it('o "Ciente" da nuvem desce mesmo com a data mais velha que a daqui', async () => {
    const id = randomUUID();
    await aplicar({ id, origem: 'aqui', ciente_em: null, updated_at: new Date() });
    await aplicar({ id, origem: 'nuvem', ciente_em: new Date(Date.now() - 7_200_000), updated_at: new Date(Date.now() - 3_600_000) });
    expect(await ler(id)).toMatchObject({ origem: 'nuvem' });
    expect((await ler(id)).ciente_em).not.toBeNull();
  });

  it('sem "Ciente": o LWW de sempre; e a regra só vale para o aviso do KDS', async () => {
    const id = randomUUID();
    await aplicar({ id, origem: 'nova', ciente_em: null, updated_at: new Date() });
    await aplicar({ id, origem: 'velha', ciente_em: null, updated_at: new Date(Date.now() - 60_000) });
    expect((await ler(id)).origem).toBe('nova');
    expect(condicaoDoDaemon()('pedido_alteracao', new Set(['id', 'situacao', 'updated_at']))).not.toContain('ciente_em');
  });
});
