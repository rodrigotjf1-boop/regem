'use client';

import { api } from '@/lib/api';
import { ListaDados, texto2 } from '@/components/ui/lista';
import { useLeitura } from '@/components/relatorios/leitura';
import { AvisoSemValores, Bloco, BotaoCsv, Parte, SemDados } from '@/components/relatorios/bloco';
import { plural, rs, type PropsDaAba } from '@/components/relatorios/formatos';

/* eslint-disable @typescript-eslint/no-explicit-any */

// ABA OPERAÇÕES DE CAIXA — `/relatorios/operacoes-caixa`: cancelamentos e sangrias/suprimentos,
// somados por operador.

export function AbaOperacoes({ inicio, fim, chave, versao, verFin, acompanhar }: PropsDaAba) {
  const operacoes = useLeitura<any>(() => api.relatorioOperacoesCaixa(inicio, fim), chave, true, versao, acompanhar);

  return (
    <div className="space-y-5">
      <div>
        <h2 className="font-display text-xl font-bold">Operações de caixa</h2>
        <p className={`text-sm ${texto2}`}>cancelamentos, sangrias e suprimentos por operador</p>
      </div>
      {!verFin && <AvisoSemValores />}

      <Parte leitura={operacoes} oQue="as operações de caixa">
        {(d) => {
          const canc: any[] = d.cancelamentos ?? [];
          const movs: any[] = d.movimentos ?? [];
          if (!canc.length && !movs.length) return <SemDados>Nenhum cancelamento, sangria ou suprimento neste período.</SemDados>;
          return (
            <div className="space-y-5">
              <Bloco
                id="canc-titulo"
                titulo="Cancelamentos por operador"
                apoio={`${plural(d.cancelamentosTotal?.qtd ?? 0, 'cancelamento', 'cancelamentos')}${verFin ? ` · ${rs(d.cancelamentosTotal?.valor)}` : ''}`}
                acoes={<BotaoCsv nome="cancelamentos-por-operador" linhas={canc.map((x) => ({ operador: x.operador, cancelamentos: x.qtd, ...(verFin ? { valor: x.valor } : {}) }))} />}
              >
                {canc.length ? (
                  <ListaDados
                    legenda="Cancelamentos por operador"
                    linhas={canc}
                    chave={(x) => String(x.operador)}
                    nome={(x) => String(x.operador)}
                    colunas={[
                      { titulo: 'Operador', celula: (x) => <span className="break-words font-bold">{x.operador}</span> },
                      { titulo: 'Cancelamentos', celula: (x) => x.qtd, classe: 'font-mono' },
                      ...(verFin ? [{ titulo: 'Valor', celula: (x: any) => rs(x.valor), classe: 'whitespace-nowrap font-mono' }] : []),
                    ]}
                  />
                ) : (
                  <SemDados>Nenhum cancelamento neste período.</SemDados>
                )}
              </Bloco>

              <Bloco
                id="mov-titulo"
                titulo="Sangrias e suprimentos por operador"
                apoio={verFin ? `sangrias ${rs(d.movimentosTotal?.sangrias)} · suprimentos ${rs(d.movimentosTotal?.suprimentos)}` : undefined}
                acoes={
                  <BotaoCsv
                    nome="sangrias-suprimentos"
                    linhas={movs.map((x) => ({ operador: x.operador, 'qtd. de sangrias': x.qtdSangrias, ...(verFin ? { sangrias: x.sangrias } : {}), 'qtd. de suprimentos': x.qtdSuprimentos, ...(verFin ? { suprimentos: x.suprimentos } : {}) }))}
                  />
                }
              >
                {movs.length ? (
                  <ListaDados
                    legenda="Sangrias e suprimentos por operador"
                    linhas={movs}
                    chave={(x) => String(x.operador)}
                    nome={(x) => String(x.operador)}
                    colunas={[
                      { titulo: 'Operador', celula: (x) => <span className="break-words font-bold">{x.operador}</span> },
                      { titulo: 'Sangrias', celula: (x) => <>{verFin && <span className="font-mono">{rs(x.sangrias)} </span>}<span className={`text-xs ${texto2}`}>({x.qtdSangrias})</span></>, classe: 'whitespace-nowrap' },
                      { titulo: 'Suprimentos', celula: (x) => <>{verFin && <span className="font-mono">{rs(x.suprimentos)} </span>}<span className={`text-xs ${texto2}`}>({x.qtdSuprimentos})</span></>, classe: 'whitespace-nowrap' },
                    ]}
                  />
                ) : (
                  <SemDados>Nenhuma sangria ou suprimento neste período.</SemDados>
                )}
              </Bloco>
            </div>
          );
        }}
      </Parte>
    </div>
  );
}
