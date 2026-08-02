'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { LogOut, Settings2, PanelLeft, PanelRight, KeyRound } from 'lucide-react';
import { RegemMark } from '@/components/brand/regem-mark';
import { cn } from '@/lib/utils';
import { getNome, getFuncaoNome } from '@/lib/api';
import type { UiPrefs } from '@/hooks/use-ui-prefs';

export function AccountMenu({
  cat,
  prefs,
  onSet,
  onSair,
}: {
  cat: string;
  prefs: UiPrefs;
  onSet: (patch: Partial<UiPrefs>) => void;
  onSair: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  // Nome + função vêm do JWT; só depois da montagem (evita mismatch de hidratação).
  const [nome, setNome] = useState<string | null>(null);
  const [func, setFunc] = useState<string | null>(null);
  useEffect(() => {
    setNome(getNome());
    setFunc(getFuncaoNome());
  }, []);

  useEffect(() => {
    if (!open) return;
    function fora(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function esc(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', fora);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', fora);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative m-2.5">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open ? 'true' : 'false'}
        className="shell-account flex w-full items-center gap-2.5 rounded-lg bg-white/5 p-3 text-left hover:bg-white/10"
      >
        <span className="grid h-9 w-9 flex-none place-items-center rounded-full bg-primary">
          <RegemMark className="h-5 w-5 text-[#0F2230]" />
        </span>
        <span className="shell-account-text min-w-0 flex-1">
          <span className="block truncate text-[13px] font-semibold text-white">
            {nome || 'Minha conta'}
          </span>
          <span className="block truncate text-[11px] uppercase tracking-wide text-[#7A99AC]">
            {func || cat || '—'}
          </span>
        </span>
        <Settings2 className="shell-account-text h-4 w-4 flex-none text-[#7A99AC]" />
      </button>

      {open && (
        <div
          role="menu"
          className={cn(
            'absolute bottom-full z-50 mb-2 min-w-[220px] rounded-xl border border-white/10 bg-[#16303F] p-2 text-[#DCE7EE] shadow-2xl',
            // Ancora pelo lado da sidebar p/ escapar bem quando recolhida.
            prefs.side === 'right' ? 'right-0' : 'left-0',
          )}
        >
          <p className="px-2 pb-1 pt-1.5 font-display text-[10px] font-bold uppercase tracking-[.16em] text-[#5E7B8E]">
            Preferências
          </p>

          {/* Lado */}
          <div className="px-1 pb-1">
            <p className="px-1 pb-1 text-[11px] text-[#7A99AC]" id="lado-label">
              Lado do menu
            </p>
            <div role="group" aria-labelledby="lado-label" className="grid grid-cols-2 gap-1.5">
              <OpcaoLado
                ativo={prefs.side === 'left'}
                onClick={() => onSet({ side: 'left' })}
                icon={<PanelLeft className="h-4 w-4" />}
                titulo="Esquerda"
                sub="canhoto"
              />
              <OpcaoLado
                ativo={prefs.side === 'right'}
                onClick={() => onSet({ side: 'right' })}
                icon={<PanelRight className="h-4 w-4" />}
                titulo="Direita"
                sub="destro"
              />
            </div>
          </div>

          {/* "Recolher menu" foi removido daqui — já existe o botão no rodapé do menu. */}
          <Link
            href="/trocar-senha"
            role="menuitem"
            onClick={() => setOpen(false)}
            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-[#B9CBD7] hover:bg-white/5 hover:text-white"
          >
            <KeyRound className="h-4 w-4" /> Trocar minha senha
          </Link>
          <button
            type="button"
            role="menuitem"
            onClick={onSair}
            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-[#B9CBD7] hover:bg-white/5 hover:text-white"
          >
            <LogOut className="h-4 w-4" /> Sair
          </button>
        </div>
      )}
    </div>
  );
}

function OpcaoLado({
  ativo,
  onClick,
  icon,
  titulo,
  sub,
}: {
  ativo: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  titulo: string;
  sub: string;
}) {
  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={ativo ? 'true' : 'false'}
      onClick={onClick}
      className={cn(
        'flex flex-col items-center gap-1 rounded-lg border px-2 py-2 text-xs',
        ativo
          ? 'border-primary bg-primary/15 text-white'
          : 'border-white/10 text-[#B9CBD7] hover:bg-white/5',
      )}
    >
      {icon}
      <span className="font-medium">{titulo}</span>
      <span className="text-[10px] text-[#7A99AC]">{sub}</span>
    </button>
  );
}
