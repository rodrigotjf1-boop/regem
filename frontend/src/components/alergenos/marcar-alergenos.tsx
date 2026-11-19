'use client';

import { useId, useState } from 'react';
import { GRUPOS_DE_ALERGENOS, rotuloDoAlergeno, type MarcacaoDeAlergenos, type SimNao } from '@/lib/alergenos';

// A MARCAÇÃO DOS ALÉRGENOS (mig 454, D2 — protótipo `regem-atendente-alergenos-agendado.html`, as gavetas "Alérgenos do
// insumo" e "Alérgenos do produto"). O mesmo bloco nas duas: "conferi", o que contém (o que não for marcado conta como "não
// contém" depois de conferido), o "pode conter", o glúten e a lactose. `modo`:
//   insumo  — pelo rótulo (Estoque › Produtos);
//   produto — o ajuste à mão (A3): soma cautela ao que vem da ficha; "conferi" só no produto sem ficha.

type Props = {
  valor: MarcacaoDeAlergenos;
  aoMudar: (v: MarcacaoDeAlergenos) => void;
  modo: 'insumo' | 'produto';
  /** Produto: tem ficha técnica (o "conferi" não aparece — quem responde é a ficha). */
  temFicha?: boolean;
};

function Chips({ titulo, itens, marcados, travados = [], alternar, rotuloId }: {
  titulo: string; itens: readonly string[]; marcados: string[]; travados?: string[]; alternar: (a: string) => void; rotuloId: string;
}) {
  return (
    <div role="group" aria-labelledby={rotuloId} className="space-y-1.5">
      <p id={rotuloId} className="text-xs font-semibold text-secondary-foreground">{titulo}</p>
      <div className="flex flex-wrap gap-1.5">
        {itens.map((a) => {
          const on = marcados.includes(a) || travados.includes(a);
          const trava = travados.includes(a);
          return (
            <button
              key={a}
              type="button"
              aria-pressed={on}
              disabled={trava}
              title={trava ? 'Vem da ficha técnica: corrige-se no insumo' : undefined}
              onClick={() => alternar(a)}
              className={`rounded-full border px-2.5 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                on ? 'border-primary bg-primary/15 text-foreground' : 'border-border bg-card text-secondary-foreground hover:border-primary'
              } ${trava ? 'cursor-not-allowed opacity-80' : ''}`}
            >
              {on ? '✓ ' : ''}{rotuloDoAlergeno(a)}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function SimNaoGrupo({ rotulo, valor, aoMudar, sim, nao, idBase }: {
  rotulo: string; valor: SimNao | null; aoMudar: (v: SimNao | null) => void; sim: string; nao: string; idBase: string;
}) {
  const rid = `${idBase}-rotulo`;
  return (
    <div role="radiogroup" aria-labelledby={rid} className="space-y-1.5">
      <p id={rid} className="text-xs font-semibold text-secondary-foreground">{rotulo}</p>
      <div className="flex flex-wrap gap-3 text-sm">
        {([['sim', sim], ['nao', nao]] as const).map(([v, t]) => (
          <label key={v} htmlFor={`${idBase}-${v}`} className="inline-flex items-center gap-1.5">
            <input id={`${idBase}-${v}`} type="radio" name={idBase} checked={valor === v} onChange={() => aoMudar(v)} />
            {t}
          </label>
        ))}
        {valor && (
          <button type="button" className="text-xs font-semibold text-secondary-foreground underline underline-offset-2" onClick={() => aoMudar(null)}>
            Limpar
          </button>
        )}
      </div>
    </div>
  );
}

export function MarcarAlergenos({ valor, aoMudar, modo, temFicha = false, travadosContem = [] }: Props & { travadosContem?: string[] }) {
  const id = useId();
  const [comPode, setComPode] = useState(valor.podeConter.length > 0);
  const insumo = modo === 'insumo';
  const mostraConferi = insumo || !temFicha;
  const alternar = (campo: 'contem' | 'podeConter') => (a: string) => {
    const lista = valor[campo].includes(a) ? valor[campo].filter((x) => x !== a) : [...valor[campo], a];
    const outro = campo === 'contem' ? valor.podeConter.filter((x) => !lista.includes(x)) : valor.podeConter;
    aoMudar(campo === 'contem' ? { ...valor, contem: lista, podeConter: outro } : { ...valor, podeConter: lista.filter((x) => !valor.contem.includes(x)) });
  };
  const situacao = valor.conferido ? 'Informado' : 'Não informado';
  return (
    <div className="space-y-4">
      {mostraConferi && (
        <div className="space-y-1.5 rounded-lg border border-border bg-secondary/40 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm font-semibold">{insumo ? 'Este insumo' : 'Este produto'}</span>
            <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${valor.conferido ? 'bg-ok/15 text-ok' : 'bg-muted text-secondary-foreground'}`}>
              {situacao}
            </span>
          </div>
          <label htmlFor={`${id}-conferi`} className="flex items-center gap-2 text-sm">
            <input id={`${id}-conferi`} type="checkbox" checked={valor.conferido} onChange={(e) => aoMudar({ ...valor, conferido: e.target.checked })} />
            {insumo ? 'Conferi o rótulo' : 'Conferi os alérgenos deste produto'}
          </label>
          <p className="text-xs text-secondary-foreground">
            {insumo
              ? 'Enquanto estiver "não informado", os produtos que usam este insumo ficam sem resposta nos alérgenos que ninguém confirmou.'
              : 'Produto sem ficha técnica: é esta marcação que responde ao cliente. Sem "conferi", ele fica "não informado".'}
          </p>
        </div>
      )}

      <div className="space-y-3">
        <div>
          <p className="text-sm font-semibold">{insumo || !temFicha ? 'Contém' : 'Somar ao que vem da ficha: contém'}</p>
          <p className="text-xs text-secondary-foreground">
            {insumo || !temFicha ? 'O que não for marcado conta como "não contém" depois de conferido.' : 'O que a ficha diz que contém não se apaga aqui: corrige-se o insumo.'}
          </p>
        </div>
        {GRUPOS_DE_ALERGENOS.map(([grupo, itens], i) => (
          <Chips key={grupo} titulo={grupo} itens={itens} marcados={valor.contem} travados={travadosContem} alternar={alternar('contem')} rotuloId={`${id}-contem-${i}`} />
        ))}
      </div>

      {comPode ? (
        <div className="space-y-3 border-t border-border pt-3">
          <p className="text-sm font-semibold">{insumo ? 'Pode conter (está escrito no rótulo)' : 'Pode conter (contato no preparo)'}</p>
          {GRUPOS_DE_ALERGENOS.map(([grupo, itens], i) => (
            <Chips
              key={grupo}
              titulo={grupo}
              itens={itens.filter((a) => !valor.contem.includes(a) && !travadosContem.includes(a))}
              marcados={valor.podeConter}
              alternar={alternar('podeConter')}
              rotuloId={`${id}-pode-${i}`}
            />
          ))}
        </div>
      ) : (
        <button type="button" className="text-sm font-semibold text-primary underline-offset-2 hover:underline" onClick={() => setComPode(true)}>
          {insumo ? '＋ O rótulo diz "pode conter"' : '＋ Pode conter (contato no preparo)'}
        </button>
      )}

      <div className="grid grid-cols-1 gap-3 border-t border-border pt-3 sm:grid-cols-2">
        <SimNaoGrupo rotulo="Glúten" valor={valor.gluten} aoMudar={(v) => aoMudar({ ...valor, gluten: v })} sim="Contém glúten" nao="Não contém glúten" idBase={`${id}-gluten`} />
        <SimNaoGrupo rotulo="Lactose" valor={valor.lactose} aoMudar={(v) => aoMudar({ ...valor, lactose: v })} sim="Contém lactose" nao="Não contém lactose" idBase={`${id}-lactose`} />
      </div>
    </div>
  );
}
