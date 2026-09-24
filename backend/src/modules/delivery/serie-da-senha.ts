import { PREFIXO_BALCAO } from '../../common/senha-origem';

// R6 — de que SÉRIE sai a senha quando um pedido externo vira comanda.
//
// O balcão tem UMA série (B): PDV, mesa avulsa e totem bebem do mesmo contador, então
// nunca saem dois pedidos com o mesmo número para o cliente. Delivery tem a sua (D).
// O totem é venda de balcão — antes ele exibia o sequencial do `pedido_externo` e, ao
// ser cobrado, ganhava uma senha D: dois números para o mesmo pedido, e ambos podendo
// repetir um do PDV.
//
// `senhaReservada` existe porque a senha do totem é tirada na CRIAÇÃO do pedido — o
// cliente já saiu com ela impressa. Tirar outra no aceite faria a cozinha chamar um
// número diferente do que está na mão dele.
export type SerieDaSenha = {
  senhaPrefixo?: string;
  senhaReservada?: number | null;
};

export function serieDaSenha(
  canal: string | null | undefined,
  displayId: string | null | undefined,
): SerieDaSenha {
  if ((canal ?? '').toLowerCase() !== 'totem') return {};
  const n = Number(displayId);
  return {
    senhaPrefixo: PREFIXO_BALCAO,
    senhaReservada: Number.isFinite(n) && n > 0 ? n : null,
  };
}
