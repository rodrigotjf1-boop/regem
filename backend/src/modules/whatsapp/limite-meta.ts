// O LIMITE DE ENVIO da Meta (messaging limit tier), lido do nome do degrau. Função pura, usada pelo número das lojas
// (`whatsapp-cloud.service.ts`) e pelo número do Mister (`modules/mister`): uma régua só para os dois.
//
// Degraus de hoje: TIER_250 → TIER_2K → TIER_10K → TIER_100K → TIER_UNLIMITED. TIER_50 e TIER_NOT_SET seguem no enum
// (número restrito / que nunca enviou). NÃO usa lista fixa de casos: era o que prendia a loja em 250 quando a Meta
// liberava 2.000 — o degrau novo não casava em nenhum caso. Lê o NÚMERO do próprio nome (TIER_2K → 2000), então degrau
// novo funciona sem mexer no código.

/** number = teto | 'ilimitado' | null = não reconhecido (quem chama decide o que mostrar). */
export function tierParaNumero(tier: string | null | undefined): number | 'ilimitado' | null {
  const t = String(tier ?? '').trim().toUpperCase();
  if (!t) return null;
  if (t.includes('UNLIMITED') || t.includes('ILIMIT')) return 'ilimitado';
  // Aceita TIER_2K, TIER_250, TIER_100K e também um número cru ("2000").
  const m = t.match(/^(?:TIER_)?(\d+)\s*([KM])?$/);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n * (m[2] === 'M' ? 1_000_000 : m[2] === 'K' ? 1_000 : 1);
}
