import { ArrowLeftRight } from 'lucide-react';
import { RegemMark } from '@/components/brand/regem-mark';
import { cn } from '@/lib/utils';
import { SeloApp } from './selo-app';

// Moldura da página "Autorizar o <aplicativo>": fora do menu, só a barra do Regem no topo (a
// pessoa vem de outro produto para UMA decisão) e um cartão no meio. Tema claro do Regem.
export function AutorizarMoldura({
  empresa,
  quem,
  children,
}: {
  empresa?: string | null;
  /** "Rodrigo · presidente" */
  quem?: string | null;
  children: React.ReactNode;
}) {
  return (
    <div className="app-light min-h-dvh bg-background text-foreground">
      <header className="flex items-center justify-between gap-3 bg-foreground px-4 py-3 text-white sm:px-5">
        <span className="flex items-center gap-2 font-display text-base font-extrabold">
          <RegemMark className="h-7 w-7" />
          Regem
        </span>
        {(empresa || quem) && (
          <span className="grid min-w-0 text-right text-xs leading-tight text-white/70">
            {empresa && <b className="truncate text-[13px] font-bold text-white">{empresa}</b>}
            {quem && <span className="hidden truncate sm:block">{quem}</span>}
          </span>
        )}
      </header>
      <main className="grid justify-items-center px-4 pb-9 pt-6 sm:pt-7">{children}</main>
    </div>
  );
}

/** O par "aplicativo ⇄ Regem" do topo do cartão. */
export function ParDeSelos({ cliente, rotulo, pequeno = false }: { cliente: string; rotulo: string; pequeno?: boolean }) {
  return (
    <div className="flex items-center gap-3 text-muted-foreground">
      <SeloApp cliente={cliente} rotulo={rotulo} pequeno={pequeno} />
      <ArrowLeftRight className="h-[18px] w-[18px]" aria-hidden="true" />
      <span
        role="img"
        aria-label="Regem"
        className={cn('grid flex-none place-items-center rounded-full bg-foreground text-white', pequeno ? 'h-8 w-8' : 'h-11 w-11')}
      >
        <RegemMark className={pequeno ? 'h-6 w-6' : 'h-8 w-8'} />
      </span>
    </div>
  );
}

/** Cartão curto e centrado: recusa, erro, "voltando". */
export function CartaoCurto({ children, papel }: { children: React.ReactNode; papel?: 'status' | 'alert' }) {
  return (
    <div
      role={papel}
      className="grid w-full max-w-[480px] justify-items-center gap-3.5 rounded-xl border border-border bg-card p-5 text-center sm:p-6"
    >
      {children}
    </div>
  );
}

const TOM = {
  ok: 'bg-ok/15 text-ok',
  atencao: 'bg-warn/15 text-warn',
  perigo: 'bg-destructive/10 text-destructive',
} as const;

export function Disco({ tom, children }: { tom: keyof typeof TOM; children: React.ReactNode }) {
  return <span className={cn('grid h-14 w-14 place-items-center rounded-full [&_svg]:h-[26px] [&_svg]:w-[26px]', TOM[tom])}>{children}</span>;
}
