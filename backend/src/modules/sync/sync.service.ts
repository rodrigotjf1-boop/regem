import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import {
  TABELAS_PULL,
  TABELAS_RESTORE,
  TABELAS_JANELA_MIRROR,
  TabelaSync,
  modoPush,
  colunaLWW,
  REDIGIR,
} from './sync-config';
import { LoteSyncDto } from './dto/push.dto';
import { assinarSync } from './sync-sig';
import type { SyncCtxData } from './sync-token.guard';

@Injectable()
export class SyncService {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDB) {}
  private readonly logger = new Logger('Sync');
  private colunasCache = new Map<string, Set<string>>();

  // Verifica a ASSINATURA do push (integridade/autenticidade) + a JANELA de tempo
  // (anti-replay) + a SEQUÊNCIA por dispositivo (anti-omissão). A chave HMAC é
  // derivada do token do dispositivo. Tolerante por padrão (só alerta se faltar) até
  // todos os edges enviarem — `SYNC_REQUIRE_SIG=true` passa a EXIGIR. A sig/ts REJEITAM;
  // o seq só ALERTA (gap/regressão) p/ não quebrar retry/restauração legítimos.
  private async verificarAssinatura(
    ctx: SyncCtxData,
    lotes: unknown,
    assin: { seq?: string; ts?: string; sig?: string },
  ) {
    const exigir = String(process.env.SYNC_REQUIRE_SIG ?? '').toLowerCase() === 'true';
    const dev = ctx.equipamentoId.slice(0, 8);
    const { seq, ts, sig } = assin;
    if (!sig || !seq || !ts) {
      if (exigir) throw new UnauthorizedException('Push sem assinatura.');
      this.logger.warn(`push sem assinatura (dev ${dev}) — tolerado`);
      return;
    }
    // Janela de tempo (anti-replay). Tolerância larga p/ absorver skew de relógio.
    const skew = Math.abs(Date.now() - new Date(ts).getTime());
    if (isNaN(skew) || skew > 15 * 60 * 1000) {
      throw new UnauthorizedException('Push fora da janela de tempo.');
    }
    // Assinatura HMAC (integridade + posse do token).
    const esperado = assinarSync(ctx.token, seq, ts, lotes);
    if (sig.length !== esperado.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(esperado))) {
      throw new UnauthorizedException('Assinatura de push inválida.');
    }
    // Sequência monotônica + anti-rollback de relógio por dispositivo — só ALERTAM.
    const r: any = await this.db.execute(
      sql`select last_push_seq as s, last_push_ts as t from equipamento where id = ${ctx.equipamentoId}`,
    );
    const row0 = (r.rows ?? r)[0] ?? {};
    const last = Number(row0.s) || 0;
    const n = Number(seq);
    if (n > last + 1) this.logger.warn(`GAP de sync (dev ${dev}): seq ${last} → ${n} — lotes omitidos?`);
    else if (n < last) this.logger.warn(`REGRESSÃO de seq (dev ${dev}): ${n} < ${last} — restauração/duplicata?`);
    // Anti-rollback de relógio: o ts do push nunca deveria retroceder.
    const tsAtual = new Date(ts).getTime();
    const tsMax = row0.t ? new Date(row0.t).getTime() : 0;
    if (tsAtual < tsMax) {
      this.logger.warn(`RELÓGIO retrocedeu (dev ${dev}): ${new Date(ts).toISOString()} < ${new Date(tsMax).toISOString()} — possível backdating.`);
    }
    if (n > last || tsAtual > tsMax) {
      await this.db.execute(sql`update equipamento set
        last_push_seq = ${Math.max(n, last)},
        last_push_ts = ${new Date(Math.max(tsAtual, tsMax)).toISOString()}
        where id = ${ctx.equipamentoId}`);
    }
  }

  // Colunas reais da tabela (whitelist por introspecção — nada de coluna arbitrária).
  private async colunasDe(tabela: string): Promise<Set<string>> {
    const cache = this.colunasCache.get(tabela);
    if (cache) return cache;
    const r: any = await this.db.execute(sql`
      select column_name from information_schema.columns
      where table_schema = 'public' and table_name = ${tabela}
    `);
    const set = new Set<string>((r.rows ?? r).map((x: any) => x.column_name));
    this.colunasCache.set(tabela, set);
    return set;
  }

  // Deltas de controle (desce/ambos) desde o cursor, escopados ao tenant.
  // Identificadores (tabela/cursor) vêm da whitelist TABELAS_PULL — nunca do usuário.
  async pull(tenantId: string, desde?: string) {
    return this.deltas(tenantId, TABELAS_PULL, desde);
  }

  // RESTAURAÇÃO (nuvem → edge, sob demanda): deltas das tabelas TRANSACIONAIS.
  // Mesma mecânica do pull, outra whitelist (TABELAS_RESTORE). O edge faz UPSERT
  // por id (aditivo). Autenticado pelo mesmo sync token (tenant forçado).
  async restore(tenantId: string, desde?: string) {
    return this.deltas(tenantId, TABELAS_RESTORE, desde);
  }

  // Janela de espelho (mirror_dias) da empresa — quantos dias de transacional pesado
  // o EDGE puxa. Defensivo: se a coluna ainda não foi migrada na nuvem, cai em 60.
  private async mirrorDias(tenantId: string): Promise<number> {
    try {
      const r: any = await this.db.execute(
        sql`select mirror_dias from empresa where id = ${tenantId}`,
      );
      const v = Number((r.rows ?? r)[0]?.mirror_dias);
      return Number.isFinite(v) && v > 0 ? v : 60;
    } catch {
      return 60;
    }
  }

  // Núcleo do delta por cursor, reutilizado por pull e restore.
  private async deltas(tenantId: string, lista: TabelaSync[], desde?: string) {
    const desdeTs = desde || '1970-01-01T00:00:00Z';
    const tabelas: Record<string, any[]> = {};
    const PAGINA = 1000; // linhas por tabela por request (evita 413)
    let maxCursor = desdeTs;
    const avancar = (v: any) => {
      if (v && new Date(v) > new Date(maxCursor)) maxCursor = v;
    };
    // Teto do cursor compartilhado: com UMA página por tabela e UM cursor único, se
    // alguma tabela satura (devolve página cheia) o proximoCursor NÃO pode avançar além
    // do último cursor dela — senão as linhas seguintes (cursor entre a página e o max de
    // outra tabela) seriam puladas para sempre. Guarda o MENOR teto entre as saturadas.
    let teto: string | null = null;
    const capar = (v: any) => {
      if (v && (teto === null || new Date(v) < new Date(teto))) teto = v;
    };
    // Só consulta a janela se alguma tabela da lista for transacional pesada.
    const usaJanela = lista.some((t) => TABELAS_JANELA_MIRROR.has(t.tabela));
    const mirrorDias = usaJanela ? await this.mirrorDias(tenantId) : 60;

    for (const t of lista) {
      // Defensivo: se o cursor configurado não existir na tabela real (drift de
      // schema), cai para created_at; sem nenhum → pula (não derruba o delta).
      const colunas = await this.colunasDe(t.tabela);
      const cursor = colunas.has(t.cursor)
        ? t.cursor
        : colunas.has('created_at')
          ? 'created_at'
          : colunas.has('criado_em')
            ? 'criado_em'
            : null;
      if (!cursor) continue;
      // Soft-delete também é "mudança": inclui deleted_at no delta (onde a coluna existe),
      // para exclusões propagarem mesmo que o updated_at não tenha sido bumpado.
      const temDel = colunas.has('deleted_at');
      const cond = temDel
        ? sql`(${sql.identifier(cursor)} > ${desdeTs} or deleted_at > ${desdeTs})`
        : sql`${sql.identifier(cursor)} > ${desdeTs}`;
      // Janela de espelho: transacional pesado só desce dos últimos `mirror_dias`
      // (por created_at quando existe — "N dias de vendas"; senão pelo cursor). A
      // nuvem guarda tudo; isto só limita o que o edge puxa. Controle/catálogo = sem janela.
      const janelaCol = colunas.has('created_at') ? 'created_at' : cursor;
      const janela = TABELAS_JANELA_MIRROR.has(t.tabela)
        ? sql` and ${sql.identifier(janelaCol)} >= now() - (${mirrorDias} * interval '1 day')`
        : sql``;
      // Filtro FIXO por tabela (constante do sync-config, nunca do usuário): ex.:
      // equipamento só sincroniza impressora/pdv/salao (nunca servidor_local).
      const filtro = t.filtroSql ? sql` and (${sql.raw(t.filtroSql)})` : sql``;
      const escopo = t.escopo ?? 'tenant_id';
      const r: any = await this.db.execute(sql`
        select * from ${sql.identifier(t.tabela)}
        where ${sql.identifier(escopo)} = ${tenantId} and ${cond}${janela}${filtro}
        order by ${sql.identifier(cursor)} asc
        limit ${PAGINA}
      `);
      let rows = r.rows ?? r;
      // Saturou a página → o proximoCursor não pode passar do último cursor desta tabela.
      // ALÉM disso, como o backfill do CRM bumpa `atualizado_em = now()` para MUITOS
      // clientes na MESMA transação, centenas de linhas compartilham o mesmo cursor: com
      // `>` estrito o próximo ciclo pularia os empatados além da página. Por isso, quando
      // satura, completamos TODAS as linhas com o cursor igual ao da borda (fecha os
      // empates) e paramos o cursor nessa borda — os ciclos seguintes trazem o resto.
      if (rows.length === PAGINA) {
        const borda = rows[rows.length - 1]?.[cursor];
        if (borda) {
          const rb: any = await this.db.execute(sql`
            select * from ${sql.identifier(t.tabela)}
            where ${sql.identifier(escopo)} = ${tenantId}
              and ${sql.identifier(cursor)} = ${borda}${janela}${filtro}
            limit 50000
          `);
          const empatadas = rb.rows ?? rb;
          const porId = new Map(rows.map((x: any) => [x.id, x]));
          for (const x of empatadas) porId.set(x.id, x);
          rows = [...porId.values()];
          capar(borda); // não avança além da borda (linhas > borda vêm depois)
        }
      }
      const segredos = REDIGIR[t.tabela];
      const limpas = segredos
        ? rows.map((row: any) => {
            const c = { ...row };
            for (const s of segredos) delete c[s];
            return c;
          })
        : rows;
      tabelas[t.tabela] = limpas;
      for (const row of rows) {
        avancar(row[cursor]);
        if (temDel) avancar(row['deleted_at']);
      }
    }

    // Se nenhuma tabela saturou, avança tudo (maxCursor). Se saturou, respeita o teto.
    const proximoCursor =
      teto && new Date(teto) < new Date(maxCursor) ? teto : maxCursor;

    return {
      serverTime: new Date().toISOString(),
      desde: desdeTs,
      proximoCursor,
      tabelas,
    };
  }

  // Ingestão (local → nuvem). Seguro:
  // - tabela na whitelist (append 'sobe' | lww 'ambos'); senão rejeita;
  // - tenant_id FORÇADO ao do token (ignora o que vier na linha);
  // - só colunas reais (introspecção); jsonb serializado;
  // - append: on conflict (id) do nothing (idempotente);
  // - lww: on conflict (id) do update SÓ se a recebida for mais nova, e SÓ do mesmo tenant.
  async push(
    ctx: SyncCtxData,
    lotes: LoteSyncDto[],
    assin: { seq?: string; ts?: string; sig?: string } = {},
  ) {
    await this.verificarAssinatura(ctx, lotes, assin);
    const tenantId = ctx.tenantId;
    const resultado: Record<string, { aplicadas: number; ignoradas: number }> = {};

    for (const lote of lotes) {
      const modo = modoPush(lote.tabela);
      if (!modo) {
        throw new BadRequestException(`Tabela não permitida no push: ${lote.tabela}`);
      }
      const colunas = await this.colunasDe(lote.tabela);
      let aplicadas = 0;
      let ignoradas = 0;

      for (const linha of lote.linhas ?? []) {
        if (!linha || typeof linha !== 'object' || !linha.id) {
          ignoradas++;
          continue;
        }
        const cols = Object.keys(linha).filter(
          (k) => colunas.has(k) && k !== 'tenant_id',
        );
        const nomes = ['tenant_id', ...cols];
        const valores = [tenantId, ...cols.map((c) => coagir((linha as any)[c]))];
        const insercao = sql`insert into ${sql.identifier(lote.tabela)} (
            ${sql.join(nomes.map((n) => sql.identifier(n)), sql`, `)}
          ) values (
            ${sql.join(valores.map((v) => sql`${v}`), sql`, `)}
          )`;

        // LWW (update-se-mais-nova) para QUALQUER tabela com `updated_at` — inclui
        // as transacionais 'sobe' da v2, que mudam de estado. Tabelas append puras
        // (sem updated_at, ex.: movimento_estoque) seguem do-nothing (imutáveis).
        const setCols = cols.filter((c) => c !== 'id');
        // Coluna de comparação do LWW: cursor configurado p/ tabelas 'ambos'
        // (cliente = atualizado_em), updated_at p/ o caso legado (append c/ updated_at).
        const lwwCol = modo === 'lww' ? colunaLWW(lote.tabela) : 'updated_at';
        const conflito =
          (modo === 'lww' || colunas.has('updated_at')) &&
          setCols.length &&
          colunas.has(lwwCol)
            ? sql`on conflict (id) do update set ${sql.join(
                setCols.map((c) => sql`${sql.identifier(c)} = excluded.${sql.identifier(c)}`),
                sql`, `,
              )}
              where ${sql.identifier(lote.tabela)}.tenant_id = excluded.tenant_id
                and ${sql.identifier(lote.tabela)}.${sql.identifier(lwwCol)} < excluded.${sql.identifier(lwwCol)}`
            : sql`on conflict (id) do nothing`;

        try {
          const r: any = await this.db.execute(sql`${insercao} ${conflito}`);
          if ((r?.rowCount ?? 0) > 0) aplicadas++;
          else ignoradas++;
        } catch (e: any) {
          // 23505 = duplicado; 23503 = FK fora de ordem (pai ainda não chegou) —
          // ignora sem derrubar o push (a linha volta no próximo ciclo/estado).
          if (e?.code === '23505' || e?.code === '23503') {
            ignoradas++;
            continue;
          }
          throw e;
        }
      }
      resultado[lote.tabela] = { aplicadas, ignoradas };
    }

    return { serverTime: new Date().toISOString(), resultado };
  }
}

// jsonb/arrays viram string; o resto passa como está (pg casta pelo tipo da coluna).
function coagir(v: unknown): unknown {
  if (v !== null && typeof v === 'object') return JSON.stringify(v);
  return v;
}
