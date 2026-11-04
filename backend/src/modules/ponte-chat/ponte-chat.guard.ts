import { CanActivate, ExecutionContext, HttpException, HttpStatus, Injectable, createParamDecorator } from '@nestjs/common';
import { EquipamentoService } from '../equipamento/equipamento.service';
import { dentroDoLimite, registrarTokenValidado } from '../../common/dispositivo-limite';

/** O PC da ponte que está chamando (mig 366): a empresa e a loja saem DELE, nunca do corpo. */
export type PonteCtx = { id: string; tenantId: string; unidadeId: string | null; nome: string };

// A PONTE DO CHAT fala com a nuvem sem login de pessoa: quem prova é o PC (id + segredo do pareamento nos cabeçalhos,
// como o celular do app de atendimento). A régua de "acesso vale" é a do `aparelhoDaPonte` (revogada, loja ou empresa
// apagada → 403 com `code`). Validado o segredo, a ponte sai do balde do IP da loja (CfThrottlerGuard) e fica no limite
// por aparelho (common/dispositivo-limite.ts) — a fila de saída é consultada a cada poucos segundos.
@Injectable()
export class PonteChatGuard implements CanActivate {
  constructor(private readonly equipamentos: EquipamentoService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();
    const id = req.headers?.['x-terminal-id'];
    const segredoBruto = req.headers?.['x-terminal-secret'];
    const segredo = Array.isArray(segredoBruto) ? segredoBruto[0] : segredoBruto;
    const ponte = await this.equipamentos.aparelhoDaPonte(Array.isArray(id) ? id[0] : id, segredo);
    registrarTokenValidado(String(segredo));
    if (!dentroDoLimite(ponte.id))
      throw new HttpException('Muitas chamadas desta ponte em 1 minuto. Ela tenta de novo sozinha.', HttpStatus.TOO_MANY_REQUESTS);
    req.ponteChat = ponte;
    return true;
  }
}

export const Ponte = createParamDecorator((_d: unknown, ctx: ExecutionContext): PonteCtx => ctx.switchToHttp().getRequest().ponteChat);
