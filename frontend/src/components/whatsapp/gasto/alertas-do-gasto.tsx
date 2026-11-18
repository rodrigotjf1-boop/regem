import Link from 'next/link';
import { buttonVariants } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Selo, texto2 } from '@/components/ui/lista';
import { cn } from '@/lib/utils';
import { type AlertasDoMes, DESTINO, dinheiro } from './tipos';

// "Alertas de gasto deste mês" (G2 do protótipo `mockups/regem-whatsapp-gasto.html`): os valores do alerta pelo Mister e
// quando o gasto do mês passou de cada um, e a franquia do atendimento. Os valores e para quem vai mudam no Mister ›
// Avisos e relatórios.

const quando = (iso: string) => {
  const d = new Date(iso);
  const fuso = { timeZone: 'America/Sao_Paulo' } as const;
  return `${d.toLocaleDateString('pt-BR', { ...fuso, day: '2-digit', month: '2-digit' })} ${d.toLocaleTimeString('pt-BR', { ...fuso, hour: '2-digit', minute: '2-digit' })}`;
};

export function AlertasDoGasto({ a, misterLigado, moeda }: { a: AlertasDoMes; misterLigado: boolean | null; moeda: string | null }) {
  const destinos = (l: string[]) => l.map((d) => DESTINO[d] ?? d).join(', ') || 'nenhum destino';
  return (
    <Card className="p-5">
      <h2 className="font-display text-lg font-bold">Alertas de gasto deste mês</h2>
      {misterLigado === false && (
        <p role="note" className="mt-2 rounded-md bg-muted px-3 py-2 text-sm">
          Os alertas vão pelo Mister, e ele está desligado. Ligue em Visão C&amp;O › Módulos do produto para receber os avisos no WhatsApp.
        </p>
      )}
      <ul className="mt-3 divide-y divide-border">
        {!a.gasto.ligado ? (
          <li className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 py-2.5">
            <span className="min-w-0">
              <strong>Gasto do WhatsApp oficial</strong>
              <span className={cn('block text-xs', texto2)}>Ligue e escolha os valores no Mister.</span>
            </span>
            <Selo>desligado</Selo>
          </li>
        ) : (
          a.gasto.valores.map((v, i) => {
            const passou = !!v.passouEm;
            const jaPassou = !passou && v.valor <= a.custoDoMes;
            return (
              <li key={v.valor} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 py-2.5">
                <span className="min-w-0">
                  <strong className="font-mono">{dinheiro(v.valor, moeda)}</strong>
                  <span className={cn('block text-xs', texto2)}>
                    Alerta {i + 1} ·{' '}
                    {passou || jaPassou ? destinos(a.gasto.destinos) : `faltam ${dinheiro(Math.round((v.valor - a.custoDoMes) * 100) / 100, moeda)}`}
                  </span>
                </span>
                {passou ? <Selo tom="ok">passou em {quando(v.passouEm!)}</Selo> : jaPassou ? <Selo tom="aviso">avisa na próxima leitura</Selo> : <Selo>ainda não</Selo>}
              </li>
            );
          })
        )}
        <li className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 py-2.5">
          <span className="min-w-0">
            <strong>Atendimento grátis perto do fim</strong>
            <span className={cn('block text-xs', texto2)}>
              {a.franquia.numeros.length ? a.franquia.numeros.map((n) => `número final ${n.final}`).join(', ') : `900 de 1.000 em cada número · ${destinos(a.franquia.destinos)}`}
            </span>
          </span>
          {!a.franquia.ligado ? (
            <Selo>desligado</Selo>
          ) : a.franquia.numeros.length ? (
            <Selo tom="ok">passou em {quando(a.franquia.numeros[0].passouEm ?? '')}</Selo>
          ) : (
            <Selo>ainda não</Selo>
          )}
        </li>
      </ul>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Link href="/mister?parte=avisos" className={buttonVariants({ variant: 'outline' })}>
          Mudar os alertas
        </Link>
        <span className={cn('text-xs', texto2)}>Os valores e para quem vai ficam no Mister › Avisos e relatórios.</span>
      </div>
    </Card>
  );
}
