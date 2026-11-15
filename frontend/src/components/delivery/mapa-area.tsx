'use client';

import { useEffect, useRef } from 'react';
import 'leaflet/dist/leaflet.css';

/* eslint-disable @typescript-eslint/no-explicit-any */
const CORES = ['#0E7C66', '#E2A340', '#C2410C', '#B91C1C', '#7C3AED', '#0369A1'];
const brl = (n: number) => Number(n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const km = (n: number) => String(n).replace('.', ',');

// Mapa com CÍRCULOS CONCÊNTRICOS por faixa de raio (500m, 1km…), centrado no endereço
// da loja. Referência visual das faixas de entrega na config por distância (item 5).
// 15/11/2026 (o dono: "o mapa está limitado numa área pequena, dificultando a edição e a escolha dos raios"): o mapa tem
// a altura do editor de áreas desenhadas, se reenquadra quando aparece ou muda de tamanho (montado com a aba escondida,
// o Leaflet não sabia o tamanho e cortava os círculos) e cada faixa traz o rótulo na borda ("até 1,9 km · grátis").
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
  const enquadrar = useRef<() => void>(() => {});
  // `Number(null)` e `Number('')` dão 0 (um ponto no oceano): coordenada vazia não conta.
  const coord = (v: unknown) => v != null && String(v).trim() !== '' && Number.isFinite(Number(v));
  const temCentro = coord(lat) && coord(lng);
  const slat = Number(lat);
  const slng = Number(lng);

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
      .filter((r) => r.km > 0 && r.km < 100)
      .sort((a, b) => a.km - b.km);
    let maiorM = 0;
    faixas.forEach((f, i) => {
      const cor = CORES[i % CORES.length];
      const raioM = f.km * 1000;
      maiorM = Math.max(maiorM, raioM);
      const circ = L.circle(center, { radius: raioM, color: cor, weight: 2, fillColor: cor, fillOpacity: 0.06 }).addTo(map);
      circ.bindTooltip(`até ${km(f.km)} km · ${f.taxa === 0 ? 'grátis' : brl(f.taxa)}`, { permanent: false, sticky: true });
      camadas.current.push(circ);
      // O rótulo da faixa na borda do círculo, cada um num ângulo (os das faixas pequenas não se encostam).
      const ang = ((90 - i * 28) * Math.PI) / 180;
      const dLat = (f.km / 111.32) * Math.sin(ang);
      const dLng = (f.km / (111.32 * Math.cos((slat * Math.PI) / 180))) * Math.cos(ang);
      const rotulo = L.marker([slat + dLat, slng + dLng], {
        interactive: false,
        keyboard: false,
        icon: L.divIcon({
          className: '',
          iconSize: null,
          html: `<span style="display:inline-block;transform:translate(-50%,-50%);white-space:nowrap;background:#fff;border:1px solid ${cor};color:#0F2230;border-radius:6px;padding:1px 6px;font:600 11px/1.4 system-ui,sans-serif">até ${km(f.km)} km · ${f.taxa === 0 ? 'grátis' : brl(f.taxa)}</span>`,
        }),
      }).addTo(map);
      camadas.current.push(rotulo);
    });
    enquadrar.current = () => {
      if (!mapObj.current) return;
      mapObj.current.invalidateSize();
      if (maiorM > 0) {
        try {
          mapObj.current.fitBounds(L.latLng(center).toBounds(maiorM * 2), { padding: [28, 28] });
        } catch {
          /* noop */
        }
      } else mapObj.current.setView(center, 14);
    };
    enquadrar.current();
  }

  // Inicializa o mapa (só no cliente — Leaflet acessa window).
  useEffect(() => {
    let cancel = false;
    let obs: ResizeObserver | null = null;
    (async () => {
      const mod: any = await import('leaflet');
      const L = mod.default ?? mod;
      if (cancel || !el.current || mapObj.current) return;
      const center: [number, number] = temCentro ? [slat, slng] : [-14.235, -51.925];
      // `zoomSnap` de 0,25: o círculo maior cabe inteiro sem sobrar meio mapa vazio.
      const map = L.map(el.current, { zoomSnap: 0.25 }).setView(center, temCentro ? 14 : 4);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap', maxZoom: 19 }).addTo(map);
      mapObj.current = map;
      desenhar(L, map);
      // Montado com a aba ainda escondida (ou a janela mudou de tamanho): reenquadra quando o tamanho real aparece.
      let ultimo = '';
      obs = new ResizeObserver((e) => {
        const r = e[0]?.contentRect;
        const chave = r ? `${Math.round(r.width)}x${Math.round(r.height)}` : '';
        if (!r || !r.width || !r.height || chave === ultimo) return;
        ultimo = chave;
        enquadrar.current();
      });
      obs.observe(el.current);
    })();
    return () => {
      cancel = true;
      obs?.disconnect();
      if (mapObj.current) { mapObj.current.remove(); mapObj.current = null; }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Redesenha quando muda o centro ou as faixas.
  useEffect(() => {
    (async () => {
      if (!mapObj.current) return;
      const mod: any = await import('leaflet');
      desenhar(mod.default ?? mod, mapObj.current);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slat, slng, JSON.stringify(raios)]);

  return (
    <div>
      {/* `isolate`: sem camada própria, os z-index do Leaflet (400–1000) cobrem diálogo e barra de baixo (ERR-277). A
          altura é a do editor de áreas desenhadas (o dono achou o mapa de 256 px pequeno demais para escolher as faixas). */}
      <div
        ref={el}
        data-mapa-faixas
        role="img"
        aria-label="Mapa das faixas de distância a partir da loja"
        className="isolate h-[min(60vh,520px)] min-h-[320px] w-full rounded-lg border border-border"
      />
      {!temCentro && (
        <p className="mt-1 text-[11px] text-warn">Cadastre a latitude/longitude da loja (aba Endereço) para ver as faixas no mapa.</p>
      )}
    </div>
  );
}
