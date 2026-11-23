'use client';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Selo, texto2, useModoDaLista, useTelaLarga } from '@/components/ui/lista';
import { NOME_DA_FONTE, apoioDoLancamento, comSinal, diaCurto, situacaoDe, type Lancamento } from '@/lib/banco-repasses';

// A lista de lançamentos: tabela quando cabe no espaço da peça, cartões quando não cabe. Nunca rola para o lado (V45).
const corDoValor = (v: number) => (v > 0 ? 'text-ok' : 'text-foreground');

function IssoE({ l, rotulo }: { l: Lancamento; rotulo: (t: string | null) => string }) {
  return l.tipo ? <>{rotulo(l.tipo)}</> : <Selo tom="aviso">Falta dizer</Selo>;
}

export function ListaDeLancamentos({
  linhas,
  rotuloDoTipo,
  aoAbrir,
}: {
  linhas: Lancamento[];
  rotuloDoTipo: (t: string | null) => string;
  aoAbrir: (l: Lancamento) => void;
}) {
  const larga = useTelaLarga();
  const { caixa, modo } = useModoDaLista('banco-lancamentos');
  const abrir = (l: Lancamento) => `Abrir o lançamento de ${diaCurto(l.data)}, ${comSinal(l.valor)}`;

  if (larga && modo < 2)
    return (
      <div ref={caixa} className="min-w-0">
        <Card className="relative overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <caption className="sr-only">Lançamentos do banco e repasses</caption>
            <thead>
              <tr className={`border-b border-border bg-secondary text-left text-xs uppercase tracking-wide ${texto2}`}>
                <th scope="col" className="px-3 py-2.5 font-bold">Data</th>
                <th scope="col" className="px-3 py-2.5 font-bold">Descrição</th>
                <th scope="col" className="px-3 py-2.5 font-bold">Isso é</th>
                <th scope="col" className="px-3 py-2.5 font-bold">Fonte</th>
                <th scope="col" className="px-3 py-2.5 font-bold">Situação</th>
                <th scope="col" className="px-3 py-2.5 text-right font-bold">Valor</th>
                <th scope="col" className="px-3 py-2.5"><span className="sr-only">Ações</span></th>
              </tr>
            </thead>
            <tbody>
              {linhas.map((l) => {
                const s = situacaoDe(l.situacao);
                const apoio = apoioDoLancamento(l);
                return (
                  <tr key={l.id} className="border-b border-border last:border-b-0 hover:bg-secondary/60">
                    <td className="whitespace-nowrap px-3 py-2.5 align-top font-mono text-[13px]">{diaCurto(l.data)}</td>
                    <td className="min-w-[190px] px-3 py-2.5 align-top">
                      <span className="block break-words font-semibold">{l.descricao}</span>
                      {apoio && <span className={`block text-xs ${texto2}`}>{apoio}</span>}
                    </td>
                    <td className="px-3 py-2.5 align-top"><IssoE l={l} rotulo={rotuloDoTipo} /></td>
                    <td className="whitespace-nowrap px-3 py-2.5 align-top">{NOME_DA_FONTE[l.fonte]}</td>
                    <td className="px-3 py-2.5 align-top"><Selo tom={s.tom}>{s.rotulo}</Selo></td>
                    <td className={`whitespace-nowrap px-3 py-2.5 text-right align-top font-mono text-[13.5px] font-bold tabular-nums ${corDoValor(l.valor)}`}>{comSinal(l.valor)}</td>
                    <td className="whitespace-nowrap px-2 py-1.5 text-right align-top">
                      <Button type="button" variant="outline" size="sm" aria-label={abrir(l)} onClick={() => aoAbrir(l)}>Abrir</Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      </div>
    );

  return (
    <div ref={caixa} className="min-w-0">
      <ul aria-label="Lançamentos do banco e repasses" className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,290px),1fr))] gap-2">
        {linhas.map((l) => {
          const s = situacaoDe(l.situacao);
          const apoio = apoioDoLancamento(l);
          return (
            <li key={l.id} className="min-w-0">
              <Card className="flex h-full min-w-0 flex-col gap-1 p-3 text-sm">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                  <span className={`font-mono text-[13px] ${texto2}`}>{diaCurto(l.data)}</span>
                  <span className={`font-mono text-[15px] font-bold tabular-nums ${corDoValor(l.valor)}`}>{comSinal(l.valor)}</span>
                </div>
                <p className="break-words font-semibold [overflow-wrap:anywhere]">{l.descricao}</p>
                {apoio && <p className={`text-xs ${texto2}`}>{apoio}</p>}
                <p><span className={`font-semibold ${texto2}`}>Isso é · </span><IssoE l={l} rotulo={rotuloDoTipo} /></p>
                <p><span className={`font-semibold ${texto2}`}>Fonte · </span>{NOME_DA_FONTE[l.fonte]}</p>
                <div className="mt-auto flex flex-wrap items-center justify-between gap-2 pt-1">
                  <Selo tom={s.tom}>{s.rotulo}</Selo>
                  <Button type="button" variant="outline" size="sm" aria-label={abrir(l)} onClick={() => aoAbrir(l)}>Abrir</Button>
                </div>
              </Card>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
