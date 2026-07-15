'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, getToken, getPermissoes } from '@/lib/api';
import { toast } from '@/lib/toast';
import { Shell } from '@/components/app-shell/shell';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { CreditCard, Landmark, Bike, Footprints, Store } from 'lucide-react';

/* eslint-disable @typescript-eslint/no-explicit-any */

const TIPOS = [
  { v: 'dinheiro', l: 'Dinheiro' },
  { v: 'credito', l: 'Cartão de crédito' },
  { v: 'debito', l: 'Cartão de débito' },
  { v: 'pix', l: 'Pix' },
  { v: 'vr', l: 'Vale' },
  { v: 'outro', l: 'Outro' },
];
const TIPOS_PEDIDO = [
  { v: 'delivery', l: 'Delivery', icon: Bike },
  { v: 'retirada', l: 'Retirada', icon: Footprints },
  { v: 'balcao', l: 'Balcão', icon: Store },
];
const BANDEIRAS = ['Visa', 'Mastercard', 'Elo', 'Amex', 'Hipercard'];
const brl = (n: any) =>
  Number(n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
      className={`relative inline-flex h-5 w-9 flex-none items-center rounded-full transition-colors ${on ? 'bg-primary' : 'bg-secondary'}`}
    >
      <span className={`inline-block h-4 w-4 transform rounded-full bg-card shadow transition-transform ${on ? 'translate-x-4' : 'translate-x-0.5'}`} />
    </button>
  );
}

export default function FormasPagamentoPage() {
  const router = useRouter();
  const [formas, setFormas] = useState<any[]>([]);
  const [edit, setEdit] = useState<any>(null); // forma em edição (ou {} para nova)

  const carregar = useCallback(async () => {
    setFormas((await api.formasPagamento().catch(() => [])) as any[]);
  }, []);
  useEffect(() => {
    if (!getToken()) {
      router.replace('/entrar');
      return;
    }
    if (!getPermissoes()?.formas_pagamento && getPermissoes() !== undefined) {
      // presidente não tem o objeto? bypass via servidor; aqui só oculta se claramente sem perm
    }
    carregar();
  }, [carregar, router]);

  async function alternar(f: any) {
    try {
      await api.ativarFormaPagamento(f.id, !f.ativo);
      setFormas((arr) => arr.map((x) => (x.id === f.id ? { ...x, ativo: !x.ativo } : x)));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro');
    }
  }
  async function salvar(dto: any) {
    try {
      if (dto.id) await api.atualizarFormaPagamento(dto.id, dto);
      else await api.criarFormaPagamento(dto);
      setEdit(null);
      await carregar();
      toast.success('Forma de pagamento salva.');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro ao salvar');
    }
  }
  async function remover(f: any) {
    if (!confirm(`Remover "${f.nome}"?`)) return;
    try {
      await api.removerFormaPagamento(f.id);
      await carregar();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro ao remover');
    }
  }

  return (
    <Shell eyebrow="Financeiro" title="Formas de pagamento">
      <div className="space-y-6">
        {/* ── Pagamento online (vitrine — integração em breve) ── */}
        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <h2 className="font-display text-lg font-semibold">Pagamento online</h2>
            <span className="rounded bg-ok/15 px-2 py-0.5 text-xs font-semibold text-ok">Preferido dos clientes</span>
          </div>
          <p className="text-sm text-muted-foreground">
            Formas que trazem mais agilidade no atendimento e recebimento automático.
          </p>
          <div className="grid gap-3 md:grid-cols-2">
            <CardOnline
              icon={CreditCard}
              titulo="Cartão de crédito online"
              sub="(Mercado Pago ou Cielo)"
              linhas={[
                ['Automação total', 'Reconhecimento de pagamentos e estornos automáticos.'],
                ['Regras de aceite', 'Pedidos com cartão online aceitos em até 3 dias.'],
              ]}
              botao="Usar integração de pagamento"
            />
            <CardOnline
              icon={Landmark}
              titulo="Pix automático online"
              sub="(Tuna)"
              linhas={[
                ['Agilidade', 'Pagamento identificado na hora, sem comprovante.'],
                ['Fluxo de caixa', 'Dinheiro na conta em 1 dia útil.'],
              ]}
              botao="Cadastrar conta de repasse"
            />
          </div>
        </section>

        {/* ── Pré-definidas ── */}
        <section className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-display text-lg font-semibold">Formas pré-definidas</h2>
            <Button type="button" size="sm" onClick={() => setEdit({ tipo: 'outro', tiposPedido: ['delivery', 'retirada', 'balcao'], bandeiras: [] })}>
              ＋ Nova forma
            </Button>
          </div>
          <p className="text-sm text-muted-foreground">
            Valem para <strong>delivery e balcão</strong>. Desative as que não usa.
          </p>

          <Card className="overflow-x-auto p-0">
            <table className="w-full min-w-[720px] text-sm">
              <caption className="sr-only">Formas de pagamento pré-definidas</caption>
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-4 py-2.5 font-medium">Método</th>
                  <th className="px-3 py-2.5 font-medium">Cardápio digital</th>
                  <th className="px-3 py-2.5 font-medium">Tipo de pedido</th>
                  <th className="px-3 py-2.5 font-medium">Taxa extra</th>
                  <th className="px-3 py-2.5 font-medium">Obs.</th>
                  <th className="px-3 py-2.5 font-medium">Bandeiras</th>
                  <th className="px-3 py-2.5 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {formas.length === 0 && (
                  <tr><td colSpan={7} className="px-4 py-6 text-center text-muted-foreground">Nenhuma forma cadastrada.</td></tr>
                )}
                {formas.map((f) => (
                  <tr key={f.id} className="border-b border-border/50">
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2.5">
                        <Toggle on={!!f.ativo} onChange={() => alternar(f)} label={`ativar ${f.nome}`} />
                        <span className={`font-medium ${f.ativo ? '' : 'text-muted-foreground line-through'}`}>{f.nome}</span>
                      </div>
                    </td>
                    <td className="px-3 py-2.5">
                      <span className={`rounded px-1.5 py-0.5 text-xs font-semibold ${f.cardapio ? 'bg-ok/15 text-ok' : 'bg-secondary text-muted-foreground'}`}>
                        {f.cardapio ? 'Habilitado' : 'Desabilitado'}
                      </span>
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-1.5 text-muted-foreground">
                        {TIPOS_PEDIDO.map((t) => {
                          const on = (f.tiposPedido ?? []).includes(t.v);
                          return <t.icon key={t.v} className={`h-4 w-4 ${on ? 'text-foreground' : 'opacity-25'}`} aria-label={t.l} />;
                        })}
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-muted-foreground">{f.taxaExtra != null ? brl(f.taxaExtra) : '—'}</td>
                    <td className="px-3 py-2.5 max-w-[140px] truncate text-muted-foreground" title={f.obs ?? ''}>{f.obs || '—'}</td>
                    <td className="px-3 py-2.5 text-muted-foreground">{(f.bandeiras ?? []).length ? f.bandeiras.join(', ') : '—'}</td>
                    <td className="px-3 py-2.5 text-right">
                      <button type="button" onClick={() => setEdit(f)} className="text-sm font-semibold text-primary hover:underline">Editar</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </section>
      </div>

      {edit && <ModalForma forma={edit} onFechar={() => setEdit(null)} onSalvar={salvar} onRemover={remover} />}
    </Shell>
  );
}

function CardOnline({ icon: Icon, titulo, sub, linhas, botao }: any) {
  return (
    <Card className="flex flex-col gap-3 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <Icon className="h-5 w-5 text-primary" />
          <div>
            <p className="font-semibold leading-tight">{titulo}</p>
            <p className="text-xs text-muted-foreground">{sub}</p>
          </div>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={() => toast.info('Integração online em breve.')}>
          {botao}
        </Button>
      </div>
      <div className="grid gap-1.5 text-xs">
        {linhas.map(([k, v]: [string, string]) => (
          <p key={k}><strong>{k}:</strong> <span className="text-muted-foreground">{v}</span></p>
        ))}
      </div>
    </Card>
  );
}

function ModalForma({ forma, onFechar, onSalvar, onRemover }: any) {
  const [f, setF] = useState<any>({
    ...forma,
    tiposPedido: forma.tiposPedido ?? ['delivery', 'retirada', 'balcao'],
    bandeiras: forma.bandeiras ?? [],
  });
  const set = (p: any) => setF((x: any) => ({ ...x, ...p }));
  const toggleArr = (campo: string, v: string) =>
    set({ [campo]: (f[campo] ?? []).includes(v) ? f[campo].filter((x: string) => x !== v) : [...(f[campo] ?? []), v] });
  const ehCartao = f.tipo === 'credito' || f.tipo === 'debito';

  return (
    <div className="fixed inset-0 z-40 grid place-items-center overflow-y-auto bg-black/50 p-4" onClick={onFechar}>
      <Card className="w-full max-w-md space-y-3 p-5" onClick={(e) => e.stopPropagation()}>
        <h3 className="font-display text-lg font-semibold">{f.id ? 'Editar forma' : 'Nova forma'}</h3>

        <label className="block space-y-1">
          <span className="text-xs text-muted-foreground">Nome</span>
          <Input value={f.nome ?? ''} onChange={(e) => set({ nome: e.target.value })} placeholder="Ex.: Cartão de crédito" />
        </label>
        <label className="block space-y-1">
          <span className="text-xs text-muted-foreground">Tipo</span>
          <select value={f.tipo ?? 'outro'} onChange={(e) => set({ tipo: e.target.value })} className="h-11 w-full rounded-md border border-input bg-card px-2 text-sm">
            {TIPOS.map((t) => <option key={t.v} value={t.v}>{t.l}</option>)}
          </select>
        </label>

        <div className="flex items-center justify-between">
          <span className="text-sm">Mostrar no cardápio digital</span>
          <Toggle on={!!f.cardapio} onChange={(v) => set({ cardapio: v })} label="cardápio digital" />
        </div>

        <div className="space-y-1">
          <span className="text-xs text-muted-foreground">Tipo de pedido que aceita</span>
          <div className="flex flex-wrap gap-2">
            {TIPOS_PEDIDO.map((t) => {
              const on = (f.tiposPedido ?? []).includes(t.v);
              return (
                <button key={t.v} type="button" aria-pressed={on} onClick={() => toggleArr('tiposPedido', t.v)}
                  className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium ${on ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground'}`}>
                  <t.icon className="h-3.5 w-3.5" />{t.l}
                </button>
              );
            })}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <label className="space-y-1">
            <span className="text-xs text-muted-foreground">Taxa extra (R$)</span>
            <Input inputMode="decimal" value={f.taxaExtra ?? ''} onChange={(e) => set({ taxaExtra: e.target.value })} placeholder="0,00" />
          </label>
          <label className="space-y-1">
            <span className="text-xs text-muted-foreground">Observação</span>
            <Input value={f.obs ?? ''} onChange={(e) => set({ obs: e.target.value })} placeholder="opcional" />
          </label>
        </div>

        {ehCartao && (
          <div className="space-y-1">
            <span className="text-xs text-muted-foreground">Bandeiras aceitas</span>
            <div className="flex flex-wrap gap-2">
              {BANDEIRAS.map((b) => {
                const on = (f.bandeiras ?? []).includes(b);
                return (
                  <button key={b} type="button" aria-pressed={on} onClick={() => toggleArr('bandeiras', b)}
                    className={`rounded-full border px-3 py-1 text-xs font-medium ${on ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground'}`}>
                    {b}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <div className="flex items-center justify-between pt-2">
          {f.id ? (
            <Button type="button" variant="ghost" size="sm" className="text-destructive" onClick={() => onRemover(f)}>Remover</Button>
          ) : <span />}
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={onFechar}>Cancelar</Button>
            <Button type="button" onClick={() => onSalvar(f)} disabled={!f.nome?.trim()}>Salvar</Button>
          </div>
        </div>
      </Card>
    </div>
  );
}
