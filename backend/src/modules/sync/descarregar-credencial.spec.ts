import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
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
  // `sync_state` é a tabela de estado do daemon (no banco da loja). O teste mexe em três chaves;
  // o que havia antes volta no fim.
  const CHAVES = ['push_seq', 'push_categoria_produto', 'relogio_desvio_s'];
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
