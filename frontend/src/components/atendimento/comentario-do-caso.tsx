'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, getCategoria } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { ComentarioCartao } from '@/components/atendimento/comentario-cartao';
import type { CasoDaFila } from '@/lib/atendimento';
import { QUEM_CUIDA_DOS_COMENTARIOS, arroba, type ComentarioDoInstagram } from '@/lib/comentarios-do-instagram';

/**
 * O comentário do caso (F6, `tipo = 'instagram_comentario'`): o post, o comentário, o que o atendente virtual já fez (a
 * mensagem no Direct) e as mesmas ações da gaveta "Comentários". Quem cuida dos comentários é a gestão (gerente e
 * presidente — o servidor confere): para os outros, o comentário que veio com o caso, sem as ações. Quando a pessoa
 * responde no Direct, a conversa segue lá.
 */
export function ComentarioDoCaso({ caso: c }: { caso: CasoDaFila }) {
  const [comentario, setComentario] = useState<ComentarioDoInstagram | null>(null);
  const [erro, setErro] = useState(false);
  // O perfil só depois de montar (V35).
  const [cuida, setCuida] = useState<boolean | null>(null);
  useEffect(() => setCuida(QUEM_CUIDA_DOS_COMENTARIOS.includes(getCategoria() ?? '')), []);

  const ler = useCallback(async () => {
    try {
      setComentario((await api.atendimentoComentarioDoCaso(c.id)) as ComentarioDoInstagram);
      setErro(false);
    } catch {
      setErro(true);
    }
  }, [c.id]);
  useEffect(() => {
    if (cuida) void ler();
  }, [cuida, ler]);

  const doCaso = (c.detalhe?.comentario ?? {}) as { autorUsuario?: string; texto?: string };

  return (
    <section className="space-y-2 rounded-lg border border-border p-3 text-sm" aria-label="Comentário no post">
      <h3 className="font-display font-bold">Comentário no post</h3>
      {cuida === false ? (
        <>
          <p className="font-semibold">{arroba(doCaso.autorUsuario ?? null)} comentou</p>
          <p className="whitespace-pre-wrap break-words border-l-4 border-border pl-3">{doCaso.texto || '(sem texto)'}</p>
          <p className="text-xs text-secondary-foreground">Quem responde e esconde comentários é o gerente ou o presidente.</p>
        </>
      ) : erro ? (
        <div className="space-y-2" role="status">
          <p>Não consegui ler o comentário agora.</p>
          <Button type="button" variant="outline" size="sm" onClick={() => void ler()}>
            Tentar de novo
          </Button>
        </div>
      ) : !comentario ? (
        <p className="text-secondary-foreground">Lendo o comentário…</p>
      ) : (
        <>
          <ComentarioCartao comentario={comentario} noCaso podeAgir aoMudar={setComentario} />
          <p className="text-xs text-secondary-foreground">Sem pedido ligado: o Instagram não manda telefone. Quando a pessoa responder a mensagem do Direct, a conversa segue no Direct, como as outras.</p>
        </>
      )}
    </section>
  );
}
