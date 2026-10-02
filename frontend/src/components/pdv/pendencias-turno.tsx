'use client';

import { useState } from 'react';
import { api } from '@/lib/api';
import { toast } from '@/lib/toast';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';

/* eslint-disable @typescript-eslint/no-explicit-any */

// PENDÊNCIAS DO TURNO — o passo que aparece ANTES da contagem quando há pedido sem baixa:
//   • turno do delivery: entrega pendente BARRA o fechamento (gerente/presidente fecha escrevendo
//     o motivo — o servidor confere de novo);
//   • turno do balcão: retirada pendente só AVISA — resolver agora ou deixar para o próximo turno.
// Pedido parado há mais de 24 h pode ser baixado de uma vez pelo gerente/presidente.

export interface PendenciasDoTurno {
  escopo: 'delivery' | 'pdv';
  total: number;
  antigas: number;
  baixaveis: number;
  horasAntiga: number;
  bloqueia: boolean;
  gestor: boolean;
  justificativaMinima: number;
  itens: { id: string; numero: string | null; canal: string; tipo: string; status: string; clienteNome: string | null; total: number; pago: boolean; criadoEm: string; agendamento: string | null; antiga: boolean }[];
}

const brl = (n: number) => Number(n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const STATUS: Record<string, string> = { novo: 'Aguardando aceite', confirmado: 'Em preparo', pronto: 'Pronto', despachado: 'Em rota', entregue: 'Entregue, falta conferir' };
const CANAL: Record<string, string> = { ifood: 'iFood', '99food': '99Food', anotaai: 'Anota AI', cardapio_web: 'Cardápio Web', cardapio: 'Cardápio', totem: 'Totem', manual: 'Manual', open_delivery: 'Open Delivery', delivery_direto: 'Delivery Direto' };

function ha(desde: string): string {
  const min = Math.max(0, Math.round((Date.now() - new Date(desde).getTime()) / 60_000));
  if (min < 60) return `há ${min} min`;
  const h = Math.round(min / 60);
  if (h < 48) return `há ${h} h`;
  return `há ${Math.round(h / 24)} dias`;
}

export function PendenciasTurno({
  dados,
  onAtualizar,
  onResolver,
  onSeguir,
}: {
  dados: PendenciasDoTurno;
  /** A lista mudou (depois da baixa das antigas); pode ter zerado. */
  onAtualizar: (d: PendenciasDoTurno) => void;
  /** Sair do fechamento para resolver os pedidos. */
  onResolver: () => void;
  /** Seguir para a contagem; no delivery com pendência, leva o motivo do gestor. */
  onSeguir: (justificativa?: string) => void;
}) {
  const [motivo, setMotivo] = useState('');
  const [confirmarBaixa, setConfirmarBaixa] = useState(false);
  const [busy, setBusy] = useState(false);
  const delivery = dados.escopo === 'delivery';
  const coisa = delivery ? 'entrega' : 'retirada';
  const n = dados.total;
  const motivoOk = motivo.replace(/\s+/g, ' ').trim().length >= dados.justificativaMinima;

  async function baixarAntigas() {
    setBusy(true);
    try {
      const r: any = await api.baixarPendenciasAntigas(dados.escopo);
      const feitos = (r?.concluidos ?? 0) + (r?.cancelados ?? 0);
      toast.success(
        feitos === 0
          ? 'Nenhum pedido antigo para baixar.'
          : `${feitos} pedido(s) baixado(s): ${r.concluidos} concluído(s) e ${r.cancelados} cancelado(s) por nunca terem sido aceitos.`,
      );
      setConfirmarBaixa(false);
      if (r?.pendencias) onAtualizar(r.pendencias as PendenciasDoTurno);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Não foi possível baixar as pendências.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <h3 className="font-display font-semibold">
        {n === 1 ? `1 ${coisa} ainda não foi baixada` : `${n} ${coisa}s ainda não foram baixadas`}
      </h3>
      <p className="mb-3 mt-0.5 text-xs text-muted-foreground">
        {delivery
          ? 'O turno do delivery só fecha com todos os pedidos concluídos ou cancelados.'
          : 'Resolva agora na tela Retirada / Encomendas (entregar, cobrar ou cancelar) ou deixe para o próximo turno.'}
      </p>

      <div className="max-h-56 overflow-y-auto rounded-md border border-border">
        <table className="w-full text-sm">
          <caption className="sr-only">Pedidos pendentes neste turno</caption>
          <tbody>
            {dados.itens.map((p) => (
              <tr key={p.id} className="border-b border-border last:border-0">
                <td className="py-1.5 pl-2 pr-1 align-top font-mono text-xs font-bold">{p.numero ? `#${p.numero}` : '—'}</td>
                <td className="px-1 py-1.5">
                  <div className="truncate font-medium">{p.clienteNome || 'Cliente'}</div>
                  <div className="text-xs text-muted-foreground">
                    {STATUS[p.status] ?? p.status} · {CANAL[p.canal] ?? p.canal} · {ha(p.agendamento ?? p.criadoEm)}
                  </div>
                </td>
                <td className="py-1.5 pl-1 pr-2 text-right align-top">
                  <div className="font-mono text-xs">{brl(p.total)}</div>
                  {!p.pago && <div className="text-[11px] font-semibold text-warn">a receber</div>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {n > dados.itens.length && <p className="mt-1 text-[11px] text-muted-foreground">Mostrando os {dados.itens.length} mais recentes de {n}.</p>}

      {dados.baixaveis > 0 && (
        <div className="mt-3 rounded-md border border-warn/40 bg-warn/10 p-3 text-xs">
          <p className="font-semibold">
            {dados.baixaveis === 1 ? '1 pedido está parado' : `${dados.baixaveis} pedidos estão parados`} há mais de {dados.horasAntiga} horas.
          </p>
          {!dados.gestor ? (
            <p className="mt-1 text-muted-foreground">Um gerente ou o presidente pode baixá-los de uma vez.</p>
          ) : !confirmarBaixa ? (
            <Button type="button" size="sm" variant="outline" className="mt-2" onClick={() => setConfirmarBaixa(true)}>
              Baixar pendências antigas
            </Button>
          ) : (
            <>
              <p className="mt-1 text-muted-foreground">
                Os pedidos aceitos passam a <strong>concluídos</strong> e os que nunca foram aceitos, a <strong>cancelados</strong>. É só o registro que fecha:{' '}
                <strong>não baixa estoque, não mexe no caixa e não avisa o canal nem o cliente</strong>. Pedido em rota fica de fora. A baixa fica na auditoria.
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                <Button type="button" size="sm" onClick={baixarAntigas} disabled={busy}>
                  {busy ? 'Baixando…' : 'Confirmar baixa'}
                </Button>
                <Button type="button" size="sm" variant="ghost" onClick={() => setConfirmarBaixa(false)} disabled={busy}>
                  Cancelar
                </Button>
              </div>
            </>
          )}
        </div>
      )}

      {delivery ? (
        <>
          {dados.gestor ? (
            <div className="mt-3 space-y-1">
              <Label className="text-xs" htmlFor="pend-motivo">
                Fechar mesmo assim? Escreva o motivo (fica na auditoria)
              </Label>
              <textarea
                id="pend-motivo"
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
                rows={2}
                maxLength={300}
                placeholder="Ex.: entregador sem sinal; pedido será conferido amanhã"
                className="w-full rounded-md border border-input bg-card px-3 py-2 text-sm"
              />
            </div>
          ) : (
            <p className="mt-3 rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
              Conclua ou cancele os pedidos no painel. Se não for possível, chame um gerente: ele pode fechar o turno informando o motivo.
            </p>
          )}
          <div className="mt-4 flex gap-2">
            <Button type="button" variant="ghost" className="flex-1" onClick={onResolver}>
              Voltar ao painel
            </Button>
            {dados.gestor && (
              <Button type="button" className="flex-1" disabled={!motivoOk} onClick={() => onSeguir(motivo.replace(/\s+/g, ' ').trim())}>
                Fechar com pendência
              </Button>
            )}
          </div>
        </>
      ) : (
        <div className="mt-4 flex flex-col gap-2 sm:flex-row">
          <Button type="button" variant="outline" className="flex-1" onClick={onResolver}>
            Resolver agora
          </Button>
          <Button type="button" className="flex-1" onClick={() => onSeguir()}>
            Deixar pendentes e fechar
          </Button>
        </div>
      )}
    </>
  );
}
