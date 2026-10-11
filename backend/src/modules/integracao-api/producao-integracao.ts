/* eslint-disable @typescript-eslint/no-explicit-any */

// A FILA DE PRODUÇÃO para a API de integração (Farol — contrato em docs/integracao-farol.md): as
// peças sem banco. O serviço lê as tabelas em conjunto e entrega as linhas; aqui elas viram o
// RETRATO que a rota devolve (a versão dele sai de `versaoDoRetrato`, como no catálogo).
//
// O QUE SAI: o que a cozinha vê — o pedido com a etapa e os horários, e cada item com o produto, a
// variação, as escolhas (adicionais e retiradas) e a observação.
//
// O QUE NÃO SAI, POR CONSTRUÇÃO: quem é o cliente (nome, telefone, CPF), a mesa, a senha de
// retirada, o motivo do cancelamento (texto livre de quem cancelou) e qualquer valor — nenhuma
// consulta do serviço seleciona `preco_unitario`, `preco_delta` nem toca a `comanda`. O teste
// `integracao-farol.http.spec` varre a resposta atrás de nome e de valor de dinheiro (ERR-166).

/** Pedido em produção (recebido ou em preparo): sai enquanto tiver até este tempo de criado. */
export const HORAS_DOS_ABERTOS = 24;
/** Pedido concluído (pronto ou entregue) ou cancelado: sai por este tempo depois de concluído. */
export const HORAS_DOS_CONCLUIDOS = 2;

export type RetratoProducao = {
  loja_id: string | null;
  pedidos: any[];
};

const iso = (v: unknown): string | null => (v == null ? null : new Date(v as any).toISOString());

function agrupar<T extends Record<string, any>>(linhas: T[], chave: string): Map<string, T[]> {
  const mapa = new Map<string, T[]>();
  for (const l of linhas) {
    const lista = mapa.get(l[chave]);
    if (lista) lista.push(l);
    else mapa.set(l[chave], [l]);
  }
  return mapa;
}

/**
 * O que a escolha ACRESCENTOU ao lanche, como ficou gravado NA VENDA (o cadastro pode ter mudado
 * depois): o insumo e quanto dele saiu por escolha, na unidade do estoque; a ficha, quando a opção
 * é um preparo; ou o produto (a bebida do combo). Mesmo formato do catálogo.
 */
function acrescentou(e: any) {
  if (e.item_id) {
    return {
      tipo: 'insumo' as const,
      insumo_id: e.item_id as string,
      nome: (e.item_nome ?? null) as string | null,
      quantidade_estoque: Number(e.quantidade),
      unidade_estoque: (e.item_unidade ?? null) as string | null,
    };
  }
  if (e.origem_tipo === 'ficha' && e.origem_ficha_id) return { tipo: 'ficha' as const, ficha_id: e.origem_ficha_id as string };
  if (e.produto_ref_id) return { tipo: 'produto' as const, produto_id: e.produto_ref_id as string };
  return null;
}

/** O ingrediente da ficha que a escolha TIROU ("sem cebola"). */
function retirou(e: any) {
  if (!e.tem_retira) return null;
  return {
    insumo_id: (e.retira_item_id ?? null) as string | null,
    sub_ficha_id: (e.retira_sub_ficha_id ?? null) as string | null,
    nome: (e.retira_nome ?? null) as string | null,
  };
}

/**
 * As escolhas de um item. A venda grava UMA linha por escolha — "+1 bacon" duas vezes são duas
 * linhas —: aqui as repetições da mesma escolha viram uma, com `vezes`, na ordem em que aparecem.
 */
function escolhasDoItem(linhas: any[]) {
  const grupos = new Map<string, any>();
  for (const e of linhas) {
    const tipo = e.tipo === 'remover' ? 'remover' : 'adicionar';
    const chave = `${tipo}\u0000${e.opcao_id ?? ''}\u0000${e.nome ?? ''}\u0000${e.item_id ?? ''}\u0000${e.produto_ref_id ?? ''}`;
    const g = grupos.get(chave);
    if (g) {
      g.vezes += 1;
      continue;
    }
    grupos.set(chave, {
      tipo,
      opcao_id: (e.opcao_id ?? null) as string | null,
      nome: e.nome as string,
      vezes: 1,
      acrescenta: tipo === 'adicionar' ? acrescentou(e) : null,
      retira: tipo === 'remover' ? retirou(e) : null,
    });
  }
  return [...grupos.values()];
}

/** O retrato da fila: os pedidos na ordem em que entraram, cada um com os seus itens. */
export function montarProducao(
  lojaId: string | null,
  l: { pedidos: any[]; itens: any[]; escolhas: any[] },
): RetratoProducao {
  const itensDe = agrupar(l.itens, 'pedido_id');
  const escolhasDe = agrupar(l.escolhas, 'comanda_item_id');
  return {
    loja_id: lojaId,
    pedidos: l.pedidos.map((p) => ({
      id: p.id as string,
      numero: p.numero == null ? null : Number(p.numero),
      origem: p.origem as string,
      canal: (p.plataforma ?? null) as string | null,
      consumo: (p.consumo ?? null) as string | null,
      status: p.status as string,
      setor_id: (p.setor_id ?? null) as string | null,
      tempo_preparo_min: p.tempo_preparo_min == null ? null : Number(p.tempo_preparo_min),
      alterado: p.alterado === true,
      criado_em: iso(p.criado_em),
      iniciado_em: iso(p.iniciado_em),
      pronto_em: iso(p.pronto_em),
      entregue_em: iso(p.entregue_em),
      cancelado_em: iso(p.cancelado_em),
      itens: (itensDe.get(p.id) ?? []).map((i) => ({
        id: i.id as string,
        produto_id: (i.produto_id ?? null) as string | null,
        ficha_id: (i.ficha_id ?? null) as string | null,
        variacao: i.variacao_id
          ? {
              id: i.variacao_id as string,
              nome: (i.variacao_nome ?? null) as string | null,
              codigo: (i.variacao_codigo ?? null) as string | null,
              fator_ficha: i.variacao_fator == null ? null : Number(i.variacao_fator),
            }
          : null,
        descricao: i.descricao as string,
        quantidade: Number(i.quantidade),
        observacao: (i.observacao ?? null) as string | null,
        removido: i.status === 'removido',
        adicionais_texto: (i.complementos_texto ?? null) as string | null,
        adicionais: i.comanda_item_id ? escolhasDoItem(escolhasDe.get(i.comanda_item_id) ?? []) : [],
      })),
    })),
  };
}
