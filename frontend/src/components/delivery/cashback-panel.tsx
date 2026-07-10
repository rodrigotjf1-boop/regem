'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { toast } from '@/lib/toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

/* eslint-disable @typescript-eslint/no-explicit-any */

const VAZIO = {
  id: '',
  tipo: 'valor',
  ativo: true,
  percentual: '',
  base: 'total',
  regras: [{ reais: '', pontos: '' }] as any[],
  produtos: [] as any[],
  prazoResgateDias: '',
  semPrazo: true,
};

export function CashbackPanel({ pode }: { pode: boolean }) {
  const [planos, setPlanos] = useState<any[]>([]);
  const [produtos, setProdutos] = useState<any[]>([]);
  const [form, setForm] = useState<any>({ ...VAZIO });
  const [salvando, setSalvando] = useState(false);

  async function recarregar() {
    try {
      setPlanos((await api.cashbackPlanos()) as any[]);
    } catch {
      /* ignore */
    }
  }
  useEffect(() => {
    recarregar();
    api.produtos().then((p: any) => setProdutos((p as any[]) ?? [])).catch(() => {});
  }, []);

  const set = (patch: any) => setForm((s: any) => ({ ...s, ...patch }));

  function editar(p: any) {
    setForm({
      id: p.id,
      tipo: p.tipo,
      ativo: p.ativo,
      percentual: p.percentual != null ? String(p.percentual) : '',
      base: p.base ?? 'total',
      regras: (p.regras ?? []).length ? p.regras.map((r: any) => ({ reais: String(r.reais), pontos: String(r.pontos) })) : [{ reais: '', pontos: '' }],
      produtos: p.produtos ?? [],
      prazoResgateDias: p.prazoResgateDias ? String(p.prazoResgateDias) : '',
      semPrazo: !p.prazoResgateDias,
    });
  }

  async function salvar() {
    setSalvando(true);
    try {
      await api.salvarCashbackPlano({
        id: form.id || undefined,
        tipo: form.tipo,
        ativo: form.ativo,
        percentual: form.tipo === 'valor' ? Number(String(form.percentual).replace(',', '.')) || 0 : undefined,
        base: form.base,
        regras: form.tipo === 'pontos'
          ? form.regras.map((r: any) => ({ reais: Number(r.reais) || 0, pontos: Number(r.pontos) || 0 })).filter((r: any) => r.reais > 0 && r.pontos > 0)
          : [],
        produtos: form.tipo === 'pontos' ? form.produtos.filter((p: any) => p.produtoId && Number(p.pontos) > 0) : [],
        prazoResgateDias: form.semPrazo ? null : Number(form.prazoResgateDias) || null,
      });
      toast.success(form.id ? 'Plano atualizado.' : 'Plano criado.');
      setForm({ ...VAZIO });
      recarregar();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro ao salvar');
    } finally {
      setSalvando(false);
    }
  }

  async function excluir(p: any) {
    if (!confirm('Excluir este plano de cashback? Os saldos já creditados aos clientes permanecem.')) return;
    try {
      await api.removerCashbackPlano(p.id);
      toast.success('Plano excluído.');
      recarregar();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro');
    }
  }

  async function finalizar(p: any) {
    if (!confirm('Finalizar este plano? Para de gerar cashback novo; os saldos existentes seguem válidos.')) return;
    try {
      await api.finalizarCashbackPlano(p.id);
      toast.success('Plano finalizado.');
      recarregar();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro');
    }
  }

  const setRegra = (i: number, patch: any) =>
    set({ regras: form.regras.map((r: any, j: number) => (j === i ? { ...r, ...patch } : r)) });
  const addRegra = () => set({ regras: [...form.regras, { reais: '', pontos: '' }] });
  const delRegra = (i: number) => set({ regras: form.regras.filter((_: any, j: number) => j !== i) });
  const setProdPontos = (produtoId: string, pontos: string) => {
    const outros = form.produtos.filter((p: any) => p.produtoId !== produtoId);
    set({ produtos: pontos ? [...outros, { produtoId, pontos: Number(pontos) }] : outros });
  };
  const prodPontos = (produtoId: string) => form.produtos.find((p: any) => p.produtoId === produtoId)?.pontos ?? '';

  return (
    <div className="space-y-4">
      {/* Formulário */}
      <div className="max-w-2xl space-y-3 rounded-lg border border-border p-3">
        <p className="text-sm font-semibold">{form.id ? 'Editar plano de cashback' : 'Novo plano de cashback'}</p>

        <div>
          <label className="mb-1 block text-xs text-muted-foreground">Tipo de cashback</label>
          <select aria-label="Tipo" className="flex h-11 w-full rounded-md border border-input bg-card px-2 text-sm" value={form.tipo} onChange={(e) => set({ tipo: e.target.value })} disabled={!pode}>
            <option value="valor">Retorno em valor (R$) — % do pedido vira saldo</option>
            <option value="pontos">Pontos — troca por produtos</option>
          </select>
        </div>

        {form.tipo === 'valor' ? (
          <div className="grid gap-2 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">% de retorno</label>
              <Input type="number" value={form.percentual} onChange={(e) => set({ percentual: e.target.value })} placeholder="ex.: 10" disabled={!pode} />
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">Base do cálculo</label>
              <select aria-label="Base" className="flex h-11 w-full rounded-md border border-input bg-card px-2 text-sm" value={form.base} onChange={(e) => set({ base: e.target.value })} disabled={!pode}>
                <option value="total">Total do pedido</option>
                <option value="sem_frete">Total sem a taxa de entrega</option>
              </select>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">Faixas de pontos (aplica a que der mais pontos)</label>
              <div className="space-y-2">
                {form.regras.map((r: any, i: number) => (
                  <div key={i} className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">A cada R$</span>
                    <Input className="w-20" type="number" value={r.reais} onChange={(e) => setRegra(i, { reais: e.target.value })} placeholder="1" disabled={!pode} />
                    <span className="text-xs text-muted-foreground">=</span>
                    <Input className="w-20" type="number" value={r.pontos} onChange={(e) => setRegra(i, { pontos: e.target.value })} placeholder="2" disabled={!pode} />
                    <span className="text-xs text-muted-foreground">pontos</span>
                    {form.regras.length > 1 && pode && <button type="button" onClick={() => delRegra(i)} className="text-destructive">×</button>}
                  </div>
                ))}
              </div>
              {pode && <button type="button" onClick={addRegra} className="mt-1 text-xs font-semibold text-primary">＋ adicionar faixa</button>}
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">Produtos para resgate (pontos)</label>
              <div className="max-h-48 space-y-1 overflow-y-auto rounded-md border border-border p-2">
                {produtos.map((p) => (
                  <div key={p.id} className="flex items-center gap-2 text-sm">
                    <span className="min-w-0 flex-1 truncate">{p.nome}</span>
                    <Input className="w-24" type="number" value={prodPontos(p.id)} onChange={(e) => setProdPontos(p.id, e.target.value)} placeholder="pontos" disabled={!pode} />
                  </div>
                ))}
                {produtos.length === 0 && <p className="text-xs text-muted-foreground">Nenhum produto cadastrado.</p>}
              </div>
            </div>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-3 border-t border-border pt-3">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="h-4 w-4 accent-primary" checked={form.semPrazo} onChange={(e) => set({ semPrazo: e.target.checked })} disabled={!pode} />
            Saldo sem prazo (indeterminado)
          </label>
          {!form.semPrazo && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">Prazo (dias):</span>
              <Input className="w-24" type="number" value={form.prazoResgateDias} onChange={(e) => set({ prazoResgateDias: e.target.value })} disabled={!pode} />
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
            {form.id && <Button type="button" variant="outline" onClick={() => setForm({ ...VAZIO })}>Cancelar</Button>}
          </div>
        )}
      </div>

      {/* Lista */}
      <div className="space-y-2">
        {planos.length === 0 && <p className="text-sm text-muted-foreground">Nenhum plano de cashback.</p>}
        {planos.map((p) => (
          <div key={p.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-3 text-sm">
            <div className="min-w-0 flex-1">
              <p className="font-semibold">
                {p.tipo === 'valor' ? `Cashback ${Number(p.percentual)}% (${p.base === 'sem_frete' ? 'sem frete' : 'total'})` : 'Cashback em pontos'}{' '}
                {p.status === 'finalizando' && <span className="rounded bg-warn/15 px-1.5 py-0.5 text-[10px] text-warn">finalizando</span>}
                {!p.ativo && p.status !== 'finalizando' && <span className="rounded bg-secondary px-1.5 py-0.5 text-[10px] text-muted-foreground">inativo</span>}
              </p>
              <p className="text-xs text-muted-foreground">
                {p.tipo === 'pontos' ? `${(p.regras ?? []).map((r: any) => `R$${r.reais}=${r.pontos}pt`).join(' · ')} · ${(p.produtos ?? []).length} produto(s)` : ''}
                {p.prazoResgateDias ? ` · saldo expira em ${p.prazoResgateDias}d` : ' · sem prazo'}
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
  );
}
