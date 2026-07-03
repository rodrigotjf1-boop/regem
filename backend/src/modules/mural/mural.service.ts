import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import {
  comunicado,
  comunicadoLeitura,
  climaPesquisa,
  climaResposta,
  climaParticipacao,
} from '../../db/schema';
import { AuthUser } from '../../auth/auth-user';
import { CreateComunicadoDto } from './dto/create-comunicado.dto';
import { CreatePesquisaDto } from './dto/create-pesquisa.dto';
import { ResponderClimaDto } from './dto/responder-clima.dto';

@Injectable()
export class MuralService {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDB) {}

  // Denominador do "11/14" — colaboradores ativos do tenant.
  private async totalColaboradores(tenantId: string): Promise<number> {
    const r: any = await this.db.execute(sql`
      select count(*)::int as n from colaborador
      where tenant_id = ${tenantId} and status = 'ativo' and deleted_at is null
    `);
    return Number((r.rows ?? r)[0]?.n ?? 0);
  }

  // Contagem de colaboradores ativos por unidade (null = sem unidade definida).
  private async contagemPorUnidade(tenantId: string) {
    const r: any = await this.db.execute(sql`
      select unidade_id as "unidadeId", count(*)::int as n
      from colaborador
      where tenant_id = ${tenantId} and status = 'ativo' and deleted_at is null
      group by unidade_id
    `);
    const rows = r.rows ?? r;
    let total = 0;
    let semUnidade = 0;
    const porUnidade = new Map<string, number>();
    for (const row of rows) {
      const n = Number(row.n);
      total += n;
      if (row.unidadeId) porUnidade.set(row.unidadeId, n);
      else semUnidade = n;
    }
    return { total, semUnidade, porUnidade };
  }

  // ── Mural ──────────────────────────────────────────────────────────────────
  async publicar(user: AuthUser, dto: CreateComunicadoDto) {
    const [row] = await this.db
      .insert(comunicado)
      .values({
        tenantId: user.tenantId,
        unidadeId: dto.unidadeId ?? user.unidadeId ?? undefined,
        setorId: dto.audiencia === 'setor' ? dto.setorId : undefined,
        autorColaboradorId: user.colaboradorId,
        titulo: dto.titulo,
        corpo: dto.corpo,
        audiencia: dto.audiencia ?? 'loja',
        fixado: dto.fixado ?? false,
      })
      .returning();
    return row;
  }

  async feed(user: AuthUser) {
    const { total, semUnidade, porUnidade } = await this.contagemPorUnidade(
      user.tenantId,
    );
    // Escopo multi-loja: usuário com unidade vê comunicados da rede (unidade nula)
    // + da própria loja; usuário sem unidade definida vê tudo do tenant.
    const filtroUnidade = user.unidadeId
      ? sql`and (c.unidade_id is null or c.unidade_id = ${user.unidadeId})`
      : sql``;
    const r: any = await this.db.execute(sql`
      select c.id, c.titulo, c.corpo, c.audiencia, c.fixado,
        c.created_at as "createdAt", c.setor_id as "setorId", c.unidade_id as "unidadeId",
        col.nome as "autorNome",
        (select count(*)::int from comunicado_leitura l where l.comunicado_id = c.id) as "leram",
        exists(
          select 1 from comunicado_leitura l
          where l.comunicado_id = c.id and l.colaborador_id = ${user.colaboradorId}
        ) as "euLi"
      from comunicado c
      left join colaborador col on col.id = c.autor_colaborador_id
      where c.tenant_id = ${user.tenantId} and c.deleted_at is null ${filtroUnidade}
      order by c.fixado desc, c.created_at desc
    `);
    const comunicados = (r.rows ?? r).map((c: any) => ({
      ...c,
      // Alvo (denominador) = quem aquele comunicado atinge. Rede = todos; loja =
      // colaboradores da loja + os sem unidade definida (que enxergam tudo).
      alvo: c.unidadeId
        ? semUnidade + (porUnidade.get(c.unidadeId) ?? 0)
        : total,
    }));
    return { total, comunicados };
  }

  async confirmarLeitura(user: AuthUser, comunicadoId: string) {
    // Idempotente: reler não duplica.
    await this.db
      .insert(comunicadoLeitura)
      .values({
        tenantId: user.tenantId,
        comunicadoId,
        colaboradorId: user.colaboradorId,
      })
      .onConflictDoNothing();
    return { ok: true };
  }

  // ── Clima (anônimo) ──────────────────────────────────────────────────────────
  async criarPesquisa(user: AuthUser, dto: CreatePesquisaDto) {
    const [row] = await this.db
      .insert(climaPesquisa)
      .values({
        tenantId: user.tenantId,
        unidadeId: dto.unidadeId ?? user.unidadeId ?? undefined,
        titulo: dto.titulo,
      })
      .returning();
    return row;
  }

  // Pesquisa aberta mais recente + CONSOLIDADO (nunca resposta individual).
  async climaAtual(user: AuthUser) {
    const p: any = await this.db.execute(sql`
      select id, titulo, aberta, created_at as "createdAt"
      from clima_pesquisa
      where tenant_id = ${user.tenantId} and deleted_at is null
      order by created_at desc limit 1
    `);
    const pesquisa = (p.rows ?? p)[0];
    if (!pesquisa) return { pesquisa: null };

    const total = await this.totalColaboradores(user.tenantId);
    const agg: any = await this.db.execute(sql`
      select humor, count(*)::int as n
      from clima_resposta
      where tenant_id = ${user.tenantId} and pesquisa_id = ${pesquisa.id}
      group by humor
    `);
    const distribuicao: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    for (const row of agg.rows ?? agg) distribuicao[Number(row.humor)] = Number(row.n);

    const part: any = await this.db.execute(sql`
      select
        (select count(*)::int from clima_participacao
          where pesquisa_id = ${pesquisa.id}) as "responderam",
        exists(select 1 from clima_participacao
          where pesquisa_id = ${pesquisa.id}
            and colaborador_id = ${user.colaboradorId}) as "euRespondi"
    `);
    const { responderam, euRespondi } = (part.rows ?? part)[0];

    // Anonimato reforçado: só revela o consolidado com massa crítica de respostas
    // (com N pequeno daria para inferir o humor de quem respondeu).
    const MIN_RESPOSTAS = 3;
    const nResp = Number(responderam);
    const revelar = nResp >= MIN_RESPOSTAS;

    return {
      pesquisa,
      total,
      responderam: nResp,
      euRespondi: Boolean(euRespondi),
      minRespostas: MIN_RESPOSTAS,
      distribuicaoOculta: !revelar,
      distribuicao: revelar ? distribuicao : null,
    };
  }

  async responder(user: AuthUser, pesquisaId: string, dto: ResponderClimaDto) {
    const p: any = await this.db.execute(sql`
      select aberta from clima_pesquisa
      where id = ${pesquisaId} and tenant_id = ${user.tenantId} and deleted_at is null
    `);
    const pesquisa = (p.rows ?? p)[0];
    if (!pesquisa) throw new NotFoundException('Pesquisa não encontrada.');
    if (!pesquisa.aberta) throw new BadRequestException('Pesquisa encerrada.');

    return this.db.transaction(async (tx) => {
      // A participação (com colaborador) trava o voto duplo…
      try {
        await tx.insert(climaParticipacao).values({
          tenantId: user.tenantId,
          pesquisaId,
          colaboradorId: user.colaboradorId,
        });
      } catch (e: any) {
        if (e?.code === '23505') {
          throw new BadRequestException('Você já respondeu esta pesquisa.');
        }
        throw e;
      }
      // …e a resposta é gravada SEM vínculo com a pessoa (anônima).
      await tx.insert(climaResposta).values({
        tenantId: user.tenantId,
        pesquisaId,
        humor: dto.humor,
        comentario: dto.comentario,
      });
      return { ok: true };
    });
  }
}
