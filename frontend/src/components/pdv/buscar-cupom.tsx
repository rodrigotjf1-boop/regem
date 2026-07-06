'use client';

import { useState } from 'react';
import { api } from '@/lib/api';
import { toast } from '@/lib/toast';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

/* eslint-disable @typescript-eslint/no-explicit-any */
const brl = (n: number) =>
  Number(n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

// Busca um cupom pela SENHA e permite cancelar (com estorno). Alterar um cupom
// já fechado = cancelar + refazer (decisão de projeto: edita só enquanto aberto).
export function BuscarCupom() {
  const [aberto, setAberto] = useState(false);
  const [senha, setSenha] = useState('');
  const [cupom, setCupom] = useState<any>(null);
  const [motivo, setMotivo] = useState('');
  const [busy, setBusy] = useState(false);

  function fechar() {
    setAberto(false);
    setSenha('');
    setCupom(null);
    setMotivo('');
  }

  async function buscar() {
    if (!senha.trim()) return;
    setBusy(true);
    setCupom(null);
    try {
      setCupom(await api.buscarCupomSenha(senha.trim()));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Cupom não encontrado');
    } finally {
      setBusy(false);
    }
  }

  async function cancelar() {
    if (!cupom?.id) return;
    if (!confirm(`Cancelar o cupom da senha ${cupom.senha ?? ''}? O estoque e o caixa são estornados.`)) return;
    setBusy(true);
    try {
      await api.cancelarVenda(cupom.id, { motivo: motivo.trim() || undefined });
      toast.success('Cupom cancelado (estornado).');
      fechar();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro ao cancelar');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button type="button" variant="outline" size="sm" onClick={() => setAberto(true)}>
        🔎 Buscar / cancelar cupom
      </Button>

      {aberto && (
        <div className="fixed inset-0 z-40 grid place-items-center overflow-y-auto bg-black/50 p-4" onClick={fechar}>
          <Card className="w-full max-w-sm p-5" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <h3 className="font-display font-semibold">Buscar cupom</h3>
              <button type="button" onClick={fechar} className="text-muted-foreground">✕</button>
            </div>

            <div className="flex gap-2">
              <Input
                inputMode="numeric"
                value={senha}
                onChange={(e) => setSenha(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') buscar(); }}
                placeholder="Senha do cupom"
                autoFocus
              />
              <Button type="button" onClick={buscar} disabled={busy}>{busy ? '…' : 'Buscar'}</Button>
            </div>

            {cupom && (
              <div className="mt-4">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-sm">Senha {cupom.senha ?? '—'}</span>
                  <span className={`rounded-md px-2 py-0.5 text-[11px] font-bold ${cupom.status === 'cancelada' ? 'bg-destructive/10 text-destructive' : 'bg-ok/10 text-ok'}`}>
                    {cupom.status}
                  </span>
                </div>
                <div className="mt-2 max-h-48 space-y-1 overflow-y-auto border-y border-border py-2 text-sm">
                  {(cupom.itens ?? []).map((it: any) => (
                    <div key={it.id} className="flex justify-between gap-2">
                      <span className="min-w-0 truncate">{Number(it.quantidade)}× {it.descricao}</span>
                      <span className="font-mono text-xs">{brl(Number(it.precoUnitario) * Number(it.quantidade))}</span>
                    </div>
                  ))}
                </div>
                <div className="mt-2 flex justify-between font-bold">
                  <span>Total</span>
                  <span className="font-mono">{brl(Number(cupom.total))}</span>
                </div>

                {cupom.status !== 'cancelada' ? (
                  <div className="mt-4 space-y-2">
                    <Input value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Motivo do cancelamento (opcional)" />
                    <Button type="button" variant="outline" className="w-full border-destructive/50 text-destructive" onClick={cancelar} disabled={busy}>
                      {busy ? '…' : 'Cancelar cupom (estornar)'}
                    </Button>
                    <p className="text-center text-[11px] text-muted-foreground">Para alterar, cancele e refaça o cupom.</p>
                  </div>
                ) : (
                  <p className="mt-3 text-center text-xs text-muted-foreground">
                    Cupom já cancelado{cupom.motivoCancelamento ? ` · ${cupom.motivoCancelamento}` : ''}.
                  </p>
                )}
              </div>
            )}
          </Card>
        </div>
      )}
    </>
  );
}
