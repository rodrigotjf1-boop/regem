// Integração Mercado Pago — pagamento PIX. REST direto (sem SDK) para manter o
// deploy leve. O access token vem por tenant (tabela integracao canal
// 'mercadopago') ou do env MP_ACCESS_TOKEN. Falha de rede → lança para o chamador
// tratar (o checkout cai no fallback). Docs: https://www.mercadopago.com.br/developers
//
// Fluxo PIX: cria um "payment" method_id=pix → devolve QR Code (copia-e-cola +
// base64) e o id; o cliente paga; o MP chama o webhook; consultamos o status.

const API = 'https://api.mercadopago.com';

export type PixCriado = {
  id: string;
  status: string; // pending | approved | rejected | ...
  qrCode: string | null; // copia-e-cola
  qrCodeBase64: string | null; // imagem base64 do QR
  ticketUrl: string | null; // link de pagamento (fallback)
};

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
    expiraEm?: Date; // date_of_expiration: o MP recusa pagamento após esse instante
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
  if (dados.expiraEm) body.date_of_expiration = isoOffset(dados.expiraEm);
  const postar = (b: Record<string, unknown>) =>
    fetch(`${API}/v1/payments`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'X-Idempotency-Key': dados.idempotencia,
      },
      body: JSON.stringify(b),
    });
  let res = await postar(body);
  // Se o MP recusar E havia date_of_expiration, tenta SEM ela (o mínimo de expiração
  // do MP varia) — não vale quebrar o PIX por causa disso; o cron cancela em 10 min.
  if (!res.ok && body.date_of_expiration) {
    const semExp = { ...body };
    delete semExp.date_of_expiration;
    res = await postar(semExp);
  }
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`Mercado Pago ${res.status}: ${txt.slice(0, 200)}`);
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
  }).catch(() => {});
}

// Reembolsa (refund) um pagamento APROVADO — total (sem valor) ou parcial (`valor`
// em reais). Usado no cancelamento de encomenda com sinal dentro do prazo. Lança
// em falha para o chamador cair no fallback manual. Docs: /v1/payments/{id}/refunds
export async function reembolsarPagamentoMP(
  token: string,
  paymentId: string,
  valor?: number,
): Promise<{ id: string; status: string }> {
  const body = valor != null ? JSON.stringify({ amount: Math.round(Number(valor) * 100) / 100 }) : undefined;
  const res = await fetch(`${API}/v1/payments/${paymentId}/refunds`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'X-Idempotency-Key': `refund-${paymentId}`,
    },
    body,
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`Mercado Pago refund ${res.status}: ${txt.slice(0, 200)}`);
  }
  const j: any = await res.json();
  return { id: String(j.id ?? ''), status: j.status ?? 'approved' };
}

// Consulta o status de um pagamento (usado pelo webhook).
export async function consultarPagamentoMP(
  token: string,
  paymentId: string,
): Promise<{ id: string; status: string; referenciaExterna: string | null }> {
  const res = await fetch(`${API}/v1/payments/${paymentId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Mercado Pago status ${res.status}`);
  const j: any = await res.json();
  return { id: String(j.id), status: j.status ?? '', referenciaExterna: j.external_reference ?? null };
}
