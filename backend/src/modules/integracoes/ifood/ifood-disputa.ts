import { sql } from 'drizzle-orm';

/* eslint-disable @typescript-eslint/no-explicit-any */

// DISPUTAS DO iFOOD NA CENTRAL DE ATENDIMENTO (Onda 1, PR 2 — decisão do dono de 01/11/2026: "vamos usar a disputa do
// iFood, antes descartada"). Fonte: iFood · Plataforma de negociação (developer.ifood.com.br › order › handshake-platform,
// conferida em 02/11/2026). O evento HSD (HANDSHAKE_DISPUTE) traz a negociação: o que o cliente quer (cancelamento total,
// parcial, reembolso ou mais tempo), a fala dele, as fotos, os itens, o PRAZO (`expiresAt`), o que o iFood faz sozinho sem
// resposta (`timeoutAction`) e as propostas que a loja pode fazer. O HSS (HANDSHAKE_SETTLEMENT) diz como terminou. A loja
// responde UMA vez por disputa. Antes de hoje o leitor de eventos confirmava e jogava fora os dois (ifood.poller.ts).

export type AlternativaDaDisputa = {
  id: string;
  tipo: 'REFUND' | 'BENEFIT' | 'ADDITIONAL_TIME' | string;
  /** Valor máximo em CENTAVOS (o iFood manda "value" sem decimais: R$ 1,00 = "100"). */
  maxCentavos: number | null;
  minutos: number[];
  motivos: string[];
};

export type DisputaIfood = {
  id: string;
  pedidoExterno: string | null;
  acao: string; // CANCELLATION | PARTIAL_CANCELLATION | PROPOSED_AMOUNT_REFUND | PROPOSED_ADDITIONAL_TIME | VOID
  tipo: string; // AFTER_DELIVERY | DELAY | PREPARATION_TIME | AFTER_DELIVERY_PARTIALLY
  mensagem: string | null;
  expiraEm: string | null;
  acaoAutomatica: string | null; // ACCEPT_CANCELLATION | REJECT_CANCELLATION | VOID
  alternativas: AlternativaDaDisputa[];
  motivosParaAceitar: string[];
  fotos: Array<{ url: string; tipo: string | null }>;
  itens: Array<{ nome: string | null; codigo: string | null; quantidade: number; centavos: number | null; motivo: string | null }>;
  criadaEm: string | null;
};

const lista = (v: unknown): any[] => (Array.isArray(v) ? v : []);
const texto = (v: unknown): string | null => (v == null || v === '' ? null : String(v));
const centavos = (amount: any): number | null => {
  const n = Number(amount?.value);
  return Number.isFinite(n) ? Math.round(n) : null;
};

/** O evento HSD como a central usa. Lê os campos onde a documentação os põe (e o `metadata` aninhado, por segurança). */
export function lerDisputa(ev: any): DisputaIfood | null {
  const m = ev?.metadata ?? {};
  const id = texto(m.id ?? m.disputeId);
  if (!id) return null;
  const dentro = m.metadata ?? {};
  return {
    id,
    pedidoExterno: texto(ev?.orderId ?? m.orderId),
    acao: String(m.action ?? ''),
    tipo: String(m.handshakeType ?? ''),
    mensagem: texto(m.message),
    expiraEm: texto(m.expiresAt),
    acaoAutomatica: texto(m.timeoutAction),
    alternativas: lista(m.alternatives).map((a) => ({
      id: String(a?.id ?? ''),
      tipo: String(a?.type ?? ''),
      maxCentavos: centavos(a?.metadata?.maxAmount),
      minutos: lista(a?.metadata?.allowedsAdditionalTimeInMinutes).map(Number).filter((n) => Number.isFinite(n) && n > 0),
      motivos: lista(a?.metadata?.allowedsAdditionalTimeReasons).map(String),
    })),
    motivosParaAceitar: lista(m.acceptCancellationReasons ?? dentro.acceptCancellationReasons).map(String),
    fotos: lista(m.evidences ?? dentro.evidences)
      .filter((f) => typeof f?.url === 'string')
      .map((f) => ({ url: String(f.url), tipo: texto(f.contentType) })),
    itens: [...lista(m.item ?? dentro.item), ...lista(m.garnishItems ?? dentro.garnishItems)].map((i) => ({
      nome: texto(i?.name ?? i?.description),
      codigo: texto(i?.externalCode),
      quantidade: Number(i?.quantity) || 1,
      centavos: centavos(i?.amount),
      motivo: texto(i?.reason),
    })),
    criadaEm: texto(m.createdAt ?? ev?.createdAt),
  };
}

/** O resultado do HSS: ACCEPTED | REJECTED | EXPIRED | ALTERNATIVE_REPLIED → a decisão gravada no caso. */
export const DECISAO_DO_ENCERRAMENTO: Record<string, string> = {
  ACCEPTED: 'aceito',
  REJECTED: 'recusado',
  EXPIRED: 'expirou',
  ALTERNATIVE_REPLIED: 'proposta_aceita',
};

type Emitir = (evento: string, dados: any) => unknown;

/**
 * Abre o CASO da disputa (canal ifood, tipo 'disputa', com o prazo do iFood). Idempotente: o mesmo evento repetido (o iFood
 * reenvia até a confirmação de leitura) não abre outro — índice único por empresa, canal e id da disputa (mig 351). Liga ao
 * pedido do Regem quando ele existe (o número, o nome do cliente e a loja vêm dele). Devolve se abriu agora.
 */
export async function registrarDisputa(
  db: any,
  emitir: Emitir,
  ig: { tenantId: string; unidadeId: string | null },
  ev: any,
): Promise<{ aberto: boolean; id: string | null }> {
  const d = lerDisputa(ev);
  if (!d) return { aberto: false, id: null };
  const p: any = d.pedidoExterno
    ? ((
        await db.execute(sql`
          select id, unidade_id, numero, display_id, cliente_nome from pedido_externo
           where tenant_id = ${ig.tenantId} and canal = 'ifood' and external_id = ${d.pedidoExterno}
           limit 1`)
      ).rows ?? [])[0]
    : null;
  const r: any = await db.execute(sql`
    insert into atendimento_chamado (tenant_id, unidade_id, tipo, canal, cliente, pedido_id, pedido_numero, mensagem,
                                     prioridade, prazo_em, externo_id, detalhe)
    values (${ig.tenantId}, ${p?.unidade_id ?? ig.unidadeId ?? null}, 'disputa', 'ifood', ${p?.cliente_nome ?? null},
            ${p?.id ?? null}, ${p?.numero != null ? String(p.numero) : null}, ${d.mensagem},
            'normal', ${d.expiraEm}, ${d.id}, ${JSON.stringify({ plataforma: 'ifood', disputa: d })}::jsonb)
    on conflict (tenant_id, canal, externo_id) where externo_id is not null do nothing
    returning *`);
  const row = (r.rows ?? r)[0];
  if (row) emitir('atendimento.novo', { tenantId: ig.tenantId, chamado: row });
  return { aberto: !!row, id: row?.id ?? null };
}

/**
 * O iFood ENCERROU a disputa (HSS): grava como terminou e resolve o caso que ainda estava aberto (o prazo venceu, ou a
 * loja respondeu pelo app do iFood). Caso já resolvido (a loja respondeu pela central) só ganha o resultado. Disputa que a
 * central nunca viu: nada a fazer.
 */
export async function registrarEncerramento(db: any, emitir: Emitir, tenantId: string, ev: any): Promise<boolean> {
  const m = ev?.metadata ?? {};
  const disputa = texto(m.disputeId);
  if (!disputa) return false;
  const status = String(m.status ?? '');
  const encerramento = {
    status,
    motivo: texto(m.reason),
    proposta: m.selectedDisputeAlternative
      ? {
          tipo: String(m.selectedDisputeAlternative.type ?? ''),
          centavos: centavos(m.selectedDisputeAlternative.metadata?.amount),
          minutos: Number(m.selectedDisputeAlternative.metadata?.additionalTimeInMinutes) || null,
        }
      : null,
    em: texto(ev?.createdAt) ?? new Date().toISOString(),
  };
  const r: any = await db.execute(sql`
    update atendimento_chamado
       set detalhe = coalesce(detalhe, '{}'::jsonb) || jsonb_build_object('encerramento', ${JSON.stringify(encerramento)}::jsonb),
           decisao = case when status = 'aberto' then ${DECISAO_DO_ENCERRAMENTO[status] ?? null} else decisao end,
           resolvido_em = case when status = 'aberto' then now() else resolvido_em end,
           prazo_em = null,
           aguardando_desde = null,
           status = 'resolvido'
     where tenant_id = ${tenantId} and canal = 'ifood' and externo_id = ${disputa}
     returning id`);
  const row = (r.rows ?? r)[0];
  if (row) emitir('atendimento.mudou', { tenantId, id: row.id, motivo: 'ifood_encerrou' });
  return !!row;
}
