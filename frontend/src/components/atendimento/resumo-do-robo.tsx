import { Fragment } from 'react';
import { hora } from '@/lib/atendimento';

// "🤖 O ROBÔ RESUMIU" no caso (Onda 1, PR 4 — o "2A" do protótipo `mockups/regem-central-atendimento.html`): quem pega o
// caso lê, de cara, o motivo (e se o cliente está chateado), o que ele quer e o que o robô já fez. Vem de
// `detalhe.robo` (o servidor tira das linhas "Motivo / Quer / Já fiz" que o robô escreve, ou dos campos próprios).

// `viu` (mig 387): na menção no story que parece reclamação, o que a IA viu na imagem (o produto, o lugar — nunca pessoas).
export type Resumo = { motivo?: string | null; quer?: string | null; viu?: string | null; jaFez?: string | null; humor?: 'chateado' | 'calmo' | null; em?: string | null };

const HUMOR: Record<string, string> = { chateado: 'cliente chateado', calmo: 'cliente calmo' };

/** A linha curta para a fila: o motivo (e o humor), senão o que ele quer. */
export function resumoCurto(r: Resumo | null | undefined): string | null {
  if (!r) return null;
  const motivo = [r.motivo, r.humor ? HUMOR[r.humor] : null].filter(Boolean).join(' · ');
  return motivo || r.quer || r.jaFez || null;
}

export function ResumoDoRobo({ robo: r }: { robo: Resumo }) {
  const linhas: Array<[string, string]> = [];
  const motivo = [r.motivo, r.humor ? HUMOR[r.humor] : null].filter(Boolean).join(' · ');
  if (motivo) linhas.push(['Motivo', motivo]);
  if (r.quer) linhas.push(['Quer', r.quer]);
  if (r.viu) linhas.push(['A IA viu', r.viu]);
  if (r.jaFez) linhas.push(['O robô já fez', r.jaFez]);
  if (!linhas.length) return null;
  return (
    <section className="rounded-lg border border-border bg-secondary/40 p-3">
      <h4 className="mb-1.5 flex flex-wrap items-baseline justify-between gap-x-3 font-display text-sm font-bold">
        <span>
          <span aria-hidden="true">🤖 </span>O robô resumiu
        </span>
        {r.em && <span className="font-body text-xs font-semibold text-secondary-foreground">às {hora(r.em)}</span>}
      </h4>
      <dl className="grid grid-cols-1 gap-x-3 text-sm sm:grid-cols-[auto_minmax(0,1fr)] sm:gap-y-1">
        {linhas.map(([k, v]) => (
          <Fragment key={k}>
            <dt className="text-xs font-bold text-secondary-foreground sm:pt-0.5">{k}</dt>
            <dd className="mb-1.5 break-words sm:mb-0">{v}</dd>
          </Fragment>
        ))}
      </dl>
    </section>
  );
}
