'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { toast } from '@/lib/toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

/* eslint-disable @typescript-eslint/no-explicit-any */
// Números de WhatsApp por PAPEL × PROVEDOR (épico 2 provedores, mig 225).
//   Principal = chatbot só responde (nunca inicia): status/dúvidas/horário/link.
//   Marketing = disparo de campanha (nós iniciamos).
// O mesmo número pode ocupar os 2 papéis. Cada número tem sua instância (Evolution)
// ou phone_number_id (Cloud oficial). Os textos de uso são guard-rails anti-ban.

type Provedor = 'evolution' | 'cloud';
type NumeroResolvido = {
  papel: 'principal' | 'marketing';
  provedor: Provedor;
  numero: string | null;
  instancia: string | null;
  phoneId: string | null;
  wabaId: string | null;
  status: string;
  verificado: boolean;
  vinculado: boolean;
};
type Estado = {
  principal: NumeroResolvido;
  marketing: NumeroResolvido;
  termo: { versao: string; evolution: string; cloud: string };
};

const DESC: Record<'principal' | 'marketing', string> = {
  principal:
    'É o número que conversa com seus clientes: responde dúvidas, horário, link do cardápio e o ' +
    'andamento do pedido. O robô só responde quando o cliente chama primeiro — ele nunca começa a ' +
    'conversa sozinho.',
  marketing:
    'É o número que ENVIA as promoções e campanhas para seus clientes. Aqui é a loja que começa a ' +
    'conversa, então o WhatsApp é mais rígido: o ideal é usar um número separado (um chip só pra isso), ' +
    'nunca o número principal da loja.',
};

// Carrega o SDK JS do Facebook uma vez e inicializa com o App ID da distribuição.
let fbCarregando = false;
function carregarFB(appId: string, version: string): Promise<any> {
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

export function NumerosWhatsapp({
  pode,
  onProvedorPrincipal,
}: {
  pode: boolean;
  onProvedorPrincipal?: (p: Provedor) => void;
}) {
  const [est, setEst] = useState<Estado | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [mesmoNumero, setMesmoNumero] = useState(false);

  async function carregar() {
    setCarregando(true);
    setErro(null);
    try {
      const d: Estado = await api.whatsappNumeros();
      setEst(d);
      onProvedorPrincipal?.(d.principal.provedor);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não consegui carregar os números.');
    } finally {
      setCarregando(false);
    }
  }
  useEffect(() => {
    carregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Fallback: os cards SEMPRE aparecem (mesmo antes de carregar / se der erro), para
  // o gestor nunca ficar sem a configuração de números na tela.
  const vazio: NumeroResolvido = {
    papel: 'principal',
    provedor: 'evolution',
    numero: null,
    instancia: null,
    phoneId: null,
    wabaId: null,
    status: 'desconectado',
    verificado: false,
    vinculado: false,
  };
  const dados: Estado = est ?? {
    principal: { ...vazio, papel: 'principal' },
    marketing: { ...vazio, papel: 'marketing' },
    termo: { versao: '', evolution: '', cloud: '' },
  };

  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <p className="text-sm font-semibold text-foreground">Números de WhatsApp da loja</p>
      <p className="mt-0.5 text-xs text-foreground">
        Você tem dois números: o <strong>Principal</strong> fala com os clientes (atendimento + robô) e o de{' '}
        <strong>Marketing</strong> envia as promoções. Podem ser o mesmo número.
      </p>
      <p className="mt-2 rounded-lg bg-primary/5 px-3 py-2 text-xs text-foreground">
        💡 <strong>Dica:</strong> no <strong>Principal</strong>, use a opção <strong>Grátis</strong> pra continuar
        usando seu WhatsApp normal no celular. Pra <strong>enviar promoções</strong>, a opção <strong>Oficial</strong>{' '}
        é a mais segura (evita bloqueio).
      </p>
      {carregando && !est && <p className="mt-2 text-xs text-foreground/60">Carregando números…</p>}
      {erro && (
        <p className="mt-2 rounded-md bg-destructive/10 px-2 py-1 text-xs text-destructive">
          {erro} <button type="button" className="underline" onClick={carregar}>tentar de novo</button>
        </p>
      )}

      <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-2">
        <CardNumero papel="principal" dado={dados.principal} termo={dados.termo} pode={pode} onMudou={carregar} />
        <CardNumero
          papel="marketing"
          dado={dados.marketing}
          termo={dados.termo}
          pode={pode}
          onMudou={carregar}
          espelharDe={mesmoNumero ? dados.principal : undefined}
        />
      </div>

      {pode && (
        <label className="mt-3 flex cursor-pointer items-center gap-2 text-xs">
          <input
            type="checkbox"
            checked={mesmoNumero}
            onChange={async (e) => {
              setMesmoNumero(e.target.checked);
              if (e.target.checked) {
                // Copia a config do principal para o marketing.
                try {
                  await api.whatsappNumeroSalvar({
                    papel: 'marketing',
                    provedor: dados.principal.provedor,
                    numero: dados.principal.numero,
                    phoneId: dados.principal.phoneId,
                    wabaId: dados.principal.wabaId,
                    termoAceito: dados.termo.versao,
                  });
                  toast.success('Marketing usando o mesmo número do Principal.');
                  carregar();
                } catch (err) {
                  toast.error(err instanceof Error ? err.message : 'Não consegui espelhar.');
                }
              }
            }}
          />
          <span>Usar o mesmo número do Principal também no Marketing</span>
        </label>
      )}
    </div>
  );
}

function CardNumero({
  papel,
  dado,
  termo,
  pode,
  onMudou,
  espelharDe,
}: {
  papel: 'principal' | 'marketing';
  dado: NumeroResolvido;
  termo: Estado['termo'];
  pode: boolean;
  onMudou: () => void;
  espelharDe?: NumeroResolvido;
}) {
  const [provedor, setProvedor] = useState<Provedor>(dado.provedor);
  const [phoneId, setPhoneId] = useState(dado.phoneId ?? '');
  const [wabaId, setWabaId] = useState(dado.wabaId ?? '');
  const [numero, setNumero] = useState(dado.numero ?? '');
  const [qr, setQr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setProvedor(dado.provedor);
    setPhoneId(dado.phoneId ?? '');
    setWabaId(dado.wabaId ?? '');
    setNumero(dado.numero ?? '');
  }, [dado]);

  const titulo = papel === 'principal' ? '📱 Número Principal' : '📣 Número de Marketing';
  const conectado = dado.vinculado;

  async function salvar() {
    setBusy(true);
    try {
      await api.whatsappNumeroSalvar({ papel, provedor, numero, phoneId, wabaId, termoAceito: termo.versao });
      toast.success('Configuração salva.');
      onMudou();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Não foi possível salvar.');
    } finally {
      setBusy(false);
    }
  }

  async function conectarEvolution() {
    setBusy(true);
    setQr(null);
    try {
      // Garante o provedor evolution salvo antes de parear.
      await api.whatsappNumeroSalvar({ papel, provedor: 'evolution', numero, termoAceito: termo.versao });
      const r: any = papel === 'principal' ? await api.whatsappConectar() : await api.whatsappMarketingConectar();
      if (r?.jaConectado) {
        toast.success('Número já conectado.');
        onMudou();
      } else if (r?.qr) {
        setQr(r.qr);
      } else {
        toast.info('Gerando QR… tente novamente em alguns segundos.');
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Não foi possível conectar.');
    } finally {
      setBusy(false);
    }
  }

  // Embedded Signup (API oficial): abre o popup da Meta, captura phone_id + WABA da loja
  // e finaliza no backend. O lojista cadastra o próprio meio de pagamento no fluxo.
  async function embeddedSignup() {
    setBusy(true);
    try {
      const cfg: any = await api.whatsappEmbeddedConfig();
      if (!cfg?.appId || !cfg?.configId) {
        toast.error('Cadastro oficial ainda não configurado no servidor (App ID / Configuration ID).');
        setBusy(false);
        return;
      }
      const FB = await carregarFB(cfg.appId, cfg.graphVersion || 'v25.0');
      let phoneNumberId = '';
      let wabaId = '';
      let coexistence = false;
      const onMsg = (event: MessageEvent) => {
        try {
          if (!/(^|\.)facebook\.com$/.test(new URL(event.origin).hostname)) return;
          const d = JSON.parse(event.data);
          if (d.type !== 'WA_EMBEDDED_SIGNUP') return;
          // Número novo/migrado: devolve phone_number_id + waba_id.
          if (d.event === 'FINISH') {
            phoneNumberId = d.data?.phone_number_id ?? '';
            wabaId = d.data?.waba_id ?? '';
          }
          // COEXISTÊNCIA (número já no app WhatsApp Business): devolve só o waba_id — o
          // backend resolve o phone_number_id pela WABA. O número CONTINUA no celular.
          else if (d.event === 'FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING') {
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
          if (!code) {
            toast.error('Cadastro cancelado.');
            setBusy(false);
            return;
          }
          api
            .whatsappEmbeddedSignup({ code, phoneNumberId, wabaId, papel, coexistence })
            .then(() => {
              toast.success(coexistence ? 'WhatsApp conectado em coexistência!' : 'WhatsApp oficial conectado!');
              onMudou();
            })
            .catch((e) => toast.error(e instanceof Error ? e.message : 'Falha ao finalizar o cadastro.'))
            .finally(() => setBusy(false));
        },
        {
          config_id: cfg.configId,
          response_type: 'code',
          override_default_response_type: true,
          extras: { setup: {}, featureType: '', sessionInfoVersion: '3' },
        },
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Não consegui abrir o cadastro da Meta.');
      setBusy(false);
    }
  }

  const espelhado = !!espelharDe;

  return (
    <div className="rounded-lg border border-border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold">{titulo}</span>
        <span
          className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${
            conectado
              ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600'
              : 'border-border bg-muted text-foreground/70'
          }`}
        >
          {conectado ? '● conectado' : '○ não conectado'}
        </span>
        {dado.numero && <span className="text-[11px] text-foreground/70">{dado.numero}</span>}
      </div>

      {espelhado ? (
        <p className="mt-2 text-xs text-foreground/70">
          Espelhando o número Principal. Desmarque “usar o mesmo número” para configurar um número separado.
        </p>
      ) : (
        <>
          {/* Toggle de provedor */}
          <div className="mt-2 flex flex-wrap gap-2">
            {(['evolution', 'cloud'] as Provedor[]).map((p) => (
              <button
                key={p}
                type="button"
                disabled={!pode}
                aria-pressed={provedor === p}
                onClick={() => setProvedor(p)}
                className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition ${
                  provedor === p ? 'border-primary bg-primary/5 ring-1 ring-primary' : 'border-border hover:border-primary/40'
                } ${pode ? '' : 'cursor-not-allowed opacity-60'}`}
              >
                {p === 'evolution' ? 'Grátis (não oficial)' : 'Oficial (Meta)'}
              </button>
            ))}
          </div>

          <p className="mt-2 text-xs leading-relaxed text-foreground">{DESC[papel]}</p>

          <div className="mt-2 rounded-lg border border-dashed border-border bg-muted/30 p-2">
            <p className="text-[10px] font-bold uppercase tracking-wide text-foreground/70">O que você aceita</p>
            <p className="mt-0.5 text-[11px] leading-relaxed text-foreground">{termo[provedor]}</p>
          </div>

          {provedor === 'cloud' ? (
            <div className="mt-2 space-y-2">
              <Button type="button" size="sm" disabled={!pode || busy} onClick={embeddedSignup}>
                {busy ? 'Abrindo…' : conectado ? 'Reconectar com a Meta' : 'Conectar com a Meta (recomendado)'}
              </Button>
              <p className="text-[11px] text-foreground">
                Abre uma janela da Meta pra você conectar o número e cadastrar sua forma de pagamento (a Meta
                cobra as mensagens direto de você).
              </p>
              <p className="rounded-lg bg-primary/5 px-2 py-1.5 text-[11px] text-foreground">
                💚 <strong>Já usa o WhatsApp Business neste número?</strong> Na janela da Meta, escolha{' '}
                <strong>conectar sua conta existente (coexistência)</strong>: o número <strong>continua funcionando
                no seu celular e no WhatsApp Web</strong> pra você atender à mão, e a Regem usa a API oficial por
                trás pra campanhas e avisos. Se for um número novo (ou migração), ele sai do app comum e o
                atendimento passa a ser feito aqui, na tela do Regem.
              </p>
              <details className="text-[11px] text-foreground/70">
                <summary className="cursor-pointer">avançado — informar o código do número manualmente</summary>
                <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
                  <div>
                    <Label className="text-xs">Phone Number ID</Label>
                    <Input value={phoneId} onChange={(e) => setPhoneId(e.target.value)} placeholder="Phone Number ID" disabled={!pode} />
                  </div>
                  <div>
                    <Label className="text-xs">WABA ID</Label>
                    <Input value={wabaId} onChange={(e) => setWabaId(e.target.value)} placeholder="WABA ID" disabled={!pode} />
                  </div>
                  <div>
                    <Label className="text-xs">Número (exibir)</Label>
                    <Input value={numero} onChange={(e) => setNumero(e.target.value)} placeholder="5521999999999" disabled={!pode} />
                  </div>
                </div>
              </details>
            </div>
          ) : (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Button type="button" size="sm" disabled={!pode || busy} onClick={conectarEvolution}>
                {busy ? 'Aguarde…' : conectado ? 'Reconectar (QR)' : 'Conectar (QR)'}
              </Button>
              <Input
                value={numero}
                onChange={(e) => setNumero(e.target.value)}
                placeholder="Número (exibir) 5521999999999"
                disabled={!pode}
                className="max-w-[220px]"
              />
            </div>
          )}

          {qr && (
            <div className="mt-2 flex flex-col items-center rounded-lg border border-border bg-white p-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={qr} alt="QR Code do WhatsApp" className="h-44 w-44" />
              <p className="mt-1 text-[11px] text-foreground/70">Abra o WhatsApp → Aparelhos conectados → Conectar aparelho.</p>
            </div>
          )}

          {pode && (
            <div className="mt-2">
              <Button type="button" size="sm" variant="outline" disabled={busy} onClick={salvar}>
                {busy ? 'Salvando…' : 'Salvar escolha'}
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
