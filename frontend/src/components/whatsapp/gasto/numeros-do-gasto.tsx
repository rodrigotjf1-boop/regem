import { Card } from '@/components/ui/card';
import { texto2 } from '@/components/ui/lista';
import { cn } from '@/lib/utils';
import { type GastoOficial, PAPEL, dinheiro, inteiro, nomeDoMes } from './tipos';

// Os números grandes do topo de WhatsApp › Uso e gasto: o gasto do período, a projeção do mês, as mensagens cobradas e
// a franquia do atendimento de cada número (as 1.000 grátis do mês).
export function NumerosDoGasto({ g }: { g: GastoOficial }) {
  const moeda = g.leitura.moeda;
  const base =
    g.periodo.tipo === 'mes' ? `Gasto em ${nomeDoMes(g.periodo.de.slice(0, 7)).split(' de ')[0].toLowerCase()}` : g.periodo.tipo === 'passado' ? 'Gasto no mês passado' : 'Gasto no período';
  // A conta cobrada por meio de um parceiro: o valor é estimado (mig 448).
  const rotulo = g.leitura.fonteDoCusto === 'tabela' ? base.replace(/^Gasto/, 'Gasto estimado') : base;
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <Numero rotulo={rotulo} valor={dinheiro(g.total.custo, moeda)} apoio={`${g.periodo.de.split('-').reverse().join('/')} a ${g.periodo.ate.split('-').reverse().join('/')}`} destaque />
      {g.periodo.mesCorrente && (
        <Numero
          rotulo="Neste ritmo, o mês fecha em"
          valor={g.projecao === null ? '—' : `~ ${dinheiro(Math.round(g.projecao), moeda).replace(/,00$/, '')}`}
          apoio={g.projecao === null ? 'o ritmo aparece depois do primeiro dia do mês' : 'a média dos dias até agora × os dias do mês'}
        />
      )}
      <Numero rotulo="Mensagens cobradas" valor={inteiro(g.total.cobradas)} apoio={`de ${inteiro(g.total.mensagens)} entregues · a Meta cobra só o que foi entregue`} />
      {g.franquia.length === 0 ? (
        <Numero rotulo="Atendimento grátis" valor={`0 de ${inteiro(1000)}`} apoio="nenhuma resposta de atendimento neste mês" />
      ) : (
        g.franquia.map((f) => {
          const usou = Math.min(100, Math.round((f.usadas / f.limite) * 100));
          const acabou = f.usadas >= f.limite;
          return (
            <Card key={f.numero} className="min-w-0 p-4">
              <p className={cn('font-display text-[11px] font-bold uppercase tracking-[.08em]', texto2)}>
                Atendimento grátis · {f.papel ? PAPEL[f.papel] ?? f.papel : 'número'} final {f.final}
              </p>
              <p className="mt-1 break-words font-mono text-2xl font-bold">
                {inteiro(Math.min(f.usadas, f.limite))} de {inteiro(f.limite)}
              </p>
              <div
                className="mt-2 h-2 overflow-hidden rounded-full bg-secondary"
                role="progressbar"
                aria-label={`Atendimento grátis do número final ${f.final}`}
                aria-valuemin={0}
                aria-valuemax={f.limite}
                aria-valuenow={Math.min(f.usadas, f.limite)}
              >
                <div className={cn('h-2 rounded-full', acabou ? 'bg-warn' : 'bg-[hsl(var(--dado))]')} style={{ width: `${usou}%` }} />
              </div>
              <p className={cn('mt-1 text-sm', texto2)}>
                {acabou ? `acabaram: daí em diante cada resposta é cobrada (${inteiro(f.usadas - f.limite)} até agora)` : `faltam ${inteiro(f.limite - f.usadas)} neste mês`}
              </p>
            </Card>
          );
        })
      )}
    </div>
  );
}

function Numero({ rotulo, valor, apoio, destaque = false }: { rotulo: string; valor: string; apoio: string; destaque?: boolean }) {
  return (
    <Card className={cn('min-w-0 p-4', destaque && 'border-primary bg-primary/10')}>
      <p className={cn('font-display text-[11px] font-bold uppercase tracking-[.08em]', texto2)}>{rotulo}</p>
      <p className="mt-1 break-words font-mono text-2xl font-bold">{valor}</p>
      <p className={cn('mt-1 text-sm', texto2)}>{apoio}</p>
    </Card>
  );
}
