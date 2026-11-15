'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { SkeletonList } from '@/components/ui/skeleton';
import { FiltroSelect, Filtros, ListaDados, Vazio, dataBr, hojeIso, num, texto2 } from '@/components/ui/lista';
import { diasAtras } from './ordem';

/* eslint-disable @typescript-eslint/no-explicit-any */
const PERIODOS = [
  { v: '7', rotulo: 'Últimos 7 dias' },
  { v: '30', rotulo: 'Últimos 30 dias' },
  { v: '90', rotulo: 'Últimos 90 dias' },
];

// Planejado × produzido das ordens concluídas no período — é onde a quebra aparece. Os totais vêm
// do servidor, somados sobre o período inteiro; a tabela mostra as ordens mais recentes.
export function RelatorioOrdens() {
  const [periodo, setPeriodo] = useState('30');
  const [dados, setDados] = useState<any | null>(null);
  const [erro, setErro] = useState('');

  const carregar = useCallback(async (dias: string) => {
    setErro('');
    setDados(null);
    try {
      setDados(await api.ordensRelatorio(diasAtras(Number(dias)), hojeIso()));
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao carregar o relatório');
    }
  }, []);
  useEffect(() => {
    void carregar(periodo);
  }, [carregar, periodo]);

  const resumo = dados?.resumo;
  const itens: any[] = dados?.itens ?? [];
  const rotuloPeriodo = PERIODOS.find((p) => p.v === periodo)?.rotulo.toLowerCase();
  const kpi = (rotulo: string, valor: string) => (
    <div className="rounded-md border border-border bg-card p-3">
      <dt className={`text-xs font-bold ${texto2}`}>{rotulo}</dt>
      <dd className="font-mono text-xl font-semibold">{valor}</dd>
    </div>
  );

  return (
    <section className="space-y-3" aria-labelledby="relatorio-titulo">
      <div>
        <h2 id="relatorio-titulo" tabIndex={-1} className="font-display text-xl font-bold outline-none">Planejado × produzido</h2>
        <p className={`text-sm ${texto2}`} role="status" aria-live="polite">
          {erro ? 'não carregou' : !resumo ? 'carregando…' : `${resumo.ordens} ${resumo.ordens === 1 ? 'ordem concluída' : 'ordens concluídas'} · ${rotuloPeriodo}`}
        </p>
      </div>
      <Filtros>
        <FiltroSelect id="relatorio-periodo" rotulo="Período" opcoes={PERIODOS} valor={periodo} aoMudar={setPeriodo} />
      </Filtros>
      {erro ? (
        <Card className="space-y-3 p-5 text-sm">
          <p role="alert">{erro}</p>
          <Button type="button" variant="outline" size="sm" onClick={() => void carregar(periodo)}>Tentar de novo</Button>
        </Card>
      ) : !resumo ? (
        <SkeletonList rows={4} />
      ) : (
        <>
          <dl className="grid grid-cols-2 gap-2 lg:grid-cols-4">
            {kpi('Ordens', String(resumo.ordens))}
            {kpi('Planejado', num(resumo.planejadoTotal))}
            {kpi('Produzido', num(resumo.produzidoTotal))}
            {kpi('Aderência', resumo.aderenciaMedia != null ? `${num(resumo.aderenciaMedia)}%` : '—')}
          </dl>
          {itens.length === 0 ? (
            <Vazio>Nenhuma ordem concluída neste período.</Vazio>
          ) : (
            // A lista do modelo do Estoque: tabela na tela larga, cartões quando não cabe — nunca rola para o lado
            // (a tabela de 520 px rolava abaixo de ~560 px; ERR-476).
            <ListaDados
              legenda="Planejado e produzido por ordem"
              linhas={itens}
              chave={(r) => String(r.id)}
              nome={(r) => r.fichaNome ?? 'Ficha'}
              colunas={[
                { titulo: 'Ficha', celula: (r) => <span className="font-bold">{r.fichaNome ?? 'Ficha'}</span> },
                { titulo: 'Data', celula: (r) => <span className="whitespace-nowrap font-mono">{dataBr(r.dataProducao)}</span> },
                { titulo: 'Planejado', celula: (r) => <span className="whitespace-nowrap font-mono">{num(r.planejada)} {r.unidade}</span>, classe: 'text-right' },
                { titulo: 'Produzido', celula: (r) => <span className="whitespace-nowrap font-mono">{num(r.produzida)} {r.unidade}</span>, classe: 'text-right' },
                {
                  titulo: 'Quebra',
                  celula: (r) => <span className={`whitespace-nowrap font-mono ${r.quebra > 0 ? 'font-bold' : ''}`}>{r.quebra > 0 ? `−${num(r.quebra)}` : '0'}</span>,
                  classe: 'text-right',
                },
              ]}
            />
          )}
          {itens.length < resumo.ordens && (
            <p className={`text-sm ${texto2}`}>A tabela mostra as {itens.length} ordens mais recentes; os totais acima são de todas as {resumo.ordens} do período.</p>
          )}
        </>
      )}
    </section>
  );
}
