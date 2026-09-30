'use client';

import { useRef, useState } from 'react';
import { Check, Link2 } from 'lucide-react';
import { SaibaMaisOrigem } from './saiba-mais-origem';

// Aviso de ORIGEM no checkout (trilha C, C3a — mockup aprovado em 30/09/2026, faixa resumida):
// aparece acima do botão só quando o cliente chegou por link marcado numa loja que mede anúncios.
// "Não registrar" apaga a origem do aparelho; "Desfazer" volta atrás.

export function AvisoOrigem({
  estado,
  lojaNome,
  documento,
  whatsapp,
  contato,
  ferramenta,
  accent,
  onRecusar,
  onDesfazer,
}: {
  estado: 'aviso' | 'recusado';
  lojaNome: string;
  documento?: string | null;
  whatsapp?: string | null;
  contato?: string | null;
  ferramenta: string | null;
  accent: string;
  onRecusar: () => void;
  onDesfazer: () => void;
}) {
  const [aberto, setAberto] = useState(false);
  const gatilho = useRef<HTMLButtonElement>(null);
  const fechar = () => {
    setAberto(false);
    gatilho.current?.focus();
  };

  if (estado === 'recusado') {
    return (
      <div role="status" className="mt-4 flex gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs text-neutral-700">
        <Check aria-hidden className="mt-0.5 h-4 w-4 flex-none text-emerald-700" />
        <div className="min-w-0">
          <p>Pronto: este pedido vai sem esse registro.</p>
          <button type="button" onClick={onDesfazer} className="mt-1 font-semibold text-neutral-900 underline underline-offset-2">
            Desfazer
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-4 flex gap-2 rounded-xl border border-neutral-200 bg-neutral-50 p-3 text-xs text-neutral-700">
      <Link2 aria-hidden className="mt-0.5 h-4 w-4 flex-none text-neutral-500" />
      <div className="min-w-0">
        <p>A loja registra por qual anúncio ou link você chegou.</p>
        <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
          <button
            ref={gatilho}
            type="button"
            onClick={() => setAberto(true)}
            aria-haspopup="dialog"
            aria-expanded={aberto}
            className="font-semibold text-neutral-900 underline underline-offset-2"
          >
            Saiba mais
          </button>
          <button type="button" onClick={onRecusar} className="font-semibold text-neutral-900 underline underline-offset-2">
            Não registrar
          </button>
        </div>
      </div>
      {aberto && (
        <SaibaMaisOrigem
          lojaNome={lojaNome}
          documento={documento}
          whatsapp={whatsapp}
          contato={contato}
          ferramenta={ferramenta}
          accent={accent}
          onRecusar={() => {
            setAberto(false);
            onRecusar();
          }}
          onFechar={fechar}
        />
      )}
    </div>
  );
}
