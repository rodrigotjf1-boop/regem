import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
import { createGzip } from 'node:zlib';
import type { Response } from 'express';
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
  // Circuit-breaker anti-tempestade: 1 push por vez por dispositivo. Se o edge (com
  // daemon sem trava de reentrância) manda pushes SOBREPOSTOS, os concorrentes são
  // rejeitados BARATO (429) antes do upsert pesado — a origem não afoga (evita o 502
  // em cascata). O edge trata como falha e reenvia no próximo ciclo. In-memory basta
  // (1 instância); com réplicas, ainda limita a concorrência por instância.
  private readonly pushEmCurso = new Set<string>();

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
  // `cursores` (opcional): mapa tabela→"<ts>|<id>" p/ o pull KEYSET por tabela (edge
  // novo). Ausente = caminho legado (cursor único), edge antigo inalterado.
  async pull(tenantId: string, desde?: string, cursores?: Record<string, string>) {
    return this.deltas(tenantId, TABELAS_PULL, desde, cursores);
  }

  // RESTAURAÇÃO (nuvem → edge, sob demanda): deltas das tabelas TRANSACIONAIS.
  // Mesma mecânica do pull, outra whitelist (TABELAS_RESTORE). O edge faz UPSERT
  // por id (aditivo). Autenticado pelo mesmo sync token (tenant forçado).
  async restore(tenantId: string, desde?: string) {
    return this.deltas(tenantId, TABELAS_RESTORE, desde);
  }

  // ===== SNAPSHOT (Trilha A) — restore por ARQUIVO, robusto =====
  // Exporta as TRANSACIONAIS da loja como UM stream NDJSON gzip, escopado pelo tenant do
  // TOKEN (nunca cross-tenant). O edge baixa e carrega de uma vez, com FK desligada, no
  // lugar do restore linha-a-linha (que sofria 502-por-lote, ordem de FK e cursor
  // adiantado). Keyset por `id` NATIVO (uuid, usa o índice da PK; sem tie/skip); respeita
  // a janela mirror_dias do transacional pesado. Cada tabela vem precedida de {"__t":nome};
  // o fim é {"__fim":true,...} — o edge só aplica se recebeu o __fim (senão descarta).
  async snapshot(tenantId: string, res: Response) {
    // gzip como CORPO OPACO (octet-stream), NÃO Content-Encoding: assim nem o cliente nem
    // a Cloudflare descomprimem/recomprimem sozinhos — o edge gunzipa explícito (determinístico).
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Cache-Control', 'no-store');
    const gz = createGzip();
    gz.pipe(res);
    const escrever = (obj: unknown) =>
      new Promise<void>((resolve, reject) => {
        gz.write(JSON.stringify(obj) + '\n', (err) => (err ? reject(err) : resolve()));
      });
    const UUID_MIN = '00000000-0000-0000-0000-000000000000';
    try {
      const dias = await this.mirrorDias(tenantId);
      let total = 0;
      for (const t of TABELAS_RESTORE) {
        const colunas = await this.colunasDe(t.tabela);
        // Segurança/robustez: precisa de `id` (keyset) e `tenant_id` (escopo). Sem um
        // deles, pula a tabela — jamais exporta sem filtro de loja.
        if (!colunas.has('id') || !colunas.has('tenant_id')) continue;
        const janelaCol = colunas.has('created_at') ? 'created_at' : t.cursor;
        const janela =
          TABELAS_JANELA_MIRROR.has(t.tabela) && colunas.has(janelaCol)
            ? sql` and ${sql.identifier(janelaCol)} >= now() - (${dias} * interval '1 day')`
            : sql``;
        await escrever({ __t: t.tabela });
        let ultimoId = UUID_MIN;
        for (;;) {
          const r: any = await this.db.execute(sql`
            select * from ${sql.identifier(t.tabela)}
            where tenant_id = ${tenantId}${janela} and id > ${ultimoId}::uuid
            order by id asc limit 1000`);
          const rows = (r.rows ?? r) as any[];
          if (!rows.length) break;
          for (const row of rows) {
            await escrever(row);
            total++;
          }
          ultimoId = String(rows[rows.length - 1].id);
          if (rows.length < 1000) break;
        }
      }
      await escrever({ __fim: true, linhas: total });
      this.logger.log(`snapshot: loja ${tenantId} → ${total} linha(s)`);
    } catch (e: any) {
      // Já pipamos o gzip → não dá pra trocar por 500. Encerramos SEM __fim; o edge
      // detecta a ausência do marcador final e DESCARTA (não aplica um snapshot parcial).
      this.logger.error(`snapshot loja ${tenantId} FALHOU: ${e?.message ?? e}`);
    } finally {
      gz.end();
    }
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
  // `cursores` presente → pull KEYSET por tabela (edge novo): cada tabela avança pelo
  // par composto (coluna_cursor, id), eliminando o pulo do cursor compartilhado e os
  // empates no limite da página. Ausente → caminho LEGADO (cursor único + teto +
  // completar empates), preservado 100% para o edge antigo que não manda `cursores`.
  private async deltas(
    tenantId: string,
    lista: TabelaSync[],
    desde?: string,
    cursores?: Record<string, string>,
  ) {
    const desdeTs = desde || '1970-01-01T00:00:00Z';
    const keyset = !!cursores && typeof cursores === 'object';
    const tabelas: Record<string, any[]> = {};
    const cursoresOut: Record<string, string> = {};
    const PAGINA = 1000; // linhas por tabela por request (evita 413)
    let maxCursor = desdeTs;
    const avancar = (v: any) => {
      if (v && new Date(v) > new Date(maxCursor)) maxCursor = v;
    };
    // Teto do cursor compartilhado (SÓ no caminho legado): com UMA página por tabela e
    // UM cursor único, se alguma tabela satura o proximoCursor NÃO pode avançar além do
    // último cursor dela — senão linhas seguintes seriam puladas. Menor teto entre as
    // saturadas. O keyset não precisa disto (cada tabela tem seu próprio cursor).
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
      const temDel = colunas.has('deleted_at');
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
      const segredos = REDIGIR[t.tabela];
      // Limpa: remove o cursor auxiliar __kc e eventuais segredos antes de devolver.
      const limpar = (rows: any[]) =>
        rows.map((row: any) => {
          const c = { ...row };
          delete c.__kc;
          if (segredos) for (const s of segredos) delete c[s];
          return c;
        });

      if (keyset) {
        // ── KEYSET por tabela. Cursor = "<timestamp texto full-precision>|<id>".
        // Sem `greatest(cursor, deleted_at)` aqui: o gatilho (mig 095) bumpa updated_at
        // no soft-delete, então a exclusão anda pelo próprio cursor (mesma premissa do
        // LWW). Comparação sargável (usa índice em (cursor) / (cursor,id)).
        const raw = cursores![t.tabela];
        let kts = desdeTs;
        let kid = '';
        if (raw) {
          const p = raw.indexOf('|');
          kts = p >= 0 ? raw.slice(0, p) : raw;
          kid = p >= 0 ? raw.slice(p + 1) : '';
        }
        const cond = kid
          ? sql`(${sql.identifier(cursor)} > ${kts}::timestamptz
                 or (${sql.identifier(cursor)} = ${kts}::timestamptz and ${sql.identifier('id')} > ${kid}))`
          : sql`${sql.identifier(cursor)} > ${kts}::timestamptz`;
        const r: any = await this.db.execute(sql`
          select *, ${sql.identifier(cursor)}::text as __kc
          from ${sql.identifier(t.tabela)}
          where ${sql.identifier(escopo)} = ${tenantId} and ${cond}${janela}${filtro}
          order by ${sql.identifier(cursor)} asc, ${sql.identifier('id')} asc
          limit ${PAGINA}
        `);
        const rows = r.rows ?? r;
        tabelas[t.tabela] = limpar(rows);
        if (rows.length) {
          const last = rows[rows.length - 1];
          cursoresOut[t.tabela] = `${last.__kc}|${last.id}`;
          avancar(last.__kc);
        } else if (raw) {
          cursoresOut[t.tabela] = raw; // sem novidade — preserva a posição da tabela
        }
        continue;
      }

      // ── LEGADO (edge antigo, sem `cursores`): cursor único + teto + completa empates.
      // Soft-delete também é "mudança": inclui deleted_at (onde existe) p/ exclusões
      // propagarem mesmo sem bump de updated_at.
      const cond = temDel
        ? sql`(${sql.identifier(cursor)} > ${desdeTs} or deleted_at > ${desdeTs})`
        : sql`${sql.identifier(cursor)} > ${desdeTs}`;
      const r: any = await this.db.execute(sql`
        select * from ${sql.identifier(t.tabela)}
        where ${sql.identifier(escopo)} = ${tenantId} and ${cond}${janela}${filtro}
        order by ${sql.identifier(cursor)} asc
        limit ${PAGINA}
      `);
      let rows = r.rows ?? r;
      // Saturou → completa os empatados do último cursor e para o teto nessa borda.
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
          capar(borda);
        }
      }
      tabelas[t.tabela] = limpar(rows);
      for (const row of rows) {
        avancar(row[cursor]);
        if (temDel) avancar(row['deleted_at']);
      }
    }

    // Legado: se saturou, respeita o teto; senão avança tudo. Keyset: proximoCursor é só
    // um backstop (maior cursor visto) — a posição real vai no mapa `cursores`.
    const proximoCursor =
      teto && new Date(teto) < new Date(maxCursor) ? teto : maxCursor;

    return {
      serverTime: new Date().toISOString(),
      desde: desdeTs,
      proximoCursor,
      ...(keyset ? { cursores: cursoresOut } : {}),
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
    // Circuit-breaker anti-tempestade: recusa push CONCORRENTE do mesmo dispositivo
    // (barato, 429) ANTES do trabalho pesado — a origem não afoga (evita o 502 em
    // cascata quando o daemon do edge sobrepõe ciclos). O edge reenvia no próximo ciclo.
    if (this.pushEmCurso.has(ctx.equipamentoId)) {
      throw new HttpException('Já há um push deste dispositivo em curso.', HttpStatus.TOO_MANY_REQUESTS);
    }
    this.pushEmCurso.add(ctx.equipamentoId);
    try {
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
    } finally {
      this.pushEmCurso.delete(ctx.equipamentoId); // libera SEMPRE (sucesso ou erro)
    }
  }
}

// jsonb/arrays viram string; o resto passa como está (pg casta pelo tipo da coluna).
function coagir(v: unknown): unknown {
  if (v !== null && typeof v === 'object') return JSON.stringify(v);
  return v;
}
