'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { texto2 } from '@/components/ui/lista';
import { medidaParaA99, medidaParaOIfood, prepararFotoParaOIfood, recorteCentral, type FotosDoProduto } from '@/lib/conferencia-apps';

// As fotos do produto nos apps, lado a lado com a do Regem (R3 F6/F6b/F6c; protótipo `mockups/regem-conciliacao-ifood.html`,
// "Fotos" e decisão 16): a de cada app pela ÚLTIMA leitura da conferência (`imagem` no Orzuni, `head_img` na 99). A foto
// do Regem vai a cada app pelo botão dele, já salva:
//   • 99 — pelo endereço público dela (150 a 3000 px de lado), pela fila da 99;
//   • iFood — pela porta do Orzuni, na hora. Se a foto já serve (quadrada, 300 px ou mais, JPG/PNG), vai como está; se
//     não (retangular, WEBP…), vai uma CÓPIA enquadrada no quadrado do centro, feita aqui — a foto do Regem não muda
//     (pedido do dono, 11/11). A prévia mostra o recorte.
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
  aoMandarIfood?: (imagem?: string) => Promise<void>;
}) {
  const [medida, setMedida] = useState<{ w: number; h: number } | null>(null);
  const [mandando, setMandando] = useState<'99' | 'ifood' | null>(null);
  const [erroIfood, setErroIfood] = useState('');
  useEffect(() => {
    setMedida(null);
    setErroIfood('');
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

  const botao = (app: '99' | 'ifood', rotulo: string, desligado: boolean, aoClicar: () => Promise<void>) => (
    <Button
      type="button"
      size="sm"
      variant="outline"
      disabled={mandando !== null || !fotoSalva || naoSalva || desligado}
      onClick={async () => {
        setMandando(app);
        try {
          await aoClicar();
        } finally {
          setMandando(null);
        }
      }}
    >
      {mandando === app ? (app === 'ifood' ? 'Preparando e mandando…' : 'Mandando…') : rotulo}
    </Button>
  );

  // iFood: serve como está, vai enquadrada (com a prévia do recorte) ou é pequena demais.
  const recorte = medida ? recorteCentral(medida.w, medida.h) : null;
  const ifoodServe = medida ? medidaParaOIfood(medida.w, medida.h) : null;
  const ifoodPequena = !!medida && !recorte;
  const blocoIfood = mandaIfood && (
    <div className="space-y-1">
      {medida && (
        <p className={`text-xs ${ifoodPequena ? 'text-destructive' : texto2}`}>
          A foto do Regem tem {medida.w} × {medida.h} px:{' '}
          {ifoodServe
            ? 'serve para o iFood.'
            : recorte
              ? `vai ao iFood enquadrada no quadrado do centro (${recorte.saida} × ${recorte.saida} px). A foto do Regem não muda.`
              : 'o iFood pede 300 px de lado ou mais — use uma maior.'}
        </p>
      )}
      {medida && recorte && !ifoodServe && (
        <figure className="space-y-1">
          <figcaption className={`text-xs ${texto2}`}>Vai assim ao iFood:</figcaption>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={fotoDoRegem} alt="Prévia da foto enquadrada para o iFood" className="h-24 w-24 rounded-md border border-border object-cover object-center" />
        </figure>
      )}
      {botao('ifood', 'Mandar esta foto ao iFood', ifoodPequena, async () => {
        setErroIfood('');
        const prep = await prepararFotoParaOIfood(fotoSalva);
        if ('erro' in prep) {
          setErroIfood(prep.erro);
          return;
        }
        await (aoMandarIfood as (imagem?: string) => Promise<void>)(prep.imagem);
      })}
      {erroIfood && (
        <p role="alert" className="text-xs text-destructive">
          {erroIfood}
        </p>
      )}
    </div>
  );
  const serve99 = medida ? medidaParaA99(medida.w, medida.h) : null;
  const bloco99 = manda99 && (
    <div className="space-y-1">
      {medida && (
        <p className={`text-xs ${serve99 ? texto2 : 'text-destructive'}`}>
          A foto do Regem tem {medida.w} × {medida.h} px: {serve99 ? 'serve para a 99.' : 'a 99 pede de 150 a 3000 px de lado.'}
        </p>
      )}
      {botao('99', 'Mandar esta foto à 99', serve99 === false, aoMandar99 as () => Promise<void>)}
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
      {blocoIfood}
      {bloco99}
      {noIfood && !mandaIfood && avisoIfood}
    </div>
  );
}
