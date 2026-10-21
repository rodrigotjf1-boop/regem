import { ExecutionContext, Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { rotaDaFilaDeImpressao, rotaDaTelaDeSenhas, tokenJaValidado } from './dispositivo-limite';
import { credencialDaChamada, rotaDaIntegracao, tokenIntegracaoJaValidado } from './integracao-limite';

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
  // Fila de impressão com token JÁ validado pelo SyncTokenGuard: sai do balde do IP (que a
  // loja divide entre caixas, sync e app) e fica no limite por dispositivo
  // (common/dispositivo-limite.ts). Token desconhecido segue limitado por IP.
  protected async shouldSkip(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    if (rotaDaFilaDeImpressao(req?.originalUrl ?? req?.url)) {
      const raw = req?.headers?.['x-sync-token'];
      if (tokenJaValidado(Array.isArray(raw) ? raw[0] : raw)) return true;
      // Estação de impressão (mig 324): o segredo dela, validado pela FilaImpressaoGuard.
      const est = req?.headers?.['x-estacao-segredo'];
      if (tokenJaValidado(Array.isArray(est) ? est[0] : est)) return true;
    }
    // Tela de senhas (mig 337): a TV lê a cada aviso e a cada 30 s; com o segredo já validado pela TelaSenhasGuard,
    // fica no limite por aparelho, fora do balde do IP da loja.
    if (rotaDaTelaDeSenhas(req?.originalUrl ?? req?.url)) {
      const seg = req?.headers?.['x-tela-segredo'];
      if (tokenJaValidado(Array.isArray(seg) ? seg[0] : seg)) return true;
    }
    // API de integração (trilha C) com credencial JÁ validada pelo `IntegracaoTokenGuard` (o
    // token de integração, ou o token do DMS ID com o segredo da ligação): o limite passa a ser o
    // da credencial (60/min, common/integracao-limite.ts). Desconhecida segue no limite por IP.
    if (rotaDaIntegracao(req?.originalUrl ?? req?.url) && tokenIntegracaoJaValidado(credencialDaChamada(req))) {
      return true;
    }
    return super.shouldSkip(context);
  }

  protected async getTracker(req: Record<string, any>): Promise<string> {
    if (process.env.TRUST_CLOUDFLARE === 'true') {
      const cf = req?.headers?.['cf-connecting-ip'];
      if (typeof cf === 'string' && cf.trim()) return cf.trim();
    }
    return req?.ip ?? 'desconhecido';
  }
}
