'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { toast } from '@/lib/toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

/* eslint-disable @typescript-eslint/no-explicit-any */

const RECOMPENSA_LBL: Record<string, string> = {
  percentual_proximo: '% no próximo pedido',
  percentual_produtos: '% em produtos selecionados',
  valor_fixo: 'R$ fixo no próximo pedido',
};

const PLANO_VAZIO = {
  id: '',
  nome: '',
  ativo: true,
  qualificadorTipo: 'qualquer',
  qualificadorId: '',
  pontosMeta: 10,
  recompensaTipo: 'percentual_proximo',
  recompensaValor: '',
  recompensaProdutos: [] as string[],
  prazoResgateDias: '',
  semPrazo: true,
};

export function FidelidadePanel({ pode }: { pode: boolean }) {
  const [planos, setPlanos] = useState<any[]>([]);
  const [produtos, setProdutos] = useState<any[]>([]);
  const [categorias, setCategorias] = useState<any[]>([]);
  const [form, setForm] = useState<any>({ ...PLANO_VAZIO });
  const [aba, setAba] = useState<'planos' | 'participantes' | 'relatorio'>('planos');
  const [salvando, setSalvando] = useState(false);

  async function recarregar() {
    try {
      setPlanos((await api.fidelidadePlanos()) as any[]);
    } catch {
      /* ignore */
    }
  }
  useEffect(() => {
    recarregar();
    api.produtos().then((p: any) => setProdutos((p as any[]) ?? [])).catch(() => {});
    api.produtoCategorias().then((c: any) => setCategorias((c as any[]) ?? [])).catch(() => {});
  }, []);

  const set = (patch: any) => setForm((s: any) => ({ ...s, ...patch }));

  function editar(p: any) {
    setForm({
      id: p.id,
      nome: p.nome,
      ativo: p.ativo,
      qualificadorTipo: p.qualificadorTipo,
      qualificadorId: p.qualificadorId ?? '',
      pontosMeta: p.pontosMeta,
      recompensaTipo: p.recompensaTipo,
      recompensaValor: String(p.recompensaValor ?? ''),
      recompensaProdutos: p.recompensaProdutos ?? [],
      prazoResgateDias: p.prazoResgateDias ? String(p.prazoResgateDias) : '',
      semPrazo: !p.prazoResgateDias,
    });
    setAba('planos');
  }

  async function salvar() {
    if (!form.nome.trim()) return toast.error('Informe o nome do plano.');
    if (form.qualificadorTipo !== 'qualquer' && !form.qualificadorId)
      return toast.error('Escolha a categoria ou o produto que dá ponto.');
    setSalvando(true);
    try {
      await api.salvarFidelidadePlano({
        id: form.id || undefined,
        nome: form.nome.trim(),
        ativo: form.ativo,
        qualificadorTipo: form.qualificadorTipo,
        qualificadorId: form.qualificadorTipo === 'qualquer' ? null : form.qualificadorId,
        pontosMeta: Number(form.pontosMeta) || 1,
        recompensaTipo: form.recompensaTipo,
        recompensaValor: Number(String(form.recompensaValor).replace(',', '.')) || 0,
        recompensaProdutos: form.recompensaTipo === 'percentual_produtos' ? form.recompensaProdutos : [],
        prazoResgateDias: form.semPrazo ? null : Number(form.prazoResgateDias) || null,
      });
      toast.success(form.id ? 'Plano atualizado.' : 'Plano criado.');
      setForm({ ...PLANO_VAZIO });
      recarregar();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro ao salvar');
    } finally {
      setSalvando(false);
    }
  }

  async function excluir(p: any) {
    if (!confirm(`Excluir o plano "${p.nome}"? TODOS os clientes perderão os pontos acumulados nele.`)) return;
    try {
      await api.removerFidelidadePlano(p.id);
      toast.success('Plano excluído.');
      recarregar();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro');
    }
  }

  async function finalizar(p: any) {
    if (!confirm(`Finalizar "${p.nome}"? Não gera mais pontos, mas os prêmios já conquistados seguem válidos até os clientes resgatarem.`)) return;
    try {
      await api.finalizarFidelidadePlano(p.id);
      toast.success('Plano finalizado (sem novos pontos).');
      recarregar();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro');
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-2 border-b border-border">
        {([
          ['planos', 'Planos'],
          ['participantes', 'Participantes'],
          ['relatorio', 'Prêmios resgatados'],
        ] as const).map(([k, l]) => (
          <button
            key={k}
            type="button"
            onClick={() => setAba(k)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${aba === k ? 'border-primary text-primary' : 'border-transparent text-muted-foreground'}`}
          >
            {l}
          </button>
        ))}
      </div>

      {aba === 'planos' && (
        <div className="space-y-4">
          {/* Formulário do plano */}
          <div className="max-w-2xl space-y-3 rounded-lg border border-border p-3">
            <p className="text-sm font-semibold">{form.id ? 'Editar plano' : 'Novo plano de fidelidade'}</p>
            <Input placeholder="Nome do plano (ex: Clube do Burger)" value={form.nome} onChange={(e) => set({ nome: e.target.value })} disabled={!pode} />

            <div className="grid gap-2 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs text-muted-foreground">Ganha 1 ponto por pedido com…</label>
                <select aria-label="Qualificador" className="flex h-11 w-full rounded-md border border-input bg-card px-2 text-sm" value={form.qualificadorTipo} onChange={(e) => set({ qualificadorTipo: e.target.value, qualificadorId: '' })} disabled={!pode}>
                  <option value="qualquer">Qualquer pedido</option>
                  <option value="categoria">Item de uma categoria</option>
                  <option value="produto">Um produto específico</option>
                </select>
              </div>
              {form.qualificadorTipo === 'categoria' && (
                <div>
                  <label className="mb-1 block text-xs text-muted-foreground">Categoria</label>
                  <select aria-label="Categoria" className="flex h-11 w-full rounded-md border border-input bg-card px-2 text-sm" value={form.qualificadorId} onChange={(e) => set({ qualificadorId: e.target.value })} disabled={!pode}>
                    <option value="">Selecione…</option>
                    {categorias.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
                  </select>
                </div>
              )}
              {form.qualificadorTipo === 'produto' && (
                <div>
                  <label className="mb-1 block text-xs text-muted-foreground">Produto</label>
                  <select aria-label="Produto" className="flex h-11 w-full rounded-md border border-input bg-card px-2 text-sm" value={form.qualificadorId} onChange={(e) => set({ qualificadorId: e.target.value })} disabled={!pode}>
                    <option value="">Selecione…</option>
                    {produtos.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
                  </select>
                </div>
              )}
            </div>

            <div className="grid gap-2 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs text-muted-foreground">Pontos para ganhar o prêmio</label>
                <Input type="number" min={1} value={form.pontosMeta} onChange={(e) => set({ pontosMeta: e.target.value })} disabled={!pode} />
              </div>
              <div>
                <label className="mb-1 block text-xs text-muted-foreground">Tipo de prêmio</label>
                <select aria-label="Recompensa" className="flex h-11 w-full rounded-md border border-input bg-card px-2 text-sm" value={form.recompensaTipo} onChange={(e) => set({ recompensaTipo: e.target.value })} disabled={!pode}>
                  <option value="percentual_proximo">% de desconto no próximo pedido</option>
                  <option value="percentual_produtos">% de desconto em produtos selecionados</option>
                  <option value="valor_fixo">R$ fixo no próximo pedido</option>
                </select>
              </div>
            </div>

            <div className="grid gap-2 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs text-muted-foreground">{form.recompensaTipo === 'valor_fixo' ? 'Valor do desconto (R$)' : '% de desconto'}</label>
                <Input type="number" value={form.recompensaValor} onChange={(e) => set({ recompensaValor: e.target.value })} disabled={!pode} />
              </div>
              {form.recompensaTipo === 'percentual_produtos' && (
                <div>
                  <label className="mb-1 block text-xs text-muted-foreground">Produtos com desconto</label>
                  <select
                    aria-label="Produtos do prêmio"
                    multiple
                    className="h-24 w-full rounded-md border border-input bg-card px-2 text-sm"
                    value={form.recompensaProdutos}
                    onChange={(e) => set({ recompensaProdutos: Array.from(e.target.selectedOptions, (o) => o.value) })}
                    disabled={!pode}
                  >
                    {produtos.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
                  </select>
                </div>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-3 border-t border-border pt-3">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" className="h-4 w-4 accent-primary" checked={form.semPrazo} onChange={(e) => set({ semPrazo: e.target.checked })} disabled={!pode} />
                Sem prazo para resgate (indeterminado)
              </label>
              {!form.semPrazo && (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">Prazo (dias):</span>
                  <Input className="w-24" type="number" min={1} value={form.prazoResgateDias} onChange={(e) => set({ prazoResgateDias: e.target.value })} disabled={!pode} />
                </div>
              )}
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" className="h-4 w-4 accent-primary" checked={form.ativo} onChange={(e) => set({ ativo: e.target.checked })} disabled={!pode} />
                Ativo
              </label>
            </div>

            {pode && (
              <div className="flex gap-2">
                <Button type="button" onClick={salvar} disabled={salvando}>{form.id ? 'Salvar alterações' : 'Criar plano'}</Button>
                {form.id && <Button type="button" variant="outline" onClick={() => setForm({ ...PLANO_VAZIO })}>Cancelar</Button>}
              </div>
            )}
          </div>

          {/* Lista de planos */}
          <div className="space-y-2">
            {planos.length === 0 && <p className="text-sm text-muted-foreground">Nenhum plano cadastrado.</p>}
            {planos.map((p) => (
              <div key={p.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-3 text-sm">
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">
                    {p.nome}{' '}
                    {p.status === 'finalizando' && <span className="rounded bg-warn/15 px-1.5 py-0.5 text-[10px] text-warn">finalizando</span>}
                    {!p.ativo && p.status !== 'finalizando' && <span className="rounded bg-secondary px-1.5 py-0.5 text-[10px] text-muted-foreground">inativo</span>}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {p.pontosMeta} pts · {Number(p.recompensaValor)}{p.recompensaTipo === 'valor_fixo' ? ' R$' : '%'} {RECOMPENSA_LBL[p.recompensaTipo]}
                    {p.prazoResgateDias ? ` · resgate em ${p.prazoResgateDias}d` : ' · sem prazo'}
                  </p>
                </div>
                {pode && (
                  <div className="flex gap-1">
                    <button type="button" onClick={() => editar(p)} className="rounded border border-border px-2 py-1 text-xs">editar</button>
                    {p.status !== 'finalizando' && <button type="button" onClick={() => finalizar(p)} className="rounded border border-border px-2 py-1 text-xs">finalizar</button>}
                    <button type="button" onClick={() => excluir(p)} className="rounded border border-border px-2 py-1 text-xs text-destructive">excluir</button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {aba === 'participantes' && <Participantes planos={planos} pode={pode} />}
      {aba === 'relatorio' && <Relatorio />}
    </div>
  );
}

// Lista de participantes de um plano + ajuste manual de pontos por telefone.
function Participantes({ planos, pode }: { planos: any[]; pode: boolean }) {
  const [planoId, setPlanoId] = useState('');
  const [busca, setBusca] = useState('');
  const [lista, setLista] = useState<any[]>([]);
  const [ajuste, setAjuste] = useState({ telefone: '', delta: '' });

  async function carregar() {
    if (!planoId) return setLista([]);
    try {
      setLista((await api.fidelidadeParticipantes(planoId, busca)) as any[]);
    } catch {
      setLista([]);
    }
  }
  useEffect(() => {
    carregar();

  }, [planoId]);

  async function aplicar() {
    if (!planoId || !ajuste.telefone.trim() || !ajuste.delta) return;
    try {
      await api.ajustarFidelidadePontos(planoId, {
        telefone: ajuste.telefone.trim(),
        delta: Number(ajuste.delta),
      });
      toast.success('Pontos ajustados.');
      setAjuste({ telefone: '', delta: '' });
      carregar();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro');
    }
  }

  return (
    <div className="space-y-3">
      <select aria-label="Plano" className="flex h-11 w-full max-w-md rounded-md border border-input bg-card px-2 text-sm" value={planoId} onChange={(e) => setPlanoId(e.target.value)}>
        <option value="">Selecione um plano…</option>
        {planos.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
      </select>

      {planoId && (
        <>
          <div className="flex flex-wrap items-end gap-2">
            <Input className="w-52" placeholder="Buscar por telefone" value={busca} onChange={(e) => setBusca(e.target.value)} />
            <Button type="button" variant="outline" onClick={carregar}>Buscar</Button>
          </div>

          {pode && (
            <div className="flex flex-wrap items-end gap-2 rounded-lg border border-border p-3">
              <div>
                <label className="mb-1 block text-xs text-muted-foreground">Telefone do cliente</label>
                <Input className="w-52" placeholder="(DDD) número" value={ajuste.telefone} onChange={(e) => setAjuste((s) => ({ ...s, telefone: e.target.value }))} />
              </div>
              <div>
                <label className="mb-1 block text-xs text-muted-foreground">Pontos (+ adiciona / − retira)</label>
                <Input className="w-28" type="number" placeholder="ex: 1 ou -1" value={ajuste.delta} onChange={(e) => setAjuste((s) => ({ ...s, delta: e.target.value }))} />
              </div>
              <Button type="button" onClick={aplicar}>Aplicar</Button>
            </div>
          )}

          <div className="space-y-1.5">
            {lista.length === 0 && <p className="text-sm text-muted-foreground">Nenhum participante.</p>}
            {lista.map((c) => (
              <div key={c.id} className="flex items-center justify-between rounded-lg border border-border px-3 py-2 text-sm">
                <span>{c.nome || 'Cliente'} · <span className="font-mono text-muted-foreground">{c.telefone}</span></span>
                <span className="font-mono font-semibold">{c.pontos} pts</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// Relatório de prêmios resgatados por dia/semana/mês.
function Relatorio() {
  const [periodo, setPeriodo] = useState('dia');
  const [dados, setDados] = useState<any[]>([]);
  useEffect(() => {
    api.fidelidadeRelatorio(periodo).then((d: any) => setDados((d as any[]) ?? [])).catch(() => setDados([]));
  }, [periodo]);
  const total = dados.reduce((a, x) => a + Number(x.total), 0);
  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        {[['dia', 'Por dia'], ['semana', 'Por semana'], ['mes', 'Por mês']].map(([k, l]) => (
          <button key={k} type="button" onClick={() => setPeriodo(k)} className={`rounded-full border px-3 py-1 text-xs font-medium ${periodo === k ? 'border-primary text-primary' : 'border-border text-muted-foreground'}`}>{l}</button>
        ))}
      </div>
      <p className="text-sm text-muted-foreground">Total de prêmios resgatados: <strong className="text-foreground">{total}</strong></p>
      <div className="space-y-1">
        {dados.length === 0 && <p className="text-sm text-muted-foreground">Nenhum resgate no período.</p>}
        {dados.map((x) => (
          <div key={x.periodo} className="flex items-center justify-between rounded border border-border px-3 py-1.5 text-sm">
            <span className="font-mono">{x.periodo}</span>
            <span className="font-semibold">{x.total}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
