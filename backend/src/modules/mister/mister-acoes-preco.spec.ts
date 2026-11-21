import { ACOES, ACOES_DE_PIN, apresentacaoDoPreco, canaisComOPreco, conferirAcao, precoDaAcao, reaisDaAcao, resumoDoPreco, sigaDaAcao, type MudancaDePreco } from './mister-acoes';

// M6j, lote 8: o preço de um produto por canal, com o PIN pelo link.

const base: MudancaDePreco = {
  nome: 'X-Bacon',
  para: 39.9,
  canais: [{ canal: 'ifood', de: 36.9 }],
  temPromocao: false,
  promocao: null,
  todasAsLojas: false,
};

describe('Mister · ações (lote 8) — o preço por canal', () => {
  it('é de PIN, pela permissão da rota e com "Ver valores em R$"', () => {
    expect(ACOES_DE_PIN).toContain('mudar_preco');
    expect(ACOES.mudar_preco).toMatchObject({ nivel: 'pin', permissao: 'loja', prazoMin: 15, pedeVerValores: true });
    expect(sigaDaAcao('mudar_preco')).toContain('Abrir no Regem');
    expect(sigaDaAcao('mudar_preco')).toContain('nunca peça o PIN na conversa');
    expect(sigaDaAcao('pausar_canal')).toContain('Autorizar');
  });

  it('o preço da IA: só número, maior que zero, no teto e em centavos (V109)', () => {
    expect(precoDaAcao(39.9)).toBe(39.9);
    expect(precoDaAcao(0.01)).toBe(0.01);
    expect(precoDaAcao(999999.99)).toBe(999999.99);
    for (const ruim of [0, -1, 1000000, 39.999, Number.NaN, Number.POSITIVE_INFINITY, '39,90', '39.9', null, undefined, true, {}]) expect(precoDaAcao(ruim)).toBeNull();
  });

  it('pede o produto, o canal e o preço final; o canal nunca se supõe', () => {
    expect(conferirAcao('mudar_preco', { produto: 'X-Bacon', canais: ['ifood', '99'], precoNovo: 39.9 })).toEqual({
      parametros: { acao: 'mudar_preco', produto: 'X-Bacon', canais: ['ifood', '99food'], precoNovo: 39.9 },
      resumo: 'Mudar o preço de "X-Bacon" para R$ 39,90 no iFood e na 99.',
    });
    expect(conferirAcao('mudar_preco', { produto: 'X-Bacon', canais: ['cardapio'], precoNovo: 20 })).toMatchObject({ parametros: { canais: ['regem'] } });
    for (const en of [
      { canais: ['ifood'], precoNovo: 10 },
      { produto: 'X-Bacon', precoNovo: 10 },
      { produto: 'X-Bacon', canais: [], precoNovo: 10 },
      { produto: 'X-Bacon', canais: ['rappi'], precoNovo: 10 },
      { produto: 'X-Bacon', canais: ['ifood'] },
      { produto: 'X-Bacon', canais: ['ifood'], precoNovo: '39,90' },
      { produto: 'X-Bacon', canais: ['ifood'], precoNovo: -5 },
    ])
      expect(conferirAcao('mudar_preco', en)).toHaveProperty('erro');
  });

  it('o resumo diz o preço de hoje e avisa do salto, da promoção e das outras lojas', () => {
    expect(resumoDoPreco(base)).toBe('Mudar o preço de "X-Bacon" para R$ 39,90 no iFood (hoje R$ 36,90).');
    expect(resumoDoPreco({ ...base, para: 369 })).toContain('Atenção: é o dobro ou mais do preço de hoje.');
    expect(resumoDoPreco({ ...base, para: 3.69 })).toContain('Atenção: é a metade ou menos do preço de hoje.');
    // A promoção é do Regem: no iFood ela não entra na conta.
    expect(resumoDoPreco({ ...base, temPromocao: true, promocao: 29.9 })).not.toContain('promoção');
    expect(resumoDoPreco({ ...base, canais: [{ canal: 'regem', de: 36.9 }], temPromocao: true, promocao: 29.9 })).toContain(
      'Ele está em promoção por R$ 29,90: no cardápio digital o cliente continua pagando a promoção.',
    );
    expect(resumoDoPreco({ ...base, todasAsLojas: true })).toContain('vale em todas as lojas');
  });

  it('sem poder ver valores, nenhum preço de hoje aparece', () => {
    const oculto: MudancaDePreco = { ...base, canais: [{ canal: 'regem', de: null }], temPromocao: true, promocao: null };
    const r = resumoDoPreco(oculto);
    expect(r).not.toContain('hoje');
    expect(r).not.toContain('36,90');
    expect(r).toContain('Ele está em promoção: no cardápio digital');
    expect(apresentacaoDoPreco(oculto).itens[0]).toBe('No Regem (balcão e cardápio digital): passa a R$ 39,90.');
  });

  it('a página mostra o de → para de cada canal', () => {
    const m: MudancaDePreco = { ...base, canais: [{ canal: 'ifood', de: 36.9 }, { canal: '99food', de: 37.9 }] };
    expect(apresentacaoDoPreco(m)).toEqual({
      titulo: 'Mudar o preço de "X-Bacon"?',
      detalhe: null,
      valor: 39.9,
      botao: 'Autorizar a mudança',
      itens: ['No iFood: de R$ 36,90 para R$ 39,90.', 'Na 99: de R$ 37,90 para R$ 39,90.'],
    });
  });

  it('o efeito se confere em centavos, canal a canal', () => {
    const gravado = { precoVenda: '39.9', precoIfood: '39.90', preco99: null };
    expect(canaisComOPreco(gravado, ['regem', 'ifood', '99food'], 39.9)).toEqual(['regem', 'ifood']);
    expect(canaisComOPreco({ precoVenda: '39.91' }, ['regem'], 39.9)).toEqual([]);
    expect(reaisDaAcao(1234.5)).toBe('R$ 1.234,50');
  });
});
