'use client';

import { useEffect, useId, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { toast } from '@/lib/toast';
import { Button } from '@/components/ui/button';
import { CorrigirResposta } from '@/components/atendimento/corrigir-resposta';
import { arroba } from '@/lib/comentarios-do-instagram';
import {
  CLIMA_DA_MARCACAO,
  MAX_COMENTARIO_DA_MARCACAO,
  ONDE_DA_MARCACAO,
  ROTULO_DO_TIPO_DA_MARCACAO,
  quemAgradeceu,
  type MarcacaoDoInstagram,
} from '@/lib/marcacoes-do-instagram';

/** "hoje, 19:02" · "ontem, 22:40" · "30/10, 20:10" — como a equipe fala. */
function quando(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const hora = d.toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
  });
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
 * Uma marcação da loja (mig 387, protótipo v18): quem marcou, onde, o que a IA viu e o clima, e — conforme a situação — a
 * sugestão para a equipe publicar ou ignorar (o @ no post de outra pessoa), o agradecimento que saiu no Direct (com
 * "Corrigir" quando foi o atendente virtual) ou o caso que abriu (parece reclamação).
 */
export function MarcacaoCartao({
  marcacao: m,
  podeAgir,
  aoMudar,
  aoAbrirCaso,
}: {
  marcacao: MarcacaoDoInstagram;
  /** Gerente e presidente publicam e ignoram (o servidor confere). */
  podeAgir: boolean;
  aoMudar: (atualizada: MarcacaoDoInstagram) => void;
  aoAbrirCaso: (casoId: string) => void;
}) {
  const [texto, setTexto] = useState(m.sugestao ?? '');
  const [editado, setEditado] = useState(false);
  const [erro, setErro] = useState('');
  const [ocupado, setOcupado] = useState<'' | 'publicar' | 'ignorar'>('');
  const [corrigindo, setCorrigindo] = useState(false);
  const [corrigida, setCorrigida] = useState(false);
  const ids = { txt: useId(), conta: useId() };

  // A sugestão da IA chega depois (ela olha a imagem em segundo plano): entra no campo se a pessoa ainda não escreveu.
  useEffect(() => {
    if (!editado) setTexto(m.sugestao ?? '');
  }, [m.sugestao, editado]);

  async function publicar() {
    const t = texto.trim();
    if (!t) return setErro('Escreva o comentário antes de publicar.');
    setErro('');
    setOcupado('publicar');
    try {
      const r = (await api.atendimentoMarcacaoPublicar(m.id, t)) as MarcacaoDoInstagram;
      toast.success(m.tipo === 'comentario' ? 'Resposta publicada no comentário.' : 'Comentário publicado no post da pessoa.');
      aoMudar(r);
    } catch (e) {
      const code = e instanceof ApiError ? e.code : undefined;
      setErro(
        code === 'JA_DECIDIDA'
          ? 'Esta marcação já foi respondida ou ignorada. Atualize a lista.'
          : (e as Error)?.message || 'Não deu para publicar agora. Tente de novo.',
      );
    } finally {
      setOcupado('');
    }
  }

  async function ignorar() {
    setOcupado('ignorar');
    try {
      const r = (await api.atendimentoMarcacaoIgnorar(m.id)) as MarcacaoDoInstagram;
      toast.success('Marcação ignorada: nada foi publicado.');
      aoMudar(r);
    } catch (e) {
      const code = e instanceof ApiError ? e.code : undefined;
      toast.error(
        code === 'JA_DECIDIDA' ? 'Esta marcação já foi respondida ou ignorada.' : (e as Error)?.message || 'Não deu para ignorar agora. Tente de novo.',
      );
    } finally {
      setOcupado('');
    }
  }

  const clima = m.clima ? CLIMA_DA_MARCACAO[m.clima] : null;
  const corpoDoTexto = m.tipo === 'comentario' ? m.texto : m.legenda;
  const resposta = m.resposta;

  return (
    <article
      className="min-w-0 space-y-2 rounded-lg border border-border bg-card p-3 text-sm"
      aria-label={`Marcação de ${arroba(m.usuario)} ${ONDE_DA_MARCACAO[m.tipo]}`}
      data-marcacao={m.id}
    >
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <b className="break-all text-base">{arroba(m.usuario)}</b>
        <span className="text-secondary-foreground">
          {ROTULO_DO_TIPO_DA_MARCACAO[m.tipo]} · {quando(m.marcadoEm)}
        </span>
      </div>
      {corpoDoTexto && <p className="whitespace-pre-wrap break-words text-base text-foreground">{corpoDoTexto}</p>}
      {m.tipo === 'comentario' && m.legenda && (
        <p className="break-words text-xs text-secondary-foreground">No post: {m.legenda.length > 140 ? `${m.legenda.slice(0, 139)}…` : m.legenda}</p>
      )}
      {m.viu && (
        <p className="break-words text-secondary-foreground">
          <b className="text-foreground">🤖 A IA viu:</b> {m.viu}
        </p>
      )}
      <div className="flex flex-wrap gap-1.5">
        {clima && <span className={selo(clima.tom)}>{clima.texto}</span>}
        {m.estado === 'sugerida' && <span className={selo('warn')}>A decidir</span>}
        {m.estado === 'caso' && <span className={selo('neutro')}>📋 Caso na fila</span>}
      </div>

      {resposta && (m.estado === 'publicada' || m.estado === 'agradecida') && (
        <div className="rounded-r-md border-l-4 border-info bg-info/10 px-3 py-2">
          <p className="whitespace-pre-wrap break-words">{resposta.texto}</p>
          <p className="text-xs text-secondary-foreground">
            {m.estado === 'publicada' ? `Comentário publicado · ${resposta.quem || 'equipe'}` : `Agradecimento no Direct · ${quemAgradeceu(resposta.por)}`} ·{' '}
            {quando(resposta.em)}
          </p>
          {m.estado === 'agradecida' && resposta.por === 'padrao' && (
            <p className="text-xs text-secondary-foreground">A IA não viu a imagem (vídeo, ou a IA ainda não está liberada): saiu o texto padrão.</p>
          )}
          {podeAgir &&
            m.estado === 'agradecida' &&
            resposta.por === 'robo' &&
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
      {m.estado === 'ignorada' && <p className="text-secondary-foreground">Ignorada: nada foi publicado.</p>}
      {m.estado === 'caso' && (
        <p className="text-secondary-foreground">Parece reclamação: o atendente virtual não agradeceu. Virou caso na fila para a equipe responder no Direct.</p>
      )}
      {m.estado === 'sem_acao' && (
        <p className="text-secondary-foreground">
          {m.tipo === 'story' ? 'A conversa estava com alguém da equipe: o atendente virtual não agradeceu.' : 'Nada foi feito.'}
        </p>
      )}
      {m.estado === 'falhou' && <p className="text-secondary-foreground">O agradecimento não saiu{m.erro ? `: ${m.erro}` : '.'}</p>}

      {m.estado === 'sugerida' && podeAgir && m.tipo !== 'story' && (
        <div className="space-y-1.5">
          <label htmlFor={ids.txt} className="font-semibold">
            Sugestão de comentário (todo mundo vê)
          </label>
          <textarea
            id={ids.txt}
            rows={3}
            value={texto}
            maxLength={MAX_COMENTARIO_DA_MARCACAO}
            aria-describedby={ids.conta}
            onChange={(e) => {
              setTexto(e.target.value);
              setEditado(true);
            }}
            placeholder="Escreva o comentário da loja"
            className="w-full min-w-0 rounded-md border border-input bg-card px-3 py-2 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <p id={ids.conta} className="text-xs text-secondary-foreground">
            {texto.length} de {MAX_COMENTARIO_DA_MARCACAO}. Sai pelo Instagram da loja{' '}
            {m.tipo === 'comentario' ? 'como resposta ao comentário' : 'como comentário no post da pessoa'}; sem link nem contato.
          </p>
          {m.erro && !erro && <p className="text-xs text-secondary-foreground">Da última vez não publicou: {m.erro}</p>}
          {erro && (
            <p role="alert" className="font-semibold text-destructive">
              {erro}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" size="sm" disabled={!!ocupado} onClick={() => void publicar()}>
              {ocupado === 'publicar' ? 'Publicando…' : 'Publicar comentário'}
            </Button>
            <Button type="button" variant="ghost" size="sm" disabled={!!ocupado} onClick={() => void ignorar()}>
              {ocupado === 'ignorar' ? 'Ignorando…' : 'Ignorar'}
            </Button>
            {m.link && (
              <a
                href={m.link}
                target="_blank"
                rel="noopener noreferrer"
                className="font-semibold text-info underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                ver no Instagram
              </a>
            )}
          </div>
        </div>
      )}

      {m.chamadoId && (m.estado === 'caso' || m.estado === 'sem_acao') && (
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={() => aoAbrirCaso(m.chamadoId as string)}>
            Abrir o caso
          </Button>
        </div>
      )}

      {corrigindo && resposta && (
        <CorrigirResposta
          origem="caso"
          pergunta="[menção no story]"
          resposta={resposta.texto}
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
