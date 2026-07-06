'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

/* eslint-disable @typescript-eslint/no-explicit-any */
const brl = (n: number) =>
  Number(n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export type SelecaoProduto = {
  produtoId: string;
  variacaoId?: string;
  complementos?: string[];
  observacao?: string;
  label: string; // "X-Burger · sem alface + bacon" (para feedback)
};

// Grade de produtos + seletor de variação/opcionais/adicionais. Ao confirmar,
// chama onAdd com a seleção (o chamador decide o que fazer — ex.: lançar na mesa).
export function SeletorProduto({
  onAdd,
  enviando,
}: {
  onAdd: (sel: SelecaoProduto) => void;
  enviando?: boolean;
}) {
  const [produtos, setProdutos] = useState<any[]>([]);
  const [categorias, setCategorias] = useState<any[]>([]);
  const [catAtiva, setCatAtiva] = useState('');
  const [picker, setPicker] = useState<any>(null);
  const [pickVar, setPickVar] = useState<string | undefined>(undefined);
  const [pickOpc, setPickOpc] = useState<string[]>([]);
  const [pickObs, setPickObs] = useState('');
  const [erro, setErro] = useState('');

  const reload = useCallback(async () => {
    try {
      const [ps, cs] = await Promise.all([api.produtos(), api.produtoCategorias()]);
      setProdutos((ps as any[]).filter((p) => p.ativo !== false));
      setCategorias(cs as any[]);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao carregar');
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  async function tap(p: any) {
    let full: any = p;
    try {
      full = await api.produto(p.id);
    } catch {
      /* usa o resumo */
    }
    const variacoes = full.variacoes ?? [];
    const complementos = full.complementos ?? [];
    // Produto simples entra em 1 toque (sem abrir o modal) — mais rápido no salão.
    if (variacoes.length === 0 && complementos.length === 0) {
      onAdd({ produtoId: p.id, complementos: [], label: p.nome });
      return;
    }
    setPickVar(undefined);
    setPickOpc([]);
    setPickObs('');
    setPicker({ produto: p, variacoes, complementos });
  }

  function toggleOpc(id: string) {
    setPickOpc((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  }

  function confirmar() {
    const { produto, variacoes, complementos } = picker;
    const v = variacoes.find((x: any) => x.id === pickVar);
    let label = v ? `${produto.nome} · ${v.nome}` : produto.nome;
    const todas = (complementos as any[]).flatMap((g) =>
      (g.opcoes ?? []).map((o: any) => ({ ...o, tipo: g.tipo })),
    );
    const partes = pickOpc
      .map((id) => todas.find((o) => o.id === id))
      .filter(Boolean)
      .map((o: any) => (o.tipo === 'remover' ? `sem ${o.nome}` : `+ ${o.nome}`));
    const obs = pickObs.trim() || undefined;
    if (partes.length) label += ` (${partes.join(' · ')})`;
    if (obs) label += ` · obs: ${obs}`;
    onAdd({
      produtoId: produto.id,
      variacaoId: pickVar,
      complementos: pickOpc,
      observacao: obs,
      label,
    });
    setPicker(null);
  }

  const visiveis = catAtiva
    ? produtos.filter((p) => p.categoriaId === catAtiva)
    : produtos;

  // Agrupa por categoria (com cabeçalho).
  const nomePorId = new Map(categorias.map((c: any) => [c.id, c.nome]));
  const grupos = (() => {
    const m = new Map<string, { nome: string; itens: any[] }>();
    for (const p of visiveis) {
      const key = p.categoriaId ?? '_sem';
      if (!m.has(key))
        m.set(key, {
          nome: p.categoriaId ? nomePorId.get(p.categoriaId) ?? p.categoriaNome ?? 'Categoria' : 'Sem categoria',
          itens: [],
        });
      m.get(key)!.itens.push(p);
    }
    return [...m.values()];
  })();

  return (
    <div className="space-y-3">
      {erro && <p className="text-destructive">{erro}</p>}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setCatAtiva('')}
          className={`rounded-lg border px-3 py-1.5 text-sm font-medium ${!catAtiva ? 'border-primary bg-primary/15 text-primary' : 'border-border bg-card text-muted-foreground'}`}
        >
          Todos
        </button>
        {categorias.filter((c) => !c.parentId).map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => setCatAtiva(c.id)}
            className={`rounded-lg border px-3 py-1.5 text-sm font-medium ${catAtiva === c.id ? 'border-primary bg-primary/15 text-primary' : 'border-border bg-card text-muted-foreground'}`}
          >
            {c.nome}
          </button>
        ))}
      </div>

      {produtos.length === 0 && (
        <Card className="p-8 text-center text-sm text-muted-foreground">
          Nenhum produto. Cadastre em Cadastros → Produtos & Catálogo.
        </Card>
      )}
      {grupos.map((g) => (
        <section key={g.nome} className="space-y-2">
          <h3 className="font-display text-xs font-bold uppercase tracking-[.12em] text-muted-foreground">
            {g.nome} <span className="font-mono font-normal">· {g.itens.length}</span>
          </h3>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {g.itens.map((p) => (
              <button
                key={p.id}
                type="button"
                disabled={enviando}
                onClick={() => tap(p)}
                className="flex flex-col overflow-hidden rounded-xl border border-border bg-card text-left transition hover:border-primary/50 active:scale-95 disabled:opacity-50"
              >
                <div className="grid aspect-square w-full place-items-center overflow-hidden bg-muted/40 text-3xl">
                  {p.imagemRef ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={p.imagemRef} alt={p.nome} className="h-full w-full object-cover" />
                  ) : (
                    <span aria-hidden>🍽️</span>
                  )}
                </div>
                <div className="flex flex-1 flex-col gap-0.5 p-2.5">
                  <span className="line-clamp-2 text-sm font-medium leading-tight">{p.nome}</span>
                  <span className="mt-auto font-mono text-sm font-bold text-primary">{brl(Number(p.precoVenda))}</span>
                  {p.tipo === 'variavel' && <span className="text-[10px] text-muted-foreground">escolher tamanho</span>}
                </div>
              </button>
            ))}
          </div>
        </section>
      ))}

      {/* Seletor de variação + opcionais/adicionais */}
      {picker && (() => {
        const v = picker.variacoes.find((x: any) => x.id === pickVar);
        const base = v ? Number(v.precoVenda) : Number(picker.produto.precoVenda);
        const todas = (picker.complementos as any[]).flatMap((g) =>
          (g.opcoes ?? []).map((o: any) => ({ ...o, tipo: g.tipo })),
        );
        const extra = pickOpc.reduce(
          (s, id) => s + (Number(todas.find((o) => o.id === id)?.precoDelta) || 0),
          0,
        );
        const variacaoObrig = picker.variacoes.length > 0 && !pickVar;
        return (
          <div className="fixed inset-0 z-30 grid place-items-center overflow-y-auto bg-black/50 p-4" onClick={() => setPicker(null)}>
            <Card className="w-full max-w-sm p-5" onClick={(e) => e.stopPropagation()}>
              <h3 className="mb-3 font-display font-semibold">{picker.produto.nome}</h3>
              {picker.variacoes.length > 0 && (
                <div className="mb-3">
                  <p className="mb-1.5 text-xs font-semibold text-muted-foreground">Escolha</p>
                  <div className="space-y-1.5">
                    {picker.variacoes.map((vr: any) => (
                      <button
                        key={vr.id}
                        type="button"
                        onClick={() => setPickVar(vr.id)}
                        className={`flex w-full items-center justify-between rounded-lg border p-2.5 text-left ${pickVar === vr.id ? 'border-primary bg-primary/10' : 'border-border'}`}
                      >
                        <span className="font-medium">{vr.nome}</span>
                        <span className="font-mono text-primary">{brl(Number(vr.precoVenda))}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {(picker.complementos as any[]).map((g) => (
                <div key={g.id} className="mb-3">
                  <p className="mb-1.5 text-xs font-semibold text-muted-foreground">
                    {g.nome} <span className="font-normal">({g.tipo === 'remover' ? 'retirar' : 'adicionar'})</span>
                  </p>
                  <div className="space-y-1">
                    {(g.opcoes ?? []).map((o: any) => (
                      <label
                        key={o.id}
                        className={`flex cursor-pointer items-center gap-2 rounded-lg border p-2.5 ${pickOpc.includes(o.id) ? 'border-primary bg-primary/10' : 'border-border'}`}
                      >
                        <input type="checkbox" checked={pickOpc.includes(o.id)} onChange={() => toggleOpc(o.id)} className="h-4 w-4 accent-primary" />
                        <span className="flex-1 text-sm">{o.nome}</span>
                        {Number(o.precoDelta) > 0 && (
                          <span className="font-mono text-xs text-primary">+ {brl(Number(o.precoDelta))}</span>
                        )}
                      </label>
                    ))}
                  </div>
                </div>
              ))}
              <div className="mt-1">
                <p className="mb-1 text-xs font-semibold text-muted-foreground">Observação (opcional)</p>
                <input
                  type="text"
                  value={pickObs}
                  onChange={(e) => setPickObs(e.target.value)}
                  placeholder="Ex.: sem sal, bem passado"
                  className="w-full rounded-md border border-input bg-card px-3 py-2 text-sm"
                />
              </div>

              <div className="mt-3 flex items-center justify-between border-t border-border pt-3">
                <span className="text-sm text-muted-foreground">Item</span>
                <span className="font-mono text-lg font-bold">{brl(base + extra)}</span>
              </div>
              <Button type="button" className="mt-3 w-full" disabled={variacaoObrig || enviando} onClick={confirmar}>
                {variacaoObrig ? 'Escolha uma opção' : 'Adicionar à mesa'}
              </Button>
            </Card>
          </div>
        );
      })()}
    </div>
  );
}
