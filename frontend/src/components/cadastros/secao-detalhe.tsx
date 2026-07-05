'use client';

import { ArrowLeft } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { EntityForm } from '@/components/cadastros/entity-form';
import { type Secao } from '@/components/cadastros/build-secoes';

// Detalhe de uma seção: formulário de cadastro + lista dos itens já cadastrados.
export function SecaoDetalhe({
  sec,
  ver,
  onBack,
  reload,
}: {
  sec: Secao;
  ver: number;
  onBack: () => void;
  reload: () => Promise<void>;
}) {
  return (
    <div className="space-y-4">
      <button
        type="button"
        onClick={onBack}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> Cadastros
      </button>

      <Card className="p-4">
        <h2 className="mb-3 font-display text-lg font-semibold">
          {sec.titulo}
        </h2>
        <EntityForm
          key={`${sec.key}-${ver}`}
          fields={sec.fields}
          submitLabel="Adicionar"
          onSubmit={async (v) => {
            await sec.submit(v);
            await reload();
          }}
        />
      </Card>

      {sec.itens.length > 0 && (
        <Card className="p-4">
          <p className="mb-2 text-sm font-medium text-muted-foreground">
            Cadastrados ({sec.itens.length})
          </p>
          <div className="flex flex-wrap gap-1.5">
            {sec.itens.map((n: string, i: number) => (
              <span
                key={i}
                className="rounded-md bg-secondary px-2 py-1 text-xs text-secondary-foreground"
              >
                {n}
              </span>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
