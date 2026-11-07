import {
  casosDoNumero,
  chaveDoProduto,
  contaComoReclamacao,
  custouDoCaso,
  ESPERA_SEM_PRAZO_MS,
  lerOQueAconteceu,
  lerPeriodo,
  MAX_CASOS_NA_GAVETA,
  montarNumeros,
  motivoDoItemIfood,
  MOTIVOS,
  oQueAconteceuNoCaso,
  situacaoNoPlacar,
  type LinhaDoCaso,
} from './numeros';

/* eslint-disable @typescript-eslint/no-explicit-any */

// NÚMEROS DO ATENDIMENTO — a regra pura (item 8; protótipo versão 6). Cada regra sozinha: o período, o "O que aconteceu?",
// o motivo do item do iFood, o que vale (equipe > plataforma), quanto custou, como o caso entra no placar e a montagem.
const AGORA = Date.parse('2026-11-06T22:00:00Z');
const min = (n: number) => new Date(AGORA - n * 60_000).toISOString();
const caso = (o: Partial<LinhaDoCaso> = {}): LinhaDoCaso => ({
  id: o.id ?? `c-${Math.random()}`,
  tipo: 'humano',
  canal: 'whatsapp',
  status: 'resolvido',
  decisao: null,
  criadoEm: min(60),
  pegoEm: null,
  resolvidoEm: null,
  resolvidoPorId: null,
  prazoEm: null,
  cliente: 'Carlos Alberto',
  pedidoNumero: '1180',
  totalCentavos: 5000,
  disputa: null,
  encerramento: null,
  resposta: null,
  valor99: null,
  classificacao: null,
  ...o,
});

describe('período', () => {
  it('aceita 7, 30, mês e mês passado; o resto vira 30 dias (a régua do iFood)', () => {
    expect(['7', '30', 'mes', 'ant'].map(lerPeriodo)).toEqual(['7', '30', 'mes', 'ant']);
    expect(lerPeriodo('90')).toBe('30');
    expect(lerPeriodo(undefined)).toBe('30');
    expect(lerPeriodo({})).toBe('30');
  });
});

describe('"O que aconteceu?" (o que a equipe marca)', () => {
  it('vazio limpa; motivo fora da lista recusa', () => {
    expect(lerOQueAconteceu({ motivo: '' })).toEqual({ ok: true, valor: null });
    expect(lerOQueAconteceu({})).toEqual({ ok: true, valor: null });
    expect(lerOQueAconteceu({ motivo: 'inventado' }).ok).toBe(false);
  });
  it('os produtos só nos motivos de produto; junta o repetido; limita a 10 e o tamanho do nome', () => {
    expect(lerOQueAconteceu({ motivo: 'atraso', produtos: ['X-Burguer'] })).toEqual({ ok: false, erro: '"Atraso" não pede o produto.' });
    expect(lerOQueAconteceu({ motivo: 'atraso' })).toEqual({ ok: true, valor: { motivo: 'atraso', produtos: [] } });
    expect(lerOQueAconteceu({ motivo: 'faltou', produtos: ['Batata  média', 'batata média', ' ', 'Coca'] })).toEqual({
      ok: true,
      valor: { motivo: 'faltou', produtos: ['Batata média', 'Coca'] },
    });
    expect(lerOQueAconteceu({ motivo: 'faltou', produtos: Array.from({ length: 11 }, (_, i) => `P${i}`) }).ok).toBe(false);
    expect(lerOQueAconteceu({ motivo: 'faltou', produtos: ['x'.repeat(121)] }).ok).toBe(false);
    expect(lerOQueAconteceu({ motivo: 'faltou', produtos: 'Batata' }).ok).toBe(false);
    expect(lerOQueAconteceu({ motivo: 'faltou', produtos: [3] }).ok).toBe(false);
  });
  it('a lista tem 10 motivos, o último é "Não foi reclamação"', () => {
    expect(MOTIVOS).toHaveLength(10);
    expect(MOTIVOS[MOTIVOS.length - 1]).toMatchObject({ k: 'nao', nome: 'Não foi reclamação' });
  });
});

describe('o motivo do item na disputa do iFood', () => {
  it.each([
    ['MISSING_ITEM', 'faltou'],
    ['Item faltando', 'faltou'],
    ['WRONG_ITEM', 'errado'],
    ['Veio trocado', 'errado'],
    ['COLD_FOOD', 'frio'],
    ['Chegou frio', 'frio'],
    ['SPILLED', 'embalagem'],
    ['Embalagem violada', 'embalagem'],
    ['BAD_QUALITY', 'qualidade'],
    ['Estava cru', 'qualidade'],
    ['algo que ninguém previu', 'outro'],
  ])('%s → %s', (t, m) => expect(motivoDoItemIfood(t)).toBe(m));
  it('sem texto, sem motivo', () => expect(motivoDoItemIfood(null)).toBeNull());
});

describe('o que vale no caso', () => {
  it('o que a equipe marcou vence o que a plataforma disse', () => {
    const l = caso({ tipo: 'disputa', disputa: { tipo: 'DELAY' }, classificacao: { motivo: 'frio', produtos: ['Pizza'] } });
    expect(oQueAconteceuNoCaso(l)).toEqual({ motivo: 'frio', fonte: 'equipe', produtos: [{ nome: 'Pizza', motivo: 'frio' }] });
  });
  it('produto marcado num motivo que não é de produto não conta', () => {
    expect(oQueAconteceuNoCaso(caso({ classificacao: { motivo: 'atraso', produtos: ['Pizza'] } })).produtos).toEqual([]);
  });
  it('disputa por atraso (DELAY, tempo de preparo, mais tempo) é atraso, sem produto', () => {
    for (const disputa of [{ tipo: 'DELAY' }, { tipo: 'PREPARATION_TIME' }, { acao: 'PROPOSED_ADDITIONAL_TIME', tipo: 'AFTER_DELIVERY' }])
      expect(oQueAconteceuNoCaso(caso({ tipo: 'disputa', disputa }))).toEqual({ motivo: 'atraso', fonte: 'plataforma', produtos: [] });
  });
  it('disputa com itens: o motivo mais apontado; os itens viram os produtos', () => {
    const l = caso({
      tipo: 'disputa',
      disputa: {
        tipo: 'AFTER_DELIVERY_PARTIALLY',
        itens: [
          { nome: 'Batata média', motivo: 'MISSING_ITEM' },
          { nome: 'Coca lata', motivo: 'MISSING_ITEM' },
          { nome: 'X-Burguer', motivo: 'COLD_FOOD' },
          { nome: '', motivo: 'COLD_FOOD' },
        ],
      },
    });
    const r = oQueAconteceuNoCaso(l);
    expect(r.motivo).toBe('faltou');
    expect(r.fonte).toBe('plataforma');
    expect(r.produtos).toEqual([
      { nome: 'Batata média', motivo: 'faltou' },
      { nome: 'Coca lata', motivo: 'faltou' },
      { nome: 'X-Burguer', motivo: 'frio' },
    ]);
  });
  it('mudança de pedido não é reclamação; os outros tipos, sem marca, entram como "sem motivo"', () => {
    expect(contaComoReclamacao(caso({ tipo: 'mudanca' }))).toBe(false);
    expect(contaComoReclamacao(caso({ tipo: 'humano' }))).toBe(true);
    expect(contaComoReclamacao(caso({ tipo: 'humano', classificacao: { motivo: 'nao' } }))).toBe(false);
    expect(contaComoReclamacao(caso({ tipo: 'tipo-novo' }))).toBe(false);
  });
});

describe('quanto custou', () => {
  const disputa = (o: Partial<LinhaDoCaso>) => custouDoCaso(caso({ tipo: 'disputa', canal: 'ifood', ...o }));
  it('disputa aceita: o pedido inteiro; parcial: a soma dos itens; item sem valor: não se sabe', () => {
    expect(disputa({ disputa: { acao: 'CANCELLATION', tipo: 'DELAY' }, encerramento: { status: 'ACCEPTED' } })).toEqual({ centavos: 5000, estimado: false, conhecido: true });
    expect(
      disputa({
        disputa: { acao: 'PARTIAL_CANCELLATION', tipo: 'AFTER_DELIVERY_PARTIALLY', itens: [{ centavos: 1290 }, { centavos: 600 }] },
        encerramento: { status: 'ACCEPTED' },
      }).centavos,
    ).toBe(1890);
    expect(disputa({ disputa: { acao: 'PARTIAL_CANCELLATION', itens: [{ centavos: null }] }, encerramento: { status: 'ACCEPTED' } }).conhecido).toBe(false);
  });
  it('proposta aceita pelo cliente: o valor proposto; mais tempo não custa', () => {
    expect(disputa({ disputa: { acao: 'CANCELLATION' }, encerramento: { status: 'ALTERNATIVE_REPLIED', proposta: { tipo: 'REFUND', centavos: 700 } } }).centavos).toBe(700);
    expect(disputa({ disputa: { acao: 'CANCELLATION' }, encerramento: { status: 'ALTERNATIVE_REPLIED', proposta: { tipo: 'ADDITIONAL_TIME', centavos: null } } }).centavos).toBe(0);
  });
  it('venceu sem resposta: custa só se o iFood aceitava sozinho; recusada não custa', () => {
    expect(disputa({ disputa: { acao: 'CANCELLATION', acaoAutomatica: 'ACCEPT_CANCELLATION' }, encerramento: { status: 'EXPIRED' } }).centavos).toBe(5000);
    expect(disputa({ disputa: { acao: 'CANCELLATION', acaoAutomatica: 'REJECT_CANCELLATION' }, encerramento: { status: 'EXPIRED' } }).centavos).toBe(0);
    expect(disputa({ disputa: { acao: 'CANCELLATION' }, encerramento: { status: 'REJECTED' } }).centavos).toBe(0);
  });
  it('respondida pela central e ainda sem o encerramento do iFood: vale a resposta', () => {
    expect(disputa({ disputa: { acao: 'CANCELLATION' }, decisao: 'aceito' }).centavos).toBe(5000);
    expect(disputa({ disputa: { acao: 'CANCELLATION' }, decisao: 'recusado' }).centavos).toBe(0);
  });
  it('99: cancelamento aceito (também pelo ajuste) custa o pedido; reembolso aceito, o valor pedido ou o pedido inteiro (estimado)', () => {
    expect(custouDoCaso(caso({ tipo: 'cancelamento_99', decisao: 'aceito_automatico' })).centavos).toBe(5000);
    expect(custouDoCaso(caso({ tipo: 'cancelamento_99', decisao: 'recusado_pela_99' })).centavos).toBe(0);
    expect(custouDoCaso(caso({ tipo: 'reembolso_99', decisao: 'reembolsado_pela_99', valor99: 1500 }))).toEqual({ centavos: 1500, estimado: false, conhecido: true });
    expect(custouDoCaso(caso({ tipo: 'reembolso_99', decisao: 'aceito' }))).toEqual({ centavos: 5000, estimado: true, conhecido: true });
    expect(custouDoCaso(caso({ tipo: 'reembolso_99', decisao: 'recusado_automatico' })).centavos).toBe(0);
  });
  it('cancelamento do cardápio aceito custa o pedido; caso do robô não custa', () => {
    expect(custouDoCaso(caso({ tipo: 'cancelamento', decisao: 'aceito' })).centavos).toBe(5000);
    expect(custouDoCaso(caso({ tipo: 'cancelamento', decisao: 'recusado' })).centavos).toBe(0);
    expect(custouDoCaso(caso({ tipo: 'humano' })).centavos).toBe(0);
  });
});

describe('o caso no placar', () => {
  it('caso do robô: respondido quando alguém pega ou resolve; o tempo é até o primeiro dos dois', () => {
    expect(situacaoNoPlacar(caso({ criadoEm: min(30), pegoEm: min(27) }), AGORA)).toEqual({ conta: true, respondida: true, seg: 180 });
    expect(situacaoNoPlacar(caso({ criadoEm: min(30), resolvidoEm: min(25), resolvidoPorId: 'x', pegoEm: min(20) }), AGORA).seg).toBe(300);
    // Resolvido sem ninguém (sistema): não foi respondido.
    expect(situacaoNoPlacar(caso({ criadoEm: min(30), resolvidoEm: min(25) }), AGORA)).toEqual({ conta: true, respondida: false, seg: null });
  });
  it('o que ainda espera (no prazo, ou sem prazo há menos de 15 min) fica fora; depois conta como sem resposta', () => {
    const recente = new Date(AGORA - ESPERA_SEM_PRAZO_MS + 60_000).toISOString();
    expect(situacaoNoPlacar(caso({ status: 'aberto', criadoEm: recente }), AGORA).conta).toBe(false);
    expect(situacaoNoPlacar(caso({ status: 'aberto', criadoEm: min(20) }), AGORA)).toEqual({ conta: true, respondida: false, seg: null });
    expect(situacaoNoPlacar(caso({ tipo: 'disputa', status: 'aberto', criadoEm: min(20), prazoEm: new Date(AGORA + 60_000).toISOString() }), AGORA).conta).toBe(false);
  });
  it('disputa: pela central (com o tempo), pelo app do iFood (sem o tempo), venceu = sem resposta', () => {
    expect(situacaoNoPlacar(caso({ tipo: 'disputa', criadoEm: min(10), resposta: { em: min(4) } }), AGORA)).toEqual({ conta: true, respondida: true, seg: 360 });
    expect(situacaoNoPlacar(caso({ tipo: 'disputa', encerramento: { status: 'ALTERNATIVE_REPLIED' } }), AGORA)).toEqual({ conta: true, respondida: true, seg: null });
    expect(situacaoNoPlacar(caso({ tipo: 'disputa', encerramento: { status: 'EXPIRED' } }), AGORA)).toEqual({ conta: true, respondida: false, seg: null });
  });
  it('99: a resposta automática do Regem não é resposta; o aceite pelo ajuste da loja fica fora do placar', () => {
    expect(situacaoNoPlacar(caso({ tipo: 'reembolso_99', resposta: { em: min(1), automatico: true }, decisao: 'recusado_automatico' }), AGORA).respondida).toBe(false);
    expect(situacaoNoPlacar(caso({ tipo: 'cancelamento_99', decisao: 'aceito_automatico' }), AGORA).conta).toBe(false);
    expect(situacaoNoPlacar(caso({ tipo: 'cancelamento_99', criadoEm: min(10), resposta: { em: min(8) } }), AGORA).seg).toBe(120);
  });
});

describe('a montagem', () => {
  const linhas = [
    caso({ id: 'a', tipo: 'disputa', canal: 'ifood', disputa: { acao: 'CANCELLATION', tipo: 'DELAY' }, encerramento: { status: 'EXPIRED' }, criadoEm: min(50) }),
    caso({
      id: 'b',
      tipo: 'disputa',
      canal: 'ifood',
      disputa: { acao: 'PARTIAL_CANCELLATION', tipo: 'AFTER_DELIVERY_PARTIALLY', itens: [{ nome: 'Batata média', centavos: 1290, motivo: 'MISSING_ITEM' }, { nome: 'Coca', centavos: 600, motivo: 'MISSING_ITEM' }] },
      encerramento: { status: 'ACCEPTED' },
      resposta: { em: min(40) },
      criadoEm: min(45),
    }),
    caso({ id: 'c', classificacao: { motivo: 'faltou', produtos: ['batata  MÉDIA'] }, pegoEm: min(28), criadoEm: min(30) }),
    caso({ id: 'd', tipo: 'humano', criadoEm: min(20) }), // sem motivo
    caso({ id: 'e', tipo: 'mudanca', pegoEm: min(9), criadoEm: min(10) }), // não é reclamação
    caso({ id: 'f', tipo: 'chat', canal: 'ifood' }), // o chat entra pelas mensagens
  ];
  const n = montarNumeros(linhas, [{ canal: 'ifood', chegaram: 21, respondidas: 19, seg: 160 }], AGORA);

  it('placar: 8 linhas na ordem; o chat vem das mensagens; os casos pelos grupos', () => {
    expect(n.canais.map((c) => c.k)).toEqual(['chat-ifood', 'chat-99', 'chat-instagram', 'casos', 'disputa', 'pedido99', 'avaliacao', 'cancelamento']);
    expect(n.canais[0]).toMatchObject({ chegaram: 21, respondidas: 19, segMedio: 160, semResposta: 2 });
    expect(n.canais[1]).toMatchObject({ chegaram: 0, semMensagens: true, segMedio: null });
    expect(n.canais.find((c) => c.k === 'disputa')).toMatchObject({ chegaram: 2, respondidas: 1, semResposta: 1, segMedio: 300 });
    // c (pegou em 2 min), d (sem ninguém há 20 min), e (mudança, pegou em 1 min); f é chat.
    expect(n.canais.find((c) => c.k === 'casos')).toMatchObject({ chegaram: 3, respondidas: 2, semResposta: 1, segMedio: 90 });
  });
  it('motivos: atraso e faltou com o custo; "sem motivo" por último; a mudança fora', () => {
    expect(n.motivos.map((m) => [m.k, m.casos, m.centavos])).toEqual([
      ['faltou', 2, 1890],
      ['atraso', 1, 0],
      ['sem', 2, 0], // d (robô) e f (chat): os dois podem ser reclamação
    ]);
    expect(n.reclamacoes).toBe(5);
    expect(n.custou).toEqual({ centavos: 1890, casos: 1, estimado: false, semValor: 0 });
  });
  it('produtos: o mesmo nome escrito diferente junta; o custo do caso se divide entre os produtos dele', () => {
    expect(n.produtos).toEqual([
      { nome: 'Batata média', casos: 2, centavos: 945, motivos: [{ k: 'faltou', nome: 'Faltou item', casos: 2 }] },
      { nome: 'Coca', casos: 1, centavos: 945, motivos: [{ k: 'faltou', nome: 'Faltou item', casos: 1 }] },
    ]);
    expect(chaveDoProduto('Batata  MÉDIA')).toBe(chaveDoProduto('batata média'));
  });
  it('a gaveta: por motivo e por produto, com o primeiro nome do cliente e o limite', () => {
    const r = casosDoNumero(linhas, { produto: 'BATATA MEDIA' });
    expect(r.total).toBe(2);
    expect(r.casos.map((c) => c.id)).toEqual(['b', 'c']);
    expect(r.casos[0]).toMatchObject({ titulo: 'Carlos · pedido 1180', fonte: 'plataforma', centavos: 1890 });
    expect(casosDoNumero(linhas, { motivo: 'sem' }).casos.map((c) => c.id)).toEqual(['d', 'f']);
    const muitos = Array.from({ length: MAX_CASOS_NA_GAVETA + 5 }, (_, i) => caso({ id: `m${i}`, classificacao: { motivo: 'atraso' } }));
    const g = casosDoNumero(muitos, { motivo: 'atraso' });
    expect([g.casos.length, g.total]).toEqual([MAX_CASOS_NA_GAVETA, MAX_CASOS_NA_GAVETA + 5]);
  });
  it('nada no período: tudo zerado, sem erro', () => {
    const v = montarNumeros([], [], AGORA);
    expect(v.motivos).toEqual([]);
    expect(v.produtos).toEqual([]);
    expect(v.canais.every((c) => c.chegaram === 0)).toBe(true);
  });
  it('a disputa venceu com o "aceitar" automático do iFood e o item sem valor: fica fora da soma e conta em "sem valor"', () => {
    const v = montarNumeros(
      [caso({ tipo: 'disputa', disputa: { acao: 'PARTIAL_CANCELLATION', acaoAutomatica: 'ACCEPT_CANCELLATION', itens: [{ nome: 'X', centavos: null }] }, encerramento: { status: 'EXPIRED' } })],
      [],
      AGORA,
    );
    expect(v.custou).toEqual({ centavos: 0, casos: 0, estimado: false, semValor: 1 });
  });
});

// Garante que o tipo do teste segue o da linha (um campo novo na linha obriga a pensar no teste).
const _tipo: LinhaDoCaso = caso();
void (_tipo as any);
