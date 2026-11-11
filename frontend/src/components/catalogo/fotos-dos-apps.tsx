'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { texto2 } from '@/components/ui/lista';
import { medidaParaA99, medidaParaOIfood, type FotosDoProduto } from '@/lib/conferencia-apps';

// As fotos do produto nos apps, lado a lado com a do Regem (R3 F6/F6b; protótipo `mockups/regem-conciliacao-ifood.html`,
// "Fotos" e decisão 16): a de cada app pela ÚLTIMA leitura da conferência (`imagem` no Orzuni, `head_img` na 99). A foto
// do Regem vai a cada app pelo botão dele, já salva:
//   • 99 — pelo endereço público dela (150 a 3000 px de lado), pela fila da 99;
//   • iFood — pela porta do Orzuni, na hora (quadrada, 300 px de lado ou mais, até 8 MB; o servidor confere de novo).
// A tela mede a foto e diz se ela serve para cada um.
export function FotosDosApps({
  fotoDoRegem,
  fotoSalva,
  fotos,
  noIfood,
  na99,
  aoMandar99,
  aoMandarIfood,
}: {
  /** A foto na gaveta agora (pode não estar salva). */
  fotoDoRegem: string;
  /** A foto que está gravada no produto (é ela que vai aos apps). */
  fotoSalva: string;
  fotos: FotosDoProduto;
  noIfood: boolean;
  na99: boolean;
  aoMandar99?: () => Promise<void>;
  aoMandarIfood?: () => Promise<void>;
}) {
  const [medida, setMedida] = useState<{ w: number; h: number } | null>(null);
  const [mandando, setMandando] = useState<'99' | 'ifood' | null>(null);
  useEffect(() => {
    setMedida(null);
    if (!fotoDoRegem) return;
    const img = new Image();
    img.onload = () => setMedida({ w: img.naturalWidth, h: img.naturalHeight });
    img.src = fotoDoRegem;
  }, [fotoDoRegem]);
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
  const mandaIfood = noIfood && !!aoMandarIfood;
  const manda99 = na99 && !!aoMandar99;
  const avisoIfood = <p className={`text-xs ${texto2}`}>A foto vale para o balcão e o cardápio digital. No iFood, a foto muda no Gestor de Pedidos.</p>;
  if (!lidoIfood && !lido99 && !manda99 && !mandaIfood) return noIfood ? avisoIfood : null;

  const botao = (app: '99' | 'ifood', rotulo: string, serve: boolean | null, pede: string, aoMandar: () => Promise<void>) => (
    <div className="space-y-1">
      {medida && (
        <p className={`text-xs ${serve ? texto2 : 'text-destructive'}`}>
          A foto do Regem tem {medida.w} × {medida.h} px: {serve ? `serve para ${app === '99' ? 'a 99' : 'o iFood'}.` : pede}
        </p>
      )}
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={mandando !== null || !fotoSalva || naoSalva || serve === false}
        onClick={async () => {
          setMandando(app);
          try {
            await aoMandar();
          } finally {
            setMandando(null);
          }
        }}
      >
        {mandando === app ? 'Mandando…' : rotulo}
      </Button>
    </div>
  );

  return (
    <div className="space-y-2 rounded-md border border-border p-2">
      {(lidoIfood || lido99) && (
        <>
          <p className={`text-xs ${texto2}`}>Nos apps, pela última leitura de &quot;Conferir com os apps&quot;:</p>
          <div className="flex flex-wrap gap-3">
            {lidoIfood && quadro('no iFood', fotos.ifood, 'sem foto no iFood')}
            {lido99 && quadro('na 99', fotos['99food'], 'sem foto na 99')}
          </div>
        </>
      )}
      {(manda99 || mandaIfood) && naoSalva && <p className={`text-xs ${texto2}`}>Salve a foto nova antes de mandar aos apps.</p>}
      {mandaIfood &&
        botao(
          'ifood',
          'Mandar esta foto ao iFood',
          medida ? medidaParaOIfood(medida.w, medida.h) : null,
          'o iFood pede foto quadrada, de 300 px de lado ou mais.',
          aoMandarIfood as () => Promise<void>,
        )}
      {manda99 &&
        botao(
          '99',
          'Mandar esta foto à 99',
          medida ? medidaParaA99(medida.w, medida.h) : null,
          'a 99 pede de 150 a 3000 px de lado.',
          aoMandar99 as () => Promise<void>,
        )}
      {noIfood && !mandaIfood && avisoIfood}
    </div>
  );
}
