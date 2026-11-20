import { texto2 } from '@/components/ui/lista';
import type { PlanoDoGrafico } from '@/lib/mister-relatorio';

// AS BARRAS DEITADAS DO MISTER NA PÁGINA (versão 5, M5e; protótipo `mockups/regem-mister-ouve-ve-mostra.html`, aba
// "Gráficos" — "Por canal" e "Mais vendidos"): uma linha por parte, com o nome, a barra do tamanho dela e o valor (com a %
// na participação). O mesmo plano da imagem da conversa e do PDF; em HTML (a largura acompanha a peça, nunca rola para o
// lado), e a lista é lida como lista pelo leitor de tela.

/** As cores das partes (canais), na ordem — as mesmas da imagem e do PDF. A primeira dos mais vendidos é a dourada. */
const CORES = ['bg-foreground/80', 'bg-primary', 'bg-foreground/55', 'bg-foreground/40', 'bg-foreground/25', 'bg-foreground/15'];

export function BarrasDoMister({ grafico: g }: { grafico: PlanoDoGrafico }) {
  const partes = g.partes ?? [];
  const soma = partes.reduce((s, p) => s + p.valor, 0) || 1;
  const maior = Math.max(1, ...partes.map((p) => p.valor));
  const participacao = g.forma === 'participacao';
  return (
    <ol aria-label={g.titulo} className="grid gap-3">
      {partes.map((p, i) => {
        const pct = Math.round((p.valor / soma) * 100);
        const cor = participacao ? CORES[i % CORES.length] : i === 0 ? 'bg-primary' : 'bg-foreground/80';
        return (
          <li key={`${p.nome}-${i}`} className="grid gap-1">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 text-sm">
              <span className="min-w-0 break-words font-semibold">{p.nome}</span>
              <span className="font-mono font-semibold">
                {p.texto}
                {participacao && <span className={`font-normal ${texto2}`}> · {pct}%</span>}
              </span>
            </div>
            <div className="h-2.5 w-full overflow-hidden rounded-full bg-muted" aria-hidden="true">
              <div className={`h-full rounded-full ${cor}`} style={{ width: `${Math.max(2, (p.valor / maior) * 100)}%` }} />
            </div>
          </li>
        );
      })}
    </ol>
  );
}
