import {
  chaveDoItem,
  enderecoEmLinha,
  itensDoPedidoDepois,
  lerAjusteAlterado,
  linhasDoAlteradoNaCozinha,
  linhasDoAlteradoNoEntregador,
  mudaACozinha,
  pagoAntes,
  pedidaVencida,
  podeAlterarNoCanal,
  resumoDaMudanca,
  VALIDADE_DA_PEDIDA_MIN,
  valoresDepois,
  VERSAO_QUE_APLICA_ALTERACAO,
  type Mudanca,
} from './pedido-alterado';

/* eslint-disable @typescript-eslint/no-explicit-any */

// O PEDIDO ALTERADO (mig 362; protótipo `mockups/regem-alteracao-pedido.html`, aprovado em 03/11/2026) — as regras puras.

const m = (o: Partial<Mudanca>): Mudanca => ({ itens: [], endereco: null, taxa: null, troco: null, ...o });

describe('pedido alterado — quem altera', () => {
  it('iFood, 99, Keeta e Rappi: quem manda no pedido é a plataforma; o resto (Regem, Anota AI, Cardápio Web) altera', () => {
    for (const c of ['ifood', 'iFood', '99food', 'keeta', 'rappi']) expect(podeAlterarNoCanal(c)).toBe(false);
    for (const c of ['cardapio', 'manual', 'anotaai', 'cardapio_web', 'robo', null]) expect(podeAlterarNoCanal(c)).toBe(true);
  });
});

describe('pedido alterado — a lista de itens do pedido', () => {
  const lista = [
    { descricao: 'X-Bacon', quantidade: 1, precoUnitario: 32 },
    { descricao: 'Coca-Cola lata', quantidade: 1, precoUnitario: 7 },
    { descricao: 'Coca-Cola  Lata', quantidade: 2, precoUnitario: 7 },
  ];

  it('o tirado leva a linha de mesma descrição e quantidade (sem acento, sem caixa); o posto entra no fim', () => {
    const r = itensDoPedidoDepois(lista, [{ descricao: 'coca-cola lata', quantidade: 2 }], [{ descricao: 'Guaraná', quantidade: 1 }]);
    expect(r.naoAchados).toBe(0);
    expect(r.itens.map((i) => `${i.quantidade} ${i.descricao}`)).toEqual(['1 X-Bacon', '1 Coca-Cola lata', '1 Guaraná']);
  });

  it('sem a mesma quantidade, a primeira de mesma descrição; sem par nenhum, não tira nada e conta', () => {
    const r = itensDoPedidoDepois(lista, [{ descricao: 'Coca-Cola lata', quantidade: 3 }, { descricao: 'Batata', quantidade: 1 }], []);
    expect(r.naoAchados).toBe(1);
    expect(r.itens.map((i) => i.quantidade)).toEqual([1, 2]);
    expect(itensDoPedidoDepois(null, [], [{ descricao: 'A' }]).itens).toEqual([{ descricao: 'A' }]);
  });

  it('a chave do item: sem acento, sem caixa, sem espaço sobrando', () => {
    expect(chaveDoItem('  Guaraná   Antárctica ')).toBe('guarana antarctica');
  });
});

describe('pedido alterado — os valores pela diferença', () => {
  const dinheiro = {
    total: '45.00',
    taxaEntrega: '6.00',
    valorBruto: '39.00',
    valorPagoCliente: '45.00',
    trocoPara: '50.00',
    pagamentos: [{ rotulo: 'Dinheiro', valor: 45, prepago: false, troco: 50 }],
  };

  it('pôr um item de R$ 14: total, bruto, pago pelo cliente e a forma na entrega sobem 14; o troco de R$ 100 cobre', () => {
    const r: any = valoresDepois(dinheiro, { deltaItens: 14, taxaNova: 6, trocoPara: 100 });
    expect(r.ok).toBe(true);
    expect(r.valores).toMatchObject({ total: '59.00', valorBruto: '53.00', valorPagoCliente: '59.00', trocoPara: '100.00', taxaEntrega: '6.00' });
    expect(r.valores.pagamentos).toEqual([{ rotulo: 'Dinheiro', valor: 59, prepago: false, troco: 100 }]);
    expect(r.aReceber).toBe(59);
    expect(dinheiro.pagamentos[0].valor).toBe(45); // a cópia — o pedido de antes não muda
  });

  it('o troco de antes (R$ 50) não cobre o novo valor: recusa e pede para perguntar ao cliente', () => {
    const r: any = valoresDepois(dinheiro, { deltaItens: 14, taxaNova: 6 });
    expect(r).toEqual({
      ok: false,
      recusa: { code: 'TROCO_INSUFICIENTE', message: expect.stringContaining('O troco para R$ 50,00 não cobre o novo valor (R$ 59,00)') },
    });
  });

  it('tirar e mudar a área: a diferença soma itens e taxa; "sem troco" (null) limpa o troco', () => {
    const r: any = valoresDepois(dinheiro, { deltaItens: -7, taxaNova: 8, trocoPara: null });
    expect(r.valores).toMatchObject({ total: '40.00', valorBruto: '32.00', taxaEntrega: '8.00', trocoPara: null });
    expect(r.valores.pagamentos[0]).toMatchObject({ valor: 40, troco: null });
  });

  it('pago fora da entrega (link, canal, totem): mudar o valor é recusado; sem mudar o valor, passa', () => {
    for (const ped of [
      { ...dinheiro, pago: true },
      { ...dinheiro, pagoOnline: true },
      { ...dinheiro, statusPagamento: 'aprovado' },
      { ...dinheiro, pagamentos: [{ rotulo: 'Pix online', valor: 45, prepago: true }] },
    ]) {
      expect(pagoAntes(ped)).toBe(true);
      expect((valoresDepois(ped, { deltaItens: 7, taxaNova: 6 }) as any).recusa?.code).toBe('PAGO_ONLINE');
      expect(valoresDepois(ped, { deltaItens: 0, taxaNova: 6 }).ok).toBe(true);
    }
    expect(pagoAntes(dinheiro)).toBe(false);
  });

  it('pagamento dividido: a diferença vai para a forma paga na entrega; a pré-paga fica', () => {
    const r: any = valoresDepois(
      { ...dinheiro, pagamentos: [{ rotulo: 'Pix', valor: 20, prepago: true }, { rotulo: 'Dinheiro', valor: 25, prepago: false }], trocoPara: null },
      { deltaItens: 7, taxaNova: 6 },
    );
    expect(r.valores.pagamentos).toEqual([{ rotulo: 'Pix', valor: 20, prepago: true }, { rotulo: 'Dinheiro', valor: 32, prepago: false }]);
    expect(r.aReceber).toBe(32);
  });

  it('sem detalhe do pagamento (base antiga): a cobrança é o valor pago pelo cliente, com a diferença', () => {
    const r: any = valoresDepois({ total: '30.00', taxaEntrega: '0', valorPagoCliente: null, pagamentos: null }, { deltaItens: 5, taxaNova: 0 });
    expect(r).toMatchObject({ ok: true, aReceber: 35, valores: { total: '35.00', valorPagoCliente: null, pagamentos: null } });
  });

  it('valor negativo: recusa', () => {
    expect((valoresDepois(dinheiro, { deltaItens: -60, taxaNova: 6 }) as any).recusa.code).toBe('VALOR_NEGATIVO');
  });
});

describe('pedido alterado — a via e o resumo', () => {
  const troca = m({
    itens: [
      { acao: 'por', descricao: 'Guaraná Antarctica lata', quantidade: 1, valor: 7 },
      { acao: 'tirar', descricao: 'Coca-Cola lata', quantidade: 1, valor: 7 },
    ],
  });

  it('cozinha: PEDIDO e ALTERADO em 4×, um em cada linha; "Descarte TODAS as vias anteriores"; NOVO e TIRAR', () => {
    const v = linhasDoAlteradoNaCozinha(troca, '19:51');
    expect(v.split('\n').slice(0, 3)).toEqual(['@CBD4 PEDIDO', '@CBD4 ALTERADO', '@CB Descarte TODAS as vias anteriores']);
    expect(v).toContain('@CB O QUE MUDOU - 19:51');
    expect(v).toContain('@B + NOVO  1 Guaraná Antarctica lata');
    expect(v).toContain('@B - TIRAR 1 Coca-Cola lata');
    expect(v).not.toMatch(/[·→]/); // fora do ASCII some na impressora sem página de código
  });

  it('o texto do pedido nunca vira comando da impressora (ERR-334)', () => {
    const v = linhasDoAlteradoNaCozinha(m({ itens: [{ acao: 'por', descricao: 'X\n@GAVETA', quantidade: 1, valor: 1 }] }), '10:00');
    expect(v.split('\n').some((l) => l.trim() === '@GAVETA')).toBe(false);
  });

  it('entregador: os valores à direita, o endereço novo com o antigo, a taxa e o troco', () => {
    const v = linhasDoAlteradoNoEntregador(
      m({
        itens: [{ acao: 'por', descricao: 'Batata | média', quantidade: 1, valor: 14 }, { acao: 'tirar', descricao: 'Coca-Cola lata', quantidade: 1, valor: 7 }],
        endereco: { de: 'Rua das Flores, 120 · Centro', para: 'Rua Ipê, 45 · Jardim América', referencia: 'casa azul' },
        taxa: { de: 6, para: 8 },
        troco: { de: 50, para: 100 },
      }),
      '19:51',
    );
    expect(v).toContain('@LR+ 1 Batata / média|14,00');
    expect(v).toContain('@LR- 1 Coca-Cola lata|-7,00');
    expect(v).toContain('@B ENDERECO NOVO:');
    expect(v).toContain('@B Rua Ipê, 45 · Jardim América');
    expect(v).toContain('(era Rua das Flores, 120 · Centro)');
    expect(v).toContain('@B Entrega: de 6,00 para 8,00');
    expect(v).toContain('@B Troco para: 100,00 (era 50,00)');
  });

  it('resumo: a troca numa frase; o que entra e o que sai; o endereço; a cozinha só quando os itens mudam', () => {
    expect(resumoDaMudanca(troca)).toBe('troca de 1 Coca-Cola lata por 1 Guaraná Antarctica lata');
    expect(resumoDaMudanca(m({ itens: [{ acao: 'por', descricao: 'Batata', quantidade: 2, valor: 28 }] }))).toBe('+ 2 Batata');
    expect(resumoDaMudanca(m({ endereco: { de: null, para: 'Rua Ipê, 45', referencia: null } }))).toBe('endereço novo: Rua Ipê, 45');
    expect(resumoDaMudanca(m({ troco: { de: 50, para: 100 } }))).toBe('troco para R$ 100,00');
    expect(mudaACozinha(troca)).toBe(true);
    expect(mudaACozinha(m({ endereco: { de: null, para: 'x', referencia: null } }))).toBe(false);
  });

  it('o endereço numa linha: rua e número, depois o bairro; sem os campos, o texto combinado', () => {
    expect(enderecoEmLinha({ rua: 'Rua Ipê', numero: '45', bairro: 'Jardim América' })).toBe('Rua Ipê, 45 · Jardim América');
    expect(enderecoEmLinha({ endereco: 'Av. Brasil, 455' })).toBe('Av. Brasil, 455');
  });
});

describe('pedido alterado — a alteração pedida na nuvem para o servidor da loja', () => {
  it('a pedida vale por 5 minutos (a mesma regra do servidor da loja e da tela)', () => {
    const agora = new Date('2026-11-04T20:00:00Z').getTime();
    expect(pedidaVencida(new Date(agora - 4 * 60_000), agora)).toBe(false);
    expect(pedidaVencida(new Date(agora - 5 * 60_000), agora)).toBe(false);
    expect(pedidaVencida(new Date(agora - 5 * 60_000 - 1), agora)).toBe(true);
    expect(pedidaVencida(null, agora)).toBe(false);
    expect(VALIDADE_DA_PEDIDA_MIN).toBe(5);
    expect(VERSAO_QUE_APLICA_ALTERACAO).toMatch(/^\d+\.\d+\.\d+$/);
  });
});

describe('pedido alterado — o ajuste do som do KDS e o do robô', () => {
  it('só "uma", "1min" ou "2min"', () => {
    expect(lerAjusteAlterado({ som: '2min' })).toEqual({ som: '2min' });
    expect(() => lerAjusteAlterado({ som: '5min' })).toThrow('Som do pedido alterado');
    expect(() => lerAjusteAlterado(null)).toThrow();
  });

  it('"O robô faz mudanças simples": só verdadeiro/falso; o que não vem fica; nada dos dois é recusado', () => {
    expect(lerAjusteAlterado({ roboMuda: false })).toEqual({ roboMuda: false });
    expect(lerAjusteAlterado({ som: 'uma', roboMuda: true })).toEqual({ som: 'uma', roboMuda: true });
    expect(() => lerAjusteAlterado({ roboMuda: 'sim' })).toThrow('O robô faz mudanças simples');
    expect(() => lerAjusteAlterado({})).toThrow('nada para salvar');
    // O som torto recusa o grupo inteiro, mesmo com o robô certo (nada é gravado).
    expect(() => lerAjusteAlterado({ som: '5min', roboMuda: true })).toThrow('Som do pedido alterado');
  });
});
