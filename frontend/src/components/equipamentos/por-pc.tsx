'use client';

import { Card } from '@/components/ui/card';
import { Selo, type Acao } from '@/components/ui/lista';
import { conexaoDe, ligacaoDe, seloDe, tipoDe, type GrupoPc } from './equipamento';

/* eslint-disable @typescript-eslint/no-explicit-any */

// Equipamentos "Por PC" (conexão PC ↔ servidor, protótipo aprovado em 20/10/2026, peça 3): o terminal, a
// estação e as impressoras do mesmo PC juntos, com "conectado agora" de verdade. A lista de sempre continua
// (o seletor "Lista | Por PC" fica na página); as ações de cada aparelho são as mesmas da lista.

export function EquipamentosPorPc({
  grupos,
  estado,
  todos,
  acoes,
}: {
  grupos: GrupoPc[];
  estado: Record<string, any>;
  todos: any[];
  acoes: (e: any) => Acao<any>[];
}) {
  // Estação que nunca conectou com outra já no ar: quase sempre é a que sobrou de um código que não
  // teve onde ser digitado (18/10/2026, o "PC do delivery").
  const estacoesNoAr = todos.filter((x) => x.tipo === 'estacao_impressao' && x.ativo && (x.presenca?.vistoEm || x.estacao?.vistoEm));
  const sobrou = (e: any) =>
    e.tipo === 'estacao_impressao' && e.ativo && !e.pareado && !e.presenca && !e.estacao?.vistoEm && estacoesNoAr.length > 0;

  return (
    <div className="space-y-3">
      {grupos.map((g) => (
        <Card key={g.chave} className="overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-secondary px-3 py-2.5">
            <div className="min-w-0">
              <h3 className="break-words font-display text-base font-bold">{g.titulo}</h3>
              <p className="break-words text-xs text-secondary-foreground">{g.apoio}</p>
            </div>
            {g.selo && <Selo tom={g.selo.tom}>{g.selo.rotulo}</Selo>}
          </div>
          <ul className="divide-y divide-border">
            {g.itens.map((e) => {
              const s = seloDe(e, estado, todos);
              const lista = acoes(e);
              const ligacao = e.tipo === 'impressora' || e.tipo === 'pdv' || e.tipo === 'salao' ? ligacaoDe(e, todos) : '';
              return (
                <li key={e.id} className="grid grid-cols-1 gap-2 px-3 py-2.5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                  <div className="min-w-0">
                    <p className="text-[11px] font-bold uppercase tracking-wide text-secondary-foreground">{tipoDe(e)}</p>
                    <p className="break-words font-semibold">{e.nome}</p>
                    <p className="break-words text-xs text-secondary-foreground">
                      {[conexaoDe(e, estado), ligacao].filter((x) => x && x !== '—').join(' · ') || '—'}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                    <Selo tom={s.tom}>{s.rotulo}</Selo>
                    {lista.map((a) => {
                      const Icone = a.icone;
                      return (
                        <button
                          key={a.rotulo}
                          type="button"
                          aria-label={`${a.rotulo}: ${e.nome}`}
                          disabled={a.ocupada?.(e)}
                          onClick={() => a.aoClicar(e)}
                          className={`inline-flex min-h-9 items-center gap-1.5 whitespace-nowrap rounded-md border px-2.5 text-xs font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 ${
                            a.tom === 'perigo' ? 'border-input hover:border-destructive hover:bg-destructive/10' : 'border-input hover:bg-secondary'
                          }`}
                        >
                          <Icone className="h-4 w-4" aria-hidden="true" />
                          {a.rotulo}
                        </button>
                      );
                    })}
                  </div>
                  {sobrou(e) && (
                    <p className="rounded-md bg-warn/10 px-3 py-2 text-xs sm:col-span-2">
                      Já há estação ligada ({estacoesNoAr.map((x) => x.nome).join(', ')}). Se esta foi criada para o mesmo PC, ela sobrou:
                      pode revogar.
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        </Card>
      ))}
    </div>
  );
}
