'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { MoreVertical } from 'lucide-react';

export type KebabItem = {
  label: string;
  icon?: React.ReactNode;
  onClick: () => void;
  destructive?: boolean;
  hidden?: boolean;
};

const MENU_W = 176; // min-w-44 (11rem)

// Menu de ações "⋮" (kebab) — botão + dropdown. Fecha ao clicar fora, Esc ou rolagem.
// O dropdown é renderizado em PORTAL com position:fixed para escapar de qualquer
// ancestral com overflow (lista com overflow-hidden / painel com overflow-y-auto),
// senão as opções ficam cortadas dentro da lista. Reusado em produtos, complementos,
// opções e categorias.
export function KebabMenu({
  items,
  label = 'Ações',
  className = '',
}: {
  items: KebabItem[];
  label?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  function posicionar() {
    const b = btnRef.current;
    if (!b) return;
    const r = b.getBoundingClientRect();
    // Alinha à direita do botão, sem estourar as bordas da viewport.
    const left = Math.max(8, Math.min(r.right - MENU_W, window.innerWidth - MENU_W - 8));
    // Abre para baixo; se não couber, abre para cima (evita corte no rodapé).
    const menuH = menuRef.current?.offsetHeight ?? 0;
    const abaixo = r.bottom + 4;
    const top = menuH && abaixo + menuH > window.innerHeight - 8 ? Math.max(8, r.top - 4 - menuH) : abaixo;
    setCoords({ top, left });
  }

  // useLayoutEffect: posiciona antes da pintura (sem "pulo" do menu).
  useLayoutEffect(() => {
    if (open) posicionar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      const t = e.target as Node;
      if (btnRef.current?.contains(t) || menuRef.current?.contains(t)) return;
      setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    function fechar() {
      setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    // capture=true pega a rolagem de qualquer container interno (a lista rola sozinha).
    window.addEventListener('scroll', fechar, true);
    window.addEventListener('resize', fechar);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', fechar, true);
      window.removeEventListener('resize', fechar);
    };
  }, [open]);

  const visiveis = items.filter((i) => !i.hidden);
  if (visiveis.length === 0) return null;

  return (
    <div className={`flex-none ${className}`}>
      <button
        ref={btnRef}
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="grid h-8 w-8 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
      >
        <MoreVertical className="h-4 w-4" />
      </button>
      {open &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            style={{ position: 'fixed', top: coords?.top ?? -9999, left: coords?.left ?? -9999 }}
            className="z-50 min-w-44 overflow-hidden rounded-lg border border-border bg-card py-1 shadow-lg"
          >
            {visiveis.map((it, i) => (
              <button
                key={i}
                type="button"
                role="menuitem"
                onClick={() => {
                  setOpen(false);
                  it.onClick();
                }}
                className={`flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm transition-colors hover:bg-secondary ${
                  it.destructive ? 'text-destructive hover:bg-destructive/10' : 'text-foreground'
                }`}
              >
                {it.icon && <span className="flex-none text-muted-foreground">{it.icon}</span>}
                <span>{it.label}</span>
              </button>
            ))}
          </div>,
          document.body,
        )}
    </div>
  );
}
