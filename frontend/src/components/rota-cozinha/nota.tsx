import { cn } from '@/lib/utils';

const TOM = {
  info: 'border-info bg-info/10',
  aviso: 'border-warn bg-warn/15',
  critico: 'border-destructive bg-destructive/10',
  neutro: 'border-secondary-foreground/40 bg-secondary',
} as const;

/** Uma nota da Rota da cozinha: faixa com a borda da cor do tom, o texto em tinta (contraste) e uma ação opcional. */
export function Nota({ tom = 'info', children, acao }: { tom?: keyof typeof TOM; children: React.ReactNode; acao?: React.ReactNode }) {
  return (
    <div className={cn('flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg border-l-4 px-3 py-2.5 text-sm text-foreground', TOM[tom])}>
      <span className="min-w-0 flex-[1_1_260px] [overflow-wrap:anywhere]">{children}</span>
      {acao}
    </div>
  );
}
