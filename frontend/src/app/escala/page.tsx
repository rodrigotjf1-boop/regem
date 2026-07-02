'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { api, getToken } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { NovaAlocacaoForm } from '@/components/escala/nova-alocacao-form';
import { Shell } from '@/components/app-shell/shell';
import { cn } from '@/lib/utils';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Aloc = {
  id: string;
  data: string;
  tipo: string;
  etiquetaId: string | null;
  etiquetaSigla: string | null;
  etiquetaContador: number | null;
  etiquetaCor: string | null;
  setorNome: string | null;
  turnoNome: string | null;
  colaboradorNome: string | null;
};
type Etiqueta = {
  id: string;
  sigla: string;
  contador: number;
  cor: string | null;
  setorId: string | null;
};

function iso(d: Date) {
  return d.toISOString().slice(0, 10);
}
function hoje() {
  return iso(new Date());
}
function addDays(s: string, n: number) {
  const d = new Date(`${s}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return iso(d);
}
function mondayOf(s: string) {
  const d = new Date(`${s}T00:00:00Z`);
  const dow = d.getUTCDay();
  d.setUTCDate(d.getUTCDate() + (dow === 0 ? -6 : 1 - dow));
  return iso(d);
}
function fmtDia(s: string) {
  const d = new Date(`${s}T00:00:00`);
  return {
    semana: d
      .toLocaleDateString('pt-BR', { weekday: 'short' })
      .replace('.', ''),
    dm: d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }),
  };
}

export default function EscalaPage() {
  const router = useRouter();
  const [inicio, setInicio] = useState(() => mondayOf(hoje()));
  const [semana, setSemana] = useState<Aloc[]>([]);
  const [etiquetas, setEtiquetas] = useState<Etiqueta[]>([]);
  const [setorMap, setSetorMap] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState('');
  const [alocar, setAlocar] = useState<{ etiquetaId?: string; data: string } | null>(
    null,
  );

  const carregar = useCallback(async () => {
    setLoading(true);
    setErro('');
    try {
      const [aloc, ets, setores] = await Promise.all([
        api.escalaSemana(inicio),
        api.etiquetas(),
        api.setores(),
      ]);
      setSemana(aloc);
      setEtiquetas(ets);
      setSetorMap(
        Object.fromEntries((setores as any[]).map((s) => [s.id, s.nome])),
      );
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao carregar');
    } finally {
      setLoading(false);
    }
  }, [inicio]);

  useEffect(() => {
    if (!getToken()) {
      router.replace('/');
      return;
    }
    carregar();
  }, [carregar, router]);

  const dias = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDays(inicio, i)),
    [inicio],
  );

  // Mapa célula: etiquetaId|data -> alocações
  const cell = useMemo(() => {
    const m: Record<string, Aloc[]> = {};
    for (const a of semana) {
      const k = `${a.etiquetaId}|${a.data}`;
      (m[k] ??= []).push(a);
    }
    return m;
  }, [semana]);

  // Vagas agrupadas por setor
  const grupos = useMemo(() => {
    const g: Record<string, Etiqueta[]> = {};
    for (const e of etiquetas) {
      const nome = (e.setorId && setorMap[e.setorId]) || 'Sem setor';
      (g[nome] ??= []).push(e);
    }
    return Object.entries(g).sort((a, b) => a[0].localeCompare(b[0]));
  }, [etiquetas, setorMap]);

  const rotulo = `${fmtDia(inicio).dm} – ${fmtDia(addDays(inicio, 6)).dm}`;

  return (
    <Shell
      eyebrow="Gestão de pessoas · escala"
      title="Escala da semana"
      actions={
        <Button size="sm" onClick={() => setAlocar({ data: hoje() })}>
          <Plus className="h-4 w-4" /> Nova alocação
        </Button>
      }
    >
      <div className="mb-4 flex items-center gap-2">
        <Button
          variant="outline"
          size="icon"
          aria-label="Semana anterior"
          onClick={() => setInicio((s) => addDays(s, -7))}
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <div className="min-w-[150px] text-center">
          <p className="font-display text-sm font-bold">{rotulo}</p>
          <button
            type="button"
            onClick={() => setInicio(mondayOf(hoje()))}
            className="text-xs text-primary hover:underline"
          >
            ir para esta semana
          </button>
        </div>
        <Button
          variant="outline"
          size="icon"
          aria-label="Próxima semana"
          onClick={() => setInicio((s) => addDays(s, 7))}
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>

      {erro && <p className="mb-4 text-destructive">{erro}</p>}
      {loading && <p className="text-muted-foreground">Carregando…</p>}

      {!loading && etiquetas.length === 0 && (
        <Card className="p-8 text-center text-muted-foreground">
          Nenhuma vaga (etiqueta) cadastrada. Crie vagas em{' '}
          <button
            type="button"
            className="text-primary hover:underline"
            onClick={() => router.push('/cadastros')}
          >
            Cadastros
          </button>
          .
        </Card>
      )}

      {!loading && etiquetas.length > 0 && (
        <Card className="overflow-x-auto p-0">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="sticky left-0 z-10 bg-card px-3 py-2.5 text-left font-display text-[10px] font-bold uppercase tracking-[.1em] text-muted-foreground">
                  Vaga
                </th>
                {dias.map((d) => {
                  const f = fmtDia(d);
                  const isHoje = d === hoje();
                  return (
                    <th
                      key={d}
                      className={cn(
                        'min-w-[120px] px-2 py-2.5 text-center font-display text-[11px] font-bold uppercase tracking-wide',
                        isHoje ? 'text-primary' : 'text-muted-foreground',
                      )}
                    >
                      <span className="block">{f.semana}</span>
                      <span
                        className={cn(
                          'block font-mono text-xs',
                          isHoje && 'text-primary',
                        )}
                      >
                        {f.dm}
                      </span>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {grupos.map(([setorNome, vagas]) => (
                <FragmentSetor
                  key={setorNome}
                  setorNome={setorNome}
                  vagas={vagas}
                  dias={dias}
                  cell={cell}
                  onCell={(etiquetaId, data) => setAlocar({ etiquetaId, data })}
                />
              ))}
            </tbody>
          </table>
        </Card>
      )}

      <p className="mt-3 text-xs text-muted-foreground">
        Clique em qualquer célula para alocar um colaborador naquela vaga e dia.
        Conflitos (mesma pessoa em dois lugares) são bloqueados automaticamente.
      </p>

      {alocar && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 pt-16"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-md">
            <NovaAlocacaoForm
              data={alocar.data}
              defaultEtiquetaId={alocar.etiquetaId}
              onCancel={() => setAlocar(null)}
              onCreated={() => {
                setAlocar(null);
                carregar();
              }}
            />
          </div>
        </div>
      )}
    </Shell>
  );
}

function FragmentSetor({
  setorNome,
  vagas,
  dias,
  cell,
  onCell,
}: {
  setorNome: string;
  vagas: Etiqueta[];
  dias: string[];
  cell: Record<string, Aloc[]>;
  onCell: (etiquetaId: string, data: string) => void;
}) {
  return (
    <>
      <tr className="bg-muted/40">
        <td
          colSpan={dias.length + 1}
          className="px-3 py-1.5 font-display text-[11px] font-bold uppercase tracking-wide text-muted-foreground"
        >
          {setorNome}
        </td>
      </tr>
      {vagas.map((v) => (
        <tr key={v.id} className="border-b border-border last:border-0">
          <td className="sticky left-0 z-10 whitespace-nowrap bg-card px-3 py-2">
            <span className="inline-flex items-center gap-2">
              <span
                className="h-2.5 w-2.5 flex-none rounded-full"
                style={{ background: v.cor || 'hsl(var(--muted-foreground))' }}
              />
              <span className="font-mono text-xs font-bold">
                {v.sigla}
                {v.contador}
              </span>
            </span>
          </td>
          {dias.map((d) => {
            const allocs = cell[`${v.id}|${d}`] ?? [];
            return (
              <td
                key={d}
                onClick={() => onCell(v.id, d)}
                className="cursor-pointer border-l border-border px-1.5 py-1.5 align-top transition-colors hover:bg-primary/5"
              >
                {allocs.length === 0 ? (
                  <span className="flex h-7 items-center justify-center text-muted-foreground/40">
                    <Plus className="h-3.5 w-3.5" />
                  </span>
                ) : (
                  <div className="space-y-1">
                    {allocs.map((a) => (
                      <div
                        key={a.id}
                        className="rounded-md bg-secondary px-1.5 py-1 leading-tight"
                      >
                        <p className="truncate text-[11px] font-semibold">
                          {a.colaboradorNome ?? 'Vaga aberta'}
                        </p>
                        {a.turnoNome && (
                          <p className="truncate text-[10px] text-muted-foreground">
                            {a.turnoNome}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </td>
            );
          })}
        </tr>
      ))}
    </>
  );
}
