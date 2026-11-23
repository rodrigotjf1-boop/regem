import { useId } from 'react';
import { Selo, texto2 } from '@/components/ui/lista';
import { quandoPublicou, type NoticiaDoRamo } from './regras';

// Um bloco do boletim ("Em destaque", "Novidades e tendências", "Mais notícias"). De cada notícia, só o título da fonte, o
// crédito e o link: o texto fica no site de quem publicou.
function ItemDaNoticia({ n, posicao }: { n: NoticiaDoRamo; posicao: number | null }) {
  // O servidor já recusa link que não seja https; aqui é a segunda trava antes de virar um `href`.
  const link = n.link.startsWith('https://') ? n.link : null;
  return (
    <li className="grid grid-cols-[1.5rem_minmax(0,1fr)] gap-x-2 border-t border-border p-3 first:border-t-0 sm:p-4">
      <span aria-hidden="true" className={`font-mono text-[15px] font-bold leading-6 ${texto2}`}>
        {posicao ?? '·'}
      </span>
      <div className="min-w-0">
        <h4 className="text-[15px] font-semibold leading-6 [overflow-wrap:anywhere]">
          {link ? (
            <a href={link} target="_blank" rel="noopener noreferrer" className="underline decoration-border underline-offset-2 hover:decoration-current focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              {n.titulo}
              <span className="sr-only"> (abre no site da fonte)</span>
            </a>
          ) : (
            n.titulo
          )}
        </h4>
        <div className={`mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] ${texto2}`}>
          <Selo quebrar>{n.categoriaNome}</Selo>
          <span className="min-w-0 [overflow-wrap:anywhere]">
            {n.credito} · {quandoPublicou(n.publicadoEm)}
          </span>
        </div>
        {n.aviso && (
          <div className="mt-1.5">
            <Selo tom="aviso" quebrar>
              {n.aviso}
            </Selo>
          </div>
        )}
      </div>
    </li>
  );
}

export function BlocoDeNoticias({ titulo, itens, numerar = false }: { titulo: string; itens: NoticiaDoRamo[]; numerar?: boolean }) {
  const id = useId();
  if (!itens.length) return null;
  const Lista = numerar ? 'ol' : 'ul';
  return (
    <section aria-labelledby={id} className="space-y-1.5">
      <h3 id={id} className={`font-display text-xs font-bold uppercase tracking-wide ${texto2}`}>
        {titulo} · {itens.length}
      </h3>
      <Lista className="overflow-hidden rounded-lg border border-border bg-card">
        {itens.map((n, i) => (
          <ItemDaNoticia key={n.id} n={n} posicao={numerar ? i + 1 : null} />
        ))}
      </Lista>
    </section>
  );
}
