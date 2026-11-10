'use client';

import { useState } from 'react';
import { api } from '@/lib/api';
import { toast } from '@/lib/toast';
import { Button } from '@/components/ui/button';
import { DESCRICAO_DO_CANAL, type EstadoDasPausas } from '@/lib/pausa-dos-pedidos';

const hora = (iso: string | null) =>
  iso ? new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '';

/**
 * Uma faixa por canal pausado no painel do Delivery (mig 392; protótipo `mockups/regem-pausa.html`): o motivo, quem
 * pausou e quando, e a hora de reabrir. O gestor reabre na hora. Some sozinha quando o tempo passa (a próxima leitura).
 */
export function FaixasDaPausa({
  estado,
  podeReabrir,
  aoMudar,
}: {
  estado: EstadoDasPausas | null;
  podeReabrir: boolean;
  aoMudar: (novo: EstadoDasPausas) => void;
}) {
  const [reabrindo, setReabrindo] = useState<string | null>(null);
  const pausados = (estado?.canais ?? []).filter((c) => c.pausa);
  if (!pausados.length) return null;

  async function reabrir(canal: string) {
    setReabrindo(canal);
    try {
      aoMudar((await api.deliveryReabrir(canal)) as EstadoDasPausas);
      toast.success('Reaberto: o canal voltou a receber pedidos');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Não deu para reabrir.');
    } finally {
      setReabrindo(null);
    }
  }

  return (
    <div className="flex flex-col gap-2" aria-live="polite">
      {pausados.map((c) => {
        const p = c.pausa!;
        const quem = [p.pausadoEm && `pausado às ${hora(p.pausadoEm)}`, p.pausadoPorNome && `por ${p.pausadoPorNome}`].filter(Boolean).join(' ');
        return (
          <div key={c.canal} className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-warn/50 bg-warn/10 px-4 py-2">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold">
                {/* Tinta sobre o laranja: 4,7:1 (o branco ficava em 3,3:1). */}
                <span className="mr-2 rounded bg-warn px-1.5 py-0.5 text-xs font-bold text-foreground">⏸ {c.nome}</span>
                Pausado · {p.rotulo}
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {[DESCRICAO_DO_CANAL[c.canal], quem, `reabre ${p.volta.texto}`].filter(Boolean).join(' · ')}
              </p>
            </div>
            {podeReabrir && (
              <Button type="button" size="sm" onClick={() => reabrir(c.canal)} disabled={reabrindo === c.canal}>
                {reabrindo === c.canal ? 'Reabrindo…' : 'Reabrir agora'}
              </Button>
            )}
          </div>
        );
      })}
    </div>
  );
}
