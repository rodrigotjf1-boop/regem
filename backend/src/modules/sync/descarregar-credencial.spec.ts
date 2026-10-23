import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer, Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { Pool } from 'pg';

/* eslint-disable @typescript-eslint/no-explicit-any */

// O ENVIO ANTES DA REINSTALAÇÃO COM A CREDENCIAL RECUSADA (ERR-123).
//
// Na loja (29/09), a máquina tinha uma instalação antiga cujo servidor já tinha ido para outra
// máquina: a nuvem respondia 401 a tudo. O push tratava o 401 como "linha veneno" e reenviava
// o banco inteiro linha a linha — 14 minutos — marcando cada linha como enviada sem nada ter
// subido. E um banco sem nada novo a enviar não fazia requisição nenhuma: saía 0 com a
// credencial morta, e o instalador apagaria o banco. Estes testes rodam o daemon de verdade
// contra uma nuvem falsa e guardam: a recusa para o envio na primeira requisição, com código de
// saída próprio (4), sem mexer em cursor; e o relógio fora não vira "tudo enviado".

const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('descarregar-credencial.spec: sem TEST_PG_URL — PULADO');

jest.setTimeout(120_000);

const DAEMON = join(__dirname, '..', '..', '..', 'edge', 'sync-daemon.mjs');
const RECUSA = { message: 'Token de sync inválido.', error: 'Unauthorized', statusCode: 401 };

type Pedido = { url: string; lotes: any[] | null };

/** Nuvem falsa: `responder(n)` decide o status da n-ésima requisição (1, 2, ...). */
async function nuvemFalsa(responder: (n: number) => { status: number; corpo: any }) {
  const pedidos: Pedido[] = [];
  const srv: Server = createServer((req, res) => {
    let b = '';
    req.on('data', (c) => (b += c));
    req.on('end', () => {
      let lotes: any[] | null = null;
      try {
        lotes = JSON.parse(b || '{}').lotes ?? null;
      } catch {
        /* corpo não-JSON */
      }
      pedidos.push({ url: req.url ?? '', lotes });
      const r = responder(pedidos.length);
      res.writeHead(r.status, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(r.corpo));
    });
  });
  await new Promise<void>((ok) => srv.listen(0, '127.0.0.1', () => ok()));
  const porta = (srv.address() as AddressInfo).port;
  return { srv, pedidos, url: `http://127.0.0.1:${porta}/api/v1` };
}

/** Roda `sync-daemon --descarregar` ASSÍNCRONO (a nuvem falsa responde neste mesmo processo). */
function descarregar(cloud: string): Promise<{ codigo: number; saida: string }> {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [DAEMON, '--descarregar'], {
      env: {
        ...process.env,
        EDGE_DATABASE_URL: URL_PG,
        DATABASE_URL: URL_PG,
        CLOUD_API: cloud,
        SYNC_TOKEN: 'token-da-instalacao-antiga',
        SYNC_FETCH_RETRIES: '1',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let saida = '';
    p.stdout.on('data', (d) => (saida += d));
    p.stderr.on('data', (d) => (saida += d));
    const prazo = setTimeout(() => p.kill(), 90_000);
    p.on('close', (codigo) => {
      clearTimeout(prazo);
      resolve({ codigo: codigo ?? -1, saida });
    });
  });
}

descrever('--descarregar com a credencial recusada (ERR-123)', () => {
  const pool = new Pool({ connectionString: URL_PG });
  const q = (s: string, p: any[] = []) => pool.query(s, p).then((r) => r.rows);
  // O que sobe ANTES de `categoria_produto` na lista do daemon (o cadastro da loja, fase 3B): no teste do envio, o cursor
  // dessas vai para o futuro — o banco de teste tem linhas delas de outras specs, e o 1º lote tem de ser o desta linha.
  const ANTES = (() => {
    const fonte = readFileSync(DAEMON, 'utf8');
    const bloco = fonte.slice(fonte.indexOf('const PUSH_TABLES = ['), fonte.indexOf("{ tabela: 'categoria_produto'"));
    return [...bloco.matchAll(/tabela: '([a-z_]+)'/g)].map((m) => m[1]);
  })();
  // `sync_state` é a tabela de estado do daemon (no banco da loja). O teste mexe nestas chaves;
  // o que havia antes volta no fim.
  const CHAVES = ['push_seq', 'push_categoria_produto', 'relogio_desvio_s', ...ANTES.map((t) => `push_${t}`)];
  let estadoAntes: { chave: string; valor: string }[] = [];
  let tabelaExistia = false;
  let empresa: string | null = null;

  beforeAll(async () => {
    tabelaExistia = !!(await q(`select to_regclass('public.sync_state') t`))[0].t;
    await q(`create table if not exists sync_state (chave text primary key, valor text)`);
    estadoAntes = await q(`select chave, valor from sync_state where chave = any($1::text[])`, [CHAVES]);
    await q(`delete from sync_state where chave = any($1::text[])`, [CHAVES]);
    empresa = (await q(`insert into empresa (nome) values ('Teste descarregar 401') returning id`))[0].id;
  });

  afterAll(async () => {
    if (empresa) {
      await q(`delete from categoria_produto where tenant_id = $1`, [empresa]);
      await q(`delete from empresa where id = $1`, [empresa]);
    }
    if (tabelaExistia) {
      await q(`delete from sync_state where chave = any($1::text[])`, [CHAVES]);
      for (const l of estadoAntes) await q(`insert into sync_state (chave, valor) values ($1, $2)`, [l.chave, l.valor]);
    } else {
      await q(`drop table if exists sync_state`);
    }
    await pool.end();
  });

  const estado = async (chave: string) =>
    ((await q(`select valor from sync_state where chave = $1`, [chave]))[0]?.valor as string | undefined) ?? null;

  it('credencial recusada logo na conferência: sai 4 em UMA requisição, sem enviar nada', async () => {
    const nuvem = await nuvemFalsa(() => ({ status: 401, corpo: RECUSA }));
    try {
      const r = await descarregar(nuvem.url);
      expect(r.codigo).toBe(4);
      expect(nuvem.pedidos).toHaveLength(1);
      expect(nuvem.pedidos[0].url).toBe('/api/v1/sync/push');
      expect(nuvem.pedidos[0].lotes).toEqual([]); // a conferência vai vazia
      expect(r.saida).toMatch(/RECUSOU este servidor \(HTTP 401: Token de sync inválido\.\)/);
      expect(r.saida).not.toMatch(/dead-letter/);
      expect(await estado('push_seq')).toBeNull(); // nada avançou
    } finally {
      nuvem.srv.close();
    }
  });

  it('credencial recusada no meio do envio: para no lote, sem "linha veneno" e sem avançar o cursor', async () => {
    // Uma linha nova numa tabela que sobe, com o cursor logo antes dela: o 1º lote a leva.
    const [linha] = await q(
      `insert into categoria_produto (tenant_id, nome, updated_at) values ($1, 'Lanches', now()) returning id, updated_at::text as ts`,
      [empresa],
    );
    const cursor = `${new Date(new Date(linha.ts).getTime() - 1000).toISOString()}|00000000-0000-0000-0000-000000000000`;
    await q(`insert into sync_state (chave, valor) values ('push_categoria_produto', $1)
             on conflict (chave) do update set valor = excluded.valor`, [cursor]);
    expect(ANTES).toContain('unidade'); // a leitura da lista do daemon funcionou
    for (const t of ANTES)
      await q(`insert into sync_state (chave, valor) values ($1, '9999-12-31T00:00:00Z|ffffffff-ffff-ffff-ffff-ffffffffffff')
               on conflict (chave) do update set valor = excluded.valor`, [`push_${t}`]);
    // A conferência passa (a credencial ainda valia) e a nuvem passa a recusar no meio.
    const nuvem = await nuvemFalsa((n) => (n === 1 ? { status: 201, corpo: {} } : { status: 401, corpo: RECUSA }));
    try {
      const r = await descarregar(nuvem.url);
      expect(r.codigo).toBe(4);
      expect(nuvem.pedidos).toHaveLength(2); // conferência + o 1º lote — antes: uma por LINHA
      expect(nuvem.pedidos[1].lotes?.[0]?.tabela).toBe('categoria_produto');
      expect(nuvem.pedidos[1].lotes?.[0]?.linhas.map((l: any) => l.id)).toContain(linha.id);
      expect(r.saida).not.toMatch(/dead-letter/);
      expect(await estado('push_categoria_produto')).toBe(cursor); // a linha continua para enviar
    } finally {
      nuvem.srv.close();
    }
  });

  it('relógio fora: o envio suspenso NÃO sai 0 ("tudo enviado") — sai 1 sem requisição nenhuma', async () => {
    await q(`insert into sync_state (chave, valor) values ('relogio_desvio_s', '7200')
             on conflict (chave) do update set valor = excluded.valor`);
    const nuvem = await nuvemFalsa(() => ({ status: 201, corpo: {} }));
    try {
      const r = await descarregar(nuvem.url);
      expect(r.codigo).toBe(1);
      expect(nuvem.pedidos.filter((p) => p.url.endsWith('/sync/push'))).toHaveLength(0);
      expect(r.saida).toMatch(/rel[óo]gio/i);
    } finally {
      nuvem.srv.close();
      await q(`delete from sync_state where chave = 'relogio_desvio_s'`);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// A PRIMEIRA CARGA DO SERVIDOR DA LOJA (ERR-132) — um ciclo do daemon real contra a nuvem falsa.
//
// Na loja piloto (30/09), a primeira carga do zero trazia milhares de filhos antes do pai; cada
// um era tentado e desfeito num ponto de salvamento da MESMA transação, e o Postgres esgotou a
// tabela de travas ("53200 out of shared memory"). O ciclo voltava inteiro e o seguinte repetia
// a mesma página: o servidor nunca recebeu a loja. Reproduzido no Postgres 17 da loja; aqui o
// teto de tentativas desfeitas vem baixo (SYNC_TETO_DESFEITAS) para provar o gravar em partes
// sem precisar de 13 mil tentativas. Mesmo arquivo do bloco acima: os dois mexem no estado do
// daemon (`sync_state`) e não podem rodar ao mesmo tempo.

/** Nuvem falsa do ciclo: devolve a página dada no pull e aceita o resto. */
async function nuvemDoCiclo(pagina: any) {
  const srv: Server = createServer((req, res) => {
    let b = '';
    req.on('data', (c) => (b += c));
    req.on('end', () => {
      const u = req.url ?? '';
      res.writeHead(u.startsWith('/api/v1/sync/push') ? 201 : 200, { 'content-type': 'application/json; charset=utf-8' });
      if (u.startsWith('/api/v1/sync/pull')) return res.end(JSON.stringify(pagina));
      if (u.startsWith('/api/v1/edge/comandos')) return res.end('[]');
      return res.end('{}');
    });
  });
  await new Promise<void>((ok) => srv.listen(0, '127.0.0.1', () => ok()));
  return { srv, url: `http://127.0.0.1:${(srv.address() as AddressInfo).port}/api/v1` };
}

/** Roda `sync-daemon --um-ciclo` (assíncrono: a nuvem falsa responde neste processo). */
function umCiclo(cloud: string, extra: Record<string, string> = {}): Promise<{ codigo: number; saida: string }> {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [DAEMON, '--um-ciclo'], {
      env: {
        ...process.env,
        EDGE_DATABASE_URL: URL_PG,
        DATABASE_URL: URL_PG,
        CLOUD_API: cloud,
        SYNC_TOKEN: 'token-do-servidor',
        SYNC_FETCH_RETRIES: '1',
        SYNC_PUSH_LIMITE_MS: '1500', // o push do banco compartilhado do CI não interessa aqui
        EDGE_UNIDADE_ID: '',
        ...extra,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let saida = '';
    p.stdout.on('data', (d) => (saida += d));
    p.stderr.on('data', (d) => (saida += d));
    const prazo = setTimeout(() => p.kill(), 100_000);
    p.on('close', (codigo) => {
      clearTimeout(prazo);
      resolve({ codigo: codigo ?? -1, saida });
    });
  });
}

descrever('primeira carga do servidor da loja (ERR-132)', () => {
  const pool = new Pool({ connectionString: URL_PG });
  const q = (s: string, p: any[] = []) => pool.query(s, p).then((r) => r.rows);
  // Um ciclo inteiro mexe em muitas chaves do estado do daemon e na fila de órfãos: tudo o que
  // havia antes volta no fim.
  let estadoAntes: { chave: string; valor: string }[] = [];
  let tabelaExistia = false;
  let orfaosAntes: any[] = [];
  let empresa: string | null = null;

  beforeAll(async () => {
    tabelaExistia = !!(await q(`select to_regclass('public.sync_state') t`))[0].t;
    await q(`create table if not exists sync_state (chave text primary key, valor text)`);
    estadoAntes = await q(`select chave, valor from sync_state`);
    orfaosAntes = await q(`select tipo, tabela, registro_id, conteudo, tentativas from sync_fila where tipo = 'orfao'`);
    empresa = (await q(`insert into empresa (nome) values ('Teste primeira carga') returning id`))[0].id;
  });

  afterAll(async () => {
    try {
      await q(`drop trigger if exists zz_teste_sem_recurso on categoria_produto`);
      await q(`drop function if exists zz_teste_sem_recurso()`);
      if (empresa) {
        await q(`delete from producao_pedido_item where tenant_id = $1`, [empresa]);
        await q(`delete from categoria_produto where tenant_id = $1`, [empresa]);
        await q(`delete from empresa where id = $1`, [empresa]);
      }
      await q(`delete from sync_fila where tipo = 'orfao'`);
      for (const o of orfaosAntes) {
        await q(`insert into sync_fila (tipo, tabela, registro_id, conteudo, tentativas) values ($1,$2,$3,$4,$5)`, [
          o.tipo, o.tabela, o.registro_id, o.conteudo, o.tentativas,
        ]);
      }
      if (tabelaExistia) {
        await q(`delete from sync_state`);
        for (const l of estadoAntes) await q(`insert into sync_state (chave, valor) values ($1, $2)`, [l.chave, l.valor]);
      } else {
        await q(`drop table if exists sync_state`);
      }
    } finally {
      await pool.end();
    }
  });

  const estado = async (chave: string) =>
    ((await q(`select valor from sync_state where chave = $1`, [chave]))[0]?.valor as string | undefined) ?? null;

  it('órfãos em massa: o ciclo termina gravando em partes e o cursor anda junto com as linhas', async () => {
    const agora = Date.now();
    const itens = Array.from({ length: 60 }, (_, i) => ({
      id: randomUUID(),
      tenant_id: empresa,
      pedido_id: randomUUID(), // o pedido ainda não chegou
      descricao: `Item ${i}`,
      quantidade: '1',
      status: 'ok',
      updated_at: new Date(agora - (60 - i) * 1000).toISOString(),
    }));
    const cursor = `${itens[59].updated_at}|${itens[59].id}`;
    const nuvem = await nuvemDoCiclo({
      tabelas: { producao_pedido_item: itens },
      cursores: { producao_pedido_item: cursor },
      proximoCursor: itens[59].updated_at,
    });
    try {
      const r = await umCiclo(nuvem.url, { SYNC_TETO_DESFEITAS: '20' });
      expect(r.saida).toMatch(/sync ok/);
      expect(r.codigo).toBe(0);
      expect(r.saida).toMatch(/carga grande gravada em \d+ partes/);
      expect(r.saida).not.toMatch(/53200/);
      expect(JSON.parse((await estado('pull_cursores')) ?? '{}')).toMatchObject({ producao_pedido_item: cursor });
      const [fila] = await q(
        `select count(*)::int n from sync_fila where tipo = 'orfao' and tabela = 'producao_pedido_item' and registro_id = any($1::uuid[])`,
        [itens.map((x) => x.id)],
      );
      expect(fila.n).toBe(60); // esperam o pai — nada foi pulado
      expect(await estado('sync_falhando_desde')).toBe('');
    } finally {
      nuvem.srv.close();
    }
  });

  it('falta de recurso do banco derruba o ciclo: nada é pulado e o cursor não anda', async () => {
    // Gatilho só para a linha marcada: o mesmo 53200 que a primeira carga produzia.
    await q(`create or replace function zz_teste_sem_recurso() returns trigger as $$
             begin
               if new.nome = 'zz-sem-recurso' then
                 raise exception 'out of shared memory' using errcode = '53200';
               end if;
               return new;
             end $$ language plpgsql`);
    await q(`drop trigger if exists zz_teste_sem_recurso on categoria_produto`);
    await q(`create trigger zz_teste_sem_recurso before insert on categoria_produto
             for each row execute function zz_teste_sem_recurso()`);
    const agora = new Date().toISOString();
    const cats = [
      { id: randomUUID(), tenant_id: empresa, nome: 'Bebidas (primeira carga)', updated_at: agora },
      { id: randomUUID(), tenant_id: empresa, nome: 'zz-sem-recurso', updated_at: agora },
    ];
    const cursorAntes = await estado('pull_cursores');
    const nuvem = await nuvemDoCiclo({
      tabelas: { categoria_produto: cats },
      cursores: { categoria_produto: `${agora}|${cats[1].id}` },
      proximoCursor: agora,
    });
    try {
      const r = await umCiclo(nuvem.url);
      expect(r.codigo).toBe(1);
      expect(r.saida).toMatch(/sync FALHOU: 53200/);
      expect(r.saida).not.toMatch(/IGNORADA/); // antes: a linha era pulada e o cursor andava
      expect(await estado('pull_cursores')).toBe(cursorAntes);
      const [bebidas] = await q(`select count(*)::int n from categoria_produto where id = $1`, [cats[0].id]);
      expect(bebidas.n).toBe(0); // o ciclo voltou inteiro
      expect(await estado('sync_falhando_desde')).toMatch(/^\d{4}-\d{2}-\d{2}T/); // vai na batida
    } finally {
      nuvem.srv.close();
      await q(`drop trigger if exists zz_teste_sem_recurso on categoria_produto`);
      await q(`drop function if exists zz_teste_sem_recurso()`);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// ENVIO ADIADO (ERR-278) — o daemon real contra uma nuvem que atrasa ou recusa o envio.
//
// Medido na loja em 21/10: o envio que passava do tempo era REPETIDO na hora e batia na trava do
// primeiro (429 "Já há um push deste dispositivo em curso"); o ciclo inteiro contava como falha, o
// intervalo esticava até 5 min e a nuvem deixava de ver o servidor como vivo — pedidos de canal
// levando de 2 a 5 minutos para descer. Agora o envio que passou do tempo não se repete, o 429 e o
// tempo esgotado deixam o lote para o próximo ciclo (sem falha) e o --descarregar NÃO apaga o banco
// com um lote pendente. Mesmo arquivo dos blocos acima: todos mexem no `sync_state`.

/** Nuvem falsa do envio: `push(n, lotes)` decide a n-ésima requisição de envio (status, corpo, atraso). */
async function nuvemDoEnvio(push: (n: number, lotes: any[]) => { status: number; corpo?: any; atrasoMs?: number }) {
  const envios: any[][] = [];
  const srv: Server = createServer((req, res) => {
    let b = '';
    req.on('data', (c) => (b += c));
    req.on('end', () => {
      const u = req.url ?? '';
      const responder = (status: number, corpo: any) => {
        if (res.writableEnded || res.destroyed) return;
        res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(corpo));
      };
      if (u.startsWith('/api/v1/sync/push')) {
        let lotes: any[] = [];
        try {
          lotes = JSON.parse(b || '{}').lotes ?? [];
        } catch {
          /* corpo não-JSON */
        }
        envios.push(lotes);
        const r = push(envios.length, lotes);
        if (r.atrasoMs) setTimeout(() => responder(r.status, r.corpo ?? {}), r.atrasoMs);
        else responder(r.status, r.corpo ?? {});
        return;
      }
      if (u.startsWith('/api/v1/sync/pull')) return responder(200, { tabelas: {}, cursores: {} });
      if (u.startsWith('/api/v1/edge/comandos')) return responder(200, []);
      return responder(200, {});
    });
  });
  await new Promise<void>((ok) => srv.listen(0, '127.0.0.1', () => ok()));
  return { srv, envios, url: `http://127.0.0.1:${(srv.address() as AddressInfo).port}/api/v1` };
}

/** Roda o daemon real (`--descarregar` ou `--um-ciclo`) com o ambiente dado. */
function rodarDaemon(
  modo: '--descarregar' | '--um-ciclo' | '--conferir-pedidos',
  cloud: string,
  extra: Record<string, string>,
): Promise<{ codigo: number; saida: string }> {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [DAEMON, modo], {
      env: {
        ...process.env,
        EDGE_DATABASE_URL: URL_PG,
        DATABASE_URL: URL_PG,
        CLOUD_API: cloud,
        SYNC_TOKEN: 'token-do-servidor',
        EDGE_UNIDADE_ID: '',
        ...extra,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let saida = '';
    p.stdout.on('data', (d) => (saida += d));
    p.stderr.on('data', (d) => (saida += d));
    const prazo = setTimeout(() => p.kill(), 100_000);
    p.on('close', (codigo) => {
      clearTimeout(prazo);
      resolve({ codigo: codigo ?? -1, saida });
    });
  });
}

const EM_CURSO = { statusCode: 429, message: 'Já há um push deste dispositivo em curso.', error: 'Too Many Requests' };

descrever('envio adiado: 429 "em curso" e envio que passou do tempo (ERR-278)', () => {
  const pool = new Pool({ connectionString: URL_PG });
  const q = (s: string, p: any[] = []) => pool.query(s, p).then((r) => r.rows);
  let estadoAntes: { chave: string; valor: string }[] = [];
  let tabelaExistia = false;
  let empresa: string | null = null;
  let cursor = '';
  let linhaId = '';

  beforeAll(async () => {
    tabelaExistia = !!(await q(`select to_regclass('public.sync_state') t`))[0].t;
    await q(`create table if not exists sync_state (chave text primary key, valor text)`);
    estadoAntes = await q(`select chave, valor from sync_state`);
    empresa = (await q(`insert into empresa (nome) values ('Teste envio adiado') returning id`))[0].id;
    const [linha] = await q(
      `insert into categoria_produto (tenant_id, nome, updated_at) values ($1, 'Porções', now()) returning id, updated_at::text as ts`,
      [empresa],
    );
    linhaId = linha.id;
    cursor = `${new Date(new Date(linha.ts).getTime() - 1000).toISOString()}|00000000-0000-0000-0000-000000000000`;
  });

  // Cada caso começa com a linha nova da categoria logo depois do cursor e sem marca de falha; as outras
  // tabelas com o cursor no fim (nada delas sobe), para o 1º lote enviado ser o da categoria.
  beforeEach(async () => {
    await q(`delete from sync_state where chave like 'push\\_%' or chave in ('sync_falhando_desde', 'relogio_desvio_s')`);
    const futuro = '2999-01-01T00:00:00Z|ffffffff-ffff-ffff-ffff-ffffffffffff';
    const tabelas = (await q(`select distinct table_name from information_schema.columns
                               where table_schema = current_schema() and column_name = 'tenant_id'`)).map((t: any) => t.table_name);
    for (const t of tabelas) {
      await q(`insert into sync_state (chave, valor) values ($1, $2) on conflict (chave) do update set valor = excluded.valor`, [`push_${t}`, futuro]);
      await q(`insert into sync_state (chave, valor) values ($1, $2) on conflict (chave) do update set valor = excluded.valor`, [`push_${t}__id`, 'ffffffff-ffff-ffff-ffff-ffffffffffff']);
    }
    await q(`update sync_state set valor = $1 where chave = 'push_categoria_produto'`, [cursor]);
  });

  afterAll(async () => {
    try {
      if (empresa) {
        await q(`delete from categoria_produto where tenant_id = $1`, [empresa]);
        await q(`delete from empresa where id = $1`, [empresa]);
      }
      if (tabelaExistia) {
        await q(`delete from sync_state`);
        for (const l of estadoAntes) await q(`insert into sync_state (chave, valor) values ($1, $2)`, [l.chave, l.valor]);
      } else {
        await q(`drop table if exists sync_state`);
      }
    } finally {
      await pool.end();
    }
  });

  const estado = async (chave: string) =>
    ((await q(`select valor from sync_state where chave = $1`, [chave]))[0]?.valor as string | undefined) ?? null;
  const comLinhas = (envios: any[][]) => envios.filter((l) => l.length && l[0]?.linhas?.length);

  it('--descarregar: o envio que passou do tempo NÃO se repete, sai 1 (o banco fica) e o cursor não anda', async () => {
    // A conferência da credencial responde na hora; o 1º lote demora mais que o tempo do envio.
    const nuvem = await nuvemDoEnvio((n) => (n === 1 ? { status: 201 } : { status: 201, atrasoMs: 2500 }));
    try {
      const r = await rodarDaemon('--descarregar', nuvem.url, { SYNC_PUSH_TIMEOUT_MS: '800', SYNC_FETCH_RETRIES: '3' });
      expect(r.codigo).toBe(1);
      expect(r.saida).toMatch(/ficou pendente \(o envio passou do tempo\) — NÃO apagar o banco/);
      const lotes = comLinhas(nuvem.envios);
      expect(lotes).toHaveLength(1); // antes: repetia na hora (até 3 vezes) em cima da própria trava
      expect(lotes[0][0].tabela).toBe('categoria_produto');
      expect(lotes[0][0].linhas.map((l: any) => l.id)).toContain(linhaId);
      expect(await estado('push_categoria_produto')).toBe(cursor);
    } finally {
      nuvem.srv.close();
    }
  });

  it('--descarregar: 429 "em curso" no lote sai 1 (o banco fica), sem "linha veneno" e sem andar o cursor', async () => {
    const nuvem = await nuvemDoEnvio((n) => (n === 1 ? { status: 201 } : { status: 429, corpo: EM_CURSO }));
    try {
      const r = await rodarDaemon('--descarregar', nuvem.url, { SYNC_FETCH_RETRIES: '3' });
      expect(r.codigo).toBe(1);
      expect(r.saida).toMatch(/ficou pendente \(outro envio deste servidor ainda está na nuvem\) — NÃO apagar o banco/);
      expect(r.saida).not.toMatch(/dead-letter/);
      expect(comLinhas(nuvem.envios)).toHaveLength(1);
      expect(await estado('push_categoria_produto')).toBe(cursor);
    } finally {
      nuvem.srv.close();
    }
  });

  it('um ciclo: 429 "em curso" deixa o lote para o próximo ciclo — "sync ok", sem marca de falha', async () => {
    const nuvem = await nuvemDoEnvio(() => ({ status: 429, corpo: EM_CURSO }));
    try {
      const r = await rodarDaemon('--um-ciclo', nuvem.url, { SYNC_FETCH_RETRIES: '3' });
      expect(r.saida).toMatch(/sync ok — pull \d+ linha\(s\), push 0 linha\(s\) \(categoria_produto fica para o próximo ciclo: outro envio/);
      expect(r.saida).not.toMatch(/sync FALHOU/);
      expect(r.codigo).toBe(0); // o ciclo não contou falha (não estica o intervalo)
      expect(await estado('sync_falhando_desde')).toBe('');
      expect(await estado('push_categoria_produto')).toBe(cursor);
    } finally {
      nuvem.srv.close();
    }
  });

  it('um ciclo: o envio que passou do tempo não se repete e não vira falha', async () => {
    const nuvem = await nuvemDoEnvio(() => ({ status: 201, atrasoMs: 2500 }));
    try {
      const r = await rodarDaemon('--um-ciclo', nuvem.url, { SYNC_PUSH_TIMEOUT_MS: '800', SYNC_FETCH_RETRIES: '3' });
      expect(r.saida).toMatch(/categoria_produto fica para o próximo ciclo \(o envio passou do tempo; lote de 200\)/);
      expect(r.saida).toMatch(/sync ok/);
      expect(r.saida).not.toMatch(/sync FALHOU/);
      expect(r.codigo).toBe(0);
      expect(comLinhas(nuvem.envios)).toHaveLength(1);
      expect(await estado('sync_falhando_desde')).toBe('');
    } finally {
      nuvem.srv.close();
    }
  });
});

// ===== CONFERÊNCIA RÁPIDA DOS PEDIDOS (ERR-280) =====
// O pull anda por um cursor de data, e um pedido gravado com data anterior a ele nunca desceria (o eco do envio com o
// relógio da loja adiantado, uma gravação que termina tarde na nuvem). A cada ~30 s o servidor da loja pergunta quais
// pedidos ele precisa ter (id e versão) e pede PELO ID o que falta. Aqui, o daemon real (`--conferir-pedidos`) contra uma
// nuvem falsa, com o banco do teste fazendo de banco da loja. Mesmo arquivo dos blocos acima: todos mexem no `sync_state`.

/**
 * Nuvem falsa da conferência: `lista()` responde a pergunta; `porId(ids)`, o pedido pelo id; `pull()`, o pull do ciclo.
 * Guarda o que foi pedido. O resto (envio, batida, licença) responde 200 vazio.
 */
async function nuvemDaConferencia(o: {
  lista: () => { status: number; corpo?: any };
  porId?: (ids: string[]) => { status: number; corpo?: any };
  pull?: () => any;
}) {
  const porIdPedidos: string[][] = [];
  const telemetria: any[] = [];
  const srv: Server = createServer((req, res) => {
    let b = '';
    req.on('data', (c) => (b += c));
    req.on('end', () => {
      const u = req.url ?? '';
      const responder = (status: number, corpo: any) => {
        res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(corpo));
      };
      let corpo: any = {};
      try {
        corpo = JSON.parse(b || '{}');
      } catch {
        /* corpo não-JSON */
      }
      if (u.startsWith('/api/v1/sync/pedidos-pendentes') && req.method === 'GET') {
        const r = o.lista();
        return responder(r.status, r.corpo ?? {});
      }
      if (u.startsWith('/api/v1/sync/pedidos-pendentes') && req.method === 'POST') {
        porIdPedidos.push(corpo.ids ?? []);
        const r = o.porId ? o.porId(corpo.ids ?? []) : { status: 500, corpo: { message: 'sem resposta' } };
        return responder(r.status, r.corpo ?? {});
      }
      if (u.startsWith('/api/v1/edge/telemetria')) {
        telemetria.push(corpo);
        return responder(201, {});
      }
      if (u.startsWith('/api/v1/sync/pull')) return responder(200, o.pull ? o.pull() : { tabelas: {}, cursores: {} });
      if (u.startsWith('/api/v1/sync/push')) return responder(201, {});
      if (u.startsWith('/api/v1/edge/comandos')) return responder(200, []);
      return responder(200, {});
    });
  });
  await new Promise<void>((ok) => srv.listen(0, '127.0.0.1', () => ok()));
  return { srv, porIdPedidos, telemetria, url: `http://127.0.0.1:${(srv.address() as AddressInfo).port}/api/v1` };
}

descrever('conferência rápida dos pedidos (ERR-280)', () => {
  const pool = new Pool({ connectionString: URL_PG });
  const q = (s: string, p: any[] = []) => pool.query(s, p).then((r) => r.rows);
  // Gravação como a do daemon (sessão marcada como sync): o carimbo não troca a versão e a exclusão não vira registro.
  const comoSync = async (s: string, p: any[] = []) => {
    const c = await pool.connect();
    try {
      await c.query('begin');
      await c.query(`select set_config('regem.sync', 'on', true)`);
      const r = await c.query(s, p);
      await c.query('commit');
      return r.rows;
    } catch (e) {
      await c.query('rollback');
      throw e;
    } finally {
      c.release();
    }
  };
  let estadoAntes: { chave: string; valor: string }[] = [];
  let tabelaExistia = false;
  let E = '';

  // A linha como a nuvem a manda (as datas em texto completo) + `__v`, a versão inteira.
  const naNuvem = async (id: string) =>
    (await q(`select to_jsonb(p) || jsonb_build_object('__v', p.updated_at::text) as j from pedido_externo p where id = $1`, [id]))[0].j;
  const clienteNaNuvem = async (id: string) => (await q(`select to_jsonb(c) as j from cliente c where id = $1`, [id]))[0].j;
  const novoPedido = async (display: string, cliente: string | null = null) =>
    (await q(`insert into pedido_externo (tenant_id, canal, status, cliente_id, display_id) values ($1, 'ifood', 'novo', $2, $3) returning id`, [
      E,
      cliente,
      display,
    ]))[0].id as string;
  const novoCliente = async (nome: string) => (await q(`insert into cliente (tenant_id, nome) values ($1, $2) returning id`, [E, nome]))[0].id as string;
  const daLista = (...js: any[]) => ({ status: 200, corpo: { pedidos: js.map((j) => ({ id: j.id, v: j.updated_at })) } });
  const existe = async (id: string) => (await q(`select count(*)::int as n from pedido_externo where id = $1`, [id]))[0].n === 1;

  beforeAll(async () => {
    tabelaExistia = !!(await q(`select to_regclass('public.sync_state') t`))[0].t;
    await q(`create table if not exists sync_state (chave text primary key, valor text)`);
    estadoAntes = await q(`select chave, valor from sync_state`);
    E = (await q(`insert into empresa (nome) values ('Teste conferência rápida') returning id`))[0].id;
  });

  beforeEach(async () => {
    await q(`delete from sync_state where chave = 'pull_cursores'`);
    await comoSync(`delete from pedido_externo where tenant_id = $1`, [E]);
    await comoSync(`delete from cliente where tenant_id = $1`, [E]);
  });

  afterAll(async () => {
    try {
      if (E) {
        await comoSync(`delete from pedido_externo where tenant_id = $1`, [E]);
        await comoSync(`delete from cliente where tenant_id = $1`, [E]);
        await q(`delete from sync_exclusao where tenant_id = $1`, [E]).catch(() => undefined);
        await q(`delete from sync_marcador where tenant_id = $1`, [E]).catch(() => undefined);
        await q(`delete from empresa where id = $1`, [E]);
      }
      if (tabelaExistia) {
        await q(`delete from sync_state`);
        for (const l of estadoAntes) await q(`insert into sync_state (chave, valor) values ($1, $2)`, [l.chave, l.valor]);
      } else {
        await q(`drop table if exists sync_state`);
      }
    } finally {
      await pool.end();
    }
  });

  it('traz pelo id o pedido que falta aqui, com os pagamentos e o cliente novo — e não pede o que está igual ou mais novo aqui', async () => {
    const cli = await novoCliente('Cliente novo');
    const novo = await novoPedido('#101', cli);
    await q(`insert into pedido_externo_pagamento (tenant_id, pedido_externo_id, forma, valor) values ($1, $2, 'pix', 30), ($1, $2, 'dinheiro', 12.5)`, [
      E,
      novo,
    ]);
    const jNovo = await naNuvem(novo);
    const jCli = await clienteNaNuvem(cli);
    const jPags = (await q(`select to_jsonb(p) as j from pedido_externo_pagamento p where pedido_externo_id = $1`, [novo])).map((x: any) => x.j);
    const jIgual = await naNuvem(await novoPedido('#102'));
    const maisNovoAqui = await novoPedido('#103');
    const jMaisNovo = await naNuvem(maisNovoAqui);
    // A loja ainda não recebeu o #101 (nem o cliente dele); o #103 ela mudou depois da versão que a nuvem tem.
    await comoSync(`delete from pedido_externo where id = $1`, [novo]);
    await comoSync(`delete from cliente where id = $1`, [cli]);
    await comoSync(`update pedido_externo set updated_at = updated_at + interval '1 minute' where id = $1`, [maisNovoAqui]);

    const nuvem = await nuvemDaConferencia({
      lista: () => daLista(jNovo, jIgual, jMaisNovo),
      porId: (ids) => ({
        status: 201,
        corpo: { tabelas: { cliente: [jCli], pedido_externo: [jNovo].filter((j) => ids.includes(j.id)), pedido_externo_pagamento: jPags } },
      }),
    });
    try {
      const r = await rodarDaemon('--conferir-pedidos', nuvem.url, {});
      expect(r.codigo).toBe(0);
      expect(nuvem.porIdPedidos).toEqual([[novo]]); // só o que faltava
      expect(r.saida).toMatch(/pedidos: 1 pedido\(s\) gravado\(s\) pela conferência rápida \(faltavam 1\)/);
      const [aqui] = await q(`select status, cliente_id, updated_at = $2::timestamptz as mesma_versao from pedido_externo where id = $1`, [
        novo,
        jNovo.updated_at,
      ]);
      expect(aqui).toEqual({ status: 'novo', cliente_id: cli, mesma_versao: true });
      const formas = (await q(`select forma from pedido_externo_pagamento where pedido_externo_id = $1 order by forma`, [novo])).map((x: any) => x.forma);
      expect(formas).toEqual(['dinheiro', 'pix']);
      // Gravado com a versão da nuvem, inteira: a próxima conferência não pede de novo (nada de laço a cada 30 s).
      const r2 = await rodarDaemon('--conferir-pedidos', nuvem.url, {});
      expect(r2.codigo).toBe(0);
      expect(r2.saida).toMatch(/"faltavam":0/);
      expect(nuvem.porIdPedidos).toHaveLength(1);
    } finally {
      nuvem.srv.close();
    }
  });

  it('o pedido mais velho aqui é atualizado; o cliente que a loja já tem não é sobrescrito; sem o cliente, o pedido entra sem ele', async () => {
    const daLoja = await novoCliente('Nome da loja');
    const velho = await novoPedido('#201', daLoja);
    // Na nuvem, o canal cancelou o #201 (versão mais nova) e o cliente tem outro nome.
    await comoSync(`update pedido_externo set status = 'cancelado', updated_at = now() + interval '1 minute' where id = $1`, [velho]);
    const jVelho = await naNuvem(velho);
    const jClienteNuvem = { ...(await clienteNaNuvem(daLoja)), nome: 'Nome da nuvem' };
    await comoSync(`update pedido_externo set status = 'novo', updated_at = now() where id = $1`, [velho]); // a loja ficou para trás
    // O #202 aponta para um cliente que nem a nuvem manda.
    const fantasma = await novoCliente('Cliente que não desce');
    const semCliente = await novoPedido('#202', fantasma);
    const jSem = await naNuvem(semCliente);
    await comoSync(`delete from pedido_externo where id = $1`, [semCliente]);
    await comoSync(`delete from cliente where id = $1`, [fantasma]);

    const nuvem = await nuvemDaConferencia({
      lista: () => daLista(jVelho, jSem),
      porId: () => ({ status: 201, corpo: { tabelas: { cliente: [jClienteNuvem], pedido_externo: [jVelho, jSem] } } }),
    });
    try {
      const r = await rodarDaemon('--conferir-pedidos', nuvem.url, {});
      expect(r.codigo).toBe(0);
      expect(nuvem.porIdPedidos).toEqual([[velho, semCliente]]);
      expect((await q(`select status from pedido_externo where id = $1`, [velho]))[0].status).toBe('cancelado');
      expect((await q(`select nome from cliente where id = $1`, [daLoja]))[0].nome).toBe('Nome da loja');
      expect((await q(`select cliente_id from pedido_externo where id = $1`, [semCliente]))[0]).toEqual({ cliente_id: null });
    } finally {
      nuvem.srv.close();
    }
  });

  it('o pedido ATRÁS do cursor do pull — que o pull nunca traria — vem pela conferência e vai para a telemetria; o cursor fica', async () => {
    const atras = await novoPedido('#301');
    const atras2 = await novoPedido('#302');
    const jAtras = await naNuvem(atras);
    const jAtras2 = await naNuvem(atras2);
    const adiante = await novoPedido('#303');
    await comoSync(`update pedido_externo set updated_at = now() + interval '1 minute' where id = $1`, [adiante]);
    const jAdiante = await naNuvem(adiante);
    await comoSync(`delete from pedido_externo where id = any($1::uuid[])`, [[atras, atras2, adiante]]);
    // O pull já passou da versão do #301 e do #302 (o eco do envio com o relógio adiantado, ou uma gravação que terminou
    // tarde na nuvem); o #303 está depois do cursor (o pull o traria no próximo ciclo). Dois atrás e um adiante: a conta
    // ao contrário daria 1.
    const [{ t }] = await q(`select (greatest($1::timestamptz, $2::timestamptz) + interval '5 seconds')::text as t`, [jAtras.__v, jAtras2.__v]);
    const cursores = JSON.stringify({ pedido_externo: `${t}|00000000-0000-0000-0000-000000000000` });
    await q(`insert into sync_state (chave, valor) values ('pull_cursores', $1) on conflict (chave) do update set valor = excluded.valor`, [cursores]);

    const nuvem = await nuvemDaConferencia({
      lista: () => daLista(jAtras, jAtras2, jAdiante),
      porId: () => ({ status: 201, corpo: { tabelas: { pedido_externo: [jAtras, jAtras2, jAdiante] } } }),
    });
    try {
      const r = await rodarDaemon('--conferir-pedidos', nuvem.url, {});
      expect(r.codigo).toBe(0);
      expect(r.saida).toMatch(/pedidos: 3 pedido\(s\) gravado\(s\) pela conferência rápida \(faltavam 3\) — 2 estava\(m\) ATRÁS do cursor do pull/);
      expect(nuvem.telemetria.map((x) => x.tipo)).toEqual(['pedido_fora_do_cursor']);
      expect(await existe(atras)).toBe(true);
      expect(await existe(atras2)).toBe(true);
      expect(await existe(adiante)).toBe(true);
      expect((await q(`select valor from sync_state where chave = 'pull_cursores'`))[0].valor).toBe(cursores);
    } finally {
      nuvem.srv.close();
    }
  });

  it('o pedido que a LOJA já tocou (aceitou, cancelou) nunca é pedido nem sobrescrito — nem com a versão da nuvem parecendo mais nova', async () => {
    // Na nuvem: os dois ainda "novo", com uma mudança (o pagamento) DEPOIS do que a loja fez — o relógio daqui atrasado.
    const aceito = await novoPedido('#501');
    const cancelado = await novoPedido('#502');
    await comoSync(`update pedido_externo set pago = true, updated_at = now() + interval '1 minute' where id = any($1::uuid[])`, [[aceito, cancelado]]);
    const jAceito = await naNuvem(aceito);
    const jCancelado = await naNuvem(cancelado);
    // Na loja: um aceito (venda feita) e um cancelado, com a data do relógio daqui (antes da versão da nuvem).
    const venda = randomUUID();
    await comoSync(`update pedido_externo set status = 'confirmado', comanda_id = $2, updated_at = now() where id = $1`, [aceito, venda]);
    await comoSync(`update pedido_externo set status = 'cancelado', updated_at = now() where id = $1`, [cancelado]);
    // Um que falta, para a conferência pedir alguma coisa — e a "nuvem" devolve os dois tocados junto (a corrida: a loja
    // agiu entre a comparação e a gravação; a trava tem de estar NA gravação).
    const falta = await novoPedido('#503');
    const jFalta = await naNuvem(falta);
    await comoSync(`delete from pedido_externo where id = $1`, [falta]);
    const nuvem = await nuvemDaConferencia({
      lista: () => daLista(jAceito, jCancelado, jFalta),
      porId: () => ({ status: 201, corpo: { tabelas: { pedido_externo: [jAceito, jCancelado, jFalta] } } }),
    });
    try {
      const r = await rodarDaemon('--conferir-pedidos', nuvem.url, {});
      expect(r.codigo).toBe(0);
      expect(nuvem.porIdPedidos).toEqual([[falta]]); // os tocados nem são pedidos
      expect(r.saida).toMatch(/pedidos: 1 pedido\(s\) gravado\(s\) pela conferência rápida \(faltavam 1\)/);
      // E, mesmo vindo na resposta, não são sobrescritos — senão "novo" de novo, aceito de novo: venda em dobro.
      const [a] = await q(`select status, comanda_id from pedido_externo where id = $1`, [aceito]);
      expect(a).toEqual({ status: 'confirmado', comanda_id: venda });
      expect((await q(`select status from pedido_externo where id = $1`, [cancelado]))[0].status).toBe('cancelado');
      expect(await existe(falta)).toBe(true);
    } finally {
      nuvem.srv.close();
    }
  });

  it('o PULL não devolve a "novo" o pedido que a loja já aceitou ou cancelou, mesmo com a data da nuvem "mais nova"; o cancelamento do canal desce', async () => {
    const aceito = await novoPedido('#601');
    const canceladoAqui = await novoPedido('#602');
    const aceito2 = await novoPedido('#603');
    // A nuvem: os três com versão 1 min depois do que a loja fez (o relógio daqui atrasado) — #601 e #602 ainda "novo" (a
    // nuvem não soube do aceite nem do cancelamento da loja); #603 cancelado pelo canal.
    await comoSync(`update pedido_externo set updated_at = now() + interval '1 minute' where id = any($1::uuid[])`, [[aceito, canceladoAqui, aceito2]]);
    const jAceito = await naNuvem(aceito);
    const jCanceladoAqui = await naNuvem(canceladoAqui);
    const jCancelamento = { ...(await naNuvem(aceito2)), status: 'cancelado' };
    const venda = randomUUID();
    await comoSync(`update pedido_externo set status = 'confirmado', comanda_id = $2, updated_at = now() where id = $1`, [aceito, venda]);
    await comoSync(`update pedido_externo set status = 'cancelado', updated_at = now() where id = $1`, [canceladoAqui]);
    await comoSync(`update pedido_externo set status = 'confirmado', comanda_id = $2, updated_at = now() where id = $1`, [aceito2, randomUUID()]);
    // Nada a enviar: o envio de toda tabela começa no fim (só o pull importa aqui).
    const futuro = '2999-01-01T00:00:00Z|ffffffff-ffff-ffff-ffff-ffffffffffff';
    const tabelas = (await q(`select distinct table_name from information_schema.columns
                               where table_schema = current_schema() and column_name = 'tenant_id'`)).map((t: any) => t.table_name);
    for (const t of tabelas) {
      await q(`insert into sync_state (chave, valor) values ($1, $2) on conflict (chave) do update set valor = excluded.valor`, [`push_${t}`, futuro]);
    }
    const nuvem = await nuvemDaConferencia({
      lista: () => ({ status: 200, corpo: { pedidos: [] } }),
      pull: () => ({ tabelas: { pedido_externo: [jAceito, jCanceladoAqui, jCancelamento] }, cursores: {} }),
    });
    try {
      const r = await rodarDaemon('--um-ciclo', nuvem.url, {});
      expect(r.saida).toMatch(/sync ok/);
      expect(r.codigo).toBe(0);
      // Pela data a nuvem venceria; voltar a "novo, sem venda" faria a loja aceitar de novo — venda em dobro.
      expect((await q(`select status, comanda_id from pedido_externo where id = $1`, [aceito]))[0]).toEqual({ status: 'confirmado', comanda_id: venda });
      expect((await q(`select status from pedido_externo where id = $1`, [canceladoAqui]))[0].status).toBe('cancelado');
      expect((await q(`select status from pedido_externo where id = $1`, [aceito2]))[0].status).toBe('cancelado'); // o canal cancelou: desce
    } finally {
      nuvem.srv.close();
    }
  });

  it('nuvem sem a rota (404, antes do deploy): não é erro — o pedido segue descendo pelo ciclo', async () => {
    const nuvem = await nuvemDaConferencia({ lista: () => ({ status: 404, corpo: { message: 'Cannot GET' } }) });
    try {
      const r = await rodarDaemon('--conferir-pedidos', nuvem.url, {});
      expect(r.codigo).toBe(0);
      expect(r.saida).toMatch(/"semRota":true/);
      expect(nuvem.porIdPedidos).toEqual([]);
    } finally {
      nuvem.srv.close();
    }
  });

  it('falha da nuvem no pedido pelo id: sai 1 com a causa e nada é gravado (a próxima conferência tenta de novo)', async () => {
    const id = await novoPedido('#401');
    const j = await naNuvem(id);
    await comoSync(`delete from pedido_externo where id = $1`, [id]);
    const nuvem = await nuvemDaConferencia({
      lista: () => daLista(j),
      porId: () => ({ status: 500, corpo: { message: 'erro interno' } }),
    });
    try {
      const r = await rodarDaemon('--conferir-pedidos', nuvem.url, { SYNC_FETCH_RETRIES: '1' });
      expect(r.codigo).toBe(1);
      expect(r.saida).toMatch(/pedidos pelo id HTTP 500/);
      expect(await existe(id)).toBe(false);
    } finally {
      nuvem.srv.close();
    }
  });
});
