// A COEXISTÊNCIA no cadastro integrado da Meta (o número continua no aplicativo WhatsApp Business do celular e entra na
// API oficial ao mesmo tempo). Fonte: "Onboard WhatsApp Business app users" (developers.facebook.com, conferida em
// 12/11/2026) — o mesmo caminho que o RegemCast já usa (`docs/whatsapp.md` dele).
//
// O que muda em relação ao número só da API:
//   • a janela da Meta abre com `featureType = whatsapp_business_app_onboarding` (vazio = número só da API; a Meta não
//     oferece "conectar o app existente" nesse caminho — era por isso que a opção não aparecia no Regem, 12/11/2026);
//   • o evento de fim é `FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING` e pode vir SEM o phone_number_id: o número se acha na
//     conta (WABA) — o que está no aplicativo (`is_on_biz_app`);
//   • o número NÃO se registra (`/register`): o aplicativo já registrou;
//   • a cópia dos dados do aplicativo (contatos e conversas) tem de ser PEDIDA em até 24 horas do fim do cadastro — sem
//     o pedido, a Meta desfaz a conexão e o cadastro se refaz do zero.

/** O `featureType` da janela da Meta no caminho da coexistência. */
export const FEATURE_TYPE_COEXISTENCIA = 'whatsapp_business_app_onboarding';

/** Um número da conta como a Meta lista (`GET /{waba}/phone_numbers?fields=id,is_on_biz_app,platform_type`). */
export type NumeroDaWaba = { id?: unknown; is_on_biz_app?: unknown; platform_type?: unknown };

const ID = /^\d{5,32}$/;

/**
 * O número a ligar quando o evento da Meta não trouxe o phone_number_id. Na coexistência, o que está no aplicativo
 * (`is_on_biz_app`); a conta com um número só, ele; mais de um sem saber qual: vazio — ligar o número errado é pior
 * que pedir para tentar de novo. Fora da coexistência (o evento sempre traz o id), o primeiro, como sempre foi.
 */
export function escolherNumeroDaWaba(lista: readonly NumeroDaWaba[] | null | undefined, coexistencia: boolean): string {
  const numeros = (lista ?? [])
    .map((n) => ({ id: String(n?.id ?? '').trim(), noApp: n?.is_on_biz_app === true }))
    .filter((n) => ID.test(n.id));
  if (!numeros.length) return '';
  if (!coexistencia) return numeros[0].id;
  const noApp = numeros.filter((n) => n.noApp);
  if (noApp.length === 1) return noApp[0].id;
  if (noApp.length === 0 && numeros.length === 1) return numeros[0].id;
  return '';
}

/** Os dois pedidos de cópia, na ordem da Meta: os contatos e depois as conversas. */
export const PEDIDOS_DE_COPIA = ['smb_app_state_sync', 'history'] as const;

export type ResultadoDaCopia = { pedida: true } | { pedida: false; motivo: string };

type Buscar = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}>;

/**
 * Pede à Meta a cópia dos dados do aplicativo (`POST /{phone_number_id}/smb_app_data`, um pedido por tipo). O 200 só
 * ENFILEIRA: o conteúdo chega depois pelos avisos `smb_app_state_sync` e `history`. Para no primeiro recusado e devolve
 * o motivo (a tela mostra; o log registra) — nunca lança.
 */
export async function pedirCopiaDoApp(o: { graph: string; phoneNumberId: string; token: string; buscar?: Buscar }): Promise<ResultadoDaCopia> {
  const buscar: Buscar = o.buscar ?? ((url, init) => fetch(url, init));
  for (const tipo of PEDIDOS_DE_COPIA) {
    let res: { ok: boolean; status: number; json: () => Promise<unknown> } | null = null;
    try {
      res = await buscar(`${o.graph}/${o.phoneNumberId}/smb_app_data`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${o.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ messaging_product: 'whatsapp', sync_type: tipo }),
      });
    } catch (e: any) {
      return { pedida: false, motivo: `${tipo}: sem resposta da Meta (${String(e?.message ?? e).slice(0, 120)})` };
    }
    if (!res.ok) {
      const j: any = await res.json().catch(() => ({}));
      const msg = j?.error?.error_user_msg || j?.error?.message || `HTTP ${res.status}`;
      return { pedida: false, motivo: `${tipo}: ${String(msg).slice(0, 200)}` };
    }
  }
  return { pedida: true };
}
