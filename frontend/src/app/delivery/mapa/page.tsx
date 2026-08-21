'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { Shell } from '@/components/app-shell/shell';
import { Card } from '@/components/ui/card';
import 'leaflet/dist/leaflet.css';

/* eslint-disable @typescript-eslint/no-explicit-any */
// E2b — mapa dos entregadores ao vivo (consome GET /entregador/ao-vivo:
// última posição de cada entregador nos últimos 15 min + nº em rota).
type Vivo = {
  colaborador_id: string;
  lat: number | null;
  lng: number | null;
  criado_em: string;
  nome: string;
  em_rota: number;
};

const OURO = '#E2A340';
const horaCurta = (d?: string) =>
  d ? new Date(d).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '—';
const minAtras = (d?: string) =>
  d ? Math.max(0, Math.floor((Date.now() - new Date(d).getTime()) / 60000)) : null;
const esc = (s: string) =>
  s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));

export default function MapaEntregadoresPage() {
  const mapEl = useRef<HTMLDivElement>(null);
  const mapObj = useRef<any>(null);
  const markers = useRef<Record<string, any>>({});
  const Lref = useRef<any>(null);
  const [pronto, setPronto] = useState(false);
  const [vivos, setVivos] = useState<Vivo[]>([]);
  const [carregando, setCarregando] = useState(true);

  // Inicializa o mapa só no cliente (Leaflet acessa `window`).
  useEffect(() => {
    let cancel = false;
    (async () => {
      const L = await import('leaflet');
      if (cancel || !mapEl.current || mapObj.current) return;
      Lref.current = L;
      const map = L.map(mapEl.current).setView([-14.235, -51.925], 4); // Brasil
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
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
    };
  }, []);

  const carregar = useCallback(async () => {
    try {
      const rows = (await api.entregadoresAoVivo()) as Vivo[];
      setVivos(Array.isArray(rows) ? rows : []);
    } catch {
      /* silencioso — polling */
    } finally {
      setCarregando(false);
    }
  }, []);

  // Polling a cada 15s.
  useEffect(() => {
    carregar();
    const t = setInterval(carregar, 15000);
    return () => clearInterval(t);
  }, [carregar]);

  // Reconcilia marcadores (cria/atualiza/remove) e enquadra.
  useEffect(() => {
    const L = Lref.current;
    const map = mapObj.current;
    if (!pronto || !L || !map) return;
    const vistos = new Set<string>();
    const pts: [number, number][] = [];
    for (const v of vivos) {
      if (v.lat == null || v.lng == null) continue;
      const pos: [number, number] = [Number(v.lat), Number(v.lng)];
      vistos.add(v.colaborador_id);
      pts.push(pos);
      const badge = v.em_rota > 0 ? ` · ${v.em_rota}` : '';
      const html =
        `<div style="transform:translate(-50%,-100%);display:flex;flex-direction:column;align-items:center;white-space:nowrap;">` +
        `<div style="background:${OURO};color:#0F2230;font:600 12px/1 Figtree,system-ui,sans-serif;` +
        `padding:5px 9px;border-radius:999px;box-shadow:0 2px 6px rgba(0,0,0,.3);">🛵 ${esc(v.nome ?? 'Entregador')}${badge}</div>` +
        `<div style="width:2px;height:9px;background:${OURO};"></div></div>`;
      const icon = L.divIcon({ className: '', html, iconSize: [0, 0], iconAnchor: [0, 0] });
      if (markers.current[v.colaborador_id]) {
        markers.current[v.colaborador_id].setLatLng(pos).setIcon(icon);
      } else {
        markers.current[v.colaborador_id] = L.marker(pos, { icon }).addTo(map);
      }
    }
    for (const id of Object.keys(markers.current)) {
      if (!vistos.has(id)) {
        map.removeLayer(markers.current[id]);
        delete markers.current[id];
      }
    }
    if (pts.length) map.fitBounds(pts, { padding: [48, 48], maxZoom: 15 });
  }, [vivos, pronto]);

  return (
    <Shell>
      <div className="mx-auto w-full max-w-6xl px-4 py-6">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Delivery</p>
        <h1 className="text-2xl font-bold">Mapa ao vivo</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Entregadores em rota — última posição dos últimos 15 minutos. Atualiza sozinho a cada 15s.
        </p>

        <div className="mt-5 grid grid-cols-1 gap-4 lg:grid-cols-3">
          <Card className="overflow-hidden p-0 lg:col-span-2">
            <div ref={mapEl} className="h-[420px] w-full sm:h-[540px]" />
          </Card>

          <Card className="p-4">
            <h2 className="mb-3 text-sm font-semibold">
              Em rota agora {vivos.length > 0 && <span className="text-muted-foreground">({vivos.length})</span>}
            </h2>
            {carregando ? (
              <p className="text-sm text-muted-foreground">Carregando…</p>
            ) : vivos.length === 0 ? (
              <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
                Nenhum entregador transmitindo posição agora. Aparecem aqui quando estão com uma entrega ativa no app.
              </div>
            ) : (
              <ul className="flex flex-col gap-2">
                {vivos.map((v) => {
                  const m = minAtras(v.criado_em);
                  return (
                    <li
                      key={v.colaborador_id}
                      className="flex items-center justify-between rounded-lg border px-3 py-2"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">🛵 {v.nome ?? 'Entregador'}</p>
                        <p className="text-xs text-muted-foreground">
                          {v.em_rota > 0 ? `${v.em_rota} pedido(s) em rota` : 'sem pedido em rota'}
                        </p>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="font-mono text-xs">{horaCurta(v.criado_em)}</p>
                        <p className="text-[11px] text-muted-foreground">
                          {m === 0 ? 'agora' : m != null ? `há ${m} min` : ''}
                        </p>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </Shell>
  );
}
