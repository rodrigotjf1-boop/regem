'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/* eslint-disable @typescript-eslint/no-explicit-any */

// O PRÊMIO SURPRESA na página do pedido (`/r/…`), depois da entrega (fase A1 do `docs/plano-clube-e-banner.md`, mig 474;
// protótipo `mockups/regem-clube-banner.html`, "No cardápio" › 1 e 2). Sem login: o token do link é o do pedido. O
// prêmio já foi definido quando o cliente ganhou (o pedido entregue): a raspadinha e a roleta só MOSTRAM — a tela diz isso.
// O servidor decide se há prêmio (GET /rastreio/:token/premio) e só entrega qual é ao revelar (POST …/premio/revelar).

const NAVY = '#0F2230';
const OURO = '#E2A340';
const CINZA = '#48586a';
const BORDA = '#d9e0e8';
const MARROM = '#5B3A10';
const FATIAS_CORES = ['#F7D488', '#F3B3A6'];

type Premio = { nome: string; descricao: string; codigo: string | null; validoAte: string; usado: boolean; vencido: boolean };
type Dados =
  | { tem: false }
  | { tem: true; forma: 'raspadinha' | 'roleta'; revelado: boolean; fatias: string[]; premio: Premio | null; fatia: number | null; regras: string[] };

const cartao: React.CSSProperties = {
  background: '#fff',
  border: `1px solid ${BORDA}`,
  borderRadius: 14,
  padding: 20,
  marginTop: 12,
  boxShadow: '0 8px 24px rgba(15,34,48,.06)',
  display: 'grid',
  gap: 10,
};
const botaoPrincipal: React.CSSProperties = {
  width: '100%',
  minHeight: 46,
  borderRadius: 10,
  border: 'none',
  background: OURO,
  color: NAVY,
  fontWeight: 800,
  fontSize: 15,
  cursor: 'pointer',
};
const link: React.CSSProperties = {
  background: 'none',
  border: 'none',
  padding: 0,
  minHeight: 44,
  color: '#0B5CAD',
  fontWeight: 700,
  fontSize: 14,
  textDecoration: 'underline',
  cursor: 'pointer',
  justifySelf: 'start',
};

function apiBase(): string {
  return process.env.NEXT_PUBLIC_API_URL || 'https://api.dmsregem.com/api/v1';
}
const menosMovimento = () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
const diaMes = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

/** O cupom revelado: o código, a validade e se já foi usado ou venceu. */
function OCupom({ p }: { p: Premio }) {
  const situacao = p.usado ? 'Já usado' : p.vencido ? `Venceu em ${diaMes(p.validoAte)}` : `Vale até ${diaMes(p.validoAte)}`;
  return (
    <div style={{ display: 'grid', gap: 8 }} aria-live="polite">
      <p style={{ margin: 0, textAlign: 'center', color: NAVY }}>
        <b>{p.nome}</b>
        <br />
        <span style={{ fontSize: 13, color: CINZA }}>{p.descricao}</span>
      </p>
      {p.codigo && (
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: '6px 10px',
            alignItems: 'center',
            justifyContent: 'space-between',
            border: '1px dashed #C9A36A',
            background: '#FFFBF2',
            borderRadius: 10,
            padding: '8px 10px',
          }}
        >
          <code style={{ fontFamily: 'ui-monospace, monospace', fontWeight: 700, fontSize: 15, letterSpacing: '.06em', color: MARROM, overflowWrap: 'anywhere' }}>
            {p.codigo}
          </code>
          <span style={{ fontSize: 13, color: p.usado || p.vencido ? CINZA : MARROM }}>{situacao}</span>
        </div>
      )}
      {!p.usado && !p.vencido && (
        <p style={{ margin: 0, fontSize: 13, color: CINZA }}>
          Está guardado na sua conta do cardápio (Benefícios): no próximo pedido, toque em Usar ou digite o código. Só você usa.
        </p>
      )}
    </div>
  );
}

function Regras({ regras }: { regras: string[] }) {
  if (!regras.length) return null;
  return (
    <details style={{ fontSize: 13, color: CINZA }}>
      <summary style={{ cursor: 'pointer', color: '#0B5CAD', fontWeight: 700, minHeight: 32 }}>Regras do clube</summary>
      <ul style={{ margin: '6px 0 0', paddingLeft: 18, display: 'grid', gap: 4 }}>
        {regras.map((r) => (
          <li key={r}>{r}</li>
        ))}
      </ul>
    </details>
  );
}

/** A raspadinha: a camada cinza no canvas; raspar metade (ou "Revelar sem raspar") mostra o prêmio. */
function Raspadinha({ premio, aoComecar, revelado, aoTerminar }: { premio: Premio | null; aoComecar: () => void; revelado: boolean; aoTerminar: () => void }) {
  const caixa = useRef<HTMLDivElement | null>(null);
  const tela = useRef<HTMLCanvasElement | null>(null);
  const comecou = useRef(false);

  const pintar = useCallback(() => {
    const c = tela.current;
    const r = caixa.current?.getBoundingClientRect();
    if (!c || !r || !r.width) return;
    c.width = Math.round(r.width);
    c.height = Math.round(r.height);
    const g = c.getContext('2d');
    if (!g) return;
    g.globalCompositeOperation = 'source-over';
    const grad = g.createLinearGradient(0, 0, c.width, c.height);
    grad.addColorStop(0, '#B9BEC4');
    grad.addColorStop(0.5, '#DADDE1');
    grad.addColorStop(1, '#A9AEB5');
    g.fillStyle = grad;
    g.fillRect(0, 0, c.width, c.height);
    g.fillStyle = '#3F474F';
    g.font = '700 16px Figtree, system-ui, sans-serif';
    g.textAlign = 'center';
    g.fillText('Raspe aqui', c.width / 2, c.height / 2 + 6);
  }, []);

  useEffect(() => {
    if (revelado) return;
    pintar();
    const el = caixa.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => {
      if (!comecou.current) pintar();
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [pintar, revelado]);

  function raspar(e: React.PointerEvent<HTMLCanvasElement>, primeiro = false) {
    if (revelado) return;
    if (!primeiro && e.pointerType === 'mouse' && !(e.buttons & 1)) return;
    if (!comecou.current) {
      comecou.current = true;
      aoComecar(); // pede o prêmio ao servidor no primeiro toque (ele já existe; só não foi mostrado)
    }
    const c = tela.current;
    const g = c?.getContext('2d');
    if (!c || !g) return;
    const r = c.getBoundingClientRect();
    g.globalCompositeOperation = 'destination-out';
    g.beginPath();
    g.arc(e.clientX - r.left, e.clientY - r.top, 20, 0, Math.PI * 2);
    g.fill();
    const d = g.getImageData(0, 0, c.width, c.height).data;
    let vazio = 0;
    let total = 0;
    for (let i = 3; i < d.length; i += 4 * 40) {
      total += 1;
      if (d[i] === 0) vazio += 1;
    }
    if (total && vazio / total > 0.5) aoTerminar();
  }

  return (
    <div
      ref={caixa}
      style={{
        position: 'relative',
        borderRadius: 12,
        overflow: 'hidden',
        aspectRatio: '2 / 1',
        maxWidth: '100%',
        background: 'linear-gradient(135deg,#FFF4D6,#FFE2A8)',
        border: '2px dashed #D9A441',
        display: 'grid',
        placeItems: 'center',
        textAlign: 'center',
        padding: 10,
        touchAction: 'none',
      }}
    >
      <div style={{ display: 'grid', gap: 2 }}>
        <b style={{ fontSize: 22, fontWeight: 800, color: '#7A3B07' }}>{premio ? premio.nome : '🎁'}</b>
        {premio && <span style={{ fontSize: 12.5, color: '#6B4A1E' }}>{premio.descricao}</span>}
      </div>
      {!revelado && (
        <canvas
          ref={tela}
          aria-hidden="true"
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', cursor: 'pointer', borderRadius: 10 }}
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture?.(e.pointerId);
            raspar(e, true);
          }}
          onPointerMove={(e) => raspar(e)}
        />
      )}
    </div>
  );
}

/** Uma fatia da roleta no `viewBox` −100…100: do ângulo `a0` ao `a1` (graus, no sentido do relógio a partir do topo). */
function caminhoDaFatia(a0: number, a1: number): string {
  const p = (a: number) => [96 * Math.sin((a * Math.PI) / 180), -96 * Math.cos((a * Math.PI) / 180)].map((n) => n.toFixed(2)).join(' ');
  return `M0 0 L${p(a0)} A96 96 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${p(a1)} Z`;
}
const curto = (s: string) => (s.length > 14 ? `${s.slice(0, 13)}…` : s);

/** A roleta: as fatias da lista da loja; girar pede o prêmio e a roda para na fatia dele. */
function Roleta({ fatias, fatia, girando, aoGirar, aoParar }: { fatias: string[]; fatia: number | null; girando: boolean; aoGirar: () => void; aoParar: () => void }) {
  const seg = 360 / Math.max(1, fatias.length);
  // O centro da fatia do cliente sob o ponteiro (no topo): a roda gira de volta até ele, depois de 5 voltas inteiras.
  const alvo = fatia == null ? 0 : 360 - (fatia * seg + seg / 2);
  const angulo = fatia == null ? 0 : girando && !menosMovimento() ? 360 * 5 + alvo : alvo;
  const parou = fatia != null && !girando;
  return (
    <div style={{ display: 'grid', justifyItems: 'center', gap: 12 }}>
      <div style={{ position: 'relative', width: 'min(100%, 240px)', aspectRatio: '1' }}>
        <span
          aria-hidden="true"
          style={{
            position: 'absolute',
            left: '50%',
            top: -6,
            transform: 'translateX(-50%)',
            width: 0,
            height: 0,
            borderLeft: '12px solid transparent',
            borderRight: '12px solid transparent',
            borderTop: '20px solid #2A1A12',
            zIndex: 1,
          }}
        />
        <svg
          viewBox="-100 -100 200 200"
          role="img"
          aria-label={`Roleta com ${fatias.length} prêmios: ${[...new Set(fatias)].join(', ')}`}
          style={{
            width: '100%',
            height: '100%',
            display: 'block',
            transform: `rotate(${angulo}deg)`,
            transition: girando && !menosMovimento() ? 'transform 3.2s cubic-bezier(.17,.67,.21,1)' : 'none',
          }}
          onTransitionEnd={() => girando && aoParar()}
        >
          {fatias.map((nome, i) => (
            <path key={`f${i}`} d={caminhoDaFatia(i * seg, (i + 1) * seg)} fill={FATIAS_CORES[i % 2]} />
          ))}
          <circle r="96" fill="none" stroke="#2A1A12" strokeWidth="3" />
          {fatias.map((nome, i) => (
            <text
              key={`t${i}`}
              transform={`rotate(${i * seg + seg / 2}) translate(0 -60)`}
              textAnchor="middle"
              style={{ fontSize: 10, fontWeight: 700, fill: '#2A1A12', fontFamily: 'Figtree, system-ui, sans-serif' }}
            >
              {curto(nome)}
            </text>
          ))}
          <circle r="14" fill="#2A1A12" />
        </svg>
      </div>
      {!parou && (
        <button type="button" style={{ ...botaoPrincipal, maxWidth: 320 }} onClick={aoGirar} disabled={girando || fatia != null}>
          {girando || fatia != null ? 'Girando…' : 'Girar'}
        </button>
      )}
    </div>
  );
}

export function PremioDoPedido({ token }: { token: string }) {
  const [dados, setDados] = useState<Dados | null>(null);
  const [premio, setPremio] = useState<Premio | null>(null);
  const [fatia, setFatia] = useState<number | null>(null);
  const [mostrar, setMostrar] = useState(false);
  const [girando, setGirando] = useState(false);
  const [falhou, setFalhou] = useState(false);
  const pedindo = useRef<Promise<void> | null>(null);

  useEffect(() => {
    let vivo = true;
    fetch(`${apiBase()}/rastreio/${encodeURIComponent(token)}/premio`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: Dados | null) => {
        if (!vivo || !d) return;
        setDados(d);
        if (d.tem && d.revelado && d.premio) {
          setPremio(d.premio);
          setFatia(d.fatia);
          setMostrar(true);
        }
      })
      .catch(() => {
        /* sem o estado, a página segue sem o prêmio (nada de jogo que não revela) */
      });
    return () => {
      vivo = false;
    };
  }, [token]);

  /** Pede ao servidor o prêmio (uma vez; tocar de novo reaproveita o pedido em curso). */
  const revelar = useCallback((): Promise<void> => {
    if (pedindo.current) return pedindo.current;
    setFalhou(false);
    pedindo.current = fetch(`${apiBase()}/rastreio/${encodeURIComponent(token)}/premio/revelar`, { method: 'POST' })
      .then(async (r) => {
        if (!r.ok) throw new Error(String(r.status));
        const d = (await r.json()) as Dados;
        if (!d.tem || !d.premio) throw new Error('sem prêmio');
        setPremio(d.premio);
        setFatia(d.fatia);
      })
      .catch(() => {
        pedindo.current = null;
        setFalhou(true);
        setGirando(false);
      });
    return pedindo.current;
  }, [token]);

  if (!dados || !dados.tem) return null;
  const roleta = dados.forma === 'roleta';

  return (
    <section style={cartao} aria-labelledby="premio-titulo">
      <h2 id="premio-titulo" style={{ margin: 0, fontSize: 17, color: NAVY, textAlign: roleta ? 'center' : 'left' }}>
        {mostrar && premio
          ? '🎉 Seu prêmio'
          : roleta
            ? 'Gire para descobrir o seu prêmio'
            : '🎁 Você ganhou uma raspadinha'}
      </h2>
      {!mostrar && (
        <p style={{ margin: 0, fontSize: 13.5, color: CINZA, textAlign: roleta ? 'center' : 'left' }}>
          {roleta ? 'Ele já foi escolhido para você: a roleta só mostra.' : 'Seu prêmio já está garantido. Raspe para ver.'}
        </p>
      )}

      {roleta ? (
        <Roleta
          fatias={dados.fatias}
          fatia={fatia}
          girando={girando}
          aoGirar={() => {
            setGirando(true);
            void revelar().then(() => {
              if (menosMovimento()) {
                setGirando(false);
                setMostrar(true);
              }
            });
          }}
          aoParar={() => {
            setGirando(false);
            setMostrar(true);
          }}
        />
      ) : (
        <>
          <Raspadinha
            premio={premio}
            revelado={mostrar}
            aoComecar={() => void revelar()}
            aoTerminar={() => void revelar().then(() => setMostrar(!!pedindo.current))}
          />
          {!mostrar && (
            <button type="button" style={link} onClick={() => void revelar().then(() => setMostrar(!!pedindo.current))}>
              Revelar sem raspar
            </button>
          )}
        </>
      )}

      {falhou && (
        <p role="alert" style={{ margin: 0, fontSize: 13.5, color: '#9B1C1C' }}>
          Não deu para revelar agora. Tente de novo em instantes: o prêmio continua garantido.
        </p>
      )}
      {mostrar && premio && <OCupom p={premio} />}
      <Regras regras={dados.regras} />
    </section>
  );
}
