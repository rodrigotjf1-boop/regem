import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { moduloAtivacao, unidade } from '../../db/schema';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { AuthUser } from '../../auth/auth-user';

// Módulos ativáveis do produto. `padrao` = estado quando nada foi configurado.
export const MODULOS = [
  { chave: 'app_colaborador', label: 'App do Colaborador', emoji: '📱' },
  { chave: 'kds', label: 'KDS de Alertas', emoji: '🖥️' },
  { chave: 'terminal_ponto', label: 'Terminal de Ponto', emoji: '🕐' },
  { chave: 'bot', label: 'Bot de Suporte', emoji: '🤖' },
];
const CHAVES = new Set(MODULOS.map((m) => m.chave));

// Ponte entre o nome do módulo aqui e o do PLANO contratado (`ativacao.modulos`),
// que usa 'ponto' onde aqui é 'terminal_ponto'. Sem isso o Terminal de Ponto
// pareceria fora do plano em toda empresa.
const NO_PLANO: Record<string, string> = {
  app_colaborador: 'app_colaborador',
  kds: 'kds',
  terminal_ponto: 'ponto',
  bot: 'bot',
};

@Injectable()
export class ModuloService {
  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly auditoria: AuditoriaService,
  ) {}

  private async rows(q: any): Promise<any[]> {
    const r: any = await this.db.execute(q);
    return r.rows ?? r;
  }

  // Módulos que a empresa CONTRATOU (plano/licença). É o teto: o que não está no
  // plano não pode ser ligado nem aparece no menu, nem para o presidente — não é
  // restrição de perfil, é algo que a loja não comprou. Sem ativação registrada,
  // não limitamos (instalações antigas e ambiente de teste seguem como antes).
  private async doPlano(tenantId: string): Promise<Set<string> | null> {
    const r: any = await this.db.execute(sql`
      select modulos from ativacao
      where tenant_id = ${tenantId} and status = 'ativado'
      order by atualizado_em desc nulls last limit 1
    `);
    const mods = (r?.rows ?? r)?.[0]?.modulos;
    if (!Array.isArray(mods) || !mods.length) return null;
    return new Set(mods.map((m: any) => String(m)));
  }

  // Um módulo está ativo para uma unidade se: estiver no plano contratado E
  // (houver override da loja → usa ele; senão o padrão da rede; senão ligado).
  // Trava real de acesso.
  async ativo(tenantId: string, unidadeId: string | null, modulo: string): Promise<boolean> {
    const plano = await this.doPlano(tenantId);
    if (plano && !plano.has(NO_PLANO[modulo] ?? modulo)) return false;
    if (unidadeId) {
      const [loja] = await this.db
        .select({ ativo: moduloAtivacao.ativo })
        .from(moduloAtivacao)
        .where(
          and(
            eq(moduloAtivacao.tenantId, tenantId),
            eq(moduloAtivacao.unidadeId, unidadeId),
            eq(moduloAtivacao.modulo, modulo),
          ),
        );
      if (loja) return loja.ativo;
    }
    const [rede] = await this.db
      .select({ ativo: moduloAtivacao.ativo })
      .from(moduloAtivacao)
      .where(
        and(
          eq(moduloAtivacao.tenantId, tenantId),
          isNull(moduloAtivacao.unidadeId),
          eq(moduloAtivacao.modulo, modulo),
        ),
      );
    return rede ? rede.ativo : true;
  }

  // Estado completo para a tela do presidente: rede + overrides por loja.
  async estado(tenantId: string) {
    const unidades = await this.rows(sql`
      select id, nome from unidade
      where tenant_id = ${tenantId} and deleted_at is null order by nome`);
    const linhas = await this.db
      .select()
      .from(moduloAtivacao)
      .where(eq(moduloAtivacao.tenantId, tenantId));

    const rede: Record<string, boolean> = {};
    const porUnidade: Record<string, Record<string, boolean>> = {};
    for (const m of MODULOS) rede[m.chave] = true; // default ligado
    for (const l of linhas) {
      if (l.unidadeId == null) rede[l.modulo] = l.ativo;
      else {
        porUnidade[l.unidadeId] ??= {};
        porUnidade[l.unidadeId][l.modulo] = l.ativo;
      }
    }
    return { modulos: MODULOS, unidades, rede, porUnidade };
  }

  // Estado resolvido para a unidade do usuário logado (apps checam ao abrir).
  async meus(user: AuthUser) {
    const out: Record<string, boolean> = {};
    for (const m of MODULOS) out[m.chave] = await this.ativo(user.tenantId, user.unidadeId ?? null, m.chave);
    return out;
  }

  // Liga/desliga um módulo por rede (unidadeId nulo) ou loja. Upsert + auditoria.
  async setar(
    ator: AuthUser,
    dto: { unidadeId?: string | null; modulo: string; ativo: boolean },
  ) {
    if (!CHAVES.has(dto.modulo)) throw new BadRequestException('Módulo inválido.');
    // Não dá para LIGAR o que não foi contratado — senão o toggle contornaria o
    // plano. Desligar é sempre permitido.
    if (dto.ativo) {
      const plano = await this.doPlano(ator.tenantId);
      if (plano && !plano.has(NO_PLANO[dto.modulo] ?? dto.modulo)) {
        throw new BadRequestException(
          'Este módulo não faz parte do plano contratado. Fale com o seu consultor para incluí-lo.',
        );
      }
    }
    const unidadeId = dto.unidadeId ?? null;

    if (unidadeId) {
      const [uni] = await this.db
        .select({ id: unidade.id })
        .from(unidade)
        .where(and(eq(unidade.id, unidadeId), eq(unidade.tenantId, ator.tenantId)));
      if (!uni) throw new BadRequestException('Unidade inválida.');
    }

    const cond = and(
      eq(moduloAtivacao.tenantId, ator.tenantId),
      eq(moduloAtivacao.modulo, dto.modulo),
      unidadeId
        ? eq(moduloAtivacao.unidadeId, unidadeId)
        : isNull(moduloAtivacao.unidadeId),
    );
    const [existente] = await this.db.select().from(moduloAtivacao).where(cond);
    if (existente) {
      await this.db
        .update(moduloAtivacao)
        .set({ ativo: dto.ativo, updatedAt: new Date() })
        .where(eq(moduloAtivacao.id, existente.id));
    } else {
      await this.db
        .insert(moduloAtivacao)
        .values({ tenantId: ator.tenantId, unidadeId, modulo: dto.modulo, ativo: dto.ativo });
    }

    await this.auditoria.registrar({
      tenantId: ator.tenantId,
      atorId: ator.colaboradorId,
      atorPerfil: ator.categoria,
      tipo: 'modulos',
      acao: dto.ativo ? 'modulo_ativado' : 'modulo_desativado',
      unidadeId: unidadeId ?? undefined,
      entidadeTipo: 'modulo',
      detalhe: { modulo: dto.modulo, escopo: unidadeId ? 'loja' : 'rede' },
    });
    return { ok: true };
  }
}
