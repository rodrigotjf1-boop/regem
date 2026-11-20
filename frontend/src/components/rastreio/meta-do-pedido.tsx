'use client';

import { useEffect, useState } from 'react';

// A META DO MÊS na página do pedido (`/r/…`), depois da entrega (fase A3 do `docs/plano-clube-e-banner.md`; protótipo
// `mockups/regem-clube-banner.html`, "No cardápio" › 3). Sem login: o token do link é o do pedido. O servidor diz se a meta
// está ligada e o pedido é deste mês (GET /rastreio/:token/meta); senão, nada aparece. O prêmio se escolhe em Sua conta.

const NAVY = '#0F2230';
const CINZA = '#48586a';
const BORDA = '#d9e0e8';
const OURO = '#E2A340';
const ORDINAL = ['primeiro', 'segundo', 'terceiro'];

type Meta =
  | { tem: false }
  | { tem: true; mesNome: string; pedidos: number; proximo: { nivel: number; pedidos: number; falta: number } | null; pendente: boolean; niveis: number[] };

function apiBase(): string {
  return process.env.NEXT_PUBLIC_API_URL || 'https://api.dmsregem.com/api/v1';
}

export function MetaDoPedido({ token }: { token: string }) {
  const [meta, setMeta] = useState<Meta>({ tem: false });

  useEffect(() => {
    let vivo = true;
    fetch(`${apiBase()}/rastreio/${encodeURIComponent(token)}/meta`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : { tem: false }))
      .then((d: Meta) => {
        if (vivo) setMeta(d?.tem ? d : { tem: false });
      })
      // Sem a meta não há o que mostrar: a página do pedido segue igual.
      .catch(() => undefined);
    return () => {
      vivo = false;
    };
  }, [token]);

  if (!meta.tem) return null;
  const topo = meta.niveis[meta.niveis.length - 1] ?? 1;
  const largura = Math.min(100, Math.round((meta.pedidos / topo) * 100));
  const frase = meta.pendente
    ? 'Você bateu a meta! Escolha o seu prêmio em Sua conta, no cardápio.'
    : meta.proximo
      ? `${meta.pedidos} ${meta.pedidos === 1 ? 'pedido' : 'pedidos'} de ${meta.proximo.pedidos} para o ${ORDINAL[meta.proximo.nivel - 1] ?? 'próximo'} prêmio.`
      : 'Você bateu todos os níveis deste mês!';
  return (
    <div
      role="status"
      style={{ background: '#fff', border: `1px solid ${BORDA}`, borderRadius: 14, padding: 20, marginTop: 12, boxShadow: '0 8px 24px rgba(15,34,48,.06)', display: 'grid', gap: 8 }}
    >
      <p style={{ margin: 0, fontSize: 15, fontWeight: 700, color: NAVY }}>Meta de {meta.mesNome}</p>
      <p style={{ margin: 0, fontSize: 13, color: CINZA }}>{frase}</p>
      <div role="img" aria-label={`${meta.pedidos} de ${topo} pedidos`} style={{ height: 10, borderRadius: 999, background: '#EDF0F4', overflow: 'hidden' }}>
        <span style={{ display: 'block', height: '100%', width: `${largura}%`, borderRadius: 999, background: OURO }} />
      </div>
    </div>
  );
}
