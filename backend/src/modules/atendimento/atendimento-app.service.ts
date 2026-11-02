import { ForbiddenException, Inject, Injectable, Optional } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { AuthUser } from '../../auth/auth-user';
import { AuthService } from '../../auth/auth.service';
import { EquipamentoService } from '../equipamento/equipamento.service';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { sqlUnidadeOuRede } from '../../common/filtro-unidade';
import { lerPresenca, PRESENCA_VALE_MIN } from './presenca';
import { LIMITE_DA_FILA } from './atendimento.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

export type PresencaNoApp = {
  colaboradorId: string;
  nome: string;
  estado: 'disponivel' | 'ocupado';
  motivo: string | null;
  desde: string;
};

// O APP "REGEM ATENDIMENTO" (Onda 2 da central de atendimento, mig 353; decisão do dono de 02/11/2026: o app fala com a
// NUVEM agora, com o servidor da loja depois). O celular pareia uma vez (Configurações › Equipamentos › "App de
// atendimento" › código) e cada pessoa entra com o PIN dela. Daí em diante o app usa as MESMAS rotas da tela Atendimento
// (fila, pegar, passar, resolver, disputa e 99 com o PIN) — aqui ficam só a entrada e o "Disponível / Ocupado".
@Injectable()
export class AtendimentoAppService {
  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly auth: AuthService,
    private readonly equipamentos: EquipamentoService,
    @Optional() private readonly auditoria?: AuditoriaService,
  ) {}

  /**
   * Entrar com o PIN: primeiro o APARELHO prova quem é (id + segredo do pareamento — revogado não entra, e o app esquece o
   * pareamento só com `TERMINAL_REVOGADO`), depois a pessoa (o PIN, com a trava por celular). A sessão sai presa ao
   * celular (`ap` no token).
   */
  async entrar(terminalId: unknown, segredo: unknown, pin: unknown) {
    const ap = await this.equipamentos.aparelhoDeAtendimento(terminalId, segredo);
    const r = await this.auth.pinLoginNoAparelho(ap, String(pin ?? ''));
    let loja: string | null = null;
    if (r.unidadeId) {
      const u: any = await this.db.execute(
        sql`select nome from unidade where id = ${r.unidadeId}::uuid and tenant_id = ${ap.tenantId}::uuid`,
      );
      loja = (u.rows ?? u)[0]?.nome ?? null;
    }
    return {
      access_token: r.access_token,
      colaboradorId: r.colaboradorId,
      nome: r.nome,
      categoria: r.categoria,
      permissoes: r.permissoes,
      unidadeId: r.unidadeId,
      loja,
      aparelho: { id: ap.id, nome: ap.nome },
    };
  }

  /** Quem está no app agora (da loja em uso), com a situação; e a minha. Só quem avisou nos últimos minutos vale. */
  async presenca(user: AuthUser, unidade: string | null) {
    const r: any = await this.db.execute(sql`
      select p.colaborador_id as "colaboradorId", c.nome, p.estado, p.motivo, p.desde
        from atendimento_presenca p
        join colaborador c on c.id = p.colaborador_id and c.tenant_id = p.tenant_id
       where p.tenant_id = ${user.tenantId}
         and p.atualizado_em > now() - interval '${sql.raw(String(PRESENCA_VALE_MIN))} minutes'
         and c.deleted_at is null and c.status = 'ativo'
         ${sqlUnidadeOuRede('c.unidade_id', unidade)}
       order by p.estado, c.nome
       limit ${LIMITE_DA_FILA}`);
    const equipe = (r.rows ?? r) as PresencaNoApp[];
    return {
      eu: equipe.find((p) => p.colaboradorId === user.colaboradorId) ?? null,
      equipe,
      valeMin: PRESENCA_VALE_MIN,
    };
  }

  /**
   * "Disponível" ou "Ocupado: <motivo>" — e o aviso de "ainda estou aqui" (o app manda a cada minuto). Só do app: a sessão
   * do computador não tem celular e não entra na vez. O "desde" anda só quando a situação muda (ou a pessoa voltou depois
   * de sumir), não a cada aviso.
   */
  async marcar(user: AuthUser, dto: unknown) {
    if (!user.aparelhoId) throw new ForbiddenException('A situação "Disponível / Ocupado" é do app de atendimento.');
    const { estado, motivo } = lerPresenca(dto);
    const r: any = await this.db.execute(sql`
      insert into atendimento_presenca (colaborador_id, tenant_id, estado, motivo, desde, equipamento_id, atualizado_em)
      values (${user.colaboradorId}::uuid, ${user.tenantId}::uuid, ${estado}, ${motivo}, now(), ${user.aparelhoId}::uuid, now())
      on conflict (colaborador_id) do update set
        estado = excluded.estado,
        motivo = excluded.motivo,
        equipamento_id = excluded.equipamento_id,
        desde = case
          when atendimento_presenca.estado is distinct from excluded.estado
            or atendimento_presenca.motivo is distinct from excluded.motivo
            or atendimento_presenca.atualizado_em <= now() - interval '${sql.raw(String(PRESENCA_VALE_MIN))} minutes'
          then now() else atendimento_presenca.desde end,
        atualizado_em = now()
      where atendimento_presenca.tenant_id = excluded.tenant_id
      returning estado, motivo, desde`);
    const row = (r.rows ?? r)[0];
    if (!row) throw new ForbiddenException('Não foi possível marcar a sua situação.');
    return { estado: row.estado, motivo: row.motivo, desde: row.desde, valeMin: PRESENCA_VALE_MIN };
  }

  /** "Sair" (fim do turno, ou outra pessoa vai usar o celular): sai da vez na hora e fica registrado. */
  async sair(user: AuthUser) {
    await this.db.execute(sql`
      delete from atendimento_presenca where colaborador_id = ${user.colaboradorId}::uuid and tenant_id = ${user.tenantId}::uuid`);
    await this.auditoria?.registrar({
      tenantId: user.tenantId,
      unidadeId: user.unidadeId ?? null,
      atorId: user.colaboradorId,
      atorPerfil: user.categoria,
      tipo: 'auth',
      acao: 'saiu_do_app_atendimento',
      entidadeTipo: 'equipamento',
      entidadeId: user.aparelhoId ?? null,
      origem: 'terminal',
    });
    return { ok: true };
  }
}
