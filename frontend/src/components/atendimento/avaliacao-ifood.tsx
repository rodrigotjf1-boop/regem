'use client';

import { useState } from 'react';
import { api, getCategoria } from '@/lib/api';
import { toast } from '@/lib/toast';
import { Button } from '@/components/ui/button';
import { Dialogo } from '@/components/ui/sobreposto';
import { hora, type CasoDaFila } from '@/lib/atendimento';

// A AVALIAÇÃO DO iFOOD no caso da central (06/11/2026 — protótipo `mockups/regem-central-atendimento.html`, caso
// "Avaliação"). Mostra a nota, o comentário e o que o cliente respondeu às perguntas do iFood, e responde UMA vez: a
// resposta fica PÚBLICA no iFood junto da avaliação, de 10 a 300 caracteres (o iFood confere; a tela avisa antes, sem
// barrar). Quem responde: a gestão (presidente, gerente, supervisão), como no chat — o servidor confere.

export const RESPOSTA_MIN = 10;
export const RESPOSTA_MAX = 300;
export const LINK_POLITICA = 'https://comunidade.ifood.com.br/t/conheca-nossa-politica-de-avaliacoes-de-pedidos/87541';
const GESTAO = ['presidente', 'gerente', 'supervisao'];

/** "0 de 300 · mínimo 10" — o contador do campo. */
export function contadorDaResposta(texto: string): string {
  const n = texto.trim().length;
  return `${n} de ${RESPOSTA_MAX}${n < RESPOSTA_MIN ? ` · mínimo ${RESPOSTA_MIN}` : ''}`;
}

/** As estrelas da nota (5), para quem lê e para o leitor de tela. */
function Estrelas({ nota }: { nota: number | null }) {
  if (nota == null) return <p className="text-sm text-secondary-foreground">Sem nota.</p>;
  const cheias = Math.round(nota);
  return (
    <p className="text-2xl leading-none tracking-widest" aria-label={`Nota ${String(nota).replace('.', ',')} de 5`}>
      <span aria-hidden="true">{'★'.repeat(cheias)}</span>
      <span aria-hidden="true" className="opacity-25">
        {'★'.repeat(Math.max(0, 5 - cheias))}
      </span>
    </p>
  );
}

const COMO_FICOU: Record<string, string> = {
  respondida: 'A loja respondeu por aqui.',
  respondida_no_ifood: 'A loja respondeu pelo Portal do Parceiro do iFood.',
  descartada_pelo_ifood: 'O iFood descartou esta avaliação.',
  encerrada_no_ifood: 'O iFood já publicou esta avaliação: ela não aceita mais resposta.',
};

export function AvaliacaoIfood({ caso: c, aoMudar }: { caso: CasoDaFila; aoMudar: () => Promise<void> }) {
  const a = (c as any).detalhe?.avaliacao;
  const resposta = (c as any).detalhe?.resposta;
  const [texto, setTexto] = useState('');
  const [conferindo, setConferindo] = useState(false);
  const [enviando, setEnviando] = useState(false);
  if (!a) return null;
  const aberta = c.situacao !== 'resolvido' && !resposta;
  const podeResponder = GESTAO.includes(String(getCategoria() ?? ''));
  const n = texto.trim().length;

  async function enviar() {
    setEnviando(true);
    try {
      await api.atendimentoResponderAvaliacao(c.id, texto.trim());
      toast.success('Resposta enviada ao iFood.');
      setConferindo(false);
      setTexto('');
      await aoMudar();
    } catch (e: any) {
      toast.error(e?.message ?? 'O iFood não recebeu a resposta agora. Tente de novo.');
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="space-y-4">
      <section className="rounded-lg border border-border p-3">
        <h4 className="mb-2 flex flex-wrap items-baseline gap-x-2 font-display text-sm font-bold">
          O que o cliente avaliou
          {a.criadaEm && <span className="font-body text-xs font-semibold text-secondary-foreground">às {hora(a.criadaEm)}</span>}
        </h4>
        <Estrelas nota={a.nota ?? null} />
        <p className="mt-2 whitespace-pre-line break-words text-sm">{a.comentario ? `"${a.comentario}"` : 'O cliente não escreveu comentário.'}</p>
        {Array.isArray(a.perguntas) && a.perguntas.length > 0 && (
          <ul className="mt-2 list-disc space-y-0.5 pl-5 text-sm text-secondary-foreground" aria-label="Respostas às perguntas do iFood">
            {a.perguntas.map((q: any, i: number) => (
              <li key={i} className="break-words">
                {q.pergunta}: {q.resposta}
              </li>
            ))}
          </ul>
        )}
      </section>

      {aberta ? (
        <section className="space-y-2">
          <h4 className="font-display text-sm font-bold">Responder no iFood</h4>
          {podeResponder ? (
            <>
              <label htmlFor={`resp-aval-${c.id}`} className="text-sm font-semibold">
                A resposta da loja
              </label>
              <textarea
                id={`resp-aval-${c.id}`}
                value={texto}
                onChange={(e) => setTexto(e.target.value)}
                rows={4}
                maxLength={RESPOSTA_MAX}
                aria-describedby={`resp-aval-conta-${c.id} resp-aval-regra-${c.id}`}
                placeholder="Agradeça, peça desculpas pelo que deu errado e diga o que a loja fez a respeito."
                className="min-h-24 w-full min-w-0 resize-y rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
              <p id={`resp-aval-conta-${c.id}`} className={`text-xs ${n > 0 && n < RESPOSTA_MIN ? 'text-destructive' : 'text-secondary-foreground'}`} aria-live="polite">
                {contadorDaResposta(texto)}
              </p>
              <Button type="button" disabled={!n || enviando} onClick={() => setConferindo(true)}>
                Responder no iFood
              </Button>
            </>
          ) : (
            <p className="text-sm text-secondary-foreground">Quem responde é a gestão (gerente, supervisão ou presidente).</p>
          )}
          <p id={`resp-aval-regra-${c.id}`} className="text-xs text-secondary-foreground">
            A resposta fica <b>pública</b> no iFood, junto da avaliação. O iFood aceita uma resposta só por avaliação; depois que
            ela é publicada, não aceita mais.{' '}
            <a href={LINK_POLITICA} target="_blank" rel="noopener noreferrer" className="font-semibold underline underline-offset-2">
              Política de avaliações do iFood
            </a>
          </p>
        </section>
      ) : (
        <section className="rounded-lg border border-border bg-secondary/40 p-3 text-sm">
          <h4 className="mb-1 font-display text-sm font-bold">Como ficou</h4>
          {resposta ? (
            <>
              <p>
                {resposta.por ? `${resposta.por} respondeu` : 'A loja respondeu'}
                {resposta.em ? ` às ${hora(resposta.em)}` : ''}:
              </p>
              <p className="mt-1 whitespace-pre-line break-words">"{resposta.texto}"</p>
            </>
          ) : (
            <p>{COMO_FICOU[String((c as any).decisao ?? '')] ?? 'Esta avaliação já foi encerrada no iFood.'}</p>
          )}
        </section>
      )}

      {conferindo && (
        <Dialogo
          titulo="Responder a avaliação no iFood"
          fecharNoFundo={false}
          aoFechar={() => setConferindo(false)}
          rodape={
            <>
              <Button type="button" variant="outline" onClick={() => setConferindo(false)}>
                Voltar
              </Button>
              <Button type="button" disabled={enviando} onClick={() => void enviar()}>
                Enviar ao iFood
              </Button>
            </>
          }
        >
          <div className="space-y-3 text-sm">
            <p>
              A resposta fica <b>pública</b> no iFood, junto da avaliação{c.cliente ? ` de ${c.cliente}` : ''}. <b>O iFood não aceita outra depois.</b>
            </p>
            <blockquote className="whitespace-pre-line break-words border-l-4 border-border pl-3">{texto.trim()}</blockquote>
            {n < RESPOSTA_MIN && <p className="text-destructive">O iFood pede no mínimo {RESPOSTA_MIN} caracteres — ele deve recusar esta resposta.</p>}
          </div>
        </Dialogo>
      )}
    </div>
  );
}
