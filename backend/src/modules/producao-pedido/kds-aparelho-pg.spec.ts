import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../../db/schema';
import { EquipamentoService } from '../equipamento/equipamento.service';
import { ModuloService } from '../modulo/modulo.service';
import { ProducaoPedidoService } from './producao-pedido.service';
import { KdsAparelhoGuard } from './kds-aparelho.guard';
import { ProducaoAparelhoController } from './producao-aparelho.controller';

/* eslint-disable @typescript-eslint/no-explicit-any */

// O KDS FÍSICO PELO TOKEN DO APARELHO (16/11/2026 — a TV box da cozinha do Mister Burger ficava "online" e vazia: a tela
// relê a fila a cada pedido novo e a rota da fila só aceitava pessoa logada). Postgres real: a régua do guarda (V75 —
// token ativo, só KDS, loja viva, módulo ligado) e as três rotas presas à loja do aparelho.
const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('kds-aparelho-pg.spec: sem TEST_PG_URL — PULADO');

jest.setTimeout(60_000);

descrever('KDS físico pelo token do aparelho (Postgres)', () => {
  let pool: Pool;
  let guard: KdsAparelhoGuard;
  let ctrl: ProducaoAparelhoController;
  const q = (s: string, p: any[] = []) => pool.query(s, p).then((r) => r.rows);
  const T = randomUUID();
  const U1 = randomUUID();
  const U2 = randomUUID();
  const U_APAGADA = randomUUID();
  const U_SEM_KDS = randomUUID();
  const tk = (n: string) => `tk-kds-aparelho-${n}-${T}`;
  const cartao: Record<string, string> = {};

  // Monta o pedido HTTP do jeito que o Nest entrega ao guarda e devolve o que ele deixou para a rota.
  async function entra(token?: string) {
    const req: any = { headers: token ? { 'x-device-token': token } : {} };
    await guard.canActivate({ switchToHttp: () => ({ getRequest: () => req }) } as any);
    return req.kdsAparelho;
  }
  async function recusa(token?: string) {
    try {
      await entra(token);
      return null;
    } catch (e: any) {
      const r = e?.getResponse?.() ?? {};
      return { status: e?.getStatus?.(), code: r.code };
    }
  }

  beforeAll(async () => {
    pool = new Pool({ connectionString: URL_PG });
    const db = drizzle(pool, { schema }) as any;
    const auditoria = { registrar: async () => undefined } as any;
    const eventos = { emit: () => true } as any;
    const modulos = new ModuloService(db, auditoria);
    guard = new KdsAparelhoGuard(new EquipamentoService(db, auditoria), modulos, db);
    ctrl = new ProducaoAparelhoController(new ProducaoPedidoService(db, auditoria, eventos, undefined, modulos));

    await q(`insert into empresa (id, nome) values ($1, 'teste KDS pelo token do aparelho')`, [T]);
    for (const [id, nome, apagada] of [
      [U1, 'Loja 1', false],
      [U2, 'Loja 2', false],
      [U_APAGADA, 'Loja apagada', true],
      [U_SEM_KDS, 'Loja sem KDS', false],
    ] as const) {
      await q(`insert into unidade (id, tenant_id, nome, deleted_at) values ($1, $2, $3, $4)`, [id, T, nome, apagada ? new Date() : null]);
    }
    await q(`insert into modulo_ativacao (tenant_id, unidade_id, modulo, ativo) values ($1, $2, 'kds', false)`, [T, U_SEM_KDS]);
    const equip = (n: string, tipo: string, unidade: string | null, ativo = true) =>
      q(`insert into equipamento (tenant_id, unidade_id, nome, tipo, token, ativo) values ($1, $2, $3, $4, $5, $6)`, [
        T,
        unidade,
        `KDS ${n}`,
        tipo,
        tk(n),
        ativo,
      ]);
    await equip('cozinha', 'kds', U1);
    await equip('revogado', 'kds', U1, false);
    await equip('impressora', 'impressora', U1);
    await equip('apagada', 'kds', U_APAGADA);
    await equip('sem-modulo', 'kds', U_SEM_KDS);
    for (const [nome, unidade] of [
      ['loja1', U1],
      ['loja2', U2],
    ] as const) {
      const [c] = await q(
        `insert into producao_pedido (tenant_id, unidade_id, senha, status, origem, numero) values ($1, $2, 51, 'recebido', 'balcao', 51) returning id`,
        [T, unidade],
      );
      cartao[nome] = c.id;
      await q(`insert into producao_pedido_item (tenant_id, pedido_id, descricao, quantidade) values ($1, $2, 'X-Burger', 1)`, [T, c.id]);
    }
  });

  afterAll(async () => {
    if (!pool) return;
    await q('delete from producao_pedido_item where tenant_id = $1', [T]).catch(() => undefined);
    await q('delete from producao_pedido where tenant_id = $1', [T]).catch(() => undefined);
    await q('delete from equipamento where tenant_id = $1', [T]).catch(() => undefined);
    await q('delete from modulo_ativacao where tenant_id = $1', [T]).catch(() => undefined);
    await q('delete from unidade where tenant_id = $1', [T]).catch(() => undefined);
    await q('delete from empresa where id = $1', [T]).catch(() => undefined);
    await pool.end();
  });

  it('a régua do guarda: sem token, token de outro tipo, revogado, loja apagada e módulo desligado são recusados', async () => {
    expect(await recusa(undefined)).toEqual({ status: 401, code: 'KDS_TOKEN_AUSENTE' });
    expect(await recusa('token-que-nao-existe')).toEqual({ status: 401, code: 'KDS_TOKEN_INVALIDO' });
    expect(await recusa(tk('impressora'))).toEqual({ status: 401, code: 'KDS_TOKEN_INVALIDO' });
    expect(await recusa(tk('revogado'))).toEqual({ status: 401, code: 'KDS_TOKEN_INVALIDO' });
    expect(await recusa(tk('apagada'))).toEqual({ status: 401, code: 'KDS_LOJA_INEXISTENTE' });
    expect(await recusa(tk('sem-modulo'))).toEqual({ status: 403, code: 'MODULO_DESATIVADO' });
  });

  it('a empresa, a loja e o KDS saem do aparelho', async () => {
    expect(await entra(tk('cozinha'))).toMatchObject({ tenantId: T, unidadeId: U1, nome: 'KDS cozinha' });
  });

  it('a fila do aparelho traz o cartão da loja dele, com os itens, e não o da outra loja', async () => {
    const kds = await entra(tk('cozinha'));
    const r: any = await ctrl.fila(kds, 'todos');
    const ids = (r.pedidos ?? []).map((p: any) => p.id);
    expect(ids).toContain(cartao.loja1);
    expect(ids).not.toContain(cartao.loja2);
    expect((r.pedidos ?? []).find((p: any) => p.id === cartao.loja1)?.itens?.[0]?.descricao).toBe('X-Burger');
  });

  it('a fila do aparelho diz ao cabeçalho o nome do cadastro e o IP com que ele chegou (o que o servidor vê)', async () => {
    const kds = await entra(tk('cozinha'));
    const r: any = await ctrl.fila(kds, 'todos', { ip: '::ffff:192.168.1.24' });
    expect(r.aparelho).toEqual({ nome: 'KDS cozinha', ip: '192.168.1.24' });
    // sem `req.ip` (proxy sem o cabeçalho), o endereço da conexão; nada que não seja IP vira texto na tela
    expect((await ctrl.fila(kds, 'todos', { socket: { remoteAddress: '192.168.1.30' } }) as any).aparelho.ip).toBe('192.168.1.30');
    expect((await ctrl.fila(kds, 'todos', { ip: '<b>x</b>' }) as any).aparelho).toEqual({ nome: 'KDS cozinha', ip: null });
    // a fila de sempre continua ao lado (campo aditivo)
    expect(Array.isArray(r.pedidos)).toBe(true);
    expect(r.cores).toBeDefined();
  });

  it('avança o cartão da loja dele; o da outra loja responde como inexistente; o toque velho (de) não pula etapa', async () => {
    const kds = await entra(tk('cozinha'));
    await expect(ctrl.avancar(kds, cartao.loja2, { de: 'recebido' })).rejects.toMatchObject({ status: 404 });
    expect((await q('select status from producao_pedido where id = $1', [cartao.loja2]))[0].status).toBe('recebido');
    await ctrl.avancar(kds, cartao.loja1, { de: 'recebido' });
    const depois = (await q('select status from producao_pedido where id = $1', [cartao.loja1]))[0].status;
    expect(depois).not.toBe('recebido');
    await expect(ctrl.avancar(kds, cartao.loja1, { de: 'recebido' })).rejects.toMatchObject({ status: 409 });
  });

  it('o "Visto" só no cartão da loja dele', async () => {
    const kds = await entra(tk('cozinha'));
    // O "Visto" é do pedido ALTERADO (mig 362): os dois cartões foram alterados e ainda não vistos.
    await q(`update producao_pedido set alterado_em = now() where id = any($1::uuid[])`, [
      [cartao.loja1, cartao.loja2],
    ]);
    await expect(ctrl.visto(kds, cartao.loja2)).rejects.toMatchObject({ status: 404 });
    await ctrl.visto(kds, cartao.loja1); // não lança
  });
});
