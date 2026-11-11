import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { eq } from 'drizzle-orm';
import * as schema from '../../db/schema';
import { ProducaoPedidoService } from './producao-pedido.service';
import { EquipamentoService } from '../equipamento/equipamento.service';
import { proximoEfetivo, recebeDeOutroKds, type TelaDaCorrente } from '../../common/fluxo-kds';

/* eslint-disable @typescript-eslint/no-explicit-any */

// AUDITORIA DO KDS (11/11/2026) — o avanço do cartão e a rota KDS1 → KDS2 → imprime → TV de senhas:
//  • R8  toque duplo / tela velha: com a etapa que a tela viu (`de`), o segundo toque não pula etapa;
//  • R4  "Entregar" só no KDS de entrega — decidido pelo CADASTRO da tela, não pelo que ela manda;
//  • R1  "imprimir a produção só ao avançar" no modo comum: a via da venda espera e o ticket sai no avanço (antes nunca);
//  • R6  corrente no modo comum: o KDS2 só vê o cartão depois que o KDS1 termina;
//  • R3  o KDS de entrega não é "vai para" (o servidor recusa; o cadastro antigo vale como "termina aqui");
//  • R9  KDS desligado no meio da corrente é pulado;
//  • R2  módulo KDS desligado: nada de estações nem de adiar — os itens saem em papel;
//  • R5  despacho com "imprimir ao entregar" imprime na ação Entregue;
//  • R10 a impressora do ticket é conferida ao salvar e ao imprimir.
const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('kds-avanco-rota.spec: sem TEST_PG_URL — PULADO');

jest.setTimeout(120_000);

// As regras puras da corrente (sem banco).
describe('corrente dos KDS (regras puras)', () => {
  const tela = (proximoKdsId: string | null, o: Partial<TelaDaCorrente> = {}): TelaDaCorrente => ({
    proximoKdsId,
    ativo: true,
    revogado: false,
    escopo: 'producao',
    ...o,
  });
  it('segue o "vai para", pula o desligado/revogado e nunca termina na tela de entrega', () => {
    const t = new Map<string, TelaDaCorrente>([
      ['chapa', tela('montagem')],
      ['montagem', tela('despacho', { ativo: false })],
      ['despacho', tela(null, { escopo: 'despacho' })],
      ['bar', tela('senhas')],
      ['senhas', tela(null, { escopo: 'entrega' })],
      ['fritas', tela('velho')],
      ['velho', tela('despacho', { revogado: true })],
      ['a', tela('b')],
      ['b', tela('a', { ativo: false })],
    ]);
    expect(proximoEfetivo(t, 'chapa')).toBe('despacho');
    expect(proximoEfetivo(t, 'bar')).toBeNull();
    expect(proximoEfetivo(t, 'fritas')).toBe('despacho');
    expect(proximoEfetivo(t, 'despacho')).toBeNull();
    expect(proximoEfetivo(t, 'a')).toBeNull(); // círculo antigo com o do meio desligado: não trava
    expect(proximoEfetivo(t, 'nao-existe')).toBeNull();
    expect(recebeDeOutroKds(t, 'despacho')).toBe(true); // da chapa (pulando a montagem desligada)
    expect(recebeDeOutroKds(t, 'montagem')).toBe(false); // desligada: ninguém "manda" para ela de verdade
    expect(recebeDeOutroKds(t, 'chapa')).toBe(false);
    expect(recebeDeOutroKds(t, 'senhas')).toBe(false);
  });
});

descrever('KDS — avanço e rota (Postgres)', () => {
  let pool: Pool;
  let db: any;
  let svc: ProducaoPedidoService;
  let equip: EquipamentoService;
  const antes = process.env.EDGE_MODE;
  const ATOR = { id: randomUUID(), perfil: 'gerente' };
  const q = (s: string, p: any[] = []) => pool.query(s, p).then((r) => r.rows);

  // Empresa C (modo COMUM: nenhum KDS com produto marcado) — K1 imprime no pronto (o "armado"), K2, K3, a tela de
  // entrega ENT e a impressora IMP_C. A loja adia a via da produção até o KDS.
  const TC = randomUUID();
  const UC = randomUUID();
  const UC2 = randomUUID();
  const [K1, K2, K3, ENT, IMP_C, IMP_OUTRA_LOJA, IMP_DESLIGADA] = Array.from({ length: 7 }, () => randomUUID());
  // Empresa E (modo ESTAÇÕES): A (marca o burger), DESP (despacho, imprime ao entregar), IMP_E (padrão da cozinha).
  const TE = randomUUID();
  const UE = randomUUID();
  const COZ_E = randomUUID();
  const [A, DESP, IMP_E] = Array.from({ length: 3 }, () => randomUUID());
  const empresas = [TC, TE];
  const prod: Record<string, any> = {};
  let senhaSeq = 500;

  const kds = (id: string, t: string, u: string, nome: string, extra: Record<string, any> = {}) =>
    q(
      `insert into equipamento (id, tenant_id, unidade_id, nome, token, tipo, ativo, escopo, imprime_ao_avancar, imprime_no_status, impressora_destino_id)
       values ($1,$2,$3,$4,$5,'kds',true,$6,$7,$8,$9)`,
      [id, t, u, nome, 'tok-' + id, extra.escopo ?? 'producao', !!extra.imprime, extra.etapa ?? 'pronto', extra.impressora ?? null],
    );
  const impressora = (id: string, t: string, u: string, nome: string, o: { padrao?: boolean; ativo?: boolean } = {}) =>
    q(
      `insert into equipamento (id, tenant_id, unidade_id, nome, token, tipo, conexao, host, faz_producao, padrao, ativo)
       values ($1,$2,$3,$4,$5,'impressora','rede','10.0.0.9',true,$6,$7)`,
      [id, t, u, nome, 'tok-' + id, !!o.padrao, o.ativo ?? true],
    );
  const produto = async (t: string, nome: string, setor: string | null, kdsId?: string) => {
    const id = randomUUID();
    await q(`insert into produto (id, tenant_id, nome, vai_para_producao, setor_producao_id) values ($1,$2,$3,true,$4)`, [id, t, nome, setor]);
    if (kdsId) await q(`insert into produto_destino_producao (tenant_id, produto_id, equipamento_id) values ($1,$2,$3)`, [t, id, kdsId]);
    const [row] = await db.select().from(schema.produto).where(eq(schema.produto.id, id));
    return row;
  };
  const vender = async (t: string, u: string, itens: any[], origem = 'balcao') => {
    const senha = ++senhaSeq;
    const cmd = (await q(`insert into comanda (tenant_id, unidade_id, status, senha, senha_prefixo) values ($1,$2,'fechada',$3,'B') returning id`, [t, u, senha]))[0].id;
    await db.transaction((tx: any) =>
      svc.criarPedidos(
        tx,
        { tenantId: t, unidadeId: u, comandaId: cmd, origem, senha, senhaPrefixo: 'B' },
        itens.map((p) => ({ produto: p, descricao: p.nome, quantidade: 1, opcaoIds: [] }) as any),
      ),
    );
    const cartoes = await q(
      `select id, destino_tipo, destino_equipamento_id as destino, setor_id from producao_pedido where comanda_id = $1 order by destino_tipo`,
      [cmd],
    );
    return { cmd, cartoes, cartao: cartoes.find((c: any) => c.destino_tipo === 'kds')?.id as string };
  };
  const ler = async (id: string) =>
    (await q(`select status, destino_equipamento_id as destino, iniciado_em, pronto_em from producao_pedido where id = $1`, [id]))[0];
  const jobs = async (cmd: string) =>
    q(`select equipamento_id as eq, pedido_id from impressao_job where comanda_id = $1 and via = 'producao' order by criado_em`, [cmd]);
  const naFila = async (t: string, u: string, k: string, id: string) =>
    ((await svc.filaKds(t, { unidadeId: u, equipamentoId: k })) as any).pedidos.some((c: any) => c.id === id);

  beforeAll(async () => {
    process.env.EDGE_MODE = 'true'; // caminho do servidor local (edgeAtivo = false): as vias e os tickets são gravados aqui
    pool = new Pool({ connectionString: URL_PG });
    db = drizzle(pool, { schema });
    const auditoria = { registrar: async () => undefined } as any;
    svc = new ProducaoPedidoService(db, auditoria, { emit: () => true } as any);
    equip = new EquipamentoService(db, auditoria);
    await q(`insert into empresa (id, nome) values ($1,'kds comum'), ($2,'kds estacoes')`, [TC, TE]);
    await q(`insert into unidade (id, tenant_id, nome) values ($1,$3,'Loja C'), ($2,$3,'Loja C2'), ($4,$5,'Loja E')`, [UC, UC2, TC, UE, TE]);
    await q(`insert into setor (id, tenant_id, unidade_id, nome) values ($1,$2,$3,'Cozinha')`, [COZ_E, TE, UE]);

    await impressora(IMP_C, TC, UC, 'Cozinha C');
    await impressora(IMP_OUTRA_LOJA, TC, UC2, 'Cozinha da loja 2');
    await impressora(IMP_DESLIGADA, TC, UC, 'Desligada', { ativo: false });
    await kds(K1, TC, UC, 'KDS 1', { imprime: true, etapa: 'pronto', impressora: IMP_C });
    await kds(K2, TC, UC, 'KDS 2');
    await kds(K3, TC, UC, 'KDS 3');
    await kds(ENT, TC, UC, 'Retirada', { escopo: 'entrega' });
    await q(`insert into delivery_config (tenant_id, unidade_id, adiar_producao_ate_kds) values ($1,$2,true)`, [TC, UC]);
    prod.lanche = await produto(TC, 'Lanche', null);

    await impressora(IMP_E, TE, UE, 'Cozinha E', { padrao: true });
    await kds(A, TE, UE, 'Chapa');
    await kds(DESP, TE, UE, 'Despacho', { escopo: 'despacho', imprime: true, etapa: 'entregue', impressora: IMP_E });
    prod.burger = await produto(TE, 'Burger', COZ_E, A);
    prod.refri = await produto(TE, 'Refri', COZ_E, DESP);
  });

  afterAll(async () => {
    if (antes === undefined) delete process.env.EDGE_MODE;
    else process.env.EDGE_MODE = antes;
    if (!pool) return;
    for (const t of ['impressao_job', 'producao_pedido_item', 'producao_pedido', 'comanda_item', 'comanda', 'produto_destino_producao', 'produto', 'delivery_config', 'modulo_ativacao', 'equipamento', 'setor', 'unidade'])
      await q(`delete from ${t} where tenant_id = any($1::uuid[])`, [empresas]).catch(() => undefined);
    await q(`delete from empresa where id = any($1::uuid[])`, [empresas]).catch(() => undefined);
    await pool.end();
  });

  it('R8: com a etapa que a tela viu, o toque duplo e a tela velha não pulam etapa', async () => {
    const v = await vender(TC, UC, [prod.lanche]);
    expect(await svc.avancar(TC, ATOR.id, v.cartao, undefined, K2, 'recebido')).toMatchObject({ status: 'preparo' });
    // O segundo toque do toque duplo chega depois do primeiro gravar: antes virava "pronto".
    await expect(svc.avancar(TC, ATOR.id, v.cartao, undefined, K2, 'recebido')).rejects.toThrow(/já mudou de etapa/);
    expect((await ler(v.cartao)).status).toBe('preparo');
    // Dois aparelhos ao mesmo tempo com a mesma etapa: um avança, o outro recebe 409.
    const r = await Promise.allSettled([
      svc.avancar(TC, ATOR.id, v.cartao, undefined, K2, 'preparo'),
      svc.avancar(TC, ATOR.id, v.cartao, undefined, K2, 'preparo'),
    ]);
    expect(r.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    expect((await ler(v.cartao)).status).toBe('pronto');
    // Sem `de` (tela antiga ainda no cache): o comportamento de antes — avança a partir da etapa atual.
    expect(await svc.avancar(TC, ATOR.id, v.cartao, undefined, ENT)).toMatchObject({ status: 'entregue' });
  });

  it('R4: "Entregar" só no KDS de entrega — pelo cadastro, nunca pelo que a tela manda', async () => {
    const v = await vender(TC, UC, [prod.lanche]);
    await svc.avancar(TC, ATOR.id, v.cartao, undefined, K2, 'recebido');
    await svc.avancar(TC, ATOR.id, v.cartao, undefined, K2, 'preparo');
    // A tela de cozinha mandando 'entrega' (o que a tela fazia sempre) não conclui mais.
    await expect(svc.avancar(TC, ATOR.id, v.cartao, 'entrega', K2, 'pronto')).rejects.toThrow(/KDS de entrega/);
    await expect(svc.avancar(TC, ATOR.id, v.cartao, 'entrega', undefined, 'pronto')).rejects.toThrow(/KDS de entrega/);
    expect((await ler(v.cartao)).status).toBe('pronto');
    expect(await svc.avancar(TC, ATOR.id, v.cartao, undefined, ENT, 'pronto')).toMatchObject({ status: 'entregue' });
  });

  it('R1: "imprimir só ao avançar" no modo comum — a venda espera e o ticket sai UMA vez no avanço', async () => {
    // Pelo KDS que imprime (K1).
    const v = await vender(TC, UC, [prod.lanche]);
    expect(v.cartoes).toHaveLength(1);
    expect(v.cartoes[0]).toMatchObject({ destino: null, setor_id: null }); // o cartão comum: sem destino nem setor
    expect(await jobs(v.cmd)).toHaveLength(0); // adiado: a loja tem KDS "armado"
    await svc.avancar(TC, ATOR.id, v.cartao, undefined, K1, 'recebido');
    expect(await jobs(v.cmd)).toHaveLength(0); // só no pronto
    await svc.avancar(TC, ATOR.id, v.cartao, undefined, K1, 'preparo');
    expect(await jobs(v.cmd)).toEqual([{ eq: IMP_C, pedido_id: v.cartao }]);

    // Por um KDS que não imprime (K2) e pela tela sem KDS escolhido: o ticket sai pelo KDS armado da loja, uma vez.
    for (const tocou of [K2, undefined]) {
      const w = await vender(TC, UC, [prod.lanche]);
      await svc.avancar(TC, ATOR.id, w.cartao, undefined, tocou, 'recebido');
      await svc.avancar(TC, ATOR.id, w.cartao, undefined, tocou, 'preparo');
      expect(await jobs(w.cmd)).toEqual([{ eq: IMP_C, pedido_id: w.cartao }]);
    }
  });

  it('R10: a impressora do ticket é conferida ao salvar e, no avanço, a inválida cai na do setor (sem setor: não imprime)', async () => {
    await expect(equip.setImpressaoEtapa(TC, K2, { imprimeAoAvancar: true, imprimeNoStatus: 'pronto', impressoraDestinoId: IMP_OUTRA_LOJA })).rejects.toThrow(/outra loja/);
    await expect(equip.setImpressaoEtapa(TC, K2, { imprimeAoAvancar: true, imprimeNoStatus: 'pronto', impressoraDestinoId: IMP_DESLIGADA })).rejects.toThrow(/desligada/);
    await expect(equip.setImpressaoEtapa(TC, K2, { imprimeAoAvancar: true, imprimeNoStatus: 'pronto', impressoraDestinoId: K3 })).rejects.toThrow(/não encontrada/);
    await expect(equip.setImpressaoEtapa(TC, K2, { imprimeAoAvancar: true, imprimeNoStatus: 'pronto', impressoraDestinoId: 'x' })).rejects.toThrow(/da lista/);
    expect((await q(`select imprime_ao_avancar from equipamento where id = $1`, [K2]))[0].imprime_ao_avancar).toBe(false);
    // Gravada antes desta regra: a impressora desligou depois. O ticket não vai para ela.
    await q(`update equipamento set impressora_destino_id = $2 where id = $1`, [K1, IMP_DESLIGADA]);
    const v = await vender(TC, UC, [prod.lanche]);
    await svc.avancar(TC, ATOR.id, v.cartao, undefined, K1, 'recebido');
    await svc.avancar(TC, ATOR.id, v.cartao, undefined, K1, 'preparo');
    expect((await jobs(v.cmd)).map((j: any) => j.eq)).not.toContain(IMP_DESLIGADA);
    await q(`update equipamento set impressora_destino_id = $2 where id = $1`, [K1, IMP_C]);
  });

  it('R3: a tela de entrega não é "vai para"; o cadastro antigo que aponta para ela vale como "termina aqui"', async () => {
    await expect(svc.setFluxoDoKds(TC, K2, { proximoKdsId: ENT }, ATOR)).rejects.toThrow(/entrega/);
    await expect(equip.setProximoKds(TC, K2, ENT)).rejects.toThrow(/entrega/);
    await q(`update equipamento set proximo_kds_id = $2 where id = $1`, [K3, ENT]); // gravado antes da regra
    const v = await vender(TC, UC, [prod.lanche]);
    await svc.avancar(TC, ATOR.id, v.cartao, undefined, K3, 'recebido');
    expect(await svc.avancar(TC, ATOR.id, v.cartao, undefined, K3, 'preparo')).toMatchObject({ status: 'pronto' });
    expect(await ler(v.cartao)).toMatchObject({ status: 'pronto', destino: null }); // não foi para a tela de entrega
    await q(`update equipamento set proximo_kds_id = null where id = $1`, [K3]);
  });

  it('R6: corrente no modo comum — o KDS 2 só vê o cartão depois que o KDS 1 termina', async () => {
    await svc.setFluxoDoKds(TC, K1, { proximoKdsId: K2 }, ATOR);
    const v = await vender(TC, UC, [prod.lanche]);
    expect(await naFila(TC, UC, K1, v.cartao)).toBe(true);
    expect(await naFila(TC, UC, K2, v.cartao)).toBe(false); // antes aparecia aqui e o KDS 2 podia concluir
    expect(await naFila(TC, UC, K3, v.cartao)).toBe(true); // fora da corrente: como sempre
    await svc.avancar(TC, ATOR.id, v.cartao, undefined, K1, 'recebido');
    expect(await svc.avancar(TC, ATOR.id, v.cartao, undefined, K1, 'preparo')).toMatchObject({ passouPara: K2 });
    expect(await naFila(TC, UC, K2, v.cartao)).toBe(true);
    expect(await naFila(TC, UC, K1, v.cartao)).toBe(false);
  });

  it('R9: KDS desligado no meio da corrente é pulado (K1 → K2 desligado → K3)', async () => {
    await svc.setFluxoDoKds(TC, K2, { proximoKdsId: K3 }, ATOR);
    await q(`update equipamento set ativo = false where id = $1`, [K2]);
    const v = await vender(TC, UC, [prod.lanche]);
    expect(await naFila(TC, UC, K3, v.cartao)).toBe(false); // o K3 recebe do K1 (pela corrente de verdade)
    await svc.avancar(TC, ATOR.id, v.cartao, undefined, K1, 'recebido');
    expect(await svc.avancar(TC, ATOR.id, v.cartao, undefined, K1, 'preparo')).toMatchObject({ passouPara: K3 });
    expect(await ler(v.cartao)).toMatchObject({ status: 'recebido', destino: K3 });
    await q(`update equipamento set ativo = true where id = $1`, [K2]);
  });

  it('R5: o despacho com "imprimir ao entregar" imprime o pedido inteiro na ação Entregue', async () => {
    const v = await vender(TE, UE, [prod.burger, prod.refri], 'delivery');
    const chapa = v.cartoes.find((c: any) => c.destino === A).id;
    await svc.avancar(TE, ATOR.id, chapa, undefined, A, 'recebido');
    await svc.avancar(TE, ATOR.id, chapa, undefined, A, 'preparo');
    await svc.acaoDespacho(TE, ATOR as any, DESP, { comandaId: v.cmd, acao: 'pronto' });
    const antesDeEntregar = (await jobs(v.cmd)).filter((j: any) => j.eq === IMP_E && j.pedido_id !== null).length;
    await svc.acaoDespacho(TE, ATOR as any, DESP, { comandaId: v.cmd, acao: 'entregue' });
    expect((await jobs(v.cmd)).filter((j: any) => j.eq === IMP_E).length).toBe(antesDeEntregar + 1);
  });

  it('R2: módulo KDS desligado — sem estações e sem cartão de KDS: os itens saem em papel na padrão', async () => {
    const ligado = await vender(TE, UE, [prod.burger]);
    expect(ligado.cartoes.find((c: any) => c.destino_tipo === 'kds')?.destino).toBe(A);
    expect((await jobs(ligado.cmd)).map((j: any) => j.eq)).not.toContain(IMP_E); // o KDS substitui o papel

    await q(`insert into modulo_ativacao (tenant_id, unidade_id, modulo, ativo) values ($1,$2,'kds',false)`, [TE, UE]);
    const desligado = await vender(TE, UE, [prod.burger]);
    expect(desligado.cartoes.some((c: any) => c.destino === A)).toBe(false);
    expect((await jobs(desligado.cmd)).map((j: any) => j.eq)).toContain(IMP_E);

    // E a loja que adia a via até o KDS: com o módulo desligado, a via sai na venda.
    await q(`insert into modulo_ativacao (tenant_id, unidade_id, modulo, ativo) values ($1,$2,'kds',false)`, [TC, UC]);
    await impressora(randomUUID(), TC, UC, 'Padrão C', { padrao: true });
    const c = await vender(TC, UC, [prod.lanche]);
    expect((await jobs(c.cmd)).length).toBeGreaterThan(0);
    await q(`delete from modulo_ativacao where tenant_id = any($1::uuid[])`, [empresas]);
  });
});
