/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  BadGatewayException,
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { sql, type SQL } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { AuthUser } from '../../auth/auth-user';
import { ehServidorLocal } from '../../common/modo';
import { FUSO_SQL } from '../../common/fuso-sql';
import { sqlUnidadeOuRede } from '../../common/filtro-unidade';
import { chaveSql } from '../ponte-chat/casos-do-chat';
import { inicioDoCasoSql } from './horario-da-equipe';
import {
  casosDoNumero,
  classificacaoGravada,
  ehMotivo,
  lerOQueAconteceu,
  lerPeriodo,
  MAX_PRODUTOS,
  montarNumeros,
  MOTIVOS,
  oQueAconteceuNoCaso,
  type ChatDoPeriodo,
  type LinhaDoCaso,
  type OQueAconteceu,
  type Periodo,
} from './numeros';

// NÚMEROS DO ATENDIMENTO (item 8 da Central; protótipo versão 6): placar por canal, reclamações por motivo e por produto,
// quanto custou — da LOJA EM USO (o caso sem loja, do robô da empresa toda, entra em todas — V4); o presidente em "todas
// as lojas" vê a soma (V48). Período no fuso da operação (ERR-120). As mensagens do chat do iFood e da 99 moram só na
// nuvem: no servidor da loja a conta inteira vem de lá (V37).

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Quantos casos do período entram na conta, no máximo (os mais novos). Acima disso a resposta avisa `parcial`. */
export const LIMITE_DE_CASOS = 5000;
/** A mensagem do cliente sem resposta há menos que isto ainda está esperando: não conta como "sem resposta". */
const ESPERA_DO_CHAT = sql.raw(`interval '15 minutes'`);

@Injectable()
export class NumerosDoAtendimentoService {
  private readonly logger = new Logger('NumerosDoAtendimento');

  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDB) {}

  /** O início e o fim do período, como instantes (o mês é o do relógio da operação). */
  private async limites(p: Periodo): Promise<{ de: string; ate: string }> {
    const mes = sql`(date_trunc('month', now() at time zone ${FUSO_SQL}) at time zone ${FUSO_SQL})`;
    const de: SQL =
      p === '7'
        ? sql`now() - interval '7 days'`
        : p === '30'
          ? sql`now() - interval '30 days'`
          : p === 'mes'
            ? mes
            : sql`(date_trunc('month', (now() at time zone ${FUSO_SQL}) - interval '1 month') at time zone ${FUSO_SQL})`;
    const ate: SQL = p === 'ant' ? mes : sql`now()`;
    const r: any = await this.db.execute(sql`select ${de} as de, ${ate} as ate`);
    const l = (r.rows ?? r)[0];
    return { de: new Date(l.de).toISOString(), ate: new Date(l.ate).toISOString() };
  }

  /** As linhas dos casos do período (só o que a conta usa do `detalhe` — nada da conversa), os mais novos primeiro. */
  private async linhas(tenantId: string, unidade: string | null, de: string, ate: string, limite = LIMITE_DE_CASOS + 1): Promise<LinhaDoCaso[]> {
    const r: any = await this.db.execute(sql`
      select ch.id, ch.tipo, ch.canal, ch.status, ch.decisao, ch.criado_em as "criadoEm", ch.pego_em as "pegoEm",
             ${inicioDoCasoSql('ch')} as "inicioEm",
             ch.resolvido_em as "resolvidoEm", ch.resolvido_por_id as "resolvidoPorId", ch.prazo_em as "prazoEm",
             ch.cliente, ch.pedido_numero as "pedidoNumero",
             (select round(pe.total * 100)::int from pedido_externo pe where pe.id = ch.pedido_id and pe.tenant_id = ch.tenant_id) as "totalCentavos",
             case when ch.detalhe ? 'disputa' then jsonb_build_object(
               'acao', ch.detalhe -> 'disputa' -> 'acao', 'tipo', ch.detalhe -> 'disputa' -> 'tipo',
               'acaoAutomatica', ch.detalhe -> 'disputa' -> 'acaoAutomatica', 'itens', ch.detalhe -> 'disputa' -> 'itens') end as disputa,
             case when ch.detalhe ? 'encerramento' then jsonb_build_object(
               'status', ch.detalhe -> 'encerramento' -> 'status', 'proposta', ch.detalhe -> 'encerramento' -> 'proposta') end as encerramento,
             case when ch.detalhe ? 'resposta' then jsonb_build_object(
               'em', ch.detalhe -> 'resposta' -> 'em', 'automatico', ch.detalhe -> 'resposta' -> 'automatico') end as resposta,
             case when jsonb_typeof(ch.detalhe -> 'pedido99' -> 'valorCentavos') = 'number'
                  then (ch.detalhe -> 'pedido99' ->> 'valorCentavos')::numeric end as "valor99",
             ch.detalhe -> 'classificacao' as classificacao
        from atendimento_chamado ch
       where ch.tenant_id = ${tenantId} and ch.criado_em >= ${de}::timestamptz and ch.criado_em < ${ate}::timestamptz
             ${sqlUnidadeOuRede('ch.unidade_id', unidade)}
       order by ch.criado_em desc
       limit ${limite}`);
    return ((r.rows ?? r) as any[]).map((l) => ({
      ...l,
      totalCentavos: l.totalCentavos == null ? null : Number(l.totalCentavos),
      valor99: l.valor99 == null ? null : Number(l.valor99),
    }));
  }

  /**
   * O placar do chat do iFood e da 99, numa consulta (V31: nada de laço). Cada vez que o cliente escreve depois de a loja
   * ter falado (ou abre a conversa) é uma "mensagem que espera"; ela foi respondida quando a LOJA escreve depois — a equipe
   * pelo Regem (enviada), o robô (enviada) ou alguém direto no Gestor da plataforma (lida pela ponte). Os avisos
   * automáticos ("saiu", "chegando") não contam como resposta. A que ainda espera há menos de 15 min fica de fora.
   */
  private async chat(tenantId: string, unidade: string | null, de: string, ate: string): Promise<ChatDoPeriodo[]> {
    const r: any = await this.db.execute(sql`
      with m as (
        select m.canal, ${chaveSql('m')} as conv,
               case when m.autor = 'cliente' and m.direcao = 'entrada' then 'c'
                    when m.autor in ('loja', 'equipe', 'robo') and (m.direcao = 'entrada' or m.estado = 'enviada') then 'l' end as quem,
               coalesce(m.enviado_em, m.criado_em) as em
          from chat_plataforma_msg m
         where m.tenant_id = ${tenantId} and m.canal in ('ifood', '99food')
           and m.criado_em >= ${de}::timestamptz - interval '1 day' and m.criado_em < ${ate}::timestamptz + interval '1 day'
           ${sqlUnidadeOuRede('m.unidade_id', unidade)}
      ), v as (
        select canal, quem, em,
               lag(quem) over (partition by canal, conv order by em, quem desc) as antes,
               min(case when quem = 'l' then em end)
                 over (partition by canal, conv order by em, quem desc rows between current row and unbounded following) as resposta
          from m
         where quem is not null and conv is not null
      )
      select canal,
             count(*) filter (where resposta is not null or em <= now() - ${ESPERA_DO_CHAT})::int as chegaram,
             count(*) filter (where resposta is not null)::int as respondidas,
             round(avg(extract(epoch from resposta - em)) filter (where resposta is not null))::int as seg
        from v
       where quem = 'c' and antes is distinct from 'c' and em >= ${de}::timestamptz and em < ${ate}::timestamptz
       group by canal`);
    return (r.rows ?? r) as ChatDoPeriodo[];
  }

  /**
   * O placar do Instagram Direct (mig 377), pela mesma régua do chat: a mensagem do cliente que espera e a primeira da loja
   * depois dela — a equipe pelo Regem ou quem respondeu no próprio app do Instagram (o eco); a que falhou não conta. A
   * conta do Instagram é da empresa (não tem loja): entra em todas as lojas, como o caso sem loja (V4).
   */
  private async instagram(tenantId: string, de: string, ate: string): Promise<ChatDoPeriodo[]> {
    const r: any = await this.db.execute(sql`
      with m as (
        select igsid as conv,
               case when autor = 'cliente' then 'c' when autor in ('equipe', 'loja', 'robo') and estado = 'enviada' then 'l' end as quem,
               criado_em as em
          from instagram_mensagem
         where tenant_id = ${tenantId}
           and criado_em >= ${de}::timestamptz - interval '1 day' and criado_em < ${ate}::timestamptz + interval '1 day'
      ), v as (
        select quem, em,
               lag(quem) over (partition by conv order by em, quem desc) as antes,
               min(case when quem = 'l' then em end) over (partition by conv order by em, quem desc rows between current row and unbounded following) as resposta
          from m
         where quem is not null
      )
      select 'instagram' as canal,
             count(*) filter (where resposta is not null or em <= now() - ${ESPERA_DO_CHAT})::int as chegaram,
             count(*) filter (where resposta is not null)::int as respondidas,
             round(avg(extract(epoch from resposta - em)) filter (where resposta is not null))::int as seg
        from v
       where quem = 'c' and antes is distinct from 'c' and em >= ${de}::timestamptz and em < ${ate}::timestamptz`);
    return ((r.rows ?? r) as ChatDoPeriodo[]).filter((l) => Number(l.chegaram) > 0 || Number(l.respondidas) > 0);
  }

  /** Os números do período, para a página "Números do atendimento". */
  async numeros(tenantId: string, unidade: string | null, periodoPedido: unknown) {
    const periodo = lerPeriodo(periodoPedido);
    if (ehServidorLocal()) return this.pelaNuvem(`numeros-da-loja?${this.consulta(periodo, unidade).toString()}`);
    const { de, ate } = await this.limites(periodo);
    const [linhas, chat, direct] = await Promise.all([
      this.linhas(tenantId, unidade, de, ate),
      this.chat(tenantId, unidade, de, ate),
      this.instagram(tenantId, de, ate),
    ]);
    const parcial = linhas.length > LIMITE_DE_CASOS;
    const n = montarNumeros(linhas.slice(0, LIMITE_DE_CASOS), [...chat, ...direct], Date.now());
    return { periodo: { chave: periodo, de, ate }, parcial, ...n, motivosDaLista: MOTIVOS.map((m) => ({ k: m.k, nome: m.nome })) };
  }

  /** Os casos atrás de um motivo ou de um produto (a gaveta). */
  async casos(tenantId: string, unidade: string | null, q: { periodo?: unknown; motivo?: unknown; produto?: unknown }) {
    const periodo = lerPeriodo(q?.periodo);
    const motivo = typeof q?.motivo === 'string' && (q.motivo === 'sem' || ehMotivo(q.motivo)) ? q.motivo : undefined;
    const produto = typeof q?.produto === 'string' && q.produto.trim() ? q.produto.trim().slice(0, 120) : undefined;
    if (!motivo && !produto) throw new BadRequestException('Escolha um motivo ou um produto.');
    if (ehServidorLocal()) {
      const c = this.consulta(periodo, unidade);
      if (motivo) c.set('motivo', motivo);
      if (produto) c.set('produto', produto);
      return this.pelaNuvem(`numeros-da-loja/casos?${c.toString()}`);
    }
    const { de, ate } = await this.limites(periodo);
    const linhas = await this.linhas(tenantId, unidade, de, ate, LIMITE_DE_CASOS);
    return casosDoNumero(linhas, { motivo, produto });
  }

  /**
   * Para o passo "O que aconteceu?": o que já está marcado (pela equipe ou pelo que a plataforma disse) e os produtos do
   * pedido do caso (os itens do pedido; na disputa sem pedido no Regem, os itens que o iFood mandou). Lê o banco deste
   * lado (o caso e o pedido sincronizam): funciona também no servidor da loja.
   */
  async doCaso(tenantId: string, id: string) {
    if (!UUID_RE.test(String(id ?? ''))) throw new NotFoundException('Caso não encontrado.');
    const r: any = await this.db.execute(sql`
      select ch.id, ch.tipo, ch.canal, ch.status, ch.decisao, ch.criado_em as "criadoEm", ch.pego_em as "pegoEm",
             ch.resolvido_em as "resolvidoEm", ch.resolvido_por_id as "resolvidoPorId", ch.prazo_em as "prazoEm",
             ch.cliente, ch.pedido_numero as "pedidoNumero", null::int as "totalCentavos",
             case when ch.detalhe ? 'disputa' then jsonb_build_object(
               'acao', ch.detalhe -> 'disputa' -> 'acao', 'tipo', ch.detalhe -> 'disputa' -> 'tipo',
               'itens', ch.detalhe -> 'disputa' -> 'itens') end as disputa,
             null::jsonb as encerramento, null::jsonb as resposta, null::numeric as "valor99",
             ch.detalhe -> 'classificacao' as classificacao,
             (select coalesce(jsonb_agg(i ->> 'descricao') filter (where coalesce(i ->> 'descricao', '') <> ''), '[]'::jsonb)
                from pedido_externo pe, jsonb_array_elements(case when jsonb_typeof(pe.itens) = 'array' then pe.itens else '[]'::jsonb end) i
               where pe.id = ch.pedido_id and pe.tenant_id = ch.tenant_id) as "itensDoPedido"
        from atendimento_chamado ch
       where ch.tenant_id = ${tenantId} and ch.id = ${id}`);
    const l = (r.rows ?? r)[0];
    if (!l) throw new NotFoundException('Caso não encontrado.');
    const marcado = oQueAconteceuNoCaso(l as LinhaDoCaso);
    const vistos = new Set<string>();
    const produtos: string[] = [];
    const juntar = (nome: unknown) => {
      const n = typeof nome === 'string' ? nome.replace(/\s+/g, ' ').trim() : '';
      const k = n.toLowerCase();
      if (n && !vistos.has(k) && produtos.length < 30) {
        vistos.add(k);
        produtos.push(n.slice(0, 120));
      }
    };
    for (const n of Array.isArray(l.itensDoPedido) ? l.itensDoPedido : []) juntar(n);
    for (const p of marcado.produtos) juntar(p.nome);
    return {
      motivo: marcado.motivo,
      fonte: marcado.fonte,
      produtosMarcados: marcado.produtos.map((p) => p.nome),
      produtos,
      motivos: MOTIVOS.map((m) => ({ k: m.k, nome: m.nome, doProduto: m.doProduto })),
      maxProdutos: MAX_PRODUTOS,
    };
  }

  /**
   * Grava o que a equipe marcou (ou limpa, com o motivo vazio). Só a chave `classificacao` do `detalhe`, mesclada no banco
   * (V82: a plataforma grava `encerramento` e `resposta` no mesmo campo). Quem marcou e quando vão junto.
   */
  async salvar(user: AuthUser, id: string, dto: any) {
    if (!UUID_RE.test(String(id ?? ''))) throw new NotFoundException('Caso não encontrado.');
    const lido = lerOQueAconteceu(dto ?? {});
    if (!lido.ok) throw new BadRequestException(lido.erro);
    const r: any = await this.db.execute(
      lido.valor
        ? sql`update atendimento_chamado
                 set detalhe = coalesce(detalhe, '{}'::jsonb) || jsonb_build_object('classificacao', ${JSON.stringify(classificacaoGravada(lido.valor, user))}::jsonb)
               where tenant_id = ${user.tenantId} and id = ${id} returning id`
        : sql`update atendimento_chamado set detalhe = detalhe - 'classificacao'
               where tenant_id = ${user.tenantId} and id = ${id} returning id`,
    );
    if (!(r.rows ?? r)[0]) throw new NotFoundException('Caso não encontrado.');
    return { ok: true, motivo: lido.valor?.motivo ?? null, produtos: lido.valor?.produtos ?? [] };
  }

  // ───────────────────────── servidor da loja → nuvem ─────────────────────────

  private consulta(periodo: Periodo, unidade: string | null) {
    const q = new URLSearchParams({ periodo });
    if (unidade && UUID_RE.test(unidade)) q.set('unidade', unidade);
    return q;
  }

  private async pelaNuvem(caminho: string): Promise<any> {
    const nuvem = String(process.env.CLOUD_API ?? '').replace(/\/$/, '');
    const token = process.env.SYNC_TOKEN ?? '';
    if (!nuvem || !token) throw new BadGatewayException('Este servidor não está ligado à nuvem: os números do atendimento vêm de lá.');
    let res: Response;
    try {
      res = await fetch(`${nuvem}/atendimento/${caminho}`, { headers: { 'x-sync-token': token }, signal: AbortSignal.timeout(20_000) });
    } catch (e: any) {
      this.logger.warn(`números do atendimento (${caminho.split('?')[0]}): a nuvem não respondeu (${e?.cause?.code ?? e?.message ?? e})`);
      throw new BadGatewayException('A nuvem não respondeu agora. Tente de novo em instantes.');
    }
    const j: any = await res.json().catch(() => null);
    if (!res.ok) {
      const msg = typeof j?.message === 'string' ? j.message : `a nuvem recusou (HTTP ${res.status})`;
      if (res.status === 400) throw new BadRequestException(msg);
      if (res.status === 403) throw new ForbiddenException(msg);
      this.logger.warn(`números do atendimento (${caminho.split('?')[0]}): ${msg}`);
      throw new BadGatewayException(msg);
    }
    return j;
  }
}
