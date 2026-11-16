import {
  CANAIS_DE_FORA,
  PIN_TENTATIVAS,
  PROCEDIMENTOS,
  TEXTOS_DO_CANCELAMENTO,
  TEXTOS_DO_LINK,
  apresentacaoDaProposta,
  apresentacaoDoCancelamento,
  nomeCurtoDoCliente,
  botoesDaProposta,
  caminhoDoLink,
  ehCodigoDoLink,
  ehPinValido,
  estadoDoLink,
  idDoBotao,
  lerBotao,
  perguntaDaProposta,
  propostaDoAviso,
  resultadoDaConsulta,
  tentativasQueRestam,
  textoDoDesfecho,
} from './mister-procedimentos';

// O catálogo das propostas do Mister (F4.1): puro. O banco, o toque e a execução pelos serviços das telas estão em
// `mister-pg.teste-spec.ts` (rodado pela `ia/ia-empresa-pg.spec.ts`).

const NOTA = '0e1b9a54-7f3a-4c2d-9b8e-1a2b3c4d5e6f';

describe('o catálogo das propostas do Mister', () => {
  it('os de botão valem 10 minutos e nascem de um aviso; o cancelamento é de PIN, vale 15 minutos e nasce da pergunta', () => {
    for (const p of Object.values(PROCEDIMENTOS)) {
      if (p.id === 'cancelar_pedido') expect(p).toMatchObject({ nivel: 'pin', prazoMin: 15, tipoDoAviso: null });
      else expect(p).toMatchObject({ nivel: 'botao', prazoMin: 10 });
      if (p.nivel === 'botao') expect(p.tipoDoAviso).not.toBeNull();
      expect(p.conferirMin).toBeGreaterThan(0);
    }
  });

  it('o aviso da nota sem resposta pede a consulta da nota da chave; outra chave ou outro tipo, nada', () => {
    expect(propostaDoAviso({ tipo: 'nota_sem_resposta', chave: `nota:${NOTA}` })).toEqual({ procedimento: 'consultar_nota', parametros: { notaId: NOTA } });
    expect(propostaDoAviso({ tipo: 'nota_sem_resposta', chave: 'nota:nao-e-uuid' })).toBeNull();
    expect(propostaDoAviso({ tipo: 'caixa_24h', chave: `caixa:${NOTA}` })).toBeNull();
    expect(propostaDoAviso({ tipo: 'certificado', chave: 'qualquer' })).toBeNull();
  });

  it('o aviso da impressora parada pede a via de teste da impressora e do servidor da chave do vigia', () => {
    expect(propostaDoAviso({ tipo: 'impressora', chave: 'vigia:impressora_parada:srv:abc:impressora:9' })).toEqual({
      procedimento: 'imprimir_teste',
      parametros: { servidorId: 'abc', impressoraId: '9' },
    });
    expect(propostaDoAviso({ tipo: 'impressora', chave: 'vigia:servico_parado:srv:abc' })).toBeNull();
  });

  it('o botão leva a proposta e a escolha; o que não é botão de proposta não é lido', () => {
    expect(idDoBotao(NOTA, true)).toBe(`prop:${NOTA}:sim`);
    expect(lerBotao(`prop:${NOTA}:sim`)).toEqual({ propostaId: NOTA, autorizar: true });
    expect(lerBotao(`prop:${NOTA}:nao`)).toEqual({ propostaId: NOTA, autorizar: false });
    expect(lerBotao(`prop:${NOTA}:talvez`)).toBeNull();
    expect(lerBotao('emp:1')).toBeNull();
    expect(lerBotao(null)).toBeNull();
    expect(botoesDaProposta(NOTA).map((b) => b.titulo)).toEqual(['Autorizar', 'Não agora']);
    // O título do botão cabe no limite da Meta (20 caracteres).
    for (const b of botoesDaProposta(NOTA)) expect(b.titulo.length).toBeLessThanOrEqual(20);
  });

  it('a pergunta diz o que vai ser feito e o prazo', () => {
    expect(perguntaDaProposta('consultar_nota')).toBe('Posso consultar esta nota de novo na SEFAZ? Leva alguns segundos. A pergunta vale por 10 minutos.');
    expect(perguntaDaProposta('imprimir_teste')).toContain('via de teste');
  });

  it('a resposta da SEFAZ vira o desfecho: a situação final é "feito"; a pendente é "não deu"', () => {
    expect(resultadoDaConsulta({ status: 'autorizada', numero: 12 })).toEqual({ feita: true, texto: 'A SEFAZ autorizou a nota nº 12.' });
    expect(resultadoDaConsulta({ status: 'rejeitada', numero: 12, motivo: '539 - Duplicidade' })).toEqual({
      feita: true,
      texto: 'A SEFAZ rejeitou a nota nº 12 (539 - Duplicidade). Veja a nota no Regem para corrigir e emitir de novo.',
    });
    expect(resultadoDaConsulta({ status: 'cancelada' }).texto).toBe('A SEFAZ diz que a nota está cancelada.');
    expect(resultadoDaConsulta({ status: 'pendente' }).feita).toBe(false);
    expect(resultadoDaConsulta({}).feita).toBe(false);
    expect(textoDoDesfecho(true, 'A SEFAZ autorizou a nota nº 12.', '21:03')).toBe('✅ Feito às 21:03. A SEFAZ autorizou a nota nº 12.');
    expect(textoDoDesfecho(false, 'a SEFAZ continua sem responder.', '21:03')).toBe('Não deu: a SEFAZ continua sem responder.');
  });
});

// O link com PIN (F4.2a, mig 433; protótipo `mockups/regem-mister-pin.html`): o código, o PIN, o estado da página.
describe('o link com PIN das propostas do Mister', () => {
  it('o código do link tem 32 letras de base64url; o resto nem chega ao banco', () => {
    expect(ehCodigoDoLink('a'.repeat(32))).toBe(true);
    expect(ehCodigoDoLink('Ab-_0123456789Ab-_0123456789Ab-_')).toBe(true);
    expect(ehCodigoDoLink('a'.repeat(31))).toBe(false);
    expect(ehCodigoDoLink('a'.repeat(33))).toBe(false);
    expect(ehCodigoDoLink(`${'a'.repeat(31)}/`)).toBe(false);
    expect(ehCodigoDoLink(`${'a'.repeat(30)}' `)).toBe(false);
    expect(ehCodigoDoLink(undefined)).toBe(false);
    expect(ehCodigoDoLink(12345)).toBe(false);
    expect(caminhoDoLink('x'.repeat(32))).toBe(`/m/${'x'.repeat(32)}`);
  });

  it('o PIN tem de 4 a 6 dígitos, como o do login por PIN', () => {
    for (const p of ['1234', '12345', '123456']) expect(ehPinValido(p)).toBe(true);
    for (const p of ['123', '1234567', '12a4', ' 1234', '', null, 1234]) expect(ehPinValido(p)).toBe(false);
  });

  it('o estado da página sai da situação gravada; o bloqueio vence tudo; a pendente fora do prazo já é "venceu"', () => {
    const agora = Date.parse('2026-11-16T21:10:00Z');
    const depois = '2026-11-16T21:17:00Z';
    const antes = '2026-11-16T21:00:00Z';
    expect(estadoDoLink({ situacao: 'proposta', venceEm: depois }, agora)).toBe('proposta');
    expect(estadoDoLink({ situacao: 'proposta', venceEm: antes }, agora)).toBe('venceu');
    expect(estadoDoLink({ situacao: 'vencida', venceEm: antes }, agora)).toBe('venceu');
    expect(estadoDoLink({ situacao: 'autorizada', venceEm: depois }, agora)).toBe('fazendo');
    expect(estadoDoLink({ situacao: 'executando', venceEm: antes }, agora)).toBe('fazendo');
    expect(estadoDoLink({ situacao: 'feita', venceEm: antes }, agora)).toBe('feito');
    expect(estadoDoLink({ situacao: 'nao_deu', venceEm: antes }, agora)).toBe('naodeu');
    expect(estadoDoLink({ situacao: 'recusada', venceEm: depois }, agora)).toBe('recusou');
    expect(estadoDoLink({ situacao: 'recusada', venceEm: depois, bloqueadaEm: antes }, agora)).toBe('bloqueado');
  });

  it('as tentativas: 5 por link, nunca negativo; a frase do PIN errado diz quantas restam', () => {
    expect(PIN_TENTATIVAS).toBe(5);
    expect([0, 1, 4, 5, 9, null, 'x'].map(tentativasQueRestam)).toEqual([5, 4, 1, 0, 0, 5, 5]);
    expect(TEXTOS_DO_LINK.pinErrado(4)).toBe('O PIN não confere. Restam 4 tentativas.');
    expect(TEXTOS_DO_LINK.pinErrado(1)).toBe('O PIN não confere. Resta 1 tentativa.');
    expect(TEXTOS_DO_LINK.botao.length).toBeLessThanOrEqual(20);
  });

  it('a apresentação: o procedimento sem a sua mostra o nome do catálogo; o desconhecido, a frase geral', () => {
    expect(apresentacaoDaProposta('consultar_nota')).toEqual({ titulo: 'Autorizar: consultar a nota de novo na SEFAZ?', itens: [], detalhe: null, valor: null, botao: 'Autorizar' });
    expect(apresentacaoDaProposta('nao_existe').titulo).toBe('Autorizar o pedido do Mister?');
  });
});

// O cancelamento com o estorno (F4.2b): o que a página e a conversa dizem — só o que o serviço do painel faz.
describe('cancelar o pedido com o estorno (F4.2b)', () => {
  const ifood = { nome: '#284 · iFood 5120', canal: 'iFood', canalExterno: true, cliente: 'Mariana S.', total: 132.9, pagoNoPix: true, provedor: 'Mercado Pago' };
  const balcao = { nome: '#12 · Cardápio', canal: 'Cardápio', canalExterno: false, cliente: null, total: 40, pagoNoPix: false, provedor: null };

  it('o nome curto do cliente: o primeiro nome e a inicial do último', () => {
    expect(nomeCurtoDoCliente('Mariana Souza Lima')).toBe('Mariana L.');
    expect(nomeCurtoDoCliente('  ana  ')).toBe('ana');
    expect(nomeCurtoDoCliente('')).toBeNull();
    expect(nomeCurtoDoCliente(null)).toBeNull();
  });

  it('as plataformas de fora são uma lista fechada (o canal do próprio Regem não ganha "cancelado no …")', () => {
    expect(CANAIS_DE_FORA).toEqual(expect.arrayContaining(['ifood', '99food']));
    for (const c of ['cardapio', 'totem', 'whatsapp', 'manual']) expect(CANAIS_DE_FORA).not.toContain(c);
  });

  it('a página: o pedido do canal pago no Pix, e o do Regem sem Pix', () => {
    expect(apresentacaoDoCancelamento(ifood)).toEqual({
      titulo: 'Cancelar o pedido #284 · iFood 5120?',
      detalhe: 'iFood · cliente Mariana S. · pago por Pix',
      valor: 132.9,
      itens: ['O pedido é cancelado no Regem e no iFood.', 'O estorno do Pix é pedido ao Mercado Pago.'],
      botao: 'Autorizar o cancelamento',
    });
    expect(apresentacaoDoCancelamento(balcao)).toMatchObject({
      detalhe: 'Cardápio',
      itens: ['O pedido é cancelado no Regem.', 'Não houve Pix pago pelo Regem: nenhum estorno é pedido por aqui.'],
    });
  });

  it('as frases da conversa: o link, o feito, o estorno que falhou ou ficou na fila, a recusa do serviço', () => {
    expect(TEXTOS_DO_CANCELAMENTO.link(ifood, '21:17')).toBe(
      'Para cancelar o pedido #284 · iFood 5120 (R$ 132,90, Pix já pago), a autorização é no Regem, com o seu PIN. O pedido vale até 21:17.',
    );
    expect(TEXTOS_DO_CANCELAMENTO.link(balcao, '21:17')).toContain('(R$ 40,00), a autorização');
    expect(TEXTOS_DO_CANCELAMENTO.feito(ifood)).toBe('O pedido #284 · iFood 5120 foi cancelado no Regem e no iFood, e o estorno do Pix foi pedido ao Mercado Pago. Autorizado por você, com o PIN.');
    expect(TEXTOS_DO_CANCELAMENTO.feito(balcao)).toBe('O pedido #12 · Cardápio foi cancelado no Regem. Autorizado por você, com o PIN.');
    expect(TEXTOS_DO_CANCELAMENTO.estornoFalhou(ifood, 'saldo insuficiente')).toContain('(saldo insuficiente). Um caso urgente entrou em Atendimento');
    expect(TEXTOS_DO_CANCELAMENTO.estornoNaFila(ifood)).toContain('ainda não saiu no Mercado Pago');
    expect(TEXTOS_DO_CANCELAMENTO.naoCancelou(ifood)).toContain('Delivery › Painel');
    expect(TEXTOS_DO_CANCELAMENTO.recusado('Pedido concluído não pode ser cancelado.')).toBe('pedido concluído não pode ser cancelado. Nada foi feito.');
    expect(TEXTOS_DO_LINK.vencida(TEXTOS_DO_CANCELAMENTO.doCancelamento('#284'), '21:17')).toBe(
      'O pedido de autorização do cancelamento do pedido #284 venceu às 21:17 sem resposta. Nada foi feito. Se ainda precisar, é só me pedir de novo.',
    );
  });
});
