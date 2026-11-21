'use client';

import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import type { AlvoDoCodigo, CodigosPdv } from '@/components/produtos/use-codigos-pdv';

// O campo do código PDV na linha da lista. O motivo de uma recusa aparece na barra de salvar, que fica sempre à vista
// (a linha pode estar em outra aba); aqui o campo só fica marcado.
export function CampoCodigoPdv({ codigos, alvo, className }: { codigos: CodigosPdv; alvo: AlvoDoCodigo; className?: string }) {
  const recusa = codigos.recusa(alvo);
  const mudou = codigos.mudou(alvo);
  return (
    <Input
      aria-label={`Código PDV de ${alvo.nome}`}
      aria-invalid={recusa ? true : undefined}
      title={recusa || undefined}
      value={codigos.valor(alvo)}
      onChange={(e) => codigos.mudar(alvo, e.target.value)}
      maxLength={60}
      placeholder="sem código"
      autoComplete="off"
      spellCheck={false}
      disabled={codigos.salvando}
      data-codigo-pdv={`${alvo.tipo}:${alvo.id}`}
      className={cn(
        'h-9 px-2 font-mono text-xs',
        mudou && 'border-primary bg-primary/10',
        recusa && 'border-destructive bg-destructive/10',
        className,
      )}
    />
  );
}
