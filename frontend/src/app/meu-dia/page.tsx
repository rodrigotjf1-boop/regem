'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  BarChart3,
  Boxes,
  CalendarDays,
  Check,
  CircleSlash,
  LogOut,
  MinusCircle,
  Plus,
  X,
} from 'lucide-react';
import { api, clearToken, getToken } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { BottomNav } from '@/components/app-shell/bottom-nav';
import { NovaTarefaForm } from '@/components/tarefa/nova-tarefa-form';
import { RegemMark } from '@/components/brand/regem-mark';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Tarefa = {
  id: string;
  estado: string;
  titulo: string | null;
  setorNome: string | null;
  etiquetaSigla: string | null;
  etiquetaContador: number | null;
  colaboradorNome: string | null;
};

const STATUS: Record<string, { label: string; cls: string }> = {
  pendente: { label: 'Pendente', cls: 'bg-slate-500/20 text-slate-200' },
  em_execucao: { label: 'Em execução', cls: 'bg-blue-500/20 text-blue-200' },
  feita: { label: 'Feita', cls: 'bg-emerald-500/20 text-emerald-200' },
  parcial: { label: 'Parcial', cls: 'bg-amber-500/20 text-amber-100' },
  nao_feita: { label: 'Não feita', cls: 'bg-red-500/20 text-red-200' },
  impossibilitada: {
    label: 'Impossibilitada',
    cls: 'bg-violet-500/20 text-violet-200',
  },
};

function hoje() {
  return new Date().toISOString().slice(0, 10);
}
function saudacao() {
  const h = new Date().getHours();
  if (h < 12) return 'Bom dia';
  if (h < 18) return 'Boa tarde';
  return 'Boa noite';
}

export default function MeuDiaPage() {
  const router = useRouter();
  const [tarefas, setTarefas] = useState<Tarefa[]>([]);
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState('');
  const [show, setShow] = useState(false);
  const data = hoje();

  const carregar = useCallback(async () => {
    try {
      setTarefas(await api.tarefasDoDia(data));
      // KPIs do dia (só gestor enxerga; se 403, ignora)
      try {
        setStats(await api.dashboard(data));
      } catch {
        setStats(null);
      }
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao carregar');
    } finally {
      setLoading(false);
    }
  }, [data]);

  useEffect(() => {
    if (!getToken()) {
      router.replace('/');
      return;
    }
    carregar();
  }, [carregar, router]);

  async function marcar(id: string, estado: string) {
    setTarefas((t) => t.map((x) => (x.id === id ? { ...x, estado } : x)));
    try {
      await api.concluirTarefa(id, estado);
    } catch {
      carregar();
    }
  }

  function sair() {
    clearToken();
    router.replace('/');
  }

  const grupos = tarefas.reduce<Record<string, Tarefa[]>>((acc, t) => {
    const k = t.setorNome ?? 'Sem setor';
    (acc[k] ??= []).push(t);
    return acc;
  }, {});

  const dataLabel = new Date(data + 'T00:00').toLocaleDateString('pt-BR', {
    weekday: 'long',
    day: '2-digit',
    month: 'long',
  });

  const atalhos = [
    { label: 'Nova tarefa', icon: Plus, onClick: () => setShow((v) => !v) },
    { label: 'Escala', icon: CalendarDays, onClick: () => router.push('/escala') },
    { label: 'Operação', icon: Boxes, onClick: () => router.push('/operacao') },
    { label: 'Painel', icon: BarChart3, onClick: () => router.push('/painel') },
  ];

  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-10 border-b border-border bg-card/80 backdrop-blur">
        <div className="mx-auto flex max-w-2xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2">
            <RegemMark className="h-8 w-8 text-foreground" />
            <span className="font-display text-lg font-semibold">Regem</span>
          </div>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setShow((v) => !v)}
              aria-label="Nova tarefa"
            >
              {show ? <X className="h-5 w-5" /> : <Plus className="h-5 w-5" />}
            </Button>
            <Button variant="ghost" size="icon" onClick={sair} aria-label="Sair">
              <LogOut className="h-5 w-5" />
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-2xl space-y-6 px-4 py-5 pb-24">
        {/* Saudação */}
        <section>
          <h1 className="font-display text-2xl font-bold tracking-tight">
            {saudacao()} 👋
          </h1>
          <p className="mt-0.5 text-sm capitalize text-muted-foreground">
            {dataLabel}
          </p>
        </section>

        {show && (
          <NovaTarefaForm
            data={data}
            onCancel={() => setShow(false)}
            onCreated={() => {
              setShow(false);
              carregar();
            }}
          />
        )}

        {/* Resumo do dia (KPIs) */}
        {stats && (
          <section className="grid grid-cols-3 gap-2">
            <Card className="p-3 text-center">
              <p className="font-display text-2xl font-bold tabular-nums text-primary">
                {stats.tarefas.pctConclusao}%
              </p>
              <p className="text-[.7rem] uppercase tracking-wide text-muted-foreground">
                Conclusão
              </p>
            </Card>
            <Card className="p-3 text-center">
              <p className="font-display text-2xl font-bold tabular-nums">
                {stats.tarefas.pendentes}
              </p>
              <p className="text-[.7rem] uppercase tracking-wide text-muted-foreground">
                Pendentes
              </p>
            </Card>
            <Card className="p-3 text-center">
              <p className="font-display text-2xl font-bold tabular-nums">
                {stats.escala.preenchidas}/{stats.escala.vagas}
              </p>
              <p className="text-[.7rem] uppercase tracking-wide text-muted-foreground">
                Escala
              </p>
            </Card>
          </section>
        )}

        {/* Atalhos */}
        <section>
          <h2 className="mb-2 px-1 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Atalhos
          </h2>
          <div className="grid grid-cols-4 gap-2">
            {atalhos.map((a) => (
              <button
                key={a.label}
                type="button"
                onClick={a.onClick}
                className="flex flex-col items-center gap-1.5 rounded-lg border border-border bg-card p-3 text-center transition-colors hover:border-primary/50"
              >
                <a.icon className="h-5 w-5 text-primary" />
                <span className="text-[.72rem] font-medium leading-tight">
                  {a.label}
                </span>
              </button>
            ))}
          </div>
        </section>

        {/* Tarefas de hoje */}
        <section className="space-y-3">
          <h2 className="px-1 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Tarefas de hoje
          </h2>

          {loading && <p className="text-muted-foreground">Carregando…</p>}
          {erro && (
            <p role="alert" className="text-destructive">
              {erro}
            </p>
          )}
          {!loading && !erro && tarefas.length === 0 && (
            <Card className="p-8 text-center">
              <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-primary/15">
                <RegemMark className="h-7 w-7 text-foreground" />
              </div>
              <p className="font-display text-lg font-semibold">
                Nada por aqui ainda
              </p>
              <p className="mx-auto mt-1 max-w-xs text-sm text-muted-foreground">
                Configure sua operação (unidade, equipe, turnos) para montar a
                escala e as tarefas do dia.
              </p>
              <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-center">
                <Button onClick={() => router.push('/inicio')}>
                  Configurar operação
                </Button>
                <Button variant="outline" onClick={() => setShow(true)}>
                  <Plus className="h-4 w-4" /> Nova tarefa
                </Button>
              </div>
            </Card>
          )}

          {Object.entries(grupos).map(([setorNome, items]) => (
            <div key={setorNome} className="space-y-2">
              <h3 className="px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground/80">
                {setorNome}
              </h3>
              <div className="space-y-2">
                {items.map((t) => {
                  const st = STATUS[t.estado] ?? STATUS.pendente;
                  return (
                    <Card key={t.id} className="p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="font-medium leading-tight">
                            {t.titulo ?? 'Tarefa'}
                          </p>
                          <p className="mt-0.5 text-sm text-muted-foreground">
                            {t.etiquetaSigla
                              ? `${t.etiquetaSigla}${t.etiquetaContador ?? ''}`
                              : '—'}
                            {t.colaboradorNome
                              ? ` · ${t.colaboradorNome}`
                              : ' · vaga aberta'}
                          </p>
                        </div>
                        <Badge className={st.cls}>{st.label}</Badge>
                      </div>
                      <div className="mt-3 grid grid-cols-3 gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => marcar(t.id, 'feita')}
                        >
                          <Check className="h-4 w-4" /> Feita
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => marcar(t.id, 'parcial')}
                        >
                          <MinusCircle className="h-4 w-4" /> Parcial
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => marcar(t.id, 'nao_feita')}
                        >
                          <CircleSlash className="h-4 w-4" /> Não feita
                        </Button>
                      </div>
                    </Card>
                  );
                })}
              </div>
            </div>
          ))}
        </section>
      </main>
      <BottomNav />
    </div>
  );
}
