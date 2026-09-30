'use client';

import { useEffect, useRef } from 'react';

// "Saiba mais" do aviso de origem (trilha C, C3a — mockup aprovado em 30/09/2026): quem cuida do
// dado, o que é guardado, para quê, quem mais recebe, por quanto tempo e como recusar. A loja é a
// controladora; o Regem guarda para ela.

/** CNPJ com máscara. CPF (loja de pessoa física) não aparece: é dado pessoal do dono. */
function cnpjDaLoja(documento?: string | null): string | null {
  const d = String(documento ?? '').replace(/\D/g, '');
  if (d.length !== 14) return null;
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
}

export function SaibaMaisOrigem({
  lojaNome,
  documento,
  whatsapp,
  contato,
  ferramenta,
  accent,
  onRecusar,
  onFechar,
}: {
  lojaNome: string;
  documento?: string | null;
  whatsapp?: string | null;
  contato?: string | null;
  ferramenta: string | null;
  accent: string;
  onRecusar: () => void;
  onFechar: () => void;
}) {
  const titulo = useRef<HTMLHeadingElement>(null);
  // O foco vai ao título só ao abrir; o Esc usa sempre o `onFechar` mais novo.
  const fechar = useRef(onFechar);
  fechar.current = onFechar;
  useEffect(() => {
    titulo.current?.focus();
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') fechar.current();
    };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, []);

  const cnpj = cnpjDaLoja(documento);
  const canal = whatsapp ? `pelo WhatsApp ${whatsapp}` : contato ? `pelo telefone ${contato}` : 'pelos contatos dela';
  const itens: [string, string][] = [
    ['Quem cuida', `${lojaNome}${cnpj ? `, CNPJ ${cnpj}` : ''}, a loja em que você está pedindo. O Regem é o sistema que ela usa e guarda o registro para ela.`],
    [
      'O que fica registrado',
      'O link por onde você entrou: a campanha, o anúncio e, quando o anúncio envia, o código do clique, um número que o Google ou a Meta criam a cada clique. Seu nome e seu telefone não entram nesse registro.',
    ],
    [
      'Para quê',
      'Para a loja saber quais anúncios trazem pedidos de verdade e quanto eles rendem. O registro não é usado para mostrar anúncios para você e não é vendido.',
    ],
    [
      'Quem mais recebe',
      `A ferramenta de marketing contratada pela loja${ferramenta ? `, ${ferramenta},` : ','} que usa o registro só nos relatórios da loja.`,
    ],
    [
      'Por quanto tempo',
      'No seu aparelho, só enquanto esta aba estiver aberta. No pedido, o código do clique é apagado em até 90 dias; a campanha e o anúncio ficam com o pedido enquanto a loja guardar os pedidos dela.',
    ],
    ['Se não quiser', `Toque em “Não registrar” antes de fazer o pedido. Depois do pedido, peça à loja para apagar o registro ${canal}.`],
    ['Base legal', 'Legítimo interesse da loja em medir os próprios anúncios (LGPD, art. 7º, IX).'],
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50" onClick={onFechar}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="saiba-mais-origem-titulo"
        className="flex max-h-[88dvh] w-full max-w-lg flex-col rounded-t-3xl bg-white text-neutral-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-neutral-100 px-4 py-3">
          <h2 id="saiba-mais-origem-titulo" ref={titulo} tabIndex={-1} className="text-base font-bold outline-none">
            De onde você veio
          </h2>
          <button type="button" onClick={onFechar} aria-label="Fechar" className="text-neutral-400">
            ✕
          </button>
        </div>
        <div className="space-y-3 overflow-y-auto px-4 py-3">
          <dl className="space-y-3">
            {itens.map(([t, d]) => (
              <div key={t}>
                <dt className="text-[11px] font-bold uppercase tracking-wide text-neutral-500">{t}</dt>
                <dd className="mt-0.5 text-sm text-neutral-700">{d}</dd>
              </div>
            ))}
          </dl>
          <p className="text-sm">
            <a href="/privacidade" target="_blank" rel="noopener noreferrer" className="font-semibold underline underline-offset-2">
              Política de privacidade do Regem
            </a>
          </p>
        </div>
        <div className="flex gap-2 border-t border-neutral-100 px-4 py-3">
          <button type="button" onClick={onRecusar} className="flex-1 rounded-xl border border-neutral-200 py-2.5 text-sm font-semibold">
            Não registrar
          </button>
          <button type="button" onClick={onFechar} className="flex-1 rounded-xl py-2.5 text-sm font-bold text-white" style={{ background: accent }}>
            Entendi
          </button>
        </div>
      </div>
    </div>
  );
}
