// Progresso da instalação/reversão do servidor da loja, gravado pelo atualizar.ps1 / reverter.ps1 em
// logs/update-status.json. Regra ÚNICA de "em curso" (ERR-322): a API usa para aceitar um novo clique
// e a tela usa para travar os botões — antes eram duas réguas diferentes.
//
// Um status que não terminou (nem `ok` nem `erro`) e não muda há mais de 20 min é uma execução que
// PAROU (PC desligado, processo encerrado, script antigo que não fechava o status). Ele vai para a tela
// como `interrompida`: a tela avisa e libera "Instalar agora", em vez de mostrar "Iniciando… 2%" para
// sempre com os botões desligados.

export const VALIDADE_DO_PROGRESSO_MS = 20 * 60 * 1000;

export type ProgressoAtualizacao = {
  fase: string;
  estagio: string;
  pct: number;
  versao: string | null;
  baixadoMb: number | null;
  totalMb: number | null;
  erro: string | null;
  acaoFinal: string | null;
  ts: string | null;
};

const TERMINAL = new Set(['ok', 'erro']);

/** Uma instalação/reversão está rodando AGORA? (não terminou e mudou nos últimos 20 min). */
export function progressoEmCurso(p: ProgressoAtualizacao | null, agora = Date.now()): boolean {
  if (!p || TERMINAL.has(p.fase)) return false;
  const ts = p.ts ? Date.parse(p.ts) : NaN;
  return Number.isFinite(ts) && agora - ts < VALIDADE_DO_PROGRESSO_MS;
}

/** O que a tela recebe: o status como está, ou `interrompida` quando parou sem terminar. */
export function progressoParaTela(p: ProgressoAtualizacao | null, agora = Date.now()): ProgressoAtualizacao | null {
  if (!p || TERMINAL.has(p.fase) || progressoEmCurso(p, agora)) return p;
  return { ...p, fase: 'interrompida' };
}
