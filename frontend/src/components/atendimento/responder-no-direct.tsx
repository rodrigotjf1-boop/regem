'use client';

import { useId, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { toast } from '@/lib/toast';
import { Button } from '@/components/ui/button';
import { Dialogo } from '@/components/ui/sobreposto';
import { MAX_MENSAGEM_NO_DIRECT, arroba, type ComentarioDoInstagram } from '@/lib/comentarios-do-instagram';

const bytes = (s: string) => new TextEncoder().encode(s).length;

/**
 * "Responder no Direct" — a resposta PRIVADA ao comentário (F6, protótipo v15): só quem comentou vê; regra do Instagram,
 * uma mensagem por comentário, até 7 dias depois dele. O servidor confere de novo (409 com o motivo).
 */
export function ResponderNoDirect({
  comentario: c,
  aoEnviar,
  aoFechar,
}: {
  comentario: ComentarioDoInstagram;
  aoEnviar: (atualizado: ComentarioDoInstagram) => void;
  aoFechar: () => void;
}) {
  const [texto, setTexto] = useState('');
  const [erro, setErro] = useState('');
  const [enviando, setEnviando] = useState(false);
  const ids = { txt: useId(), conta: useId() };
  const tam = bytes(texto);

  async function enviar() {
    const t = texto.trim();
    if (!t) return setErro('Escreva a mensagem antes de enviar.');
    if (bytes(t) > MAX_MENSAGEM_NO_DIRECT) return setErro(`A mensagem passou do limite do Instagram (${MAX_MENSAGEM_NO_DIRECT} caracteres).`);
    setErro('');
    setEnviando(true);
    try {
      const r = (await api.atendimentoComentarioPrivada(c.id, t)) as ComentarioDoInstagram;
      toast.success(`Mensagem enviada no Direct de ${arroba(c.autorUsuario)}.`);
      aoEnviar(r);
    } catch (e) {
      const code = e instanceof ApiError ? e.code : undefined;
      setErro(
        code === 'JA_RESPONDIDO_NO_DIRECT'
          ? 'Esta pessoa já recebeu a mensagem no Direct por este comentário (o Instagram deixa uma só).'
          : code === 'PRAZO_VENCIDO'
            ? 'Passou de 7 dias do comentário: o Instagram não deixa mais mandar a mensagem. Ainda dá para responder no post.'
            : (e as Error)?.message || 'Não deu para enviar agora. Tente de novo.',
      );
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Dialogo
      titulo="Responder no Direct"
      aoFechar={aoFechar}
      fecharNoFundo={false}
      rodape={
        <>
          <Button type="button" variant="outline" onClick={aoFechar}>
            Cancelar
          </Button>
          <Button type="button" onClick={() => void enviar()} disabled={enviando}>
            {enviando ? 'Enviando…' : 'Enviar no Direct'}
          </Button>
        </>
      }
    >
      <div className="space-y-3 text-sm">
        <div className="space-y-1">
          <p className="font-semibold">{arroba(c.autorUsuario)} comentou</p>
          <p className="whitespace-pre-wrap break-words border-l-4 border-border pl-3">{c.texto}</p>
        </div>
        <div className="space-y-1">
          <label htmlFor={ids.txt} className="font-semibold">
            Mensagem no Direct
          </label>
          <textarea
            id={ids.txt}
            rows={4}
            value={texto}
            autoFocus
            aria-describedby={ids.conta}
            onChange={(e) => setTexto(e.target.value)}
            placeholder="Ex.: Oi! Vi seu comentário. Me conta o número do pedido que eu resolvo por aqui."
            className="w-full min-w-0 rounded-md border border-input bg-card px-3 py-2 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <p id={ids.conta} className={`text-xs ${tam > MAX_MENSAGEM_NO_DIRECT ? 'font-semibold text-destructive' : 'text-secondary-foreground'}`}>
            {tam} de {MAX_MENSAGEM_NO_DIRECT}. Só quem comentou vê. Chega no Direct da pessoa (ou em &quot;Solicitações&quot;, se ela não segue a loja), com o link do post.
          </p>
        </div>
        <p className="text-xs text-secondary-foreground">
          Regra do Instagram: <b className="text-foreground">uma mensagem por comentário</b>, até 7 dias depois dele. Quando a pessoa responder, a conversa segue no Direct, como as outras.
        </p>
        {erro && (
          <p role="alert" className="font-semibold text-destructive">
            {erro}
          </p>
        )}
      </div>
    </Dialogo>
  );
}
