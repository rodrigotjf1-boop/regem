import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { sql } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { ehServidorLocal } from '../../common/modo';
import { hojeISO, somarDias } from '../../common/data';
import { instanteDe } from '../../common/fuso-sql';
import { abrirChamadoPeloRobo, type Emitir } from '../atendimento/abrir-chamado';
import {
  NotaConferida,
  OPCOES_DO_PESO,
  abreCaso,
  ajustesDaNotaDaLinha,
  conferirNota,
  ehPedidoDoRegem,
  googleDaNota,
  itensEmUmaLinha,
  mensagemDoCaso,
  prazoAte,
  sqlPedidoDoRegem,
} from './nota-do-pedido';

/* eslint-disable @typescript-eslint/no-explicit-any */

const rows = (r: any): any[] => r?.rows ?? r ?? [];

/** O que a página do pedido mostra: nada (desligado, pedido de fora, ainda não entregue), o formulário, a nota já dada
 *  ou "encerrou". */
export type SituacaoDaNota = 'desligado' | 'fora' | 'nao_entregue' | 'aberta' | 'avaliado' | 'encerrada';

export type EstadoDaNota = {
  situacao: SituacaoDaNota;
  /** O nome da loja ("A nota vai para a Mister Burger"). */
  loja: string | null;
  prazoDias: number;
  /** Até quando dá para avaliar (a entrega mais o prazo), ou null antes da entrega. */
  ate: string | null;
  opcoes: readonly string[];
  /** A nota já dada (por qualquer caminho). */
  feita: { nota: number; origem: string; em: string } | null;
  /** O link do Google: só com a nota 5 dada e o link colado no cartão "Pedir avaliação no Google". */
  google: string | null;
};

const logger = new Logger('NotaDoPedido');

/**
 * O pedido com o que decide a nota (os ajustes da loja, o link do Google, a nota já dada): pelo token do rastreio (a
 * página do pedido) ou pelo id na empresa (o formulário do WhatsApp — fase A2). null = não achou.
 */
export async function lerPedidoParaNota(db: any, onde: { token: string } | { tenantId: string; pedidoId: string }): Promise<any | null> {
  const filtro =
    'token' in onde ? sql`p.rastreio_token = ${onde.token}` : sql`p.id = ${onde.pedidoId}::uuid and p.tenant_id = ${onde.tenantId}::uuid`;
  const r: any = await db.execute(sql`
    select p.id, p.tenant_id, p.unidade_id, p.canal, p.status, p.numero, p.display_id, p.cliente_nome, p.cliente_telefone,
           coalesce(p.entregue_em, p.concluido_em) as entregue_em,
           e.nome as loja,
           rc.nota_ativa, rc.nota_caso_ate, rc.nota_prazo_dias, rc.avaliacao_link,
           a.nota as feita_nota, a.origem as feita_origem, a.criado_em as feita_em
      from pedido_externo p
      join empresa e on e.id = p.tenant_id
      left join robo_config rc on rc.tenant_id = p.tenant_id
      left join pedido_avaliacao a on a.pedido_id = p.id
     where ${filtro}
     order by p.criado_em desc
     limit 1`);
  return rows(r)[0] ?? null;
}

/** A situação do pedido para a nota (a regra que a página, o formulário do WhatsApp e a gravação seguem). */
export function situacaoDaNota(l: any, agora: Date = new Date()): SituacaoDaNota {
  const ajustes = ajustesDaNotaDaLinha(l);
  if (!ajustes.ativa) return 'desligado';
  if (!ehPedidoDoRegem(l.canal)) return 'fora';
  if (l.feita_nota != null) return 'avaliado';
  if (!['entregue', 'concluido'].includes(String(l.status)) || !l.entregue_em) return 'nao_entregue';
  if (agora.getTime() > prazoAte(new Date(l.entregue_em), ajustes.prazoDias).getTime()) return 'encerrada';
  return 'aberta';
}

export type NotaGravada = {
  avaliacaoId: string;
  criadoEm: Date;
  /** O caso que a nota baixa abriu (ou somou); `paraOCliente` = a frase da loja quando a equipe está fora do horário. */
  caso: { id: string; paraOCliente: string | null } | null;
};

/**
 * Grava a nota — UMA por pedido (`on conflict do nothing` no índice único: duas abas, dois toques ou a página e o
 * WhatsApp ao mesmo tempo não gravam duas). A nota baixa abre (ou soma a) o caso "Avaliação"; se o caso falhar, a nota
 * fica gravada e o motivo vai para o log (V11). null = já havia nota. Quem chama confere a situação antes.
 */
export async function gravarNota(db: any, emitir: Emitir, l: any, n: NotaConferida, origem: 'pagina' | 'whatsapp'): Promise<NotaGravada | null> {
  // O array pelo `sql.join` (V31): um array solto no `sql` do Drizzle vira a lista "(a, b)", não um `text[]`.
  const pesou = n.pesou.length ? sql`array[${sql.join(n.pesou.map((p) => sql`${p}`), sql`, `)}]::text[]` : sql`'{}'::text[]`;
  const r: any = await db.execute(sql`
    insert into pedido_avaliacao (tenant_id, unidade_id, pedido_id, nota, pesou, comentario, origem)
    values (${l.tenant_id}::uuid, ${l.unidade_id ?? null}, ${l.id}::uuid, ${n.nota}, ${pesou}, ${n.comentario}, ${origem})
    on conflict (pedido_id) do nothing
    returning id, criado_em`);
  const nova = rows(r)[0];
  if (!nova) return null;
  const avaliacaoId = String(nova.id);
  const caso = abreCaso(n.nota, ajustesDaNotaDaLinha(l).casoAte) ? await abrirCasoDaNota(db, emitir, l, n, origem, avaliacaoId) : null;
  return { avaliacaoId, criadoEm: new Date(nova.criado_em), caso };
}

/** O caso "Avaliação" no Atendimento (ou a soma ao caso aberto do mesmo telefone), ligado à nota. Nunca lança. */
async function abrirCasoDaNota(
  db: any,
  emitir: Emitir,
  l: any,
  n: NotaConferida,
  origem: 'pagina' | 'whatsapp',
  avaliacaoId: string,
): Promise<{ id: string; paraOCliente: string | null } | null> {
  const numero = l.display_id ?? (l.numero != null ? String(l.numero) : null);
  try {
    const caso: any = await abrirChamadoPeloRobo(db, emitir, String(l.tenant_id), l.unidade_id ?? null, {
      tipo: 'avaliacao',
      canal: 'cardapio',
      cliente: l.cliente_nome ?? undefined,
      telefone: l.cliente_telefone ?? undefined,
      pedidoId: String(l.id),
      pedidoNumero: numero ?? undefined,
      mensagem: mensagemDoCaso(n, { origem, pedidoNumero: numero }),
    });
    if (!caso?.id) return null;
    await db.execute(sql`update pedido_avaliacao set chamado_id = ${caso.id}::uuid where id = ${avaliacaoId}::uuid`);
    return { id: String(caso.id), paraOCliente: caso.foraDoHorario && caso.paraOCliente ? String(caso.paraOCliente) : null };
  } catch (e: any) {
    logger.warn(`nota ${n.nota} do pedido ${l.id}: o caso no Atendimento não abriu — ${e?.message ?? e}`);
    return null;
  }
}

export const PERIODOS_DA_LISTA = ['hoje', '7', '30'] as const;
export type PeriodoDaLista = (typeof PERIODOS_DA_LISTA)[number];
/** Quantas avaliações a lista traz no máximo (os números de cima contam o período inteiro). */
export const LIMITE_DA_LISTA = 1000;

/**
 * A NOTA DO PEDIDO (mig 453, fase A1). Nos DOIS lados:
 *  • a página do pedido (`/r/…`, sem login): o estado e a gravação da nota pelo token do rastreio — só na NUVEM, onde a
 *    página roda;
 *  • Delivery › Avaliações: a lista do período com os números; no servidor da loja, pede à nuvem (a tabela é de lá — V37).
 * A nota baixa (até a nota que a loja escolheu) abre o caso "Avaliação" no Atendimento — ou soma ao caso aberto do mesmo
 * telefone nas últimas 12 h (a regra do robô, `abrirChamadoPeloRobo`).
 */
@Injectable()
export class NotaDoPedidoService {
  private readonly logger = logger;

  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly events: EventEmitter2,
  ) {}

  // ───────────────────────── a página do pedido ─────────────────────────

  /** O pedido pelo token do rastreio, com os ajustes da loja, o link do Google e a nota já dada. */
  private async pedidoDoToken(token: unknown): Promise<any> {
    const tk = String(token ?? '').replace(/[^a-z0-9]/gi, '');
    if (!tk) throw new NotFoundException('Pedido não encontrado.');
    const l = await lerPedidoParaNota(this.db, { token: tk });
    if (!l) throw new NotFoundException('Pedido não encontrado.');
    return l;
  }

  /** A situação do pedido para a nota (a regra que a página e a gravação seguem). */
  static situacao(l: any, agora: Date = new Date()): SituacaoDaNota {
    return situacaoDaNota(l, agora);
  }

  private static estado(l: any, situacao: SituacaoDaNota): EstadoDaNota {
    const ajustes = ajustesDaNotaDaLinha(l);
    // Desligado ou pedido de fora: a página não mostra nada — nem o nome da loja sai.
    if (situacao === 'desligado' || situacao === 'fora')
      return { situacao, loja: null, prazoDias: ajustes.prazoDias, ate: null, opcoes: OPCOES_DO_PESO, feita: null, google: null };
    const feita = l.feita_nota != null ? { nota: Number(l.feita_nota), origem: String(l.feita_origem), em: new Date(l.feita_em).toISOString() } : null;
    return {
      situacao,
      loja: l.loja ?? null,
      prazoDias: ajustes.prazoDias,
      ate: l.entregue_em ? prazoAte(new Date(l.entregue_em), ajustes.prazoDias).toISOString() : null,
      opcoes: OPCOES_DO_PESO,
      feita,
      google: googleDaNota(feita?.nota, l.avaliacao_link),
    };
  }

  /** `GET /rastreio/:token/avaliacao` — o que a página mostra abaixo do "Pedido entregue". */
  async estadoPublico(token: unknown): Promise<EstadoDaNota> {
    const l = await this.pedidoDoToken(token);
    return NotaDoPedidoService.estado(l, NotaDoPedidoService.situacao(l));
  }

  /**
   * `POST /rastreio/:token/avaliacao` — grava a nota dada pela página. Uma por pedido (`on conflict do nothing` no índice
   * único: duas abas ou dois toques não gravam duas). A nota baixa abre (ou soma a) o caso "Avaliação"; se o caso falhar,
   * a nota fica gravada e o motivo vai para o log (V11). Devolve o estado novo e se o caso abriu.
   */
  async avaliarPelaPagina(token: unknown, dto: any): Promise<EstadoDaNota & { caso: boolean }> {
    const n = conferirNota(dto);
    const l = await this.pedidoDoToken(token);
    const situacao = NotaDoPedidoService.situacao(l);
    if (situacao === 'desligado' || situacao === 'fora') throw new ForbiddenException('Este pedido não recebe avaliação por aqui.');
    if (situacao === 'nao_entregue') throw new BadRequestException('Dá para avaliar depois que o pedido for entregue.');
    if (situacao === 'encerrada') throw new BadRequestException('A avaliação deste pedido encerrou.');
    if (situacao === 'avaliado') throw new ConflictException('Você já avaliou este pedido.');
    const g = await gravarNota(this.db, (ev, p) => this.events.emit(ev, p), l, n, 'pagina');
    if (!g) throw new ConflictException('Você já avaliou este pedido.');
    const depois = { ...l, feita_nota: n.nota, feita_origem: 'pagina', feita_em: g.criadoEm };
    return { ...NotaDoPedidoService.estado(depois, 'avaliado'), caso: !!g.caso };
  }

  // ───────────────────────── Delivery › Avaliações ─────────────────────────

  /** `GET /delivery/avaliacoes` — no servidor da loja, pede à nuvem (a tabela é de lá). */
  async lista(tenantId: string, unidadeId: string | null, periodo: unknown) {
    const p = NotaDoPedidoService.periodo(periodo);
    if (ehServidorLocal()) {
      const q = new URLSearchParams({ periodo: p });
      if (unidadeId) q.set('unidade', unidadeId);
      return this.pelaNuvem(`avaliacoes-da-loja?${q.toString()}`);
    }
    return this.listaNaNuvem(tenantId, unidadeId, p);
  }

  static periodo(v: unknown): PeriodoDaLista {
    return (PERIODOS_DA_LISTA as readonly string[]).includes(String(v)) ? (String(v) as PeriodoDaLista) : '7';
  }

  /**
   * A lista do período (o fuso da operação — V46/V48): hoje, 7 ou 30 dias contando hoje. Os números de cima (média, quantos
   * avaliaram, as notas, os entregues do Regem) contam o período INTEIRO no banco; a lista traz até 1.000, a mais nova
   * primeiro, e diz se há mais. A loja: a da linha ou sem loja (V4); `unidadeId` vazio = todas (o presidente).
   */
  async listaNaNuvem(tenantId: string, unidadeId: string | null, periodo: unknown) {
    const p = NotaDoPedidoService.periodo(periodo);
    const hoje = hojeISO();
    const inicio = instanteDe(p === 'hoje' ? hoje : somarDias(hoje, -(Number(p) - 1)));
    const daLoja = (col: string) => (unidadeId ? sql`and (${sql.raw(col)} = ${unidadeId}::uuid or ${sql.raw(col)} is null)` : sql``);

    const ajustes = ajustesDaNotaDaLinha(rows(await this.db.execute(sql`select nota_ativa, nota_caso_ate, nota_prazo_dias from robo_config where tenant_id = ${tenantId}::uuid`))[0]);
    const k = rows(
      await this.db.execute(sql`
        select count(*)::int as avaliacoes, avg(a.nota)::float as media,
               count(*) filter (where a.nota = 1)::int as n1, count(*) filter (where a.nota = 2)::int as n2,
               count(*) filter (where a.nota = 3)::int as n3, count(*) filter (where a.nota = 4)::int as n4,
               count(*) filter (where a.nota = 5)::int as n5
          from pedido_avaliacao a
         where a.tenant_id = ${tenantId}::uuid and a.criado_em >= ${inicio} ${daLoja('a.unidade_id')}`),
    )[0];
    // Os pedidos de ENTREGA do Regem entregues no período (a página do pedido é do link do rastreio da entrega).
    const e = rows(
      await this.db.execute(sql`
        select count(*)::int as entregues
          from pedido_externo p
         where p.tenant_id = ${tenantId}::uuid and p.status in ('entregue', 'concluido') and p.tipo = 'entrega'
           and coalesce(p.entregue_em, p.concluido_em) >= ${inicio} and ${sqlPedidoDoRegem('p.canal')}
           ${daLoja('p.unidade_id')}`),
    )[0];
    const r = rows(
      await this.db.execute(sql`
        select a.id, a.nota, a.pesou, a.comentario, a.origem, a.criado_em, a.chamado_id,
               p.id as pedido_id, p.numero, p.display_id, p.cliente_nome, p.itens, p.total, p.canal,
               extract(epoch from coalesce(p.entregue_em, p.concluido_em) - p.criado_em) / 60 as minutos,
               c.status as caso_status
          from pedido_avaliacao a
          join pedido_externo p on p.id = a.pedido_id and p.tenant_id = a.tenant_id
          left join atendimento_chamado c on c.id = a.chamado_id and c.tenant_id = a.tenant_id
         where a.tenant_id = ${tenantId}::uuid and a.criado_em >= ${inicio} ${daLoja('a.unidade_id')}
         order by a.criado_em desc, a.id
         limit ${LIMITE_DA_LISTA + 1}`),
    );
    const mais = r.length > LIMITE_DA_LISTA;
    return {
      periodo: p,
      ajustes,
      kpis: {
        avaliacoes: Number(k?.avaliacoes ?? 0),
        media: k?.media == null ? null : Math.round(Number(k.media) * 10) / 10,
        entregues: Number(e?.entregues ?? 0),
        notas: { 1: Number(k?.n1 ?? 0), 2: Number(k?.n2 ?? 0), 3: Number(k?.n3 ?? 0), 4: Number(k?.n4 ?? 0), 5: Number(k?.n5 ?? 0) },
      },
      lista: r.slice(0, LIMITE_DA_LISTA).map((x) => ({
        id: String(x.id),
        nota: Number(x.nota),
        pesou: Array.isArray(x.pesou) ? x.pesou.map(String) : [],
        comentario: x.comentario ?? null,
        origem: String(x.origem),
        em: new Date(x.criado_em).toISOString(),
        pedido: {
          id: String(x.pedido_id),
          numero: x.display_id ?? (x.numero != null ? String(x.numero) : null),
          cliente: x.cliente_nome ?? null,
          itens: itensEmUmaLinha(x.itens),
          total: Number(x.total ?? 0),
          minutos: x.minutos == null ? null : Math.max(0, Math.round(Number(x.minutos))),
        },
        caso: x.chamado_id ? { id: String(x.chamado_id), status: x.caso_status ?? null } : null,
      })),
      mais,
    };
  }

  /** No servidor da loja: a lista vem da nuvem pelo token do servidor (quem pediu e a loja foram conferidos aqui). */
  private async pelaNuvem(caminho: string): Promise<any> {
    const nuvem = String(process.env.CLOUD_API ?? '').replace(/\/$/, '');
    const token = process.env.SYNC_TOKEN ?? '';
    if (!nuvem || !token) throw new BadGatewayException('Este servidor não está ligado à nuvem: as avaliações vêm de lá.');
    let res: Response;
    try {
      res = await fetch(`${nuvem}/delivery/${caminho}`, { headers: { 'x-sync-token': token }, signal: AbortSignal.timeout(20_000) });
    } catch (e: any) {
      this.logger.warn(`avaliações: a nuvem não respondeu (${e?.cause?.code ?? e?.message ?? e})`);
      throw new BadGatewayException('A nuvem não respondeu agora. Tente de novo em instantes.');
    }
    const j: any = await res.json().catch(() => null);
    if (!res.ok) {
      const msg = typeof j?.message === 'string' ? j.message : `a nuvem recusou (HTTP ${res.status})`;
      if (res.status === 400) throw new BadRequestException(msg);
      if (res.status === 403) throw new ForbiddenException(msg);
      this.logger.warn(`avaliações: ${msg}`);
      throw new BadGatewayException(msg);
    }
    return j;
  }
}
