'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import 'leaflet/dist/leaflet.css';

/* eslint-disable @typescript-eslint/no-explicit-any */
// Rastreio PÚBLICO do cliente (sem login) — consome GET /rastreio/:token.
// Mostra o entregador se movendo, o destino, status, ETA e "parada X de Y".
// O link é enviado no WhatsApp quando o entregador está a caminho DESTE endereço.

const OURO = '#E2A340';
const NAVY = '#0F2230';

function apiBase(): string {
  return process.env.NEXT_PUBLIC_API_URL || 'https://api.dmsregem.com/api/v1';
}

type Dados = {
  numero: number | null;
  status: string;
  statusLabel: string;
  entregador: { pos: { lat: number; lng: number } | null; nome: string | null } | null;
  destino: { lat: number; lng: number } | null;
  parada: { x: number; y: number } | null;
  etaMin: number | null;
  codigoEntrega: string | null;
};

export default function RastreioPage() {
  const params = useParams<{ token: string }>();
  const token = String(params?.token ?? '');
  const mapEl = useRef<HTMLDivElement>(null);
  const mapObj = useRef<any>(null);
  const Lref = useRef<any>(null);
  const driverMk = useRef<any>(null);
  const destMk = useRef<any>(null);
  const enquadrado = useRef(false);
  const [pronto, setPronto] = useState(false);
  const [dados, setDados] = useState<Dados | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);

  // Mapa só no cliente (Leaflet acessa window).
  useEffect(() => {
    let cancel = false;
    (async () => {
      const L = await import('leaflet');
      if (cancel || !mapEl.current || mapObj.current) return;
      Lref.current = L;
      const map = L.map(mapEl.current, { zoomControl: false }).setView([-14.235, -51.925], 4);
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
    };
  }, []);

  const carregar = useCallback(async () => {
    if (typeof document !== 'undefined' && document.hidden) return;
    try {
      const r = await fetch(`${apiBase()}/rastreio/${encodeURIComponent(token)}`, { cache: 'no-store' });
      if (!r.ok) {
        setErro(r.status === 404 ? 'Rastreio não encontrado.' : 'Não foi possível carregar o rastreio.');
        return;
      }
      setErro(null);
      setDados((await r.json()) as Dados);
    } catch {
      /* silencioso — polling */
    } finally {
      setCarregando(false);
    }
  }, [token]);

  useEffect(() => {
    if (!token) return;
    carregar();
    const t = setInterval(carregar, 15000);
    const onVis = () => {
      if (typeof document !== 'undefined' && !document.hidden) carregar();
    };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      clearInterval(t);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [carregar, token]);

  // Reconcilia marcadores (entregador + destino) e enquadra na 1ª vez.
  useEffect(() => {
    const L = Lref.current;
    const map = mapObj.current;
    if (!pronto || !L || !map || !dados) return;
    const pts: [number, number][] = [];

    if (dados.destino) {
      const pos: [number, number] = [dados.destino.lat, dados.destino.lng];
      pts.push(pos);
      const html =
        `<div style="transform:translate(-50%,-100%);display:flex;flex-direction:column;align-items:center;">` +
        `<div style="background:${NAVY};color:#fff;font:600 12px/1 system-ui,sans-serif;padding:5px 9px;border-radius:999px;box-shadow:0 2px 6px rgba(0,0,0,.3);">📍 Você</div>` +
        `<div style="width:2px;height:9px;background:${NAVY};"></div></div>`;
      const icon = L.divIcon({ className: '', html, iconSize: [0, 0], iconAnchor: [0, 0] });
      if (destMk.current) destMk.current.setLatLng(pos).setIcon(icon);
      else destMk.current = L.marker(pos, { icon }).addTo(map);
    }

    const dp = dados.entregador?.pos;
    if (dp) {
      const pos: [number, number] = [dp.lat, dp.lng];
      pts.push(pos);
      const html =
        `<div style="transform:translate(-50%,-100%);display:flex;flex-direction:column;align-items:center;">` +
        `<div style="background:${OURO};color:${NAVY};font:600 12px/1 system-ui,sans-serif;padding:5px 9px;border-radius:999px;box-shadow:0 2px 6px rgba(0,0,0,.3);">🛵 Entregador</div>` +
        `<div style="width:2px;height:9px;background:${OURO};"></div></div>`;
      const icon = L.divIcon({ className: '', html, iconSize: [0, 0], iconAnchor: [0, 0] });
      if (driverMk.current) driverMk.current.setLatLng(pos).setIcon(icon);
      else driverMk.current = L.marker(pos, { icon }).addTo(map);
    }

    if (pts.length && !enquadrado.current) {
      if (pts.length === 1) map.setView(pts[0], 15);
      else map.fitBounds(pts, { padding: [60, 60], maxZoom: 16 });
      enquadrado.current = true;
    }
  }, [dados, pronto]);

  const entregue = dados && ['entregue', 'concluido'].includes(dados.status);

  return (
    <main style={{ minHeight: '100dvh', background: '#eef1f5', color: NAVY, fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ maxWidth: 560, margin: '0 auto', padding: '18px 16px 40px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
          <span style={{ fontSize: 22 }}>🛵</span>
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '.08em', color: '#7a8a9c', textTransform: 'uppercase' }}>
              Acompanhe sua entrega
            </div>
            <div style={{ fontSize: 18, fontWeight: 800 }}>
              {dados?.numero != null ? `Pedido #${dados.numero}` : 'Rastreio'}
            </div>
          </div>
        </div>

        {carregando && !dados ? (
          <p style={{ color: '#7a8a9c' }}>Carregando…</p>
        ) : erro ? (
          <div style={{ background: '#fff', border: '1px solid #d9e0e8', borderRadius: 14, padding: 24, textAlign: 'center' }}>
            <p style={{ fontSize: 15 }}>{erro}</p>
            <p style={{ fontSize: 13, color: '#7a8a9c', marginTop: 6 }}>Confira o link com a loja.</p>
          </div>
        ) : dados ? (
          <>
            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: 8,
                alignItems: 'center',
                marginBottom: 12,
              }}
            >
              <span
                style={{
                  background: entregue ? '#d7ece5' : '#f8ecd6',
                  color: entregue ? '#0e7c66' : '#7a5011',
                  border: `1px solid ${entregue ? '#0e7c66' : OURO}`,
                  borderRadius: 999,
                  padding: '5px 12px',
                  fontSize: 13,
                  fontWeight: 700,
                }}
              >
                {entregue ? '✅ ' : '🛵 '}
                {dados.statusLabel}
              </span>
              {dados.parada && (
                <span style={{ fontSize: 13, color: '#48586a', fontWeight: 600 }}>
                  Parada {dados.parada.x} de {dados.parada.y}
                </span>
              )}
              {dados.etaMin != null && !entregue && (
                <span style={{ fontSize: 13, color: '#48586a', fontWeight: 600 }}>· ~{dados.etaMin} min</span>
              )}
            </div>

            {dados.codigoEntrega && (
              <div
                style={{
                  background: '#f8ecd6',
                  border: `1px solid ${OURO}`,
                  borderRadius: 12,
                  padding: '12px 16px',
                  marginBottom: 12,
                  textAlign: 'center',
                }}
              >
                <div style={{ fontSize: 12, color: '#7a5011', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.08em' }}>
                  Código de entrega
                </div>
                <div style={{ fontSize: 32, fontWeight: 800, letterSpacing: '.25em', color: NAVY, fontFamily: 'ui-monospace, monospace', marginTop: 2 }}>
                  {dados.codigoEntrega}
                </div>
                <div style={{ fontSize: 12.5, color: '#48586a', marginTop: 2 }}>
                  Informe este código ao entregador para confirmar a entrega.
                </div>
              </div>
            )}

            <div style={{ background: '#fff', border: '1px solid #d9e0e8', borderRadius: 14, overflow: 'hidden', boxShadow: '0 8px 24px rgba(15,34,48,.06)' }}>
              <div ref={mapEl} style={{ height: 360, width: '100%' }} />
            </div>

            <p style={{ fontSize: 13, color: '#48586a', marginTop: 12 }}>
              {entregue
                ? 'Seu pedido foi entregue. Bom apetite! 🍽️'
                : dados.entregador?.pos
                ? `${dados.entregador?.nome ? `${dados.entregador.nome} está` : 'O entregador está'} a caminho — a posição atualiza sozinha.`
                : 'Assim que o entregador sair para o seu endereço, você o verá se movendo aqui.'}
            </p>
          </>
        ) : null}
      </div>
    </main>
  );
}
