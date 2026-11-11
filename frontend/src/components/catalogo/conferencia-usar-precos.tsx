'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialogo } from '@/components/ui/sobreposto';
import { texto2 } from '@/components/ui/lista';
import { APP, precoNoApp, reais, type CanalConferido, type LinhaConferida } from '@/lib/conferencia-apps';

// "Conferir com os apps" (R3 F4a) — o diálogo do "Usar os preços do <app> (N)": a lista de → para antes de gravar (a
// ação em massa do protótipo só existe nesta direção, decisão 3). Um pedido só ao servidor (operação em massa).
export function ConferenciaUsarPrecos({
  canal,
  linhas,
  aoFechar,
  aoConfirmar,
}: {
  canal: CanalConferido;
  linhas: LinhaConferida[];
  aoFechar: () => void;
  aoConfirmar: () => Promise<void>;
}) {
  const [ocupado, setOcupado] = useState(false);
  const a = APP[canal];
  const n = linhas.length;
  return (
    <Dialogo
      titulo={`Usar os preços ${a.do} no Regem`}
      aoFechar={() => !ocupado && aoFechar()}
      largura="md"
      rodape={
        <>
          <Button type="button" variant="outline" onClick={aoFechar} disabled={ocupado}>
            Cancelar
          </Button>
          <Button
            type="button"
            disabled={ocupado}
            onClick={async () => {
              setOcupado(true);
              try {
                await aoConfirmar();
              } finally {
                setOcupado(false);
              }
            }}
          >
            {ocupado ? 'Gravando…' : `Usar ${n} preço${n === 1 ? '' : 's'}`}
          </Button>
        </>
      }
    >
      <div className="space-y-3 text-sm">
        <p>
          O preço {a.do} de {n === 1 ? 'este produto' : `estes ${n} produtos`} no Regem passa a ser o que {a.o} tem hoje. Nada muda {a.no}.
        </p>
        <ul className="divide-y divide-border rounded-md border border-border">
          {linhas.map((l) => (
            <li key={l.chave} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 px-3 py-2">
              <span className="min-w-0 break-words font-semibold">{l.regem?.nome ?? l.nome}</span>
              <span className="font-mono text-xs">
                <span className={texto2}>{reais(l.regem?.preco)}</span> → <b>{precoNoApp(l)}</b>
              </span>
            </li>
          ))}
        </ul>
        <p className={`text-xs ${texto2}`}>Cada mudança fica na auditoria (quem, o quê, de → para).</p>
      </div>
    </Dialogo>
  );
}
