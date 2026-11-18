'use client';

import { useEffect, useRef, useState } from 'react';
import { Card } from '@/components/ui/card';
import { texto2 } from '@/components/ui/lista';

// Gráficos dos relatórios (mockup `mockups/regem-relatorios.html`). O número fica ESCRITO: nada
// depende de passar o mouse. A cor é `--dado` (o dourado de ação é claro demais para barra fina).

export type Ponto = { rotulo: string; valor: number; texto: string };

/** Barras deitadas: nome, o número escrito e a barra embaixo — nunca passa da largura do cartão. */
export function Barras({ legenda, linhas }: { legenda: string; linhas: Ponto[] }) {
  const maior = Math.max(1, ...linhas.map((l) => l.valor));
  return (
    <Card className="p-4">
      <ul className="space-y-3" aria-label={legenda}>
        {linhas.map((l) => (
          <li key={l.rotulo} className="space-y-1">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 text-sm">
              <span className="min-w-0 break-words font-semibold capitalize">{l.rotulo}</span>
              <span className="font-mono">{l.texto}</span>
            </div>
            <div className="h-2 rounded-full bg-secondary" aria-hidden="true">
              <div className="h-2 rounded-full bg-[hsl(var(--dado))]" style={{ width: `${Math.max(2, Math.round((l.valor / maior) * 100))}%` }} />
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}

/** A letra dos rótulos das colunas tem 10 px: cada caractere ocupa perto de 5,2 px, mais o respiro entre dois rótulos. */
const LARGURA_DO_CARACTERE = 5.2;
const RESPIRO_DO_ROTULO = 4;
/** O teto de cada coluna (`max-w-12`) mais o vão entre elas. */
const PASSO_MAXIMO = 52;

/**
 * De quantas em quantas colunas se escreve o rótulo, para um não encostar no outro. A regra de sempre (muitas colunas:
 * perto de 10 rótulos) é o piso; com a largura da peça medida, o rótulo comprido ("20/10") em peça estreita pula mais.
 */
export function passoDosRotulos(pontos: Ponto[], largura: number | null): number {
  const porContagem = pontos.length > 16 ? Math.ceil(pontos.length / 10) : 1;
  if (!largura || !pontos.length) return porContagem;
  const precisa = Math.max(...pontos.map((p) => p.rotulo.length)) * LARGURA_DO_CARACTERE + RESPIRO_DO_ROTULO;
  const passo = Math.min(PASSO_MAXIMO, largura / pontos.length);
  return Math.max(porContagem, Math.ceil(precisa / passo));
}

/**
 * Quais colunas levam o rótulo escrito: uma a cada `passoDosRotulos`, menos a que não cabe até o fim da linha (o texto
 * começa na coluna dele e a linha corta o que passa) — o número de todas continua em "Maior" e em "Ver em tabela".
 */
export function rotulosEscritos(pontos: Ponto[], largura: number | null): boolean[] {
  const pula = passoDosRotulos(pontos, largura);
  if (!largura) return pontos.map((_, i) => i % pula === 0);
  const passo = Math.min(PASSO_MAXIMO, largura / pontos.length);
  return pontos.map((p, i) => i % pula === 0 && (pontos.length - i) * passo >= p.rotulo.length * LARGURA_DO_CARACTERE);
}

/** Colunas (por dia, por hora, por mês) + o maior valor escrito + os mesmos números em tabela. */
export function Colunas({ legenda, pontos, cabecalho }: { legenda: string; pontos: Ponto[]; cabecalho: [string, string] }) {
  const maior = Math.max(1, ...pontos.map((p) => p.valor));
  const pico = pontos.reduce((a, b) => (b.valor > a.valor ? b : a), pontos[0]);
  // A largura da linha dos rótulos, medida depois do primeiro desenho (antes dela vale a regra pela contagem).
  const linhaDosRotulos = useRef<HTMLDivElement>(null);
  const [largura, setLargura] = useState<number | null>(null);
  useEffect(() => {
    const el = linhaDosRotulos.current;
    if (!el) return;
    const medir = () => setLargura(el.clientWidth || null);
    medir();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(medir);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  // Muitas colunas ou rótulo comprido em peça estreita: escreve um rótulo a cada tantas, para não encavalar.
  const escrito = rotulosEscritos(pontos, largura);
  return (
    <Card className="space-y-2 p-4">
      {/* Poucas colunas não se esticam pela largura toda: cada uma tem um teto, e o conjunto fica à esquerda.
          As barras são filhas diretas da caixa de altura fixa (é o que faz a altura em % valer); os
          rótulos vão numa linha própria, com a mesma regra de largura, para caírem embaixo de cada barra. */}
      <div className="flex h-32 items-end gap-0.5 border-b border-border sm:gap-1" role="img" aria-label={`${legenda}. Maior valor: ${pico.rotulo}, ${pico.texto}.`}>
        {pontos.map((p) => (
          <div key={p.rotulo} className="min-h-[2px] min-w-0 max-w-12 flex-1 rounded-t bg-[hsl(var(--dado))]" style={{ height: `${Math.max(1, Math.round((p.valor / maior) * 100))}%` }} title={`${p.rotulo} · ${p.texto}`} />
        ))}
      </div>
      <div ref={linhaDosRotulos} className="flex gap-0.5 overflow-hidden sm:gap-1" aria-hidden="true">
        {pontos.map((p, i) => (
          <span key={p.rotulo} className={`min-w-0 max-w-12 flex-1 overflow-visible whitespace-nowrap text-center text-[10px] ${texto2}`}>{escrito[i] ? p.rotulo : ''}</span>
        ))}
      </div>
      <p className={`text-sm ${texto2}`}>
        Maior: <b className="text-foreground">{pico.rotulo}</b> — {pico.texto}.
      </p>
      <details className="text-sm">
        <summary className="inline-flex min-h-10 cursor-pointer items-center font-semibold">Ver em tabela</summary>
        <table className="mt-1 w-full border-collapse">
          <caption className="sr-only">{legenda}</caption>
          <thead>
            <tr className={`border-b border-border text-left text-xs uppercase tracking-wide ${texto2}`}>
              <th scope="col" className="py-1.5 pr-3 font-bold">{cabecalho[0]}</th>
              <th scope="col" className="py-1.5 text-right font-bold">{cabecalho[1]}</th>
            </tr>
          </thead>
          <tbody>
            {pontos.map((p) => (
              <tr key={p.rotulo} className="border-b border-border last:border-b-0">
                <th scope="row" className="py-1.5 pr-3 text-left font-normal">{p.rotulo}</th>
                <td className="break-words py-1.5 text-right font-mono">{p.texto}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </Card>
  );
}
