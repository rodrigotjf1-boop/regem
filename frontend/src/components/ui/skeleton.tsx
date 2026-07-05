import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * Placeholder de carregamento no formato do conteúdo real. Usa `bg-muted` +
 * `animate-pulse` (respeita prefers-reduced-motion via tailwindcss-animate).
 */
function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      aria-hidden
      className={cn('animate-pulse rounded-md bg-muted', className)}
      {...props}
    />
  );
}

/** Linha de texto (largura relativa opcional). */
function SkeletonText({ className }: { className?: string }) {
  return <Skeleton className={cn('h-4 w-full', className)} />;
}

/** Bloco de card no formato de item de lista (título + 2 linhas). */
function SkeletonCard({ className }: { className?: string }) {
  return (
    <div className={cn('rounded-lg border border-border bg-card p-4', className)}>
      <Skeleton className="h-4 w-1/3" />
      <Skeleton className="mt-3 h-3 w-2/3" />
      <Skeleton className="mt-2 h-3 w-1/2" />
    </div>
  );
}

/** N cards empilhados — atalho para listas em carregamento. */
function SkeletonList({ rows = 4, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn('space-y-2', className)} role="status" aria-label="Carregando…">
      {Array.from({ length: rows }).map((_, i) => (
        <SkeletonCard key={i} />
      ))}
    </div>
  );
}

export { Skeleton, SkeletonText, SkeletonCard, SkeletonList };
