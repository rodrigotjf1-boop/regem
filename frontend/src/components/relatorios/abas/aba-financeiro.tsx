'use client';

import { api } from '@/lib/api';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ListaDados, brl, texto2 } from '@/components/ui/lista';
import { Indicadores } from '@/components/relatorios/pecas';
import { useLeitura } from '@/components/relatorios/leitura';
import { Bloco, BotaoCsv, Parte, SemDados } from '@/components/relatorios/bloco';
import { Colunas } from '@/components/relatorios/graficos';
import { mesCurto, plural, type PropsDaAba } from '@/components/relatorios/formatos';

/* eslint-disable @typescript-eslint/no-explicit-any */

// ABA FINANCEIRO — só para quem tem "Ver valores em R$" (o servidor recusa os demais):
// faturamento por mês (`/relatorios/faturamento`) e por plataforma de delivery
// (`/relatorios/faturamento-delivery`), cada um por si.

export function AbaFinanceiro({ inicio, fim, todas, chave, versao, acompanhar, mes, aoEscolherMes }: PropsDaAba & { mes: string; aoEscolherMes: (ym: string) => void }) {
  const fat = useLeitura<any>(() => api.relatorioFaturamento(inicio, fim, todas), chave, true, versao, acompanhar);
  const fatDelivery = useLeitura<any>(() => api.relatorioFaturamentoDelivery(inicio, fim, todas), chave, true, versao, acompanhar);

  return (
    <div className="space-y-5">
      <div>
        <h2 className="font-display text-xl font-bold">Financeiro</h2>
        <p className={`text-sm ${texto2}`}>faturamento por mês e por plataforma de delivery</p>
      </div>

      <Bloco
        id="fat-mes-titulo"
        titulo="Faturamento por mês"
        apoio="os meses dentro do período escolhido"
        acoes={
          <>
            <span className="flex items-center gap-2">
              <Label htmlFor="fin-mes" className="whitespace-nowrap">Ir para o mês</Label>
              <Input id="fin-mes" type="month" value={mes} onChange={(e) => aoEscolherMes(e.target.value)} className="h-9 w-auto" />
            </span>
            <BotaoCsv nome="faturamento-mes" linhas={(fat.dados?.porMes ?? []).map((m: any) => ({ mês: m.ym, faturamento: m.total, vendas: m.vendas }))} />
          </>
        }
      >
        <Parte leitura={fat} oQue="o faturamento por mês">
          {(f) => {
            const meses: any[] = f.porMes ?? [];
            if (!meses.length) return <SemDados>Sem vendas neste período.</SemDados>;
            return (
              <div className="space-y-3">
                <Colunas
                  legenda="Faturamento por mês"
                  cabecalho={['Mês', 'Faturamento e vendas']}
                  pontos={meses.map((m) => ({ rotulo: mesCurto(m.ym), valor: Number(m.total), texto: `${brl(m.total)} · ${plural(m.vendas, 'venda', 'vendas')}` }))}
                />
                {(f.trimestres ?? []).length > 1 && (
                  <Indicadores itens={f.trimestres.map((t: any) => ({ rotulo: String(t.trimestre), valor: brl(t.total), apoio: plural(t.vendas, 'venda', 'vendas') }))} />
                )}
                <p className="text-right text-sm">
                  Total do período: <b className="font-mono">{brl(f.total)}</b>
                </p>
              </div>
            );
          }}
        </Parte>
      </Bloco>

      <Bloco
        id="fat-delivery-titulo"
        titulo="Faturamento por delivery (plataforma)"
        acoes={<BotaoCsv nome="faturamento-delivery" linhas={(fatDelivery.dados?.porPlataforma ?? []).map((p: any) => ({ plataforma: p.plataforma, pedidos: p.pedidos, total: p.total, 'ticket médio': p.ticketMedio }))} />}
      >
        <Parte leitura={fatDelivery} oQue="o faturamento do delivery">
          {(d) => {
            const plataformas: any[] = d.porPlataforma ?? [];
            if (!plataformas.length) return <SemDados>Sem pedidos de delivery neste período.</SemDados>;
            return (
              <div className="space-y-3">
                <Indicadores
                  itens={[
                    { rotulo: 'Total do delivery', valor: brl(d.total) },
                    { rotulo: 'Pedidos', valor: d.pedidos },
                    { rotulo: 'Ticket médio', valor: brl(d.ticketMedio) },
                  ]}
                />
                <p className={`text-sm ${texto2}`}>Fora pendentes e cancelados. Produto menos o desconto que você bancou, mais a entrega que é sua. Sem gorjeta.</p>
                {/* Sem este aviso, período sem o detalhe por origem parece só "menor". */}
                {Number(d.pedidos) > 0 && Number(d.detalhados) < Number(d.pedidos) && (
                  <p className="rounded-md border-l-4 border-l-warn bg-warn/10 px-3 py-2 text-sm" role="status">
                    {d.detalhados} de {plural(d.pedidos, 'pedido', 'pedidos')} com o desconto separado por origem; o resto entra pelo valor total.
                  </p>
                )}
                {Number(d.gorjeta) > 0 && <p className={`text-sm ${texto2}`}>+ {brl(d.gorjeta)} de gorjeta, fora do faturamento (repasse ao entregador).</p>}
                <ListaDados
                  legenda="Faturamento por plataforma de delivery"
                  linhas={plataformas}
                  chave={(p) => String(p.plataforma)}
                  nome={(p) => String(p.plataforma)}
                  colunas={[
                    { titulo: 'Plataforma', celula: (p) => <span className="break-words font-bold capitalize">{p.plataforma}</span> },
                    { titulo: 'Pedidos', celula: (p) => p.pedidos, classe: 'font-mono' },
                    { titulo: 'Total', celula: (p) => brl(p.total), classe: 'whitespace-nowrap font-mono' },
                    { titulo: 'Ticket médio', celula: (p) => brl(p.ticketMedio), classe: 'whitespace-nowrap font-mono' },
                  ]}
                />
              </div>
            );
          }}
        </Parte>
      </Bloco>
    </div>
  );
}
