'use client';

import { cn } from '@/lib/utils';

// Chave liga/desliga (`role="switch"`). A área de toque tem 40 px de altura; o desenho da chave é
// menor e fica no meio. O texto "Ligado"/"Desligado" ao lado dispensa depender só da cor.
export function Chave({
  ligada,
  aoMudar,
  rotulo,
  ocupada = false,
  comTexto = true,
  id,
}: {
  ligada: boolean;
  aoMudar: (ligada: boolean) => void;
  /** Nome do que a chave liga, para leitor de tela ("Alerta Lavar as mãos ativo"). */
  rotulo: string;
  /** Desligada enquanto a mudança anterior ainda está sendo gravada. */
  ocupada?: boolean;
  comTexto?: boolean;
  id?: string;
}) {
  return (
    <span className="inline-flex items-center gap-1.5">
      {comTexto && <span className="min-w-[4.25rem] text-right text-xs font-bold text-secondary-foreground">{ligada ? 'Ligado' : 'Desligado'}</span>}
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={ligada}
        aria-label={rotulo}
        disabled={ocupada}
        onClick={() => aoMudar(!ligada)}
        className="relative h-10 w-[52px] flex-none rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
      >
        <span className={cn('absolute inset-x-0.5 bottom-2 top-2 rounded-full transition-colors motion-reduce:transition-none', ligada ? 'bg-ok' : 'bg-secondary-foreground/70')} aria-hidden="true" />
        <span className={cn('absolute left-[5px] top-[11px] h-[18px] w-[18px] rounded-full bg-card shadow transition-transform motion-reduce:transition-none', ligada && 'translate-x-6')} aria-hidden="true" />
      </button>
    </span>
  );
}
