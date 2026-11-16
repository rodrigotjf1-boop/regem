// A SESSÃO DO TERMINAL DE PONTO (avaliação de segurança de 16/11/2026, achado A-03).
//
// O login por PIN (`POST /auth/pin`) é o do terminal de ponto: a pessoa digita o PIN, o terminal envia a foto e marca o
// ponto, e descarta a sessão. O token que saía dali era o GERAL — na nuvem, quem tinha o acesso online desligado
// (`pode_nuvem` falso; o login por senha recusa) entrava pelo PIN e abria a API inteira com o perfil dele.
//
// Agora, NA NUVEM, o PIN de quem não tem o acesso online gera uma sessão marcada (`so: 'ponto'` no token) que o
// `JwtAuthGuard` só aceita nas duas rotas que o terminal usa depois do PIN. O que não muda: no servidor da loja o PIN
// entra como sempre (a operação da loja é local); quem tem o acesso online, e o presidente, seguem com a sessão geral
// (eles entrariam pela senha de qualquer jeito); o ponto das lojas que usam o terminal pela nuvem continua marcando.

/** A marca no token da sessão que só serve ao terminal de ponto. */
export const SESSAO_SO_DO_PONTO = 'ponto';

/** O PIN deste colaborador, neste lado (nuvem × servidor da loja), gera a sessão restrita ao ponto? */
export function pinGeraSessaoSoDoPonto(o: { servidorDaLoja: boolean; nivel: string; podeNuvem: boolean | null | undefined }): boolean {
  return !o.servidorDaLoja && o.nivel !== 'presidente' && !o.podeNuvem;
}

/** As rotas que o terminal de ponto chama depois do PIN: enviar a foto e marcar o ponto (as duas por POST). */
const ROTAS_DO_TERMINAL = /^\/api\/v1\/(?:ponto\/marcar|midia\/upload)\/?$/;

/** O pedido é uma das rotas do terminal de ponto? (o caminho sem a consulta; só POST) */
export function rotaDoTerminalDePonto(req: { method?: string; originalUrl?: string; url?: string }): boolean {
  if (String(req?.method ?? '').toUpperCase() !== 'POST') return false;
  const caminho = String(req?.originalUrl ?? req?.url ?? '').split('?')[0];
  return ROTAS_DO_TERMINAL.test(caminho);
}
