'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, getToken, getCategoria } from '@/lib/api';
import { toast } from '@/lib/toast';
import { Shell } from '@/components/app-shell/shell';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { imprimirCupomNavegador } from '@/lib/print-cupom';

/* eslint-disable @typescript-eslint/no-explicit-any */
const brl = (n: number) =>
  Number(n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const hora = (d?: string) =>
  d ? new Date(d).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '—';

export default function CuponsPage() {
  const router = useRouter();
  // cat resolvido no cliente (evita divergência de hidratação: no SSR o token
  // é null e viraria presidente só depois de montar).
  const [cat, setCat] = useState<string | null>(null);
  const isPresidente = cat === 'presidente';
  const [cupons, setCupons] = useState<any[] | null>(null);
  const [erro, setErro] = useState('');
  const [sel, setSel] = useState<any>(null); // cupom detalhado (com itens)
  const [motivo, setMotivo] = useState('');
  const [cancelando, setCancelando] = useState(false);
  const [cancelLivre, setCancelLivre] = useState<boolean | null>(null);
  const [busca, setBusca] = useState('');
  const [buscando, setBuscando] = useState(false);
  const [reimprimindo, setReimprimindo] = useState(false);

  const reload = useCallback(async () => {
    setErro('');
    try {
      const [cs, cfg] = await Promise.all([
        api.vendasCupons(),
        api.vendasConfig().catch(() => ({ cancelamentoLivre: false })),
      ]);
      setCupons(cs as any[]);
      setCancelLivre(!!(cfg as any).cancelamentoLivre);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao carregar');
    }
  }, []);

  useEffect(() => {
    if (!getToken()) {
      router.replace('/entrar');
      return;
    }
    setCat(getCategoria());
    reload();
  }, [reload, router]);

  async function abrir(id: string) {
    setMotivo('');
    try {
      const c: any = await api.vendasCupom(id);
      setSel(c);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro ao abrir cupom');
    }
  }

  async function buscarPorSenha() {
    const n = busca.trim();
    if (!n) return;
    setBuscando(true);
    try {
      const c: any = await api.buscarCupomSenha(n);
      setSel(c);
      setMotivo('');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Nenhum cupom com essa senha.');
    } finally {
      setBuscando(false);
    }
  }

  async function reimprimir() {
    if (!sel) return;
    setReimprimindo(true);
    try {
      await api.reimprimirCupom(sel.id);
      toast.success('2ª via enviada para a impressora.');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro ao reimprimir');
    } finally {
      setReimprimindo(false);
    }
  }

  async function toggleLivre(ativo: boolean) {
    try {
      await api.setCancelamentoLivre(ativo);
      setCancelLivre(ativo);
      toast.success(ativo ? 'Atendente pode cancelar sem autorização.' : 'Cancelamento exige gerente.');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro ao salvar');
    }
  }

  async function cancelar() {
    if (!sel) return;
    if (!confirm(`Cancelar a venda ${sel.mesa ? `da mesa ${sel.mesa}` : ''}? Estorna estoque e caixa.`)) return;
    setCancelando(true);
    try {
      await api.cancelarVenda(sel.id, { motivo: motivo || undefined });
      toast.success('Venda cancelada. Estoque e caixa estornados.');
      setSel(null);
      await reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro ao cancelar');
    } finally {
      setCancelando(false);
    }
  }

  // Atendente sem liberação vê o botão, mas o servidor bloqueia; avisamos antes.
  const atendenteBloqueado = cat === 'atendente' && cancelLivre === false;

  return (
    <Shell eyebrow="PDV · vendas" title="Cupons">
      <div className="space-y-4">
        {erro && <p className="text-destructive">{erro}</p>}

        {isPresidente && (
          <Card className="p-4">
            <h2 className="mb-1 font-display text-sm font-bold">Cancelamento pelo atendente</h2>
            <p className="mb-2 text-xs text-muted-foreground">
              Defina se o atendente pode cancelar vendas sem autorização de um gerente.
            </p>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={!!cancelLivre}
                onChange={(e) => toggleLivre(e.target.checked)}
                className="h-4 w-4 accent-primary"
                aria-label="Permitir cancelamento livre pelo atendente"
              />
              Atendente pode cancelar sem autorização
            </label>
          </Card>
        )}

        <Card className="p-3">
          <div className="flex flex-wrap items-end gap-2">
            <div className="flex-1 space-y-1">
              <Label className="text-xs">Buscar por senha/nº</Label>
              <Input
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') buscarPorSenha();
                }}
                inputMode="numeric"
                placeholder="Ex.: 42"
              />
            </div>
            <Button type="button" variant="outline" disabled={buscando} onClick={buscarPorSenha}>
              {buscando ? 'Buscando…' : 'Buscar'}
            </Button>
          </div>
        </Card>

        <Card className="p-4">
          <p className="mb-3 text-sm font-medium text-muted-foreground">
            Últimas vendas {cupons ? `(${cupons.length})` : ''}
          </p>
          {!cupons && <p className="text-sm text-muted-foreground">Carregando…</p>}
          {cupons?.length === 0 && (
            <p className="text-sm text-muted-foreground">Nenhuma venda registrada ainda.</p>
          )}
          <div className="space-y-2">
            {cupons?.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => abrir(c.id)}
                className="flex w-full items-center gap-3 rounded-lg border border-border p-3 text-left hover:border-primary/50"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{c.mesa ? `Mesa ${c.mesa}` : 'Balcão'}</span>
                    {c.status === 'cancelada' ? (
                      <span className="rounded bg-destructive/10 px-1.5 py-0.5 text-xs text-destructive">cancelada</span>
                    ) : c.status === 'falha' ? (
                      <span className="rounded bg-destructive/10 px-1.5 py-0.5 text-xs font-medium text-destructive">falha no pagamento</span>
                    ) : (
                      <span className="rounded bg-ok/10 px-1.5 py-0.5 text-xs text-ok">fechada</span>
                    )}
                    {c.forma && <span className="text-xs capitalize text-muted-foreground">{c.forma}</span>}
                    {c.equipamentoNome && (
                      <span
                        className="rounded bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground"
                        title="Equipamento de origem"
                      >
                        {c.equipamentoNome}
                      </span>
                    )}
                  </div>
                  {c.status === 'falha' && c.motivoCancelamento && (
                    <span className="mt-0.5 block text-xs text-destructive">{c.motivoCancelamento}</span>
                  )}
                  <span className="text-xs text-muted-foreground">
                    {hora(c.canceladaEm ?? c.fechadaEm ?? c.abertaEm)}
                  </span>
                </div>
                <span className={`font-mono text-sm font-bold ${c.status === 'cancelada' ? 'text-muted-foreground line-through' : c.status === 'falha' ? 'text-muted-foreground' : ''}`}>
                  {brl(Number(c.total))}
                </span>
              </button>
            ))}
          </div>
        </Card>
      </div>

      {/* Detalhe do cupom */}
      {sel && (
        <div className="fixed inset-0 z-30 grid place-items-center overflow-y-auto bg-black/50 p-4" onClick={() => setSel(null)}>
          <Card className="w-full max-w-md p-5" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <h3 className="font-display font-semibold">
                {sel.mesa ? `Mesa ${sel.mesa}` : 'Balcão'} · {brl(Number(sel.total))}
              </h3>
              <Button type="button" variant="ghost" size="sm" onClick={() => setSel(null)}>fechar</Button>
            </div>

            <div className="mb-3 space-y-1">
              {(sel.itens ?? []).map((it: any) => (
                <div key={it.id} className="text-sm">
                  <div className="flex justify-between">
                    <span>{it.quantidade}× {it.descricao ?? it.nome}</span>
                    <span className="font-mono">{brl(Number(it.precoUnitario ?? it.preco ?? 0) * Number(it.quantidade))}</span>
                  </div>
                  {(it.complementos ?? []).length > 0 && (
                    <p className="pl-4 text-[11px] text-muted-foreground">
                      {it.complementos.map((cp: any) => (cp.tipo === 'remover' ? `sem ${cp.nome}` : `+ ${cp.nome}`)).join(' · ')}
                    </p>
                  )}
                </div>
              ))}
            </div>

            <div className="mb-3 grid grid-cols-1 sm:grid-cols-2 gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={reimprimindo}
                onClick={reimprimir}
                title="Reenvia para a impressora térmica pelo servidor local"
              >
                {reimprimindo ? 'Enviando…' : '🖨 Reimprimir (térmica)'}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => imprimirCupomNavegador(sel)}
                title="Imprime pelo navegador — use no modo nuvem ou se o servidor local estiver fora"
              >
                🌐 Imprimir (navegador)
              </Button>
            </div>

            {sel.status === 'cancelada' ? (
              <p className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
                Venda cancelada em {hora(sel.canceladaEm)}
                {sel.motivoCancelamento ? ` · ${sel.motivoCancelamento}` : ''}
              </p>
            ) : sel.status === 'falha' ? (
              // Falha de pagamento do totem: informativo, sem cancelar/estornar
              // (não movimentou estoque nem caixa).
              <p className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
                Pedido não pago — falha no totem
                {sel.motivoCancelamento ? ` · ${sel.motivoCancelamento}` : ''}
                <span className="mt-1 block text-xs text-muted-foreground">
                  Registro só para controle — não baixou estoque nem entrou no caixa.
                </span>
              </p>
            ) : (
              <div className="space-y-2 border-t border-border pt-3">
                <div className="space-y-1">
                  <Label className="text-xs">Motivo do cancelamento (opcional)</Label>
                  <Input value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Ex.: pedido errado" />
                </div>
                {atendenteBloqueado && (
                  <p className="text-xs text-warn">
                    Cancelamento exige autorização de um gerente.
                  </p>
                )}
                <Button
                  type="button"
                  variant="destructive"
                  className="w-full"
                  disabled={cancelando}
                  onClick={cancelar}
                >
                  {cancelando ? 'Cancelando…' : 'Cancelar venda (estornar)'}
                </Button>
              </div>
            )}
          </Card>
        </div>
      )}
    </Shell>
  );
}
