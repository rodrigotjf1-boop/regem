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
  },
): Promise<PixCriado> {
  // O MP valida o formato do e-mail do pagador (rejeita TLD .local, vazio, etc.).
  // O cardápio coleta nome+telefone, não e-mail → usa o informado só se for válido,
  // senão um fallback com domínio real. Sem e-mail válido o PIX volta 400.
  const emailValido = (e?: string) => !!e && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e);
  const body = {
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
  const res = await fetch(`${API}/v1/payments`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'X-Idempotency-Key': dados.idempotencia,
    },
    body: JSON.stringify(body),
  });
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
