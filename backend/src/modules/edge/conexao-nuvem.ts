// O SERVIDOR DA LOJA SEM FALAR COM A NUVEM (F1.4 do docs/plano-mister.md — o alerta local; protótipo
// mockups/regem-dependencias-e-qualidade.html, vista "Loja sem internet").
//
// UMA regra para os dois lugares que mostram isso (V74): o ícone do servidor na bandeja (`bandeja.service.ts`) e a faixa
// "sem conexão com a nuvem" nas telas do servidor (a presença do PC, `EdgeService.conexaoComANuvem`). A fonte é a anotação
// que o sync-daemon faz a CADA BATIDA com a nuvem (`sync_state.nuvem_contato` = { okEm, falhandoDesde }): é o contato com
// a nuvem — o que decide se os pedidos do iFood, da 99 e do cardápio chegam —, não o ciclo de sincronismo.
// A venda local continua; o que para é o que vem pela nuvem e os avisos do Mister.

/** Falhando há este tempo = sem conexão (uma batida ruim é um piscar da rede). */
export const SEM_NUVEM_APOS_MS = 2 * 60_000;
/** Nenhum contato certo há este tempo = sem conexão, mesmo sem a falha anotada (o daemon caiu ou travou). */
export const ENVIO_PARADO_APOS_MS = 5 * 60_000;

export type SituacaoDaNuvem = {
  situacao: 'ok' | 'falhando' | 'sem_informacao';
  /** falhando: 'falha' (a batida falha) ou 'sem_noticia' (nenhum contato certo há 5 min). */
  motivo: 'falha' | 'sem_noticia' | null;
  /** ok: o último contato certo; falhando: desde quando (ms desde 1970). */
  desde: number | null;
  /** O que a faixa da tela usa: desde quando está sem conexão (ISO), ou null. */
  semConexaoDesde: string | null;
};

const instante = (v: unknown): number | null => {
  if (!v) return null;
  const t = new Date(String(v)).getTime();
  return Number.isNaN(t) ? null : t;
};

/** Lê a anotação (o texto do `sync_state` ou o objeto já lido). Ilegível = sem informação. */
function contatoDe(v: unknown): { okEm?: unknown; falhandoDesde?: unknown } | null {
  if (v && typeof v === 'object') return v as any;
  if (typeof v !== 'string' || !v.trim()) return null;
  try {
    const o = JSON.parse(v);
    return o && typeof o === 'object' ? o : null;
  } catch {
    return null;
  }
}

/** A situação do contato com a nuvem — a MESMA para o ícone e para a faixa. */
export function situacaoDaNuvem(nuvemContato: unknown, agora = Date.now()): SituacaoDaNuvem {
  const c = contatoDe(nuvemContato);
  const ok = instante(c?.okEm);
  const falha = instante(c?.falhandoDesde);
  const falhaAtual = falha !== null && (ok === null || falha > ok);
  if (falhaAtual && agora - falha! >= SEM_NUVEM_APOS_MS) return { situacao: 'falhando', motivo: 'falha', desde: falha, semConexaoDesde: new Date(falha!).toISOString() };
  if (ok !== null && agora - ok >= ENVIO_PARADO_APOS_MS) return { situacao: 'falhando', motivo: 'sem_noticia', desde: ok, semConexaoDesde: new Date(ok).toISOString() };
  if (ok !== null) return { situacao: 'ok', motivo: null, desde: ok, semConexaoDesde: null };
  return { situacao: 'sem_informacao', motivo: null, desde: null, semConexaoDesde: null };
}
