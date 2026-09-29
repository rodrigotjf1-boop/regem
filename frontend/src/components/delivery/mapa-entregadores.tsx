'use client';

import { useEffect, useRef, useState } from 'react';
import 'leaflet/dist/leaflet.css';

/* eslint-disable @typescript-eslint/no-explicit-any */

// Mapa Leaflet dos entregadores ao vivo — o MESMO no Mapa ao vivo do delivery e no KDS.
// Recebe os dados prontos (quem busca e com que frequência é a tela); aqui só desenha:
// pino da loja, um pino por entregador (nome + nº de pedidos em rota), reconcilia os pinos a
// cada atualização e enquadra UMA vez (depois não mexe no zoom de quem está olhando).

export type EntregadorAoVivo = {
  colaborador_id: string;
  lat: number | null;
  lng: number | null;
  criado_em: string;
  nome: string;
  em_rota: number;
  pedidos?: string[];
};

export type Centro = { lat: number; lng: number } | null;

const OURO = '#E2A340';
const NAVY = '#0F2230';

export const horaCurta = (d?: string) =>
  d ? new Date(d).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '—';
export const minAtras = (d?: string) =>
  d ? Math.max(0, Math.floor((Date.now() - new Date(d).getTime()) / 60000)) : null;
const esc = (s: string) =>
  s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));

// Pino em HTML (divIcon): etiqueta arredondada + haste.
function pino(texto: string, fundo: string, cor: string, escala = 1) {
  const px = Math.round(12 * escala);
  return (
    `<div style="transform:translate(-50%,-100%);display:flex;flex-direction:column;align-items:center;white-space:nowrap;">` +
    `<div style="background:${fundo};color:${cor};font:600 ${px}px/1 Figtree,system-ui,sans-serif;` +
    `padding:${Math.round(5 * escala)}px ${Math.round(9 * escala)}px;border-radius:999px;box-shadow:0 2px 6px rgba(0,0,0,.35);">${texto}</div>` +
    `<div style="width:2px;height:${Math.round(9 * escala)}px;background:${fundo};"></div></div>`
  );
}

// Tema escuro sem outro provedor de mapa: o mesmo OpenStreetMap com o azulejo invertido.
const FILTRO_ESCURO = 'invert(1) hue-rotate(180deg) brightness(0.9) contrast(0.9)';

export function MapaEntregadores({
  centro,
  entregadores,
  escuro = false,
  escala = 1,
  className = 'h-[420px] w-full sm:h-[540px]',
}: {
  centro: Centro;
  entregadores: EntregadorAoVivo[];
  escuro?: boolean;
  escala?: number; // KDS: pinos maiores, para ler de longe
  className?: string;
}) {
  const mapEl = useRef<HTMLDivElement>(null);
  const mapObj = useRef<any>(null);
  const tiles = useRef<any>(null);
  const markers = useRef<Record<string, any>>({});
  const lojaMarker = useRef<any>(null);
  const centradoInicial = useRef(false);
  const enquadrado = useRef(false);
  const Lref = useRef<any>(null);
  const [pronto, setPronto] = useState(false);

  // Inicializa o mapa só no cliente (Leaflet acessa `window`).
  useEffect(() => {
    let cancel = false;
    (async () => {
      const L = await import('leaflet');
      if (cancel || !mapEl.current || mapObj.current) return;
      Lref.current = L;
      const map = L.map(mapEl.current).setView([-14.235, -51.925], 4); // Brasil
      tiles.current = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap',
        maxZoom: 19,
      }).addTo(map);
      mapObj.current = map;
      setPronto(true);
    })();
    return () => {
      cancel = true;
      if (mapObj.current) {
        mapObj.current.remove();
        mapObj.current = null;
      }
      markers.current = {};
      lojaMarker.current = null;
    };
  }, []);

  useEffect(() => {
    const c = tiles.current?.getContainer?.();
    if (c) c.style.filter = escuro ? FILTRO_ESCURO : '';
  }, [escuro, pronto]);

  // Reconcilia os pinos (cria/atualiza/remove) e enquadra.
  useEffect(() => {
    const L = Lref.current;
    const map = mapObj.current;
    if (!pronto || !L || !map) return;

    if (centro) {
      const lojaPos: [number, number] = [centro.lat, centro.lng];
      const lojaIcon = L.divIcon({ className: '', html: pino('🏪 Loja', NAVY, '#fff', escala), iconSize: [0, 0], iconAnchor: [0, 0] });
      if (lojaMarker.current) lojaMarker.current.setLatLng(lojaPos).setIcon(lojaIcon);
      else lojaMarker.current = L.marker(lojaPos, { icon: lojaIcon }).addTo(map);
      if (!centradoInicial.current) {
        map.setView(lojaPos, 14);
        centradoInicial.current = true;
      }
    }

    const vistos = new Set<string>();
    const pts: [number, number][] = [];
    for (const v of entregadores) {
      if (v.lat == null || v.lng == null) continue;
      const pos: [number, number] = [Number(v.lat), Number(v.lng)];
      if (!Number.isFinite(pos[0]) || !Number.isFinite(pos[1])) continue;
      vistos.add(v.colaborador_id);
      pts.push(pos);
      const badge = v.em_rota > 0 ? ` · ${v.em_rota}` : '';
      const icon = L.divIcon({
        className: '',
        html: pino(`🛵 ${esc(v.nome || 'Entregador')}${badge}`, OURO, NAVY, escala),
        iconSize: [0, 0],
        iconAnchor: [0, 0],
      });
      if (markers.current[v.colaborador_id]) markers.current[v.colaborador_id].setLatLng(pos).setIcon(icon);
      else markers.current[v.colaborador_id] = L.marker(pos, { icon }).addTo(map);
    }
    for (const id of Object.keys(markers.current)) {
      if (!vistos.has(id)) {
        map.removeLayer(markers.current[id]);
        delete markers.current[id];
      }
    }
    if (pts.length && !enquadrado.current) {
      const bounds = centro ? [...pts, [centro.lat, centro.lng] as [number, number]] : pts;
      map.fitBounds(bounds, { padding: [48, 48], maxZoom: 15 });
      enquadrado.current = true;
    }
  }, [entregadores, pronto, centro, escala]);

  return <div ref={mapEl} className={className} role="region" aria-label="Mapa dos entregadores" />;
}
