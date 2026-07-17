'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { api } from '@/lib/api';
import './menu-theme.css';
import {
  brl,
  TEMA,
  SELO,
  carregarCliente,
  salvarCliente,
  getClienteToken,
  setClienteToken,
  type CartItem,
} from '@/components/loja/tipos';
import { distanciaKm, taxaPorRaio, geocodificar } from '@/lib/geo';
import { ClientePanel } from '@/components/loja/cliente-panel';
import { PedidosPanel } from '@/components/loja/pedidos-panel';
import { BannerCarousel } from '@/components/loja/banner-carousel';
import { LojaBottomNav } from '@/components/loja/bottom-nav';
import { PromosPanel } from '@/components/loja/promos-panel';
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
  const [temaCliente, setTemaCliente] = useState(''); // '' = segue a loja
  const [prefereDark, setPrefereDark] = useState(false);
  const [erro, setErro] = useState('');
  const [cat, setCat] = useState('');
  const [cart, setCart] = useState<CartItem[]>([]);
  // Idempotência: 1 ref por carrinho, reenviado em qualquer retry; zera no sucesso.
  const [clientRef, setClientRef] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [checkout, setCheckout] = useState(false);
  const [ped, setPed] = useState<any>(null);
  const [chk, setChk] = useState<any>(CHK_INICIAL);
  const [cupomOk, setCupomOk] = useState<any>(null);
  const [mostrarCliente, setMostrarCliente] = useState(false);
  const [mostrarPedidos, setMostrarPedidos] = useState(false);
  const [perguntaAdd, setPerguntaAdd] = useState(false);
  const [aba, setAba] = useState<'inicio' | 'pedidos' | 'promos' | 'carrinho'>('inicio');
  const [ultimoPedido, setUltimoPedido] = useState<any>(null);
  const temCliente = typeof window !== 'undefined' && !!getClienteToken(token);

  function irAba(a: 'inicio' | 'pedidos' | 'promos' | 'carrinho') {
    if (a === 'pedidos') setMostrarPedidos(true);
    else if (a === 'carrinho') setCheckout(true);
    else {
      setAba(a);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }

  // "Pedir de novo": recompõe o carrinho a partir do snapshot do pedido.
  async function reordenarUltimo() {
    const ct = getClienteToken(token);
    if (!ct || !ultimoPedido) return;
    try {
      const r: any = await api.clientePedirDeNovo(token, ultimoPedido.id, ct);
      reordenar(r.itens ?? []);
      setPerguntaAdd(true);
    } catch {
      /* ignore */
    }
  }
  function reordenar(itens: any[]) {
    const novos: CartItem[] = (itens ?? []).map((it, i) => ({
      key: `${it.produtoId}::${it.variacaoId ?? ''}::re${i}`,
      produtoId: it.produtoId,
      variacaoId: it.variacaoId || undefined,
      complementos: [],
      nome: it.descricao ?? 'Item',
      sub: '',
      preco: Number(it.precoUnitario ?? 0),
      obs: it.observacao || '',
      qtd: Number(it.quantidade) || 1,
    }));
    if (novos.length) setCart((c) => [...c, ...novos]);
  }

  // Endereços salvos do cliente (para o select no checkout).
  const [enderecosSalvos, setEnderecosSalvos] = useState<any[]>([]);
  const recarregarEnderecos = useCallback(async () => {
    const ct = getClienteToken(token);
    if (!ct) {
      setEnderecosSalvos([]);
      return;
    }
    try {
      const p: any = await api.clientePerfil(token, ct);
      setEnderecosSalvos(p.enderecos ?? []);
    } catch {
      /* sem perfil: lista vazia */
    }
  }, [token]);

  // Cadastra um novo endereço a partir do checkout (mesmo processo de "Meus dados").
  async function cadastrarEndereco(dados: any) {
    const ct = getClienteToken(token);
    if (!ct) {
      setErro('Confirme seu telefone em "Meus dados" para salvar endereços.');
      return;
    }
    const b = bairros.find((x: any) => x.id === dados.bairroId);
    await api.clienteAddEndereco(token, {
      clienteToken: ct,
      apelido: dados.apelido || undefined,
      cep: dados.cep || undefined,
      logradouro: dados.logradouro,
      numero: dados.numero,
      referencia: dados.referencia,
      bairroId: dados.bairroId || undefined,
      bairro: b?.nome ?? undefined,
      cidade: dados.cidade || undefined,
      lat: dados.lat || undefined,
      lng: dados.lng || undefined,
    });
    await recarregarEnderecos();
    usarEndereco({
      logradouro: dados.logradouro,
      numero: dados.numero,
      referencia: dados.referencia,
      bairroId: dados.bairroId,
      lat: dados.lat,
      lng: dados.lng,
    });
  }

  // Usar um endereço salvo: preenche o checkout de entrega.
  function usarEndereco(e: any) {
    setChk((s: any) => ({
      ...s,
      tipo: 'entrega',
      rua: e.logradouro || s.rua,
      numero: e.numero || s.numero,
      referencia: e.referencia || e.complemento || s.referencia,
      bairroId: e.bairroId || s.bairroId, // já traz o frete da área de atendimento
      lat: e.lat ?? s.lat,
      lng: e.lng ?? s.lng,
    }));
    setCheckout(true);
  }
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

  // Identidade por link no ?u=. Aceita slug curto (resolve no servidor) ou o
  // token JWT assinado (legado). Não expõe nome/telefone na URL.
  const [ident, setIdent] = useState(0);
  useEffect(() => {
    const u = search?.get('u');
    if (!u) return;
    if (u.includes('.')) {
      // token assinado (legado): tem pontos (header.payload.assinatura)
      setClienteToken(token, u);
      setIdent((n) => n + 1);
    } else {
      // slug curto: troca por clienteToken no servidor
      api.cardapioResolverLink(token, u).then((r: any) => {
        if (r?.clienteToken) {
          setClienteToken(token, r.clienteToken);
          setIdent((n) => n + 1);
        }
      }).catch(() => {});
    }
  }, [search, token]);

  // Compat: link antigo com ?nome=...&tel=... (só prefill, sem identidade).
  useEffect(() => {
    const nome = search?.get('nome');
    const tel = search?.get('tel');
    if (!nome && !tel) return;
    setChk((s: any) => ({ ...s, nome: s.nome || nome || '', telefone: s.telefone || tel || '' }));
  }, [search]);

  // Cliente identificado: pré-preenche nome, telefone e endereço principal.
  useEffect(() => {
    const ct = getClienteToken(token);
    if (!menu || !ct) return;
    api.clientePerfil(token, ct).then((p: any) => {
      setEnderecosSalvos(p.enderecos ?? []);
      const pr = (p.enderecos ?? []).find((e: any) => e.principal) ?? (p.enderecos ?? [])[0];
      setChk((s: any) => ({
        ...s,
        nome: s.nome || p.cliente?.nome || '',
        telefone: s.telefone || p.cliente?.telefone || '',
        rua: s.rua || pr?.logradouro || '',
        numero: s.numero || pr?.numero || '',
        referencia: s.referencia || pr?.referencia || pr?.complemento || '',
        bairroId: s.bairroId || pr?.bairroId || '',
        lat: s.lat || pr?.lat || '',
        lng: s.lng || pr?.lng || '',
      }));
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [menu, token, ident]);

  // Último pedido do cliente (card do topo quando não há banners).
  useEffect(() => {
    if (!menu) return;
    const tel = (chk.telefone ?? '').replace(/\D/g, '');
    if (tel.length < 10) {
      setUltimoPedido(null);
      return;
    }
    api.cardapioUltimoPedido(token, tel).then(setUltimoPedido).catch(() => setUltimoPedido(null));
  }, [menu, token, chk.telefone]);

  // Modo raio: se o endereço não tem coordenadas, geocodifica o endereço
  // digitado (CEP/rua) para calcular o frete por distância.
  useEffect(() => {
    if (!checkout || !menu || menu.loja?.areaModo !== 'raio' || chk.tipo !== 'entrega') return;
    if (chk.lat && chk.lng) return; // já tem coordenadas (endereço salvo/GPS)
    if (!chk.rua?.trim()) return;
    const cidade = menu.loja?.endereco?.cidade ?? '';
    const q = [chk.rua, chk.numero, cidade, 'Brasil'].filter(Boolean).join(', ');
    const t = setTimeout(() => {
      geocodificar(q).then((c) => { if (c) setChk((s: any) => ({ ...s, lat: c.lat, lng: c.lng })); }).catch(() => {});
    }, 600);
    return () => clearTimeout(t);
  }, [checkout, menu, chk.rua, chk.numero, chk.tipo, chk.lat, chk.lng]);

  // Tipo padrão respeita a config (se a loja só faz retirada, começa em retirada).
  useEffect(() => {
    const t = menu?.tipos;
    if (!t) return;
    setChk((s: any) => {
      const ok = (s.tipo === 'entrega' && t.delivery) || (s.tipo === 'retirada' && (t.retirada || t.local));
      return ok ? s : { ...s, tipo: t.delivery ? 'entrega' : 'retirada' };
    });
  }, [menu]);

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
  // Personalização do tema (botão "Editar tema"): cor primária custom + toggles.
  const tc = loja?.temaConfig ?? {};
  const accent = tc.corPrimaria || TEMA[loja?.ramo] || '#E2A340';
  // Cores do cabeçalho (Editar tema): fundo e texto personalizáveis; null = padrão.
  const headerBgCustom = tc.corCabecalho || null;
  const headerText = tc.corTextoCabecalho || '#ffffff';
  const showDestaques = tc.mostrarDestaques !== false;
  const showBanner = tc.mostrarBanner !== false;
  const showUltimos = tc.mostrarUltimos !== false;
  const bannerIntervalo = Math.max(1, Number(tc.bannerIntervalo) || 2);
  // Tema/layout do cardápio (só apresentação). Fallback classic. O modo escuro
  // continua sendo eixo independente (classe tema-escuro no body).
  const menuTheme = ['fastfood', 'grid'].includes(loja?.menuTheme) ? loja.menuTheme : 'classic';
  const isGrid = menuTheme === 'grid';

  // Busca (overlay fastfood/grid) — estados no topo para o abrirItem poder fechá-la.
  const [buscaAberta, setBuscaAberta] = useState(false);
  const [busca, setBusca] = useState('');

  // Abre o item (sheet de observações/complementos) e fecha a busca se estiver
  // aberta — senão o sheet abriria ATRÁS do overlay de busca (z maior).
  const abrirItem = (p: any) => {
    setSel(p);
    setBuscaAberta(false);
    setBusca('');
  };

  // Card de um produto na lista (reusado no classic filtrado e nas seções fastfood).
  const cardProduto = (p: any) => (
    <button key={p.id} type="button" disabled={p.esgotado} onClick={() => abrirItem(p)} className="lp-card flex w-full items-stretch gap-3 rounded-2xl border border-neutral-200 bg-white p-3 text-left transition active:scale-[.99] disabled:opacity-50">
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
      <div className="relative grid aspect-square w-20 flex-none self-center place-items-center overflow-hidden rounded-xl bg-neutral-100 text-3xl sm:w-24">
        {p.imagemRef ? <img src={p.imagemRef} alt={p.nome} loading="lazy" className="absolute inset-0 h-full w-full object-cover object-center" /> : '🍽'}
        {!p.esgotado && <span className="absolute -bottom-1 -right-1 grid h-7 w-7 place-items-center rounded-lg text-base font-bold text-white shadow" style={{ background: accent }}>＋</span>}
      </div>
    </button>
  );

  // Card vertical para a grade 2 colunas (tema grid): foto grande em cima.
  const gridCard = (p: any) => (
    <button key={p.id} type="button" disabled={p.esgotado} onClick={() => abrirItem(p)} className="lp-card relative flex flex-col overflow-hidden rounded-2xl border border-neutral-200 bg-white text-left disabled:opacity-60">
      <div className="relative grid aspect-square w-full place-items-center overflow-hidden bg-neutral-100 text-4xl">
        {p.imagemRef ? <img src={p.imagemRef} alt={p.nome} loading="lazy" className="absolute inset-0 h-full w-full object-cover object-center" /> : '🍽'}
        {(p.selos ?? []).slice(0, 1).map((s: string) => <span key={s} className="absolute left-2 top-2 rounded-full bg-emerald-500 px-2 py-0.5 text-[9px] font-bold text-white">{SELO[s] ?? s}</span>)}
        {p.esgotado && <span className="absolute inset-0 grid place-items-center bg-white/70 text-xs font-bold text-neutral-600">ESGOTADO</span>}
      </div>
      <div className="flex flex-1 flex-col p-2.5">
        <p className="line-clamp-2 text-center text-sm font-bold text-neutral-900">{p.nome}</p>
        <div className="mt-auto flex items-center justify-between pt-2">
          <span className="font-mono text-sm font-bold" style={{ color: accent }}>{brl(p.precoVenda)}</span>
          {!p.esgotado && <span className="grid h-8 w-8 flex-none place-items-center rounded-full text-base font-bold text-white shadow" style={{ background: accent }}>＋</span>}
        </div>
      </div>
    </button>
  );

  // Tema do cardápio: o lojista escolhe (loja.tema: claro|escuro|auto); o cliente
  // pode alternar (persistido por token). 'auto' segue o sistema do cliente.
  useEffect(() => {
    try {
      setTemaCliente(localStorage.getItem(`cardapio_tema_${token}`) || '');
    } catch {}
    if (typeof window !== 'undefined' && window.matchMedia) {
      const mq = window.matchMedia('(prefers-color-scheme: dark)');
      setPrefereDark(mq.matches);
      const on = (e: MediaQueryListEvent) => setPrefereDark(e.matches);
      mq.addEventListener?.('change', on);
      return () => mq.removeEventListener?.('change', on);
    }
  }, [token]);
  const temaBase = temaCliente || loja?.tema || 'claro';
  const dark = temaBase === 'escuro' || (temaBase === 'auto' && prefereDark);
  useEffect(() => {
    if (typeof document === 'undefined') return;
    document.body.classList.toggle('tema-escuro', dark);
    return () => document.body.classList.remove('tema-escuro');
  }, [dark]);
  function alternarTema() {
    const prox = dark ? 'claro' : 'escuro';
    setTemaCliente(prox);
    try {
      localStorage.setItem(`cardapio_tema_${token}`, prox);
    } catch {}
  }
  const isServico = loja?.ramo === 'servicos';
  const isIndustria = loja?.ramo === 'industria';
  const produtos: any[] = menu?.produtos ?? [];
  const bairros: any[] = menu?.bairros ?? [];

  // Fastfood: grade de destaques + busca (overlay). Reusa os produtos já carregados.
  const destaques = useMemo(
    () =>
      produtos
        .filter((p) => !p.esgotado && (p.destaque || (p.selos ?? []).some((s: string) => ['novo', 'mais_pedido'].includes(s))))
        .slice(0, 12),
    [produtos],
  );
  const resultadosBusca = useMemo(() => {
    const q = busca.trim().toLowerCase();
    if (!q) return [];
    return produtos.filter((p) => `${p.nome} ${p.descricao ?? ''}`.toLowerCase().includes(q));
  }, [produtos, busca]);
  // Scroll-spy (todos os temas): ativa a categoria da seção visível ao rolar.
  useEffect(() => {
    if (buscaAberta || aba !== 'inicio') return;
    const secoes = Array.from(document.querySelectorAll<HTMLElement>('[data-cat-sec]'));
    if (!secoes.length) return;
    const obs = new IntersectionObserver(
      (entries) => {
        const vis = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (vis) setCat(vis.target.getAttribute('data-cat-sec') || '');
      },
      { rootMargin: '-120px 0px -60% 0px' },
    );
    secoes.forEach((s) => obs.observe(s));
    return () => obs.disconnect();
  }, [menuTheme, buscaAberta, aba, produtos, menu]);

  const total = useMemo(() => cart.reduce((s, i) => s + i.preco * i.qtd, 0), [cart]);
  const qtdItens = cart.reduce((s, i) => s + i.qtd, 0);
  const produtosPromo = useMemo(
    () => produtos.filter((p) => p.precoDe != null && !p.esgotado),
    [produtos],
  );
  const upsell = useMemo(
    () => produtos.filter((p) => p.destaque && !p.esgotado && !cart.some((c) => c.produtoId === p.id)).slice(0, 6),
    [produtos, cart],
  );
  // "Peça também" inteligente: cadastro vinculado (prioridade) → senão mais pedidos.
  // Busca quando o carrinho abre/muda; cai no upsell por `destaque` se vier vazio.
  const [pecaTambem, setPecaTambem] = useState<any[]>([]);
  useEffect(() => {
    if (!checkout || cart.length === 0) return;
    let cancel = false;
    const ids = [...new Set(cart.map((c) => c.produtoId))];
    api
      .cardapioPecaTambem(token, ids)
      .then((r: any) => {
        if (!cancel)
          setPecaTambem(
            Array.isArray(r) ? r.map((p: any) => ({ ...p, precoVenda: p.preco, imagemRef: p.imagem })) : [],
          );
      })
      .catch(() => {
        if (!cancel) setPecaTambem([]);
      });
    return () => {
      cancel = true;
    };
  }, [checkout, cart, token]);
  const upsellFinal = pecaTambem.length ? pecaTambem : upsell;

  const taxa = useMemo(() => {
    if (isServico || chk.tipo !== 'entrega') return 0;
    if (cupomOk?.valido && cupomOk.freteGratis) return 0; // cupom de frete grátis
    // Frete grátis só se o limite for > 0 (0/vazio = função desligada).
    const gratisAcima = loja?.freteGratisAcima != null && loja.freteGratisAcima > 0 && total >= loja.freteGratisAcima;
    if (loja?.areaModo === 'raio') {
      if (gratisAcima) return 0;
      const km = distanciaKm(loja.lojaLat, loja.lojaLng, chk.lat, chk.lng);
      if (km == null) return 0; // sem localização ainda
      return taxaPorRaio(loja.raios ?? [], km);
    }
    if (gratisAcima) return 0;
    return Number(bairros.find((b) => b.id === chk.bairroId)?.taxa ?? 0);
  }, [chk.tipo, chk.bairroId, chk.lat, chk.lng, total, bairros, loja, isServico, cupomOk]);
  const desc = cupomOk?.valido ? cupomOk.desconto : 0;

  function onAdd(item: CartItem) {
    setCart((c) => {
      const ex = c.find((i) => i.key === item.key);
      if (ex) return c.map((i) => (i.key === item.key ? { ...i, qtd: i.qtd + item.qtd } : i));
      return [...c, item];
    });
    setSel(null);
    if (!mesa) setPerguntaAdd(true); // pergunta: continuar comprando ou finalizar
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

  // Deep-link do banner: `item:ID` abre o produto, `category:ID` filtra a
  // categoria, `coupon:CODE` aplica o cupom, senão trata como URL. Reusa o campo
  // `link` existente do banner — sem estrutura nova.
  function abrirBanner(b: any) {
    const alvo: string = b?.deepLink || b?.link || '';
    if (!alvo) return;
    const [tipo, ...resto] = alvo.split(':');
    const valor = resto.join(':');
    if (tipo === 'item') {
      const it = (menu?.produtos ?? []).find((p: any) => p.id === valor);
      if (it) setSel(it);
    } else if (tipo === 'category') {
      setCat(valor);
      irAba('inicio');
    } else if (tipo === 'coupon') {
      aplicarCupom(valor);
      irAba('carrinho');
    } else if (/^https?:\/\//.test(alvo)) {
      window.open(alvo, '_blank', 'noopener,noreferrer');
    }
  }

  // Clique na categoria (todos os temas): rola até a seção; o scroll-spy destaca.
  function irCategoria(id: string) {
    setCat(id);
    setTimeout(() => {
      if (id) document.querySelector(`[data-cat-sec="${id}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      else window.scrollTo({ top: 0, behavior: 'smooth' });
    }, 0);
  }

  async function aplicarCupom(codigo?: string) {
    const cod = (codigo ?? chk.cupom ?? '').trim();
    if (!cod) return;
    if (codigo) setChk((s: any) => ({ ...s, cupom: cod.toUpperCase() }));
    try {
      setCupomOk(await api.cardapioCupomValidar(token, cod, total, chk.telefone));
    } catch {
      setCupomOk({ valido: false });
    }
  }

  // Cupons que o cliente pode usar agora (sugestão no checkout).
  const [cuponsSugeridos, setCuponsSugeridos] = useState<any[]>([]);
  useEffect(() => {
    if (!checkout || !menu) return;
    api
      .cardapioCuponsDisponiveis(token, (chk.telefone ?? '').replace(/\D/g, ''), Math.round(total))
      .then((l: any) => setCuponsSugeridos(Array.isArray(l) ? l : []))
      .catch(() => setCuponsSugeridos([]));
  }, [checkout, menu, token, chk.telefone, total]);

  // Saldo de cashback (valor) — opção de usar no pedido.
  const [cashbackSaldo, setCashbackSaldo] = useState(0);
  const [usarCashback, setUsarCashback] = useState(true);
  useEffect(() => {
    if (!checkout || !menu) return;
    const tel = (chk.telefone ?? '').replace(/\D/g, '');
    if (tel.length < 10) {
      setCashbackSaldo(0);
      return;
    }
    api.cardapioCashback(token, tel).then((c: any) => setCashbackSaldo(Number(c?.valor) || 0)).catch(() => setCashbackSaldo(0));
  }, [checkout, menu, token, chk.telefone]);

  // Prêmios de fidelidade resgatados (abate automático no pedido).
  const [premios, setPremios] = useState<any[]>([]);
  const [premioSel, setPremioSel] = useState('');
  useEffect(() => {
    if (!checkout || !menu) return;
    const tel = (chk.telefone ?? '').replace(/\D/g, '');
    if (tel.length < 10) {
      setPremios([]);
      return;
    }
    api
      .cardapioFidelidadePremios(token, tel)
      .then((l: any) => {
        const arr = Array.isArray(l) ? l : [];
        setPremios(arr);
        setPremioSel((c) => c || arr[0]?.id || ''); // auto-aplica o 1º
      })
      .catch(() => setPremios([]));
  }, [checkout, menu, token, chk.telefone]);
  const premioDesc = useMemo(() => {
    const p = premios.find((x) => x.id === premioSel);
    if (!p) return 0;
    const v = Number(p.recompensaValor) || 0;
    if (p.recompensaTipo === 'valor_fixo') return Math.min(total, v);
    if (p.recompensaTipo === 'percentual_produtos') {
      const sel = new Set(p.recompensaProdutos ?? []);
      const base = cart.filter((i) => sel.has(i.produtoId)).reduce((a, i) => a + i.preco * i.qtd, 0);
      return Number(((base * v) / 100).toFixed(2));
    }
    return Number(((total * v) / 100).toFixed(2));
  }, [premios, premioSel, total, cart]);
  // Preview do saldo de cashback aplicado (uso máximo sobre o que restou).
  const cashbackDesc = useMemo(() => {
    if (!usarCashback || cashbackSaldo <= 0) return 0;
    const restante = Math.max(0, total - desc - premioDesc);
    return Number(Math.min(cashbackSaldo, restante).toFixed(2));
  }, [usarCashback, cashbackSaldo, total, desc, premioDesc]);
  const totalFinal = Math.max(0, total - desc - premioDesc - cashbackDesc + taxa);
  const premioNome = premios.find((x) => x.id === premioSel)?.plano;

  function enviar() {
    if (!cart.length) return;
    // Envio direto SÓ quando é um QR de mesa de verdade (link com ?mesa=).
    // O link de delivery (sem mesa) sempre abre o checkout (tipo/pagamento/endereço).
    if (menu.modo === 'mesa' && mesa) return void submitPedido();
    setCheckout(true);
  }

  async function submitPedido() {
    // Cliente é obrigado a informar nome e telefone (exceto QR de mesa).
    if (!mesa) {
      if (!chk.nome?.trim()) { setErro('Informe seu nome.'); setCheckout(true); return; }
      if ((chk.telefone ?? '').replace(/\D/g, '').length < 10) { setErro('Informe um telefone válido (com DDD).'); setCheckout(true); return; }
    }
    setEnviando(true);
    try {
      const entrega = !isServico && chk.tipo === 'entrega';
      // Mesmo ref em qualquer retry deste carrinho → o backend não duplica o pedido.
      const ref =
        clientRef ||
        (globalThis.crypto?.randomUUID?.() ??
          `${Date.now()}-${Math.random().toString(36).slice(2)}`);
      if (ref !== clientRef) setClientRef(ref);
      const r: any = await api.cardapioPedido(token, {
        mesa: mesa || undefined,
        clientRef: ref,
        cliente: chk.nome || 'Cliente',
        telefone: chk.telefone || undefined,
        clienteToken: getClienteToken(token) || undefined,
        telefone2: entrega ? chk.telefone2 || undefined : undefined,
        tipo: isServico ? 'retirada' : chk.tipo,
        rua: entrega ? chk.rua || undefined : undefined,
        numero: entrega ? chk.numero || undefined : undefined,
        referencia: entrega ? chk.referencia || undefined : undefined,
        bairroId: entrega ? chk.bairroId || undefined : undefined,
        lat: entrega && chk.lat ? Number(chk.lat) : undefined,
        lng: entrega && chk.lng ? Number(chk.lng) : undefined,
        formaPagamento: chk.forma || undefined,
        bandeira: chk.forma === 'cartao' ? chk.bandeira || undefined : undefined,
        trocoPara: chk.forma === 'entrega' && chk.troco ? Number(String(chk.troco).replace(',', '.')) : undefined,
        cupom: cupomOk?.valido ? chk.cupom.trim() : undefined,
        resgateId: premioDesc > 0 ? premioSel || undefined : undefined,
        usarCashback,
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
      // Pagamento online: com Mercado Pago configurado, retorna o PIX (QR +
      // copia-e-cola) para exibir; sem gateway, aprova na hora (mock).
      let pixResp: any = null;
      if (r.pagamentoOnline && r.pedidoId)
        pixResp = await api.cardapioPagar(token, r.pedidoId).catch(() => null);
      // Identidade do cliente (token aleatório) criada/confirmada no 1º pedido.
      if (r.clienteToken) setClienteToken(token, r.clienteToken);
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
      setClientRef(''); // pedido concluído: próximo carrinho recebe um novo ref
      setCheckout(false);
      if (r.modo === 'mesa') setPed({ mesa: r.mesa, modo: 'mesa' });
      else setPed({ pedidoId: r.pedidoId, displayId: r.displayId, status: 'novo', pontos: r.pontos, orcamento: r.orcamento, agendamento: r.agendamento, total: r.total, ref, pix: pixResp?.pix ?? null });
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
  // Skeleton no formato do conteúdo (hero + categorias + cards de item).
  if (!menu)
    return (
      <main className="min-h-dvh bg-neutral-50 pb-28">
        <div className="h-[68px] animate-pulse bg-neutral-200" />
        <div className="flex gap-2 overflow-hidden px-4 pt-4">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-8 w-20 flex-none animate-pulse rounded-full bg-neutral-200" />
          ))}
        </div>
        <div className="space-y-2.5 px-4 pt-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex gap-3 rounded-2xl border border-neutral-200 bg-white p-3">
              <div className="flex-1 space-y-2">
                <div className="h-4 w-2/3 animate-pulse rounded bg-neutral-200" />
                <div className="h-3 w-full animate-pulse rounded bg-neutral-100" />
                <div className="h-4 w-16 animate-pulse rounded bg-neutral-200" />
              </div>
              <div className="h-20 w-20 flex-none animate-pulse rounded-xl bg-neutral-200" />
            </div>
          ))}
        </div>
      </main>
    );

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
          {/* PIX (Mercado Pago): QR + copia-e-cola. O status atualiza pelo webhook. */}
          {ped.pix?.qrCode && (
            <div className="mt-5 rounded-2xl border-2 p-4 text-center" style={{ borderColor: accent }}>
              <p className="text-sm font-semibold">Pague com PIX para confirmar</p>
              {ped.pix.qrCodeBase64 && (
                <img src={`data:image/png;base64,${ped.pix.qrCodeBase64}`} alt="QR Code PIX" className="mx-auto my-3 h-48 w-48" />
              )}
              <p className="mb-1 text-left text-xs text-neutral-500">Copia e cola:</p>
              <div className="flex items-center gap-2">
                <input readOnly aria-label="Código PIX copia e cola" value={ped.pix.qrCode} className="min-w-0 flex-1 truncate rounded-lg border px-2 py-1.5 text-xs" />
                <button
                  type="button"
                  onClick={() => navigator.clipboard?.writeText(ped.pix.qrCode)}
                  className="flex-none rounded-lg px-3 py-1.5 text-xs font-semibold text-white"
                  style={{ background: accent }}
                >
                  Copiar
                </button>
              </div>
              <p className="mt-2 text-xs text-neutral-500">Após pagar, o status atualiza automaticamente.</p>
            </div>
          )}
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
          {ped.pedidoId && ped.status !== 'cancelado' && (
            <a
              href={`/c/${token}/pedido/${ped.pedidoId}${ped.ref ? `?ref=${encodeURIComponent(ped.ref)}` : ''}`}
              className="mt-4 block rounded-xl border-2 px-5 py-3 font-semibold"
              style={{ borderColor: accent, color: accent }}
            >
              🔗 Acompanhar pedido (salve este link)
            </a>
          )}
          {loja.whatsapp && (
            <a href={`https://wa.me/${loja.whatsapp.replace(/\D/g, '')}`} className="mt-4 inline-block rounded-xl bg-emerald-500 px-5 py-3 font-semibold text-white">💬 Falar no WhatsApp</a>
          )}
          <button type="button" onClick={() => { setPed(null); setCupomOk(null); }} className="mt-6 block w-full rounded-xl px-5 py-3 font-semibold text-white" style={{ background: accent }}>Fazer outro pedido</button>
        </div>
      </main>
    );
  }

  return (
    <div
      data-menu-theme={menuTheme}
      className="lp-menu min-h-dvh bg-neutral-50 text-neutral-900"
      style={{ ['--brand-primary' as any]: accent }}
    >
      {/* Coluna central responsiva: full-width no celular, centrada no desktop. */}
      <main className="mx-auto w-full max-w-2xl pb-28">
      {/* Hero — grid: base curva; cores de fundo/texto vêm do "Editar tema"
          (padrão: grid = cor da loja; demais = faixa escura; texto branco). */}
      <header
        className={isGrid ? 'lp-hero lp-hero-grid px-4 pb-5 pt-3' : 'lp-hero px-4 py-2.5'}
        style={
          headerBgCustom
            ? { backgroundColor: headerBgCustom, color: headerText }
            : isGrid
              ? { backgroundColor: accent, color: headerText }
              : { backgroundColor: '#1a1a1a', backgroundImage: `linear-gradient(150deg, #1a1a1a, ${accent}22)`, color: headerText }
        }
      >
        <div className="flex items-center gap-2.5">
          {loja.logoRef ? (
            // Logo sempre em círculo preenchido (a foto cobre o círculo inteiro).
            <img src={loja.logoRef} alt={loja.nome} className="h-10 w-10 flex-none rounded-full object-cover object-center" />
          ) : (
            <div className="grid h-10 w-10 flex-none place-items-center rounded-full text-xl" style={{ background: accent }}>{loja.logoEmoji ?? '🍔'}</div>
          )}
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-[15px] font-bold leading-tight">{loja.nome}</h1>
            <p className="truncate text-[11px] leading-tight">
              <span className={menu.abertaAgora ? 'text-emerald-300' : 'text-red-300'}>● </span>
              <span className="opacity-70">{menu.horarioLabel ?? (menu.abertaAgora ? 'Aberta' : 'Fechada')}</span>
            </p>
          </div>
          <button
            type="button"
            onClick={alternarTema}
            aria-label={dark ? 'Mudar para tema claro' : 'Mudar para tema escuro'}
            className="flex-none rounded-full border px-2.5 py-1.5 text-[13px]"
            style={{ borderColor: `${headerText}40`, backgroundColor: `${headerText}1a` }}
          >
            {dark ? '☀️' : '🌙'}
          </button>
          <button
            type="button"
            onClick={() => setMostrarCliente(true)}
            className="flex-none rounded-full border px-3 py-1.5 text-[11px] font-semibold"
            style={{ borderColor: `${headerText}40`, backgroundColor: `${headerText}1a` }}
          >
            👤 {getClienteToken(token) ? 'Perfil' : 'Entrar'}
          </button>
        </div>
        {(loja.pedidoMinimo != null || (loja.freteGratisAcima ?? 0) > 0 || loja.tempoEntregaMin) && (
          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] opacity-70">
            {loja.tempoEntregaMin && <span>⏱ {loja.tempoEntregaMin} min</span>}
            {loja.pedidoMinimo != null && <span>Pedido mínimo {brl(loja.pedidoMinimo)}</span>}
            {(loja.freteGratisAcima ?? 0) > 0 && <span>🛵 Frete grátis acima de {brl(loja.freteGratisAcima)}</span>}
          </div>
        )}
      </header>

      {/* Fidelidade */}
      {loja.fidelidadeAtiva && (
        <div className="mx-4 mt-3 flex items-center gap-3 rounded-2xl border border-neutral-200 bg-white p-3">
          <span className="text-xl">🎁</span>
          <div className="min-w-0"><p className="text-sm font-bold">Fidelidade Regem</p><p className="text-xs text-neutral-500">A cada R$ 1 = 1 ponto · junte e troque por produtos</p></div>
        </div>
      )}

      {mesa && <div className="bg-white px-4 py-2 text-center text-xs text-neutral-500">Mesa {mesa}</div>}

      {aba === 'promos' && (
        <PromosPanel token={token} produtosPromo={produtosPromo} accent={accent} telefone={(chk.telefone ?? '').replace(/\D/g, '')} />
      )}

      {aba === 'inicio' && (
      <>
      {/* Banner (carrossel automático) OU card do último pedido do cliente.
          Ambos podem ser desligados no "Editar tema". */}
      {showBanner && (menu.banners?.length ?? 0) > 0 ? (
        <BannerCarousel banners={menu.banners} accent={accent} intervalo={bannerIntervalo} onAbrir={abrirBanner} />
      ) : showUltimos && ultimoPedido ? (
        <button type="button" onClick={reordenarUltimo} className="mx-4 mt-3 flex items-center gap-3 rounded-2xl border border-neutral-200 bg-white p-3 text-left">
          <div className="flex flex-none -space-x-3">
            {ultimoPedido.itens.slice(0, 3).map((it: any, i: number) =>
              it.imagemRef ? (
                <img key={i} src={it.imagemRef} alt={it.nome} className="h-12 w-12 rounded-xl border-2 border-white object-cover object-center" />
              ) : (
                <div key={i} className="grid h-12 w-12 place-items-center rounded-xl border-2 border-white bg-neutral-100 text-lg">🍽</div>
              ),
            )}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold">Seu último pedido</p>
            <p className="truncate text-xs text-neutral-500">{ultimoPedido.itens.map((i: any) => i.nome).join(', ')}</p>
          </div>
          <span className="flex-none rounded-lg px-3 py-1.5 text-xs font-bold text-white" style={{ background: accent }}>Pedir de novo</span>
        </button>
      ) : null}

      {/* Categorias (sticky) — grid: chips circulares; senão: pills. Sem "Todos":
          clicar rola até a seção e o scroll-spy destaca a categoria visível.
          Barra de rolagem escondida (arrasta na horizontal). */}
      {menu.categorias.length > 0 && (
        <div className="lp-cats sticky top-0 z-10 bg-neutral-50 px-4 pt-2 shadow-[0_8px_12px_-10px_rgba(0,0,0,.12)]">
          {isGrid ? (
            <div className="no-scrollbar flex gap-3 overflow-x-auto py-2">
              {menu.categorias.map((c: any) => {
                const on = cat === c.id;
                return (
                  <button key={c.id} type="button" onClick={() => irCategoria(c.id)} className="flex w-14 flex-none flex-col items-center gap-1">
                    <span className="grid h-12 w-12 place-items-center rounded-full text-lg font-bold" style={on ? { background: accent, color: '#fff' } : { background: '#fff', color: accent, boxShadow: '0 4px 12px -6px rgba(0,0,0,.2)' }}>
                      {(c.nome || '?').slice(0, 1).toUpperCase()}
                    </span>
                    <span className="w-full truncate text-center text-[10px] font-semibold text-neutral-600">{c.nome}</span>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="no-scrollbar flex gap-1.5 overflow-x-auto py-2">
              {menu.categorias.map((c: any) => (
                <button key={c.id} type="button" onClick={() => irCategoria(c.id)} className="whitespace-nowrap rounded-full border px-2.5 py-1 text-[13px] font-semibold" style={cat === c.id ? { borderColor: accent, color: accent, background: `${accent}15` } : { borderColor: '#e5e5e5', color: '#666', background: '#fff' }}>{c.nome}</button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Cards de item */}
      {/* Grade de destaques (fastfood) — pode ser desligada no "Editar tema". */}
      {showDestaques && menuTheme === 'fastfood' && destaques.length > 0 && (
        <div className="px-4 pt-4">
          <p className="mb-2 text-base font-extrabold text-neutral-900">Destaques</p>
          <div className="no-scrollbar flex gap-3 overflow-x-auto pb-1">
            {destaques.map((p: any) => (
              <button key={p.id} type="button" disabled={p.esgotado} onClick={() => setSel(p)} className="lp-card w-36 flex-none overflow-hidden rounded-2xl border border-neutral-200 bg-white text-left disabled:opacity-50">
                <div className="grid h-24 w-full place-items-center bg-neutral-100 text-3xl">
                  {p.imagemRef ? <img src={p.imagemRef} alt={p.nome} loading="lazy" className="h-full w-full object-cover object-center" /> : '🍔'}
                </div>
                <div className="p-2">
                  <p className="truncate text-xs font-bold">{p.nome}</p>
                  <p className="mt-0.5 font-mono text-xs font-bold" style={{ color: accent }}>{p.precoDe != null ? 'A partir de ' : ''}{brl(p.precoVenda)}</p>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Lista — seções por categoria com scroll-spy nos 3 temas (estilo iFood).
          grid usa grade 2 colunas; classic/fastfood usam lista de cards. */}
      <div className={`px-4 pt-2 ${temCliente ? 'pb-24' : ''}`}>
        {[{ id: '', nome: '' }, ...menu.categorias].map((c: any) => {
          const itens = produtos.filter((p: any) => (c.id ? p.categoriaId === c.id : !p.categoriaId));
          if (!itens.length) return null;
          return (
            <section key={c.id || 'sem'} data-cat-sec={c.id} className="scroll-mt-24 pt-3">
              {c.nome && (
                <div className="mb-2">
                  <p className="text-base font-extrabold text-neutral-900">{c.nome}</p>
                  {c.descricao && <p className="text-xs text-neutral-500">{c.descricao}</p>}
                </div>
              )}
              {isGrid ? (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">{itens.map(gridCard)}</div>
              ) : (
                <div className="space-y-2.5">{itens.map(cardProduto)}</div>
              )}
            </section>
          );
        })}
      </div>
      </>
      )}
      </main>

      {/* barra do carrinho */}
      {qtdItens > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-20 mx-auto max-w-2xl p-3" style={{ paddingBottom: 'calc(0.75rem + env(safe-area-inset-bottom))' }}>
          <button type="button" onClick={enviar} disabled={enviando} className="flex w-full items-center gap-3 rounded-2xl px-5 py-3.5 font-bold text-white shadow-lg disabled:opacity-60" style={{ background: accent }}>
            <span className="rounded-lg bg-black/20 px-2 py-0.5 font-mono text-xs">{qtdItens}</span>
            <span>{enviando ? 'Enviando…' : menu.modo === 'mesa' && mesa ? 'Enviar pedido' : 'Ver pedido'}</span>
            <span className="ml-auto font-mono">{brl(total)}</span>
          </button>
        </div>
      )}

      {/* Busca (fastfood) — filtra os produtos já carregados, sem API nova. */}
      {buscaAberta && (
        <div className="fixed inset-0 z-40 flex flex-col bg-neutral-50">
          <div className="flex items-center gap-2 border-b border-neutral-200 bg-white p-3">
            <input
              autoFocus
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Encontre seu produto"
              aria-label="Buscar produto"
              className="h-11 flex-1 rounded-xl border border-neutral-200 px-3 text-sm outline-none"
            />
            <button type="button" onClick={() => { setBuscaAberta(false); setBusca(''); }} className="px-2 text-sm font-semibold" style={{ color: accent }}>Fechar</button>
          </div>
          <div className="flex-1 space-y-2.5 overflow-y-auto p-4">
            {!busca.trim() && <p className="py-10 text-center text-sm text-neutral-400">Digite o nome do produto.</p>}
            {busca.trim() && resultadosBusca.length === 0 && <p className="py-10 text-center text-sm text-neutral-400">Nada encontrado.</p>}
            {resultadosBusca.map(cardProduto)}
          </div>
        </div>
      )}

      {sel && <ItemSheet sel={sel} accent={accent} menuTheme={menuTheme} onClose={() => setSel(null)} onAdd={onAdd} />}

      {checkout && (
        <CartSheet
          accent={accent}
          loja={loja}
          tipos={menu.tipos}
          abertaAgora={menu.abertaAgora}
          bairros={bairros}
          cart={cart}
          upsell={upsellFinal}
          isServico={isServico}
          isIndustria={isIndustria}
          total={total}
          taxa={taxa}
          desc={desc}
          totalFinal={totalFinal}
          chk={chk}
          setChk={setChk}
          cupomOk={cupomOk}
          onAplicarCupom={() => aplicarCupom()}
          cuponsSugeridos={cuponsSugeridos}
          onEscolherCupom={(c: string) => aplicarCupom(c)}
          premios={premios}
          premioSel={premioSel}
          premioDesc={premioDesc}
          premioNome={premioNome}
          onEscolherPremio={setPremioSel}
          cashbackSaldo={cashbackSaldo}
          cashbackDesc={cashbackDesc}
          usarCashback={usarCashback}
          onUsarCashback={setUsarCashback}
          onQtd={mudarQtd}
          onRemove={removeItem}
          onAddUpsell={addUpsell}
          onClose={() => setCheckout(false)}
          onSubmit={submitPedido}
          enderecos={enderecosSalvos}
          onUsarEndereco={usarEndereco}
          onCadastrarEndereco={cadastrarEndereco}
          areaRaio={menu.loja?.areaModo === 'raio'}
          temCliente={temCliente}
          enviando={enviando}
        />
      )}

      {/* Após adicionar: continuar comprando ou ir para "Seu pedido". */}
      {perguntaAdd && (
        <div className="fixed inset-0 z-[55] flex items-end justify-center bg-black/40 sm:items-center" onClick={() => setPerguntaAdd(false)}>
          <div className="w-full max-w-sm rounded-t-2xl bg-white p-5 text-neutral-900 sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
            <p className="text-center text-sm font-semibold">Item adicionado ao carrinho ✓</p>
            <p className="mt-0.5 text-center text-xs text-neutral-500">{qtdItens} item(ns) · {brl(total)}</p>
            <div className="mt-4 grid grid-cols-2 gap-2">
              <button type="button" onClick={() => setPerguntaAdd(false)} className="rounded-lg border border-neutral-300 py-2.5 text-sm font-semibold">Continuar comprando</button>
              <button type="button" onClick={() => { setPerguntaAdd(false); setCheckout(true); }} className="rounded-lg py-2.5 text-sm font-semibold text-white" style={{ background: accent }}>Finalizar</button>
            </div>
          </div>
        </div>
      )}

      {mostrarCliente && (
        <ClientePanel
          token={token}
          bairros={bairros}
          onClose={() => setMostrarCliente(false)}
          onUsarEndereco={usarEndereco}
        />
      )}

      {mostrarPedidos && (
        <PedidosPanel
          token={token}
          accent={accent}
          onClose={() => setMostrarPedidos(false)}
          onEntrar={() => { setMostrarPedidos(false); setMostrarCliente(true); }}
          onPedirDeNovo={reordenar}
        />
      )}

      {/* Menu inferior — aparece após o 1º pedido; some quando há overlay aberto. */}
      {temCliente && qtdItens === 0 && !sel && !checkout && !perguntaAdd && !mostrarCliente && !mostrarPedidos && (
        <LojaBottomNav aba={aba} onAba={irAba} accent={accent} carrinhoQtd={qtdItens} menuTheme={menuTheme} onBuscar={() => setBuscaAberta(true)} total={total} />
      )}
    </div>
  );
}
