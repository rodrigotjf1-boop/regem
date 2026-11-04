import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../../db/schema';
import { FiscalService } from '../fiscal/fiscal.service';
import { ProducaoPedidoService } from '../producao-pedido/producao-pedido.service';
import { VendasService } from '../vendas/vendas.service';
import { CashbackService } from '../cashback/cashback.service';
import { DeliveryService } from '../delivery/delivery.service';
import { EdgeAlteracoesProcessor } from '../delivery/edge-alteracoes.processor';
import { EntregadorService } from '../entregador/entregador.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

// O PEDIDO ALTERADO PELA EQUIPE, DE PONTA A PONTA (mig 362; protótipo `mockups/regem-alteracao-pedido.html`, aprovado em
// 03/11/2026) — contra Postgres (TEST_PG_URL), com os serviços de verdade, como NUVEM de loja sem servidor ligado.
//
// O que a alteração de antes deixava de fazer (medido em 03/11): a lista de itens do pedido, o valor a cobrar e o troco
// continuavam os antigos; a cozinha recebia o item novo num cartão separado e o tirado sumia sem aviso; a via saía sem
// destaque, numa impressora só; ninguém sabia quem tinha alterado; o pedido "pronto" que ganhava item seguia "pronto".

const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('pedido-alterado-pg.spec: sem TEST_PG_URL — PULADO');
jest.setTimeout(120_000);

const MIGRATIONS = join(__dirname, '../../../../database/migrations');

descrever('pedido alterado pela equipe (Postgres real)', () => {
  const pool = new Pool({ connectionString: URL_PG });
  const db = drizzle(pool, { schema }) as any;
  const auditados: any[] = [];
  const auditoria = { registrar: async (a: any) => void auditados.push(a) } as any;
  const eventos = { emit: () => true } as any;
  const fiscal = new FiscalService(db, auditoria);
  const producao = new ProducaoPedidoService(db, auditoria, eventos);
  const vendas = new VendasService(db, auditoria, eventos, producao, fiscal, {} as any);
  const cashback = new CashbackService(db);
  const beneficio = () => new Proxy({}, { get: () => async () => undefined }) as any;
  const delivery = new (DeliveryService as any)(
    db, vendas, producao, cashback, beneficio(), eventos, { flashPedidos: () => undefined },
    undefined, undefined, undefined, undefined, undefined, undefined, auditoria,
  ) as DeliveryService;
  const empresas: string[] = [];
  const q = (s: string, p: any[] = []) => pool.query(s, p).then((r) => r.rows);
  const edgeOriginal = process.env.EDGE_MODE;

  beforeAll(async () => {
    delete process.env.EDGE_MODE; // como NUVEM (o jest do CI roda sem EDGE_MODE — V44)
    // "Servidor da loja ligado" (V53) e a posição do entregador são tabelas da nuvem: o banco do CI é de loja (V44).
    for (const t of ['edge_status', 'edge_heartbeat'])
      await pool
        .query(`create table if not exists ${t} (id uuid primary key default gen_random_uuid(), tenant_id uuid, unidade_id uuid, recebido_em timestamptz not null default now())`)
        .catch((e: any) => {
          if (!['23505', '42P07'].includes(e?.code)) throw e;
        });
    // A versão do servidor da loja (a telemetria da frota, na nuvem): a alteração pedida na nuvem só vai ao servidor que aplica.
    await pool.query(`alter table edge_heartbeat add column if not exists versao text`);
    const tem = async (t: string) => (await q(`select to_regclass(current_schema() || '.' || $1) is not null as ok`, [t]))[0].ok;
    if (!(await tem('entregador_chegada'))) await pool.query(readFileSync(join(MIGRATIONS, '201_entregador_chegada.sql'), 'utf8'));
    // A fila de comandos para o servidor da loja (só nuvem): a mig 124 cria, a 269 põe o destino e os dados.
    if (!(await tem('edge_comando'))) {
      await pool.query(readFileSync(join(MIGRATIONS, '124_edge_release_comando.sql'), 'utf8'));
      await pool.query(readFileSync(join(MIGRATIONS, '269_impressora_status_codepage_comando_destino.sql'), 'utf8'));
    }
    // A mig 362 só quando falta (o banco do CI já a tem pelo apply-all; o local de quem testa, talvez não).
    if (!(await tem('pedido_alteracao'))) await pool.query(readFileSync(join(MIGRATIONS, '362_pedido_alteracao.sql'), 'utf8'));
  });
  afterAll(async () => {
    if (edgeOriginal !== undefined) process.env.EDGE_MODE = edgeOriginal;
    if (empresas.length) {
      for (const t of ['pedido_alteracao', 'pedido_envio', 'pedido_notificacao', 'impressao_job', 'producao_pedido', 'nota_fiscal', 'cashback_movimento',
        'cashback_saldo', 'cashback_plano', 'pedido_externo', 'lancamento_caixa', 'comanda', 'cliente_endereco', 'cliente', 'cardapio_bairro', 'produto',
        'categoria_produto', 'equipamento', 'edge_heartbeat', 'edge_comando', 'colaborador', 'funcao', 'unidade'])
        await pool.query(`delete from ${t} where tenant_id = any($1::uuid[])`, [empresas]).catch(() => {});
      await pool.query(`delete from entregador_chegada where tenant_id = any($1::uuid[])`, [empresas]).catch(() => {});
      await pool.query('delete from empresa where id = any($1::uuid[])', [empresas]).catch(() => {});
    }
    await pool.end();
  }, 120_000);

  // ── a loja de teste ─────────────────────────────────────────────────────────────────────────
  // X-Bacon (R$ 32), Batata (R$ 14) e Suco (R$ 7) vão para a cozinha; a Água (R$ 3) não. A impressora da cozinha é a
  // padrão; a do caixa faz o cupom. Áreas: Centro (R$ 6) e Jardim América (R$ 8).
  async function loja() {
    const t = (await q(`insert into empresa (nome) values ('teste pedido alterado') returning id`))[0].id as string;
    empresas.push(t);
    const u = (await q(`insert into unidade (tenant_id, nome) values ($1,'Loja de teste') returning id`, [t]))[0].id as string;
    const funcao = (await q(`insert into funcao (tenant_id, nome, categoria) values ($1,'Gerente','gerente') returning id`, [t]))[0].id as string;
    const gestor = (await q(`insert into colaborador (tenant_id, nome, funcao_id) values ($1,'Ana de teste',$2) returning id`, [t, funcao]))[0].id as string;
    const categoria = (await q(`insert into categoria_produto (tenant_id, nome) values ($1,'Lanches de teste') returning id`, [t]))[0].id as string;
    const prod = async (codigo: string, nome: string, preco: number, cozinha: boolean) =>
      (await q(
        `insert into produto (tenant_id, codigo, nome, categoria_id, preco_venda, vai_para_producao) values ($1,$2,$3,$4,$5,$6) returning id`,
        [t, codigo, nome, categoria, preco.toFixed(2), cozinha],
      ))[0].id as string;
    const xbacon = await prod('XB1', 'X-Bacon de teste', 32, true);
    const batata = await prod('BT1', 'Batata de teste', 14, true);
    const suco = await prod('SC1', 'Suco de teste', 7, true);
    const agua = await prod('AG1', 'Água de teste', 3, false);
    const imp = async (nome: string, cozinha: boolean) =>
      (await q(
        // Com endereço na rede: a via do cliente só sai em impressora com alvo (IP ou nome no Windows).
        `insert into equipamento (tenant_id, unidade_id, nome, tipo, token, faz_producao, faz_cupom, padrao, conexao, host)
         values ($1,$2,$3,'impressora',$4,$5,$6,$5,'rede',$7) returning id`,
        [t, u, nome, randomBytes(12).toString('hex'), cozinha, !cozinha, cozinha ? '10.0.0.21' : '10.0.0.22'],
      ))[0].id as string;
    const cozinha = await imp('Cozinha de teste', true);
    const caixa = await imp('Caixa de teste', false);
    const bairro = async (nome: string, taxa: number) =>
      (await q(`insert into cardapio_bairro (tenant_id, unidade_id, nome, taxa) values ($1,$2,$3,$4) returning id`, [t, u, nome, taxa]))[0].id as string;
    const centro = await bairro('Centro', 6);
    const jardim = await bairro('Jardim América', 8);
    return { t, u, gestor, xbacon, batata, suco, agua, cozinha, caixa, centro, jardim };
  }
  type Loja = Awaited<ReturnType<typeof loja>>;
  const equipe = (l: Loja) => ({ tenantId: l.t, colaboradorId: l.gestor, nome: 'Ana de teste', categoria: 'gerente' });

  /** O pedido de entrega do cardápio (X-Bacon + Suco + R$ 6 de entrega = R$ 45, dinheiro com troco para R$ 50), aceito. */
  async function pedidoAceito(l: Loja, o: { pagamentos?: any[]; telefone?: string } = {}) {
    const ped: any = await delivery.ingest(
      l.t,
      l.u,
      'cardapio',
      {
        cliente: 'Marina de teste',
        clienteTelefone: o.telefone ?? `2199${String(Math.floor(Math.random() * 1e7)).padStart(7, '0')}`,
        tipo: 'entrega',
        endereco: 'Rua das Flores, 120, Centro',
        formaPagamento: 'Dinheiro',
        total: 45,
        itens: [
          { produtoId: l.xbacon, descricao: 'X-Bacon de teste', quantidade: 1, precoUnitario: 32, opcaoIds: [] },
          { produtoId: l.suco, descricao: 'Suco de teste', quantidade: 1, precoUnitario: 7, opcaoIds: [] },
        ],
        valorBruto: 39,
        pagamentos: o.pagamentos ?? [{ rotulo: 'Dinheiro', valor: 45, prepago: false, troco: 50 }],
        valorPagoCliente: 45,
      } as any,
      { clientRef: randomUUID(), taxaEntrega: 6, trocoPara: 50, repetidoConferido: true } as any,
    );
    await q(`update pedido_externo set endereco_rua = 'Rua das Flores', endereco_numero = '120', endereco_bairro = 'Centro' where id = $1`, [ped.id]);
    const r: any = await delivery.aceitar(l.t, l.gestor, ped.id);
    return { id: ped.id as string, comandaId: r.comandaId as string, clienteId: r.clienteId as string | null, telefone: r.clienteTelefone as string };
  }
  const itemDaVenda = async (comandaId: string, descricao: string) =>
    (await q(`select id from comanda_item where comanda_id = $1 and descricao = $2`, [comandaId, descricao]))[0].id as string;
  const cartoesDa = (comandaId: string) =>
    q(`select id, numero, status, obs, alterado_em, visto_em, visto_por from producao_pedido where comanda_id = $1 order by created_at, id`, [comandaId]);
  const itensDoCartao = (cartaoId: string) =>
    q(`select descricao, status, mudou_em from producao_pedido_item where pedido_id = $1 order by descricao`, [cartaoId]);
  const viasAlteradas = (comandaId: string) =>
    q(`select equipamento_id, via, conteudo from impressao_job where comanda_id = $1 and conteudo like '%@CBD4 ALTERADO%' order by via`, [comandaId]);
  const cartaoNoKds = async (l: Loja, comandaId: string) => {
    const f: any = await producao.filaKds(l.t, { unidadeId: l.u });
    return { cores: f.cores, cartoes: f.pedidos.filter((p: any) => p.comandaId === comandaId) };
  };
  const recusa = (code: string) => expect.objectContaining({ response: expect.objectContaining({ code }) });

  it('pôr um item com o pedido em produção: o mesmo cartão ganha o NOVO, o pedido e a cobrança sobem, saem as vias "PEDIDO ALTERADO" e o histórico guarda quem', async () => {
    const l = await loja();
    const p = await pedidoAceito(l);
    // A via do caixa já tinha saído na impressora do caixa (é ali que a nova sai).
    await q(`insert into impressao_job (tenant_id, unidade_id, equipamento_id, comanda_id, via, conteudo, status) values ($1,$2,$3,$4,'cliente','via de antes','impresso')`, [l.t, l.u, l.caixa, p.comandaId]);
    auditados.length = 0;

    const depois: any = await delivery.alterar(equipe(l), p.id, { idAlteracao: randomUUID(), adicionar: [{ produtoId: l.batata }], trocoPara: 100 });
    expect(depois).toMatchObject({ status: 'confirmado', total: '59.00', valorBruto: '53.00', valorPagoCliente: '59.00', trocoPara: '100.00', alterado: true });
    expect(depois.itens.map((i: any) => i.descricao)).toEqual(['X-Bacon de teste', 'Suco de teste', 'Batata de teste']);
    expect(depois.pagamentos).toEqual([{ rotulo: 'Dinheiro', valor: 59, prepago: false, troco: 100 }]);
    expect((await q(`select total::float8 as total from comanda where id = $1`, [p.comandaId]))[0].total).toBe(53);
    expect((await q(`select valor::float8 as valor from lancamento_caixa where comanda_id = $1 and categoria = 'venda'`, [p.comandaId]))[0].valor).toBe(53);

    // A cozinha: o MESMO cartão (antes saía outro, sem canal e sem número), com o item novo e o aviso até o "Visto".
    const cartoes = await cartoesDa(p.comandaId);
    expect(cartoes).toHaveLength(1);
    expect(cartoes[0]).toMatchObject({ status: 'recebido', obs: 'ALTERADO', visto_em: null });
    expect(cartoes[0].alterado_em).not.toBeNull();
    expect((await itensDoCartao(cartoes[0].id)).map((i: any) => [i.descricao, i.status])).toEqual([
      ['Batata de teste', 'novo'],
      ['Suco de teste', 'ok'],
      ['X-Bacon de teste', 'ok'],
    ]);
    const kds = await cartaoNoKds(l, p.comandaId);
    expect(kds.cores.alteradoSom).toBe('1min');
    expect(kds.cartoes[0]).toMatchObject({ alteracaoNaoVista: true, enderecoMudouEm: null });

    // As vias: a da cozinha (que já tinha impresso) e a do caixa, com o destaque e o que mudou.
    const vias = await viasAlteradas(p.comandaId);
    expect(vias.map((v: any) => [v.equipamento_id, v.via])).toEqual([[l.caixa, 'cliente'], [l.cozinha, 'producao']]);
    const daCozinha = vias.find((v: any) => v.via === 'producao').conteudo as string;
    expect(daCozinha.split('\n').slice(0, 3)).toEqual(['@CBD4 PEDIDO', '@CBD4 ALTERADO', '@CB Descarte TODAS as vias anteriores']);
    expect(daCozinha).toContain('@B + NOVO  1 Batata de teste');
    expect(daCozinha).toContain('1x Batata de teste << NOVO');
    expect(daCozinha).toContain('1x X-Bacon de teste');
    const doCaixa = vias.find((v: any) => v.via === 'cliente').conteudo as string;
    expect(doCaixa).toContain('@LR+ 1 Batata de teste|14,00');
    expect(doCaixa).toContain('@B Troco para: 100,00 (era 50,00)');

    // O histórico: quem, o que mudou, antes → agora, as vias; e a cozinha ainda não viu.
    const h: any = await delivery.alteracoesDoPedido(l.t, p.id);
    expect(h.alteracoes).toHaveLength(1);
    expect(h.alteracoes[0]).toMatchObject({
      origem: 'equipe',
      situacao: 'aplicada',
      porNome: 'Ana de teste',
      mudanca: { itens: [{ acao: 'por', descricao: 'Batata de teste', quantidade: 1, valor: 14 }], endereco: null, troco: { de: 50, para: 100 } },
      antes: { total: 45, trocoPara: 50, status: 'confirmado' },
      depois: { total: 59, trocoPara: 100, aReceber: 59, cozinha: true },
    });
    expect(h.alteracoes[0].vias).toHaveLength(2);
    expect(h.impressoras).toMatchObject({ [l.cozinha]: 'Cozinha de teste', [l.caixa]: 'Caixa de teste' });
    expect(h.cozinha).toMatchObject({ pendente: true, vistoEm: null });
    expect(auditados).toContainEqual(expect.objectContaining({ acao: 'alterou_pedido', entidadeId: p.id, detalhe: expect.objectContaining({ mudanca: '+ 1 Batata de teste', totalAntes: 45, totalDepois: 59 }) }));

    // "Visto": o aviso sai do cartão e o painel mostra quem viu.
    await producao.marcarVisto(l.t, cartoes[0].id, { nome: 'Chapa de teste' });
    expect((await cartaoNoKds(l, p.comandaId)).cartoes[0].alteracaoNaoVista).toBe(false);
    expect((await delivery.alteracoesDoPedido(l.t, p.id) as any).cozinha).toMatchObject({ pendente: false, vistoPor: 'Chapa de teste' });
  });

  it('tirar um item: ele fica riscado no KDS até o "Visto"; o total, o bruto e a forma na entrega caem', async () => {
    const l = await loja();
    const p = await pedidoAceito(l);
    const suco = await itemDaVenda(p.comandaId, 'Suco de teste');
    const depois: any = await delivery.alterar(equipe(l), p.id, { remover: [suco] });
    expect(depois).toMatchObject({ total: '38.00', valorBruto: '32.00', trocoPara: '50.00' });
    expect(depois.itens.map((i: any) => i.descricao)).toEqual(['X-Bacon de teste']);
    expect(depois.pagamentos[0]).toMatchObject({ valor: 38, troco: 50 });
    let kds = await cartaoNoKds(l, p.comandaId);
    expect(kds.cartoes[0].itens.map((i: any) => [i.descricao, i.status])).toEqual(
      expect.arrayContaining([['Suco de teste', 'removido'], ['X-Bacon de teste', 'ok']]),
    );
    expect(kds.cartoes[0].alteracaoNaoVista).toBe(true);
    // A via da cozinha diz o que parar.
    expect((await viasAlteradas(p.comandaId)).find((v: any) => v.via === 'producao').conteudo).toContain('@B - TIRAR 1 Suco de teste');
    await producao.marcarVisto(l.t, kds.cartoes[0].id);
    kds = await cartaoNoKds(l, p.comandaId);
    expect(kds.cartoes[0].itens.map((i: any) => i.descricao)).toEqual(['X-Bacon de teste']);
  });

  it('o pedido pronto que ganha item volta para a produção: cartão novo com o MESMO número, e só fica pronto quando ele ficar', async () => {
    const l = await loja();
    const p = await pedidoAceito(l);
    await q(`update producao_pedido set status = 'pronto', pronto_em = now() where comanda_id = $1`, [p.comandaId]);
    await q(`update pedido_externo set status = 'pronto', pronto_em = now() where id = $1`, [p.id]);
    const depois: any = await delivery.alterar(equipe(l), p.id, { adicionar: [{ produtoId: l.batata }], trocoPara: 100 });
    expect(depois).toMatchObject({ status: 'confirmado', prontoEm: null });
    const cartoes = await cartoesDa(p.comandaId);
    expect(cartoes).toHaveLength(2);
    expect(cartoes[1]).toMatchObject({ numero: cartoes[0].numero, status: 'recebido', obs: 'ALTERADO' });
    expect((await itensDoCartao(cartoes[1].id)).map((i: any) => [i.descricao, i.status])).toEqual([['Batata de teste', 'novo']]);
    expect(await producao.comandaTodaPronta(l.t, p.comandaId)).toBe(false);
  });

  it('o troco de antes não cobre o valor novo: recusa e NADA muda (a venda, a cozinha e o pedido voltam como estavam)', async () => {
    const l = await loja();
    const p = await pedidoAceito(l);
    await expect(delivery.alterar(equipe(l), p.id, { adicionar: [{ produtoId: l.batata }] })).rejects.toEqual(recusa('TROCO_INSUFICIENTE'));
    expect((await q(`select count(*)::int as n from comanda_item where comanda_id = $1`, [p.comandaId]))[0].n).toBe(2);
    expect((await q(`select count(*)::int as n from producao_pedido_item i join producao_pedido c on c.id = i.pedido_id where c.comanda_id = $1`, [p.comandaId]))[0].n).toBe(2);
    expect((await q(`select total::float8 as total, alterado from pedido_externo where id = $1`, [p.id]))[0]).toEqual({ total: 45, alterado: false });
    expect((await q(`select count(*)::int as n from pedido_alteracao where pedido_id = $1`, [p.id]))[0].n).toBe(0);
  });

  it('recusas com o motivo: pago fora da entrega, iFood, nota fiscal emitida e loja com o servidor ligado', async () => {
    const l = await loja();
    // Pago pelo link: mudar o valor não dá (decisão 4A); mudar só o endereço na mesma área, dá.
    const pago = await pedidoAceito(l, { pagamentos: [{ rotulo: 'Pix online', valor: 45, prepago: true }] });
    await expect(delivery.alterar(equipe(l), pago.id, { adicionar: [{ produtoId: l.agua }] })).rejects.toEqual(recusa('PAGO_ONLINE'));
    const soEndereco: any = await delivery.alterar(equipe(l), pago.id, { endereco: { rua: 'Rua Nova', numero: '10', bairroId: l.centro } });
    expect(soEndereco).toMatchObject({ total: '45.00', enderecoRua: 'Rua Nova' });

    const ifood = await pedidoAceito(l);
    await q(`update pedido_externo set canal = 'ifood' where id = $1`, [ifood.id]);
    await expect(delivery.alterar(equipe(l), ifood.id, { adicionar: [{ produtoId: l.agua }] })).rejects.toEqual(recusa('CANAL_SEM_ALTERACAO'));

    const comNota = await pedidoAceito(l);
    await q(`insert into nota_fiscal (tenant_id, unidade_id, comanda_id, serie, numero, status) values ($1,$2,$3,1,1,'autorizada')`, [l.t, l.u, comNota.comandaId]);
    await expect(delivery.alterar(equipe(l), comNota.id, { adicionar: [{ produtoId: l.agua }], trocoPara: 100 })).rejects.toEqual(recusa('NOTA_FISCAL'));
    expect((await q(`select count(*)::int as n from comanda_item where comanda_id = $1`, [comNota.comandaId]))[0].n).toBe(2);

    const comServidor = await pedidoAceito(l);
    await q(`insert into edge_heartbeat (tenant_id, unidade_id) values ($1,$2)`, [l.t, l.u]);
    await expect(delivery.alterar(equipe(l), comServidor.id, { adicionar: [{ produtoId: l.agua }] })).rejects.toEqual(recusa('LOJA_COM_SERVIDOR'));
    await q(`delete from edge_heartbeat where tenant_id = $1`, [l.t]);
  });

  it('mudar o endereço: a taxa da área nova, só a via do caixa/entregador, a cozinha sem aviso; o KDS mostra "Endereço mudou"', async () => {
    const l = await loja();
    const p = await pedidoAceito(l);
    const depois: any = await delivery.alterar(equipe(l), p.id, {
      endereco: { rua: 'Rua Ipê', numero: '45', bairroId: l.jardim, referencia: 'casa azul' },
      trocoPara: 50,
    });
    expect(depois).toMatchObject({ total: '47.00', taxaEntrega: '8.00', enderecoRua: 'Rua Ipê', enderecoBairro: 'Jardim América', enderecoReferencia: 'casa azul' });
    const [a] = (await delivery.alteracoesDoPedido(l.t, p.id) as any).alteracoes;
    expect(a.mudanca).toMatchObject({
      itens: [],
      endereco: { de: 'Rua das Flores, 120 · Centro', para: 'Rua Ipê, 45 · Jardim América', referencia: 'casa azul' },
      taxa: { de: 6, para: 8 },
      troco: null, // o troco mandado igual ao de antes não conta como mudança
    });
    expect(a.depois.cozinha).toBe(false);
    const vias = await viasAlteradas(p.comandaId);
    expect(vias.map((v: any) => v.via)).toEqual(['cliente']); // a cozinha não recebe via nova
    expect(vias[0].conteudo).toContain('@B ENDERECO NOVO:');
    expect(vias[0].conteudo).toContain('@B Entrega: de 6,00 para 8,00');
    const kds = await cartaoNoKds(l, p.comandaId);
    expect(kds.cartoes[0]).toMatchObject({ alteracaoNaoVista: false, alteradoEm: null });
    expect(kds.cartoes[0].enderecoMudouEm).not.toBeNull();
  });

  it('a mesma alteração mandada duas vezes entra uma vez; duas alterações juntas entram uma depois da outra', async () => {
    const l = await loja();
    const p = await pedidoAceito(l);
    const id = randomUUID();
    await delivery.alterar(equipe(l), p.id, { idAlteracao: id, adicionar: [{ produtoId: l.agua }], trocoPara: 100 });
    const deNovo: any = await delivery.alterar(equipe(l), p.id, { idAlteracao: id, adicionar: [{ produtoId: l.agua }], trocoPara: 100 });
    expect(deNovo.repetida).toBe(true);
    expect((await q(`select count(*)::int as n from comanda_item where comanda_id = $1`, [p.comandaId]))[0].n).toBe(3);
    // A água não vai para a cozinha: nem cartão mexido, nem via da cozinha.
    expect((await cartoesDa(p.comandaId))[0].alterado_em).toBeNull();
    expect((await viasAlteradas(p.comandaId)).map((v: any) => v.via)).toEqual(['cliente']);

    await Promise.all([
      delivery.alterar(equipe(l), p.id, { adicionar: [{ produtoId: l.agua }] }),
      delivery.alterar(equipe(l), p.id, { adicionar: [{ produtoId: l.agua }] }),
    ]);
    const [ped] = await q(`select total::float8 as total, jsonb_array_length(itens) as n from pedido_externo where id = $1`, [p.id]);
    expect(ped).toEqual({ total: 54, n: 5 }); // 45 + 3 × 3 — nenhuma se perdeu
    expect((await q(`select count(*)::int as n from pedido_alteracao where pedido_id = $1`, [p.id]))[0].n).toBe(3);
  });

  it('a alteração lê o pedido DENTRO da gravação: a de item que começou antes não desfaz a taxa do endereço novo', async () => {
    const l = await loja();
    const p = await pedidoAceito(l);
    const comoAntes = await (delivery as any).carregar(l.t, p.id); // o pedido como a outra tela o leu
    await delivery.alterar(equipe(l), p.id, { endereco: { rua: 'Rua Ipê', numero: '45', bairroId: l.jardim } }); // taxa 6 → 8
    const carregar = (delivery as any).carregar.bind(delivery);
    // A alteração do item começou antes (leu o pedido com a taxa de R$ 6) e só agora pega a linha.
    (delivery as any).carregar = async () => {
      (delivery as any).carregar = carregar;
      return comoAntes;
    };
    try {
      await delivery.alterar(equipe(l), p.id, { adicionar: [{ produtoId: l.agua }] });
    } finally {
      (delivery as any).carregar = carregar;
    }
    const [ped] = await q(`select total::float8 as total, taxa_entrega::float8 as taxa, endereco_rua from pedido_externo where id = $1`, [p.id]);
    expect(ped).toEqual({ total: 50, taxa: 8, endereco_rua: 'Rua Ipê' }); // 45 + 2 (área nova) + 3 (água)
  });

  it('o cashback do pedido acompanha o valor novo (decisão 7) e o cancelamento devolve o certo', async () => {
    const l = await loja();
    await q(`insert into cashback_plano (tenant_id, tipo, percentual, base) values ($1,'valor',5,'total')`, [l.t]);
    const p = await pedidoAceito(l);
    // O aceite credita o cashback em segundo plano (5% de R$ 45): espera o lançamento aparecer.
    for (let i = 0; i < 50; i++) {
      if ((await q(`select 1 from cashback_movimento where pedido_id = $1`, [p.id])).length) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    await delivery.alterar(equipe(l), p.id, { adicionar: [{ produtoId: l.batata }], trocoPara: 100 });
    const [a] = (await delivery.alteracoesDoPedido(l.t, p.id) as any).alteracoes;
    expect([a.antes.cashback, a.depois.cashback]).toEqual([2.25, 2.95]);
    const movs = await q(`select origem, delta::float8 as delta from cashback_movimento where pedido_id = $1 order by criado_em, delta desc`, [p.id]);
    expect(movs).toEqual([{ origem: 'credito', delta: 2.25 }, { origem: 'credito', delta: 0.7 }]);
    // Tirar a batata de novo: o crédito volta a 2,25 com um estorno de 0,70.
    await delivery.alterar(equipe(l), p.id, { remover: [await itemDaVenda(p.comandaId, 'Batata de teste')] });
    const soma = await q(`select sum(delta)::float8 as s from cashback_movimento where pedido_id = $1 and origem in ('credito','estorno')`, [p.id]);
    expect(soma[0].s).toBeCloseTo(2.25, 9);
  });

  it('o entregador: depois da alteração, a posição do endereço antigo sai e o caminho sai do endereço novo', async () => {
    const l = await loja();
    const p = await pedidoAceito(l);
    const entregador = new EntregadorService(db, delivery, {} as any);
    const coord = (ped: any) => (entregador as any).coordDoPedido(l.t, ped);
    // A posição guardada do endereço de antes vale enquanto o pedido não muda.
    await q(`insert into entregador_chegada (tenant_id, pedido_id, lat, lng, avisada, criado_em) values ($1,$2,-22.1,-43.1,true, now() - interval '1 hour')`, [l.t, p.id]);
    expect(await coord({ id: p.id })).toEqual({ lat: -22.1, lng: -43.1 });
    // O endereço novo já tem a posição no cadastro do cliente (sem buscar fora).
    const cli = (await q(`select cliente_id from pedido_externo where id = $1`, [p.id]))[0].cliente_id as string;
    await q(`insert into cliente_endereco (tenant_id, cliente_id, logradouro, numero, lat, lng) values ($1,$2,'Rua Ipê','45',-22.9,-43.2)`, [l.t, cli]);
    await delivery.alterar(equipe(l), p.id, { endereco: { rua: 'Rua Ipê', numero: '45', bairroId: l.jardim }, trocoPara: 100 });
    expect(await coord({ id: p.id, cliente_id: cli, endereco_rua: 'Rua Ipê', endereco_numero: '45' })).toEqual({ lat: -22.9, lng: -43.2 });
    expect(await q(`select lat::float8 as lat, avisada from entregador_chegada where pedido_id = $1`, [p.id])).toEqual([{ lat: -22.9, avisada: false }]);
  });

  // ── a alteração feita na NUVEM de uma loja com servidor ligado: o servidor da loja aplica (V53) ──────────────────────
  const servidorNaVersao = (l: Loja, versao: string) =>
    q(`insert into edge_heartbeat (tenant_id, unidade_id, versao) values ($1,$2,$3)`, [l.t, l.u, versao]);
  const itensNaVenda = async (comandaId: string) =>
    (await q(`select count(*)::int as n from comanda_item where comanda_id = $1`, [comandaId]))[0].n as number;
  // O módulo do servidor da loja que grava a pedida vinda do comando — avaliado do TEXTO do arquivo (é o que o daemon roda).
  function moduloDoDaemon(): { SQL_ALTERACAO_PEDIDA: string; paramsDaAlteracaoPedida: (d: any) => any[] | null } {
    const fonte = readFileSync(join(__dirname, '../../../edge/alteracao-pedida.mjs'), 'utf8');
    const nomes = [...fonte.matchAll(/^export (?:const|function) (\w+)/gm)].map((m) => m[1]);
    return new Function(fonte.replace(/^export (const|function) /gm, '$1 ') + `\nreturn { ${nomes.join(', ')} };`)();
  }
  // "No servidor da loja": o processador só roda com EDGE_MODE e cuida só da loja dele.
  async function noServidorDaLoja<T>(l: Loja, fn: (proc: EdgeAlteracoesProcessor) => Promise<T>): Promise<T> {
    const unidadeAntes = process.env.EDGE_UNIDADE_ID;
    process.env.EDGE_MODE = 'true';
    process.env.EDGE_UNIDADE_ID = l.u;
    try {
      return await fn(new EdgeAlteracoesProcessor(db, delivery));
    } finally {
      delete process.env.EDGE_MODE;
      if (unidadeAntes === undefined) delete process.env.EDGE_UNIDADE_ID;
      else process.env.EDGE_UNIDADE_ID = unidadeAntes;
    }
  }

  it('na tela da nuvem: a alteração vira "pedida" e vai ao servidor da loja pelo comando; servidor antigo recusa com o motivo', async () => {
    const l = await loja();
    const p = await pedidoAceito(l);
    await servidorNaVersao(l, '1.30.12');
    await expect(delivery.alterar(equipe(l), p.id, { adicionar: [{ produtoId: l.agua }] })).rejects.toEqual(recusa('LOJA_COM_SERVIDOR'));
    await q(`update edge_heartbeat set versao = '1.30.13' where tenant_id = $1`, [l.t]);
    const id = randomUUID();
    const r: any = await delivery.alterar(equipe(l), p.id, { idAlteracao: id, adicionar: [{ produtoId: l.agua }], trocoPara: 100 });
    expect(r).toMatchObject({ pedida: true, repetida: false, alteracao: { id, situacao: 'pedida', origem: 'equipe', porNome: 'Ana de teste' } });
    // Nada mudou ainda (quem aplica é o servidor da loja): a venda, o pedido e a cozinha seguem como estavam.
    expect(await itensNaVenda(p.comandaId)).toBe(2);
    expect((await q(`select total::float8 as total, alterado from pedido_externo where id = $1`, [p.id]))[0]).toEqual({ total: 45, alterado: false });
    expect((await viasAlteradas(p.comandaId)).length).toBe(0);
    // O comando leva os dados da pedida ao servidor da loja; a mesma pedida de novo não manda outro.
    const cmds = await q(`select comando, dados from edge_comando where tenant_id = $1`, [l.t]);
    expect(cmds).toHaveLength(1);
    expect(cmds[0]).toMatchObject({ comando: 'alterar_pedido', dados: { id, pedidoId: p.id, situacao: 'pedida', pedido: { adicionar: [{ produtoId: l.agua }], trocoPara: 100 } } });
    expect((await delivery.alterar(equipe(l), p.id, { idAlteracao: id, adicionar: [{ produtoId: l.agua }] }) as any).repetida).toBe(true);
    expect((await q(`select count(*)::int as n from edge_comando where tenant_id = $1`, [l.t]))[0].n).toBe(1);
    expect(auditados).toContainEqual(expect.objectContaining({ acao: 'pediu_alteracao_ao_servidor_da_loja', entidadeId: p.id }));
    // A gaveta mostra "esperando a loja" (ainda dentro da validade).
    const [h] = (await delivery.alteracoesDoPedido(l.t, p.id) as any).alteracoes;
    expect(h).toMatchObject({ situacao: 'pedida', vencida: false });
  });

  it('o servidor da loja grava a pedida do comando (uma vez), aplica pelo mesmo caminho da equipe e não aplica duas vezes', async () => {
    const l = await loja();
    const p = await pedidoAceito(l);
    await servidorNaVersao(l, '1.30.13');
    const id = randomUUID();
    await delivery.alterar(equipe(l), p.id, { idAlteracao: id, adicionar: [{ produtoId: l.agua }], trocoPara: 100 });
    const [cmd] = await q(`select dados from edge_comando where tenant_id = $1`, [l.t]);
    await q(`delete from edge_heartbeat where tenant_id = $1`, [l.t]);
    // No banco da loja a linha chega pelo comando (aqui, o mesmo banco: apaga-se a da nuvem para provar a gravação).
    await q(`delete from pedido_alteracao where id = $1`, [id]);
    const daemon = moduloDoDaemon();
    expect(daemon.paramsDaAlteracaoPedida({ id: 'x' })).toBeNull();
    const params = daemon.paramsDaAlteracaoPedida(cmd.dados)!;
    expect((await pool.query(daemon.SQL_ALTERACAO_PEDIDA, params)).rowCount).toBe(1);
    expect((await pool.query(daemon.SQL_ALTERACAO_PEDIDA, params)).rowCount).toBe(0); // o sync já a trouxe: não grava de novo

    // Uma pedida de OUTRA loja da mesma empresa: este servidor não toca nela (o da outra loja aplica).
    const daOutraLoja = randomUUID();
    await q(
      `insert into pedido_alteracao (id, tenant_id, unidade_id, pedido_id, situacao, pedido) values ($1,$2,$3,$4,'pedida','{}'::jsonb)`,
      [daOutraLoja, l.t, randomUUID(), randomUUID()],
    );

    const aplicadas = await noServidorDaLoja(l, async (proc) => [await proc.processar(), await proc.processar()]);
    expect(aplicadas).toEqual([1, 0]); // decidida: não volta para a fila
    expect((await q(`select situacao from pedido_alteracao where id = $1`, [daOutraLoja]))[0].situacao).toBe('pedida');
    const [a] = await q(`select situacao, motivo, mudanca, depois from pedido_alteracao where id = $1`, [id]);
    expect(a).toMatchObject({ situacao: 'aplicada', motivo: null, mudanca: { itens: [{ acao: 'por', descricao: 'Água de teste', valor: 3 }] }, depois: { total: 48, trocoPara: 100 } });
    expect(await itensNaVenda(p.comandaId)).toBe(3);
    // Mesmo chamada de novo (a pedida voltou pelo sync com relógio errado, por exemplo), não aplica outra vez.
    await delivery.aplicarAlteracaoPedida({ ...(await q(`select * from pedido_alteracao where id = $1`, [id]))[0], tenantId: l.t, pedidoId: p.id, createdAt: new Date() } as any);
    expect(await itensNaVenda(p.comandaId)).toBe(3);
  });

  it('o servidor da loja recusa com o motivo (a regra da equipe) e a pedida que chegou depois da validade', async () => {
    const l = await loja();
    const p = await pedidoAceito(l);
    const pedida = async (id: string, pedido: any, criadaEm: Date) => {
      await q(
        `insert into pedido_alteracao (id, tenant_id, unidade_id, pedido_id, comanda_id, origem, situacao, por_nome, pedido, created_at)
         values ($1,$2,$3,$4,$5,'robo','pedida','Robô do WhatsApp',$6::jsonb,$7)`,
        [id, l.t, l.u, p.id, p.comandaId, JSON.stringify(pedido), criadaEm],
      );
      return { id, tenantId: l.t, pedidoId: p.id, porId: null, porNome: 'Robô do WhatsApp', origem: 'robo', pedido, pedidoDoCliente: null, createdAt: criadaEm };
    };
    // R$ 45 + batata = R$ 59, e o cliente paga com R$ 50: o servidor recusa com o motivo do troco.
    const semTroco = await pedida(randomUUID(), { adicionar: [{ produtoId: l.batata }] }, new Date());
    expect(await delivery.aplicarAlteracaoPedida(semTroco)).toEqual({ aplicada: false, motivo: expect.stringContaining('não cobre o novo valor') });
    expect((await q(`select situacao, motivo from pedido_alteracao where id = $1`, [semTroco.id]))[0]).toMatchObject({ situacao: 'recusada', motivo: expect.stringContaining('troco') });
    // Chegou depois de 5 minutos: recusa sem mexer no pedido.
    const tarde = await pedida(randomUUID(), { adicionar: [{ produtoId: l.agua }], trocoPara: 100 }, new Date(Date.now() - 6 * 60_000));
    expect((await delivery.aplicarAlteracaoPedida(tarde)).motivo).toContain('depois de 5 minutos');
    expect(await itensNaVenda(p.comandaId)).toBe(2);
    // A gaveta da nuvem mostra a recusa com o motivo (a mais nova primeiro).
    const h: any = await delivery.alteracoesDoPedido(l.t, p.id);
    expect(h.alteracoes.map((x: any) => x.situacao)).toEqual(['recusada', 'recusada']);
  });
});
