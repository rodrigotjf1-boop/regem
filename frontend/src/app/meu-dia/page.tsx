'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Check, CircleSlash, MinusCircle, Plus, X } from 'lucide-react';
import { api, getToken } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { SkeletonList } from '@/components/ui/skeleton';
import { Shell } from '@/components/app-shell/shell';
import { NovaTarefaForm } from '@/components/tarefa/nova-tarefa-form';
import { PontoCard } from '@/components/ponto/ponto-card';

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
  pendente: { label: 'Pendente', cls: 'bg-slate-100 text-slate-600' },
  em_execucao: { label: 'Em execução', cls: 'bg-blue-100 text-blue-700' },
  feita: { label: 'Feita', cls: 'bg-emerald-100 text-emerald-700' },
  parcial: { label: 'Parcial', cls: 'bg-amber-100 text-amber-800' },
  nao_feita: { label: 'Não feita', cls: 'bg-red-100 text-red-700' },
  impossibilitada: { label: 'Impossibilitada', cls: 'bg-violet-100 text-violet-700' },
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
    if (getToken()) carregar();
  }, [carregar]);

  async function marcar(id: string, estado: string) {
    setTarefas((t) => t.map((x) => (x.id === id ? { ...x, estado } : x)));
    try {
      await api.concluirTarefa(id, estado);
    } catch {
      carregar();
    }
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
    <Shell
      eyebrow="Operação diária"
      title="Meu Dia"
      actions={
        <Button size="sm" onClick={() => setShow((v) => !v)}>
          {show ? (
            <>
              <X className="h-4 w-4" /> Fechar
            </>
          ) : (
            <>
              <Plus className="h-4 w-4" /> Nova tarefa
            </>
          )}
        </Button>
      }
    >
      <p className="mb-4 text-sm capitalize text-muted-foreground">{dataLabel}</p>
      {erro && (
        <p role="alert" className="mb-4 text-destructive">
          {erro}
        </p>
      )}

      <div className="mb-5 max-w-2xl">
        <PontoCard />
      </div>

      {show && (
        <div className="mb-5 max-w-xl">
          <NovaTarefaForm
            data={data}
            onCancel={() => setShow(false)}
            onCreated={() => {
              setShow(false);
              carregar();
            }}
          />
        </div>
      )}

      {loading && <SkeletonList rows={4} className="max-w-xl" />}

      {!loading && tarefas.length === 0 && (
        <Card className="max-w-xl p-8 text-center">
          <p className="font-display text-lg font-semibold">Nada por aqui ainda</p>
          <p className="mx-auto mt-1 max-w-xs text-sm text-muted-foreground">
            Configure sua operação (unidade, equipe, turnos) para montar a escala
            e as tarefas do dia.
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

      <div className="space-y-6">
        {Object.entries(grupos).map(([setorNome, items]) => (
          <section key={setorNome} className="space-y-2">
            <h3 className="font-display text-[11px] font-bold uppercase tracking-[.12em] text-muted-foreground">
              {setorNome}
            </h3>
            <div className="grid gap-2 md:grid-cols-2">
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
                      <span
                        className={`shrink-0 rounded-md px-2 py-0.5 text-[11px] font-bold ${st.cls}`}
                      >
                        {st.label}
                      </span>
                    </div>
                    <div className="mt-3 grid grid-cols-3 gap-2">
                      <Button variant="outline" size="sm" onClick={() => marcar(t.id, 'feita')}>
                        <Check className="h-4 w-4" /> Feita
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => marcar(t.id, 'parcial')}>
                        <MinusCircle className="h-4 w-4" /> Parcial
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => marcar(t.id, 'nao_feita')}>
                        <CircleSlash className="h-4 w-4" /> Não feita
                      </Button>
                    </div>
                  </Card>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </Shell>
  );
}
