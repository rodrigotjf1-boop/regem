'use client';

import { Shell } from '@/components/app-shell/shell';
import { PontoCard } from '@/components/ponto/ponto-card';

// "Meu ponto" — página do colaborador só com o registro de ponto (a marcação).
// As tarefas ficam no menu "Tarefas" (separado).
export default function MeuPontoPage() {
  return (
    <Shell eyebrow="Operação diária" title="Meu ponto">
      <div className="max-w-2xl">
        <PontoCard />
      </div>
    </Shell>
  );
}
