import { Card } from '@/components/ui/card';
import { texto2 } from '@/components/ui/lista';
import { GraficoDoMister } from '@/components/mister/grafico-do-mister';
import type { PlanoDoRelatorio } from '@/lib/mister-relatorio';

// O CORPO DO RELATÓRIO POR INSUMO DO MISTER (M3c): os números, o gráfico, "De onde saiu" e a fonte — o mesmo desenho na
// página logada (`/mister/relatorio`) e na do link para encaminhar (`/m/r/<código>`). O título e as ações são de cada
// página. `nivel` = o nível dos títulos das partes (a página logada já tem o h1 do Shell e o h2 do relatório).
export function CorpoDoRelatorio({ plano: p, vazio, nivel = 3 }: { plano: PlanoDoRelatorio; vazio: boolean; nivel?: 2 | 3 }) {
  const Titulo = nivel === 2 ? 'h2' : 'h3';
  return (
    <>
      <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {p.numeros.map((n) => (
          <Card key={n.rotulo} className="p-4">
            <dt className={`text-xs ${texto2}`}>{n.rotulo}</dt>
            <dd className="mt-1 break-words font-mono text-2xl font-semibold">{n.valor}</dd>
          </Card>
        ))}
      </dl>

      {vazio ? (
        <p className="rounded-lg border border-dashed border-border p-6 text-center text-muted-foreground">Nenhuma venda deste insumo no período.</p>
      ) : (
        <section aria-labelledby="grafico-do-relatorio" className="space-y-2">
          <Titulo id="grafico-do-relatorio" className="font-display font-semibold">
            {p.grafico.titulo}
          </Titulo>
          {/* Versão 5 (M5d.1): o desenho novo, o mesmo da imagem da conversa e do PDF (a legenda da média vai dentro dele). */}
          <Card className="p-4">
            <GraficoDoMister legenda={p.grafico.titulo} pontos={p.grafico.barras} linha={p.grafico.linha} cabecalho={['Quando', 'Quanto']} />
          </Card>
          {p.grafico.nota && <p className={`text-xs ${texto2}`}>{p.grafico.nota}</p>}
        </section>
      )}

      {!vazio && (
        <section aria-labelledby="de-onde-saiu" className="space-y-2">
          <Titulo id="de-onde-saiu" className="font-display font-semibold">
            De onde saiu
          </Titulo>
          <Card className="p-0">
            <ul aria-label="Cada produto e quanto usou do insumo">
              {p.deOnde.map((d) => (
                <li key={d.produto} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-b border-border px-4 py-3 text-sm last:border-b-0">
                  <span className="min-w-0 break-words font-semibold">{d.produto}</span>
                  <span className={`min-w-0 break-words ${texto2}`}>{d.detalhe}</span>
                  <span className="font-mono font-semibold">{d.valor}</span>
                </li>
              ))}
            </ul>
          </Card>
          {p.outros && <p className={`text-sm ${texto2}`}>{p.outros}</p>}
        </section>
      )}

      <p className="text-xs text-muted-foreground">{p.fonte}</p>
    </>
  );
}
