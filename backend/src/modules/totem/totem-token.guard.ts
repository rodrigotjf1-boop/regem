import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Optional,
  UnauthorizedException,
  createParamDecorator,
} from '@nestjs/common';
import { EquipamentoService } from '../equipamento/equipamento.service';
import { PresencaService, enderecoDoHost, ipDoPc } from '../equipamento/presenca.service';
import { conferirDispositivo } from '../sync/sync-token.guard';

export type TotemCtxData = {
  tenantId: string;
  unidadeId: string | null;
  equipamentoId: string;
};

// R3 — autentica o TOTEM no servidor local.
//
// O app do totem manda `X-Device-Token` (é o contrato dele com a nuvem GoGeM, e não
// mudamos o app ao apontá-lo para o edge). Aceitamos também `X-Sync-Token` para
// diagnóstico com as mesmas ferramentas do resto do sync.
// A REGRA de quem pode entrar é a mesma do `SyncTokenGuard` (`conferirDispositivo`):
// tipo 'totem' só vale no servidor local, e totem sem loja é recusado.
@Injectable()
export class TotemTokenGuard implements CanActivate {
  constructor(
    private readonly equipamentos: EquipamentoService,
    // Opcional: os testes montam o guard só com o serviço de equipamentos.
    @Optional() private readonly presenca?: PresencaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const bruto = req.headers['x-device-token'] ?? req.headers['x-sync-token'];
    const token = Array.isArray(bruto) ? bruto[0] : bruto;
    if (!token) throw new UnauthorizedException('Token do dispositivo ausente.');

    const dev = await this.equipamentos.validarToken(String(token));
    conferirDispositivo(dev);
    req.totem = {
      tenantId: dev.tenantId,
      unidadeId: dev.unidadeId ?? null,
      equipamentoId: dev.id,
    } satisfies TotemCtxData;
    // "Em uso": a última chamada do totem fica na memória do servidor da loja (o ícone do servidor mostra quantos estão
    // em uso). O app do totem é outro (não mandamos nele): sem versão.
    if (dev.tipo === 'totem') {
      this.presenca?.notar({ id: dev.id, tenantId: dev.tenantId, tipo: 'totem', ip: ipDoPc(req.ip), endereco: enderecoDoHost(req.headers?.host), maquina: null, versao: null });
    }
    return true;
  }
}

export const TotemCtx = createParamDecorator(
  (_data, ctx: ExecutionContext): TotemCtxData =>
    ctx.switchToHttp().getRequest().totem,
);
