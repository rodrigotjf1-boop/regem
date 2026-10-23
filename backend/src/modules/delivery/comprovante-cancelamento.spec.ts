import { randomUUID } from 'node:crypto';
import * as bcrypt from 'bcryptjs';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../../db/schema';
import { FiscalService } from '../fiscal/fiscal.service';
import { ProducaoPedidoService } from '../producao-pedido/producao-pedido.service';
import { VendasService } from '../vendas/vendas.service';
import { DeliveryService } from './delivery.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

// COMPROVANTE DO CANCELAMENTO e QUEM LIBERA (pedidos do dono, 22–23/10/2026), no servidor da loja, contra o Postgres:
//  • cancelar pedido de canal (painel do Delivery) imprime o comprovante — pedido, horário, motivo, quem cancelou, quem
//    liberou e perda × reaproveitados — na impressora do PC que cancelou; as impressoras do perfil mandam se marcadas;
//  • a senha da SUPERVISÃO libera (além de presidente e gerente); a da execução e a errada, não;
//  • reabrir pedido registra na auditoria quem liberou;
//  • cancelar venda do balcão imprime o mesmo comprovante, com quem liberou (o gestor, ou o caixa com cancelamento livre).
const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('comprovante-cancelamento.spec: sem TEST_PG_URL — PULADO');

const SENHA = { gerente: 'Senha-Gerente-1', supervisao: 'Senha-Supervisao-1', execucao: 'Senha-Atendente-1' };

descrever('comprovante do cancelamento e quem libera (Postgres real)', () => {
  jest.setTimeout(120_000);
  const pool = new Pool({ connectionString: URL_PG });
  const db = drizzle(pool, { schema }) as any;
  const auditado: any[] = [];
  const auditoria = { registrar: async (e: any) => void auditado.push(e) } as any;
  const eventos = { emit: () => true } as any;
  const producao = new ProducaoPedidoService(db, auditoria, eventos);
  const vendas = new VendasService(db, auditoria, eventos, producao, new FiscalService(db, auditoria), {} as any);
  const beneficio = new Proxy({}, { get: () => async () => undefined }) as any;
  const delivery = new DeliveryService(
    db, vendas, producao, beneficio, beneficio, eventos, { flashPedidos: () => undefined } as any,
    undefined, undefined, undefined, undefined, undefined, undefined, auditoria,
  );
  const env0 = { EDGE_MODE: process.env.EDGE_MODE, CLOUD_API: process.env.CLOUD_API, SYNC_TOKEN: process.env.SYNC_TOKEN };
  const empresas: string[] = [];
  const q = (s: string, p: any[] = []) => pool.query(s, p).then((r) => r.rows);
  const um = async (s: string, p: any[] = []) => (await q(s, p))[0].id as string;
  const semNbsp = (s: string) => String(s).replace(/ /g, ' ');
  let display = 700;

  beforeAll(() => {
    process.env.EDGE_MODE = 'true'; // o servidor da loja aceita, cancela e imprime
    delete process.env.CLOUD_API;
    delete process.env.SYNC_TOKEN;
  });
  afterAll(async () => {
    for (const [k, v] of Object.entries(env0)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    if (empresas.length) {
      for (const t of [
        'pedido_envio', 'pedido_notificacao', 'impressao_job', 'producao_pedido_item', 'producao_pedido', 'pedido_externo',
        'lancamento_caixa', 'caixa_sessao', 'movimento_estoque', 'comanda_item', 'comanda', 'senha_contador', 'entitlement',
        'delivery_config', 'produto', 'colaborador', 'funcao', 'equipamento', 'unidade',
      ])
        await pool.query(`delete from ${t} where tenant_id = any($1::uuid[])`, [empresas]).catch(() => {});
      await pool.query('delete from empresa where id = any($1::uuid[])', [empresas]).catch(() => {});
    }
    await pool.end();
  }, 120_000);
  beforeEach(() => {
    auditado.length = 0;
  });

  // A loja: duas impressoras de cupom, o PC do delivery (terminal) ligado à primeira, e quem pode (ou não) liberar.
  async function loja(cupomPerfis: any = {}) {
    const t = await um(`insert into empresa (nome) values ('teste comprovante de cancelamento') returning id`);
    empresas.push(t);
    const u = await um(`insert into unidade (tenant_id, nome) values ($1,'Loja') returning id`, [t]);
    const impressora = (nome: string) =>
      um(
        `insert into equipamento (tenant_id, unidade_id, tipo, nome, token, ativo, conexao, host, porta, faz_cupom)
         values ($1,$2,'impressora',$3,$4,true,'rede','10.0.0.20',9100,true) returning id`,
        [t, u, nome, 'tok-' + randomUUID()],
      );
    const caixaDelivery = await impressora('Caixa delivery');
    const caixaBalcao = await impressora('Caixa balcão');
    const pdv = await um(
      `insert into equipamento (tenant_id, unidade_id, tipo, nome, token, ativo, impressora_padrao_id)
       values ($1,$2,'pdv','Pdv delivery',$3,true,$4) returning id`,
      [t, u, 'tok-' + randomUUID(), caixaDelivery],
    );
    await q(`insert into produto (tenant_id, codigo, nome, preco_venda, vai_para_producao) values ($1,'XT1','Lanche de teste','20.00',false)`, [t]);
    const pessoa = async (nome: string, categoria: string, senha: string) => {
      const f = await um(`insert into funcao (tenant_id, nome, categoria) values ($1,$2,$3) returning id`, [t, nome, categoria]);
      return um(`insert into colaborador (tenant_id, nome, funcao_id, senha_hash) values ($1,$2,$3,$4) returning id`, [t, nome, f, await bcrypt.hash(senha, 4)]);
    };
    const gerente = await pessoa('Gerente Teste', 'gerente', SENHA.gerente);
    const supervisora = await pessoa('Supervisora Teste', 'supervisao', SENHA.supervisao);
    const atendente = await pessoa('Atendente Teste', 'execucao', SENHA.execucao);
    await q(`insert into delivery_config (tenant_id, cupom_perfis) values ($1,$2::jsonb)`, [
      t,
      JSON.stringify(typeof cupomPerfis === 'function' ? cupomPerfis({ caixaDelivery, caixaBalcao }) : cupomPerfis),
    ]);
    return { t, u, caixaDelivery, caixaBalcao, pdv, gerente, supervisora, atendente };
  }
  type Loja = Awaited<ReturnType<typeof loja>>;

  async function aceito(l: Loja) {
    display++;
    const [p] = await q(
      `insert into pedido_externo (tenant_id, unidade_id, canal, external_id, display_id, numero, cliente_nome, tipo, itens, total,
         forma_pagamento, status, pago)
       values ($1,$2,'ifood',$3,$4,42,'Cliente de teste','entrega',
         '[{"codigo":"XT1","descricao":"Lanche de teste","quantidade":1,"precoUnitario":20}]'::jsonb,'20.00','online','novo',true)
       returning id`,
      [l.t, l.u, randomUUID(), String(display)],
    );
    await delivery.aceitar(l.t, l.atendente, p.id);
    return p.id as string;
  }
  const comprovantes = async (l: Loja) =>
    (await q(`select equipamento_id as eq, conteudo from impressao_job where tenant_id = $1 and via = 'caixa' order by criado_em, id`, [l.t])).map(
      (j: any) => ({ eq: j.eq as string, linhas: semNbsp(j.conteudo).split('\n') }),
    );

  it('cancelar pedido de canal: o comprovante sai no PC que cancelou, com tudo o que o dono pediu', async () => {
    const l = await loja();
    const id = await aceito(l);
    const r: any = await delivery.cancelar(l.t, l.atendente, 'execucao', id, 'Cliente desistiu', SENHA.supervisao, false, l.pdv);
    expect(r.status).toBe('cancelado');
    expect(r.comprovante).toEqual({ enfileirados: 1, aviso: null, impressoras: ['Caixa delivery'] });
    const [c] = await comprovantes(l);
    expect(c.eq).toBe(l.caixaDelivery);
    expect(c.linhas).toEqual(
      expect.arrayContaining([
        '@CBD CANCELAMENTO',
        `@CB iFood #${display}`,
        '@C Pedido Regem #42',
        '@B Motivo: Cliente desistiu',
        'Atendente: Atendente Teste',
        '@B Autorizado por: Supervisora Teste', // a supervisão também libera (dono, 23/10/2026)
        '@B Insumos: PERDA (saem do estoque)',
      ]),
    );
    expect(c.linhas.join('\n')).toMatch(/@CB SENHA D-\d+/);
    expect(c.linhas.some((s) => /^\d{2}\/\d{2}\/\d{4}, \d{2}:\d{2}:\d{2}$/.test(s))).toBe(true);
    expect((await q(`select motivo_cancelamento from pedido_externo where id = $1`, [id]))[0].motivo_cancelamento).toBe(
      'Cliente desistiu (autorizado por Supervisora Teste)',
    );
  });

  it('quem libera: presidente, gerente e supervisão com acesso; a execução e a senha errada, não', async () => {
    const l = await loja();
    const id = await aceito(l);
    for (const senha of ['errada', SENHA.execucao])
      await expect(delivery.cancelar(l.t, l.atendente, 'execucao', id, 'x', senha, true, l.pdv)).rejects.toThrow(/Senha de gestor inválida/);
    // A supervisora que saiu não libera mais.
    await q(`update colaborador set deleted_at = now() where id = $1`, [l.supervisora]);
    await expect(delivery.cancelar(l.t, l.atendente, 'execucao', id, 'x', SENHA.supervisao, true, l.pdv)).rejects.toThrow(/Senha de gestor inválida/);
    expect(await comprovantes(l)).toEqual([]); // nada cancelado, nada impresso
    const r: any = await delivery.cancelar(l.t, l.atendente, 'execucao', id, 'Engano', SENHA.gerente, true, l.pdv);
    expect(r.comprovante.enfileirados).toBe(1);
    expect((await comprovantes(l))[0].linhas).toEqual(
      expect.arrayContaining(['@B Autorizado por: Gerente Teste', '@B Insumos: REAPROVEITADOS (voltam ao estoque)']),
    );
  });

  it('as impressoras marcadas no perfil "Caixa — cancelamento" mandam; sem PC, as de cupom', async () => {
    const l = await loja(({ caixaBalcao }: any) => ({ cancelamento: { impressoras: [caixaBalcao] } }));
    await delivery.cancelar(l.t, l.atendente, 'execucao', await aceito(l), 'x', SENHA.gerente, true, l.pdv);
    expect((await comprovantes(l)).map((c) => c.eq)).toEqual([l.caixaBalcao]);

    const l2 = await loja();
    const r: any = await delivery.cancelar(l2.t, l2.atendente, 'execucao', await aceito(l2), 'x', SENHA.gerente, true, null);
    expect(r.comprovante.enfileirados).toBe(2); // sem o PC e sem impressora no perfil: as de cupom, como a sangria
  });

  it('reabrir pedido: quem liberou fica na auditoria', async () => {
    const l = await loja();
    const id = await aceito(l);
    await q(`update pedido_externo set status = 'concluido', concluido_em = now() where id = $1`, [id]);
    await delivery.voltarPedido(l.t, l.atendente, id, SENHA.supervisao, 'execucao');
    expect(auditado.filter((a) => a.acao === 'reabriu_pedido')).toEqual([
      expect.objectContaining({
        atorId: l.atendente,
        atorPerfil: 'execucao',
        entidadeId: id,
        detalhe: expect.objectContaining({ de: 'concluido', para: 'despachado', autorizadoPor: 'Supervisora Teste', autorizadoPorId: l.supervisora }),
      }),
    ]);
  });

  it('cancelar venda do balcão: o mesmo comprovante, com quem liberou', async () => {
    const l = await loja();
    await q(`insert into caixa_sessao (tenant_id, unidade_id, terminal_id, origem, status, valor_abertura, aberta_por_id) values ($1,$2,$3,'pdv','aberta',0,$4)`, [
      l.t, l.u, l.pdv, l.gerente,
    ]);
    const venda = async () => {
      const c = await um(`insert into comanda (tenant_id, unidade_id, status, senha, senha_prefixo, total, forma) values ($1,$2,'fechada',7,'B',30,'dinheiro') returning id`, [l.t, l.u]);
      await q(`insert into lancamento_caixa (tenant_id, unidade_id, comanda_id, tipo, valor, data, categoria, forma) values ($1,$2,$3,'entrada',30,current_date,'venda','dinheiro')`, [l.t, l.u, c]);
      return c;
    };
    const r: any = await vendas.cancelar(l.t, l.gerente, 'gerente', await venda(), { motivo: 'Lançado errado' }, l.pdv);
    expect(r.comprovante.enfileirados).toBe(1);
    const [c] = await comprovantes(l);
    expect(c.eq).toBe(l.caixaDelivery);
    expect(c.linhas).toEqual(expect.arrayContaining(['@CBD CANCELAMENTO', '@CB SENHA B-7', '@B Motivo: Lançado errado', 'Atendente: Gerente Teste', '@B Autorizado por: Gerente Teste']));
    expect(c.linhas.join('\n')).not.toContain('Insumos'); // a venda não tinha baixado nada

    // Caixa com o cancelamento livre (o presidente liberou): quem cancelou é a atendente, sem gestor.
    await q(`insert into entitlement (tenant_id, modulo, ativo) values ($1,'pdv_cancelamento_livre',true)`, [l.t]);
    await q(`delete from impressao_job where tenant_id = $1`, [l.t]);
    await vendas.cancelar(l.t, l.atendente, 'execucao', await venda(), { motivo: 'Desistiu' }, l.pdv);
    expect((await comprovantes(l))[0].linhas).toEqual(
      expect.arrayContaining(['Atendente: Atendente Teste', '@B Autorizado por: cancelamento liberado para o caixa']),
    );
  });
});
