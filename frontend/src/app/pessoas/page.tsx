'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, getCategoria, getToken } from '@/lib/api';
import { Shell } from '@/components/app-shell/shell';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { TIPO_LABEL } from '@/components/ponto/ponto-card';

/* eslint-disable @typescript-eslint/no-explicit-any */
function iso(d: Date) {
  return d.toISOString().slice(0, 10);
}
function addDays(s: string, n: number) {
  const d = new Date(`${s}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return iso(d);
}
function fmtMin(min: number) {
  const s = min < 0 ? '-' : '';
  const a = Math.abs(min);
  return `${s}${Math.floor(a / 60)}h${String(a % 60).padStart(2, '0')}`;
}
function hora(isoStr: string) {
  return new Date(isoStr).toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function PessoasPage() {
  const [cat, setCat] = useState<string | null>(null);
  const [pessoas, setPessoas] = useState<any[] | null>(null);
  const [erro, setErro] = useState('');
  const [sel, setSel] = useState<{ id: string; nome: string } | null>(null);
  const [inicio, setInicio] = useState(() => addDays(iso(new Date()), -6));
  const [fim, setFim] = useState(() => iso(new Date()));
  const [espelho, setEspelho] = useState<any | null>(null);

  const autorizado =
    cat === 'presidente' || cat === 'gerente' || cat === 'supervisao';

  const carregar = useCallback(async () => {
    setErro('');
    try {
      setPessoas(await api.pontoPessoas());
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao carregar');
    }
  }, []);

  useEffect(() => {
    if (!getToken()) return;
    const c = getCategoria();
    setCat(c);
    if (c === 'presidente' || c === 'gerente' || c === 'supervisao') carregar();
  }, [carregar]);

  const abrirEspelho = useCallback(
    async (id: string, nome: string) => {
      setSel({ id, nome });
      setEspelho(null);
      try {
        setEspelho(await api.pontoEspelho(id, inicio, fim));
      } catch (e) {
        setErro(e instanceof Error ? e.message : 'Erro ao carregar espelho');
      }
    },
    [inicio, fim],
  );

  useEffect(() => {
    if (sel) abrirEspelho(sel.id, sel.nome);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inicio, fim]);

  return (
    <Shell eyebrow="Gestão de pessoas · ponto" title="Pessoas & Ponto">
      {!autorizado ? (
        <Card className="p-10 text-center">
          <p className="font-display text-lg font-semibold">Área restrita</p>
          <p className="mt-1 text-sm text-muted-foreground">
            O acompanhamento de ponto é para diretoria, gerência e supervisão.
          </p>
        </Card>
      ) : (
        <>
          <div className="mb-4 rounded-lg border border-amber-300 bg-amber-50 px-4 py-2.5 text-xs text-amber-800">
            ⚠️ Ponto de <strong>gestão de jornada</strong> (lógica da Portaria
            671, registro imutável com NSR). Não substitui um REP-P homologado
            (AFD/AEJ + certificação) — no backlog.
          </div>

          {erro && <p className="mb-4 text-destructive">{erro}</p>}

          <div className="grid gap-4 lg:grid-cols-[1fr_1.2fr]">
            <Card className="p-0">
              <div className="border-b border-border px-5 py-3.5">
                <p className="font-display text-sm font-bold">Ponto de hoje</p>
                <p className="text-xs text-muted-foreground">
                  Clique num colaborador para ver o espelho
                </p>
              </div>
              <div className="divide-y divide-border">
                {pessoas === null && (
                  <p className="px-5 py-6 text-sm text-muted-foreground">
                    Carregando…
                  </p>
                )}
                {pessoas?.length === 0 && (
                  <p className="px-5 py-6 text-sm text-muted-foreground">
                    Ninguém bateu ponto hoje ainda.
                  </p>
                )}
                {pessoas?.map((p) => (
                  <button
                    key={p.colaboradorId}
                    type="button"
                    onClick={() => abrirEspelho(p.colaboradorId, p.nome)}
                    className={`flex w-full items-center gap-3 px-5 py-3 text-left transition-colors hover:bg-primary/5 ${
                      sel?.id === p.colaboradorId ? 'bg-primary/10' : ''
                    }`}
                  >
                    <span
                      className={`h-2 w-2 flex-none rounded-full ${
                        p.status === 'trabalhando'
                          ? 'bg-[hsl(var(--ok))]'
                          : 'bg-muted-foreground/40'
                      }`}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold">{p.nome}</p>
                      <p className="text-xs text-muted-foreground">
                        {p.ultimaMarcacao
                          ? `${TIPO_LABEL[p.ultimaMarcacao.tipo] ?? p.ultimaMarcacao.tipo} ${hora(p.ultimaMarcacao.hora)}`
                          : '—'}
                      </p>
                    </div>
                    <span className="font-mono text-xs font-bold tabular-nums">
                      {fmtMin(p.trabalhadoMin)}
                    </span>
                  </button>
                ))}
              </div>
            </Card>

            <Card className="p-0">
              <div className="flex flex-wrap items-end justify-between gap-2 border-b border-border px-5 py-3">
                <div>
                  <p className="font-display text-sm font-bold">
                    {sel ? `Espelho · ${sel.nome}` : 'Espelho de ponto'}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Trabalhado × esperado (escala) = saldo
                  </p>
                </div>
                <div className="flex items-end gap-2">
                  <div className="space-y-1">
                    <Label htmlFor="ini" className="text-[10px]">
                      De
                    </Label>
                    <Input
                      id="ini"
                      type="date"
                      value={inicio}
                      onChange={(e) => setInicio(e.target.value)}
                      className="h-8 w-[130px]"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="fim" className="text-[10px]">
                      Até
                    </Label>
                    <Input
                      id="fim"
                      type="date"
                      value={fim}
                      onChange={(e) => setFim(e.target.value)}
                      className="h-8 w-[130px]"
                    />
                  </div>
                </div>
              </div>

              {!sel ? (
                <p className="px-5 py-10 text-center text-sm text-muted-foreground">
                  Selecione um colaborador à esquerda.
                </p>
              ) : espelho === null ? (
                <p className="px-5 py-10 text-center text-sm text-muted-foreground">
                  Carregando espelho…
                </p>
              ) : (
                <>
                  <div className="grid grid-cols-3 gap-px bg-border">
                    {[
                      { l: 'Trabalhado', v: espelho.totalTrabalhadoMin, c: 'var(--info)' },
                      { l: 'Esperado', v: espelho.totalEsperadoMin, c: 'var(--muted-foreground)' },
                      {
                        l: 'Saldo',
                        v: espelho.saldoMin,
                        c: espelho.saldoMin < 0 ? 'var(--destructive)' : 'var(--ok)',
                      },
                    ].map((k) => (
                      <div key={k.l} className="bg-card px-4 py-3 text-center">
                        <p className="font-display text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                          {k.l}
                        </p>
                        <p
                          className="font-mono text-lg font-bold tabular-nums"
                          style={{ color: `hsl(${k.c})` }}
                        >
                          {fmtMin(k.v)}
                        </p>
                      </div>
                    ))}
                  </div>

                  <div className="divide-y divide-border">
                    {espelho.dias.length === 0 && (
                      <p className="px-5 py-6 text-sm text-muted-foreground">
                        Sem marcações no período.
                      </p>
                    )}
                    {espelho.dias.map((d: any) => (
                      <div key={d.data} className="px-5 py-3">
                        <div className="flex items-center justify-between">
                          <p className="text-sm font-semibold">
                            {new Date(`${d.data}T00:00:00`).toLocaleDateString(
                              'pt-BR',
                              { weekday: 'short', day: '2-digit', month: '2-digit' },
                            )}
                          </p>
                          <p className="font-mono text-xs">
                            <span className="font-bold">{fmtMin(d.trabalhadoMin)}</span>
                            <span className="text-muted-foreground">
                              {' '}
                              / {fmtMin(d.esperadoMin)}
                            </span>
                            <span
                              className="ml-2 font-bold"
                              style={{
                                color:
                                  d.saldoMin < 0
                                    ? 'hsl(var(--destructive))'
                                    : 'hsl(var(--ok))',
                              }}
                            >
                              {d.saldoMin >= 0 ? '+' : ''}
                              {fmtMin(d.saldoMin)}
                            </span>
                          </p>
                        </div>
                        {d.marcacoes.length > 0 && (
                          <div className="mt-1.5 flex flex-wrap gap-1">
                            {d.marcacoes.map((m: any) => (
                              <span
                                key={m.nsr}
                                className="rounded bg-secondary px-1.5 py-0.5 font-mono text-[10px]"
                                title={`NSR ${m.nsr} · ${TIPO_LABEL[m.tipo] ?? m.tipo}`}
                              >
                                {hora(m.hora)}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </>
              )}
            </Card>
          </div>
        </>
      )}
    </Shell>
  );
}
