// Integração PagBank / PagSeguro — pagamento PIX pela API de Pedidos (Orders).
// REST direto (sem SDK). Modo distribuição: o token é BYO puro, SÓ por tenant
// (tabela integracao canal 'pagseguro'), colado na tela de integração — sem env
// nem cadastro na API. O ambiente é produção por padrão; PAGBANK_API_BASE só serve
// pra apontar sandbox (https://sandbox.api.pagseguro.com) no dev/homologação.
// Docs: https://developer.pagbank.com.br/reference/criar-pedido-pedido-com-qr-code
//
// Fluxo PIX: cria um "order" com qr_codes → devolve o EMV copia-e-cola (qr_codes[0].text)
// + link PNG do QR; o cliente paga; o PagBank chama o webhook; consultamos o pedido
// (charges[].status === 'PAID').

const API = process.env.PAGBANK_API_BASE || 'https://api.pagseguro.com';

export type PixCriado = {
  id: string;
  status: string;
  qrCode: string | null; // copia-e-cola (EMV)
  qrCodeBase64: string | null; // PagBank não devolve base64 — usa o link PNG (ticketUrl)
  ticketUrl: string | null; // link do PNG do QR
};

const centavos = (reais: number) => Math.round(Number(reais) * 100);
const emailValido = (e?: string) => !!e && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e);

// Cria um pedido PIX com QR Code. `valor` em reais.
export async function criarPixPagBank(
  token: string,
  dados: {
    valor: number;
    descricao: string;
    email?: string;
    nome?: string;
    referenciaExterna: string; // = pedidoId (correlação)
    notificationUrl?: string;
    idempotencia: string;
    expiraEm?: Date;
  },
): Promise<PixCriado> {
  const valorCent = centavos(dados.valor);
  const body: Record<string, unknown> = {
    reference_id: dados.referenciaExterna,
    customer: {
      name: dados.nome || 'Cliente',
      email: emailValido(dados.email) ? dados.email : 'no-reply@dmsregem.com',
    },
    items: [{ name: String(dados.descricao).slice(0, 100) || 'Pedido', quantity: 1, unit_amount: valorCent }],
    qr_codes: [
      {
        amount: { value: valorCent },
        ...(dados.expiraEm ? { expiration_date: dados.expiraEm.toISOString() } : {}),
      },
    ],
    ...(dados.notificationUrl ? { notification_urls: [dados.notificationUrl] } : {}),
  };
  const res = await fetch(`${API}/orders`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'x-idempotency-key': dados.idempotencia,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`PagBank ${res.status}: ${txt.slice(0, 200)}`);
  }
  const j: any = await res.json();
  const qr = (j?.qr_codes ?? [])[0] ?? {};
  const pngLink = (qr.links ?? []).find((l: any) => l?.media === 'image/png')?.href ?? null;
  return {
    // Correlação pelo id do PEDIDO (o webhook e a consulta usam GET /orders/{id}).
    id: String(j.id),
    status: 'pending',
    qrCode: qr.text ?? null,
    qrCodeBase64: null,
    ticketUrl: pngLink,
  };
}

// Valida o token do vendedor (Bearer). Heurística read-only: um GET a um pedido
// inexistente responde 401 se o token for inválido, e 400/404 se for válido.
export async function validarTokenPagBank(token: string): Promise<{ ok: true; conta?: string }> {
  const res = await fetch(`${API}/orders/ORDE_00000000-0000-0000-0000-000000000000`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status === 401 || res.status === 403) {
    const txt = await res.text().catch(() => '');
    throw new Error(`PagBank ${res.status}: token inválido. ${txt.slice(0, 120)}`);
  }
  return { ok: true };
}

// Consulta o status do pedido (usado no polling e no webhook). 'paid' quando alguma
// charge está PAID.
export async function consultarPagamentoPagBank(
  token: string,
  orderId: string,
): Promise<{ id: string; status: string; referenciaExterna: string | null }> {
  const res = await fetch(`${API}/orders/${orderId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`PagBank status ${res.status}`);
  const j: any = await res.json();
  const pago = (j?.charges ?? []).some((c: any) => String(c?.status).toUpperCase() === 'PAID');
  return { id: String(j.id), status: pago ? 'paid' : 'pending', referenciaExterna: j?.reference_id ?? null };
}

// PIX não pago EXPIRA sozinho (expiration_date). Não há o que cancelar na API —
// no-op para manter a mesma assinatura dos outros gateways (best-effort).
export async function cancelarPagamentoPagBank(_token: string, _orderId: string): Promise<void> {
  /* PIX não pago expira sozinho; nada a cancelar. */
}

// Reembolsa (estorna) um pedido PAGO — total ou parcial (`valor` em reais). Busca a
// charge PAID do pedido e chama POST /charges/{id}/cancel. Lança em falha para o
// chamador cair no fallback manual. Docs: /reference/reembolsar (charges cancel).
export async function reembolsarPagamentoPagBank(
  token: string,
  orderId: string,
  valor?: number,
): Promise<{ id: string; status: string }> {
  const ord = await fetch(`${API}/orders/${orderId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!ord.ok) throw new Error(`PagBank order ${ord.status}`);
  const oj: any = await ord.json();
  const charge = (oj?.charges ?? []).find((c: any) => String(c?.status).toUpperCase() === 'PAID');
  if (!charge?.id) throw new Error('PagBank: charge paga não encontrada para estorno.');
  const body = valor != null ? JSON.stringify({ amount: { value: centavos(valor) } }) : undefined;
  const res = await fetch(`${API}/charges/${charge.id}/cancel`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body,
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`PagBank refund ${res.status}: ${txt.slice(0, 200)}`);
  }
  const j: any = await res.json();
  return { id: String(j.id ?? charge.id), status: String(j.status ?? 'CANCELED') };
}
