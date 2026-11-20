'use client';

import { useEffect, useState } from 'react';

// O SELO DO ÁLBUM na página do pedido (`/r/…`), depois da entrega (fase A2 do `docs/plano-clube-e-banner.md`, mig 479;
// protótipo `mockups/regem-clube-banner.html`, "No cardápio" › 3). Sem login: o token do link é o do pedido. O servidor
// diz se este pedido deu o selo do mês (GET /rastreio/:token/selo); sem álbum ligado ou sem selo, nada aparece.

const NAVY = '#0F2230';
const CINZA = '#48586a';
const BORDA = '#d9e0e8';
const MARROM = '#5B3A10';

type Selo = { tem: false } | { tem: true; mes: string; arte: string; selos: number; total: number; completo: boolean };

function apiBase(): string {
  return process.env.NEXT_PUBLIC_API_URL || 'https://api.dmsregem.com/api/v1';
}

export function SeloDoPedido({ token }: { token: string }) {
  const [selo, setSelo] = useState<Selo>({ tem: false });

  useEffect(() => {
    let vivo = true;
    fetch(`${apiBase()}/rastreio/${encodeURIComponent(token)}/selo`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : { tem: false }))
      .then((d: Selo) => {
        if (vivo) setSelo(d?.tem ? d : { tem: false });
      })
      // Sem o selo não há o que mostrar: a página do pedido segue igual.
      .catch(() => undefined);
    return () => {
      vivo = false;
    };
  }, [token]);

  if (!selo.tem) return null;
  return (
    <div
      role="status"
      style={{
        background: '#fff',
        border: `1px solid ${BORDA}`,
        borderRadius: 14,
        padding: 20,
        marginTop: 12,
        boxShadow: '0 8px 24px rgba(15,34,48,.06)',
        display: 'flex',
        gap: 14,
        alignItems: 'center',
      }}
    >
      <span
        aria-hidden="true"
        style={{
          flex: 'none',
          width: 56,
          height: 56,
          borderRadius: '50%',
          display: 'grid',
          placeItems: 'center',
          fontSize: 26,
          background: 'radial-gradient(circle at 35% 30%,#FFE7B0,#E8A845)',
          border: '2px solid #C8862A',
          color: MARROM,
        }}
      >
        {selo.arte}
      </span>
      <div style={{ minWidth: 0 }}>
        <p style={{ margin: 0, fontSize: 15, fontWeight: 700, color: NAVY }}>Você ganhou o selo de {selo.mes}</p>
        <p style={{ margin: '4px 0 0', fontSize: 13, color: CINZA }}>
          {selo.completo
            ? `Álbum completo: ${selo.selos} de ${selo.total}. Escolha o seu prêmio em Sua conta, no cardápio.`
            : `${selo.selos} de ${selo.total} selos no álbum.`}
        </p>
      </div>
    </div>
  );
}
