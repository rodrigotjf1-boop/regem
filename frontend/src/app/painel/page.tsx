'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AlertTriangle } from 'lucide-react';
import { api, getCategoria, getToken, rotaInicial } from '@/lib/api';
import { Shell } from '@/components/app-shell/shell';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { toast } from '@/lib/toast';
import { Timeline } from '@/components/dashboard/timeline';
import { CardPontoHoje } from '@/components/dashboard/card-ponto-hoje';
import { NovaTarefaForm } from '@/components/tarefa/nova-tarefa-form';
import { TarefaModal } from '@/components/tarefa/tarefa-modal';
import { Plus, Settings2 } from 'lucide-react';

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
  const [gridMin, setGridMin] = useState(60); // granularidade da grade do timeline (padrão 1h)
  const [novaTarefa, setNovaTarefa] = useState(false);
  const [tarefaSel, setTarefaSel] = useState<any>(null);
  const [politica, setPolitica] = useState({ conclusao: false, parcial: false });
  const [politicaModal, setPoliticaModal] = useState(false);
  // Categoria lida em estado (não no render): ler getCategoria() no corpo do
  // render descasa o SSR (token nulo no servidor) do cliente — hydration mismatch.
  const [cat, setCat] = useState('');
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
      api.politicaFotoTarefa().then((p: any) => p && setPolitica(p)).catch(() => {});
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
    // Dashboard é só de gestor (RBAC do backend); demais perfis vão para a 1ª
    // tela que o perfil pode ver (rotaInicial) — nunca /meu-dia fixo, que
    // execução não tem permissão e daria 403.
    const c = getCategoria() ?? '';
    setCat(c);
    if (c !== 'presidente' && c !== 'gerente') {
      router.replace(rotaInicial(c));
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

  // Data + aviso de tarefa pendente vão para o cabeçalho (Shell actions). "Pendente"
  // agrega o que precisa de atenção (pendente/não feita/parcial) do dia.
  const headerInfo = (
    <div className="flex items-center gap-2.5">
      <span className="hidden text-xs capitalize text-muted-foreground sm:inline">{dataLabel}</span>
      {atencao.length > 0 && (
        <span className="inline-flex items-center gap-1.5 rounded-md border border-warn/40 bg-warn/10 px-2.5 py-1.5 text-xs font-semibold text-warn">
          <AlertTriangle className="h-3.5 w-3.5" />
          {atencao.length} pendente{atencao.length > 1 ? 's' : ''}
        </span>
      )}
    </div>
  );

  return (
    <Shell eyebrow="Visão geral" title="Dashboard" actions={headerInfo}>
      {erro && <p className="mb-3 text-destructive">{erro}</p>}

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
        <div className="flex flex-wrap items-center gap-3 border-b border-border px-5 py-3.5">
          <div className="min-w-0">
            <p className="font-display text-sm font-bold">
              Linha do tempo operacional
            </p>
            <p className="text-xs text-muted-foreground">
              Quem está escalado e o que deveria estar em execução agora, por setor
            </p>
          </div>
          <label className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground">
            Alinhamento
            <select
              value={gridMin}
              onChange={(e) => setGridMin(Number(e.target.value))}
              className="rounded-md border border-border bg-card px-2 py-1 text-xs font-medium text-foreground outline-none"
              aria-label="Granularidade da grade da linha do tempo"
            >
              <option value={15}>15 em 15 min</option>
              <option value={30}>30 em 30 min</option>
              <option value={60}>1 em 1 hora</option>
              <option value={120}>2 em 2 horas</option>
            </select>
          </label>
        </div>
        {timeline ? (
          <Timeline
            setores={timeline.setores ?? []}
            picos={timeline.picos ?? []}
            agora={timeline.agora ?? null}
            stepMin={gridMin}
          />
        ) : (
          <p className="px-5 py-6 text-sm text-muted-foreground">Carregando…</p>
        )}
      </Card>

      {/* Tarefas em atraso/atenção (½) + Ponto de hoje (½) */}
      <div className="mb-4 grid gap-4 lg:grid-cols-2">
        <Card className="p-0">
          <div className="flex items-center gap-3 border-b border-border px-5 py-3.5">
            <div className="min-w-0">
              <p className="font-display text-sm font-bold">
                Gerenciamento de tarefas
              </p>
              <p className="text-xs text-muted-foreground">Em atraso ou atenção · puxadas da escala do dia</p>
            </div>
            {cat === 'presidente' && (
              <button
                type="button"
                onClick={() => setPoliticaModal(true)}
                className="ml-auto inline-flex h-8 w-8 flex-none items-center justify-center rounded-md border border-border text-muted-foreground hover:border-primary hover:text-primary"
                aria-label="Política de foto"
                title="Exigência de foto na conclusão"
              >
                <Settings2 className="h-4 w-4" />
              </button>
            )}
            <button
              type="button"
              onClick={() => setNovaTarefa(true)}
              className={`${cat === 'presidente' ? '' : 'ml-auto'} inline-flex h-8 w-8 flex-none items-center justify-center rounded-md border border-border text-muted-foreground hover:border-primary hover:text-primary`}
              aria-label="Nova tarefa"
              title="Nova tarefa"
            >
              <Plus className="h-4 w-4" />
            </button>
          </div>
          <div className="divide-y divide-border">
            {atencao.length === 0 && (
              <p className="px-5 py-6 text-sm text-muted-foreground">
                Nenhuma tarefa pendente. 🎉
              </p>
            )}
            {atencao.map((t: any) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTarefaSel(t)}
                className="flex w-full items-center gap-3 px-5 py-3 text-left hover:bg-primary/5"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">
                    {t.titulo ?? 'Tarefa'}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {t.setorNome ?? '—'} · {t.colaboradorNome ?? 'em aberto'}
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
              </button>
            ))}
          </div>
        </Card>

        <CardPontoHoje />
      </div>

      {/* Ranking da equipe — abaixo, largura cheia */}
      {ranking && (
        <Card className="mb-4 p-0">
          <div className="border-b border-border px-5 py-3.5">
            <p className="font-display text-sm font-bold">Ranking da equipe</p>
            <p className="text-xs text-muted-foreground">Pontuação · gamificação</p>
          </div>
          <div className="grid gap-x-6 sm:grid-cols-2">
            {ranking.length === 0 && (
              <p className="px-5 py-6 text-sm text-muted-foreground">
                Sem pontuação ainda.
              </p>
            )}
            {ranking.slice(0, 10).map((r: any, i: number) => (
              <div key={r.id} className="flex items-center gap-3 border-b border-border px-5 py-2.5">
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

      {novaTarefa && (
        <div className="fixed inset-0 z-[60] grid place-items-center overflow-y-auto bg-black/40 p-4" onClick={() => setNovaTarefa(false)}>
          <div className="w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <NovaTarefaForm
              data={data}
              onCreated={() => {
                setNovaTarefa(false);
                carregar();
              }}
              onCancel={() => setNovaTarefa(false)}
            />
          </div>
        </div>
      )}

      {tarefaSel && (
        <TarefaModal
          tarefa={tarefaSel}
          politica={politica}
          data={data}
          onClose={() => setTarefaSel(null)}
          onChanged={() => {
            setTarefaSel(null);
            carregar();
          }}
        />
      )}

      {politicaModal && (
        <div className="fixed inset-0 z-[60] grid place-items-center bg-black/40 p-4" onClick={() => setPoliticaModal(false)}>
          <Card className="w-full max-w-sm space-y-4 p-5" onClick={(e) => e.stopPropagation()}>
            <div>
              <h2 className="font-display text-base font-bold">Foto na conclusão de tarefas</h2>
              <p className="text-xs text-muted-foreground">
                Você (presidente/C&O) decide quando a comprovação por foto é obrigatória.
              </p>
            </div>
            <label className="flex items-center justify-between gap-3 text-sm">
              <span>Exigir foto ao concluir</span>
              <input type="checkbox" className="h-4 w-4 accent-primary" checked={politica.conclusao}
                onChange={(e) => setPolitica((p) => ({ ...p, conclusao: e.target.checked }))} />
            </label>
            <label className="flex items-center justify-between gap-3 text-sm">
              <span>Exigir foto na conclusão parcial</span>
              <input type="checkbox" className="h-4 w-4 accent-primary" checked={politica.parcial}
                onChange={(e) => setPolitica((p) => ({ ...p, parcial: e.target.checked }))} />
            </label>
            <p className="text-xs text-muted-foreground">Não concluída nunca exige foto — só o motivo.</p>
            <div className="flex gap-2">
              <Button
                className="flex-1"
                onClick={async () => {
                  try {
                    await api.setPoliticaFotoTarefa(politica);
                    toast.success('Política salva.');
                    setPoliticaModal(false);
                  } catch (e) {
                    toast.error(e instanceof Error ? e.message : 'Erro ao salvar');
                  }
                }}
              >
                Salvar
              </Button>
              <Button variant="outline" onClick={() => setPoliticaModal(false)}>Fechar</Button>
            </div>
          </Card>
        </div>
      )}
    </Shell>
  );
}
