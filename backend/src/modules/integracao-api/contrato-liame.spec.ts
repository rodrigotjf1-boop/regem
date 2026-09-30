import { telefoneE164 } from '../../common/telefone-e164';
import { canalIntegracao, grupoCanalIntegracao } from './canal-integracao';
import { codificarCursor, lerCursor, lerInstante, lerLimite, vinculoCursor } from './cursor-integracao';
import { errosClienteAnonimizado, errosPagina, errosPedidoRegem } from './contrato-liame.teste-spec';
import { ProblemaException } from './problema';
import { formatarQuantidade, montarFoto, situacaoDaVenda, textoCanonico } from './venda-integracao';
import { custoDoItem } from './vendas-integracao.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

// PEÇAS PURAS da leitura de vendas (trilha C, C1c) — sem banco. O contrato é o do Liame (v1): as
// amostras abaixo são as fixtures dele (`apps/server/test/fixtures/regem/v1/`), copiadas: o
// validador daqui tem de aceitá-las (senão ele seria mais rígido que o Liame e esconderia erro
// de verdade) e recusar o que o zod de lá recusa.

const PED_001 = {
  id: 'ped-001',
  versao: 3,
  atualizado_em: '2026-09-26T23:00:01.412Z',
  canal: 'cardapio',
  grupo_canal: 'cardapio',
  situacao: 'confirmado',
  moeda: 'BRL',
  fuso: 'America/Sao_Paulo',
  receita_centavos: 5990,
  desconto_loja_centavos: 500,
  estornado_centavos: 0,
  cupom: null,
  cliente: { id: 'cli-1', telefone: '(21) 99999-8888', novo: true },
  criado_em: '2026-09-26T22:58:00Z',
  confirmado_em: '2026-09-26T23:00:00Z',
  cancelado_em: null,
  itens: [
    { id: 'it-1', produto_id: 'p-9', nome: 'Burger da casa', quantidade: '2', receita_centavos: 4000, custo_centavos: 1600 },
    { id: 'it-2', produto_id: 'p-3', nome: 'Refrigerante lata', quantidade: '1', receita_centavos: 990, custo_centavos: null },
  ],
  origem: {
    capturado_em: '2026-09-25T20:41:07Z',
    lk: null,
    utm_source: 'meta',
    utm_medium: 'paid',
    utm_campaign: 'Combo sexta',
    utm_content: null,
    utm_term: null,
    campaign_id: '120215566778899',
    adset_id: '120215566770000',
    adgroup_id: null,
    ad_id: '120215566771111',
    gclid: null,
    gbraid: null,
    wbraid: null,
    fbclid: 'IwAR0ped001',
  },
  faturado_em: '2026-09-26T22:58:00Z',
};

const COM_010_REMOVIDO = {
  id: 'com-010',
  versao: 2,
  atualizado_em: '2026-09-27T02:20:00Z',
  canal: 'balcao',
  grupo_canal: 'presencial',
  situacao: 'removido',
  moeda: 'BRL',
  fuso: 'America/Sao_Paulo',
  receita_centavos: 1990,
  desconto_loja_centavos: 0,
  estornado_centavos: 0,
  cupom: null,
  cliente: null,
  criado_em: '2026-09-27T01:05:00Z',
  confirmado_em: '2026-09-27T01:10:00Z',
  faturado_em: '2026-09-27T01:10:00Z',
  cancelado_em: null,
  itens: [{ id: 'it-1', produto_id: 'p-14', nome: 'Água sem gás', quantidade: '2', receita_centavos: 1990, custo_centavos: 500 }],
  origem: null,
};

describe('contrato do Liame (v1) — o validador daqui', () => {
  it('aceita as fixtures do Liame (pedido do cardápio, comanda removida, cliente anonimizado)', () => {
    expect(errosPedidoRegem(PED_001)).toEqual([]);
    expect(errosPedidoRegem(COM_010_REMOVIDO)).toEqual([]);
    expect(
      errosClienteAnonimizado({ id: 'cli-1', anonimizado_em: '2026-09-28T12:00:00Z', versao: 1, atualizado_em: '2026-09-28T12:00:00Z' }),
    ).toEqual([]);
    expect(errosPagina({ itens: [PED_001], proximo_cursor: 'ped-c1', tem_mais: true }, errosPedidoRegem)).toEqual([]);
    // microssegundos e offset também passam (o zod 4 aceita fração de qualquer tamanho)
    expect(errosPedidoRegem({ ...PED_001, atualizado_em: '2026-09-26T23:00:01.412345Z', criado_em: '2026-09-26T19:58:00-03:00' })).toEqual([]);
  });

  it('recusa o que o zod do Liame recusa (e que pararia a leitura da loja inteira)', () => {
    const casos: [string, any][] = [
      ['canal', { ...PED_001, canal: 'open-delivery' }],
      ['receita_centavos', { ...PED_001, receita_centavos: -1 }],
      ['receita_centavos', { ...PED_001, receita_centavos: 10.5 }],
      ['confirmado_em', { ...PED_001, confirmado_em: null }],
      ['cancelado_em', (() => { const x: any = { ...PED_001 }; delete x.cancelado_em; return x; })()],
      ['cupom', (() => { const x: any = { ...PED_001 }; delete x.cupom; return x; })()],
      ['situacao', { ...PED_001, situacao: 'estornado' }],
      ['itens.0.custo_centavos', { ...PED_001, itens: [{ ...PED_001.itens[0], custo_centavos: undefined }] }],
      ['itens.0.quantidade', { ...PED_001, itens: [{ ...PED_001.itens[0], quantidade: '1.0000' }] }],
      ['itens.0.nome', { ...PED_001, itens: [{ ...PED_001.itens[0], nome: '' }] }],
      ['atualizado_em', { ...PED_001, atualizado_em: '2026-09-26 23:00:01' }],
      ['atualizado_em', { ...PED_001, atualizado_em: '2026-09-26T23:00Z' }],
    ];
    for (const [campo, p] of casos) expect(errosPedidoRegem(p)).toContain(campo);
  });
});

describe('telefone em E.164', () => {
  it.each([
    ['21999998888', '+5521999998888'],
    ['(21) 99999-8888', '+5521999998888'],
    ['5521999998888', '+5521999998888'],
    ['+55 21 99999-8888', '+5521999998888'],
    ['005521999998888', '+5521999998888'],
    ['021999998888', '+5521999998888'],
    ['2133334444', '+552133334444'], // fixo (10 dígitos) sai como veio: não inventa o 9
    ['552133334444', '+552133334444'],
    ['55999998888', '+5555999998888'], // DDD 55 (RS), 11 dígitos
  ])('%s → %s', (bruto, esperado) => expect(telefoneE164(bruto)).toBe(esperado));

  it.each([[null], [''], ['123'], ['0021999998888'], ['21899998888'], ['0999998888'], ['1234567890123456']])(
    '%s → null (não dá para ter certeza)',
    (bruto) => expect(telefoneE164(bruto)).toBeNull(),
  );
});

describe('canal e grupo do canal', () => {
  it('canal sai no formato do contrato', () => {
    expect(canalIntegracao('iFood')).toBe('ifood');
    expect(canalIntegracao('open-delivery')).toBe('open_delivery');
    expect(canalIntegracao('  Delivery Direto!! ')).toBe('delivery_direto');
    expect(canalIntegracao('')).toBe('outro');
    expect(canalIntegracao(null)).toBe('outro');
    expect(canalIntegracao('x'.repeat(80))).toHaveLength(40);
  });

  it.each([
    ['cardapio', 'pedido_externo', 'cardapio'],
    ['ifood', 'pedido_externo', 'marketplace'],
    ['99food', 'pedido_externo', 'marketplace'],
    ['keeta', 'pedido_externo', 'marketplace'],
    ['open_delivery', 'pedido_externo', 'marketplace'],
    ['rappi', 'pedido_externo', 'marketplace'],
    ['ubereats', 'pedido_externo', 'marketplace'],
    ['totem', 'pedido_externo', 'presencial'],
    ['gogem', 'pedido_externo', 'presencial'],
    ['anotaai', 'pedido_externo', 'outro'],
    ['cardapio_web', 'pedido_externo', 'outro'],
    ['delivery_direto', 'pedido_externo', 'outro'],
    ['manual', 'pedido_externo', 'outro'],
    ['canal_novo', 'pedido_externo', 'outro'],
    ['balcao', 'comanda', 'presencial'],
    ['mesa', 'comanda', 'presencial'],
    ['totem', 'comanda', 'presencial'],
  ] as const)('%s (%s) → %s', (canal, fonte, grupo) => expect(grupoCanalIntegracao(canal, fonte)).toBe(grupo));
});

describe('cursor opaco', () => {
  const lojaA1 = vinculoCursor('tenant-a', 'loja-a1');
  const pos = { t: '2026-09-29T20:00:01.123456Z', i: '0b4f0c2e-1111-4222-8333-944455556666' };

  it('volta igual e guarda o confirmados_desde', () => {
    const c = codificarCursor('venda', lojaA1, { posicao: pos, desde: '2026-07-01T00:00:00.000Z' });
    expect(c).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(lerCursor(c, 'venda', lojaA1)).toEqual({ posicao: pos, desde: '2026-07-01T00:00:00.000Z' });
    expect(lerCursor(codificarCursor('venda', lojaA1, { posicao: null, desde: null }), 'venda', lojaA1)).toEqual({
      posicao: null,
      desde: null,
    });
  });

  it('de outra loja, de outra rota, adulterado ou lixo → 400 cursor-invalido', () => {
    const c = codificarCursor('venda', lojaA1, { posicao: pos, desde: null });
    const outraLoja = vinculoCursor('tenant-a', 'loja-a2');
    const adulterado = Buffer.from(JSON.stringify({ k: 'venda', l: lojaA1, t: '2026-09-29T20:00:01Z', i: pos.i, d: null })).toString('base64url');
    const semId = Buffer.from(JSON.stringify({ k: 'venda', l: lojaA1, t: pos.t, i: null, d: null })).toString('base64url');
    for (const [texto, rota, vinculo] of [
      [c, 'venda', outraLoja],
      [c, 'cliente', lojaA1],
      [adulterado, 'venda', lojaA1],
      [semId, 'venda', lojaA1],
      ['nao-e-base64-de-json', 'venda', lojaA1],
      ['a'.repeat(1001), 'venda', lojaA1],
      ['', 'venda', lojaA1],
    ] as const) {
      let erro: any = null;
      try {
        lerCursor(texto, rota, vinculo);
      } catch (e) {
        erro = e;
      }
      expect(erro).toBeInstanceOf(ProblemaException);
      expect(erro.getStatus()).toBe(400);
      expect(erro.tipo).toBe('cursor-invalido');
    }
  });

  it('limite e instante: fora do formato → 400 parametro-invalido', () => {
    expect(lerLimite(undefined)).toBe(200);
    expect(lerLimite('500')).toBe(500);
    for (const v of ['0', '501', '-1', 'abc', '10.5', ['1', '2']]) expect(() => lerLimite(v)).toThrow(ProblemaException);
    expect(lerInstante('2026-07-01T00:00:00Z', 'x')).toBe('2026-07-01T00:00:00.000Z');
    expect(lerInstante('2026-07-01T00:00:00-03:00', 'x')).toBe('2026-07-01T03:00:00.000Z');
    for (const v of ['2026-07-01', '2026-07-01T00:00:00', 'ontem', ['2026-07-01T00:00:00Z']]) {
      expect(() => lerInstante(v, 'x')).toThrow(ProblemaException);
    }
  });
});

describe('montagem da venda (foto) e situação', () => {
  const pedido = (x: any = {}) => ({
    fonte: 'pedido_externo',
    id: 'p1',
    status: 'confirmado',
    canal: 'iFood',
    vale: true,
    teve_confirmacao: true,
    receita: '5990',
    desconto: '500',
    cupom: ' combosexta ',
    cliente_id: 'c1',
    cliente_novo: true,
    criado_em: '2026-09-26T22:58:00.000000Z',
    confirmado_em: '2026-09-26T23:00:00.000000Z',
    faturado_em: '2026-09-26T22:58:00.000000Z',
    cancelado_em: null,
    itens: [{ id: 'i1', produto_id: 'p9', nome: 'Burger', quantidade: '2.0000', receita: 4000 }],
    ...x,
  });

  it('pedido: confirmado, cancelado depois de confirmado, e o que não é venda', () => {
    expect(situacaoDaVenda(pedido(), false)).toBe('confirmado');
    expect(situacaoDaVenda(pedido({ vale: false, status: 'cancelado' }), false)).toBe('cancelado');
    expect(situacaoDaVenda(pedido({ vale: false, status: 'novo', teve_confirmacao: false }), false)).toBeNull();
    // cancelado sem nunca confirmar: não sai…
    expect(situacaoDaVenda(pedido({ vale: false, status: 'cancelado', teve_confirmacao: false }), false)).toBeNull();
    // …a não ser que já tenha saído como venda (reflexo do canal sem `confirmado_em`)
    expect(situacaoDaVenda(pedido({ vale: false, status: 'cancelado', teve_confirmacao: false }), true)).toBe('cancelado');
  });

  it('comanda: fechada que não é de canal; cancelada depois de fechar; aberta, falha e de canal não', () => {
    const c = (x: any) => ({ fonte: 'comanda', id: 'c', status: 'fechada', fechou: true, de_canal: false, ...x });
    expect(situacaoDaVenda(c({}), false)).toBe('confirmado');
    expect(situacaoDaVenda(c({ status: 'cancelada' }), false)).toBe('cancelado');
    expect(situacaoDaVenda(c({ status: 'cancelada', fechou: false }), false)).toBeNull();
    expect(situacaoDaVenda(c({ status: 'aberta', fechou: false }), false)).toBeNull();
    expect(situacaoDaVenda(c({ status: 'falha' }), false)).toBeNull();
    expect(situacaoDaVenda(c({ de_canal: true }), false)).toBeNull();
    expect(situacaoDaVenda(undefined, true)).toBeNull();
  });

  it('foto do pedido: canal/grupo do contrato, centavos inteiros, cupom aparado, quantidade com até 3 casas', () => {
    const f = montarFoto(pedido(), 'confirmado');
    expect(f).toMatchObject({
      canal: 'ifood',
      grupo: 'marketplace',
      receita: 5990,
      desconto: 500,
      cupom: 'combosexta',
      cliente: { id: 'c1', novo: true },
      cancelado_em: null,
      itens: [{ id: 'i1', produto_id: 'p9', nome: 'Burger', quantidade: '2', receita: 4000 }],
    });
    expect(montarFoto(pedido({ status: 'cancelado', cancelado_em: '2026-09-27T01:00:00.000000Z' }), 'cancelado').cancelado_em).toBe(
      '2026-09-27T01:00:00.000000Z',
    );
  });

  it('cupom da plataforma de pedidos da loja (Anota AI, CardápioWeb) vai para o Liame; o de marketplace não', () => {
    const cupom = (canal: string, descontos: any[], proprio: string | null = null) =>
      montarFoto(pedido({ canal, cupom: proprio, descontos_canal: descontos }), 'confirmado').cupom;
    // Anota AI: a etiqueta do desconto é o próprio código
    expect(cupom('anotaai', [{ origem: 'cupom', rotulo: 'SEXTA10', valor: 5, quemBanca: 'loja' }])).toBe('SEXTA10');
    // CardápioWeb: o código vem em `campanha` (coupon_code); o rótulo é o nome do cupom
    expect(cupom('cardapio_web', [{ origem: 'cupom', rotulo: 'Cupom de sexta', campanha: 'SEXTA10', valor: 5, quemBanca: 'loja' }])).toBe('SEXTA10');
    // o primeiro desconto de cupom com cara de código; fidelidade e promoção não contam
    expect(
      cupom('anotaai', [
        { origem: 'fidelidade', rotulo: 'FIDELIDADE10', valor: 3 },
        { origem: 'cupom', rotulo: 'Cupom de desconto', valor: 2 },
        { origem: 'cupom', rotulo: 'NATAL10', valor: 4 },
      ]),
    ).toBe('NATAL10');
    // marketplace: a "campanha" é promoção da plataforma, não cupom da loja
    expect(cupom('ifood', [{ origem: 'cupom', rotulo: 'FD_DESPIT_27D7135', valor: 10, quemBanca: 'marketplace' }])).toBeNull();
    expect(cupom('99food', [{ origem: 'cupom', rotulo: 'NINE10', valor: 10 }])).toBeNull();
    // o cupom do próprio pedido (cardápio do Regem) vem primeiro; sem nada, nulo
    expect(cupom('cardapio', [{ origem: 'cupom', rotulo: 'OUTRO' }], 'COMBOSEXTA')).toBe('COMBOSEXTA');
    expect(cupom('anotaai', [])).toBeNull();
    expect(cupom('anotaai', null as any)).toBeNull();
    expect(cupom('anotaai', [{ origem: 'cupom', rotulo: 'x'.repeat(61) }])).toBeNull();
  });

  it('foto da comanda: mesa, totem (chave do aparelho sem operador) e balcão; negativo sai 0 com aviso', () => {
    const base = { fonte: 'comanda', id: 'c', status: 'fechada', receita: '1000', criado_em: 'a', confirmado_em: 'b', itens: [] };
    expect(montarFoto({ ...base, tem_mesa: true }, 'confirmado').canal).toBe('mesa');
    expect(montarFoto({ ...base, idempotency_key: 'k1', aberta_por_id: null }, 'confirmado').canal).toBe('totem');
    expect(montarFoto({ ...base, idempotency_key: 'k1', aberta_por_id: 'op' }, 'confirmado').canal).toBe('balcao');
    const avisos: string[] = [];
    const f = montarFoto({ ...base, receita: '-50', itens: [{ id: 'x', nome: '', quantidade: '-1', receita: -3 }] }, 'confirmado', (m) =>
      avisos.push(m),
    );
    expect(f).toMatchObject({ receita: 0, grupo: 'presencial', cupom: null, cliente: null, faturado_em: 'b' });
    expect(f.itens[0]).toEqual({ id: 'x', produto_id: null, nome: 'Item', quantidade: '0', receita: 0 });
    expect(avisos.length).toBe(2);
  });

  it('quantidade e custo do item', () => {
    expect(formatarQuantidade('2.0000')).toBe('2');
    expect(formatarQuantidade('0.3504')).toBe('0.35');
    expect(formatarQuantidade('10')).toBe('10');
    expect(formatarQuantidade('100.5')).toBe('100.5');
    expect(formatarQuantidade('abc')).toBe('0');
    expect(custoDoItem({ p: 8.25 }, 'p', '2')).toBe(1650);
    expect(custoDoItem({ p: 8.25 }, 'q', '2')).toBeNull();
    expect(custoDoItem({ p: 8.25 }, null, '2')).toBeNull();
    expect(custoDoItem(null, 'p', '2')).toBeNull();
    expect(custoDoItem({ p: -1 }, 'p', '2')).toBeNull();
    expect(custoDoItem({ p: 1 }, '__proto__', '1')).toBeNull();
  });

  it('texto canônico não depende da ordem das chaves (o jsonb reordena)', () => {
    expect(textoCanonico({ b: 1, a: [{ y: 2, x: null }] })).toBe(textoCanonico({ a: [{ x: null, y: 2 }], b: 1 }));
    expect(textoCanonico({ a: 1 })).not.toBe(textoCanonico({ a: 2 }));
  });
});
