import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Senha das rotas do robô de atendimento (`publico/bot/*` e o link do cliente), que o n8n usa.
 *
 * Vai no CABEÇALHO: endereço com `?secret=` fica gravado no log do proxy, da Cloudflare e no nosso
 * registro de erro. A senha na URL ou no corpo ainda é aceita só para os fluxos antigos do n8n.
 */
export const CABECALHO_SEGREDO_ROBO = 'x-regem-robo-segredo';

/** Compara em tempo constante. Falha sem `BOT_RESOLVER_SECRET` configurado ou com tamanho diferente. */
export function segredoDoRoboOk(recebido: string | null | undefined): boolean {
  const esperado = process.env.BOT_RESOLVER_SECRET ?? '';
  if (!esperado) return false;
  const a = Buffer.from(String(recebido ?? ''));
  const b = Buffer.from(esperado);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Cabeçalho que a Evolution manda em cada aviso de mensagem (configurado por instância ao conectar). */
export const CABECALHO_ASSINATURA_EVOLUTION = 'x-regem-evolution';

/**
 * A assinatura de UMA instância da Evolution, derivada da senha do robô: se vazar, só aquela instância fica exposta (a
 * senha do robô vale para todas as lojas). Vazia sem `BOT_RESOLVER_SECRET`.
 */
export function assinaturaDaInstancia(instancia: string): string {
  const s = process.env.BOT_RESOLVER_SECRET ?? '';
  if (!s || !instancia) return '';
  return createHmac('sha256', s).update(`evolution:${instancia}`).digest('hex');
}

export function assinaturaDaInstanciaOk(instancia: string, recebida: unknown): boolean {
  const esperada = assinaturaDaInstancia(instancia);
  if (!esperada) return false;
  const a = Buffer.from(String(Array.isArray(recebida) ? recebida[0] : (recebida ?? '')));
  const b = Buffer.from(esperada);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Cabeçalho com que o Regem assina a mensagem que entrega ao robô (n8n): `sha256=<hmac do corpo>`. */
export const CABECALHO_ASSINATURA_REGEM = 'x-regem-assinatura';
export function assinarParaORobo(corpo: string): string {
  const s = process.env.BOT_RESOLVER_SECRET ?? '';
  return s ? `sha256=${createHmac('sha256', s).update(corpo).digest('hex')}` : '';
}

/** A senha da chamada: a do cabeçalho primeiro; a da URL ou do corpo só se o cabeçalho não veio. */
export function segredoDaChamada(cabecalho?: string | null, legado?: string | null): string {
  return String((cabecalho ?? '').trim() || (legado ?? ''));
}
