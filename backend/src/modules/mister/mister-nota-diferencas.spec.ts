import type { ItemNoMister, NotaNoMister } from '../../common/nota-por-foto';
import { diferencasDoPedido, diferencasParaAIa, diferencasSemDecisao, lerDecisoesDoPedido, linhasDoPedidoNoResumo, textoDasDiferencas } from './mister-nota-diferencas';

// Versão 10, C1b: as diferenças entre o pedido e a nota, decididas na conversa (puro). O caminho inteiro (a nota que bate, a
// decisão pela ferramenta, o lançamento com o pedido novo só do que chega e o item a mais no pedido) em `mister-pg.teste-spec.ts`.

const item = (o: Partial<ItemNoMister>): ItemNoMister =>
  ({ descricao: 'X', codigo: null, quantidade: 1, unidade: 'UN', valorUnitarioCentavos: 100, valorTotalCentavos: 100, insumoId: null, insumoNome: null, unidadeDoEstoque: 'caixa', fator: 1, fatorProposto: null, fatorConfirmado: true, estado: 'ligado', sugestoes: [], ...o }) as ItemNoMister;

const PEDIDO = [
  { compraItemId: 'c1', itemId: 'batata', nome: 'Batata 7 mm', quantidade: 30 },
  { compraItemId: 'c2', itemId: 'cebola', nome: 'Cebola', quantidade: 10 },
  { compraItemId: 'c3', itemId: 'carne', nome: 'Carne 120gr', quantidade: 8 },
];
const nota = (itens: ItemNoMister[], decisoes?: any): Pick<NotaNoMister, 'itens' | 'pedido'> =>
  ({ itens, pedido: { listaId: 'l', nome: 'Compras da semana', fornecedor: 'Rucas', criado: '24/11', itens: 3, batem: 2, resposta: 'receber', itensDoPedido: PEDIDO, decisoes } }) as any;

describe('C1b · as diferenças entre o pedido e a nota', () => {
  const comBatataMenos = [
    item({ insumoId: 'batata', insumoNome: 'Batata 7 mm', quantidade: 25 }),
    item({ insumoId: 'carne', insumoNome: 'Carne 120gr', quantidade: 4, fator: 2 }),
    item({ insumoId: 'nugget', insumoNome: 'Nugget 1 kg', quantidade: 1 }),
    item({ estado: 'fora', insumoId: null }),
  ];
  it('veio menos, não veio e veio a mais, por insumo e na unidade do estoque (a conversão conta)', () => {
    expect(diferencasDoPedido(nota(comBatataMenos))).toEqual({
      pronto: true,
      iguais: 1,
      faltas: [
        { itemId: 'batata', nome: 'Batata 7 mm', pedida: 30, veio: 25 },
        { itemId: 'cebola', nome: 'Cebola', pedida: 10, veio: 0 },
      ],
      aMais: [{ itemId: 'nugget', nome: 'Nugget 1 kg', veio: 1 }],
    });
  });
  it('com linha ainda sem ligar não está pronto; sem o retrato do pedido, não há diferenças (o caminho de antes)', () => {
    expect(diferencasDoPedido(nota([...comBatataMenos, item({ estado: 'item', insumoId: null })])).pronto).toBe(false);
    expect(diferencasDoPedido({ itens: comBatataMenos, pedido: { listaId: 'l', resposta: 'receber' } as any })).toEqual({ pronto: true, iguais: 0, faltas: [], aMais: [] });
  });
  it('a pergunta mostra o que veio e o que difere, sem botões, e diz que nada foi lançado', () => {
    const t = textoDasDiferencas({ nome: 'Compras da semana', criado: '24/11' }, diferencasDoPedido(nota(comBatataMenos)), 'cupom');
    expect(t).toContain('Conferi o cupom com o pedido "Compras da semana" (24/11)');
    expect(t).toContain('✓ 1 item veio como pedido');
    expect(t).toContain('! Batata 7 mm: pedidos 30, vieram 25');
    expect(t).toContain('! Cebola: não veio');
    expect(t).toContain('+ Nugget 1 kg: 1 que não estava no pedido');
    expect(t).toContain('Nada foi lançado ainda.');
  });

  const dif = diferencasDoPedido(nota(comBatataMenos));
  it('a decisão da IA: pelo nome (o igual, ou o único que contém), com o dia que chega; soma às anteriores', () => {
    const r = lerDecisoesDoPedido({ faltas: [{ produto: 'batata', decisao: 'chega_depois', para: '2026-11-26' }] }, dif, undefined, '2026-11-25');
    expect(r).toEqual({ decisoes: { faltas: { batata: { decisao: 'chega_depois', para: '2026-11-26' } }, aMais: {} }, feito: ['Batata 7 mm: 5 continua no pedido, para 26/11.'] });
    expect(diferencasSemDecisao({ decisoes: (r as any).decisoes }, dif)).toBe(2);
    const r2 = lerDecisoesDoPedido({ faltas: [{ produto: 'Cebola', decisao: 'cancelado' }], a_mais: [{ produto: 'nugget', decisao: 'no_pedido' }] }, dif, (r as any).decisoes, '2026-11-25');
    expect((r2 as any).decisoes).toEqual({
      faltas: { batata: { decisao: 'chega_depois', para: '2026-11-26' }, cebola: { decisao: 'cancelado', para: null } },
      aMais: { nugget: 'no_pedido' },
    });
    expect(diferencasSemDecisao({ decisoes: (r2 as any).decisoes }, dif)).toBe(0);
    expect(linhasDoPedidoNoResumo(dif, (r2 as any).decisoes)).toEqual([
      '• Batata 7 mm: 5 continua num pedido novo, para 26/11.',
      '• Cebola: sai do pedido (cancelado).',
      '• Nugget 1 kg: entra no pedido.',
    ]);
  });
  it('produto fora das diferenças, decisão que não existe, dia impossível ou longe: volta para a IA perguntar', () => {
    expect((lerDecisoesDoPedido({ faltas: [{ produto: 'tomate', decisao: 'cancelado' }] }, dif, undefined, '2026-11-25') as any).erro).toContain('não está nas diferenças');
    expect((lerDecisoesDoPedido({ faltas: [{ produto: 'cebola', decisao: 'sumiu' }] }, dif, undefined, '2026-11-25') as any).erro).toContain('chega_depois, cancelado ou outro_lugar');
    expect((lerDecisoesDoPedido({ faltas: [{ produto: 'batata', decisao: 'chega_depois', para: '2026-11-31' }] }, dif, undefined, '2026-11-25') as any).erro).toContain('AAAA-MM-DD');
    expect((lerDecisoesDoPedido({ faltas: [{ produto: 'batata', decisao: 'chega_depois', para: '2026-11-20' }] }, dif, undefined, '2026-11-25') as any).erro).toContain('confirme');
    expect((lerDecisoesDoPedido({ a_mais: [{ produto: 'nugget', decisao: 'joga fora' }] }, dif, undefined, '2026-11-25') as any).erro).toContain('no_pedido ou avulso');
    expect((lerDecisoesDoPedido({}, dif, undefined, '2026-11-25') as any).erro).toContain('Diga o que aconteceu');
  });
  it('para a IA: cada diferença com o que já foi decidido', () => {
    expect(diferencasParaAIa(dif, { faltas: { cebola: { decisao: 'cancelado', para: null } }, aMais: {} })).toMatchObject({
      vieramComoPedido: 1,
      faltas: [
        { produto: 'Batata 7 mm', pedida: 30, veio: 25, decidido: null },
        { produto: 'Cebola', pedida: 10, veio: 0, decidido: 'cancelado' },
      ],
      aMais: [{ produto: 'Nugget 1 kg', veio: 1, decidido: null }],
    });
  });
  it('C1b-2 · veio de outro lugar: o fornecedor, o valor, a quantidade (sem ela, o que faltou) e a forma', () => {
    const r = lerDecisoesDoPedido({ faltas: [{ produto: 'cebola', decisao: 'outro_lugar', fornecedor: ' Mercado  do Zé ', valor: 48, forma: 'pix' }] }, dif, undefined, '2026-11-25');
    expect(r).toEqual({
      decisoes: { faltas: { cebola: { decisao: 'outro_lugar', para: null, fornecedor: { id: null, nome: 'Mercado do Zé' }, quantidade: 10, valorCentavos: 4800, forma: 'pix' } }, aMais: {} },
      feito: ['Cebola: 10 veio de Mercado do Zé, R$ 48,00, conta paga.'],
    });
    // O resumo diz o fornecedor novo (sem id) e a conta paga; com o id do cadastro, sem "novo".
    const dec: any = (r as any).decisoes;
    expect(linhasDoPedidoNoResumo(dif, dec)).toEqual(['• Cebola: 10 entra pelo Mercado do Zé (fornecedor novo), R$ 48,00, conta paga.']);
    dec.faltas.cebola.fornecedor = { id: 'f1', nome: 'Mercado do Zé' };
    expect(linhasDoPedidoNoResumo(dif, dec)).toEqual(['• Cebola: 10 entra pelo Mercado do Zé, R$ 48,00, conta paga.']);
    // A quantidade dita vale; a forma fora da lista fica sem forma.
    expect((lerDecisoesDoPedido({ faltas: [{ produto: 'batata', decisao: 'outro_lugar', fornecedor: 'Atacadão', valor: 60, quantidade: 5, forma: 'cheque' }] }, dif, undefined, '2026-11-25') as any).decisoes.faltas.batata).toMatchObject({ quantidade: 5, forma: null });
  });
  it('C1b-2 · sem de onde veio ou sem o valor, volta para a IA perguntar', () => {
    expect((lerDecisoesDoPedido({ faltas: [{ produto: 'cebola', decisao: 'outro_lugar', valor: 48 }] }, dif, undefined, '2026-11-25') as any).erro).toContain('diga de onde veio');
    expect((lerDecisoesDoPedido({ faltas: [{ produto: 'cebola', decisao: 'outro_lugar', fornecedor: 'Mercado' }] }, dif, undefined, '2026-11-25') as any).erro).toContain('quanto custou');
    expect((lerDecisoesDoPedido({ faltas: [{ produto: 'cebola', decisao: 'outro_lugar', fornecedor: 'Mercado', valor: 10, quantidade: -1 }] }, dif, undefined, '2026-11-25') as any).erro).toContain('não é válida');
  });
});
