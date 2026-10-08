'use client';

import { useEffect, useState } from 'react';
import { Download } from 'lucide-react';
import { api } from '@/lib/api';
import { baixarCsv } from '@/lib/csv';
import { Button } from '@/components/ui/button';
import { FiltroBusca, Filtros, ListaDados, TituloLista, Vazio, num, semAcento, texto2 } from '@/components/ui/lista';
import { Indicadores } from '@/components/relatorios/pecas';
import { useLeitura } from '@/components/relatorios/leitura';
import { AvisoSemValores, Bloco, Parte } from '@/components/relatorios/bloco';
import { Colunas } from '@/components/relatorios/graficos';
import { diaCurto, mesCurto, plural, rs, type PropsDaAba } from '@/components/relatorios/formatos';

/* eslint-disable @typescript-eslint/no-explicit-any */

// ABA PRODUÇÃO — `/relatorios/producao`: quanto de cada ficha foi produzido no período (fonte: os
// registros de produção de ficha na auditoria). O gráfico agrupa por dia, semana ou mês.

const ID_TITULO = 'producao-aba-titulo';
const AGRUPAR = [
  { v: 'dia', rotulo: 'Dia', coluna: 'Dia' },
  { v: 'semana', rotulo: 'Semana', coluna: 'Semana de' },
  { v: 'mes', rotulo: 'Mês', coluna: 'Mês' },
] as const;
type Agrup = (typeof AGRUPAR)[number]['v'];

function ListaDaProducao({ dados, verFin, agrup, aoContar }: { dados: any; verFin: boolean; agrup: Agrup; aoContar: (n: number) => void }) {
  const [busca, setBusca] = useState('');
  const todos: any[] = dados.porProduto ?? [];
  const pontos: any[] = dados.porPeriodo ?? [];
  useEffect(() => aoContar(todos.length), [todos.length, aoContar]);
  const b = semAcento(busca);
  const linhas = todos.filter((p) => !b || semAcento(p.nome).includes(b));
  const exportar = () => baixarCsv('producao-produto', linhas.map((p) => ({ ficha: p.nome, produções: p.producoes, quantidade: p.qtd, ...(verFin ? { 'custo teórico': p.custo } : {}) })));
  const coluna = AGRUPAR.find((a) => a.v === agrup)!;

  return (
    <div className="space-y-4">
      <Indicadores
        itens={[
          { rotulo: 'Produções', valor: dados.resumo?.producoes ?? 0 },
          { rotulo: 'Unidades produzidas', valor: num(dados.resumo?.qtd ?? 0) },
          verFin && { rotulo: 'Custo teórico', valor: rs(dados.resumo?.custo) },
        ]}
      />
      {pontos.length > 0 && (
        <Bloco id="producao-grafico-titulo" titulo={`Produção por ${agrup === 'mes' ? 'mês' : agrup}`}>
          <Colunas
            legenda="Unidades produzidas"
            cabecalho={[coluna.coluna, 'Unidades e produções']}
            pontos={pontos.map((x) => ({
              rotulo: agrup === 'mes' ? mesCurto(x.periodo) : diaCurto(x.periodo),
              valor: Number(x.qtd),
              texto: `${num(x.qtd)} un · ${plural(x.producoes, 'produção', 'produções')}${verFin ? ` · ${rs(x.custo)}` : ''}`,
            }))}
          />
        </Bloco>
      )}
      <section className="space-y-3" aria-labelledby={ID_TITULO}>
        <TituloLista id={ID_TITULO} titulo="Produção por produto" total={todos.length} mostrando={linhas.length} um="ficha produzida" varios="fichas produzidas">
          {linhas.length > 0 && <Button type="button" variant="outline" onClick={exportar}><Download className="h-4 w-4" aria-hidden="true" /> Exportar CSV</Button>}
        </TituloLista>
        {todos.length === 0 ? (
          <Vazio>Nenhuma produção neste período. As produções aparecem aqui quando uma ficha técnica é produzida.</Vazio>
        ) : (
          <>
            <Filtros>
              <FiltroBusca id="producao-aba-busca" valor={busca} aoMudar={setBusca} placeholder="Nome da ficha" />
            </Filtros>
            {linhas.length === 0 ? (
              <Vazio aoLimpar={() => setBusca('')} />
            ) : (
              <ListaDados
                legenda="Produção por produto, da maior quantidade para a menor"
                linhas={linhas}
                chave={(p) => String(p.fichaId ?? p.nome)}
                nome={(p) => String(p.nome)}
                colunas={[
                  { titulo: 'Ficha', celula: (p) => <span className="break-words font-bold">{p.nome}</span> },
                  { titulo: 'Produções', celula: (p) => `${p.producoes}×`, classe: 'whitespace-nowrap font-mono' },
                  { titulo: 'Quantidade', celula: (p) => <b>{num(p.qtd)} un</b>, classe: 'whitespace-nowrap font-mono' },
                  ...(verFin ? [{ titulo: 'Custo teórico', celula: (p: any) => rs(p.custo), classe: 'whitespace-nowrap font-mono' }] : []),
                ]}
              />
            )}
          </>
        )}
      </section>
    </div>
  );
}

export function AbaProducao({ inicio, fim, todas, chave, versao, verFin, acompanhar, aoContar }: PropsDaAba & { aoContar: (n: number) => void }) {
  const [agrup, setAgrup] = useState<Agrup>('dia');
  const producao = useLeitura<any>(() => api.relatorioProducao(inicio, fim, agrup, todas), chave ? `${chave}|${agrup}` : '', true, versao, acompanhar);
  return (
    <div className="space-y-4">
      {!verFin && <AvisoSemValores />}
      <div className="space-y-1">
        <p id="producao-agrupar" className={`text-xs font-bold ${texto2}`}>Agrupar o gráfico por</p>
        <div className="inline-flex flex-wrap gap-1.5" role="group" aria-labelledby="producao-agrupar">
          {AGRUPAR.map((a) => (
            <button
              key={a.v}
              type="button"
              aria-pressed={agrup === a.v}
              onClick={() => setAgrup(a.v)}
              className={`min-h-10 rounded-md border px-3.5 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${agrup === a.v ? 'border-foreground bg-foreground text-background' : `border-input bg-card ${texto2} hover:text-foreground`}`}
            >
              {a.rotulo}
            </button>
          ))}
        </div>
      </div>
      <Parte leitura={producao} oQue="a produção">{(d) => <ListaDaProducao dados={d} verFin={verFin} agrup={agrup} aoContar={aoContar} />}</Parte>
    </div>
  );
}
