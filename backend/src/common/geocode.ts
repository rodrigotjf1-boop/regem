// Geocode via Nominatim (OpenStreetMap) — endereço em texto → { lat, lng }.
// Gratuito e sem chave. Política de uso: User-Agent identificável e baixo volume
// (checkout ocasional + salvar loja). Falha de rede/limite → devolve null (o
// chamador cai no fallback: frete 0 / por bairro). NÃO lança.
//
// Se um dia o volume crescer, trocar por um provedor com chave (OpenCage/Google)
// mantendo esta mesma assinatura.

const NOMINATIM = 'https://nominatim.openstreetmap.org/search';
const UA = 'RegemDelivery/1.0 (contato: suporte@dmsregem.com)';

export async function geocode(endereco: string): Promise<{ lat: number; lng: number } | null> {
  const q = (endereco || '').trim();
  if (q.length < 4) return null;
  try {
    const url = `${NOMINATIM}?format=json&limit=1&q=${encodeURIComponent(q)}`;
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 5000);
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, 'Accept-Language': 'pt-BR' },
      signal: ctrl.signal,
    }).finally(() => clearTimeout(t));
    if (!res.ok) return null;
    const arr = (await res.json()) as Array<{ lat: string; lon: string }>;
    if (!Array.isArray(arr) || !arr.length) return null;
    const lat = Number(arr[0].lat);
    const lng = Number(arr[0].lon);
    return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
  } catch {
    return null; // rede/timeout/limite: fallback silencioso
  }
}

// Monta uma string de endereço para geocode a partir de partes (ignora vazios).
export function montarEndereco(
  partes: (string | null | undefined)[],
): string {
  return partes.map((p) => (p ?? '').trim()).filter(Boolean).join(', ');
}
