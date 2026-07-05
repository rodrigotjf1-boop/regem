'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { api } from '@/lib/api';

/* eslint-disable @typescript-eslint/no-explicit-any, @next/next/no-img-element */
const brl = (n: number) =>
  Number(n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const TEMA: Record<string, string> = {
  food: '#E2A340',
  varejo: '#2563EB',
  industria: '#E05A2B',
  servicos: '#0E8E7E',
};
const SELO: Record<string, string> = {
  mais_pedido: '🔥 Mais pedido',
  novo: '✨ Novo',
  veg: '🌱 Veg',
  sem_gluten: '🌾 S/ glúten',
  sem_lactose: '🥛 S/ lactose',
  picante: '🌶️ Picante',
};

type CartItem = {
  key: string;
  produtoId: string;
  variacaoId?: string;
  complementos: string[];
  nome: string;
  sub: string;
  preco: number;
  obs: string;
  qtd: number;
};

export default function CardapioPublicoPage() {
  const params = useParams();
  const search = useSearchParams();
  const token = String(params?.token ?? '');
  const mesa = search?.get('mesa') ?? '';

  const [menu, setMenu] = useState<any>(null);
  const [erro, setErro] = useState('');
  const [cat, setCat] = useState('');
  const [cart, setCart] = useState<CartItem[]>([]);
  const [cliente, setCliente] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [checkout, setCheckout] = useState(false);
  const [ped, setPed] = useState<any>(null); // pedido enviado (status/timeline)
  const [chk, setChk] = useState<any>({ tipo: 'entrega', endereco: '', bairroId: '', forma: '', troco: '', cupom: '', telefone: '' });
  const [cupomOk, setCupomOk] = useState<any>(null);
  const [sel, setSel] = useState<any>(null); // produto no modal
  const [pickVar, setPickVar] = useState<string | undefined>();
  const [pickOpc, setPickOpc] = useState<string[]>([]);
  const [pickObs, setPickObs] = useState('');

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

  const loja = menu?.loja;
  const accent = TEMA[loja?.ramo] ?? '#E2A340';
  const produtos = menu?.produtos ?? [];
  const visiveis = cat ? produtos.filter((p: any) => p.categoriaId === cat) : produtos;
  const total = useMemo(() => cart.reduce((s, i) => s + i.preco * i.qtd, 0), [cart]);
  const qtdItens = cart.reduce((s, i) => s + i.qtd, 0);

  // ---- modal ----
  function abrir(p: any) {
    setSel(p);
    setPickVar(undefined);
    setPickOpc([]);
    setPickObs('');
  }
  function toggleOpc(g: any, id: string) {
    setPickOpc((s) => {
      if (s.includes(id)) return s.filter((x) => x !== id);
      if (g.max === 1) {
        const outros = (g.opcoes ?? []).map((o: any) => o.id);
        return [...s.filter((x) => !outros.includes(x)), id];
      }
      const noGrupo = s.filter((x) => (g.opcoes ?? []).some((o: any) => o.id === x));
      if (g.max && noGrupo.length >= g.max) return s;
      return [...s, id];
    });
  }
  const modalOpcoes = (sel?.grupos ?? []).flatMap((g: any) => (g.opcoes ?? []).map((o: any) => ({ ...o })));
  const modalVar = (sel?.variacoes ?? []).find((v: any) => v.id === pickVar);
  const modalBase = modalVar ? modalVar.precoVenda : sel?.precoVenda ?? 0;
  const modalExtra = pickOpc.reduce((s, id) => s + (modalOpcoes.find((o: any) => o.id === id)?.precoDelta ?? 0), 0);
  const modalPreco = modalBase + modalExtra;
  const modalValido =
    sel &&
    (sel.variacoes?.length ? !!pickVar : true) &&
    (sel.grupos ?? []).every((g: any) => {
      if (!g.obrigatorio && !g.min) return true;
      const n = pickOpc.filter((id) => (g.opcoes ?? []).some((o: any) => o.id === id)).length;
      return n >= (g.min || 1);
    });

  function addAoCarrinho() {
    if (!sel || !modalValido) return;
    const partes: string[] = [];
    if (modalVar) partes.push(modalVar.nome);
    pickOpc.forEach((id) => { const o = modalOpcoes.find((x: any) => x.id === id); if (o) partes.push(o.nome); });
    const key = `${sel.id}:${pickVar ?? ''}:${[...pickOpc].sort().join(',')}:${pickObs}`;
    setCart((c) => {
      const ex = c.find((i) => i.key === key);
      if (ex) return c.map((i) => (i.key === key ? { ...i, qtd: i.qtd + 1 } : i));
      return [...c, {
        key, produtoId: sel.id, variacaoId: pickVar, complementos: pickOpc,
        nome: sel.nome, sub: partes.join(' · '), preco: modalPreco, obs: pickObs.trim(), qtd: 1,
      }];
    });
    setSel(null);
  }
  function mudarQtd(key: string, d: number) {
    setCart((c) => c.map((i) => (i.key === key ? { ...i, qtd: i.qtd + d } : i)).filter((i) => i.qtd > 0));
  }

  const taxa = useMemo(() => {
    if (chk.tipo !== 'entrega' || !menu) return 0;
    if (loja?.freteGratisAcima != null && total >= loja.freteGratisAcima) return 0;
    return Number((menu.bairros ?? []).find((b: any) => b.id === chk.bairroId)?.taxa ?? 0);
  }, [chk.tipo, chk.bairroId, total, menu, loja]);
  const desc = cupomOk?.valido ? cupomOk.desconto : 0;
  const totalFinal = Math.max(0, total - desc + taxa);

  async function aplicarCupom() {
    if (!chk.cupom.trim()) return;
    try {
      const r: any = await api.cardapioCupomValidar(token, chk.cupom.trim(), total);
      setCupomOk(r);
    } catch { setCupomOk({ valido: false }); }
  }

  async function enviar() {
    if (!cart.length) return;
    // Mesa: envia direto. Retirada/totem: passa pelo checkout.
    if (menu.modo === 'mesa') return void submitPedido();
    setCheckout(true);
  }

  async function submitPedido() {
    setEnviando(true);
    try {
      const r: any = await api.cardapioPedido(token, {
        mesa: mesa || undefined,
        cliente: cliente || chk.nome || 'Cliente',
        telefone: chk.telefone || undefined,
        tipo: chk.tipo,
        endereco: chk.tipo === 'entrega' ? chk.endereco : undefined,
        bairroId: chk.tipo === 'entrega' ? chk.bairroId || undefined : undefined,
        formaPagamento: chk.forma || undefined,
        trocoPara: chk.forma === 'entrega' && chk.troco ? Number(String(chk.troco).replace(',', '.')) : undefined,
        cupom: cupomOk?.valido ? chk.cupom.trim() : undefined,
        itens: cart.map((i) => ({
          produtoId: i.produtoId, variacaoId: i.variacaoId, complementos: i.complementos,
          quantidade: i.qtd, observacao: i.obs || undefined,
        })),
      });
      if (r.pagamentoOnline && r.pedidoId) {
        // gateway (mock): confirma o pagamento online
        await api.cardapioPagar(token, r.pedidoId).catch(() => {});
      }
      setCart([]);
      setCheckout(false);
      if (r.modo === 'mesa') { setPed({ mesa: r.mesa, modo: 'mesa' }); }
      else { setPed({ pedidoId: r.pedidoId, displayId: r.displayId, status: 'novo' }); }
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao enviar');
    } finally {
      setEnviando(false);
    }
  }

  // Polling da timeline (pedido de retirada/entrega).
  useEffect(() => {
    if (!ped?.pedidoId) return;
    const t = setInterval(async () => {
      try { const s: any = await api.cardapioStatus(token, ped.pedidoId); setPed((p: any) => ({ ...p, ...s })); } catch { /* */ }
    }, 5000);
    return () => clearInterval(t);
  }, [ped?.pedidoId, token]);

  if (erro && !menu)
    return <main className="grid min-h-dvh place-items-center bg-neutral-50 p-6 text-center text-neutral-600">{erro}</main>;
  if (!menu) return <main className="grid min-h-dvh place-items-center bg-neutral-50">Carregando…</main>;

  // ---- pedido enviado: timeline ----
  if (ped) {
    const passos = ['novo', 'confirmado', 'pronto', 'despachado', 'concluido'];
    const rot: Record<string, string> = { novo: 'Pedido recebido', confirmado: 'Em preparo', pronto: 'Pronto', despachado: chk.tipo === 'entrega' ? 'Saiu para entrega' : 'Aguardando retirada', concluido: 'Concluído' };
    const idx = ped.modo === 'mesa' ? 0 : Math.max(0, passos.indexOf(ped.status ?? 'novo'));
    return (
      <main className="min-h-dvh bg-neutral-50 p-6">
        <div className="mx-auto max-w-md text-center">
          <p className="text-3xl">🎉</p>
          <h1 className="mt-1 text-xl font-bold" style={{ color: accent }}>Pedido enviado!</h1>
          {ped.modo === 'mesa'
            ? <p className="mt-1 text-neutral-600">Foi para a cozinha (mesa {ped.mesa}).</p>
            : <p className="mt-1 text-neutral-600">Senha {ped.displayId} · total {brl(ped.total ?? totalFinal)}</p>}
          {ped.pedidoId && ped.status !== 'cancelado' && (
            <div className="mt-6 text-left">
              {passos.map((s, i) => (
                <div key={s} className="flex items-center gap-3 pb-4">
                  <span className="grid h-6 w-6 flex-none place-items-center rounded-full text-xs text-white" style={{ background: i <= idx ? accent : '#d4d4d4' }}>{i < idx ? '✓' : ''}</span>
                  <span className={`text-sm ${i === idx ? 'font-bold' : i < idx ? 'text-neutral-500' : 'text-neutral-400'}`}>{rot[s]}</span>
                </div>
              ))}
            </div>
          )}
          {ped.status === 'cancelado' && <p className="mt-4 text-red-600">Pedido cancelado.</p>}
          {loja.whatsapp && (
            <a href={`https://wa.me/${loja.whatsapp.replace(/\D/g, '')}`} className="mt-4 inline-block rounded-xl bg-emerald-500 px-5 py-3 font-semibold text-white">💬 Falar no WhatsApp</a>
          )}
          <button type="button" onClick={() => { setPed(null); setCupomOk(null); }} className="mt-6 block w-full rounded-xl px-5 py-3 font-semibold text-white" style={{ background: accent }}>Fazer outro pedido</button>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-dvh bg-neutral-50 pb-28">
      {/* Hero */}
      <header className="px-4 py-4 text-white" style={{ background: `linear-gradient(150deg, #1a1a1a, ${accent}22)` , backgroundColor: '#1f1a14' }}>
        <div className="flex items-center gap-3">
          <div className="grid h-14 w-14 flex-none place-items-center rounded-2xl text-3xl" style={{ background: accent }}>
            {loja.logoEmoji ?? '🍔'}
          </div>
          <div className="min-w-0">
            <h1 className="truncate text-lg font-bold">{loja.nome}</h1>
            {loja.subtitulo && <p className="truncate text-xs text-white/60">{loja.subtitulo}</p>}
          </div>
          <span className={`ml-auto flex-none rounded-full border px-3 py-1 text-[10px] font-bold ${loja.aberto ? 'border-emerald-400/50 bg-emerald-400/15 text-emerald-300' : 'border-red-400/50 bg-red-400/15 text-red-300'}`}>
            {loja.aberto ? '● ABERTO' : '● FECHADO'}
          </span>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {loja.tempoEntregaMin && <span className="rounded-lg bg-white/10 px-2.5 py-1.5 text-xs">⏱ {loja.tempoEntregaMin} min</span>}
          {loja.freteGratisAcima != null && <span className="rounded-lg bg-white/10 px-2.5 py-1.5 text-xs">🛵 Frete grátis &gt; {brl(loja.freteGratisAcima)}</span>}
          {loja.pedidoMinimo != null && <span className="rounded-lg bg-white/10 px-2.5 py-1.5 text-xs">Mín. {brl(loja.pedidoMinimo)}</span>}
          {loja.avaliacao != null && <span className="rounded-lg bg-white/10 px-2.5 py-1.5 text-xs">⭐ {loja.avaliacao}</span>}
        </div>
      </header>

      {mesa && <div className="bg-white px-4 py-2 text-center text-xs text-neutral-500">Mesa {mesa}</div>}

      {/* categorias */}
      {menu.categorias.length > 0 && (
        <div className="sticky top-0 z-10 flex gap-2 overflow-x-auto bg-neutral-50 px-4 py-3">
          <button type="button" onClick={() => setCat('')} className="whitespace-nowrap rounded-full border px-3 py-1.5 text-sm" style={cat === '' ? { borderColor: accent, color: accent, background: `${accent}15` } : { borderColor: '#e5e5e5', color: '#666', background: '#fff' }}>Todos</button>
          {menu.categorias.map((c: any) => (
            <button key={c.id} type="button" onClick={() => setCat(c.id)} className="whitespace-nowrap rounded-full border px-3 py-1.5 text-sm" style={cat === c.id ? { borderColor: accent, color: accent, background: `${accent}15` } : { borderColor: '#e5e5e5', color: '#666', background: '#fff' }}>{c.nome}</button>
          ))}
        </div>
      )}

      {/* itens */}
      <div className="space-y-2 px-4 pt-2">
        {visiveis.map((p: any) => (
          <button key={p.id} type="button" onClick={() => abrir(p)} className="flex w-full gap-3 rounded-2xl border border-neutral-200 bg-white p-3 text-left">
            <div className="min-w-0 flex-1">
              <p className="font-semibold text-neutral-900">{p.nome}</p>
              <div className="mt-0.5 flex flex-wrap gap-1">
                {(p.selos ?? []).map((s: string) => <span key={s} className="rounded-full bg-neutral-100 px-2 py-0.5 text-[10px] font-semibold text-neutral-600">{SELO[s] ?? s}</span>)}
                {p.duracaoMin && <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-[10px] font-semibold text-neutral-600">🕐 {p.duracaoMin} min</span>}
              </div>
              {p.descricao && <p className="mt-1 line-clamp-2 text-sm text-neutral-500">{p.descricao}</p>}
              <div className="mt-1 flex items-baseline gap-2">
                {p.precoDe != null && <span className="text-xs text-neutral-400 line-through">{brl(p.precoDe)}</span>}
                <span className="font-bold" style={{ color: accent }}>{brl(p.precoVenda)}</span>
              </div>
            </div>
            {p.imagemRef && <img src={p.imagemRef} alt={p.nome} className="h-20 w-20 flex-none rounded-xl object-cover" />}
          </button>
        ))}
      </div>

      {/* barra do carrinho */}
      {qtdItens > 0 && (
        <div className="fixed inset-x-0 bottom-0 mx-auto max-w-lg p-3">
          <div className="rounded-xl bg-white p-3 shadow-lg">
            {menu.modo !== 'mesa' && <input value={cliente} onChange={(e) => setCliente(e.target.value)} placeholder="Seu nome" className="mb-2 w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm" />}
            <div className="mb-2 max-h-28 space-y-1 overflow-y-auto">
              {cart.map((i) => (
                <div key={i.key} className="flex items-center gap-2 text-sm">
                  <div className="flex items-center gap-1">
                    <button type="button" onClick={() => mudarQtd(i.key, -1)} className="grid h-6 w-6 place-items-center rounded-full border">−</button>
                    <span className="w-4 text-center">{i.qtd}</span>
                    <button type="button" onClick={() => mudarQtd(i.key, 1)} className="grid h-6 w-6 place-items-center rounded-full border">＋</button>
                  </div>
                  <span className="min-w-0 flex-1 truncate">{i.nome}{i.sub ? ` · ${i.sub}` : ''}</span>
                  <span className="font-mono text-xs">{brl(i.preco * i.qtd)}</span>
                </div>
              ))}
            </div>
            <button type="button" onClick={enviar} disabled={enviando} className="flex w-full items-center justify-between rounded-xl px-5 py-3 font-semibold text-white disabled:opacity-60" style={{ background: accent }}>
              <span>{enviando ? 'Enviando…' : `Enviar pedido (${qtdItens})`}</span>
              <span>{brl(total)}</span>
            </button>
            {erro && <p className="mt-2 text-center text-sm text-red-600">{erro}</p>}
          </div>
        </div>
      )}

      {/* modal item */}
      {sel && (
        <div className="fixed inset-0 z-30 flex items-end justify-center bg-black/50" onClick={() => setSel(null)}>
          <div className="max-h-[92dvh] w-full max-w-lg overflow-y-auto rounded-t-3xl bg-white" onClick={(e) => e.stopPropagation()}>
            {sel.imagemRef && <img src={sel.imagemRef} alt={sel.nome} className="h-44 w-full object-cover" />}
            <div className="p-4">
              <div className="flex items-start justify-between gap-2">
                <h2 className="text-lg font-bold">{sel.nome}</h2>
                <button type="button" onClick={() => setSel(null)} className="text-neutral-400">✕</button>
              </div>
              {sel.descricao && <p className="mt-1 text-sm text-neutral-500">{sel.descricao}</p>}

              {sel.variacoes?.length > 0 && (
                <div className="mt-4">
                  <p className="mb-1 text-sm font-semibold">Escolha <span className="text-xs text-red-500">obrigatório</span></p>
                  {sel.variacoes.map((v: any) => (
                    <button key={v.id} type="button" onClick={() => setPickVar(v.id)} className="mb-1.5 flex w-full items-center justify-between rounded-xl border p-3" style={pickVar === v.id ? { borderColor: accent } : { borderColor: '#e5e5e5' }}>
                      <span className="text-sm">{v.nome}</span><span className="font-mono text-sm">{brl(v.precoVenda)}</span>
                    </button>
                  ))}
                </div>
              )}

              {(sel.grupos ?? []).map((g: any) => (
                <div key={g.id} className="mt-4">
                  <p className="mb-1 text-sm font-semibold">{g.nome}{' '}
                    <span className="text-xs text-neutral-400">{g.obrigatorio || g.min ? 'obrigatório · ' : ''}{g.max === 1 ? 'escolha 1' : g.max ? `até ${g.max}` : 'opcional'}</span>
                  </p>
                  {(g.opcoes ?? []).map((o: any) => (
                    <label key={o.id} className="mb-1.5 flex cursor-pointer items-center gap-2 rounded-xl border p-3" style={pickOpc.includes(o.id) ? { borderColor: accent } : { borderColor: '#e5e5e5' }}>
                      <input type="checkbox" checked={pickOpc.includes(o.id)} onChange={() => toggleOpc(g, o.id)} className="h-4 w-4" style={{ accentColor: accent }} />
                      <span className="flex-1 text-sm">{o.nome}</span>
                      {o.precoDelta > 0 && <span className="font-mono text-xs text-neutral-500">+ {brl(o.precoDelta)}</span>}
                    </label>
                  ))}
                </div>
              ))}

              <div className="mt-4">
                <p className="mb-1 text-sm font-semibold">Observação</p>
                <input value={pickObs} onChange={(e) => setPickObs(e.target.value)} placeholder="Ex.: sem cebola" className="w-full rounded-xl border border-neutral-200 px-3 py-2 text-sm" />
              </div>

              <button type="button" onClick={addAoCarrinho} disabled={!modalValido} className="mt-5 flex w-full items-center justify-between rounded-xl px-5 py-3 font-semibold text-white disabled:opacity-50" style={{ background: accent }}>
                <span>{modalValido ? 'Adicionar' : 'Escolha as opções'}</span>
                <span>{brl(modalPreco)}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* checkout */}
      {checkout && (
        <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/50" onClick={() => setCheckout(false)}>
          <div className="max-h-[92dvh] w-full max-w-lg overflow-y-auto rounded-t-3xl bg-white p-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold">Finalizar pedido</h2>
              <button type="button" onClick={() => setCheckout(false)} className="text-neutral-400">✕</button>
            </div>

            <div className="mt-3 grid grid-cols-2 gap-2">
              {['entrega', 'retirada'].map((t) => (
                <button key={t} type="button" onClick={() => setChk((s: any) => ({ ...s, tipo: t }))} className="rounded-xl border py-2.5 text-sm font-semibold capitalize" style={chk.tipo === t ? { borderColor: accent, color: accent } : { borderColor: '#e5e5e5', color: '#666' }}>{t}</button>
              ))}
            </div>

            {chk.tipo === 'entrega' && (
              <div className="mt-3 space-y-2">
                <input value={chk.endereco} onChange={(e) => setChk((s: any) => ({ ...s, endereco: e.target.value }))} placeholder="Endereço de entrega" className="w-full rounded-xl border border-neutral-200 px-3 py-2 text-sm" />
                {(menu.bairros ?? []).length > 0 && (
                  <select aria-label="Bairro" value={chk.bairroId} onChange={(e) => setChk((s: any) => ({ ...s, bairroId: e.target.value }))} className="w-full rounded-xl border border-neutral-200 px-3 py-2 text-sm">
                    <option value="">Bairro (taxa)</option>
                    {menu.bairros.map((b: any) => <option key={b.id} value={b.id}>{b.nome} — {brl(b.taxa)}</option>)}
                  </select>
                )}
              </div>
            )}

            <div className="mt-3 flex gap-2">
              <input value={chk.nome ?? cliente} onChange={(e) => setChk((s: any) => ({ ...s, nome: e.target.value }))} placeholder="Seu nome" className="flex-1 rounded-xl border border-neutral-200 px-3 py-2 text-sm" />
              <input value={chk.telefone} onChange={(e) => setChk((s: any) => ({ ...s, telefone: e.target.value }))} placeholder="WhatsApp" className="flex-1 rounded-xl border border-neutral-200 px-3 py-2 text-sm" />
            </div>

            {/* cupom */}
            <div className="mt-3 flex gap-2">
              <input value={chk.cupom} onChange={(e) => setChk((s: any) => ({ ...s, cupom: e.target.value.toUpperCase() }))} placeholder="Cupom" className="flex-1 rounded-xl border border-neutral-200 px-3 py-2 text-sm uppercase" />
              <button type="button" onClick={aplicarCupom} className="rounded-xl bg-neutral-900 px-4 text-sm font-semibold text-white">Aplicar</button>
            </div>
            {cupomOk && <p className={`mt-1 text-xs ${cupomOk.valido ? 'text-emerald-600' : 'text-red-600'}`}>{cupomOk.valido ? `Cupom aplicado: −${brl(cupomOk.desconto)}` : cupomOk.motivo ?? 'Cupom inválido'}</p>}

            {/* pagamento */}
            {(loja.pagamentos ?? []).length > 0 && (
              <div className="mt-3">
                <p className="mb-1 text-sm font-semibold">Pagamento</p>
                <div className="grid grid-cols-2 gap-2">
                  {(loja.pagamentos ?? []).map((pg: string) => {
                    const lbl: Record<string, string> = { pix: '⚡ Pix online', cartao: '💳 Cartão online', entrega: '💵 Na entrega', vr: '🍽 Vale-refeição' };
                    return (
                      <button key={pg} type="button" onClick={() => setChk((s: any) => ({ ...s, forma: pg }))} className="rounded-xl border py-2.5 text-xs font-semibold" style={chk.forma === pg ? { borderColor: accent, color: accent } : { borderColor: '#e5e5e5', color: '#666' }}>{lbl[pg] ?? pg}</button>
                    );
                  })}
                </div>
                {chk.forma === 'entrega' && (
                  <input value={chk.troco} onChange={(e) => setChk((s: any) => ({ ...s, troco: e.target.value }))} placeholder="Troco para quanto?" className="mt-2 w-full rounded-xl border border-neutral-200 px-3 py-2 text-sm" />
                )}
              </div>
            )}

            {/* totais */}
            <div className="mt-4 space-y-1 border-t border-neutral-200 pt-3 text-sm">
              <div className="flex justify-between text-neutral-500"><span>Subtotal</span><span className="font-mono">{brl(total)}</span></div>
              {desc > 0 && <div className="flex justify-between text-emerald-600"><span>Cupom</span><span className="font-mono">− {brl(desc)}</span></div>}
              {chk.tipo === 'entrega' && <div className="flex justify-between text-neutral-500"><span>Frete</span><span className="font-mono">{taxa === 0 ? 'Grátis' : brl(taxa)}</span></div>}
              <div className="flex justify-between text-base font-bold"><span>Total</span><span className="font-mono">{brl(totalFinal)}</span></div>
            </div>

            <button type="button" onClick={submitPedido} disabled={enviando || ((loja.pagamentos ?? []).length > 0 && !chk.forma)} className="mt-4 w-full rounded-xl px-5 py-3 font-semibold text-white disabled:opacity-50" style={{ background: accent }}>
              {enviando ? 'Enviando…' : 'Confirmar pedido'}
            </button>
          </div>
        </div>
      )}
    </main>
  );
}
