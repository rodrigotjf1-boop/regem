'use client';

import { useCallback, useEffect, useState } from 'react';
import { Printer, SlidersHorizontal } from 'lucide-react';
import { api, getCategoria, getToken } from '@/lib/api';
import { Shell } from '@/components/app-shell/shell';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { TIPO_LABEL } from '@/components/ponto/ponto-card';
import { PontoGestao } from '@/components/ponto/ponto-gestao';
import { AcessoSenhaCard } from '@/components/pessoas/acesso-senha-card';

const AJUSTE_LABEL: Record<string, string> = {
  abono: 'Abono',
  atestado: 'Atestado',
  justificativa: 'Justificativa',
  desconsideracao: 'Desconsideração',
};

/* eslint-disable @typescript-eslint/no-explicit-any */
// "Hoje" no fuso da operação (BRT) — não UTC.
function hojeSP() {
  return new Date().toLocaleDateString('en-CA', {
    timeZone: 'America/Sao_Paulo',
  });
}
function addDays(s: string, n: number) {
  const d = new Date(`${s}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
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
  const [colaboradores, setColaboradores] = useState<any[]>([]);
  const [inicio, setInicio] = useState(() => addDays(hojeSP(), -6));
  const [fim, setFim] = useState(() => hojeSP());
  const [espelho, setEspelho] = useState<any | null>(null);
  const [gestaoOpen, setGestaoOpen] = useState(false);

  const autorizado =
    cat === 'presidente' || cat === 'gerente' || cat === 'supervisao';
  const podeGerir = cat === 'presidente' || cat === 'gerente';

  function gerarPdf() {
    if (!sel) return;
    window.open(
      `/espelho-ponto?colaboradorId=${sel.id}&inicio=${inicio}&fim=${fim}`,
      '_blank',
    );
  }

  const carregar = useCallback(async () => {
    setErro('');
    try {
      const [ps, cols] = await Promise.all([
        api.pontoPessoas(),
        api.colaboradores().catch(() => []),
      ]);
      setPessoas(ps);
      setColaboradores(Array.isArray(cols) ? cols : []);
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
          {podeGerir && (
            <div className="mb-4">
              <AcessoSenhaCard />
            </div>
          )}
          <div className="mb-4 rounded-lg border border-warn/30 bg-warn/10 px-4 py-2.5 text-xs text-warn">
            ⚠️ Ponto de <strong>gestão de jornada</strong> (lógica da Portaria
            671, registro imutável com NSR). Não substitui um REP-P homologado
            (AFD/AEJ + certificação) — no backlog.
          </div>

          {erro && <p className="mb-4 text-destructive">{erro}</p>}

          <div className="grid gap-4 lg:grid-cols-[1fr_1.2fr]">
            <Card className="p-0">
              <div className="space-y-2 border-b border-border px-5 py-3.5">
                <div>
                  <p className="font-display text-sm font-bold">Ponto de hoje</p>
                  <p className="text-xs text-muted-foreground">
                    Clique num colaborador para ver o espelho
                  </p>
                </div>
                {colaboradores.length > 0 && (
                  <select
                    aria-label="Ver espelho de qualquer colaborador"
                    value={sel?.id ?? ''}
                    onChange={(e) => {
                      const c = colaboradores.find((x) => x.id === e.target.value);
                      if (c) abrirEspelho(c.id, c.nome);
                    }}
                    className="h-9 w-full rounded-md border border-input bg-card px-2 text-sm"
                  >
                    <option value="">Ver qualquer colaborador…</option>
                    {colaboradores.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.nome}
                      </option>
                    ))}
                  </select>
                )}
              </div>
              <div className="divide-y divide-border">
                {pessoas === null &&
                  Array.from({ length: 4 }).map((_, i) => (
                    <div key={i} className="flex items-center gap-3 px-5 py-3.5">
                      <Skeleton className="h-9 w-9 flex-none rounded-full" />
                      <div className="min-w-0 flex-1">
                        <Skeleton className="h-4 w-1/3" />
                        <Skeleton className="mt-2 h-3 w-1/4" />
                      </div>
                      <Skeleton className="h-4 w-12" />
                    </div>
                  ))}
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
                  {sel && espelho && (
                    <div className="mt-2 flex gap-2">
                      <Button size="sm" variant="outline" onClick={gerarPdf}>
                        <Printer className="h-4 w-4" /> Gerar PDF
                      </Button>
                      {podeGerir && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setGestaoOpen((v) => !v)}
                        >
                          <SlidersHorizontal className="h-4 w-4" />
                          {gestaoOpen ? 'Fechar gestão' : 'Gestão'}
                        </Button>
                      )}
                    </div>
                  )}
                </div>
                <div className="flex flex-col items-end gap-1.5">
                  <div className="flex gap-1">
                    {[
                      { l: '7 dias', ini: addDays(hojeSP(), -6), f: hojeSP() },
                      { l: 'Este mês', ini: `${hojeSP().slice(0, 8)}01`, f: hojeSP() },
                      { l: '30 dias', ini: addDays(hojeSP(), -29), f: hojeSP() },
                    ].map((p) => {
                      const ativo = inicio === p.ini && fim === p.f;
                      return (
                        <button
                          key={p.l}
                          type="button"
                          onClick={() => {
                            setInicio(p.ini);
                            setFim(p.f);
                          }}
                          className={`rounded-md border px-2 py-1 text-[11px] transition ${
                            ativo
                              ? 'border-primary bg-primary/10 text-primary'
                              : 'border-border text-muted-foreground hover:bg-secondary'
                          }`}
                        >
                          {p.l}
                        </button>
                      );
                    })}
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
              </div>

              {!sel ? (
                <p className="px-5 py-10 text-center text-sm text-muted-foreground">
                  Selecione um colaborador à esquerda.
                </p>
              ) : espelho === null ? (
                <div className="p-5">
                  <div className="grid grid-cols-3 gap-3">
                    {Array.from({ length: 3 }).map((_, i) => (
                      <Skeleton key={i} className="h-14" />
                    ))}
                  </div>
                  <Skeleton className="mt-4 h-4 w-1/3" />
                  <div className="mt-3 space-y-2">
                    {Array.from({ length: 3 }).map((_, i) => (
                      <Skeleton key={i} className="h-10" />
                    ))}
                  </div>
                </div>
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

                  {gestaoOpen && sel && (
                    <PontoGestao
                      colaboradorId={sel.id}
                      dias={espelho.dias}
                      onDone={() => abrirEspelho(sel.id, sel.nome)}
                    />
                  )}

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
                            <span className="font-bold">{fmtMin(d.efetivoMin)}</span>
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
                                key={m.id}
                                className={`rounded px-1.5 py-0.5 font-mono text-[10px] ${
                                  m.desconsiderada
                                    ? 'bg-destructive/10 text-destructive line-through'
                                    : 'bg-secondary'
                                }`}
                                title={`NSR ${m.nsr} · ${TIPO_LABEL[m.tipo] ?? m.tipo}${
                                  m.origem === 'ajuste' ? ' · incluída (ajuste)' : ''
                                }`}
                              >
                                {hora(m.hora)}
                                {m.origem === 'ajuste' && !m.desconsiderada && ' ✎'}
                              </span>
                            ))}
                          </div>
                        )}
                        {d.ajustes.length > 0 && (
                          <div className="mt-1.5 space-y-0.5">
                            {d.ajustes.map((a: any) => (
                              <p
                                key={a.id}
                                className="text-[11px] text-muted-foreground"
                              >
                                <span className="font-semibold text-foreground">
                                  {AJUSTE_LABEL[a.tipo] ?? a.tipo}
                                </span>
                                {a.minutos != null ? ` ${fmtMin(a.minutos)}` : ''}
                                {' · '}
                                {a.justificativa}
                                {a.atestadoRef && (
                                  <a
                                    href={a.atestadoRef}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="ml-1 text-primary underline"
                                  >
                                    ver anexo
                                  </a>
                                )}
                              </p>
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
