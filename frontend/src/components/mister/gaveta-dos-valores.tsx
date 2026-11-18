'use client';

import { useId, useState } from 'react';
import { Button } from '@/components/ui/button';
import { texto2 } from '@/components/ui/lista';
import { Gaveta } from '@/components/ui/sobreposto';

// OS VALORES DO ALERTA DE GASTO (G2 do protótipo `mockups/regem-whatsapp-gasto.html`, aprovado em 18/11/2026): até 10
// valores em reais; cada um avisa uma vez por mês, quando o gasto do mês na Meta passa dele. Sem valores, a gaveta sugere
// R$ 100, R$ 200 e R$ 400 (decisão 4). "Aplicar" leva os valores para a barra de "Salvar" da tela, em ordem; o servidor
// confere as mesmas regras (`conferirValoresDoGasto`).

export const VALORES_MAX = 10;
const SUGESTAO = [100, 200, 400];

/** "1.284,90" ↔ 1284.9 (o campo aceita "1284,9", "1.284,90" e "1284.90"). */
export const textoDoValor = (n: number) => n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export function lerValor(t: string): number | null {
  const s = t.trim().replace(/\s+/g, '');
  if (!s) return null;
  const normal = s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s;
  const n = Number(normal);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : NaN;
}

/** A conferência da tela (a mesma do servidor): devolve os valores em ordem ou a frase do que está errado e em qual linha. */
export function conferirValores(textos: string[]): { valores: number[] } | { erro: string; linha: number } {
  const vistos: number[] = [];
  for (let i = 0; i < textos.length; i++) {
    const v = lerValor(textos[i]);
    if (v === null) return { erro: `Escreva o valor do alerta ${i + 1}, ou tire a linha.`, linha: i };
    if (Number.isNaN(v) || v < 1 || v > 100000) return { erro: `O alerta ${i + 1} precisa ser um valor entre R$ 1,00 e R$ 100.000,00.`, linha: i };
    if (vistos.includes(v)) return { erro: `O valor R$ ${textoDoValor(v)} está repetido.`, linha: i };
    vistos.push(v);
  }
  return { valores: [...vistos].sort((a, b) => a - b) };
}

export function GavetaDosValores({
  valores,
  custoDoMes,
  aoAplicar,
  aoFechar,
}: {
  valores: number[];
  /** O gasto do mês até agora, quando a tela sabe (mostra quanto falta para cada valor). */
  custoDoMes?: number | null;
  aoAplicar: (valores: number[]) => void;
  aoFechar: () => void;
}) {
  const base = useId();
  const sugerido = valores.length === 0;
  const [linhas, setLinhas] = useState<string[]>((sugerido ? SUGESTAO : valores).map(textoDoValor));
  const [erro, setErro] = useState<{ erro: string; linha: number } | null>(null);

  const situacao = (t: string): string => {
    const v = lerValor(t);
    if (v === null || Number.isNaN(v) || custoDoMes === null || custoDoMes === undefined) return '';
    return v <= custoDoMes ? 'o mês já passou deste valor: avisa na próxima leitura, uma vez' : `faltam R$ ${textoDoValor(Math.round((v - custoDoMes) * 100) / 100)}`;
  };
  const aplicar = () => {
    const r = conferirValores(linhas);
    if ('erro' in r) {
      setErro(r);
      return;
    }
    aoAplicar(r.valores);
  };
  return (
    <Gaveta
      titulo="Valores do alerta de gasto"
      aoFechar={aoFechar}
      rodape={
        <>
          <Button type="button" variant="outline" onClick={aoFechar}>
            Cancelar
          </Button>
          <Button type="button" onClick={aplicar}>
            Aplicar
          </Button>
        </>
      }
    >
      <p className={`text-sm ${texto2}`}>
        Cada valor avisa uma vez por mês, quando o gasto do mês na Meta passa dele. No dia 1º tudo recomeça. Até {VALORES_MAX} valores; o Regem põe em ordem.
      </p>
      {sugerido && <p className={`mt-2 text-sm ${texto2}`}>Sugestão para começar: R$ 100, R$ 200 e R$ 400. Mude como quiser.</p>}
      {custoDoMes !== null && custoDoMes !== undefined && (
        <p className="mt-2 text-sm">
          Gasto deste mês até agora: <span className="font-mono font-semibold">R$ {textoDoValor(custoDoMes)}</span>
        </p>
      )}
      <ol className="mt-4 space-y-3">
        {linhas.map((t, i) => {
          const id = `${base}-valor-${i}`;
          const st = situacao(t);
          return (
            <li key={id} className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-2">
              <div className="grid min-w-0 gap-1">
                <label htmlFor={id} className="text-sm font-semibold">
                  Alerta {i + 1}
                </label>
                <div
                  className={`flex min-h-11 items-center rounded-md border bg-card px-3 focus-within:ring-2 focus-within:ring-ring ${erro?.linha === i ? 'border-destructive' : 'border-input'}`}
                >
                  <span className={`mr-2 font-mono text-sm ${texto2}`} aria-hidden="true">
                    R$
                  </span>
                  <input
                    id={id}
                    inputMode="decimal"
                    autoComplete="off"
                    className="min-h-10 w-full min-w-0 bg-transparent font-mono outline-none"
                    value={t}
                    aria-invalid={erro?.linha === i}
                    aria-describedby={st ? `${id}-st` : undefined}
                    onChange={(e) => {
                      const v = e.target.value;
                      setLinhas((l) => l.map((x, k) => (k === i ? v : x)));
                      setErro(null);
                    }}
                  />
                </div>
                {st && (
                  <span id={`${id}-st`} className={`text-xs ${texto2}`}>
                    {st}
                  </span>
                )}
              </div>
              <Button
                type="button"
                variant="outline"
                className="min-h-11"
                aria-label={`Tirar o alerta ${i + 1}`}
                onClick={() => {
                  setLinhas((l) => l.filter((_, k) => k !== i));
                  setErro(null);
                }}
              >
                Tirar
              </Button>
            </li>
          );
        })}
      </ol>
      <Button
        type="button"
        variant="outline"
        className="mt-3"
        disabled={linhas.length >= VALORES_MAX}
        onClick={() => {
          const maior = linhas.map(lerValor).filter((v): v is number => typeof v === 'number' && !Number.isNaN(v)).reduce((a, b) => Math.max(a, b), 0);
          setLinhas((l) => [...l, textoDoValor(maior ? Math.min(100000, maior * 2) : 100)]);
          setErro(null);
        }}
      >
        {linhas.length >= VALORES_MAX ? `Máximo de ${VALORES_MAX} valores` : '＋ Novo valor'}
      </Button>
      {erro && (
        <p role="alert" className="mt-3 text-sm font-medium text-destructive">
          {erro.erro}
        </p>
      )}
      {linhas.length === 0 && <p className={`mt-3 text-sm ${texto2}`}>Sem valores, o alerta de gasto só pode ficar desligado.</p>}
      <p className={`mt-4 text-xs ${texto2}`}>
        Como chega pelo WhatsApp: &quot;O gasto do WhatsApp oficial de novembro passou de R$ 200,00. R$ 201,40 até agora… Próximo alerta: R$ 400,00.&quot;
      </p>
    </Gaveta>
  );
}
