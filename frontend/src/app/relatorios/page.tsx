'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, getToken, getCategoria, podeVerFinanceiro } from '@/lib/api';
import { Shell } from '@/components/app-shell/shell';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';

/* eslint-disable @typescript-eslint/no-explicit-any */
const brl = (n: number) =>
  Number(n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
// Valor em R$ que pode vir ANULADO do servidor (gerente não vê financeiro): mostra "—".
const rs = (v: any) => (v == null ? '—' : brl(v));
// Pode ver valores financeiros (permissão do perfil). A trava real é no servidor.
const podeFinanceiro = () => podeVerFinanceiro();
const hoje = () => new Date().toISOString().slice(0, 10);
const diasAtras = (d: number) => new Date(Date.now() - d * 86400000).toISOString().slice(0, 10);
const MESES = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
// 'YYYY-MM' → 'Jan/26'.
const mesLabel = (ym: string) => {
  const [y, m] = ym.split('-').map(Number);
  return `${MESES[m - 1]}/${String(y).slice(2)}`;
};

// Exporta linhas (array de objetos) como CSV e dispara o download.
function baixarCsv(nome: string, linhas: Record<string, any>[]) {
  if (!linhas.length) return;
  const cols = Object.keys(linhas[0]);
  const esc = (v: any) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const csv = [
    cols.join(';'),
    ...linhas.map((l) => cols.map((c) => esc(l[c])).join(';')),
  ].join('\n');
  const url = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `${nome}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
const CLASSE: Record<string, string> = {
  A: 'bg-ok/15 text-ok',
  B: 'bg-warn/15 text-warn',
  C: 'bg-secondary text-muted-foreground',
};

function Barra({ label, valor, max, right }: { label: string; valor: number; max: number; right: string }) {
  const pct = max > 0 ? Math.max(2, (valor / max) * 100) : 0;
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-sm">
        <span className="capitalize">{label}</span>
        <span className="font-mono text-muted-foreground">{right}</span>
      </div>
      <div className="h-2 rounded-full bg-secondary">
        <div className="h-2 rounded-full bg-primary" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export default function RelatoriosPage() {
  const router = useRouter();
  const isGestor = ['presidente', 'gerente', 'supervisao'].includes(getCategoria() ?? '');
  const verFin = podeFinanceiro(); // presidente/C&O vê valores em R$
  const [inicio, setInicio] = useState(diasAtras(29));
  const [fim, setFim] = useState(hoje());
  const [vendas, setVendas] = useState<any>(null);
  const [produtos, setProdutos] = useState<any>(null);
  const [atendentes, setAtendentes] = useState<any>(null);
  const [erro, setErro] = useState('');
  const [aba, setAba] = useState<'vendas' | 'balcao' | 'delivery' | 'turnos' | 'caixa' | 'estoque' | 'producao' | 'fidelidade' | 'cashback' | 'financeiro'>('vendas');
  const [caixaOps, setCaixaOps] = useState<any>(null);
  const [fatAnual, setFatAnual] = useState<any>(null);
  const [fatDelivery, setFatDelivery] = useState<any>(null);
  const [balcao, setBalcao] = useState<any>(null);
  const [delivery, setDelivery] = useState<any>(null);
  const [ranking, setRanking] = useState<any>(null);
  const [turnos, setTurnos] = useState<any>(null);
  const [estoque, setEstoque] = useState<any>(null);
  const [producao, setProducao] = useState<any>(null);
  const [agrupProd, setAgrupProd] = useState<'dia' | 'semana' | 'mes'>('dia');

  const reload = useCallback(async () => {
    setErro('');
    try {
      const [v, p, a] = await Promise.all([
        api.relatorioVendas(inicio, fim),
        api.relatorioProdutos(inicio, fim),
        api.relatorioAtendentes(inicio, fim),
      ]);
      setVendas(v);
      setProdutos(p);
      setAtendentes(a);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao carregar');
    }
  }, [inicio, fim]);

  const reloadFin = useCallback(async () => {
    setErro('');
    try {
      const [fa, fd] = await Promise.all([
        api.relatorioFaturamento(inicio, fim),
        api.relatorioFaturamentoDelivery(inicio, fim),
      ]);
      setFatAnual(fa);
      setFatDelivery(fd);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao carregar');
    }
  }, [inicio, fim]);

  const reloadBalcao = useCallback(async () => {
    setErro('');
    try {
      const [b, r] = await Promise.all([
        api.relatorioBalcao(inicio, fim),
        api.relatorioRanking(inicio, fim),
      ]);
      setBalcao(b);
      setRanking(r);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao carregar');
    }
  }, [inicio, fim]);

  const reloadDelivery = useCallback(async () => {
    setErro('');
    try {
      setDelivery(await api.relatorioDelivery(inicio, fim));
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao carregar');
    }
  }, [inicio, fim]);

  const reloadTurnos = useCallback(async () => {
    setErro('');
    try {
      setTurnos(await api.relatorioTurnos(inicio, fim));
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao carregar');
    }
  }, [inicio, fim]);

  const reloadEstoque = useCallback(async () => {
    setErro('');
    try {
      setEstoque(await api.estoqueInteligencia(inicio, fim));
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao carregar');
    }
  }, [inicio, fim]);

  const reloadProducao = useCallback(async () => {
    setErro('');
    try {
      setProducao(await api.relatorioProducao(inicio, fim, agrupProd));
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao carregar');
    }
  }, [inicio, fim, agrupProd]);

  const reloadCaixa = useCallback(async () => {
    setErro('');
    try {
      setCaixaOps(await api.relatorioOperacoesCaixa(inicio, fim));
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao carregar');
    }
  }, [inicio, fim]);

  // Seletor de mês → ajusta o período De/Até para o mês inteiro.
  function escolherMes(ym: string) {
    if (!ym) return;
    const [y, m] = ym.split('-').map(Number);
    const ultimo = new Date(y, m, 0).getDate();
    setInicio(`${ym}-01`);
    setFim(`${ym}-${String(ultimo).padStart(2, '0')}`);
  }

  useEffect(() => {
    if (!getToken()) {
      router.replace('/entrar');
      return;
    }
    reload();
  }, [reload, router]);

  useEffect(() => {
    if (!getToken()) return;
    if (aba === 'financeiro') reloadFin();
    else if (aba === 'balcao') reloadBalcao();
    else if (aba === 'delivery') reloadDelivery();
    else if (aba === 'turnos') reloadTurnos();
    else if (aba === 'caixa') reloadCaixa();
    else if (aba === 'estoque') reloadEstoque();
    else if (aba === 'producao') reloadProducao();
  }, [aba, reloadFin, reloadBalcao, reloadDelivery, reloadTurnos, reloadCaixa, reloadEstoque, reloadProducao]);

  if (!isGestor) {
    return (
      <Shell eyebrow="Relatórios" title="Relatórios de venda">
        <p className="text-sm text-muted-foreground">Acesso restrito à gestão.</p>
      </Shell>
    );
  }

  const maxForma = Math.max(1, ...(vendas?.porForma ?? []).map((x: any) => x.total));
  const maxCanal = Math.max(1, ...(vendas?.porCanal ?? []).map((x: any) => x.total));
  const maxHora = Math.max(1, ...(vendas?.porHora ?? []).map((x: any) => x.qtd));

  return (
    <Shell eyebrow="Gestão · relatórios" title="Relatórios de venda">
      <div className="max-w-4xl space-y-4">
        {erro && <p className="text-destructive">{erro}</p>}

        <Card className="flex flex-wrap items-end gap-3 p-4">
          <div className="space-y-1">
            <Label className="text-xs">De</Label>
            <Input type="date" value={inicio} onChange={(e) => setInicio(e.target.value)} className="w-40" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Até</Label>
            <Input type="date" value={fim} onChange={(e) => setFim(e.target.value)} className="w-40" />
          </div>
          <Button
            type="button"
            onClick={() => {
              if (aba === 'financeiro') reloadFin();
              else if (aba === 'balcao') reloadBalcao();
              else if (aba === 'delivery') reloadDelivery();
              else if (aba === 'turnos') reloadTurnos();
              else if (aba === 'caixa') reloadCaixa();
              else if (aba === 'estoque') reloadEstoque();
              else if (aba === 'producao') reloadProducao();
              else reload();
            }}
          >
            Atualizar
          </Button>
        </Card>

        {/* Abas por módulo */}
        <div className="flex flex-wrap gap-2">
          {[
            { v: 'vendas', l: 'Vendas' },
            { v: 'balcao', l: 'Balcão / Salão' },
            { v: 'delivery', l: 'Delivery' },
            { v: 'turnos', l: 'Turnos / Caixa' },
            { v: 'caixa', l: 'Operações de caixa' },
            { v: 'estoque', l: 'Estoque' },
            { v: 'producao', l: 'Produção' },
            { v: 'fidelidade', l: 'Fidelidades' },
            { v: 'cashback', l: 'Cashbacks' },
            { v: 'financeiro', l: 'Financeiro' },
          ].filter((t) => verFin || t.v !== 'financeiro').map((t) => (
            <button
              key={t.v}
              type="button"
              onClick={() => setAba(t.v as any)}
              className={`rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors ${
                aba === t.v
                  ? 'border-primary bg-primary/15 text-primary'
                  : 'border-border bg-card text-muted-foreground hover:text-foreground'
              }`}
            >
              {t.l}
            </button>
          ))}
        </div>

        {aba === 'vendas' && (
        <>
        {/* KPIs */}
        {vendas && (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              ...(verFin ? [{ l: 'Faturado', v: rs(vendas.resumo.faturado) }] : []),
              { l: 'Vendas', v: vendas.resumo.vendas },
              ...(verFin ? [{ l: 'Ticket médio', v: rs(vendas.resumo.ticketMedio) }] : []),
              { l: 'Canceladas', v: vendas.resumo.canceladas },
            ].map((k) => (
              <Card key={k.l} className="p-4">
                <p className="text-xs text-muted-foreground">{k.l}</p>
                <p className="mt-1 font-mono text-xl font-bold">{k.v}</p>
              </Card>
            ))}
          </div>
        )}

        {verFin && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {/* Por forma */}
          <Card className="space-y-3 p-4">
            <h2 className="font-display text-sm font-bold">Por forma de pagamento</h2>
            {(vendas?.porForma ?? []).length === 0 && <p className="text-sm text-muted-foreground">Sem vendas.</p>}
            {(vendas?.porForma ?? []).map((x: any) => (
              <Barra key={x.forma} label={x.forma} valor={x.total} max={maxForma} right={`${brl(x.total)} · ${x.qtd}`} />
            ))}
          </Card>

          {/* Por canal */}
          <Card className="space-y-3 p-4">
            <h2 className="font-display text-sm font-bold">Por canal</h2>
            {(vendas?.porCanal ?? []).map((x: any) => (
              <Barra key={x.canal} label={x.canal} valor={x.total} max={maxCanal} right={`${brl(x.total)} · ${x.qtd}`} />
            ))}
          </Card>
        </div>
        )}

        {/* Curva ABC */}
        <Card className="p-4">
          <h2 className="mb-3 font-display text-sm font-bold">Curva ABC de produtos</h2>
          {(produtos?.itens ?? []).length === 0 && <p className="text-sm text-muted-foreground">Sem vendas no período.</p>}
          <div className="space-y-1">
            {(produtos?.itens ?? []).slice(0, 20).map((p: any, i: number) => (
              <div key={i} className="flex items-center gap-2 border-b border-border/50 py-1.5 text-sm last:border-0">
                <span className={`w-5 rounded text-center text-xs font-bold ${CLASSE[p.classe] ?? ''}`}>{p.classe}</span>
                <span className="min-w-0 flex-1 truncate">{p.descricao}</span>
                <span className="w-10 text-right text-xs text-muted-foreground">{p.qtd}x</span>
                <span className="w-24 text-right font-mono">{rs(p.faturamento)}</span>
                <span className="w-12 text-right text-xs text-muted-foreground">{p.pct}%</span>
              </div>
            ))}
          </div>
        </Card>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {/* Atendentes */}
          <Card className="p-4">
            <h2 className="mb-3 font-display text-sm font-bold">Por atendente</h2>
            {(atendentes?.atendentes ?? []).length === 0 && <p className="text-sm text-muted-foreground">Sem vendas.</p>}
            <div className="space-y-1">
              {(atendentes?.atendentes ?? []).map((a: any, i: number) => (
                <div key={i} className="flex items-center gap-2 text-sm">
                  <span className="min-w-0 flex-1 truncate">{a.nome}</span>
                  <span className="text-xs text-muted-foreground">{a.vendas} vendas</span>
                  <span className="w-24 text-right font-mono">{rs(a.total)}</span>
                  <span className="w-20 text-right text-xs text-muted-foreground">tm {rs(a.ticketMedio)}</span>
                </div>
              ))}
            </div>
          </Card>

          {/* Por hora */}
          <Card className="p-4">
            <h2 className="mb-3 font-display text-sm font-bold">Vendas por hora</h2>
            {(vendas?.porHora ?? []).length === 0 && <p className="text-sm text-muted-foreground">Sem vendas.</p>}
            <div className="flex items-end gap-1" style={{ height: 120 }}>
              {(vendas?.porHora ?? []).map((h: any) => (
                <div key={h.hora} className="flex flex-1 flex-col items-center justify-end" title={`${h.hora}h · ${h.qtd} vendas`}>
                  <div className="w-full rounded-t bg-primary" style={{ height: `${(h.qtd / maxHora) * 100}%` }} />
                  <span className="mt-1 text-[9px] text-muted-foreground">{h.hora}</span>
                </div>
              ))}
            </div>
          </Card>
        </div>
        </>
        )}

        {aba === 'balcao' && (
          <>
            <DetalheCanal data={balcao} nome="balcao" />
            <RankingGlobal data={ranking} />
          </>
        )}

        {aba === 'delivery' && (
          <>
            <div className="flex justify-end">
              <Button type="button" variant="outline" size="sm" onClick={() => router.push('/relatorios/delivery')}>
                🗺️ Mapa de calor por bairro
              </Button>
            </div>
            <DetalheCanal data={delivery} nome="delivery" delivery />
          </>
        )}

        {aba === 'turnos' && <TurnosView data={turnos} />}

        {aba === 'caixa' && <CaixaOpsView data={caixaOps} />}

        {aba === 'estoque' && <EstoqueView data={estoque} />}

        {aba === 'producao' && (
          <ProducaoView data={producao} agrup={agrupProd} setAgrup={setAgrupProd} />
        )}

        {aba === 'fidelidade' && (
          <ResgatesView
            titulo="Prêmios de fidelidade resgatados"
            colunaDetalhe="Prêmio"
            buscar={(i, f, t) => api.fidelidadeRelatorioPeriodo(i, f, t)}
            mapa={(r: any) => ({ data: r.resgatadoEm, cliente: r.telefone, item: r.premio, detalhe: r.detalhe })}
          />
        )}

        {aba === 'cashback' && (
          <ResgatesView
            titulo="Cashbacks resgatados"
            colunaDetalhe="Uso"
            buscar={(i, f, t) => api.cashbackRelatorio(i, f, t)}
            mapa={(r: any) => ({ data: r.criadoEm, cliente: r.telefone, item: r.tipo === 'valor' ? 'Saldo (R$)' : 'Pontos', detalhe: r.tipo === 'valor' ? brl(r.valor) : `${r.valor} pts` })}
          />
        )}

        {aba === 'financeiro' && (
        <>
          {/* Faturamento por mês (respeita o período De/Até acima) */}
          <Card className="space-y-3 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="font-display text-sm font-bold">Faturamento por mês</h2>
                <p className="text-xs text-muted-foreground">Meses dentro do período De/Até. Use o seletor para pular para um mês.</p>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="month"
                  aria-label="Escolher mês"
                  value={inicio.slice(0, 7)}
                  onChange={(e) => escolherMes(e.target.value)}
                  className="h-9 rounded-md border border-input bg-card px-2 text-sm"
                />
                {fatAnual && (
                  <Button type="button" variant="outline" size="sm" onClick={() => baixarCsv('faturamento-mes', fatAnual.porMes.map((m: any) => ({ mes: m.ym, faturamento: m.total, vendas: m.vendas })))}>
                    Exportar CSV
                  </Button>
                )}
              </div>
            </div>
            {fatAnual && (
              fatAnual.porMes.length === 0 ? (
                <p className="text-sm text-muted-foreground">Sem vendas no período.</p>
              ) : (
              <>
                <div className="flex items-end gap-1.5" style={{ height: 140 }}>
                  {fatAnual.porMes.map((m: any) => {
                    const mx = Math.max(1, ...fatAnual.porMes.map((x: any) => x.total));
                    return (
                      <div key={m.ym} className="flex flex-1 flex-col items-center justify-end" title={`${mesLabel(m.ym)} · ${brl(m.total)} · ${m.vendas} vendas`}>
                        <div className="w-full rounded-t bg-primary" style={{ height: `${(m.total / mx) * 100}%` }} />
                        <span className="mt-1 text-[9px] text-muted-foreground">{mesLabel(m.ym)}</span>
                      </div>
                    );
                  })}
                </div>
                {fatAnual.trimestres.length > 1 && (
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    {fatAnual.trimestres.map((t: any) => (
                      <div key={t.trimestre} className="rounded-lg border border-border p-2.5 text-center">
                        <p className="text-[10px] font-bold uppercase text-muted-foreground">{t.trimestre}</p>
                        <p className="mt-0.5 font-mono text-sm font-bold">{brl(t.total)}</p>
                        <p className="text-[10px] text-muted-foreground">{t.vendas} vendas</p>
                      </div>
                    ))}
                  </div>
                )}
                <p className="text-right text-sm">
                  Total do período: <strong className="font-mono">{brl(fatAnual.total)}</strong>
                </p>
              </>
              )
            )}
          </Card>

          {/* Faturamento por delivery / plataforma (usa o período De/Até) */}
          <Card className="space-y-3 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="font-display text-sm font-bold">Faturamento por delivery (plataforma)</h2>
                <p className="text-xs text-muted-foreground">Período De/Até acima · exclui pendentes e cancelados.</p>
              </div>
              {fatDelivery && fatDelivery.porPlataforma.length > 0 && (
                <Button type="button" variant="outline" size="sm" onClick={() => baixarCsv('faturamento-delivery', fatDelivery.porPlataforma.map((p: any) => ({ plataforma: p.plataforma, pedidos: p.pedidos, total: p.total, ticketMedio: p.ticketMedio })))}>
                  Exportar CSV
                </Button>
              )}
            </div>
            {fatDelivery && (
              <>
                <div className="grid grid-cols-3 gap-2">
                  <div className="rounded-lg border border-border p-2.5 text-center">
                    <p className="text-[10px] uppercase text-muted-foreground">Total delivery</p>
                    <p className="mt-0.5 font-mono text-sm font-bold">{brl(fatDelivery.total)}</p>
                  </div>
                  <div className="rounded-lg border border-border p-2.5 text-center">
                    <p className="text-[10px] uppercase text-muted-foreground">Pedidos</p>
                    <p className="mt-0.5 font-mono text-sm font-bold">{fatDelivery.pedidos}</p>
                  </div>
                  <div className="rounded-lg border border-border p-2.5 text-center">
                    <p className="text-[10px] uppercase text-muted-foreground">Ticket médio</p>
                    <p className="mt-0.5 font-mono text-sm font-bold">{brl(fatDelivery.ticketMedio)}</p>
                  </div>
                </div>
                {fatDelivery.porPlataforma.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Sem pedidos de delivery no período.</p>
                ) : (
                  <div className="space-y-1">
                    {fatDelivery.porPlataforma.map((p: any) => (
                      <div key={p.plataforma} className="flex items-center gap-2 border-b border-border/50 py-1.5 text-sm last:border-0">
                        <span className="min-w-0 flex-1 truncate capitalize">{p.plataforma}</span>
                        <span className="w-14 text-right text-xs text-muted-foreground">{p.pedidos} ped.</span>
                        <span className="w-24 text-right font-mono">{brl(p.total)}</span>
                        <span className="w-20 text-right text-xs text-muted-foreground">tm {brl(p.ticketMedio)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </Card>
        </>
        )}
      </div>
    </Shell>
  );
}

// Relatório de resgates (fidelidade/cashback) por período + filtro por cliente.
function ResgatesView({
  titulo,
  colunaDetalhe,
  buscar,
  mapa,
}: {
  titulo: string;
  colunaDetalhe: string;
  buscar: (inicio: string, fim: string, telefone: string) => Promise<any>;
  mapa: (r: any) => { data: any; cliente: string; item: string; detalhe: string };
}) {
  const [inicio, setInicio] = useState(diasAtras(30));
  const [fim, setFim] = useState(hoje());
  const [telefone, setTelefone] = useState('');
  const [linhas, setLinhas] = useState<any[]>([]);
  const [carregando, setCarregando] = useState(false);

  const carregar = useCallback(async () => {
    setCarregando(true);
    try {
      const r = await buscar(inicio, fim, telefone.replace(/\D/g, ''));
      setLinhas(((r as any[]) ?? []).map(mapa));
    } catch {
      setLinhas([]);
    } finally {
      setCarregando(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inicio, fim, telefone]);
  useEffect(() => {
    carregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const dh = (d: any) => (d ? new Date(d).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—');

  return (
    <Card className="space-y-4 p-4">
      <div className="flex flex-wrap items-end gap-3">
        <h2 className="mr-auto font-display text-base font-bold">{titulo}</h2>
        <div>
          <Label className="text-xs">Início</Label>
          <Input type="date" value={inicio} onChange={(e) => setInicio(e.target.value)} className="h-9" />
        </div>
        <div>
          <Label className="text-xs">Fim</Label>
          <Input type="date" value={fim} onChange={(e) => setFim(e.target.value)} className="h-9" />
        </div>
        <div>
          <Label className="text-xs">Cliente (telefone)</Label>
          <Input value={telefone} onChange={(e) => setTelefone(e.target.value)} placeholder="opcional" className="h-9 w-40" />
        </div>
        <Button type="button" onClick={carregar} disabled={carregando}>{carregando ? 'Buscando…' : 'Filtrar'}</Button>
        <Button type="button" variant="outline" onClick={() => baixarCsv(titulo, linhas.map((l) => ({ Data: dh(l.data), Cliente: l.cliente, Item: l.item, Detalhe: l.detalhe })))} disabled={!linhas.length}>CSV</Button>
      </div>

      <p className="text-sm text-muted-foreground">{linhas.length} resgate(s) no período.</p>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <caption className="sr-only">{titulo}</caption>
          <thead>
            <tr className="border-b border-border text-left text-xs text-muted-foreground">
              <th className="py-2 pr-3 font-medium">Data</th>
              <th className="py-2 pr-3 font-medium">Cliente</th>
              <th className="py-2 pr-3 font-medium">{colunaDetalhe}</th>
              <th className="py-2 font-medium">Detalhe</th>
            </tr>
          </thead>
          <tbody>
            {linhas.length === 0 && (
              <tr><td colSpan={4} className="py-6 text-center text-muted-foreground">Nenhum resgate no período.</td></tr>
            )}
            {linhas.map((l, i) => (
              <tr key={i} className="border-b border-border/50">
                <td className="py-2 pr-3 font-mono text-xs">{dh(l.data)}</td>
                <td className="py-2 pr-3 font-mono">{l.cliente}</td>
                <td className="py-2 pr-3">{l.item}</td>
                <td className="py-2 font-semibold">{l.detalhe}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

// Barras simples (por dia/hora) reutilizadas.
function BarChart({ pontos, label }: { pontos: { k: string; v: number; t: string }[]; label: string }) {
  const mx = Math.max(1, ...pontos.map((p) => p.v));
  return (
    <Card className="p-4">
      <h2 className="mb-3 font-display text-sm font-bold">{label}</h2>
      {pontos.length === 0 ? (
        <p className="text-sm text-muted-foreground">Sem dados no período.</p>
      ) : (
        <div className="flex items-end gap-1" style={{ height: 120 }}>
          {pontos.map((p) => (
            <div key={p.k} className="flex flex-1 flex-col items-center justify-end" title={p.t}>
              <div className="w-full rounded-t bg-primary" style={{ height: `${(p.v / mx) * 100}%` }} />
              <span className="mt-1 text-[9px] text-muted-foreground">{p.k}</span>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

// Detalhe de um canal (balcão ou delivery): KPIs + por dia + por hora + mais
// vendidos (+ região e plataforma no delivery).
function DetalheCanal({ data, nome, delivery }: { data: any; nome: string; delivery?: boolean }) {
  if (!data) return <p className="text-sm text-muted-foreground">Carregando…</p>;
  const vf = data.verFinanceiro !== false; // gerente: sem valores em R$
  const kpis = vf
    ? [
        { l: 'Faturado', v: rs(data.resumo.faturado) },
        { l: 'Vendas', v: data.resumo.vendas },
        { l: 'Ticket médio', v: rs(data.resumo.ticketMedio) },
      ]
    : [{ l: 'Vendas', v: data.resumo.vendas }];
  return (
    <div className="space-y-4">
      <div className={`grid gap-3 ${vf ? 'grid-cols-1 sm:grid-cols-3' : 'grid-cols-1'}`}>
        {kpis.map((k) => (
          <Card key={k.l} className="p-4">
            <p className="text-xs text-muted-foreground">{k.l}</p>
            <p className="mt-1 font-mono text-xl font-bold">{k.v}</p>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <BarChart
          label={vf ? 'Vendas por dia (R$)' : 'Vendas por dia'}
          pontos={data.porDia.map((d: any) => ({ k: String(d.dia).slice(5), v: vf ? d.total : d.qtd, t: `${d.dia} · ${vf ? brl(d.total) + ' · ' : ''}${d.qtd} vendas` }))}
        />
        <BarChart
          label="Vendas por hora"
          pontos={data.porHora.map((h: any) => ({ k: String(h.hora), v: h.qtd, t: `${h.hora}h · ${h.qtd} vendas` }))}
        />
      </div>

      {delivery && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Card className="p-4">
            <h2 className="mb-3 font-display text-sm font-bold">Por plataforma</h2>
            {data.porPlataforma.length === 0 && <p className="text-sm text-muted-foreground">Sem pedidos.</p>}
            {data.porPlataforma.map((p: any) => (
              <div key={p.plataforma} className="flex items-center gap-2 border-b border-border/50 py-1.5 text-sm last:border-0">
                <span className="min-w-0 flex-1 truncate capitalize">{p.plataforma}</span>
                <span className="w-12 text-right text-xs text-muted-foreground">{p.qtd}</span>
                <span className="w-24 text-right font-mono">{rs(p.total)}</span>
              </div>
            ))}
          </Card>
          <Card className="p-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-display text-sm font-bold">Por região (bairro)</h2>
              {data.porRegiao.length > 0 && (
                <Button type="button" variant="outline" size="sm" onClick={() => baixarCsv('delivery-regiao', data.porRegiao)}>CSV</Button>
              )}
            </div>
            {data.porRegiao.length === 0 && <p className="text-sm text-muted-foreground">Sem entregas com bairro.</p>}
            {data.porRegiao.map((r: any) => (
              <div key={r.regiao} className="flex items-center gap-2 border-b border-border/50 py-1.5 text-sm last:border-0">
                <span className="min-w-0 flex-1 truncate">{r.regiao}</span>
                <span className="w-12 text-right text-xs text-muted-foreground">{r.qtd}</span>
                <span className="w-24 text-right font-mono">{rs(r.total)}</span>
              </div>
            ))}
          </Card>
        </div>
      )}

      <Card className="p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-display text-sm font-bold">Mais vendidos</h2>
          {data.maisVendidos.length > 0 && (
            <Button type="button" variant="outline" size="sm" onClick={() => baixarCsv(`mais-vendidos-${nome}`, data.maisVendidos)}>Exportar CSV</Button>
          )}
        </div>
        {data.maisVendidos.length === 0 && <p className="text-sm text-muted-foreground">Sem vendas no período.</p>}
        <div className="space-y-1">
          {data.maisVendidos.map((p: any, i: number) => (
            <div key={i} className="flex items-center gap-2 border-b border-border/50 py-1.5 text-sm last:border-0">
              <span className="w-5 text-center text-xs text-muted-foreground">{i + 1}</span>
              <span className="min-w-0 flex-1 truncate">{p.descricao}</span>
              <span className="w-12 text-right text-xs text-muted-foreground">{p.qtd}x</span>
              <span className="w-24 text-right font-mono">{rs(p.faturamento)}</span>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

// Ranking global de produtos (balcão + delivery), com a quebra por canal.
function RankingGlobal({ data }: { data: any }) {
  if (!data) return null;
  return (
    <Card className="p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-display text-sm font-bold">Ranking global de produtos (balcão + delivery)</h2>
        {data.itens.length > 0 && (
          <Button type="button" variant="outline" size="sm" onClick={() => baixarCsv('ranking-global', data.itens)}>Exportar CSV</Button>
        )}
      </div>
      {data.itens.length === 0 && <p className="text-sm text-muted-foreground">Sem vendas no período.</p>}
      <div className="space-y-1">
        {data.itens.map((p: any, i: number) => (
          <div key={i} className="flex items-center gap-2 border-b border-border/50 py-1.5 text-sm last:border-0">
            <span className="w-5 text-center text-xs text-muted-foreground">{i + 1}</span>
            <span className="min-w-0 flex-1 truncate">{p.descricao}</span>
            <span className="w-24 text-right text-[11px] text-muted-foreground">🏠 {p.qtdBalcao} · 🛵 {p.qtdDelivery}</span>
            <span className="w-10 text-right text-xs font-bold">{p.qtd}x</span>
            <span className="w-24 text-right font-mono">{rs(p.faturamento)}</span>
          </div>
        ))}
      </div>
    </Card>
  );
}

// Data/hora curta.
function dt(iso?: string) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

// Turnos/Caixa: lista de sessões + cupom de fechamento (detalhe ao expandir).
function TurnosView({ data }: { data: any }) {
  const [sel, setSel] = useState<string | null>(null);
  const [det, setDet] = useState<any>(null);
  async function abrir(id: string) {
    if (sel === id) { setSel(null); setDet(null); return; }
    setSel(id);
    setDet(null);
    try { setDet(await api.relatorioTurnoDetalhe(id)); } catch { /* */ }
  }
  if (!data) return <p className="text-sm text-muted-foreground">Carregando…</p>;
  return (
    <div className="space-y-2">
      {data.turnos.length === 0 && (
        <Card className="p-8 text-center text-sm text-muted-foreground">Nenhum turno no período.</Card>
      )}
      {data.turnos.map((t: any) => (
        <Card key={t.id} className="p-0">
          <button type="button" onClick={() => abrir(t.id)} className="flex w-full flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-left hover:bg-primary/5">
            <span className="rounded bg-secondary px-1.5 py-0.5 text-[11px] uppercase text-muted-foreground">{t.origem}</span>
            <span className="min-w-0 flex-1 truncate text-sm font-medium">
              {t.abertaPor ?? '—'} · {dt(t.abertaEm)} {t.fechadaEm ? `→ ${dt(t.fechadaEm)}` : '· (aberto)'}
            </span>
            <span className="font-mono text-sm">{rs(t.vendas)}</span>
            {t.diferenca != null && (
              <span
                className="w-24 text-right font-mono text-xs font-bold"
                style={{ color: t.diferenca < 0 ? 'hsl(var(--destructive))' : t.diferenca > 0 ? 'hsl(var(--warn))' : 'hsl(var(--ok))' }}
              >
                dif {rs(t.diferenca)}
              </span>
            )}
          </button>

          {sel === t.id && (
            <div className="border-t border-border p-4 text-sm">
              {!det ? (
                <p className="text-muted-foreground">Carregando cupom…</p>
              ) : (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <p className="font-display font-bold">Cupom de fechamento de turno</p>
                    <Button type="button" variant="outline" size="sm" onClick={() => baixarCsv(`turno-formas-${t.id.slice(0, 6)}`, det.porForma)}>CSV</Button>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
                    <div><p className="text-muted-foreground">Abertura</p><p className="font-mono font-bold">{rs(det.sessao.abertura)}</p></div>
                    <div><p className="text-muted-foreground">Esperado</p><p className="font-mono font-bold">{rs(det.sessao.esperado)}</p></div>
                    <div><p className="text-muted-foreground">Informado</p><p className="font-mono font-bold">{rs(det.sessao.informado)}</p></div>
                    <div><p className="text-muted-foreground">Diferença</p><p className="font-mono font-bold" style={{ color: (det.sessao.diferenca ?? 0) < 0 ? 'hsl(var(--destructive))' : undefined }}>{rs(det.sessao.diferenca)}</p></div>
                  </div>
                  <div>
                    <p className="mb-1 text-xs font-bold text-muted-foreground">Vendas por forma</p>
                    {det.porForma.length === 0 && <p className="text-xs text-muted-foreground">Sem vendas.</p>}
                    {det.porForma.map((p: any) => (
                      <div key={p.forma} className="flex items-center gap-2 border-b border-border/50 py-1 last:border-0">
                        <span className="min-w-0 flex-1 truncate capitalize">{p.forma}</span>
                        <span className="w-10 text-right text-xs text-muted-foreground">{p.qtd}</span>
                        <span className="w-24 text-right font-mono">{rs(p.total)}</span>
                      </div>
                    ))}
                  </div>
                  {det.movimentos.length > 0 && (
                    <div>
                      <p className="mb-1 text-xs font-bold text-muted-foreground">Sangrias / suprimentos</p>
                      {det.movimentos.map((m: any, i: number) => (
                        <div key={i} className="flex items-center gap-2 border-b border-border/50 py-1 text-xs last:border-0">
                          <span className={`rounded px-1.5 py-0.5 font-bold ${m.categoria === 'sangria' ? 'bg-destructive/10 text-destructive' : 'bg-ok/10 text-ok'}`}>{m.categoria}</span>
                          <span className="min-w-0 flex-1 truncate text-muted-foreground">{m.descricao ?? '—'}</span>
                          <span className="font-mono">{rs(m.valor)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  <p className="text-[11px] text-muted-foreground">Operador: abriu {det.sessao.abertaPor ?? '—'} · fechou {det.sessao.fechadaPor ?? '—'}</p>
                </div>
              )}
            </div>
          )}
        </Card>
      ))}
    </div>
  );
}

// Produção de fichas (§1.2): quanto de cada produto foi produzido no período,
// agrupável por dia/semana/mês. Fonte = eventos auditados `produziu_ficha`.
function ProducaoView({
  data,
  agrup,
  setAgrup,
}: {
  data: any;
  agrup: 'dia' | 'semana' | 'mes';
  setAgrup: (v: 'dia' | 'semana' | 'mes') => void;
}) {
  const periodoLabel = (p: string) =>
    agrup === 'mes' ? mesLabel(p) : String(p).slice(5);
  const vf = data?.verFinanceiro !== false; // gerente não vê custo
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          {([
            { v: 'dia', l: 'Dia' },
            { v: 'semana', l: 'Semana' },
            { v: 'mes', l: 'Mês' },
          ] as const).map((o) => (
            <button
              key={o.v}
              type="button"
              onClick={() => setAgrup(o.v)}
              className={`rounded-md border px-2.5 py-1 text-xs font-medium ${agrup === o.v ? 'border-primary bg-primary/15 text-primary' : 'border-border text-muted-foreground'}`}
            >
              {o.l}
            </button>
          ))}
        </div>
        {data?.porProduto?.length > 0 && (
          <Button type="button" variant="outline" size="sm" onClick={() => baixarCsv('producao-produto', data.porProduto.map((p: any) => ({ produto: p.nome, producoes: p.producoes, quantidade: p.qtd, custo: p.custo })))}>
            Exportar CSV
          </Button>
        )}
      </div>

      {!data ? (
        <p className="text-sm text-muted-foreground">Carregando…</p>
      ) : (
        <>
          <div className={`grid gap-3 ${vf ? 'grid-cols-2 sm:grid-cols-3' : 'grid-cols-2'}`}>
            {[
              { l: 'Produções', v: data.resumo.producoes },
              { l: 'Unidades produzidas', v: data.resumo.qtd },
              ...(vf ? [{ l: 'Custo teórico', v: rs(data.resumo.custo) }] : []),
            ].map((k) => (
              <Card key={k.l} className="p-4">
                <p className="text-xs text-muted-foreground">{k.l}</p>
                <p className="mt-1 font-mono text-xl font-bold">{k.v}</p>
              </Card>
            ))}
          </div>

          <BarChart
            label={`Produção por ${agrup === 'mes' ? 'mês' : agrup}`}
            pontos={(data.porPeriodo ?? []).map((d: any) => ({
              k: periodoLabel(d.periodo),
              v: d.qtd,
              t: `${d.periodo} · ${d.qtd} un · ${vf ? brl(d.custo) + ' · ' : ''}${d.producoes} produções`,
            }))}
          />

          <Card className="p-4">
            <h2 className="mb-3 font-display text-sm font-bold">Produção por produto (mais → menos)</h2>
            {(data.porProduto ?? []).length === 0 && <p className="text-sm text-muted-foreground">Nenhuma produção no período.</p>}
            <div className="space-y-1">
              {(data.porProduto ?? []).map((p: any, i: number) => (
                <div key={p.fichaId ?? i} className="flex items-center gap-2 border-b border-border/50 py-1.5 text-sm last:border-0">
                  <span className="w-5 text-center text-xs text-muted-foreground">{i + 1}</span>
                  <span className="min-w-0 flex-1 truncate">{p.nome}</span>
                  <span className="w-16 text-right text-xs text-muted-foreground">{p.producoes}×</span>
                  <span className="w-16 text-right font-mono text-xs font-bold">{p.qtd} un</span>
                  {vf && <span className="w-24 text-right font-mono">{rs(p.custo)}</span>}
                </div>
              ))}
            </div>
          </Card>
        </>
      )}
    </div>
  );
}

// Estoque: posição por produto + giro (mais → menos giram). Reaproveita a
// "inteligência" de estoque (saldo, valor, consumo no período, cobertura).
function CaixaOpsView({ data }: { data: any }) {
  if (!data) return <p className="text-sm text-muted-foreground">Carregando…</p>;
  return (
    <div className="space-y-4">
      {/* Cancelamentos por operador */}
      <Card className="p-0">
        <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
          <h3 className="text-sm font-semibold">Cancelamentos</h3>
          <span className="text-xs text-muted-foreground">
            {data.cancelamentosTotal.qtd} cancelamento(s) · {rs(data.cancelamentosTotal.valor)}
          </span>
        </div>
        {data.cancelamentos.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-muted-foreground">Nenhum cancelamento no período.</p>
        ) : (
          <div className="overflow-x-auto"><table className="w-full min-w-[420px] text-sm">
            <caption className="sr-only">Cancelamentos por operador</caption>
            <thead>
              <tr className="text-left text-xs uppercase text-muted-foreground">
                <th className="px-4 py-2 font-medium">Operador</th>
                <th className="px-4 py-2 text-right font-medium">Qtd</th>
                <th className="px-4 py-2 text-right font-medium">Valor</th>
              </tr>
            </thead>
            <tbody>
              {data.cancelamentos.map((r: any, i: number) => (
                <tr key={i} className="border-t border-border">
                  <td className="px-4 py-2">{r.operador}</td>
                  <td className="px-4 py-2 text-right font-mono">{r.qtd}</td>
                  <td className="px-4 py-2 text-right font-mono">{rs(r.valor)}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
      </Card>

      {/* Sangrias e suprimentos por operador */}
      <Card className="p-0">
        <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
          <h3 className="text-sm font-semibold">Sangrias e suprimentos</h3>
          <span className="text-xs text-muted-foreground">
            sangrias {rs(data.movimentosTotal.sangrias)} · suprimentos {rs(data.movimentosTotal.suprimentos)}
          </span>
        </div>
        {data.movimentos.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-muted-foreground">Nenhuma sangria/suprimento no período.</p>
        ) : (
          <div className="overflow-x-auto"><table className="w-full min-w-[420px] text-sm">
            <caption className="sr-only">Sangrias e suprimentos por operador</caption>
            <thead>
              <tr className="text-left text-xs uppercase text-muted-foreground">
                <th className="px-4 py-2 font-medium">Operador</th>
                <th className="px-4 py-2 text-right font-medium">Sangrias</th>
                <th className="px-4 py-2 text-right font-medium">Suprimentos</th>
              </tr>
            </thead>
            <tbody>
              {data.movimentos.map((r: any, i: number) => (
                <tr key={i} className="border-t border-border">
                  <td className="px-4 py-2">{r.operador}</td>
                  <td className="px-4 py-2 text-right font-mono">{rs(r.sangrias)} <span className="text-xs text-muted-foreground">({r.qtdSangrias})</span></td>
                  <td className="px-4 py-2 text-right font-mono">{rs(r.suprimentos)} <span className="text-xs text-muted-foreground">({r.qtdSuprimentos})</span></td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
      </Card>
    </div>
  );
}

function EstoqueView({ data }: { data: any }) {
  const [ordem, setOrdem] = useState<'mais' | 'menos'>('mais');
  const verFin = podeFinanceiro(); // valor do estoque (R$) só p/ presidente
  if (!data) return <p className="text-sm text-muted-foreground">Carregando…</p>;
  const itens = [...(data.itens ?? [])].sort((a, b) =>
    ordem === 'mais' ? b.consumoDiario - a.consumoDiario : a.consumoDiario - b.consumoDiario,
  );
  return (
    <div className="space-y-4">
      <div className={`grid gap-3 grid-cols-2 ${verFin ? 'sm:grid-cols-4' : ''}`}>
        {[
          ...(verFin ? [{ l: 'Valor em estoque', v: brl(data.resumo?.valorEstoque ?? 0) }] : []),
          ...(verFin ? [{ l: 'Consumido no período', v: brl(data.resumo?.valorConsumido ?? 0) }] : []),
          { l: 'Abaixo do mínimo', v: data.resumo?.itensAbaixoMinimo ?? 0 },
          { l: 'A repor', v: data.resumo?.itensRepor ?? 0 },
        ].map((k) => (
          <Card key={k.l} className="p-4">
            <p className="text-xs text-muted-foreground">{k.l}</p>
            <p className="mt-1 font-mono text-xl font-bold">{k.v}</p>
          </Card>
        ))}
      </div>

      <Card className="p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="font-display text-sm font-bold">Posição e giro por produto</h2>
            <p className="text-xs text-muted-foreground">Ordenado por giro (consumo/dia) no período.</p>
          </div>
          <div className="flex items-center gap-1.5">
            {(['mais', 'menos'] as const).map((o) => (
              <button
                key={o}
                type="button"
                onClick={() => setOrdem(o)}
                className={`rounded-md border px-2.5 py-1 text-xs font-medium ${ordem === o ? 'border-primary bg-primary/15 text-primary' : 'border-border text-muted-foreground'}`}
              >
                {o === 'mais' ? 'Mais giram' : 'Menos giram'}
              </button>
            ))}
            {itens.length > 0 && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  baixarCsv('estoque-giro', itens.map((i: any) => ({
                    produto: i.nome,
                    saldo: i.saldo,
                    unidade: i.unidadeMedida,
                    ...(verFin ? { valorEstoque: Number(i.valorEstoque.toFixed(2)) } : {}),
                    consumoDia: i.consumoDiario,
                    ...(verFin ? { valorConsumido: Number(i.valorConsumido.toFixed(2)) } : {}),
                    diasCobertura: i.diasCobertura ?? '',
                    abc: i.classeAbc ?? '',
                  })))
                }
              >
                Exportar CSV
              </Button>
            )}
          </div>
        </div>
        {itens.length === 0 && <p className="text-sm text-muted-foreground">Nenhum insumo cadastrado.</p>}
        <div className="space-y-1">
          {itens.map((i: any) => (
            <div key={i.id} className="flex items-center gap-2 border-b border-border/50 py-1.5 text-sm last:border-0">
              <span className="min-w-0 flex-1 truncate">
                {i.nome}
                {i.abaixoMinimo && <span className="ml-1.5 rounded bg-destructive/10 px-1 py-0.5 text-[10px] font-bold text-destructive">baixo</span>}
              </span>
              <span className="w-20 text-right text-xs text-muted-foreground">{i.saldo} {i.unidadeMedida}</span>
              {verFin && <span className="w-24 text-right font-mono text-xs">{brl(i.valorEstoque)}</span>}
              <span className="w-24 text-right text-xs text-muted-foreground" title="Consumo por dia">{i.consumoDiario}/dia</span>
              <span className="w-16 text-right text-xs text-muted-foreground" title="Dias de cobertura">{i.diasCobertura != null ? `${i.diasCobertura}d` : '—'}</span>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
