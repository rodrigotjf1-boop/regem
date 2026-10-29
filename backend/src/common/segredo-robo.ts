import { timingSafeEqual } from 'node:crypto';

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

/** A senha da chamada: a do cabeçalho primeiro; a da URL ou do corpo só se o cabeçalho não veio. */
export function segredoDaChamada(cabecalho?: string | null, legado?: string | null): string {
  return String((cabecalho ?? '').trim() || (legado ?? ''));
}
