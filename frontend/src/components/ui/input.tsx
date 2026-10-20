import * as React from 'react';
import { cn } from '@/lib/utils';
import { autoCompleteDoCampo } from '@/lib/senha-sem-preencher';

const Input = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(({ className, type, autoComplete, ...props }, ref) => (
  <input
    type={type}
    // Campo de senha: o navegador não preenche sozinho (PC compartilhado da loja).
    autoComplete={autoCompleteDoCampo(type, autoComplete)}
    ref={ref}
    className={cn(
      'flex h-11 w-full rounded-md border border-input bg-card px-3 py-2 text-base placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50',
      className,
    )}
    {...props}
  />
));
Input.displayName = 'Input';

export { Input };
