'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';

/* eslint-disable @typescript-eslint/no-explicit-any */

// "COMO FOI O PEDIDO?" — a nota do pedido na página do rastreio (`/r/…`), depois da entrega (mig 453, fase A1 do protótipo
// `mockups/regem-avaliacao-pedido.html`, aba "Página do pedido"). Sem login: o token do link é o do pedido. Só aparece se a
// loja ligou "Pedir uma nota depois da entrega", em pedido do Regem; o servidor decide (GET /rastreio/:token/avaliacao) e
// grava UMA vez (POST). O link do Google só volta com a nota 5 (decisão do dono, 18/11/2026).

const NAVY = '#0F2230';
const OURO = '#E2A340';
const CINZA = '#48586a';
const SUAVE = '#5b6b7c'; // ~5,5:1 no branco (o #7a8a9c da página fica em ~3,5:1 — texto pequeno pede 4,5)
const BORDA = '#d9e0e8';
const NOMES = ['', 'Péssimo', 'Ruim', 'Regular', 'Bom', 'Excelente'];
const COMENTARIO_MAX = 300;

type Estado = {
  situacao: 'desligado' | 'fora' | 'nao_entregue' | 'aberta' | 'avaliado' | 'encerrada';
  loja: string | null;
  prazoDias: number;
  ate: string | null;
  opcoes: string[];
  feita: { nota: number; origem: string; em: string } | null;
  google: string | null;
};
/** Depois de enviar: o obrigado (com o Google na nota 5) ou o "sinto muito" da nota que abriu caso. */
type Enviado = { nota: number; caso: boolean; google: string | null };

const cartao: React.CSSProperties = {
  background: '#fff',
  border: `1px solid ${BORDA}`,
  borderRadius: 14,
  padding: 20,
  marginTop: 12,
  boxShadow: '0 8px 24px rgba(15,34,48,.06)',
};
const centro: React.CSSProperties = { ...cartao, textAlign: 'center', display: 'grid', gap: 6, justifyItems: 'center' };
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
const botaoGoogle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: '100%',
  minHeight: 44,
  marginTop: 8,
  borderRadius: 10,
  border: `1px solid ${BORDA}`,
  background: '#fff',
  color: '#0B5CAD',
  fontWeight: 700,
  fontSize: 14,
  textDecoration: 'none',
};

function apiBase(): string {
  return process.env.NEXT_PUBLIC_API_URL || 'https://api.dmsregem.com/api/v1';
}

/** "hoje às 20:54" ou "em 16/11 às 20:30", no fuso da operação. */
function quando(iso: string): string {
  const d = new Date(iso);
  const fuso = { timeZone: 'America/Sao_Paulo' } as const;
  const dia = d.toLocaleDateString('pt-BR', { ...fuso, day: '2-digit', month: '2-digit' });
  const hoje = new Date().toLocaleDateString('pt-BR', { ...fuso, day: '2-digit', month: '2-digit' });
  const hora = d.toLocaleTimeString('pt-BR', { ...fuso, hour: '2-digit', minute: '2-digit' });
  return dia === hoje ? `hoje às ${hora}` : `em ${dia} às ${hora}`;
}

function Estrelas({ n }: { n: number }) {
  return (
    <span aria-label={`nota ${n} de 5`} style={{ fontSize: 22, letterSpacing: 2, color: OURO }}>
      {'★'.repeat(n)}
      <span style={{ color: BORDA }}>{'★'.repeat(5 - n)}</span>
    </span>
  );
}

function BotaoGoogle({ link }: { link: string }) {
  return (
    <a href={link} target="_blank" rel="noopener noreferrer" style={botaoGoogle}>
      Contar também no Google
    </a>
  );
}

export function ComoFoiOPedido({ token }: { token: string }) {
  const [estado, setEstado] = useState<Estado | null>(null);
  const [nota, setNota] = useState(0);
  const [pesou, setPesou] = useState<string[]>([]);
  const [comentario, setComentario] = useState('');
  const [semNota, setSemNota] = useState(false);
  const [falhou, setFalhou] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [enviado, setEnviado] = useState<Enviado | null>(null);
  const estrelas = useRef<HTMLDivElement | null>(null);
  const id = useId();

  const ler = useCallback(async () => {
    try {
      const r = await fetch(`${apiBase()}/rastreio/${encodeURIComponent(token)}/avaliacao`, { cache: 'no-store' });
      if (!r.ok) return; // sem o estado, a página fica só com o "Pedido entregue" (nada de formulário que não grava)
      setEstado((await r.json()) as Estado);
    } catch {
      /* idem */
    }
  }, [token]);
  useEffect(() => {
    ler();
  }, [ler]);

  function marcar(n: number) {
    setNota(n);
    setSemNota(false);
  }
  function teclas(e: React.KeyboardEvent) {
    const sobe = e.key === 'ArrowRight' || e.key === 'ArrowUp';
    const desce = e.key === 'ArrowLeft' || e.key === 'ArrowDown';
    if (!sobe && !desce) return;
    e.preventDefault();
    const n = Math.min(5, Math.max(1, (nota || 0) + (sobe ? 1 : -1)));
    marcar(n);
    estrelas.current?.querySelector<HTMLButtonElement>(`[data-nota="${n}"]`)?.focus();
  }

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    if (!nota) {
      setSemNota(true);
      estrelas.current?.querySelector<HTMLButtonElement>('[data-nota="1"]')?.focus();
      return;
    }
    setEnviando(true);
    setFalhou(null);
    try {
      const r = await fetch(`${apiBase()}/rastreio/${encodeURIComponent(token)}/avaliacao`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nota, pesou, comentario: comentario.trim() || null }),
      });
      const j: any = await r.json().catch(() => null);
      if (r.status === 409) {
        await ler(); // já avaliado (outra aba, o WhatsApp): mostra a nota que ficou
        return;
      }
      if (!r.ok) {
        setFalhou(typeof j?.message === 'string' ? j.message : 'Não deu para enviar agora. Toque em "Enviar avaliação" de novo.');
        return;
      }
      setEnviado({ nota, caso: !!j?.caso, google: j?.google ?? null });
    } catch {
      setFalhou('Não deu para enviar agora. Confira a internet e toque em "Enviar avaliação" de novo — o que você escreveu continua aqui.');
    } finally {
      setEnviando(false);
    }
  }

  if (!estado) return null;
  const loja = estado.loja || 'a loja';

  if (enviado) {
    if (enviado.caso)
      return (
        <div style={centro} role="status">
          <span aria-hidden="true" style={{ fontSize: 34 }}>😔</span>
          <strong style={{ fontSize: 16 }}>Sinto muito pelo pedido.</strong>
          <span style={{ fontSize: 13.5, color: CINZA }}>A equipe da {loja} já recebeu a sua avaliação e vai falar com você pelo WhatsApp do pedido.</span>
        </div>
      );
    return (
      <div style={centro} role="status">
        <span aria-hidden="true" style={{ fontSize: 34 }}>💛</span>
        <strong style={{ fontSize: 16 }}>Obrigado pela nota!</strong>
        <span style={{ fontSize: 13.5, color: CINZA }}>
          Ela vai direto para a equipe da {loja}
          {enviado.google ? '.' : ' — é assim que a gente melhora.'}
        </span>
        {enviado.google && <BotaoGoogle link={enviado.google} />}
      </div>
    );
  }

  if (estado.situacao === 'avaliado' && estado.feita)
    return (
      <div style={centro}>
        <Estrelas n={estado.feita.nota} />
        <strong style={{ fontSize: 15 }}>Você já avaliou este pedido</strong>
        <span style={{ fontSize: 13, color: CINZA }}>
          {estado.feita.origem === 'whatsapp' ? 'Pelo WhatsApp' : 'Por esta página'}, {quando(estado.feita.em)}. Obrigado!
        </span>
        {estado.google && <BotaoGoogle link={estado.google} />}
      </div>
    );

  if (estado.situacao === 'encerrada')
    return (
      <div style={centro}>
        <strong style={{ fontSize: 15 }}>A avaliação deste pedido encerrou</strong>
        <span style={{ fontSize: 13, color: CINZA }}>
          Dá para avaliar até {estado.prazoDias} dias depois da entrega. Para falar com a loja, use o WhatsApp do pedido.
        </span>
      </div>
    );

  if (estado.situacao !== 'aberta') return null;

  return (
    <form style={{ ...cartao, display: 'grid', gap: 14 }} onSubmit={enviar} noValidate aria-labelledby={`${id}-titulo`}>
      <div>
        <h2 id={`${id}-titulo`} style={{ fontSize: 17, fontWeight: 800, margin: 0 }}>
          Como foi o pedido?
        </h2>
        <p style={{ fontSize: 13, color: CINZA, margin: '4px 0 0' }}>Sua nota vai direto para a equipe da {loja}.</p>
      </div>

      <div>
        <div
          ref={estrelas}
          role="radiogroup"
          aria-labelledby={`${id}-nota`}
          aria-describedby={semNota ? `${id}-sem-nota` : undefined}
          onKeyDown={teclas}
          style={{ display: 'flex', gap: 4, justifyContent: 'center' }}
        >
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              type="button"
              role="radio"
              data-nota={n}
              aria-checked={nota === n}
              aria-label={`${n} de 5 · ${NOMES[n]}`}
              tabIndex={n === (nota || 1) ? 0 : -1}
              onClick={() => marcar(n)}
              style={{
                width: 48,
                height: 48,
                fontSize: 34,
                lineHeight: 1,
                border: 'none',
                background: 'transparent',
                cursor: 'pointer',
                color: n <= nota ? OURO : BORDA,
              }}
            >
              ★
            </button>
          ))}
        </div>
        <p id={`${id}-nota`} style={{ textAlign: 'center', fontSize: 13.5, fontWeight: 700, margin: '4px 0 0' }}>
          {nota ? `${nota} de 5 · ${NOMES[nota]}` : 'Toque nas estrelas'}
        </p>
      </div>

      <fieldset style={{ border: 'none', padding: 0, margin: 0 }}>
        <legend style={{ fontSize: 13.5, fontWeight: 700, marginBottom: 6 }}>
          O que mais pesou? <span style={{ fontWeight: 400, color: SUAVE }}>(opcional)</span>
        </legend>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {estado.opcoes.map((o) => {
            const marcado = pesou.includes(o);
            return (
              <button
                key={o}
                type="button"
                aria-pressed={marcado}
                onClick={() => setPesou(marcado ? pesou.filter((x) => x !== o) : [...pesou, o])}
                style={{
                  minHeight: 36,
                  padding: '6px 12px',
                  borderRadius: 999,
                  border: `1px solid ${marcado ? NAVY : BORDA}`,
                  background: marcado ? NAVY : '#fff',
                  color: marcado ? '#fff' : NAVY,
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                {o}
              </button>
            );
          })}
        </div>
      </fieldset>

      <div style={{ display: 'grid', gap: 4 }}>
        <label htmlFor={`${id}-coment`} style={{ fontSize: 13.5, fontWeight: 700 }}>
          Quer contar mais? <span style={{ fontWeight: 400, color: SUAVE }}>(opcional)</span>
        </label>
        <textarea
          id={`${id}-coment`}
          maxLength={COMENTARIO_MAX}
          rows={3}
          value={comentario}
          placeholder="O que a loja precisa saber"
          onChange={(e) => setComentario(e.target.value)}
          style={{ width: '100%', boxSizing: 'border-box', borderRadius: 10, border: `1px solid ${BORDA}`, padding: 10, fontSize: 14, fontFamily: 'inherit', resize: 'vertical' }}
        />
        <span style={{ fontSize: 12, color: SUAVE, textAlign: 'right' }} aria-live="polite">
          {comentario.length} de {COMENTARIO_MAX}
        </span>
      </div>

      {semNota && (
        <p id={`${id}-sem-nota`} role="alert" style={{ margin: 0, fontSize: 13.5, fontWeight: 700, color: '#b42318' }}>
          Escolha uma nota de 1 a 5.
        </p>
      )}
      {falhou && (
        <p role="alert" style={{ margin: 0, padding: '10px 12px', borderRadius: 10, background: '#fdecea', color: '#8a1c13', fontSize: 13.5 }}>
          {falhou}
        </p>
      )}
      <button type="submit" disabled={enviando} style={{ ...botaoPrincipal, opacity: enviando ? 0.7 : 1 }}>
        {enviando ? 'Enviando…' : 'Enviar avaliação'}
      </button>
      <span style={{ fontSize: 12, color: SUAVE, textAlign: 'center' }}>
        A nota vai para a {loja}. Você pode avaliar até {estado.prazoDias} dias depois da entrega.
      </span>
    </form>
  );
}
