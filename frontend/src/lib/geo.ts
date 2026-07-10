// Helpers de geolocalização e endereço.
// - ViaCEP (sem chave): CEP → rua/bairro/cidade.
// - GPS do navegador (sem chave): coordenadas do dispositivo.
// - Google (chave NEXT_PUBLIC_GOOGLE_MAPS_API_KEY): geocodificação + mapa embed.

export const MAPS_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? '';

export type CepDados = { logradouro: string; bairro: string; cidade: string; uf: string };

// Consulta o ViaCEP. Devolve null se o CEP for inválido/não encontrado.
export async function buscarCep(cep: string): Promise<CepDados | null> {
  const c = (cep ?? '').replace(/\D/g, '');
  if (c.length !== 8) return null;
  try {
    const r = await fetch(`https://viacep.com.br/ws/${c}/json/`);
    const j = await r.json();
    if (j?.erro) return null;
    return {
      logradouro: j.logradouro ?? '',
      bairro: j.bairro ?? '',
      cidade: j.localidade ?? '',
      uf: j.uf ?? '',
    };
  } catch {
    return null;
  }
}

// Coordenadas do dispositivo (pede permissão ao usuário).
export function localizacaoAtual(): Promise<{ lat: number; lng: number }> {
  return new Promise((resolve, reject) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation)
      return reject(new Error('Geolocalização indisponível neste dispositivo.'));
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
      (e) => reject(new Error(e.message || 'Não foi possível obter a localização.')),
      { enableHighAccuracy: true, timeout: 10000 },
    );
  });
}

// Geocodifica um endereço em coordenadas. Usa o Google se houver chave; senão,
// cai no Nominatim (OpenStreetMap), que é gratuito e sem chave.
export async function geocodificar(endereco: string): Promise<{ lat: number; lng: number } | null> {
  if (!endereco.trim()) return null;
  if (MAPS_KEY) {
    try {
      const r = await fetch(
        `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(endereco)}&key=${MAPS_KEY}&region=br`,
      );
      const j = await r.json();
      const loc = j?.results?.[0]?.geometry?.location;
      if (loc) return { lat: loc.lat, lng: loc.lng };
    } catch {
      /* cai no fallback */
    }
  }
  // Fallback keyless (Nominatim / OpenStreetMap).
  try {
    const r = await fetch(
      `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=br&q=${encodeURIComponent(endereco)}`,
    );
    const j = await r.json();
    const hit = Array.isArray(j) ? j[0] : null;
    return hit ? { lat: Number(hit.lat), lng: Number(hit.lon) } : null;
  } catch {
    return null;
  }
}

// Distância entre duas coordenadas (km). null se faltar alguma coordenada.
export function distanciaKm(lat1: any, lng1: any, lat2: any, lng2: any): number | null {
  const a1 = Number(lat1), o1 = Number(lng1), a2 = Number(lat2), o2 = Number(lng2);
  if (![a1, o1, a2, o2].every(Number.isFinite)) return null;
  const R = 6371;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(a2 - a1);
  const dLon = rad(o2 - o1);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a1)) * Math.cos(rad(a2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

// Taxa da faixa de raio para uma distância (km). Usa a menor faixa que cobre;
// se ultrapassar todas, usa a última.
export function taxaPorRaio(raios: any[], km: number): number {
  const ord = [...(raios ?? [])].sort((a, b) => (Number(a.ateKm) || 0) - (Number(b.ateKm) || 0));
  if (!ord.length) return 0;
  const faixa = ord.find((r) => km <= Number(r.ateKm)) ?? ord[ord.length - 1];
  return Number(faixa.taxa) || 0;
}

// URL do mapa centralizado num ponto. Google Embed se houver chave; senão,
// o mapa embutido do OpenStreetMap (sem chave).
export function mapaEmbedUrl(lat: number, lng: number, zoom = 16): string {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return '';
  if (MAPS_KEY) return `https://www.google.com/maps/embed/v1/place?key=${MAPS_KEY}&q=${lat},${lng}&zoom=${zoom}`;
  const d = 0.008; // ~800m de margem no bbox
  const bbox = `${lng - d},${lat - d},${lng + d},${lat + d}`;
  return `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${lat},${lng}`;
}
