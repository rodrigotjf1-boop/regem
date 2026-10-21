import { AsyncLocalStorage } from 'node:async_hooks';
import type { ChamadaAtual } from './hub.regras';

// A CHAMADA DA API DE INTEGRAÇÃO que está sendo atendida, para o registro central do hub (Padrão §10; Hub DMS F3, A2).
//
// O registro junta o que só partes diferentes sabem: a duração (o middleware), quem chamou e por qual credencial (o
// guard e a troca), o problema da recusa e o erro inesperado (o filtro do Padrão). Cada parte anota no mesmo lugar — o
// `AsyncLocalStorage` do pedido — e o middleware monta o registro quando a resposta termina. Nunca o conteúdo: nem
// parâmetro, nem resposta, nem segredo.

const armazem = new AsyncLocalStorage<ChamadaAtual>();

/** Roda `fn` (o resto do pedido) com esta chamada como a atual. */
export function comChamada<T>(chamada: ChamadaAtual, fn: () => T): T {
  return armazem.run(chamada, fn);
}

/** A chamada em atendimento, ou nada (fora da API de integração). */
export function chamadaAtual(): ChamadaAtual | undefined {
  return armazem.getStore();
}

type Anotavel = Omit<ChamadaAtual, 'inicio'>;

/** Anota na chamada atual. Fora da API de integração, não faz nada. Campo indefinido não apaga o que já estava. */
export function anotarChamada(campos: Anotavel): void {
  const atual = armazem.getStore();
  if (!atual) return;
  for (const [campo, valor] of Object.entries(campos) as Array<[keyof Anotavel, never]>) {
    if (valor !== undefined) atual[campo] = valor;
  }
}
