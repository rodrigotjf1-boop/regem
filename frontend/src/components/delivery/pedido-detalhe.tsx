'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { toast } from '@/lib/toast';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SeletorProduto, type SelecaoProduto } from '@/components/pdv/seletor-produto';

/* eslint-disable @typescript-eslint/no-explicit-any */
const brl = (n: number) =>
  Number(n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const hora = (d: any) =>
  d ? new Date(d).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '';
const STATUS_LABEL: Record<string, string> = {
  novo: 'Novo', confirmado: 'Em produção', pronto: 'Pronto',
  despachado: 'Em rota', concluido: 'Concluído', cancelado: 'Cancelado',
};

// Painel flutuante com o pedido completo + ações: reimprimir, alterar, cancelar.
export function PedidoDetalhe({
  pedido: p,
  onClose,
  onChanged,
}: {
  pedido: any;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [modo, setModo] = useState<'view' | 'cancelar' | 'alterar'>('view');
  const [busy, setBusy] = useState(false);
  // cancelar
  const [motivo, setMotivo] = useState('');
  const [senha, setSenha] = useState('');
  // mig 128 — destino do insumo já baixado ao cancelar: reutilizado x perda.
  const [reaproveitado, setReaproveitado] = useState(true);
  // alterar — itens
  const [itens, setItens] = useState<any[] | null>(null);
  const [remover, setRemover] = useState<Set<string>>(new Set());
  const [adicionar, setAdicionar] = useState<{ produtoId: string; label: string; observacao?: string }[]>([]);
  // alterar — endereço
  const [bairros, setBairros] = useState<any[]>([]);
  const [endRua, setEndRua] = useState(p.enderecoRua ?? '');
  const [endNum, setEndNum] = useState(p.enderecoNumero ?? '');
  const [endBairro, setEndBairro] = useState(p.enderecoBairro ?? '');
  const [endBairroId, setEndBairroId] = useState('');
  const [endRef, setEndRef] = useState(p.enderecoReferencia ?? '');
  const [endEditado, setEndEditado] = useState(false);

  const podeAlterar = ['confirmado', 'pronto'].includes(p.status);
  const finalizado = ['concluido', 'cancelado'].includes(p.status);

  const carregarItens = useCallback(async () => {
    try {
      setItens((await api.itensDelivery(p.id)) as any[]);
    } catch {
      setItens([]);
    }
  }, [p.id]);

  useEffect(() => {
    if (modo === 'alterar') {
      if (itens === null) carregarItens();
      if (bairros.length === 0) api.bairrosDelivery().then((b: any) => setBairros(b as any[])).catch(() => {});
    }
  }, [modo, itens, bairros.length, carregarItens]);

  // Taxa prevista ao escolher um bairro cadastrado.
  const taxaPrevista = endBairroId ? Number(bairros.find((b) => b.id === endBairroId)?.taxa ?? 0) : null;

  async function reimprimir() {
    setBusy(true);
    try {
      await api.reimprimirDelivery(p.id);
      toast.success('Vias reenviadas para impressão.');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro ao reimprimir');
    } finally {
      setBusy(false);
    }
  }

  async function confirmarCancelamento() {
    if (!senha.trim()) return toast.error('Informe a senha do gestor.');
    setBusy(true);
    try {
      const r: any = await api.cancelarDelivery(p.id, motivo.trim() || undefined, senha, reaproveitado);
      toast.success(r?.estoqueAviso ? `Pedido cancelado. ${r.estoqueAviso}` : 'Pedido cancelado.');
      onChanged();
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro ao cancelar');
    } finally {
      setBusy(false);
    }
  }

  function toggleRemover(id: string) {
    setRemover((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  }

  function addProduto(s: SelecaoProduto) {
    setAdicionar((a) => [...a, { produtoId: s.produtoId, label: s.label, observacao: s.observacao }]);
  }

  async function salvarAlteracao() {
    if (remover.size === 0 && adicionar.length === 0 && !endEditado)
      return toast.error('Nenhuma mudança para salvar.');
    setBusy(true);
    try {
      await api.alterarDelivery(p.id, {
        remover: [...remover],
        adicionar: adicionar.map((a) => ({ produtoId: a.produtoId, quantidade: 1, observacao: a.observacao })),
        endereco: endEditado
          ? { rua: endRua.trim(), numero: endNum.trim(), bairro: endBairro.trim(), bairroId: endBairroId || undefined, referencia: endRef.trim() }
          : undefined,
      });
      toast.success('Pedido alterado — vias reimpressas e cozinha avisada.');
      onChanged();
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro ao alterar');
    } finally {
      setBusy(false);
    }
  }

  function escolherBairro(id: string) {
    setEndBairroId(id);
    setEndEditado(true);
    const b = bairros.find((x) => x.id === id);
    if (b) setEndBairro(b.nome);
  }

  const enderecoFmt = p.enderecoRua
    ? `${p.enderecoRua}${p.enderecoNumero ? `, ${p.enderecoNumero}` : ''}${p.enderecoBairro ? ` · ${p.enderecoBairro}` : ''}`
    : p.endereco;

  return (
    <div className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-black/50 p-4" onClick={onClose}>
      <Card className="w-full max-w-md p-5" onClick={(e) => e.stopPropagation()}>
        {/* Cabeçalho */}
        <div className="flex items-center gap-2">
          <h3 className="font-display text-base font-bold">{p.displayId ?? 'Pedido'}</h3>
          {p.alterado && <span className="rounded bg-warn/15 px-1.5 py-0.5 text-[11px] font-bold text-warn">ALTERADO</span>}
          <span className="ml-auto font-mono text-sm font-bold">{brl(Number(p.total))}</span>
        </div>

        {/* ===== VIEW ===== */}
        {modo === 'view' && (
          <>
            <div className="mt-2 space-y-1 text-sm">
              <p className="flex flex-wrap items-center gap-1.5">
                <span>{p.tipo === 'retirada' ? '🏪' : '🛵'}</span>
                <span className="font-medium capitalize">{p.tipo}</span>
                {STATUS_LABEL[p.status] && (
                  <span className="rounded bg-secondary px-1.5 py-0.5 text-[11px] text-muted-foreground">{STATUS_LABEL[p.status]}</span>
                )}
                {p.numero != null && <span className="text-xs text-muted-foreground">#{p.numero}</span>}
                <span className="ml-auto font-mono text-[11px] text-muted-foreground">{hora(p.criadoEm)}</span>
              </p>
              <p className="font-medium">
                {p.clienteNome ?? 'Cliente'}
                {p.clienteTelefone ? <span className="font-normal text-muted-foreground"> · 📞 {p.clienteTelefone}</span> : null}
              </p>
              {enderecoFmt && <p className="text-muted-foreground">📍 {enderecoFmt}{p.enderecoReferencia ? ` (${p.enderecoReferencia})` : ''}</p>}
              <p className="text-xs">
                {p.pago ? <span className="font-bold text-ok">Pago</span> : <span className="font-bold text-warn">Paga na entrega</span>}
                {p.formaPagamento ? ` · ${p.formaPagamento}` : ''}
                {p.trocoPara != null && Number(p.trocoPara) > 0 ? ` · troco p/ ${brl(Number(p.trocoPara))}` : ''}
              </p>
              {p.entregadorNome && (
                <p className="text-xs font-medium">🛵 {p.entregadorNome}{p.entregadorTelefone ? ` · 📞 ${p.entregadorTelefone}` : ''}</p>
              )}
              {p.agendamento && <p className="text-xs text-info">🗓 agendado p/ {hora(p.agendamento)}</p>}
              {p.cupom && <p className="text-xs text-muted-foreground">🎟 cupom {p.cupom}</p>}
            </div>

            {/* Itens — com complementos/observação e valor por linha */}
            <div className="mt-3 space-y-1.5 border-t border-border pt-2">
              {(p.itens ?? []).map((it: any, k: number) => (
                <div key={k} className="text-sm">
                  <div className="flex justify-between gap-2">
                    <span className="font-medium">{Number(it.quantidade)}× {it.descricao}</span>
                    {it.precoUnitario != null && Number(it.precoUnitario) > 0 && (
                      <span className="shrink-0 font-mono text-xs text-muted-foreground">{brl(Number(it.precoUnitario) * Number(it.quantidade))}</span>
                    )}
                  </div>
                  {it.observacao && <p className="text-xs text-muted-foreground">↳ {it.observacao}</p>}
                </div>
              ))}
            </div>

            {/* Totais */}
            <div className="mt-2 space-y-0.5 border-t border-border pt-2 text-xs text-muted-foreground">
              {Number(p.desconto) > 0 && (
                <div className="flex justify-between"><span>Desconto</span><span>- {brl(Number(p.desconto))}</span></div>
              )}
              {Number(p.taxaEntrega) > 0 && (
                <div className="flex justify-between"><span>Taxa de entrega</span><span>{brl(Number(p.taxaEntrega))}</span></div>
              )}
              <div className="flex justify-between text-sm font-bold text-foreground"><span>Total</span><span>{brl(Number(p.total))}</span></div>
            </div>

            {/* Ações (ícones) */}
            <div className="mt-4 flex gap-2">
              <IconBtn icon="🖨" label="Reimprimir" onClick={reimprimir} disabled={busy || !p.comandaId} />
              {podeAlterar && <IconBtn icon="✏️" label="Alterar" onClick={() => setModo('alterar')} disabled={busy} />}
              {!finalizado && <IconBtn icon="✕" label="Cancelar" tone="destructive" onClick={() => setModo('cancelar')} disabled={busy} />}
            </div>
            <Button type="button" variant="ghost" className="mt-2 w-full" onClick={onClose}>Fechar</Button>
          </>
        )}

        {/* ===== CANCELAR ===== */}
        {modo === 'cancelar' && (
          <div className="mt-3">
            <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm font-medium text-destructive">
              Confirmar cancelamento? Esta ação não pode ser desfeita e não contabiliza estoque.
            </p>
            <div className="mt-3 space-y-3">
              <div className="space-y-1">
                <Label className="text-xs">Motivo</Label>
                <Input value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Ex.: cliente desistiu" autoFocus />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Senha de um gestor (autorização)</Label>
                <Input type="password" value={senha} onChange={(e) => setSenha(e.target.value)} placeholder="senha do presidente/gerente" />
              </div>
            </div>
            {/* Insumo já baixado (pedido produzido): voltou ao estoque ou virou perda? */}
            <div className="mt-3 space-y-1.5">
              <p className="text-xs font-medium">O que aconteceu com os insumos deste pedido?</p>
              <div className="flex gap-1.5">
                <button
                  type="button"
                  aria-pressed={reaproveitado}
                  onClick={() => setReaproveitado(true)}
                  className={`flex-1 rounded-md border px-2 py-1.5 text-xs font-medium ${reaproveitado ? 'border-primary bg-primary/15 text-primary' : 'border-border text-muted-foreground'}`}
                >
                  ♻️ Reutilizados (voltam ao estoque)
                </button>
                <button
                  type="button"
                  aria-pressed={!reaproveitado}
                  onClick={() => setReaproveitado(false)}
                  className={`flex-1 rounded-md border px-2 py-1.5 text-xs font-medium ${!reaproveitado ? 'border-destructive bg-destructive/10 text-destructive' : 'border-border text-muted-foreground'}`}
                >
                  🗑️ Perda (não voltam)
                </button>
              </div>
            </div>
            <div className="mt-4 flex gap-2">
              <Button type="button" variant="ghost" className="flex-1" onClick={() => setModo('view')}>Voltar</Button>
              <Button type="button" className="flex-1 bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={confirmarCancelamento} disabled={busy}>
                {busy ? '…' : 'Confirmar cancelamento'}
              </Button>
            </div>
          </div>
        )}

        {/* ===== ALTERAR ===== */}
        {modo === 'alterar' && (
          <div className="mt-3">
            <p className="mb-2 text-xs text-muted-foreground">Marque itens para remover e/ou adicione novos. Ao salvar, as vias são reimpressas e a cozinha é avisada.</p>
            <div className="space-y-1">
              {itens === null && <p className="text-sm text-muted-foreground">Carregando itens…</p>}
              {itens?.length === 0 && <p className="text-sm text-muted-foreground">Sem itens.</p>}
              {itens?.map((it) => {
                const marcado = remover.has(it.id);
                return (
                  <button
                    key={it.id}
                    type="button"
                    onClick={() => toggleRemover(it.id)}
                    className={`flex w-full items-center justify-between rounded-lg border p-2 text-left text-sm ${marcado ? 'border-destructive bg-destructive/5 line-through opacity-70' : 'border-border'}`}
                  >
                    <span>{Number(it.quantidade)}× {it.descricao}</span>
                    <span className="text-xs">{marcado ? 'remover ✕' : brl(Number(it.precoUnitario))}</span>
                  </button>
                );
              })}
            </div>

            {adicionar.length > 0 && (
              <div className="mt-2 space-y-1">
                <p className="text-xs font-semibold text-ok">A adicionar</p>
                {adicionar.map((a, i) => (
                  <div key={i} className="flex items-center justify-between rounded-lg border border-ok/40 bg-ok/5 p-2 text-sm">
                    <span>+ {a.label}</span>
                    <button type="button" className="text-xs text-destructive" onClick={() => setAdicionar((s) => s.filter((_, j) => j !== i))}>tirar</button>
                  </div>
                ))}
              </div>
            )}

            {/* Endereço da entrega (recalcula a taxa pelo bairro) */}
            {p.tipo !== 'retirada' && (
              <div className="mt-3 rounded-lg border border-border p-2.5">
                <p className="mb-2 text-xs font-semibold">Endereço da entrega</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <div className="col-span-2"><Input value={endRua} onChange={(e) => { setEndRua(e.target.value); setEndEditado(true); }} placeholder="Rua" /></div>
                  <Input value={endNum} onChange={(e) => { setEndNum(e.target.value); setEndEditado(true); }} placeholder="Número" />
                  {bairros.length > 0 ? (
                    <select value={endBairroId} onChange={(e) => escolherBairro(e.target.value)} aria-label="Bairro" className="rounded-md border border-border bg-background px-2 py-1.5 text-sm">
                      <option value="">{endBairro || 'Bairro…'}</option>
                      {bairros.map((b) => <option key={b.id} value={b.id}>{b.nome} — {brl(Number(b.taxa))}</option>)}
                    </select>
                  ) : (
                    <Input value={endBairro} onChange={(e) => { setEndBairro(e.target.value); setEndEditado(true); }} placeholder="Bairro" />
                  )}
                  <div className="col-span-2"><Input value={endRef} onChange={(e) => { setEndRef(e.target.value); setEndEditado(true); }} placeholder="Referência" /></div>
                </div>
                {taxaPrevista != null && (
                  <p className="mt-1.5 text-[11px] text-muted-foreground">Taxa do bairro: <span className="font-mono font-bold text-foreground">{brl(taxaPrevista)}</span></p>
                )}
                {bairros.length === 0 && (
                  <p className="mt-1.5 text-[11px] text-muted-foreground">Cadastre bairros com taxa em Cardápio → Área de atendimento para recalcular a taxa automaticamente.</p>
                )}
              </div>
            )}

            <div className="mt-3">
              <Label className="text-xs">Adicionar item</Label>
              <div className="mt-1 max-h-64 overflow-y-auto rounded-lg border border-border p-2">
                <SeletorProduto onAdd={addProduto} enviando={busy} />
              </div>
            </div>

            <div className="mt-4 flex gap-2">
              <Button type="button" variant="ghost" className="flex-1" onClick={() => setModo('view')}>Voltar</Button>
              <Button type="button" className="flex-1" onClick={salvarAlteracao} disabled={busy}>{busy ? '…' : 'Salvar alteração'}</Button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}

function IconBtn({
  icon,
  label,
  onClick,
  disabled,
  tone,
}: {
  icon: string;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  tone?: 'destructive';
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`flex flex-1 flex-col items-center gap-1 rounded-lg border p-2.5 text-xs font-medium disabled:opacity-40 ${
        tone === 'destructive' ? 'border-destructive/40 text-destructive hover:bg-destructive/5' : 'border-border hover:border-primary/50'
      }`}
    >
      <span className="text-lg">{icon}</span>
      {label}
    </button>
  );
}
