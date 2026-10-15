// Marca do cupom que parou no meio (sem papel, tampa aberta, papel preso) e sai de novo INTEIRO —
// decisão do dono em 15/10/2026, para ninguém fazer o pedido duas vezes. A MESMA linha do servidor
// da loja (`backend/edge/impressao-fila.mjs › MARCA_REIMPRESSAO`); o teste confere as duas.
export const MARCA_REIMPRESSAO = '@CB *** REIMPRESSÃO ***';

// Estados que a impressora pode informar (mig 324) — o que a estação manda na batida.
export const ESTADOS_IMPRESSORA = [
  'pronta',
  'papel_acabando',
  'sem_papel',
  'tampa_aberta',
  'erro',
  'parada',
  'sem_resposta',
] as const;
