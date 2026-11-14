import { BadRequestException, Inject, Injectable, Optional } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { AuthUser } from '../../auth/auth-user';
import { AuditoriaService } from '../auditoria/auditoria.service';
import {
  RELATORIO_NA_TELA,
  RegraDoRelatorio,
  TIPOS_DE_RELATORIO,
  TipoDeRelatorio,
  conferirRelatorios,
  ehTipoDeRelatorio,
  regraDoRelatorioQueVale,
} from './mister-relatorios.regras';

/* eslint-disable @typescript-eslint/no-explicit-any */

// O HORÁRIO DE CADA RELATÓRIO (mig 420): a escolha da empresa; sem escolha, o padrão (desligado). Só o presidente muda (o
// controlador). Só na nuvem: no servidor da loja a tabela não existe.

const linhas = (r: any) => (r?.rows ?? r ?? []) as any[];
const semTabela = (e: any) => e?.code === '42P01' || e?.code === '42703';

export interface RelatorioNaTela {
  tipo: TipoDeRelatorio;
  titulo: string;
  descricao: string;
  regra: RegraDoRelatorio;
  /** O último envio deste relatório na empresa (para a tela dizer "saiu ontem às 23:31" ou o motivo de não ter saído). */
  ultimo: { referencia: string; situacao: string; motivo: string | null; em: string } | null;
}

@Injectable()
export class MisterRelatoriosConfigService {
  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    @Optional() private readonly auditoria?: AuditoriaService,
  ) {}

  /** As regras salvas da empresa (tipo → regra), sem o padrão. Banco sem a 420 = nada salvo. */
  async salvas(tenantId: string): Promise<Map<TipoDeRelatorio, Partial<RegraDoRelatorio>>> {
    try {
      const lidas = linhas(
        await this.db.execute(sql`
          select tipo, ligado, hora, dia_semana as "diaSemana" from mister_relatorio_regra where tenant_id = ${tenantId}::uuid`),
      );
      const m = new Map<TipoDeRelatorio, Partial<RegraDoRelatorio>>();
      for (const l of lidas) if (ehTipoDeRelatorio(l.tipo)) m.set(l.tipo, { ligado: l.ligado, hora: l.hora, diaSemana: l.diaSemana ?? null });
      return m;
    } catch (e: any) {
      if (semTabela(e)) return new Map();
      throw e;
    }
  }

  /** As regras LIGADAS de todas as empresas (a rotina): só quem ligou algum relatório tem linha ligada. */
  async ligadas(): Promise<Array<{ tenantId: string; tipo: TipoDeRelatorio; regra: RegraDoRelatorio }>> {
    let lidas: any[] = [];
    try {
      lidas = linhas(
        await this.db.execute(sql`
          select r.tenant_id::text as "tenantId", r.tipo, r.ligado, r.hora, r.dia_semana as "diaSemana"
            from mister_relatorio_regra r join empresa e on e.id = r.tenant_id and e.deleted_at is null
           where r.ligado`),
      );
    } catch (e: any) {
      if (!semTabela(e)) throw e;
    }
    return lidas
      .filter((l) => ehTipoDeRelatorio(l.tipo))
      .map((l) => ({ tenantId: l.tenantId, tipo: l.tipo as TipoDeRelatorio, regra: regraDoRelatorioQueVale(l.tipo, { ligado: l.ligado, hora: l.hora, diaSemana: l.diaSemana }) }));
  }

  /** O que o grupo "Relatórios" da tela mostra. */
  async daTela(tenantId: string): Promise<{ relatorios: RelatorioNaTela[] }> {
    const salvas = await this.salvas(tenantId);
    let ultimos: any[] = [];
    try {
      ultimos = linhas(
        await this.db.execute(sql`
          select distinct on (tipo) tipo, to_char(referencia, 'YYYY-MM-DD') as referencia, situacao, motivo,
                 coalesce(concluido_em, criado_em) as em
            from mister_relatorio where tenant_id = ${tenantId}::uuid
           order by tipo, criado_em desc`),
      );
    } catch (e: any) {
      if (!semTabela(e)) throw e;
    }
    return {
      relatorios: TIPOS_DE_RELATORIO.map((tipo) => {
        const u = ultimos.find((x) => x.tipo === tipo);
        return {
          tipo,
          ...RELATORIO_NA_TELA[tipo],
          regra: regraDoRelatorioQueVale(tipo, salvas.get(tipo)),
          ultimo: u ? { referencia: String(u.referencia), situacao: String(u.situacao), motivo: u.motivo ?? null, em: new Date(u.em).toISOString() } : null,
        };
      }),
    };
  }

  /** Salva os relatórios que mudaram (todos ou nenhum: uma gravação só) e audita o que mudou. */
  async salvar(user: AuthUser, dto: unknown) {
    const r = conferirRelatorios(dto);
    if ('erro' in r) throw new BadRequestException(r.erro);
    const antes = await this.salvas(user.tenantId);
    await this.db.execute(sql`
      insert into mister_relatorio_regra (tenant_id, tipo, ligado, hora, dia_semana, alterado_por, atualizado_em)
      select ${user.tenantId}::uuid, x.tipo, x.ligado, x.hora, x."diaSemana", ${user.colaboradorId}::uuid, now()
        from jsonb_to_recordset(${JSON.stringify(r.map((x) => ({ tipo: x.tipo, ...x.regra })))}::jsonb)
             as x(tipo text, ligado boolean, hora text, "diaSemana" smallint)
      on conflict (tenant_id, tipo) do update
         set ligado = excluded.ligado, hora = excluded.hora, dia_semana = excluded.dia_semana,
             alterado_por = excluded.alterado_por, atualizado_em = now()`);
    await this.auditoria?.registrar({
      tenantId: user.tenantId,
      atorId: user.colaboradorId,
      atorPerfil: user.categoria,
      tipo: 'config',
      acao: 'mister_relatorios_alterados',
      entidadeTipo: 'mister_relatorio_regra',
      entidadeId: user.tenantId,
      detalhe: { mudou: r.map((x) => ({ tipo: x.tipo, antes: regraDoRelatorioQueVale(x.tipo, antes.get(x.tipo)), depois: x.regra })) },
    });
    return this.daTela(user.tenantId);
  }
}
