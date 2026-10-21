import { CanActivate, ExecutionContext, HttpException, HttpStatus, Injectable, UnauthorizedException, createParamDecorator } from '@nestjs/common';
import { EquipamentoService } from '../equipamento/equipamento.service';
import { dentroDoLimite, registrarTokenValidado } from '../../common/dispositivo-limite';

/* eslint-disable @typescript-eslint/no-explicit-any */

const primeiro = (v: unknown) => (Array.isArray(v) ? v[0] : v);

/**
 * A tela de senhas (mig 337) se identifica pelo `X-Tela-Id` + `X-Tela-Segredo` que recebeu no pareamento — sem login.
 * O segredo validado sai do limite por IP (a loja divide o IP entre caixas, sync e app: `common/dispositivo-limite`) e
 * passa ao limite por aparelho; segredo desconhecido segue limitado por IP, como sempre. 401 = a TV volta a pedir o código.
 */
@Injectable()
export class TelaSenhasGuard implements CanActivate {
  constructor(private readonly equipamentos: EquipamentoService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const id = String(primeiro(req.headers?.['x-tela-id']) ?? '');
    const segredo = primeiro(req.headers?.['x-tela-segredo']);
    const tela = await this.equipamentos.validarTela(id, segredo ? String(segredo) : null);
    if (!tela) throw new UnauthorizedException('Esta tela de senhas não está pareada ou foi revogada. Pareie de novo com o código gerado em Equipamentos.');
    registrarTokenValidado(String(segredo));
    if (!dentroDoLimite(tela.id)) throw new HttpException('Muitas leituras desta tela — aguarde um minuto.', HttpStatus.TOO_MANY_REQUESTS);
    req.telaSenhas = tela;
    return true;
  }
}

/** A tela que chamou (o equipamento validado pela guarda). */
export const TelaAtual = createParamDecorator((_d: unknown, ctx: ExecutionContext) => ctx.switchToHttp().getRequest().telaSenhas);
