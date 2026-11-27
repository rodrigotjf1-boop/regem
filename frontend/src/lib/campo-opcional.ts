// CAMPO DE VALOR OPCIONAL NA EDIÇÃO (o custo manual e o preço promocional do produto). O servidor mantém o que estava
// quando o campo vem AUSENTE e limpa quando vem `null`. Antes a tela mandava ausente em TODO vazio: "vazio = usa o custo
// calculado" não limpava nada, e o custo R$ 0,00 que a importação gravou ficava para sempre escondendo a ficha (ERR-636).
//
// Lê como o `<input type="number">` entrega (ponto decimal, nunca milhar) e como o banco devolve ("1.200" = 1,2): NÃO usar
// `lerValorDigitado` aqui — ele lê "1.200" como mil e duzentos (o valor salvo voltaria multiplicado, ERR-227).

/** O número do campo; `null` = vazio; `NaN` = o que não é número. */
export function numeroDoCampo(v: string | number | null | undefined): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : NaN;
  const s = String(v ?? '').trim();
  if (!s) return null;
  const n = Number(s.replace(',', '.'));
  return Number.isFinite(n) ? n : NaN;
}

/**
 * O que mandar ao servidor: digitado → o número; esvaziado AGORA (antes tinha valor) → `null` (limpa); vazio que já era
 * vazio → ausente; o que não é número → ausente (um erro de digitação não apaga o guardado). Comparar com o de antes também
 * protege quem não vê o campo (o custo, só com "Ver valores em R$"): o vazio dele nunca apaga o custo que outro pôs.
 */
export function valorOpcionalDaEdicao(
  agora: string | number | null | undefined,
  antes: string | number | null | undefined,
): number | null | undefined {
  const v = numeroDoCampo(agora);
  if (v === null) return numeroDoCampo(antes) === null ? undefined : null;
  return Number.isNaN(v) ? undefined : v;
}
