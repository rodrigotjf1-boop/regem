'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { api } from '@/lib/api';
import {
  brl,
  TEMA,
  SELO,
  carregarCliente,
  salvarCliente,
  type CartItem,
} from '@/components/loja/tipos';
import { ItemSheet } from '@/components/loja/item-sheet';
import { CartSheet } from '@/components/loja/cart-sheet';

/* eslint-disable @typescript-eslint/no-explicit-any, @next/next/no-img-element */

const CHK_INICIAL = {
  tipo: 'entrega',
  quando: 'agora',
  agendamento: '',
  rua: '',
  numero: '',
  referencia: '',
  bairroId: '',
  nome: '',
  telefone: '',
  telefone2: '',
  forma: '',
  troco: '',
  cupom: '',
  profissional: '',
  cnpj: '',
};

export default function CardapioPublicoPage() {
  const params = useParams();
  const search = useSearchParams();
  const token = String(params?.token ?? '');
  const mesa = search?.get('mesa') ?? '';

  const [menu, setMenu] = useState<any>(null);
  const [erro, setErro] = useState('');
  const [cat, setCat] = useState('');
  const [busca, setBusca] = useState('');
  const [cart, setCart] = useState<CartItem[]>([]);
  const [enviando, setEnviando] = useState(false);
  const [checkout, setCheckout] = useState(false);
  const [ped, setPed] = useState<any>(null);
  const [chk, setChk] = useState<any>(CHK_INICIAL);
  const [cupomOk, setCupomOk] = useState<any>(null);
  const [sel, setSel] = useState<any>(null);

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

  // Prefill: dados do cliente lembrados neste aparelho.
  useEffect(() => {
    if (!menu) return;
    const c = carregarCliente(token);
    if (Object.keys(c).length) setChk((s: any) => ({ ...s, ...c }));
  }, [menu, token]);

  // Prefill do nome pelo telefone (se a fidelidade estiver ativa).
  useEffect(() => {
    const tel = (chk.telefone ?? '').replace(/\D/g, '');
    if (!menu?.loja?.fidelidadeAtiva || tel.length < 8 || (chk.nome ?? '').trim()) return;
    const t = setTimeout(async () => {
      try {
        const r: any = await api.cardapioPontos(token, tel);
        if (r?.nome) setChk((s: any) => (s.nome ? s : { ...s, nome: r.nome }));
      } catch {
        /* ignora */
      }
    }, 700);
    return () => clearTimeout(t);
  }, [chk.telefone, chk.nome, menu, token]);

  const loja = menu?.loja;
  const accent = TEMA[loja?.ramo] ?? '#E2A340';
  const isServico = loja?.ramo === 'servicos';
  const isIndustria = loja?.ramo === 'industria';
  const produtos: any[] = menu?.produtos ?? [];
  const bairros: any[] = menu?.bairros ?? [];

  const visiveis = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return produtos.filter(
      (p) =>
        (!cat || p.categoriaId === cat) &&
        (!q || `${p.nome} ${p.descricao ?? ''}`.toLowerCase().includes(q)),
    );
  }, [produtos, cat, busca]);

  const total = useMemo(() => cart.reduce((s, i) => s + i.preco * i.qtd, 0), [cart]);
  const qtdItens = cart.reduce((s, i) => s + i.qtd, 0);
  const upsell = useMemo(
    () => produtos.filter((p) => p.destaque && !p.esgotado && !cart.some((c) => c.produtoId === p.id)).slice(0, 6),
    [produtos, cart],
  );

  const taxa = useMemo(() => {
    if (isServico || chk.tipo !== 'entrega') return 0;
    if (loja?.freteGratisAcima != null && total >= loja.freteGratisAcima) return 0;
    return Number(bairros.find((b) => b.id === chk.bairroId)?.taxa ?? 0);
  }, [chk.tipo, chk.bairroId, total, bairros, loja, isServico]);
  const desc = cupomOk?.valido ? cupomOk.desconto : 0;
  const totalFinal = Math.max(0, total - desc + taxa);

  function onAdd(item: CartItem) {
    setCart((c) => {
      const ex = c.find((i) => i.key === item.key);
      if (ex) return c.map((i) => (i.key === item.key ? { ...i, qtd: i.qtd + item.qtd } : i));
      return [...c, item];
    });
    setSel(null);
  }
  function mudarQtd(key: string, d: number) {
    setCart((c) => c.map((i) => (i.key === key ? { ...i, qtd: i.qtd + d } : i)).filter((i) => i.qtd > 0));
  }
  function removeItem(key: string) {
    setCart((c) => c.filter((i) => i.key !== key));
  }
  function addUpsell(p: any) {
    // Upsell simples: produto sem variação/grupos obrigatórios → 1 unidade.
    const key = `${p.id}::`;
    setCart((c) => {
      const ex = c.find((i) => i.key === key);
      if (ex) return c.map((i) => (i.key === key ? { ...i, qtd: i.qtd + 1 } : i));
      return [...c, { key, produtoId: p.id, complementos: [], nome: p.nome, sub: '', preco: p.precoVenda, obs: '', qtd: 1 }];
    });
  }

  async function aplicarCupom() {
    if (!chk.cupom.trim()) return;
    try {
      setCupomOk(await api.cardapioCupomValidar(token, chk.cupom.trim(), total));
    } catch {
      setCupomOk({ valido: false });
    }
  }

  function enviar() {
    if (!cart.length) return;
    if (menu.modo === 'mesa') return void submitPedido();
    setCheckout(true);
  }

  async function submitPedido() {
    setEnviando(true);
    try {
      const entrega = !isServico && chk.tipo === 'entrega';
      const r: any = await api.cardapioPedido(token, {
        mesa: mesa || undefined,
        cliente: chk.nome || 'Cliente',
        telefone: chk.telefone || undefined,
        telefone2: entrega ? chk.telefone2 || undefined : undefined,
        tipo: isServico ? 'retirada' : chk.tipo,
        rua: entrega ? chk.rua || undefined : undefined,
        numero: entrega ? chk.numero || undefined : undefined,
        referencia: entrega ? chk.referencia || undefined : undefined,
        bairroId: entrega ? chk.bairroId || undefined : undefined,
        formaPagamento: chk.forma || undefined,
        trocoPara: chk.forma === 'entrega' && chk.troco ? Number(String(chk.troco).replace(',', '.')) : undefined,
        cupom: cupomOk?.valido ? chk.cupom.trim() : undefined,
        agendamento: chk.agendamento || undefined,
        profissional: chk.profissional || undefined,
        cnpj: chk.cnpj || undefined,
        itens: cart.map((i) => ({
          produtoId: i.produtoId,
          variacaoId: i.variacaoId,
          complementos: i.complementos,
          quantidade: i.qtd,
          observacao: i.obs || undefined,
        })),
      });
      if (r.pagamentoOnline && r.pedidoId) await api.cardapioPagar(token, r.pedidoId).catch(() => {});
      // Lembra o cliente neste aparelho para o próximo pedido.
      salvarCliente(token, {
        nome: chk.nome,
        telefone: chk.telefone,
        telefone2: chk.telefone2,
        rua: chk.rua,
        numero: chk.numero,
        referencia: chk.referencia,
        bairroId: chk.bairroId,
      });
      setCart([]);
      setCheckout(false);
      if (r.modo === 'mesa') setPed({ mesa: r.mesa, modo: 'mesa' });
      else setPed({ pedidoId: r.pedidoId, displayId: r.displayId, status: 'novo', pontos: r.pontos, orcamento: r.orcamento, agendamento: r.agendamento, total: r.total });
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao enviar');
    } finally {
      setEnviando(false);
    }
  }

  useEffect(() => {
    if (!ped?.pedidoId) return;
    const t = setInterval(async () => {
      try {
        const s: any = await api.cardapioStatus(token, ped.pedidoId);
        setPed((p: any) => ({ ...p, ...s }));
      } catch {
        /* */
      }
    }, 5000);
    return () => clearInterval(t);
  }, [ped?.pedidoId, token]);

  if (erro && !menu)
    return <main className="grid min-h-dvh place-items-center bg-neutral-50 p-6 text-center text-neutral-600">{erro}</main>;
  if (!menu) return <main className="grid min-h-dvh place-items-center bg-neutral-50 text-neutral-400">Carregando…</main>;

  // ---- pedido enviado: timeline ----
  if (ped) {
    const passos = ['novo', 'confirmado', 'pronto', 'despachado', 'concluido'];
    const rot: Record<string, string> = { novo: 'Pedido recebido', confirmado: 'Em preparo', pronto: 'Pronto', despachado: chk.tipo === 'entrega' ? 'Saiu para entrega' : 'Aguardando retirada', concluido: 'Concluído' };
    const idx = ped.modo === 'mesa' ? 0 : Math.max(0, passos.indexOf(ped.status ?? 'novo'));
    return (
      <main className="min-h-dvh bg-neutral-50 p-6 text-neutral-900">
        <div className="mx-auto max-w-md text-center">
          <p className="text-4xl">{ped.orcamento ? '🧾' : ped.agendamento ? '📅' : '🎉'}</p>
          <h1 className="mt-1 text-xl font-bold" style={{ color: accent }}>{ped.orcamento ? 'Orçamento solicitado!' : ped.agendamento ? 'Agendamento confirmado!' : 'Pedido enviado!'}</h1>
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
          {ped.orcamento && <p className="mt-3 rounded-xl bg-neutral-100 px-3 py-2 text-sm text-neutral-600">Orçamento solicitado — em breve retornamos com a proposta.</p>}
          {ped.agendamento && <p className="mt-3 rounded-xl bg-neutral-100 px-3 py-2 text-sm text-neutral-600">Agendado para {new Date(ped.agendamento).toLocaleString('pt-BR')}.</p>}
          {ped.pontos != null && <p className="mt-3 text-sm font-semibold" style={{ color: accent }}>⭐ Você tem {ped.pontos} pontos de fidelidade.</p>}
          {loja.whatsapp && (
            <a href={`https://wa.me/${loja.whatsapp.replace(/\D/g, '')}`} className="mt-4 inline-block rounded-xl bg-emerald-500 px-5 py-3 font-semibold text-white">💬 Falar no WhatsApp</a>
          )}
          <button type="button" onClick={() => { setPed(null); setCupomOk(null); }} className="mt-6 block w-full rounded-xl px-5 py-3 font-semibold text-white" style={{ background: accent }}>Fazer outro pedido</button>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-dvh bg-neutral-50 pb-28 text-neutral-900">
      {/* Hero */}
      <header className="px-4 py-4 text-white" style={{ backgroundColor: '#1f1a14', backgroundImage: `linear-gradient(150deg, #1a1a1a, ${accent}33)` }}>
        <div className="flex items-center gap-3">
          <div className="grid h-14 w-14 flex-none place-items-center rounded-2xl text-3xl" style={{ background: accent }}>{loja.logoEmoji ?? '🍔'}</div>
          <div className="min-w-0">
            <h1 className="truncate text-lg font-bold">{loja.nome}</h1>
            {loja.subtitulo && <p className="truncate text-xs text-white/60">{loja.subtitulo}</p>}
          </div>
          <span className={`ml-auto flex-none rounded-full border px-3 py-1 text-[10px] font-bold ${loja.aberto ? 'border-emerald-400/50 bg-emerald-400/15 text-emerald-300' : 'border-red-400/50 bg-red-400/15 text-red-300'}`}>{loja.aberto ? '● ABERTO' : '● FECHADO'}</span>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {loja.tempoEntregaMin && <span className="rounded-lg bg-white/10 px-2.5 py-1.5 text-xs">⏱ {loja.tempoEntregaMin} min</span>}
          {loja.freteGratisAcima != null && <span className="rounded-lg bg-white/10 px-2.5 py-1.5 text-xs">🛵 Frete grátis &gt; {brl(loja.freteGratisAcima)}</span>}
          {loja.pedidoMinimo != null && <span className="rounded-lg bg-white/10 px-2.5 py-1.5 text-xs">Mín. {brl(loja.pedidoMinimo)}</span>}
          {loja.avaliacao != null && <span className="rounded-lg bg-white/10 px-2.5 py-1.5 text-xs">⭐ {loja.avaliacao}</span>}
        </div>
      </header>

      {/* Fidelidade */}
      {loja.fidelidadeAtiva && (
        <div className="mx-4 mt-3 flex items-center gap-3 rounded-2xl border border-neutral-200 bg-white p-3">
          <span className="text-xl">🎁</span>
          <div className="min-w-0"><p className="text-sm font-bold">Fidelidade Regem</p><p className="text-xs text-neutral-500">A cada R$ 1 = 1 ponto · junte e troque por produtos</p></div>
        </div>
      )}

      {mesa && <div className="bg-white px-4 py-2 text-center text-xs text-neutral-500">Mesa {mesa}</div>}

      {/* Busca + categorias */}
      <div className="sticky top-0 z-10 bg-neutral-50 px-4 pt-3 shadow-[0_8px_12px_-10px_rgba(0,0,0,.12)]">
        <input value={busca} onChange={(e) => setBusca(e.target.value)} type="search" placeholder="Buscar no cardápio…" className="w-full rounded-xl border border-neutral-200 bg-white px-3 py-2.5 text-sm" />
        {menu.categorias.length > 0 && (
          <div className="flex gap-2 overflow-x-auto py-3">
            <button type="button" onClick={() => setCat('')} className="whitespace-nowrap rounded-full border px-3 py-1.5 text-sm font-semibold" style={cat === '' ? { borderColor: accent, color: accent, background: `${accent}15` } : { borderColor: '#e5e5e5', color: '#666', background: '#fff' }}>Todos</button>
            {menu.categorias.map((c: any) => (
              <button key={c.id} type="button" onClick={() => setCat(c.id)} className="whitespace-nowrap rounded-full border px-3 py-1.5 text-sm font-semibold" style={cat === c.id ? { borderColor: accent, color: accent, background: `${accent}15` } : { borderColor: '#e5e5e5', color: '#666', background: '#fff' }}>{c.nome}</button>
            ))}
          </div>
        )}
      </div>

      {/* Cards de item */}
      <div className="space-y-2.5 px-4 pt-3">
        {visiveis.length === 0 && <p className="py-10 text-center text-sm text-neutral-400">Nada encontrado.</p>}
        {visiveis.map((p: any) => (
          <button key={p.id} type="button" disabled={p.esgotado} onClick={() => setSel(p)} className="flex w-full items-stretch gap-3 rounded-2xl border border-neutral-200 bg-white p-3 text-left transition active:scale-[.99] disabled:opacity-50">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="font-bold text-neutral-900">{p.nome}</span>
                {p.esgotado && <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-[9px] font-bold text-neutral-500">ESGOTADO</span>}
                {(p.selos ?? []).map((s: string) => <span key={s} className="rounded-full bg-emerald-50 px-2 py-0.5 text-[9px] font-bold text-emerald-600">{SELO[s] ?? s}</span>)}
                {p.destaque && <span className="rounded-full px-2 py-0.5 text-[9px] font-bold" style={{ background: `${accent}18`, color: accent }}>SUGERIDO</span>}
                {p.duracaoMin && <span className="text-[10px] font-semibold text-neutral-500">🕐 {p.duracaoMin} min</span>}
              </div>
              {p.descricao && <p className="mt-1 line-clamp-2 text-xs text-neutral-500">{p.descricao}</p>}
              <div className="mt-2 flex items-baseline gap-2">
                {p.precoDe != null && <span className="font-mono text-[11px] text-neutral-400 line-through">{brl(p.precoDe)}</span>}
                <span className="font-mono font-bold" style={{ color: accent }}>{brl(p.precoVenda)}</span>
                {loja.parcelasMax > 1 && <span className="text-[10px] font-semibold text-emerald-600">em até {loja.parcelasMax}x</span>}
              </div>
            </div>
            <div className="relative grid w-20 flex-none place-items-center overflow-hidden rounded-xl bg-neutral-100 text-3xl">
              {p.imagemRef ? <img src={p.imagemRef} alt={p.nome} className="h-full w-full object-cover" /> : '🍽'}
              {!p.esgotado && <span className="absolute -bottom-1 -right-1 grid h-7 w-7 place-items-center rounded-lg text-base font-bold text-white shadow" style={{ background: accent }}>＋</span>}
            </div>
          </button>
        ))}
      </div>

      {/* barra do carrinho */}
      {qtdItens > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-20 mx-auto max-w-lg p-3" style={{ paddingBottom: 'calc(0.75rem + env(safe-area-inset-bottom))' }}>
          <button type="button" onClick={enviar} disabled={enviando} className="flex w-full items-center gap-3 rounded-2xl px-5 py-3.5 font-bold text-white shadow-lg disabled:opacity-60" style={{ background: accent }}>
            <span className="rounded-lg bg-black/20 px-2 py-0.5 font-mono text-xs">{qtdItens}</span>
            <span>{enviando ? 'Enviando…' : menu.modo === 'mesa' ? 'Enviar pedido' : 'Ver pedido'}</span>
            <span className="ml-auto font-mono">{brl(total)}</span>
          </button>
        </div>
      )}

      {sel && <ItemSheet sel={sel} accent={accent} onClose={() => setSel(null)} onAdd={onAdd} />}

      {checkout && (
        <CartSheet
          accent={accent}
          loja={loja}
          bairros={bairros}
          cart={cart}
          upsell={upsell}
          isServico={isServico}
          isIndustria={isIndustria}
          total={total}
          taxa={taxa}
          desc={desc}
          totalFinal={totalFinal}
          chk={chk}
          setChk={setChk}
          cupomOk={cupomOk}
          onAplicarCupom={aplicarCupom}
          onQtd={mudarQtd}
          onRemove={removeItem}
          onAddUpsell={addUpsell}
          onClose={() => setCheckout(false)}
          onSubmit={submitPedido}
          enviando={enviando}
        />
      )}
    </main>
  );
}
