'use client';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Selo, texto2 } from '@/components/ui/lista';
import {
  A_FAZER, EM_PRODUCAO, ENCERRADA, STATUS_TOM, apoioDe, fichaDe, grupoDe, podeCancelar, podeConcluir, podeIniciar, podeLiberar, quandoDe, rotuloDe, situacaoDe,
} from './ordem';

/* eslint-disable @typescript-eslint/no-explicit-any */
const COLUNAS: [string, number][] = [['A fazer', A_FAZER], ['Em produção', EM_PRODUCAO], ['Encerradas', ENCERRADA]];
/** Quantas encerradas o quadro mostra: ele é a tela do que está acontecendo — o resto fica na lista. */
const MAX_ENCERRADAS = 12;

// O quadro de três colunas (também usado na cozinha como painel da produção interna): as mesmas
// ações da lista, em cartões. As pendências de lançamento não têm coluna aqui — ficam na lista.
export function QuadroOrdens({
  ordens, gestao, agindo, aoLiberar, aoIniciar, aoConcluir, aoCancelar,
}: {
  ordens: any[];
  gestao: boolean;
  agindo: string | null;
  aoLiberar: (o: any) => void;
  aoIniciar: (o: any) => void;
  aoConcluir: (o: any) => void;
  aoCancelar: (o: any) => void;
}) {
  return (
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
      {COLUNAS.map(([titulo, grupo]) => {
        const todas = ordens.filter((o) => grupoDe(o) === grupo);
        const lista = grupo === ENCERRADA ? todas.slice(0, MAX_ENCERRADAS) : todas;
        return (
          <Card key={titulo} className="space-y-2 p-3">
            <h3 className="flex items-center justify-between gap-2 font-display text-base font-bold">
              {titulo} <span className="rounded-full bg-secondary px-2 py-px font-mono text-xs">{todas.length}</span>
            </h3>
            {!lista.length && <p className={`text-sm ${texto2}`}>Nenhuma ordem aqui.</p>}
            <ul className="space-y-2" aria-label={titulo}>
              {lista.map((o) => (
                <li key={o.id} className="space-y-2 rounded-md border border-border p-2.5 text-sm">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="break-words font-bold">{fichaDe(o)}</p>
                      <p className={`text-xs ${texto2}`}>
                        {[apoioDe(o), quandoDe(o), o.setorNome, o.colaboradorNome].filter(Boolean).join(' · ')}
                      </p>
                    </div>
                    <Selo tom={STATUS_TOM[o.status] ?? 'neutro'}>{situacaoDe(o).toLowerCase()}</Selo>
                  </div>
                  {grupo !== ENCERRADA && (
                    <div className="flex flex-wrap gap-1.5">
                      {podeLiberar(o) && <Button type="button" size="sm" variant="outline" disabled={agindo === o.id} aria-label={`Liberar: ${rotuloDe(o)}`} onClick={() => aoLiberar(o)}>Liberar</Button>}
                      {podeIniciar(o) && <Button type="button" size="sm" variant="outline" disabled={agindo === o.id} aria-label={`Iniciar: ${rotuloDe(o)}`} onClick={() => aoIniciar(o)}>Iniciar</Button>}
                      {podeConcluir(o) && <Button type="button" size="sm" disabled={agindo === o.id} aria-label={`Concluir: ${rotuloDe(o)}`} onClick={() => aoConcluir(o)}>Concluir</Button>}
                      {gestao && podeCancelar(o) && <Button type="button" size="sm" variant="ghost" disabled={agindo === o.id} aria-label={`Cancelar: ${rotuloDe(o)}`} onClick={() => aoCancelar(o)}>Cancelar</Button>}
                    </div>
                  )}
                </li>
              ))}
            </ul>
            {todas.length > lista.length && <p className={`text-xs ${texto2}`}>E mais {todas.length - lista.length} — todas estão na parte “Ordens”, situação “Encerradas”.</p>}
          </Card>
        );
      })}
    </div>
  );
}
