// A SESSÃO DO TERMINAL DE PONTO (avaliação de segurança de 16/11/2026: achado A-03 e, na segunda rodada, B-01).
//
// O login por PIN (`POST /auth/pin`) é o do terminal de ponto, e só dele: a pessoa digita o PIN, o terminal envia a foto
// e marca o ponto, e descarta a sessão. O token que saía dali era o GERAL — quem acertasse um PIN abria a API inteira
// com o perfil da pessoa.
//
// A sessão do PIN é SEMPRE a do terminal (`so: 'ponto'` no token), na nuvem e no servidor da loja, para qualquer nível:
//  • o `JwtAuthGuard` só a aceita nas duas rotas que o terminal usa depois do PIN;
//  • o tempo real (`RealtimeGateway`) não a aceita: quem bate ponto não entra nas salas da empresa.
//
// Por que para todos (a primeira versão deixava de fora o presidente, quem tem o acesso online e o servidor da loja):
// o PIN tem de 4 a 6 dígitos e a trava é de 10 erros a cada 5 minutos por loja — numa empresa com dez PINs de 4 dígitos,
// acertar algum leva horas, não anos. Quem tem acesso à gestão entra com a senha; nenhuma tela usa o token do PIN para
// outra coisa que não o ponto (só `terminal/ponto` chama esta rota).

/** A marca no token da sessão que só serve ao terminal de ponto. */
export const SESSAO_SO_DO_PONTO = 'ponto';

/** As rotas que o terminal de ponto chama depois do PIN: enviar a foto e marcar o ponto (as duas por POST). */
const ROTAS_DO_TERMINAL = /^\/api\/v1\/(?:ponto\/marcar|midia\/upload)\/?$/;

/** O pedido é uma das rotas do terminal de ponto? (o caminho sem a consulta; só POST) */
export function rotaDoTerminalDePonto(req: { method?: string; originalUrl?: string; url?: string }): boolean {
  if (String(req?.method ?? '').toUpperCase() !== 'POST') return false;
  const caminho = String(req?.originalUrl ?? req?.url ?? '').split('?')[0];
  return ROTAS_DO_TERMINAL.test(caminho);
}

/**
 * O token serve ao TEMPO REAL? Só a sessão geral. A marcada com um uso só (`so`: o terminal de ponto) e a presa a um
 * aparelho (`ap`: o app de atendimento, que não usa o tempo real) não entram nas salas da empresa — por elas passam o
 * ponto dos colegas, os pedidos e os alertas. O guarda das rotas conferia a marca e o tempo real, não (B-01): toda
 * marca nova de sessão restrita tem de ser recusada aqui também, e por isso a regra é "qualquer `so`", não "`so` igual
 * a ponto".
 */
export function tokenAbreOTempoReal(payload: { so?: unknown; ap?: unknown } | null | undefined): boolean {
  return !!payload && !payload.so && !payload.ap;
}
