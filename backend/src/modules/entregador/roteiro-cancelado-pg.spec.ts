import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../../db/schema';
import { EntregadorService } from './entregador.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

// PEDIDO CANCELADO SAI DO ROTEIRO DO ENTREGADOR (ERR-338, 31/10/2026): cancelar não mexia na saída — o cancelado ficava
// como parada pendente que não finaliza ("precisa estar em rota"), a saída nunca fechava e o entregador ficava preso, sem
// o botão da fila (havia 6 cancelados ainda presos a entregador no banco). A tabela das saídas é só da nuvem: o teste
// cria só ela, com os comandos da 210 (o banco do CI é o de uma loja).
const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('roteiro-cancelado-pg.spec: sem TEST_PG_URL — PULADO');
jest.setTimeout(60_000);

const MIG_210 = join(__dirname, '../../../../database/migrations/210_entregador_saida_rastreio.sql');
const daTabelaDeSaidas = () =>
  readFileSync(MIG_210, 'utf8')
    .split(';')
    .map((s) => s.trim())
    .filter((s) => /entregador_saida/.test(s) && !/alter table (entregador_config|pedido_externo)/i.test(s));

descrever('roteiro do entregador com pedido cancelado (Postgres)', () => {
  const pool = new Pool({ connectionString: URL_PG });
  const db = drizzle(pool, { schema }) as any;
  const q = async (s: string, p: any[] = []) => (await pool.query(s, p)).rows;
  const links: string[] = [];
  const cliente: any = { enviarEventoWebhook: async (_t: string, p: any) => void links.push(p.telefone) };
  const delivery: any = { marcarEntregue: jest.fn(async () => ({})), confirmarEntregaComCodigo: jest.fn() };
  const svc: any = new EntregadorService(db, delivery, cliente);
  const empresas: string[] = [];

  beforeAll(async () => {
    for (const s of daTabelaDeSaidas()) await pool.query(s);
  });
  beforeEach(() => {
    links.length = 0;
  });
  afterAll(async () => {
    if (empresas.length) {
      await pool.query('delete from pedido_externo where tenant_id = any($1::uuid[])', [empresas]).catch(() => {});
      await pool.query('delete from entregador_saida where tenant_id = any($1::uuid[])', [empresas]).catch(() => {});
      await pool.query('delete from empresa where id = any($1::uuid[])', [empresas]).catch(() => {});
    }
    await pool.end();
  });

  /** Uma loja com uma saída em rota e N paradas (status de cada uma). */
  async function saidaCom(status: string[]) {
    const t = (await q(`insert into empresa (nome) values ('teste roteiro cancelado') returning id`))[0].id as string;
    empresas.push(t);
    const colaborador = randomUUID();
    const saida = (await q(`insert into entregador_saida (tenant_id, colaborador_id, status, total_paradas) values ($1,$2,'em_rota',$3) returning id`, [t, colaborador, status.length]))[0].id as string;
    const ids: string[] = [];
    for (let i = 0; i < status.length; i++) {
      const id = randomUUID();
      ids.push(id);
      await q(
        `insert into pedido_externo (id, tenant_id, canal, tipo, status, saida_id, ordem_parada, cliente_telefone, rastreio_token)
         values ($1,$2,'cardapio','entrega',$3,$4,$5,$6,$7)`,
        [id, t, status[i], saida, i + 1, `2198765000${i}`, `rt-${i}-${id.slice(0, 6)}`],
      );
    }
    const user = { tenantId: t, colaboradorId: colaborador, nome: 'Ana', funcaoNome: 'Entregador' };
    return { t, colaborador, saida, ids, user };
  }
  const statusDaSaida = async (id: string) => (await q(`select status from entregador_saida where id = $1`, [id]))[0].status;

  it('a parada cancelada some do roteiro; as outras seguem', async () => {
    const { t, colaborador, saida, ids } = await saidaCom(['cancelado', 'despachado']);
    const r = await svc.saidaAtiva(t, colaborador);
    expect(r.saida?.id).toBe(saida);
    expect(r.paradas.map((p: any) => p.id)).toEqual([ids[1]]);
    expect(await statusDaSaida(saida)).toBe('em_rota');
  });

  it('todas canceladas, ou o resto concluído pelo painel: a saída fecha e o entregador fica livre', async () => {
    const a = await saidaCom(['cancelado', 'cancelado']);
    expect(await svc.saidaAtiva(a.t, a.colaborador)).toEqual({ saida: null, paradas: [] });
    expect(await statusDaSaida(a.saida)).toBe('concluida');
    const b = await saidaCom(['concluido', 'cancelado']);
    expect((await svc.saidaAtiva(b.t, b.colaborador)).saida).toBeNull();
    expect(await statusDaSaida(b.saida)).toBe('concluida');
  });

  it('cancelou a parada DA VEZ: o próximo cliente recebe o link; cancelou uma de depois: ninguém é avisado antes da hora', async () => {
    const s = await saidaCom(['despachado', 'despachado', 'despachado']);
    // A 2ª foi cancelada enquanto o entregador ia para a 1ª: só some da lista.
    await q(`update pedido_externo set status = 'cancelado' where id = $1`, [s.ids[1]]);
    await svc.aoCancelar({ tenantId: s.t, pedidoId: s.ids[1] });
    expect(links).toEqual([]);
    // A 1ª (a da vez) foi cancelada: o link vai para a próxima pendente (a 3ª).
    await q(`update pedido_externo set status = 'cancelado' where id = $1`, [s.ids[0]]);
    await svc.aoCancelar({ tenantId: s.t, pedidoId: s.ids[0] });
    expect(links).toEqual(['21987650002']);
    // A última: a saída fecha.
    await q(`update pedido_externo set status = 'cancelado' where id = $1`, [s.ids[2]]);
    await svc.aoCancelar({ tenantId: s.t, pedidoId: s.ids[2] });
    expect(await statusDaSaida(s.saida)).toBe('concluida');
  });

  it('o entregador toca em "finalizar" numa parada cancelada: responde que saiu do roteiro (sem o erro de antes)', async () => {
    const s = await saidaCom(['cancelado', 'despachado']);
    const r = await svc.finalizar(s.user, s.ids[0], '');
    expect(r).toMatchObject({ ok: true, valid: true, cancelado: true });
    expect(delivery.marcarEntregue).not.toHaveBeenCalled();
    expect(links).toEqual(['21987650001']); // a próxima parada recebe o link
  });
});
