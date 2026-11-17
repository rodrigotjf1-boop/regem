// TOTEM EM DINHEIRO COBRADO NO BALCÃO (pedido do dono, 16/11/2026): "o cliente vai ao balcão com a via dele, faz o
// pagamento, o caixa emite uma via com a mesma senha atualizada com a informação de que foi paga no caixa, e dá a via
// antiga ao atendimento. A via só sai depois do pagamento no caixa."
//
// Daqui saem o destaque no ALTO dessa via e o nome da forma cobrada. A via em si é a do caixa de sempre (a mesma senha,
// os itens, o total): ver `DeliveryService.imprimirViaPagaNoCaixa`.

/** O nome da forma como a pessoa lê ("credito" → "Crédito"); o rótulo pronto (o do pagamento dividido) passa como veio. */
const NOMES: Record<string, string> = {
  dinheiro: 'Dinheiro',
  credito: 'Crédito',
  'crédito': 'Crédito',
  debito: 'Débito',
  'débito': 'Débito',
  cartao: 'Cartão',
  'cartão': 'Cartão',
  pix: 'Pix',
  vale: 'Vale-refeição',
  voucher: 'Voucher',
};

export function nomeDaForma(forma?: string | null): string {
  const t = String(forma ?? '').trim();
  if (!t) return 'Dinheiro';
  return NOMES[t.toLowerCase()] ?? t;
}

/**
 * O destaque no alto da via: "PAGO NO CAIXA" grande e em negrito, a forma e a hora logo abaixo, e a linha dupla. A
 * impressora não imprime branco no preto: o destaque é o tamanho e o negrito (como o "PEDIDO ALTERADO"). 13 letras em
 * tamanho duplo cabem no papel de 58 mm (16 colunas).
 */
export function linhasDaViaPagaNoCaixa(forma: string | null | undefined, hora: string): string {
  return ['@CBD PAGO NO CAIXA', `@CB ${nomeDaForma(forma)} - ${hora}`, '@C ========================'].join('\n') + '\n';
}
