'use client';

import { ErroDeLeitura, Indicadores } from '@/components/relatorios/pecas';
import { Card } from '@/components/ui/card';
import { dataBr, texto2 } from '@/components/ui/lista';
import { SkeletonList } from '@/components/ui/skeleton';
import { taxaDeFicha, type AberturasDaPagina, type OrigemDasFichas } from '@/lib/vagas-ficha';

// F5a (protótipo `mockups/regem-vagas-talentos.html`, "De onde vêm as fichas"; mig 430): quantos abriram a Página de vagas e
// quantos enviaram a ficha, por QR, por canal do robô e pelo link sem origem, no período. Cada aparelho conta uma abertura
// por dia; ninguém é identificado. Lista empilhada (nome em cima, as barras embaixo): cabe em qualquer largura.

export const PERIODOS = [7, 30, 90] as const;

const TIPO: Record<OrigemDasFichas['tipo'], string> = { qr: 'QR ou link da loja', robo: 'link que o robô mandou', link: 'link sem marca de origem' };
const pct = (t: number | null) => (t === null ? '—' : `${t}%`);

function Barra({ rotulo, valor, maximo, cor }: { rotulo: string; valor: number; maximo: number; cor: 'aberturas' | 'fichas' }) {
  const largura = maximo ? Math.max(valor ? 2 : 0, Math.round((valor * 100) / maximo)) : 0;
  return (
    <div className="grid grid-cols-[minmax(0,7rem)_minmax(0,1fr)] items-center gap-2 text-xs">
      <span className={texto2}>
        {rotulo} <b className="font-mono text-foreground">{valor}</b>
      </span>
      <span className="h-2 overflow-hidden rounded-full bg-secondary" aria-hidden="true">
        <span className={`block h-full rounded-full ${cor === 'fichas' ? 'bg-primary' : 'bg-info/60'}`} style={{ width: `${largura}%` }} />
      </span>
    </div>
  );
}

export function DeOndeVem({
  dias,
  aoEscolherDias,
  leitura,
  aoTentar,
}: {
  dias: number;
  aoEscolherDias: (d: number) => void;
  leitura: { dados: AberturasDaPagina | null; erro: string; lendo: boolean };
  aoTentar: () => void;
}) {
  const { dados, erro, lendo } = leitura;
  const maximo = Math.max(0, ...(dados?.origens ?? []).map((o) => Math.max(o.aberturas, o.fichas)));
  const comNumero = (dados?.origens ?? []).filter((o) => o.aberturas > 0 || o.fichas > 0);
  const contouDepois = dados && (!dados.contandoDesde || dados.contandoDesde > dados.desde);

  return (
    <Card className="space-y-3 p-4" aria-labelledby="de-onde-titulo" data-de-onde-vem>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 id="de-onde-titulo" className="font-display text-base font-bold">
            De onde vêm as fichas
          </h3>
          <p className={`text-sm ${texto2}`}>Últimos {dias} dias. Cada aparelho conta uma abertura por dia; ninguém é identificado.</p>
        </div>
        <div className="flex flex-wrap gap-1" role="group" aria-label="Período">
          {PERIODOS.map((d) => (
            <button
              key={d}
              type="button"
              aria-pressed={dias === d}
              onClick={() => aoEscolherDias(d)}
              className={`min-h-9 rounded-full border px-3 text-sm ${dias === d ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-card'}`}
            >
              {d} dias
            </button>
          ))}
        </div>
      </div>

      {erro && !dados ? (
        <ErroDeLeitura oQue="de onde vêm as fichas" motivo={erro} aoTentar={aoTentar} ocupado={lendo} />
      ) : !dados ? (
        <SkeletonList />
      ) : (
        <>
          <Indicadores
            itens={[
              { rotulo: 'Abriram a página', valor: dados.totais.aberturas },
              { rotulo: 'Enviaram a ficha', valor: dados.totais.fichas },
              { rotulo: 'Viraram ficha', valor: pct(taxaDeFicha(dados.totais.aberturas, dados.totais.fichas)) },
            ]}
          />
          {contouDepois && (
            <p className={`text-xs ${texto2}`} role="note">
              {dados.contandoDesde
                ? `As aberturas começaram a contar em ${dataBr(dados.contandoDesde)}; antes disso só as fichas aparecem.`
                : 'As aberturas começam a contar quando alguém abre a página pelo QR ou pelo link; antes disso só as fichas aparecem.'}
            </p>
          )}
          {comNumero.length === 0 ? (
            <p className="rounded-md border border-dashed border-border p-4 text-sm">
              <b className="block">Ainda não há aberturas neste período</b>
              As aberturas começam a contar quando a página está ligada e alguém abre pelo QR ou pelo link.
            </p>
          ) : (
            <ul aria-label="Aberturas e fichas por origem" className="divide-y divide-border">
              {comNumero.map((o) => (
                <li key={o.origem || 'sem-origem'} className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3" data-origem>
                  <div className="min-w-[10rem] flex-1">
                    <span className="block font-semibold">{o.nome}</span>
                    <span className={`block text-xs ${texto2}`}>{TIPO[o.tipo]}</span>
                  </div>
                  <div className="min-w-[12rem] flex-[2] space-y-1">
                    <Barra rotulo="abriram" valor={o.aberturas} maximo={maximo} cor="aberturas" />
                    <Barra rotulo="fichas" valor={o.fichas} maximo={maximo} cor="fichas" />
                  </div>
                  <span className="text-right">
                    <b className="block font-mono">{pct(taxaDeFicha(o.aberturas, o.fichas))}</b>
                    <span className={`block text-xs ${texto2}`}>viraram ficha</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </Card>
  );
}
