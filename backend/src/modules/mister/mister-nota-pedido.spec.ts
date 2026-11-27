import {
  FRASES_DO_PEDIDO_DA_NOTA,
  botoesDoEstoqueDoPedido,
  botoesDoPedidoDaNota,
  lancaEstoque,
  lerBotaoDoPedidoDaNota,
  pedidoQueBate,
  recebePedido,
  type CandidatoDoPedido,
} from './mister-nota-pedido';
import type { NotaNoMister, PedidoDaNota } from '../../common/nota-por-foto';

// P4 de "Pedidos e recebimento" (PR-7 e a decisão do dono: "ao receber pedido, perguntar se é para lançar no estoque").

const cand = (listaId: string, itemIds: string[], o: Partial<CandidatoDoPedido> = {}): CandidatoDoPedido => ({
  listaId,
  nome: `Pedido ${listaId}`,
  fornecedorId: null,
  fornecedor: null,
  criado: '24/11',
  itemIds,
  ...o,
});

describe('o pedido que bate com a nota (PR-7: metade ou mais dos itens do pedido estão na nota)', () => {
  it('metade ou mais, e ao menos um; nada ligado, nada bate', () => {
    expect(pedidoQueBate([cand('a', ['x', 'y', 'z'])], ['x', 'y', 'w'], null)).toEqual({
      listaId: 'a', nome: 'Pedido a', fornecedor: null, criado: '24/11', itens: 3, batem: 2, resposta: null,
    });
    expect(pedidoQueBate([cand('a', ['x', 'y', 'z'])], ['x'], null)).toBeNull(); // 1 de 3: menos da metade
    expect(pedidoQueBate([cand('a', ['x', 'y'])], ['x'], null)).toMatchObject({ itens: 2, batem: 1 }); // a metade vale
    expect(pedidoQueBate([cand('a', [])], ['x'], null)).toBeNull();
    expect(pedidoQueBate([cand('a', ['x'])], [], null)).toBeNull();
    // o insumo repetido no pedido conta uma vez
    expect(pedidoQueBate([cand('a', ['x', 'x', 'y'])], ['x'], null)).toMatchObject({ itens: 2, batem: 1 });
  });

  it('entre os que batem: o do fornecedor da nota, depois o que bate mais, depois o mais novo (a ordem da busca)', () => {
    const novo = cand('novo', ['x', 'y']); // 1 de 2
    const velho = cand('velho', ['x']); // 1 de 1
    expect(pedidoQueBate([novo, velho], ['x'], null)?.listaId).toBe('velho');
    const doFornecedor = cand('forn', ['x', 'y'], { fornecedorId: 'F1', fornecedor: 'Atacadão' });
    expect(pedidoQueBate([novo, velho, doFornecedor], ['x'], 'F1')).toMatchObject({ listaId: 'forn', fornecedor: 'Atacadão' });
    expect(pedidoQueBate([cand('um', ['x']), cand('dois', ['x'])], ['x'], null)?.listaId).toBe('um');
  });
});

describe('a resposta e o caminho do estoque', () => {
  const pedido: PedidoDaNota = { listaId: 'l', nome: 'Compras do mercado', fornecedor: null, criado: '24/11', itens: 9, batem: 7, resposta: null };
  const nota = (o: Partial<NotaNoMister> = {}): NotaNoMister =>
    ({ chave: null, numero: '98765', emitenteNome: 'Atacadão', emitenteCnpj: null, valorTotalCentavos: 124_000, duplicatas: [], itens: [], ...o }) as NotaNoMister;

  it('o estoque: a resposta vale; sem resposta, a nota de fornecedor dá entrada e o cupom não', () => {
    expect(lancaEstoque(nota())).toBe(true);
    expect(lancaEstoque(nota({ especie: 'cupom' }))).toBe(false);
    expect(lancaEstoque(nota({ especie: 'cupom', comoLancar: 'estoque' }))).toBe(true);
    expect(lancaEstoque(nota({ comoLancar: 'despesa' }))).toBe(false);
    expect(recebePedido(nota({ pedido: { ...pedido, resposta: 'receber' } }))).toBe(true);
    expect(recebePedido(nota({ pedido: { ...pedido, resposta: 'nao' } }))).toBe(false);
    expect(recebePedido(nota())).toBe(false);
  });

  it('as frases: a pergunta do pedido, a do estoque, o resumo e o que foi feito', () => {
    expect(FRASES_DO_PEDIDO_DA_NOTA.bate(nota({ especie: 'cupom' }), pedido)).toMatch(
      /\n\nTemos o pedido "Compras do mercado", criado em 24\/11, com 9 itens, que bate com este cupom: 7 dos 9 itens estão nele\. Registrar o recebimento\?$/,
    );
    expect(FRASES_DO_PEDIDO_DA_NOTA.bate(nota(), { ...pedido, fornecedor: 'Rucas' })).toContain('Temos o pedido "Compras do mercado" (Rucas), criado em 24/11, com 9 itens, que bate com esta nota: 7 dos 9 itens estão nela.');
    // ERR-628: é a escolha do caminho, não o lançamento — e a frase diz isso.
    expect(FRASES_DO_PEDIDO_DA_NOTA.estoque(nota(), pedido)).toMatch(
      /^Recebo o pedido "Compras do mercado" com esta nota\. Os itens entram no estoque\?\n• Entram no estoque: .+\n• Só marcar recebido: .+\n\nNada é lançado agora: .+"Lançar"\.$/,
    );
    expect(FRASES_DO_PEDIDO_DA_NOTA.noResumo(nota({ comoLancar: 'despesa' }), pedido)).toBe('📦 O pedido "Compras do mercado" fica marcado como recebido, sem mexer no estoque.');
    expect(FRASES_DO_PEDIDO_DA_NOTA.soDespesaDaNota(nota({ duplicatas: [{ vencimento: '2026-12-01', valorCentavos: 62_000 }, { vencimento: '2026-12-15', valorCentavos: 62_000 }] }))).toMatch(
      /Lanço a conta a pagar de R\$ 1\.240,00 em 2 parcelas\? O estoque não muda\.$/,
    );
    expect(FRASES_DO_PEDIDO_DA_NOTA.recebido(pedido, { entraram: 6, faltaram: ['Batata 7 mm: 25 de 30'], naoVieram: ['Cebola', 'Tomate'], pendentes: ['Hambúrguer 56 g'], aMais: 1 })).toBe(
      '📦 Recebi o pedido "Compras do mercado" em Estoque › Pedidos: 6 itens entraram no estoque (e 1 item a mais, pelo recebimento avulso). ' +
        'Veio menos: Batata 7 mm: 25 de 30. Não vieram (fica como falta no pedido): Cebola, Tomate. A validade de Hambúrguer 56 g ficou pendente: responda a data quando souber.',
    );
    expect(FRASES_DO_PEDIDO_DA_NOTA.recebido(pedido, { entraram: 1, faltaram: [], naoVieram: [], pendentes: [], aMais: 0 })).toBe('📦 Recebi o pedido "Compras do mercado" em Estoque › Pedidos: 1 item entrou no estoque.');
    // PR-8: a nota sem pedido que bata vira um pedido já recebido.
    expect(FRASES_DO_PEDIDO_DA_NOTA.semPedidoNoResumo(nota())).toBe('📦 Sem pedido aberto que bata com esta nota: a entrada vira um pedido já recebido em Estoque › Pedidos.');
    expect(FRASES_DO_PEDIDO_DA_NOTA.criado({ ...pedido, nome: 'Cupom 7101 · Atacadão' }, [])).toBe(
      '📦 Não havia pedido aberto que batesse: registrei como pedido já recebido em Estoque › Pedidos, "Cupom 7101 · Atacadão".',
    );
    expect(FRASES_DO_PEDIDO_DA_NOTA.criado(pedido, ['Óleo'])).toMatch(/A validade de Óleo ficou pendente: responda a data quando souber\.$/);
  });

  it('os botões cabem no WhatsApp (até 20 letras) e se leem de volta', () => {
    const id = '0b0e8f3e-6d5c-4a9f-9a51-3c1f0e2d7a10';
    const todos = [...botoesDoPedidoDaNota(id), ...botoesDoEstoqueDoPedido(id)];
    expect(todos.map((b) => b.titulo)).toEqual(['Receber o pedido', 'Não é deste pedido', 'Entram no estoque', 'Só marcar recebido']);
    for (const b of todos) expect(b.titulo.length).toBeLessThanOrEqual(20);
    expect(todos.map((b) => lerBotaoDoPedidoDaNota(b.id)?.escolha)).toEqual(['r', 'n', 'e', 's']);
    expect(lerBotaoDoPedidoDaNota(`doc:pd:${id.toUpperCase()}:R`)).toEqual({ documentoId: id, escolha: 'r' });
    expect(lerBotaoDoPedidoDaNota(`doc:pd:${id}:x`)).toBeNull();
    expect(lerBotaoDoPedidoDaNota(`doc:cl:${id}:e`)).toBeNull();
  });
});
