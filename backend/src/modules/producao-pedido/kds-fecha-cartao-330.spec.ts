import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Pool, PoolClient } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../../db/schema';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { ProducaoPedidoService } from './producao-pedido.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

// Auditoria do KDS (20/10/2026): uma tela mostrava 904 cartões abertos, 854 com mais de um dia — o pedido saía da loja
// pela tela de delivery, pelo PDV › Retirada ou pelo canal, e o cartão da cozinha ficava "recebido" para sempre.
//  • mig 330, gatilho: o pedido de canal que vira despachado/entregue/concluído fecha os cartões abertos da comanda
//    (menos o totem, cuja senha segue em "pronto" até o cliente buscar), com `updated_at` novo mesmo na sessão de
//    sincronização — é ele que faz o cartão fechado chegar ao outro lado;
//  • mig 330, uma vez e só na nuvem: fecha os abertos de pedido que já saiu e os com mais de um dia (menos encomenda
//    ainda por fazer), com auditoria encadeada;
//  • a fila do KDS mostra os abertos das últimas 12 horas (encomenda por fazer continua) e os cancelados recentes.
// A migration roda numa transação DESFEITA no fim (o critério é do banco inteiro e não pode mexer nas specs paralelas).
const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('kds-fecha-cartao-330.spec: sem TEST_PG_URL — PULADO');

const ARQUIVO = join(__dirname, '..', '..', '..', '..', 'database', 'migrations', '330_kds_fecha_cartao_quando_o_pedido_sai.sql');
const MARCA = 'Fechado pela migration 330';

describe('migration 330 (arquivo)', () => {
  const texto = readFileSync(ARQUIVO, 'utf8');
  it('roda nos dois lados (o gatilho vale na loja), passa pela trava do Supabase e deixa o totem de fora', () => {
    expect(texto).not.toMatch(/^\s*--\s*@cloud-only\b/im);
    expect(texto).not.toMatch(/\bdrop\b|\btruncate\b|^\s*delete\b/im);
    expect(texto).toMatch(/create or replace trigger trg_pedido_externo_fecha_producao/);
    expect(texto).toMatch(/new\.canal is distinct from 'totem'/);
    expect(texto).toMatch(/to_regclass\(current_schema\(\) \|\| '\.edge_status'\) is null then\s+return;/);
  });
});

descrever('migration 330 e a fila do KDS (Postgres)', () => {
  jest.setTimeout(120_000);
  const pool = new Pool({ connectionString: URL_PG });
  const sql330 = readFileSync(ARQUIVO, 'utf8');
  afterAll(async () => {
    await pool.end();
  }, 60_000);

  // Monta, no `q` dado (transação ou pool), uma empresa com uma loja e devolve ajudantes para criar venda + cartão.
  async function loja(q: (s: string, p?: any[]) => Promise<any[]>) {
    const t = (await q(`insert into empresa (nome) values ('teste migration 330') returning id`))[0].id as string;
    const u = (await q(`insert into unidade (tenant_id, nome) values ($1,'Loja') returning id`, [t]))[0].id as string;
    const venda = async (o: { canal?: string; status?: string; card?: string; criado?: string; agendamento?: string | null; semPedido?: boolean }) => {
      const comanda = (await q(
        `insert into comanda (tenant_id, unidade_id, status, total, fechada_em, senha_prefixo) values ($1,$2,'fechada',20, now(),'D') returning id`,
        [t, u],
      ))[0].id as string;
      const card = (await q(
        `insert into producao_pedido (tenant_id, unidade_id, comanda_id, destino_tipo, origem, status, criado_em, cancelado_em)
         values ($1,$2,$3,'kds','delivery',$4, now() - $5::interval, case when $4 = 'cancelado' then now() - $5::interval end) returning id`,
        [t, u, comanda, o.card ?? 'recebido', o.criado ?? '0 minutes'],
      ))[0].id as string;
      let pedido: string | null = null;
      if (!o.semPedido) {
        pedido = (await q(
          `insert into pedido_externo (tenant_id, unidade_id, canal, external_id, display_id, cliente_nome, tipo, status, itens, total, comanda_id, agendamento)
           values ($1,$2,$3,$4,'1','Cliente de teste','entrega',$5,'[]'::jsonb,20,$6,$7) returning id`,
          [t, u, o.canal ?? 'anotaai', randomUUID(), o.status ?? 'confirmado', comanda, o.agendamento ?? null],
        ))[0].id as string;
      }
      return { comanda, card, pedido };
    };
    return { t, u, venda };
  }

  it('fecha os cartões esquecidos uma vez (com auditoria) e, daí em diante, o gatilho fecha o cartão quando o pedido sai da loja', async () => {
    const c: PoolClient = await pool.connect();
    try {
      await c.query('begin');
      const q = (s: string, p: any[] = []) => c.query(s, p).then((r) => r.rows);
      // "Como nuvem": a parte única só roda onde existe `edge_status` (o banco do CI é de loja).
      if (!(await q(`select to_regclass(current_schema() || '.edge_status') as t`))[0].t) {
        await q(`create table edge_status (equipamento_id uuid primary key, tenant_id uuid, unidade_id uuid, versao text, recebido_em timestamptz)`);
      }
      const l = await loja(q);
      const antigo = await l.venda({ criado: '2 days' }); // pedido ainda "confirmado", mas o cartão tem 2 dias
      const saiu = await l.venda({ status: 'concluido' }); // recente, mas o pedido já saiu
      const aberto = await l.venda({}); // recente e o pedido ainda na cozinha
      const encomenda = await l.venda({ criado: '3 days', agendamento: new Date(Date.now() + 86400_000).toISOString() });
      const cancelado = await l.venda({ card: 'cancelado', criado: '3 days' });
      const totemSaiu = await l.venda({ canal: 'totem', status: 'concluido' }); // totem: a senha segue em "pronto"
      // Só a leitura da auditoria usa o serviço: `registrar` abre transação própria e, num cliente já em transação,
      // confirmaria esta (a continuação de uma corrente existente está provada na spec da 328).
      const auditoria = new AuditoriaService(drizzle(c as any, { schema }) as any);

      const res: any = await c.query(sql330);
      const conferencia = (Array.isArray(res) ? res[res.length - 1] : res).rows[0];
      expect(conferencia).toMatchObject({ gatilho: true, nuvem: true });

      const card = async (id: string) => (await q('select status, obs, entregue_em, iniciado_em, pronto_em from producao_pedido where id = $1', [id]))[0];
      for (const v of [antigo, saiu]) {
        const x = await card(v.card);
        expect(x.status).toBe('entregue');
        expect(x.obs).toContain(MARCA);
        expect(x.entregue_em).not.toBeNull();
        expect([x.iniciado_em, x.pronto_em]).toEqual([null, null]); // não entra na média de preparo
      }
      expect((await card(aberto.card)).status).toBe('recebido');
      expect((await card(encomenda.card)).status).toBe('recebido');
      expect((await card(cancelado.card)).status).toBe('cancelado');
      expect((await card(totemSaiu.card)).status).toBe('recebido');

      // Auditoria: uma linha da empresa, na corrente dela, com quantos cartões fechou.
      const aud = await q(`select seq, actor_tipo, detalhe from audit_log where tenant_id = $1 and acao = 'fechou_cartoes_kds'`, [l.t]);
      expect(aud).toEqual([{ seq: 1, actor_tipo: 'distribuicao', detalhe: expect.objectContaining({ cards: '2', migration: '330' }) }]);
      expect(await auditoria.verificarCadeia(l.t)).toEqual({ ok: true, total: 1, quebras: [] });

      // Gatilho: despachado fecha; pronto não; totem não.
      await q(`update pedido_externo set status = 'despachado' where id = $1`, [aberto.pedido]);
      expect((await card(aberto.card)).status).toBe('entregue');
      const naCozinha = await l.venda({});
      await q(`update pedido_externo set status = 'pronto' where id = $1`, [naCozinha.pedido]);
      expect((await card(naCozinha.card)).status).toBe('recebido');
      const totem = await l.venda({ canal: 'totem' });
      await q(`update pedido_externo set status = 'concluido' where id = $1`, [totem.pedido]);
      expect((await card(totem.card)).status).toBe('recebido');

      // Na sessão de sincronização o `bump_updated_at` não mexe na data: o gatilho a escreve, e o cartão fechado desce.
      const pelaSync = await l.venda({});
      await q(`select set_config('regem.sync', 'on', true)`);
      // Envelhece o cartão DENTRO da sessão de sincronização (fora dela o `bump_updated_at` gravaria "agora").
      await q(`update producao_pedido set updated_at = now() - interval '1 hour' where id = $1`, [pelaSync.card]);
      const antes = (await q(`select updated_at < now() - interval '50 minutes' as velho from producao_pedido where id = $1`, [pelaSync.card]))[0];
      expect(antes).toEqual({ velho: true });
      await q(`update pedido_externo set status = 'concluido' where id = $1`, [pelaSync.pedido]);
      await q(`select set_config('regem.sync', '', true)`);
      const sync = (await q(`select status, updated_at > now() - interval '1 minute' as data_nova from producao_pedido where id = $1`, [pelaSync.card]))[0];
      expect(sync).toEqual({ status: 'entregue', data_nova: true });

      // De novo: nada a fechar, nenhuma auditoria a mais.
      await c.query(sql330);
      expect((await q(`select count(*)::int as n from audit_log where tenant_id = $1 and acao = 'fechou_cartoes_kds'`, [l.t]))[0].n).toBe(1);
    } finally {
      await c.query('rollback').catch(() => {});
      c.release();
    }
  });

  it('a fila do KDS mostra os abertos das últimas 12 horas, a encomenda por fazer e os cancelados recentes', async () => {
    const db = drizzle(pool, { schema }) as any;
    const producao = new ProducaoPedidoService(db, { registrar: async () => undefined } as any, { emit: () => true } as any);
    const q = (s: string, p: any[] = []) => pool.query(s, p).then((r) => r.rows);
    const l = await loja(q);
    try {
      const agora = await l.venda({ criado: '2 hours' });
      const ontem = await l.venda({ criado: '13 hours' });
      const encomenda = await l.venda({ criado: '30 hours', agendamento: new Date(Date.now() + 3 * 3600_000).toISOString() });
      const canceladoAgora = await l.venda({ card: 'cancelado', criado: '10 minutes' });
      const canceladoAntes = await l.venda({ card: 'cancelado', criado: '2 hours' });
      const fila: any = await producao.filaKds(l.t, {});
      const ids = (fila.pedidos ?? fila).map((p: any) => p.id).sort();
      expect(ids).toEqual([agora.card, encomenda.card, canceladoAgora.card].sort());
      expect(ids).not.toContain(ontem.card);
      expect(ids).not.toContain(canceladoAntes.card);
    } finally {
      for (const tb of ['producao_pedido', 'pedido_externo', 'comanda', 'unidade'])
        await pool.query(`delete from ${tb} where tenant_id = $1`, [l.t]).catch(() => {});
      await pool.query('delete from empresa where id = $1', [l.t]).catch(() => {});
    }
  });
});
