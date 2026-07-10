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

// URL do mapa centralizado num ponto. Google Embed se houver chave; senão,
// o mapa embutido do OpenStreetMap (sem chave).
export function mapaEmbedUrl(lat: number, lng: number, zoom = 16): string {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return '';
  if (MAPS_KEY) return `https://www.google.com/maps/embed/v1/place?key=${MAPS_KEY}&q=${lat},${lng}&zoom=${zoom}`;
  const d = 0.008; // ~800m de margem no bbox
  const bbox = `${lng - d},${lat - d},${lng + d},${lat + d}`;
  return `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${lat},${lng}`;
}
