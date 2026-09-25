// Depois de cancelar uma venda do TOTEM, o Regem pede ao GoGeM o estorno do cartão/PIX (só ele
// tem as credenciais do Mercado Pago). A resposta do cancelamento traz `estornoGogem`, e o
// operador PRECISA ver: às vezes quem devolve o dinheiro é ele, no balcão, ou o estorno ficou
// para quando a conexão voltar. Um lugar só para as quatro telas que cancelam.
import { toast } from '@/lib/toast';

export type EstornoGogem = {
  situacao: 'solicitado' | 'sem_estorno_eletronico' | 'pendente' | 'integracao_recusou' | 'recusado';
  mensagem: string;
};

/** Mostra o resultado do pedido de estorno ao GoGeM, se a resposta do cancelamento trouxer um. */
export function avisarEstornoGogem(resposta: unknown) {
  const e = (resposta as { estornoGogem?: EstornoGogem } | null)?.estornoGogem;
  if (!e?.mensagem) return;
  if (e.situacao === 'solicitado') toast.success(e.mensagem, 8000);
  else if (e.situacao === 'integracao_recusou' || e.situacao === 'recusado') toast.error(e.mensagem, 15000);
  else toast.info(e.mensagem, 12000);
}
