'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, getToken } from '@/lib/api';
import { toast } from '@/lib/toast';
import { Shell } from '@/components/app-shell/shell';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

/* eslint-disable @typescript-eslint/no-explicit-any */
const brl = (n: number) =>
  Number(n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

type ItemCarrinho = {
  key: string;
  produtoId: string;
  variacaoId?: string;
  nome: string;
  preco: number;
  qtd: number;
};

export default function PdvPage() {
  const router = useRouter();
  const [produtos, setProdutos] = useState<any[]>([]);
  const [categorias, setCategorias] = useState<any[]>([]);
  const [catAtiva, setCatAtiva] = useState('');
  const [carrinho, setCarrinho] = useState<ItemCarrinho[]>([]);
  const [taxa, setTaxa] = useState(false);
  const [forma, setForma] = useState('dinheiro');
  const [picker, setPicker] = useState<any>(null); // produto variável escolhendo variação
  const [comprovante, setComprovante] = useState<any>(null);
  const [erro, setErro] = useState('');
  const [enviando, setEnviando] = useState(false);
  const chaveRef = useRef<string | null>(null); // chave idempotente da venda atual

  const reload = useCallback(async () => {
    try {
      const [ps, cs] = await Promise.all([api.produtos(), api.produtoCategorias()]);
      setProdutos(ps.filter((p: any) => p.ativo !== false));
      setCategorias(cs);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao carregar');
    }
  }, []);

  useEffect(() => {
    if (!getToken()) {
      router.replace('/entrar');
      return;
    }
    reload();
  }, [reload, router]);

  function addItem(produtoId: string, variacaoId: string | undefined, nome: string, preco: number) {
    const key = `${produtoId}:${variacaoId ?? ''}`;
    setCarrinho((c) => {
      const ex = c.find((i) => i.key === key);
      if (ex) return c.map((i) => (i.key === key ? { ...i, qtd: i.qtd + 1 } : i));
      return [...c, { key, produtoId, variacaoId, nome, preco, qtd: 1 }];
    });
  }

  async function tap(p: any) {
    if (p.tipo === 'variavel') {
      try {
        const full: any = await api.produto(p.id);
        setPicker({ produto: p, variacoes: full.variacoes ?? [] });
      } catch {
        addItem(p.id, undefined, p.nome, Number(p.precoVenda));
      }
      return;
    }
    addItem(p.id, undefined, p.nome, Number(p.precoVenda));
  }

  function mudarQtd(key: string, d: number) {
    setCarrinho((c) =>
      c
        .map((i) => (i.key === key ? { ...i, qtd: i.qtd + d } : i))
        .filter((i) => i.qtd > 0),
    );
  }

  const subtotal = carrinho.reduce((s, i) => s + i.preco * i.qtd, 0);
  const total = subtotal * (taxa ? 1.1 : 1);

  async function finalizar() {
    if (carrinho.length === 0) return;
    setErro('');
    setEnviando(true);
    // Chave idempotente estável: reusada em retry (rede), renovada só após sucesso.
    if (!chaveRef.current) chaveRef.current = crypto.randomUUID();
    try {
      const r: any = await api.vendaBalcao({
        itens: carrinho.map((i) => ({
          produtoId: i.produtoId,
          variacaoId: i.variacaoId,
          quantidade: i.qtd,
        })),
        forma,
        taxaServicoPct: taxa ? 10 : 0,
        idempotencyKey: chaveRef.current,
      });
      setComprovante(r);
      setCarrinho([]);
      setTaxa(false);
      chaveRef.current = null; // sucesso → próxima venda usa chave nova
      toast.success(r?.idempotente ? 'Venda já registrada.' : 'Venda registrada.');
    } catch (e) {
      const m = e instanceof Error ? e.message : 'Erro ao finalizar';
      setErro(m);
      toast.error(m);
    } finally {
      setEnviando(false);
    }
  }

  const visiveis = catAtiva
    ? produtos.filter((p) => p.categoriaId === catAtiva)
    : produtos;

  return (
    <Shell eyebrow="PDV · balcão" title="Venda rápida">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_340px]">
        {/* Produtos */}
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
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {visiveis.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => tap(p)}
                className="flex flex-col items-start gap-1 rounded-xl border border-border bg-card p-3 text-left transition hover:border-primary/50 active:scale-95"
              >
                <span className="font-medium leading-tight">{p.nome}</span>
                <span className="font-mono text-sm text-primary">{brl(Number(p.precoVenda))}</span>
                {p.tipo === 'variavel' && (
                  <span className="text-[10px] text-muted-foreground">escolher tamanho</span>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Carrinho */}
        <Card className="flex h-fit flex-col gap-3 p-4 lg:sticky lg:top-4">
          <h2 className="font-display font-semibold">Comanda</h2>
          {carrinho.length === 0 && (
            <p className="py-6 text-center text-sm text-muted-foreground">Toque nos produtos para adicionar.</p>
          )}
          <div className="space-y-2">
            {carrinho.map((i) => (
              <div key={i.key} className="flex items-center gap-2 text-sm">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{i.nome}</p>
                  <p className="font-mono text-xs text-muted-foreground">{brl(i.preco)}</p>
                </div>
                <button type="button" onClick={() => mudarQtd(i.key, -1)} className="grid h-7 w-7 place-items-center rounded border border-border">−</button>
                <span className="w-5 text-center font-mono">{i.qtd}</span>
                <button type="button" onClick={() => mudarQtd(i.key, 1)} className="grid h-7 w-7 place-items-center rounded border border-border">＋</button>
              </div>
            ))}
          </div>

          {carrinho.length > 0 && (
            <>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={taxa} onChange={(e) => setTaxa(e.target.checked)} className="h-4 w-4 accent-primary" />
                Taxa de serviço 10%
              </label>
              <div className="space-y-1">
                <span className="text-xs text-muted-foreground">Pagamento</span>
                <div className="flex flex-wrap gap-1.5">
                  {['dinheiro', 'pix', 'cartao'].map((fmt) => (
                    <button
                      key={fmt}
                      type="button"
                      onClick={() => setForma(fmt)}
                      className={`rounded-md border px-2.5 py-1 text-xs font-medium capitalize ${forma === fmt ? 'border-primary bg-primary/15 text-primary' : 'border-border'}`}
                    >
                      {fmt}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex items-baseline justify-between border-t border-border pt-2">
                <span className="font-semibold">Total</span>
                <span className="font-mono text-xl font-bold">{brl(total)}</span>
              </div>
              <Button type="button" size="lg" onClick={finalizar} disabled={enviando}>
                {enviando ? 'Finalizando…' : 'Receber e enviar à produção'}
              </Button>
            </>
          )}
        </Card>
      </div>

      {/* Picker de variação */}
      {picker && (
        <div className="fixed inset-0 z-30 grid place-items-center bg-black/50 p-4" onClick={() => setPicker(null)}>
          <Card className="w-full max-w-sm p-5" onClick={(e) => e.stopPropagation()}>
            <h3 className="mb-3 font-display font-semibold">{picker.produto.nome} — escolha</h3>
            <div className="space-y-2">
              {picker.variacoes.length === 0 && (
                <p className="text-sm text-muted-foreground">Sem variações cadastradas.</p>
              )}
              {picker.variacoes.map((v: any) => (
                <button
                  key={v.id}
                  type="button"
                  onClick={() => {
                    addItem(picker.produto.id, v.id, `${picker.produto.nome} · ${v.nome}`, Number(v.precoVenda));
                    setPicker(null);
                  }}
                  className="flex w-full items-center justify-between rounded-lg border border-border p-3 text-left hover:border-primary/50"
                >
                  <span className="font-medium">{v.nome}</span>
                  <span className="font-mono text-primary">{brl(Number(v.precoVenda))}</span>
                </button>
              ))}
            </div>
          </Card>
        </div>
      )}

      {/* Comprovante */}
      {comprovante && (
        <div className="fixed inset-0 z-30 grid place-items-center bg-black/50 p-4" onClick={() => setComprovante(null)}>
          <Card className="w-full max-w-sm p-6 text-center" onClick={(e) => e.stopPropagation()}>
            <p className="font-display text-lg font-bold text-ok">Venda concluída ✓</p>
            <p className="mt-2 font-mono text-3xl font-bold">{brl(comprovante.total)}</p>
            {comprovante.taxaServicoPct > 0 && (
              <p className="mt-1 text-xs text-muted-foreground">inclui {comprovante.taxaServicoPct}% de serviço</p>
            )}
            {comprovante.pedidoKds?.length > 0 && (
              <p className="mt-2 text-sm text-muted-foreground">{comprovante.pedidoKds.length} item(ns) enviado(s) à produção (KDS).</p>
            )}
            <Button type="button" className="mt-4 w-full" onClick={() => setComprovante(null)}>
              Nova venda
            </Button>
          </Card>
        </div>
      )}
    </Shell>
  );
}
