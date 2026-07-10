'use client';

/* eslint-disable @typescript-eslint/no-explicit-any */
// Menu inferior do cardápio — aparece depois do 1º pedido (cliente identificado).
export type LojaAba = 'inicio' | 'pedidos' | 'promos' | 'carrinho';

const ABAS: { v: LojaAba; label: string; icon: string }[] = [
  { v: 'inicio', label: 'Início', icon: '🏠' },
  { v: 'pedidos', label: 'Pedidos', icon: '🧾' },
  { v: 'promos', label: 'Promos', icon: '🎁' },
  { v: 'carrinho', label: 'Carrinho', icon: '🛒' },
];

export function LojaBottomNav({
  aba,
  onAba,
  accent,
  carrinhoQtd,
}: {
  aba: LojaAba;
  onAba: (a: LojaAba) => void;
  accent: string;
  carrinhoQtd: number;
}) {
  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-black/10 bg-white/95 backdrop-blur">
      <div className="mx-auto flex max-w-lg">
        {ABAS.map((a) => {
          const on = aba === a.v;
          return (
            <button
              key={a.v}
              type="button"
              onClick={() => onAba(a.v)}
              aria-current={on ? 'page' : undefined}
              className="relative flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] font-medium"
              style={{ color: on ? accent : '#7a7a7a' }}
            >
              <span className="text-lg leading-none">{a.icon}</span>
              {a.label}
              {a.v === 'carrinho' && carrinhoQtd > 0 && (
                <span
                  className="absolute right-1/2 top-1 translate-x-4 rounded-full px-1.5 text-[10px] font-bold text-white"
                  style={{ background: accent }}
                >
                  {carrinhoQtd}
                </span>
              )}
            </button>
          );
        })}
      </div>
      <div className="h-[env(safe-area-inset-bottom)]" />
    </nav>
  );
}
