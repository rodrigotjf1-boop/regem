'use client';

import { useState } from 'react';
import { api } from '@/lib/api';
import { toast } from '@/lib/toast';
import { Button } from '@/components/ui/button';
import { Dialogo } from '@/components/ui/sobreposto';
import { CorrigirResposta } from '@/components/atendimento/corrigir-resposta';
import {
  ASSUNTOS_DO_CONHECIMENTO,
  LIMITE_DO_CONHECIMENTO,
  ROTULO_DA_ORIGEM,
  type ItemDeConhecimento,
} from '@/lib/treino-do-atendente';

const quando = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
};

/**
 * "O QUE ELE APRENDEU" (F4, protótipo v13): o conhecimento do atendente por assunto, com editar, remover e "＋ Ensinar
 * uma resposta". A lista vem de quem abre (a gaveta de teste); aqui só se desenha e se muda — cada mudança devolve a
 * lista nova a quem abriu.
 */
export function OQueAprendeu({
  itens,
  erro,
  aoMudar,
}: {
  /** `null` = ainda lendo. */
  itens: ItemDeConhecimento[] | null;
  erro: string;
  aoMudar: (itens: ItemDeConhecimento[]) => void;
}) {
  const [editando, setEditando] = useState<ItemDeConhecimento | 'novo' | null>(null);
  const [removendo, setRemovendo] = useState<ItemDeConhecimento | null>(null);
  const [apagando, setApagando] = useState(false);

  if (erro) return <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm">{erro}</p>;
  if (itens === null) return <p className="py-6 text-center text-sm text-secondary-foreground">Carregando o que ele aprendeu…</p>;

  async function remover(it: ItemDeConhecimento) {
    setApagando(true);
    try {
      await api.atendimentoConhecimentoApagar(it.id);
      aoMudar((itens ?? []).filter((x) => x.id !== it.id));
      toast.success('Resposta removida: o atendente deixa de usá-la.');
      setRemovendo(null);
    } catch (e) {
      toast.error((e as Error)?.message || 'Não deu para remover agora.');
    } finally {
      setApagando(false);
    }
  }

  const grupos = ASSUNTOS_DO_CONHECIMENTO.map((a) => ({ ...a, itens: itens.filter((x) => x.assunto === a.valor) })).filter((g) => g.itens.length);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs text-secondary-foreground" data-conta-aprendido>
          {itens.length} de {LIMITE_DO_CONHECIMENTO} · vale para o WhatsApp e o Direct
        </span>
        <Button type="button" variant="outline" size="sm" onClick={() => setEditando('novo')} disabled={itens.length >= LIMITE_DO_CONHECIMENTO}>
          ＋ Ensinar uma resposta
        </Button>
      </div>
      {grupos.length === 0 ? (
        <p className="rounded-md border-l-4 border-info bg-info/10 px-3 py-2 text-sm">
          Nada ensinado ainda. Corrija uma resposta na conversa de teste ou numa conversa do Direct na fila.
        </p>
      ) : (
        grupos.map((g) => (
          <section key={g.valor} aria-label={g.rotulo}>
            <h3 className="mb-1.5 font-display text-sm font-bold">
              {g.rotulo} · {g.itens.length}
            </h3>
            <ul className="space-y-2">
              {g.itens.map((it) => (
                <li key={it.id} className="min-w-0 space-y-1 rounded-lg border border-border px-3 py-2">
                  <p className="break-words font-semibold">“{it.pergunta}”</p>
                  <p className="whitespace-pre-wrap break-words text-sm">{it.resposta}</p>
                  <p className="text-xs text-secondary-foreground">
                    {ROTULO_DA_ORIGEM[it.origem]}
                    {it.criadoPorNome ? ` · ${it.criadoPorNome}` : ''}
                    {quando(it.atualizadoEm || it.criadoEm) ? ` · ${quando(it.atualizadoEm || it.criadoEm)}` : ''}
                  </p>
                  <div className="flex flex-wrap gap-2 pt-1">
                    <Button type="button" variant="outline" size="sm" onClick={() => setEditando(it)}>
                      Editar
                    </Button>
                    <Button type="button" variant="outline" size="sm" onClick={() => setRemovendo(it)}>
                      Remover
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ))
      )}

      {editando && (
        <CorrigirResposta
          origem="manual"
          item={editando === 'novo' ? undefined : editando}
          aoFechar={() => setEditando(null)}
          aoSalvar={(salvo) => {
            const outros = (itens ?? []).filter((x) => x.id !== salvo.id);
            aoMudar([...outros, salvo]);
            setEditando(null);
          }}
        />
      )}
      {removendo && (
        <Dialogo
          titulo="Remover o que o atendente aprendeu"
          alerta
          aoFechar={() => setRemovendo(null)}
          rodape={
            <>
              <Button type="button" variant="outline" onClick={() => setRemovendo(null)}>
                Cancelar
              </Button>
              <Button type="button" variant="destructive" disabled={apagando} onClick={() => void remover(removendo)}>
                {apagando ? 'Removendo…' : 'Remover'}
              </Button>
            </>
          }
        >
          <p className="text-sm">O atendente deixa de usar esta resposta.</p>
          <p className="mt-2 break-words border-l-4 border-border pl-3 text-sm">
            <b>“{removendo.pergunta}”</b>
            <br />
            {removendo.resposta}
          </p>
        </Dialogo>
      )}
    </div>
  );
}
