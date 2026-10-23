// O COMPROVANTE de uma operação (o cancelamento, por ora) é impresso pelo servidor, que devolve na resposta se ele saiu
// (`comprovante: { enfileirados, aviso }`). Antes a falha era engolida e ninguém sabia que o papel não tinha saído. Um
// lugar só para as telas que cancelam.
import { toast } from '@/lib/toast';

export type Comprovante = { enfileirados: number; aviso: string | null };

/** Avisa quando o comprovante não saiu (ou saiu com ressalva); sem comprovante na resposta, nada. */
export function avisarComprovante(resposta: unknown, oQue = 'O comprovante do cancelamento') {
  const c = (resposta as { comprovante?: Comprovante } | null)?.comprovante;
  if (!c) return;
  if (!c.enfileirados) toast.error(`${oQue} não foi impresso${c.aviso ? `: ${c.aviso}` : '.'}`, 12000);
  else if (c.aviso) toast.info(c.aviso, 8000);
}
