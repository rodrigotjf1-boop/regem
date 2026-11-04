import {
  type OperacaoDoRobo,
  type PedidoFeito,
  OPCOES_DE_AJUDA,
  TEXTO_DA_PEDIDA,
  contaDaMudanca,
  deltaDaMudanca,
  lerMudanca,
  linhasDaMudanca,
  motivoParaNaoMudar,
  opcoesDaConferencia,
  opcoesDoTroco,
  ordemDoPedido,
  textoDaConferencia,
  textoDaDecisao,
  textoDaPerguntaDoTroco,
  textoDaRecusaDaGravacao,
  textoDoFeito,
  visaoDoPedidoFeito,
} from './robo-mudanca';

/* eslint-disable @typescript-eslint/no-explicit-any */

// As regras puras da MUDANÇA DO PEDIDO JÁ FEITO PELO ROBÔ (PR 3): quando muda, a conta (a MESMA da gravação — V74) e o
// que o cliente lê nos textos e botões.

const pedido = (o: Partial<PedidoFeito> = {}): PedidoFeito => ({
  id: 'p1',
  numero: '57',
  status: 'confirmado',
  tipo: 'entrega',
  total: 45,
  trocoPara: 50,
  trocoPossivel: true,
  pagoAntes: false,
  comNota: false,
  jaMudouPeloRobo: false,
  mudancaPendente: false,
  desligado: false,
  outroEmAndamento: false,
  itens: [
    { linha: 1, comandaItemId: 'ci1', produtoId: 'xb', variacaoId: null, opcaoIds: [], descricao: 'X-Bacon', quantidade: 1, precoUnitario: 32, observacao: null, pronto: false },
    { linha: 2, comandaItemId: 'ci2', produtoId: 'co', variacaoId: null, opcaoIds: [], descricao: 'Coca lata', quantidade: 2, precoUnitario: 6.5, observacao: null, pronto: true },
  ],
  ...o,
});
const entra = (o: any = {}) => ({ produtoId: 'bt', variacaoId: null, complementos: [], quantidade: 1, observacao: null, descricao: 'Batata', precoUnitario: 14, ...o });
const por: OperacaoDoRobo = { tipo: 'por', entra: entra() };
const tirarCoca: OperacaoDoRobo = { tipo: 'tirar', sai: { comandaItemId: 'ci2', descricao: 'Coca lata', quantidade: 2, precoUnitario: 6.5 } };
const trocarXBacon: OperacaoDoRobo = {
  tipo: 'trocar',
  sai: { comandaItemId: 'ci1', descricao: 'X-Bacon', quantidade: 1, precoUnitario: 32 },
  entra: entra({ produtoId: 'xb', descricao: 'X-Bacon', precoUnitario: 32, observacao: 'sem cebola' }),
};
/** O pedido como a gravação lê (a linha do `pedido_externo`): dinheiro na entrega, troco para R$ 50. */
const linha = (o: any = {}) => ({
  total: '45.00',
  taxaEntrega: '6.00',
  trocoPara: '50.00',
  valorPagoCliente: '45.00',
  pagamentos: [{ rotulo: 'Dinheiro', valor: 45, prepago: false, troco: 50 }],
  ...o,
});

describe('quando o robô muda o pedido', () => {
  it('a conta da operação: pôr soma, tirar subtrai, trocar faz a diferença', () => {
    expect(deltaDaMudanca(por)).toBe(14);
    expect(deltaDaMudanca(tirarCoca)).toBe(-13);
    expect(deltaDaMudanca(trocarXBacon)).toBe(0);
    expect(deltaDaMudanca({ tipo: 'trocar', sai: tirarCoca.sai, entra: entra({ quantidade: 1, precoUnitario: 6.5 }) })).toBe(-6.5);
  });

  it('pedido aceito, ainda na loja, nada pendente: muda', () => {
    expect(motivoParaNaoMudar(pedido())).toBeNull();
    expect(motivoParaNaoMudar(pedido({ status: 'pronto' }), por)).toBeNull();
  });

  it('a situação do pedido segue a mesma lista da alteração da equipe (STATUS_ALTERAVEL)', () => {
    const m = (status: string) => motivoParaNaoMudar(pedido({ status }));
    expect(m('novo')).toMatchObject({ motivo: 'chegando', chamaEquipe: false });
    expect(m('despachado')).toMatchObject({ motivo: 'saiu', chamaEquipe: true, mensagem: 'O pedido nº 57 já saiu para a entrega: não dá para mudar por aqui.' });
    expect(m('concluido')).toMatchObject({ motivo: 'entregue', chamaEquipe: true });
    expect(m('cancelado')).toMatchObject({ motivo: 'cancelado', chamaEquipe: false });
    expect(m('qualquer_outra')).toMatchObject({ motivo: 'situacao', chamaEquipe: true });
  });

  it('desligado na loja, dois pedidos em andamento, uma mudança com a loja e a segunda mudança: a equipe (ou esperar)', () => {
    expect(motivoParaNaoMudar(pedido({ desligado: true }))).toMatchObject({ motivo: 'desligado', chamaEquipe: true });
    expect(motivoParaNaoMudar(pedido({ outroEmAndamento: true }))).toMatchObject({ motivo: 'dois_pedidos', chamaEquipe: true });
    expect(motivoParaNaoMudar(pedido({ mudancaPendente: true }))).toMatchObject({ motivo: 'uma_por_vez', chamaEquipe: false });
    expect(motivoParaNaoMudar(pedido({ jaMudouPeloRobo: true }))).toMatchObject({ motivo: 'ja_mudou', chamaEquipe: true });
  });

  it('pago pelo link e nota fiscal: só barram a mudança que MEXE no valor (4A e 7)', () => {
    expect(motivoParaNaoMudar(pedido({ pagoAntes: true }), por)).toMatchObject({ motivo: 'pago' });
    expect(motivoParaNaoMudar(pedido({ comNota: true }), tirarCoca)).toMatchObject({ motivo: 'nota' });
    expect(motivoParaNaoMudar(pedido({ pagoAntes: true, comNota: true }), trocarXBacon)).toBeNull();
    // Sem a operação (o "dá para mudar?" do ver_pedido), pago e nota ainda não dizem nada.
    expect(motivoParaNaoMudar(pedido({ pagoAntes: true, comNota: true }))).toBeNull();
  });

  it('o item que SAI já pronto na cozinha não sai nem troca por aqui; pôr um item novo, sim', () => {
    expect(motivoParaNaoMudar(pedido(), tirarCoca)).toMatchObject({
      motivo: 'item_pronto',
      mensagem: 'O Coca lata já ficou pronto na cozinha: não dá para tirar por aqui.',
    });
    expect(motivoParaNaoMudar(pedido(), { tipo: 'trocar', sai: tirarCoca.sai, entra: entra() })?.mensagem).toContain('não dá para trocar');
    expect(motivoParaNaoMudar(pedido(), por)).toBeNull();
    expect(motivoParaNaoMudar(pedido(), trocarXBacon)).toBeNull();
  });
});

describe('a conta da mudança é a da gravação (valoresDepois)', () => {
  it('o total, o que o entregador recebe e o troco que fica', () => {
    expect(contaDaMudanca(linha(), tirarCoca)).toEqual({ ok: true, total: 32, aReceber: 32, troco: 50 });
    expect(contaDaMudanca(linha(), trocarXBacon)).toEqual({ ok: true, total: 45, aReceber: 45, troco: 50 });
  });

  it('o troco que não cobre o valor novo é a pergunta do troco; o troco novo (ou "sem troco") resolve', () => {
    expect(contaDaMudanca(linha(), por)).toMatchObject({ ok: false, code: 'TROCO_INSUFICIENTE' });
    expect(contaDaMudanca(linha(), por, 100)).toEqual({ ok: true, total: 59, aReceber: 59, troco: 100 });
    expect(contaDaMudanca(linha(), por, null)).toEqual({ ok: true, total: 59, aReceber: 59, troco: null });
    expect(contaDaMudanca(linha(), por, 55)).toMatchObject({ ok: false, code: 'TROCO_INSUFICIENTE' });
  });

  it('pago antes: mudar o valor é recusado pela mesma regra da gravação', () => {
    const pago = linha({ pagoOnline: true, pagamentos: [{ rotulo: 'Pix', valor: 45, prepago: true }], trocoPara: null });
    expect(contaDaMudanca(pago, por)).toMatchObject({ ok: false, code: 'PAGO_ONLINE' });
    expect(contaDaMudanca(pago, trocarXBacon)).toMatchObject({ ok: true, total: 45 });
  });
});

describe('o que o cliente lê', () => {
  it('as linhas da mudança', () => {
    expect(linhasDaMudanca(por)).toEqual(['➕ 1 Batata — R$ 14,00']);
    expect(linhasDaMudanca(tirarCoca)).toEqual(['➖ 2 Coca lata — R$ 13,00']);
    expect(linhasDaMudanca(trocarXBacon)).toEqual(['🔄 1 X-Bacon → 1 X-Bacon (sem cebola)']);
  });

  it('a conferência: o total antes → depois e o troco que continua, que muda ou que sai', () => {
    expect(textoDaConferencia('57', tirarCoca, 45, 32, { antes: 50, depois: 50, possivel: true })).toBe(
      ['Mudança no pedido nº 57', '➖ 2 Coca lata — R$ 13,00', 'Total: R$ 45,00 → R$ 32,00', 'Troco para R$ 50,00 (continua)', '', 'Confere a mudança 👇'].join('\n'),
    );
    expect(textoDaConferencia('57', por, 45, 59, { antes: 50, depois: 100, possivel: true })).toContain('Troco para R$ 100,00 (novo)');
    expect(textoDaConferencia('57', por, 45, 59, { antes: 50, depois: null, possivel: true })).toContain('Sem troco (novo)');
    expect(textoDaConferencia('57', trocarXBacon, 45, 45, { antes: 50, depois: 50, possivel: true })).toContain('Total: R$ 45,00 (não muda)');
    // Cartão na entrega sem troco, ou pago antes: nada de troco no texto.
    expect(textoDaConferencia(null, trocarXBacon, 45, 45, { antes: null, depois: null, possivel: true })).not.toContain('roco');
    expect(textoDaConferencia(null, trocarXBacon, 45, 45, { antes: null, depois: null, possivel: false }).split('\n')[0]).toBe('Mudança no pedido');
  });

  it('a pergunta do troco: o troco que não cobre, ou o "Mudar o troco"', () => {
    const t = textoDaPerguntaDoTroco('57', por, 45, 59, { naoCobre: true, trocoAntes: 50 });
    expect(t).toContain('Total: R$ 45,00 → R$ 59,00');
    expect(t.endsWith('O troco para R$ 50,00 não cobre o valor novo. Vai precisar de troco para quanto?')).toBe(true);
    expect(textoDaPerguntaDoTroco('57', por, 45, 59, { naoCobre: false, trocoAntes: 100 }).endsWith('\n\nVai precisar de troco para quanto?')).toBe(true);
  });

  it('os botões: cabem no WhatsApp (até 20 letras) e são os combinados', () => {
    expect(opcoesDaConferencia(true)).toEqual(['Pode alterar', 'Mudar o troco', 'Deixar como estava']);
    expect(opcoesDaConferencia(false)).toEqual(['Pode alterar', 'Deixar como estava']);
    expect(opcoesDoTroco(59)).toEqual(['R$ 100', 'R$ 150', 'Não preciso de troco']);
    expect(OPCOES_DE_AJUDA).toEqual(['Sim, quero ajuda', 'Não, obrigado']);
    for (const o of [...opcoesDaConferencia(true), ...opcoesDoTroco(59), ...OPCOES_DE_AJUDA]) expect(o.length).toBeLessThanOrEqual(20);
  });

  it('feito, pedido à loja e a decisão da loja (sem o motivo da equipe)', () => {
    expect(textoDoFeito('57', 59, 100)).toBe('✅ Pronto! Pedido nº 57 alterado.\nTotal: R$ 59,00 · troco para R$ 100,00.');
    expect(textoDoFeito(null, 32, null)).toBe('✅ Pronto! Pedido alterado.\nTotal: R$ 32,00.');
    expect(TEXTO_DA_PEDIDA).toBe('Pedi a mudança à loja ⏳ Te confirmo aqui em instantes.');
    expect(textoDaDecisao('57', 'aplicada', { total: 59, troco: 100 })).toBe('✅ A loja confirmou: pedido nº 57 alterado.\nTotal: R$ 59,00 · troco para R$ 100,00.');
    expect(textoDaDecisao('57', 'recusada')).toBe('A loja não conseguiu mudar o pedido nº 57 agora. Quer ajuda de alguém da equipe?');
    expect(textoDaDecisao('57', 'vencida')).toContain('Já chamei alguém da equipe');
  });

  it('a recusa da gravação vira o motivo para o cliente; sem código conhecido, a oferta da equipe', () => {
    expect(textoDaRecusaDaGravacao('57', 'PAGO_ONLINE')).toMatchObject({ motivo: 'pago', chamaEquipe: true });
    expect(textoDaRecusaDaGravacao('57', 'NOTA_FISCAL')).toMatchObject({ motivo: 'nota', chamaEquipe: true });
    expect(textoDaRecusaDaGravacao('57', 'LOJA_COM_SERVIDOR')).toEqual({ motivo: 'nao_mudou', mensagem: 'Não consegui mudar o pedido nº 57 agora.', chamaEquipe: true });
  });
});

describe('a numeração dos itens do pedido feito', () => {
  // Os itens da venda nascem na mesma transação (o mesmo instante) e o id é aleatório: numerar pelo id dava "item 2" ao
  // X-Bacon que o cliente leu em primeiro no resumo (achado no teste contra o Postgres, 04/11).
  const item = (id: string, produtoId: string | null, descricao: string, criadoEm = 1000) => ({ id, produtoId, descricao, criadoEm });
  const lista = [
    { produtoId: 'xb', descricao: 'X-Bacon' },
    { produtoId: 'sc', descricao: 'Suco' },
    { produtoId: 'xb', descricao: 'X-Bacon' },
    { descricao: 'Item avulso' },
  ];

  it('os que nasceram juntos seguem a lista do pedido — não o id', () => {
    const r = ordemDoPedido([item('a-suco', 'sc', 'Suco'), item('b-xb', 'xb', 'X-Bacon'), item('0-avulso', null, 'item avulso'), item('c-xb', 'xb', 'X-Bacon')], lista);
    expect(r.map((x) => x.id)).toEqual(['b-xb', 'a-suco', 'c-xb', '0-avulso']);
  });

  it('os que entraram depois (numa mudança) vêm depois; sem lista, a ordem é a do instante e do id (sempre a mesma)', () => {
    const r = ordemDoPedido([item('z-batata', 'bt', 'Batata', 2000), item('a-suco', 'sc', 'Suco'), item('b-xb', 'xb', 'X-Bacon')], lista);
    expect(r.map((x) => x.id)).toEqual(['b-xb', 'a-suco', 'z-batata']);
    expect(ordemDoPedido([item('b', 'x', 'B'), item('a', 'y', 'A')], null).map((x) => x.id)).toEqual(['a', 'b']);
  });
});

describe('a mudança guardada e o que o robô vê', () => {
  it('a mudança sem a forma certa conta como nenhuma', () => {
    expect(lerMudanca(null)).toBeNull();
    expect(lerMudanca({ id: 'x' })).toBeNull();
    expect(lerMudanca({ id: 'x', pedidoId: 'p1', op: {} })).toBeNull();
    expect(lerMudanca({ id: 'x', pedidoId: 'p1', op: por, criadaEm: 'agora' })).toMatchObject({ id: 'x' });
  });

  it('o pedido feito no ver_pedido: os itens numerados, se dá para mudar e a mudança em conferência', () => {
    const v: any = visaoDoPedidoFeito(pedido(), 'em produção', null);
    expect(v).toMatchObject({ numero: '57', situacao: 'em produção', podeMudar: true, total: 'R$ 45,00' });
    expect(v.itens).toEqual([
      { linha: 1, item: '1x X-Bacon', valor: 'R$ 32,00' },
      { linha: 2, item: '2x Coca lata', valor: 'R$ 13,00', prontoNaCozinha: true },
    ]);
    expect(v.comoMudar).toContain('pedido_tirar');
    const naoDa: any = visaoDoPedidoFeito(pedido({ status: 'despachado' }), 'a caminho', null);
    expect(naoDa).toMatchObject({ podeMudar: false, motivo: 'saiu', chamaEquipe: true });
    expect(naoDa.comoMudar).toBeUndefined();
    const m = { id: 'm1', pedidoId: 'p1', numero: '57', op: por, aguardaTroco: true, criadaEm: 'agora' };
    expect((visaoDoPedidoFeito(pedido(), 'em produção', m) as any).mudancaEmConferencia).toEqual({ mudanca: ['➕ 1 Batata — R$ 14,00'], esperandoOTroco: true });
    // A de outro pedido, ou a que já foi aplicada, não aparece.
    expect((visaoDoPedidoFeito(pedido(), 'em produção', { ...m, pedidoId: 'outro' }) as any).mudancaEmConferencia).toBeUndefined();
    expect((visaoDoPedidoFeito(pedido(), 'em produção', { ...m, situacao: 'aplicada' }) as any).mudancaEmConferencia).toBeUndefined();
  });
});
