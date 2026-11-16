import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
  createParamDecorator,
} from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { EquipamentoService } from '../equipamento/equipamento.service';
import { ModuloService } from '../modulo/modulo.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

export type KdsAparelhoCtx = {
  tenantId: string;
  unidadeId: string | null;
  equipamentoId: string;
  nome: string;
};

// O KDS FÍSICO pelo token do aparelho (TV box, tela da cozinha — 16/11/2026). O KDS aberto com `?token=` entrava no
// tempo real, mas a tela relê a fila no servidor a cada pedido novo, e a rota da fila só aceitava pessoa logada: a tela
// ficava "online" e vazia. Mesmo padrão do totem (`TotemTokenGuard`): o token vai em `X-Device-Token`.
// A régua de "acesso vale" é a da porta (V75): token ATIVO (revogar desliga), só aparelho do tipo `kds`, a loja dele
// não apagada e o módulo KDS ligado para ela. A empresa e a loja saem do APARELHO, nunca do que a tela manda.
@Injectable()
export class KdsAparelhoGuard implements CanActivate {
  constructor(
    private readonly equipamentos: EquipamentoService,
    private readonly modulos: ModuloService,
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const bruto = req.headers['x-device-token'];
    const token = String(Array.isArray(bruto) ? bruto[0] : (bruto ?? '')).trim();
    if (!token) throw new UnauthorizedException({ code: 'KDS_TOKEN_AUSENTE', message: 'Token do KDS ausente.' });

    const dev: any = await this.equipamentos.validarToken(token);
    if (!dev) throw new UnauthorizedException({ code: 'KDS_TOKEN_INVALIDO', message: 'KDS não reconhecido ou revogado.' });
    if (dev.tipo !== 'kds') {
      throw new UnauthorizedException({ code: 'KDS_TOKEN_INVALIDO', message: 'Este token não é de um KDS.' });
    }
    const unidadeId: string | null = dev.unidadeId ?? null;
    if (unidadeId) {
      const r: any = await this.db.execute(
        sql`select 1 from unidade where id = ${unidadeId}::uuid and tenant_id = ${dev.tenantId}::uuid and deleted_at is null`,
      );
      if (!(r.rows ?? r).length) {
        throw new UnauthorizedException({ code: 'KDS_LOJA_INEXISTENTE', message: 'A loja deste KDS não existe mais.' });
      }
    }
    if (!(await this.modulos.ativo(dev.tenantId, unidadeId, 'kds'))) {
      throw new ForbiddenException({ code: 'MODULO_DESATIVADO', message: 'Módulo "kds" está desativado para esta unidade.' });
    }
    req.kdsAparelho = {
      tenantId: dev.tenantId,
      unidadeId,
      equipamentoId: dev.id,
      nome: String(dev.nome ?? 'KDS'),
    } satisfies KdsAparelhoCtx;
    return true;
  }
}

export const AparelhoKds = createParamDecorator(
  (_data, ctx: ExecutionContext): KdsAparelhoCtx => ctx.switchToHttp().getRequest().kdsAparelho,
);
