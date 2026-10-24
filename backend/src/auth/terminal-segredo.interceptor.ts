import {
  CallHandler,
  ConflictException,
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
 *
 * Parear sem reinstalar (pedido do dono de 22/10/2026): a recusa diz o MOTIVO em `code`, e o PC só esquece o
 * pareamento na revogação (`TERMINAL_REVOGADO`). O servidor recém-reinstalado não conhece o terminal até o cadastro
 * voltar da nuvem (com o mesmo segredo): enquanto restaura, `LOJA_CARREGANDO` (409 — não é falha do servidor, e 5xx
 * viraria alerta de erro na telemetria a cada 30 s por caixa); fora disso, `TERMINAL_NAO_RECONHECIDO`. Antes, qualquer
 * 403 apagava o pareamento do caixa, e ele pedia código depois de toda reinstalação.
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
      if (!eq) {
        const motivo = await this.equipamentos.motivoDaRecusa(tenantId, String(terminalId));
        if (motivo === 'revogado')
          throw new ForbiddenException({
            message: 'Este equipamento foi revogado no Regem. Refaça o pareamento com um código novo do gestor.',
            code: 'TERMINAL_REVOGADO',
          });
        if (motivo === 'desconhecido' && (await this.equipamentos.servidorCarregando()))
          throw new ConflictException({
            message: 'O servidor da loja está carregando o cadastro da nuvem. Este equipamento volta sozinho em instantes.',
            code: 'LOJA_CARREGANDO',
          });
        throw new ForbiddenException({
          message:
            'O servidor não reconheceu este equipamento. Se o servidor acabou de ser reinstalado, espere o cadastro chegar da nuvem; se continuar, refaça o pareamento com um código novo do gestor.',
          code: 'TERMINAL_NAO_RECONHECIDO',
        });
      }
      req.terminal = eq; // quem precisar do equipamento já resolvido
    }
    return next.handle();
  }
}
