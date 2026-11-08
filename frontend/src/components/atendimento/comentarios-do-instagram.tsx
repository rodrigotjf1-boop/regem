'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { api, ApiError } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Gaveta } from '@/components/ui/sobreposto';
import { ComentarioCartao } from '@/components/atendimento/comentario-cartao';
import { FILTROS_DOS_COMENTARIOS, type ComentarioDoInstagram, type FiltroDosComentarios, type ListaDeComentarios } from '@/lib/comentarios-do-instagram';

/** O que a gaveta mostra além da lista: lendo, a leitura falhou ou a conta precisa reconectar (sem a permissão). */
type Situacao = 'lendo' | 'pronta' | 'erro' | 'reconectar';

/** Recusas da API que querem dizer "o Instagram não está pronto para comentários" (sem a permissão, ou outra conta). */
export const ehSemComentarios = (e: unknown) => e instanceof ApiError && ['SEM_PERMISSAO', 'CONTA_TROCADA'].includes(String(e.code ?? ''));

const botaoDeFiltro = (ativo: boolean) =>
  `min-h-11 rounded-md border px-3 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
    ativo ? 'border-primary bg-primary/10 shadow-[inset_0_0_0_1px_hsl(var(--primary))]' : 'border-input bg-card hover:border-foreground/40'
  }`;

/**
 * "💬 Comentários" (F6, protótipo v15): os comentários dos posts dos últimos 30 dias, em Sem resposta · Respondidos ·
 * Escondidos · Todos, com as ações de cada um. A contagem vem do servidor (a mesma regra do "sem resposta").
 */
export function ComentariosDoInstagram({
  podeAgir,
  aoFechar,
  aoAbrirCaso,
  aoContar,
}: {
  podeAgir: boolean;
  aoFechar: () => void;
  aoAbrirCaso: (casoId: string) => void;
  /** Avisa a página do número dos sem resposta (o botão do topo). */
  aoContar: (semResposta: number) => void;
}) {
  const [filtro, setFiltro] = useState<FiltroDosComentarios>('sem-resposta');
  const [itens, setItens] = useState<ComentarioDoInstagram[]>([]);
  const [contagem, setContagem] = useState<ListaDeComentarios['contagem'] | null>(null);
  const [proximo, setProximo] = useState<string | null>(null);
  const [situacao, setSituacao] = useState<Situacao>('lendo');
  const [lendoMais, setLendoMais] = useState(false);
  // Só a leitura mais nova vale (V64): trocar de filtro depressa cruza as respostas.
  const leitura = useRef(0);

  const ler = useCallback(
    async (f: FiltroDosComentarios, silencioso = false) => {
      const n = ++leitura.current;
      if (!silencioso) setSituacao('lendo');
      try {
        const r = (await api.atendimentoComentarios(f)) as ListaDeComentarios;
        if (n !== leitura.current) return;
        // Sem a conta com a permissão dos comentários: nada a responder daqui (o servidor recusaria) — pede para conectar.
        if (r?.permitido === false) {
          setSituacao('reconectar');
          return;
        }
        if (!silencioso) {
          setItens(Array.isArray(r?.itens) ? r.itens : []);
          setProximo(r?.proximo ?? null);
        }
        setContagem(r?.contagem ?? null);
        if (r?.contagem) aoContar(r.contagem.semResposta);
        setSituacao('pronta');
      } catch (e) {
        if (n !== leitura.current) return;
        setSituacao(ehSemComentarios(e) ? 'reconectar' : 'erro');
      }
    },
    [aoContar],
  );

  useEffect(() => {
    void ler(filtro);
  }, [filtro, ler]);

  async function verMais() {
    if (!proximo) return;
    setLendoMais(true);
    const n = leitura.current;
    try {
      const r = (await api.atendimentoComentarios(filtro, proximo)) as ListaDeComentarios;
      if (n !== leitura.current) return;
      setItens((a) => {
        const vistos = new Set(a.map((x) => x.id));
        return [...a, ...(r.itens ?? []).filter((x) => !vistos.has(x.id))];
      });
      setProximo(r.proximo ?? null);
    } catch {
      setSituacao('erro');
    } finally {
      setLendoMais(false);
    }
  }

  // Mudou um comentário: troca no lugar (não pula da lista enquanto a pessoa está nela) e relê só a contagem.
  const mudou = (c: ComentarioDoInstagram) => {
    setItens((a) => a.map((x) => (x.id === c.id ? c : x)));
    void ler(filtro, true);
  };

  return (
    <Gaveta titulo="Comentários do Instagram" aoFechar={aoFechar} media>
      <div className="space-y-3">
        {situacao === 'reconectar' ? (
          <div className="space-y-3">
            <p className="rounded-md bg-warn/15 px-3 py-2 text-sm">
              Para ver e responder os comentários, <b>conecte (ou reconecte) o Instagram da loja</b>: a Meta pede uma permissão a mais para os comentários, e a conta conectada antes dela não a tem.
            </p>
            <Link
              href="/delivery/configuracoes?aba=atendimento"
              className="inline-flex min-h-11 items-center rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Ir para os ajustes do Instagram
            </Link>
          </div>
        ) : (
          <>
            <div className="flex flex-wrap gap-2" role="group" aria-label="Filtrar comentários">
              {FILTROS_DOS_COMENTARIOS.map((x) => (
                <button key={x.filtro} type="button" aria-pressed={filtro === x.filtro} className={botaoDeFiltro(filtro === x.filtro)} onClick={() => setFiltro(x.filtro)}>
                  {x.nome}
                  {contagem ? ` · ${contagem[x.conta]}` : ''}
                </button>
              ))}
            </div>
            <p className="text-sm text-secondary-foreground">
              Comentários dos posts da loja nos últimos 30 dias. Com o atendente virtual ligado para comentários (Delivery › Configurações › Atendimento › Instagram · Direct e comentários), ele responde primeiro; o que não resolve
              fica em &quot;Sem resposta&quot; ou vira caso na fila. Os da própria loja e os das lives ficam de fora.
            </p>
            <div className="space-y-2.5" aria-live="polite" aria-busy={situacao === 'lendo'}>
              {situacao === 'lendo' ? (
                <p className="py-8 text-center text-sm text-secondary-foreground">Lendo os comentários…</p>
              ) : situacao === 'erro' ? (
                <div className="space-y-2 rounded-md border border-dashed border-border p-4 text-center text-sm" role="status">
                  <p>
                    <b>Não consegui ler os comentários agora.</b> Eles continuam no Instagram.
                  </p>
                  <Button type="button" variant="outline" size="sm" onClick={() => void ler(filtro)}>
                    Tentar de novo
                  </Button>
                </div>
              ) : itens.length === 0 ? (
                <div className="rounded-md border border-dashed border-border p-6 text-center text-sm text-secondary-foreground" role="status">
                  {contagem && contagem.todos > 0 ? (
                    <b className="text-foreground">Nenhum comentário neste filtro.</b>
                  ) : (
                    <>
                      <b className="text-foreground">Nenhum comentário nos últimos 30 dias.</b>
                      <br />
                      Quando alguém comentar num post da loja, aparece aqui.
                    </>
                  )}
                </div>
              ) : (
                itens.map((c) => <ComentarioCartao key={c.id} comentario={c} podeAgir={podeAgir} aoMudar={mudou} aoAbrirCaso={aoAbrirCaso} />)
              )}
            </div>
            {situacao === 'pronta' && proximo && (
              <Button type="button" variant="outline" onClick={() => void verMais()} disabled={lendoMais}>
                {lendoMais ? 'Lendo…' : 'Ver mais comentários'}
              </Button>
            )}
          </>
        )}
      </div>
    </Gaveta>
  );
}
