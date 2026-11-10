import { avisoDaPausa, trechosComDestaque } from '@/lib/pausa-dos-pedidos';

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
