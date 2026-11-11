'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Gaveta } from '@/components/ui/sobreposto';
import { texto2 } from '@/components/ui/lista';
import { APP, itemDoCodigo, reais, type CanalConferido, type LinhaConferida } from '@/lib/conferencia-apps';

// "Conferir com os apps" (R3 F4b) — a gaveta "Corrigir o código" da linha "só no Regem": o produto marcado "Está no <app>"
// que o app não tem pelo código dele. Se o item existe lá com outro código, a pessoa digita o código de lá; a tela diz qual
// item é (pela última leitura) e o produto passa a ter esse código, copiando o preço e a pausa de lá (nada muda no app).
export function ConferenciaCorrigirCodigo({
  linha: l,
  canal,
  itens,
  aoFechar,
  aoSalvar,
}: {
  linha: LinhaConferida;
  canal: CanalConferido;
  itens: LinhaConferida[];
  aoFechar: () => void;
  aoSalvar: (alvo: LinhaConferida) => Promise<void>;
}) {
  const a = APP[canal];
  const [codigo, setCodigo] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const achado = itemDoCodigo(itens, codigo, canal);

  return (
    <Gaveta
      titulo={`Corrigir o código: ${l.nome}`}
      aoFechar={() => !ocupado && aoFechar()}
      rodape={
        <>
          <Button type="button" variant="outline" onClick={aoFechar} disabled={ocupado}>
            Cancelar
          </Button>
          <Button
            type="button"
            disabled={!achado.linha || ocupado}
            onClick={async () => {
              if (!achado.linha) return;
              setOcupado(true);
              try {
                await aoSalvar(achado.linha);
              } finally {
                setOcupado(false);
              }
            }}
          >
            {ocupado ? 'Salvando…' : 'Salvar o código'}
          </Button>
        </>
      }
    >
      <div className="space-y-4 text-sm">
        <p className="rounded-md border border-warn/40 bg-warn/10 px-3 py-2">
          {l.pdv ? (
            <>
              {a.o.replace(/^./, (x) => x.toUpperCase())} não tem item com o código <b className="font-mono">{l.pdv}</b>. Se o item existe lá com
              outro código, ponha aqui o código de lá.
            </>
          ) : (
            <>&quot;{l.nome}&quot; não tem código PDV no Regem. Ponha aqui o código do item {a.do}.</>
          )}
        </p>
        <div className="space-y-1">
          <Label htmlFor="corrigir-codigo">Código PDV {a.no}</Label>
          <Input id="corrigir-codigo" value={codigo} onChange={(e) => setCodigo(e.target.value)} placeholder="Ex.: 2098" autoComplete="off" />
          <p className={`text-xs ${achado.linha ? 'font-semibold' : texto2}`} aria-live="polite">
            {achado.frase}
          </p>
        </div>
        {achado.linha && (
          <p className={`text-xs ${texto2}`}>
            O código de &quot;{l.nome}&quot; passa a ser {achado.linha.pdv}
            {achado.linha.precos.length === 1 ? `, e o preço ${a.do} no Regem fica o de lá (${reais(achado.linha.precos[0])})` : ''}
            {achado.linha.pausado ? ', pausado como lá' : ''}. Nada muda {a.no}. O código vale para todos os canais.
          </p>
        )}
      </div>
    </Gaveta>
  );
}
