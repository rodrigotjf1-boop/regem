'use client';

import { Card } from '@/components/ui/card';
import { corHierarquia } from '@/lib/hierarquia';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Aloc = any;

function toMin(h?: string | null): number {
  if (!h) return 0;
  const [a, b] = String(h).split(':').map(Number);
  return a * 60 + (b || 0);
}
const hh = (m: number) => `${String(Math.floor((m / 60) % 24)).padStart(2, '0')}h`;

// Timeline do dia: cada colaborador escalado vira uma barra no eixo de horas,
// agrupada por setor, com a PAUSA marcada (faixa hachurada) — o gestor vê os
// intervalos e organiza a cobertura.
export function TimelineDia({ alocacoes }: { alocacoes: Aloc[] }) {
  const linhas = alocacoes.filter((a) => a.turnoInicio && a.colaboradorNome);
  if (linhas.length === 0) {
    return (
      <Card className="p-8 text-center text-sm text-muted-foreground">
        Ninguém escalado (com turno) neste dia.
      </Card>
    );
  }

  let min = 24 * 60;
  let max = 0;
  const norm = (a: Aloc) => {
    const s = toMin(a.turnoInicio);
    let e = toMin(a.turnoFim);
    if (e <= s) e += 24 * 60;
    return { s, e };
  };
  for (const a of linhas) {
    const { s, e } = norm(a);
    min = Math.min(min, s);
    max = Math.max(max, e);
  }
  min = Math.floor(min / 60) * 60;
  max = Math.ceil(max / 60) * 60;
  const span = Math.max(60, max - min);
  const pct = (m: number) => `${((m - min) / span) * 100}%`;
  const horas: number[] = [];
  for (let h = min; h <= max; h += 60) horas.push(h);

  const bySetor: Record<string, Aloc[]> = {};
  for (const a of linhas) (bySetor[a.setorNome || 'Sem setor'] ??= []).push(a);
  const grupos = Object.entries(bySetor).sort((x, y) => x[0].localeCompare(y[0]));

  return (
    <Card className="overflow-x-auto p-4">
      <div className="min-w-[560px]">
        {/* eixo de horas */}
        <div className="mb-1 flex pl-40 text-[10px] text-muted-foreground">
          {horas.map((h) => (
            <div key={h} className="flex-1 border-l border-border pl-1 font-mono">
              {hh(h)}
            </div>
          ))}
        </div>

        {grupos.map(([setor, arr]) => (
          <div key={setor} className="mb-2">
            <p className="mb-1 font-display text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
              {setor}
            </p>
            <div className="space-y-1">
              {arr.map((a) => {
                const { s, e } = norm(a);
                const cor = corHierarquia(a.categoria);
                const temPausa = a.pausaInicio && a.pausaFim;
                let ps = 0;
                let pe = 0;
                if (temPausa) {
                  ps = toMin(a.pausaInicio);
                  pe = toMin(a.pausaFim);
                  if (pe <= ps) pe += 24 * 60;
                }
                return (
                  <div key={a.id} className="flex items-center gap-2">
                    <div className="w-40 flex-none truncate pr-2 text-xs">
                      <span className="font-semibold">{a.colaboradorNome}</span>{' '}
                      <span className="font-mono text-[10px] text-muted-foreground">
                        {a.etiquetaSigla}
                        {a.etiquetaContador}
                      </span>
                    </div>
                    <div className="relative h-7 flex-1 rounded bg-secondary/40">
                      <div
                        className="absolute inset-y-0 flex items-center overflow-hidden rounded px-1.5"
                        style={{
                          left: pct(s),
                          width: `${((e - s) / span) * 100}%`,
                          background: `${cor}22`,
                          borderLeft: `3px solid ${cor}`,
                        }}
                        title={`${a.turnoNome}: ${a.turnoInicio}–${a.turnoFim}${
                          temPausa ? ` · pausa ${a.pausaInicio}–${a.pausaFim}` : ''
                        }`}
                      >
                        <span className="truncate text-[10px] font-medium">
                          {String(a.turnoInicio).slice(0, 5)}–{String(a.turnoFim).slice(0, 5)}
                        </span>
                      </div>
                      {temPausa && (
                        <div
                          className="absolute inset-y-0"
                          style={{
                            left: pct(ps),
                            width: `${((pe - ps) / span) * 100}%`,
                            background:
                              'repeating-linear-gradient(45deg, rgba(0,0,0,.18) 0 4px, transparent 4px 8px)',
                          }}
                          title={`Pausa ${a.pausaInicio}–${a.pausaFim}`}
                        />
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
        <p className="mt-2 text-[11px] text-muted-foreground">
          A faixa hachurada é a <b>pausa</b> — organize a cobertura nesse intervalo.
        </p>
      </div>
    </Card>
  );
}
