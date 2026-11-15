'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Gaveta } from '@/components/ui/sobreposto';
import { connectAsGestor } from '@/lib/rt';
import { darCiente, haQuanto, relerAvisos, useAvisosDaLoja, type AvisoNaTela } from '@/lib/avisos-da-loja';

// OS AVISOS DO MISTER NA TELA DA LOJA (F1.4, protótipo `mockups/regem-avisos-na-tela.html` aprovado em 14/11/2026).
//  • A FAIXA abaixo do topo: o aviso aberto mais recente que ESTA pessoa ainda não deu "Ciente", com "Ciente" e "Ver
//    avisos". Para todos que estão logados na loja; não trava nada.
//  • O ⚠️ do topo: os avisos abertos depois do "Ciente" (a faixa sumiu, o aviso não).
//  • A GAVETA "Avisos da loja": todos os abertos, com o "o que fazer" e para onde mais foram.
// O servidor decide tudo (a loja, o módulo, o ciente por pessoa, a escala que traz a faixa de volta); a tela só mostra.

/** Liga a leitura (a cada minuto e pelo tempo real). Montado uma vez pelo Shell, para quem está logado. */
export function LeitorDeAvisos({ ativo }: { ativo: boolean }) {
  const { desligado } = useAvisosDaLoja();
  useEffect(() => {
    if (!ativo || desligado) return;
    void relerAvisos();
    const t = setInterval(() => void relerAvisos(), 60_000);
    let s: any = null;
    try {
      s = connectAsGestor();
      s.on('mister:avisos', () => void relerAvisos());
    } catch {
      /* sem tempo real: fica a leitura a cada minuto */
    }
    return () => {
      clearInterval(t);
      try {
        s?.disconnect();
      } catch {
        /* nada */
      }
    };
  }, [ativo, desligado]);
  return null;
}

/** A faixa abaixo do topo. */
export function FaixaDeAvisos() {
  const { avisos, semConexao } = useAvisosDaLoja();
  const [aberta, setAberta] = useState(false);
  const [, tique] = useState(0);
  // O "há 3 min" anda sozinho.
  useEffect(() => {
    const t = setInterval(() => tique((n) => n + 1), 30_000);
    return () => clearInterval(t);
  }, []);
  const naFaixa = avisos.find((a) => !a.ciente);
  if (semConexao || !naFaixa) return aberta ? <GavetaDeAvisos aoFechar={() => setAberta(false)} /> : null;
  const tom = naFaixa.escalado ? 'border-l-destructive border-destructive/40' : 'border-l-amber-600 border-amber-500/40';
  return (
    <>
      <div role="status" aria-live="polite" className={`mx-5 mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-l-[5px] bg-card px-3 py-2.5 ${tom}`}>
        <div className="min-w-0 flex-[1_1_320px]">
          <p className="font-semibold">
            <span aria-hidden>⚠️ </span>
            {naFaixa.titulo}
            <span className="text-sm font-normal text-muted-foreground"> · {naFaixa.escalado ? 'sem solução, ' : ''}{haQuanto(naFaixa.abertoEm)}</span>
          </p>
          {naFaixa.detalhe && <p className="text-sm text-muted-foreground">{naFaixa.detalhe}</p>}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => void darCiente(naFaixa.id)}>
            Ciente
          </Button>
          <Button onClick={() => setAberta(true)}>{avisos.length === 1 ? 'Ver o aviso' : `Ver os ${avisos.length} avisos`}</Button>
        </div>
      </div>
      {aberta && <GavetaDeAvisos aoFechar={() => setAberta(false)} />}
    </>
  );
}

/** O ⚠️ do topo: aparece quando há aviso aberto e a faixa não está (todos com "Ciente"). */
export function ChipDeAvisos() {
  const { avisos, semConexao } = useAvisosDaLoja();
  const [aberta, setAberta] = useState(false);
  if (semConexao || !avisos.length || avisos.some((a) => !a.ciente)) return aberta ? <GavetaDeAvisos aoFechar={() => setAberta(false)} /> : null;
  const n = avisos.length;
  return (
    <>
      <button
        type="button"
        onClick={() => setAberta(true)}
        aria-label={`${n} ${n === 1 ? 'aviso da loja aberto' : 'avisos da loja abertos'}`}
        className="inline-flex min-h-10 items-center gap-1.5 rounded-md border border-amber-500/50 bg-amber-500/10 px-3 text-sm font-semibold text-amber-900 dark:text-amber-200"
      >
        <span aria-hidden>⚠️</span>
        <span className="font-mono">{n}</span> {n === 1 ? 'aviso' : 'avisos'}
      </button>
      {aberta && <GavetaDeAvisos aoFechar={() => setAberta(false)} />}
    </>
  );
}

function GavetaDeAvisos({ aoFechar }: { aoFechar: () => void }) {
  const { avisos } = useAvisosDaLoja();
  return (
    <Gaveta
      titulo={`Avisos da loja · ${avisos.length} ${avisos.length === 1 ? 'aberto' : 'abertos'}`}
      aoFechar={aoFechar}
      rodape={
        <p className="mr-auto text-sm text-muted-foreground">
          Os avisos somem sozinhos quando o problema se resolve. Para mudar quem recebe cada aviso: Mister › Avisos e relatórios (o presidente).
        </p>
      }
    >
      {avisos.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border p-6 text-center text-muted-foreground">Nenhum aviso aberto nesta loja agora.</p>
      ) : (
        <ul className="space-y-3">
          {avisos.map((a) => (
            <ItemDeAviso key={a.id} a={a} />
          ))}
        </ul>
      )}
    </Gaveta>
  );
}

function ItemDeAviso({ a }: { a: AvisoNaTela }) {
  const hora = new Date(a.abertoEm).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  return (
    <li className="rounded-lg border border-border p-3">
      <p className="flex flex-wrap gap-2">
        <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${a.escalado ? 'bg-destructive/10 text-destructive' : 'bg-amber-500/15 text-amber-900 dark:text-amber-200'}`}>{a.grupo}</span>
        {a.escalado && <span className="rounded-full bg-destructive/10 px-2.5 py-0.5 text-xs font-bold text-destructive">sem solução</span>}
      </p>
      <p className="mt-1 font-semibold">{a.titulo}</p>
      {a.detalhe && <p className="text-sm text-muted-foreground">{a.detalhe}</p>}
      <p className="mt-1.5 text-xs text-muted-foreground">
        Abriu às <span className="font-mono">{hora}</span> · {haQuanto(a.abertoEm)}
        {a.tambem.length ? ` · também foi para ${a.tambem.join(', ')}` : ''}
      </p>
    </li>
  );
}
