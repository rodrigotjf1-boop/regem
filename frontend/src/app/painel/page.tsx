'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, LogOut } from 'lucide-react';
import { api, clearToken, getToken } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';

/* eslint-disable @typescript-eslint/no-explicit-any */
function hoje() {
  return new Date().toISOString().slice(0, 10);
}

function Kpi({
  label,
  valor,
  sub,
  tone,
}: {
  label: string;
  valor: string | number;
  sub?: string;
  tone?: string;
}) {
  return (
    <Card className="p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className={`mt-1 text-3xl font-bold tabular-nums ${tone ?? ''}`}>
        {valor}
      </p>
      {sub && <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p>}
    </Card>
  );
}

export default function PainelPage() {
  const router = useRouter();
  const [d, setD] = useState<any>(null);
  const [erro, setErro] = useState('');
  const data = hoje();

  const carregar = useCallback(async () => {
    try {
      setD(await api.dashboard(data));
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao carregar');
    }
  }, [data]);

  useEffect(() => {
    if (!getToken()) {
      router.replace('/');
      return;
    }
    carregar();
  }, [carregar, router]);

  function sair() {
    clearToken();
    router.replace('/');
  }

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
            <Button
              variant="ghost"
              size="icon"
              onClick={() => router.push('/meu-dia')}
              aria-label="Voltar"
            >
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <div>
              <p className="text-sm font-semibold leading-none">Painel</p>
              <p className="text-xs capitalize text-muted-foreground tabular-nums">
                {dataLabel}
              </p>
            </div>
          </div>
          <Button variant="ghost" size="icon" onClick={sair} aria-label="Sair">
            <LogOut className="h-5 w-5" />
          </Button>
        </div>
      </header>

      <main className="mx-auto max-w-2xl px-4 py-4">
        {erro && (
          <p role="alert" className="text-destructive">
            {erro}
          </p>
        )}
        {!d && !erro && <p className="text-muted-foreground">Carregando…</p>}
        {d && (
          <div className="grid grid-cols-2 gap-3">
            <Kpi
              label="Conclusão"
              valor={`${d.tarefas.pctConclusao}%`}
              sub={`${d.tarefas.feitas}/${d.tarefas.total} tarefas`}
              tone="text-primary"
            />
            <Kpi label="Pendentes" valor={d.tarefas.pendentes} sub="tarefas do dia" />
            <Kpi
              label="Não feitas"
              valor={d.tarefas.naoFeitas}
              tone={d.tarefas.naoFeitas > 0 ? 'text-red-600' : ''}
            />
            <Kpi
              label="Conclusão em massa"
              valor={d.tarefas.emMassa}
              sub="governança"
              tone={d.tarefas.emMassa > 0 ? 'text-amber-600' : ''}
            />
            <Kpi
              label="Escala"
              valor={`${d.escala.preenchidas}/${d.escala.vagas}`}
              sub="vagas preenchidas"
            />
            <Kpi
              label="Estoque crítico"
              valor={d.estoqueAbaixoMinimo}
              sub="itens abaixo do mínimo"
              tone={d.estoqueAbaixoMinimo > 0 ? 'text-red-600' : ''}
            />
            <Kpi
              label="Desperdícios"
              valor={d.desperdicio.total}
              sub={`${d.desperdicio.quantidade} un.`}
            />
            <Kpi label="Vistorias" valor={d.vistorias} sub="registradas hoje" />
          </div>
        )}
      </main>
    </div>
  );
}
