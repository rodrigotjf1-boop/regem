'use client';

type Faixa = { nome: string; inicio: number; fim: number };
type TarefaT = {
  titulo: string;
  horario: number;
  estado: string;
  setor: string | null;
  etiqueta: string | null;
};

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

export function Timeline({
  turnos,
  picos,
  tarefas,
}: {
  turnos: Faixa[];
  picos: Faixa[];
  tarefas: TarefaT[];
}) {
  const pts: number[] = [];
  turnos.forEach((t) => pts.push(t.inicio, t.fim));
  picos.forEach((p) => pts.push(p.inicio, p.fim));
  tarefas.forEach((t) => pts.push(t.horario));

  const vazio = turnos.length === 0 && tarefas.length === 0 && picos.length === 0;
  if (vazio) {
    return (
      <p className="px-5 py-6 text-sm text-muted-foreground">
        Sem dados de horário para hoje. Cadastre <strong>turnos</strong> (com
        início/fim), defina <strong>horários nas tarefas</strong> e{' '}
        <strong>janelas de pico</strong> para ver a linha do tempo.
      </p>
    );
  }

  const min = pts.length ? Math.max(0, Math.floor(Math.min(...pts)) - 1) : 6;
  const max = pts.length ? Math.min(24, Math.ceil(Math.max(...pts)) + 1) : 24;
  const span = Math.max(1, max - min);
  const pct = (h: number) => ((h - min) / span) * 100;
  const ticks: number[] = [];
  for (let h = min; h <= max; h += 2) ticks.push(h);

  return (
    <div className="px-5 py-4">
      {/* régua de horas */}
      <div className="relative mb-1 h-4">
        {ticks.map((h) => (
          <span
            key={h}
            className="absolute -translate-x-1/2 font-mono text-[10px] text-muted-foreground"
            style={{ left: `${pct(h)}%` }}
          >
            {h}h
          </span>
        ))}
      </div>

      {/* faixa: turnos ao fundo, picos por cima */}
      <div className="relative rounded-lg border border-border bg-muted/30">
        {/* linhas verticais das horas */}
        {ticks.map((h) => (
          <span
            key={h}
            className="absolute inset-y-0 w-px bg-border/70"
            style={{ left: `${pct(h)}%` }}
          />
        ))}

        {/* turnos (cada um numa linha) */}
        <div className="relative space-y-1 p-2">
          {turnos.length === 0 && (
            <div className="h-7 text-[11px] text-muted-foreground">
              Sem turnos cadastrados
            </div>
          )}
          {turnos.map((t, i) => (
            <div key={i} className="relative h-7">
              <div
                className="absolute inset-y-0 flex items-center overflow-hidden rounded-md bg-primary/15 px-2"
                style={{
                  left: `${pct(t.inicio)}%`,
                  width: `${Math.max(2, pct(t.fim) - pct(t.inicio))}%`,
                }}
              >
                <span className="truncate text-[11px] font-semibold text-primary">
                  {t.nome}
                </span>
              </div>
            </div>
          ))}
        </div>

        {/* picos: overlay translúcido sobre toda a área */}
        {picos.map((p, i) => (
          <div
            key={i}
            className="pointer-events-none absolute inset-y-0 border-x border-destructive/40 bg-destructive/10"
            style={{
              left: `${pct(p.inicio)}%`,
              width: `${Math.max(1, pct(p.fim) - pct(p.inicio))}%`,
            }}
            title={`Pico: ${p.nome} (${hhmm(p.inicio)}–${hhmm(p.fim)})`}
          >
            <span className="absolute left-1 top-0 text-[9px] font-bold uppercase tracking-wide text-destructive">
              {p.nome}
            </span>
          </div>
        ))}
      </div>

      {/* tarefas com horário */}
      {tarefas.length > 0 && (
        <div className="relative mt-2 h-6">
          {tarefas.map((t, i) => {
            const cor = ESTADO_COR[t.estado] || 'var(--muted-foreground)';
            return (
              <span
                key={i}
                className="absolute top-0 -translate-x-1/2"
                style={{ left: `${pct(t.horario)}%` }}
                title={`${hhmm(t.horario)} · ${t.titulo}${
                  t.setor ? ` · ${t.setor}` : ''
                } (${t.estado})`}
              >
                <span
                  className="block h-2.5 w-2.5 rounded-full ring-2 ring-card"
                  style={{ background: `hsl(${cor})` }}
                />
              </span>
            );
          })}
        </div>
      )}

      {/* legenda */}
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-4 rounded bg-primary/15" /> turno
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-4 rounded border-x border-destructive/40 bg-destructive/10" />{' '}
          pico
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span
            className="h-2.5 w-2.5 rounded-full"
            style={{ background: 'hsl(var(--ok))' }}
          />{' '}
          tarefa (cor = estado)
        </span>
      </div>
    </div>
  );
}
