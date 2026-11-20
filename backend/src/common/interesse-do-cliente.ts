import { sql, type SQL } from 'drizzle-orm';

// O INTERESSE DO CLIENTE NO CARDÁPIO (F4b do docs/plano-perfil-cliente.md, §4.3; protótipo, camada 3 "O que olha no
// cardápio" e o público "Pelo que olharam no cardápio"). Lê os cliques LIGADOS ao cliente (`cardapio_interacao.cliente_id`,
// mig 466) — que só existem para quem entrou com o código do WhatsApp e não desligou as "Recomendações" (ligadas por padrão — D16). Uma régua
// só para a ficha, a aba de Clientes, a campanha e a contagem (V74).

/** Os pontos: abrir vale 1, ficar 10 s ou mais vale 2, pôr no carrinho vale 4, com meia-vida de 14 dias. "Viu e não
 *  pediu": abriu o MESMO produto 2 vezes ou mais nos últimos 30 dias e não pediu direto esse produto desde a primeira. */
export const INTERESSE = { meiaVidaDias: 14, abrir: 1, abrirLongo: 2, longoMs: 10_000, carrinho: 4, viuVezes: 2, viuJanelaDias: 30 } as const;

/** Os pontos de UM clique (alias da `cardapio_interacao` dado), já com a meia-vida — some com `sum(...)`. */
export function sqlPontosDoClique(i: string): SQL {
  const a = sql.raw(i);
  return sql`(power(2, -extract(epoch from (now() - ${a}.em)) / 86400.0 / ${INTERESSE.meiaVidaDias}::numeric)
    * case when ${a}.tipo = 'produto_adicionado' then ${INTERESSE.carrinho}::int
           when coalesce(${a}.ms, 0) >= ${INTERESSE.longoMs}::int then ${INTERESSE.abrirLongo}::int
           else ${INTERESSE.abrir}::int end)`;
}

/** Não fez pedido direto (sem iFood e 99, sem cancelado) com o produto desde o instante dado. */
export function sqlNaoPediuDesde(tenant: SQL, cliente: SQL, produto: SQL, desde: SQL): SQL {
  return sql`not exists (
    select 1 from pedido_externo p
     cross join lateral jsonb_array_elements(case when jsonb_typeof(p.itens) = 'array' then p.itens else '[]'::jsonb end) it
     where p.tenant_id = ${tenant} and p.cliente_id = ${cliente} and p.status <> 'cancelado'
       and coalesce(p.canal, '') not in ('ifood', '99food')
       and p.criado_em >= ${desde} and it ->> 'produtoId' = (${produto})::text)`;
}

/** O cliente (alias `c`) viu e não pediu algum produto — a condição da aba "Olharam e não pediram". */
export function sqlOlhouENaoPediu(): SQL {
  return sql`exists (
    select 1 from cardapio_interacao i
     where i.cliente_id = c.id and i.tenant_id = c.tenant_id and i.tipo = 'produto_aberto' and i.produto_id is not null
       and i.em > now() - make_interval(days => ${INTERESSE.viuJanelaDias}::int)
     group by i.produto_id
    having count(*) >= ${INTERESSE.viuVezes}::int
       and ${sqlNaoPediuDesde(sql`c.tenant_id`, sql`c.id`, sql`i.produto_id`, sql`min(i.em)`)})`;
}
