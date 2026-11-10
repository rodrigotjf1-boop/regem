'use client';

import { useEffect, useState } from 'react';
import { avisoDaPausa, relogioDaPausa, segundosAte, trechosComDestaque } from '@/lib/pausa-dos-pedidos';

/**
 * O tempo que falta até reabrir ("12:34"), andando a cada segundo (F2). Nada no primeiro desenho: a hora só existe no
 * navegador (V35). Some quando chega a zero.
 */
export function ContadorDaPausa({
  ate,
  className,
  texto = (r) => r,
}: {
  ate: string;
  className?: string;
  /** Como escrever o tempo ("12:34" por padrão; o cardápio escreve "(faltam 12:34)"). */
  texto?: (relogio: string) => string;
}) {
  const [agora, setAgora] = useState<number | null>(null);
  useEffect(() => {
    setAgora(Date.now());
    const t = setInterval(() => setAgora(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  if (agora == null) return null;
  const seg = segundosAte(ate, agora);
  if (!seg) return null;
  return (
    <span className={className} aria-label={`faltam ${relogioDaPausa(seg)} para reabrir`}>
      {texto(relogioDaPausa(seg))}
    </span>
  );
}

/**
 * Texto com o destaque do WhatsApp (`*assim*`) em negrito. `<strong>`, não `<b>`: no cardápio online o `<b>` do aviso é
 * o título (`.p-aviso b{display:block}`) — o destaque virava uma segunda linha de título.
 */
export function ComDestaque({ texto }: { texto: string }) {
  return (
    <>
      {trechosComDestaque(texto).map((t, i) =>
        t.destaque ? <strong key={i} className="font-bold">{t.texto}</strong> : <span key={i}>{t.texto}</span>,
      )}
    </>
  );
}

/**
 * O aviso da pausa como o cliente lê no cardápio online (mig 392) — a prévia do "⏸ Pausar" usa este mesmo. As cores vêm
 * de quem o põe na tela (o cardápio tem o tema da loja; o painel, o do Regem).
 */
export function AvisoDaPausa({ frase, volta, className }: { frase: string; volta: { texto: string }; className?: string }) {
  const a = avisoDaPausa({ frase, volta });
  return (
    <div className={className}>
      <p className="font-display text-base font-bold">{a.titulo}</p>
      <p className="mt-1 text-sm">
        <ComDestaque texto={a.motivo} />
      </p>
      <p className="mt-2 text-sm font-semibold">{a.volta}</p>
      <p className="mt-1 text-sm">{a.rodape}</p>
    </div>
  );
}
