'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { toast } from '@/lib/toast';
import { avisarEstornoGogem } from '@/lib/estorno-gogem';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SeletorProduto, type SelecaoProduto } from '@/components/pdv/seletor-produto';
import { DetalheEntregadorDoCanal } from '@/components/delivery/logistica-canal';
import { LinhaDoTempoPedido } from '@/components/delivery/linha-do-tempo-pedido';
import { ondeSaiu } from '@/lib/reimpressao';
import { useSenhaSemSalvar } from '@/lib/use-senha-sem-salvar';
import { avisarComprovante } from '@/lib/comprovante';
import { ItensDoPedido } from './itens-do-pedido';
import { ItensDaPerda, type MarcaDaPerda } from './itens-da-perda';

/* eslint-disable @typescript-eslint/no-explicit-any */
const brl = (n: number) =>
  Number(n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const hora = (d: any) =>
  d ? new Date(d).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '';
// Data + hora (encomenda pode ser p/ dias à frente → mostrar a data junto).
const dataHora = (d: any) =>
  d
    ? new Date(d).toLocaleString('pt-BR', {
        day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit',
      })
    : '';
const STATUS_LABEL: Record<string, string> = {
  novo: 'Novo', confirmado: 'Em produção', pronto: 'Pronto',
  despachado: 'Em rota', concluido: 'Concluído', cancelado: 'Cancelado',
};

// Painel flutuante com o pedido completo + ações: reimprimir, alterar, cancelar.
export function PedidoDetalhe({
  pedido: p,
  onClose,
  onChanged,
  modoInicial,
}: {
  pedido: any;
  onClose: () => void;
  onChanged: () => void;
  modoInicial?: 'view' | 'alterar';
}) {
  // Abre já em "alterar" quando o botão "Editar pedido" pede — mas só se o pedido for
  // realmente editável (status + canal); senão cai em 'view' (não abre edição indevida).
  const editavel =
    ['confirmado', 'pronto'].includes(p.status) && !['99food', 'ifood'].includes(p.canal);
  const [modo, setModo] = useState<'view' | 'cancelar' | 'alterar' | 'perda'>(
    modoInicial === 'alterar' && editavel ? 'alterar' : 'view',
  );
  const [busy, setBusy] = useState(false);
  // cancelar
  const [motivo, setMotivo] = useState('');
  const [senha, setSenha] = useState('');
  const campoSenha = useSenhaSemSalvar(); // o navegador não oferece guardar a senha do gestor (PC da loja)
  // mig 128 — destino do insumo já baixado ao cancelar: reutilizado x perda.
  const [reaproveitado, setReaproveitado] = useState(true);
  // Perda parcial (28/10/2026): os itens marcados como perdidos (null = a lista ainda não carregou).
  const [perda, setPerda] = useState<MarcaDaPerda[] | null>(null);
  // alterar — itens
  const [itens, setItens] = useState<any[] | null>(null);
  const [remover, setRemover] = useState<Set<string>>(new Set());
  const [adicionar, setAdicionar] = useState<{ produtoId: string; label: string; observacao?: string; variacaoId?: string; complementos?: string[] }[]>([]);
  // alterar — endereço
  const [bairros, setBairros] = useState<any[]>([]);
  // Endereço no editar: canais integrados (Anota Aí / Cardápio Web) guardam só o
  // endereço COMBINADO em `p.endereco` (os campos estruturados vêm vazios) — por isso o
  // "Alterar" não puxava o endereço deles (só puxava do Regem, que preenche os campos).
  // Fallback: se não há nenhum campo estruturado, usa o combinado na linha da rua.
  const semEstruturado = !(p.enderecoRua || p.enderecoNumero || p.enderecoBairro);
  const [endRua, setEndRua] = useState(p.enderecoRua ?? (semEstruturado ? (p.endereco ?? '') : ''));
  const [endNum, setEndNum] = useState(p.enderecoNumero ?? '');
  const [endBairro, setEndBairro] = useState(p.enderecoBairro ?? '');
  const [endBairroId, setEndBairroId] = useState('');
  const [endRef, setEndRef] = useState(p.enderecoReferencia ?? '');
  const [endEditado, setEndEditado] = useState(false);

  // 99food/iFood NÃO podem ser alterados: o marketplace controla o pedido e alterar
  // localmente dessincroniza. Os demais (Regem / Anota Aí / Cardápio Web) podem. (= editavel)
  const podeAlterar = editavel;
  const finalizado = ['concluido', 'cancelado'].includes(p.status);
  // O canal, o cliente ou o sistema cancelou e ninguém disse o que se perdeu: o "Registrar perda" (28/10/2026).
  const perdaPendente = p.status === 'cancelado' && !!p.comandaId && p.estoqueReaproveitado == null;

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
      const res: any = await api.reimprimirDelivery(p.id);
      if (res && typeof res === 'object' && res.enfileirados === 0) {
        toast.error(res.aviso || 'Nenhuma impressora disponível.');
      } else if (res?.aviso) {
        toast.info(res.aviso);
      } else {
        toast.success(`Via reenviada à impressão.${ondeSaiu(res)}`);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro ao reimprimir');
    } finally {
      setBusy(false);
    }
  }

  // Bloco 3: o entregador ligou dizendo que não consegue falar com o cliente — o cliente recebe pelo WhatsApp que o
  // entregador está com o pedido, com o link de onde ele está (o contato do entregador só se ele autorizou no app).
  // Só no pedido de entrega a caminho, do canal do Regem: iFood, 99 e os integrados falam pelo app deles.
  const canalDoRegem = !['ifood', '99food', 'keeta', 'anotaai', 'cardapio_web', 'delivery_direto', 'rappi', 'totem', 'gogem'].includes(
    String(p.canal ?? '').toLowerCase(),
  );
  const podeSemContato = p.tipo === 'entrega' && p.status === 'despachado' && canalDoRegem && !!p.clienteTelefone;
  async function semContato() {
    setBusy(true);
    try {
      const r: any = await api.semContatoDelivery(p.id);
      if (r?.pelaNuvem) toast.success('Pedido à nuvem: o cliente recebe o aviso pelo WhatsApp em instantes.');
      else if (r?.saiu) toast.success('Cliente avisado pelo WhatsApp: o entregador está tentando falar com ele.');
      else toast.error(`O aviso não saiu: ${r?.motivo ?? 'tente de novo'}.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Não foi possível avisar o cliente.');
    } finally {
      setBusy(false);
    }
  }

  async function confirmarCancelamento() {
    if (!senha.trim()) return toast.error('Informe a senha do gestor.');
    setBusy(true);
    try {
      const r: any = await api.cancelarDelivery(p.id, motivo.trim() || undefined, senha, reaproveitado, reaproveitado ? null : perda);
      toast.success(r?.estoqueAviso ? `Pedido cancelado. ${r.estoqueAviso}` : 'Pedido cancelado.');
      avisarEstornoGogem(r);
      avisarComprovante(r);
      onChanged();
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro ao cancelar');
    } finally {
      setBusy(false);
    }
  }

  async function registrarPerda() {
    if (!senha.trim()) return toast.error('Informe a senha do gestor.');
    if (!perda) return toast.error('Espere a lista dos itens carregar.');
    setBusy(true);
    try {
      const r: any = await api.registrarPerdaDelivery(p.id, perda, senha);
      toast.success(r?.aviso ?? 'Perda registrada.');
      onChanged();
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro ao registrar a perda');
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
    setAdicionar((a) => [...a, { produtoId: s.produtoId, label: s.label, observacao: s.observacao, variacaoId: s.variacaoId, complementos: s.complementos }]);
  }

  async function salvarAlteracao() {
    if (remover.size === 0 && adicionar.length === 0 && !endEditado)
      return toast.error('Nenhuma mudança para salvar.');
    setBusy(true);
    try {
      await api.alterarDelivery(p.id, {
        remover: [...remover],
        adicionar: adicionar.map((a) => ({ produtoId: a.produtoId, quantidade: 1, observacao: a.observacao, variacaoId: a.variacaoId, complementos: a.complementos })),
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
      <Card className="my-6 max-h-[90vh] w-full max-w-2xl overflow-y-auto p-5 sm:p-6" onClick={(e) => e.stopPropagation()}>
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
                {p.canal === '99food' && p.tipo === 'retirada' && (p.codigoRetirada ?? p.raw?.takeaway_code) && (
                  <span
                    className="rounded bg-primary/15 px-1.5 py-0.5 font-mono text-[11px] font-bold text-primary"
                    title="Código de retirada da 99Food — confira com o cliente antes de entregar"
                  >
                    Código de retirada {p.codigoRetirada ?? p.raw?.takeaway_code}
                  </span>
                )}
                <span className="ml-auto font-mono text-[11px] text-muted-foreground">{dataHora(p.criadoEm)}</span>
              </p>
              <p className="font-medium">
                {p.clienteNome ?? 'Cliente'}
                {p.clienteTelefone ? <span className="font-normal text-muted-foreground"> · 📞 {p.clienteTelefone}</span> : null}
              </p>
              {enderecoFmt && <p className="text-muted-foreground">📍 {enderecoFmt}{p.enderecoReferencia ? ` (${p.enderecoReferencia})` : ''}</p>}
              {/* A observação GERAL do pedido (mig 346): o recado do cliente ("interfone ruim, ligar ao chegar"). */}
              {p.observacao && (
                <p className="break-words rounded-md border border-warn/40 bg-warn/10 px-2 py-1 text-sm">
                  <span className="font-semibold">📝 Observação do pedido:</span> {p.observacao}
                </p>
              )}
              <p className="text-xs">
                {p.pago ? <span className="font-bold text-ok">Pago</span> : <span className="font-bold text-warn">Paga na entrega</span>}
                {p.formaPagamento ? ` · ${p.formaPagamento}` : ''}
                {p.trocoPara != null && Number(p.trocoPara) > 0 ? ` · troco p/ ${brl(Number(p.trocoPara))}` : ''}
              </p>
              {p.entregadorNome && p.logistica?.modo !== 'logistica_canal' && (
                <p className="text-xs font-medium">🛵 {p.entregadorNome}{p.entregadorTelefone ? ` · 📞 ${p.entregadorTelefone}` : ''}</p>
              )}
              <DetalheEntregadorDoCanal
                l={p.logistica}
                codigoColeta={p.canal === '99food' && p.logistica?.modo === 'logistica_canal' ? p.raw?.handover_code ?? null : null}
              />
              {p.agendamento && <p className="text-xs text-info">🗓 agendado p/ {dataHora(p.agendamento)}</p>}
              {p.cupom && <p className="text-xs text-muted-foreground">🎟 cupom {p.cupom}</p>}
            </div>

            {/* Itens — como no Anota AI (dono, 28/10/2026): o produto em negrito e, embaixo, recuadas, as escolhas (uma
                por linha) e a observação; o valor por linha. */}
            <div className="mt-3 border-t border-border pt-2">
              <ItensDoPedido
                itens={Array.isArray(p.itens) ? p.itens : []}
                valor={(it) => (it.precoUnitario != null ? Number(it.precoUnitario) * Number(it.quantidade ?? 1) : null)}
              />
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

            {/* O que aconteceu com o pedido e o que foi enviado ao canal e ao cliente */}
            <LinhaDoTempoPedido pedidoId={p.id} />

            {/* Ações (ícones) */}
            <div className="mt-4 flex flex-wrap gap-2">
              <IconBtn icon="🖨" label="Reimprimir" onClick={reimprimir} disabled={busy || !p.comandaId} />
              {podeAlterar && <IconBtn icon="✏️" label="Alterar" onClick={() => setModo('alterar')} disabled={busy} />}
              {podeSemContato && <IconBtn icon="📵" label="Sem contato" onClick={semContato} disabled={busy} />}
              {!finalizado && <IconBtn icon="✕" label="Cancelar" tone="destructive" onClick={() => setModo('cancelar')} disabled={busy} />}
              {perdaPendente && <IconBtn icon="🗑️" label="Registrar perda" tone="destructive" onClick={() => setModo('perda')} disabled={busy} />}
            </div>
            {perdaPendente && (
              <p className="mt-2 text-xs text-muted-foreground">
                Este pedido foi cancelado fora da loja (canal, cliente ou sistema): se algo já tinha sido feito, use
                <strong className="text-foreground"> Registrar perda</strong> para tirar do estoque o que se perdeu.
              </p>
            )}
            <Button type="button" variant="ghost" className="mt-2 w-full" onClick={onClose}>Fechar</Button>
          </>
        )}

        {/* ===== CANCELAR ===== */}
        {modo === 'cancelar' && (
          <div className="mt-3">
            <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm font-medium text-destructive">
              Confirmar cancelamento? Esta ação não pode ser desfeita: a venda é estornada, a cozinha é avisada e o pedido não pode ser reaberto.
            </p>
            <div className="mt-3 space-y-3">
              <div className="space-y-1">
                <Label className="text-xs">Motivo</Label>
                <Input value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Ex.: cliente desistiu" autoFocus />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Senha de quem libera (presidente, gerente ou supervisão)</Label>
                <Input {...campoSenha} aria-label="Senha de quem libera (presidente, gerente ou supervisão)" value={senha} onChange={(e) => setSenha(e.target.value)} placeholder="senha de quem libera" />
              </div>
            </div>
            {/* Só o pedido já aceito tem cozinha: perda baixa o insumo do estoque (se a produção
                começou); reutilizado deixa no estoque. O servidor responde o que aconteceu. */}
            {['confirmado', 'pronto', 'despachado', 'entregue'].includes(p.status) && (
              <div className="mt-3 space-y-1.5">
                <p className="text-xs font-medium">O que aconteceu com os insumos deste pedido?</p>
                <div className="flex gap-1.5">
                  <button
                    type="button"
                    aria-pressed={reaproveitado}
                    onClick={() => setReaproveitado(true)}
                    className={`flex-1 rounded-md border px-2 py-1.5 text-xs font-medium ${reaproveitado ? 'border-primary bg-primary/15 text-primary' : 'border-border text-muted-foreground'}`}
                  >
                    ♻️ Reutilizados (ficam no estoque)
                  </button>
                  <button
                    type="button"
                    aria-pressed={!reaproveitado}
                    onClick={() => setReaproveitado(false)}
                    className={`flex-1 rounded-md border px-2 py-1.5 text-xs font-medium ${!reaproveitado ? 'border-destructive bg-destructive/10 text-destructive' : 'border-border text-muted-foreground'}`}
                  >
                    🗑️ Perda (saem do estoque)
                  </button>
                </div>
                {/* Perda parcial (dono, 28/10/2026): o que não se perdeu, desmarca-se. */}
                {!reaproveitado && <ItensDaPerda pedidoId={p.id} onChange={setPerda} />}
              </div>
            )}
            <div className="mt-4 flex gap-2">
              <Button type="button" variant="ghost" className="flex-1" onClick={() => setModo('view')}>Voltar</Button>
              <Button type="button" className="flex-1 bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={confirmarCancelamento} disabled={busy}>
                {busy ? '…' : 'Confirmar cancelamento'}
              </Button>
            </div>
          </div>
        )}

        {/* ===== REGISTRAR PERDA (pedido cancelado fora da loja) ===== */}
        {modo === 'perda' && (
          <div className="mt-3 space-y-3">
            <p className="rounded-lg bg-warn/10 px-3 py-2 text-sm font-medium text-foreground">
              O pedido foi cancelado sem ninguém da loja dizer o que se perdeu. Marque o que já tinha sido feito: sai do
              estoque e vai para Estoque › Desperdício. Dá para registrar uma vez só.
            </p>
            <ItensDaPerda pedidoId={p.id} onChange={setPerda} />
            <div className="space-y-1">
              <Label className="text-xs">Senha de quem libera (presidente, gerente ou supervisão)</Label>
              <Input {...campoSenha} aria-label="Senha de quem libera (presidente, gerente ou supervisão)" value={senha} onChange={(e) => setSenha(e.target.value)} placeholder="senha de quem libera" />
            </div>
            <div className="flex gap-2">
              <Button type="button" variant="ghost" className="flex-1" onClick={() => setModo('view')}>Voltar</Button>
              <Button type="button" className="flex-1 bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={registrarPerda} disabled={busy || !perda}>
                {busy ? '…' : 'Registrar perda'}
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
