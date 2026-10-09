'use client';

import { useId, useState } from 'react';
import { Minus, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialogo } from '@/components/ui/sobreposto';
import { GrupoDeOpcoes } from '@/components/pdv/grupo-de-opcoes';

/* eslint-disable @typescript-eslint/no-explicit-any */
const brl = (n: number) => Number(n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export type EscolhaDoItem = { variacaoId?: string; complementos: string[]; observacao?: string; qtd: number };

// Janela de um item do balcão: tamanho, etapas de opções, observação e quantidade. Serve para o
// item NOVO (produto com escolhas) e para EDITAR um que já está no pedido — inclusive o produto
// simples, que antes entrava com um toque e não tinha como levar observação.
export function EditorDoItem({
  produto,
  variacoes,
  complementos,
  inicial,
  editando,
  aoConfirmar,
  aoTirar,
  aoFechar,
}: {
  produto: any;
  variacoes: any[];
  complementos: any[];
  inicial?: Partial<EscolhaDoItem>;
  editando: boolean;
  aoConfirmar: (e: EscolhaDoItem) => void;
  aoTirar?: () => void;
  aoFechar: () => void;
}) {
  const form = useId();
  const [variacaoId, setVariacaoId] = useState<string | undefined>(inicial?.variacaoId);
  const [opcoes, setOpcoes] = useState<string[]>(inicial?.complementos ?? []);
  const [obs, setObs] = useState(inicial?.observacao ?? '');
  const [qtd, setQtd] = useState(Math.max(1, inicial?.qtd ?? 1));

  const v = variacoes.find((x: any) => x.id === variacaoId);
  const base = v ? Number(v.precoVenda) : Number(produto.precoVenda);
  const todas = complementos.flatMap((g: any) => g.opcoes ?? []);
  const extra = opcoes.reduce((s, id) => s + (Number(todas.find((o: any) => o.id === id)?.precoDelta) || 0), 0);
  const faltaTamanho = variacoes.length > 0 && !variacaoId;

  const confirmar = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (faltaTamanho) return;
    aoConfirmar({ variacaoId, complementos: opcoes, observacao: obs.trim() || undefined, qtd });
  };
  const passo = 'grid h-11 w-11 place-items-center rounded-md hover:bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

  return (
    <Dialogo
      titulo={produto.nome}
      aoFechar={aoFechar}
      largura="sm"
      voltarPara="busca-balcao"
      rodape={
        <>
          <div role="group" aria-label="Quantidade" className="mr-auto flex items-center rounded-md border border-border bg-card">
            <button type="button" onClick={() => setQtd((n) => Math.max(1, n - 1))} disabled={qtd <= 1} aria-label="Diminuir a quantidade" className={`${passo} disabled:opacity-30`}>
              <Minus className="h-4 w-4" aria-hidden="true" />
            </button>
            <span className="w-8 text-center font-mono text-base font-bold" data-teste="qtd-editor">{qtd}</span>
            <button type="button" onClick={() => setQtd((n) => Math.min(99, n + 1))} aria-label="Aumentar a quantidade" className={passo}>
              <Plus className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
          {editando && aoTirar && (
            <Button type="button" variant="outline" className="text-destructive" onClick={aoTirar}>
              <Trash2 className="h-4 w-4" aria-hidden="true" />
              Tirar do pedido
            </Button>
          )}
          <Button type="submit" form={form} disabled={faltaTamanho}>
            {faltaTamanho ? 'Escolha o tamanho' : `${editando ? 'Salvar' : 'Adicionar'} · ${brl((base + extra) * qtd)}`}
          </Button>
        </>
      }
    >
      <form id={form} onSubmit={confirmar}>
        {variacoes.length > 0 && (
          <div className="mb-3">
            <p className="mb-1.5 text-xs font-semibold text-muted-foreground">Tamanho</p>
            <div className="space-y-1.5">
              {variacoes.map((vr: any) => (
                <button
                  key={vr.id}
                  type="button"
                  aria-pressed={variacaoId === vr.id}
                  onClick={() => setVariacaoId(vr.id)}
                  className={`flex min-h-11 w-full items-center justify-between gap-3 rounded-lg border p-2.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${variacaoId === vr.id ? 'border-primary bg-primary/15' : 'border-border'}`}
                >
                  <span className="font-medium">{vr.nome}</span>
                  <span className="font-mono">{brl(Number(vr.precoVenda))}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {complementos.map((g: any) => (
          <GrupoDeOpcoes key={g.id} grupo={g} escolhidas={opcoes} onMudar={setOpcoes} />
        ))}

        <label className="mt-1 block">
          <span className="mb-1 block text-xs font-semibold text-muted-foreground">Observação (opcional)</span>
          <input
            type="text"
            value={obs}
            maxLength={140}
            onChange={(e) => setObs(e.target.value)}
            placeholder="Ex.: sem sal, bem passado"
            // item simples aberto para editar: o cursor já nasce na observação
            data-foco-inicial={variacoes.length === 0 && complementos.length === 0 ? '' : undefined}
            className="h-11 w-full rounded-md border border-input bg-card px-3 text-sm"
          />
        </label>
      </form>
    </Dialogo>
  );
}
