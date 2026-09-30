import { sql, SQL } from 'drizzle-orm';
import {
  comandaEhDeCanal,
  descontoLojaProduto,
  faturamentoComanda,
  faturamentoPedido,
  pedidoVale,
} from '../../common/faturamento';
import { ehVendaDoTotem } from '../gogem/aviso-gogem';
import { canalIntegracao, grupoCanalIntegracao, GrupoCanal } from './canal-integracao';

/* eslint-disable @typescript-eslint/no-explicit-any */

// A VENDA como a API de integração devolve (contrato Regem → Liame v1, `GET /pedidos`).
//
// Uma venda é UMA de duas fontes, pela regra do faturamento do Painel (`common/faturamento.ts`),
// chamada aqui — nunca copiada, para a regra nova de lá valer aqui sozinha:
//   • `pedido_externo` (qualquer canal) — o id do pedido;
//   • `comanda` que NÃO é de canal (`comandaEhDeCanal`): balcão, mesa, totem direto.
// Receita = `faturamentoPedido` / `faturamentoComanda` em centavos, o "Faturamento" do Painel ao
// centavo; o dia da venda (`faturado_em`) é o instante que o Painel usa (pedido: criação;
// comanda: fechamento).
//
// A montagem roda no CARIMBADOR (poucas vendas por vez, em conjunto — uma consulta por fonte,
// nunca uma por venda) e vira a FOTO guardada em `integracao_versao`: a leitura da API devolve a
// foto, então quem lê a versão N vê exatamente o que foi publicado como N. Ficam FORA da foto o
// custo (o vigente na leitura, decisão do dono) e o telefone (dado pessoal: lido na hora do
// cadastro — cliente excluído não deixa telefone guardado aqui). A ORIGEM do pedido do cardápio
// (mig 299) também é lida na hora — os códigos de clique somem aos 90 dias e não podem ficar
// guardados na foto; a foto leva só `origem_em` (quando o cliente chegou pelo link), que muda a
// foto quando a origem é gravada e dá versão nova à venda.

export type Situacao = 'confirmado' | 'cancelado' | 'removido';
export type FonteVenda = 'pedido_externo' | 'comanda';

export type ItemFoto = { id: string; produto_id: string | null; nome: string; quantidade: string; receita: number };

export type FotoVenda = {
  fonte: FonteVenda;
  canal: string;
  grupo: GrupoCanal;
  receita: number;
  desconto: number;
  cupom: string | null;
  cliente: { id: string; novo: boolean | null } | null;
  criado_em: string | null;
  confirmado_em: string;
  faturado_em: string | null;
  cancelado_em: string | null;
  itens: ItemFoto[];
  /** Pedido do cardápio com origem gravada (mig 299). Ausente — não `null` — sem origem: as fotos
   *  publicadas antes da 299 continuam iguais e não geram versão nova. */
  origem_em?: string;
};

/** Teto de itens por venda (o do contrato). */
export const MAX_ITENS_VENDA = 1000;

/** Instante em texto ISO 8601 UTC com microssegundos (nulo continua nulo). */
export function sqlIso(expr: SQL): SQL {
  return sql`to_char((${expr}) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
}

function lista(ids: string[]): SQL {
  return sql.join(
    ids.map((id) => sql`${id}::uuid`),
    sql`, `,
  );
}

/** Itens da comanda `comanda` (expressão SQL do id), na ordem em que entraram. */
function sqlItensDaComanda(comanda: SQL, tenant: SQL): SQL {
  return sql`(select jsonb_agg(jsonb_build_object(
                       'id', ci.id::text,
                       'produto_id', ci.produto_id::text,
                       'nome', ci.descricao,
                       'quantidade', ci.quantidade::text,
                       'receita', round(ci.quantidade * ci.preco_unitario * 100))
                     order by ci.created_at, ci.id)
                from comanda_item ci
               where ci.comanda_id = ${comanda} and ci.tenant_id = ${tenant})`;
}

// Número dentro do JSON do pedido, à prova de valor estranho (texto, vazio): vira 0 em vez de
// derrubar a montagem do lote inteiro. Sem barra invertida no SQL (V27): `[.]` no lugar de `\.`.
export function numeroJson(campo: SQL): SQL {
  return sql`(case when (${campo}) ~ '^-?[0-9]+([.][0-9]+)?$' then (${campo})::numeric else 0 end)`;
}

/** Itens de `pedido_externo.itens` (pedido ainda sem comanda): id `pedido:<posição>`. */
const sqlItensDoPedido = (): SQL => sql`(select jsonb_agg(jsonb_build_object(
          'id', 'pedido:' || (o.n - 1)::text,
          'produto_id', nullif(btrim(o.x->>'produtoId'), ''),
          'nome', coalesce(nullif(btrim(o.x->>'descricao'), ''), nullif(btrim(o.x->>'nome'), '')),
          'quantidade', ${numeroJson(sql`o.x->>'quantidade'`)}::text,
          'receita', round(${numeroJson(sql`o.x->>'quantidade'`)} * ${numeroJson(sql`o.x->>'precoUnitario'`)} * 100))
        order by o.n)
   from jsonb_array_elements(case when jsonb_typeof(pe.itens) = 'array' then pe.itens else '[]'::jsonb end)
        with ordinality as o(x, n))`;

/**
 * As vendas de PEDIDO (uma linha por pedido). `novo` = nenhum pedido que conta como venda antes
 * deste, do mesmo cliente, na loja (empresa de loja única: na empresa — os pedidos do cardápio
 * da rede caem sem loja); cliente importado com pedidos no outro sistema nunca é novo.
 */
export function sqlVendasDePedidos(ids: string[]): SQL {
  return sql`
    select 'pedido_externo' as fonte, pe.id::text as id, pe.tenant_id::text as tenant_id,
           pe.unidade_id::text as unidade_id, pe.status, pe.canal,
           (${pedidoVale('pe')}) as vale,
           (pe.confirmado_em is not null) as teve_confirmacao,
           round((${faturamentoPedido('pe')}) * 100)::text as receita,
           round((${descontoLojaProduto('pe')}) * 100)::text as desconto,
           nullif(btrim(pe.cupom), '') as cupom,
           pe.cliente_id::text as cliente_id,
           case
             when pe.cliente_id is null then null
             when coalesce(case when (cl.importacao->>'pedidos') ~ '^[0-9]+$'
                                then (cl.importacao->>'pedidos')::bigint end, 0) > 0 then false
             else not exists (
               select 1 from pedido_externo p2
                where p2.tenant_id = pe.tenant_id and p2.cliente_id = pe.cliente_id and p2.id <> pe.id
                  and ${pedidoVale('p2')}
                  and (p2.criado_em < pe.criado_em or (p2.criado_em = pe.criado_em and p2.id < pe.id))
                  and (lu.unica or p2.unidade_id is not distinct from pe.unidade_id))
           end as cliente_novo,
           ${sqlIso(sql`pe.criado_em`)} as criado_em,
           ${sqlIso(sql`coalesce(pe.confirmado_em,
                                  least(pe.pronto_em, pe.despachado_em, pe.entregue_em, pe.concluido_em),
                                  pe.criado_em)`)} as confirmado_em,
           ${sqlIso(sql`pe.criado_em`)} as faturado_em,
           ${sqlIso(sql`pe.cancelado_em`)} as cancelado_em,
           coalesce(case when pe.comanda_id is not null
                         then ${sqlItensDaComanda(sql`pe.comanda_id`, sql`pe.tenant_id`)} end,
                    ${sqlItensDoPedido()},
                    '[]'::jsonb) as itens,
           ${sqlIso(sql`po.capturado_em`)} as origem_em
      from pedido_externo pe
      left join cliente cl on cl.id = pe.cliente_id and cl.tenant_id = pe.tenant_id
      left join pedido_origem po on po.pedido_id = pe.id and po.tenant_id = pe.tenant_id
      cross join lateral (
        select count(*) <= 1 as unica from unidade u where u.tenant_id = pe.tenant_id and u.deleted_at is null
      ) lu
     where pe.id in (${lista(ids)})`;
}

/** As vendas de COMANDA (uma linha por comanda). `de_canal` decide se ela é venda própria. */
export function sqlVendasDeComandas(ids: string[]): SQL {
  return sql`
    select 'comanda' as fonte, c.id::text as id, c.tenant_id::text as tenant_id,
           c.unidade_id::text as unidade_id, c.status,
           (c.mesa_id is not null) as tem_mesa, c.idempotency_key, c.aberta_por_id::text as aberta_por_id,
           (c.fechada_em is not null) as fechou,
           (${comandaEhDeCanal('c')}) as de_canal,
           round((${faturamentoComanda('c')}) * 100)::text as receita,
           ${sqlIso(sql`c.aberta_em`)} as criado_em,
           ${sqlIso(sql`c.fechada_em`)} as confirmado_em,
           ${sqlIso(sql`c.fechada_em`)} as faturado_em,
           ${sqlIso(sql`c.cancelada_em`)} as cancelado_em,
           coalesce(${sqlItensDaComanda(sql`c.id`, sql`c.tenant_id`)}, '[]'::jsonb) as itens
      from comanda c
     where c.id in (${lista(ids)})`;
}

/**
 * A venda existe hoje, e como? (`null` = não é venda: pedido `novo`, cancelado sem nunca ter
 * sido confirmado, comanda aberta/falha/de canal.) `publicadaComoVenda` = já saiu como
 * confirmada ou cancelada: o pedido que confirmou sem `confirmado_em` (reflexo do canal) e depois
 * foi cancelado sai como `cancelado`, não some.
 */
export function situacaoDaVenda(l: any, publicadaComoVenda: boolean): 'confirmado' | 'cancelado' | null {
  if (!l) return null;
  if (l.fonte === 'pedido_externo') {
    if (l.vale) return 'confirmado';
    if (l.status === 'cancelado' && (l.teve_confirmacao || publicadaComoVenda)) return 'cancelado';
    return null;
  }
  if (l.de_canal) return null;
  if (l.status === 'fechada') return 'confirmado';
  if (l.status === 'cancelada' && l.fechou) return 'cancelado';
  return null;
}

/** Quantidade no formato do contrato (`^\d{1,10}(\.\d{1,3})?$`): até 3 casas, sem zeros à toa. */
export function formatarQuantidade(v: unknown): string {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return '0';
  return Math.min(n, 9_999_999_999).toFixed(3).replace(/\.?0+$/, '');
}

/** Centavos inteiros e não negativos (o contrato não aceita negativo). */
function centavos(v: unknown, aviso: (m: string) => void, onde: string): number {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return 0;
  if (n < 0) {
    aviso(`${onde}: valor negativo (${n}) saiu como 0`);
    return 0;
  }
  return n;
}

/** A foto da venda publicada, no formato que a API devolve (canal e grupo já decididos). */
export function montarFoto(l: any, situacao: Situacao, aviso: (m: string) => void = () => undefined): FotoVenda {
  const fonte: FonteVenda = l.fonte;
  const canalBruto =
    fonte === 'comanda'
      ? l.tem_mesa
        ? 'mesa'
        : ehVendaDoTotem({ idempotencyKey: l.idempotency_key, abertaPorId: l.aberta_por_id })
          ? 'totem'
          : 'balcao'
      : l.canal;
  const canal = canalIntegracao(canalBruto);
  const itens: any[] = Array.isArray(l.itens) ? l.itens : [];
  if (itens.length > MAX_ITENS_VENDA) aviso(`venda ${l.id}: ${itens.length} itens — saem os ${MAX_ITENS_VENDA} primeiros`);
  const confirmado = l.confirmado_em ?? l.criado_em ?? new Date().toISOString();
  return {
    fonte,
    canal,
    grupo: grupoCanalIntegracao(canal, fonte),
    receita: centavos(l.receita, aviso, `venda ${l.id}`),
    desconto: fonte === 'comanda' ? 0 : centavos(l.desconto, aviso, `desconto da venda ${l.id}`),
    cupom: fonte === 'comanda' || !l.cupom ? null : String(l.cupom).trim().slice(0, 60) || null,
    cliente:
      fonte === 'pedido_externo' && l.cliente_id
        ? { id: String(l.cliente_id), novo: l.cliente_novo === null || l.cliente_novo === undefined ? null : !!l.cliente_novo }
        : null,
    criado_em: l.criado_em ?? null,
    confirmado_em: confirmado,
    faturado_em: fonte === 'comanda' ? confirmado : (l.faturado_em ?? l.criado_em ?? null),
    cancelado_em: situacao === 'cancelado' ? (l.cancelado_em ?? null) : null,
    itens: itens.slice(0, MAX_ITENS_VENDA).map((it: any, i: number) => ({
      id: String(it?.id ?? `item:${i}`).slice(0, 100),
      produto_id: it?.produto_id ? String(it.produto_id).slice(0, 100) : null,
      nome: String(it?.nome ?? '').trim().slice(0, 300) || 'Item',
      quantidade: formatarQuantidade(it?.quantidade),
      receita: centavos(it?.receita, aviso, `item ${it?.id ?? i} da venda ${l.id}`),
    })),
    ...(fonte === 'pedido_externo' && l.origem_em ? { origem_em: String(l.origem_em) } : {}),
  };
}

/** JSON com as chaves em ordem: duas fotos iguais dão o mesmo texto (o `jsonb` reordena). */
export function textoCanonico(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(textoCanonico).join(',')}]`;
  if (v && typeof v === 'object') {
    return `{${Object.keys(v as any)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${textoCanonico((v as any)[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(v ?? null);
}
