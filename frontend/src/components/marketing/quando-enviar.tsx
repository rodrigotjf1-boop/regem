'use client';

import { useId } from 'react';

// "QUANDO ENVIAR" DA CAMPANHA (F7 parte 4b do docs/plano-perfil-cliente.md, §6.3; protótipo `regem-perfil-cliente.html`, aba
// "Marketing", cartão "Quando enviar"; mig 480). "Num horário fixo" é a campanha de sempre (todos de uma vez, dentro da janela
// de envio); "Na hora habitual de cada cliente" manda a cada um de 30 a 60 min antes da faixa em que ele costuma pedir —
// usa o perfil, então só vai para quem aceitou as mensagens clicando (D4/D15). Só aparece para presidente e gerente com o
// módulo "Perfil do cliente" ligado (quem mostra é a página; o servidor confere de novo — `conferirEnvioHabitual`).

export type PreviaHabitual = { foraPorAceite: number; porHora: Record<string, number>; dia: number };

const DIA = ['', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado', 'domingo'];
/** A hora na ordem do dia de operação (a madrugada, antes das 4h, vem depois das 23h). */
const ordem = (h: number) => (h < 4 ? h + 24 : h);

export function QuandoEnviar({
  habitual,
  aoMudar,
  previa,
  total,
}: {
  habitual: boolean;
  aoMudar: (habitual: boolean) => void;
  /** O bloco `habitual` da prévia (null enquanto calcula ou com "num horário fixo"). */
  previa: PreviaHabitual | null;
  /** Quantos vão receber (o total da prévia). */
  total: number | null;
}) {
  const id = useId();
  const horas = previa
    ? Object.entries(previa.porHora)
        .map(([h, n]) => ({ h: Number(h), n: Number(n) }))
        .filter((x) => x.n > 0)
        .sort((a, b) => ordem(a.h) - ordem(b.h))
    : [];
  const maior = Math.max(1, ...horas.map((x) => x.n));
  const opcoes = [
    {
      v: true,
      t: 'Na hora habitual de cada cliente',
      d: 'De 30 a 60 min antes da faixa em que cada um costuma pedir. Quem tem pouco histórico recebe no pico da loja.',
    },
    { v: false, t: 'Num horário fixo', d: 'Todos de uma vez, dentro da janela de envio.' },
  ];
  return (
    <div className="rounded-lg border border-dashed border-border p-3" data-quando-enviar>
      <p id={`${id}-titulo`} className="mb-2 text-xs font-semibold text-foreground/70">
        Quando enviar
      </p>
      <div role="group" aria-labelledby={`${id}-titulo`} className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {opcoes.map((o) => (
          <button
            key={String(o.v)}
            type="button"
            onClick={() => aoMudar(o.v)}
            aria-pressed={habitual === o.v}
            className={`rounded-md border px-3 py-2 text-left text-xs ${
              habitual === o.v ? 'border-primary bg-primary/10' : 'border-border'
            }`}
          >
            <span className="block font-semibold text-foreground">{o.t}</span>
            <span className="mt-0.5 block text-foreground/70">{o.d}</span>
          </button>
        ))}
      </div>

      {habitual && (
        <div className="mt-3 space-y-2">
          {previa == null ? (
            <p className="text-xs text-foreground/70">Calculando a hora de cada cliente…</p>
          ) : (
            <>
              {previa.foraPorAceite > 0 && (
                <p className="text-xs text-foreground/80" data-fora-aceite>
                  <strong>{previa.foraPorAceite}</strong>{' '}
                  {previa.foraPorAceite === 1 ? 'fica de fora: não aceitou' : 'ficam de fora: não aceitaram'} as mensagens clicando
                  (no cardápio ou no WhatsApp). A hora habitual usa o perfil do cliente — só vai para quem aceitou.
                </p>
              )}
              {total != null && total > 0 && horas.length > 0 ? (
                <>
                  <p id={`${id}-horas`} className="text-xs font-semibold text-foreground/70">
                    Como os {total} envios se espalham num dia como hoje ({DIA[previa.dia] ?? 'hoje'})
                  </p>
                  <ul aria-labelledby={`${id}-horas`} className="flex flex-wrap items-end gap-2">
                    {horas.map((x) => (
                      <li key={x.h} className="flex w-9 flex-col items-center gap-1 text-[11px] text-foreground/70">
                        <span className="font-mono font-semibold text-foreground">{x.n}</span>
                        <span className="flex h-14 w-5 items-end rounded-sm bg-secondary" aria-hidden="true">
                          <span className="block w-full rounded-sm bg-primary" style={{ height: `${Math.max(6, Math.round((100 * x.n) / maior))}%` }} />
                        </span>
                        <span className="font-mono">{x.h}h</span>
                        <span className="sr-only">{x.n === 1 ? 'envio' : 'envios'}</span>
                      </li>
                    ))}
                  </ul>
                </>
              ) : (
                <p className="text-xs text-foreground/70">Ninguém para receber na hora habitual com este público.</p>
              )}
              <p className="text-[11px] text-foreground/60">
                Sem janela de horário, nada sai antes das 8h nem depois das 23h. Quem passar da hora hoje recebe no dia seguinte, na
                hora daquele dia.
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}
