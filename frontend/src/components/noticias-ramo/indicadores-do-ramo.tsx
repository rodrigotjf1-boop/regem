import { Selo, texto2 } from '@/components/ui/lista';
import { detalheDoIndicador, valorDoIndicador, type IndicadorDoRamo } from './regras';

// Os indicadores do boletim, com a fonte de cada um. A grade se arruma pelo espaço da peça, não pela janela (V45).
export function IndicadoresDoRamo({ itens }: { itens: IndicadorDoRamo[] }) {
  if (!itens.length) return null;
  return (
    <div
      role="group"
      aria-label="Indicadores do dia"
      className="grid gap-px overflow-hidden rounded-lg border border-border bg-border [grid-template-columns:repeat(auto-fit,minmax(min(100%,13rem),1fr))]"
    >
      {itens.map((i) => (
        <div key={i.id} className="min-w-0 bg-card p-3 sm:p-4">
          <div className={`font-display text-xs font-semibold uppercase tracking-wide ${texto2}`}>{i.nome}</div>
          <div className="mt-0.5 flex flex-wrap items-center gap-2">
            <span className="font-mono text-2xl font-bold tabular-nums">{valorDoIndicador(i)}</span>
            {i.mudou && <Selo tom="info">Mudou</Selo>}
          </div>
          <div className={`text-[13px] ${texto2}`}>{detalheDoIndicador(i)}</div>
          <div className={`mt-0.5 text-xs ${texto2}`}>{i.credito}</div>
        </div>
      ))}
    </div>
  );
}
