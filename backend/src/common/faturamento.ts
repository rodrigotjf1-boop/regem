import { sql, SQL } from 'drizzle-orm';

/**
 * FATURAMENTO — definição única do Regem.
 *
 * Decidida pelo dono: *"faturamento por definição é o total de venda de produtos ou
 * serviços; as taxas que são serviços devem integrar o faturamento"* — e, na sequência,
 * *"gorjeta não entra no faturamento"*.
 *
 *   ENTRA .... produto vendido
 *              taxa de entrega QUANDO é da loja (a loja configurou e é dona do valor)
 *              taxas de serviço cobradas no pedido (serviço prestado)
 *   NÃO ENTRA  gorjeta / taxa de serviço do garçom — é repasse ao funcionário,
 *              não receita da empresa (Lei 13.419/2017). O dinheiro passa pelo caixa,
 *              mas não é faturamento.
 *              taxa da plataforma — é receita dela.
 *   REDUZ .... só o desconto bancado pela LOJA. O bancado pelo MARKETPLACE não reduz:
 *              o cliente pagou menos, mas a loja recebe cheio no repasse semanal.
 *
 * Este arquivo é a ÚNICA fonte dessas fórmulas. Relatórios, dashboard e Visão C&O
 * importam daqui — foi a divergência entre cópias da mesma conta que fez o mesmo dia
 * aparecer com três faturamentos diferentes.
 */

// Alias de tabela é constante do nosso código (nunca entrada de usuário), mas validar
// mantém `sql.raw` honesto: qualquer coisa fora de [a-z_] vira erro no boot, não SQL.
function alias(a: string): SQL {
  if (!/^[a-z_][a-z0-9_]*$/.test(a)) throw new Error(`alias SQL inválido: ${a}`);
  return sql.raw(a);
}

// Tipos de taxa que são GORJETA. Cobre os códigos crus dos 5 canais: 'TIP' (iFood,
// Open Delivery), 'total_tip_money' (99food), 'waiter_tip' (Anota Aí) e os em pt-BR.
// Ancorado em `_`/início/fim para não pegar 'meal_top_up_price' e afins por acidente.
const RE_GORJETA = String.raw`(^|_)tips?(_|$)|gorjeta`;

// `jsonb_array_elements` LANÇA ERRO se o valor não for array — e uma única linha
// malformada (payload de canal que mudou de forma, gravação manual) derrubaria o
// relatório de dinheiro inteiro com 500. Aqui a linha estranha vira lista vazia:
// o pedido perde o detalhe, mas o relatório continua de pé para todos os outros.
function comoArray(expr: SQL): SQL {
  return sql`(case when jsonb_typeof(${expr}) = 'array' then ${expr} else '[]'::jsonb end)`;
}

/** Soma das taxas extras do pedido que são gorjeta (repasse ao funcionário). */
export function gorjetaPedido(a = 'pe'): SQL {
  const t = alias(a);
  return sql`coalesce((select sum((x->>'valor')::numeric)
                         from jsonb_array_elements(${comoArray(sql`${t}.taxas_extras_detalhe`)}) x
                        where x->>'tipo' ~* ${RE_GORJETA}), 0)`;
}

/** Soma das taxas extras que NÃO são gorjeta — serviço cobrado no pedido. */
export function taxasServicoPedido(a = 'pe'): SQL {
  const t = alias(a);
  return sql`coalesce((select sum((x->>'valor')::numeric)
                         from jsonb_array_elements(${comoArray(sql`${t}.taxas_extras_detalhe`)}) x
                        where x->>'tipo' !~* ${RE_GORJETA}), 0)`;
}

/**
 * Desconto bancado pela LOJA que incide sobre PRODUTO.
 *
 * Exclui o desconto com alvo DELIVERY_FEE de propósito: `taxa_entrega` já chega
 * LÍQUIDA do desconto de entrega em pelo menos um canal — o 99food grava
 * `price.delivery_price`, que é a taxa DEPOIS da promoção. Subtrair o desconto de
 * frete por cima tirava o mesmo dinheiro duas vezes (era a diferença de R$ 1.090,50
 * que aparecia na conferência do 99food). Pedido sem detalhe (anterior à mig 241)
 * cai no `desconto_loja` agregado.
 */
export function descontoLojaProduto(a = 'pe'): SQL {
  const t = alias(a);
  return sql`case when ${t}.descontos is null then coalesce(${t}.desconto_loja, 0)
                  else coalesce((select sum((d->>'valor')::numeric)
                                   from jsonb_array_elements(${comoArray(sql`${t}.descontos`)}) d
                                  where coalesce(d->>'quemBanca','indefinido') <> 'marketplace'
                                    and coalesce(d->>'alvo','') <> 'DELIVERY_FEE'), 0)
             end`;
}

/** Desconto da loja que caiu no frete — separado só para relatório (não reduz faturamento). */
export function descontoLojaFrete(a = 'pe'): SQL {
  const t = alias(a);
  return sql`coalesce((select sum((d->>'valor')::numeric)
                         from jsonb_array_elements(${comoArray(sql`${t}.descontos`)}) d
                        where coalesce(d->>'quemBanca','indefinido') <> 'marketplace'
                          and coalesce(d->>'alvo','') = 'DELIVERY_FEE'), 0)`;
}

/** Venda de produto a preço cheio. Cai no `total` antigo enquanto o pedido não tem detalhe. */
export function brutoPedido(a = 'pe'): SQL {
  const t = alias(a);
  return sql`coalesce(${t}.valor_bruto, ${t}.total, 0)`;
}

/** Taxa de entrega que é RECEITA da loja (a loja é dona do valor). */
export function taxaEntregaLoja(a = 'pe'): SQL {
  const t = alias(a);
  return sql`case when ${t}.taxa_entrega_dono = 'loja'
                  then coalesce(${t}.taxa_entrega, 0) else 0 end`;
}

/** Taxa de entrega que é do TERCEIRO (logística do marketplace) — nunca receita da loja. */
export function taxaEntregaTerceiro(a = 'pe'): SQL {
  const t = alias(a);
  return sql`case when ${t}.taxa_entrega_dono is distinct from 'loja'
                  then coalesce(${t}.taxa_entrega, 0) else 0 end`;
}

/** FATURAMENTO de um pedido de canal (delivery / marketplace / cardápio). */
export function faturamentoPedido(a = 'pe'): SQL {
  return sql`(${brutoPedido(a)} - ${descontoLojaProduto(a)} + ${taxaEntregaLoja(a)} + ${taxasServicoPedido(a)})`;
}

/**
 * O pedido já tem a decomposição da mig 241? Serve para o relatório dizer QUANTO do
 * número veio decomposto e quanto ainda é o `total` cru — em vez de misturar as duas
 * bases em silêncio.
 */
export function pedidoDetalhado(a = 'pe'): SQL {
  const t = alias(a);
  return sql`(${t}.valor_bruto is not null)`;
}

/** Pedidos que contam como venda: exclui o que ainda não foi aceito e o cancelado. */
export function pedidoVale(a = 'pe'): SQL {
  const t = alias(a);
  return sql`${t}.status not in ('novo','cancelado')`;
}

// ===================== COMANDA (balcão / salão / PDV) =====================
//
// ATENÇÃO: `comanda.total` é gravado como `subtotal * (1 + taxa_servico_pct/100)` —
// ou seja, JÁ INCLUI a taxa de serviço do garçom. Todo relatório que somava
// `comanda.total` como faturamento estava contando a gorjeta como receita da empresa.
// O caixa continua recebendo o valor cheio (o dinheiro entra mesmo na gaveta); o que
// muda é só o que se chama de faturamento.

/** Divisor da taxa de serviço, à prova de pct absurdo (nunca divide por zero). */
function divisorServico(a: string): SQL {
  const t = alias(a);
  return sql`coalesce(nullif(1 + coalesce(${t}.taxa_servico_pct, 0) / 100.0, 0), 1)`;
}

/** FATURAMENTO de uma comanda: o total SEM a taxa de serviço. */
export function faturamentoComanda(a = 'c'): SQL {
  const t = alias(a);
  return sql`round(coalesce(${t}.total, 0) / ${divisorServico(a)}, 2)`;
}

/** Gorjeta (taxa de serviço) embutida no total da comanda — repasse, não receita. */
export function gorjetaComanda(a = 'c'): SQL {
  const t = alias(a);
  return sql`round(coalesce(${t}.total, 0) - coalesce(${t}.total, 0) / ${divisorServico(a)}, 2)`;
}

/** A comanda veio de um pedido de canal? Evita contar o mesmo dinheiro nos dois lados. */
export function comandaEhDeCanal(a = 'c'): SQL {
  const t = alias(a);
  return sql`exists (select 1 from pedido_externo pex
                      where pex.comanda_id = ${t}.id and ${pedidoVale('pex')})`;
}
