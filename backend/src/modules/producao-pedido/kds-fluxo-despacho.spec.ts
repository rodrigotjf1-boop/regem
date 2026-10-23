import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { eq } from 'drizzle-orm';
import * as bcrypt from 'bcryptjs';
import * as schema from '../../db/schema';
import { ProducaoPedidoService } from './producao-pedido.service';
import { EquipamentoService } from '../equipamento/equipamento.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

// COZINHA EM ESTAÇÕES, entrega 2 (dono, 21/10/2026): o fluxo entre KDS e o despacho.
//  • "Quando ficar pronto, vai para": o cartão passa para o KDS seguinte no PRONTO (antes pulava no primeiro toque) e
//    começa lá como recebido; o toque atrasado da tela anterior não mexe no cartão; o início do preparo é o primeiro;
//  • o lugar no fluxo se grava com as regras (KDS ligado da mesma loja, sem círculo; o despacho não manda adiante) — na
//    gaveta do KDS e no cadastro do equipamento;
//  • o KDS de despacho vê o pedido inteiro com o andamento de cada estação; "Despachar" só com todas prontas — com estação
//    faltando, só com a senha de um gestor ATIVO (excluído, bloqueado ou de nível baixo não libera), e fica na auditoria;
//  • o pronto do pedido (canal) sai uma vez, no despacho — nunca na passagem entre estações.
const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('kds-fluxo-despacho.spec: sem TEST_PG_URL — PULADO');

jest.setTimeout(90_000);

descrever('Cozinha em estações — fluxo entre KDS e despacho (Postgres)', () => {
  let pool: Pool;
  let db: any;
  let svc: ProducaoPedidoService;
  let equip: EquipamentoService;
  const auditado: any[] = [];
  const emitidos: { nome: string; dado: any }[] = [];
  const antes = process.env.EDGE_MODE;
  const T = randomUUID();
  const OUTRA = randomUUID();
  const U = randomUUID();
  const U2 = randomUUID();
  const COZ = randomUUID();
  const [CHAPA, MONTA, FRITA, DESP, BAR, DESLIG, OUTRA_LOJA, IMP] = Array.from({ length: 8 }, () => randomUUID());
  const ATOR = { id: randomUUID(), perfil: 'execucao' };
  const q = (s: string, p: any[] = []) => pool.query(s, p).then((r) => r.rows);
  const p: Record<string, any> = {};

  const produto = async (nome: string, kds: string | null) => {
    const id = randomUUID();
    await q(`insert into produto (id, tenant_id, nome, vai_para_producao, setor_producao_id) values ($1,$2,$3,true,$4)`, [id, T, nome, COZ]);
    if (kds) await q(`insert into produto_destino_producao (tenant_id, produto_id, equipamento_id) values ($1,$2,$3)`, [T, id, kds]);
    const [row] = await db.select().from(schema.produto).where(eq(schema.produto.id, id));
    return row;
  };
  let senhaSeq = 100;
  const vender = async (itens: any[], origem = 'delivery') => {
    const senha = ++senhaSeq;
    const cmd = (await q(`insert into comanda (tenant_id, unidade_id, status, senha, senha_prefixo) values ($1,$2,'fechada',$3,'D') returning id`, [T, U, senha]))[0].id;
    await db.transaction((tx: any) =>
      svc.criarPedidos(
        tx,
        { tenantId: T, unidadeId: U, comandaId: cmd, origem, senha, senhaPrefixo: 'D' },
        itens.map((prod) => ({ produto: prod, descricao: prod.nome, quantidade: 1, opcaoIds: [] }) as any),
      ),
    );
    const cartoes = await q(`select id, destino_equipamento_id as destino from producao_pedido where comanda_id = $1 and destino_tipo = 'kds'`, [cmd]);
    return { cmd, cartoes };
  };
  const cartao = (v: any, destino: string) => v.cartoes.find((c: any) => c.destino === destino).id as string;
  const ler = async (id: string) =>
    (await q(`select destino_equipamento_id as destino, status, estacoes, iniciado_em, pronto_em from producao_pedido where id = $1`, [id]))[0];
  const pedidoNoDespacho = async (cmd: string, canal?: string) =>
    ((await svc.filaDespacho(T, DESP, { unidadeId: U, canal })) as any).pedidos.find((x: any) => x.comandaId === cmd);
  const naFila = async (kds: string, cmd: string) =>
    ((await svc.filaKds(T, { unidadeId: U, equipamentoId: kds })) as any).pedidos.filter((c: any) => c.comandaId === cmd).map((c: any) => c.id);
  // Avança o cartão na estação até ele sair dela (recebido → preparo → pronto).
  const terminar = async (id: string, kds: string) => {
    await svc.avancar(T, ATOR.id, id, 'entrega', kds);
    return svc.avancar(T, ATOR.id, id, 'entrega', kds);
  };

  beforeAll(async () => {
    process.env.EDGE_MODE = 'true'; // caminho do servidor local (edgeAtivo = false): as vias são gravadas aqui
    pool = new Pool({ connectionString: URL_PG });
    db = drizzle(pool, { schema });
    const auditoria = { registrar: async (e: any) => void auditado.push(e) } as any;
    svc = new ProducaoPedidoService(db, auditoria, { emit: (nome: string, dado: any) => (emitidos.push({ nome, dado }), true) } as any);
    equip = new EquipamentoService(db, auditoria);
    await q(`insert into empresa (id, nome) values ($1,'teste fluxo'), ($2,'outra empresa')`, [T, OUTRA]);
    await q(`insert into unidade (id, tenant_id, nome) values ($1,$3,'Loja'), ($2,$3,'Loja 2')`, [U, U2, T]);
    await q(`insert into setor (id, tenant_id, unidade_id, nome) values ($1,$2,$3,'Cozinha')`, [COZ, T, U]);
    const kds = (id: string, nome: string, unidade = U, ativo = true) =>
      q(`insert into equipamento (id, tenant_id, unidade_id, nome, token, tipo, ativo) values ($1,$2,$3,$4,$5,'kds',$6)`, [id, T, unidade, nome, 'tok-' + id, ativo]);
    await kds(CHAPA, 'Chapa');
    await kds(MONTA, 'Montagem');
    await kds(FRITA, 'Fritadeira');
    await kds(DESP, 'Despacho');
    await kds(BAR, 'Bar');
    await kds(DESLIG, 'Desligado', U, false);
    await kds(OUTRA_LOJA, 'Chapa da loja 2', U2);
    await q(`insert into equipamento (id, tenant_id, unidade_id, nome, token, tipo, conexao, host, faz_producao, padrao, ativo)
             values ($1,$2,$3,'Expedição','tok-imp','impressora','rede','10.0.0.9',true,false,true)`, [IMP, T, U]);
    p.burger = await produto('Burger', CHAPA);
    p.batata = await produto('Batata', FRITA);
    p.refri = await produto('Refri', DESP); // bebida: direto ao despacho
    p.agua = await produto('Água', DESP);
    p.suco = await produto('Suco', BAR); // o bar termina ali
    // Quem libera o "Despachar assim mesmo": presidente, gerente ou supervisão com acesso (dono, 23/10/2026).
    const gerente = (await q(`insert into funcao (tenant_id, nome, categoria) values ($1,'Gerente','gerente') returning id`, [T]))[0].id;
    const supervisao = (await q(`insert into funcao (tenant_id, nome, categoria) values ($1,'Supervisor','supervisao') returning id`, [T]))[0].id;
    const atendente = (await q(`insert into funcao (tenant_id, nome, categoria) values ($1,'Atendente','execucao') returning id`, [T]))[0].id;
    const restrito = (await q(`insert into perfil_acesso (tenant_id, nome, nivel) values ($1,'Restrito','execucao') returning id`, [T]))[0].id;
    const pessoa = (nome: string, funcao: string, senha: string, o: { saiu?: boolean; bloqueado?: boolean; perfil?: string } = {}) =>
      q(
        `insert into colaborador (tenant_id, nome, funcao_id, senha_hash, perfil_acesso_id, status, deleted_at)
         values ($1, $2, $3, $4, $5, $6, case when $7::boolean then now() end)`,
        [T, nome, funcao, bcrypt.hashSync(senha, 4), o.perfil ?? null, o.bloqueado ? 'bloqueado' : 'ativo', !!o.saiu],
      );
    await pessoa('Gerente ativo', gerente, 'gerente-123');
    await pessoa('Gerente que saiu', gerente, 'saiu-123', { saiu: true });
    await pessoa('Gerente bloqueado', gerente, 'bloq-123', { bloqueado: true });
    await pessoa('Atendente', atendente, 'atend-123');
    await pessoa('Gerente rebaixado', gerente, 'rebaixado-123', { perfil: restrito });
    await pessoa('Supervisora', supervisao, 'super-123');
    await pessoa('Supervisora que saiu', supervisao, 'super-saiu-123', { saiu: true });
  });

  afterAll(async () => {
    if (antes === undefined) delete process.env.EDGE_MODE;
    else process.env.EDGE_MODE = antes;
    if (!pool) return;
    for (const t of ['impressao_job', 'producao_pedido_item', 'producao_pedido', 'comanda_item', 'comanda', 'produto_destino_producao', 'produto', 'equipamento', 'colaborador', 'perfil_acesso', 'funcao', 'setor', 'unidade'])
      await q(`delete from ${t} where tenant_id = any($1::uuid[])`, [[T, OUTRA]]).catch(() => undefined);
    await q(`delete from empresa where id = any($1::uuid[])`, [[T, OUTRA]]).catch(() => undefined);
    await pool.end();
  });

  it('o lugar no fluxo: grava com as regras, ausente mantém, audita e recusa o que não serve', async () => {
    expect(await svc.setFluxoDoKds(T, CHAPA, { papel: 'estacao', proximoKdsId: MONTA }, ATOR)).toMatchObject({ papel: 'estacao', proximoKdsId: MONTA, mudou: true });
    await svc.setFluxoDoKds(T, MONTA, { proximoKdsId: DESP }, ATOR);
    await svc.setFluxoDoKds(T, FRITA, { proximoKdsId: DESP }, ATOR);
    expect(await svc.setFluxoDoKds(T, DESP, { papel: 'despacho' }, ATOR)).toMatchObject({ papel: 'despacho', proximoKdsId: null, mudou: true });
    expect(await svc.setFluxoDoKds(T, CHAPA, {}, ATOR)).toMatchObject({ papel: 'estacao', proximoKdsId: MONTA, mudou: false });

    const telas: any[] = await svc.telasDeKds(T, U);
    expect(telas.find((t) => t.id === CHAPA)).toMatchObject({ escopo: 'producao', proximoKdsId: MONTA });
    expect(telas.find((t) => t.id === DESP)).toMatchObject({ escopo: 'despacho', proximoKdsId: null });

    await expect(svc.setFluxoDoKds(T, CHAPA, { proximoKdsId: CHAPA })).rejects.toThrow(/ele mesmo/);
    await expect(svc.setFluxoDoKds(T, MONTA, { proximoKdsId: CHAPA })).rejects.toThrow('círculo: Montagem → Chapa → Montagem');
    await expect(svc.setFluxoDoKds(T, CHAPA, { proximoKdsId: OUTRA_LOJA })).rejects.toThrow(/outra loja/);
    await expect(svc.setFluxoDoKds(T, CHAPA, { proximoKdsId: DESLIG })).rejects.toThrow(/desligado/);
    await expect(svc.setFluxoDoKds(T, CHAPA, { proximoKdsId: 'nao-e-uuid' })).rejects.toThrow(/da lista/);
    await expect(svc.setFluxoDoKds(T, DESP, { proximoKdsId: BAR })).rejects.toThrow(/última etapa/);
    await expect(svc.setFluxoDoKds(T, CHAPA, { papel: 'cozinha' })).rejects.toThrow(/estação de preparo ou KDS de despacho/);
    await expect(svc.setFluxoDoKds(T, DESLIG, { proximoKdsId: MONTA })).rejects.toThrow(/desligado/);
    await expect(svc.setFluxoDoKds(OUTRA, CHAPA, {})).rejects.toThrow(/KDS não encontrado/);
    expect((await svc.telasDeKds(T, U) as any[]).find((t) => t.id === MONTA).proximoKdsId).toBe(DESP); // a recusa não mexeu

    const aud = auditado.filter((a) => a.acao === 'configurou_fluxo_kds');
    expect(aud).toHaveLength(4); // a 5ª não mudou nada
    expect(aud[0]).toMatchObject({
      entidadeId: CHAPA,
      detalhe: { kds: 'Chapa', antes: { papel: 'estacao', vaiPara: null }, depois: { papel: 'estacao', vaiPara: 'Montagem' } },
    });
    expect(aud[3]).toMatchObject({ entidadeId: DESP, detalhe: { depois: { papel: 'despacho', vaiPara: null } } });
  });

  it('o cadastro do equipamento segue as mesmas regras (sem círculo; o despacho não manda adiante)', async () => {
    await expect(equip.setProximoKds(T, MONTA, CHAPA)).rejects.toThrow(/círculo/);
    await expect(equip.setProximoKds(T, CHAPA, DESLIG)).rejects.toThrow(/desligado/);
    await expect(equip.setProximoKds(T, DESP, BAR)).rejects.toThrow(/última etapa/);
    // Virar despacho pelo cadastro tira o "vai para".
    await svc.setFluxoDoKds(T, BAR, { proximoKdsId: DESP });
    await equip.atualizar(T, BAR, { escopo: 'despacho' });
    expect((await q(`select escopo, proximo_kds_id from equipamento where id = $1`, [BAR]))[0]).toEqual({ escopo: 'despacho', proximo_kds_id: null });
    await equip.atualizar(T, BAR, { escopo: 'producao' }); // o bar volta a ser estação que termina ali
    expect((await q(`select escopo, proximo_kds_id from equipamento where id = $1`, [BAR]))[0]).toEqual({ escopo: 'producao', proximo_kds_id: null });
  });

  it('com o servidor da loja ligado, a nuvem não ajusta o fluxo (o ajuste é no servidor dele)', async () => {
    await q(`create table if not exists edge_heartbeat (id uuid primary key default gen_random_uuid(),
             tenant_id uuid, unidade_id uuid, recebido_em timestamptz not null default now())`);
    await q(`insert into edge_heartbeat (tenant_id, unidade_id) values ($1, $2)`, [T, U]);
    delete process.env.EDGE_MODE; // caminho da NUVEM
    try {
      await expect(svc.setFluxoDoKds(T, BAR, { proximoKdsId: DESP })).rejects.toThrow(/servidor da loja/);
    } finally {
      process.env.EDGE_MODE = 'true';
      await q(`delete from edge_heartbeat where tenant_id = $1`, [T]);
    }
  });

  it('a passagem no PRONTO: o cartão anda de estação em estação e começa como recebido; o toque atrasado não mexe', async () => {
    const v = await vender([p.burger]);
    const id = cartao(v, CHAPA);
    await svc.avancar(T, ATOR.id, id, 'entrega', CHAPA); // recebido → preparo: fica na Chapa (antes pulava aqui)
    expect(await ler(id)).toMatchObject({ destino: CHAPA, status: 'preparo' });
    const iniciado = (await ler(id)).iniciado_em;
    expect(iniciado).not.toBeNull();

    const desde = emitidos.length;
    expect(await svc.avancar(T, ATOR.id, id, 'entrega', CHAPA)).toMatchObject({ status: 'recebido', passouPara: MONTA });
    const naMontagem = await ler(id);
    expect(naMontagem).toMatchObject({ destino: MONTA, status: 'recebido', pronto_em: null });
    expect(naMontagem.estacoes).toEqual([{ kds: CHAPA, pronto: expect.any(String) }]);
    // Não é o pronto do pedido: nada vai ao canal. Para a Montagem é um cartão novo (apita lá).
    const novos = emitidos.slice(desde);
    expect(novos.filter((e) => e.nome === 'producao.pronto')).toHaveLength(0);
    expect(novos).toContainEqual({ nome: 'producao.evento', dado: expect.objectContaining({ tipo: 'novo', pedidoId: id, destinoEquipamentoId: MONTA }) });

    // A tela da Chapa estava velha: o toque atrasado não avança o cartão na Montagem.
    await expect(svc.avancar(T, ATOR.id, id, 'entrega', CHAPA)).rejects.toThrow(/outro KDS/);
    expect(await ler(id)).toMatchObject({ destino: MONTA, status: 'recebido' });
    expect(await naFila(CHAPA, v.cmd)).toEqual([]);
    expect(await naFila(MONTA, v.cmd)).toEqual([id]);

    await svc.avancar(T, ATOR.id, id, 'entrega', MONTA);
    expect((await ler(id)).iniciado_em).toEqual(iniciado); // o começo do preparo é o da Chapa
    await svc.avancar(T, ATOR.id, id, 'entrega', MONTA); // pronto → o despacho
    const noDespacho = await ler(id);
    expect(noDespacho).toMatchObject({ destino: DESP, status: 'recebido', pronto_em: null });
    expect(noDespacho.estacoes.map((e: any) => e.kds)).toEqual([CHAPA, MONTA]);
  });

  it('termina aqui: o pronto fica na estação e o pedido fica pronto; o "vai para" desligado vale como termina aqui', async () => {
    const v = await vender([p.suco]);
    const id = cartao(v, BAR);
    const desde = emitidos.length;
    expect(await terminar(id, BAR)).toMatchObject({ status: 'pronto' });
    expect(await ler(id)).toMatchObject({ destino: BAR, status: 'pronto' });
    expect(emitidos.slice(desde).filter((e) => e.nome === 'producao.pronto' && e.dado.comandaId === v.cmd)).toHaveLength(1);

    // O KDS seguinte foi desligado depois do ajuste: o cartão não vai para uma tela que ninguém vê.
    await q(`update equipamento set proximo_kds_id = $1 where id = $2`, [DESLIG, BAR]);
    try {
      const w = await vender([p.suco]);
      expect(await terminar(cartao(w, BAR), BAR)).toMatchObject({ status: 'pronto' });
      expect(await ler(cartao(w, BAR))).toMatchObject({ destino: BAR, status: 'pronto' });
    } finally {
      await q(`update equipamento set proximo_kds_id = null where id = $1`, [BAR]);
    }
  });

  it('o despacho vê o pedido inteiro com o andamento; Despachar só com todas as estações; o pronto sai uma vez', async () => {
    const v = await vender([p.burger, p.batata, p.refri]);
    let f = await pedidoNoDespacho(v.cmd);
    expect(f).toMatchObject({ situacao: 'preparando', status: 'preparo' });
    expect([...f.falta].sort()).toEqual(['Chapa', 'Fritadeira']);
    expect(f.estacoes.map((e: any) => [e.nome, e.estado]).sort()).toEqual([['Chapa', 'na_fila'], ['Fritadeira', 'na_fila']]);
    expect(f.itens.map((i: any) => i.descricao).sort()).toEqual(['Batata', 'Burger', 'Refri']); // a bebida já está aqui
    expect(await pedidoNoDespacho(v.cmd, 'balcao')).toBeUndefined(); // o filtro de canal vale no despacho
    await expect(svc.acaoDespacho(T, ATOR, DESP, { comandaId: v.cmd, acao: 'pronto' })).rejects.toThrow(/Falta: /);

    await svc.avancar(T, ATOR.id, cartao(v, CHAPA), 'entrega', CHAPA); // a Chapa começa
    f = await pedidoNoDespacho(v.cmd);
    expect(f.estacoes.find((e: any) => e.nome === 'Chapa')).toMatchObject({ estado: 'preparando', desde: expect.any(String) });
    await svc.avancar(T, ATOR.id, cartao(v, CHAPA), 'entrega', CHAPA); // → Montagem
    await terminar(cartao(v, CHAPA), MONTA); // → despacho
    await terminar(cartao(v, FRITA), FRITA); // → despacho
    f = await pedidoNoDespacho(v.cmd);
    expect(f).toMatchObject({ situacao: 'pronto_para_despachar', falta: [] });
    expect(f.estacoes.map((e: any) => e.nome).sort()).toEqual(['Chapa', 'Fritadeira', 'Montagem']);
    expect(f.estacoes.every((e: any) => e.estado === 'feito')).toBe(true);
    expect(await svc.comandaTodaPronta(T, v.cmd)).toBe(false); // esperando no despacho ainda não é pronto

    const desde = emitidos.length;
    expect(await svc.acaoDespacho(T, ATOR, DESP, { comandaId: v.cmd, acao: 'pronto' })).toMatchObject({ ok: true, cartoes: 3, forcado: false });
    expect(await svc.comandaTodaPronta(T, v.cmd)).toBe(true);
    expect(emitidos.slice(desde).filter((e) => e.nome === 'producao.pronto' && e.dado.comandaId === v.cmd)).toHaveLength(1);
    expect((await pedidoNoDespacho(v.cmd)).situacao).toBe('pronto');
    await expect(svc.acaoDespacho(T, ATOR, DESP, { comandaId: v.cmd, acao: 'pronto' })).rejects.toThrow(/já está pronto/);

    expect(await svc.acaoDespacho(T, ATOR, DESP, { comandaId: v.cmd, acao: 'entregue' })).toMatchObject({ situacao: 'entregue', cartoes: 3 });
    expect(await pedidoNoDespacho(v.cmd)).toBeUndefined();
    expect((await q(`select distinct status from producao_pedido where comanda_id = $1`, [v.cmd])).map((r: any) => r.status)).toEqual(['entregue']);
  });

  it('Despachar assim mesmo: só com a senha de um gestor com acesso, e fica na auditoria', async () => {
    const v = await vender([p.burger, p.refri]);
    const forcar = { comandaId: v.cmd, acao: 'pronto', forcar: true };
    await expect(svc.acaoDespacho(T, ATOR, DESP, forcar)).rejects.toThrow(/senha de autorização/);
    // Errada, de quem saiu (gerente ou supervisão), de quem está bloqueado, da execução e do gerente com perfil restrito:
    // nada libera.
    for (const senha of ['errada', 'saiu-123', 'super-saiu-123', 'bloq-123', 'atend-123', 'rebaixado-123'])
      await expect(svc.acaoDespacho(T, ATOR, DESP, { ...forcar, senha })).rejects.toThrow(/Senha de gestor inválida/);
    expect(await ler(cartao(v, CHAPA))).toMatchObject({ destino: CHAPA, status: 'recebido' });

    expect(await svc.acaoDespacho(T, ATOR, DESP, { ...forcar, senha: 'gerente-123' })).toMatchObject({ ok: true, forcado: true, cartoes: 2 });
    const veio = await ler(cartao(v, CHAPA));
    expect(veio).toMatchObject({ destino: DESP, status: 'pronto' });
    expect(veio.estacoes).toEqual([{ kds: CHAPA, pronto: expect.any(String), forcado: true }]);
    expect(auditado.filter((a) => a.acao === 'forcou_despacho_kds')).toEqual([
      expect.objectContaining({ entidadeId: DESP, atorId: ATOR.id, detalhe: expect.objectContaining({ kds: 'Despacho', faltavam: ['Chapa'], autorizadoPor: 'Gerente ativo' }) }),
    ]);
    expect((await pedidoNoDespacho(v.cmd)).estacoes).toEqual([expect.objectContaining({ nome: 'Chapa', estado: 'feito', forcado: true })]);
  });

  it('a senha da supervisão também libera (dono, 23/10/2026: presidente, gerente e supervisão)', async () => {
    const v = await vender([p.burger, p.refri]);
    expect(await svc.acaoDespacho(T, ATOR, DESP, { comandaId: v.cmd, acao: 'pronto', forcar: true, senha: 'super-123' })).toMatchObject({
      ok: true,
      forcado: true,
    });
    expect(auditado.filter((a) => a.acao === 'forcou_despacho_kds').at(-1)).toEqual(
      expect.objectContaining({ detalhe: expect.objectContaining({ autorizadoPor: 'Supervisora' }) }),
    );
  });

  it('estação que termina noutro lugar conta quando fica pronta; KDS que não é despacho, outra loja e pedido torto são recusados', async () => {
    const v = await vender([p.burger, p.suco]); // o burger vai ao despacho; o suco termina no bar
    let f = await pedidoNoDespacho(v.cmd);
    expect([...f.falta].sort()).toEqual(['Bar', 'Chapa']);
    await terminar(cartao(v, BAR), BAR);
    f = await pedidoNoDespacho(v.cmd);
    expect(f.falta).toEqual(['Chapa']);
    expect(f.estacoes.find((e: any) => e.nome === 'Bar')).toMatchObject({ estado: 'feito' });

    await expect(svc.acaoDespacho(T, ATOR, CHAPA, { comandaId: v.cmd, acao: 'pronto' })).rejects.toThrow(/não é de despacho/);
    await expect(svc.filaDespacho(T, CHAPA, { unidadeId: U })).rejects.toThrow(/não é de despacho/);
    await expect(svc.acaoDespacho(T, { id: ATOR.id, perfil: 'gerente' }, DESP, { comandaId: v.cmd, acao: 'pronto' }, U2)).rejects.toThrow(/não encontrado/);
    await expect(svc.filaDespacho(T, DESP, { unidadeId: U2 })).rejects.toThrow(/não encontrado/);
    await expect(svc.acaoDespacho(T, ATOR, DESP, { comandaId: 'x', acao: 'pronto' })).rejects.toThrow(/Pedido inválido/);
    await expect(svc.acaoDespacho(T, ATOR, DESP, { comandaId: v.cmd, acao: 'sumir' })).rejects.toThrow(/Ação inválida/);
    await expect(svc.acaoDespacho(T, ATOR, DESP, { comandaId: v.cmd, acao: 'entregue' })).rejects.toThrow(/Despache o pedido antes/);
  });

  it('venda desfeita: o despacho tira o pedido da fila em vez de despachar', async () => {
    const v = await vender([p.burger, p.refri]);
    await q(`update comanda set status = 'cancelada' where id = $1`, [v.cmd]);
    await expect(svc.acaoDespacho(T, ATOR, DESP, { comandaId: v.cmd, acao: 'pronto' })).rejects.toThrow(/cancelado/);
    expect((await q(`select distinct status from producao_pedido where comanda_id = $1`, [v.cmd])).map((r: any) => r.status)).toEqual(['cancelado']);
    expect(await pedidoNoDespacho(v.cmd)).toMatchObject({ situacao: 'cancelado', status: 'cancelado' });
  });

  it('o despacho imprime o pedido inteiro num ticket só, sem o item tirado da comanda', async () => {
    await q(`update equipamento set imprime_ao_avancar = true, imprime_no_status = 'pronto', impressora_destino_id = $1 where id = $2`, [IMP, DESP]);
    try {
      const v = await vender([p.burger, p.refri, p.agua]);
      await q(`update producao_pedido_item set status = 'removido' where descricao = 'Água' and pedido_id = any($1::uuid[])`, [v.cartoes.map((c: any) => c.id)]);
      await terminar(cartao(v, CHAPA), CHAPA);
      await terminar(cartao(v, CHAPA), MONTA);
      await svc.acaoDespacho(T, ATOR, DESP, { comandaId: v.cmd, acao: 'pronto' });
      const jobs = await q(`select conteudo from impressao_job where equipamento_id = $1 and pedido_id = any($2::uuid[])`, [IMP, v.cartoes.map((c: any) => c.id)]);
      expect(jobs).toHaveLength(1);
      expect(String(jobs[0].conteudo)).toContain('Burger');
      expect(String(jobs[0].conteudo)).toContain('Refri');
      expect(String(jobs[0].conteudo)).not.toContain('Água');
    } finally {
      await q(`update equipamento set imprime_ao_avancar = false, impressora_destino_id = null where id = $1`, [DESP]);
    }
  });
});
