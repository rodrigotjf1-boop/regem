import {
  VALIDADE_DO_PIX_DO_ADICIONAL_MIN,
  descricaoDoQueEntra,
  textoDaLojaConfirmou,
  textoDoAlerta,
  textoDoCasoDoEstorno,
  textoDoNaoEntrou,
  textoDoPagoAplicado,
  textoDoPagoPedido,
  textoDoPix,
  textoDoVencido,
} from './adicional-pix';

// O Pix do item novo no pedido já pago (mig 373): o que o cliente e a equipe leem em cada passo.
describe('Pix do item novo — os textos', () => {
  it('o Pix vale 5 minutos (o pedido do dono) e o cliente lê isso antes de pagar', () => {
    expect(VALIDADE_DO_PIX_DO_ADICIONAL_MIN).toBe(5);
    expect(textoDoPix('57', '1x Coca lata', 6)).toBe(
      [
        'Aqui está o Pix de R$ 6,00 para pôr 1x Coca lata no pedido nº 57 👇',
        'Vale por 5 minutos. Assim que o pagamento cair, o item entra no pedido e eu te aviso aqui.',
        'Se não for pago a tempo, o código expira e o pedido pode sair sem o item.',
      ].join('\n'),
    );
  });

  it('pago (na hora ou pela loja), vencido e o que não entrou — o valor volta pela instituição financeira', () => {
    expect(textoDoPagoAplicado('57', '1x Coca lata', 40)).toBe('✅ Pagamento recebido! 1x Coca lata entrou no pedido nº 57.\nTotal: R$ 40,00.');
    expect(textoDoPagoPedido('57', '1x Coca lata')).toBe('✅ Pagamento recebido! Pedi à loja para pôr 1x Coca lata no pedido nº 57 ⏳ Te confirmo aqui em instantes.');
    expect(textoDaLojaConfirmou('57', '1x Coca lata', 40)).toBe('✅ A loja confirmou: 1x Coca lata entrou no pedido nº 57.\nTotal: R$ 40,00.');
    expect(textoDaLojaConfirmou(null, '1x Coca lata', null)).toBe('✅ A loja confirmou: 1x Coca lata entrou no pedido.');
    expect(textoDoVencido('57', '1x Coca lata')).toMatch(/^O Pix para pôr 1x Coca lata no pedido nº 57 expirou sem pagamento, e o pedido segue como estava\./);
    const nao = textoDoNaoEntrou('57', '1x Coca lata', 6);
    expect(nao).toMatch(/^Recebi o Pix de R\$ 6,00, mas não deu para pôr 1x Coca lata no pedido nº 57/);
    expect(nao).toMatch(/será devolvido automaticamente para a mesma conta, pela instituição financeira/);
  });

  it('o alerta da Central: "segure o pedido" enquanto espera o Pix e enquanto a mudança paga entra', () => {
    expect(textoDoAlerta({ numero: '57', descricao: '1x Coca lata', valor: 6, situacao: 'aguardando' })).toBe(
      'Pedido #57: o robô está pondo 1x Coca lata (R$ 6,00) e espera o Pix do cliente. Segure o pedido: não libere até a conclusão.',
    );
    for (const situacao of ['pago', 'pedido_a_loja'])
      expect(textoDoAlerta({ numero: '57', descricao: '1x Coca lata', valor: 6, situacao })).toMatch(/foi pago — a mudança está entrando\. Segure o pedido/);
  });

  it('o caso urgente do estorno que não saiu diz o gateway e o motivo', () => {
    expect(
      textoDoCasoDoEstorno({ numero: '57', descricao: '1x Coca lata', valor: 6, gateway: 'pagseguro', motivo: 'PagBank 400' }),
    ).toBe('O estorno do Pix do item novo do pedido #57 (1x Coca lata, R$ 6,00) não saiu: devolva o valor ao cliente pelo app do PagBank. Motivo do PagBank: PagBank 400');
  });

  it('a descrição do que entra', () => {
    expect(descricaoDoQueEntra({ tipo: 'por', entra: { quantidade: 2, descricao: 'Coca lata' } })).toBe('2x Coca lata');
    expect(descricaoDoQueEntra({ tipo: 'tirar' })).toBe('o item');
  });
});
