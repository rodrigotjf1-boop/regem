'use client';

import { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { toast } from '@/lib/toast';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  DESCRICAO_DO_CANAL,
  NOME_NA_FRASE,
  faltamTexto,
  naHoraDoAviso,
  relogioDaPausa,
  segundosAte,
  type EstadoDasPausas,
} from '@/lib/pausa-dos-pedidos';

const hora = (iso: string | null) =>
  iso ? new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '';

/**
 * Uma faixa por canal pausado no painel do Delivery (mig 392; protótipo `mockups/regem-pausa.html`): o motivo, quem
 * pausou e quando, a hora de reabrir e — F2, mig 393 — o CONTADOR REGRESSIVO até a reabertura. Quando faltar o tempo do
 * aviso (Ajustes › Atendimento › "Pausa dos pedidos", padrão 5 min), a faixa fica vermelha e o painel toca o som UMA vez
 * por pausa (com o "🔔 Som" ligado). O gestor reabre na hora ou estende (+10 / +30 min). No fim do tempo a faixa some.
 */
export function FaixasDaPausa({
  estado,
  podeReabrir,
  aoMudar,
  aoAvisar,
  aoAcabar,
}: {
  estado: EstadoDasPausas | null;
  podeReabrir: boolean;
  aoMudar: (novo: EstadoDasPausas) => void;
  /** Toca o som do aviso; devolve se tocou (o "🔔 Som" do painel pode estar desligado). */
  aoAvisar?: (som: 'bipe' | 'campainha') => boolean;
  /** O tempo de uma pausa acabou: a tela relê o estado (a faixa some). */
  aoAcabar?: () => void;
}) {
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [agora, setAgora] = useState(() => Date.now());
  // Uma vez por pausa (canal + fim): o aviso toca uma vez, o "acabou" relê uma vez. Estender muda o fim = pausa nova.
  const avisadas = useRef(new Map<string, boolean>());
  const acabadas = useRef(new Set<string>());
  const pausados = (estado?.canais ?? []).filter((c) => c.pausa);
  const temPausa = pausados.length > 0;

  useEffect(() => {
    if (!temPausa) return;
    setAgora(Date.now());
    const t = setInterval(() => setAgora(Date.now()), 1000);
    return () => clearInterval(t);
  }, [temPausa]);

  const avisoMin = estado?.aviso?.minutos;
  useEffect(() => {
    for (const c of pausados) {
      const chave = `${c.canal}|${c.pausa!.ate}`;
      const seg = segundosAte(c.pausa!.ate, agora);
      if (naHoraDoAviso(seg, avisoMin) && !avisadas.current.has(chave)) {
        avisadas.current.set(chave, aoAvisar ? aoAvisar(estado?.aviso?.som ?? 'bipe') : false);
      }
      if (seg === 0 && !acabadas.current.has(chave)) {
        acabadas.current.add(chave);
        aoAcabar?.();
      }
    }
  });

  if (!temPausa) return null;

  async function agir(canal: string, fn: () => Promise<unknown>, ok: string) {
    setOcupado(canal);
    try {
      aoMudar((await fn()) as EstadoDasPausas);
      toast.success(ok);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Não deu para fazer isso agora.');
    } finally {
      setOcupado(null);
    }
  }

  const estender = estado?.minutosParaEstender?.length ? estado.minutosParaEstender : [];
  return (
    <div className="flex flex-col gap-2">
      {pausados.map((c) => {
        const p = c.pausa!;
        const seg = segundosAte(p.ate, agora);
        const logo = naHoraDoAviso(seg, avisoMin);
        const tocou = avisadas.current.get(`${c.canal}|${p.ate}`) === true;
        const quem = [p.pausadoEm && `pausado às ${hora(p.pausadoEm)}`, p.pausadoPorNome && `por ${p.pausadoPorNome}`].filter(Boolean).join(' ');
        return (
          <div
            key={c.canal}
            className={cn(
              'flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border px-4 py-2',
              logo ? 'border-destructive bg-destructive/10' : 'border-warn/50 bg-warn/10',
            )}
          >
            <div className="min-w-0 flex-1 basis-56">
              <p className="text-sm font-bold">
                {/* Tinta sobre o laranja: 4,7:1 (o branco ficava em 3,3:1). */}
                <span className="mr-2 rounded bg-warn px-1.5 py-0.5 text-xs font-bold text-foreground">⏸ {c.nome}</span>
                Pausado · {p.rotulo}
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {[DESCRICAO_DO_CANAL[c.canal], quem, `reabre ${p.volta.texto}`].filter(Boolean).join(' · ')}
              </p>
            </div>
            <div className="text-center">
              <span className="block font-mono text-2xl font-bold leading-none tabular-nums" aria-label={`tempo até reabrir: ${relogioDaPausa(seg)}`}>
                {relogioDaPausa(seg)}
              </span>
              <small className="text-xs text-muted-foreground">até reabrir</small>
            </div>
            {podeReabrir && (
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  disabled={ocupado === c.canal}
                  onClick={() => agir(c.canal, () => api.deliveryReabrir(c.canal), 'Reaberto: o canal voltou a receber pedidos')}
                >
                  {ocupado === c.canal ? 'Aguarde…' : 'Reabrir agora'}
                </Button>
                {estender.map((m) => (
                  <Button
                    key={m}
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={ocupado === c.canal}
                    onClick={() => agir(c.canal, () => api.deliveryEstender(c.canal, m), `Pausa estendida em ${m} min`)}
                  >
                    +{m} min
                  </Button>
                ))}
              </div>
            )}
            {logo && (
              <p role="alert" className="flex w-full items-center gap-2 text-sm font-semibold">
                <span aria-hidden="true">🔔</span>
                {faltamTexto(seg)} para reabrir {NOME_NA_FRASE[c.canal] ?? 'o canal'}
                {tocou ? ' — o painel tocou o aviso.' : '.'}
                {podeReabrir ? ' Reabra ou estenda.' : ''}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}
