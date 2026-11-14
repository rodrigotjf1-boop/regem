import { BadRequestException, Inject, Injectable, Optional } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { AuthUser } from '../../auth/auth-user';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { NOME_DO_DESTINO, RegraDoAviso, TIPOS_DE_AVISO, TipoDeAviso, conferirRegras, ehTipoDeAviso, regraQueVale } from './mister-avisos.regras';

/* eslint-disable @typescript-eslint/no-explicit-any */

// PARA ONDE VAI CADA AVISO (mig 419): a escolha da empresa, tipo por tipo. Sem escolha, vale o padrão aprovado pelo dono em
// 14/11/2026 (`mister-avisos.regras.ts`). Só o presidente muda (o controlador); a tela manda só os tipos que mudaram e cada
// um vai inteiro. Só na nuvem: no servidor da loja a tabela não existe.

const linhas = (r: any) => (r?.rows ?? r ?? []) as any[];
const semTabela = (e: any) => e?.code === '42P01' || e?.code === '42703';

export interface AvisoNaTela {
  tipo: TipoDeAviso;
  grupo: string;
  titulo: string;
  descricao: string;
  jaFunciona: boolean;
  regra: RegraDoAviso;
  /** A empresa ainda não mudou este aviso: vale o padrão. */
  padrao: boolean;
}

@Injectable()
export class MisterAvisosConfigService {
  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    @Optional() private readonly auditoria?: AuditoriaService,
  ) {}

  /** As regras salvas da empresa (tipo → regra), sem o padrão. Banco sem a 419 = nada salvo. */
  async salvas(tenantId: string): Promise<Map<TipoDeAviso, Partial<RegraDoAviso>>> {
    try {
      const lidas = linhas(
        await this.db.execute(sql`
          select tipo, ligado, destinos, escala_min as "escalaMin", escala_para as "escalaPara", parametro
            from mister_aviso_regra where tenant_id = ${tenantId}::uuid`),
      );
      const m = new Map<TipoDeAviso, Partial<RegraDoAviso>>();
      for (const l of lidas) if (ehTipoDeAviso(l.tipo)) m.set(l.tipo, { ligado: l.ligado, destinos: l.destinos ?? [], escalaMin: l.escalaMin ?? null, escalaPara: l.escalaPara ?? [], parametro: l.parametro ?? null });
      return m;
    } catch (e: any) {
      if (semTabela(e)) return new Map();
      throw e;
    }
  }

  /** As regras que valem para várias empresas de uma vez (a rotina dos avisos): empresa → tipo → regra. */
  async regrasDe(tenantIds: string[]): Promise<Map<string, Map<TipoDeAviso, RegraDoAviso>>> {
    const fora = new Map<string, Map<TipoDeAviso, RegraDoAviso>>();
    if (!tenantIds.length) return fora;
    let lidas: any[] = [];
    try {
      lidas = linhas(
        await this.db.execute(sql`
          select tenant_id::text as "tenantId", tipo, ligado, destinos, escala_min as "escalaMin", escala_para as "escalaPara", parametro
            from mister_aviso_regra
           where tenant_id in (${sql.join(
             tenantIds.map((t) => sql`${t}::uuid`),
             sql`, `,
           )})`),
      );
    } catch (e: any) {
      if (!semTabela(e)) throw e;
    }
    for (const t of tenantIds) {
      const m = new Map<TipoDeAviso, RegraDoAviso>();
      for (const tipo of TIPOS_DE_AVISO) {
        const l = lidas.find((x) => x.tenantId === t && x.tipo === tipo.tipo);
        m.set(tipo.tipo, regraQueVale(tipo.tipo, l ? { ligado: l.ligado, destinos: l.destinos, escalaMin: l.escalaMin, escalaPara: l.escalaPara, parametro: l.parametro } : null));
      }
      fora.set(t, m);
    }
    return fora;
  }

  /** O que a tela "Avisos e relatórios" mostra. */
  async daTela(tenantId: string): Promise<{ avisos: AvisoNaTela[]; destinos: { id: string; nome: string }[] }> {
    const salvas = await this.salvas(tenantId);
    return {
      destinos: Object.entries(NOME_DO_DESTINO).map(([id, nome]) => ({ id, nome })),
      avisos: TIPOS_DE_AVISO.map((t) => ({
        tipo: t.tipo,
        grupo: t.grupo,
        titulo: t.titulo,
        descricao: t.descricao,
        jaFunciona: t.jaFunciona,
        regra: regraQueVale(t.tipo, salvas.get(t.tipo)),
        padrao: !salvas.has(t.tipo),
      })),
    };
  }

  /** Salva os tipos que mudaram (todos ou nenhum: uma gravação só) e audita o que mudou. */
  async salvar(user: AuthUser, dto: unknown) {
    const r = conferirRegras(dto);
    if ('erro' in r) throw new BadRequestException(r.erro);
    const antes = await this.salvas(user.tenantId);
    await this.db.execute(sql`
      insert into mister_aviso_regra (tenant_id, tipo, ligado, destinos, escala_min, escala_para, parametro, alterado_por, atualizado_em)
      select ${user.tenantId}::uuid, x.tipo, x.ligado, x.destinos, x."escalaMin", x."escalaPara", x.parametro, ${user.colaboradorId}::uuid, now()
        from jsonb_to_recordset(${JSON.stringify(r.map((x) => ({ tipo: x.tipo, ...x.regra })))}::jsonb)
             as x(tipo text, ligado boolean, destinos text[], "escalaMin" integer, "escalaPara" text[], parametro integer)
      on conflict (tenant_id, tipo) do update
         set ligado = excluded.ligado, destinos = excluded.destinos, escala_min = excluded.escala_min, escala_para = excluded.escala_para,
             parametro = excluded.parametro, alterado_por = excluded.alterado_por, atualizado_em = now()`);
    await this.auditoria?.registrar({
      tenantId: user.tenantId,
      atorId: user.colaboradorId,
      atorPerfil: user.categoria,
      tipo: 'config',
      acao: 'mister_avisos_alterados',
      entidadeTipo: 'mister_aviso_regra',
      entidadeId: user.tenantId,
      detalhe: { mudou: r.map((x) => ({ tipo: x.tipo, antes: regraQueVale(x.tipo, antes.get(x.tipo)), depois: x.regra })) },
    });
    return this.daTela(user.tenantId);
  }
}
