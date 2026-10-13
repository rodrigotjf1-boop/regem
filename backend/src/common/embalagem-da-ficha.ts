// EMBALAGEM NA FICHA TÉCNICA (pedido do dono, 12/10/2026).
//
// Cada linha da ficha é de um destes três tipos:
//  • comum (ingrediente): entra em toda venda;
//  • embalagem do DELIVERY (`somente_delivery`, mig 147): entra no pedido externo;
//  • embalagem do BALCÃO (`somente_balcao`, mig 317): entra na venda de balcão, mesa e totem.
//
// A empresa diz, numa chave só, se usa a MESMA embalagem no balcão e no delivery
// (`entitlement.modulo = MODULO_MESMA_EMBALAGEM`):
//  • desligada (o padrão — é a conta de sempre): dois cadastros, cada venda usa o seu;
//  • ligada: um cadastro só, o do delivery, e ele vale para as DUAS vendas. A embalagem de balcão
//    que já estava cadastrada fica guardada, não conta, e volta se a chave for desligada.
//
// ⚠️ A MESMA regra vive em `frontend/src/lib/embalagem-da-ficha.ts` (a ficha mostra os dois custos
//    enquanto a pessoa digita). Mude os dois juntos: `frontend/scripts/check-embalagem.mjs` roda os
//    mesmos casos nos dois arquivos e falha se as respostas diferirem.

/**
 * Para que venda o custo (ou a baixa de estoque) está sendo calculado. `nenhum` = só os
 * ingredientes: produção interna, custo do produto feito na loja, perda ainda na cozinha e a conta
 * de quantas unidades dá para vender.
 */
export type CanalDaFicha = 'balcao' | 'delivery' | 'nenhum';

/** A venda em que a ficha está sendo explodida: o canal e a chave da empresa. */
export type VendaDaFicha = { canal: CanalDaFicha; mesmaEmbalagem: boolean };

/** Só os ingredientes, sem embalagem de canal nenhum. */
export const SO_INGREDIENTES: VendaDaFicha = { canal: 'nenhum', mesmaEmbalagem: false };
/** Pedido externo: no delivery a chave da empresa não muda nada (vale sempre o cadastro do delivery). */
export const PEDIDO_EXTERNO: VendaDaFicha = { canal: 'delivery', mesmaEmbalagem: false };

/** Nome da chave em `entitlement` (por empresa; sem registro = desligada). */
export const MODULO_MESMA_EMBALAGEM = 'ficha_mesma_embalagem';

export type LinhaDeCanal = { somenteDelivery?: boolean | null; somenteBalcao?: boolean | null };

/** A linha da ficha entra nesta venda? */
export function linhaEntra(linha: LinhaDeCanal, canal: CanalDaFicha, mesmaEmbalagem: boolean): boolean {
  if (linha.somenteDelivery) return canal === 'delivery' || (canal === 'balcao' && mesmaEmbalagem);
  if (linha.somenteBalcao) return canal === 'balcao' && !mesmaEmbalagem;
  return true;
}
