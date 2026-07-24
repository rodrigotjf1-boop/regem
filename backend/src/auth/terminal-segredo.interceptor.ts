import {
  CallHandler,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { EquipamentoService } from '../modules/equipamento/equipamento.service';

/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Prova de identidade do PC (mig 142).
 *
 * O `X-Terminal-Id` sozinho não provava nada: era um id guardado no localStorage,
 * e qualquer usuário logado podia trocá-lo no navegador para assumir o caixa e a
 * unidade de OUTRO terminal da mesma empresa. Aqui, sempre que o header vier,
 * conferimos o `X-Terminal-Secret` contra o hash guardado. Errado = 403.
 *
 * Compatibilidade: PC pareado ANTES desta migration ainda não tem segredo — esse
 * segue aceito até parear de novo, senão o cliente ficaria sem PDV no dia do
 * deploy. Quem já pareou pelo código novo passa a ser exigido.
 */
@Injectable()
export class TerminalSegredoInterceptor implements NestInterceptor {
  constructor(private readonly equipamentos: EquipamentoService) {}

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<any>> {
    const req = context.switchToHttp().getRequest();
    const bruto = req?.headers?.['x-terminal-id'];
    const terminalId = Array.isArray(bruto) ? bruto[0] : bruto;
    const tenantId = req?.user?.tenantId;
    if (terminalId && tenantId) {
      const s = req.headers['x-terminal-secret'];
      const segredo = Array.isArray(s) ? s[0] : s;
      const eq = await this.equipamentos.validarSegredo(tenantId, terminalId, segredo);
      if (!eq)
        throw new ForbiddenException(
          'Este equipamento não está pareado (ou foi revogado). Refaça o pareamento com o código do gestor.',
        );
      req.terminal = eq; // quem precisar do equipamento já resolvido
    }
    return next.handle();
  }
}
