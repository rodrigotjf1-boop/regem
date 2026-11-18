import { Card } from '@/components/ui/card';
import { texto2 } from '@/components/ui/lista';
import { cn } from '@/lib/utils';
import { type GastoOficial, TIPO, dinheiro, inteiro } from './tipos';

// "Por tipo de mensagem": a Meta cobra pelo tipo. Cada linha com o nome, o valor escrito, o que é, a barra da parte do
// gasto e as mensagens (cobradas e grátis). Nunca passa da largura do cartão.
export function GastoPorTipo({ g }: { g: GastoOficial }) {
  const total = g.total.custo;
  return (
    <Card className="p-5">
      <h2 className="font-display text-lg font-bold">Por tipo de mensagem</h2>
      <p className={cn('mt-1 max-w-3xl text-sm', texto2)}>A Meta cobra por mensagem entregue, pelo tipo. O valor é o que a Meta informa, aproximado.</p>
      <ul className="mt-4 space-y-4" aria-label="Gasto por tipo de mensagem">
        {g.tipos.map((t) => {
          const parte = total > 0 ? Math.round((t.custo / total) * 100) : 0;
          return (
            <li key={t.grupo} className="space-y-1">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                <span className="font-semibold">{TIPO[t.grupo].nome}</span>
                <span className="font-mono font-bold">{dinheiro(t.custo, g.leitura.moeda)}</span>
              </div>
              <p className={cn('text-sm', texto2)}>{TIPO[t.grupo].explica}</p>
              {t.mensagens > 0 && (
                <div className="h-2.5 rounded-full bg-secondary" aria-hidden="true">
                  <div className="h-2.5 rounded-full bg-[hsl(var(--dado))]" style={{ width: `${Math.max(1, parte)}%` }} />
                </div>
              )}
              <p className={cn('break-words font-mono text-xs', texto2)}>
                {t.mensagens === 0
                  ? '0 mensagens'
                  : [`${inteiro(t.mensagens)} ${t.mensagens === 1 ? 'mensagem' : 'mensagens'}`, t.gratis > 0 ? `${inteiro(t.gratis)} grátis` : '', t.gratis > 0 ? `${inteiro(t.cobradas)} cobradas` : '', `${parte}% do gasto`]
                      .filter(Boolean)
                      .join(' · ')}
              </p>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
