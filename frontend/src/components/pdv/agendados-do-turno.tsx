'use client';

import { Button } from '@/components/ui/button';

/* eslint-disable @typescript-eslint/no-explicit-any */

// "VÃO FECHAR O TURNO COM AGENDADO PARA DEPOIS" (mig 455, D4b — protótipo, parte 2, G8): o Regem pergunta um por um e não
// fecha sem a resposta — "Manter" fica marcado aqui; mudar o horário ou cancelar é no painel do Delivery (o pedido sai da
// lista). O servidor confere de novo ao fechar (409 AGENDADOS_DO_TURNO).

const SP = 'America/Sao_Paulo';
const quando = (iso: string) =>
  new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: SP });

export function AgendadosDoTurno({
  agendados,
  mantidos,
  aoMudar,
  onResolver,
  onSeguir,
  onCancelar,
}: {
  agendados: any[];
  mantidos: Set<string>;
  aoMudar: (id: string, manter: boolean) => void;
  onResolver: () => void;
  onSeguir: () => void;
  onCancelar: () => void;
}) {
  const todos = agendados.every((a) => mantidos.has(String(a.id)));
  return (
    <div className="space-y-3">
      <div>
        <h3 className="font-display font-semibold">Pedidos agendados para depois</h3>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {agendados.length === 1 ? 'Há 1 pedido agendado' : `Há ${agendados.length} pedidos agendados`} para depois deste turno. Diga o
          que acontece com cada um antes de fechar: manter, mudar o horário ou cancelar (os dois últimos no painel do Delivery).
        </p>
      </div>
      <ul className="max-h-64 space-y-2 overflow-y-auto">
        {agendados.map((a) => {
          const id = String(a.id);
          return (
            <li key={`agendado-turno-${id}`} className="rounded-lg border border-border p-2.5">
              <p className="text-sm font-semibold">
                Pedido {a.numero ?? ''} · {quando(a.agendamento)}
              </p>
              <p className="text-xs text-muted-foreground">
                {a.clienteNome ?? 'Cliente'} · {a.tipo === 'entrega' ? 'Entrega' : 'Retirada'}
              </p>
              <label htmlFor={`agendado-manter-${id}`} className="mt-1.5 flex items-center gap-2 text-sm">
                <input id={`agendado-manter-${id}`} type="checkbox" className="h-4 w-4 accent-primary" checked={mantidos.has(id)} onChange={(e) => aoMudar(id, e.target.checked)} />
                Manter para {quando(a.agendamento)}
              </label>
            </li>
          );
        })}
      </ul>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="ghost" onClick={onCancelar}>Cancelar</Button>
        <Button type="button" variant="outline" onClick={onResolver}>Mudar ou cancelar no painel</Button>
        <Button type="button" onClick={onSeguir} disabled={!todos}>Seguir para a contagem</Button>
      </div>
    </div>
  );
}
