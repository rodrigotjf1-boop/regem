'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

/* eslint-disable @typescript-eslint/no-explicit-any */

// "O QUE ACONTECEU?" (Números do atendimento — protótipo `mockups/regem-central-atendimento.html`, versão 6): o passo
// OPCIONAL do "Resolver o caso" e do "Marcar o motivo". Uma lista fixa de motivos (o servidor manda) e, nos motivos de
// produto, os produtos do próprio pedido. Vem marcado com o que já se sabe (o que o iFood disse na disputa, ou o que a
// equipe marcou antes); tocar de novo desmarca. Alimenta as reclamações por motivo e por produto.

export type MarcaDoCaso = { motivo: string; produtos: string[] } | null;
type MotivoDaLista = { k: string; nome: string; doProduto: boolean };
type Lido = {
  motivo: string | null;
  fonte: 'equipe' | 'plataforma' | null;
  produtosMarcados: string[];
  produtos: string[];
  motivos: MotivoDaLista[];
  maxProdutos: number;
};

const opcao = (ligada: boolean) =>
  `min-h-11 flex-[1_1_9rem] rounded-md border px-3 py-2 text-left text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
    ligada ? 'border-primary bg-primary/15 text-foreground ring-1 ring-inset ring-primary' : 'border-input bg-card text-foreground hover:border-foreground/40'
  }`;

export function OQueAconteceu({
  casoId,
  aoMudar,
  resolvido = false,
  sozinho = false,
}: {
  casoId: string;
  /** Sozinho no diálogo ("Marcar o motivo"): sem a linha que o separa do texto do Resolver. */
  sozinho?: boolean;
  /** A cada toque: o que está marcado agora e se a pessoa mexeu (sem mexer, o Resolver não grava nada). */
  aoMudar: (v: { marca: MarcaDoCaso; mexeu: boolean }) => void;
  resolvido?: boolean;
}) {
  const [lido, setLido] = useState<Lido | null>(null);
  const [erro, setErro] = useState(false);
  const [motivo, setMotivo] = useState<string | null>(null);
  const [produtos, setProdutos] = useState<string[]>([]);

  useEffect(() => {
    let vivo = true;
    setLido(null);
    setErro(false);
    api
      .atendimentoOQueAconteceu(casoId)
      .then((r: any) => {
        if (!vivo) return;
        const l: Lido = {
          motivo: typeof r?.motivo === 'string' ? r.motivo : null,
          fonte: r?.fonte === 'equipe' || r?.fonte === 'plataforma' ? r.fonte : null,
          produtosMarcados: Array.isArray(r?.produtosMarcados) ? r.produtosMarcados.map(String) : [],
          produtos: Array.isArray(r?.produtos) ? r.produtos.map(String) : [],
          motivos: Array.isArray(r?.motivos) ? r.motivos : [],
          maxProdutos: Number(r?.maxProdutos) || 10,
        };
        setLido(l);
        // "Não foi reclamação" vindo da plataforma (mudança de pedido) não precisa aparecer marcado.
        const inicial = l.fonte === 'plataforma' && l.motivo === 'nao' ? null : l.motivo;
        setMotivo(inicial);
        setProdutos(l.produtosMarcados);
      })
      .catch(() => vivo && setErro(true));
    return () => {
      vivo = false;
    };
  }, [casoId]);

  const doProduto = (k: string | null) => !!lido?.motivos.find((m) => m.k === k)?.doProduto;
  const avisar = (m: string | null, p: string[]) => aoMudar({ marca: m ? { motivo: m, produtos: doProduto(m) ? p : [] } : null, mexeu: true });

  if (erro)
    return (
      <p className="rounded-md border border-dashed border-input px-3 py-2 text-sm text-secondary-foreground">
        Não deu para carregar a lista de motivos agora{resolvido ? '.' : ' — dá para resolver sem marcar.'}
      </p>
    );
  if (!lido) return <p className="text-sm text-secondary-foreground">Carregando os motivos…</p>;

  const cheio = produtos.length >= lido.maxProdutos;
  return (
    <section className={`space-y-2 ${sozinho ? '' : 'border-t border-border pt-3'}`} aria-label="O que aconteceu">
      <p className="text-sm font-semibold">
        O que aconteceu? <span className="font-normal text-secondary-foreground">(opcional · entra nos Números do atendimento)</span>
      </p>
      <div className="flex flex-wrap gap-2" role="group" aria-label="O que aconteceu">
        {lido.motivos.map((m) => {
          const ligada = motivo === m.k;
          return (
            <button
              key={m.k}
              type="button"
              aria-pressed={ligada}
              className={opcao(ligada)}
              onClick={() => {
                const novo = ligada ? null : m.k; // tocar de novo desmarca: o passo é opcional
                setMotivo(novo);
                avisar(novo, produtos);
              }}
            >
              {m.nome}
            </button>
          );
        })}
      </div>
      {lido.fonte && lido.motivo && lido.motivo !== 'nao' && (
        <p className="text-xs text-secondary-foreground">
          {lido.fonte === 'plataforma' ? 'Já vem marcado com o que o iFood disse na disputa. Mude se não foi isso.' : 'Já marcado antes pela equipe.'}
        </p>
      )}
      {doProduto(motivo) && (
        <div className="space-y-2">
          {lido.produtos.length ? (
            <>
              <p className="text-sm font-semibold">
                Qual produto? <span className="font-normal text-secondary-foreground">(os deste pedido · um ou mais)</span>
              </p>
              <div className="flex flex-wrap gap-2" role="group" aria-label="Produto com problema">
                {lido.produtos.map((p) => {
                  const ligada = produtos.includes(p);
                  return (
                    <button
                      key={p}
                      type="button"
                      aria-pressed={ligada}
                      disabled={!ligada && cheio}
                      className={`${opcao(ligada)} disabled:opacity-50`}
                      onClick={() => {
                        const lista = ligada ? produtos.filter((x) => x !== p) : [...produtos, p];
                        setProdutos(lista);
                        avisar(motivo, lista);
                      }}
                    >
                      {p}
                    </button>
                  );
                })}
              </div>
            </>
          ) : (
            <p className="text-xs text-secondary-foreground">Este caso não tem pedido ligado: fica só o motivo.</p>
          )}
        </div>
      )}
      {resolvido && <p className="text-xs text-secondary-foreground">O caso já está resolvido: só o motivo muda.</p>}
    </section>
  );
}
