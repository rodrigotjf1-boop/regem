'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { texto2 } from '@/components/ui/lista';
import {
  LADO_DA_COPIA_IFOOD,
  medidaParaA99,
  medidaParaOIfood,
  prepararFotoParaOIfood,
  previaDoRecorte,
  recorteCentral,
  type FotosDoProduto,
  type Recorte,
} from '@/lib/conferencia-apps';
import { RecorteDaFoto } from '@/components/catalogo/recorte-da-foto';

// As fotos do produto nos apps, lado a lado com a do Regem (R3 F6/F6b/F6c; protótipo `mockups/regem-conciliacao-ifood.html`,
// "Fotos" e decisão 16): a de cada app pela ÚLTIMA leitura da conferência (`imagem` no Orzuni, `head_img` na 99). A foto
// do Regem vai a cada app pelo botão dele, já salva:
//   • 99 — pelo endereço público dela (150 a 3000 px de lado), pela fila da 99;
//   • iFood — pela porta do Orzuni, na hora. Se a foto já serve (quadrada, 300 px ou mais, JPG/PNG), vai como está; se
//     não (retangular, WEBP…), vai uma CÓPIA enquadrada no quadrado do centro, feita aqui — a foto do Regem não muda
//     (pedido do dono, 11/11). A prévia mostra o recorte; "Ajustar o recorte" (R3 G2) escolhe outro quadrado à mão.
//   • "Usar esta no Regem" (R3 G1) — a foto de um app vem para o campo da foto (a pessoa salva).
export function FotosDosApps({
  fotoDoRegem,
  fotoSalva,
  fotos,
  noIfood,
  na99,
  aoMandar99,
  aoMandarIfood,
  aoUsarFoto,
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
  /** "Usar esta no Regem" (R3 G1): a foto do app vem para o campo da foto (a pessoa salva). */
  aoUsarFoto?: (canal: 'ifood' | '99food') => Promise<void>;
}) {
  const [medida, setMedida] = useState<{ w: number; h: number } | null>(null);
  const [mandando, setMandando] = useState<'99' | 'ifood' | null>(null);
  const [trazendo, setTrazendo] = useState<'ifood' | '99food' | null>(null);
  const [erroIfood, setErroIfood] = useState('');
  // R3 G2: o recorte escolhido à mão (null = o centro) e o diálogo de ajustar.
  const [escolhido, setEscolhido] = useState<Recorte | null>(null);
  const [ajustando, setAjustando] = useState(false);
  useEffect(() => {
    setMedida(null);
    setErroIfood('');
    setEscolhido(null);
    if (!fotoDoRegem) return;
    const img = new Image();
    img.onload = () => setMedida({ w: img.naturalWidth, h: img.naturalHeight });
    img.src = fotoDoRegem;
  }, [fotoDoRegem]);
  const naoSalva = fotoDoRegem !== fotoSalva;
  const quadro = (titulo: string, url: string | null | undefined, aviso: string, canal: 'ifood' | '99food') => (
    <figure className="min-w-0 space-y-1">
      <figcaption className="text-xs font-semibold">{titulo}</figcaption>
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt={`Foto ${titulo}`} className="h-24 w-24 rounded-md border border-border object-cover" loading="lazy" />
      ) : (
        <span className={`grid h-24 w-24 place-items-center rounded-md border border-dashed border-border px-1 text-center text-xs ${texto2}`}>{aviso}</span>
      )}
      {url && aoUsarFoto && (
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={trazendo !== null || mandando !== null}
          aria-label={`Usar a foto ${titulo} no Regem`}
          onClick={async () => {
            setTrazendo(canal);
            try {
              await aoUsarFoto(canal);
            } finally {
              setTrazendo(null);
            }
          }}
        >
          {trazendo === canal ? 'Trazendo…' : 'Usar esta no Regem'}
        </Button>
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

  // iFood: serve como está, vai enquadrada (o centro ou o recorte escolhido, com a prévia) ou é pequena demais.
  const recorte = medida ? recorteCentral(medida.w, medida.h) : null;
  const ifoodServe = medida ? medidaParaOIfood(medida.w, medida.h) : null;
  const ifoodPequena = !!medida && !recorte;
  const enquadra = !!medida && !!recorte && !ifoodServe;
  const vale = medida && enquadra ? (escolhido ?? { sx: recorte!.sx, sy: recorte!.sy, lado: recorte!.lado }) : null;
  const blocoIfood = mandaIfood && (
    <div className="space-y-1">
      {medida && (
        <p className={`text-xs ${ifoodPequena ? 'text-destructive' : texto2}`}>
          A foto do Regem tem {medida.w} × {medida.h} px:{' '}
          {ifoodServe
            ? 'serve para o iFood.'
            : vale
              ? `vai ao iFood enquadrada ${escolhido ? 'no recorte escolhido' : 'no quadrado do centro'} (${Math.min(vale.lado, LADO_DA_COPIA_IFOOD)} × ${Math.min(vale.lado, LADO_DA_COPIA_IFOOD)} px). A foto do Regem não muda.`
              : 'o iFood pede 300 px de lado ou mais — use uma maior.'}
        </p>
      )}
      {medida && vale && (
        <div className="flex flex-wrap items-end gap-3">
          <figure className="space-y-1">
            <figcaption className={`text-xs ${texto2}`}>Vai assim ao iFood:</figcaption>
            <div
              role="img"
              aria-label="Prévia da foto enquadrada para o iFood"
              className="h-24 w-24 rounded-md border border-border bg-no-repeat"
              style={{ backgroundImage: `url(${JSON.stringify(fotoDoRegem)})`, ...previaDoRecorte(medida.w, medida.h, vale) }}
            />
          </figure>
          <Button type="button" size="sm" variant="ghost" disabled={mandando !== null} onClick={() => setAjustando(true)}>
            Ajustar o recorte
          </Button>
        </div>
      )}
      {ajustando && medida && (
        <RecorteDaFoto
          url={fotoDoRegem}
          largura={medida.w}
          altura={medida.h}
          inicial={escolhido}
          aoFechar={() => setAjustando(false)}
          aoUsar={(r) => {
            setEscolhido(r);
            setAjustando(false);
          }}
        />
      )}
      {botao('ifood', 'Mandar esta foto ao iFood', ifoodPequena, async () => {
        setErroIfood('');
        const prep = await prepararFotoParaOIfood(fotoSalva, enquadra ? escolhido : null);
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
            {lidoIfood && quadro('no iFood', fotos.ifood, 'sem foto no iFood', 'ifood')}
            {lido99 && quadro('na 99', fotos['99food'], 'sem foto na 99', '99food')}
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
