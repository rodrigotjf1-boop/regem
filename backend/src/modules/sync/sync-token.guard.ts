import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  UnauthorizedException,
  createParamDecorator,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { EquipamentoService, INTEGRADORES } from '../equipamento/equipamento.service';
import { ehServidorLocal } from '../../common/modo';
import { ACEITA_INTEGRADOR } from './aceita-integrador.decorator';
import {
  dentroDoLimite,
  registrarTokenValidado,
  rotaDaFilaDeImpressao,
} from '../../common/dispositivo-limite';

export type SyncCtxData = {
  tenantId: string;
  unidadeId: string | null;
  equipamentoId: string;
  token: string; // usado p/ derivar a chave HMAC da assinatura de push
};

// Autentica por token de DISPOSITIVO (menor privilégio, revogável), nunca por JWT de
// usuário. Aceita:
//  • 'servidor_local' — em qualquer lugar (é o edge falando com a nuvem);
//  • 'totem'          — SÓ no servidor local (R1). O totem fala com o edge pela LAN; um
//    token de totem nunca vale contra a nuvem, então um aparelho público comprometido
//    não alcança a API da nuvem. O tipo é conferido com `ehServidorLocal()` e nunca
//    comparando EDGE_MODE à mão (registro interno: V2).
// O totem PRECISA ter loja: sem `unidade_id`, a venda nasceria "da rede" — desceria para
// todos os servidores e sairia do CMV por loja (registro interno: V17).
/**
 * Regra ÚNICA de quem pode usar token de dispositivo (R1). Exportada porque o guard do
 * módulo `totem` aplica exatamente a mesma — duas cópias divergiriam com o tempo, e é
 * regra de autenticação. Lança `UnauthorizedException`; devolve o dispositivo válido.
 */
export function conferirDispositivo(dev: any): asserts dev {
  const tipoAceito =
    dev?.tipo === 'servidor_local' || (dev?.tipo === 'totem' && ehServidorLocal());
  if (!dev || !tipoAceito) {
    throw new UnauthorizedException('Token de sync inválido.');
  }
  if (dev.tipo === 'totem' && !dev.unidadeId) {
    throw new UnauthorizedException(
      'Totem sem loja definida — vincule o aparelho a uma loja antes de usá-lo.',
    );
  }
}

/** Lê o `@AceitaIntegrador()` da rota (metadado do Nest; não precisa de injeção). */
const reflector = new Reflector();
const log = new Logger('SyncTokenGuard');
/** Recusa de integrador já registrada no log, por equipamento e rota (uma vez por hora). */
const recusaLogada = new Map<string, number>();

/**
 * A credencial de um INTEGRADOR (GoGeM) só passa nas rotas marcadas com `@AceitaIntegrador()`.
 * É integrador o equipamento já marcado (`integrador`, mig 290) ou quem se identifica pelo
 * `X-Integrador` — o servidor da loja nunca manda esse cabeçalho, e a marca nunca cai num
 * servidor que já sincronizou (`notarIntegrador`). Só na NUVEM: no servidor da loja a credencial
 * do GoGeM nem existe (`servidor_local` não desce) e o cabeçalho não significa nada.
 * Sem o metadado (contexto sem rota) = recusa: a lista é do que pode.
 */
export function conferirRotaDoIntegrador(dev: any, cabecalhoIntegrador: unknown, context: ExecutionContext, rota: string): void {
  if (ehServidorLocal()) return;
  const cab = String(cabecalhoIntegrador ?? '').trim().toLowerCase();
  const integrador = dev?.integrador ?? (INTEGRADORES.has(cab) ? cab : null);
  if (!integrador) return;
  const handler = typeof context.getHandler === 'function' ? context.getHandler() : undefined;
  const classe = typeof context.getClass === 'function' ? context.getClass() : undefined;
  const alvos = [handler, classe].filter((x): x is any => !!x);
  if (alvos.length && reflector.getAllAndOverride<boolean>(ACEITA_INTEGRADOR, alvos)) return;
  const chave = `${dev?.id}|${rota}`;
  if (Date.now() - (recusaLogada.get(chave) ?? 0) > 3_600_000) {
    recusaLogada.set(chave, Date.now());
    if (recusaLogada.size > 5_000) recusaLogada.clear();
    log.warn(`credencial de integrador (${integrador}, equipamento ${dev?.id}, empresa ${dev?.tenantId}) recusada em ${rota}: rota fora das do integrador`);
  }
  throw new ForbiddenException('Esta credencial de integração não acessa esta rota.');
}

@Injectable()
export class SyncTokenGuard implements CanActivate {
  constructor(private readonly equipamentos: EquipamentoService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const raw = req.headers['x-sync-token'];
    const token = Array.isArray(raw) ? raw[0] : raw;
    if (!token) throw new UnauthorizedException('Token de sync ausente.');

    const dev = await this.equipamentos.validarToken(String(token));
    conferirDispositivo(dev);
    registrarTokenValidado(String(token));
    // Fila de impressão: isenta do limite por IP (cf-throttler.guard) → limite próprio por
    // dispositivo. As demais rotas de sync seguem no limite por IP de sempre.
    if (rotaDaFilaDeImpressao(req.originalUrl ?? req.url) && !dentroDoLimite(dev.id)) {
      throw new HttpException('Muitas requisições deste dispositivo — aguarde um minuto.', HttpStatus.TOO_MANY_REQUESTS);
    }
    // Quem chama se identifica (`X-Integrador`, GoGeM #137): na NUVEM, isso marca o equipamento
    // como a credencial daquela integração — é por essa marca que o aviso de cancelamento e o
    // "Publicar no GoGeM" escolhem o token (ERR-108). Só grava quando muda (ou de hora em hora) e
    // nunca lança: não derruba a chamada. No servidor da loja o cabeçalho não significa nada.
    const integradorRaw = req.headers['x-integrador'];
    const integrador = Array.isArray(integradorRaw) ? integradorRaw[0] : integradorRaw;
    if (integrador && !ehServidorLocal()) {
      await this.equipamentos.notarIntegrador(dev, integrador);
    }
    // A credencial do integrador só abre as rotas dele — nunca o sincronismo da empresa inteira.
    conferirRotaDoIntegrador(dev, integrador, context, String(req.originalUrl ?? req.url ?? '').split('?')[0]);
    req.sync = {
      tenantId: dev.tenantId,
      unidadeId: dev.unidadeId ?? null,
      equipamentoId: dev.id,
      token: String(token),
    } satisfies SyncCtxData;
    return true;
  }
}

export const SyncCtx = createParamDecorator(
  (_data, ctx: ExecutionContext): SyncCtxData =>
    ctx.switchToHttp().getRequest().sync,
);
