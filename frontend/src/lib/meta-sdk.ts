/* eslint-disable @typescript-eslint/no-explicit-any */

// A JANELA DA META (cadastro integrado do WhatsApp oficial). Um lugar só para carregar o SDK do Facebook e abrir a
// janela: serve aos números das lojas (`components/delivery/numeros-whatsapp.tsx`) e ao número do Mister, no console
// da distribuição (`components/distribuicao/mister-no-console.tsx`).

// Carrega o SDK JS do Facebook uma vez e inicializa com o App ID da distribuição.
let fbCarregando = false;
export function carregarFB(appId: string, version: string): Promise<any> {
  return new Promise((resolve) => {
    const w = window as any;
    if (w.FB) {
      try {
        w.FB.init({ appId, autoLogAppEvents: true, xfbml: false, version });
      } catch {
        /* já inicializado */
      }
      return resolve(w.FB);
    }
    w.fbAsyncInit = function () {
      w.FB.init({ appId, autoLogAppEvents: true, xfbml: false, version });
      resolve(w.FB);
    };
    if (!fbCarregando) {
      fbCarregando = true;
      const s = document.createElement('script');
      s.src = 'https://connect.facebook.net/en_US/sdk.js';
      s.async = true;
      s.defer = true;
      s.crossOrigin = 'anonymous';
      document.body.appendChild(s);
    }
  });
}

export interface CadastroNaMeta {
  code: string;
  phoneNumberId: string;
  wabaId: string;
  /** A Meta concluiu pelo caminho da coexistência (o número continua no WhatsApp Business do celular). */
  coexistence: boolean;
}

/**
 * Abre a janela da Meta e devolve o que ela entrega ao fim — ou null se a pessoa fechou sem concluir.
 * `coexistencia`: a Meta só oferece "conectar o WhatsApp Business existente" com o `featureType` próprio; vazio é o
 * número só da API.
 */
export async function abrirCadastroDaMeta(o: { appId: string; configId: string; graphVersion?: string; coexistencia: boolean }): Promise<CadastroNaMeta | null> {
  const FB = await carregarFB(o.appId, o.graphVersion || 'v25.0');
  return new Promise((resolve) => {
    let phoneNumberId = '';
    let wabaId = '';
    let coexistence = false;
    const onMsg = (event: MessageEvent) => {
      try {
        if (!/(^|\.)facebook\.com$/.test(new URL(event.origin).hostname)) return;
        const d = JSON.parse(event.data);
        if (d.type !== 'WA_EMBEDDED_SIGNUP') return;
        if (d.event === 'FINISH') {
          phoneNumberId = d.data?.phone_number_id ?? '';
          wabaId = d.data?.waba_id ?? '';
        } else if (d.event === 'FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING') {
          // Coexistência: vem só a conta; o servidor acha o número que está no aplicativo do celular.
          wabaId = d.data?.waba_id ?? '';
          coexistence = true;
        }
      } catch {
        /* mensagem não-JSON do SDK */
      }
    };
    window.addEventListener('message', onMsg);
    FB.login(
      (resp: any) => {
        window.removeEventListener('message', onMsg);
        const code = resp?.authResponse?.code;
        resolve(code ? { code, phoneNumberId, wabaId, coexistence } : null);
      },
      {
        config_id: o.configId,
        response_type: 'code',
        override_default_response_type: true,
        extras: { setup: {}, featureType: o.coexistencia ? 'whatsapp_business_app_onboarding' : '', sessionInfoVersion: '3' },
      },
    );
  });
}
