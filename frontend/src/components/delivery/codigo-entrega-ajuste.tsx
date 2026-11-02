'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialogo } from '@/components/ui/sobreposto';

// Por que manter o código (o informativo pedido pelo dono, 01/11/2026). Cada frase tem a regra que a sustenta: o
// entregador só conclui com o código (`EntregadorService.finalizar`); sem ele, o "entregue" é só o toque do entregador
// (`DeliveryService.marcarEntregue`, sem conferência).
export const MOTIVO_DO_CODIGO =
  'O código confirma que o pedido chegou à pessoa certa e marca a hora exata da entrega. Sem ele, o "entregue" depende só do toque do entregador: o tempo de cada etapa (preparo, espera, saída e entrega) fica menos confiável para decidir escala, área de entrega e taxa.';

// O ajuste "Usar o código de entrega" (mig 348). Ligado de padrão; desligar pede confirmação com o motivo de manter.
// Desligado, só os pedidos NOVOS nascem sem código (o gatilho da mig 348): os que já estão em andamento seguem com o deles.
export function CodigoEntregaAjuste({
  usar,
  pode,
  salvando,
  aoMudar,
}: {
  usar: boolean;
  pode: boolean;
  salvando: boolean;
  aoMudar: (usar: boolean) => void;
}) {
  const [confirmar, setConfirmar] = useState(false);
  const bloqueado = !pode || salvando;
  return (
    <div className="space-y-3">
      <label className={`flex items-start gap-3 rounded-lg border border-border p-3 ${bloqueado ? 'opacity-60' : ''}`}>
        <input
          id="usar-codigo-entrega"
          type="checkbox"
          className="mt-0.5 h-4 w-4 flex-none accent-primary"
          disabled={bloqueado}
          checked={usar}
          onChange={(e) => (e.target.checked ? aoMudar(true) : setConfirmar(true))}
        />
        <div className="min-w-0">
          <p className="text-sm font-medium">Usar o código de entrega</p>
          <p className="text-xs text-muted-foreground">
            Ligado: o cliente recebe um código de 4 dígitos e o entregador só conclui a entrega com ele. Desligado: os
            pedidos novos saem sem código; os que já estão em andamento seguem com o deles. Vale para as entregas do
            cardápio digital, do robô e do pedido feito no painel — iFood e 99 usam o código deles.
          </p>
        </div>
      </label>
      <div role="note" className="rounded-lg border border-border bg-secondary p-3">
        <p className="text-sm font-semibold">Por que manter o código</p>
        <p className="mt-1 text-xs text-secondary-foreground">{MOTIVO_DO_CODIGO}</p>
      </div>
      {confirmar && (
        <Dialogo
          titulo="Desligar o código de entrega?"
          alerta
          aoFechar={() => setConfirmar(false)}
          voltarPara="usar-codigo-entrega"
          rodape={
            <>
              <Button type="button" variant="outline" onClick={() => setConfirmar(false)}>
                Manter o código
              </Button>
              <Button
                type="button"
                onClick={() => {
                  setConfirmar(false);
                  aoMudar(false);
                }}
              >
                Desligar o código
              </Button>
            </>
          }
        >
          <p className="text-sm">{MOTIVO_DO_CODIGO}</p>
          <p className="mt-2 text-sm text-muted-foreground">
            Os pedidos novos saem sem código. Os que já estão em andamento seguem com o deles.
          </p>
        </Dialogo>
      )}
    </div>
  );
}
