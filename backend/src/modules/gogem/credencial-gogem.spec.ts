import { randomBytes, randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { EquipamentoService } from '../equipamento/equipamento.service';
import { SyncTokenGuard } from '../sync/sync-token.guard';
import { CatalogoSyncController } from '../produto/catalogo-sync.controller';
import { CLOUD_ONLY } from '../../common/cloud-only.decorator';
import { GogemAvisoService } from './gogem-aviso.service';
import { GogemPublishService, MSG_PUBLICAR_SEM_REGISTRO } from './gogem-publish.service';
import { GogemRepasseController } from './gogem-repasse.controller';
import { MSG_GOGEM_SEM_REGISTRO, gravarAvisoCancelamentoTotem } from './aviso-gogem';

/* eslint-disable @typescript-eslint/no-explicit-any */

// A CREDENCIAL DO GOGEM (mig 290, ERR-108) — contra o Postgres de verdade.
//
// O GoGeM aceitava UM token por empresa: o da integração dele. O piloto tem 6 `servidor_local`, e o
// Regem pegava "um qualquer" para avisar o cancelamento — 5 de 6 davam 401, e o estorno do
// cartão/PIX não era pedido. O próprio GoGeM se identifica (`X-Integrador: gogem`) e marca o
// equipamento dele (a marca segue valendo para a origem das vendas — `equipamentoDoGogem`).
//
// Desde a fase 4 (24/11/2026, P-7) o aviso e o "Publicar" saem SÓ assinados, pelo registro do GoGeM
// (`aviso-assinado.spec.ts`): o token marcado não basta, e sem registro nada sai — nunca se chuta.

const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('credencial-gogem.spec: sem TEST_PG_URL — PULADO');

jest.setTimeout(60_000);

describe('a rota que recebe o aviso da loja é só da nuvem', () => {
  it('@CloudOnly — no servidor da loja ela não responde (lá o aviso sai, não entra)', () => {
    expect(Reflect.getMetadata(CLOUD_ONLY, GogemRepasseController)).toBe(true);
  });
});

descrever('a credencial do GoGeM (Postgres real)', () => {
  const pool = new Pool({ connectionString: URL_PG });
  const db = drizzle(pool) as any;
  const auditorias: any[] = [];
  const auditoria = { registrar: async (a: any) => void auditorias.push(a) } as any;
  const equip = new EquipamentoService(db, auditoria);
  const guard = new SyncTokenGuard(equip);
  const avisos = new GogemAvisoService(db, auditoria);
  const publicar = new GogemPublishService(db);
  const empresas: string[] = [];
  const q = (s: string, p: any[] = []) => pool.query(s, p).then((r) => r.rows);
  const edgeOriginal = process.env.EDGE_MODE;

  let chamadas: Array<{ url: string; token: string; corpo: any }> = [];
  let espiao: jest.SpyInstance;

  beforeAll(() => {
    delete process.env.EDGE_MODE; // a marca e o envio ao GoGeM são da NUVEM
    espiao = jest.spyOn(global, 'fetch').mockImplementation(async (url: any, init: any) => {
      const h = new Headers(init?.headers ?? {});
      chamadas.push({ url: String(url), token: h.get('x-sync-token') ?? '', corpo: init?.body ? JSON.parse(String(init.body)) : null });
      const corpo = String(url).includes('/publicar')
        ? { alterados: 3 }
        : { status: 'cancelado', estorno: { feito: true, meio: 'pix', valorCentavos: 2000, mensagem: 'ok' } };
      return new Response(JSON.stringify(corpo), { status: 200, headers: { 'content-type': 'application/json' } });
    });
  });
  afterAll(async () => {
    espiao?.mockRestore();
    if (edgeOriginal !== undefined) process.env.EDGE_MODE = edgeOriginal;
    if (empresas.length) await pool.query('delete from empresa where id = any($1::uuid[])', [empresas]);
    await pool.end();
  }, 120_000);
  beforeEach(() => {
    chamadas = [];
    auditorias.length = 0;
  });

  async function servidor(t: string, u: string | null, o: { push?: boolean; diasAtras: number; integrador?: string; vistoHorasAtras?: number }) {
    const token = randomBytes(24).toString('hex');
    const [e] = await q(
      `insert into equipamento (tenant_id, unidade_id, nome, tipo, token, ativo, integrador, integrador_visto_em,
                                last_push_ts, last_push_seq, created_at)
       values ($1,$2,'Servidor','servidor_local',$3,true,$4,
               case when $5::int is null then null else now() - make_interval(hours => $5::int) end,
               case when $6 then now() - interval '2 days' end, case when $6 then 42 end,
               now() - make_interval(days => $7::int))
       returning id`,
      [t, u, token, o.integrador ?? null, o.vistoHorasAtras ?? null, !!o.push, o.diasAtras],
    );
    return { id: e.id as string, token };
  }

  /** O piloto: servidores de loja, sobras que nunca sincronizaram e o GoGeM — nenhum marcado ainda. */
  async function piloto() {
    const t = (await q(`insert into empresa (nome) values ('Teste credencial GoGeM') returning id`))[0].id as string;
    empresas.push(t);
    const u = (await q(`insert into unidade (tenant_id, nome) values ($1,'Mister Burguer Steakhouse') returning id`, [t]))[0].id;
    const s = {
      lojaTeste: await servidor(t, u, { push: true, diasAtras: 20 }),
      rodrigo: await servidor(t, u, { push: true, diasAtras: 30 }),
      rede: await servidor(t, null, { push: true, diasAtras: 40 }),
      sobra1: await servidor(t, u, { diasAtras: 10 }),
      gogem: await servidor(t, u, { diasAtras: 12 }),
      sobra2: await servidor(t, u, { diasAtras: 1 }),
    };
    return { t, u, s };
  }

  const chamarGuard = (headers: Record<string, string>) => {
    const req: any = { headers, originalUrl: '/api/v1/sync/catalogo' };
    // A rota de verdade (o catálogo): a credencial de integrador só passa nas rotas dela (@AceitaIntegrador).
    return guard.canActivate({
      switchToHttp: () => ({ getRequest: () => req }),
      getHandler: () => CatalogoSyncController.prototype.catalogo,
      getClass: () => CatalogoSyncController,
    } as any);
  };
  const equipamentoDe = async (id: string) => (await q(`select * from equipamento where id = $1`, [id]))[0];
  const aviso = async (t: string, u: string | null) => {
    const chave = `totem-${randomUUID()}`;
    const r = await gravarAvisoCancelamentoTotem(db, {
      tenantId: t,
      unidadeId: u,
      idempotencyKey: chave,
      regemComandaId: randomUUID(),
      motivo: 'Cliente desistiu',
      canceladoPor: 'pessoa',
      referenciaTipo: 'comanda',
      referenciaId: randomUUID(),
    });
    return { id: r.id as string, chave };
  };
  const avisoPorId = async (id: string) => (await q(`select * from aviso_integracao where id = $1`, [id]))[0];

  // ── a marca ──────────────────────────────────────────────────────────────────────────────

  it('sem o registro do GoGeM: o aviso ESPERA — nenhuma chamada com um servidor_local qualquer', async () => {
    const p = await piloto();
    const a = await aviso(p.t, p.u);

    const r = await avisos.enviarAgora(a.id);

    expect(chamadas).toHaveLength(0); // antes: "o primeiro servidor_local" → 401 no GoGeM
    expect(r).toEqual(MSG_GOGEM_SEM_REGISTRO);
    const l = await avisoPorId(a.id);
    expect(l.status).toBe('aguardando_integracao');
    expect(l.ultimo_erro).toContain('não registrou o endereço dos avisos');
    expect(auditorias.map((x) => x.acao)).toContain('aviso_gogem_sem_integracao');
  });

  it('o GoGeM se identifica: o equipamento dele fica MARCADO; desde a fase 4 o aviso ainda espera o registro', async () => {
    const p = await piloto();
    const a = await aviso(p.t, p.u);
    await avisos.enviarAgora(a.id); // espera: sem registro

    await chamarGuard({ 'x-sync-token': p.s.gogem.token, 'x-integrador': 'gogem' });

    const g = await equipamentoDe(p.s.gogem.id);
    expect(g.integrador).toBe('gogem');
    expect(g.integrador_visto_em).not.toBeNull();
    expect(auditorias.map((x) => x.acao)).toContain('marcou_credencial_integracao');

    // Só o aviso DESTE teste: o job (`rodarFila`) varre a fila de todas as empresas, e no CI as
    // specs dividem o banco em paralelo (LIC-084). O token marcado não abre o caminho antigo.
    await avisos.enviarAgora(a.id);
    expect(chamadas.filter((c) => c.corpo?.idempotencyKey === a.chave)).toHaveLength(0);
    expect((await avisoPorId(a.id)).status).toBe('aguardando_integracao');
  });

  it('servidor de LOJA (já sincronizou) não vira credencial pelo cabeçalho', async () => {
    const p = await piloto();
    await chamarGuard({ 'x-sync-token': p.s.lojaTeste.token, 'x-integrador': 'gogem' });
    expect((await equipamentoDe(p.s.lojaTeste.id)).integrador).toBeNull();
  });

  it('cabeçalho de outro integrador, ou no servidor da loja: nada muda', async () => {
    const p = await piloto();
    await chamarGuard({ 'x-sync-token': p.s.sobra1.token, 'x-integrador': 'outro' });
    process.env.EDGE_MODE = 'true';
    try {
      await chamarGuard({ 'x-sync-token': p.s.sobra2.token, 'x-integrador': 'gogem' });
    } finally {
      delete process.env.EDGE_MODE;
    }
    expect((await equipamentoDe(p.s.sobra1.id)).integrador).toBeNull();
    expect((await equipamentoDe(p.s.sobra2.id)).integrador).toBeNull();
  });

  it('o GoGeM chama a toda hora: grava só quando muda — o "visto" se renova de hora em hora', async () => {
    const t = (await q(`insert into empresa (nome) values ('Visto') returning id`))[0].id as string;
    empresas.push(t);
    const g = await servidor(t, null, { diasAtras: 3, integrador: 'gogem', vistoHorasAtras: 0 });
    const antes = (await equipamentoDe(g.id)).integrador_visto_em;
    await chamarGuard({ 'x-sync-token': g.token, 'x-integrador': 'gogem' });
    expect((await equipamentoDe(g.id)).integrador_visto_em).toEqual(antes); // nada gravado

    await q(`update equipamento set integrador_visto_em = now() - interval '2 hours' where id = $1`, [g.id]);
    await chamarGuard({ 'x-sync-token': g.token, 'x-integrador': 'gogem' });
    const depois = new Date((await equipamentoDe(g.id)).integrador_visto_em).getTime();
    expect(Date.now() - depois).toBeLessThan(60_000);
    expect(auditorias.filter((x) => x.acao === 'marcou_credencial_integracao')).toHaveLength(0); // já era dele
  });

  // ── o "Publicar" (o envio assinado, com conexão e sem, está em `aviso-assinado.spec.ts`) ───────────

  it('"Publicar no GoGeM" sem o registro: erro claro, mesmo com o token antigo marcado — nada sai (fase 4)', async () => {
    const p = await piloto();
    await expect(publicar.publicar(p.t)).rejects.toThrow(MSG_PUBLICAR_SEM_REGISTRO);
    await q(`update equipamento set integrador = 'gogem', integrador_visto_em = now() where id = $1`, [p.s.gogem.id]);
    await expect(publicar.publicar(p.t)).rejects.toThrow(MSG_PUBLICAR_SEM_REGISTRO);
    expect(chamadas).toHaveLength(0);
  });

  // ── o aviso que vem do servidor da loja (o envio com o registro está em `aviso-assinado.spec.ts`) ───

  it('sem o registro do GoGeM, a nuvem aceita o aviso da loja e ele espera — a loja não insiste', async () => {
    const p = await piloto();
    await q(`update equipamento set integrador = 'gogem', integrador_visto_em = now() where id = $1`, [p.s.gogem.id]);
    const sync = { tenantId: p.t, unidadeId: p.u, equipamentoId: p.s.lojaTeste.id, token: p.s.lojaTeste.token };
    const r = await avisos.receberDaLoja(sync, { avisoId: randomUUID(), chave: `totem-${randomUUID()}`, corpo: {} });
    expect(r.aceito).toBe(true);
    expect(r.estorno).toEqual(MSG_GOGEM_SEM_REGISTRO);
    expect((await avisoPorId(r.avisoId)).status).toBe('aguardando_integracao');
    expect(chamadas).toHaveLength(0);
  });

  it('id de aviso que já é de OUTRA empresa: recusado, e nada alheio é tocado', async () => {
    const a = await piloto();
    const b = await piloto();
    const deB = await aviso(b.t, b.u);
    const sync = { tenantId: a.t, unidadeId: a.u, equipamentoId: a.s.lojaTeste.id, token: a.s.lojaTeste.token };
    await expect(
      avisos.receberDaLoja(sync, { avisoId: deB.id, chave: `totem-${randomUUID()}`, corpo: {} }),
    ).rejects.toThrow('identificador já está em uso');
    expect((await avisoPorId(deB.id)).tenant_id).toBe(b.t);
    expect(chamadas).toHaveLength(0);
  });
});
