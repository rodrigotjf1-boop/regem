import { sql } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import {
  brutoPedido, comandaEhDeCanal, descontoLojaFrete, descontoLojaProduto,
  faturamentoComanda, faturamentoPedido, gorjetaComanda, gorjetaPedido,
  pedidoDetalhado, pedidoVale, taxaEntregaLoja, taxaEntregaTerceiro, taxasServicoPedido,
} from './faturamento';

// Guarda de regressão da DEFINIÇÃO de faturamento. Os números em si foram conferidos
// contra o banco; o que estes testes impedem é alguém reintroduzir a gorjeta na
// receita, ou o desconto de frete na conta de produto, numa edição distraída.
const dialect = new PgDialect();
const render = (q: any) => dialect.sqlToQuery(sql`select ${q}`).sql;

describe('faturamento — fórmulas compartilhadas', () => {
  it('faturamento do pedido NÃO soma gorjeta', () => {
    const f = render(faturamentoPedido('pe'));
    // A fórmula usa taxasServicoPedido (!~*), nunca gorjetaPedido (~*).
    expect(f).toContain('!~*');
    expect(f.match(/\s~\*/g)).toBeNull();
  });

  it('faturamento do pedido = bruto − desconto de produto + entrega da loja + serviço', () => {
    const f = render(faturamentoPedido('pe'));
    expect(f).toContain('valor_bruto');
    expect(f).toContain('taxa_entrega_dono');
    expect(f).toContain('taxas_extras_detalhe');
    expect(f).toContain('DELIVERY_FEE'); // via descontoLojaProduto, que o exclui
  });

  it('desconto da loja em PRODUTO exclui o alvo DELIVERY_FEE e o marketplace', () => {
    const d = render(descontoLojaProduto('pe'));
    expect(d).toContain(`coalesce(d->>'alvo','') <> 'DELIVERY_FEE'`);
    expect(d).toContain(`coalesce(d->>'quemBanca','indefinido') <> 'marketplace'`);
  });

  it('desconto da loja em FRETE pega só o alvo DELIVERY_FEE', () => {
    expect(render(descontoLojaFrete('pe'))).toContain(`coalesce(d->>'alvo','') = 'DELIVERY_FEE'`);
  });

  it('faturamento da comanda tira a taxa de serviço e nunca divide por zero', () => {
    const f = render(faturamentoComanda('c'));
    expect(f).toContain('taxa_servico_pct');
    expect(f).toContain('nullif'); // guarda contra pct = -100
  });

  it('entrega da loja e de terceiro são complementares (nenhuma taxa fica de fora nem conta duas vezes)', () => {
    expect(render(taxaEntregaLoja('pe'))).toContain(`= 'loja'`);
    expect(render(taxaEntregaTerceiro('pe'))).toContain(`is distinct from 'loja'`);
  });

  it('bruto cai no total antigo quando o pedido não tem detalhe (não zera a série)', () => {
    expect(render(brutoPedido('pe'))).toContain('coalesce(pe.valor_bruto, pe.total, 0)');
  });

  it('pedido só conta como venda fora de novo/cancelado', () => {
    expect(render(pedidoVale('pe'))).toContain(`not in ('novo','cancelado')`);
  });

  it('marca de "detalhado" é a presença de valor_bruto', () => {
    expect(render(pedidoDetalhado('pe'))).toContain('valor_bruto is not null');
  });

  it('a comanda de canal é detectada pelo vínculo com pedido_externo', () => {
    const c = render(comandaEhDeCanal('c'));
    expect(c).toContain('pedido_externo pex');
    expect(c).toContain('pex.comanda_id');
  });

  it('alias inválido explode no boot, não vira SQL', () => {
    expect(() => faturamentoComanda('c; drop table comanda --')).toThrow(/alias SQL inválido/);
    expect(() => gorjetaPedido('PE')).toThrow(/alias SQL inválido/);
  });
});

// A classificação de gorjeta é um regex aplicado ao CÓDIGO CRU da taxa em cada canal.
// Um falso positivo transforma receita em repasse; um falso negativo faz o contrário.
describe('classificação de gorjeta por tipo de taxa', () => {
  const RE = /(^|_)tips?(_|$)|gorjeta/i;
  const ehGorjeta = (tipo: string) => RE.test(tipo);

  it.each([
    'TIP',                 // iFood / Open Delivery
    'total_tip_money',     // 99food
    'waiter_tip',          // Anota Aí
    'tips',
    'gorjeta',
    'GORJETA_GARCOM',
  ])('“%s” é gorjeta', (tipo) => expect(ehGorjeta(tipo)).toBe(true));

  it.each([
    'service_price',           // 99food — taxa de serviço
    'service_fee',             // Cardápio Web
    'small_order_price',       // taxa de pedido mínimo
    'meal_top_up_price',       // complemento de pedido mínimo (contém "top", não "tip")
    'payment_fee',
    'additional_fee',
    'ifood_additional_fees',
    'DELIVERY_FEE',
    'multiple',                // continha "tip" em substring? não — guarda de sanidade
    'participation_fee',
  ])('“%s” NÃO é gorjeta', (tipo) => expect(ehGorjeta(tipo)).toBe(false));
});
