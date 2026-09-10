'use client';

import { Input } from './input';

/**
 * Campo em formato de MOEDA (BRL). Digita em centavos (1234 → R$ 12,34) e devolve
 * o valor como string decimal ("12.34"); vazio devolve "". Prefixo "R$" fixo.
 */
export function InputMoeda({
  value,
  onChange,
  disabled,
  placeholder,
  className,
  ariaLabel,
}: {
  value: string | number | null | undefined;
  onChange: (v: string) => void;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
  ariaLabel?: string;
}) {
  const display =
    value === '' || value == null || Number.isNaN(Number(value))
      ? ''
      : Number(value).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  function handle(e: React.ChangeEvent<HTMLInputElement>) {
    const digits = e.target.value.replace(/\D/g, '');
    if (!digits) return onChange('');
    onChange((Number(digits) / 100).toFixed(2));
  }
  return (
    <div className={`relative ${className ?? ''}`}>
      <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">R$</span>
      <Input
        inputMode="numeric"
        value={display}
        onChange={handle}
        disabled={disabled}
        placeholder={placeholder ?? '0,00'}
        aria-label={ariaLabel}
        className="pl-8 text-right"
      />
    </div>
  );
}
