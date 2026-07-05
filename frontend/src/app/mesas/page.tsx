'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, getToken } from '@/lib/api';
import { toast } from '@/lib/toast';
import { connectAsGestor, type Socket } from '@/lib/rt';
import { Shell } from '@/components/app-shell/shell';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SeletorProduto, type SelecaoProduto } from '@/components/pdv/seletor-produto';

/* eslint-disable @typescript-eslint/no-explicit-any */
const brl = (n: number) =>
  Number(n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export default function MesasPage() {
  const router = useRouter();
  const [mesas, setMesas] = useState<any[] | null>(null);
  const [sel, setSel] = useState<any>(null); // mesa aberta (detalhe)
  const [comandaAtiva, setComandaAtiva] = useState<string>('');
  const [erro, setErro] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [forma, setForma] = useState('dinheiro');

  // abrir mesa
  const [novoNum, setNovoNum] = useState('');
  const [novoModo, setNovoModo] = useState('mesa');
  // abrir comanda por cliente
  const [novoIdent, setNovoIdent] = useState('');

  const socketRef = useRef<Socket | null>(null);
  const selRef = useRef<any>(null);
  selRef.current = sel;

  const reload = useCallback(async () => {
    try {
      const ms = await api.mesas();
      setMesas(ms as any[]);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao carregar');
    }
  }, []);

  const abrirDetalhe = useCallback(async (id: string) => {
    try {
      const m: any = await api.mesa(id);
      setSel(m);
      const abertas = m.comandas ?? [];
      setComandaAtiva(abertas[0]?.id ?? '');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro ao abrir mesa');
    }
  }, []);

  useEffect(() => {
    if (!getToken()) {
      router.replace('/entrar');
      return;
    }
    reload();
    const socket = connectAsGestor();
    socketRef.current = socket;
    socket.on('mesa:atualizada', (p: any) => {
      reload();
      if (selRef.current && p.mesaId === selRef.current.id) abrirDetalhe(selRef.current.id);
    });
    return () => {
      socket.close();
      socketRef.current = null;
    };
  }, [reload, router, abrirDetalhe]);

  async function abrirMesa() {
    if (!novoNum.trim()) return;
    try {
      const m: any = await api.abrirMesa({ numero: novoNum.trim(), modo: novoModo });
      setNovoNum('');
      await reload();
      await abrirDetalhe(m.id);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro ao abrir mesa');
    }
  }

  async function addItem(s: SelecaoProduto) {
    if (!comandaAtiva) {
      toast.error('Abra/escolha uma comanda primeiro.');
      return;
    }
    setEnviando(true);
    try {
      await api.addComandaItem(comandaAtiva, {
        produtoId: s.produtoId,
        variacaoId: s.variacaoId,
        complementos: s.complementos,
        quantidade: 1,
      });
      toast.success(`Adicionado: ${s.label}`);
      await abrirDetalhe(sel.id);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro ao adicionar');
    } finally {
      setEnviando(false);
    }
  }

  async function novaComanda() {
    try {
      const c: any = await api.abrirComandaNaMesa(sel.id, { identificador: novoIdent.trim() || undefined });
      setNovoIdent('');
      await abrirDetalhe(sel.id);
      setComandaAtiva(c.id);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro ao abrir comanda');
    }
  }

  async function removerItem(itemId: string) {
    if (!confirm('Remover este item? A cozinha é avisada.')) return;
    try {
      await api.removerComandaItem(itemId);
      toast.success('Item removido.');
      await abrirDetalhe(sel.id);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro ao remover');
    }
  }

  async function fecharComanda(id: string) {
    if (!confirm('Fechar esta comanda para pagamento?')) return;
    try {
      await api.fecharComanda(id, { forma });
      toast.success('Comanda fechada.');
      await abrirDetalhe(sel.id);
      await reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro ao fechar');
    }
  }

  async function fecharMesa() {
    if (!confirm('Fechar a mesa inteira? Fecha todas as comandas para pagamento.')) return;
    try {
      const r: any = await api.fecharMesa(sel.id, { forma });
      toast.success(`Mesa fechada · ${brl(r.total)}`);
      setSel(null);
      await reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro ao fechar mesa');
    }
  }

  // ---- Detalhe da mesa ----
  if (sel) {
    const totalMesa = (sel.comandas ?? []).reduce((s: number, c: any) => s + Number(c.total || 0), 0);
    return (
      <Shell eyebrow="PDV · mesas" title={`Mesa ${sel.numero}`}>
        <div className="mb-3 flex items-center gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={() => setSel(null)}>← mesas</Button>
          <span className="text-sm text-muted-foreground">
            {sel.modo === 'comandas' ? 'Comandas por cliente' : 'Comanda única'}
          </span>
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_340px]">
          <SeletorProduto onAdd={addItem} enviando={enviando} />

          <Card className="flex h-fit flex-col gap-3 p-4 lg:sticky lg:top-4">
            {sel.modo === 'comandas' && (
              <div className="flex items-end gap-2">
                <div className="flex-1 space-y-1">
                  <Label className="text-xs">Nova comanda (cliente/pulseira)</Label>
                  <Input value={novoIdent} onChange={(e) => setNovoIdent(e.target.value)} placeholder="Ex.: João / 07" />
                </div>
                <Button type="button" size="sm" onClick={novaComanda}>Abrir</Button>
              </div>
            )}

            {(sel.comandas ?? []).length === 0 && (
              <p className="py-4 text-center text-sm text-muted-foreground">
                {sel.modo === 'comandas' ? 'Abra uma comanda para começar.' : 'Sem itens ainda.'}
              </p>
            )}

            {(sel.comandas ?? []).map((c: any) => (
              <div
                key={c.id}
                className={`rounded-lg border p-3 ${comandaAtiva === c.id ? 'border-primary' : 'border-border'}`}
              >
                <button
                  type="button"
                  onClick={() => setComandaAtiva(c.id)}
                  className="mb-1 flex w-full items-center justify-between text-left"
                >
                  <span className="text-sm font-semibold">
                    {c.identificador ? c.identificador : sel.modo === 'comandas' ? 'Comanda' : 'Itens'}
                    {comandaAtiva === c.id && <span className="ml-2 text-xs text-primary">(ativa)</span>}
                  </span>
                  <span className="font-mono text-sm font-bold">{brl(Number(c.total))}</span>
                </button>
                <div className="space-y-0.5">
                  {(c.itens ?? []).map((it: any) => (
                    <div key={it.id} className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                      <span className="flex-1">{Number(it.quantidade)}× {it.descricao}</span>
                      <span className="font-mono">{brl(Number(it.precoUnitario) * Number(it.quantidade))}</span>
                      <button
                        type="button"
                        onClick={() => removerItem(it.id)}
                        className="text-destructive hover:opacity-70"
                        aria-label="Remover item"
                        title="Remover item"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
                {(c.itens ?? []).length > 0 && (
                  <Button type="button" size="sm" variant="ghost" className="mt-1 h-7 text-xs" onClick={() => fecharComanda(c.id)}>
                    Fechar esta comanda
                  </Button>
                )}
              </div>
            ))}

            <div className="space-y-1 border-t border-border pt-2">
              <span className="text-xs text-muted-foreground">Pagamento</span>
              <div className="flex flex-wrap gap-1.5">
                {['dinheiro', 'pix', 'cartao'].map((fmt) => (
                  <button
                    key={fmt}
                    type="button"
                    onClick={() => setForma(fmt)}
                    className={`rounded-md border px-2.5 py-1 text-xs font-medium capitalize ${forma === fmt ? 'border-primary bg-primary/15 text-primary' : 'border-border'}`}
                  >
                    {fmt}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-baseline justify-between">
              <span className="font-semibold">Total da mesa</span>
              <span className="font-mono text-xl font-bold">{brl(totalMesa)}</span>
            </div>
            <Button type="button" size="lg" onClick={fecharMesa} disabled={totalMesa <= 0}>
              Fechar mesa
            </Button>
          </Card>
        </div>
      </Shell>
    );
  }

  // ---- Lista de mesas ----
  return (
    <Shell eyebrow="PDV · mesas" title="Mesas">
      <div className="max-w-3xl space-y-4">
        {erro && <p className="text-destructive">{erro}</p>}

        <Card className="p-4">
          <h2 className="mb-2 font-display text-sm font-bold">Abrir mesa</h2>
          <div className="flex flex-wrap items-end gap-2">
            <div className="flex-1 space-y-1">
              <Label className="text-xs">Número / nome</Label>
              <Input value={novoNum} onChange={(e) => setNovoNum(e.target.value)} placeholder="Ex.: 12" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Modo</Label>
              <select
                aria-label="Modo da mesa"
                className="flex h-11 w-44 rounded-md border border-input bg-card px-3 text-sm"
                value={novoModo}
                onChange={(e) => setNovoModo(e.target.value)}
              >
                <option value="mesa">Comanda única</option>
                <option value="comandas">Comandas por cliente</option>
              </select>
            </div>
            <Button type="button" onClick={abrirMesa}>Abrir</Button>
          </div>
        </Card>

        <Card className="p-4">
          <p className="mb-3 text-sm font-medium text-muted-foreground">
            Mesas abertas {mesas ? `(${mesas.length})` : ''}
          </p>
          {!mesas && <p className="text-sm text-muted-foreground">Carregando…</p>}
          {mesas?.length === 0 && <p className="text-sm text-muted-foreground">Nenhuma mesa aberta.</p>}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {mesas?.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => abrirDetalhe(m.id)}
                className="flex flex-col items-start gap-1 rounded-xl border border-border bg-card p-3 text-left hover:border-primary/50"
              >
                <span className="font-semibold">Mesa {m.numero}</span>
                <span className="text-xs text-muted-foreground">
                  {Number(m.comandas)} comanda{Number(m.comandas) === 1 ? '' : 's'}
                </span>
                <span className="font-mono text-sm text-primary">{brl(Number(m.total))}</span>
              </button>
            ))}
          </div>
        </Card>
      </div>
    </Shell>
  );
}
