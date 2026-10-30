import { CABECALHO_SEGREDO_ROBO, segredoDoRoboOk } from './segredo-robo';

/* eslint-disable @typescript-eslint/no-explicit-any */

// LIMITE DE CHAMADAS DO ROBÔ (n8n) POR LOJA, não pelo IP (30/10/2026).
//
// O n8n chama o Regem de UM IP para todas as lojas: no limite por IP (`cf-throttler.guard`), a loja mais movimentada
// deixaria as outras sem robô (429) — e o chamado ao atendente tinha 20/min para a rede inteira. Escala é premissa.
// Só sai do balde do IP a chamada com a SENHA DO ROBÔ certa: quem não tem a senha continua contado pelo IP, como sempre.
// O balde passa a ser `robo:<loja>`, com a loja pela chave que vem na própria chamada — o token do cardápio na URL
// (`publico/cardapio/:token/atendimento` e `/cliente/link`), o `phoneNumberId` (API oficial) ou a `instancia`
// (Evolution). Os limites de cada rota (`@Throttle`) não mudam: passam a valer para cada loja.
// A chave da loja não é conferida aqui (o serviço confere e recusa a que não existe); sem a senha, nada muda.

const ROTA_DO_ROBO = /\/publico\/bot\/[^/?]+/;
const ROTA_DO_CARDAPIO_PARA_O_ROBO = /\/publico\/cardapio\/([^/?]+)\/(?:atendimento|cliente\/link)(?:[/?]|$)/;

const texto = (v: unknown): string => (typeof v === 'string' ? v : Array.isArray(v) && typeof v[0] === 'string' ? v[0] : '');

/** O balde do limite para esta chamada do robô, ou `null` quando ela não é do robô (ou vem sem a senha certa). */
export function baldeDoRobo(req: any): string | null {
  const url = String(req?.originalUrl ?? req?.url ?? '');
  const doCardapio = ROTA_DO_CARDAPIO_PARA_O_ROBO.exec(url);
  if (!doCardapio && !ROTA_DO_ROBO.test(url)) return null;
  const segredo = texto(req?.headers?.[CABECALHO_SEGREDO_ROBO]) || texto(req?.body?.secret) || texto(req?.query?.secret);
  if (!segredoDoRoboOk(segredo)) return null;
  const loja =
    (doCardapio ? decodeURIComponent(doCardapio[1]) : '') ||
    texto(req?.query?.phoneNumberId) ||
    texto(req?.body?.phoneNumberId) ||
    texto(req?.query?.instancia) ||
    texto(req?.body?.instancia);
  const chave = loja.trim().slice(0, 80);
  return chave ? `robo:${chave}` : null;
}
