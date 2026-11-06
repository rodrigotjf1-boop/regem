import { sql } from 'drizzle-orm';

/* eslint-disable @typescript-eslint/no-explicit-any */

// AS AVALIAÇÕES DO iFOOD NA CENTRAL DE ATENDIMENTO (checkpoint da Central, item 4 — 06/11/2026; protótipo
// `mockups/regem-central-atendimento.html`, caso "Avaliação"). Fonte: iFood · Review API v2.0 (`/review/v2.0/merchants/
// {merchantId}/reviews`, o detalhe e `…/reviews/{id}/answers`). O portal oficial não abre para leitura automática (403):
// a forma veio de uma integração aberta homologada no módulo em 10/2026 — a lista (até 50 por página, datas ISO, `status`,
// `replies[]` com `from` MERCHANT/CUSTOMER, `questions`), a resposta `{ text }` de 10 a 300 caracteres, UMA por avaliação,
// e a avaliação PUBLICADA não aceita mais resposta (409/422). A leitura é tolerante (nomes alternativos) e a CONFERÊNCIA
// com a doc oficial fica para quando o módulo for liberado no app da distribuição.

export type Avaliacao = {
  id: string;
  nota: number | null;
  comentario: string | null;
  pedidoExterno: string | null;
  pedidoNumero: string | null;
  cliente: string | null;
  criadaEm: string | null;
  /** CREATED | NOT_REPLIED | REPLIED | PUBLISHED | DISCARDED | INVALID… (o que o iFood mandar). */
  status: string;
  /** A loja já respondeu (por aqui ou pelo Portal do Parceiro). */
  respondida: boolean;
  perguntas: Array<{ pergunta: string; resposta: string }>;
};

const lista = (v: unknown): any[] => (Array.isArray(v) ? v : []);
const texto = (v: unknown, max = 2000): string | null => {
  if (v == null) return null;
  const s = String(v).trim();
  return s ? s.slice(0, max) : null;
};

/** Os textos de uma resposta ou opção, de onde o iFood os põe. */
const rotulo = (x: any): string => (typeof x === 'string' ? x : String(x?.title ?? x?.text ?? x?.name ?? x?.value ?? '')).trim();

/** A avaliação como a central usa. Sem id: nada. */
export function lerAvaliacao(r: any): Avaliacao | null {
  const id = texto(r?.id ?? r?.reviewId, 120);
  if (!id) return null;
  const notaBruta = Number(r?.score ?? r?.rating ?? r?.grade);
  const respostas = lista(r?.replies);
  const status = String(r?.status ?? '').toUpperCase();
  return {
    id,
    nota: Number.isFinite(notaBruta) && notaBruta > 0 ? Math.round(notaBruta * 10) / 10 : null,
    comentario: texto(r?.comment ?? r?.text),
    pedidoExterno: texto(r?.order?.id ?? r?.orderId, 120),
    pedidoNumero: texto(r?.order?.shortId ?? r?.order?.displayId ?? r?.orderShortId, 40),
    cliente: texto(r?.customerName ?? r?.customer?.name, 120),
    criadaEm: texto(r?.createdAt ?? r?.created_at, 40),
    status,
    respondida:
      ['REPLIED', 'PUBLISHED'].includes(status) ||
      !!texto(r?.reply?.text ?? (typeof r?.reply === 'string' ? r.reply : null)) ||
      respostas.some((x) => String(x?.from ?? '').toUpperCase() === 'MERCHANT'),
    perguntas: lista(r?.questions)
      .map((q) => ({
        pergunta: rotulo(q?.title ?? q?.question ?? q),
        resposta: lista(q?.answers)
          .map(rotulo)
          .filter(Boolean)
          .join(', '),
      }))
      .filter((q) => q.pergunta && q.resposta),
  };
}

/** As situações em que o iFood ainda aceita a resposta da loja. */
const ABERTAS = new Set(['', 'CREATED', 'NOT_REPLIED']);

/**
 * Vira CASO na fila: ainda sem resposta da loja, numa situação que aceita resposta, e que pede uma pessoa — tem comentário
 * ou nota até 3. As boas sem comentário (a maioria) não entram: lotariam a fila sem nada a dizer.
 */
export function viraCaso(a: Avaliacao): boolean {
  if (a.respondida || !ABERTAS.has(a.status)) return false;
  return !!a.comentario || (a.nota != null && a.nota <= 3);
}

/** Nota até 2: urgente (o cliente está insatisfeito — quanto antes a resposta, melhor). */
export const prioridadeDaAvaliacao = (a: Avaliacao): 'urgente' | 'normal' => (a.nota != null && a.nota <= 2 ? 'urgente' : 'normal');

/** A chave do caso (o índice único é por empresa, canal e `externo_id` — o da disputa é outro id do iFood). */
export const chaveDaAvaliacao = (id: string) => `avaliacao:${id}`;

/** O que a fila mostra quando não há comentário. */
export function mensagemDaAvaliacao(a: Avaliacao): string {
  return a.comentario ?? (a.nota != null ? `Nota ${String(a.nota).replace('.', ',')} sem comentário` : 'Avaliação sem comentário');
}

/** O ajuste "Avaliações do iFood na fila" (`integracao.config.atendimentoIfood.avaliacoes`): nasce DESLIGADO. */
export function avaliacoesLigadas(config: any): boolean {
  return config?.atendimentoIfood?.avaliacoes === true;
}

/** Os limites do iFood para o texto da resposta (o iFood confere de novo — a tela avisa antes). */
export const RESPOSTA_MIN = 10;
export const RESPOSTA_MAX = 300;
export const LINK_POLITICA_DE_AVALIACOES = 'https://comunidade.ifood.com.br/t/conheca-nossa-politica-de-avaliacoes-de-pedidos/87541';

type Emitir = (evento: string, dados: any) => unknown;

/**
 * Abre o CASO da avaliação (canal ifood, tipo 'avaliacao'). Idempotente: a mesma avaliação lida de novo não abre outro
 * (índice único por empresa, canal e `externo_id`). Liga ao pedido do Regem quando ele existe (o número, o nome e a loja
 * vêm dele). Devolve se abriu agora.
 */
export async function registrarAvaliacao(
  db: any,
  emitir: Emitir,
  ig: { tenantId: string; unidadeId: string | null },
  a: Avaliacao,
): Promise<{ aberto: boolean; id: string | null }> {
  if (!viraCaso(a)) return { aberto: false, id: null };
  const p: any = a.pedidoExterno
    ? ((
        await db.execute(sql`
          select id, unidade_id, numero, display_id, cliente_nome from pedido_externo
           where tenant_id = ${ig.tenantId} and canal = 'ifood' and external_id = ${a.pedidoExterno}
           limit 1`)
      ).rows ?? [])[0]
    : null;
  const numero = p?.display_id ?? (p?.numero != null ? String(p.numero) : null) ?? a.pedidoNumero;
  const r: any = await db.execute(sql`
    insert into atendimento_chamado (tenant_id, unidade_id, tipo, canal, cliente, pedido_id, pedido_numero, mensagem,
                                     prioridade, externo_id, detalhe)
    values (${ig.tenantId}, ${p?.unidade_id ?? ig.unidadeId ?? null}, 'avaliacao', 'ifood', ${p?.cliente_nome ?? a.cliente},
            ${p?.id ?? null}, ${numero}, ${mensagemDaAvaliacao(a)}, ${prioridadeDaAvaliacao(a)}, ${chaveDaAvaliacao(a.id)},
            ${JSON.stringify({ plataforma: 'ifood', avaliacao: a })}::jsonb)
    on conflict (tenant_id, canal, externo_id) where externo_id is not null do nothing
    returning *`);
  const row = (r.rows ?? r)[0];
  if (row) emitir('atendimento.novo', { tenantId: ig.tenantId, chamado: row });
  return { aberto: !!row, id: row?.id ?? null };
}

/**
 * A avaliação mudou no iFood (a loja respondeu pelo Portal do Parceiro, ela foi publicada ou descartada): o caso ainda
 * aberto se resolve com o que aconteceu. Caso já resolvido (respondido por aqui) fica como está. Devolve se resolveu.
 */
export async function atualizarAvaliacao(db: any, emitir: Emitir, tenantId: string, a: Avaliacao): Promise<boolean> {
  if (!a.respondida && ABERTAS.has(a.status)) return false;
  const decisao = a.respondida ? 'respondida_no_ifood' : a.status === 'DISCARDED' ? 'descartada_pelo_ifood' : 'encerrada_no_ifood';
  const r: any = await db.execute(sql`
    update atendimento_chamado
       set detalhe = coalesce(detalhe, '{}'::jsonb) || jsonb_build_object('avaliacao', ${JSON.stringify(a)}::jsonb),
           status = 'resolvido', decisao = ${decisao}, resolvido_em = now(), aguardando_desde = null
     where tenant_id = ${tenantId} and canal = 'ifood' and externo_id = ${chaveDaAvaliacao(a.id)} and status <> 'resolvido'
     returning id`);
  const row = (r.rows ?? r)[0];
  if (row) emitir('atendimento.mudou', { tenantId, id: row.id, motivo: 'ifood_avaliacao' });
  return !!row;
}
