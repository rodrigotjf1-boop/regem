import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

/**
 * Rate limit contando pelo IP REAL do cliente quando a nuvem está atrás da
 * Cloudflare (cliente → Cloudflare → proxy do EasyPanel → API).
 *
 * Sem isto o `req.ip` vira o IP de saída da Cloudflare e a rede inteira divide
 * o mesmo balde de requisições — um cardápio movimentado derruba todo mundo com
 * 429 no horário de pico.
 *
 * `CF-Connecting-IP` é forjável por quem bate DIRETO na origem (sem passar pela
 * Cloudflare), por isso só é lido com TRUST_CLOUDFLARE=true — ligar apenas
 * depois que o domínio estiver proxiado (e, idealmente, com o firewall da VPS
 * aceitando só as faixas da Cloudflare). No edge/dev a var não existe e o
 * comportamento é o de sempre.
 */
@Injectable()
export class CfThrottlerGuard extends ThrottlerGuard {
  protected async getTracker(req: Record<string, any>): Promise<string> {
    if (process.env.TRUST_CLOUDFLARE === 'true') {
      const cf = req?.headers?.['cf-connecting-ip'];
      if (typeof cf === 'string' && cf.trim()) return cf.trim();
    }
    return req?.ip ?? 'desconhecido';
  }
}
