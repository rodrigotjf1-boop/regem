// QUEM RESPONDE pelo chat de um canal numa loja (mig 366). A ponte pode estar em mais de um PC (o do delivery, o servidor
// da loja): todas leem, uma só ENVIA — senão o cliente recebe a mesma mensagem duas vezes. Regra ÚNICA, usada pela fila
// de saída (`pegar`) e pelo sinal de vida (`estado`), para a ponte saber o papel dela.
//
// Viva = deu sinal há no máximo 2 min E está logada naquela plataforma. Entre as vivas: a "principal" escolhida nos
// ajustes; senão as "automáticas"; senão a "reserva". Empate: a ponte pareada primeiro (estável — o papel não fica
// trocando de PC a cada sinal). A 99 aceita um login só (ERR-365): na prática há uma ponte viva nela.

export const VIVA_POR_MS = 2 * 60_000;

export type Papel = 'auto' | 'principal' | 'reserva';

export type PonteCandidata = {
  id: string;
  papel: Papel;
  /** Último sinal (ms). */
  vistoEm: number;
  /** Logada na plataforma do canal em questão, pelo último sinal. */
  logada: boolean;
  /** Quando foi cadastrada (ms) — desempate estável. */
  criadaEm: number;
};

const ORDEM: Record<Papel, number> = { principal: 0, auto: 1, reserva: 2 };

export function quemResponde(pontes: readonly PonteCandidata[], agora: number): string | null {
  const vivas = pontes.filter((p) => p.logada && agora - p.vistoEm <= VIVA_POR_MS);
  if (!vivas.length) return null;
  const [primeira] = [...vivas].sort(
    (a, b) => ORDEM[a.papel] - ORDEM[b.papel] || a.criadaEm - b.criadaEm || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
  return primeira.id;
}

export const CANAIS = ['ifood', '99food'] as const;
export type CanalDaPonte = (typeof CANAIS)[number];
export const ehCanalDaPonte = (c: unknown): c is CanalDaPonte => CANAIS.includes(c as CanalDaPonte);
