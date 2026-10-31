import {
  acharBairro,
  acharForma,
  acharProduto,
  acharVariacao,
  alterarEscolhas,
  faltaDaLinha,
  faltaDoPedido,
  formasDoRobo,
  montarEscolhas,
  nomeDoCliente,
  quantidadeDoPedido,
  referenciaDoPedido,
  textoDoEndereco,
  valorDoTroco,
} from './robo-pedido';
import { formasDaChave } from './robo-pedido.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

// AS REGRAS DO PEDIDO PELO WHATSAPP (Fase 5, F3): achar pelo nome, as escolhas como a tela do produto, a área, o
// pagamento e o troco, e o que falta — sem banco (o fluxo com o banco está em robo-pedido-pg.spec.ts).
const refri = {
  id: 'g-refri',
  nome: 'Escolha o refri',
  min: 1,
  max: 1,
  obrigatorio: true,
  regra: 'uma',
  opcoes: [
    { id: 'o-coca', nome: 'Coca-Cola', precoDelta: 0 },
    { id: 'o-guarana', nome: 'Guaraná', precoDelta: 0 },
    { id: 'o-coca-zero', nome: 'Coca-Cola Zero', precoDelta: 1 },
  ],
};
const adicionais = {
  id: 'g-adic',
  nome: 'Adicionais',
  min: 0,
  max: 3,
  obrigatorio: false,
  regra: 'varias_com_repeticao',
  opcoes: [
    { id: 'o-bacon', nome: 'Bacon extra', precoDelta: 4 },
    { id: 'o-queijo', nome: 'Queijo cheddar', precoDelta: 3 },
  ],
};
const talheres = { id: 'g-talher', nome: 'Talheres?', min: 0, max: 1, regra: 'uma', opcoes: [{ id: 'o-talher', nome: 'Sim', padraoMarcada: true }] };
const MENU: any = {
  loja: { pagamentos: ['pix', 'cartao', 'entrega'], areaModo: 'bairro' },
  bairros: [
    { id: 'b-centro', nome: 'Centro', taxa: 5 },
    { id: 'b-sc', nome: 'São Cristóvão', taxa: 7 },
    { id: 'b-ch', nome: 'Centro Histórico', taxa: 6 },
  ],
  produtos: [
    { id: '11111111-1111-4111-8111-111111111111', nome: 'X-Bacon', precoVenda: 25.9, grupos: [adicionais, talheres], variacoes: [] },
    { id: 'p-trio', nome: 'Trio X-Bacon', precoVenda: 34.9, grupos: [refri], variacoes: [] },
    { id: 'p-xsalada', nome: 'X-Salada', precoVenda: 22, grupos: [adicionais], variacoes: [] },
    { id: 'p-suco', nome: 'Suco natural', precoVenda: 9, grupos: [], variacoes: [{ id: 'v-300', nome: '300 ml', precoVenda: 9 }, { id: 'v-500', nome: '500 ml', precoVenda: 12 }] },
    { id: 'p-pudim', nome: 'Pudim', precoVenda: 8, esgotado: true, grupos: [], variacoes: [] },
  ],
};
const xbacon = MENU.produtos[0];
const trio = MENU.produtos[1];
const suco = MENU.produtos[3];

describe('achar o produto pelo nome', () => {
  it('"x-bacon", "xbacon" e "X bacon" são o X-Bacon — e não o Trio', () => {
    for (const t of ['x-bacon', 'xbacon', 'X bacon', 'X-BACON'])
      expect(acharProduto(MENU, t)).toEqual({ ok: true, produto: xbacon });
    expect(acharProduto(MENU, 'trio xbacon')).toEqual({ ok: true, produto: trio });
  });
  it('pelo id que veio da busca', () => {
    expect(acharProduto(MENU, xbacon.id)).toEqual({ ok: true, produto: xbacon });
  });
  it('vários com as palavras: pergunta qual (com o preço); esgotado: avisa; nada: nenhum', () => {
    const r: any = acharProduto(MENU, 'x');
    expect(r.ok).toBe(false);
    expect(r.motivo).toBe('varios');
    expect(r.opcoes.map((o: any) => o.nome)).toEqual(expect.arrayContaining(['X-Bacon', 'Trio X-Bacon', 'X-Salada']));
    expect(r.opcoes[0].preco).toMatch(/^R\$/);
    expect(acharProduto(MENU, 'pudim')).toMatchObject({ ok: false, motivo: 'esgotado' });
    expect(acharProduto(MENU, 'pizza')).toEqual({ ok: false, motivo: 'nenhum' });
    expect(acharProduto(MENU, '')).toEqual({ ok: false, motivo: 'nenhum' });
  });
});

describe('a versão e as escolhas (como a tela do produto do cardápio)', () => {
  it('versão: pelo nome; sem escolher, falta (com as opções e o preço); nome errado, nenhuma', () => {
    expect(acharVariacao(suco, '500ml')).toMatchObject({ ok: true, variacao: { id: 'v-500' } });
    expect(acharVariacao(suco, '')).toMatchObject({ ok: false, motivo: 'falta', opcoes: [{ nome: '300 ml' }, { nome: '500 ml' }] });
    expect(acharVariacao(suco, '1 litro')).toMatchObject({ ok: false, motivo: 'nenhuma' });
    expect(acharVariacao(xbacon, 'qualquer')).toEqual({ ok: true, variacao: null });
  });
  it('adicional pelo nome; a etapa sem escolha fica com a marcada do cadastro ("Talheres? Sim")', () => {
    const r = montarEscolhas(xbacon, ['bacon']);
    expect(r).toMatchObject({ naoAchei: [], passouDoLimite: [], faltaEscolher: [] });
    expect(r.complementos).toEqual(['o-bacon', 'o-talher']);
  });
  it('"2x bacon" só onde a etapa aceita repetir; acima do máximo, recusa', () => {
    expect(montarEscolhas(xbacon, ['bacon', 'bacon']).complementos).toEqual(['o-bacon', 'o-bacon', 'o-talher']);
    expect(montarEscolhas(xbacon, ['bacon', 'bacon', 'queijo', 'bacon']).passouDoLimite).toEqual([{ grupo: 'Adicionais', maximo: 3 }]);
    expect(montarEscolhas(trio, ['coca', 'guaraná']).passouDoLimite).toEqual([{ grupo: 'Escolha o refri', maximo: 1 }]);
  });
  it('etapa obrigatória sem escolha: falta (com as opções); o que não existe volta em "não achei"', () => {
    const r = montarEscolhas(trio, []);
    expect(r.faltaEscolher).toEqual([{ grupo: 'Escolha o refri', minimo: 1, maximo: 1, opcoes: ['Coca-Cola', 'Guaraná', 'Coca-Cola Zero (+R$ 1,00)'] }]);
    expect(montarEscolhas(trio, ['coca zero']).complementos).toEqual(['o-coca-zero']);
    expect(montarEscolhas(trio, ['fanta']).naoAchei).toEqual(['fanta']);
  });
  it('mudar um item: na etapa de uma escolha só, TROCA; "tirar" sai uma vez; o resto fica', () => {
    expect(alterarEscolhas(trio, ['o-guarana'], ['coca'], []).complementos).toEqual(['o-coca']);
    const r = alterarEscolhas(xbacon, ['o-bacon', 'o-bacon', 'o-talher'], [], ['bacon']);
    expect(r.complementos).toEqual(['o-bacon', 'o-talher']);
    expect(alterarEscolhas(xbacon, ['o-bacon', 'o-talher'], ['queijo'], []).complementos).toEqual(['o-bacon', 'o-queijo', 'o-talher']);
    expect(alterarEscolhas(xbacon, ['o-talher'], [], ['cebola']).naoAchei).toEqual(['cebola']);
  });
  it('o que falta numa linha guardada: a versão e a etapa obrigatória', () => {
    expect(faltaDaLinha(suco, { variacaoId: null, complementos: [] })).toEqual(['a versão (300 ml, 500 ml)']);
    expect(faltaDaLinha(trio, { variacaoId: null, complementos: [] })[0]).toMatch(/^Escolha o refri/);
    expect(faltaDaLinha(trio, { variacaoId: null, complementos: ['o-coca'] })).toEqual([]);
  });
  it('quantidade: inteiro de 1 a 50 (vazio ou 0, como a ferramenta manda quando não muda, = 1)', () => {
    expect(quantidadeDoPedido(undefined)).toBe(1);
    expect(quantidadeDoPedido(0)).toBe(1);
    expect(quantidadeDoPedido('2')).toBe(2);
    for (const v of [-1, 1.5, 51, 'dois']) expect(quantidadeDoPedido(v)).toBeNull();
  });
  it('adicionais em texto separado por vírgula (como a ferramenta do n8n manda)', () => {
    expect(montarEscolhas(xbacon, 'bacon, queijo').complementos).toEqual(['o-bacon', 'o-queijo', 'o-talher']);
    expect(alterarEscolhas(trio, ['o-coca'], 'guaraná', '').complementos).toEqual(['o-guarana']);
  });
});

describe('a entrega', () => {
  it('bairro igual (sem acento, sem espaço); parecidos; fora da lista', () => {
    expect(acharBairro(MENU, 'centro')).toEqual({ ok: true, bairro: { id: 'b-centro', nome: 'Centro' } });
    expect(acharBairro(MENU, 'sao cristovao')).toEqual({ ok: true, bairro: { id: 'b-sc', nome: 'São Cristóvão' } });
    expect(acharBairro(MENU, 'SaoCristovao')).toEqual({ ok: true, bairro: { id: 'b-sc', nome: 'São Cristóvão' } });
    expect(acharBairro(MENU, 'Histórico')).toEqual({ ok: false, parecidos: ['Centro Histórico'] });
    expect(acharBairro(MENU, 'Barra da Tijuca')).toEqual({ ok: false, parecidos: [] });
  });
  it('referência: "não tem" fica marcado como perguntado; o texto do endereço', () => {
    expect(referenciaDoPedido('não tem')).toBe('sem referência');
    expect(referenciaDoPedido('Sem referência')).toBe('sem referência');
    expect(referenciaDoPedido('casa 2, portão azul')).toBe('casa 2, portão azul');
    expect(referenciaDoPedido('')).toBeNull();
    const e: any = { tipo: 'entrega', rua: 'Rua A', numero: '10', bairro: 'Centro', referencia: 'portão azul' };
    expect(textoDoEndereco(e)).toBe('Rua A, 10 · Centro · ref: portão azul');
    expect(textoDoEndereco({ ...e, referencia: 'sem referência' })).toBe('Rua A, 10 · Centro');
  });
});

describe('o pagamento', () => {
  it('as formas do robô: as do cardápio de pagar na entrega (Pix e cartão online ficam no link)', () => {
    expect(formasDoRobo(MENU, 'entrega')).toEqual([{ forma: 'entrega', nome: 'Pagar na entrega (dinheiro ou maquininha)', pedeTroco: true }]);
    expect(formasDoRobo(MENU, 'retirada')[0].nome).toBe('Pagar na retirada (dinheiro ou maquininha)');
  });
  it('"dinheiro" e "cartão" caem no pagar na entrega; cartão não pergunta troco; "pix" vai pelo link', () => {
    expect(acharForma(MENU, 'entrega', 'dinheiro')).toEqual({ ok: true, forma: 'entrega', porCartao: false });
    expect(acharForma(MENU, 'entrega', 'cartão de crédito')).toEqual({ ok: true, forma: 'entrega', porCartao: true });
    expect(acharForma(MENU, 'entrega', 'maquininha')).toEqual({ ok: true, forma: 'entrega', porCartao: true });
    expect(acharForma(MENU, 'entrega', 'pix')).toMatchObject({ ok: false, motivo: 'so_pelo_link' });
    expect(acharForma(MENU, 'entrega', 'cheque')).toMatchObject({ ok: false, motivo: 'nenhuma' });
  });
  it('formas com nome da loja: pelo nome; "cartão" entre débito e crédito pergunta qual', () => {
    const m: any = { loja: { pagamentos: ['Dinheiro', 'Cartão de débito', 'Cartão de crédito', 'Pix'] } };
    expect(acharForma(m, 'entrega', 'pix')).toEqual({ ok: true, forma: 'Pix', porCartao: false });
    expect(acharForma(m, 'entrega', 'débito')).toEqual({ ok: true, forma: 'Cartão de débito', porCartao: false });
    expect(acharForma(m, 'entrega', 'cartão')).toMatchObject({ ok: false, motivo: 'nenhuma', opcoes: ['Dinheiro', 'Cartão de débito', 'Cartão de crédito', 'Pix'] });
    expect(formasDoRobo(m, 'entrega').find((f) => f.forma === 'Dinheiro')?.pedeTroco).toBe(true);
    expect(formasDoRobo(m, 'entrega').find((f) => f.forma === 'Pix')?.pedeTroco).toBe(false);
  });
  it('o valor do troco: "100", "R$ 100,00", "1.000"', () => {
    expect(valorDoTroco('100')).toBe(100);
    expect(valorDoTroco('R$ 100,00')).toBe(100);
    expect(valorDoTroco('1.000')).toBe(1000);
    expect(valorDoTroco('1.000,50')).toBe(1000.5);
    expect(valorDoTroco(50)).toBe(50);
    for (const v of ['', 'cem', '-5', 0]) expect(valorDoTroco(v)).toBeNull();
  });
});

describe('o que falta, na ordem em que o robô pergunta', () => {
  const base = {
    linhas: 1,
    linhasIncompletas: [],
    tipo: 'entrega' as const,
    tiposAbertos: ['entrega', 'retirada'] as ('entrega' | 'retirada')[],
    entrega: { tipo: 'entrega', rua: 'Rua A', numero: '10', bairro: 'Centro', bairroId: 'b', referencia: 'portão', lat: null, lng: null, enderecoId: null } as any,
    enderecoForaDaArea: false,
    subtotal: 40,
    pedidoMinimo: 20,
    nome: 'Ana',
    pagamento: { forma: 'entrega', trocoPara: 100, semTroco: false },
    pagamentoServe: true,
  };
  it('completo: nada falta', () => {
    expect(faltaDoPedido(base)).toEqual([]);
  });
  it('itens, escolha do item, referência, mínimo, nome, pagamento e troco', () => {
    const campos = faltaDoPedido({
      ...base,
      linhasIncompletas: [{ linha: 2, produto: 'Trio X-Bacon', falta: ['Escolha o refri (Coca-Cola, Guaraná)'] }],
      entrega: { ...base.entrega, referencia: null },
      subtotal: 15,
      nome: null,
      pagamento: { forma: 'entrega', trocoPara: null, semTroco: false },
    }).map((f) => f.campo);
    expect(campos).toEqual(['linha 2', 'referencia', 'minimo', 'nome', 'troco']);
    expect(faltaDoPedido({ ...base, linhas: 0 })[0].campo).toBe('itens');
    expect(faltaDoPedido({ ...base, pagamento: null }).map((f) => f.campo)).toEqual(['pagamento']);
    expect(faltaDoPedido({ ...base, pagamento: { forma: 'entrega', trocoPara: null, semTroco: true } })).toEqual([]);
  });
  it('fora da área e sem tipo; a retirada não pede endereço nem mínimo', () => {
    expect(faltaDoPedido({ ...base, enderecoForaDaArea: true })[0].campo).toBe('endereco');
    expect(faltaDoPedido({ ...base, tipo: null })[0]).toEqual({ campo: 'tipo', pergunta: 'Se é para entregar ou para retirar na loja.' });
    expect(faltaDoPedido({ ...base, tipo: 'retirada', entrega: { tipo: 'retirada' }, subtotal: 5 })).toEqual([]);
  });
  it('o mínimo diz quanto falta', () => {
    expect(faltaDoPedido({ ...base, subtotal: 15 })[0].pergunta).toBe('O pedido mínimo para entrega é R$ 20,00 em itens (faltam R$ 5,00).');
  });
});

describe('o nome e o telefone', () => {
  it('nome com letra, até 60', () => {
    expect(nomeDoCliente('  Ana   Maria ')).toBe('Ana Maria');
    expect(nomeDoCliente('123')).toBeNull();
  });
  it('as formas do número no cadastro: com/sem 55 e com/sem o nono dígito', () => {
    expect(formasDaChave('21987654321')).toEqual(['21987654321', '5521987654321', '2187654321', '552187654321']);
    expect(formasDaChave('2133334444')).toEqual(['2133334444', '552133334444']); // fixo: sem nono dígito
  });
});
