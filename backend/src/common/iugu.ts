// Integração Iugu — pagamento PIX. REST direto (sem SDK) para manter o deploy leve.
// Espelha common/mercadopago.ts: mesma interface PixCriado, para encaixar no fluxo
// do cardápio sem atrito. O token (Live API Token) vem por tenant (tabela integracao
// canal 'iugu') ou do env IUGU_API_TOKEN. Auth = Basic base64(token:) — o token é o
// usuário, senha vazia. Docs: https://dev.iugu.com/reference
//
// Fluxo PIX: cria uma "invoice" com payable_with=['pix'] → a resposta traz o QR Code
// (imagem base64 + copia-e-cola) e o id; o cliente paga; a Iugu chama o webhook
// (invoice.status_changed); consultamos a fatura para confirmar (status 'paid').

import type { PixCriado } from './mercadopago';

const API = 'https://api.iugu.com';

function authHeader(token: string): string {
  // Basic base64("<token>:") — token como usuário, senha vazia.
  return `Basic ${Buffer.from(`${token}:`).toString('base64')}`;
}

// Cria uma fatura PIX. `valor` em reais. `referenciaExterna` = pedidoId (correlação).
export async function criarPixIugu(
  token: string,
  dados: {
    valor: number;
    descricao: string;
    email?: string;
    nome?: string;
    referenciaExterna: string;
    idempotencia?: string; // não usado pela Iugu (sem header dedicado); mantém a assinatura
  },
): Promise<PixCriado> {
  const hoje = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const body = {
    email: dados.email || 'cliente@regem.local',
    due_date: hoje,
    ensure_workday_due_date: false,
    payable_with: ['pix'],
    external_reference: dados.referenciaExterna,
    payer: { name: dados.nome || 'Cliente', email: dados.email || 'cliente@regem.local' },
    items: [
      {
        description: dados.descricao,
        quantity: 1,
        price_cents: Math.round(Number(dados.valor) * 100),
      },
    ],
  };
  const res = await fetch(`${API}/v1/invoices`, {
    method: 'POST',
    headers: {
      Authorization: authHeader(token),
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`Iugu ${res.status}: ${txt.slice(0, 200)}`);
  }
  const j: any = await res.json();
  const pix = j?.pix ?? {};
  // A Iugu entrega o copia-e-cola em `pix.qrcode_text` e a imagem em `pix.qrcode`
  // (base64/data-uri). `secure_url` é o link da fatura (fallback de pagamento).
  return {
    id: String(j.id),
    status: j.status ?? 'pending', // pending | paid | canceled | expired ...
    qrCode: pix.qrcode_text ?? null,
    qrCodeBase64: pix.qrcode ?? null,
    ticketUrl: j.secure_url ?? j.secure_payment_url ?? null,
  };
}

// Consulta a fatura (usado pelo webhook). Status 'paid' = confirmado.
export async function consultarFaturaIugu(
  token: string,
  invoiceId: string,
): Promise<{ id: string; status: string; referenciaExterna: string | null }> {
  const res = await fetch(`${API}/v1/invoices/${invoiceId}`, {
    headers: { Authorization: authHeader(token), Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`Iugu status ${res.status}`);
  const j: any = await res.json();
  return {
    id: String(j.id),
    status: j.status ?? '',
    referenciaExterna: j.external_reference ?? null,
  };
}
