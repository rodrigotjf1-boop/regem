// O CUSTO DO COMBO PELA SOMA DOS PRODUTOS DO COMBO. Na venda, o combo baixa o estoque de cada componente (a ficha do lanche,
// a da batata, o item da lata — `vendas.service` `acumularProduto`), mas o custo efetivo não tinha ramo de combo: o combo
// aparecia sem custo ou com o da ficha dele, que a venda nem baixa. Pedido do dono em 27/11/2026 ("opção de adicionar algo a
// mais além da ficha técnica para compor o custo… um produto como uma lata, ou uma batata cheddar que tem mais uma ficha").
//
// A regra, a mesma nos três lugares que dão custo ao produto (a lista do Cardápio, o mapa dos relatórios e da integração, e o
// Mister): o custo manual vence; num combo COM produtos, vale a soma do custo de cada um × a quantidade, com balcão e
// delivery separados (a embalagem de cada ficha entra como na venda); se ALGUM produto do combo não tem custo conhecido, o
// combo não tem — nunca a soma parcial, que daria margem falsa (V74). Combo dentro de combo resolve pela mesma regra; ciclo =
// sem custo. Combo SEM produtos segue como era (o custo do cadastro dele). O que é "custo conhecido" de um produto comum
// (ficha incompleta conta ou não) é de quem chama: cada tela já tinha a sua regra.

export interface ParteDoCombo {
  produtoId: string;
  quantidade: number;
}
export type ProdutosDosCombos = ReadonlyMap<string, ReadonlyArray<ParteDoCombo>>;
export interface CustoPar {
  balcao: number;
  delivery: number;
}
export type FonteDoCusto = 'manual' | 'combo' | 'ficha' | 'estoque';
export type CustoResolvido = { custo: CustoPar; fonte: FonteDoCusto } | null;

/** As linhas de `produto_combo_item` (vivas) agrupadas por combo. Quantidade vazia ou zero = 1, como na venda. */
export function agruparProdutosDosCombos(
  linhas: ReadonlyArray<{ combo: string; componente: string; quantidade: unknown }>,
): Map<string, ParteDoCombo[]> {
  const porCombo = new Map<string, ParteDoCombo[]>();
  for (const l of linhas) {
    const lista = porCombo.get(String(l.combo)) ?? [];
    lista.push({ produtoId: String(l.componente), quantidade: Number(l.quantidade) || 1 });
    porCombo.set(String(l.combo), lista);
  }
  return porCombo;
}

export interface FontesDoCusto {
  /** O custo informado à mão no produto, ou null. */
  manual: (produtoId: string) => CustoPar | null;
  /** O custo do cadastro (a ficha ou o item do estoque), pela regra de quem chama, ou null. */
  cadastro: (produtoId: string) => { custo: CustoPar; fonte: 'ficha' | 'estoque' } | null;
  ehCombo: (produtoId: string) => boolean;
  produtosDosCombos: ProdutosDosCombos;
}

/** Devolve quem resolve o custo de um produto (com memória: cada produto é resolvido uma vez). */
export function criarResolvedorDeCusto(f: FontesDoCusto): (produtoId: string) => CustoResolvido {
  const memoria = new Map<string, CustoResolvido>();
  const emCurso = new Set<string>();
  const resolver = (id: string): CustoResolvido => {
    if (memoria.has(id)) return memoria.get(id) ?? null;
    let r: CustoResolvido = null;
    const manual = f.manual(id);
    const partes = f.ehCombo(id) ? f.produtosDosCombos.get(id) : undefined;
    if (manual) r = { custo: manual, fonte: 'manual' };
    else if (partes?.length) {
      if (emCurso.has(id)) return null; // ciclo (A dentro de B dentro de A): sem custo conhecido
      emCurso.add(id);
      let balcao = 0;
      let delivery = 0;
      let todos = true;
      for (const p of partes) {
        const c = resolver(p.produtoId);
        if (!c || !Number.isFinite(c.custo.balcao) || !Number.isFinite(c.custo.delivery)) {
          todos = false;
          break;
        }
        balcao += c.custo.balcao * p.quantidade;
        delivery += c.custo.delivery * p.quantidade;
      }
      emCurso.delete(id);
      r = todos ? { custo: { balcao, delivery }, fonte: 'combo' } : null;
    } else {
      const c = f.cadastro(id);
      r = c ? { custo: c.custo, fonte: c.fonte } : null;
    }
    memoria.set(id, r);
    return r;
  };
  return resolver;
}
