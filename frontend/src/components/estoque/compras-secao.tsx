'use client';

import { useCallback, useEffect, useState } from 'react';
import { Plus, Trash2, Sparkles } from 'lucide-react';
import { api } from '@/lib/api';
import { toast } from '@/lib/toast';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Linha = { itemId: string; quantidade: string; custoUnitario: string };

// Seção Compras do hub: gerar lista (produtos + quantidades, com filtro),
// data de recebimento + delegação, e receber (entra no estoque).
export function ComprasSecao({ itens, fornecedores }: { itens: any[]; fornecedores: any[] }) {
  const [listas, setListas] = useState<any[]>([]);
  const [colabs, setColabs] = useState<any[]>([]);
  const [novo, setNovo] = useState(false);
  const [busy, setBusy] = useState(false);

  // form
  const [nome, setNome] = useState('');
  const [fornecedorId, setFornecedorId] = useState('');
  const [dataRecebimento, setDataRecebimento] = useState('');
  const [delegadoId, setDelegadoId] = useState('');
  const [enviarKds, setEnviarKds] = useState(true);
  const [enviarDashboard, setEnviarDashboard] = useState(true);
  const [filtro, setFiltro] = useState('');
  const [linhas, setLinhas] = useState<Record<string, Linha>>({});

  const reload = useCallback(async () => {
    try {
      const [ls, cs] = await Promise.all([api.comprasListas(), api.colaboradores()]);
      setListas(ls as any[]);
      setColabs(cs as any[]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro ao carregar compras');
    }
  }, []);
  useEffect(() => { reload(); }, [reload]);

  function toggle(itemId: string) {
    setLinhas((l) => {
      const n = { ...l };
      if (n[itemId]) delete n[itemId];
      else n[itemId] = { itemId, quantidade: '', custoUnitario: '' };
      return n;
    });
  }
  function setLinha(itemId: string, patch: Partial<Linha>) {
    setLinhas((l) => ({ ...l, [itemId]: { ...l[itemId], ...patch } }));
  }

  async function sugerir() {
    try {
      const s: any[] = await api.comprasSugestao();
      if (!s.length) { toast.error('Nenhum item abaixo do mínimo.'); return; }
      const n: Record<string, Linha> = {};
      for (const r of s) n[r.itemId] = { itemId: r.itemId, quantidade: String(r.sugerido), custoUnitario: '' };
      setLinhas(n);
      toast.success(`${s.length} item(ns) sugerido(s) do estoque baixo.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro ao sugerir');
    }
  }

  async function criar() {
    const sel = Object.values(linhas).filter((l) => Number(l.quantidade) > 0);
    if (!nome.trim() || sel.length === 0) {
      toast.error('Dê um nome e informe a quantidade de ao menos 1 produto.');
      return;
    }
    setBusy(true);
    try {
      await api.criarCompraLista({
        nome: nome.trim(),
        fornecedorId: fornecedorId || undefined,
        dataRecebimento: dataRecebimento || undefined,
        delegadoId: delegadoId || undefined,
        enviarKds,
        enviarDashboard,
        itens: sel.map((l) => ({
          itemId: l.itemId,
          quantidade: Number(l.quantidade),
          custoUnitario: l.custoUnitario ? Number(l.custoUnitario) : undefined,
        })),
      });
      toast.success('Lista de compras criada.');
      setNovo(false); setNome(''); setLinhas({}); setFiltro('');
      await reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro ao criar');
    } finally {
      setBusy(false);
    }
  }

  async function receber(id: string) {
    if (!confirm('Confirmar recebimento? Os itens entram no estoque.')) return;
    try {
      await api.receberCompra(id);
      toast.success('Compra recebida — estoque atualizado.');
      await reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro ao receber');
    }
  }

  const visiveis = itens.filter((i) =>
    !filtro.trim() || i.nome.toLowerCase().includes(filtro.trim().toLowerCase()),
  );
  const nSel = Object.keys(linhas).length;

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="font-display font-semibold">Compras</h2>
        {!novo && (
          <Button size="sm" onClick={() => setNovo(true)}>
            <Plus className="h-4 w-4" /> Gerar lista
          </Button>
        )}
      </div>

      {novo && (
        <Card className="space-y-3 p-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2">
              <Label>Nome da lista</Label>
              <Input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Ex.: Compra da semana" />
            </div>
            <div className="space-y-1.5">
              <Label>Fornecedor</Label>
              <Select value={fornecedorId} onChange={(e) => setFornecedorId(e.target.value)}>
                <option value="">— sem fornecedor —</option>
                {fornecedores.map((f) => (<option key={f.id} value={f.id}>{f.nome}</option>))}
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Data de recebimento</Label>
              <Input type="date" value={dataRecebimento} onChange={(e) => setDataRecebimento(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Delegar recebimento a (opcional)</Label>
              <Select value={delegadoId} onChange={(e) => setDelegadoId(e.target.value)}>
                <option value="">— ninguém —</option>
                {colabs.map((c) => (<option key={c.id} value={c.id}>{c.nome}</option>))}
              </Select>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <Label>Produtos ({nSel} selecionado(s))</Label>
            <Button type="button" size="sm" variant="outline" onClick={sugerir}>
              <Sparkles className="h-4 w-4" /> Sugerir do estoque baixo
            </Button>
          </div>
          <Input value={filtro} onChange={(e) => setFiltro(e.target.value)} placeholder="🔎 filtrar produtos…" className="h-9" />
          <div className="max-h-56 space-y-1.5 overflow-y-auto rounded-md border border-border p-2">
            {visiveis.length === 0 && <p className="text-xs text-muted-foreground">Nenhum produto.</p>}
            {visiveis.map((i) => {
              const l = linhas[i.id];
              return (
                <div key={i.id} className="flex items-center gap-2">
                  <label className="flex min-w-0 flex-1 items-center gap-2 text-sm">
                    <input type="checkbox" checked={!!l} onChange={() => toggle(i.id)} className="h-4 w-4 accent-primary" />
                    <span className="truncate">{i.nome} <span className="text-xs text-muted-foreground">({i.saldo} {i.unidadeMedida})</span></span>
                  </label>
                  {l && (
                    <>
                      <Input type="number" inputMode="decimal" value={l.quantidade} placeholder="qtd" className="h-9 w-20"
                        onChange={(e) => setLinha(i.id, { quantidade: e.target.value })} />
                      <Input type="number" inputMode="decimal" value={l.custoUnitario} placeholder="R$/un" className="h-9 w-20"
                        onChange={(e) => setLinha(i.id, { custoUnitario: e.target.value })} />
                    </>
                  )}
                </div>
              );
            })}
          </div>

          <div className="flex flex-wrap gap-4 text-sm">
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={enviarKds} onChange={(e) => setEnviarKds(e.target.checked)} className="h-4 w-4 accent-primary" />
              Avisar no KDS ao receber
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={enviarDashboard} onChange={(e) => setEnviarDashboard(e.target.checked)} className="h-4 w-4 accent-primary" />
              Avisar no dashboard
            </label>
          </div>

          <div className="flex gap-2">
            <Button type="button" className="flex-1" disabled={busy} onClick={criar}>Criar lista</Button>
            <Button type="button" variant="outline" onClick={() => setNovo(false)}>Cancelar</Button>
          </div>
        </Card>
      )}

      {listas.length === 0 && !novo && (
        <Card className="p-6 text-center text-sm text-muted-foreground">Nenhuma lista de compras.</Card>
      )}
      {listas.map((l) => (
        <Card key={l.id} className="flex items-center justify-between gap-3 p-4">
          <div className="min-w-0">
            <p className="flex items-center gap-2 font-medium">
              {l.nome}
              {l.status === 'recebida'
                ? <Badge className="bg-ok/10 text-ok">recebida</Badge>
                : <Badge className="bg-warn/10 text-warn">aguardando</Badge>}
            </p>
            <p className="text-xs text-muted-foreground">
              {l.fornecedorNome ? `${l.fornecedorNome} · ` : ''}
              {l.itens} item(ns)
              {l.dataRecebimento ? ` · receber ${l.dataRecebimento}` : ''}
              {l.delegadoNome ? ` · ${l.delegadoNome}` : ''}
            </p>
          </div>
          <div className="flex items-center gap-1.5">
            {l.status !== 'recebida' && (
              <Button size="sm" onClick={() => receber(l.id)}>Receber</Button>
            )}
            <Button type="button" variant="ghost" size="icon" aria-label="Remover lista" className="text-destructive"
              onClick={async () => { if (confirm('Remover esta lista?')) { await api.removerCompraLista(l.id); reload(); } }}>
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </Card>
      ))}
    </section>
  );
}
