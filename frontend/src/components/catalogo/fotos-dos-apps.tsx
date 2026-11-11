'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { texto2 } from '@/components/ui/lista';
import { medidaParaA99, type FotosDoProduto } from '@/lib/conferencia-apps';

// As fotos do produto nos apps, lado a lado com a do Regem (R3 F6; protótipo `mockups/regem-conciliacao-ifood.html`, "Fotos" e
// decisão 16): a de cada app pela ÚLTIMA leitura da conferência (`imagem` no Orzuni, `head_img` na 99). A 99 recebe a foto do
// Regem pelo endereço público dela ("Mandar esta foto à 99"; 150 a 3000 px de lado — a tela mede); o iFood ainda não (o
// Orzuni não tem a ferramenta): a foto de lá muda no Gestor de Pedidos.
export function FotosDosApps({
  fotoDoRegem,
  fotoSalva,
  fotos,
  noIfood,
  na99,
  aoMandar99,
}: {
  /** A foto na gaveta agora (pode não estar salva). */
  fotoDoRegem: string;
  /** A foto que está gravada no produto (é ela que vai à 99). */
  fotoSalva: string;
  fotos: FotosDoProduto;
  noIfood: boolean;
  na99: boolean;
  aoMandar99?: () => Promise<void>;
}) {
  const [medida, setMedida] = useState<{ w: number; h: number } | null>(null);
  const [mandando, setMandando] = useState(false);
  useEffect(() => {
    setMedida(null);
    if (!fotoDoRegem) return;
    const img = new Image();
    img.onload = () => setMedida({ w: img.naturalWidth, h: img.naturalHeight });
    img.src = fotoDoRegem;
  }, [fotoDoRegem]);
  const medidaOk = medida ? medidaParaA99(medida.w, medida.h) : null;
  const naoSalva = fotoDoRegem !== fotoSalva;
  const quadro = (titulo: string, url: string | null | undefined, aviso: string) => (
    <figure className="min-w-0 space-y-1">
      <figcaption className="text-xs font-semibold">{titulo}</figcaption>
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt={`Foto ${titulo}`} className="h-24 w-24 rounded-md border border-border object-cover" loading="lazy" />
      ) : (
        <span className={`grid h-24 w-24 place-items-center rounded-md border border-dashed border-border px-1 text-center text-xs ${texto2}`}>{aviso}</span>
      )}
    </figure>
  );
  const lidoIfood = noIfood && fotos.ifood !== undefined;
  const lido99 = na99 && fotos['99food'] !== undefined;
  const avisoIfood = <p className={`text-xs ${texto2}`}>A foto vale para o balcão e o cardápio digital. No iFood, a foto muda no Gestor de Pedidos.</p>;
  if (!lidoIfood && !lido99 && !(na99 && aoMandar99)) return noIfood ? avisoIfood : null;
  return (
    <div className="space-y-2 rounded-md border border-border p-2">
      <p className={`text-xs ${texto2}`}>Nos apps, pela última leitura de &quot;Conferir com os apps&quot;:</p>
      <div className="flex flex-wrap gap-3">
        {lidoIfood && quadro('no iFood', fotos.ifood, 'sem foto no iFood')}
        {lido99 && quadro('na 99', fotos['99food'], 'sem foto na 99')}
      </div>
      {na99 && aoMandar99 && (
        <div className="space-y-1">
          {medida && (
            <p className={`text-xs ${medidaOk ? texto2 : 'text-destructive'}`}>
              A foto do Regem tem {medida.w} × {medida.h} px: {medidaOk ? 'serve para a 99.' : 'a 99 pede de 150 a 3000 px de lado.'}
            </p>
          )}
          {naoSalva && <p className={`text-xs ${texto2}`}>Salve a foto nova antes de mandar à 99.</p>}
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={mandando || !fotoSalva || naoSalva || medidaOk === false}
            onClick={async () => {
              setMandando(true);
              try {
                await aoMandar99();
              } finally {
                setMandando(false);
              }
            }}
          >
            {mandando ? 'Mandando…' : 'Mandar esta foto à 99'}
          </Button>
        </div>
      )}
      {noIfood && avisoIfood}
    </div>
  );
}
