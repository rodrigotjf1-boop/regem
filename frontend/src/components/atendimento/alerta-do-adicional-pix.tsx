'use client';

import type { AlertaDoAdicionalPix } from '@/lib/atendimento';

// O ALERTA "SEGURE O PEDIDO" no topo da tela Atendimento (mig 373; pedido do dono de 06/11/2026): o robô pôs um item num
// pedido do cardápio já pago no Pix e espera o Pix da diferença (vale 5 min). Fora da fila — não é caso: some quando o
// Pix vence ou a mudança entra (a via "PEDIDO ALTERADO" sai). O texto vem do servidor (`adicional-pix.ts`, textoDoAlerta);
// aqui só o tempo que falta. `null` (não li) ou lista vazia: nada.

/** "4:12" — o que falta para o Pix vencer; `agora` só existe depois de montar (V35). */
export function faltaParaVencer(expiraEm: string, agora: number | null): string | null {
  if (agora === null) return null;
  const s = Math.max(0, Math.floor((new Date(expiraEm).getTime() - agora) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function AlertaDoAdicionalPix({ alertas, agora }: { alertas: AlertaDoAdicionalPix[] | null; agora: number | null }) {
  if (!alertas?.length) return null;
  return (
    <div className="flex flex-col gap-2" role="alert" aria-live="polite" data-alerta="adicional-pix">
      {alertas.map((a) => {
        const falta = a.situacao === 'aguardando' ? faltaParaVencer(a.expiraEm, agora) : null;
        return (
          <div
            key={a.id}
            className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-warn/50 bg-warn/10 px-3 py-2 text-sm"
            data-situacao={a.situacao}
          >
            <span className="rounded-full bg-warn/20 px-2 py-0.5 text-xs font-bold text-foreground">
              ✋ Segure o pedido{a.numero ? ` #${a.numero}` : ''}
            </span>
            <span className="min-w-0 flex-1 basis-64 break-words">{a.texto}</span>
            {falta && (
              <span className="font-mono text-xs font-semibold tabular-nums" aria-label={`O Pix vence em ${falta}`}>
                ⏱ {falta}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
