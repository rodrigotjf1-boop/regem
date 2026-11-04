import { BadRequestException, Inject, Injectable, Optional } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { AuthUser } from '../../auth/auth-user';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { AjusteRepetido, ajusteRepetidoDaLinha, JANELAS_MIN, linhaDoAjusteRepetido } from './pedido-repetido';

/* eslint-disable @typescript-eslint/no-explicit-any */

// O AJUSTE DO PEDIDO IGUAL (mig 360) em Delivery › Configurações › Operação › Atendimento › "Pedido repetido": mora em
// `cardapio_config` da loja (sem linha dela, a da empresa), como o "Cheguei" (mig 354). A regra do pedido igual em si
// está em `pedido-repetido.ts`.
@Injectable()
export class PedidoRepetidoService {
  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    // Quem mudou o ajuste fica na auditoria. Opcional: os testes montam o serviço sem ela.
    @Optional() private readonly auditoria?: AuditoriaService,
  ) {}

  /** O ajuste para a tela, as janelas oferecidas e se a loja tem cardápio online (sem ele não há onde gravar). */
  async ajustes(tenantId: string, unidadeId: string | null): Promise<AjusteRepetido & { temCardapio: boolean; janelas: number[] }> {
    const row = await linhaDoAjusteRepetido(this.db, tenantId, unidadeId);
    return { ...ajusteRepetidoDaLinha(row), temCardapio: !!row, janelas: [...JANELAS_MIN] };
  }

  /**
   * Grava só os campos que vieram (V16) e só as colunas deles — dois salvamentos ao mesmo tempo não desfazem um ao
   * outro. Quem mudou e de quê para quê fica na auditoria. Sem cardápio online: recusa, com o caminho para criar.
   */
  async salvarAjustes(user: AuthUser, unidadeId: string | null, parcial: Partial<AjusteRepetido>): Promise<void> {
    const row = await linhaDoAjusteRepetido(this.db, user.tenantId, unidadeId);
    if (!row)
      throw new BadRequestException(
        'A loja ainda não tem cardápio online: o ajuste do pedido igual mora nele (Delivery › Configurações › Cardápio).',
      );
    const antes = ajusteRepetidoDaLinha(row);
    const mudou = (Object.keys(parcial) as (keyof AjusteRepetido)[]).filter((k) => parcial[k] !== antes[k]);
    if (!mudou.length) return;
    const colunas: Record<keyof AjusteRepetido, string> = { ativo: 'pedido_repetido_ativo', minutos: 'pedido_repetido_min' };
    const sets = mudou.map((k) => sql`${sql.raw(colunas[k])} = ${parcial[k] as any}`);
    await this.db.execute(sql`
      update cardapio_config set ${sql.join(sets, sql`, `)}, updated_at = now()
       where id = ${row.id}::uuid and tenant_id = ${user.tenantId}::uuid`);
    await this.auditoria?.registrar({
      tenantId: user.tenantId,
      unidadeId: row.unidade_id ?? null,
      atorId: user.colaboradorId,
      atorPerfil: user.categoria,
      tipo: 'config',
      acao: 'ajustou_pedido_repetido',
      origem: 'atendimento',
      entidadeTipo: 'cardapio_config',
      entidadeId: row.id,
      detalhe: {
        de: Object.fromEntries(mudou.map((k) => [k, antes[k]])),
        para: Object.fromEntries(mudou.map((k) => [k, parcial[k]])),
      },
    });
  }
}
