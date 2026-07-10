'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { brl } from './tipos';

/* eslint-disable @typescript-eslint/no-explicit-any */
// Aba Promos: cupons vigentes, fidelidade e produtos em promoção (do menu).
export function PromosPanel({
  token,
  produtosPromo,
  accent,
}: {
  token: string;
  produtosPromo: any[];
  accent: string;
}) {
  const [data, setData] = useState<any>(null);

  useEffect(() => {
    api.cardapioPromos(token).then(setData).catch(() => setData({ cupons: [], fidelidadeAtiva: false }));
  }, [token]);

  const cupomLabel = (c: any) =>
    c.tipo === 'percentual' ? `${c.valor}% OFF` : `${brl(c.valor)} OFF`;

  const nada =
    data && !data.fidelidadeAtiva && (data.cupons?.length ?? 0) === 0 && produtosPromo.length === 0;

  return (
    <div className="space-y-5 px-4 py-4">
      <h2 className="text-lg font-bold">Promoções</h2>

      {data?.fidelidadeAtiva && (
        <div className="rounded-2xl p-4 text-white" style={{ background: accent }}>
          <p className="text-sm font-bold">⭐ Programa de fidelidade</p>
          <p className="mt-0.5 text-xs opacity-90">Você acumula pontos a cada pedido — use como desconto.</p>
        </div>
      )}

      {(data?.cupons?.length ?? 0) > 0 && (
        <div>
          <p className="mb-2 text-sm font-semibold">Cupons</p>
          <div className="space-y-2">
            {data.cupons.map((c: any) => (
              <div key={c.codigo} className="flex items-center gap-3 rounded-xl border border-dashed border-black/20 px-3.5 py-2.5">
                <span className="text-xl">🎟️</span>
                <div className="min-w-0 flex-1">
                  <p className="font-bold" style={{ color: accent }}>{c.codigo}</p>
                  <p className="text-xs text-black/50">
                    {cupomLabel(c)}
                    {c.minimo ? ` · mín. ${brl(c.minimo)}` : ''}
                    {c.validade ? ` · até ${new Date(c.validade).toLocaleDateString('pt-BR')}` : ''}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => navigator.clipboard?.writeText(c.codigo)}
                  className="flex-none rounded-lg border border-black/15 px-2.5 py-1 text-xs font-semibold"
                >
                  copiar
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {produtosPromo.length > 0 && (
        <div>
          <p className="mb-2 text-sm font-semibold">Ofertas do dia</p>
          <div className="space-y-2">
            {produtosPromo.map((p: any) => (
              <div key={p.id} className="flex items-center gap-3 rounded-xl border border-black/10 px-3.5 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{p.nome}</p>
                  <p className="text-xs">
                    <span className="font-bold" style={{ color: accent }}>{brl(p.precoVenda)}</span>{' '}
                    <span className="text-black/40 line-through">{brl(p.precoDe)}</span>
                  </p>
                </div>
                <span className="flex-none rounded-lg px-2 py-0.5 text-[11px] font-bold text-white" style={{ background: accent }}>
                  -{Math.round((1 - p.precoVenda / p.precoDe) * 100)}%
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {nada && <p className="text-sm text-black/50">Nenhuma promoção ativa no momento.</p>}
    </div>
  );
}
