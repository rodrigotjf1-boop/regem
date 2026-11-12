'use client';

import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialogo } from '@/components/ui/sobreposto';
import { texto2 } from '@/components/ui/lista';
import { LADO_DA_COPIA_IFOOD, limitarRecorte, mudarLadoDoRecorte, previaDoRecorte, recorteCentral, type Recorte } from '@/lib/conferencia-apps';

// "Ajustar o recorte" (R3 G2, pedido do dono 11/11): o quadrado que vai ao iFood, escolhido à mão em vez do centro. A
// foto aparece inteira com o quadrado por cima: arrastar (mouse ou dedo) ou as setas do teclado movem (Shift = passo
// maior); "Tamanho" muda o lado mantendo o centro. Vale para este envio ao iFood — a foto do Regem não muda.
export function RecorteDaFoto({
  url,
  largura,
  altura,
  inicial,
  aoUsar,
  aoFechar,
}: {
  url: string;
  largura: number;
  altura: number;
  inicial: Recorte | null;
  aoUsar: (r: Recorte) => void;
  aoFechar: () => void;
}) {
  const centro = recorteCentral(largura, altura);
  const [r, setR] = useState<Recorte | null>(() => (inicial ? limitarRecorte(largura, altura, inicial) : centro ? { sx: centro.sx, sy: centro.sy, lado: centro.lado } : null));
  const caixa = useRef<HTMLDivElement>(null);
  const arrasto = useRef<{ x: number; y: number; r: Recorte } | null>(null);
  if (!r) return null;
  const maior = Math.floor(Math.min(largura, altura));
  const mover = (dx: number, dy: number) => setR((a) => (a ? limitarRecorte(largura, altura, { ...a, sx: a.sx + dx, sy: a.sy + dy }) : a));
  const pct = (v: number, t: number) => `${(v / t) * 100}%`;
  const previa = previaDoRecorte(largura, altura, r);
  return (
    <Dialogo
      titulo="Ajustar o recorte para o iFood"
      aoFechar={aoFechar}
      largura="lg"
      rodape={
        <>
          <Button type="button" variant="outline" onClick={() => centro && setR({ sx: centro.sx, sy: centro.sy, lado: centro.lado })}>
            Voltar ao centro
          </Button>
          <Button type="button" variant="outline" onClick={aoFechar}>
            Cancelar
          </Button>
          <Button type="button" onClick={() => aoUsar(r)}>
            Usar este recorte
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <p className={`text-sm ${texto2}`}>
          Arraste o quadrado (ou use as setas do teclado) e escolha o tamanho. Vale para este envio ao iFood; a foto do Regem
          não muda.
        </p>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-[minmax(0,1fr)_auto]">
          <div className="min-w-0">
            <div ref={caixa} className="relative mx-auto w-full max-w-[34rem] touch-none select-none overflow-hidden rounded-md border border-border">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={url} alt="A foto do Regem inteira" className="block h-auto w-full" draggable={false} />
              <div
                role="group"
                tabIndex={0}
                aria-label={`Área do recorte: ${r.lado} × ${r.lado} px a partir de ${r.sx}, ${r.sy}. Use as setas para mover.`}
                className="absolute cursor-move rounded-sm outline-none ring-2 ring-primary shadow-[0_0_0_9999px_rgb(0_0_0/0.45)] focus-visible:ring-4"
                style={{ left: pct(r.sx, largura), top: pct(r.sy, altura), width: pct(r.lado, largura), height: pct(r.lado, altura) }}
                onPointerDown={(e) => {
                  (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
                  arrasto.current = { x: e.clientX, y: e.clientY, r };
                }}
                onPointerMove={(e) => {
                  const a = arrasto.current;
                  const el = caixa.current;
                  if (!a || !el) return;
                  const k = largura / el.clientWidth;
                  setR(limitarRecorte(largura, altura, { ...a.r, sx: a.r.sx + (e.clientX - a.x) * k, sy: a.r.sy + (e.clientY - a.y) * k }));
                }}
                onPointerUp={() => (arrasto.current = null)}
                onPointerCancel={() => (arrasto.current = null)}
                onKeyDown={(e) => {
                  const passo = Math.max(1, Math.round((e.shiftKey ? 0.1 : 0.01) * maior));
                  const d: Record<string, [number, number]> = { ArrowLeft: [-passo, 0], ArrowRight: [passo, 0], ArrowUp: [0, -passo], ArrowDown: [0, passo] };
                  if (!d[e.key]) return;
                  e.preventDefault();
                  mover(...d[e.key]);
                }}
              />
            </div>
          </div>
          <div className="space-y-3 md:w-48">
            <label className="block space-y-1 text-sm">
              <span className="font-medium">Tamanho do recorte</span>
              <input
                type="range"
                min={300}
                max={maior}
                step={1}
                value={r.lado}
                disabled={maior <= 300}
                onChange={(e) => setR((a) => (a ? mudarLadoDoRecorte(largura, altura, a, Number(e.target.value)) : a))}
                className="w-full accent-primary"
              />
              <span className={`block text-xs ${texto2}`}>
                {r.lado} × {r.lado} px na foto · vai com {Math.min(r.lado, LADO_DA_COPIA_IFOOD)} px de lado
              </span>
            </label>
            <figure className="space-y-1">
              <figcaption className={`text-xs ${texto2}`}>Vai assim ao iFood:</figcaption>
              <div
                role="img"
                aria-label="Prévia do recorte para o iFood"
                className="h-24 w-24 rounded-md border border-border bg-no-repeat"
                style={{ backgroundImage: `url(${JSON.stringify(url)})`, ...previa }}
              />
            </figure>
          </div>
        </div>
      </div>
    </Dialogo>
  );
}
