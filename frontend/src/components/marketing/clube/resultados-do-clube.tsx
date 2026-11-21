'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { brl } from '@/components/ui/lista';

/* eslint-disable @typescript-eslint/no-explicit-any */

// Marketing › Clube › Resultados (fase A4 do `docs/plano-clube-e-banner.md`; protótipo `mockups/regem-clube-banner.html`,
// "Marketing › Clube" › Resultados): o período, os prêmios dados, revelados e usados, o desconto e o vendido nos pedidos
// com prêmio, e as campanhas com prêmio (quem voltou em 15 dias, contra o grupo de controle quando ele está ligado). Só
// leitura. Vazio, carregando e erro com "Tentar de novo".

type Resultados = {
  periodo: string;
  titulo: string;
  ganharam: number;
  revelaram: number;
  usaram: number;
  desconto: number;
  vendido: number;
  campanhas: {
    receberam: number;
    voltaram: number;
    dias: number;
    controle: { base: number; voltaram: number; pouco: boolean } | null;
  } | null;
};

const PERIODOS = [
  { v: 'mes', rotulo: 'Este mês' },
  { v: 'mes_passado', rotulo: 'Mês passado' },
  { v: '90d', rotulo: 'Últimos 90 dias' },
];

function Numero({ valor, rotulo }: { valor: string; rotulo: string }) {
  return (
    <Card className="min-w-0 p-3">
      <b className="block font-mono text-xl font-bold [overflow-wrap:anywhere]">{valor}</b>
      <span className="text-xs text-secondary-foreground">{rotulo}</span>
    </Card>
  );
}

export function ResultadosDoClube() {
  const id = useId();
  const [periodo, setPeriodo] = useState('mes');
  const [r, setR] = useState<Resultados | null>(null);
  const [erro, setErro] = useState('');
  const [carregando, setCarregando] = useState(true);
  // Só a resposta da leitura mais nova vale (V64): trocar de período no meio não mistura os números.
  const leitura = useRef(0);

  const ler = useCallback((p: string) => {
    const n = ++leitura.current;
    setCarregando(true);
    setErro('');
    api
      .clubeResultados(p)
      .then((x: any) => {
        if (n === leitura.current) setR(x as Resultados);
      })
      .catch((e: unknown) => {
        if (n === leitura.current) setErro(e instanceof Error ? e.message : 'Não foi possível ler os resultados.');
      })
      .finally(() => {
        if (n === leitura.current) setCarregando(false);
      });
  }, []);
  useEffect(() => ler(periodo), [ler, periodo]);

  const pct = (a: number, b: number) => (b > 0 ? `${Math.round((a / b) * 100)}%` : '—');

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-bold">{r && !erro ? r.titulo : 'Resultados'}</h2>
        <label htmlFor={`${id}-periodo`} className="sr-only">Período</label>
        <select
          id={`${id}-periodo`}
          className="flex h-10 rounded-md border border-input bg-card px-3 text-sm"
          value={periodo}
          onChange={(e) => setPeriodo(e.target.value)}
        >
          {PERIODOS.map((p) => (
            <option key={p.v} value={p.v}>{p.rotulo}</option>
          ))}
        </select>
      </div>

      {erro ? (
        <Card className="flex flex-wrap items-center gap-3 p-4 text-sm" role="alert">
          <span>Não deu para ler os resultados agora: {erro}</span>
          <Button type="button" variant="outline" size="sm" onClick={() => ler(periodo)}>Tentar de novo</Button>
        </Card>
      ) : carregando && !r ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5" aria-busy="true" aria-label="Carregando os resultados">
          {Array.from({ length: 5 }, (_, i) => <Skeleton key={i} className="h-20 w-full" />)}
        </div>
      ) : r && r.ganharam === 0 && !r.campanhas ? (
        <Card className="p-4">
          <h3 className="font-semibold">Ainda sem números</h3>
          <p className="text-sm text-secondary-foreground">Os resultados aparecem quando o primeiro cliente ganhar um prêmio.</p>
        </Card>
      ) : r ? (
        <div className={carregando ? 'space-y-4 opacity-60' : 'space-y-4'} aria-busy={carregando}>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            <Numero valor={String(r.ganharam)} rotulo="ganharam um prêmio" />
            <Numero valor={String(r.revelaram)} rotulo={`revelaram (${pct(r.revelaram, r.ganharam)})`} />
            <Numero valor={String(r.usaram)} rotulo={`usaram (${pct(r.usaram, r.ganharam)})`} />
            <Numero valor={brl(r.desconto)} rotulo="em desconto" />
            <Numero valor={brl(r.vendido)} rotulo="vendido nos pedidos com prêmio" />
          </div>
          <Card className="p-4">
            <h3 className="font-semibold">{r.campanhas?.controle ? 'Contra quem não recebeu' : 'Nas campanhas com prêmio'}</h3>
            {r.campanhas ? (
              <div className="space-y-1 text-sm text-secondary-foreground">
                <p>
                  {r.campanhas.voltaram} de {r.campanhas.receberam} que receberam voltaram a pedir em até {r.campanhas.dias} dias (
                  {pct(r.campanhas.voltaram, r.campanhas.receberam)})
                  {r.campanhas.controle
                    ? `; do grupo de controle, ${r.campanhas.controle.voltaram} de ${r.campanhas.controle.base} (${pct(r.campanhas.controle.voltaram, r.campanhas.controle.base)}).`
                    : '.'}
                </p>
                {r.campanhas.controle?.pouco && (
                  <p className="text-xs">Grupo de controle com menos de 100 clientes: a diferença ainda varia muito.</p>
                )}
                {!r.campanhas.controle && (
                  <p className="text-xs">
                    Para comparar com quem não recebeu, ligue "Grupo de controle das campanhas (10%)" em Delivery › Marketing › Automáticas ›
                    Para todas as automáticas. Vale para as próximas campanhas.
                  </p>
                )}
              </div>
            ) : (
              <p className="text-sm text-secondary-foreground">Nenhuma campanha com prêmio surpresa saiu neste período.</p>
            )}
          </Card>
          <p className="text-xs text-secondary-foreground">
            Contam os prêmios dados no período (todos os gatilhos, o álbum e a meta); "usaram" é o cupom num pedido que não foi cancelado.
          </p>
        </div>
      ) : null}
    </div>
  );
}
