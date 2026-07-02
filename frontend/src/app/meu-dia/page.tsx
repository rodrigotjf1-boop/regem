'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  BarChart3,
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
  pendente: { label: 'Pendente', cls: 'bg-slate-100 text-slate-700' },
  em_execucao: { label: 'Em execução', cls: 'bg-blue-100 text-blue-700' },
  feita: { label: 'Feita', cls: 'bg-emerald-100 text-emerald-700' },
  parcial: { label: 'Parcial', cls: 'bg-amber-100 text-amber-800' },
  nao_feita: { label: 'Não feita', cls: 'bg-red-100 text-red-700' },
  impossibilitada: {
    label: 'Impossibilitada',
    cls: 'bg-violet-100 text-violet-700',
  },
};

function hoje() {
  return new Date().toISOString().slice(0, 10);
}

export default function MeuDiaPage() {
  const router = useRouter();
  const [tarefas, setTarefas] = useState<Tarefa[]>([]);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState('');
  const [show, setShow] = useState(false);
  const data = hoje();

  const carregar = useCallback(async () => {
    try {
      setTarefas(await api.tarefasDoDia(data));
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

  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-10 border-b border-border bg-card/80 backdrop-blur">
        <div className="mx-auto flex max-w-2xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2">
            <RegemMark className="h-8 w-8 text-foreground" />
            <div>
              <p className="text-sm font-semibold leading-none">Meu Dia</p>
              <p className="text-xs capitalize text-muted-foreground tabular-nums">
                {dataLabel}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => router.push('/painel')}
              aria-label="Painel"
            >
              <BarChart3 className="h-5 w-5" />
            </Button>
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

      <main className="mx-auto max-w-2xl space-y-6 px-4 py-4 pb-24">
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
        {loading && <p className="text-muted-foreground">Carregando…</p>}
        {erro && (
          <p role="alert" className="text-destructive">
            {erro}
          </p>
        )}
        {!loading && !erro && tarefas.length === 0 && (
          <Card className="p-8 text-center text-muted-foreground">
            Nenhuma tarefa para hoje.
          </Card>
        )}

        {Object.entries(grupos).map(([setorNome, items]) => (
          <section key={setorNome} className="space-y-2">
            <h2 className="px-1 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              {setorNome}
            </h2>
            <div className="space-y-2">
              {items.map((t) => {
                const s = STATUS[t.estado] ?? STATUS.pendente;
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
                      <Badge className={s.cls}>{s.label}</Badge>
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
          </section>
        ))}
      </main>
      <BottomNav />
    </div>
  );
}
