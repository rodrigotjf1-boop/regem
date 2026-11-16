import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../../db/schema';
import { ORDEM_ENCERRADAS, SyncService } from './sync.service';
import { OrdemProducaoService } from '../ordem-producao/ordem-producao.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

// ORDEM DE PRODUÇÃO ENCERRADA NÃO REABRE PELO SYNC (ERR-075, V60). A rotina das 06:20 roda na nuvem e no servidor da loja
// e marca "pendência crítica" na ordem que ainda espera o lançamento. A loja concluiu sem internet (com a entrada no
// estoque) e a nuvem marcou a cópia dela DEPOIS: pela data, a conclusão voltava a pendência — e lançar de novo dobrava o
// estoque. Regra: a encerrada não reabre por uma cópia aberta do outro lado, e a encerrada que chega vence mesmo mais
// velha. Entre duas encerradas, a data. Postgres real no push; o SQL do daemon no pull.
const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('ordem-encerrada.spec: sem TEST_PG_URL — PULADO');

jest.setTimeout(60_000);

const RAIZ = join(__dirname, '..', '..', '..');
const FONTE_DAEMON = readFileSync(join(RAIZ, 'edge', 'sync-daemon.mjs'), 'utf8').replace(/\r\n/g, '\n');

function terminaisDoDaemon(): Record<string, string[]> {
  const linha = FONTE_DAEMON.match(/^const ESTADOS_TERMINAIS = .*$/m)?.[0];
  if (!linha) throw new Error('sync-daemon.mjs mudou: ESTADOS_TERMINAIS não encontrado');
  return new Function(`${linha}\nreturn ESTADOS_TERMINAIS;`)();
}

describe('ordem encerrada — a mesma lista nos três lugares', () => {
  it('as encerradas do serviço, do envio (nuvem) e do daemon (loja) são as mesmas', () => {
    expect([...ORDEM_ENCERRADAS].sort()).toEqual([...OrdemProducaoService.ENCERRADAS].sort());
    expect([...terminaisDoDaemon().ordem_producao].sort()).toEqual([...OrdemProducaoService.ENCERRADAS].sort());
  });
});

// Cada caso: situação deste lado → a outra ponta manda (com a data: 'nova' ou 'velha') → o que fica.
const CASOS: [string, string, 'nova' | 'velha', string][] = [
  ['concluida_total', 'pendencia_critica', 'nova', 'concluida_total'], // encerrada não reabre pela cópia "mais nova"
  ['pendencia_critica', 'concluida_total', 'velha', 'concluida_total'], // a conclusão vence a pendência marcada depois
  ['aguardando_lancamento', 'cancelada', 'velha', 'cancelada'], // qualquer encerrada vence a aberta
  ['aguardando_lancamento', 'pendencia_critica', 'nova', 'pendencia_critica'], // aberta × aberta: a data, como sempre
  ['pendencia_critica', 'aguardando_lancamento', 'velha', 'pendencia_critica'],
  ['cancelada', 'concluida_parcial', 'nova', 'concluida_parcial'], // encerrada × encerrada: a data
  ['cancelada', 'concluida_parcial', 'velha', 'cancelada'],
];

descrever('ordem encerrada — a nuvem recebendo da loja (push)', () => {
  let pool: Pool;
  let svc: SyncService;
  const q = (s: string, p: any[] = []) => pool.query(s, p).then((r) => r.rows);
  const T = randomUUID();
  const SERVIDOR = randomUUID();
  let ficha = '';
  const ctx = () => ({ tenantId: T, unidadeId: null, equipamentoId: SERVIDOR, token: 'tok-servidor' });

  beforeAll(async () => {
    pool = new Pool({ connectionString: URL_PG });
    svc = new SyncService(drizzle(pool, { schema }) as any);
    await q(`insert into empresa (id, nome) values ($1, 'teste ordem encerrada')`, [T]);
    await q(`insert into equipamento (id, tenant_id, tipo, nome, token) values ($1,$2,'servidor_local','Servidor',$3)`, [
      SERVIDOR,
      T,
      'tok-servidor-' + SERVIDOR,
    ]);
    [{ id: ficha }] = await q(`insert into ficha_tecnica (tenant_id, nome) values ($1, 'Molho da casa') returning id`, [T]);
  });
  afterAll(async () => {
    if (!pool) return;
    await q('delete from sync_push_lock where equipamento_id = $1', [SERVIDOR]).catch(() => undefined);
    await q('delete from ordem_producao where tenant_id = $1', [T]).catch(() => undefined);
    await q('delete from ficha_tecnica where tenant_id = $1', [T]).catch(() => undefined);
    await q('delete from equipamento where tenant_id = $1', [T]).catch(() => undefined);
    await q('delete from empresa where id = $1', [T]).catch(() => undefined);
    await pool.end();
  });

  it.each(CASOS)('nuvem "%s", a loja manda "%s" (%s) → fica "%s"', async (aqui, daLoja, data, fica) => {
    const id = randomUUID();
    await q(`insert into ordem_producao (id, tenant_id, ficha_id, data_producao, status) values ($1,$2,$3,'2026-11-14',$4)`, [
      id,
      T,
      ficha,
      aqui,
    ]);
    // a data daqui: meia hora atrás (dentro da sessão de sincronização o gatilho mantém o carimbo)
    await q(`begin; select set_config('regem.sync','on',true);
             update ordem_producao set updated_at = now() - interval '30 minutes' where id = '${id}'; commit;`);
    const linha = JSON.parse(JSON.stringify((await q('select * from ordem_producao where id = $1', [id]))[0]));
    const quando = data === 'nova' ? new Date() : new Date(Date.now() - 3_600_000);
    await svc.push(ctx() as any, [
      { tabela: 'ordem_producao', linhas: [{ ...linha, status: daLoja, updated_at: quando.toISOString() }] } as any,
    ]);
    expect((await q('select status from ordem_producao where id = $1', [id]))[0].status).toBe(fica);
  });
});

// O lado do SERVIDOR DA LOJA (pull e restore do sync-daemon): a regra mora em `condicaoSobrescrever` e em
// `ESTADOS_TERMINAIS`, avaliados a partir do TEXTO do arquivo — é exatamente o SQL que o daemon monta.
function condicaoDoDaemon(): (tabela: string, cols: Set<string>) => string {
  const i = FONTE_DAEMON.indexOf('function condicaoSobrescrever(');
  if (i < 0) throw new Error('não achei condicaoSobrescrever no sync-daemon.mjs');
  const funcao = FONTE_DAEMON.slice(i, FONTE_DAEMON.indexOf('\n}\n', i) + 3);
  const q = FONTE_DAEMON.match(/^const q = .*$/m)?.[0];
  const terminais = FONTE_DAEMON.match(/^const ESTADOS_TERMINAIS = .*$/m)?.[0];
  if (!q || !terminais) throw new Error('sync-daemon.mjs mudou: q / ESTADOS_TERMINAIS não encontrados');
  return new Function(`${q}\n${terminais}\n${funcao}\nreturn condicaoSobrescrever;`)();
}

descrever('ordem encerrada — o servidor da loja recebendo da nuvem (pull)', () => {
  let pool: Pool;
  const q = (s: string, p: any[] = []) => pool.query(s, p).then((r) => r.rows);
  let condicao: string;
  const esquema = `teste_ordem_${Date.now()}`;
  const aplicar = (id: string, status: string, updatedAt: Date) =>
    q(
      `insert into ordem_producao (id, status, updated_at) values ($1,$2,$3)
       on conflict (id) do update set status = excluded.status, updated_at = excluded.updated_at${condicao}`,
      [id, status, updatedAt],
    );

  beforeAll(async () => {
    pool = new Pool({ connectionString: URL_PG, options: `-c search_path=${esquema}` });
    await q(`create schema ${esquema}`);
    await q(`create table ordem_producao (id uuid primary key, status text not null, updated_at timestamptz)`);
    condicao = condicaoDoDaemon()('ordem_producao', new Set(['id', 'status', 'updated_at']));
  });
  afterAll(async () => {
    if (!pool) return;
    await q(`drop schema if exists ${esquema} cascade`).catch(() => undefined);
    await pool.end();
  });

  it.each(CASOS)('loja "%s", a nuvem manda "%s" (%s) → fica "%s"', async (aqui, daNuvem, data, fica) => {
    const id = randomUUID();
    await aplicar(id, aqui, new Date(Date.now() - 1_800_000)); // a daqui: meia hora atrás
    await aplicar(id, daNuvem, data === 'nova' ? new Date() : new Date(Date.now() - 3_600_000));
    expect((await q('select status from ordem_producao where id = $1', [id]))[0].status).toBe(fica);
  });

  it('a regra da ordem só vale para a ordem (o chamado e o cartão seguem com as deles)', () => {
    const doChamado = condicaoDoDaemon()('atendimento_chamado', new Set(['id', 'status', 'atualizado_em']));
    expect(doChamado).not.toContain(`'concluida_total'`);
  });
});
