import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { AuthUser } from '../../auth/auth-user';

/* eslint-disable @typescript-eslint/no-explicit-any */
// App do Entregador (E0). Auth reusa o login de colaborador (o JWT já traz nome,
// função e permissões), então o perfil sai do token sem query. Sempre por tenant.
@Injectable()
export class EntregadorService {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDB) {}

  // Perfil do entregador a partir do JWT. `ehEntregador` = função contém "entregador".
  // As permissões do app são as chaves que o lojista liberou (padrão mínimo = tudo off).
  perfil(user: AuthUser) {
    const funcao = user.funcaoNome ?? '';
    const p: any = user.permissoes ?? {};
    return {
      nome: user.nome ?? null,
      funcao,
      ehEntregador: /entregador/i.test(funcao),
      permissoes: {
        pedidos: !!p.entregador_pedidos,
        taxas: !!p.entregador_taxas,
        ganhos: !!p.entregador_ganhos,
        tempo: !!p.entregador_tempo,
        relatorio: !!p.entregador_relatorio,
        tipos: !!p.entregador_tipos,
      },
    };
  }

  // Upsert do token de push do aparelho (por colaborador + token). Best-effort.
  async registrarDispositivo(
    tenantId: string,
    colaboradorId: string,
    fcmToken: string,
    plataforma?: string,
  ) {
    const tok = String(fcmToken ?? '').trim();
    if (!tok) return { ok: false };
    await this.db.execute(sql`
      insert into entregador_dispositivo (tenant_id, colaborador_id, fcm_token, plataforma)
      values (${tenantId}, ${colaboradorId}, ${tok}, ${plataforma ?? null})
      on conflict (colaborador_id, fcm_token)
      do update set atualizado_em = now(), plataforma = excluded.plataforma`);
    return { ok: true };
  }
}
