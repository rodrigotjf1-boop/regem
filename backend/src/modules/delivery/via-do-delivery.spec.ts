import { ProducaoPedidoService } from '../producao-pedido/producao-pedido.service';
import { perfilEfetivo } from './cupom-perfis';
import { dadosDaViaDoDelivery } from './via-do-delivery';

/* eslint-disable @typescript-eslint/no-explicit-any */

// A VIA DO DELIVERY (pedido do dono, 22/10/2026): a comanda do pedido de canal que sai no caixa "sem os dados do
// cliente", com "Venda balcão" e o total só dos itens. Agora: o perfil "Cliente — delivery" com os dados do pedido e os
// destaques do dono — nº do pedido e nome em destaque, endereço intermediário, total do tamanho da senha, troco em negrito.
describe('via do delivery — dados do pedido e impressão', () => {
  const servico = new ProducaoPedidoService({} as any, {} as any, {} as any);
  // O real sai com espaço não separável ("R$ 34,00"); o teste compara com o espaço comum.
  const producao = { renderCupomPerfil: (...a: Parameters<ProducaoPedidoService['renderCupomPerfil']>) => servico.renderCupomPerfil(...a).replace(/ /g, ' ') };
  const itens = [
    { quantidade: 2, descricao: 'Lanche Fictício (2x Bacon)', precoUnitario: 12, escolhas: [{ tipo: 'adicionar', nome: 'Bacon' }, { tipo: 'adicionar', nome: 'Bacon' }] },
    { quantidade: 1, descricao: 'Refrigerante Fictício', precoUnitario: 6, observacao: 'bem gelado' },
  ];
  // Pedido do cardápio, entrega, dinheiro na entrega com troco para R$ 50: itens 30 + taxa 6 − desconto 2 = 34.
  const pedido = (extra: any = {}) => ({
    canal: 'cardapio',
    displayId: '12',
    numero: 284,
    tipo: 'entrega',
    clienteNome: 'Cliente Fictício',
    clienteTelefone: '(00) 0000-0000',
    endereco: 'Rua Fictícia, 10 - Centro',
    enderecoRua: 'Rua Fictícia',
    enderecoNumero: '10',
    enderecoBairro: 'Centro',
    enderecoReferencia: 'portão azul',
    criadoEm: new Date('2026-10-23T00:30:00Z'),
    taxaEntrega: '6.00',
    desconto: '2.00',
    total: '34.00',
    valorPagoCliente: '34.00',
    formaPagamento: 'dinheiro',
    trocoPara: '50',
    pago: false,
    pagamentos: [{ rotulo: 'Dinheiro', valor: 34, prepago: false, troco: 50 }],
    ...extra,
  });

  it('os dados: canal e nº, nome, telefone, endereço, total com taxa e desconto, a cobrar e o troco a levar', () => {
    const d: any = dadosDaViaDoDelivery(pedido(), itens, { senha: 5, senhaPrefixo: 'D', forma: 'Dinheiro' });
    expect(d).toMatchObject({
      senha: 5,
      senhaPrefixo: 'D',
      tipoPedido: 'DELIVERY',
      plataforma: 'Cardápio 12',
      pedidoRegem: '#284',
      dataHora: '22/10/2026, 21:30:00', // a hora do pedido, no fuso da loja
      cliente: 'Cliente Fictício',
      telefone: '(00) 0000-0000',
      endereco: 'Rua Fictícia, 10\nCentro\nRef: portão azul',
      subtotal: 30,
      taxaEntrega: 6,
      desconto: 2,
      totalGeral: 34,
      cobrarCliente: 34,
      pagamento: 'Dinheiro',
      troco: 50,
      trocoLevar: 16,
    });
  });

  it('pago online: nada a cobrar e sem troco; retirada: sem endereço', () => {
    const pago: any = dadosDaViaDoDelivery(pedido({ pago: true, statusPagamento: 'aprovado' }), itens);
    expect(pago.cobrarCliente).toBe(0);
    expect(pago.troco).toBeUndefined();
    const retirada: any = dadosDaViaDoDelivery(pedido({ tipo: 'retirada' }), itens);
    expect(retirada.endereco).toBeUndefined();
    expect(retirada.tipoPedido).toBe('RETIRADA');
    // Sem taxa e sem desconto, as linhas não saem.
    const limpo: any = dadosDaViaDoDelivery(pedido({ taxaEntrega: '0', desconto: '0' }), itens);
    expect(limpo.taxaEntrega).toBeUndefined();
    expect(limpo.desconto).toBeUndefined();
  });

  it('impressa no padrão do Regem: destaques, cabeçalho e rodapé, troco em linha própria, sem "Venda balcao"', () => {
    const conteudo = producao.renderCupomPerfil(
      perfilEfetivo('entregador', null),
      dadosDaViaDoDelivery(pedido(), itens, {
        senha: 5,
        senhaPrefixo: 'D',
        forma: 'Dinheiro',
        nomeLoja: 'Loja Fictícia\nRua da Loja, 1',
        qrData: 'https://exemplo.invalid/e/abc',
      }),
      undefined,
      'Obrigado!\nVolte sempre',
    );
    const linhas = conteudo.split('\n');
    // Dono, 28/10/2026: "PEDIDO #284" (o número do painel) em destaque, o do canal logo abaixo e menor, sem a senha.
    expect(linhas.slice(0, 5)).toEqual(['@CB Loja Fictícia', '@CB Rua da Loja, 1', '@CBD PEDIDO #284', '@C Cardápio 12', '@CB DELIVERY']);
    expect(conteudo).not.toMatch(/SENHA/i);
    expect(linhas).toEqual(
      expect.arrayContaining([
        '@BD Cliente Fictício', // nome em destaque
        '@BSD Rua Fictícia, 10', // endereço: destaque intermediário, uma linha por informação
        '@BSD Centro',
        '@BSD Ref: portão azul',
        '2x Lanche Fictício', // a lista do cardápio sai da descrição...
        '@B    + 2x Bacon', // ...e vira a linha do adicional, em negrito
        '@B    OBS: bem gelado',
        'Entrega: R$ 6,00',
        'Desconto: -R$ 2,00',
        '@BD TOTAL: R$ 34,00', // do tamanho da senha
        '@CB COBRAR R$ 34,00',
        'Pagamento: Dinheiro',
        '@B Troco para R$ 50,00',
        '@B LEVAR TROCO: R$ 16,00',
        '@QR:https://exemplo.invalid/e/abc',
        '@C Obrigado!',
        '@C Volte sempre',
      ]),
    );
    expect(conteudo).not.toMatch(/Venda balcao/i);
    // O troco não se repete na linha do pagamento.
    expect(linhas.filter((l) => l.includes('Troco para'))).toHaveLength(1);
  });

  it('pago online sai "PAGO - NADA A COBRAR" (antes, "COBRAR R$ 0,00")', () => {
    const conteudo = producao.renderCupomPerfil(perfilEfetivo('entregador', null), dadosDaViaDoDelivery(pedido({ pago: true }), itens));
    expect(conteudo).toContain('@CB PAGO - NADA A COBRAR');
    expect(conteudo).not.toContain('COBRAR R$');
  });

  it('perfil do balcão usado num pedido de canal: diz o tipo no lugar de "Venda balcao"', () => {
    const conteudo = producao.renderCupomPerfil(perfilEfetivo('caixa', null), { tipoPedido: 'DELIVERY', itens: [] });
    expect(conteudo).toContain('DELIVERY');
    expect(conteudo).not.toContain('Venda balcao');
    expect(producao.renderCupomPerfil(perfilEfetivo('caixa', null), { itens: [] })).toContain('Venda balcao');
  });

  // Dono, 28/10/2026: o "Trio 08" (lanche + batata + bebida) com a batata e a bebida cada uma na sua linha, recuadas e em
  // negrito, embaixo do produto — numa linha só, a bebida passava batida.
  it('combo do canal: quantidade + produto, e cada escolha na sua linha, recuada e em negrito', () => {
    const trio = [{ quantidade: 1, descricao: 'Trio 08', precoUnitario: 39.9, complementosTexto: 'Batata média · Coca-Cola lata' }];
    const conteudo = producao.renderCupomPerfil(perfilEfetivo('entregador', null), dadosDaViaDoDelivery(pedido({ canal: 'ifood', displayId: '6214' }), trio));
    const linhas = conteudo.split('\n');
    const i = linhas.indexOf('1x Trio 08');
    expect(i).toBeGreaterThan(-1);
    expect(linhas.slice(i + 1, i + 3)).toEqual(['@B    + Batata média', '@B    + Coca-Cola lata']);
    expect(linhas).toContain('@C iFood 6214');
  });

  it('via de produção de quem nunca editou o modelo: "PEDIDO #10", o canal embaixo, a senha pequena e o combo uma escolha por linha', () => {
    const ctx = { origem: 'delivery', plataforma: 'iFood', senhaPlataforma: '6214', senha: 1, senhaPrefixo: 'D', cliente: 'Ana', pedidoNumero: 10 };
    const its = [{ quantidade: 1, descricao: 'Trio 08', complementosTexto: 'Batata média · Coca-Cola lata', observacao: 'sem gelo' }];
    const linhas = (servico as any).renderTicket(ctx, its, 57, null).split('\n');
    expect(linhas.slice(0, 6)).toEqual(['*** PRODUCAO ***', '@CBD PEDIDO #10', '@C iFood 6214', '@B DELIVERY', '@B Ana', '@S senha D-1']);
    expect(linhas.join('\n')).not.toContain('#57'); // o número da cozinha (outro contador) não sai
    const i = linhas.indexOf('1x Trio 08');
    expect(linhas.slice(i + 1, i + 4)).toEqual(['@B   + Batata média', '@B   + Coca-Cola lata', '  ** OBS: sem gelo']);
    // Sem o número do painel (cartão antigo): o cabeçalho de antes, com a senha grande.
    const antigo = (servico as any).renderTicket({ ...ctx, pedidoNumero: null }, its, 57, null).split('\n');
    expect(antigo).toEqual(expect.arrayContaining(['>>> SENHA D-1 <<<', 'DELIVERY · #57', '@B iFood 6214']));
    // Balcão (sem canal): como sempre — a senha é por onde a cozinha chama.
    const balcao = (servico as any).renderTicket({ origem: 'balcao', senha: 7, senhaPrefixo: 'B', pedidoNumero: 10 }, its, 58, null).split('\n');
    expect(balcao.slice(0, 3)).toEqual(['*** PRODUCAO ***', '>>> SENHA B-7 <<<', 'BALCAO · #58']);
  });
});
