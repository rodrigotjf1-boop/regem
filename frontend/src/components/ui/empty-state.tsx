import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * Estado vazio padrão: ícone + título + descrição + ação opcional.
 * `icon` aceita um emoji/nó (ex.: '📦') ou um ícone; a ação é livre
 * (normalmente um <Button>). Tokens do design system, sem cor crua.
 */
export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: React.ReactNode;
  title: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center rounded-lg border border-dashed border-border bg-card px-6 py-12 text-center',
        className,
      )}
    >
      {icon != null && (
        <div className="mb-3 grid h-12 w-12 place-items-center rounded-full bg-muted text-2xl text-muted-foreground">
          {icon}
        </div>
      )}
      <p className="font-display text-base font-bold text-foreground">{title}</p>
      {description && (
        <p className="mt-1 max-w-sm text-sm text-muted-foreground">{description}</p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
