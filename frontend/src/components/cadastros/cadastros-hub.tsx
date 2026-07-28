'use client';

import { META } from '@/components/cadastros/constants';
import { type Secao } from '@/components/cadastros/build-secoes';

/* eslint-disable @typescript-eslint/no-explicit-any */

export function CadastrosHub({
  secoes,
  onSelect,
  onNavigate,
}: {
  secoes: Secao[];
  onSelect: (key: string) => void;
  onNavigate: (path: string) => void;
}) {
  const feitas = secoes.filter((s) => s.itens.length > 0).length;
  const pct = Math.round((feitas / secoes.length) * 100);
  const tint = (key: string) =>
    key === 'pico' || key === 'fornecedor'
      ? 'bg-warn/10'
      : key === 'colaborador' || key === 'turno'
        ? 'bg-ok/10'
        : 'bg-info/10';

  return (
    <>
      {/* Completude — faixa minimalista, sem roubar a atenção dos cards */}
      <div className="flex items-center gap-3 px-1 text-xs text-muted-foreground">
        <span className="font-mono font-bold text-primary">{pct}%</span>
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-secondary">
          <div
            className="h-full rounded-full bg-primary transition-all duration-700"
            style={{ width: `${pct}%` }}
          />
        </div>
        <span className="whitespace-nowrap">
          {feitas}/{secoes.length} com dados
        </span>
      </div>

      {/* Grid por dependência */}
      <p className="px-1 font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
        Ordem sugerida — cada etapa habilita a próxima
      </p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {secoes.map((sec) => {
          const m = META[sec.key];
          const zero = sec.itens.length === 0;
          return (
            <button
              key={sec.key}
              type="button"
              onClick={() => onSelect(sec.key)}
              className={`relative flex flex-col gap-3 rounded-2xl border bg-card p-5 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-primary/40 ${
                zero ? 'border-dashed border-input' : 'border-border'
              }`}
            >
              {zero && m?.nudge && (
                <span className="absolute -top-2 left-4 rounded-full bg-primary px-2.5 py-0.5 font-mono text-[9px] font-bold uppercase tracking-[0.14em] text-primary-foreground">
                  Comece por aqui
                </span>
              )}
              <div className="flex items-start gap-3">
                <div
                  className={`grid h-10 w-10 flex-none place-items-center rounded-xl text-lg ${tint(
                    sec.key,
                  )}`}
                >
                  {m?.icon ?? '📋'}
                </div>
                <div>
                  <div className="font-mono text-[9.5px] uppercase tracking-[0.14em] text-muted-foreground">
                    Passo {m?.step ?? '—'}
                  </div>
                  <h3 className="font-display text-[15px] font-bold">
                    {sec.titulo}
                  </h3>
                </div>
                <span className="ml-auto grid h-8 w-8 flex-none place-items-center rounded-lg border border-border bg-secondary text-base text-muted-foreground">
                  ＋
                </span>
              </div>
              <div
                className={`font-mono text-2xl font-bold ${
                  zero ? 'text-muted-foreground' : ''
                }`}
              >
                {sec.itens.length}{' '}
                <small className="font-sans text-xs font-medium text-muted-foreground">
                  cadastrado(s)
                </small>
              </div>
              {zero && m?.nudge ? (
                <div className="rounded-lg bg-info/10 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
                  💡 {m.nudge}
                </div>
              ) : (
                <div className="text-xs text-muted-foreground">
                  {zero ? 'Ainda sem cadastros' : 'Toque para ver e adicionar'}
                </div>
              )}
            </button>
          );
        })}
      </div>

      {/* Produtos & Equipamentos (fora da cadeia de dependência) — cards quadrados
          no mesmo padrão dos 8 acima. */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <button
          type="button"
          onClick={() => onNavigate('/produtos')}
          className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-5 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-primary/40"
        >
          <div className="flex items-start gap-3">
            <div className="grid h-10 w-10 flex-none place-items-center rounded-xl bg-ok/10 text-lg">
              🍔
            </div>
            <div>
              <div className="font-mono text-[9.5px] uppercase tracking-[0.14em] text-muted-foreground">
                Catálogo
              </div>
              <h3 className="font-display text-[15px] font-bold">Cardápio</h3>
            </div>
          </div>
          <div className="text-xs leading-relaxed text-muted-foreground">
            Cadastro completo dos produtos vendidos no balcão (PDV) e no cardápio
            digital — cada produto escolhe onde aparece. Ligados às fichas técnicas.
          </div>
        </button>

        <button
          type="button"
          onClick={() => onNavigate('/equipamentos')}
          className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-5 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-primary/40"
        >
          <div className="flex items-start gap-3">
            <div className="grid h-10 w-10 flex-none place-items-center rounded-xl bg-info/10 text-lg">
              🖥️
            </div>
            <div>
              <div className="font-mono text-[9.5px] uppercase tracking-[0.14em] text-muted-foreground">
                Sistema
              </div>
              <h3 className="font-display text-[15px] font-bold">Equipamentos & Apps</h3>
            </div>
          </div>
          <div className="text-xs leading-relaxed text-muted-foreground">
            Cadastrar KDS e Terminais de Ponto (device token).
          </div>
        </button>
      </div>
    </>
  );
}
