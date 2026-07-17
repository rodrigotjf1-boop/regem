'use client';

/* eslint-disable @typescript-eslint/no-explicit-any */

type Alocacao = {
  colaborador: string;
  funcao: string | null;
  etiqueta: string | null;
  turno: string | null;
  inicio: number;
  fim: number;
};
type TarefaT = { titulo: string; horario: number; estado: string };
type SetorRow = { setor: string; alocacoes: Alocacao[]; tarefas: TarefaT[] };
type Faixa = { nome: string; inicio: number; fim: number };

const ESTADO_COR: Record<string, string> = {
  feita: 'var(--ok)',
  pendente: 'var(--warn)',
  parcial: 'var(--warn)',
  nao_feita: 'var(--destructive)',
  em_execucao: 'var(--info)',
};

function hhmm(h: number) {
  const hora = Math.floor(h);
  const min = Math.round((h - hora) * 60);
  return `${String(hora).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

// Cor do bloco de alocação conforme o "agora": futuro = em dia, em curso =
// em execução, passado = concluído; sem responsável = atenção.
function corAloc(a: Alocacao, agora: number | null): { bg: string; ink: string } {
  if (!a.colaborador || a.colaborador === 'A definir')
    return { bg: 'color-mix(in srgb, hsl(var(--warn)) 16%, transparent)', ink: 'hsl(var(--warn))' };
  if (agora != null && agora >= a.fim)
    return { bg: 'rgba(141,163,178,.18)', ink: '#6b7f8c' };
  if (agora != null && agora >= a.inicio && agora < a.fim)
    return { bg: 'color-mix(in srgb, hsl(var(--info)) 20%, transparent)', ink: 'hsl(var(--info))' };
  return { bg: 'color-mix(in srgb, hsl(var(--ok)) 18%, transparent)', ink: 'hsl(var(--ok))' };
}

export function Timeline({
  setores,
  picos,
  agora,
  stepMin = 60,
}: {
  setores: SetorRow[];
  picos: Faixa[];
  agora: number | null;
  stepMin?: number; // granularidade da grade em minutos (15/30/60/120); padrão 1h
}) {
  const pts: number[] = [];
  setores.forEach((s) => {
    s.alocacoes.forEach((a) => pts.push(a.inicio, a.fim));
    s.tarefas.forEach((t) => pts.push(t.horario));
  });
  picos.forEach((p) => pts.push(p.inicio, p.fim));
  if (agora != null) pts.push(agora);

  const vazio = setores.length === 0 && picos.length === 0;
  if (vazio) {
    return (
      <p className="px-5 py-6 text-sm text-muted-foreground">
        Sem escala para hoje. Monte a <strong>escala do dia</strong> (colaborador +
        turno por setor) para ver quem está escalado e o que deveria estar em
        execução agora. Tarefas com horário e janelas de pico também aparecem aqui.
      </p>
    );
  }

  const min = pts.length ? Math.max(0, Math.floor(Math.min(...pts)) - 1) : 6;
  const max = pts.length ? Math.min(24, Math.ceil(Math.max(...pts)) + 1) : 22;
  const span = Math.max(1, max - min);
  const pct = (h: number) => ((h - min) / span) * 100;
  // Grade por passo escolhido (15/30/60/120 min). Começa alinhada a um múltiplo do
  // passo. Rótulos ficam ao menos de hora em hora (finos não poluem): a cada passo
  // quando >=1h, e de hora em hora quando 15/30 min.
  const step = Math.max(0.25, (stepMin || 60) / 60); // horas por linha da grade
  const ticks: number[] = [];
  for (let h = Math.ceil(min / step) * step; h <= max + 1e-9; h += step)
    ticks.push(Number(h.toFixed(4)));
  const labelEvery = step < 1 ? Math.round(1 / step) : 1; // 15min→4, 30min→2, ≥1h→1

  return (
    <div className="overflow-x-auto px-3 py-4">
      <div className="min-w-[620px]">
        {/* grade: rótulo do setor + trilha */}
        <div className="grid grid-cols-[92px_1fr]">
          {/* faixa discreta com o nome dos picos, no topo */}
          {picos.length > 0 && (
            <>
              <div className="flex items-center justify-end pr-2 text-[9px] font-bold uppercase tracking-wide text-warn/70">
                pico
              </div>
              <div className="relative mb-0.5 h-3.5">
                {picos.map((p, i) => (
                  <span
                    key={`pl${i}`}
                    className="pointer-events-none absolute top-0 flex items-center gap-0.5 whitespace-nowrap text-[9px] font-bold text-warn"
                    style={{ left: `${pct(p.inicio)}%` }}
                    title={`${p.nome} · ${hhmm(p.inicio)}–${hhmm(p.fim)}`}
                  >
                    🔥 {p.nome}
                  </span>
                ))}
              </div>
            </>
          )}
          {/* régua de horas (só na coluna da trilha) */}
          <div />
          <div className="relative mb-1 h-4">
            {ticks.filter((_, i) => i % labelEvery === 0).map((h) => (
              <span
                key={h}
                className="absolute -translate-x-1/2 font-mono text-[10px] text-muted-foreground"
                style={{ left: `${pct(h)}%` }}
              >
                {Number.isInteger(h) ? `${h}h` : hhmm(h)}
              </span>
            ))}
          </div>

          {/* uma linha por setor */}
          {setores.map((s, si) => (
            <div key={si} className="contents">
              <div className="flex items-center pr-2 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
                {s.setor}
              </div>
              <div className="relative border-t border-border py-1.5">
                {/* grade vertical + janelas de pico + agora */}
                {ticks.map((h) => (
                  <span key={h} className="absolute inset-y-0 w-px bg-border/60" style={{ left: `${pct(h)}%` }} />
                ))}
                {picos.map((p, i) => (
                  <span
                    key={`pk${i}`}
                    className="pointer-events-none absolute inset-y-0 border-x-2 border-warn/60 bg-warn/30"
                    style={{ left: `${pct(p.inicio)}%`, width: `${Math.max(0.8, pct(p.fim) - pct(p.inicio))}%` }}
                    title={`Pico: ${p.nome} (${hhmm(p.inicio)}–${hhmm(p.fim)})`}
                  />
                ))}
                {agora != null && (
                  <span className="absolute inset-y-0 z-10 w-0.5 bg-destructive" style={{ left: `${pct(agora)}%` }} title={`Agora · ${hhmm(agora)}`} />
                )}

                {/* blocos de alocação (quem está escalado) */}
                <div className="relative space-y-1">
                  {s.alocacoes.length === 0 && <div className="h-6" />}
                  {s.alocacoes.map((a, ai) => {
                    const c = corAloc(a, agora);
                    return (
                      <div key={ai} className="relative h-6">
                        <div
                          className="absolute inset-y-0 flex items-center gap-1 overflow-hidden rounded-md px-2"
                          style={{
                            left: `${pct(a.inicio)}%`,
                            width: `${Math.max(3, pct(a.fim) - pct(a.inicio))}%`,
                            background: c.bg,
                          }}
                          title={`${a.colaborador}${a.funcao ? ` · ${a.funcao}` : ''} · ${a.turno ?? ''} (${hhmm(a.inicio)}–${hhmm(a.fim)})`}
                        >
                          <span className="truncate text-[11px] font-semibold" style={{ color: c.ink }}>
                            {a.colaborador}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* tarefas com horário (marcador + nome da tarefa) */}
                {s.tarefas.length > 0 && (
                  <div className="relative mt-1 h-4">
                    {s.tarefas.map((t, ti) => (
                      <span
                        key={ti}
                        className="absolute top-0 flex items-center gap-1 whitespace-nowrap"
                        style={{ left: `${pct(t.horario)}%` }}
                        title={`${hhmm(t.horario)} · ${t.titulo} (${t.estado})`}
                      >
                        <span className="-ml-1 block h-2 w-2 flex-none rounded-full ring-2 ring-card" style={{ background: `hsl(${ESTADO_COR[t.estado] || 'var(--muted-foreground)'})` }} />
                        <span className="max-w-[96px] truncate text-[9px] leading-none text-muted-foreground">{t.titulo}</span>
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* legenda */}
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
          <Leg cor="hsl(var(--ok))" label="em dia" />
          <Leg cor="hsl(var(--info))" label="em execução" />
          <Leg cor="#8DA3B2" label="concluído" />
          <Leg cor="hsl(var(--warn))" label="atenção / sem responsável" />
          <span className="inline-flex items-center gap-1.5">
            <span className="h-3 w-0.5 bg-destructive" /> agora
          </span>
        </div>
      </div>
    </div>
  );
}

function Leg({ cor, label }: { cor: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="h-2.5 w-4 rounded" style={{ background: cor }} /> {label}
    </span>
  );
}
