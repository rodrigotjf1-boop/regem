// Integração Mercado Pago — pagamento PIX. REST direto (sem SDK) para manter o
// deploy leve. O access token vem por tenant (tabela integracao canal
// 'mercadopago') ou do env MP_ACCESS_TOKEN. Falha de rede → lança para o chamador
// tratar (o checkout cai no fallback). Docs: https://www.mercadopago.com.br/developers
//
// Fluxo PIX: cria um "payment" method_id=pix → devolve QR Code (copia-e-cola +
// base64) e o id; o cliente paga; o MP chama o webhook; consultamos o status.

import { createHmac, timingSafeEqual } from 'node:crypto';
import { classificarFalhaGateway, FIN_TIMEOUT_CRIAR_MS, FIN_TIMEOUT_CONSULTA_MS } from './gateway-erro';

const API = 'https://api.mercadopago.com';

// Verifica a ASSINATURA do webhook do Mercado Pago (defesa em profundidade sobre a
// re-consulta). Só bloqueia se `MP_WEBHOOK_SECRET` estiver configurado — sem ele,
// retorna true (comportamento atual mantido). Manifesto oficial:
// `id:<data.id>;request-id:<x-request-id>;ts:<ts>;` → HMAC-SHA256 hex = v1.
export function assinaturaWebhookMPOk(
  xSignature: string | undefined,
  xRequestId: string | undefined,
  dataId: string,
  secret: string,
): boolean {
  if (!secret) return true; // sem secret → não exige assinatura (opcional)
  if (!xSignature) return false;
  const parts: Record<string, string> = {};
  for (const p of String(xSignature).split(',')) {
    const [k, v] = p.split('=');
    if (k && v) parts[k.trim()] = v.trim();
  }
  const { ts, v1 } = parts;
  if (!ts || !v1) return false;
  const manifest = `id:${String(dataId).toLowerCase()};request-id:${xRequestId ?? ''};ts:${ts};`;
  const calc = createHmac('sha256', secret).update(manifest).digest('hex');
  const a = Buffer.from(calc);
  const b = Buffer.from(v1);
  return a.length === b.length && timingSafeEqual(a, b);
}

export type PixCriado = {
  id: string;
  status: string; // pending | approved | rejected | ...
  qrCode: string | null; // copia-e-cola
  qrCodeBase64: string | null; // imagem base64 do QR
  ticketUrl: string | null; // link de pagamento (fallback)
};

// O Mercado Pago só garante o Pix com vencimento de 30 minutos a 30 dias depois de criado (doc oficial do Checkout API,
// "Integrar Pix"). Abaixo disso ele ACEITA a data, mas a cobrança deixa de receber antes do horário: o Pix de 5 min do
// adicional (pedido 77, 27/11/2026) foi recusado no Itaú e no Nubank com 1 minuto de vida — "o banco recebedor está com
// problema" (ERR-653). Por isso o MP recebe sempre o mínimo dele com 1 minuto de folga; o PRAZO do Regem (10 min do
// pedido e do adicional) vale pelas rotinas, que cancelam a cobrança no MP quando ele acaba (`cancelarPagamentoMP`).
export const MINIMO_DO_VENCIMENTO_NO_MP_MS = 31 * 60_000;

/** O vencimento que vai ao Mercado Pago: o pedido, ou o mínimo do MP (com folga) se o pedido for mais curto. */
export function vencimentoNoMP(expiraEm: Date, agora = Date.now()): Date {
  return new Date(Math.max(expiraEm.getTime(), agora + MINIMO_DO_VENCIMENTO_NO_MP_MS));
}

// Cria um pagamento PIX. `valor` em reais. `idempotencia` evita cobrança dupla.
export async function criarPixMP(
  token: string,
  dados: {
    valor: number;
    descricao: string;
    email?: string;
    nome?: string;
    referenciaExterna: string; // = pedidoId (correlação)
    notificationUrl?: string;
    idempotencia: string;
    expiraEm?: Date; // o prazo do Regem; o date_of_expiration sai pelo `vencimentoNoMP` (nunca abaixo do mínimo do MP)
  },
): Promise<PixCriado> {
  // O MP valida o formato do e-mail do pagador (rejeita TLD .local, vazio, etc.).
  // O cardápio coleta nome+telefone, não e-mail → usa o informado só se for válido,
  // senão um fallback com domínio real. Sem e-mail válido o PIX volta 400.
  const emailValido = (e?: string) => !!e && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e);
  // MP exige ISO 8601 COM offset (não aceita 'Z'). Usamos UTC como +00:00.
  const isoOffset = (d: Date) => d.toISOString().replace('Z', '+00:00');
  const body: Record<string, unknown> = {
    transaction_amount: Math.round(Number(dados.valor) * 100) / 100,
    description: dados.descricao,
    payment_method_id: 'pix',
    external_reference: dados.referenciaExterna,
    notification_url: dados.notificationUrl,
    payer: {
      email: emailValido(dados.email) ? dados.email : 'no-reply@dmsregem.com',
      first_name: dados.nome || 'Cliente',
    },
  };
  if (dados.expiraEm) body.date_of_expiration = isoOffset(vencimentoNoMP(dados.expiraEm));
  const postar = (b: Record<string, unknown>) =>
    fetch(`${API}/v1/payments`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'X-Idempotency-Key': dados.idempotencia,
      },
      body: JSON.stringify(b),
      signal: AbortSignal.timeout(FIN_TIMEOUT_CRIAR_MS),
    });
  let res: Response;
  try {
    res = await postar(body);
    // Se o MP recusar E havia date_of_expiration, tenta SEM ela (vale 24 h) — não vale quebrar o
    // PIX por causa disso; as rotinas do Regem cancelam a cobrança no MP quando o prazo dele acaba.
    if (!res.ok && body.date_of_expiration) {
      const semExp = { ...body };
      delete semExp.date_of_expiration;
      res = await postar(semExp);
    }
  } catch (e) {
    // Rede/timeout/abort: estado DESCONHECIDO → ambíguo (a idempotency-key protege o retry no
    // MESMO provider; o orquestrador NÃO deve cair em outro gateway p/ não gerar 2ª PIX).
    throw classificarFalhaGateway(e);
  }
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw classificarFalhaGateway(new Error(`Mercado Pago ${res.status}: ${txt.slice(0, 200)}`), res.status);
  }
  const j: any = await res.json();
  const tx = j?.point_of_interaction?.transaction_data ?? {};
  return {
    id: String(j.id),
    status: j.status ?? 'pending',
    qrCode: tx.qr_code ?? null,
    qrCodeBase64: tx.qr_code_base64 ?? null,
    ticketUrl: tx.ticket_url ?? null,
  };
}

// Valida o Access Token: /users/me responde 200 com a conta se o token for válido.
// Usado pelo botão "Testar conexão" das Integrações.
export async function validarTokenMP(token: string): Promise<{ ok: true; conta?: string }> {
  const res = await fetch(`${API}/users/me`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`Mercado Pago ${res.status}: ${txt.slice(0, 160)}`);
  }
  const j: any = await res.json();
  return { ok: true, conta: j?.nickname || j?.email || (j?.id ? `conta ${j.id}` : undefined) };
}

// Cancela um pagamento PIX pendente (expirou sem pagar) — impede pagamento tardio
// depois de o pedido ter sido cancelado por falta de pagamento. Best-effort.
export async function cancelarPagamentoMP(token: string, paymentId: string): Promise<void> {
  await fetch(`${API}/v1/payments/${paymentId}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'cancelled' }),
    signal: AbortSignal.timeout(FIN_TIMEOUT_CONSULTA_MS),
  }).catch(() => {});
}

// Reembolsa (refund) um pagamento APROVADO — total (sem valor) ou parcial (`valor`
// em reais). Usado no cancelamento de encomenda com sinal dentro do prazo. Lança
// em falha para o chamador cair no fallback manual. Docs: /v1/payments/{id}/refunds
export async function reembolsarPagamentoMP(
  token: string,
  paymentId: string,
  valor?: number,
  /** Outra chave de idempotência para OUTRO pedido de estorno do mesmo pagamento (a 2ª forma do `estornarTudoMP`). */
  chave = `refund-${paymentId}`,
): Promise<{ id: string; status: string }> {
  const body = valor != null ? JSON.stringify({ amount: Math.round(Number(valor) * 100) / 100 }) : undefined;
  const res = await fetch(`${API}/v1/payments/${paymentId}/refunds`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'X-Idempotency-Key': chave,
    },
    body,
    signal: AbortSignal.timeout(FIN_TIMEOUT_CRIAR_MS),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`Mercado Pago refund ${res.status}: ${txt.slice(0, 200)}`);
  }
  const j: any = await res.json();
  return { id: String(j.id ?? ''), status: j.status ?? 'approved' };
}

/** O valor pago e o quanto já voltou ao cliente (`transaction_amount` e `transaction_amount_refunded` do pagamento). */
export async function valoresDoPagamentoMP(token: string, paymentId: string): Promise<{ total: number | null; devolvido: number }> {
  const res = await fetch(`${API}/v1/payments/${paymentId}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(FIN_TIMEOUT_CONSULTA_MS),
  });
  if (!res.ok) throw new Error(`Mercado Pago status ${res.status}`);
  const j: any = await res.json();
  const total = Number(j.transaction_amount);
  return { total: Number.isFinite(total) ? total : null, devolvido: Number(j.transaction_amount_refunded) || 0 };
}

/**
 * O ESTORNO TOTAL do Pix do pedido cancelado (15/11/2026 — ERR-472). O pedido #71 (R$ 65,00) foi estornado com o corpo
 * vazio (o "total" da doc) e o cliente recebeu R$ 64,54: a tarifa do Mercado Pago (R$ 0,46) ficou de fora. Agora:
 *  1. lê o pagamento — o que já voltou não pede de novo;
 *  2. pede o estorno com o VALOR CHEIO explícito (`amount` = o valor pago);
 *  3. se o Mercado Pago recusar o valor (4xx), pede da forma de antes (corpo vazio), com outra chave de idempotência;
 *  4. lê de novo e devolve QUANTO voltou (`devolvido`) — quem chama avisa a loja quando voltou menos que o pago.
 * Leitura que falha não impede o estorno: `devolvido` vem null (não se sabe).
 */
export async function estornarTudoMP(
  token: string,
  paymentId: string,
): Promise<{ id: string; status: string; total: number | null; devolvido: number | null }> {
  const antes = await valoresDoPagamentoMP(token, paymentId).catch(() => null);
  if (antes?.total != null && antes.devolvido >= antes.total - 0.005) {
    return { id: '', status: 'refunded', total: antes.total, devolvido: antes.devolvido };
  }
  let r: { id: string; status: string };
  if (antes?.total != null) {
    const falta = Math.round((antes.total - antes.devolvido) * 100) / 100;
    try {
      r = await reembolsarPagamentoMP(token, paymentId, falta, `refund-${paymentId}-cheio`);
    } catch (e: any) {
      if (!/refund 4\d\d/.test(String(e?.message ?? ''))) throw e;
      r = await reembolsarPagamentoMP(token, paymentId);
    }
  } else {
    r = await reembolsarPagamentoMP(token, paymentId);
  }
  const depois = await valoresDoPagamentoMP(token, paymentId).catch(() => null);
  return { ...r, total: depois?.total ?? antes?.total ?? null, devolvido: depois ? depois.devolvido : null };
}

// Consulta o status de um pagamento (usado pelo webhook).
export async function consultarPagamentoMP(
  token: string,
  paymentId: string,
): Promise<{ id: string; status: string; referenciaExterna: string | null }> {
  const res = await fetch(`${API}/v1/payments/${paymentId}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(FIN_TIMEOUT_CONSULTA_MS),
  });
  if (!res.ok) throw new Error(`Mercado Pago status ${res.status}`);
  const j: any = await res.json();
  return { id: String(j.id), status: j.status ?? '', referenciaExterna: j.external_reference ?? null };
}
