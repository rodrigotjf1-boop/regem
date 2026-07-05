import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

// Skeleton do hub de cadastros (grid de cards) enquanto as listas carregam.
export function CadastrosSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: 6 }).map((_, i) => (
        <Card key={i} className="flex items-center gap-3 p-4">
          <Skeleton className="h-10 w-10 flex-none rounded-xl" />
          <div className="min-w-0 flex-1">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="mt-2 h-3 w-1/2" />
          </div>
          <Skeleton className="h-8 w-8 flex-none rounded-lg" />
        </Card>
      ))}
    </div>
  );
}
