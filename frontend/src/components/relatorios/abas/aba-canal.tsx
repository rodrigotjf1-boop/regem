'use client';

import Link from 'next/link';
import { api } from '@/lib/api';
import { ListaDados, texto2, type Coluna } from '@/components/ui/lista';
import { Indicadores } from '@/components/relatorios/pecas';
import { useLeitura } from '@/components/relatorios/leitura';
import { AvisoSemValores, Bloco, BotaoCsv, Parte, SemDados, TabelaCurta } from '@/components/relatorios/bloco';
import { Colunas } from '@/components/relatorios/graficos';
import { diaCurto, plural, rs, type PropsDaAba } from '@/components/relatorios/formatos';

/* eslint-disable @typescript-eslint/no-explicit-any */

// ABAS BALCÃO / SALÃO e DELIVERY — o detalhe de um canal (`/relatorios/balcao` ou
// `/relatorios/delivery`): indicadores, por dia, por hora e os mais vendidos (o servidor manda os
// 20 primeiros). No delivery entram plataforma e bairro; no balcão, o ranking dos dois canais
// juntos (`/relatorios/ranking-produtos`, os 30 primeiros).

const dinheiro = (verFin: boolean, titulo: string, celula: Coluna<any>['celula']): Coluna<any>[] => (verFin ? [{ titulo, celula, classe: 'whitespace-nowrap font-mono' }] : []);

export function AbaCanal({ canal, podeMapa, inicio, fim, todas, chave, versao, verFin, acompanhar }: PropsDaAba & { canal: 'balcao' | 'delivery'; podeMapa?: boolean }) {
  const delivery = canal === 'delivery';
  const detalhe = useLeitura<any>(() => (delivery ? api.relatorioDelivery(inicio, fim, todas) : api.relatorioBalcao(inicio, fim, todas)), chave, true, versao, acompanhar);
  const ranking = useLeitura<any>(() => api.relatorioRanking(inicio, fim, todas), chave, !delivery, versao, acompanhar);
  const semVendas = !!detalhe.dados && Number(detalhe.dados.resumo?.vendas) === 0;

  return (
    <div className="space-y-5">
      <div>
        <h2 className="font-display text-xl font-bold">{delivery ? 'Delivery' : 'Balcão / Salão'}</h2>
        <p className={`text-sm ${texto2}`}>{delivery ? 'pedidos de entrega e de retirada dos canais' : 'vendas do balcão e das mesas'}</p>
      </div>
      {!verFin && <AvisoSemValores />}

      <Parte leitura={detalhe} oQue={delivery ? 'os pedidos de delivery' : 'as vendas do balcão e das mesas'}>
        {(d) => {
          const r = d.resumo;
          if (semVendas)
            return (
              <div className="space-y-5">
                <Indicadores itens={[verFin && { rotulo: 'Faturado', valor: rs(r.faturado) }, { rotulo: 'Vendas', valor: 0 }]} />
                <SemDados>
                  {delivery
                    ? 'Nenhum pedido de delivery neste período. Os pedidos aparecem aqui quando são aceitos no painel do Delivery.'
                    : 'Nenhuma venda de balcão ou de mesa neste período. As vendas aparecem aqui quando são fechadas no PDV ou nas mesas.'}
                </SemDados>
              </div>
            );
          const mais: any[] = d.maisVendidos ?? [];
          return (
            <div className="space-y-5">
              <Indicadores
                itens={[
                  verFin && { rotulo: 'Faturado', valor: rs(r.faturado) },
                  { rotulo: 'Vendas', valor: r.vendas },
                  verFin && { rotulo: 'Ticket médio', valor: rs(r.ticketMedio) },
                  // A gorjeta só aparece quando existe — em loja sem taxa de serviço vira ruído.
                  verFin && Number(r.gorjeta) > 0 && { rotulo: 'Gorjeta', valor: rs(r.gorjeta), apoio: 'fora do faturamento' },
                ]}
              />
              <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
                <Bloco id="dia-titulo" titulo={verFin ? 'Vendas por dia (R$)' : 'Vendas por dia'}>
                  <Colunas
                    legenda="Vendas por dia"
                    cabecalho={['Dia', verFin ? 'Valor e vendas' : 'Vendas']}
                    pontos={(d.porDia ?? []).map((x: any) => ({ rotulo: diaCurto(x.dia), valor: Number(verFin ? x.total : x.qtd), texto: `${verFin ? `${rs(x.total)} · ` : ''}${plural(x.qtd, 'venda', 'vendas')}` }))}
                  />
                </Bloco>
                <Bloco id="hora-titulo" titulo="Vendas por hora">
                  <Colunas legenda="Vendas por hora" cabecalho={['Hora', 'Vendas']} pontos={(d.porHora ?? []).map((h: any) => ({ rotulo: `${h.hora}h`, valor: Number(h.qtd), texto: plural(h.qtd, 'venda', 'vendas') }))} />
                </Bloco>
              </div>

              {delivery && (
                <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
                  <Bloco id="plataforma-titulo" titulo="Por plataforma" acoes={<BotaoCsv nome="delivery-plataforma" linhas={(d.porPlataforma ?? []).map((p: any) => ({ plataforma: p.plataforma, pedidos: p.qtd, ...(verFin ? { total: p.total } : {}) }))} />}>
                    {(d.porPlataforma ?? []).length ? (
                      <ListaDados
                        legenda="Delivery por plataforma"
                        linhas={d.porPlataforma as any[]}
                        chave={(p) => String(p.plataforma)}
                        nome={(p) => String(p.plataforma)}
                        colunas={[
                          { titulo: 'Plataforma', celula: (p) => <span className="break-words font-bold capitalize">{p.plataforma}</span> },
                          { titulo: 'Pedidos', celula: (p) => p.qtd, classe: 'font-mono' },
                          ...dinheiro(verFin, 'Total', (p) => rs(p.total)),
                        ]}
                      />
                    ) : (
                      <SemDados>Sem pedidos de delivery neste período.</SemDados>
                    )}
                  </Bloco>
                  <Bloco
                    id="regiao-titulo"
                    titulo="Por região (bairro)"
                    acoes={
                      <>
                        {podeMapa && (
                          <Link href="/relatorios/delivery" className="inline-flex min-h-9 items-center rounded-md border border-input bg-card px-3 text-sm font-semibold hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                            Mapa de calor por bairro
                          </Link>
                        )}
                        <BotaoCsv nome="delivery-regiao" linhas={(d.porRegiao ?? []).map((x: any) => ({ bairro: x.regiao, pedidos: x.qtd, ...(verFin ? { total: x.total } : {}) }))} />
                      </>
                    }
                  >
                    {(d.porRegiao ?? []).length ? (
                      <TabelaCurta
                        legenda="Delivery por bairro"
                        linhas={d.porRegiao as any[]}
                        chave={(x) => String(x.regiao)}
                        nome={(x) => String(x.regiao)}
                        oQue="bairros"
                        colunas={[
                          { titulo: 'Bairro', celula: (x) => <span className="break-words font-bold">{x.regiao}</span> },
                          { titulo: 'Pedidos', celula: (x) => x.qtd, classe: 'font-mono' },
                          ...dinheiro(verFin, 'Total', (x) => rs(x.total)),
                        ]}
                      />
                    ) : (
                      <SemDados>Sem entregas com bairro neste período.</SemDados>
                    )}
                  </Bloco>
                </div>
              )}

              <Bloco
                id="mais-titulo"
                titulo="Mais vendidos"
                apoio={mais.length ? 'os 20 primeiros em quantidade' : undefined}
                acoes={<BotaoCsv nome={`mais-vendidos-${canal}`} linhas={mais.map((p, i) => ({ posição: i + 1, produto: p.descricao, quantidade: p.qtd, ...(verFin ? { faturamento: p.faturamento } : {}) }))} />}
              >
                {mais.length ? (
                  <TabelaCurta
                    legenda="Mais vendidos"
                    linhas={mais}
                    chave={(p, i) => `${i}-${p.descricao}`}
                    nome={(p) => String(p.descricao)}
                    oQue="produtos"
                    colunas={[
                      { titulo: 'Produto', celula: (p) => <span className="break-words font-bold"><span className={`mr-1.5 font-normal ${texto2}`}>{mais.indexOf(p) + 1}º</span>{p.descricao}</span> },
                      { titulo: 'Quantidade', celula: (p) => `${p.qtd}×`, classe: 'whitespace-nowrap font-mono' },
                      ...dinheiro(verFin, 'Faturamento', (p) => rs(p.faturamento)),
                    ]}
                  />
                ) : (
                  <SemDados>Sem vendas neste período.</SemDados>
                )}
              </Bloco>
            </div>
          );
        }}
      </Parte>

      {!delivery && !semVendas && (
        <Parte leitura={ranking} oQue="o ranking de produtos">
          {(rk) => {
            const itens: any[] = rk.itens ?? [];
            if (!itens.length) return null;
            return (
              <Bloco
                id="ranking-titulo"
                titulo="Ranking de produtos — balcão + delivery"
                apoio="os 30 primeiros em quantidade"
                acoes={<BotaoCsv nome="ranking-global" linhas={itens.map((p, i) => ({ posição: i + 1, produto: p.descricao, balcão: p.qtdBalcao, delivery: p.qtdDelivery, total: p.qtd, ...(verFin ? { faturamento: p.faturamento } : {}) }))} />}
              >
                <TabelaCurta
                  legenda="Ranking de produtos"
                  linhas={itens}
                  chave={(p, i) => `${i}-${p.descricao}`}
                  nome={(p) => String(p.descricao)}
                  oQue="produtos"
                  colunas={[
                    { titulo: 'Produto', celula: (p) => <span className="break-words font-bold"><span className={`mr-1.5 font-normal ${texto2}`}>{itens.indexOf(p) + 1}º</span>{p.descricao}</span> },
                    { titulo: 'Balcão', celula: (p) => `${p.qtdBalcao}×`, classe: 'whitespace-nowrap font-mono' },
                    { titulo: 'Delivery', celula: (p) => `${p.qtdDelivery}×`, classe: 'whitespace-nowrap font-mono' },
                    { titulo: 'Total', celula: (p) => <b>{p.qtd}×</b>, classe: 'whitespace-nowrap font-mono' },
                    ...dinheiro(verFin, 'Faturamento', (p) => rs(p.faturamento)),
                  ]}
                />
              </Bloco>
            );
          }}
        </Parte>
      )}
    </div>
  );
}
