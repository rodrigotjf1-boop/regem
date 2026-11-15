// O SERVIDOR DA LOJA SEM FALAR COM A NUVEM (F1.4 do docs/plano-mister.md — o alerta local; protótipo
// mockups/regem-dependencias-e-qualidade.html, vista "Loja sem internet").
//
// O sync-daemon grava no `sync_state` do próprio servidor quando o envio começou a falhar (`sync_falhando_desde`) e o
// último ciclo que deu certo (`sync_ultimo_ok`). A tela da loja lê pela presença do PC (a cada 30 s) e mostra a faixa.
// A venda local continua; o que para é o que vem pela nuvem (iFood, 99, cardápio digital) e os avisos do Mister.

/** Falhando há este tempo = sem conexão (um ciclo ruim é um piscar da rede; o ciclo do daemon é de 1 minuto). */
export const SEM_NUVEM_APOS_MS = 2 * 60_000;
/** Nenhum ciclo certo há este tempo = o envio parou (o daemon caiu ou travou), mesmo sem marcar a falha. */
export const ENVIO_PARADO_APOS_MS = 5 * 60_000;

const instante = (v: string | null | undefined): number | null => {
  if (!v) return null;
  const t = new Date(v).getTime();
  return Number.isNaN(t) ? null : t;
};

/**
 * Desde quando o servidor da loja está sem falar com a nuvem (ISO) — ou null quando está falando, ou quando ainda não
 * se sabe (servidor recém-instalado, sem nenhum ciclo anotado: não acusa).
 */
export function semConexaoComANuvem(falhandoDesde: string | null | undefined, ultimoOk: string | null | undefined, agora = Date.now()): string | null {
  const falha = instante(falhandoDesde);
  if (falha !== null && agora - falha >= SEM_NUVEM_APOS_MS) return new Date(falha).toISOString();
  if (falha !== null) return null; // falhando há pouco: ainda pode ser um piscar
  const ok = instante(ultimoOk);
  if (ok !== null && agora - ok >= ENVIO_PARADO_APOS_MS) return new Date(ok).toISOString();
  return null;
}
