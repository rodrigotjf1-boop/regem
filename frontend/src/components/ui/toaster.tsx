'use client';

import { useEffect, useState } from 'react';
import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react';
import { subscribe, dismiss, type ToastItem, type ToastType } from '@/lib/toast';

// Espelha para o lado OPOSTO à sidebar — nunca nasce sob o polegar que navega.
function ladoOposto(): 'left' | 'right' {
  if (typeof window === 'undefined') return 'right';
  try {
    const p = JSON.parse(localStorage.getItem('regem_ui') || '{}');
    return p.side === 'right' ? 'left' : 'right';
  } catch {
    return 'right';
  }
}

const ICON = { success: CheckCircle2, error: AlertCircle, info: Info };
const COR: Record<ToastType, string> = {
  success: 'var(--ok)',
  error: 'var(--destructive)',
  info: 'var(--info)',
};

export function Toaster() {
  const [items, setItems] = useState<ToastItem[]>([]);
  const [lado, setLado] = useState<'left' | 'right'>('right');

  useEffect(() => {
    setLado(ladoOposto());
    return subscribe(setItems);
  }, []);

  if (items.length === 0) return null;

  return (
    <div
      className={`app-light pointer-events-none fixed bottom-0 z-[100] flex w-full max-w-sm flex-col gap-2 p-4 ${
        lado === 'left' ? 'left-0 items-start' : 'right-0 items-end'
      }`}
      aria-live="polite"
      aria-atomic="false"
    >
      {items.map((t) => {
        const Icon = ICON[t.type];
        return (
          <div
            key={t.id}
            role="status"
            className="pointer-events-auto flex w-full items-start gap-2.5 rounded-xl border border-border bg-card p-3 shadow-lg"
            style={{ borderLeft: `3px solid hsl(${COR[t.type]})` }}
          >
            <Icon className="mt-0.5 h-5 w-5 flex-none" style={{ color: `hsl(${COR[t.type]})` }} />
            <p className="min-w-0 flex-1 text-sm text-foreground">{t.msg}</p>
            <button
              type="button"
              onClick={() => dismiss(t.id)}
              aria-label="Fechar aviso"
              className="flex-none text-muted-foreground hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
