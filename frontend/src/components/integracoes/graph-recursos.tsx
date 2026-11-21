'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Chave } from '@/components/ui/chave';
import { hojeNaLoja } from '@/lib/hoje-na-loja';

// Os recursos do DMS Graph na janela do cartão (plano "recursos por produto", contrato 1.3.0; protótipo aprovado em
// 20/11/2026, aba "No Regem"): antes de ligar, o que o Regem vai pedir; ligado, o que está liberado e o "Pedir mais". O que
// a pessoa autoriza é decidido na página do Graph; aqui ela só escolhe o que pedir. Quem não é presidente só vê.

export type RecursoDoGraph = { id: string; nome: string; frase: string; motivo: string; necessaria: boolean; pago: boolean };

const AUDIO = ['audio.ouvir', 'audio.falar'];
const FRASE_DO_PAGO = 'Recurso pago: a empresa começa com franquia 0, e a DMS libera.';
const dataBr = (iso: string) => iso.split('-').reverse().join('/');
const minuscula = (t: string) => t.charAt(0).toLowerCase() + t.slice(1);

/** Antes de ligar: a leitura é necessária; o resto a pessoa decide na página do Graph. */
export function RecursosAPedir({ recursos }: { recursos: RecursoDoGraph[] }) {
  return (
    <div className="rounded-lg border border-border p-3">
      <h3 className="mb-2 font-display text-sm font-semibold">O que o Regem vai pedir ao DMS Graph</h3>
      <ul className="m-0 grid list-none gap-2 p-0 text-sm">
        {recursos.map((r) => (
          <li key={r.id} className="flex items-start gap-2">
            <span aria-hidden="true" className={r.necessaria ? 'font-bold text-ok' : 'font-bold text-muted-foreground'}>
              {r.necessaria ? '✓' : '+'}
            </span>
            <span className="min-w-0">
              {r.necessaria ? r.nome : `Opcional: ${minuscula(r.nome)}`}
              <small className="block text-xs text-muted-foreground">
                {r.necessaria ? `Necessária. ${r.motivo}` : r.motivo}
                {r.pago ? ` ${FRASE_DO_PAGO}` : ''}
              </small>
            </span>
          </li>
        ))}
      </ul>
      <p className="m-0 mt-2 text-xs text-muted-foreground">As opcionais você decide na página do DMS Graph; cada uma começa desligada.</p>
    </div>
  );
}

/** Ligado: cada recurso com a situação dele, a chave do que falta e o "Pedir mais ao DMS Graph" (só o presidente). */
export function RecursosLiberados({
  recursos,
  permissoes,
  legadoAte,
  podePedir,
  indo,
  aoPedir,
}: {
  recursos: RecursoDoGraph[];
  permissoes: string[];
  legadoAte: string;
  podePedir: boolean;
  indo: boolean;
  aoPedir: (ids: string[]) => void;
}) {
  const [marcados, setMarcados] = useState<string[]>([]);
  const naJanela = hojeNaLoja() < legadoAte && permissoes.includes('arquivos.analisar');
  const pelaAntiga = (id: string) => naJanela && AUDIO.includes(id) && !permissoes.includes(id);
  const audioPelaAntiga = AUDIO.filter(pelaAntiga);
  const faltam = recursos.filter((r) => !permissoes.includes(r.id));
  const alternar = (id: string, ligada: boolean) => setMarcados((m) => (ligada ? [...m, id] : m.filter((x) => x !== id)));

  return (
    <div className="grid gap-3">
      {audioPelaAntiga.length > 0 && (
        <div role="status" className="grid gap-2 rounded-lg border-l-4 border-warn bg-warn/10 px-3 py-2.5 text-sm text-foreground">
          <b>Peça de novo &quot;ouvir áudios&quot; e &quot;falar&quot; até {dataBr(legadoAte)}</b>
          <span>O DMS Graph passou a ter uma permissão para cada recurso. Os dois seguem funcionando pela permissão antiga até essa data; depois, o Mister para de ouvir e de falar se você não autorizar.</span>
          {podePedir && (
            <Button variant="outline" className="justify-self-start" onClick={() => aoPedir(audioPelaAntiga)} disabled={indo}>
              {indo ? 'Abrindo o DMS Graph…' : 'Pedir de novo ouvir e falar'}
            </Button>
          )}
        </div>
      )}
      <div className="rounded-lg border border-border p-3">
        <h3 className="mb-2 font-display text-sm font-semibold">O que está liberado</h3>
        <ul className="m-0 grid list-none gap-2 p-0 text-sm">
          {recursos.map((r) => {
            const tem = permissoes.includes(r.id);
            const antiga = pelaAntiga(r.id);
            return (
              <li key={r.id} className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
                <span className="flex min-w-0 flex-1 basis-48 items-start gap-2">
                  <span aria-hidden="true" className={tem ? 'font-bold text-ok' : 'font-bold text-muted-foreground'}>
                    {tem ? '✓' : antiga ? '…' : '–'}
                  </span>
                  <span className="min-w-0">
                    {r.nome}
                    <small className="block text-xs text-muted-foreground">
                      {tem ? r.motivo : antiga ? `Pela permissão antiga, até ${dataBr(legadoAte)}.` : `Não liberado.${r.pago ? ` ${FRASE_DO_PAGO}` : ` ${r.motivo}`}`}
                    </small>
                  </span>
                </span>
                {!tem && podePedir && (
                  <Chave comTexto={false} ligada={marcados.includes(r.id)} aoMudar={(l) => alternar(r.id, l)} rotulo={`Pedir: ${minuscula(r.nome)}`} ocupada={indo} />
                )}
              </li>
            );
          })}
        </ul>
        {podePedir && faltam.length > 0 && (
          <div className="mt-3 grid gap-2">
            <Button onClick={() => aoPedir(marcados)} disabled={indo || !marcados.length} className="w-full">
              {indo ? 'Abrindo o DMS Graph…' : 'Pedir mais ao DMS Graph'}
            </Button>
            <p className="m-0 text-xs text-muted-foreground">
              Ligue o que quer pedir: a página do DMS Graph abre com o que é novo. Se você recusar lá, fica tudo como está.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
