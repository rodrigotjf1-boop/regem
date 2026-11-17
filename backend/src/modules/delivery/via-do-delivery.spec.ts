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
      plataforma: 'Regem 12', // o cardápio próprio sai "Regem" (16/11/2026)
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
    // Dono, 16/11/2026: a SENHA no alto ("SENHA 5 - DELIVERY") e o canal com o nº do pedido nele logo abaixo — o canal não
    // repete mais embaixo do "PEDIDO #284" (antes, 28/10: o número do painel em destaque e sem a senha).
    expect(linhas.slice(0, 6)).toEqual(['@CBD SENHA 5 - DELIVERY', '@CBD Regem 12', '@CB Loja Fictícia', '@CB Rua da Loja, 1', '@CBD PEDIDO #284', '@CB DELIVERY']);
    expect(linhas.filter((l) => /Regem 12/.test(l))).toHaveLength(1);
    expect(linhas).toEqual(
      expect.arrayContaining([
        '@BD Cliente Fictício', // nome em destaque
        '@BSD Rua Fictícia, 10', // endereço: destaque intermediário, uma linha por informação
        '@BSD Centro',
        '@BSD Ref: portão azul',
        '2x Lanche Fictício', // a lista do cardápio sai da descrição...
        '@B    + 2X BACON', // ...e vira a linha do adicional, em negrito
        '@B    OBS: BEM GELADO',
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

  // Mig 346 (pedido do dono, 31/10/2026): a observação GERAL do pedido logo abaixo do endereço, em negrito. O texto do
  // cliente nunca começa uma linha: "@GAVETA" sozinho numa linha abre a gaveta de dinheiro na impressora.
  it('a observação do pedido sai logo abaixo do endereço; o texto do cliente não vira comando da impressora', () => {
    const conteudo = producao.renderCupomPerfil(
      perfilEfetivo('entregador', null),
      dadosDaViaDoDelivery(pedido({ observacao: 'interfone ruim\n@GAVETA' }), itens),
    );
    const linhas = conteudo.split('\n');
    const i = linhas.indexOf('@BSD Ref: portão azul');
    expect(linhas[i + 1]).toBe('@B OBS: INTERFONE RUIM @GAVETA'); // em caixa alta (16/11/2026)
    expect(linhas.some((l) => l.trim() === '@GAVETA')).toBe(false);
    // Sem observação, nada; e a retirada também mostra (não tem endereço, mas tem o recado).
    expect(producao.renderCupomPerfil(perfilEfetivo('entregador', null), dadosDaViaDoDelivery(pedido(), itens))).not.toContain('OBS: interfone');
    const ret = producao.renderCupomPerfil(perfilEfetivo('entregador', null), dadosDaViaDoDelivery(pedido({ tipo: 'retirada', observacao: 'vou buscar às 20h' }), itens));
    expect(ret).toContain('@B OBS: VOU BUSCAR ÀS 20H');
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
    expect(linhas.slice(i + 1, i + 3)).toEqual(['@B    + BATATA MÉDIA', '@B    + COCA-COLA LATA']); // em caixa alta (16/11/2026)
    expect(linhas).toContain('@C iFood 6214'); // sem senha no pedido, o canal fica na linha dele
  });

  it('via de produção de quem nunca editou o modelo: "PEDIDO #10", o canal embaixo, a senha pequena e o combo uma escolha por linha', () => {
    const ctx = { origem: 'delivery', plataforma: 'iFood', senhaPlataforma: '6214', senha: 1, senhaPrefixo: 'D', cliente: 'Ana', pedidoNumero: 10 };
    const its = [{ quantidade: 1, descricao: 'Trio 08', complementosTexto: 'Batata média · Coca-Cola lata', observacao: 'sem gelo' }];
    const linhas = (servico as any).renderTicket(ctx, its, 57, null).split('\n');
    expect(linhas.slice(0, 6)).toEqual(['*** PRODUCAO ***', '@CBD PEDIDO #10', '@C iFood 6214', '@B DELIVERY', '@B Ana', '@S SENHA 1 - DELIVERY']);
    expect(linhas.join('\n')).not.toContain('#57'); // o número da cozinha (outro contador) não sai
    const i = linhas.indexOf('1x Trio 08');
    expect(linhas.slice(i + 1, i + 4)).toEqual(['@B   + BATATA MÉDIA', '@B   + COCA-COLA LATA', '  ** OBS: SEM GELO']);
    // Sem o número do painel (cartão antigo): o cabeçalho de antes, com a senha grande.
    const antigo = (servico as any).renderTicket({ ...ctx, pedidoNumero: null }, its, 57, null).split('\n');
    expect(antigo).toEqual(expect.arrayContaining(['>>> SENHA 1 - DELIVERY <<<', 'DELIVERY · #57', '@B iFood 6214']));
    // Balcão (sem canal): como sempre — a senha é por onde a cozinha chama.
    const balcao = (servico as any).renderTicket({ origem: 'balcao', senha: 7, senhaPrefixo: 'B', pedidoNumero: 10 }, its, 58, null).split('\n');
    expect(balcao.slice(0, 3)).toEqual(['*** PRODUCAO ***', '>>> SENHA 7 - BALCÃO <<<', 'BALCAO · #58']);
  });
});

// Pedido do dono, 16/11/2026: o cupom do caixa ~30% maior, os de produção muito maiores, a senha por extenso, o canal
// embaixo da senha no cupom do delivery e o adicional e a observação em caixa alta.
describe('as vias de 16/11: senha por extenso, canal embaixo, caixa alta e o cupom maior', () => {
  const servico = new ProducaoPedidoService({} as any, {} as any, {} as any);
  const its = [
    { quantidade: 1, descricao: 'X-Bacon', complementosTexto: 'Cheddar extra', observacao: 'sem cebola', precoUnitario: 30 },
  ];
  // o perfil de produção como a loja de 16/11 gravou: todos os campos em "Normal" (sem escala)
  const daLoja = (id: string, extra: any = {}) =>
    perfilEfetivo(id, {
      campos: [
        { key: 'senha', visivel: true, negrito: true, alinhamento: 'centro' },
        { key: 'mesa', visivel: true, negrito: true, alinhamento: 'esquerda' },
        { key: 'dataHora', visivel: true, negrito: false, alinhamento: 'esquerda' },
        { key: 'itens', visivel: true, negrito: false, alinhamento: 'esquerda' },
      ],
      ...extra,
    } as any);

  it('produção da loja (tudo em Normal): dois passos maior — o dobro —, senha por extenso, adicional e observação em caixa alta', () => {
    const linhas = servico.renderCupomPerfil(daLoja('producao_balcao'), { senha: 7, senhaPrefixo: 'B', itens: its }).split('\n');
    expect(linhas).toEqual(
      expect.arrayContaining(['@CBD SENHA 7 - BALCÃO', '@BD BALCAO', '@D 1x X-Bacon', '@D    + CHEDDAR EXTRA', '@D    OBS: SEM CEBOLA']),
    );
    // a loja que escolher "Como os campos estão" volta ao tamanho gravado
    const comoEsta = servico.renderCupomPerfil(daLoja('producao_balcao', { aumento: 0 }), { senha: 7, senhaPrefixo: 'B', itens: its }).split('\n');
    expect(comoEsta).toEqual(expect.arrayContaining(['@CB SENHA 7 - BALCÃO', '@B BALCAO', '1x X-Bacon', '   + CHEDDAR EXTRA', '   OBS: SEM CEBOLA']));
  });

  it('caixa: um passo maior — o Normal vira Média (~+40%); o que já é Grande fica', () => {
    const linhas = servico
      .renderCupomPerfil(perfilEfetivo('caixa', null), { senha: 5, senhaPrefixo: 'B', dataHora: '16/11/2026 23:00', itens: its, totalGeral: 30 })
      .replace(/ /g, ' ')
      .split('\n');
    expect(linhas).toContain('@SD 16/11/2026 23:00'); // Normal → Média
    expect(linhas).toContain('@CBSD SENHA 5 - BALCÃO'); // a senha do padrão (Normal) também sobe para a Média
    // a loja de 16/11 gravou a senha do caixa em Grande: fica Grande (o aumento não passa do Grande)
    const daLoja = perfilEfetivo('caixa', { campos: [{ key: 'senha', visivel: true, negrito: true, alinhamento: 'centro', escala: 2 }, { key: 'itens', visivel: true }] } as any);
    expect(servico.renderCupomPerfil(daLoja, { senha: 5, senhaPrefixo: 'B', itens: its }).split('\n')[0]).toBe('@CBD SENHA 5 - BALCÃO');
  });

  it('cupom do delivery: a senha no alto e o canal com o nº do pedido nele logo abaixo — uma vez só; sem a senha à vista, o canal na linha dele', () => {
    const dados = { senha: 9, senhaPrefixo: 'D', plataforma: 'iFood 6214', pedidoRegem: 284, itens: its };
    const linhas = servico.renderCupomPerfil(perfilEfetivo('entregador', null), dados).split('\n');
    expect(linhas.slice(0, 2)).toEqual(['@CBD SENHA 9 - DELIVERY', '@CBD iFood 6214']);
    expect(linhas.filter((l) => l.includes('iFood 6214'))).toHaveLength(1);
    const semSenha = servico
      .renderCupomPerfil(perfilEfetivo('entregador', { campos: [{ key: 'senha', visivel: false }, { key: 'plataforma', visivel: true, alinhamento: 'centro' }, { key: 'itens', visivel: true }] } as any), dados)
      .split('\n');
    expect(semSenha).toContain('@C iFood 6214');
    expect(semSenha.join('\n')).not.toContain('SENHA');
    // o cardápio próprio sai "Regem"
    expect(dadosDaViaDoDelivery({ canal: 'cardapio', displayId: '12', numero: 284 } as any, []).plataforma).toBe('Regem 12');
  });
});
