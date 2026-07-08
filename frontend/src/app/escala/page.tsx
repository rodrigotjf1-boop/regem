'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronLeft, ChevronRight, Plus, Trash2 } from 'lucide-react';
import { api, getToken } from '@/lib/api';
import { toast } from '@/lib/toast';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Select } from '@/components/ui/select';
import { SkeletonList } from '@/components/ui/skeleton';
import { NovaAlocacaoForm } from '@/components/escala/nova-alocacao-form';
import { TimelineDia } from '@/components/escala/timeline-dia';
import { GradeMensal } from '@/components/escala/grade-mensal';
import { Shell } from '@/components/app-shell/shell';
import { cn } from '@/lib/utils';
import { corHierarquia, LABEL_HIERARQUIA, ORDEM_HIERARQUIA } from '@/lib/hierarquia';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Aloc = {
  id: string;
  data: string;
  tipo: string;
  etiquetaId: string | null;
  etiquetaSigla: string | null;
  etiquetaContador: number | null;
  categoria: string | null;
  setorNome: string | null;
  setorCor: string | null;
  turnoNome: string | null;
  colaboradorNome: string | null;
};
type Etiqueta = {
  id: string;
  sigla: string;
  contador: number;
  cor: string | null;
  setorId: string | null;
  setorNome: string | null;
  setorCor: string | null;
  categoria: string | null;
  funcaoId: string | null;
};
type Colab = { id: string; nome: string; funcaoIds?: string[] };
type Grupo = { setorId: string; nome: string; cor: string | null; vagas: Etiqueta[] };

function iso(d: Date) {
  return d.toISOString().slice(0, 10);
}
function hoje() {
  // Data de "hoje" no fuso de SP (en-CA formata YYYY-MM-DD). Usar toISOString
  // aqui daria a data em UTC — à noite no Brasil apontaria o dia seguinte.
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
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

const EMOJI_ESPECIAL: Record<string, string> = {
  feriado: '🎉',
  ferias: '🏖️',
  evento: '📅',
  folga: '😴',
  outro: '⭐',
};

export default function EscalaPage() {
  const router = useRouter();
  const [inicio, setInicio] = useState(() => mondayOf(hoje()));
  const [semana, setSemana] = useState<Aloc[]>([]);
  const [etiquetas, setEtiquetas] = useState<Etiqueta[]>([]);
  const [colabs, setColabs] = useState<Colab[]>([]);
  const [especiais, setEspeciais] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  // Visões: semana (grade) · dia (timeline) · mês (tabela).
  const [view, setView] = useState<'semana' | 'dia' | 'mes'>('semana');
  const [diaSel, setDiaSel] = useState(() => hoje());
  const [diaAloc, setDiaAloc] = useState<any[]>([]);
  const [diaEsp, setDiaEsp] = useState<any[]>([]);
  const [mesCursor, setMesCursor] = useState(() => hoje().slice(0, 7)); // YYYY-MM
  const [mesAloc, setMesAloc] = useState<any[]>([]);
  const [mesEsp, setMesEsp] = useState<any[]>([]);
  const [erro, setErro] = useState('');
  const [alocar, setAlocar] = useState<{ etiquetaId?: string; data: string } | null>(
    null,
  );
  // Visão por dia (mobile): índice 0–6 dentro da semana.
  const [diaIdx, setDiaIdx] = useState(() => {
    const h = hoje();
    const base = mondayOf(h);
    const i = Array.from({ length: 7 }, (_, n) => addDays(base, n)).indexOf(h);
    return i >= 0 ? i : 0;
  });
  function irDia(delta: number) {
    setDiaIdx((cur) => {
      const n = cur + delta;
      if (n < 0) {
        setInicio((s) => addDays(s, -7));
        return 6;
      }
      if (n > 6) {
        setInicio((s) => addDays(s, 7));
        return 0;
      }
      return n;
    });
  }

  const carregar = useCallback(async () => {
    setLoading(true);
    setErro('');
    try {
      const [aloc, ets, cs, esp] = await Promise.all([
        api.escalaSemana(inicio),
        api.etiquetas(),
        api.colaboradores(),
        api.diasEspeciais(inicio, addDays(inicio, 6)),
      ]);
      setSemana(aloc);
      setEtiquetas(ets);
      setColabs(cs);
      setEspeciais(esp as any[]);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao carregar');
    } finally {
      setLoading(false);
    }
  }, [inicio]);

  useEffect(() => {
    if (!getToken()) {
      router.replace('/entrar');
      return;
    }
    carregar();
  }, [carregar, router]);

  // Visão Dia: alocações + dias especiais do dia selecionado.
  useEffect(() => {
    if (view !== 'dia' || !getToken()) return;
    Promise.all([api.escalaPeriodo(diaSel, diaSel), api.diasEspeciais(diaSel, diaSel)])
      .then(([a, e]) => {
        setDiaAloc(a as any[]);
        setDiaEsp(e as any[]);
      })
      .catch(() => {});
  }, [view, diaSel]);

  // Visão Mês: alocações + dias especiais do mês.
  useEffect(() => {
    if (view !== 'mes' || !getToken()) return;
    const ini = `${mesCursor}-01`;
    const d = new Date(`${ini}T00:00:00Z`);
    d.setUTCMonth(d.getUTCMonth() + 1);
    d.setUTCDate(0);
    const fim = d.toISOString().slice(0, 10);
    Promise.all([api.escalaPeriodo(ini, fim), api.diasEspeciais(ini, fim)])
      .then(([a, e]) => {
        setMesAloc(a as any[]);
        setMesEsp(e as any[]);
      })
      .catch(() => {});
  }, [view, mesCursor]);

  function irMes(delta: number) {
    const [ano, mes] = mesCursor.split('-').map(Number);
    const d = new Date(Date.UTC(ano, mes - 1 + delta, 1));
    setMesCursor(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`);
  }
  const fmtMes = (ym: string) => {
    const [a, m] = ym.split('-').map(Number);
    return new Date(Date.UTC(a, m - 1, 1)).toLocaleDateString('pt-BR', {
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC',
    });
  };

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

  // Vagas agrupadas por setor (nome + cor do setor).
  const grupos: Grupo[] = useMemo(() => {
    const g: Record<string, Grupo> = {};
    for (const e of etiquetas) {
      const key = e.setorId ?? 'sem';
      if (!g[key])
        g[key] = {
          setorId: key,
          nome: e.setorNome ?? 'Sem setor',
          cor: e.setorCor ?? null,
          vagas: [],
        };
      g[key].vagas.push(e);
    }
    return Object.values(g).sort((a, b) => a.nome.localeCompare(b.nome));
  }, [etiquetas]);

  // Colaboradores elegíveis para uma vaga = os que cobrem a função dela.
  const elegiveis = useCallback(
    (funcaoId?: string | null) =>
      funcaoId ? colabs.filter((c) => (c.funcaoIds ?? []).includes(funcaoId)) : colabs,
    [colabs],
  );

  // Dias importantes que cobrem uma data (feriado/férias/evento da rede;
  // os por colaborador aparecem como nota também).
  const especiaisDoDia = useCallback(
    (d: string) => especiais.filter((e) => e.data <= d && (e.dataFim ?? e.data) >= d),
    [especiais],
  );

  async function removerAloc(id: string) {
    if (!confirm('Remover esta alocação?')) return;
    try {
      await api.removerAlocacao(id);
      toast.success('Alocação removida.');
      await carregar();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro ao remover');
    }
  }
  async function trocarResp(id: string, colaboradorId: string) {
    try {
      const r: any = await api.alterarAlocacao(id, { colaboradorId: colaboradorId || null });
      toast.success(colaboradorId ? 'Responsável atualizado.' : 'Vaga reaberta.');
      (r?.avisos ?? []).forEach((a: any) => toast.error(`⚠️ ${a.msg}`));
      await carregar();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro ao alterar');
    }
  }

  const rotulo = `${fmtDia(inicio).dm} – ${fmtDia(addDays(inicio, 6)).dm}`;

  // Dados do modal (alocações existentes na célula + vaga selecionada).
  const vagaSel = alocar?.etiquetaId
    ? etiquetas.find((e) => e.id === alocar.etiquetaId)
    : undefined;
  const existentes = alocar?.etiquetaId
    ? cell[`${alocar.etiquetaId}|${alocar.data}`] ?? []
    : [];
  const elegVaga = elegiveis(vagaSel?.funcaoId);

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
      {/* Alternador de visões */}
      <div className="mb-4 flex gap-1.5">
        {(['semana', 'dia', 'mes'] as const).map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => setView(v)}
            aria-pressed={view === v ? 'true' : 'false'}
            className={`rounded-md border px-3 py-1.5 text-sm font-medium capitalize ${
              view === v
                ? 'border-primary bg-primary/15 text-primary'
                : 'border-border text-muted-foreground hover:border-primary/50'
            }`}
          >
            {v === 'mes' ? 'Mês' : v}
          </button>
        ))}
      </div>

      {view === 'semana' && (
        <>
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

      {/* Legenda de hierarquia (define a cor das vagas). */}
      <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span className="font-medium">Hierarquia:</span>
        {ORDEM_HIERARQUIA.map((c) => (
          <span key={c} className="inline-flex items-center gap-1">
            <span
              className="h-2.5 w-2.5 rounded-full"
              style={{ background: corHierarquia(c) }}
            />
            {LABEL_HIERARQUIA[c]}
          </span>
        ))}
      </div>

      {erro && <p className="mb-4 text-destructive">{erro}</p>}
      {loading && <SkeletonList rows={5} />}

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

      {/* Grade semanal (desktop ≥700px) */}
      {!loading && etiquetas.length > 0 && (
        <Card className="hidden overflow-x-auto p-0 min-[700px]:block">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="sticky left-0 z-10 bg-card px-3 py-2.5 text-left font-display text-[10px] font-bold uppercase tracking-[.1em] text-muted-foreground">
                  Vaga
                </th>
                {dias.map((d) => {
                  const f = fmtDia(d);
                  const isHoje = d === hoje();
                  const esp = especiaisDoDia(d);
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
                      {esp.length > 0 && (
                        <span
                          className="mt-0.5 block text-xs"
                          title={esp.map((e) => e.nome).join(', ')}
                        >
                          {esp.map((e) => EMOJI_ESPECIAL[e.tipo] ?? '⭐').join(' ')}
                        </span>
                      )}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {grupos.map((g) => (
                <FragmentSetor
                  key={g.setorId}
                  grupo={g}
                  dias={dias}
                  cell={cell}
                  onCell={(etiquetaId, data) => setAlocar({ etiquetaId, data })}
                />
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {/* Visão por dia (mobile <700px) */}
      {!loading && etiquetas.length > 0 && (
        <div className="min-[700px]:hidden">
          <div className="mb-3 flex items-center gap-2">
            <Button variant="outline" size="icon" aria-label="Dia anterior" onClick={() => irDia(-1)}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <div className="flex-1 text-center">
              <p className="font-display text-sm font-bold capitalize">
                {fmtDia(dias[diaIdx]).semana} · {fmtDia(dias[diaIdx]).dm}
              </p>
              {dias[diaIdx] === hoje() && (
                <span className="text-[11px] font-medium text-primary">hoje</span>
              )}
              {especiaisDoDia(dias[diaIdx]).map((e) => (
                <span key={e.id} className="ml-1 text-[11px] text-muted-foreground">
                  {EMOJI_ESPECIAL[e.tipo] ?? '⭐'} {e.nome}
                </span>
              ))}
            </div>
            <Button variant="outline" size="icon" aria-label="Próximo dia" onClick={() => irDia(1)}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>

          <div className="space-y-3">
            {grupos.map((g) => (
              <div key={g.setorId}>
                <p className="mb-1.5 flex items-center gap-1.5 px-1 font-display text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
                  <span
                    className="h-2.5 w-2.5 flex-none rounded-full"
                    style={{ background: g.cor || 'hsl(var(--muted-foreground))' }}
                  />
                  {g.nome}
                </p>
                <div className="space-y-1.5">
                  {g.vagas.map((v) => {
                    const allocs = cell[`${v.id}|${dias[diaIdx]}`] ?? [];
                    return (
                      <Card
                        key={v.id}
                        onClick={() => setAlocar({ etiquetaId: v.id, data: dias[diaIdx] })}
                        className="flex min-h-[44px] cursor-pointer items-center gap-3 p-3 active:bg-primary/5"
                        style={{ borderLeft: `3px solid ${corHierarquia(v.categoria)}` }}
                      >
                        <span className="w-12 flex-none font-mono text-xs font-bold">
                          {v.sigla}
                          {v.contador}
                        </span>
                        <div className="min-w-0 flex-1">
                          {allocs.length === 0 ? (
                            <span className="text-sm text-muted-foreground">
                              Vaga aberta · toque para alocar
                            </span>
                          ) : (
                            allocs.map((a) => (
                              <div key={a.id} className="leading-tight">
                                <span className="text-sm font-semibold">
                                  {a.colaboradorNome ?? 'Vaga aberta'}
                                </span>
                                {a.turnoNome && (
                                  <span className="ml-1.5 text-xs text-muted-foreground">
                                    {a.turnoNome}
                                  </span>
                                )}
                              </div>
                            ))
                          )}
                        </div>
                        <Plus className="h-4 w-4 flex-none text-muted-foreground/50" />
                      </Card>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <p className="mt-3 text-xs text-muted-foreground">
        Clique em qualquer célula para alocar, trocar ou remover. Conflitos (mesma
        pessoa em dois lugares no mesmo turno) são bloqueados automaticamente.
      </p>
        </>
      )}

      {/* Visão por dia (timeline por hora) */}
      {view === 'dia' && (
        <>
          <div className="mb-3 flex items-center gap-2">
            <Button variant="outline" size="icon" aria-label="Dia anterior" onClick={() => setDiaSel((s) => addDays(s, -1))}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <div className="flex-1 text-center">
              <p className="font-display text-sm font-bold capitalize">
                {fmtDia(diaSel).semana} · {fmtDia(diaSel).dm}
                {diaSel !== hoje() && (
                  <button type="button" onClick={() => setDiaSel(hoje())} className="ml-2 text-xs font-medium text-primary hover:underline">
                    hoje
                  </button>
                )}
              </p>
              {diaEsp.map((e) => (
                <span key={e.id} className="text-[11px] text-muted-foreground">
                  {EMOJI_ESPECIAL[e.tipo] ?? '⭐'} {e.nome}{' '}
                </span>
              ))}
            </div>
            <Button variant="outline" size="icon" aria-label="Próximo dia" onClick={() => setDiaSel((s) => addDays(s, 1))}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
          <TimelineDia alocacoes={diaAloc} />
        </>
      )}

      {/* Visão mensal resumida */}
      {view === 'mes' && (
        <>
          <div className="mb-3 flex items-center gap-2">
            <Button variant="outline" size="icon" aria-label="Mês anterior" onClick={() => irMes(-1)}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <p className="flex-1 text-center font-display text-sm font-bold capitalize">
              {fmtMes(mesCursor)}
            </p>
            <Button variant="outline" size="icon" aria-label="Próximo mês" onClick={() => irMes(1)}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
          <GradeMensal mesCursor={mesCursor} alocacoes={mesAloc} colabs={colabs} especiais={mesEsp} />
        </>
      )}

      {alocar && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 pt-16"
          role="dialog"
          aria-modal="true"
          onClick={() => setAlocar(null)}
        >
          <div className="w-full max-w-md space-y-3" onClick={(e) => e.stopPropagation()}>
            {/* Alocações já existentes na célula: trocar responsável ou remover. */}
            {existentes.length > 0 && (
              <Card className="space-y-2 p-4">
                <p className="font-display text-sm font-bold">
                  {vagaSel ? `${vagaSel.sigla}${vagaSel.contador}` : 'Alocações'} ·{' '}
                  {fmtDia(alocar.data).dm}
                </p>
                {existentes.map((a) => (
                  <div key={a.id} className="flex items-center gap-2">
                    <div className="flex-1">
                      <Select
                        aria-label="Responsável"
                        value={
                          colabs.find((c) => c.nome === a.colaboradorNome)?.id ?? ''
                        }
                        onChange={(e) => trocarResp(a.id, e.target.value)}
                      >
                        <option value="">Vaga aberta</option>
                        {elegVaga.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.nome}
                          </option>
                        ))}
                      </Select>
                    </div>
                    {a.turnoNome && (
                      <span className="text-xs text-muted-foreground">{a.turnoNome}</span>
                    )}
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label="Remover alocação"
                      className="text-destructive"
                      onClick={() => removerAloc(a.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </Card>
            )}

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
  grupo,
  dias,
  cell,
  onCell,
}: {
  grupo: Grupo;
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
          <span className="inline-flex items-center gap-1.5">
            <span
              className="h-2.5 w-2.5 flex-none rounded-full"
              style={{ background: grupo.cor || 'hsl(var(--muted-foreground))' }}
            />
            {grupo.nome}
          </span>
        </td>
      </tr>
      {grupo.vagas.map((v) => (
        <tr key={v.id} className="border-b border-border last:border-0">
          <td
            className="sticky left-0 z-10 whitespace-nowrap bg-card px-3 py-2"
            style={{ boxShadow: `inset 3px 0 0 ${corHierarquia(v.categoria)}` }}
          >
            <span className="inline-flex items-center gap-2">
              <span
                className="h-2.5 w-2.5 flex-none rounded-full"
                style={{ background: corHierarquia(v.categoria) }}
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
                        style={{ borderLeft: `3px solid ${corHierarquia(v.categoria)}` }}
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
