'use client';

import { useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';

// Confirmação de revogar um aplicativo (numa loja ou em todas). O foco abre no "Manter" (a ação
// segura), o Esc fecha, e quem chamou devolve o foco ao botão que abriu.
export function DialogoRevogar({
  app,
  leitura = 'os dados',
  loja,
  revogando,
  aoManter,
  aoRevogar,
}: {
  app: string;
  /** O que o aplicativo lê, como a frase diz ("os pedidos", "os dados"). */
  leitura?: string;
  /** Nome da loja; `null` = todas as lojas (ou a empresa inteira). */
  loja: string | null;
  revogando: boolean;
  aoManter: () => void;
  aoRevogar: () => void;
}) {
  const manter = useRef<HTMLButtonElement>(null);
  const fechar = useRef(aoManter);
  fechar.current = aoManter;
  useEffect(() => {
    manter.current?.focus();
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') fechar.current();
    };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, []);

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4" onClick={aoManter}>
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="revogar-titulo"
        aria-describedby="revogar-texto"
        className="w-full max-w-md space-y-3 rounded-xl bg-card p-5 text-foreground shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="revogar-titulo" className="font-display text-lg font-extrabold">
          {loja ? `Revogar o ${app} na ${loja}?` : `Revogar o ${app} em todas as lojas?`}
        </h2>
        <p id="revogar-texto" className="text-sm text-secondary-foreground">
          O {app} para de ler {leitura} {loja ? 'desta loja' : 'de todas as lojas'} agora. O que ele já leu segue o prazo de
          guarda de lá. Para voltar, é preciso autorizar de novo pelo {app}.
        </p>
        <div className="flex flex-wrap justify-end gap-2 pt-1">
          <Button ref={manter} type="button" variant="outline" onClick={aoManter} disabled={revogando}>
            Manter
          </Button>
          <Button type="button" variant="destructive" onClick={aoRevogar} disabled={revogando}>
            {revogando ? 'Revogando…' : 'Revogar'}
          </Button>
        </div>
      </div>
    </div>
  );
}
