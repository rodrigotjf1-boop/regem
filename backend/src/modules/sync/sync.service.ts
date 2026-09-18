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
  JANELA_ABERTOS,
  filtroLoja,
  TABELAS_DESDE_ZERO,
  TabelaSync,
  modoPush,
  colunaLWW,
  REDIGIR,
  TABELAS_EXCLUIVEIS,
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
    // Reinstalação LIMPA zera o contador do edge (seq volta a 1). Sem tratar, o edge fica
    // ETERNAMENTE "regredindo" (1<14110, 2<14110…) e FLODA o log a cada push. Queda GRANDE
    // (>50) = reinstalação → ACEITA o novo baseline (rebaseia last=n) e loga UMA vez; queda
    // pequena = duplicata real → só avisa. A segurança anti-replay real é a janela de 15min
    // do ts (acima) + a assinatura HMAC — o seq é secundário.
    const reinstalou = n < last && last - n > 50;
    if (n > last + 1) this.logger.warn(`GAP de sync (dev ${dev}): seq ${last} → ${n} — lotes omitidos?`);
    else if (reinstalou) this.logger.log(`sequência de push REINICIADA (dev ${dev}): ${last} → ${n} (reinstalação) — rebaseando; para de avisar.`);
    else if (n < last) this.logger.warn(`REGRESSÃO de seq (dev ${dev}): ${n} < ${last} — duplicata?`);
    // Anti-rollback de relógio: o ts do push nunca deveria retroceder.
    const tsAtual = new Date(ts).getTime();
    const tsMax = row0.t ? new Date(row0.t).getTime() : 0;
    if (tsAtual < tsMax) {
      this.logger.warn(`RELÓGIO retrocedeu (dev ${dev}): ${new Date(ts).toISOString()} < ${new Date(tsMax).toISOString()} — possível backdating.`);
    }
    // Avança (n>last) OU REBASEIA no reset (reinstalou → last=n) OU só o ts. No reset, o
    // próximo push (n+1 > n) já é normal → o spam para na 1ª linha.
    if (n > last || reinstalou || tsAtual > tsMax) {
      await this.db.execute(sql`update equipamento set
        last_push_seq = ${reinstalou ? n : Math.max(n, last)},
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

  // Marcador de mudança por tabela (mig 264) — uma leitura por pull. `balde` existe para a
  // gravação não serializar numa linha só; aqui pegamos o maior de cada tabela.
  private async marcadoresDe(tenantId: string): Promise<Map<string, string>> {
    try {
      const r: any = await this.db.execute(sql`
        select tabela, max(mudou_em)::text as m from sync_marcador
         where tenant_id = ${tenantId} group by tabela`);
      return new Map((r.rows ?? r).map((x: any) => [x.tabela as string, x.m as string]));
    } catch {
      // Sem a tabela (banco ainda sem a mig 264) o pull segue como antes.
      return new Map();
    }
  }

  // Deltas de controle (desce/ambos) desde o cursor, escopados ao tenant.
  // Identificadores (tabela/cursor) vêm da whitelist TABELAS_PULL — nunca do usuário.
  // `cursores` (opcional): mapa tabela→"<ts>|<id>" p/ o pull KEYSET por tabela (edge
  // novo). Ausente = caminho legado (cursor único), edge antigo inalterado.
  async pull(
    tenantId: string,
    desde?: string,
    cursores?: Record<string, string>,
    unidadeId?: string | null,
  ) {
    const saida: any = await this.deltas(
      tenantId, TABELAS_PULL, desde, cursores, await this.lojaDoEdge(tenantId, unidadeId),
    );
    // JANELA DE RETENÇÃO (mig 265): registro de exclusão vive 30 dias. Servidor local parado
    // mais que isso perdeu exclusões e não tem como saber — o sync seguiria com linha fantasma
    // para sempre. O mercado trata isso como reinicialização explícita: o Sync Gateway avisa
    // que o cliente offline além do expurgo perde a exclusão, o SQL Data Sync marca o grupo
    // como desatualizado e manda reprovisionar, e o AppSync cai na consulta base. Aqui pedimos
    // a restauração por arquivo, que é o nosso "recomeçar limpo" (e não perde o que é local:
    // o push sobe antes).
    if (atrasadoDemais(desde, cursores)) saida.reinicializar = true;
    return saida;
  }

  // A loja pela qual filtrar o pull: a do servidor local, e SÓ quando a empresa tem mais de
  // uma (decisão do dono). Uma loja só, ou edge sem loja definida → null = desce tudo.
  private async lojaDoEdge(tenantId: string, unidadeId?: string | null): Promise<string | null> {
    if (!unidadeId) return null;
    const r: any = await this.db.execute(
      sql`select count(*)::int as n from unidade where tenant_id = ${tenantId} and deleted_at is null`,
    );
    return Number((r.rows ?? r)[0]?.n ?? 0) > 1 ? unidadeId : null;
  }

  // RESTAURAÇÃO (nuvem → edge, sob demanda): deltas das tabelas TRANSACIONAIS.
  // Mesma mecânica do pull, outra whitelist (TABELAS_RESTORE). O edge faz UPSERT
  // por id (aditivo). Autenticado pelo mesmo sync token (tenant forçado).
  async restore(tenantId: string, desde?: string, unidadeId?: string | null) {
    return this.deltas(tenantId, TABELAS_RESTORE, desde, undefined, await this.lojaDoEdge(tenantId, unidadeId));
  }

  // ===== SNAPSHOT (Trilha A) — restore por ARQUIVO, robusto =====
  // Exporta as TRANSACIONAIS da loja como UM stream NDJSON gzip, escopado pelo tenant do
  // TOKEN (nunca cross-tenant). O edge baixa e carrega de uma vez, com FK desligada, no
  // lugar do restore linha-a-linha (que sofria 502-por-lote, ordem de FK e cursor
  // adiantado). Keyset por `id` NATIVO (uuid, usa o índice da PK; sem tie/skip); respeita
  // a janela mirror_dias do transacional pesado. Cada tabela vem precedida de {"__t":nome};
  // o fim é {"__fim":true,...} — o edge só aplica se recebeu o __fim (senão descarta).
  async snapshot(tenantId: string, res: Response, unidadeId?: string | null) {
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
      // Mesmo escopo por loja do pull: o arquivo do restore não leva o movimento da outra loja.
      const loja = await this.lojaDoEdge(tenantId, unidadeId);
      let total = 0;
      for (const t of TABELAS_RESTORE) {
        const colunas = await this.colunasDe(t.tabela);
        // Segurança/robustez: precisa de `id` (keyset) e `tenant_id` (escopo). Sem um
        // deles, pula a tabela — jamais exporta sem filtro de loja.
        if (!colunas.has('id') || !colunas.has('tenant_id')) continue;
        const janelaCol = colunas.has('created_at') ? 'created_at' : t.cursor;
        const janela =
          TABELAS_JANELA_MIRROR.has(t.tabela) && colunas.has(janelaCol)
            ? sql` and (${sql.identifier(janelaCol)} >= now() - (${dias} * interval '1 day')${abertoOu(t.tabela, colunas)})`
            : sql``;
        const porLoja = filtroLoja(t.tabela, colunas, loja);
        await escrever({ __t: t.tabela });
        let ultimoId = UUID_MIN;
        for (;;) {
          const r: any = await this.db.execute(sql`
            select * from ${sql.identifier(t.tabela)}
            where tenant_id = ${tenantId}${janela}${porLoja} and id > ${ultimoId}::uuid
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
    // Loja do servidor local (já resolvida por lojaDoEdge): filtra o transacional.
    loja: string | null = null,
  ) {
    const EPOCA = '1970-01-01T00:00:00Z';
    const desdeTs = desde || EPOCA;
    const keyset = !!cursores && typeof cursores === 'object';
    // MARCADOR (mig 264): "esta tabela desta empresa mudou quando?". Antes o pull consultava
    // as 59 tabelas TODA vez, mesmo sem nada ter mudado — medido: 56 consultas, 16.546 linhas
    // lidas e 897 blocos para devolver ZERO (e em 5.000 lojas isso projeta ~1,4 milhão de
    // linhas por segundo). O SymmetricDS lê UMA tabela de mudanças, o AppSync lê UMA tabela
    // delta e o Firestore empurra. Aqui: uma leitura do marcador e só consultamos as tabelas
    // cujo marcador é MAIS NOVO que o cursor daquele servidor local.
    const marcadores = await this.marcadoresDe(tenantId);
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
        ? sql` and (${sql.identifier(janelaCol)} >= now() - (${mirrorDias} * interval '1 day')${abertoOu(t.tabela, colunas)})`
        : sql``;
      // Filtro FIXO por tabela (constante do sync-config, nunca do usuário): ex.:
      // equipamento só sincroniza impressora/pdv/salao (nunca servidor_local).
      const filtro = t.filtroSql ? sql` and (${sql.raw(t.filtroSql)})` : sql``;
      // Escopo por LOJA do transacional (decisão do dono): a filial não baixa o movimento
      // da matriz. Cadastro e configuração seguem inteiros.
      const porLoja = filtroLoja(t.tabela, colunas, loja);
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
        const raw0 = cursores![t.tabela];
        const marca = marcadores.get(t.tabela);
        // Pula a tabela SEM CONSULTAR quando o marcador é estritamente anterior ao cursor: toda
        // linha dela tem `cursor <= marcador`, então não há nada depois do que este servidor já
        // tem. Na igualdade NÃO pula (pode haver linha com o mesmo instante e id maior).
        // Sem marcador (tabela nunca escrita nesta empresa, ou gatilho ausente) consulta como
        // antes — o silêncio nunca vira "não precisa sincronizar".
        if (raw0 && marca && marca < String(raw0).split('|')[0]) {
          tabelas[t.tabela] = [];
          cursoresOut[t.tabela] = raw0;
          continue;
        }
        // ── KEYSET por tabela. Cursor = "<timestamp texto full-precision>|<id>".
        // Sem `greatest(cursor, deleted_at)` aqui: o gatilho (mig 095) bumpa updated_at
        // no soft-delete, então a exclusão anda pelo próprio cursor (mesma premissa do
        // LWW). Comparação sargável (usa índice em (cursor) / (cursor,id)).
        const raw = cursores![t.tabela];
        // Sem cursor próprio da tabela: normalmente cai no piso GLOBAL. Para tabela
        // recém-adicionada ao sync isso é errado — num edge já instalado o piso está em
        // "agora" e o histórico nunca desceria (ver TABELAS_DESDE_ZERO).
        let kts = !raw && TABELAS_DESDE_ZERO.has(t.tabela) ? EPOCA : desdeTs;
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
          where ${sql.identifier(escopo)} = ${tenantId} and ${cond}${janela}${filtro}${porLoja}${porLoja}
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
  private aplicarExclusoes(tx: any, tenantId: string, linhas: any[]) {
    return aplicarExclusoesTx(tx, tenantId, linhas);
  }

  async push(
    ctx: SyncCtxData,
    lotes: LoteSyncDto[],
    assin: { seq?: string; ts?: string; sig?: string } = {},
  ) {
    // Circuit-breaker anti-tempestade: recusa push CONCORRENTE do mesmo dispositivo
    // (barato, 429) ANTES do trabalho pesado — a origem não afoga (evita o 502 em
    // cascata quando o daemon do edge sobrepõe ciclos). O edge reenvia no próximo ciclo.
    // Trava NO BANCO (advisory lock por dispositivo), não mais um conjunto em memória: com
    // mais de uma réplica da API, o conjunto só protegia dentro de cada processo e dois pushes
    // do mesmo servidor local passavam em paralelo. `pg_try_advisory_xact_lock` é barato e some
    // sozinho no fim da transação; a chave é o hash do id do equipamento.
    const travou: any = await this.db.execute(
      sql`select pg_try_advisory_lock(hashtext('sync_push'), hashtext(${ctx.equipamentoId})) as ok`,
    );
    if (!((travou.rows ?? travou)[0]?.ok)) {
      throw new HttpException('Já há um push deste dispositivo em curso.', HttpStatus.TOO_MANY_REQUESTS);
    }
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

      // Linhas válidas (com id). O tenant_id é FORÇADO ao do token (ignora o da linha).
      let linhas = (lote.linhas ?? []).filter(
        (l: any) => l && typeof l === 'object' && l.id,
      );
      ignoradas += (lote.linhas?.length ?? 0) - linhas.length;

      // EXCLUSÃO VENCE (reproduzido em teste): a nuvem apaga a linha, a loja edita a mesma
      // linha ANTES de receber a exclusão e o push a recria aqui — a linha apagada reaparece
      // e conta em relatório até a loja receber a exclusão e devolvê-la. É a regra "delete
      // always wins" do Atlas Device Sync e do GoldenGate. Linha com exclusão registrada é
      // descartada no push.
      if (linhas.length && TABELAS_EXCLUIVEIS.has(lote.tabela)) {
        const ids = linhas.map((l: any) => String(l.id));
        const rex: any = await this.db.execute(sql`
          select registro_id from sync_exclusao
           where tenant_id = ${tenantId} and tabela = ${lote.tabela}
             and registro_id in ${ids}`);
        const apagadas = new Set((rex.rows ?? rex).map((x: any) => String(x.registro_id)));
        if (apagadas.size) {
          const antes = linhas.length;
          linhas = linhas.filter((l: any) => !apagadas.has(String(l.id)));
          ignoradas += antes - linhas.length;
        }
      }

      if (linhas.length) {
        // Colunas do LOTE: do 1º registro (o edge manda `select *` → colunas consistentes).
        const cols = Object.keys(linhas[0] as any).filter(
          (k) => colunas.has(k) && k !== 'tenant_id',
        );
        const nomes = ['tenant_id', ...cols];
        const setCols = cols.filter((c) => c !== 'id');
        const lwwCol = modo === 'lww' ? colunaLWW(lote.tabela) : 'updated_at';
        // LWW (update-se-mais-nova) p/ tabela com updated_at; senão do-nothing (append imutável).
        const conflito =
          (modo === 'lww' || colunas.has('updated_at')) && setCols.length && colunas.has(lwwCol)
            ? sql`on conflict (id) do update set ${sql.join(
                setCols.map((c) => sql`${sql.identifier(c)} = excluded.${sql.identifier(c)}`),
                sql`, `,
              )}
              where ${sql.identifier(lote.tabela)}.tenant_id = excluded.tenant_id
                and ${sql.identifier(lote.tabela)}.${sql.identifier(lwwCol)} < excluded.${sql.identifier(lwwCol)}`
            : sql`on conflict (id) do nothing`;
        const linhaVals = (linha: any) =>
          sql`(${sql.join([tenantId, ...cols.map((c) => coagir(linha[c]))].map((v) => sql`${v}`), sql`, `)})`;
        const colsSql = sql.join(nomes.map((n) => sql.identifier(n)), sql`, `);

        // SET-BASED: 1 INSERT multi-linha por lote (1 ida ao banco no lugar de N). Com o
        // banco em Oregon (~200ms/ida), row-a-row × 200 linhas estourava o timeout de 100s
        // da Cloudflare → 502. Um bloco só resolve em ~1 ida. Regra "operação em massa =
        // query set-based, nunca loop N". Se o bloco falhar (FK fora de ordem, id repetido),
        // cai no FALLBACK linha-a-linha (ignora 23503/23505 por linha, sem derrubar o lote).
        //
        // Tudo numa transação marcada com `regem.sync = on` (mig 259): o gatilho de
        // updated_at mantém o carimbo que veio do edge. Sem a marca ele trocava pela hora da
        // nuvem, a linha voltava ao edge como "mais nova" e ficava indo e voltando a cada
        // ciclo — e o carimbo falso podia vencer uma edição real feita aqui no meio. O bloco
        // e cada linha do fallback rodam em SAVEPOINT, para uma falha não abortar a transação.
        await this.db.transaction(async (tx) => {
          await tx.execute(sql`select set_config('regem.sync', 'on', true)`);
          try {
            const r: any = await tx.transaction((sp) =>
              sp.execute(
                sql`insert into ${sql.identifier(lote.tabela)} (${colsSql}) values ${sql.join(linhas.map(linhaVals), sql`, `)} ${conflito}`,
              ),
            );
            aplicadas += r?.rowCount ?? 0;
            ignoradas += linhas.length - (r?.rowCount ?? 0);
          } catch {
            for (const linha of linhas) {
              try {
                const r: any = await tx.transaction((sp) =>
                  sp.execute(
                    sql`insert into ${sql.identifier(lote.tabela)} (${colsSql}) values ${linhaVals(linha)} ${conflito}`,
                  ),
                );
                if ((r?.rowCount ?? 0) > 0) aplicadas++;
                else ignoradas++;
              } catch (e: any) {
                if (e?.code === '23505' || e?.code === '23503') {
                  ignoradas++;
                  continue;
                }
                throw e;
              }
            }
          }
          // Exclusões que vieram do edge (mig 262): apaga a mesma linha aqui, na MESMA
          // transação marcada — então não gera outro registro de exclusão (sem eco). Só em
          // tabela sincronizada com estado e só dentro da empresa do token.
          if (lote.tabela === 'sync_exclusao') await this.aplicarExclusoes(tx, tenantId, linhas);
        });
      }
      resultado[lote.tabela] = { aplicadas, ignoradas };
    }

    return { serverTime: new Date().toISOString(), resultado };
    } finally {
      // Libera SEMPRE (sucesso ou erro). A conexão é do pool: sem o unlock explícito a trava
      // ficaria presa na sessão reaproveitada e o dispositivo não empurraria mais nada.
      await this.db
        .execute(sql`select pg_advisory_unlock(hashtext('sync_push'), hashtext(${ctx.equipamentoId}))`)
        .catch(() => undefined);
    }
  }
}

// O servidor local está mais atrasado que a janela de retenção das exclusões (mig 265)?
// Olha a posição MAIS VELHA que ele mandou: é a partir dela que ele ainda vai pedir dados.
export const RETENCAO_EXCLUSAO_DIAS = Number(process.env.SYNC_RETENCAO_DIAS ?? 30);
export function atrasadoDemais(desde?: string, cursores?: Record<string, string>): boolean {
  const limite = Date.now() - RETENCAO_EXCLUSAO_DIAS * 86400000;
  const quando = (v?: string) => {
    const t = new Date(String(v ?? '').split('|')[0]).getTime();
    return Number.isFinite(t) ? t : null;
  };
  const marcas = [quando(desde), ...Object.values(cursores ?? {}).map(quando)].filter(
    (x): x is number => x != null,
  );
  if (!marcas.length) return false; // 1ª sincronização (sem cursor) já vem completa
  // A época (1970) é o edge NOVO pedindo tudo desde o começo — não é atraso.
  const maisVelha = Math.min(...marcas);
  return maisVelha > new Date('1971-01-01').getTime() && maisVelha < limite;
}

// Aplica exclusões recebidas (sync_exclusao). Em savepoint por linha: apagar o pai antes do
// filho que não tem cascata dá 23503; as que falham são retentadas em mais passadas (a ordem
// entre elas é arbitrária) e, se ainda falharem, ficam de fora sem derrubar o lote.
async function aplicarExclusoesTx(tx: any, tenantId: string, linhas: any[]): Promise<void> {
  let pendentes = linhas.filter(
    (l: any) => l && TABELAS_EXCLUIVEIS.has(String(l.tabela)) && l.registro_id,
  );
  for (let passe = 0; passe < 3 && pendentes.length; passe++) {
    const resta: any[] = [];
    for (const l of pendentes) {
      try {
        await tx.transaction((sp: any) =>
          sp.execute(
            sql`delete from ${sql.identifier(String(l.tabela))} where id = ${l.registro_id} and tenant_id = ${tenantId}`,
          ),
        );
      } catch (e: any) {
        if (e?.code === '23503') resta.push(l);
        else throw e;
      }
    }
    if (resta.length === pendentes.length) break;
    pendentes = resta;
  }
}

// Exceção da janela: registro ainda aberto desce mesmo antigo (ver JANELA_ABERTOS).
function abertoOu(tabela: string, colunas: Set<string>) {
  const cond = JANELA_ABERTOS[tabela];
  return cond && colunas.has('status') ? sql` or (${sql.raw(cond)})` : sql``;
}

// jsonb/arrays viram string; o resto passa como está (pg casta pelo tipo da coluna).
function coagir(v: unknown): unknown {
  if (v !== null && typeof v === 'object') return JSON.stringify(v);
  return v;
}
