'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, LogOut } from 'lucide-react';
import { api, clearToken, getCategoria, getToken } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { EntityForm, type FieldDef } from '@/components/cadastros/entity-form';

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
  const [colabs, setColabs] = useState<any[]>([]);
  const [tipos, setTipos] = useState<any[]>([]);
  const [ranking, setRanking] = useState<any[] | null>(null);
  const [erro, setErro] = useState('');
  const [ver, setVer] = useState(0);
  const data = hoje();
  const isPresidente = getCategoria() === 'presidente';

  const carregar = useCallback(async () => {
    try {
      const [dash, cs, ts] = await Promise.all([
        api.dashboard(data),
        api.get('/colaboradores'),
        api.get('/tipos-ocorrencia'),
      ]);
      setD(dash);
      setColabs(cs);
      setTipos(ts);
      if (getCategoria() === 'presidente') {
        try {
          setRanking(await api.get('/ocorrencias/ranking'));
        } catch {
          setRanking(null);
        }
      }
      setVer((v) => v + 1);
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
  const optColab = colabs.map((c: any) => ({ value: c.id, label: c.nome }));
  const optTipo = tipos.map((t: any) => ({
    value: t.id,
    label: `${t.nome} (${t.sinal === 'positiva' ? '+' : '−'}${t.pontos})`,
  }));

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

      <main className="mx-auto max-w-2xl space-y-6 px-4 py-4">
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

        <section className="space-y-3">
          <h2 className="font-semibold">Desempenho / Ocorrências</h2>

          <Card className="p-4">
            <p className="mb-2 text-sm font-medium">Registrar ocorrência</p>
            {optColab.length > 0 && optTipo.length > 0 ? (
              <EntityForm
                key={`oc-${ver}`}
                submitLabel="Registrar"
                fields={
                  [
                    { name: 'colaboradorId', label: 'Colaborador', type: 'select', required: true, options: optColab, defaultValue: optColab[0]?.value },
                    { name: 'tipoId', label: 'Tipo', type: 'select', required: true, options: optTipo, defaultValue: optTipo[0]?.value },
                    { name: 'gravidade', label: 'Gravidade', type: 'select', options: [{ value: 'leve', label: 'Leve' }, { value: 'grave', label: 'Grave' }], defaultValue: 'leve' },
                    { name: 'data', label: 'Data', type: 'date', defaultValue: data },
                  ] as FieldDef[]
                }
                onSubmit={async (v) => {
                  await api.post('/ocorrencias', {
                    colaboradorId: v.colaboradorId,
                    tipoId: v.tipoId,
                    gravidade: v.gravidade,
                    data: v.data || undefined,
                  });
                  await carregar();
                }}
              />
            ) : (
              <p className="text-sm text-muted-foreground">
                Cadastre colaboradores e tipos de ocorrência primeiro.
              </p>
            )}
          </Card>

          <Card className="p-4">
            <p className="mb-2 text-sm font-medium">Novo tipo de ocorrência</p>
            <EntityForm
              key={`tp-${ver}`}
              submitLabel="Criar tipo"
              fields={
                [
                  { name: 'nome', label: 'Nome', type: 'text', required: true, placeholder: 'Ex.: Boa ação' },
                  { name: 'sinal', label: 'Sinal', type: 'select', options: [{ value: 'positiva', label: 'Positiva (+)' }, { value: 'negativa', label: 'Negativa (−)' }], defaultValue: 'positiva' },
                  { name: 'pontos', label: 'Pontos', type: 'text', placeholder: '10' },
                ] as FieldDef[]
              }
              onSubmit={async (v) => {
                await api.post('/tipos-ocorrencia', {
                  nome: v.nome,
                  sinal: v.sinal,
                  pontos: v.pontos ? Number(v.pontos) : 0,
                });
                await carregar();
              }}
            />
          </Card>

          {isPresidente && ranking && (
            <Card className="p-4">
              <p className="mb-3 text-sm font-medium">
                Ranking{' '}
                <span className="text-xs font-normal text-muted-foreground">
                  (exclusivo do presidente)
                </span>
              </p>
              <div className="space-y-2">
                {ranking.map((r: any, i: number) => (
                  <div key={r.id} className="flex items-center justify-between">
                    <span className="text-sm">
                      {i + 1}. {r.nome}{' '}
                      <span className="text-xs text-muted-foreground">
                        ({r.ocorrencias} oc.)
                      </span>
                    </span>
                    <Badge
                      className={
                        r.pontos >= 0
                          ? 'bg-emerald-100 text-emerald-700'
                          : 'bg-red-100 text-red-700'
                      }
                    >
                      {r.pontos} pts
                    </Badge>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </section>
      </main>
    </div>
  );
}
