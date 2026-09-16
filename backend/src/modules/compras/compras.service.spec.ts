import { ComprasService } from './compras.service';

// A divergência é deduzida da conta e só vem do cliente no caso que a conta não
// enxerga (chegou tudo, mas danificado). O vocabulário é o mesmo de
// `recebimento_item.divergencia` — duas palavras para a mesma ideia é como se
// acaba com dois relatórios que não batem.
describe('compras — divergência da conferência', () => {
  const svc = new ComprasService(null as any, null as any, null as any);
  const div = (pedida: number, recebida: number) =>
    (svc as any).divergenciaDe(pedida, recebida);

  it('chegou o que foi pedido', () => expect(div(10, 10)).toBe('ok'));
  it('chegou menos', () => expect(div(10, 7)).toBe('parcial'));
  it('chegou mais', () => expect(div(10, 12)).toBe('excedente'));
  it('não chegou nada', () => expect(div(10, 0)).toBe('nao_veio'));

  // O caso que motivou tudo: a quantidade PEDIDA entrava no estoque mesmo quando
  // chegava outra coisa. Se a conta voltar a dizer 'ok' aqui, a divergência some
  // do relatório e o erro fica invisível de novo.
  it('recebido diferente do pedido nunca é "ok"', () => {
    for (const r of [0, 1, 9, 9.5, 11]) expect(div(10, r)).not.toBe('ok');
  });

  it('fração conta como divergência', () => expect(div(1, 0.5)).toBe('parcial'));
});
