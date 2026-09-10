'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, X } from 'lucide-react';
import { api, getToken, getCategoria } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { SkeletonList } from '@/components/ui/skeleton';
import { Shell } from '@/components/app-shell/shell';
import { NovaTarefaForm } from '@/components/tarefa/nova-tarefa-form';
import { TarefaModal } from '@/components/tarefa/tarefa-modal';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Tarefa = {
  id: string;
  estado: string;
  titulo: string | null;
  setorNome: string | null;
  colaboradorNome: string | null;
  horario?: string | null;
  horarioFim?: string | null;
  prioridade?: string | null;
  criadoEm?: string | null;
  criadoPorNivel?: string | null;
  [k: string]: any;
};

// Hierarquia p/ gate de UI de editar/excluir (a trava real é no servidor).
const RANK: Record<string, number> = { execucao: 1, supervisao: 2, gerente: 3, presidente: 4 };

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

function fmtData(v?: string | null) {
  if (!v) return '—';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('pt-BR');
}

function fmtHora(v?: string | null) {
  return v ? String(v).slice(0, 5) : '—';
}

export default function MeuDiaPage() {
  const router = useRouter();
  const [tarefas, setTarefas] = useState<Tarefa[]>([]);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState('');
  const [show, setShow] = useState(false);
  const [sel, setSel] = useState<Tarefa | null>(null);
  const [politica, setPolitica] = useState({ conclusao: false, parcial: false });
  const data = hoje();

  // Quem sou eu — para liberar editar/excluir só a quem tem nível >= o de quem criou.
  // A trava real é no servidor; aqui é só UI.
  const minhaCategoria = getCategoria() ?? 'execucao';
  const meuRank = RANK[minhaCategoria] ?? 1;

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
    // Sem sessão: redireciona (antes o skeleton ficava para sempre — carregar() nunca rodava).
    if (getToken()) carregar();
    else router.replace('/entrar');
  }, [carregar, router]);

  // Política de foto (gestão) — usada pelo modal de conclusão. Silencia se sem permissão.
  useEffect(() => {
    api.politicaFotoTarefa().then((p: any) => p && setPolitica(p)).catch(() => {});
  }, []);

  const dataLabel = new Date(data + 'T00:00').toLocaleDateString('pt-BR', {
    weekday: 'long',
    day: '2-digit',
    month: 'long',
  });

  return (
    <Shell
      eyebrow="Operação diária"
      title="Tarefas"
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
            Suas tarefas do dia aparecem aqui, montadas a partir da escala.
          </p>
          <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-center">
            <Button onClick={() => setShow(true)}>
              <Plus className="h-4 w-4" /> Nova tarefa
            </Button>
          </div>
        </Card>
      )}

      {!loading && tarefas.length > 0 && (
        <Card className="overflow-hidden p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <caption className="sr-only">Tarefas do dia — clique numa linha para ver detalhes</caption>
              <thead>
                <tr className="border-b border-border bg-muted/30 text-left text-[11px] font-bold uppercase tracking-[.08em] text-muted-foreground">
                  <th className="whitespace-nowrap px-3 py-2.5">Data criação</th>
                  <th className="px-3 py-2.5">Nome</th>
                  <th className="px-3 py-2.5">Status</th>
                  <th className="whitespace-nowrap px-3 py-2.5">Hora inicial</th>
                  <th className="whitespace-nowrap px-3 py-2.5">Hora final</th>
                  <th className="px-3 py-2.5">Responsável</th>
                </tr>
              </thead>
              <tbody>
                {tarefas.map((t) => {
                  const st = STATUS[t.estado] ?? STATUS.pendente;
                  return (
                    <tr
                      key={t.id}
                      tabIndex={0}
                      role="button"
                      onClick={() => setSel(t)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          setSel(t);
                        }
                      }}
                      className="cursor-pointer border-b border-border/60 outline-none transition-colors last:border-0 hover:bg-muted/40 focus-visible:bg-muted/40"
                    >
                      <td className="whitespace-nowrap px-3 py-2.5 font-mono text-xs text-muted-foreground">
                        {fmtData(t.criadoEm)}
                      </td>
                      <td className="px-3 py-2.5">
                        <span className="font-medium">{t.titulo ?? 'Tarefa'}</span>
                        {t.prioridade && (
                          <span
                            className={`ml-2 inline-block rounded px-1.5 py-0.5 text-[10px] font-bold ${
                              t.prioridade === 'alta'
                                ? 'bg-red-100 text-red-700'
                                : t.prioridade === 'media'
                                  ? 'bg-amber-100 text-amber-800'
                                  : 'bg-slate-100 text-slate-600'
                            }`}
                          >
                            {t.prioridade === 'media' ? 'média' : t.prioridade}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2.5">
                        <span className={`inline-block rounded-md px-2 py-0.5 text-[11px] font-bold ${st.cls}`}>
                          {st.label}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5 font-mono text-xs">{fmtHora(t.horario)}</td>
                      <td className="whitespace-nowrap px-3 py-2.5 font-mono text-xs">{fmtHora(t.horarioFim)}</td>
                      <td className="px-3 py-2.5 text-muted-foreground">
                        {t.colaboradorNome ?? 'vaga aberta'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {sel && (
        <TarefaModal
          tarefa={sel}
          politica={politica}
          data={data}
          podeEditar={meuRank >= (RANK[sel.criadoPorNivel ?? 'gerente'] ?? 3)}
          onClose={() => setSel(null)}
          onChanged={() => {
            setSel(null);
            carregar();
          }}
        />
      )}
    </Shell>
  );
}
