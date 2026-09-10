'use client';

import { useEffect, useRef } from 'react';
import 'leaflet/dist/leaflet.css';

/* eslint-disable @typescript-eslint/no-explicit-any */
const CORES = ['#0E7C66', '#E2A340', '#C2410C', '#B91C1C', '#7C3AED', '#0369A1'];
const brl = (n: number) => Number(n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

// Mapa com CÍRCULOS CONCÊNTRICOS por faixa de raio (500m, 1km…), centrado no endereço
// da loja. Referência visual das faixas de entrega na config por raio (item 5).
export function MapaAreaEntrega({
  lat, lng, raios,
}: {
  lat?: number | string | null;
  lng?: number | string | null;
  raios: { ateKm: number | string; taxa: number | string }[];
}) {
  const el = useRef<HTMLDivElement>(null);
  const mapObj = useRef<any>(null);
  const camadas = useRef<any[]>([]);
  const slat = Number(lat);
  const slng = Number(lng);
  const temCentro = Number.isFinite(slat) && Number.isFinite(slng);

  function desenhar(L: any, map: any) {
    camadas.current.forEach((c) => map.removeLayer(c));
    camadas.current = [];
    if (!temCentro) return;
    const center: [number, number] = [slat, slng];
    // Marcador da loja (centro do delivery).
    const loja = L.circleMarker(center, { radius: 6, color: '#0F2230', fillColor: '#0F2230', fillOpacity: 1 }).addTo(map);
    loja.bindTooltip('Loja', { permanent: false });
    camadas.current.push(loja);
    const faixas = [...(raios ?? [])]
      .map((r) => ({ km: Number(r.ateKm) || 0, taxa: Number(r.taxa) || 0 }))
      .filter((r) => r.km > 0)
      .sort((a, b) => a.km - b.km);
    let maiorM = 0;
    faixas.forEach((f, i) => {
      const cor = CORES[i % CORES.length];
      const raioM = f.km * 1000;
      maiorM = Math.max(maiorM, raioM);
      const circ = L.circle(center, { radius: raioM, color: cor, weight: 2, fillColor: cor, fillOpacity: 0.06 }).addTo(map);
      circ.bindTooltip(`${f.km} km · ${brl(f.taxa)}`, { permanent: false, sticky: true });
      camadas.current.push(circ);
    });
    if (maiorM > 0) {
      try { map.fitBounds(L.latLng(center).toBounds(maiorM * 2.2)); } catch { /* noop */ }
    } else {
      map.setView(center, 14);
    }
  }

  // Inicializa o mapa (só no cliente — Leaflet acessa window).
  useEffect(() => {
    let cancel = false;
    (async () => {
      const L = await import('leaflet');
      if (cancel || !el.current || mapObj.current) return;
      const center: [number, number] = temCentro ? [slat, slng] : [-14.235, -51.925];
      const map = L.map(el.current).setView(center, temCentro ? 14 : 4);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap', maxZoom: 19 }).addTo(map);
      mapObj.current = map;
      desenhar(L, map);
    })();
    return () => {
      cancel = true;
      if (mapObj.current) { mapObj.current.remove(); mapObj.current = null; }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Redesenha quando muda o centro ou as faixas.
  useEffect(() => {
    (async () => {
      if (!mapObj.current) return;
      const L = await import('leaflet');
      desenhar(L, mapObj.current);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slat, slng, JSON.stringify(raios)]);

  return (
    <div>
      <div ref={el} className="h-64 w-full rounded-lg border border-border" />
      {!temCentro && (
        <p className="mt-1 text-[11px] text-warn">Cadastre a latitude/longitude da loja (aba Loja) para ver as faixas no mapa.</p>
      )}
    </div>
  );
}
