// PEDIDO IGUAL em até 30 min (mig 360; pedido do dono, 03/11/2026 — protótipo `mockups/regem-alteracao-pedido.html`):
// os textos do aviso de "possível repetido" na tela da loja. A marca vem do servidor (`repetido` em cada pedido do
// painel); a regra do que é "igual" está só lá (`backend/src/modules/pedido-repetido/pedido-repetido.ts`).
import { hora } from '@/lib/atendimento';

export type MarcaDoRepetido = {
  pedidoId: string;
  deId: string;
  deNumero: number | null;
  deDisplayId: string | null;
  deEm: string | null;
  /** Quem confirmou "São dois pedidos" e quando; null = a marca está aberta. */
  ok: { porNome: string | null; em: string } | null;
};

/** A hora (HH:MM) no fuso da loja. */
export const horaCurta = (iso: string | null | undefined) => hora(iso);

/** "pedido #127 (19:46)" — ou o que se souber do outro pedido. */
export function textoDoOutroPedido(m: { deNumero: number | null; deEm: string | null }): string {
  const n = m.deNumero != null ? `pedido #${m.deNumero}` : 'outro pedido do mesmo cliente';
  const h = horaCurta(m.deEm);
  return h ? `${n} (${h})` : n;
}

/** A marca ainda aberta (sem o "São dois pedidos")? */
export const repetidoAberto = (m: MarcaDoRepetido | null | undefined) => !!m && !m.ok;
