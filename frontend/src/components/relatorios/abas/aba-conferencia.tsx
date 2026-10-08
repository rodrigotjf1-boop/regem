'use client';

import { api } from '@/lib/api';
import { ListaDados, Selo, texto2 } from '@/components/ui/lista';
import { Indicadores } from '@/components/relatorios/pecas';
import { useLeitura } from '@/components/relatorios/leitura';
import { AvisoSemValores, Bloco, BotaoCsv, Parte, SemDados } from '@/components/relatorios/bloco';
import { plural, rs, type PropsDaAba } from '@/components/relatorios/formatos';

/* eslint-disable @typescript-eslint/no-explicit-any */

// ABA CONFERÊNCIA DE VALORES — `/relatorios/conferencia-valores`: decompõe o pedido em quem bancou
// o quê, por canal. Lê só as colunas separadas por origem (mig 241).

const valor = { classe: 'whitespace-nowrap font-mono' };

export function AbaConferencia({ inicio, fim, chave, versao, verFin, acompanhar }: PropsDaAba) {
  const conferencia = useLeitura<any>(() => api.relatorioConferencia(inicio, fim), chave, true, versao, acompanhar);

  return (
    <div className="space-y-5">
      <div>
        <h2 className="font-display text-xl font-bold">Conferência de valores</h2>
        <p className={`text-sm ${texto2}`}>quem bancou cada desconto e o que entra no faturamento</p>
      </div>
      {!verFin && <AvisoSemValores />}

      <Parte leitura={conferencia} oQue="a conferência de valores">
        {(c) => {
          const canais: any[] = c.porCanal ?? [];
          const taxas: any[] = c.taxasPorTipo ?? [];
          const t = c.total ?? {};
          if (!canais.length)
            return (
              <SemDados>
                Nenhum pedido com valores detalhados neste período. Os valores separados por origem existem a partir de setembro de 2026.
                {c.cobertura?.pedidos > 0 && ` Há ${plural(c.cobertura.pedidos, 'pedido', 'pedidos')} no período sem esse detalhe.`}
              </SemDados>
            );
          return (
            <div className="space-y-5">
              <Indicadores
                itens={[
                  { rotulo: 'Faturamento', valor: rs(t.faturamento), apoio: 'produtos + serviços da loja' },
                  { rotulo: 'Você bancou em desconto', valor: rs(t.descontoLoja), apoio: 'sai do seu bolso' },
                  { rotulo: 'Marketplace bancou', valor: rs(t.descontoMarketplace), apoio: 'volta no repasse — confira no extrato' },
                  { rotulo: 'Cliente pagou', valor: rs(t.clientePagou), apoio: plural(t.pedidos, 'pedido', 'pedidos') },
                ]}
              />
              {c.cobertura && c.cobertura.pct < 100 && (
                <p className="rounded-md border-l-4 border-l-warn bg-warn/10 px-3 py-2 text-sm" role="status">
                  {c.cobertura.detalhados} de {plural(c.cobertura.pedidos, 'pedido', 'pedidos')} do período têm o valor separado por origem ({c.cobertura.pct}%). Os outros entram pelo valor total, sem separar quem bancou o desconto.
                </p>
              )}

              <Bloco
                id="conf-canal-titulo"
                titulo="Por canal"
                acoes={<BotaoCsv nome="conferencia-valores" linhas={canais} />}
              >
                <ListaDados
                  legenda="Conferência de valores por canal"
                  linhas={canais}
                  chave={(x) => String(x.canal)}
                  nome={(x) => String(x.canal)}
                  colunas={[
                    { titulo: 'Canal', celula: (x) => <span className="break-words font-bold capitalize">{x.canal}</span> },
                    { titulo: 'Pedidos', celula: (x) => x.pedidos, classe: 'font-mono' },
                    { titulo: 'Venda bruta', celula: (x) => rs(x.venda_bruta), ...valor },
                    { titulo: 'Você bancou', celula: (x) => rs(x.desconto_loja), ...valor },
                    { titulo: 'Eles bancaram', celula: (x) => rs(x.desconto_marketplace), ...valor },
                    { titulo: 'Entrega (sua)', celula: (x) => rs(x.taxa_entrega_loja), ...valor },
                    { titulo: 'Taxas de serviço', celula: (x) => rs(x.taxas_servico), ...valor },
                    { titulo: 'Gorjeta', celula: (x) => rs(x.gorjeta), ...valor },
                    { titulo: 'Faturamento', celula: (x) => <b>{rs(x.faturamento)}</b>, ...valor },
                    { titulo: 'Cliente pagou', celula: (x) => rs(x.cliente_pagou), ...valor },
                  ]}
                />
              </Bloco>

              <details className="rounded-md border border-border bg-card px-4 py-2 text-sm">
                <summary className="inline-flex min-h-10 cursor-pointer items-center font-bold">Como ler estes números</summary>
                <div className={`space-y-2 pb-2 ${texto2}`}>
                  <p>
                    <b className="text-foreground">Faturamento</b> = venda de produtos (já descontado o que <b>você</b> bancou) + taxa de entrega quando a logística é sua + taxas de serviço. Desconto bancado pelo marketplace <b>não reduz</b> o faturamento: o cliente pagou menos, mas você recebe cheio.
                  </p>
                  <p>
                    <b className="text-foreground">Eles bancaram</b> é o que deve voltar no repasse do período — compare com o extrato da plataforma. A comissão contratual não entra aqui: ela está no extrato deles.
                  </p>
                  {Number(t.gorjeta) > 0 && (
                    <p>
                      <b className="text-foreground">Gorjeta ({rs(t.gorjeta)})</b> fica fora do faturamento — é repasse ao funcionário, não receita da loja.
                    </p>
                  )}
                  {Number(t.taxaEntregaTerceiro) > 0 && (
                    <p>{rs(t.taxaEntregaTerceiro)} de entrega foram por logística do marketplace — não é receita sua e por isso ficam fora do faturamento.</p>
                  )}
                  {Number(t.descontoLojaFrete) > 0 && (
                    <p>
                      <b className="text-foreground">{rs(t.descontoLojaFrete)} de desconto na entrega</b> você bancou, mas ele <b>não</b> reduz o faturamento de novo: a taxa de entrega já chega com o desconto aplicado.
                    </p>
                  )}
                </div>
              </details>

              {/* Que taxas estão sendo contadas como serviço da loja, pelo código CRU do canal. */}
              {taxas.length > 0 && (
                <Bloco
                  id="conf-taxas-titulo"
                  titulo="Taxas cobradas no pedido, por tipo"
                  apoio="serviço entra no faturamento; gorjeta fica fora"
                  acoes={<BotaoCsv nome="taxas-por-tipo" linhas={taxas.map((x) => ({ canal: x.canal, taxa: x.rotulo, código: x.tipo, pedidos: x.ocorrencias, valor: x.valor, 'entra no faturamento': x.ehGorjeta ? 'não — gorjeta' : 'sim — serviço' }))} />}
                >
                  <ListaDados
                    legenda="Taxas extras por tipo e canal"
                    linhas={taxas}
                    chave={(x) => `${x.canal}-${x.tipo}`}
                    nome={(x) => String(x.rotulo)}
                    colunas={[
                      { titulo: 'Taxa', celula: (x) => <span className="break-words font-bold">{x.rotulo}</span> },
                      { titulo: 'Canal', celula: (x) => <span className="capitalize">{x.canal}</span> },
                      { titulo: 'Código do canal', celula: (x) => <span className={`break-all font-mono text-xs ${texto2}`}>{x.tipo}</span> },
                      { titulo: 'Pedidos', celula: (x) => x.ocorrencias, classe: 'font-mono' },
                      { titulo: 'Valor', celula: (x) => rs(x.valor), ...valor },
                      { titulo: 'Entra no faturamento?', celula: (x) => (x.ehGorjeta ? <Selo>não — gorjeta</Selo> : <Selo tom="ok">sim — serviço</Selo>) },
                    ]}
                  />
                </Bloco>
              )}
            </div>
          );
        }}
      </Parte>
    </div>
  );
}
