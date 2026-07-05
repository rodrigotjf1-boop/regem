'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { api } from '@/lib/api';

/* eslint-disable @typescript-eslint/no-explicit-any */
const brl = (n: number) =>
  Number(n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

// Cardápio público (QR). Sem login, sem Shell — mobile-first.
export default function CardapioPublicoPage() {
  const params = useParams();
  const search = useSearchParams();
  const token = String(params?.token ?? '');
  const mesa = search?.get('mesa') ?? '';

  const [menu, setMenu] = useState<any>(null);
  const [erro, setErro] = useState('');
  const [cat, setCat] = useState('');
  const [cart, setCart] = useState<Record<string, { qtd: number; obs: string }>>({});
  const [cliente, setCliente] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [ok, setOk] = useState<any>(null);

  const carregar = useCallback(async () => {
    try {
      setMenu(await api.cardapioMenu(token));
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Cardápio indisponível');
    }
  }, [token]);

  useEffect(() => {
    carregar();
  }, [carregar]);

  const produtos = menu?.produtos ?? [];
  const visiveis = cat ? produtos.filter((p: any) => p.categoriaId === cat) : produtos;
  const total = useMemo(
    () =>
      Object.entries(cart).reduce((s, [id, v]) => {
        const p = produtos.find((x: any) => x.id === id);
        return s + (p ? Number(p.precoVenda) * v.qtd : 0);
      }, 0),
    [cart, produtos],
  );
  const qtdItens = Object.values(cart).reduce((s, v) => s + v.qtd, 0);

  function add(id: string, d: number) {
    setCart((c) => {
      const cur = c[id] ?? { qtd: 0, obs: '' };
      const qtd = Math.max(0, cur.qtd + d);
      const n = { ...c };
      if (qtd === 0) delete n[id];
      else n[id] = { ...cur, qtd };
      return n;
    });
  }
  function setObs(id: string, obs: string) {
    setCart((c) => ({ ...c, [id]: { qtd: c[id]?.qtd ?? 1, obs } }));
  }

  async function enviar() {
    const itens = Object.entries(cart).map(([produtoId, v]) => ({
      produtoId,
      quantidade: v.qtd,
      observacao: v.obs || undefined,
    }));
    if (!itens.length) return;
    setEnviando(true);
    try {
      const r: any = await api.cardapioPedido(token, {
        mesa: mesa || undefined,
        cliente: cliente || undefined,
        itens,
      });
      setOk(r);
      setCart({});
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao enviar');
    } finally {
      setEnviando(false);
    }
  }

  if (erro && !menu) {
    return (
      <main className="grid min-h-dvh place-items-center bg-neutral-50 p-6 text-center">
        <p className="text-neutral-600">{erro}</p>
      </main>
    );
  }
  if (!menu) {
    return <main className="grid min-h-dvh place-items-center bg-neutral-50">Carregando…</main>;
  }

  if (ok) {
    return (
      <main className="grid min-h-dvh place-items-center bg-neutral-50 p-6 text-center">
        <div>
          <p className="text-2xl font-bold text-emerald-600">Pedido enviado! ✓</p>
          {ok.modo === 'mesa' ? (
            <p className="mt-2 text-neutral-600">Seu pedido foi para a cozinha (mesa {ok.mesa}).</p>
          ) : (
            <p className="mt-2 text-neutral-600">
              Acompanhe pela senha {ok.displayId ?? ''}. Você será chamado ao ficar pronto.
            </p>
          )}
          <button
            type="button"
            onClick={() => setOk(null)}
            className="mt-6 rounded-full bg-amber-500 px-6 py-3 font-semibold text-white"
          >
            Fazer outro pedido
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-dvh bg-neutral-50 pb-28">
      <header className="sticky top-0 z-10 border-b bg-white px-4 py-3">
        <h1 className="text-lg font-bold text-neutral-900">{menu.nome}</h1>
        <p className="text-xs text-neutral-500">{mesa ? `Mesa ${mesa}` : 'Retirada no balcão'}</p>
      </header>

      {menu.categorias.length > 0 && (
        <div className="flex gap-2 overflow-x-auto px-4 py-3">
          <button
            type="button"
            onClick={() => setCat('')}
            className={`whitespace-nowrap rounded-full border px-3 py-1.5 text-sm ${!cat ? 'border-amber-500 bg-amber-50 text-amber-700' : 'border-neutral-200 bg-white text-neutral-600'}`}
          >
            Todos
          </button>
          {menu.categorias.map((c: any) => (
            <button
              key={c.id}
              type="button"
              onClick={() => setCat(c.id)}
              className={`whitespace-nowrap rounded-full border px-3 py-1.5 text-sm ${cat === c.id ? 'border-amber-500 bg-amber-50 text-amber-700' : 'border-neutral-200 bg-white text-neutral-600'}`}
            >
              {c.nome}
            </button>
          ))}
        </div>
      )}

      <div className="space-y-2 px-4">
        {visiveis.map((p: any) => {
          const c = cart[p.id];
          return (
            <div key={p.id} className="rounded-2xl border border-neutral-200 bg-white p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-semibold text-neutral-900">{p.nome}</p>
                  {p.descricao && <p className="text-sm text-neutral-500">{p.descricao}</p>}
                  <p className="mt-1 font-bold text-amber-600">{brl(p.precoVenda)}</p>
                </div>
                <div className="flex items-center gap-2">
                  {c && (
                    <button type="button" onClick={() => add(p.id, -1)} className="grid h-8 w-8 place-items-center rounded-full border border-neutral-300 text-lg">−</button>
                  )}
                  {c && <span className="w-5 text-center font-semibold">{c.qtd}</span>}
                  <button type="button" onClick={() => add(p.id, 1)} className="grid h-8 w-8 place-items-center rounded-full bg-amber-500 text-lg text-white">＋</button>
                </div>
              </div>
              {c && (
                <input
                  type="text"
                  value={c.obs}
                  onChange={(e) => setObs(p.id, e.target.value)}
                  placeholder="Observação (ex.: sem cebola)"
                  className="mt-2 w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm"
                />
              )}
            </div>
          );
        })}
      </div>

      {qtdItens > 0 && (
        <div className="fixed inset-x-0 bottom-0 border-t bg-white p-3">
          {menu.modo !== 'mesa' && (
            <input
              type="text"
              value={cliente}
              onChange={(e) => setCliente(e.target.value)}
              placeholder="Seu nome"
              className="mb-2 w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm"
            />
          )}
          <button
            type="button"
            onClick={enviar}
            disabled={enviando}
            className="flex w-full items-center justify-between rounded-xl bg-amber-500 px-5 py-3 font-semibold text-white disabled:opacity-60"
          >
            <span>{enviando ? 'Enviando…' : `Enviar pedido (${qtdItens})`}</span>
            <span>{brl(total)}</span>
          </button>
          {erro && <p className="mt-2 text-center text-sm text-red-600">{erro}</p>}
        </div>
      )}
    </main>
  );
}
