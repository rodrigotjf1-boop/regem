'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { SkeletonList } from '@/components/ui/skeleton';
import { FiltroSelect, Filtros, Vazio, dataBr, hojeIso, num, texto2 } from '@/components/ui/lista';
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
            <Card className="relative overflow-x-auto">
              <table className="w-full min-w-[520px] border-collapse text-sm">
                <caption className="sr-only">Planejado e produzido por ordem</caption>
                <thead>
                  <tr className={`border-b border-border bg-secondary text-left text-xs uppercase tracking-wide ${texto2}`}>
                    <th scope="col" className="px-3 py-2.5 font-bold">Ficha</th>
                    <th scope="col" className="px-3 py-2.5 font-bold">Data</th>
                    <th scope="col" className="px-3 py-2.5 text-right font-bold">Planejado</th>
                    <th scope="col" className="px-3 py-2.5 text-right font-bold">Produzido</th>
                    <th scope="col" className="px-3 py-2.5 text-right font-bold">Quebra</th>
                  </tr>
                </thead>
                <tbody>
                  {itens.map((r) => (
                    <tr key={r.id} className="border-b border-border last:border-b-0">
                      <td className="px-3 py-2.5 font-bold">{r.fichaNome ?? 'Ficha'}</td>
                      <td className="whitespace-nowrap px-3 py-2.5 font-mono">{dataBr(r.dataProducao)}</td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-right font-mono">{num(r.planejada)} {r.unidade}</td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-right font-mono">{num(r.produzida)} {r.unidade}</td>
                      <td className={`whitespace-nowrap px-3 py-2.5 text-right font-mono ${r.quebra > 0 ? 'font-bold' : ''}`}>{r.quebra > 0 ? `−${num(r.quebra)}` : '0'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          )}
          {itens.length < resumo.ordens && (
            <p className={`text-sm ${texto2}`}>A tabela mostra as {itens.length} ordens mais recentes; os totais acima são de todas as {resumo.ordens} do período.</p>
          )}
        </>
      )}
    </section>
  );
}
