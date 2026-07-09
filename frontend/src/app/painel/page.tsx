'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AlertTriangle } from 'lucide-react';
import { api, getCategoria, getToken } from '@/lib/api';
import { Shell } from '@/components/app-shell/shell';
import { Card } from '@/components/ui/card';
import { Timeline } from '@/components/dashboard/timeline';
import { CardPontoHoje } from '@/components/dashboard/card-ponto-hoje';

/* eslint-disable @typescript-eslint/no-explicit-any */
// Data de hoje no fuso da operação (America/Sao_Paulo) — alinha KPIs e o
// marcador "agora" da timeline, evitando divergência perto da meia-noite.
function hoje() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
}
const brl = (n: number) =>
  Number(n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export default function DashboardPage() {
  const [d, setD] = useState<any>(null);
  const [tarefas, setTarefas] = useState<any[]>([]);
  const [timeline, setTimeline] = useState<any>(null);
  const [ranking, setRanking] = useState<any[] | null>(null);
  const [erro, setErro] = useState('');
  const data = hoje();

  const carregar = useCallback(async () => {
    try {
      const [dash, tar, tl] = await Promise.all([
        api.dashboard(data),
        api.tarefasDoDia(data),
        api.dashboardTimeline(data),
      ]);
      setD(dash);
      setTarefas(tar);
      setTimeline(tl);
      if (getCategoria() === 'presidente') {
        try {
          setRanking(await api.get('/ocorrencias/ranking'));
        } catch {
          /* sem permissão */
        }
      }
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao carregar');
    }
  }, [data]);

  const router = useRouter();
  useEffect(() => {
    if (!getToken()) {
      router.replace('/entrar');
      return;
    }
    // Dashboard é só de gestor (RBAC do backend); demais perfis vão ao Meu Dia.
    const cat = getCategoria();
    if (cat !== 'presidente' && cat !== 'gerente') {
      router.replace('/meu-dia');
      return;
    }
    carregar();
  }, [carregar, router]);

  const dataLabel = new Date(data + 'T00:00').toLocaleDateString('pt-BR', {
    weekday: 'long',
    day: '2-digit',
    month: 'long',
  });

  const atencao = tarefas.filter(
    (t: any) =>
      t.estado === 'pendente' ||
      t.estado === 'nao_feita' ||
      t.estado === 'parcial',
  );

  // Faixa comercial/financeira: só existe quando o servidor envia `comercial`
  // (RBAC — presidente/C&O). Gerente não recebe o bloco, logo a faixa some.
  const kpisFinanceiro = d?.comercial
    ? [
        { label: 'Faturamento hoje', value: brl(d.comercial.faturado ?? 0), sub: `${d.vendas?.total ?? 0} venda(s)`, color: 'var(--ok)' },
        { label: 'Ticket médio', value: brl(d.comercial.ticketMedio ?? 0), sub: 'por venda', color: 'var(--info)' },
        { label: 'Delivery faturado', value: brl(d.comercial.deliveryFaturado ?? 0), sub: 'apps + retirada', color: 'var(--info)' },
        { label: 'Custo de produção', value: brl(d.comercial.producaoCusto ?? 0), sub: 'fichas produzidas', color: 'var(--warn)' },
      ]
    : [];

  const kpis = d
    ? [
        { label: 'Conclusão', value: `${d.tarefas.pctConclusao}%`, sub: `${d.tarefas.feitas}/${d.tarefas.total} tarefas`, color: 'var(--ok)' },
        { label: 'Escalados hoje', value: `${d.escala.preenchidas}/${d.escala.vagas}`, sub: 'vagas preenchidas', color: 'var(--info)' },
        { label: 'Vendas hoje', value: d.vendas?.total ?? 0, sub: 'comandas fechadas', color: 'var(--ok)' },
        { label: 'Produção hoje', value: d.producaoHoje?.unidades ?? 0, sub: `${d.producaoHoje?.producoes ?? 0} produção(ões)`, color: 'var(--info)' },
        { label: 'Delivery aberto', value: d.deliveryPendentes ?? 0, sub: 'pedidos pendentes', color: 'var(--warn)' },
        { label: 'Pendentes', value: d.tarefas.pendentes, sub: 'tarefas do dia', color: 'var(--warn)' },
        { label: 'Estoque crítico', value: d.estoqueAbaixoMinimo, sub: 'abaixo do mínimo', color: 'var(--destructive)' },
        { label: 'Desperdícios', value: d.desperdicio.total, sub: `${d.desperdicio.quantidade} un.`, color: 'var(--warn)' },
      ]
    : [];

  const alertas: { txt: string; cor: string }[] = [];
  if (d) {
    if (d.estoqueAbaixoMinimo > 0)
      alertas.push({ txt: `${d.estoqueAbaixoMinimo} item(ns) de estoque abaixo do mínimo`, cor: 'hsl(var(--destructive))' });
    if (d.tarefas.naoFeitas > 0)
      alertas.push({ txt: `${d.tarefas.naoFeitas} tarefa(s) não feita(s) hoje`, cor: 'hsl(var(--destructive))' });
    if (d.tarefas.pendentes > 0)
      alertas.push({ txt: `${d.tarefas.pendentes} tarefa(s) pendente(s)`, cor: 'hsl(var(--warn))' });
    if (d.tarefas.emMassa > 0)
      alertas.push({ txt: `${d.tarefas.emMassa} conclusão(ões) em massa (governança)`, cor: 'hsl(var(--info))' });
  }

  return (
    <Shell eyebrow="Visão geral" title="Dashboard">
      {erro && <p className="text-destructive">{erro}</p>}
      <p className="mb-4 text-sm capitalize text-muted-foreground">{dataLabel}</p>

      {alertas.length > 0 && (
        <div className="mb-5 flex gap-2.5 overflow-x-auto pb-1">
          {alertas.map((a, i) => (
            <div
              key={i}
              className="flex flex-none items-center gap-2 rounded-lg border border-l-[3px] border-border bg-card px-3.5 py-2.5 text-xs font-semibold"
              style={{ borderLeftColor: a.cor }}
            >
              <AlertTriangle className="h-3.5 w-3.5" style={{ color: a.cor }} />
              {a.txt}
            </div>
          ))}
        </div>
      )}

      {kpisFinanceiro.length > 0 && (
        <>
          <p className="mb-2 font-display text-[11px] font-bold uppercase tracking-[.14em] text-muted-foreground">
            Comercial &amp; financeiro
          </p>
          <div className="mb-4 grid grid-cols-2 gap-3.5 md:grid-cols-4">
            {kpisFinanceiro.map((k) => (
              <Card key={k.label} className="relative overflow-hidden p-4">
                <span className="absolute inset-y-0 left-0 w-[3px]" style={{ background: `hsl(${k.color})` }} />
                <p className="font-display text-[10px] font-bold uppercase tracking-[.14em] text-muted-foreground">
                  {k.label}
                </p>
                <p className="mt-1 font-mono text-2xl font-bold tabular-nums">{k.value}</p>
                <p className="text-xs text-muted-foreground">{k.sub}</p>
              </Card>
            ))}
          </div>
        </>
      )}

      <div className="mb-5 grid grid-cols-2 gap-3.5 md:grid-cols-3 xl:grid-cols-5">
        {kpis.map((k) => (
          <Card key={k.label} className="relative overflow-hidden p-4">
            <span
              className="absolute inset-y-0 left-0 w-[3px]"
              style={{ background: `hsl(${k.color})` }}
            />
            <p className="font-display text-[10px] font-bold uppercase tracking-[.14em] text-muted-foreground">
              {k.label}
            </p>
            <p className="mt-1 font-mono text-2xl font-bold tabular-nums">
              {k.value}
            </p>
            <p className="text-xs text-muted-foreground">{k.sub}</p>
          </Card>
        ))}
      </div>

      <Card className="mb-4 p-0">
        <div className="border-b border-border px-5 py-3.5">
          <p className="font-display text-sm font-bold">
            Linha do tempo operacional
          </p>
          <p className="text-xs text-muted-foreground">
            Quem está escalado e o que deveria estar em execução agora, por setor
          </p>
        </div>
        {timeline ? (
          <Timeline
            setores={timeline.setores ?? []}
            picos={timeline.picos ?? []}
            agora={timeline.agora ?? null}
          />
        ) : (
          <p className="px-5 py-6 text-sm text-muted-foreground">Carregando…</p>
        )}
      </Card>

      {/* Ponto de hoje — resumo para o gerente (gestão completa em Pessoas & Ponto) */}
      <div className="mb-4">
        <CardPontoHoje />
      </div>

      <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
        <Card className="p-0">
          <div className="border-b border-border px-5 py-3.5">
            <p className="font-display text-sm font-bold">
              Tarefas em atraso ou atenção
            </p>
            <p className="text-xs text-muted-foreground">
              Puxadas da escala do dia
            </p>
          </div>
          <div className="divide-y divide-border">
            {atencao.length === 0 && (
              <p className="px-5 py-6 text-sm text-muted-foreground">
                Nenhuma tarefa pendente. 🎉
              </p>
            )}
            {atencao.map((t: any) => (
              <div key={t.id} className="flex items-center gap-3 px-5 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">
                    {t.titulo ?? 'Tarefa'}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {t.setorNome ?? '—'} · {t.colaboradorNome ?? 'vaga aberta'}
                  </p>
                </div>
                <span
                  className="ml-auto rounded-md px-2 py-1 text-[11px] font-bold"
                  style={{
                    background:
                      t.estado === 'nao_feita'
                        ? 'hsl(var(--destructive)/.12)'
                        : 'hsl(var(--warn)/.16)',
                    color:
                      t.estado === 'nao_feita'
                        ? 'hsl(var(--destructive))'
                        : 'hsl(var(--warn))',
                  }}
                >
                  {t.estado}
                </span>
              </div>
            ))}
          </div>
        </Card>

        {ranking && (
          <Card className="p-0">
            <div className="border-b border-border px-5 py-3.5">
              <p className="font-display text-sm font-bold">Ranking da equipe</p>
              <p className="text-xs text-muted-foreground">
                Pontuação · gamificação
              </p>
            </div>
            <div className="divide-y divide-border">
              {ranking.length === 0 && (
                <p className="px-5 py-6 text-sm text-muted-foreground">
                  Sem pontuação ainda.
                </p>
              )}
              {ranking.slice(0, 6).map((r: any, i: number) => (
                <div key={r.id} className="flex items-center gap-3 px-5 py-2.5">
                  <span className="w-6 font-mono text-sm font-bold text-muted-foreground">
                    {i + 1}º
                  </span>
                  <span className="truncate text-sm">{r.nome}</span>
                  <span
                    className={`ml-auto font-mono text-sm font-bold ${
                      r.pontos < 0 ? 'text-destructive' : ''
                    }`}
                  >
                    {r.pontos > 0 ? '+' : ''}
                    {r.pontos}
                  </span>
                </div>
              ))}
            </div>
          </Card>
        )}
      </div>
    </Shell>
  );
}
