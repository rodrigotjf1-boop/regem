import { cn } from '@/lib/utils';

// Selo do aplicativo conectado (a inicial na cor da marca DELE — por isso a cor não é token do
// Regem, como os logotipos de `public/integracoes`). Aplicativo sem selo próprio cai no neutro.
const SELOS: Record<string, { letra: string; classe: string }> = {
  liame: { letra: 'L', classe: 'bg-[#7B61FF] text-white' },
  regemcast: { letra: 'C', classe: 'bg-foreground text-primary' },
};

export function SeloApp({ cliente, rotulo, pequeno = false }: { cliente: string; rotulo: string; pequeno?: boolean }) {
  const s = SELOS[cliente] ?? { letra: rotulo.slice(0, 1).toUpperCase(), classe: 'bg-secondary text-foreground' };
  return (
    <span
      role="img"
      aria-label={rotulo}
      className={cn(
        'grid flex-none place-items-center font-display font-extrabold',
        pequeno ? 'h-8 w-8 rounded-lg text-sm' : 'h-11 w-11 rounded-xl text-xl',
        s.classe,
      )}
    >
      {s.letra}
    </span>
  );
}
