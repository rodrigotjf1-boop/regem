'use client';

import { useEffect, useId, useRef } from 'react';

// A confirmação das ações do console que valem para TODAS as empresas (desligar o Mister, desconectar o número, publicar as
// instruções). Esc e "Cancelar" fecham; o foco começa em "Cancelar"; o Tab alterna entre os dois botões e não sai dele.

const BOTAO = 'inline-flex min-h-10 items-center justify-center rounded-lg px-3.5 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-40';
const NEUTRO = `${BOTAO} border border-slate-600 text-slate-100 hover:bg-slate-800`;
const PERIGO = `${BOTAO} border border-red-500/60 text-red-200 hover:bg-red-500/10`;

export function Confirmar(p: { titulo: string; texto: string; acao: string; ocupado: boolean; onConfirmar: () => void; onFechar: () => void }) {
  const idT = useId();
  const idD = useId();
  const cancelar = useRef<HTMLButtonElement>(null);
  const confirmar = useRef<HTMLButtonElement>(null);
  const { onFechar } = p;
  useEffect(() => {
    const antes = document.activeElement as HTMLElement | null;
    cancelar.current?.focus();
    const tecla = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onFechar();
      } else if (e.key === 'Tab') {
        // Só há dois botões: o Tab alterna entre eles e não sai do diálogo.
        e.preventDefault();
        (document.activeElement === cancelar.current ? confirmar : cancelar).current?.focus();
      }
    };
    document.addEventListener('keydown', tecla, true);
    return () => {
      document.removeEventListener('keydown', tecla, true);
      antes?.focus?.();
    };
  }, [onFechar]);
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/80 p-4" onMouseDown={(e) => e.target === e.currentTarget && onFechar()}>
      <div role="alertdialog" aria-modal="true" aria-labelledby={idT} aria-describedby={idD} className="w-full max-w-md rounded-xl border border-slate-700 bg-slate-900 p-5 shadow-xl">
        <h3 id={idT} className="text-base font-semibold text-slate-100">
          {p.titulo}
        </h3>
        <p id={idD} className="mt-2 text-sm text-slate-300">
          {p.texto}
        </p>
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <button ref={cancelar} type="button" className={NEUTRO} onClick={onFechar}>
            Cancelar
          </button>
          <button ref={confirmar} type="button" className={PERIGO} disabled={p.ocupado} onClick={p.onConfirmar}>
            {p.acao}
          </button>
        </div>
      </div>
    </div>
  );
}
