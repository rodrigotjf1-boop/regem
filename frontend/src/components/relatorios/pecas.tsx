'use client';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { texto2 } from '@/components/ui/lista';

// Peças pequenas das telas do menu Relatórios (mockup `mockups/regem-relatorios.html`).

/** Indicadores do período: rótulo, número e uma linha de apoio. */
export function Indicadores({ itens }: { itens: ({ rotulo: string; valor: React.ReactNode; apoio?: string } | null | false | undefined)[] }) {
  const lista = itens.filter((x): x is { rotulo: string; valor: React.ReactNode; apoio?: string } => !!x);
  if (!lista.length) return null;
  return (
    <dl className="grid grid-cols-2 gap-2 lg:grid-cols-[repeat(auto-fit,minmax(170px,1fr))]">
      {lista.map((k) => (
        <div key={k.rotulo} className="min-w-0 rounded-md border border-border bg-card p-3">
          <dt className={`text-xs font-bold ${texto2}`}>{k.rotulo}</dt>
          <dd className="break-words font-mono text-xl font-semibold">{k.valor}</dd>
          {k.apoio && <dd className={`text-xs ${texto2}`}>{k.apoio}</dd>}
        </div>
      ))}
    </dl>
  );
}

/** A leitura falhou: diz o que não veio e oferece tentar de novo — falha nunca vira lista vazia. */
export function ErroDeLeitura({ oQue, motivo, aoTentar, ocupado = false }: { oQue: string; motivo: string; aoTentar: () => void; ocupado?: boolean }) {
  return (
    <Card className="space-y-3 border-l-4 border-l-destructive p-5 text-sm">
      <p role="alert">
        <span className="font-bold">Não foi possível carregar {oQue}.</span> {motivo}
      </p>
      <Button type="button" variant="outline" size="sm" onClick={aoTentar} disabled={ocupado}>
        {ocupado ? 'Tentando…' : 'Tentar de novo'}
      </Button>
    </Card>
  );
}

/** O servidor devolve no máximo `limite` linhas: quando a lista bate no teto, a tela avisa. */
export function AvisoDeLimite({ linhas, limite, oQue }: { linhas: number; limite: number; oQue: string }) {
  if (linhas < limite) return null;
  return (
    <p className="rounded-md border-l-4 border-l-warn bg-warn/10 px-3 py-2 text-sm" role="status">
      A lista mostra {oQue} mais recentes do período ({limite}). Para ver o que veio antes, escolha um período menor.
    </p>
  );
}
