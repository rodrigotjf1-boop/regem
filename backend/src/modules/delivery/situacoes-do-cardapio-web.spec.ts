import { mapStatusExterno } from './adapters';

// AS SITUAÇÕES DO PEDIDO NO CARDÁPIO WEB, UMA A UMA (ERR-496, V20).
// A lista é a da documentação oficial — docs.cardapioweb.com › Pedidos › Polling de pedidos, o campo `status` da
// resposta, lida em 16/11/2026. O tradutor era uma lista de palavras soltas e três valores não casavam com nada: o
// pedido que a loja despachava ou finalizava no painel do Cardápio Web ficava parado no Regem.
// Uma linha para CADA valor, inclusive os que não mudam nada: valor novo na documentação entra aqui antes do código.

type NoRegem = ReturnType<typeof mapStatusExterno>;

const DA_DOCUMENTACAO: [string, NoRegem, string][] = [
  ['waiting_confirmation', null, 'esperando a loja aceitar: o pedido segue o fluxo do Regem'],
  ['pending_payment', null, 'esperando o pagamento'],
  ['pending_online_payment', null, 'esperando o pagamento online'],
  ['scheduled_confirmed', null, 'agendado e aceito'],
  ['confirmed', null, 'aceito, em preparo'],
  ['ready', 'pronto', 'pronto na cozinha, sem despachar'],
  ['waiting_to_catch', 'pronto', 'liberado para a retirada: esperando o cliente'],
  ['released', 'despachado', 'liberado para a saída de entrega'],
  ['delivered', 'concluido', 'entregue'],
  ['closed', 'concluido', 'finalizado: estado final'],
  ['canceled', 'cancelado', 'cancelado: estado final'],
  // A documentação lista o valor e não diz o que ele é. Fica como sempre foi (cancela) até a definição — se um dia
  // mudar, é AQUI que a decisão fica escrita.
  ['canceling', 'cancelado', 'cancelamento em andamento (sem definição na documentação)'],
];

describe('as situações do pedido no Cardápio Web', () => {
  it.each(DA_DOCUMENTACAO)('%s → %s (%s)', (noCanal, noRegem) => {
    expect(mapStatusExterno(noCanal)).toBe(noRegem);
  });

  it('são as 12 da documentação, sem repetir', () => {
    const nomes = DA_DOCUMENTACAO.map(([n]) => n);
    expect(new Set(nomes).size).toBe(12);
    expect(nomes).toHaveLength(12);
  });

  it('maiúsculas e espaços em volta não mudam a leitura', () => {
    expect(mapStatusExterno(' CLOSED ')).toBe('concluido');
    expect(mapStatusExterno('Released')).toBe('despachado');
    expect(mapStatusExterno('WAITING_TO_CATCH')).toBe('pronto');
  });

  it('valor vazio ou desconhecido não anda o pedido', () => {
    for (const v of [undefined, null, '', '   ', 'qualquer_coisa_nova', 42, {}]) expect(mapStatusExterno(v)).toBeNull();
  });

  it('nome de propriedade do JavaScript não vira situação', () => {
    for (const v of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) expect(mapStatusExterno(v)).toBeNull();
  });

  it('o tipo do pedido não se confunde com a situação: "closed_table" é mesa, não "closed"', () => {
    expect(mapStatusExterno('closed_table')).toBeNull();
  });
});
