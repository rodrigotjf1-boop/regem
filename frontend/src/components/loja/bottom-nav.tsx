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
  menuTheme = 'classic',
  onBuscar,
  total,
}: {
  aba: LojaAba;
  onAba: (a: LojaAba) => void;
  accent: string;
  carrinhoQtd: number;
  menuTheme?: string;
  onBuscar?: () => void;
  total?: number;
}) {
  // Fastfood e Grid: 5 posições com o Carrinho central em destaque.
  // Grid = "dock" flutuante (pílula com margem); fastfood = barra cheia.
  if (menuTheme === 'fastfood' || menuTheme === 'grid') {
    const dock = menuTheme === 'grid';
    const item = (on: boolean, icon: string, label: string, onClick: () => void, key: string) => (
      <button key={key} type="button" onClick={onClick} aria-current={on ? 'page' : undefined}
        className="relative flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] font-medium" style={{ color: on ? accent : '#7a7a7a' }}>
        <span className="text-lg leading-none">{icon}</span>
        {label}
      </button>
    );
    const inner = (
      <div className={`mx-auto flex max-w-2xl items-end ${dock ? 'rounded-3xl border border-black/5 bg-white px-1 shadow-[0_10px_30px_-12px_rgba(0,0,0,.35)]' : ''}`}>
        {item(aba === 'inicio', '🏠', 'Início', () => onAba('inicio'), 'inicio')}
        {item(false, '🔍', 'Buscar', () => onBuscar?.(), 'buscar')}
        {/* Carrinho central em destaque */}
        <button type="button" onClick={() => onAba('carrinho')} className="relative -mt-5 flex flex-1 flex-col items-center">
          <span className="relative grid h-14 w-14 place-items-center rounded-full text-2xl text-white shadow-lg" style={{ background: accent }}>
            🛒
            {carrinhoQtd > 0 && (
              <span className="absolute -right-0.5 -top-0.5 grid h-5 w-5 place-items-center rounded-full border-2 border-white bg-neutral-900 text-[10px] font-bold text-white">{carrinhoQtd}</span>
            )}
          </span>
          <span className="mt-0.5 font-mono text-[10px] font-bold" style={{ color: accent }}>
            {(total ?? 0) > 0 ? (total ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : 'Carrinho'}
          </span>
        </button>
        {item(aba === 'pedidos', '🧾', 'Pedidos', () => onAba('pedidos'), 'pedidos')}
        {item(aba === 'promos', '🎁', 'Perfil', () => onAba('promos'), 'promos')}
      </div>
    );
    return (
      <nav className={dock ? 'fixed inset-x-0 bottom-0 z-40 px-3 pt-2' : 'fixed inset-x-0 bottom-0 z-40 border-t border-black/10 bg-white/95 backdrop-blur'}>
        {inner}
        <div className="h-[env(safe-area-inset-bottom)]" />
      </nav>
    );
  }

  // Classic: 4 abas (inalterado).
  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-black/10 bg-white/95 backdrop-blur">
      <div className="mx-auto flex max-w-2xl">
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
