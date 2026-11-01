import { DeliveryService } from './delivery.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

// O CÓDIGO DE ENTREGA LEMBRADO NOS AVISOS (pedido do dono, 01/11/2026): "saiu para entrega", "chegando" e "sem contato"
// lembram o código a quem vai receber o pedido. Só a entrega própria do Regem, enquanto não foi entregue — o cliente do
// iFood, da 99 e dos integrados tem o código do canal, e nem recebe mensagem pelo WhatsApp do Regem.
describe('código de entrega para lembrar nos avisos', () => {
  const pedido = (extra: Record<string, unknown> = {}) => ({ canal: 'cardapio', tipo: 'entrega', status: 'despachado', codigoEntrega: '4821', ...extra });

  it('entrega própria do Regem a caminho: o código do pedido', () => {
    expect(DeliveryService.codigoParaLembrar(pedido())).toBe('4821');
    expect(DeliveryService.codigoParaLembrar(pedido({ canal: 'manual', status: 'pronto' }))).toBe('4821');
  });

  it('iFood, 99, Keeta e integrados: nada (o cliente usa o código do canal)', () => {
    for (const canal of ['ifood', '99food', 'keeta', 'anotaai', 'cardapio_web', 'totem'])
      expect(DeliveryService.codigoParaLembrar(pedido({ canal }))).toBeNull();
  });

  it('retirada, pedido sem código, entregue, concluído ou cancelado: nada', () => {
    expect(DeliveryService.codigoParaLembrar(pedido({ tipo: 'retirada' }))).toBeNull();
    expect(DeliveryService.codigoParaLembrar(pedido({ codigoEntrega: null }))).toBeNull();
    expect(DeliveryService.codigoParaLembrar(pedido({ codigoEntrega: '  ' }))).toBeNull();
    for (const status of ['entregue', 'concluido', 'cancelado']) expect(DeliveryService.codigoParaLembrar(pedido({ status }))).toBeNull();
  });

  it('o texto do "saiu", do "chegando" e do "sem contato" leva o código; os outros avisos, não', () => {
    const texto = (evento: string, extra: Record<string, unknown> = {}) =>
      (DeliveryService as any).textoNotificacao(evento, { displayId: '81', ...pedido(extra) }).texto as string;
    expect(texto('saiu_entrega')).toBe(
      'Seu pedido #81 saiu para entrega! 🛵 Acompanhe a chegada pelo botão abaixo.\n🔑 Código de entrega: 4821. Informe ao entregador para liberar o pedido.',
    );
    expect(texto('chegando')).toBe('Seu pedido #81 está chegando! 🛵 O entregador está a poucos minutos daí.\n🔑 Tenha em mãos o código 4821 para liberar o pedido.');
    expect(texto('sem_contato')).toBe(
      'O entregador está com o seu pedido #81 e não conseguiu falar com você. Responda esta mensagem para combinar a entrega.\n🔑 Não esqueça do código 4821 para liberar o pedido.',
    );
    expect(texto('confirmado', { status: 'confirmado' })).not.toContain('4821');
    expect(texto('atrasado')).not.toContain('4821');
    // Sem código (iFood, ou a loja que não usa o código): o texto de sempre.
    expect(texto('saiu_entrega', { canal: 'ifood' })).toBe('Seu pedido #81 saiu para entrega! 🛵 Acompanhe a chegada pelo botão abaixo.');
  });
});
