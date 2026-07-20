'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Shell } from '@/components/app-shell/shell';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { api } from '@/lib/api';
import { toast } from '@/lib/toast';
import { selectCls } from '@/components/produtos/types';

/* eslint-disable @typescript-eslint/no-explicit-any */

const STATUS_LABEL: Record<string, string> = {
  planejada: 'Planejada', liberada: 'Liberada', em_producao: 'Em produção',
  concluida_total: 'Concluída (total)', concluida_parcial: 'Concluída (parcial)',
  nao_concluida: 'Não concluída', aguardando_lancamento: 'Aguardando lançamento',
  pendencia_critica: 'Pendência crítica', cancelada: 'Cancelada',
};
const STATUS_COR: Record<string, string> = {
  planejada: 'bg-secondary text-muted-foreground', liberada: 'bg-primary/15 text-primary',
  em_producao: 'bg-blue-500/15 text-blue-600', concluida_total: 'bg-ok/15 text-ok',
  concluida_parcial: 'bg-amber-500/15 text-amber-600', nao_concluida: 'bg-muted text-muted-foreground',
  aguardando_lancamento: 'bg-amber-500/15 text-amber-700', pendencia_critica: 'bg-destructive/15 text-destructive',
  cancelada: 'bg-muted text-muted-foreground line-through',
};

export default function OrdensProducaoPage() {
  const [ordens, setOrdens] = useState<any[]>([]);
  const [fichas, setFichas] = useState<any[]>([]);
  const [setores, setSetores] = useState<any[]>([]);
  const [itens, setItens] = useState<any[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [aba, setAba] = useState<'quadro' | 'pendencias' | 'relatorio'>('quadro');
  const [novo, setNovo] = useState(false);
  const [concluir, setConcluir] = useState<any>(null);
  const [relatorio, setRelatorio] = useState<any>(null);

  const carregar = useCallback(async () => {
    setCarregando(true);
    try {
      const [o, f, s, i]: any = await Promise.all([
        api.ordensProducao(), api.fichasLista(), api.setores(), api.estoqueItens(),
      ]);
      setOrdens(Array.isArray(o) ? o : []);
      setFichas(Array.isArray(f) ? f : []);
      setSetores(Array.isArray(s) ? s : []);
      setItens(Array.isArray(i) ? i : []);
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Erro ao carregar'); }
    finally { setCarregando(false); }
  }, []);
  useEffect(() => { carregar(); }, [carregar]);

  const pendencias = useMemo(
    () => ordens.filter((o) => ['aguardando_lancamento', 'pendencia_critica'].includes(o.status)),
    [ordens],
  );
  const colunas: [string, string[]][] = [
    ['A fazer', ['planejada', 'liberada']],
    ['Em produção', ['em_producao']],
    ['Encerradas', ['concluida_total', 'concluida_parcial', 'nao_concluida', 'cancelada']],
  ];

  async function acao(fn: Promise<any>, msg: string) {
    try { await fn; toast.success(msg); await carregar(); }
    catch (e) { toast.error(e instanceof Error ? e.message : 'Erro'); }
  }
  async function verRelatorio() {
    const ate = new Date().toISOString().slice(0, 10);
    const de = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
    try { setRelatorio(await api.ordensRelatorio(de, ate)); } catch (e) { toast.error(e instanceof Error ? e.message : 'Erro'); }
  }

  return (
    <Shell eyebrow="Produção" title="Ordens de produção">
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex gap-1.5">
            {(['quadro', 'pendencias', 'relatorio'] as const).map((a) => (
              <button
                key={a}
                type="button"
                aria-pressed={aba === a}
                onClick={() => { setAba(a); if (a === 'relatorio') verRelatorio(); }}
                className={`rounded-md border px-3 py-1.5 text-sm font-medium ${aba === a ? 'border-primary bg-primary/15 text-primary' : 'border-border text-muted-foreground'}`}
              >
                {a === 'quadro' ? 'Quadro' : a === 'pendencias' ? `Pendências${pendencias.length ? ` (${pendencias.length})` : ''}` : 'Relatório'}
              </button>
            ))}
          </div>
          <Button type="button" size="sm" className="ml-auto" onClick={() => setNovo(true)}>+ Nova ordem</Button>
        </div>

        {carregando && <p className="text-sm text-muted-foreground">Carregando…</p>}

        {/* QUADRO (também serve de KDS de produção interna) */}
        {aba === 'quadro' && !carregando && (
          <div className="grid gap-3 lg:grid-cols-3">
            {colunas.map(([titulo, sts]) => {
              const lista = ordens.filter((o) => sts.includes(o.status));
              return (
                <Card key={titulo} className="p-3">
                  <h2 className="mb-2 font-display text-sm font-semibold">{titulo} ({lista.length})</h2>
                  <div className="space-y-2">
                    {!lista.length && <p className="text-xs text-muted-foreground">—</p>}
                    {lista.map((o) => <OrdemCard key={o.id} o={o} onAcao={acao} onConcluir={() => setConcluir(o)} />)}
                  </div>
                </Card>
              );
            })}
          </div>
        )}

        {/* PENDÊNCIAS (gerente/C&O) */}
        {aba === 'pendencias' && !carregando && (
          <Card className="p-3">
            <p className="mb-2 text-sm text-muted-foreground">
              Ordens que saíram impressas e ainda não foram lançadas. Após 1 dia da data prevista viram <strong>pendência crítica</strong> e exigem desfecho (lançar ou cancelar).
            </p>
            <div className="space-y-2">
              {!pendencias.length && <p className="text-sm text-muted-foreground">Nenhuma pendência 🎉</p>}
              {pendencias.map((o) => <OrdemCard key={o.id} o={o} onAcao={acao} onConcluir={() => setConcluir(o)} destaque />)}
            </div>
          </Card>
        )}

        {/* RELATÓRIO planejado × produzido */}
        {aba === 'relatorio' && (
          <Card className="p-3">
            {!relatorio ? <p className="text-sm text-muted-foreground">Carregando…</p> : (
              <>
                <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <Kpi t="Ordens" v={relatorio.resumo.ordens} />
                  <Kpi t="Planejado" v={relatorio.resumo.planejadoTotal} />
                  <Kpi t="Produzido" v={relatorio.resumo.produzidoTotal} />
                  <Kpi t="Aderência" v={relatorio.resumo.aderenciaMedia != null ? relatorio.resumo.aderenciaMedia + '%' : '—'} />
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[520px] text-sm">
                    <thead><tr className="border-b border-border text-left text-xs text-muted-foreground">
                      <th className="py-1.5 pr-2 font-medium">Ficha</th><th className="py-1.5 pr-2 font-medium">Data</th>
                      <th className="py-1.5 pr-2 font-medium">Planejado</th><th className="py-1.5 pr-2 font-medium">Produzido</th>
                      <th className="py-1.5 font-medium">Quebra</th></tr></thead>
                    <tbody>
                      {relatorio.itens.map((r: any) => (
                        <tr key={r.id} className="border-b border-border/60">
                          <td className="py-1.5 pr-2">{r.fichaNome}</td>
                          <td className="py-1.5 pr-2 text-muted-foreground">{r.dataProducao}</td>
                          <td className="py-1.5 pr-2 tabular-nums">{r.planejada} {r.unidade}</td>
                          <td className="py-1.5 pr-2 tabular-nums">{r.produzida} {r.unidade}</td>
                          <td className={`py-1.5 tabular-nums ${r.quebra > 0 ? 'text-destructive' : 'text-ok'}`}>{r.quebra > 0 ? '-' + r.quebra : '0'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </Card>
        )}
      </div>

      {novo && <NovaOrdem fichas={fichas} setores={setores} itens={itens} onClose={() => setNovo(false)} onSaved={() => { setNovo(false); carregar(); }} />}
      {concluir && <ConcluirOrdem o={concluir} onClose={() => setConcluir(null)} onSaved={() => { setConcluir(null); carregar(); }} />}
    </Shell>
  );
}

function Kpi({ t, v }: { t: string; v: any }) {
  return <div className="rounded-lg border border-border p-2"><p className="text-[11px] text-muted-foreground">{t}</p><p className="font-mono text-lg font-semibold">{v}</p></div>;
}

function OrdemCard({ o, onAcao, onConcluir, destaque }: any) {
  return (
    <div className={`rounded-lg border p-2.5 text-sm ${destaque && o.status === 'pendencia_critica' ? 'border-destructive/50 bg-destructive/5' : 'border-border'}`}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-medium">{o.fichaNome ?? 'Ficha'}</p>
          <p className="text-xs text-muted-foreground">
            {o.quantidadePlanejada} {o.unidade} · {o.dataProducao}{o.horaInicio ? ` ${String(o.horaInicio).slice(0, 5)}` : ''}
            {o.setorNome ? ` · ${o.setorNome}` : ''}{o.colaboradorNome ? ` · ${o.colaboradorNome}` : ''}
          </p>
        </div>
        <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold ${STATUS_COR[o.status] ?? 'bg-secondary'}`}>{STATUS_LABEL[o.status] ?? o.status}</span>
      </div>
      {o.status === 'concluida_parcial' && <p className="mt-1 text-xs text-amber-600">Rendeu {o.quantidadeProduzida} de {o.quantidadePlanejada}</p>}
      {o.motivo && <p className="mt-1 text-xs text-muted-foreground">Motivo: {o.motivo}</p>}
      <div className="mt-2 flex flex-wrap gap-1.5">
        {o.status === 'planejada' && <Button type="button" size="sm" variant="outline" onClick={() => onAcao(api.liberarOrdem(o.id), 'Ordem liberada.')}>Liberar</Button>}
        {['planejada', 'liberada'].includes(o.status) && <Button type="button" size="sm" variant="outline" onClick={() => onAcao(api.iniciarOrdem(o.id), 'Produção iniciada.')}>Iniciar</Button>}
        {['liberada', 'em_producao', 'aguardando_lancamento', 'pendencia_critica'].includes(o.status) && <Button type="button" size="sm" onClick={onConcluir}>Concluir / lançar</Button>}
        {!['cancelada'].includes(o.status) && !o.status.startsWith('conclu') && (
          <Button type="button" size="sm" variant="ghost" className="text-destructive" onClick={() => { const m = prompt('Motivo do cancelamento:'); if (m != null) onAcao(api.cancelarOrdem(o.id, m), 'Ordem cancelada.'); }}>Cancelar</Button>
        )}
      </div>
    </div>
  );
}

function ConcluirOrdem({ o, onClose, onSaved }: any) {
  const [tipo, setTipo] = useState<'total' | 'parcial' | 'nao'>('total');
  const [qtd, setQtd] = useState('');
  const [pin, setPin] = useState('');
  const [motivo, setMotivo] = useState('');
  const [busy, setBusy] = useState(false);

  async function salvar(viaImpressa = false) {
    setBusy(true);
    try {
      const r: any = await api.concluirOrdem(o.id, {
        tipo, quantidadeProduzida: tipo === 'parcial' ? Number(qtd) : undefined,
        pin, motivo, viaImpressa,
      });
      toast.success(viaImpressa ? 'Ordem marcada para lançamento.' : 'Conclusão registrada.' + (r?.estoque ? ` ${r.estoque.insumosBaixados} insumo(s) baixado(s).` : ''));
      onSaved();
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Erro ao concluir'); }
    finally { setBusy(false); }
  }

  return (
    <div className="fixed inset-0 z-[60] grid place-items-center bg-black/50 p-4" onClick={onClose}>
      <Card className="w-full max-w-md space-y-3 p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2">
          <h3 className="font-display text-base font-bold">Concluir: {o.fichaNome}</h3>
          <button type="button" onClick={onClose} className="ml-auto text-sm text-muted-foreground hover:underline">Fechar ✕</button>
        </div>
        <p className="text-xs text-muted-foreground">Planejado: {o.quantidadePlanejada} {o.unidade}</p>
        <div className="flex gap-1.5">
          {(['total', 'parcial', 'nao'] as const).map((t) => (
            <button key={t} type="button" aria-pressed={tipo === t} onClick={() => setTipo(t)}
              className={`flex-1 rounded-md border px-2 py-1.5 text-xs font-medium ${tipo === t ? 'border-primary bg-primary/15 text-primary' : 'border-border text-muted-foreground'}`}>
              {t === 'total' ? 'Total' : t === 'parcial' ? 'Parcial' : 'Não concluída'}
            </button>
          ))}
        </div>
        {tipo === 'parcial' && (
          <div className="space-y-1"><Label className="text-xs">Quantidade produzida (menor que {o.quantidadePlanejada})</Label>
            <Input type="number" value={qtd} onChange={(e) => setQtd(e.target.value)} placeholder="ex.: 8" /></div>
        )}
        {tipo === 'nao' && (
          <div className="space-y-1"><Label className="text-xs">Motivo</Label>
            <Input value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="por que não foi produzido?" /></div>
        )}
        {tipo !== 'nao' && (
          <div className="rounded-lg bg-secondary/50 p-2 text-xs text-muted-foreground">
            {tipo === 'total' ? 'Total' : 'Parcial'} dará baixa nos insumos e entrada do produzido no estoque.
          </div>
        )}
        <div className="space-y-1"><Label className="text-xs">PIN (assinatura de quem produziu)</Label>
          <Input type="password" inputMode="numeric" value={pin} onChange={(e) => setPin(e.target.value)} placeholder="PIN do colaborador" /></div>
        <div className="flex gap-2">
          <Button type="button" variant="outline" className="flex-1" disabled={busy} onClick={() => salvar(true)}>Só imprimir p/ lançar depois</Button>
          <Button type="button" className="flex-1" disabled={busy} onClick={() => salvar(false)}>Confirmar com PIN</Button>
        </div>
      </Card>
    </div>
  );
}

function NovaOrdem({ fichas, setores, itens, onClose, onSaved }: any) {
  const hoje = new Date().toISOString().slice(0, 10);
  const [f, setF] = useState<any>({
    fichaId: '', itemSaidaId: '', quantidadePlanejada: '1', unidade: 'un',
    dataProducao: hoje, horaInicio: '', setorId: '', canais: ['linha_tempo'] as string[],
    recorrente: false, liberar: true,
  });
  const up = (p: any) => setF((s: any) => ({ ...s, ...p }));
  const [busy, setBusy] = useState(false);
  const ficha = fichas.find((x: any) => x.id === f.fichaId);
  const toggleCanal = (c: string) => up({ canais: f.canais.includes(c) ? f.canais.filter((x: string) => x !== c) : [...f.canais, c] });

  async function salvar() {
    if (!f.fichaId) return toast.error('Escolha a ficha.');
    if (!(Number(f.quantidadePlanejada) > 0)) return toast.error('Informe a quantidade.');
    setBusy(true);
    try {
      const body = {
        fichaId: f.fichaId, itemSaidaId: f.itemSaidaId || undefined,
        quantidadePlanejada: Number(f.quantidadePlanejada), unidade: f.unidade,
        dataProducao: f.dataProducao, horaInicio: f.horaInicio || undefined,
        setorId: f.setorId || undefined, canais: f.canais, liberar: f.liberar,
        titulo: ficha?.nome,
      };
      if (f.recorrente) await api.ordemRecorrencia(body as any);
      else await api.criarOrdemProducao(body as any);
      toast.success(f.recorrente ? 'Ordem recorrente criada.' : 'Ordem criada.');
      onSaved();
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Erro ao salvar'); }
    finally { setBusy(false); }
  }

  return (
    <div className="fixed inset-0 z-[60] grid place-items-center bg-black/50 p-4" onClick={onClose}>
      <Card className="max-h-[88vh] w-full max-w-md space-y-3 overflow-y-auto p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2">
          <h3 className="font-display text-base font-bold">Nova ordem de produção</h3>
          <button type="button" onClick={onClose} className="ml-auto text-sm text-muted-foreground hover:underline">Fechar ✕</button>
        </div>
        <div className="space-y-1"><Label className="text-xs">Ficha técnica *</Label>
          <select className={selectCls} value={f.fichaId} onChange={(e) => up({ fichaId: e.target.value })}>
            <option value="">— escolha —</option>
            {fichas.map((x: any) => <option key={x.id} value={x.id}>{x.nome}</option>)}
          </select>
          {ficha?.porcaoTamanho && <p className="text-[11px] text-muted-foreground">1 ficha rende {Math.round(Number(ficha.rendimento) / Number(ficha.porcaoTamanho))} porções.</p>}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <div className="space-y-1"><Label className="text-xs">Quantidade *</Label><Input type="number" value={f.quantidadePlanejada} onChange={(e) => up({ quantidadePlanejada: e.target.value })} /></div>
          <div className="space-y-1"><Label className="text-xs">Unidade</Label><Input value={f.unidade} onChange={(e) => up({ unidade: e.target.value })} placeholder="un / porção / kg" /></div>
        </div>
        <div className="space-y-1"><Label className="text-xs">Insumo de saída (entra no estoque)</Label>
          <select className={selectCls} value={f.itemSaidaId} onChange={(e) => up({ itemSaidaId: e.target.value })}>
            <option value="">— nenhum (só baixa insumos) —</option>
            {itens.map((x: any) => <option key={x.id} value={x.id}>{x.nome}</option>)}
          </select>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <div className="space-y-1"><Label className="text-xs">Data</Label><Input type="date" value={f.dataProducao} onChange={(e) => up({ dataProducao: e.target.value })} /></div>
          <div className="space-y-1"><Label className="text-xs">Hora início</Label><Input type="time" value={f.horaInicio} onChange={(e) => up({ horaInicio: e.target.value })} /></div>
        </div>
        <div className="space-y-1"><Label className="text-xs">Setor responsável</Label>
          <select className={selectCls} value={f.setorId} onChange={(e) => up({ setorId: e.target.value })}>
            <option value="">— sem setor —</option>
            {setores.map((s: any) => <option key={s.id} value={s.id}>{s.nome}</option>)}
          </select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Onde avisar</Label>
          <div className="flex flex-wrap gap-1.5">
            {[['app', 'App do colaborador'], ['kds', 'KDS/Quadro'], ['linha_tempo', 'Linha do tempo'], ['impressao', 'Impressão']].map(([c, l]) => (
              <button key={c} type="button" aria-pressed={f.canais.includes(c)} onClick={() => toggleCanal(c)}
                className={`rounded-md border px-2 py-1 text-xs ${f.canais.includes(c) ? 'border-primary bg-primary/15 text-primary' : 'border-border text-muted-foreground'}`}>{l}</button>
            ))}
          </div>
        </div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4 accent-primary" checked={f.recorrente} onChange={(e) => up({ recorrente: e.target.checked })} /><span>Repetir todo dia (recorrente)</span></label>
        <Button type="button" className="w-full" disabled={busy} onClick={salvar}>{busy ? 'Salvando…' : 'Criar ordem'}</Button>
      </Card>
    </div>
  );
}
