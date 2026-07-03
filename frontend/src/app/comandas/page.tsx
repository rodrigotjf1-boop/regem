'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, getToken } from '@/lib/api';
import { Shell } from '@/components/app-shell/shell';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

/* eslint-disable @typescript-eslint/no-explicit-any */
const brl = (n: number) =>
  Number(n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const selectCls = 'flex h-11 w-full rounded-md border border-input bg-card px-3 text-sm';

export default function ComandasPage() {
  const router = useRouter();
  const [comandas, setComandas] = useState<any[]>([]);
  const [produtos, setProdutos] = useState<any[]>([]);
  const [sel, setSel] = useState<any>(null); // comanda aberta (com itens)
  const [erro, setErro] = useState('');

  const [mesa, setMesa] = useState('');
  const [cliente, setCliente] = useState('');

  const [prodId, setProdId] = useState('');
  const [variacoes, setVariacoes] = useState<any[]>([]);
  const [varId, setVarId] = useState('');
  const [qtd, setQtd] = useState('1');

  const [taxa, setTaxa] = useState(false);
  const [forma, setForma] = useState('dinheiro');

  const reloadLista = useCallback(async () => {
    setErro('');
    try {
      const [cs, ps] = await Promise.all([api.comandas(), api.produtos()]);
      setComandas(cs);
      setProdutos(ps.filter((p: any) => p.ativo !== false));
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao carregar');
    }
  }, []);

  useEffect(() => {
    if (!getToken()) {
      router.replace('/entrar');
      return;
    }
    reloadLista();
  }, [reloadLista, router]);

  async function abrirSel(id: string) {
    try {
      setSel(await api.comanda(id));
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao abrir comanda');
    }
  }

  async function novaComanda() {
    if (!mesa.trim() && !cliente.trim()) {
      setErro('Informe a mesa ou o cliente.');
      return;
    }
    try {
      const c: any = await api.abrirComanda({
        mesa: mesa || undefined,
        cliente: cliente || undefined,
      });
      setMesa('');
      setCliente('');
      await reloadLista();
      await abrirSel(c.id);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao abrir');
    }
  }

  async function onProd(id: string) {
    setProdId(id);
    setVarId('');
    setVariacoes([]);
    const p = produtos.find((x) => x.id === id);
    if (p?.tipo === 'variavel') {
      try {
        const full: any = await api.produto(id);
        setVariacoes(full.variacoes ?? []);
      } catch {
        /* ignore */
      }
    }
  }

  async function adicionar() {
    if (!sel || !prodId) return;
    try {
      await api.addComandaItem(sel.id, {
        produtoId: prodId,
        variacaoId: varId || undefined,
        quantidade: Number(qtd) || 1,
      });
      setProdId('');
      setVarId('');
      setVariacoes([]);
      setQtd('1');
      await abrirSel(sel.id);
      await reloadLista();
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao adicionar');
    }
  }

  async function removerItem(itemId: string) {
    try {
      await api.removerComandaItem(itemId);
      await abrirSel(sel.id);
      await reloadLista();
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao remover');
    }
  }

  async function fechar() {
    if (!sel) return;
    try {
      const r: any = await api.fecharComanda(sel.id, {
        forma,
        taxaServicoPct: taxa ? 10 : 0,
      });
      alert(`Comanda fechada · ${brl(r.total)}`);
      setSel(null);
      setTaxa(false);
      await reloadLista();
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao fechar');
    }
  }

  const subtotal = (sel?.itens ?? []).reduce(
    (s: number, i: any) => s + Number(i.precoUnitario) * Number(i.quantidade),
    0,
  );
  const total = subtotal * (taxa ? 1.1 : 1);

  return (
    <Shell eyebrow="PDV · mesas" title="Comandas">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[320px_1fr]">
        {/* Lista + nova */}
        <div className="space-y-3">
          {erro && <p className="text-destructive">{erro}</p>}
          <Card className="space-y-2 p-4">
            <h2 className="font-display text-sm font-bold">Nova comanda</h2>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label className="text-xs">Mesa</Label>
                <Input value={mesa} onChange={(e) => setMesa(e.target.value)} placeholder="Ex.: 12" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Cliente</Label>
                <Input value={cliente} onChange={(e) => setCliente(e.target.value)} placeholder="opcional" />
              </div>
            </div>
            <Button type="button" onClick={novaComanda} className="w-full">Abrir comanda</Button>
          </Card>

          <p className="px-1 text-xs font-medium text-muted-foreground">
            Abertas ({comandas.length})
          </p>
          {comandas.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => abrirSel(c.id)}
              className={`flex w-full items-center justify-between rounded-lg border p-3 text-left transition ${
                sel?.id === c.id ? 'border-primary bg-primary/10' : 'border-border bg-card hover:border-primary/40'
              }`}
            >
              <div>
                <p className="font-medium">{c.mesa ? `Mesa ${c.mesa}` : c.cliente || 'Comanda'}</p>
                <p className="text-xs text-muted-foreground">{c.itens} item(ns)</p>
              </div>
              <span className="font-mono text-sm font-bold">{brl(Number(c.total))}</span>
            </button>
          ))}
          {comandas.length === 0 && (
            <p className="px-1 text-sm text-muted-foreground">Nenhuma comanda aberta.</p>
          )}
        </div>

        {/* Comanda selecionada */}
        {sel ? (
          <Card className="h-fit space-y-4 p-4">
            <div className="flex items-center justify-between">
              <h2 className="font-display text-lg font-semibold">
                {sel.mesa ? `Mesa ${sel.mesa}` : sel.cliente || 'Comanda'}
              </h2>
              <Button type="button" variant="ghost" size="sm" onClick={() => setSel(null)}>Fechar painel</Button>
            </div>

            {/* Adicionar item */}
            <div className="rounded-lg border border-border p-3">
              <Label className="text-xs">Adicionar item</Label>
              <div className="mt-2 flex flex-wrap gap-2">
                <select className={`${selectCls} flex-1`} value={prodId} onChange={(e) => onProd(e.target.value)}>
                  <option value="">— produto —</option>
                  {produtos.map((p) => (
                    <option key={p.id} value={p.id}>{p.nome} · {brl(Number(p.precoVenda))}</option>
                  ))}
                </select>
                {variacoes.length > 0 && (
                  <select className={`${selectCls} flex-1`} value={varId} onChange={(e) => setVarId(e.target.value)}>
                    <option value="">— tamanho —</option>
                    {variacoes.map((v) => (
                      <option key={v.id} value={v.id}>{v.nome} · {brl(Number(v.precoVenda))}</option>
                    ))}
                  </select>
                )}
                <Input type="number" className="w-20" value={qtd} onChange={(e) => setQtd(e.target.value)} />
                <Button type="button" onClick={adicionar} disabled={!prodId}>Adicionar</Button>
              </div>
            </div>

            {/* Itens */}
            <div className="space-y-2">
              {(sel.itens ?? []).length === 0 && (
                <p className="text-sm text-muted-foreground">Comanda vazia.</p>
              )}
              {(sel.itens ?? []).map((i: any) => (
                <div key={i.id} className="flex items-center gap-2 text-sm">
                  <span className="font-mono text-muted-foreground">{Number(i.quantidade)}×</span>
                  <span className="min-w-0 flex-1 truncate">{i.descricao}</span>
                  <span className="font-mono">{brl(Number(i.precoUnitario) * Number(i.quantidade))}</span>
                  <button type="button" onClick={() => removerItem(i.id)} className="text-destructive">×</button>
                </div>
              ))}
            </div>

            {/* Fechar */}
            <div className="space-y-2 border-t border-border pt-3">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={taxa} onChange={(e) => setTaxa(e.target.checked)} className="h-4 w-4 accent-primary" />
                Taxa de serviço 10%
              </label>
              <div className="flex flex-wrap gap-1.5">
                {['dinheiro', 'pix', 'cartao'].map((fmt) => (
                  <button key={fmt} type="button" onClick={() => setForma(fmt)}
                    className={`rounded-md border px-2.5 py-1 text-xs font-medium capitalize ${forma === fmt ? 'border-primary bg-primary/15 text-primary' : 'border-border'}`}>
                    {fmt}
                  </button>
                ))}
              </div>
              <div className="flex items-baseline justify-between">
                <span className="font-semibold">Total</span>
                <span className="font-mono text-xl font-bold">{brl(total)}</span>
              </div>
              <Button type="button" size="lg" className="w-full" onClick={fechar} disabled={(sel.itens ?? []).length === 0}>
                Fechar e receber
              </Button>
            </div>
          </Card>
        ) : (
          <Card className="grid place-items-center p-10 text-sm text-muted-foreground">
            Selecione ou abra uma comanda.
          </Card>
        )}
      </div>
    </Shell>
  );
}
