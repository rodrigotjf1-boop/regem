'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { LogOut, Plus, X } from 'lucide-react';
import { api, clearToken, getToken } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { BottomNav } from '@/components/app-shell/bottom-nav';
import { NovaAlocacaoForm } from '@/components/escala/nova-alocacao-form';

type Aloc = {
  id: string;
  tipo: string;
  etiquetaSigla: string | null;
  etiquetaContador: number | null;
  setorNome: string | null;
  turnoNome: string | null;
  colaboradorNome: string | null;
};

const TIPO: Record<string, string> = {
  titular: 'bg-slate-100 text-slate-700',
  diarista: 'bg-blue-100 text-blue-700',
  cobertura: 'bg-amber-100 text-amber-800',
  avulso: 'bg-violet-100 text-violet-700',
};

function hoje() {
  return new Date().toISOString().slice(0, 10);
}

export default function EscalaPage() {
  const router = useRouter();
  const [itens, setItens] = useState<Aloc[]>([]);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState('');
  const [show, setShow] = useState(false);
  const data = hoje();

  const carregar = useCallback(async () => {
    try {
      setItens(await api.escalaDoDia(data));
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

  function sair() {
    clearToken();
    router.replace('/');
  }

  const grupos = itens.reduce<Record<string, Aloc[]>>((acc, x) => {
    const k = x.setorNome ?? 'Sem setor';
    (acc[k] ??= []).push(x);
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
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary font-bold text-primary-foreground">
              R
            </div>
            <div>
              <p className="text-sm font-semibold leading-none">Escala</p>
              <p className="text-xs capitalize text-muted-foreground tabular-nums">
                {dataLabel}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setShow((v) => !v)}
              aria-label="Nova alocação"
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
          <NovaAlocacaoForm
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
        {!loading && !erro && itens.length === 0 && (
          <Card className="p-8 text-center text-muted-foreground">
            Nenhuma vaga escalada para hoje.
          </Card>
        )}

        {Object.entries(grupos).map(([setorNome, arr]) => (
          <section key={setorNome} className="space-y-2">
            <h2 className="px-1 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              {setorNome}
            </h2>
            <div className="space-y-2">
              {arr.map((x) => (
                <Card
                  key={x.id}
                  className="flex items-center justify-between gap-3 p-4"
                >
                  <div className="min-w-0">
                    <p className="font-medium leading-tight">
                      {x.etiquetaSigla
                        ? `${x.etiquetaSigla}${x.etiquetaContador ?? ''}`
                        : '—'}
                      {x.turnoNome ? (
                        <span className="font-normal text-muted-foreground">
                          {' '}
                          · {x.turnoNome}
                        </span>
                      ) : null}
                    </p>
                    <p className="mt-0.5 text-sm text-muted-foreground">
                      {x.colaboradorNome ?? 'Vaga aberta'}
                    </p>
                  </div>
                  <Badge className={TIPO[x.tipo] ?? TIPO.titular}>{x.tipo}</Badge>
                </Card>
              ))}
            </div>
          </section>
        ))}
      </main>
      <BottomNav />
    </div>
  );
}
