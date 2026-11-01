import {
  EstadoDaConducao,
  acharBairro,
  acharForma,
  acharProduto,
  acharVariacao,
  adicionaisDoItem,
  alterarEscolhas,
  conducaoDoPedido,
  ehLanche,
  escolhasQueFaltam,
  faltaDaLinha,
  formasDoRobo,
  montarEscolhas,
  nomeDoCliente,
  opcoesDePagamento,
  pedeExtras,
  precisaDeTroco,
  precisaDoMeio,
  quantidadeDoPedido,
  quantidadeNoNome,
  referenciaDoPedido,
  semTrocoNoTexto,
  sugestoesDeTroco,
  temAdicionalOpcional,
  temOpcao,
  textoDoEndereco,
  valorDoTroco,
} from './robo-pedido';
import { estavel, formasDaChave, respostaNegativa } from './robo-pedido.service';

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
  // 3º teste do dono (31/10, ERR-336): "trio 08" por áudio virou o lanche Número 08 — o TRIO 08 está em duas categorias
  // e voltava "mais de um produto com esse nome" com duas opções iguais.
  it('o MESMO produto em duas categorias é um só (fica a cópia com etapas); número com e sem zero, e falado', () => {
    const etapa = { id: 'g-bat', nome: 'Tamanho da batata', min: 1, max: 1, obrigatorio: true, regra: 'uma', opcoes: [{ id: 'o-p', nome: 'Pequena', precoDelta: 0 }] };
    const LOJA: any = {
      produtos: [
        { id: 't08-mais', nome: 'TRIO 08', precoVenda: 32.5, grupos: [], variacoes: [] },
        { id: 't08', nome: 'TRIO 08', precoVenda: 32.5, grupos: [etapa], variacoes: [] },
        { id: 'n08', nome: 'Numero 08', precoVenda: 21.5, grupos: [], variacoes: [] },
        { id: 't01', nome: 'TRIO 01', precoVenda: 28, grupos: [], variacoes: [] },
        { id: 't10', nome: 'TRIO 10', precoVenda: 20, grupos: [], variacoes: [] },
        { id: 'xa', nome: 'X Especial', precoVenda: 30, grupos: [], variacoes: [] },
        { id: 'xb', nome: 'X Especial', precoVenda: 35, grupos: [], variacoes: [] },
      ],
    };
    for (const t of ['trio 08', 'TRIO 8', 'trio oito', 'trio zero oito']) expect(acharProduto(LOJA, t)).toMatchObject({ ok: true, produto: { id: 't08' } });
    expect(acharProduto(LOJA, 'numero 8')).toMatchObject({ ok: true, produto: { id: 'n08' } });
    expect(acharProduto(LOJA, 'trio 1')).toMatchObject({ ok: true, produto: { id: 't01' } });
    // Nome igual e preço diferente: são dois produtos — volta a pergunta, com o id de cada um para o robô usar.
    const r: any = acharProduto(LOJA, 'x especial');
    expect(r).toMatchObject({ ok: false, motivo: 'varios' });
    expect(r.opcoes.map((o: any) => o.id).sort()).toEqual(['xa', 'xb']);
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
  it('F5: a opção copiada com o detalhe ("Bacon extra — +R$ 4,00") — a vírgula do preço não parte o nome', () => {
    expect(montarEscolhas(xbacon, 'Bacon extra — +R$ 4,00, Queijo cheddar — +R$ 3,00').complementos).toEqual(['o-bacon', 'o-queijo', 'o-talher']);
    expect(alterarEscolhas(trio, [], 'Coca-Cola Zero — +R$ 1,00', '').complementos).toEqual(['o-coca-zero']);
  });
});

describe('F5: o que perguntar no item (escolhas, adicionais e observação)', () => {
  it('as etapas obrigatórias que faltam, com TODAS as opções e o preço no detalhe', () => {
    expect(escolhasQueFaltam(trio, { variacaoId: null, complementos: [] })).toEqual([
      { grupo: 'Escolha o refri', versao: false, nomes: ['Coca-Cola', 'Guaraná', 'Coca-Cola Zero'], opcoes: ['Coca-Cola', 'Guaraná', 'Coca-Cola Zero — +R$ 1,00'] },
    ]);
    expect(escolhasQueFaltam(suco, { variacaoId: null, complementos: [] })[0]).toMatchObject({ grupo: 'a versão', versao: true, opcoes: ['300 ml — R$ 9,00', '500 ml — R$ 12,00'] });
    expect(escolhasQueFaltam(trio, { variacaoId: null, complementos: ['o-guarana'] })).toEqual([]);
  });
  it('os adicionais do item (só os opcionais de acrescentar, com o preço; o que já tem sai — o que repete fica com a quantidade)', () => {
    expect(adicionaisDoItem(xbacon)).toEqual(['Bacon extra — +R$ 4,00', 'Queijo cheddar — +R$ 3,00', 'Sim — sem custo']);
    // Caminho A (31/10): o bacon repete — fica na lista com quantos já tem, para tocar de novo.
    expect(adicionaisDoItem(xbacon, ['o-bacon'])).toEqual(['Bacon extra (1) — +R$ 4,00', 'Queijo cheddar — +R$ 3,00', 'Sim — sem custo']);
    // A etapa cheia (no máximo 3): os escolhidos saem; o que não repete ("Sim") sai assim que escolhido.
    expect(adicionaisDoItem(xbacon, ['o-bacon', 'o-bacon', 'o-queijo', 'o-talher'])).toEqual([]);
    expect(adicionaisDoItem(trio)).toEqual([]); // a escolha do refri é obrigatória: não é adicional
  });
  it('lanche pelo nome ou pela categoria pede os extras (mesmo sem adicional); bebida, não', () => {
    expect(ehLanche({ nome: 'X bacon' })).toBe(true);
    expect(ehLanche({ nome: 'TRIO 07' })).toBe(true);
    expect(ehLanche({ nome: 'Número 08' }, 'Hambúrgueres')).toBe(true);
    expect(ehLanche({ nome: 'Coca lata' }, 'Bebidas')).toBe(false);
    expect(pedeExtras(trio)).toBe(true); // trio: a observação
    expect(pedeExtras(suco)).toBe(false);
  });
  it('o cliente já pediu com adicional: os extras não se perguntam (a escolha obrigatória não conta)', () => {
    expect(temAdicionalOpcional(xbacon, 'bacon')).toBe(true);
    expect(temAdicionalOpcional(xbacon, '2 bacon')).toBe(true);
    expect(temAdicionalOpcional(trio, 'coca')).toBe(false);
  });
});

// Caminho A dos adicionais (aprovado pelo dono em 31/10/2026): os botões do WhatsApp são de escolha única — o que repete
// fica na lista com a quantidade, a quantidade dita abre em tantas vezes, e o que a loja não deixa repetir é avisado (antes
// era ignorado calado: o robô dizia "2 ovos" e o pedido ia com 1).
describe('caminho A: adicionais repetidos', () => {
  const molhos = {
    id: 'g-molho',
    nome: 'Molhos',
    min: 0,
    max: 3,
    obrigatorio: false,
    regra: 'varias',
    opcoes: [
      { id: 'o-maio', nome: 'Maionese verde', precoDelta: 1 },
      { id: 'o-ketchup', nome: 'Ketchup', precoDelta: 0 },
    ],
  };
  const fatias = { id: 'g-fatia', nome: 'Extras', min: 0, max: 2, regra: 'varias', opcoes: [{ id: 'o-2fatias', nome: '2 fatias de queijo', precoDelta: 5 }] };
  const burguer: any = { id: 'p-burguer', nome: 'Burguer da casa', precoVenda: 30, grupos: [adicionais, molhos, fatias], variacoes: [] };

  it('a quantidade no nome: "2 ovos", "2x ovo", "2xovo", "dois ovos", "ovo x2", "ovo 2x" (de 1 a 10)', () => {
    for (const t of ['2 ovos', '2x ovos', '2xovos', 'dois ovos', 'duas ovos', 'ovos x2', 'ovos 2x'])
      expect(quantidadeNoNome(t)).toEqual({ quantidade: 2, nome: 'ovos' });
    expect(quantidadeNoNome('ovo')).toBeNull();
    expect(quantidadeNoNome('20 ovos')).toBeNull();
  });

  it('a quantidade dita abre em tantas vezes onde a etapa repete; o nome da opção com número fica inteiro', () => {
    for (const t of ['2 bacon', 'dois bacon', 'bacon x2', '2x bacon extra'])
      expect(montarEscolhas(xbacon, [t]).complementos).toEqual(['o-bacon', 'o-bacon', 'o-talher']);
    expect(montarEscolhas(xbacon, ['4 bacon']).passouDoLimite).toEqual([{ grupo: 'Adicionais', maximo: 3 }]);
    expect(montarEscolhas(burguer, ['2 fatias de queijo']).complementos).toEqual(['o-2fatias']);
    expect(temOpcao(xbacon, '2 bacon')).toBe(true);
  });

  it('o que a etapa NÃO deixa repetir entra uma vez e volta em naoRepete (o robô avisa)', () => {
    const r = montarEscolhas(burguer, ['2 maionese verde', 'ketchup']);
    expect(r.complementos).toEqual(['o-maio', 'o-ketchup']);
    expect(r.naoRepete).toEqual(['Maionese verde']);
    expect(montarEscolhas(burguer, ['maionese verde']).naoRepete).toEqual([]);
    expect(alterarEscolhas(burguer, ['o-maio'], ['maionese verde'], []).naoRepete).toEqual(['Maionese verde']);
    expect(alterarEscolhas(xbacon, ['o-bacon'], ['bacon'], []).naoRepete).toEqual([]);
  });

  it('tocar de novo o adicional da lista ("Bacon extra (1) — +R$ 4,00") põe mais um; "tirar 2" tira dois', () => {
    expect(alterarEscolhas(xbacon, ['o-bacon', 'o-talher'], ['Bacon extra (1) — +R$ 4,00'], []).complementos).toEqual(['o-bacon', 'o-bacon', 'o-talher']);
    expect(alterarEscolhas(xbacon, ['o-bacon', 'o-bacon', 'o-queijo'], [], ['2 bacon']).complementos).toEqual(['o-queijo']);
  });

  it('a pergunta dos extras explica a quantidade entre parênteses e o "2 ovos" no como responder', () => {
    const base: EstadoDaConducao = {
      linhas: [{ linha: 1, produto: 'X-Bacon', faltaEscolher: [], extrasPendentes: true, adicionais: adicionaisDoItem(xbacon, ['o-bacon']) }],
      itensFechados: false,
      sugestao: null,
      tipo: 'retirada',
      tiposAbertos: ['retirada'],
      entrega: null,
      enderecoForaDaArea: false,
      ultimoEndereco: null,
      enderecosSalvos: 0,
      subtotal: 29.9,
      pedidoMinimo: null,
      nome: 'Ana',
      pagamento: null,
      pagamentoServe: false,
      opcoesDePagamento: [],
      total: 29.9,
    };
    const [extras] = conducaoDoPedido(base);
    expect(extras.campo).toBe('extras 1');
    expect(extras.opcoes?.[0]).toBe('Bacon extra (1) — +R$ 4,00');
    expect(extras.pergunta).toContain('O número entre parênteses é quantos ele já pôs: tocar de novo põe mais um.');
    expect(extras.comoResponder).toContain('com a quantidade, ex.: "2 ovos"');
    const sem = conducaoDoPedido({ ...base, linhas: [{ ...base.linhas[0], adicionais: adicionaisDoItem(xbacon) }] })[0];
    expect(sem.pergunta).not.toContain('entre parênteses');
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
  it('"dinheiro" e "cartão" caem no pagar na entrega com o MEIO; o nome inteiro da forma não diz qual; "pix" vai pelo link', () => {
    expect(acharForma(MENU, 'entrega', 'dinheiro')).toEqual({ ok: true, forma: 'entrega', porCartao: false, meio: 'dinheiro' });
    expect(acharForma(MENU, 'entrega', 'cartão de crédito')).toEqual({ ok: true, forma: 'entrega', porCartao: true, meio: 'cartao' });
    expect(acharForma(MENU, 'entrega', 'maquininha')).toEqual({ ok: true, forma: 'entrega', porCartao: true, meio: 'cartao' });
    expect(acharForma(MENU, 'entrega', 'Pagar na entrega (dinheiro ou maquininha)')).toEqual({ ok: true, forma: 'entrega', porCartao: false, meio: null });
    expect(acharForma(MENU, 'entrega', 'pix')).toMatchObject({ ok: false, motivo: 'so_pelo_link' });
    expect(acharForma(MENU, 'entrega', 'cheque')).toMatchObject({ ok: false, motivo: 'nenhuma' });
  });
  it('F5: os botões tocados ("Dinheiro", "Cartão na entrega — débito…", "Vale-refeição") e os nomes curtos', () => {
    const m: any = { loja: { pagamentos: ['pix', 'cartao', 'entrega', 'vr'] } };
    expect(opcoesDePagamento(m, 'entrega').map((o) => o.titulo)).toEqual(['Dinheiro', 'Cartão na entrega', 'Vale-refeição']);
    expect(opcoesDePagamento(m, 'retirada').map((o) => o.titulo)).toEqual(['Dinheiro', 'Cartão na retirada', 'Vale-refeição']);
    expect(opcoesDePagamento(m, 'entrega').every((o) => o.titulo.length <= 20)).toBe(true); // cabe no botão da Meta
    expect(acharForma(m, 'entrega', 'Cartão na entrega — débito ou crédito na maquininha')).toEqual({ ok: true, forma: 'entrega', porCartao: true, meio: 'cartao' });
    expect(acharForma(m, 'entrega', 'Vale-refeição')).toEqual({ ok: true, forma: 'vr', porCartao: false, meio: 'cartao' });
    expect(acharForma(m, 'entrega', 'Dinheiro')).toMatchObject({ forma: 'entrega', meio: 'dinheiro' });
  });
  it('formas com nome da loja: pelo nome; "cartão" entre débito e crédito pergunta qual', () => {
    const m: any = { loja: { pagamentos: ['Dinheiro', 'Cartão de débito', 'Cartão de crédito', 'Pix'] } };
    expect(acharForma(m, 'entrega', 'pix')).toEqual({ ok: true, forma: 'Pix', porCartao: false, meio: null });
    expect(acharForma(m, 'entrega', 'débito')).toEqual({ ok: true, forma: 'Cartão de débito', porCartao: false, meio: null });
    expect(acharForma(m, 'entrega', 'cartão')).toMatchObject({ ok: false, motivo: 'nenhuma', opcoes: ['Dinheiro', 'Cartão de débito', 'Cartão de crédito', 'Pix'] });
    expect(acharForma(m, 'entrega', 'dinheiro')).toMatchObject({ forma: 'Dinheiro', meio: 'dinheiro' });
    expect(formasDoRobo(m, 'entrega').find((f) => f.forma === 'Dinheiro')?.pedeTroco).toBe(true);
    expect(formasDoRobo(m, 'entrega').find((f) => f.forma === 'Pix')?.pedeTroco).toBe(false);
  });
  it('F5: troco só no dinheiro; "não preciso" em texto; "pagar na entrega" sem meio pergunta dinheiro ou cartão', () => {
    expect(precisaDeTroco({ forma: 'entrega', meio: 'dinheiro', trocoPara: null, semTroco: false })).toBe(true);
    expect(precisaDeTroco({ forma: 'entrega', meio: 'cartao', trocoPara: null, semTroco: false })).toBe(false);
    expect(precisaDeTroco({ forma: 'entrega', meio: 'dinheiro', trocoPara: 100, semTroco: false })).toBe(false);
    expect(precisaDeTroco({ forma: 'Dinheiro', meio: null, trocoPara: null, semTroco: false })).toBe(true);
    expect(precisaDoMeio({ forma: 'entrega', meio: null, trocoPara: null, semTroco: false })).toBe(true);
    expect(precisaDoMeio({ forma: 'entrega', trocoPara: 50, semTroco: false })).toBe(false); // carrinho de antes do F5
    for (const t of ['não preciso', 'Não preciso de troco', 'sem troco', 'tenho trocado', 'nao']) expect(semTrocoNoTexto(t)).toBe(true);
    for (const t of ['100', 'R$ 50', '', 'troco pra 50']) expect(semTrocoNoTexto(t)).toBe(false);
    expect(sugestoesDeTroco(36)).toEqual(['R$ 50', 'R$ 100']);
    expect(sugestoesDeTroco(101)).toEqual(['R$ 150', 'R$ 200']);
    expect(sugestoesDeTroco(600)).toEqual([]);
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

describe('F5: a condução — o que falta, na ordem em que o robô pergunta', () => {
  const linha = (o: Partial<EstadoDaConducao['linhas'][number]> = {}) => ({
    linha: 1,
    produto: 'X-Bacon',
    faltaEscolher: [],
    extrasPendentes: false,
    adicionais: ['Bacon extra — +R$ 4,00'],
    ...o,
  });
  const base: EstadoDaConducao = {
    linhas: [linha()],
    itensFechados: true,
    sugestao: null,
    tipo: 'entrega',
    tiposAbertos: ['entrega', 'retirada'],
    entrega: { tipo: 'entrega', rua: 'Rua A', numero: '10', bairro: 'Centro', bairroId: 'b', referencia: 'portão', lat: null, lng: null, enderecoId: null },
    enderecoForaDaArea: false,
    ultimoEndereco: null,
    enderecosSalvos: 0,
    subtotal: 40,
    pedidoMinimo: 20,
    nome: 'Ana',
    pagamento: { forma: 'entrega', meio: 'dinheiro', trocoPara: 100, semTroco: false },
    pagamentoServe: true,
    opcoesDePagamento: ['Dinheiro — pago na entrega', 'Cartão na entrega — débito ou crédito na maquininha'],
    total: 45,
  };
  const campos = (e: Partial<EstadoDaConducao>) => conducaoDoPedido({ ...base, ...e }).map((f) => f.campo);

  it('completo: nada falta', () => {
    expect(conducaoDoPedido(base)).toEqual([]);
  });
  it('a ordem do dono: escolha obrigatória → extras do item → mais alguma coisa → entrega → referência → mínimo → nome → pagamento → troco', () => {
    const tudo = campos({
      linhas: [linha({ faltaEscolher: [{ grupo: 'Escolha o refri', opcoes: ['Coca-Cola', 'Guaraná'] }], extrasPendentes: true }), linha({ linha: 2, extrasPendentes: true })],
      itensFechados: false,
      entrega: { ...(base.entrega as any), referencia: null },
      subtotal: 15,
      nome: null,
      pagamento: { forma: 'entrega', meio: 'dinheiro', trocoPara: null, semTroco: false },
    });
    // Linha 1: a escolha primeiro (os extras dela só depois); linha 2: os extras. "Mais alguma coisa" só com os itens prontos.
    expect(tudo).toEqual(['linha 1', 'extras 2', 'referencia', 'minimo', 'nome', 'troco']);
    expect(campos({ linhas: [] })[0]).toBe('itens');
    expect(campos({ itensFechados: false })).toEqual(['mais_algo']);
    expect(campos({ itensFechados: false, entrega: null, tipo: null })).toEqual(['mais_algo', 'tipo']);
    expect(campos({ pagamento: null })).toEqual(['pagamento']);
    expect(campos({ pagamento: { forma: 'entrega', meio: null, trocoPara: null, semTroco: false } })).toEqual(['meio']);
    expect(campos({ pagamento: { forma: 'entrega', meio: 'dinheiro', trocoPara: null, semTroco: true } })).toEqual([]);
    expect(campos({ pagamento: { forma: 'entrega', meio: 'cartao', trocoPara: null, semTroco: false } })).toEqual([]);
  });
  it('a escolha leva TODAS as opções e diz como responder; os extras oferecem adicionais, observação e "não"', () => {
    const [esc] = conducaoDoPedido({ ...base, linhas: [linha({ faltaEscolher: [{ grupo: 'Escolha a Bebida', opcoes: ['Coca', 'Fanta', 'Guaraná', 'Sprite', 'Coca Zero', 'Fanta Uva', 'Guaraviton'] }] })] });
    expect(esc.opcoes).toHaveLength(7);
    expect(esc.comoResponder).toContain('acao = escolher, linha = 1');
    const [ext] = conducaoDoPedido({ ...base, linhas: [linha({ extrasPendentes: true })] });
    expect(ext.opcoes).toEqual(['Bacon extra — +R$ 4,00', 'Pôr observação', 'Não, obrigado']);
    expect(ext.comoResponder).toContain('acao = concluir, linha = 1');
  });
  it('"mais alguma coisa?" com a sugestão (uma vez) e o "Não, só isso"', () => {
    const [m] = conducaoDoPedido({ ...base, itensFechados: false, sugestao: { papel: 'bebida', opcoes: ['Coca lata — R$ 6,00'] } });
    expect(m).toMatchObject({ campo: 'mais_algo', opcoes: ['Coca lata — R$ 6,00', 'Não, só isso'] });
    expect(m.pergunta).toContain('uma bebida');
    expect(m.comoResponder).toContain('acao = fechar');
  });
  it('a entrega numa pergunta: o ÚLTIMO endereço, outro ou retirada (decisão do dono); sem endereço salvo, entrega ou retirada', () => {
    const sem = { tipo: null, entrega: null } as const;
    const [e] = conducaoDoPedido({ ...base, ...sem, ultimoEndereco: { n: 2, texto: 'Av. N. Sra. da Penha, 400 · Penha' }, enderecosSalvos: 3 });
    expect(e).toMatchObject({ campo: 'endereco', opcoes: ['Sim, nesse', 'Outro endereço', 'Retirar na loja'] });
    expect(e.pergunta).toContain('Av. N. Sra. da Penha, 400');
    expect(e.comoResponder).toContain('endereco = 2');
    expect(e.comoResponder).toContain('Cadastrar novo endereço');
    // Com um endereço só, "Outro endereço" já pede o novo.
    expect(conducaoDoPedido({ ...base, ...sem, ultimoEndereco: { n: 1, texto: 'Rua B, 20' }, enderecosSalvos: 1 })[0].comoResponder).toContain('peça o endereço novo');
    // A loja que só entrega não oferece a retirada; o cliente que já disse "entrega" também não.
    expect(conducaoDoPedido({ ...base, ...sem, tiposAbertos: ['entrega'], ultimoEndereco: { n: 1, texto: 'Rua B' }, enderecosSalvos: 1 })[0].opcoes).toEqual(['Sim, nesse', 'Outro endereço']);
    expect(conducaoDoPedido({ ...base, entrega: null, ultimoEndereco: { n: 1, texto: 'Rua B' }, enderecosSalvos: 1 })[0].opcoes).toEqual(['Sim, nesse', 'Outro endereço']);
    expect(conducaoDoPedido({ ...base, ...sem })[0]).toMatchObject({ campo: 'tipo', opcoes: ['Entrega', 'Retirar na loja'] });
    expect(conducaoDoPedido({ ...base, ...sem, tiposAbertos: ['retirada'] })[0]).toMatchObject({ campo: 'tipo', opcoes: ['Retirar na loja'] });
    expect(conducaoDoPedido({ ...base, ...sem, tiposAbertos: [] })[0].pergunta).toBe('A loja não está recebendo pedidos agora.');
  });
  it('fora da área; o complemento é pedido com a referência; a retirada não pede endereço nem mínimo; o mínimo diz quanto falta', () => {
    expect(campos({ enderecoForaDaArea: true })[0]).toBe('endereco');
    expect(conducaoDoPedido({ ...base, entrega: { ...(base.entrega as any), referencia: null } })[0].pergunta).toMatch(/complemento \(apto, bloco, casa, fundos\)/);
    expect(campos({ tipo: 'retirada', entrega: { tipo: 'retirada' }, subtotal: 5 })).toEqual([]);
    expect(conducaoDoPedido({ ...base, subtotal: 15 })[0].pergunta).toBe('O pedido mínimo para entrega é R$ 20,00 em itens (faltam R$ 5,00).');
  });
  it('dinheiro ou cartão; o troco com as notas que cobrem o total e o "não preciso"', () => {
    const [meio] = conducaoDoPedido({ ...base, pagamento: { forma: 'entrega', meio: null, trocoPara: null, semTroco: false } });
    expect(meio.opcoes).toEqual(['Dinheiro', 'Cartão na entrega']);
    const [troco] = conducaoDoPedido({ ...base, total: 36, pagamento: { forma: 'entrega', meio: 'dinheiro', trocoPara: null, semTroco: false } });
    expect(troco).toMatchObject({ campo: 'troco', opcoes: ['R$ 50', 'R$ 100', 'Não preciso de troco'] });
    expect(troco.pergunta).toContain('R$ 36,00');
  });
});

describe('F5: a resposta negativa à pergunta dos extras ("Não, obrigado") — não vira observação nem adicional', () => {
  it('negativas reconhecidas; observação de verdade não', () => {
    for (const t of ['Não, obrigado', 'nao obrigada', 'nada', 'Nenhum', 'sem adicional', 'só isso', 'Tá ótimo!', 'não precisa'])
      expect(respostaNegativa(t)).toBe(true);
    for (const t of ['sem cebola', 'não colocar picles', 'bem passado', 'Bacon', '']) expect(respostaNegativa(t)).toBe(false);
  });
});

describe('F5: mudança que não muda nada não sobe a versão (o jsonb devolve as chaves em outra ordem)', () => {
  it('JSON estável: mesma coisa, mesma escrita; diferente, diferente', () => {
    expect(estavel({ b: 1, a: [{ y: 2, x: 1 }] })).toBe(estavel({ a: [{ x: 1, y: 2 }], b: 1 }));
    expect(estavel({ a: 1, b: undefined })).toBe(estavel({ a: 1 }));
    expect(estavel({ a: null })).not.toBe(estavel({ a: 1 }));
    expect(estavel([1, 2])).not.toBe(estavel([2, 1]));
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
