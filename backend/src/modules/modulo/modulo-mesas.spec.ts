import { randomUUID } from 'node:crypto';
import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../../db/schema';
import { ModuloGuard } from '../../auth/modulo.guard';
import { MODULO_KEY } from '../../auth/require-modulo.decorator';
import { FiscalService } from '../fiscal/fiscal.service';
import { ProducaoPedidoService } from '../producao-pedido/producao-pedido.service';
import { VendasController } from '../vendas/vendas.controller';
import { VendasService } from '../vendas/vendas.service';
import { ModuloService } from './modulo.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

// MÓDULO "MESAS E COMANDAS" — contra Postgres (TEST_PG_URL), com os serviços de verdade.
//
// Pedido do dono (09/10/2026), ao escolher a tela nova do balcão: "as opções de mesa só ficam
// disponíveis se o módulo estiver ativo". O módulo não existia — "Mesas e comandas" era só uma
// permissão do perfil. Passa a ser um módulo que o presidente liga e desliga por rede ou por loja.
//
// O que se confere: nasce ligado; o plano contratado NÃO o limita (ele não é vendido à parte, e a
// lista do plano não o cita — sem a exceção, toda empresa com plano o veria desligado); desligado
// na loja, ninguém lista nem abre mesa e a venda do balcão recusa a mesa; e o que NÃO pode ser
// cortado segue aberto — `comandas/:id/cancelar` é a rota que cancela qualquer venda.

const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('modulo-mesas.spec: sem TEST_PG_URL — PULADO');
jest.setTimeout(120_000);

descrever('módulo Mesas e comandas: liga/desliga por loja, plano não limita, balcão recusa a mesa (Postgres real)', () => {
  const pool = new Pool({ connectionString: URL_PG });
  const db = drizzle(pool, { schema }) as any;
  const auditados: any[] = [];
  const auditoria = { registrar: async (e: any) => void auditados.push(e) } as any;
  const eventos = { emit: () => true } as any;
  const modulos = new ModuloService(db, auditoria);
  const fiscal = new FiscalService(db, auditoria);
  const producao = new ProducaoPedidoService(db, auditoria, eventos);
  const vendas = new VendasService(db, auditoria, eventos, producao, fiscal, {} as any, undefined, modulos);
  const guarda = new ModuloGuard(new Reflector(), modulos);
  const empresas: string[] = [];
  const q = (s: string, p: any[] = []) => pool.query(s, p).then((r) => r.rows);
  const edgeOriginal = process.env.EDGE_MODE;

  beforeAll(async () => {
    delete process.env.EDGE_MODE; // como NUVEM
    for (const t of ['edge_status', 'edge_heartbeat'])
      await pool
        .query(
          `create table if not exists ${t} (id uuid primary key default gen_random_uuid(),
             tenant_id uuid, unidade_id uuid, recebido_em timestamptz not null default now())`,
        )
        .catch((e: any) => {
          if (!['23505', '42P07'].includes(e?.code)) throw e;
        });
  });
  afterAll(async () => {
    if (edgeOriginal !== undefined) process.env.EDGE_MODE = edgeOriginal;
    if (empresas.length) {
      for (const t of ['impressao_job', 'producao_pedido', 'lancamento_caixa', 'movimento_estoque', 'comanda', 'caixa_sessao',
        'modulo_ativacao', 'ativacao', 'produto', 'colaborador', 'funcao', 'unidade'])
        await pool.query(`delete from ${t} where tenant_id = any($1::uuid[])`, [empresas]).catch(() => {});
      await pool.query('delete from empresa where id = any($1::uuid[])', [empresas]).catch(() => {});
    }
    await pool.end();
  }, 120_000);

  // Empresa com duas lojas, caixa aberto nas duas e um produto simples.
  async function empresa() {
    const t = (await q(`insert into empresa (nome) values ('teste modulo mesas') returning id`))[0].id as string;
    empresas.push(t);
    const loja = async (nome: string) => (await q(`insert into unidade (tenant_id, nome) values ($1,$2) returning id`, [t, nome]))[0].id as string;
    const a = await loja('Loja com mesas'), b = await loja('Loja só balcão');
    const funcao = (await q(`insert into funcao (tenant_id, nome, categoria) values ($1,'Presidente','presidente') returning id`, [t]))[0].id as string;
    const ator = (await q(`insert into colaborador (tenant_id, nome, funcao_id) values ($1,'Pessoa de teste',$2) returning id`, [t, funcao]))[0].id as string;
    for (const u of [a, b])
      await q(`insert into caixa_sessao (tenant_id, unidade_id, status, origem, aberta_por_id) values ($1,$2,'aberta','pdv',$3)`, [t, u, ator]);
    const produto = (await q(
      `insert into produto (tenant_id, codigo, nome, preco_venda, vai_para_producao, controla_estoque)
       values ($1,'MM1','Água de teste','4.00',false,false) returning id`,
      [t],
    ))[0].id as string;
    const presidente = (unidadeId: string | null) => ({ tenantId: t, colaboradorId: ator, categoria: 'presidente', unidadeId }) as any;
    return { t, a, b, ator, produto, presidente };
  }
  const vender = (e: any, unidadeId: string, mesa?: string) =>
    vendas.vendaBalcao(e.t, e.ator, 'presidente', { itens: [{ produtoId: e.produto, quantidade: 1 }], forma: 'dinheiro', unidadeId, mesa } as any, null) as Promise<any>;
  const comandas = (t: string) => q(`select mesa, senha, unidade_id from comanda where tenant_id = $1 order by created_at`, [t]);
  // A guarda como o Nest a chama: o método do controlador e o usuário da requisição.
  const passa = (metodo: keyof VendasController, user: any) =>
    guarda.canActivate({
      getHandler: () => (VendasController.prototype as any)[metodo],
      getClass: () => VendasController,
      switchToHttp: () => ({ getRequest: () => ({ user }) }),
    } as any);

  it('nasce ligado e aparece na lista de módulos que o presidente liga e desliga', async () => {
    const e = await empresa();
    const estado: any = await modulos.estado(e.t);
    expect(estado.modulos.map((m: any) => m.chave)).toContain('mesas');
    expect(estado.rede.mesas).toBe(true);
    expect((await modulos.meus(e.presidente(e.a))).mesas).toBe(true);
    expect(await modulos.ativo(e.t, null, 'mesas')).toBe(true);
  });

  it('o plano contratado não limita Mesas (não é vendido à parte) e continua limitando os outros', async () => {
    const e = await empresa();
    await q(`insert into ativacao (tenant_id, token_hash, status, modulos) values ($1,$2,'ativado','["kds"]'::jsonb)`, [e.t, 'teste-' + randomUUID()]);
    expect(await modulos.ativo(e.t, e.a, 'kds')).toBe(true);
    expect(await modulos.ativo(e.t, e.a, 'bot')).toBe(false); // fora do plano: o teto segue valendo
    expect(await modulos.ativo(e.t, e.a, 'mesas')).toBe(true); // antes da exceção: false para toda empresa com plano
    // desligar e LIGAR de volta: ligar não pode esbarrar em "não faz parte do plano contratado"
    await modulos.setar(e.presidente(null), { modulo: 'mesas', ativo: false });
    expect(await modulos.ativo(e.t, e.a, 'mesas')).toBe(false);
    await modulos.setar(e.presidente(null), { modulo: 'mesas', ativo: true });
    expect(await modulos.ativo(e.t, e.a, 'mesas')).toBe(true);
    await expect(modulos.setar(e.presidente(null), { modulo: 'bot', ativo: true })).rejects.toThrow(/plano contratado/);
  });

  it('desligado numa loja: vale só para ela, fica na auditoria e a outra loja segue com mesas', async () => {
    const e = await empresa();
    auditados.length = 0;
    await modulos.setar(e.presidente(null), { modulo: 'mesas', ativo: false, unidadeId: e.b });
    expect(await modulos.ativo(e.t, e.b, 'mesas')).toBe(false);
    expect(await modulos.ativo(e.t, e.a, 'mesas')).toBe(true);
    expect((await modulos.meus(e.presidente(e.b))).mesas).toBe(false);
    expect(auditados).toEqual([expect.objectContaining({ acao: 'modulo_desativado', unidadeId: e.b, detalhe: { modulo: 'mesas', escopo: 'loja' } })]);
  });

  it('venda do balcão com mesa: aceita com o módulo ligado, recusa (403) e não grava nada com ele desligado', async () => {
    const e = await empresa();
    await modulos.setar(e.presidente(null), { modulo: 'mesas', ativo: false, unidadeId: e.b });

    const ok = await vender(e, e.a, '12');
    expect(ok.comandaId).toBeTruthy();
    await expect(vender(e, e.b, '12')).rejects.toBeInstanceOf(ForbiddenException);
    await expect(vender(e, e.b, '12')).rejects.toThrow(/Mesas e comandas está desligado nesta loja/);
    // a loja sem mesas continua vendendo no balcão — com senha
    const semMesa = await vender(e, e.b);
    expect(semMesa.comandaId).toBeTruthy();
    // mesa em branco é "sem mesa": não pode virar comanda sem senha nem esbarrar na trava
    const emBranco = await vender(e, e.b, '   ');
    expect(emBranco.comandaId).toBeTruthy();

    const gravadas = await comandas(e.t);
    expect(gravadas).toHaveLength(3); // as duas recusadas não deixaram comanda
    expect(gravadas[0]).toMatchObject({ mesa: '12', senha: null, unidade_id: e.a }); // mesa não leva senha
    expect(gravadas[1].mesa).toBeNull();
    expect(gravadas[1].senha).toEqual(expect.any(Number));
    expect(gravadas[2].mesa).toBeNull();
    expect(gravadas[2].senha).toEqual(expect.any(Number));
  });

  it('rotas: listar e abrir mesa/comanda pedem o módulo; fechar, cancelar e o acerto do salão não', () => {
    const exige = (metodo: string) => Reflect.getMetadata(MODULO_KEY, (VendasController.prototype as any)[metodo]);
    for (const m of ['listarMesas', 'abrirMesa', 'getMesa', 'abrirComandaNaMesa', 'listarComandas', 'abrir']) expect([m, exige(m)]).toEqual([m, 'mesas']);
    // `cancelar` é a rota que cancela QUALQUER venda (tela de cupons e "buscar cupom" do balcão)
    for (const m of ['cancelar', 'fechar', 'acertos', 'balcao']) expect([m, exige(m)]).toEqual([m, undefined]);
    const guardas = (Reflect.getMetadata('__guards__', VendasController) ?? []).map((g: any) => g.name);
    expect(guardas).toContain('ModuloGuard'); // sem a guarda no controlador, a marca acima não corta nada
  });

  it('a guarda corta na hora para quem está na loja desligada — até o presidente — e libera a outra loja', async () => {
    const e = await empresa();
    await modulos.setar(e.presidente(null), { modulo: 'mesas', ativo: false, unidadeId: e.b });
    await expect(passa('listarMesas', e.presidente(e.b))).rejects.toBeInstanceOf(ForbiddenException);
    await expect(passa('abrirMesa', e.presidente(e.b))).rejects.toBeInstanceOf(ForbiddenException);
    await expect(passa('listarMesas', e.presidente(e.a))).resolves.toBe(true);
    await expect(passa('cancelar', e.presidente(e.b))).resolves.toBe(true);
    await expect(passa('balcao', e.presidente(e.b))).resolves.toBe(true);
    // religou: volta na mesma hora
    await modulos.setar(e.presidente(null), { modulo: 'mesas', ativo: true, unidadeId: e.b });
    await expect(passa('listarMesas', e.presidente(e.b))).resolves.toBe(true);
  });
});
