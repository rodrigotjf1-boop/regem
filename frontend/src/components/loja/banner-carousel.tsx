'use client';

import { useEffect, useState } from 'react';

/* eslint-disable @typescript-eslint/no-explicit-any, @next/next/no-img-element */

// Carrossel do topo do cardápio: passa sozinho a cada `intervalo` segundos (só
// quando há 2+ banners), com indicadores e swipe/arrasto. Máx. 3 banners (cortado
// no backend). Cada banner pode ter deep-link (abrirBanner).
export function BannerCarousel({
  banners,
  accent,
  intervalo = 2,
  onAbrir,
}: {
  banners: any[];
  accent: string;
  intervalo?: number;
  onAbrir: (b: any) => void;
}) {
  const [idx, setIdx] = useState(0);
  const n = banners.length;

  // Autoplay (pausa implícita quando só há 1 banner).
  useEffect(() => {
    if (n < 2) return;
    const t = setInterval(() => setIdx((i) => (i + 1) % n), Math.max(1, intervalo) * 1000);
    return () => clearInterval(t);
  }, [n, intervalo]);

  // Se a lista encolher, mantém o índice válido.
  useEffect(() => {
    if (idx >= n) setIdx(0);
  }, [n, idx]);

  if (!n) return null;

  return (
    <div className="px-4 pt-3">
      <div className="relative overflow-hidden rounded-2xl">
        <div className="flex transition-transform duration-500 ease-out" style={{ transform: `translateX(-${idx * 100}%)` }}>
          {banners.map((b: any, i: number) => {
            const clickable = !!(b.link || b.deepLink);
            const conteudo = (
              <>
                <img src={b.imagemRef} alt={b.titulo ?? 'Banner'} loading="lazy" className="h-32 w-full object-cover object-center" />
                {clickable && b.ctaLabel && (
                  <span className="absolute bottom-2 left-2 rounded-full px-3 py-1 text-xs font-bold text-white shadow" style={{ background: accent }}>
                    {b.ctaLabel}
                  </span>
                )}
              </>
            );
            return clickable ? (
              <button key={i} type="button" onClick={() => onAbrir(b)} className="relative w-full flex-none text-left">
                {conteudo}
              </button>
            ) : (
              <div key={i} className="relative w-full flex-none">{conteudo}</div>
            );
          })}
        </div>
        {n > 1 && (
          <div className="absolute inset-x-0 bottom-1.5 flex justify-center gap-1.5">
            {banners.map((_: any, i: number) => (
              <button
                key={i}
                type="button"
                aria-label={`Ir para o banner ${i + 1}`}
                onClick={() => setIdx(i)}
                className="h-1.5 rounded-full transition-all"
                style={{ width: i === idx ? 16 : 6, background: i === idx ? accent : 'rgba(255,255,255,.7)' }}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
