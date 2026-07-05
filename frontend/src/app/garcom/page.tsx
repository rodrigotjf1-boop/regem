'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, getToken } from '@/lib/api';
import { toast } from '@/lib/toast';
import { Shell } from '@/components/app-shell/shell';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SeletorProduto, type SelecaoProduto } from '@/components/pdv/seletor-produto';

/* eslint-disable @typescript-eslint/no-explicit-any */
const brl = (n: number) =>
  Number(n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

// Terminal do garçom: lança pedidos numa mesa. O item vai à produção e avisa o
// PDV que abriu a mesa. Não fecha caixa nem recebe pagamento.
export default function GarcomPage() {
  const router = useRouter();
  const [mesas, setMesas] = useState<any[] | null>(null);
  const [sel, setSel] = useState<any>(null);
  const [comandaAtiva, setComandaAtiva] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [novoNum, setNovoNum] = useState('');
  const [novoIdent, setNovoIdent] = useState('');

  const reload = useCallback(async () => {
    try {
      setMesas((await api.mesas()) as any[]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro ao carregar');
    }
  }, []);

  const abrirDetalhe = useCallback(async (id: string) => {
    const m: any = await api.mesa(id);
    setSel(m);
    setComandaAtiva((m.comandas ?? [])[0]?.id ?? '');
  }, []);

  useEffect(() => {
    if (!getToken()) {
      router.replace('/entrar');
      return;
    }
    reload();
  }, [reload, router]);

  async function abrirMesa() {
    if (!novoNum.trim()) return;
    try {
      const m: any = await api.abrirMesa({ numero: novoNum.trim(), modo: 'mesa' });
      setNovoNum('');
      await reload();
      await abrirDetalhe(m.id);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro ao abrir mesa');
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

  async function addItem(s: SelecaoProduto) {
    if (!comandaAtiva) {
      toast.error('Escolha/abra uma comanda primeiro.');
      return;
    }
    setEnviando(true);
    try {
      await api.addComandaItem(comandaAtiva, {
        produtoId: s.produtoId,
        variacaoId: s.variacaoId,
        complementos: s.complementos,
        observacao: s.observacao,
        quantidade: 1,
      });
      toast.success(`Enviado à produção: ${s.label}`);
      await abrirDetalhe(sel.id);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro ao lançar');
    } finally {
      setEnviando(false);
    }
  }

  if (sel) {
    return (
      <Shell eyebrow="Garçom · pedidos" title={`Mesa ${sel.numero}`}>
        <div className="mb-3 flex items-center gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={() => setSel(null)}>← mesas</Button>
        </div>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_300px]">
          <SeletorProduto onAdd={addItem} enviando={enviando} />
          <Card className="flex h-fit flex-col gap-3 p-4 lg:sticky lg:top-4">
            {sel.modo === 'comandas' && (
              <div className="flex items-end gap-2">
                <div className="flex-1 space-y-1">
                  <Label className="text-xs">Nova comanda</Label>
                  <Input value={novoIdent} onChange={(e) => setNovoIdent(e.target.value)} placeholder="cliente/pulseira" />
                </div>
                <Button type="button" size="sm" onClick={novaComanda}>Abrir</Button>
              </div>
            )}
            {(sel.comandas ?? []).map((c: any) => (
              <button
                key={c.id}
                type="button"
                onClick={() => setComandaAtiva(c.id)}
                className={`rounded-lg border p-3 text-left ${comandaAtiva === c.id ? 'border-primary' : 'border-border'}`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold">
                    {c.identificador ? c.identificador : 'Comanda'}
                    {comandaAtiva === c.id && <span className="ml-2 text-xs text-primary">(ativa)</span>}
                  </span>
                  <span className="font-mono text-sm">{brl(Number(c.total))}</span>
                </div>
                <div className="mt-1 space-y-0.5">
                  {(c.itens ?? []).map((it: any) => (
                    <div key={it.id} className="text-xs text-muted-foreground">
                      {Number(it.quantidade)}× {it.descricao}
                    </div>
                  ))}
                </div>
              </button>
            ))}
          </Card>
        </div>
      </Shell>
    );
  }

  return (
    <Shell eyebrow="Garçom · pedidos" title="Mesas">
      <div className="max-w-3xl space-y-4">
        <Card className="p-4">
          <h2 className="mb-2 font-display text-sm font-bold">Abrir mesa</h2>
          <div className="flex items-end gap-2">
            <div className="flex-1 space-y-1">
              <Label className="text-xs">Número / nome</Label>
              <Input value={novoNum} onChange={(e) => setNovoNum(e.target.value)} placeholder="Ex.: 12" />
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
              </button>
            ))}
          </div>
        </Card>
      </div>
    </Shell>
  );
}
