'use client';

import { useState } from 'react';
import { Card } from '@/components/ui/card';
import { texto2 } from '@/components/ui/lista';
import { BarrasDoMister } from '@/components/mister/barras-do-mister';
import { GraficoDoMister } from '@/components/mister/grafico-do-mister';
import type { PlanoDoResumo } from '@/lib/mister-relatorio';

// O RESUMO DO DIA E DA SEMANA NA PÁGINA DO LINK (versão 5, M5e; protótipo `mockups/regem-mister-ouve-ve-mostra.html`,
// aba "Arquivo e link" › "Link de visualização"): os números grandes, os gráficos em abas (Por hora, Canais, 7 dias,
// Produtos — os que têm o que mostrar), os pontos de atenção e a fonte. O MESMO plano do PDF do resumo (decisão 8).
// As abas quebram a linha (nada rola para o lado); só uma aparece por vez, e todas trazem a tabela.

const corDoTom = (tom: PlanoDoResumo['numeros'][number]['tom']) => (tom === 'bom' ? 'text-ok' : tom === 'ruim' ? 'text-destructive' : texto2);

export function ResumoDoMister({ plano: p }: { plano: PlanoDoResumo }) {
  const [aba, setAba] = useState(p.abas[0]?.id ?? null);
  const atual = p.abas.find((a) => a.id === aba) ?? p.abas[0] ?? null;
  const g = atual?.grafico ?? null;
  const comAnterior = !!g?.barras?.some((b) => b.anterior !== undefined);

  return (
    <>
      <dl className="grid grid-cols-1 gap-3 min-[360px]:grid-cols-2 sm:grid-cols-3" data-numeros-do-resumo>
        {p.numeros.map((n) => (
          <Card key={n.rotulo} className="min-w-0 p-4">
            <dt className={`text-xs ${texto2}`}>{n.rotulo}</dt>
            <dd className="mt-1 break-words font-mono text-2xl font-semibold">{n.valor}</dd>
            {n.nota && <dd className={`mt-0.5 break-words text-xs font-semibold ${corDoTom(n.tom)}`}>{n.nota}</dd>}
          </Card>
        ))}
      </dl>

      {p.abas.length > 0 && g && (
        <section aria-labelledby="graficos-do-resumo" className="min-w-0 space-y-3">
          <h2 id="graficos-do-resumo" className="sr-only">
            Gráficos do resumo
          </h2>
          {/* Um gráfico só (o "🔗 Ver no link" de um gráfico da conversa): sem as abas. */}
          {p.abas.length > 1 && (
            <div className="flex flex-wrap gap-2" role="group" aria-label="Escolha o gráfico">
              {p.abas.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  aria-pressed={a.id === atual?.id}
                  onClick={() => setAba(a.id)}
                  className={`min-h-11 rounded-full border px-4 text-sm font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${
                    a.id === atual?.id ? 'border-foreground bg-foreground text-card' : 'border-border bg-card'
                  }`}
                >
                  {a.nome}
                </button>
              ))}
            </div>
          )}
          <Card className="min-w-0 space-y-3 p-4" data-grafico-do-resumo={atual?.id}>
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <h3 className="min-w-0 break-words font-display font-semibold">{g.titulo}</h3>
              {g.kpi && <p className="font-mono text-lg font-semibold">{g.kpi}</p>}
            </div>
            <p className={`break-words text-xs ${texto2}`}>{g.sub}</p>
            {g.delta && <p className={`break-words text-sm font-semibold ${corDoTom(g.delta.tom)}`}>{g.delta.texto}</p>}
            {g.forma === 'colunas' ? (
              <GraficoDoMister
                legenda={g.titulo}
                pontos={(g.barras ?? []).map((b) => ({ rotulo: b.rotulo2 ? `${b.rotulo} ${b.rotulo2}` : b.rotulo, valor: b.valor, texto: b.texto }))}
                linha={null}
                cabecalho={[atual?.id === 'hora' ? 'Hora' : 'Dia', p.semValores ? 'Vendas' : 'Valor']}
                anteriores={comAnterior ? (g.barras ?? []).map((b) => b.anterior ?? 0) : undefined}
                nomeDoAnterior={g.legenda?.[1] ?? 'o período anterior'}
              />
            ) : (
              <BarrasDoMister grafico={g} />
            )}
            <p className={`break-words text-xs ${texto2}`}>{g.rodape}</p>
          </Card>
        </section>
      )}

      {p.atencao.length > 0 && (
        <section aria-labelledby="atencao-do-resumo" className="min-w-0 space-y-2">
          <h2 id="atencao-do-resumo" className="font-display font-semibold">
            Pontos de atenção
          </h2>
          <Card className="p-0">
            <ul aria-label="Os pontos de atenção do resumo">
              {p.atencao.map((a, i) => (
                <li key={`${a.oque}-${i}`} className="grid gap-0.5 border-b border-border px-4 py-3 text-sm last:border-b-0">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                    <span className="font-semibold">{a.oque}</span>
                    <span className="font-mono font-semibold">{a.valor}</span>
                  </div>
                  <span className={`min-w-0 break-words ${texto2}`}>{a.detalhe}</span>
                </li>
              ))}
            </ul>
          </Card>
        </section>
      )}

      <p className="text-xs text-muted-foreground">{p.fonte}</p>
    </>
  );
}
