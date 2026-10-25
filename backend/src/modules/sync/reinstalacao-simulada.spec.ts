import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import * as http from 'node:http';
import { AddressInfo } from 'node:net';
import { join } from 'node:path';
import 'reflect-metadata';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../../db/schema';
import { SyncService } from './sync.service';
import { idConfigDaLoja } from '../../common/id-deterministico';

/* eslint-disable @typescript-eslint/no-explicit-any */

// A REINSTALAÇÃO DO SERVIDOR DA LOJA, SIMULADA DE PONTA A PONTA (P2 do plano do dono de 25/10/2026: "quando o servidor é
// reinstalado não se percam os pareamentos e configs que a máquina já tem; em lojas com muitos equipamentos requer
// reconfiguração quase completa").
//
// Um banco de LOJA à parte (as migrations do instalador, EDGE_MODE=true) recebe um aparelho de cada tipo, já pareado e
// ligado, e as configurações da loja. Depois o caminho do instalador:
//   1. `sync-daemon --descarregar` (o daemon DE VERDADE) contra uma nuvem de teste que é o SyncService de verdade, sobre
//      o banco do teste (o papel da nuvem). Tem de sair 0: tudo na nuvem, nada que só exista aqui;
//   2. o banco da loja é apagado (os dados; a estrutura fica, como depois das migrations de uma instalação nova);
//   3. `sync-daemon --um-ciclo` até tudo voltar.
// O que os aparelhos e a tela leem (o segredo do pareamento, quando pareou, o PC, a impressora ligada, os perfis de
// cupom, as cores do KDS…) tem de voltar IGUAL. Se alguma coluna, filtro ou trava do sincronismo deixar algo para trás,
// este teste fica vermelho e nada é mesclado.
const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('reinstalacao-simulada.spec: sem TEST_PG_URL — PULADO');

const BACKEND = join(__dirname, '..', '..', '..');
const DAEMON = join(BACKEND, 'edge', 'sync-daemon.mjs');
const APLICAR = join(BACKEND, 'scripts', 'apply-all-local.mjs');

jest.setTimeout(600_000);

/** Roda um processo node ASSÍNCRONO (a nuvem de teste responde neste mesmo processo). */
function rodar(args: string[], env: Record<string, string>, ms = 300_000): Promise<{ codigo: number; saida: string }> {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, args, { cwd: BACKEND, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    let saida = '';
    p.stdout.on('data', (d) => (saida += d));
    p.stderr.on('data', (d) => (saida += d));
    const prazo = setTimeout(() => p.kill(), ms);
    p.on('close', (codigo) => {
      clearTimeout(prazo);
      resolve({ codigo: codigo ?? -1, saida });
    });
  });
}

descrever('reinstalação simulada do servidor da loja: pareamentos e configurações voltam iguais', () => {
  let nuvem: Pool;
  let loja: Pool;
  let lojaUrl = '';
  let nomeBanco = '';
  let srv: http.Server;
  let cloud = '';
  const T = randomUUID();
  const LOJA = randomUUID();
  const SERVIDOR = randomUUID();
  const TOKEN = `tok-reinst-${randomUUID()}`;
  const ctx = { tenantId: T, unidadeId: LOJA, equipamentoId: SERVIDOR, token: TOKEN };
  const rotasDesconhecidas: string[] = [];
  const errosDaNuvem: string[] = [];
  const ids: Record<string, string> = {};
  const umaHoraAtras = new Date(Date.now() - 3600_000).toISOString();

  const daemon = (modo: string) =>
    rodar([DAEMON, modo], {
      EDGE_DATABASE_URL: lojaUrl,
      DATABASE_URL: lojaUrl,
      CLOUD_API: cloud,
      SYNC_TOKEN: TOKEN,
      EDGE_UNIDADE_ID: LOJA,
      EDGE_MODE: 'true',
      SYNC_FETCH_RETRIES: '1',
    });

  // As colunas que os aparelhos e as telas leem — o que tem de voltar igual.
  const COLUNAS_EQUIPAMENTO = [
    'id', 'tipo', 'nome', 'token', 'unidade_id', 'ativo', 'fingerprint', 'segredo_hash', 'pareado_em', 'estacao_id',
    'impressora_padrao_id', 'pdv_main_id', 'conexao', 'dispositivo', 'papel', 'faz_cupom', 'faz_producao', 'vias',
    'imprime_ao_avancar', 'impressora_destino_id', 'setores_atendidos',
  ];
  const fotografia = async (pool: Pool) => ({
    equipamento: (await pool.query(`select ${COLUNAS_EQUIPAMENTO.join(', ')} from equipamento where tenant_id = $1 and tipo <> 'servidor_local' order by id`, [T])).rows,
    delivery_config: (await pool.query(`select id, unidade_id, cupom_layout, cupom_perfis, impressao_regras, auto_aceitar from delivery_config where tenant_id = $1 order by id`, [T])).rows,
    kds_cor_config: (await pool.query(`select id, unidade_id, verde_ate_min, amarelo_ate_min, usa_preparo, usa_entregue from kds_cor_config where tenant_id = $1 order by id`, [T])).rows,
  });

  beforeAll(async () => {
    nuvem = new Pool({ connectionString: URL_PG });
    // O banco da LOJA: um banco novo com as migrations do instalador (como o do CI e o de uma instalação nova).
    nomeBanco = `regem_reinst_${process.pid}_${Date.now()}`;
    await nuvem.query(`create database "${nomeBanco}"`);
    const u = new URL(URL_PG!);
    u.pathname = `/${nomeBanco}`;
    lojaUrl = u.toString();
    const mig = await rodar([APLICAR], { DATABASE_URL: lojaUrl, EDGE_MODE: 'true' });
    if (mig.codigo !== 0) throw new Error(`as migrations do banco da loja falharam:\n${mig.saida.slice(-2000)}`);
    loja = new Pool({ connectionString: lojaUrl });

    // A NUVEM: a empresa, a loja e o servidor da loja (a credencial do sincronismo).
    await nuvem.query(`insert into empresa (id, nome) values ($1, 'Teste reinstalação simulada')`, [T]);
    await nuvem.query(`insert into unidade (id, tenant_id, nome, updated_at) values ($1, $2, 'Loja Centro', $3)`, [LOJA, T, umaHoraAtras]);
    await nuvem.query(`insert into equipamento (id, tenant_id, unidade_id, tipo, nome, token) values ($1, $2, $3, 'servidor_local', 'Servidor', $4)`, [SERVIDOR, T, LOJA, TOKEN]);

    // A LOJA: a empresa e a loja (como se tivessem descido), e os aparelhos e configurações feitos nela.
    await loja.query(`insert into empresa (id, nome) values ($1, 'Teste reinstalação simulada')`, [T]);
    await loja.query(`insert into unidade (id, tenant_id, nome, updated_at) values ($1, $2, 'Loja Centro', $3)`, [LOJA, T, umaHoraAtras]);
    const equipar = async (chave: string, tipo: string, nome: string, extra: Record<string, any> = {}) => {
      const cols: Record<string, any> = { id: randomUUID(), tenant_id: T, unidade_id: LOJA, tipo, nome, token: `tok-${chave}-${randomUUID()}`, ...extra };
      const nomes = Object.keys(cols);
      await loja.query(`insert into equipamento (${nomes.join(', ')}) values (${nomes.map((_, i) => `$${i + 1}`).join(', ')})`, Object.values(cols));
      ids[chave] = cols.id;
      return cols.id as string;
    };
    const pareado = (h: string) => ({ segredo_hash: h, pareado_em: umaHoraAtras, updated_at: umaHoraAtras });
    const estacao = await equipar('estacao', 'estacao_impressao', 'PC do delivery', { fingerprint: 'PC-DELIVERY', ...pareado('h-estacao') });
    const impressora = await equipar('impressora', 'impressora', 'Caixa delivery', {
      estacao_id: estacao, conexao: 'local', dispositivo: 'EPSON TM-T20', papel: 'cupom', faz_cupom: true, updated_at: umaHoraAtras,
    });
    const cozinha = await equipar('cozinha', 'impressora', 'Cozinha', { conexao: 'rede', papel: 'producao', faz_producao: true, vias: 2, updated_at: umaHoraAtras });
    const caixa = await equipar('caixa', 'pdv', 'Caixa 1', { impressora_padrao_id: impressora, ...pareado('h-caixa') });
    await equipar('garcom', 'salao', 'Garçom 2', { pdv_main_id: caixa, ...pareado('h-garcom') });
    await equipar('kds', 'kds', 'KDS chapa', { imprime_ao_avancar: true, impressora_destino_id: cozinha, updated_at: umaHoraAtras });
    await equipar('tv', 'tela_senhas', 'TV do balcão', pareado('h-tv'));
    await equipar('baixa', 'ponto_baixa', 'Ponto de baixa da câmara', { updated_at: umaHoraAtras });
    // As configurações da loja (linha única por empresa e loja, id pela chave — mig 339).
    await loja.query(
      `insert into delivery_config (id, tenant_id, unidade_id, auto_aceitar, cupom_layout, cupom_perfis, impressao_regras, updated_at)
       values ($1, $2, $3, true, $4, $5, $6, $7)`,
      [
        idConfigDaLoja('delivery_config', T, LOJA), T, LOJA,
        JSON.stringify({ cabecalho: 'Loja Centro — teste', rodape: 'Volte sempre' }),
        JSON.stringify({ caixa: { campos: [{ key: 'telefone', visivel: true, negrito: true }] } }),
        JSON.stringify({ delivery: [{ impressora: impressora, vias: ['caixa', 'producao'] }] }),
        umaHoraAtras,
      ],
    );
    await loja.query(
      `insert into kds_cor_config (id, tenant_id, unidade_id, verde_ate_min, amarelo_ate_min, usa_preparo, usa_entregue, updated_at)
       values ($1, $2, $3, 7, 15, false, true, $4)`,
      [idConfigDaLoja('kds_cor_config', T, LOJA), T, LOJA, umaHoraAtras],
    );

    // A NUVEM DE TESTE: as rotas do sincronismo no SyncService DE VERDADE (sobre o banco do teste); as rotas de saúde
    // do servidor da loja respondem vazio.
    const svc = new SyncService(drizzle(nuvem, { schema }) as any);
    srv = http.createServer(async (req, res) => {
      const url = new URL(req.url ?? '/', 'http://x');
      const caminho = url.pathname.replace(/^\/api\/v1/, '');
      let corpo = '';
      for await (const c of req) corpo += c;
      const json = (status: number, o: unknown) => {
        res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(o ?? {}));
      };
      const h = (n: string) => (req.headers[n] as string | undefined) ?? undefined;
      try {
        if (caminho.startsWith('/sync/') && h('x-sync-token') !== TOKEN) return json(401, { message: 'Token de sync inválido.' });
        if (req.method === 'POST' && caminho === '/sync/push') {
          return json(201, await svc.push(ctx as any, JSON.parse(corpo || '{}').lotes, { seq: h('x-sync-seq'), ts: h('x-sync-ts'), sig: h('x-sync-sig') }));
        }
        if (req.method === 'GET' && caminho === '/sync/pull') {
          let cursores: Record<string, string> | undefined;
          try {
            const c = JSON.parse(url.searchParams.get('cursores') ?? '');
            if (c && typeof c === 'object' && !Array.isArray(c)) cursores = c;
          } catch { /* sem cursores: caminho antigo */ }
          return json(200, await svc.pull(T, url.searchParams.get('desde') ?? undefined, cursores, LOJA, SERVIDOR));
        }
        if (req.method === 'GET' && caminho === '/sync/snapshot') return void (await svc.snapshot(T, res as any, LOJA));
        if (caminho === '/sync/pedidos-pendentes') {
          return json(200, req.method === 'GET' ? await svc.pedidosPendentes(T, LOJA) : await svc.pedidosPorId(T, JSON.parse(corpo || '{}').ids ?? [], LOJA));
        }
        if (caminho.startsWith('/edge/')) return json(200, caminho.startsWith('/edge/comandos') ? [] : {});
        rotasDesconhecidas.push(`${req.method} ${caminho}`);
        return json(404, { message: 'rota desconhecida' });
      } catch (e: any) {
        const status = typeof e?.getStatus === 'function' ? e.getStatus() : 500;
        if (status >= 500) errosDaNuvem.push(String(e?.stack ?? e));
        return json(status, typeof e?.getResponse === 'function' ? e.getResponse() : { message: String(e?.message ?? e) });
      }
    });
    await new Promise<void>((ok) => srv.listen(0, '127.0.0.1', () => ok()));
    cloud = `http://127.0.0.1:${(srv.address() as AddressInfo).port}/api/v1`;
  });

  afterAll(async () => {
    if (srv?.listening) await new Promise((ok) => srv.close(ok));
    await loja?.end().catch(() => undefined);
    if (nuvem) {
      await nuvem.query('delete from sync_push_lock where equipamento_id = $1', [SERVIDOR]).catch(() => undefined);
      for (const t of ['kds_cor_config', 'delivery_config', 'sync_exclusao'])
        await nuvem.query(`delete from ${t} where tenant_id = $1`, [T]).catch(() => undefined);
      await nuvem.query('update equipamento set estacao_id = null, pdv_main_id = null, impressora_padrao_id = null, impressora_destino_id = null where tenant_id = $1', [T]).catch(() => undefined);
      await nuvem.query('delete from equipamento where tenant_id = $1', [T]).catch(() => undefined);
      await nuvem.query('delete from unidade where tenant_id = $1', [T]).catch(() => undefined);
      await nuvem.query('delete from empresa where id = $1', [T]).catch(() => undefined);
      if (nomeBanco) await nuvem.query(`drop database if exists "${nomeBanco}" with (force)`).catch(() => undefined);
      await nuvem.end();
    }
  });

  it('descarrega tudo, apaga o banco da loja e o sincronismo devolve cada pareamento e configuração igual', async () => {
    const antes = await fotografia(loja);
    expect(antes.equipamento).toHaveLength(8);

    // 1. O --descarregar do instalador: sai 0 (tudo na nuvem; nada que só exista aqui).
    const desc = await daemon('--descarregar');
    if (desc.codigo !== 0) throw new Error(`--descarregar saiu ${desc.codigo}:\n${desc.saida.slice(-3000)}\nerros da nuvem: ${errosDaNuvem.join('\n')}`);
    const naNuvem = await fotografia(nuvem);
    expect(naNuvem.equipamento.map((e: any) => e.id)).toEqual(antes.equipamento.map((e: any) => e.id));

    // 2. A reinstalação apaga o banco: os dados da loja (a estrutura fica, como depois das migrations).
    const tabelas: string[] = (
      await loja.query(`select distinct table_name as t from information_schema.columns where table_schema = current_schema() and column_name = 'tenant_id'`)
    ).rows.map((r: any) => r.t);
    await loja.query(`truncate table ${['empresa', ...tabelas].map((t) => `"${t}"`).join(', ')} cascade`);
    await loja.query(`truncate table sync_state`);
    expect((await fotografia(loja)).equipamento).toHaveLength(0);

    // 3. O sincronismo traz de volta (alguns ciclos: as tabelas descem em ordem, pais antes dos filhos).
    let depois = await fotografia(loja);
    const saidas: string[] = [];
    for (let i = 0; i < 4 && JSON.stringify(depois) !== JSON.stringify(antes); i++) {
      const c = await daemon('--um-ciclo');
      saidas.push(`ciclo ${i + 1} (código ${c.codigo}):\n${c.saida.slice(-1500)}`);
      depois = await fotografia(loja);
    }
    if (JSON.stringify(depois) !== JSON.stringify(antes)) console.error(`${saidas.join('\n')}\nerros da nuvem: ${errosDaNuvem.join('\n')}`);
    expect(depois.equipamento).toEqual(antes.equipamento);
    expect(depois.delivery_config).toEqual(antes.delivery_config);
    expect(depois.kds_cor_config).toEqual(antes.kds_cor_config);
    expect(errosDaNuvem).toEqual([]);
    expect(rotasDesconhecidas).toEqual([]);
  });
});
