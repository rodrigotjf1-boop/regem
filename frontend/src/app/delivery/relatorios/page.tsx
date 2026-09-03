'use client';

import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { api, getToken, getCategoria } from '@/lib/api';
import { toast } from '@/lib/toast';
import { Shell } from '@/components/app-shell/shell';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

/* eslint-disable @typescript-eslint/no-explicit-any */
const brlC = (centavos: number) =>
  Number((centavos || 0) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const dur = (seg?: number | null) => {
  if (seg == null) return '—';
  const m = Math.round(seg / 60);
  if (m < 1) return '<1 min';
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}`;
};
const ymd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const dataBR = (s?: string) => {
  if (!s) return '';
  const [y, m, d] = s.split('-');
  return `${d}/${m}/${y}`;
};

type Preset = 'hoje' | 'semana' | 'mes' | 'custom';
const PRESETS: { id: Preset; label: string }[] = [
  { id: 'hoje', label: 'Hoje' },
  { id: 'semana', label: 'Semana' },
  { id: 'mes', label: 'Mês' },
  { id: 'custom', label: 'Personalizado' },
];

export default function RelatoriosEntregaPage() {
  const router = useRouter();
  const [preset, setPreset] = useState<Preset>('hoje');
  const [inicio, setInicio] = useState('');
  const [fim, setFim] = useState('');
  const [dados, setDados] = useState<any>(null);
  const [carregando, setCarregando] = useState(false);
  const [expandido, setExpandido] = useState<string | null>(null);

  // Período resolvido a partir do preset (fuso do navegador = "hoje" do usuário).
  const periodo = useMemo(() => {
    const hoje = new Date();
    if (preset === 'hoje') return { inicio: ymd(hoje), fim: ymd(hoje) };
    if (preset === 'semana') {
      const dow = (hoje.getDay() + 6) % 7; // 0 = segunda
      const ini = new Date(hoje);
      ini.setDate(hoje.getDate() - dow);
      return { inicio: ymd(ini), fim: ymd(hoje) };
    }
    if (preset === 'mes') {
      const ini = new Date(hoje.getFullYear(), hoje.getMonth(), 1);
      return { inicio: ymd(ini), fim: ymd(hoje) };
    }
    return { inicio, fim }; // personalizado
  }, [preset, inicio, fim]);

  const carregar = useCallback(async () => {
    if (!periodo.inicio || !periodo.fim) return;
    setCarregando(true);
    try {
      const r = await api.relatorioEntregas(periodo.inicio, periodo.fim);
      setDados(r);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro ao carregar o relatório');
    } finally {
      setCarregando(false);
    }
  }, [periodo]);

  useEffect(() => {
    if (!getToken()) {
      router.replace('/entrar');
      return;
    }
    const cat = getCategoria();
    if (!['presidente', 'gerente', 'supervisao', 'atendente'].includes(cat ?? '')) {
      router.replace('/painel');
    }
  }, [router]);

  // Recarrega ao trocar preset; no personalizado só com as duas datas preenchidas.
  useEffect(() => {
    if (preset !== 'custom' || (inicio && fim)) carregar();
  }, [carregar, preset, inicio, fim]);

  const linhas = (dados?.entregadores ?? []) as any[];
  const tot = dados?.totais ?? {};

  return (
    <Shell title="Relatórios de entrega" eyebrow="Delivery">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-4">
        {/* Filtro de período */}
        <Card className="p-3">
          <div className="flex flex-wrap items-center gap-2">
            {PRESETS.map((p) => (
              <button
                key={p.id}
                type="button"
                aria-pressed={preset === p.id}
                onClick={() => setPreset(p.id)}
                className={`rounded-full px-3 py-1.5 text-sm font-semibold transition ${
                  preset === p.id
                    ? 'bg-primary text-primary-foreground'
                    : 'border border-border text-muted-foreground hover:bg-muted'
                }`}
              >
                {p.label}
              </button>
            ))}
            {preset === 'custom' && (
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  type="date"
                  value={inicio}
                  max={fim || undefined}
                  onChange={(e) => setInicio(e.target.value)}
                  className="h-9 w-auto"
                  aria-label="Data inicial"
                />
                <span className="text-muted-foreground">até</span>
                <Input
                  type="date"
                  value={fim}
                  min={inicio || undefined}
                  onChange={(e) => setFim(e.target.value)}
                  className="h-9 w-auto"
                  aria-label="Data final"
                />
              </div>
            )}
            <div className="ml-auto flex items-center gap-2">
              <Button type="button" variant="outline" onClick={carregar} disabled={carregando}>
                {carregando ? 'Carregando…' : 'Atualizar'}
              </Button>
            </div>
          </div>
          {dados?.periodo && (
            <p className="mt-2 text-xs text-muted-foreground">
              Período: {dataBR(dados.periodo.inicio)} a {dataBR(dados.periodo.fim)}
            </p>
          )}
        </Card>

        {/* Totais (as 3 dimensões: entregas · tempo/entrega · ganhos) */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Card className="p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Entregas</p>
            <p className="font-mono text-2xl font-bold">{tot.entregas ?? 0}</p>
            <p className="text-xs text-muted-foreground">{tot.entregadores ?? 0} entregador(es) com movimento</p>
          </Card>
          <Card className="p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Tempo médio / entrega</p>
            <p className="font-mono text-2xl font-bold">{dur(tot.tempoMedioSeg)}</p>
            <p className="text-xs text-muted-foreground">ciclo (saída → volta) ÷ entregas</p>
          </Card>
          <Card className="p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Ganhos no período</p>
            <p className="font-mono text-2xl font-bold">{brlC(tot.ganhosCentavos ?? 0)}</p>
            <p className="text-xs text-muted-foreground">diária × dias + taxas do modelo</p>
          </Card>
        </div>

        {/* Tabela por entregador */}
        <Card className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <caption className="sr-only">Entregas, tempo médio e ganhos por entregador no período</caption>
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-4 py-2 font-semibold">Entregador</th>
                  <th className="px-4 py-2 text-right font-semibold">Entregas</th>
                  <th className="px-4 py-2 text-right font-semibold">Dias</th>
                  <th className="px-4 py-2 text-right font-semibold">Tempo médio</th>
                  <th className="px-4 py-2 text-right font-semibold">Ganhos</th>
                  <th className="px-4 py-2 text-right font-semibold">Bairros</th>
                </tr>
              </thead>
              <tbody>
                {linhas.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-10 text-center text-muted-foreground">
                      {carregando ? 'Carregando…' : 'Sem entregas no período selecionado.'}
                    </td>
                  </tr>
                )}
                {linhas.map((l) => {
                  const aberto = expandido === l.colaboradorId;
                  const bairros = (l.bairros ?? []) as any[];
                  return (
                    <Fragment key={l.colaboradorId}>
                      <tr className="border-b border-border/60">
                        <td className="px-4 py-2.5 font-medium">{l.nome ?? '—'}</td>
                        <td className="px-4 py-2.5 text-right font-mono">{l.entregas}</td>
                        <td className="px-4 py-2.5 text-right font-mono text-muted-foreground">{l.dias}</td>
                        <td className="px-4 py-2.5 text-right font-mono">{dur(l.tempoMedioSeg)}</td>
                        <td className="px-4 py-2.5 text-right font-mono font-semibold">{brlC(l.ganhosCentavos)}</td>
                        <td className="px-4 py-2.5 text-right">
                          {bairros.length > 0 ? (
                            <button
                              type="button"
                              aria-expanded={aberto}
                              onClick={() => setExpandido(aberto ? null : l.colaboradorId)}
                              className="text-xs font-semibold text-primary hover:underline"
                            >
                              {aberto ? 'ocultar' : `${bairros.length} bairro(s)`}
                            </button>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </td>
                      </tr>
                      {aberto && bairros.length > 0 && (
                        <tr className="border-b border-border/60 bg-muted/40">
                          <td colSpan={6} className="px-4 py-2">
                            <div className="flex flex-wrap gap-1.5">
                              {bairros.map((b, i) => (
                                <span
                                  key={i}
                                  className="rounded-full border border-border bg-card px-2.5 py-1 text-xs"
                                >
                                  {b.bairro} · <span className="font-mono font-semibold">{b.n}</span>
                                </span>
                              ))}
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>

        <div>
          <Link href="/delivery" className="text-sm font-semibold text-primary hover:underline">
            ← Voltar ao painel de delivery
          </Link>
        </div>
      </div>
    </Shell>
  );
}
