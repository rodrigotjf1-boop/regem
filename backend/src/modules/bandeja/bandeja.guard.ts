import { CanActivate, ExecutionContext, ForbiddenException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { ehServidorLocal } from '../../common/modo';
import { chaveConfere, doProprioComputador } from './bandeja-chave';

/**
 * Só o ícone deste servidor: (1) só no servidor da loja — na nuvem a rota nem existe; (2) só de uma conexão do próprio
 * computador; (3) só com a chave do arquivo `bandeja.key`, que fica na pasta do sistema neste computador.
 */
@Injectable()
export class BandejaGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    if (!ehServidorLocal()) throw new NotFoundException();
    const req = context.switchToHttp().getRequest();
    if (!doProprioComputador(req?.socket?.remoteAddress)) throw new ForbiddenException('Só o ícone do próprio servidor da loja usa esta rota.');
    const bruta = req?.headers?.['x-bandeja-chave'];
    if (!chaveConfere(Array.isArray(bruta) ? bruta[0] : bruta)) throw new UnauthorizedException('A chave do ícone não confere. Feche e abra o ícone.');
    return true;
  }
}
