'use client';

import { useId, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { toast } from '@/lib/toast';
import { Button } from '@/components/ui/button';
import { CorrigirResposta } from '@/components/atendimento/corrigir-resposta';
import { ResponderNoDirect } from '@/components/atendimento/responder-no-direct';
import {
  MAX_RESPOSTA_NO_POST,
  arroba,
  motivoSemPrivada,
  nomeDoPost,
  semResposta,
  type ComentarioDoInstagram,
} from '@/lib/comentarios-do-instagram';

/** "hoje, 19:02" · "ontem, 22:40" · "30/10, 20:10" — a data do comentário como a equipe fala. */
function quando(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const hora = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  const hoje = new Date();
  const ontem = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate() - 1);
  const mesmoDia = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  if (mesmoDia(d, hoje)) return `hoje, ${hora}`;
  if (mesmoDia(d, ontem)) return `ontem, ${hora}`;
  return `${d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}, ${hora}`;
}

const selo = (tom: 'neutro' | 'warn' | 'ok') =>
  `rounded-full px-2 py-0.5 text-xs font-bold ${tom === 'warn' ? 'bg-warn/15 text-foreground' : tom === 'ok' ? 'bg-ok/15 text-foreground' : 'bg-secondary text-foreground'}`;

/**
 * Um comentário de post (F6, protótipo v15): o post, quem comentou, o texto, a situação e as ações — responder no post
 * (uma resposta da loja por comentário), no Direct (a privada, uma só, até 7 dias), esconder/mostrar e corrigir a
 * resposta do robô. A mesma peça na gaveta "Comentários" e no caso da fila (`noCaso` tira o "Abrir o caso").
 */
export function ComentarioCartao({
  comentario: c,
  noCaso = false,
  podeAgir,
  aoMudar,
  aoAbrirCaso,
}: {
  comentario: ComentarioDoInstagram;
  noCaso?: boolean;
  /** Gerente e presidente respondem, escondem e ensinam (o servidor confere). */
  podeAgir: boolean;
  aoMudar: (atualizado: ComentarioDoInstagram) => void;
  aoAbrirCaso?: (casoId: string) => void;
}) {
  const [respondendo, setRespondendo] = useState(false);
  const [texto, setTexto] = useState('');
  const [erro, setErro] = useState('');
  const [ocupado, setOcupado] = useState<'' | 'publicar' | 'esconder'>('');
  const [noDirect, setNoDirect] = useState(false);
  const [corrigindo, setCorrigindo] = useState(false);
  const [corrigida, setCorrigida] = useState(false);
  const ids = { caixa: useId(), txt: useId(), conta: useId() };
  const motivo = motivoSemPrivada(c);

  async function publicar() {
    const t = texto.trim();
    if (!t) return setErro('Escreva a resposta antes de publicar.');
    setErro('');
    setOcupado('publicar');
    try {
      const r = (await api.atendimentoComentarioResponder(c.id, t)) as ComentarioDoInstagram;
      toast.success('Resposta publicada no post.');
      setRespondendo(false);
      setTexto('');
      aoMudar(r);
    } catch (e) {
      const code = e instanceof ApiError ? e.code : undefined;
      setErro(
        code === 'JA_RESPONDIDO'
          ? 'Este comentário já tem resposta da loja (uma por comentário). Atualize a lista.'
          : code === 'COMENTARIO_ESCONDIDO'
            ? 'O comentário está escondido: mostre-o no post antes de responder.'
            : (e as Error)?.message || 'Não deu para publicar agora. Tente de novo.',
      );
    } finally {
      setOcupado('');
    }
  }

  async function esconder() {
    setOcupado('esconder');
    try {
      const r = (await api.atendimentoComentarioEsconder(c.id, !c.escondido)) as ComentarioDoInstagram;
      toast.success(r.escondido ? 'Comentário escondido: some do post para os outros; quem comentou continua vendo.' : 'Comentário visível de novo no post.');
      aoMudar(r);
    } catch (e) {
      toast.error((e as Error)?.message || 'Não deu para mudar agora. Tente de novo.');
    } finally {
      setOcupado('');
    }
  }

  const sit = c.escondido ? (
    <span className={selo('neutro')}>🙈 Escondido</span>
  ) : semResposta(c) ? (
    <span className={selo('warn')}>Sem resposta</span>
  ) : (
    <span className={selo('ok')}>Respondido</span>
  );

  return (
    <article className="min-w-0 space-y-2 rounded-lg border border-border bg-card p-3 text-sm" aria-label={`Comentário de ${arroba(c.autorUsuario)}`} data-comentario={c.id}>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <b className="break-all text-base">{arroba(c.autorUsuario)}</b>
        <span className="text-secondary-foreground">{quando(c.comentadoEm)}</span>
      </div>
      <div className="flex min-w-0 items-center gap-2 text-xs text-secondary-foreground">
        <span aria-hidden="true" className="grid h-8 w-8 flex-none place-items-center rounded-md bg-secondary">
          📷
        </span>
        <span className="min-w-0 flex-1 truncate">{nomeDoPost(c.midia)}</span>
        {c.midia.link && (
          <a href={c.midia.link} target="_blank" rel="noopener noreferrer" className="flex-none font-semibold text-info underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            ver o post
          </a>
        )}
      </div>
      <p className="whitespace-pre-wrap break-words text-base text-foreground">{c.texto}</p>
      <div className="flex flex-wrap gap-1.5">
        {sit}
        {c.casoId && <span className={selo('neutro')}>📋 Caso na fila</span>}
      </div>

      {c.resposta && (
        <div className="rounded-r-md border-l-4 border-info bg-info/10 px-3 py-2">
          <p className="whitespace-pre-wrap break-words">{c.resposta.texto}</p>
          <p className="text-xs text-secondary-foreground">
            Resposta no post · {c.resposta.por === 'robo' ? 'atendente virtual' : 'equipe'} · {quando(c.resposta.em)}
          </p>
          {podeAgir && c.resposta.por === 'robo' &&
            (corrigida ? (
              <span className="block pt-0.5 text-xs font-semibold text-ok">✏️ Corrigida — o atendente já usa a resposta nova</span>
            ) : (
              <button
                type="button"
                className="mt-0.5 min-h-6 text-xs font-semibold text-info underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onClick={() => setCorrigindo(true)}
              >
                Corrigir
              </button>
            ))}
        </div>
      )}
      {c.privada && (
        <div className="rounded-r-md border-l-4 border-info bg-info/10 px-3 py-2">
          <p className="whitespace-pre-wrap break-words">{c.privada.texto}</p>
          <p className="text-xs text-secondary-foreground">Mensagem no Direct · {quando(c.privada.em)} · só quem comentou vê; a conversa segue no Direct quando a pessoa responder</p>
        </div>
      )}
      {c.erro && semResposta(c) && <p className="text-xs text-secondary-foreground">A resposta automática não saiu: {c.erro}</p>}
      {podeAgir && !c.privada && motivo && <p className="text-xs text-secondary-foreground">Responder no Direct não dá mais: {motivo} (regra do Instagram). Ainda dá para responder no post.</p>}

      {podeAgir && (
        <div className="flex flex-wrap gap-2">
          {!c.resposta && !c.escondido && (
            <Button type="button" variant="outline" size="sm" aria-expanded={respondendo} aria-controls={ids.caixa} onClick={() => setRespondendo((v) => !v)}>
              Responder no post
            </Button>
          )}
          {!c.privada && (
            <Button type="button" variant="outline" size="sm" disabled={!c.podePrivada} onClick={() => setNoDirect(true)}>
              Responder no Direct
            </Button>
          )}
          <Button type="button" variant="outline" size="sm" aria-pressed={c.escondido} disabled={ocupado === 'esconder'} onClick={() => void esconder()}>
            {ocupado === 'esconder' ? 'Mudando…' : c.escondido ? 'Mostrar no post' : 'Esconder'}
          </Button>
          {c.casoId && !noCaso && aoAbrirCaso && (
            <Button type="button" variant="ghost" size="sm" onClick={() => aoAbrirCaso(c.casoId as string)}>
              Abrir o caso
            </Button>
          )}
        </div>
      )}

      {respondendo && (
        <div id={ids.caixa} className="space-y-1.5">
          <label htmlFor={ids.txt} className="font-semibold">
            Resposta no post (todo mundo vê)
          </label>
          <textarea
            id={ids.txt}
            rows={3}
            value={texto}
            maxLength={MAX_RESPOSTA_NO_POST}
            autoFocus
            aria-describedby={ids.conta}
            onChange={(e) => setTexto(e.target.value)}
            placeholder="Escreva a resposta que aparece embaixo do comentário"
            className="w-full min-w-0 rounded-md border border-input bg-card px-3 py-2 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <p id={ids.conta} className="text-xs text-secondary-foreground">
            {texto.length} de {MAX_RESPOSTA_NO_POST}. Uma resposta da loja por comentário; sai pelo Instagram da loja e aparece no post.
          </p>
          {erro && (
            <p role="alert" className="font-semibold text-destructive">
              {erro}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" disabled={ocupado === 'publicar'} onClick={() => void publicar()}>
              {ocupado === 'publicar' ? 'Publicando…' : 'Publicar no post'}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setRespondendo(false);
                setErro('');
              }}
            >
              Cancelar
            </Button>
          </div>
        </div>
      )}

      {noDirect && (
        <ResponderNoDirect
          comentario={c}
          aoFechar={() => setNoDirect(false)}
          aoEnviar={(r) => {
            setNoDirect(false);
            aoMudar(r);
          }}
        />
      )}
      {corrigindo && c.resposta && (
        <CorrigirResposta
          origem="caso"
          pergunta={c.texto}
          resposta={c.resposta.texto}
          aoFechar={() => setCorrigindo(false)}
          aoSalvar={() => {
            setCorrigindo(false);
            setCorrigida(true);
          }}
        />
      )}
    </article>
  );
}
