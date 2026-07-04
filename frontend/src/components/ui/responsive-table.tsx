'use client';

import * as React from 'react';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';

/* eslint-disable @typescript-eslint/no-explicit-any */

export type Column<T> = {
  key: string;
  header: string;
  render?: (row: T) => React.ReactNode;
  align?: 'left' | 'right' | 'center';
  sticky?: boolean; // 1ª coluna fixa na variante de scroll
  hideOnCard?: boolean; // não repetir no card (ex.: a coluna que já é o título)
  mono?: boolean;
  className?: string;
};

const alinhamento = {
  left: 'text-left',
  right: 'text-right',
  center: 'text-center',
} as const;

function valor<T>(col: Column<T>, row: T): React.ReactNode {
  return col.render ? col.render(row) : (row as any)[col.key];
}

function Cabecalho({ title, subtitle }: { title?: string; subtitle?: string }) {
  if (!title && !subtitle) return null;
  return (
    <div className="border-b border-border px-5 py-3.5">
      {title && <p className="font-display text-sm font-bold">{title}</p>}
      {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
    </div>
  );
}

/**
 * Tabela responsiva: `<table>` acessível (num Card) ≥700px, lista de cards
 * (rótulo/valor) abaixo. Suporta coluna de ações, células customizadas
 * (status/Tag via `render`) e a variante 'scroll-sticky' (rolagem horizontal
 * com 1ª coluna fixa) para tabelas densas de leitura.
 */
export function ResponsiveTable<T>({
  caption,
  columns,
  rows,
  rowKey,
  title,
  subtitle,
  empty = 'Nada por aqui.',
  loading = false,
  variant = 'default',
  cardTitle,
  actions,
  onRowClick,
}: {
  caption: string;
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  title?: string;
  subtitle?: string;
  empty?: React.ReactNode;
  loading?: boolean;
  variant?: 'default' | 'scroll-sticky';
  cardTitle?: (row: T) => React.ReactNode;
  actions?: (row: T) => React.ReactNode;
  onRowClick?: (row: T) => void;
}) {
  const vazio = !loading && rows.length === 0;
  const tituloCard = (row: T) =>
    cardTitle ? cardTitle(row) : valor(columns[0], row);
  const colsCard = columns.filter((c, i) => i !== 0 && !c.hideOnCard);
  const nCols = columns.length + (actions ? 1 : 0);

  return (
    <>
      {/* Tabela (≥700px) */}
      <Card className="hidden p-0 min-[700px]:block">
        <Cabecalho title={title} subtitle={subtitle} />
        <div className={variant === 'scroll-sticky' ? 'overflow-x-auto' : ''}>
          <table className="w-full text-sm">
            <caption className="sr-only">{caption}</caption>
            <thead>
              <tr className="border-b border-border text-left">
                {columns.map((c) => (
                  <th
                    key={c.key}
                    className={cn(
                      'whitespace-nowrap px-4 py-2.5 font-display text-[10px] font-bold uppercase tracking-[.1em] text-muted-foreground',
                      c.align && alinhamento[c.align],
                      c.sticky &&
                        variant === 'scroll-sticky' &&
                        'sticky left-0 z-10 bg-card',
                    )}
                  >
                    {c.header}
                  </th>
                ))}
                {actions && (
                  <th className="px-4 py-2.5">
                    <span className="sr-only">Ações</span>
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={nCols} className="px-4 py-6 text-center text-muted-foreground">
                    Carregando…
                  </td>
                </tr>
              )}
              {vazio && (
                <tr>
                  <td colSpan={nCols} className="px-4 py-8 text-center text-muted-foreground">
                    {empty}
                  </td>
                </tr>
              )}
              {rows.map((row) => (
                <tr
                  key={rowKey(row)}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  className={cn(
                    'border-b border-border last:border-0',
                    onRowClick && 'cursor-pointer hover:bg-muted/40',
                  )}
                >
                  {columns.map((c) => (
                    <td
                      key={c.key}
                      className={cn(
                        'px-4 py-3 align-middle',
                        c.align && alinhamento[c.align],
                        c.mono && 'font-mono text-xs',
                        c.sticky &&
                          variant === 'scroll-sticky' &&
                          'sticky left-0 z-10 bg-card',
                        c.className,
                      )}
                    >
                      {valor(c, row)}
                    </td>
                  ))}
                  {actions && (
                    <td className="whitespace-nowrap px-4 py-3 text-right">
                      {actions(row)}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Cards (<700px) */}
      <div className="min-[700px]:hidden">
        {(title || subtitle) && (
          <div className="mb-2 px-1">
            {title && <p className="font-display text-sm font-bold">{title}</p>}
            {subtitle && (
              <p className="text-xs text-muted-foreground">{subtitle}</p>
            )}
          </div>
        )}
        {loading && (
          <Card className="p-6 text-center text-sm text-muted-foreground">
            Carregando…
          </Card>
        )}
        {vazio && (
          <Card className="p-8 text-center text-sm text-muted-foreground">
            {empty}
          </Card>
        )}
        <div className="space-y-2">
          {rows.map((row) => (
            <Card
              key={rowKey(row)}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              className={cn(
                'p-3.5',
                onRowClick && 'min-h-[44px] cursor-pointer active:bg-muted/40',
              )}
            >
              <div className="font-medium">{tituloCard(row)}</div>
              <dl className="mt-2 grid grid-cols-[auto_1fr] items-baseline gap-x-3 gap-y-1.5 text-sm">
                {colsCard.map((c) => (
                  <React.Fragment key={c.key}>
                    <dt className="text-xs text-muted-foreground">{c.header}</dt>
                    <dd
                      className={cn(
                        'text-right',
                        c.mono && 'font-mono text-xs',
                        c.align === 'left' && 'text-left',
                      )}
                    >
                      {valor(c, row)}
                    </dd>
                  </React.Fragment>
                ))}
              </dl>
              {actions && (
                <div className="mt-2.5 flex flex-wrap justify-end gap-2">
                  {actions(row)}
                </div>
              )}
            </Card>
          ))}
        </div>
      </div>
    </>
  );
}
