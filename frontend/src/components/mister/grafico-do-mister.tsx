'use client';

import { useEffect, useRef, useState } from 'react';
import { texto2 } from '@/components/ui/lista';
import type { Ponto } from '@/components/relatorios/graficos';

// O GRÁFICO DO MISTER NA PÁGINA (versão 5, M5d.1; protótipo `mockups/regem-mister-ouve-ve-mostra.html`, aba "Gráficos"):
// o mesmo desenho da imagem da conversa e do PDF — barras em azul-marinho, a maior em dourado, o valor escrito em cima
// de cada barra (quando cabe; senão só o da maior), a média tracejada, a grade leve e os rótulos que pulam quando não
// cabem. Desenhado em SVG na largura medida da peça (o texto fica no tamanho de verdade, nunca encolhido), com as cores
// do tema (claro e escuro). Os mesmos números em tabela, para quem lê com leitor de tela ou prefere ler.

const ALTURA = 230;
const TOPO = 26; // o espaço do valor da barra mais alta
const BASE = 30; // os rótulos embaixo
const LARGURA_DO_DIGITO = 6.6; // 11 px de JetBrains Mono, por caractere
const LARGURA_DA_LETRA = 6.2; // 11 px de Figtree, por caractere (média)
const BARRA_MAXIMA = 38;

/** Quantos pontos pular entre um rótulo e outro, para não encavalar (o rótulo mais longo + 8 px de folga). */
export function puloDosRotulos(pontos: Ponto[], passo: number): number {
  const maior = Math.max(1, ...pontos.map((p) => p.rotulo.length));
  return Math.max(1, Math.ceil((maior * LARGURA_DA_LETRA + 8) / Math.max(1, passo)));
}

/** O centro do texto preso dentro do gráfico: o texto da ponta nunca sai cortado. */
export function centroDentro(cx: number, larguraDoTexto: number, W: number): number {
  const meio = larguraDoTexto / 2 + 2;
  if (W <= 2 * meio) return W / 2;
  return Math.min(W - meio, Math.max(meio, cx));
}

/** Os valores cabem todos em cima das barras? (Senão, só o da maior.) */
export function valoresCabem(pontos: Ponto[], passo: number): boolean {
  return pontos.every((p) => p.texto.length * LARGURA_DO_DIGITO <= passo - 2);
}

/** O caminho da barra com o topo arredondado (x = a borda esquerda). */
const caminhoDaBarra = (x: number, largura: number, chao: number, h: number) => {
  const r = Math.min(3, h, largura / 2);
  return `M${x},${chao} V${chao - h + r} Q${x},${chao - h} ${x + r},${chao - h} H${x + largura - r} Q${x + largura},${chao - h} ${x + largura},${chao - h + r} V${chao} Z`;
};

/**
 * `anteriores` (versão 5, M5e — o "Por dia" do resumo): o mesmo ponto no período anterior, numa barra clara à esquerda
 * de cada uma (como a imagem da conversa e o PDF), com a legenda e a coluna a mais na tabela.
 */
export function GraficoDoMister({
  legenda,
  pontos,
  linha,
  cabecalho,
  anteriores,
  nomeDoAnterior = 'o período anterior',
}: {
  legenda: string;
  pontos: Ponto[];
  linha: { valor: number; texto: string } | null;
  cabecalho: [string, string];
  anteriores?: number[];
  nomeDoAnterior?: string;
}) {
  const caixa = useRef<HTMLDivElement>(null);
  const [largura, setLargura] = useState(0);
  useEffect(() => {
    const el = caixa.current;
    if (!el) return;
    const medir = () => setLargura(Math.floor(el.clientWidth));
    medir();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(medir);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const n = Math.max(1, pontos.length);
  const iMaior = pontos.reduce((m, p, i) => (p.valor > pontos[m].valor ? i : m), 0);
  const pico = pontos[iMaior];
  const W = Math.max(0, largura);
  const passo = W / n;
  const comAnterior = !!anteriores && anteriores.length === pontos.length && anteriores.some((v) => v > 0);
  const barra = comAnterior ? Math.max(3, Math.min(BARRA_MAXIMA * 0.6, passo * 0.36)) : Math.max(3, Math.min(BARRA_MAXIMA, passo * 0.62));
  /** O centro da barra deste período (com o anterior ao lado, ela fica à direita do meio). */
  const centroDaBarra = (cx: number) => (comAnterior ? cx + 1 + barra / 2 : cx);
  const maior = Math.max(1, ...pontos.map((p) => p.valor), ...(comAnterior ? anteriores! : []), linha?.valor ?? 0) * 1.08;
  const chao = ALTURA - BASE;
  const y = (v: number) => chao - (v / maior) * (chao - TOPO);
  const todos = valoresCabem(pontos, passo);
  const pulo = puloDosRotulos(pontos, passo);

  return (
    <div className="space-y-2">
      {linha && (
        <p className={`flex flex-wrap items-center gap-2 text-sm ${texto2}`}>
          <span aria-hidden="true" className="inline-block w-6 border-t-2 border-dashed border-foreground" />
          {linha.texto}
        </p>
      )}
      <div ref={caixa} className="w-full min-w-0">
        {W > 0 && (
          <svg width={W} height={ALTURA} viewBox={`0 0 ${W} ${ALTURA}`} role="img" aria-label={`${legenda}. Maior valor: ${pico.rotulo}, ${pico.texto}.`} className="block max-w-full">
            {/* a grade leve e o chão */}
            {[1 / 3, 2 / 3].map((f) => (
              <line key={f} x1={0} x2={W} y1={chao - (chao - TOPO) * f} y2={chao - (chao - TOPO) * f} stroke="hsl(var(--border))" strokeWidth={1} />
            ))}
            <line x1={0} x2={W} y1={chao} y2={chao} stroke="hsl(var(--muted-foreground))" strokeOpacity={0.5} strokeWidth={1} />
            {pontos.map((p, i) => {
              const cx = passo * i + passo / 2;
              const topo = y(p.valor);
              const h = Math.max(p.valor > 0 ? 2 : 0, chao - topo);
              const destaque = i === iMaior;
              const ant = comAnterior ? anteriores![i] : 0;
              const hAnt = ant > 0 ? Math.max(2, chao - y(ant)) : 0;
              return (
                <g key={`${p.rotulo}-${i}`}>
                  {hAnt > 0 && (
                    <path d={caminhoDaBarra(cx - 1 - barra, barra, chao, hAnt)} fill="hsl(var(--muted-foreground))" fillOpacity={0.35}>
                      <title>{`${p.rotulo} · ${nomeDoAnterior}`}</title>
                    </path>
                  )}
                  {h > 0 && (
                    <path d={caminhoDaBarra(centroDaBarra(cx) - barra / 2, barra, chao, h)} fill={destaque ? 'hsl(var(--primary))' : 'hsl(var(--foreground))'} fillOpacity={destaque ? 1 : 0.78}>
                      <title>{`${p.rotulo} · ${p.texto}`}</title>
                    </path>
                  )}
                  {i % pulo === 0 && (
                    <text x={centroDentro(cx, p.rotulo.length * LARGURA_DA_LETRA, W)} y={chao + 17} textAnchor="middle" fontSize={11} fill="hsl(var(--muted-foreground))">
                      {p.rotulo}
                    </text>
                  )}
                </g>
              );
            })}
            {linha && <line x1={0} x2={W} y1={y(linha.valor)} y2={y(linha.valor)} stroke="hsl(var(--foreground))" strokeWidth={1.5} strokeDasharray="6 4" />}
            {/* Os valores por último, por cima da linha da média, com a borda da cor do fundo (a linha não risca o número). */}
            {pontos.map((p, i) => {
              if (!todos && i !== iMaior) return null;
              const cx = centroDaBarra(passo * i + passo / 2);
              const h = Math.max(p.valor > 0 ? 2 : 0, chao - y(p.valor));
              return (
                <text
                  key={`v-${p.rotulo}-${i}`}
                  x={centroDentro(cx, p.texto.length * LARGURA_DO_DIGITO, W)}
                  y={chao - h - 6}
                  textAnchor="middle"
                  fontSize={11}
                  fontWeight={700}
                  fill="hsl(var(--foreground))"
                  stroke="hsl(var(--card))"
                  strokeWidth={3}
                  paintOrder="stroke"
                  style={{ fontFamily: 'var(--font-mono, ui-monospace), monospace' }}
                >
                  {p.texto}
                </text>
              );
            })}
          </svg>
        )}
      </div>
      {comAnterior && (
        <p className={`flex flex-wrap items-center gap-x-4 gap-y-1 text-sm ${texto2}`}>
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden="true" className="inline-block h-2.5 w-2.5 rounded-sm bg-foreground/80" /> este período
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden="true" className="inline-block h-2.5 w-2.5 rounded-sm bg-muted-foreground/40" /> {nomeDoAnterior}
          </span>
        </p>
      )}
      <p className={`text-sm ${texto2}`}>
        Maior: <b className="text-foreground">{pico.rotulo}</b> — {pico.texto}.
      </p>
      <details className="text-sm">
        <summary className="inline-flex min-h-10 cursor-pointer items-center font-semibold">Ver em tabela</summary>
        <table className="mt-1 w-full border-collapse">
          <caption className="sr-only">{legenda}</caption>
          <thead>
            <tr className={`border-b border-border text-left text-xs uppercase tracking-wide ${texto2}`}>
              <th scope="col" className="py-1.5 pr-3 font-bold">
                {cabecalho[0]}
              </th>
              <th scope="col" className="py-1.5 text-right font-bold">
                {cabecalho[1]}
              </th>
              {comAnterior && (
                <th scope="col" className="py-1.5 pl-3 text-right font-bold">
                  {nomeDoAnterior}
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {pontos.map((p, i) => (
              <tr key={`${p.rotulo}-${i}`} className="border-b border-border last:border-b-0">
                <th scope="row" className="py-1.5 pr-3 text-left font-normal">
                  {p.rotulo}
                </th>
                <td className="break-words py-1.5 text-right font-mono">{p.texto}</td>
                {comAnterior && <td className="break-words py-1.5 pl-3 text-right font-mono">{(anteriores![i] ?? 0).toLocaleString('pt-BR')}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}
