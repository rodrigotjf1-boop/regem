'use client';

import { Card } from '@/components/ui/card';
import { corHierarquia } from '@/lib/hierarquia';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Aloc = any;
type Colab = { id: string; nome: string };

const EMOJI: Record<string, string> = {
  feriado: '🎉',
  ferias: '🏖️',
  evento: '📅',
  folga: '😴',
  outro: '⭐',
};

// Grade mensal resumida: colaboradores × dias do mês. Cada célula mostra a
// sigla da vaga (colorida pela hierarquia) ou fica vazia (folga).
export function GradeMensal({
  mesCursor,
  alocacoes,
  colabs,
  especiais,
}: {
  mesCursor: string; // YYYY-MM
  alocacoes: Aloc[];
  colabs: Colab[];
  especiais: Aloc[];
}) {
  const [ano, mes] = mesCursor.split('-').map(Number);
  const nDias = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
  const dias = Array.from(
    { length: nDias },
    (_, i) => `${mesCursor}-${String(i + 1).padStart(2, '0')}`,
  );

  const byColab: Record<string, Record<string, Aloc>> = {};
  for (const a of alocacoes) {
    if (!a.colaboradorId) continue;
    (byColab[a.colaboradorId] ??= {})[a.data] = a;
  }
  const linhas = colabs.filter((c) => byColab[c.id]);
  const espDoDia = (d: string) =>
    especiais.filter((e) => e.data <= d && (e.dataFim ?? e.data) >= d);
  const nomeDia = (d: string) =>
    new Date(`${d}T00:00:00`).toLocaleDateString('pt-BR', { weekday: 'narrow' });

  if (linhas.length === 0) {
    return (
      <Card className="p-8 text-center text-sm text-muted-foreground">
        Ninguém escalado neste mês.
      </Card>
    );
  }

  return (
    <Card className="overflow-x-auto p-0">
      <table className="w-full border-collapse text-xs">
        <thead>
          <tr className="border-b border-border">
            <th className="sticky left-0 z-10 bg-card px-3 py-2 text-left font-display text-[10px] font-bold uppercase text-muted-foreground">
              Colaborador
            </th>
            {dias.map((d) => {
              const esp = espDoDia(d);
              return (
                <th
                  key={d}
                  className="min-w-[26px] px-0.5 py-1 text-center font-mono text-[10px] text-muted-foreground"
                  title={esp.map((e) => e.nome).join(', ')}
                >
                  <div>{d.slice(8)}</div>
                  <div className="text-[9px] uppercase">{nomeDia(d)}</div>
                  {esp.length > 0 && <div>{EMOJI[esp[0].tipo] ?? '⭐'}</div>}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {linhas.map((c) => (
            <tr key={c.id} className="border-b border-border last:border-0">
              <td className="sticky left-0 z-10 whitespace-nowrap bg-card px-3 py-1.5 font-medium">
                {c.nome}
              </td>
              {dias.map((d) => {
                const a = byColab[c.id]?.[d];
                if (!a) return <td key={d} className="border-l border-border/50" />;
                const cor = corHierarquia(a.categoria);
                return (
                  <td
                    key={d}
                    className="border-l border-border/50 px-0.5 py-1 text-center"
                    title={`${a.etiquetaSigla}${a.etiquetaContador} · ${a.turnoNome ?? ''}`}
                  >
                    <span
                      className="inline-block rounded px-1 font-mono text-[9px] font-bold"
                      style={{ background: `${cor}22`, color: cor }}
                    >
                      {a.etiquetaSigla}
                      {a.etiquetaContador}
                    </span>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}
