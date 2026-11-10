'use client';

import { useId, useRef } from 'react';
import { Button } from '@/components/ui/button';

const CAMPOS = [
  { campo: '{nome}', ajuda: 'o primeiro nome do cliente (sem nome, some)' },
  { campo: '{motivo}', ajuda: 'a frase do motivo escolhido ao pausar' },
  { campo: '{volta}', ajuda: 'a hora de reabrir ("às 21:40")' },
];

/**
 * O texto da mensagem pronta da pausa (F3, mig 394; protótipo `mockups/regem-pausa.html`, vista "Ajustes"): o campo, os
 * botões que põem {nome} {motivo} {volta} onde está o cursor, "Voltar ao texto padrão" e a contagem de letras.
 */
export function CampoDaMensagemDaPausa({
  valor,
  mudar,
  padrao,
  maximo,
}: {
  valor: string;
  mudar: (v: string) => void;
  padrao: string;
  maximo: number;
}) {
  const id = useId();
  const ref = useRef<HTMLTextAreaElement>(null);
  const por = (campo: string) => {
    const el = ref.current;
    const ini = el?.selectionStart ?? valor.length;
    const fim = el?.selectionEnd ?? valor.length;
    const novo = `${valor.slice(0, ini)}${campo}${valor.slice(fim)}`.slice(0, maximo);
    mudar(novo);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(ini + campo.length, ini + campo.length);
    });
  };
  return (
    <div className="w-full min-w-0 space-y-2">
      <label htmlFor={id} className="sr-only">
        Mensagem da pausa
      </label>
      <textarea
        id={id}
        ref={ref}
        rows={9}
        value={valor}
        maxLength={maximo}
        onChange={(e) => mudar(e.target.value)}
        className="w-full rounded-md border border-input bg-card px-3 py-2 font-sans text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
      <div className="flex flex-wrap items-center gap-2">
        {CAMPOS.map((c) => (
          <Button key={c.campo} type="button" size="sm" variant="outline" className="font-mono" title={c.ajuda} onClick={() => por(c.campo)}>
            {c.campo}
          </Button>
        ))}
        <Button type="button" size="sm" variant="outline" disabled={valor === padrao} onClick={() => mudar(padrao)}>
          Voltar ao texto padrão
        </Button>
        <span className="ml-auto font-mono text-xs text-muted-foreground">
          {valor.length}/{maximo}
        </span>
      </div>
    </div>
  );
}
