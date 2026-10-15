import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../../db/schema';
import { SyncService, ausenteDemais } from './sync.service';
import { LicencaService } from '../licenca/licenca.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

// ERR-233: cursor velho de tabela parada (cadastro sem mudança há 30 dias) mandava
// "reinicializar" a cada pull de um servidor que sincroniza todo minuto — restauração em laço,
// batida atrasada e a nuvem assumindo os pedidos da loja. Quem decide agora é o status do
// servidor; o cursor só levanta a suspeita. Postgres real (a decisão é uma consulta).
const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('reinicializar-pelo-status.spec: sem TEST_PG_URL — PULADO');

jest.setTimeout(60_000);

const diasAtras = (d: number) => new Date(Date.now() - d * 86400000).toISOString();
// O servidor em dia: o dado mais novo é de agora há pouco; a tabela de cadastro está parada.
const HOJE = diasAtras(0.01);
const PARADA = { fornecedor: `${diasAtras(60)}|${randomUUID()}` };

describe('ausenteDemais — o status do servidor decide', () => {
  it('ciclo completo há pouco: não recomeça', () => {
    expect(ausenteDemais({ recebidoEm: new Date(), fimDeCicloEm: HOJE }, HOJE)).toBe(false);
  });
  it('último ciclo completo há 40 dias: recomeça', () => {
    expect(ausenteDemais({ recebidoEm: diasAtras(40) }, diasAtras(40))).toBe(true);
  });
  it('batida antecipada agora, mas o último ciclo completo foi há 40 dias: recomeça', () => {
    expect(ausenteDemais({ recebidoEm: new Date(), fimDeCicloEm: diasAtras(40) }, diasAtras(40))).toBe(true);
  });
  it('sync falhando há 40 dias sem trazer nada: recomeça', () => {
    const st = { recebidoEm: new Date(), fimDeCicloEm: HOJE, syncFalhandoDesde: diasAtras(40) };
    expect(ausenteDemais(st, diasAtras(41))).toBe(true);
  });
  it('falha há 40 dias só no envio (o pull segue trazendo dado): não recomeça', () => {
    const st = { recebidoEm: new Date(), fimDeCicloEm: HOJE, syncFalhandoDesde: diasAtras(40) };
    expect(ausenteDemais(st, HOJE)).toBe(false);
  });
  it('falha há 2 dias: não recomeça', () => {
    const st = { recebidoEm: new Date(), fimDeCicloEm: HOJE, syncFalhandoDesde: diasAtras(2) };
    expect(ausenteDemais(st, diasAtras(3))).toBe(false);
  });
  it('texto que não é data na saúde não derruba nem decide', () => {
    expect(ausenteDemais({ recebidoEm: new Date(), fimDeCicloEm: 'ontem', syncFalhandoDesde: 'x' }, HOJE)).toBe(false);
  });
});

descrever('pull — "reinicializar" pelo status do servidor (Postgres)', () => {
  let pool: Pool;
  let svc: SyncService;
  let licenca: LicencaService;
  const q = (s: string, p: any[] = []) => pool.query(s, p);
  const criadas: string[] = [];

  const empresa = async () => {
    const t = randomUUID();
    await q(`insert into empresa (id, nome) values ($1,'teste reinicializar')`, [t]);
    criadas.push(t);
    return t;
  };
  const status = async (t: string, recebido: string, saude: any = null) => {
    const eq = randomUUID();
    await q(
      `insert into edge_status (equipamento_id, tenant_id, versao, estado, saude, recebido_em)
       values ($1,$2,'1.30.3','sync_ok',$3::jsonb,$4)`,
      [eq, t, saude ? JSON.stringify(saude) : null, recebido],
    );
    return eq;
  };
  // Histórico amostrado com linha recente: a batida só atualiza o status (é o caminho de
  // 29 em cada 30 minutos na produção) e o teste não depende do formato do histórico.
  const historicoRecente = (t: string) =>
    q('insert into edge_heartbeat (tenant_id, unidade_id, recebido_em) values ($1, null, now())', [t]);
  const pull = (t: string, eq: string | null, desde = HOJE, cursores: Record<string, string> = PARADA) =>
    svc.pull(t, desde, cursores, null, eq) as Promise<any>;

  beforeAll(async () => {
    pool = new Pool({ connectionString: URL_PG });
    // Só-nuvem, ausente no banco do CI (montado como servidor local): a batida grava nela.
    await q(`create table if not exists edge_heartbeat (id uuid primary key default gen_random_uuid(),
             ativacao_id uuid, tenant_id uuid, unidade_id uuid, versao text, estado text, ultimo_sync timestamptz,
             disco_livre_mb integer, clientes integer, fingerprint text, saude jsonb, erro text,
             recebido_em timestamptz not null default now())`);
    const db = drizzle(pool, { schema }) as any;
    svc = new SyncService(db);
    licenca = new LicencaService(db, {} as any, {} as any);
  });
  afterAll(async () => {
    if (!pool) return;
    for (const t of criadas) {
      await q('delete from edge_status where tenant_id = $1', [t]).catch(() => {});
      await q('delete from edge_heartbeat where tenant_id = $1', [t]).catch(() => {});
      await q('delete from empresa where id = $1', [t]).catch(() => {});
    }
    await pool.end();
  });

  it('a loja do ERR-233: sincroniza todo minuto, cadastro parado há 60 dias → NÃO recomeça', async () => {
    const t = await empresa();
    const eq = await status(t, new Date().toISOString(), { fimDeCicloEm: new Date().toISOString() });
    expect((await pull(t, eq)).reinicializar).toBeUndefined();
  });

  it('servidor sem carimbo de ciclo ainda (antes deste deploy), batendo agora → NÃO recomeça', async () => {
    const t = await empresa();
    const eq = await status(t, new Date().toISOString(), { servicos: { pg: 'Running' } });
    expect((await pull(t, eq)).reinicializar).toBeUndefined();
  });

  it('desligado há 40 dias (a batida do fim do ciclo vem depois do pull) → recomeça', async () => {
    const t = await empresa();
    const eq = await status(t, diasAtras(40), { fimDeCicloEm: diasAtras(40) });
    expect((await pull(t, eq, diasAtras(40))).reinicializar).toBe(true);
  });

  it('volta de 40 dias sem internet: a batida antecipada chega antes do pull → recomeça mesmo assim', async () => {
    const t = await empresa();
    const eq = await status(t, diasAtras(40), { fimDeCicloEm: diasAtras(40), syncFalhandoDesde: null });
    // A batida antecipada não leva saúde: atualiza o recebido_em e mantém o carimbo antigo.
    await historicoRecente(t);
    await licenca.heartbeat(t, null, { versao: '1.30.3', estado: 'sync_ok' }, eq);
    const r = (await q('select recebido_em, saude from edge_status where equipamento_id = $1', [eq])).rows[0];
    expect(Date.now() - new Date(r.recebido_em).getTime()).toBeLessThan(60_000);
    expect(Date.now() - new Date(r.saude.fimDeCicloEm).getTime()).toBeGreaterThan(39 * 86400000);
    expect((await pull(t, eq, diasAtras(40))).reinicializar).toBe(true);
  });

  it('a batida do fim do ciclo carimba a hora → o pull seguinte NÃO recomeça', async () => {
    const t = await empresa();
    const eq = await status(t, diasAtras(40), { fimDeCicloEm: diasAtras(40) });
    await historicoRecente(t);
    await licenca.heartbeat(t, null, { versao: '1.30.3', estado: 'sync_ok', saude: { syncFalhandoDesde: null } }, eq);
    const r = (await q(`select saude->>'fimDeCicloEm' as fim from edge_status where equipamento_id = $1`, [eq])).rows[0];
    expect(Date.now() - new Date(r.fim).getTime()).toBeLessThan(60_000);
    expect((await pull(t, eq)).reinicializar).toBeUndefined();
  });

  it('sync falhando há 40 dias sem trazer nada → recomeça', async () => {
    const t = await empresa();
    const eq = await status(t, new Date().toISOString(), {
      fimDeCicloEm: new Date().toISOString(),
      syncFalhandoDesde: diasAtras(40),
    });
    expect((await pull(t, eq, diasAtras(41))).reinicializar).toBe(true);
  });

  it('servidor sem status (nunca bateu) → regra antiga: cursor velho recomeça', async () => {
    const t = await empresa();
    expect((await pull(t, randomUUID())).reinicializar).toBe(true);
    expect((await pull(t, null)).reinicializar).toBe(true);
  });

  it('cursores em dia nem consultam o status (status velho não força nada)', async () => {
    const t = await empresa();
    const eq = await status(t, diasAtras(40), { fimDeCicloEm: diasAtras(40) });
    expect((await pull(t, eq, HOJE, { fornecedor: `${HOJE}|${randomUUID()}` })).reinicializar).toBeUndefined();
  });

  it('edge novo pedindo tudo (época) nunca recomeça', async () => {
    const t = await empresa();
    expect((await pull(t, null, '1970-01-01T00:00:00Z', {})).reinicializar).toBeUndefined();
  });
});
