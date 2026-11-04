import {
  ajusteRepetidoDaLinha,
  assinaturaDosItens,
  AJUSTE_REPETIDO_PADRAO,
  idDaConfirmacao,
  lerAjusteRepetido,
  linhasDaViaDoRepetido,
  situacaoParaOCliente,
  textoDoKds,
  textoDoOutro,
} from './pedido-repetido';
import { OPCOES_DO_REPETIDO, textoParaConferirRepetido } from '../cardapio/robo-resumo';

// PEDIDO IGUAL EM ATÉ 30 MIN (mig 360; pedido do dono, 03/11/2026 — decisão 1): o que é "igual", o ajuste, os textos.
describe('pedido igual — o que é "igual" (decisão 1)', () => {
  const xb = { produtoId: 'p-xbacon', descricao: 'X-Bacon', quantidade: 1, precoUnitario: 32, opcaoIds: ['o-bacon', 'o-cheddar'] };
  const coca = { produtoId: 'p-coca', descricao: 'Coca-Cola lata', quantidade: 1, precoUnitario: 7 };

  it('a mesma lista em outra ordem, as opções em outra ordem e a observação diferente: igual', () => {
    const a = assinaturaDosItens([xb, coca]);
    expect(a).not.toBe('');
    expect(assinaturaDosItens([coca, { ...xb, opcaoIds: ['o-cheddar', 'o-bacon'] }])).toBe(a);
    expect(assinaturaDosItens([{ ...xb, observacao: 'sem cebola' }, { ...coca, observacao: 'bem gelada' }])).toBe(a);
    // o preço mudou (promoção começou no meio): continua igual — o pedido é o mesmo
    expect(assinaturaDosItens([{ ...xb, precoUnitario: 29.9 }, coca])).toBe(a);
  });

  it('duas linhas de 1 = uma linha de 2; quantidade diferente, outra escolha ou outro produto: NÃO é igual', () => {
    expect(assinaturaDosItens([coca, coca])).toBe(assinaturaDosItens([{ ...coca, quantidade: 2 }]));
    const a = assinaturaDosItens([xb, coca]);
    expect(assinaturaDosItens([xb, { ...coca, quantidade: 2 }])).not.toBe(a);
    expect(assinaturaDosItens([{ ...xb, opcaoIds: ['o-bacon'] }, coca])).not.toBe(a);
    expect(assinaturaDosItens([xb])).not.toBe(a);
    expect(assinaturaDosItens([xb, coca, { produtoId: 'p-batata', descricao: 'Batata', quantidade: 1 }])).not.toBe(a);
  });

  it('canal de fora (código e complementos do canal): ordem dos complementos não importa; maiúscula e acento também não', () => {
    const it1 = {
      codigo: '101',
      descricao: 'Pão de Queijo',
      quantidade: 2,
      complementos: 'Catupiry, Bacon',
      complementosItens: [
        { codigo: 'C1', nome: 'Catupiry', quantidade: 1 },
        { codigo: 'C2', nome: 'Bacon', quantidade: 1 },
      ],
    };
    const igual = {
      ...it1,
      descricao: 'pão  de queijo',
      complementosItens: [
        { codigo: 'C2', nome: 'Bacon', quantidade: 1 },
        { codigo: 'C1', nome: 'Catupiry', quantidade: 1 },
      ],
    };
    expect(assinaturaDosItens([igual])).toBe(assinaturaDosItens([it1]));
    expect(assinaturaDosItens([{ ...it1, complementosItens: [{ codigo: 'C1', nome: 'Catupiry', quantidade: 2 }] }])).not.toBe(
      assinaturaDosItens([it1]),
    );
    // sem a lista dos complementos, vale o texto deles
    expect(assinaturaDosItens([{ codigo: '9', descricao: 'Açaí', complementos: 'Granola' }])).not.toBe(
      assinaturaDosItens([{ codigo: '9', descricao: 'Açaí', complementos: 'Leite em pó' }]),
    );
  });

  it('sem itens (ou lixo): vazio — nunca é "igual" a nada', () => {
    expect(assinaturaDosItens([])).toBe('');
    expect(assinaturaDosItens(null)).toBe('');
    expect(assinaturaDosItens('x' as any)).toBe('');
    expect(assinaturaDosItens([null, 3, 'a'] as any)).toBe('');
  });
});

describe('pedido igual — o ajuste da loja', () => {
  it('sem linha (ou sem as colunas): ligado, 30 minutos; valor torto no banco: o padrão daquele campo', () => {
    expect(ajusteRepetidoDaLinha(null)).toEqual(AJUSTE_REPETIDO_PADRAO);
    expect(AJUSTE_REPETIDO_PADRAO).toEqual({ ativo: true, minutos: 30 });
    expect(ajusteRepetidoDaLinha({ id: 'x' })).toEqual({ ativo: true, minutos: 30 });
    expect(ajusteRepetidoDaLinha({ pedido_repetido_ativo: false, pedido_repetido_min: 45 })).toEqual({ ativo: false, minutos: 45 });
    expect(ajusteRepetidoDaLinha({ pedidoRepetidoAtivo: true, pedidoRepetidoMin: 0 })).toEqual({ ativo: true, minutos: 30 });
    expect(ajusteRepetidoDaLinha({ pedido_repetido_ativo: 'sim', pedido_repetido_min: 'x' })).toEqual({ ativo: false, minutos: 30 });
  });

  it('o que a tela manda: só as janelas oferecidas; liga/desliga só como booleano (V15); ausente mantém (V16)', () => {
    expect(lerAjusteRepetido({ ativo: false, minutos: 45 })).toEqual({ ativo: false, minutos: 45 });
    expect(lerAjusteRepetido({})).toEqual({});
    expect(lerAjusteRepetido({ minutos: 10 })).toEqual({ minutos: 10 });
    expect(() => lerAjusteRepetido({ minutos: 25 })).toThrow('Pedido igual: escolha 10, 15, 20, 30, 45 ou 60 minutos.');
    expect(() => lerAjusteRepetido({ minutos: '30' })).toThrow('Pedido igual');
    // a regra do projeto (`exigirBooleano`): true/false, ou o texto "true"/"false" de um formulário; o resto é recusado
    expect(lerAjusteRepetido({ ativo: 'false' })).toEqual({ ativo: false });
    expect(() => lerAjusteRepetido({ ativo: 'não' })).toThrow('Informe "ativo" (true ou false).');
  });
});

describe('pedido igual — os textos', () => {
  const m = { deNumero: 127, deEm: '2026-11-03T22:46:00.000Z' }; // 19:46 em São Paulo

  it('a via (cozinha, caixa e entregador): o aviso no alto, em destaque, sem nada do cliente', () => {
    const v = linhasDaViaDoRepetido(m);
    expect(v.split('\n')[0]).toBe('@CBD !! POSSÍVEL REPETIDO !!');
    expect(v).toContain('@CB Igual ao pedido #127 de 19:46');
    expect(v).toContain('@CB Confirme com o cliente antes de produzir.');
    expect(v.endsWith('\n')).toBe(true);
    // sem o outro pedido no banco desta máquina (fora do espelho): o que se sabe
    expect(textoDoOutro({ deNumero: null, deEm: null })).toBe('outro pedido do mesmo cliente');
  });

  it('o KDS e a situação do outro pedido como o cliente entende', () => {
    expect(textoDoKds(m)).toBe('Igual ao pedido #127 de 19:46 — confirme com o atendimento antes de fazer.');
    expect(situacaoParaOCliente('confirmado')).toBe('em produção');
    expect(situacaoParaOCliente('novo')).toBe('recebido');
    expect(situacaoParaOCliente('despachado')).toBe('a caminho');
    expect(situacaoParaOCliente('qualquer')).toBe('em andamento');
  });

  it('a confirmação "São dois pedidos": o id nasce do pedido (o mesmo na loja e na nuvem — V42)', () => {
    const p = '11111111-2222-3333-4444-555555555555';
    expect(idDaConfirmacao(p)).toBe(idDaConfirmacao(p));
    expect(idDaConfirmacao(p)).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(idDaConfirmacao(p)).not.toBe(idDaConfirmacao('11111111-2222-3333-4444-555555555556'));
  });

  it('o robô: o aviso no alto do resumo, a pergunta no lugar do "Está tudo certo?" e os botões do pedido igual', () => {
    const resumo = '🧾 *Confere o seu pedido:*\n\n*4x Coca lata* — R$ 24,00\n\n💰 *Total: R$ 24,00*\n\nEstá tudo certo? 👇';
    const t = textoParaConferirRepetido(resumo, { numero: '57', hora: '19:42', situacao: 'em produção' });
    expect(t.split('\n')[0]).toBe('⚠️ *Você já fez um pedido igual hoje às 19:42* (nº 57), e ele está *em produção*.');
    expect(t).toContain('*4x Coca lata* — R$ 24,00');
    expect(t).not.toContain('Está tudo certo?');
    // a pergunta é a ÚLTIMA linha: é ela que vira o texto dos botões quando o resumo passa do limite
    expect(t.split('\n').pop()).toBe('Quer que a gente produza e envie *os dois* pedidos? 👇');
    expect(OPCOES_DO_REPETIDO).toEqual(['Sim, quero os dois', 'Não, foi repetido', 'Quero mudar algo']);
    // sem hora nem número (não deveria acontecer): a frase continua inteira
    expect(textoParaConferirRepetido(resumo, { numero: null, hora: null, situacao: 'recebido' }).split('\n')[0]).toBe(
      '⚠️ *Você já fez um pedido igual hoje*, e ele está *recebido*.',
    );
  });
});
