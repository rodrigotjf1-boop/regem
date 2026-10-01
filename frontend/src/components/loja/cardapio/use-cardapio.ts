'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '@/lib/api';
import {
  TEMA,
  carregarCliente,
  salvarCliente,
  getClienteToken,
  setClienteToken,
  promocoesRespondida,
  marcarPromocoesRespondida,
  type CartItem,
} from '@/components/loja/tipos';
import { distanciaKm, taxaPorRaio, geocodificar } from '@/lib/geo';
import { capturarOrigem, desfazerRecusa, origemParaPedido, origemRecusada, recusarOrigem } from '@/components/loja/origem-clique';
import type { OrigemClique } from '@/components/loja/origem-clique-regras';
import { etapasAtivas, falta as faltaDaEtapa, type Etapa, type EstadoFalta, type Falta } from './etapas';
import { templateDe, type TemplateChave } from './tipos-template';

/* eslint-disable @typescript-eslint/no-explicit-any */

// TODA A LÓGICA DO CARDÁPIO PÚBLICO (`/c/[token]`) — dados, carrinho, checkout, pedido, identidade,
// privacidade e navegação entre as telas. Os templates (Galeria, Balcão, Oferta, Regem Fluxo) só
// desenham; nenhuma regra mora neles (docs/templates-cardapio/00-base-cardapio.md §4.1).
//
// As regras do pedido são as MESMAS do checkout de uma tela que existia antes: idempotência por
// `clientRef`, frete por bairro ou por raio, cupom, prêmio, cashback, nota, encomenda/recorrência,
// origem do anúncio, promoções pelo WhatsApp, QR de mesa e os ramos serviços e indústria. O que
// mudou é a apresentação: o checkout em etapas (`etapas.ts`), o frete "a calcular" antes do
// endereço e o motivo de cada bloqueio dito na tela.

const soNumeros = (v: unknown) => String(v ?? '').replace(/\D/g, '');

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
  // Cupom fiscal: o CPF é opcional no cardápio. Quem marca a caixa passa a ter de preencher.
  cupomFiscal: false,
  cpf: '',
};

/** Camadas abertas sobre a vitrine, em pilha (o "voltar" do aparelho fecha a de cima). */
export type Camada = 'produto' | 'busca' | 'info' | 'conta' | 'local' | `etapa:${Etapa}`;

export type SituacaoLoja = 'aberta' | 'so_retirada' | 'so_entrega' | 'fechada';

const ehEtapa = (c: Camada | undefined): c is `etapa:${Etapa}` => !!c && c.startsWith('etapa:');

export function useCardapio(token: string, mesa: string, search: { get(nome: string): string | null } | null, temaForcado?: TemplateChave | null) {
  const [menu, setMenu] = useState<any>(null);
  const [temaCliente, setTemaCliente] = useState(''); // '' = segue a loja
  const [prefereDark, setPrefereDark] = useState(false);
  /** Erro de carga do cardápio (antes de existir tela). */
  const [erro, setErro] = useState('');
  /** Motivo de o pedido (ou o endereço) não ter saído — mostrado acima do botão (ERR-140). */
  const [erroEnvio, setErroEnvio] = useState('');
  const [cat, setCat] = useState('');
  const [cart, setCart] = useState<CartItem[]>([]);
  // Idempotência: 1 ref por carrinho, reenviado em qualquer retry; zera no sucesso.
  const [clientRef, setClientRef] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [ped, setPed] = useState<any>(null);
  const [verificando, setVerificando] = useState(false);
  const [agora, setAgora] = useState<number>(() => Date.now());
  const [chk, setChk] = useState<any>(CHK_INICIAL);
  const [cupomOk, setCupomOk] = useState<any>(null);
  const [sel, setSel] = useState<any>(null);
  const [busca, setBusca] = useState('');
  const [toast, setToast] = useState('');
  const [pulo, setPulo] = useState(0); // "bump" da barra da sacola a cada item que entra
  const [expressoOff, setExpressoOff] = useState(false);

  // ───────────────────────── navegação: camadas em pilha ─────────────────────────
  // Produto, busca, conta, informações e as etapas do checkout abrem por cima da vitrine. O
  // "voltar" do aparelho fecha a camada de cima em vez de sair do cardápio: enquanto há camada
  // aberta, existe UMA entrada nossa no histórico do navegador.
  const [pilha, setPilha] = useState<Camada[]>([]);
  const entradaHist = useRef(false);
  const ignorarPop = useRef(false);
  const pilhaRef = useRef<Camada[]>([]);
  pilhaRef.current = pilha;
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (pilha.length > 0 && !entradaHist.current) {
      window.history.pushState({ lpMenu: true }, '');
      entradaHist.current = true;
    } else if (pilha.length === 0 && entradaHist.current) {
      entradaHist.current = false;
      ignorarPop.current = true;
      window.history.back();
    }
  }, [pilha.length]);
  useEffect(() => {
    const onPop = () => {
      if (ignorarPop.current) {
        ignorarPop.current = false;
        // Fechou tudo e reabriu antes de o navegador voltar: a entrada nova foi a consumida.
        if (pilhaRef.current.length > 0) window.history.pushState({ lpMenu: true }, '');
        return;
      }
      if (!entradaHist.current) return;
      entradaHist.current = false; // o navegador consumiu a nossa entrada
      setPilha((p) => p.slice(0, -1));
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  const topo = pilha[pilha.length - 1];
  const abrir = useCallback((c: Camada) => setPilha((p) => (p[p.length - 1] === c ? p : [...p, c])), []);
  const voltar = useCallback(() => setPilha((p) => p.slice(0, -1)), []);
  const fecharTudo = useCallback(() => setPilha([]), []);
  const checkoutAberto = pilha.some((c) => ehEtapa(c));
  // A etapa à mostra é a última aberta — continua valendo com um produto aberto por cima dela.
  const camadaEtapa = [...pilha].reverse().find((c) => ehEtapa(c));
  const etapaAtual: Etapa | null = camadaEtapa ? (camadaEtapa.slice(6) as Etapa) : null;

  // Toast curto (item na sacola, cupom, código copiado).
  const toastT = useRef<ReturnType<typeof setTimeout> | null>(null);
  const avisar = useCallback((m: string) => {
    setToast(m);
    if (toastT.current) clearTimeout(toastT.current);
    toastT.current = setTimeout(() => setToast(''), 2400);
  }, []);
  useEffect(() => () => { if (toastT.current) clearTimeout(toastT.current); }, []);

  // Funil (F4): beacons ANÔNIMOS das etapas (uma vez por etapa/sessão). Best-effort,
  // nunca quebra a UX. Sessão gerada por visita; sem PII.
  const sessRef = useRef<string>('');
  if (!sessRef.current) sessRef.current = Math.random().toString(36).slice(2) + Date.now().toString(36);
  const beaconEnviados = useRef<Set<string>>(new Set());
  const beacon = useCallback(
    (tipo: string, meta?: any) => {
      if (!token || beaconEnviados.current.has(tipo)) return;
      beaconEnviados.current.add(tipo);
      void api.cardapioEvento(token, sessRef.current, tipo, meta).catch(() => {});
    },
    [token],
  );
  useEffect(() => { if (menu) beacon('view_menu'); }, [menu, beacon]);
  useEffect(() => { if (cart.length > 0) beacon('add_carrinho'); }, [cart, beacon]);
  useEffect(() => { if (checkoutAberto) beacon('checkout'); }, [checkoutAberto, beacon]);
  useEffect(() => {
    // Funil por etapa (o servidor já aceitava `pagamento` e a tela nunca o enviou).
    if (etapaAtual === 'entrega') beacon('etapa_entrega');
    else if (etapaAtual === 'dados') beacon('etapa_dados');
    else if (etapaAtual === 'pagamento' || etapaAtual === 'revisar') beacon('pagamento');
  }, [etapaAtual, beacon]);
  useEffect(() => { if (ped?.pedidoId) beacon('pedido'); }, [ped, beacon]);

  const [ultimoPedido, setUltimoPedido] = useState<any>(null);
  const [ident, setIdent] = useState(0);
  // Recalcula a cada render: o token nasce no 1º pedido, no login por código e no link `?u=`.
  const temCliente = typeof window !== 'undefined' && !!getClienteToken(token);

  // ───────────────────────── carga do cardápio ─────────────────────────
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

  const loja = menu?.loja;
  const isServico = loja?.ramo === 'servicos';
  const isIndustria = loja?.ramo === 'industria';
  const produtos: any[] = useMemo(() => menu?.produtos ?? [], [menu]);
  const bairros: any[] = useMemo(() => menu?.bairros ?? [], [menu]);
  const areaRaio = loja?.areaModo === 'raio';
  const template: TemplateChave = temaForcado ?? templateDe(loja?.menuTheme);
  const mesaDireta = menu?.modo === 'mesa' && !!mesa;

  // Personalização do tema (botão "Editar tema"): cor primária + chaves de exibição.
  const tc = loja?.temaConfig ?? {};
  const accent: string = tc.corPrimaria || TEMA[loja?.ramo] || '#E2A340';
  // Cor do cabeçalho escolhida pela loja ("Editar tema"): pinta o bloco com o nome da loja.
  // Sem cor de fundo escolhida, vale o cabeçalho do template (a cor do texto sozinha não se aplica).
  const corCabecalho: string | null = tc.corCabecalho || null;
  const corTextoCabecalho: string = tc.corTextoCabecalho || '#ffffff';
  const showDestaques = tc.mostrarDestaques !== false;
  const showBanner = tc.mostrarBanner !== false;
  const showUltimos = tc.mostrarUltimos !== false;
  const bannerIntervalo = Math.max(1, Number(tc.bannerIntervalo) || 2);

  // ───────────────────────── privacidade: origem do anúncio ─────────────────────────
  // De onde o cliente veio (link de anúncio, trilha C): só na loja que mede anúncios e nunca no
  // QR da mesa. Lido UMA vez por carregamento; guardado só nesta aba (`origem-clique.ts`).
  const [origem, setOrigem] = useState<OrigemClique | null>(null);
  const [origemDesfazer, setOrigemDesfazer] = useState<OrigemClique | null>(null); // para o "Desfazer"
  const origemLida = useRef(false);
  const medeAnuncios = !!loja?.medeAnuncios && !mesa;
  useEffect(() => {
    if (!menu || origemLida.current) return;
    origemLida.current = true;
    if (medeAnuncios) setOrigem(capturarOrigem(token, search));
  }, [menu, medeAnuncios, token, search]);
  function recusarOrigemPedido() {
    setOrigemDesfazer(origem);
    recusarOrigem(token);
    setOrigem(null);
  }
  function desfazerRecusaOrigem() {
    desfazerRecusa(token, origemDesfazer);
    setOrigem(origemDesfazer);
    setOrigemDesfazer(null);
  }
  const estadoOrigem: 'aviso' | 'recusado' | null = !medeAnuncios
    ? null
    : origem
      ? 'aviso'
      : origemDesfazer && origemRecusada(token)
        ? 'recusado'
        : null;

  // ───────────────────────── promoções pelo WhatsApp ─────────────────────────
  // Na loja que manda promoção, a caixinha aparece no PRIMEIRO pedido deste aparelho, já marcada;
  // respondida, não volta (o cliente identificado que já respondeu em outro aparelho também não é
  // perguntado). Nunca no QR da mesa.
  const promoLoja = (loja?.promocoes ?? null) as { frase: string; apoio: string } | null;
  const [promoRespondida, setPromoRespondida] = useState(true); // até ler o aparelho, não pergunta
  const [promoMarcada, setPromoMarcada] = useState(true);
  useEffect(() => {
    setPromoRespondida(promocoesRespondida(token));
  }, [token]);
  const perguntaPromocoes = !!promoLoja && !mesa && !promoRespondida;

  // ───────────────────────── identidade do cliente ─────────────────────────
  // Identidade por link no ?u=. Aceita slug curto (resolve no servidor) ou o
  // token JWT assinado (legado). Não expõe nome/telefone na URL.
  useEffect(() => {
    const u = search?.get('u');
    if (!u) return;
    if (u.includes('.')) {
      setClienteToken(token, u);
      setIdent((n) => n + 1);
    } else {
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

  // Cliente identificado: perfil (endereços, último pedido completo) e pré-preenchimento.
  const [perfil, setPerfil] = useState<any>(null);
  const [enderecosSalvos, setEnderecosSalvos] = useState<any[]>([]);
  const recarregarPerfil = useCallback(async () => {
    const ct = getClienteToken(token);
    if (!ct) {
      setPerfil(null);
      setEnderecosSalvos([]);
      return null;
    }
    try {
      const p: any = await api.clientePerfil(token, ct);
      setPerfil(p);
      setEnderecosSalvos(p.enderecos ?? []);
      return p;
    } catch {
      return null; /* sem perfil: lista vazia */
    }
  }, [token]);
  useEffect(() => {
    const ct = getClienteToken(token);
    if (!menu || !ct) return;
    recarregarPerfil().then((p: any) => {
      if (!p) return;
      // Já respondeu sobre as promoções (aqui ou em outro aparelho): o checkout não pergunta de novo.
      if (p.promocoes?.respondeu) {
        marcarPromocoesRespondida(token);
        setPromoRespondida(true);
      }
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
    });
  }, [menu, token, ident, recarregarPerfil]);

  // Último pedido do cliente ("Peça de novo").
  useEffect(() => {
    if (!menu) return;
    const tel = soNumeros(chk.telefone);
    if (tel.length < 10) {
      setUltimoPedido(null);
      return;
    }
    api.cardapioUltimoPedido(token, getClienteToken(token) || undefined).then(setUltimoPedido).catch(() => setUltimoPedido(null));
  }, [menu, token, chk.telefone, ident]);

  // Modo raio: se o endereço não tem coordenadas, geocodifica o endereço
  // digitado (CEP/rua) para calcular o frete por distância.
  useEffect(() => {
    if (!checkoutAberto || !menu || !areaRaio || chk.tipo !== 'entrega') return;
    if (chk.lat && chk.lng) return; // já tem coordenadas (endereço salvo/GPS)
    if (!chk.rua?.trim()) return;
    const cidade = loja?.endereco?.cidade ?? '';
    const q = [chk.rua, chk.numero, cidade, 'Brasil'].filter(Boolean).join(', ');
    const t = setTimeout(() => {
      geocodificar(q).then((c) => { if (c) setChk((s: any) => ({ ...s, lat: c.lat, lng: c.lng })); }).catch(() => {});
    }, 600);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checkoutAberto, menu, areaRaio, chk.rua, chk.numero, chk.tipo, chk.lat, chk.lng]);

  // Prefill do nome pelo telefone (se a fidelidade estiver ativa).
  useEffect(() => {
    const tel = soNumeros(chk.telefone);
    if (!loja?.fidelidadeAtiva || tel.length < 8 || (chk.nome ?? '').trim()) return;
    const t = setTimeout(async () => {
      try {
        const r: any = await api.cardapioPontos(token, getClienteToken(token) || undefined);
        if (r?.nome) setChk((s: any) => (s.nome ? s : { ...s, nome: r.nome }));
      } catch {
        /* ignora */
      }
    }, 700);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chk.telefone, chk.nome, menu, token]);

  // ───────────────────────── aparência: claro/escuro ─────────────────────────
  // O lojista escolhe (loja.tema: claro|escuro|auto); o cliente pode alternar (guardado por
  // cardápio no aparelho). 'auto' segue o sistema do cliente.
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

  // ───────────────────────── vitrine: seções, destaques, busca ─────────────────────────
  const destaques = useMemo(
    () =>
      produtos
        .filter((p) => !p.esgotado && (p.destaque || (p.selos ?? []).some((s: string) => ['novo', 'mais_pedido'].includes(s))))
        .slice(0, 12),
    [produtos],
  );
  const produtosPromo = useMemo(() => produtos.filter((p) => p.precoDe != null && !p.esgotado), [produtos]);
  /** Seções da vitrine: produtos sem categoria primeiro (sem título), depois cada categoria com produto. */
  const secoes = useMemo(() => {
    const cats: any[] = menu?.categorias ?? [];
    const ids = new Set(cats.map((c) => c.id));
    const soltos = produtos.filter((p) => !p.categoriaId || !ids.has(p.categoriaId));
    const lista = cats
      .map((c) => ({ id: String(c.id), nome: String(c.nome ?? ''), descricao: c.descricao ?? null, imagemRef: c.imagemRef ?? null, itens: produtos.filter((p) => p.categoriaId === c.id) }))
      .filter((s) => s.itens.length > 0);
    return soltos.length ? [{ id: '_outros', nome: cats.length ? 'Outros' : 'Cardápio', descricao: null, imagemRef: null, itens: soltos }, ...lista] : lista;
  }, [menu, produtos]);
  const resultadosBusca = useMemo(() => {
    const q = busca.trim().toLowerCase();
    if (!q) return [];
    return produtos.filter((p) => `${p.nome} ${p.descricao ?? ''}`.toLowerCase().includes(q));
  }, [produtos, busca]);

  // ───────────────────────── carrinho ─────────────────────────
  const total = useMemo(() => cart.reduce((s, i) => s + i.preco * i.qtd, 0), [cart]);
  const qtdItens = cart.reduce((s, i) => s + i.qtd, 0);

  /** Produto que pede escolha antes de entrar na sacola (variação ou grupo obrigatório). */
  const precisaEscolha = useCallback(
    (p: any) => (p?.variacoes?.length ?? 0) > 0 || (p?.grupos ?? []).some((g: any) => g.obrigatorio || g.min),
    [],
  );

  function onAdd(item: CartItem) {
    setCart((c) => {
      const ex = c.find((i) => i.key === item.key);
      if (ex) return c.map((i) => (i.key === item.key ? { ...i, qtd: i.qtd + item.qtd } : i));
      return [...c, item];
    });
    setSel(null);
    setPulo((n) => n + 1);
    // Com a sacola aberta, o item já aparece na lista: o aviso só cobriria o total.
    if (!checkoutAberto) avisar(`${item.nome} está na sacola`);
  }
  /** Fecha o produto (camada de cima) e põe o item na sacola. */
  function adicionarDoProduto(item: CartItem) {
    onAdd(item);
    setPilha((p) => (p[p.length - 1] === 'produto' ? p.slice(0, -1) : p));
  }
  function abrirProduto(p: any) {
    if (!p || p.esgotado) return;
    setSel(p);
    abrir('produto');
  }
  /**
   * "+" direto (produto sem escolha obrigatória): entra como entraria pelo produto — com as
   * opções que o cadastro traz pré-marcadas ("Talheres? Sim"), respeitando o máximo do grupo.
   * Produto que pede escolha abre a tela dele.
   */
  function adicionarRapido(p: any) {
    if (!p || p.esgotado) return;
    const full = produtos.find((x: any) => x.id === p.id) ?? p;
    if (precisaEscolha(full)) return abrirProduto(full);
    const marcadas: any[] = (full.grupos ?? []).flatMap((g: any) => {
      const m = (g.opcoes ?? []).filter((o: any) => o.padraoMarcada);
      return g.max != null ? m.slice(0, g.max) : m;
    });
    const complementos: string[] = marcadas.map((o: any) => o.id);
    const preco = Number(full.precoVenda ?? p.precoVenda ?? 0) + marcadas.reduce((s, o) => s + (Number(o.precoDelta) || 0), 0);
    onAdd({
      key: `${full.id}::${[...complementos].sort().join(',')}:`,
      produtoId: full.id,
      variacaoId: undefined,
      complementos,
      nome: full.nome,
      sub: marcadas.map((o: any) => o.nome).join(' · '),
      preco,
      obs: '',
      qtd: 1,
    });
  }
  function mudarQtd(key: string, d: number) {
    setCart((c) => c.map((i) => (i.key === key ? { ...i, qtd: i.qtd + d } : i)).filter((i) => i.qtd > 0));
  }
  function removeItem(key: string) {
    setCart((c) => c.filter((i) => i.key !== key));
  }

  // "Pedir de novo": recompõe o carrinho a partir do snapshot do pedido.
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
    if (novos.length) {
      setCart((c) => [...c, ...novos]);
      setPulo((n) => n + 1);
      avisar(novos.length === 1 ? `${novos[0].nome} está na sacola` : `${novos.length} itens na sacola`);
    }
  }
  async function reordenarUltimo() {
    const ct = getClienteToken(token);
    if (!ct || !ultimoPedido) return;
    try {
      const r: any = await api.clientePedirDeNovo(token, ultimoPedido.id, ct);
      reordenar(r.itens ?? []);
    } catch {
      avisar('Não foi possível repetir o pedido agora.');
    }
  }

  // "Peça também" inteligente: cadastro vinculado (prioridade) → senão os destaques.
  const upsell = useMemo(
    () => produtos.filter((p) => p.destaque && !p.esgotado && !cart.some((c) => c.produtoId === p.id)).slice(0, 6),
    [produtos, cart],
  );
  const [pecaTambem, setPecaTambem] = useState<any[]>([]);
  useEffect(() => {
    if (!checkoutAberto || cart.length === 0) return;
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
  }, [checkoutAberto, cart, token]);
  const upsellFinal = (pecaTambem.length ? pecaTambem : upsell).filter((p: any) => !cart.some((c) => c.produtoId === p.id));

  // ───────────────────────── situação da loja (base §5.5) ─────────────────────────
  const tp = menu?.tipos ?? { delivery: true };
  const temPorTipo = !!menu?.abertoPorTipo;
  const abt = menu?.abertoPorTipo ?? {};
  const habEntrega = !!tp.delivery && !isServico;
  const habRetirada = !!tp.retirada || !!tp.local;
  const entregaAberta = habEntrega && (!temPorTipo || abt.entrega !== false);
  const retiradaAberta = habRetirada && (!temPorTipo || abt.retirada !== false || abt.local !== false);
  // Fechada = nenhum modo disponível agora. No payload antigo (sem abertoPorTipo), vale o geral.
  const fechada = temPorTipo ? !entregaAberta && !retiradaAberta : menu?.abertaAgora === false;
  // Encomenda (mig 186): food/varejo só oferecem data futura se a loja liga o modo.
  const enc = loja?.encomenda;
  const encAtiva = !isServico && !isIndustria && enc?.ativa === true;
  // Loja fechada com encomenda: o pedido só pode ser agendado.
  const soAgendado = fechada && encAtiva;
  const agendar = isServico || (encAtiva && (chk.quando === 'agendar' || soAgendado));
  const fechadaSemAgenda = fechada && !agendar;
  const situacao: SituacaoLoja = fechada
    ? 'fechada'
    : habEntrega && !entregaAberta && retiradaAberta
      ? 'so_retirada'
      : habRetirada && !retiradaAberta && entregaAberta
        ? 'so_entrega'
        : 'aberta';
  // O que o cliente pode escolher: o tipo habilitado e aberto agora (ou qualquer habilitado, se o
  // pedido só pode ser agendado — o servidor libera a encomenda mesmo com a loja fechada).
  const dispEntrega = habEntrega && (soAgendado || entregaAberta);
  const dispRetirada = habRetirada && (soAgendado || retiradaAberta);
  const tipoDisponivel = isServico ? true : chk.tipo === 'entrega' ? dispEntrega : dispRetirada;

  // Tipo padrão respeita a config e o que está aberto (se só há retirada, começa em retirada).
  useEffect(() => {
    if (!menu || isServico) return;
    setChk((s: any) => {
      const ok = s.tipo === 'entrega' ? dispEntrega : dispRetirada;
      if (ok) return s;
      if (dispEntrega) return { ...s, tipo: 'entrega' };
      if (dispRetirada) return { ...s, tipo: 'retirada' };
      // nada aberto: fica no tipo que a loja oferece (o botão final é que bloqueia)
      const hab = (s.tipo === 'entrega' && habEntrega) || (s.tipo === 'retirada' && habRetirada);
      return hab ? s : { ...s, tipo: habEntrega ? 'entrega' : 'retirada' };
    });
  }, [menu, isServico, dispEntrega, dispRetirada, habEntrega, habRetirada]);
  // Loja fechada com encomenda: "o quanto antes" não existe.
  useEffect(() => {
    if (soAgendado) setChk((s: any) => (s.quando === 'agendar' ? s : { ...s, quando: 'agendar' }));
  }, [soAgendado]);

  // ───────────────────────── frete, cupom, benefícios, totais ─────────────────────────
  const entregaSel = !isServico && chk.tipo === 'entrega';
  // Frete grátis só se o limite for > 0 (0/vazio = função desligada).
  const freteGratisAcima = loja?.freteGratisAcima != null && Number(loja.freteGratisAcima) > 0 ? Number(loja.freteGratisAcima) : null;
  const gratisAcima = freteGratisAcima != null && total >= freteGratisAcima;
  const km = useMemo(
    () => (areaRaio ? distanciaKm(loja?.lojaLat, loja?.lojaLng, chk.lat, chk.lng) : null),
    [areaRaio, loja, chk.lat, chk.lng],
  );
  const bairroSel = bairros.find((b) => b.id === chk.bairroId);
  const freteInfo = useMemo(() => {
    if (!entregaSel) return { taxa: 0, pendente: false };
    if (cupomOk?.valido && cupomOk.freteGratis) return { taxa: 0, pendente: false }; // cupom de frete grátis
    if (gratisAcima) return { taxa: 0, pendente: false };
    if (areaRaio) {
      if (km == null) return { taxa: 0, pendente: true }; // sem localização ainda
      return { taxa: taxaPorRaio(loja?.raios ?? [], km), pendente: false };
    }
    if (!bairroSel) return { taxa: 0, pendente: true }; // sem bairro ainda
    return { taxa: Number(bairroSel.taxa ?? 0), pendente: false };
  }, [entregaSel, cupomOk, gratisAcima, areaRaio, km, loja, bairroSel]);
  const taxa = freteInfo.taxa;
  /** Entrega sem bairro (ou sem localização, no modo raio): o frete ainda não se conhece. */
  const taxaPendente = freteInfo.pendente;
  const desc = cupomOk?.valido ? cupomOk.desconto : 0;

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
  function tirarCupom() {
    setCupomOk(null);
    setChk((s: any) => ({ ...s, cupom: '' }));
  }
  // A sacola mudou com um cupom aplicado: confere de novo (mínimo do cupom, desconto em %).
  useEffect(() => {
    if (cupomOk?.valido && chk.cupom) void aplicarCupom(chk.cupom);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [total]);

  // Cupons que o cliente pode usar agora (sugestão no checkout).
  const [cuponsSugeridos, setCuponsSugeridos] = useState<any[]>([]);
  useEffect(() => {
    if (!checkoutAberto || !menu) return;
    api
      .cardapioCuponsDisponiveis(token, soNumeros(chk.telefone), Math.round(total))
      .then((l: any) => setCuponsSugeridos(Array.isArray(l) ? l : []))
      .catch(() => setCuponsSugeridos([]));
  }, [checkoutAberto, menu, token, chk.telefone, total]);

  // Saldo de cashback (valor) — opção de usar no pedido.
  const [cashbackSaldo, setCashbackSaldo] = useState(0);
  const [usarCashback, setUsarCashback] = useState(true);
  useEffect(() => {
    if (!checkoutAberto || !menu) return;
    const tel = soNumeros(chk.telefone);
    if (tel.length < 10) {
      setCashbackSaldo(0);
      return;
    }
    api.cardapioCashback(token, getClienteToken(token) || undefined).then((c: any) => setCashbackSaldo(Number(c?.valor) || 0)).catch(() => setCashbackSaldo(0));
  }, [checkoutAberto, menu, token, chk.telefone]);

  // Prêmios de fidelidade resgatados (abate automático no pedido).
  const [premios, setPremios] = useState<any[]>([]);
  const [premioSel, setPremioSel] = useState('');
  useEffect(() => {
    if (!checkoutAberto || !menu) return;
    const tel = soNumeros(chk.telefone);
    if (tel.length < 10) {
      setPremios([]);
      return;
    }
    api
      .cardapioFidelidadePremios(token, getClienteToken(token) || undefined)
      .then((l: any) => {
        const arr = Array.isArray(l) ? l : [];
        setPremios(arr);
        setPremioSel((c) => c || arr[0]?.id || ''); // auto-aplica o 1º
      })
      .catch(() => setPremios([]));
  }, [checkoutAberto, menu, token, chk.telefone]);
  const premioDesc = useMemo(() => {
    const p = premios.find((x) => x.id === premioSel);
    if (!p) return 0;
    const v = Number(p.recompensaValor) || 0;
    if (p.recompensaTipo === 'valor_fixo') return Math.min(total, v);
    if (p.recompensaTipo === 'percentual_produtos') {
      const selecao = new Set(p.recompensaProdutos ?? []);
      const base = cart.filter((i) => selecao.has(i.produtoId)).reduce((a, i) => a + i.preco * i.qtd, 0);
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
  const pontosPrevistos = loja?.fidelidadeAtiva && !isIndustria ? Math.round(totalFinal) : null;

  // Benefícios para a vitrine e o bloco "Seus benefícios": cupons públicos e planos da loja (uma
  // vez por carga) e, para quem está identificado, o progresso no plano de fidelidade.
  const [promosLoja, setPromosLoja] = useState<any>(null);
  useEffect(() => {
    if (!menu) return;
    api.cardapioPromos(token).then(setPromosLoja).catch(() => setPromosLoja(null));
  }, [menu, token]);
  const [fidStatus, setFidStatus] = useState<any>(null);
  const [cashbackInfo, setCashbackInfo] = useState<any>(null);
  useEffect(() => {
    const ct = getClienteToken(token);
    if (!menu || !ct) {
      setFidStatus(null);
      setCashbackInfo(null);
      return;
    }
    if (loja?.fidelidadeAtiva) api.cardapioPontos(token, ct).then(setFidStatus).catch(() => setFidStatus(null));
    api.cardapioCashback(token, ct).then(setCashbackInfo).catch(() => setCashbackInfo(null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [menu, token, ident, ped?.pedidoId]);

  // ───────────────────────── endereços salvos ─────────────────────────
  // Usar um endereço salvo: preenche o checkout de entrega.
  function usarEndereco(e: any) {
    setChk((s: any) => ({
      ...s,
      tipo: dispEntrega || !menu ? 'entrega' : s.tipo,
      rua: e.logradouro || s.rua,
      numero: e.numero || s.numero,
      referencia: e.referencia || e.complemento || s.referencia,
      bairroId: e.bairroId || s.bairroId, // já traz o frete da área de atendimento
      lat: e.lat ?? s.lat,
      lng: e.lng ?? s.lng,
    }));
  }
  // Cadastra um novo endereço a partir do checkout (mesmo processo do Perfil). Falhou: o motivo
  // aparece acima do botão e o formulário continua aberto (quem chama só fecha se não houver erro).
  async function cadastrarEndereco(dados: any) {
    const ct = getClienteToken(token);
    if (!ct) {
      const msg = 'Confirme seu telefone no Perfil para salvar endereços.';
      setErroEnvio(msg);
      throw new Error(msg);
    }
    setErroEnvio('');
    const b = bairros.find((x: any) => x.id === dados.bairroId);
    try {
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
    } catch (e) {
      setErroEnvio(e instanceof Error ? e.message : 'Não foi possível salvar o endereço. Tente de novo.');
      throw e;
    }
    await recarregarPerfil();
    usarEndereco({
      logradouro: dados.logradouro,
      numero: dados.numero,
      referencia: dados.referencia,
      bairroId: dados.bairroId,
      lat: dados.lat,
      lng: dados.lng,
    });
  }

  // ───────────────────────── checkout em etapas ─────────────────────────
  const estadoFalta: EstadoFalta = {
    template,
    qtdItens,
    chk,
    mesaDireta,
    isServico,
    isIndustria,
    areaRaio,
    temBairros: bairros.length > 0,
    fechadaSemAgenda,
    horarioLabel: menu?.horarioLabel ?? null,
    precisaAgendar: agendar,
    tipoDisponivel,
    pagamentos: loja?.pagamentos ?? [],
    formasCartao: loja?.formasCartao ?? [],
  };
  // Pedido expresso (Regem Fluxo): cliente reconhecido, com o último pedido, e nada faltando.
  const ultimoDoPerfil = (perfil?.historico ?? [])[0] ?? null;
  // Já na revisão, continua expresso mesmo que algo passe a faltar (o rodapé diz o quê).
  const podeExpresso =
    template === 'fluxo' && !mesaDireta && !isServico && !isIndustria && temCliente && !!ultimoDoPerfil && !expressoOff &&
    (pilha.includes('etapa:revisar') || !faltaDaEtapa('revisar', estadoFalta));
  const etapas = etapasAtivas({ template, mesaDireta, isServico, isIndustria, expresso: podeExpresso });
  const falta = (e: Etapa): Falta => faltaDaEtapa(e, estadoFalta);

  // Cliente reconhecido: a forma de pagamento e o tipo do último pedido já vêm escolhidos (se a
  // loja ainda os oferece). Só preenche o que está vazio — nunca troca o que o cliente escolheu.
  const expressoPreenchido = useRef(false);
  useEffect(() => {
    if (!menu || !ultimoDoPerfil || expressoPreenchido.current) return;
    expressoPreenchido.current = true;
    const pg: string[] = loja?.pagamentos ?? [];
    setChk((s: any) => {
      const n = { ...s };
      if (!n.forma && ultimoDoPerfil.formaPagamento && pg.includes(ultimoDoPerfil.formaPagamento)) {
        n.forma = ultimoDoPerfil.formaPagamento;
        const bandeiras: string[] = loja?.formasCartao ?? [];
        if (n.forma === 'cartao' && ultimoDoPerfil.bandeira && bandeiras.includes(ultimoDoPerfil.bandeira)) n.bandeira = ultimoDoPerfil.bandeira;
      }
      return n;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [menu, ultimoDoPerfil]);

  function abrirSacola() {
    if (!cart.length) return;
    setToast('');
    setErroEnvio(''); // recomeça sem o aviso de uma tentativa anterior
    setPilha((p) => [...p.filter((c) => !ehEtapa(c)), 'etapa:sacola']);
  }
  function fecharCheckout() {
    setErroEnvio('');
    setPilha((p) => p.filter((c) => !ehEtapa(c)));
  }
  /** Avança uma etapa. Devolve o que falta (para a tela rolar até o campo) ou `null`. */
  function avancar(): Falta {
    if (!etapaAtual) return null;
    const f = falta(etapaAtual);
    if (f) return f;
    const i = etapas.indexOf(etapaAtual);
    const prox = etapas[i + 1];
    if (prox) {
      setErroEnvio('');
      abrir(`etapa:${prox}`);
      return null;
    }
    void submitPedido();
    return null;
  }
  /** "Trocar" no pedido expresso: volta ao fluxo normal, direto na etapa do item. */
  function trocarNoExpresso(alvo: Etapa) {
    setExpressoOff(true);
    const normais = etapasAtivas({ template, mesaDireta, isServico, isIndustria, expresso: false });
    const ate = Math.max(0, normais.indexOf(alvo));
    setPilha((p) => [...p.filter((c) => !ehEtapa(c)), ...normais.slice(0, ate + 1).map((e) => `etapa:${e}` as Camada)]);
  }

  async function submitPedido() {
    // Cliente é obrigado a informar nome e telefone (exceto QR de mesa).
    if (!mesa) {
      if (!chk.nome?.trim()) { setErroEnvio('Informe seu nome.'); return; }
      if (soNumeros(chk.telefone).length < 10) { setErroEnvio('Informe um telefone válido (com DDD).'); return; }
      // Pediu a nota, então o documento tem de estar certo: o servidor confere os dígitos e
      // recusaria o pedido inteiro — melhor avisar aqui, antes de tentar cobrar.
      if (chk.cupomFiscal && ![11, 14].includes(soNumeros(chk.cpf).length)) {
        setErroEnvio('Informe um CPF (11 dígitos) ou CNPJ (14) para o cupom fiscal, ou desmarque a opção.');
        return;
      }
    }
    setErroEnvio(''); // some o aviso da tentativa anterior; se esta falhar, o motivo novo aparece
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
        // Recorrência leve da encomenda (mig 190): dias da semana + hora do agendamento.
        recorrencia:
          chk.recorrente && (chk.recorrenciaDias ?? []).length && chk.agendamento
            ? { dias: chk.recorrenciaDias, hora: String(chk.agendamento).slice(11, 16) }
            : undefined,
        profissional: chk.profissional || undefined,
        cnpj: chk.cnpj || undefined,
        cpf: chk.cupomFiscal ? soNumeros(chk.cpf) : undefined,
        // Lido do aparelho na hora: o que foi recusado ou apagado não vai.
        origem: medeAnuncios ? origemParaPedido(token) ?? undefined : undefined,
        // A caixinha de promoções só vai quando apareceu (true = como vem; false = desmarcou).
        promocoes: perguntaPromocoes ? promoMarcada : undefined,
        itens: cart.map((i) => ({
          produtoId: i.produtoId,
          variacaoId: i.variacaoId,
          complementos: i.complementos,
          quantidade: i.qtd,
          observacao: i.obs || undefined,
        })),
      });
      // Pagamento online: com gateway configurado, retorna o PIX (QR + copia-e-cola) para exibir;
      // sem gateway ATIVO, o backend aprova no modo mock (sem PIX). Não engolir o erro: se falhar,
      // mostrar o motivo. E se voltar sem PIX (mock), avisar que o online está inativo.
      let pixResp: any = null;
      let pixErro: string | null = null;
      if (r.pagamentoOnline && r.pedidoId) {
        try {
          pixResp = await api.cardapioPagar(token, r.pedidoId);
          if (!pixResp?.pix?.qrCode)
            pixErro =
              'Pagamento online indisponível: o Mercado Pago não está ativo. ' +
              'Ative em Delivery · Integrações (cole o Access Token e ligue a chave). ' +
              'O pedido foi registrado.';
        } catch (e) {
          pixErro = e instanceof Error ? e.message : 'Não foi possível gerar o PIX.';
        }
      }
      // Identidade do cliente (token aleatório) criada/confirmada no 1º pedido.
      if (r.clienteToken) {
        setClienteToken(token, r.clienteToken);
        setIdent((n) => n + 1);
      }
      // A pergunta das promoções foi respondida neste pedido: não volta neste aparelho.
      if (perguntaPromocoes) {
        marcarPromocoesRespondida(token);
        setPromoRespondida(true);
      }
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
      // O que a tela de confirmação precisa e o servidor não devolve (não se mistura ao status).
      const resumo = { tipo: isServico ? 'retirada' : chk.tipo, pontosPrevistos, tempoMin: entrega ? loja?.tempoEntregaMin : loja?.tempoRetiradaMin, enviadoEm: Date.now(), totalPrevisto: totalFinal };
      setCart([]);
      setClientRef(''); // pedido concluído: próximo carrinho recebe um novo ref
      setPilha([]);
      setExpressoOff(false);
      setAgora(Date.now()); // o cronômetro do Pix começa a contar de agora, não da abertura da página
      if (r.modo === 'mesa') setPed({ mesa: r.mesa, modo: 'mesa', resumo });
      else
        setPed({
          pedidoId: r.pedidoId,
          displayId: r.displayId,
          status: 'novo',
          statusPagamento: pixResp?.statusPagamento ?? (r.pagamentoOnline ? 'aguardando' : null),
          pontos: r.pontos,
          orcamento: r.orcamento,
          agendamento: r.agendamento,
          total: r.total,
          ref,
          pix: pixResp?.pix ?? null,
          pixErro,
          pixExpira: pixResp?.pix?.qrCode ? Date.now() + 10 * 60 * 1000 : null,
          avisos: Array.isArray(r.avisos) ? r.avisos : [],
          resumo,
        });
    } catch (e) {
      setErroEnvio(e instanceof Error ? e.message : 'Erro ao enviar');
    } finally {
      setEnviando(false);
    }
  }

  // ───────────────────────── pedido enviado: acompanhamento ─────────────────────────
  useEffect(() => {
    if (!ped?.pedidoId) return;
    const t = setInterval(async () => {
      try {
        const s: any = await api.cardapioStatus(token, ped.pedidoId);
        setPed((p: any) => (p ? { ...p, ...s } : p));
      } catch {
        /* */
      }
    }, 5000);
    return () => clearInterval(t);
  }, [ped?.pedidoId, token]);

  // Enquanto aguarda o PIX, consulta o pagamento no gateway (não depende do webhook chegar). Se
  // aprovado, o backend marca pago + aceita; o poll de status acima pega a mudança.
  useEffect(() => {
    if (!ped?.pedidoId || ped.statusPagamento !== 'aguardando') return;
    const t = setInterval(() => {
      api.cardapioVerificarPagamento(token, ped.pedidoId).catch(() => {});
    }, 7000);
    return () => clearInterval(t);
  }, [ped?.pedidoId, ped?.statusPagamento, token]);

  // Relógio de 1s para o cronômetro de expiração do PIX (só enquanto aguarda).
  useEffect(() => {
    if (ped?.statusPagamento !== 'aguardando') return;
    const t = setInterval(() => setAgora(Date.now()), 1000);
    return () => clearInterval(t);
  }, [ped?.statusPagamento]);

  async function verificarPagamento() {
    if (!ped?.pedidoId) return;
    setVerificando(true);
    try {
      const r: any = await api.cardapioVerificarPagamento(token, ped.pedidoId);
      const s: any = await api.cardapioStatus(token, ped.pedidoId).catch(() => ({}));
      setPed((p: any) => (p ? { ...p, ...s, ...r } : p));
    } catch {
      /* segue aguardando */
    } finally {
      setVerificando(false);
    }
  }
  function novoPedido() {
    setPed(null);
    setCupomOk(null);
  }

  // ───────────────────────── banner: deep-link ─────────────────────────
  // `item:ID` abre o produto, `category:ID` vai à categoria, `coupon:CODE` aplica o cupom e abre a
  // sacola, senão trata como URL. Reusa o campo `link` do banner — sem estrutura nova.
  function abrirBanner(b: any): { categoria?: string } | void {
    const alvo: string = b?.deepLink || b?.link || '';
    if (!alvo) return;
    const [tipo, ...resto] = alvo.split(':');
    const valor = resto.join(':');
    if (tipo === 'item') {
      const it = produtos.find((p: any) => p.id === valor);
      if (it) abrirProduto(it);
    } else if (tipo === 'category') {
      return { categoria: valor };
    } else if (tipo === 'coupon') {
      void aplicarCupom(valor);
      if (cart.length) abrirSacola();
      else avisar(`Cupom ${valor.toUpperCase()} guardado para o seu pedido`);
    } else if (/^https?:\/\//.test(alvo)) {
      window.open(alvo, '_blank', 'noopener,noreferrer');
    }
  }
  /** Foto do produto de uma linha da sacola. */
  const fotoDe = (produtoId: string): string | null => produtos.find((p: any) => p.id === produtoId)?.imagemRef ?? null;
  /** "18:00" ou "sex 18:00": quando o tipo volta a atender (o servidor calcula). */
  const proximaAbertura = (menu?.proximaAbertura ?? {}) as { entrega?: string | null; retirada?: string | null };

  /** O produto para o qual o banner aponta (legenda da Galeria: selo e preço). */
  const produtoDoBanner = (b: any) => {
    const alvo: string = b?.deepLink || b?.link || '';
    return alvo.startsWith('item:') ? produtos.find((p: any) => p.id === alvo.slice(5)) ?? null : null;
  };

  /** Sessão do cliente mudou (login por código, sair, excluir conta): recarrega o que depende dela. */
  function sessaoMudou() {
    setIdent((n) => n + 1);
    if (!getClienteToken(token)) {
      setPerfil(null);
      setEnderecosSalvos([]);
      setUltimoPedido(null);
    }
  }

  return {
    // identidade da página
    token, mesa, template, menu, loja, erro, carregar,
    isServico, isIndustria, mesaDireta, areaRaio,
    accent, corCabecalho, corTextoCabecalho, dark, alternarTema, showDestaques, showBanner, showUltimos, bannerIntervalo,
    // vitrine
    produtos, bairros, secoes, destaques, produtosPromo, cat, setCat, busca, setBusca, resultadosBusca,
    situacao, fechada, fechadaSemAgenda, soAgendado, habEntrega, habRetirada, dispEntrega, dispRetirada,
    freteGratisAcima, gratisAcima, promosLoja, fidStatus, cashbackInfo,
    abrirBanner, produtoDoBanner, precisaEscolha, fotoDe, proximaAbertura,
    // navegação
    pilha, topo, abrir, voltar, fecharTudo, etapaAtual, checkoutAberto, toast, avisar, pulo,
    // produto e carrinho
    sel, abrirProduto, adicionarRapido, adicionarDoProduto, onAdd,
    cart, qtdItens, total, mudarQtd, removeItem, upsell: upsellFinal, reordenar, reordenarUltimo, ultimoPedido,
    // checkout
    chk, setChk, etapas, falta, avancar, abrirSacola, fecharCheckout, podeExpresso, trocarNoExpresso, ultimoDoPerfil,
    encAtiva, enc, agendar, km, bairroSel,
    taxa, taxaPendente, desc, cupomOk, aplicarCupom, tirarCupom, cuponsSugeridos,
    premios, premioSel, setPremioSel, premioDesc, premioNome,
    cashbackSaldo, cashbackDesc, usarCashback, setUsarCashback,
    totalFinal, pontosPrevistos,
    enderecosSalvos, usarEndereco, cadastrarEndereco, temCliente, perfil, recarregarPerfil, sessaoMudou,
    estadoOrigem, recusarOrigemPedido, desfazerRecusaOrigem,
    perguntaPromocoes, promoLoja, promoMarcada, setPromoMarcada,
    submitPedido, enviando, erroEnvio, setErroEnvio,
    // pós-pedido
    ped, agora, verificando, verificarPagamento, novoPedido,
  };
}

export type Cardapio = ReturnType<typeof useCardapio>;
