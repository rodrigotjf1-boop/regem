import {
  aplicarEscolha,
  brl,
  ehRespostaDeDecisao,
  escolhaPeloTitulo,
  idDoBotao,
  lerIdDoBotao,
  lerLimite,
  lerRascunho,
  lerVotoDaEnquete,
  motivosDe,
  nomeNaEnquete,
  passoAtual,
  podeAceitar,
  textoDoFeito,
  valorDoAceite,
} from './gestor-whatsapp-decisao';

/* eslint-disable @typescript-eslint/no-explicit-any */

// GERENTE NO WHATSAPP, parte 5b — as regras puras da decisão: o valor do aceite (o que devolve dinheiro), o limite, os
// motivos que cada plataforma exige, os passos, a escolha velha que não vale, o id do botão e o voto da enquete.
const AVISO = '0f8fad5b-d9cb-469f-a165-70867728950e';
const caso = (o: Record<string, unknown> = {}): any => ({
  id: 'c-1',
  tipo: 'disputa',
  canal: 'ifood',
  cliente: 'Ana P.',
  pedidoNumero: '4521',
  mensagem: 'Faltou a batata.',
  prazoEm: null,
  criadoEm: new Date(),
  detalhe: { disputa: { acao: 'CANCELLATION', tipo: 'PREPARATION_TIME', motivosParaAceitar: ['CUSTOMER_REQUEST'], itens: [] } },
  totalCentavos: 3990,
  ...o,
});

describe('gerente no WhatsApp — a decisão (regras)', () => {
  it('o valor do aceite: o pedido inteiro no cancelamento; a soma dos itens na parcial; mais tempo = 0; sem dado = null', () => {
    expect(valorDoAceite(caso())).toBe(3990);
    expect(valorDoAceite(caso({ detalhe: { disputa: { acao: 'PARTIAL_CANCELLATION', itens: [{ centavos: 1290 }, { centavos: 500 }] } } }))).toBe(1790);
    expect(valorDoAceite(caso({ detalhe: { disputa: { acao: 'PARTIAL_CANCELLATION', itens: [{ centavos: 1290 }, { centavos: null }] } } }))).toBeNull();
    expect(valorDoAceite(caso({ detalhe: { disputa: { acao: 'PROPOSED_ADDITIONAL_TIME' } } }))).toBe(0);
    expect(valorDoAceite(caso({ detalhe: { disputa: { acao: 'CANCELLATION', tipo: 'AFTER_DELIVERY_PARTIALLY', itens: [] } } }))).toBeNull();
    expect(valorDoAceite(caso({ tipo: 'cancelamento', totalCentavos: 18640 }))).toBe(18640);
    expect(valorDoAceite(caso({ tipo: 'reembolso_99', detalhe: { pedido99: { valorCentavos: 900 } } }))).toBe(900);
    expect(valorDoAceite(caso({ tipo: 'reembolso_99', detalhe: { pedido99: {} } }))).toBe(3990); // sem o pedido: o inteiro
  });

  it('o limite: só para aceitar; sem limite = tudo; 0 = nada; sem valor conhecido = acima', () => {
    expect(podeAceitar(10000, 10000)).toBe(true);
    expect(podeAceitar(10001, 10000)).toBe(false);
    expect(podeAceitar(null, 10000)).toBe(false);
    expect(podeAceitar(null, null)).toBe(true);
    expect(podeAceitar(1, 0)).toBe(false);
    expect(lerLimite(null, true)).toBeNull();
    expect(lerLimite(undefined, false)).toBe(10000);
    expect(lerLimite(3000, true)).toBe(3000);
  });

  it('os motivos: o iFood manda os de aceite e tem a lista fixa de recusa; a 99 sem lista não recusa por aqui', () => {
    expect(motivosDe(caso(), 'aceitar')).toEqual([{ valor: 'CUSTOMER_REQUEST', titulo: 'Solicitação do cliente' }]);
    expect(motivosDe(caso(), 'recusar')).toHaveLength(9);
    expect(motivosDe(caso({ tipo: 'cancelamento_99', detalhe: { pedido99: { motivosDeRecusa: ['preparing'] } } }), 'recusar')).toEqual([
      { valor: 'preparing', titulo: 'O pedido já está em preparo' },
    ]);
    expect(motivosDe(caso({ tipo: 'cancelamento_99', detalhe: { pedido99: { motivosDeRecusa: [] } } }), 'recusar')).toBeNull();
    expect(motivosDe(caso({ tipo: 'reembolso_99', detalhe: { pedido99: { motivosDoReembolso: [{ id: 'b1', motivo: 'User misunderstands' }] } } }), 'recusar')).toEqual([
      { valor: 'b1', titulo: 'O cliente se enganou' },
    ]);
    expect(motivosDe(caso({ tipo: 'reembolso_99', detalhe: { pedido99: {} } }), 'aceitar')).toEqual([]);
    expect(motivosDe(caso({ tipo: 'cancelamento' }), 'recusar')).toEqual([]);
  });

  it('os passos da disputa: ação → motivo → confirmar; acima do limite, só Recusar com o porquê', () => {
    const p1 = passoAtual(caso(), {}, 10000)!;
    expect(p1).toMatchObject({ passo: 'acao', aviso: null, opcoes: [{ valor: 'aceitar', titulo: 'Aceitar · R$ 39,90' }, { valor: 'recusar', titulo: 'Recusar' }] });
    expect(passoAtual(caso(), { acao: 'aceitar' }, 10000)).toMatchObject({ passo: 'motivo', pergunta: 'Qual o motivo? A lista é do iFood.' });
    expect(passoAtual(caso(), { acao: 'aceitar', motivo: 'CUSTOMER_REQUEST' }, 10000)).toMatchObject({
      passo: 'confirmar',
      pergunta: 'Confirma? Aceitar a disputa do pedido 4521, devolvendo R$ 39,90 (motivo: Solicitação do cliente). A resposta vai ao iFood, que aceita uma só.',
    });
    const caro = passoAtual(caso({ totalCentavos: 18640 }), {}, 10000)!;
    expect(caro.opcoes).toEqual([{ valor: 'recusar', titulo: 'Recusar' }]);
    expect(caro.aviso).toBe('Acima do seu limite pelo WhatsApp (R$ 100,00): para aceitar, abra no Regem e confirme com a sua senha. Recusar dá por aqui.');
    expect(passoAtual(caso(), {}, 0)!.aviso).toBe('Aceitar só pelo Regem, com a sua senha. Recusar dá por aqui.');
    expect(passoAtual(caso({ totalCentavos: null }), {}, 10000)!.aviso).toContain('Sem o valor do que volta ao cliente');
  });

  it('o cancelamento do cardápio pergunta os insumos; a 99 sem motivos nem aceitar acima do limite: nada por aqui', () => {
    const c = caso({ tipo: 'cancelamento', canal: 'cardapio', totalCentavos: 4200 });
    expect(passoAtual(c, { acao: 'aceitar' }, 10000)).toMatchObject({ passo: 'insumos', opcoes: [{ valor: 'reutilizados' }, { valor: 'perda' }] });
    expect(passoAtual(c, { acao: 'aceitar', reaproveitado: false }, 10000)!.pergunta).toBe(
      'Confirma? Aceitar o cancelamento do pedido 4521; insumos como perda. O pedido é cancelado aqui, como no painel; pago no Pix pelo cardápio, o valor volta ao cliente sozinho.',
    );
    expect(passoAtual(c, { acao: 'recusar' }, 10000)!.pergunta).toBe('Confirma? Recusar o cancelamento do pedido 4521. O pedido segue normalmente.');
    const semNada = caso({ tipo: 'cancelamento_99', totalCentavos: 50000, detalhe: { pedido99: { motivosDeRecusa: [] } } });
    expect(passoAtual(semNada, {}, 10000)).toBeNull();
  });

  it('a escolha: a opção tem de ser do passo de agora (botão velho ou limite que mudou não vale); Voltar e Confirmar', () => {
    expect(aplicarEscolha(caso(), {}, 10000, 'acao', 'aceitar')).toEqual({ tipo: 'rascunho', rascunho: { acao: 'aceitar' } });
    expect(aplicarEscolha(caso(), {}, 3000, 'acao', 'aceitar')).toBeNull(); // o limite caiu: o Aceitar velho não vale
    expect(aplicarEscolha(caso(), { acao: 'aceitar' }, 10000, 'acao', 'recusar')).toBeNull(); // passo velho
    expect(aplicarEscolha(caso(), { acao: 'aceitar' }, 10000, 'motivo', 'WRONG_ORDER')).toBeNull(); // fora da lista do iFood
    expect(aplicarEscolha(caso(), { acao: 'aceitar' }, 10000, 'motivo', 'CUSTOMER_REQUEST')).toEqual({
      tipo: 'rascunho',
      rascunho: { acao: 'aceitar', motivo: 'CUSTOMER_REQUEST' },
    });
    const pronto = { acao: 'aceitar' as const, motivo: 'CUSTOMER_REQUEST' };
    expect(aplicarEscolha(caso(), pronto, 10000, 'confirmar', 'confirmar')).toEqual({ tipo: 'confirmar' });
    expect(aplicarEscolha(caso(), pronto, 10000, 'confirmar', 'voltar')).toEqual({ tipo: 'voltar' });
    expect(escolhaPeloTitulo(caso(), {}, 10000, 'Aceitar · R$ 39,90')).toEqual({ passo: 'acao', valor: 'aceitar' });
    expect(escolhaPeloTitulo(caso(), {}, 10000, 'Confirmar')).toBeNull();
  });

  it('o id do botão leva o aviso, o passo e o VALOR; o voto da enquete leva o número do caso', () => {
    const id = idDoBotao(AVISO, 'motivo', 'courier arrived');
    expect(id).toBe(`gw:${AVISO}:motivo:courier%20arrived`);
    expect(lerIdDoBotao(id)).toEqual({ avisoId: AVISO, passo: 'motivo', valor: 'courier arrived' });
    expect(lerIdDoBotao('gw:x:acao:aceitar')).toBeNull();
    expect(lerIdDoBotao('1')).toBeNull();
    expect(nomeNaEnquete('Aceitar · R$ 39,90', '4821')).toBe('Aceitar · R$ 39,90 · caso 4821');
    expect(lerVotoDaEnquete('Aceitar · R$ 39,90 · caso 4821')).toEqual({ titulo: 'Aceitar · R$ 39,90', codigo: '4821' });
    expect(lerVotoDaEnquete('Aceitar')).toBeNull();
    expect(ehRespostaDeDecisao('Recusar · caso 1234', null)).toBe(true);
    expect(ehRespostaDeDecisao('Recusar', id)).toBe(true);
    expect(ehRespostaDeDecisao('Quero um x-burger', null)).toBe(false);
  });

  it('o rascunho gravado: só o que é reconhecido; o "Feito" no passado; o valor com espaço comum', () => {
    expect(lerRascunho('{"acao":"aceitar","motivo":"X","reaproveitado":false,"outra":1}')).toEqual({ acao: 'aceitar', motivo: 'X', reaproveitado: false });
    expect(lerRascunho('{"acao":"apagar"}')).toEqual({});
    expect(lerRascunho('não é json')).toEqual({});
    expect(lerRascunho(null)).toEqual({});
    expect(textoDoFeito(caso(), { acao: 'aceitar' }, 3990)).toBe('disputa do pedido 4521 aceita (R$ 39,90 de volta ao cliente)');
    expect(textoDoFeito(caso({ tipo: 'cancelamento' }), { acao: 'aceitar', reaproveitado: true }, 4200)).toBe('cancelamento do pedido 4521 aceito, insumos reutilizados');
    expect(textoDoFeito(caso({ tipo: 'cancelamento_99' }), { acao: 'recusar' }, 4200)).toBe('cancelamento do pedido 4521 recusado');
    expect(brl(123456)).toBe('R$ 1.234,56');
  });
});
