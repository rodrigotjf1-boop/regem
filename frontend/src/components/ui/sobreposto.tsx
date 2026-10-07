'use client';

import { useEffect, useId, useRef } from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

// Painéis que abrem POR CIMA da tela — a GAVETA (lateral: criar/editar um registro com a lista
// à vista) e o DIÁLOGO (centro: confirmar, decisão curta, assistente). Os dois têm o mesmo
// comportamento de teclado: o foco entra no painel, o Tab não sai dele, o Esc fecha e o foco
// volta para o botão que abriu. O painel só existe enquanto está aberto (quem usa monta e
// desmonta), então não há estado "fechado" para esconder nem animação para atrapalhar o foco.

const FOCAVEIS =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function focaveis(painel: HTMLElement): HTMLElement[] {
  return [...painel.querySelectorAll<HTMLElement>(FOCAVEIS)].filter((e) => e.offsetParent !== null);
}

function useSobreposto(aoFechar: () => void, voltarPara?: string) {
  const painel = useRef<HTMLDivElement>(null);
  const fechar = useRef(aoFechar);
  fechar.current = aoFechar;
  useEffect(() => {
    const quemAbriu = document.activeElement as HTMLElement | null;
    const p = painel.current;
    // Foco inicial: o que o conteúdo marcou com `data-foco-inicial`, senão o 1º campo, senão o painel.
    (p?.querySelector<HTMLElement>('[data-foco-inicial]') ?? (p ? focaveis(p)[0] : null) ?? p)?.focus();
    const tecla = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        fechar.current();
        return;
      }
      if (e.key !== 'Tab' || !painel.current) return;
      const f = focaveis(painel.current);
      if (!f.length) {
        e.preventDefault();
        return;
      }
      const ativo = document.activeElement as HTMLElement | null;
      const fora = !ativo || !painel.current.contains(ativo);
      if (e.shiftKey && (fora || ativo === f[0])) {
        e.preventDefault();
        f[f.length - 1].focus();
      } else if (!e.shiftKey && (fora || ativo === f[f.length - 1])) {
        e.preventDefault();
        f[0].focus();
      }
    };
    document.addEventListener('keydown', tecla, true);
    const rolagem = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', tecla, true);
      document.body.style.overflow = rolagem;
      // Devolve o foco a quem abriu; se ele sumiu (a linha foi excluída), ao ponto combinado.
      if (quemAbriu && document.contains(quemAbriu)) quemAbriu.focus();
      else if (voltarPara) document.getElementById(voltarPara)?.focus();
    };
    // Só na montagem: `aoFechar` é lido pela ref e `voltarPara` não muda com o painel aberto.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return painel;
}

type Base = {
  titulo: string;
  aoFechar: () => void;
  children: React.ReactNode;
  /** Botões de ação, fixos embaixo. */
  rodape?: React.ReactNode;
  /** Clique fora fecha? Em formulário, não: um clique perdido apagaria o que foi digitado. */
  fecharNoFundo?: boolean;
  /** id do elemento que recebe o foco se o botão que abriu não existir mais. */
  voltarPara?: string;
};

function Cabecalho({ id, titulo, aoFechar }: { id: string; titulo: string; aoFechar: () => void }) {
  return (
    <header className="flex items-center justify-between gap-3 border-b border-border px-5 py-3">
      <h2 id={id} className="min-w-0 font-display text-lg font-bold">
        {titulo}
      </h2>
      <button
        type="button"
        onClick={aoFechar}
        aria-label="Fechar"
        className="grid h-11 w-11 flex-none place-items-center rounded-md text-secondary-foreground hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <X className="h-5 w-5" aria-hidden="true" />
      </button>
    </header>
  );
}

/** Gaveta lateral (direita). No celular ocupa a tela inteira. */
export function Gaveta({ titulo, aoFechar, children, rodape, fecharNoFundo = false, voltarPara }: Base) {
  const id = useId();
  const painel = useSobreposto(aoFechar, voltarPara);
  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black/50" onClick={fecharNoFundo ? aoFechar : undefined} />
      <div
        ref={painel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={id}
        tabIndex={-1}
        className="absolute inset-y-0 right-0 flex w-full max-w-[560px] flex-col bg-card text-foreground shadow-2xl outline-none"
      >
        <Cabecalho id={id} titulo={titulo} aoFechar={aoFechar} />
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {rodape && (
          <footer className="flex flex-wrap justify-end gap-2 border-t border-border bg-secondary px-5 py-3">{rodape}</footer>
        )}
      </div>
    </div>
  );
}

const LARGURA = { sm: 'max-w-md', md: 'max-w-lg', lg: 'max-w-4xl' } as const;

/** Diálogo central. `alerta` = pede uma decisão que não se desfaz (leitor de tela anuncia). */
export function Dialogo({
  titulo,
  aoFechar,
  children,
  rodape,
  fecharNoFundo = true,
  voltarPara,
  largura = 'md',
  alerta = false,
}: Base & { largura?: keyof typeof LARGURA; alerta?: boolean }) {
  const id = useId();
  const corpo = useId();
  const painel = useSobreposto(aoFechar, voltarPara);
  return (
    <div
      // Coluna explícita de largura mínima zero: sem ela a coluna automática cresce até a
      // largura do conteúdo (uma tabela larga) e o diálogo sai da tela no celular.
      className="fixed inset-0 z-50 grid grid-cols-[minmax(0,1fr)] place-items-center bg-black/50 p-3"
      onMouseDown={(e) => {
        if (fecharNoFundo && e.target === e.currentTarget) aoFechar();
      }}
    >
      <div
        ref={painel}
        role={alerta ? 'alertdialog' : 'dialog'}
        aria-modal="true"
        aria-labelledby={id}
        aria-describedby={alerta ? corpo : undefined}
        tabIndex={-1}
        className={cn(
          'flex max-h-[calc(100dvh-1.5rem)] w-full min-w-0 flex-col rounded-xl bg-card text-foreground shadow-2xl outline-none',
          LARGURA[largura],
        )}
      >
        <Cabecalho id={id} titulo={titulo} aoFechar={aoFechar} />
        <div id={corpo} className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {children}
        </div>
        {rodape && (
          <footer className="flex flex-wrap justify-end gap-2 rounded-b-xl border-t border-border bg-secondary px-5 py-3">
            {rodape}
          </footer>
        )}
      </div>
    </div>
  );
}
