'use client';

import { api } from '@/lib/api';
import { ListaDados, texto2 } from '@/components/ui/lista';
import { Indicadores } from '@/components/relatorios/pecas';
import { useLeitura } from '@/components/relatorios/leitura';
import { AvisoSemValores, Bloco, BotaoCsv, Parte, SemDados } from '@/components/relatorios/bloco';
import { Barras, Colunas } from '@/components/relatorios/graficos';
import { CurvaAbc } from '@/components/relatorios/curva-abc';
import { plural, rs, type PropsDaAba } from '@/components/relatorios/formatos';

/* eslint-disable @typescript-eslint/no-explicit-any */

// ABA VENDAS — três leituras, cada uma por si: o resumo (`/relatorios/vendas`), a curva ABC
// (`/relatorios/produtos`) e os atendentes (`/relatorios/atendentes`).

export function AbaVendas({ inicio, fim, chave, versao, verFin, acompanhar }: PropsDaAba) {
  const vendas = useLeitura<any>(() => api.relatorioVendas(inicio, fim), chave, true, versao, acompanhar);
  const produtos = useLeitura<any>(() => api.relatorioProdutos(inicio, fim), chave, true, versao, acompanhar);
  const atendentes = useLeitura<any>(() => api.relatorioAtendentes(inicio, fim), chave, true, versao, acompanhar);
  // Sem venda nenhuma, a aba mostra um estado vazio só — não cinco blocos dizendo "sem vendas".
  const semVendas = !!vendas.dados && Number(vendas.dados.resumo?.vendas) === 0;

  return (
    <div className="space-y-5">
      <div>
        <h2 className="font-display text-xl font-bold">Vendas</h2>
        <p className={`text-sm ${texto2}`} role="status">{vendas.dados ? (semVendas ? 'nenhuma venda no período' : plural(vendas.dados.resumo.vendas, 'venda', 'vendas')) : 'carregando…'}</p>
      </div>
      {!verFin && <AvisoSemValores />}

      <Parte leitura={vendas} oQue="as vendas do período">
        {(v) => {
          const r = v.resumo;
          const temGorjeta = verFin && Number(r.gorjeta) > 0;
          return (
            <div className="space-y-5">
              <Indicadores
                itens={[
                  verFin && { rotulo: 'Faturado', valor: rs(r.faturado), apoio: 'sem a taxa de serviço' },
                  { rotulo: 'Vendas', valor: r.vendas },
                  verFin && !semVendas && { rotulo: 'Ticket médio', valor: rs(r.ticketMedio) },
                  temGorjeta ? { rotulo: 'Gorjeta', valor: rs(r.gorjeta), apoio: 'repasse ao funcionário' } : { rotulo: 'Canceladas', valor: r.canceladas },
                ]}
              />
              {/* A taxa de serviço passa pelo caixa mas não é receita da empresa (Lei 13.419/2017). */}
              {temGorjeta && (
                <p className={`text-sm ${texto2}`}>
                  O faturado de <b className="text-foreground">{rs(r.faturado)}</b> não inclui a gorjeta de <b className="text-foreground">{rs(r.gorjeta)}</b> — ela é repasse ao funcionário. Entrou no caixa{' '}
                  <b className="text-foreground">{rs(r.recebido)}</b>.
                </p>
              )}
              {semVendas ? (
                <SemDados>
                  Nenhuma venda neste período. Os números aparecem aqui quando a primeira venda for fechada no PDV, na mesa ou no delivery.
                </SemDados>
              ) : (
                verFin && (
                  <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
                    <Bloco id="forma-titulo" titulo="Por forma de pagamento" acoes={<BotaoCsv nome="vendas-por-forma" linhas={(v.porForma ?? []).map((x: any) => ({ forma: x.forma, vendas: x.qtd, total: x.total }))} />}>
                      {(v.porForma ?? []).length ? (
                        <Barras legenda="Vendas por forma de pagamento" linhas={v.porForma.map((x: any) => ({ rotulo: x.forma, valor: Number(x.total), texto: `${rs(x.total)} · ${x.qtd}` }))} />
                      ) : (
                        <SemDados>Sem vendas neste período.</SemDados>
                      )}
                    </Bloco>
                    <Bloco id="canal-titulo" titulo="Por canal" acoes={<BotaoCsv nome="vendas-por-canal" linhas={(v.porCanal ?? []).map((x: any) => ({ canal: x.canal, vendas: x.qtd, total: x.total }))} />}>
                      {(v.porCanal ?? []).length ? (
                        <Barras legenda="Vendas por canal" linhas={v.porCanal.map((x: any) => ({ rotulo: x.canal, valor: Number(x.total), texto: `${rs(x.total)} · ${x.qtd}` }))} />
                      ) : (
                        <SemDados>Sem vendas neste período.</SemDados>
                      )}
                    </Bloco>
                  </div>
                )
              )}
            </div>
          );
        }}
      </Parte>

      {!semVendas && (
        <>
          <Parte leitura={produtos} oQue="a curva ABC">{(p) => <CurvaAbc itens={p.itens ?? []} verFin={verFin} />}</Parte>
          <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
            <Parte leitura={atendentes} oQue="as vendas por atendente">
              {(a) => {
                const lista: any[] = a.atendentes ?? [];
                return (
                  <Bloco
                    id="atendente-titulo"
                    titulo="Por atendente"
                    acoes={<BotaoCsv nome="vendas-por-atendente" linhas={lista.map((x) => ({ atendente: x.nome, vendas: x.vendas, ...(verFin ? { total: x.total, gorjeta: x.gorjeta, 'ticket médio': x.ticketMedio } : {}) }))} />}
                  >
                    {lista.length ? (
                      <ListaDados
                        legenda="Vendas por atendente"
                        linhas={lista}
                        chave={(x) => String(x.nome)}
                        nome={(x) => String(x.nome)}
                        colunas={[
                          { titulo: 'Atendente', celula: (x) => <span className="break-words font-bold">{x.nome}</span> },
                          { titulo: 'Vendas', celula: (x) => x.vendas, classe: 'font-mono' },
                          ...(verFin
                            ? [
                                { titulo: 'Total', celula: (x: any) => rs(x.total), classe: 'whitespace-nowrap font-mono' },
                                { titulo: 'Gorjeta', celula: (x: any) => (Number(x.gorjeta) > 0 ? rs(x.gorjeta) : '—'), classe: 'whitespace-nowrap font-mono' },
                                { titulo: 'Ticket médio', celula: (x: any) => rs(x.ticketMedio), classe: 'whitespace-nowrap font-mono' },
                              ]
                            : []),
                        ]}
                      />
                    ) : (
                      <SemDados>Sem vendas neste período.</SemDados>
                    )}
                  </Bloco>
                );
              }}
            </Parte>
            {vendas.dados && (vendas.dados.porHora ?? []).length > 0 && (
              <Bloco id="hora-titulo" titulo="Vendas por hora">
                <Colunas
                  legenda="Vendas por hora do dia"
                  cabecalho={['Hora', 'Vendas']}
                  pontos={vendas.dados.porHora.map((h: any) => ({ rotulo: `${h.hora}h`, valor: Number(h.qtd), texto: plural(h.qtd, 'venda', 'vendas') }))}
                />
              </Bloco>
            )}
          </div>
        </>
      )}
    </div>
  );
}
