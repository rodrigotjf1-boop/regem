'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ListX, PauseCircle, Search, SlidersHorizontal, Users } from 'lucide-react';
import { api, getToken } from '@/lib/api';
import { rotuloSenha } from '@/lib/senha';
import { textosDasEscolhas } from '@/lib/adicionais';
import { buscarProdutos, centavos, chaveDoItem, notasSugeridas, valorDigitado } from '@/lib/balcao';
import { toast } from '@/lib/toast';
import { uuid } from '@/lib/uuid';
import { Shell } from '@/components/app-shell/shell';
import { Card } from '@/components/ui/card';
import { ServidorStatus } from '@/components/ui/servidor-status';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { InputMoeda } from '@/components/ui/input-moeda';
import { Dialogo } from '@/components/ui/sobreposto';
import { CaixaPanel } from '@/components/pdv/caixa-panel';
import { AcertosSalao } from '@/components/pdv/acertos-salao';
import { TerminalGate } from '@/components/pdv/terminal-gate';
import { BuscarCupom } from '@/components/pdv/buscar-cupom';
import { DividirConta, type PagamentoDaVenda } from '@/components/pdv/balcao/dividir-conta';
import { EditorDoItem, type EscolhaDoItem } from '@/components/pdv/balcao/editor-do-item';
import { LinhaDoPedido, type ItemDoPedido } from '@/components/pdv/balcao/linha-do-pedido';

/* eslint-disable @typescript-eslint/no-explicit-any */
const brl = (n: number) =>
  Number(n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const itensTxt = (n: number) => `${n} ${n === 1 ? 'item' : 'itens'}`;

// Pedido guardado ("em espera"): o atendente atende o próximo e volta a este depois. Vive só na
// tela — recarregar a página perde os pedidos guardados, como já perdia o pedido em andamento.
type PedidoGuardado = { id: string; carrinho: ItemDoPedido[]; taxa: boolean; naMesa: boolean; mesa: string; viagem: boolean; chave: string | null };
// Janela de escolhas aberta: produto novo, ou a linha `editando` do pedido.
type Seletor = { produto: any; variacoes: any[]; complementos: any[]; editando?: ItemDoPedido };

// Balcão (modelo novo, 09/10/2026 — mockups/regem-balcao.html): cardápio com busca à esquerda e o
// pedido à direita, numa tela só, sem topbar (Shell `fill`), pensada para ficar aberta o expediente
// todo. A lista de itens ocupa a altura que sobrar; valores e formas de pagamento ficam compactos.
export default function PdvPage() {
  const router = useRouter();
  const [produtos, setProdutos] = useState<any[]>([]);
  const [carregado, setCarregado] = useState(false);
  const [categorias, setCategorias] = useState<any[]>([]);
  const [catAtiva, setCatAtiva] = useState('');
  const [busca, setBusca] = useState('');
  // Ordem PESSOAL das categorias no PDV (por usuário, salva em uiPrefs.pdvOrdemCategorias).
  // NÃO altera o catálogo. `organizando` liga o modo arrastar; `dragCat` = índice arrastado.
  const [ordemPdv, setOrdemPdv] = useState<string[]>([]);
  const [organizando, setOrganizando] = useState(false);
  const [dragCat, setDragCat] = useState<number | null>(null);
  const [carrinho, setCarrinho] = useState<ItemDoPedido[]>([]);
  const [destaque, setDestaque] = useState<string | null>(null); // linha que acabou de entrar/mudar
  const [taxa, setTaxa] = useState(false);
  const [formas, setFormas] = useState<any[]>([]); // formas de pagamento (cadastro)
  const [formaId, setFormaId] = useState(''); // forma selecionada (pgto único)
  const [dividindo, setDividindo] = useState(false); // janela "Dividir conta"
  const [seletor, setSeletor] = useState<Seletor | null>(null);
  const [comprovante, setComprovante] = useState<any>(null);
  const [erro, setErro] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [tefAtivo, setTefAtivo] = useState(false);
  const [tefStatus, setTefStatus] = useState<string | null>(null); // aguardando maquininha
  const [caixa, setCaixa] = useState<any>(null); // caixa/turno aberto (ou null)
  const [recebido, setRecebido] = useState(''); // valor recebido (troco em dinheiro)
  const [encomendaAtiva, setEncomendaAtiva] = useState(false); // agendar excedente de atacado
  const [encomendaData, setEncomendaData] = useState(''); // data combinada (YYYY-MM-DD)
  const [previewEnc, setPreviewEnc] = useState<any[] | null>(null); // split por item (preview)
  // Mesa na venda do balcão: só com o módulo "Mesas e comandas" ligado na loja (a trava é do
  // servidor; aqui a opção nem aparece). Enquanto a resposta não chega, fica escondida.
  const [mesasAtivo, setMesasAtivo] = useState(false);
  const [naMesa, setNaMesa] = useState(false);
  const [mesa, setMesa] = useState('');
  // Para viagem: a marca vai na venda e a cozinha a vê no cartão e no alto da via (mig 310).
  const [viagem, setViagem] = useState(false);
  const [espera, setEspera] = useState<PedidoGuardado[]>([]);
  const [descartando, setDescartando] = useState(false);
  const buscaRef = useRef<HTMLInputElement>(null);
  const mesaRef = useRef<HTMLInputElement>(null);

  const reloadCaixa = useCallback(async () => {
    const cx: any = await api.caixaAberta().catch(() => null);
    setCaixa(cx?.id ? cx : null);
  }, []);
  const chaveRef = useRef<string | null>(null); // chave idempotente da venda atual

  const reload = useCallback(async () => {
    try {
      const [ps, cs, tc, cx, fp, pr, mods] = await Promise.all([
        api.produtos(),
        api.produtoCategorias(),
        api.tefConfig().catch(() => ({ ativo: false })),
        api.caixaAberta().catch(() => null),
        api.formasPagamento().catch(() => []),
        api.getPrefs().catch(() => ({})),
        api.modulosMeus().catch(() => null),
      ]);
      setOrdemPdv(Array.isArray((pr as any)?.pdvOrdemCategorias) ? (pr as any).pdvOrdemCategorias : []);
      // PDV = canal balcão: só produtos ativos e marcados para o balcão.
      setProdutos(
        ps.filter(
          (p: any) => p.ativo !== false && p.disponivelBalcao !== false,
        ),
      );
      setCategorias(cs);
      setTefAtivo(!!(tc as any).ativo);
      setCaixa((cx as any)?.id ? cx : null);
      const ativas = (fp as any[]).filter((f) => f.ativo);
      setFormas(ativas);
      setFormaId((id) => id || ativas[0]?.id || '');
      // Sem resposta dos módulos (rede), a mesa fica escondida. Servidor que ainda não conhece o
      // módulo (loja antes da atualização) não manda a chave — e lá a mesa segue valendo.
      setMesasAtivo(!!mods && (mods as any).mesas !== false);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao carregar');
    } finally {
      setCarregado(true);
    }
  }, []);

  useEffect(() => {
    if (!getToken()) {
      router.replace('/entrar');
      return;
    }
    reload();
  }, [reload, router]);

  // Marca a linha por um instante (o item que entrou pode estar fora da vista: rola até ele).
  const marcar = useCallback((key: string) => {
    setDestaque(key);
    setTimeout(() => {
      document.querySelector(`[data-linha="${CSS.escape(key)}"]`)?.scrollIntoView({ block: 'nearest' });
    }, 0);
    setTimeout(() => setDestaque((d) => (d === key ? null : d)), 900);
  }, []);

  // Põe o item no pedido; linha igual (mesmo produto, tamanho, escolhas e observação) soma.
  function addItem(item: Omit<ItemDoPedido, 'key' | 'qtd'>, qtd = 1) {
    const key = chaveDoItem(item);
    setCarrinho((c) => (c.some((i) => i.key === key) ? c.map((i) => (i.key === key ? { ...i, qtd: i.qtd + qtd } : i)) : [...c, { ...item, key, qtd }]));
    marcar(key);
  }

  async function tap(p: any) {
    // Busca variações + complementos; abre o seletor só se houver o que escolher.
    let full: any = p;
    try {
      full = await api.produto(p.id);
    } catch {
      /* usa o resumo */
    }
    const variacoes = full.variacoes ?? [];
    const complementos = full.complementos ?? [];
    // Produto simples (sem variação/complemento) entra em 1 toque — balcão rápido.
    if (variacoes.length === 0 && complementos.length === 0) {
      addItem({ produtoId: p.id, variacaoId: undefined, complementos: [], observacao: undefined, nome: p.nome, escolhas: [], preco: Number(p.precoVenda) });
      return;
    }
    setSeletor({ produto: p, variacoes, complementos });
  }

  // Abre uma linha do pedido para mudar tamanho, escolhas, observação ou quantidade.
  async function editar(item: ItemDoPedido) {
    const resumo = produtos.find((p) => p.id === item.produtoId) ?? { id: item.produtoId, nome: item.nome, precoVenda: item.preco };
    let full: any = resumo;
    try {
      full = await api.produto(item.produtoId);
    } catch {
      /* sem o detalhe, a janela ainda deixa mudar observação e quantidade */
    }
    setSeletor({ produto: resumo, variacoes: full.variacoes ?? [], complementos: full.complementos ?? [], editando: item });
  }

  function mudarQtd(key: string, d: number) {
    setCarrinho((c) => c.map((i) => (i.key === key ? { ...i, qtd: Math.max(1, i.qtd + d) } : i)));
  }
  function tirar(item: ItemDoPedido) {
    setCarrinho((c) => c.filter((i) => i.key !== item.key));
    toast.success(`${item.nome} saiu do pedido.`);
  }

  // Confirma a janela de escolhas (variação + opcionais/adicionais + observação) → pedido.
  function confirmarSeletor(e: EscolhaDoItem) {
    if (!seletor) return;
    const { produto, variacoes, complementos, editando } = seletor;
    const v = variacoes.find((x: any) => x.id === e.variacaoId);
    let preco = v ? Number(v.precoVenda) : Number(produto.precoVenda);
    const nome = v ? `${produto.nome} · ${v.nome}` : produto.nome;
    const todasOpcoes = (complementos as any[]).flatMap((g) =>
      (g.opcoes ?? []).map((o: any) => ({ ...o, tipo: g.tipo })),
    );
    for (const id of e.complementos) {
      const o = todasOpcoes.find((x) => x.id === id);
      if (o) preco += Number(o.precoDelta) || 0; // opção repetida soma uma vez por escolha
    }
    const item = {
      produtoId: produto.id,
      variacaoId: e.variacaoId,
      complementos: e.complementos,
      observacao: e.observacao,
      nome,
      escolhas: textosDasEscolhas(e.complementos, todasOpcoes), // "+ 2x Bacon"
      preco,
    };
    setSeletor(null);
    if (!editando) return addItem(item, e.qtd);
    // Editar: a linha muda no lugar; se ficou igual a outra, as duas viram uma.
    const key = chaveDoItem(item);
    setCarrinho((c) => {
      const outra = c.find((i) => i.key === key && i.key !== editando.key);
      if (outra) return c.filter((i) => i.key !== editando.key).map((i) => (i.key === key ? { ...i, qtd: i.qtd + e.qtd } : i));
      return c.map((i) => (i.key === editando.key ? { ...item, key, qtd: e.qtd } : i));
    });
    marcar(key);
  }

  const subtotal = carrinho.reduce((s, i) => s + i.preco * i.qtd, 0);
  const total = subtotal * (taxa ? 1.1 : 1);
  const pecas = carrinho.reduce((s, i) => s + i.qtd, 0);
  const formaSel = formas.find((f) => f.id === formaId);
  const ehDinheiro = formaSel?.tipo === 'dinheiro';
  const valorRecebido = recebido === '' ? null : valorDigitado(recebido);
  const troco = valorRecebido == null ? 0 : valorRecebido - Number(total.toFixed(2));
  const mesaInformada = naMesa && mesasAtivo ? mesa.trim() : '';

  // O que impede de cobrar — antes de escolher a forma (vale também para "Dividir conta").
  const motivoBase = !caixa
    ? 'Abra o caixa para vender'
    : carrinho.length === 0
      ? 'Adicione itens para receber'
      : naMesa && mesasAtivo && !mesaInformada
        ? 'Informe o número da mesa'
        : '';
  const motivo =
    motivoBase ||
    (!formaSel ? (formas.length ? 'Escolha a forma de pagamento' : 'Cadastre formas de pagamento em Financeiro') : '') ||
    (ehDinheiro && valorRecebido != null && centavos(valorRecebido) < centavos(total) ? 'O recebido é menor que o total' : '');

  // Cobrança TEF na maquininha (pré-venda): cria a cobrança e aguarda o agente do
  // edge/pinpad. Devolve o pagamento aprovado, ou null se negado/cancelado.
  async function cobrarTef(): Promise<any | null> {
    const pag: any = await api.tefCriar({
      valor: total,
      forma: formaSel?.tipo === 'pix' ? 'pix' : 'credito',
    });
    setTefStatus('aguardando');
    for (let i = 0; i < 120; i++) {
      // ~4min: aguarda o cliente inserir/aproximar o cartão
      await new Promise((r) => setTimeout(r, 2000));
      const at: any = await api.tefGet(pag.id).catch(() => null);
      if (at && at.status !== 'pendente') {
        setTefStatus(null);
        if (at.status === 'aprovado') return at;
        toast.error(`Pagamento ${at.status}${at.mensagem ? ` · ${at.mensagem}` : ''}`);
        return null;
      }
    }
    setTefStatus(null);
    await api.tefCancelar(pag.id).catch(() => {});
    toast.error('Tempo esgotado na maquininha.');
    return null;
  }

  function limparPedido() {
    setCarrinho([]);
    setTaxa(false);
    setRecebido('');
    setNaMesa(false);
    setMesa('');
    setViagem(false);
    setEncomendaAtiva(false);
    setEncomendaData('');
    setPreviewEnc(null);
    chaveRef.current = null;
  }

  // Sempre via `pagamentos` (uma forma ou várias) — o servidor já recebia a lista.
  async function enviarVenda(pagamentos: PagamentoDaVenda[], tefPagId?: string) {
    if (!chaveRef.current) chaveRef.current = uuid();
    const r: any = await api.vendaBalcao({
      itens: carrinho.map((i) => ({
        produtoId: i.produtoId,
        variacaoId: i.variacaoId,
        complementos: i.complementos,
        observacao: i.observacao,
        quantidade: i.qtd,
      })),
      pagamentos,
      taxaServicoPct: taxa ? 10 : 0,
      mesa: mesaInformada || undefined,
      consumo: viagem ? 'viagem' : undefined,
      idempotencyKey: chaveRef.current,
      // Atacado: agenda o excedente que passar do estoque como encomenda.
      encomendaDataEntrega: encomendaAtiva && encomendaData ? encomendaData : undefined,
    });
    if (tefPagId && r?.comandaId) await api.tefVincular(tefPagId, r.comandaId).catch(() => {});
    setComprovante({ ...r, mesaInformada, viagem, trocoInformado: ehDinheiro && pagamentos.length === 1 && troco > 0 ? troco : 0 });
    setDividindo(false);
    limparPedido();
    if (r?.encomendas?.length)
      toast.success(`Venda registrada. ${r.encomendas.length} encomenda(s) agendada(s).`);
    else toast.success(r?.idempotente ? 'Venda já registrada.' : 'Venda registrada.');
  }

  // Recebe: sem argumento, a forma única escolhida na tela; com `pagamentos`, a conta dividida.
  async function finalizar(pagamentos?: PagamentoDaVenda[]) {
    const impede = pagamentos ? motivoBase : motivo;
    if (impede) {
      toast.error(impede);
      return;
    }
    if (enviando) return;
    setErro('');
    setEnviando(true);
    try {
      // TEF (só pagamento único por cartão/pix): cobra na maquininha antes.
      const tipoTef = formaSel?.tipo;
      if (!pagamentos && tefAtivo && (tipoTef === 'credito' || tipoTef === 'debito' || tipoTef === 'pix')) {
        const pago = await cobrarTef();
        if (!pago) return; // negado/cancelado → não finaliza a venda
        await enviarVenda([{ forma: formaSel.nome, valor: Number(total.toFixed(2)), formaPagamentoId: formaSel.id }], pago.id);
      } else {
        await enviarVenda(pagamentos ?? [{ forma: formaSel.nome, valor: Number(total.toFixed(2)), formaPagamentoId: formaSel.id }]);
      }
    } catch (e) {
      const m = e instanceof Error ? e.message : 'Erro ao finalizar';
      setErro(m);
      toast.error(m);
    } finally {
      setEnviando(false);
      setTefStatus(null);
    }
  }

  // Fecha o comprovante e deixa a tela pronta para o próximo cliente: cursor na busca. (O diálogo
  // devolve o foco a quem o abriu — aqui, o botão de receber —, por isso o foco vai depois dele.)
  function novaVenda() {
    setComprovante(null);
    setTimeout(() => buscaRef.current?.focus(), 0);
  }

  // ── pedidos em espera ──
  const guardado = (): PedidoGuardado => ({ id: uuid(), carrinho, taxa, naMesa, mesa, viagem, chave: chaveRef.current });
  function emEspera() {
    if (carrinho.length === 0) {
      toast.error('Este pedido está vazio: não há o que guardar.');
      return;
    }
    setEspera((e) => [...e, guardado()]);
    limparPedido();
    toast.success('Pedido guardado. Para voltar a ele, toque em “Em espera” no alto do pedido.');
    buscaRef.current?.focus();
  }
  function voltarAo(p: PedidoGuardado) {
    // O pedido em andamento (se tiver itens) troca de lugar com o guardado.
    const atual = carrinho.length ? guardado() : null;
    setEspera((e) => [...e.filter((x) => x.id !== p.id), ...(atual ? [atual] : [])]);
    setCarrinho(p.carrinho);
    setTaxa(p.taxa);
    setNaMesa(p.naMesa);
    setMesa(p.mesa);
    setViagem(!!p.viagem);
    setRecebido('');
    setEncomendaAtiva(false);
    setEncomendaData('');
    setPreviewEnc(null);
    chaveRef.current = p.chave;
  }

  // Preview do split de atacado (imediato/encomenda) enquanto a encomenda está
  // ligada: mostra ao operador o que será agendado antes de finalizar.
  useEffect(() => {
    if (!encomendaAtiva || carrinho.length === 0) {
      setPreviewEnc(null);
      return;
    }
    let cancel = false;
    (async () => {
      try {
        const itens = carrinho.map((i) => ({ produtoId: i.produtoId, quantidade: i.qtd }));
        const r: any = await api.previewAtacado(itens);
        if (!cancel) setPreviewEnc(Array.isArray(r) ? r.filter((x: any) => x.encomenda > 0) : []);
      } catch {
        if (!cancel) setPreviewEnc(null);
      }
    })();
    return () => {
      cancel = true;
    };
  }, [encomendaAtiva, carrinho]);

  // Atalhos: F2 busca · F8 guarda o pedido · F9 recebe. Digitar de qualquer lugar da tela cai na
  // busca. Com uma janela aberta (escolhas, dividir, cupom, caixa) os atalhos ficam com ela.
  const acoes = useRef({ finalizar, emEspera });
  acoes.current = { finalizar, emEspera };
  useEffect(() => {
    const tecla = (ev: KeyboardEvent) => {
      if (document.querySelector('[role="dialog"]')) return;
      if (ev.key === 'F2') {
        ev.preventDefault();
        buscaRef.current?.focus();
        buscaRef.current?.select();
      } else if (ev.key === 'F8') {
        ev.preventDefault();
        acoes.current.emEspera();
      } else if (ev.key === 'F9') {
        ev.preventDefault();
        acoes.current.finalizar();
      } else if (!ev.ctrlKey && !ev.altKey && !ev.metaKey && ev.key.length === 1 && /[\p{L}\p{N}]/u.test(ev.key)) {
        const alvo = ev.target as HTMLElement | null;
        if (alvo && (/^(INPUT|TEXTAREA|SELECT)$/.test(alvo.tagName) || alvo.isContentEditable)) return;
        buscaRef.current?.focus();
      }
    };
    document.addEventListener('keydown', tecla);
    return () => document.removeEventListener('keydown', tecla);
  }, []);

  // Categorias de topo na ORDEM PESSOAL do usuário (ordemPdv). As que não estão na
  // lista salva vão para o fim, preservando a ordem do catálogo. Não altera o catálogo.
  const catsTop = (() => {
    const top = categorias.filter((c: any) => !c.parentId);
    if (!ordemPdv.length) return top;
    const pos = new Map(ordemPdv.map((id, i) => [id, i]));
    return [...top].sort((a: any, b: any) => (pos.has(a.id) ? (pos.get(a.id) as number) : 1e9) - (pos.has(b.id) ? (pos.get(b.id) as number) : 1e9));
  })();

  // Arrastar-e-soltar: reordena as categorias e SALVA no perfil do usuário (uiPrefs).
  async function soltarCat(destino: number) {
    if (dragCat === null || dragCat === destino) { setDragCat(null); return; }
    const nova = [...catsTop];
    const [item] = nova.splice(dragCat, 1);
    nova.splice(destino, 0, item);
    setDragCat(null);
    const ids = nova.map((c: any) => c.id);
    setOrdemPdv(ids); // aplica na hora
    try {
      await api.patchPrefs({ pdvOrdemCategorias: ids });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro ao salvar a ordem');
    }
  }

  // Com texto na busca, o resultado vale para o cardápio inteiro (a categoria deixa de filtrar).
  const textoBusca = busca.trim();
  const achados = textoBusca ? buscarProdutos(produtos, textoBusca) : null;
  const visiveis = catAtiva
    ? produtos.filter((p) => p.categoriaId === catAtiva)
    : produtos;

  // Agrupa por categoria (com cabeçalho), preservando a ordem dos produtos.
  const grupos = (() => {
    if (achados) return [{ nome: `Resultado da busca`, itens: achados }];
    const nomePorId = new Map(categorias.map((c: any) => [c.id, c.nome]));
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
  const noPedido = new Map<string, number>();
  for (const i of carrinho) noPedido.set(i.produtoId, (noPedido.get(i.produtoId) ?? 0) + i.qtd);

  function teclaNaBusca(ev: React.KeyboardEvent<HTMLInputElement>) {
    if (ev.key === 'Escape' && busca) {
      ev.stopPropagation();
      setBusca('');
      return;
    }
    if (ev.key !== 'Enter') return;
    ev.preventDefault();
    if (!textoBusca) return;
    const primeiro = achados?.[0];
    if (!primeiro) {
      toast.error(`Nada encontrado para “${textoBusca}”.`);
      return;
    }
    setBusca('');
    tap(primeiro);
  }

  const pilula = (ligado: boolean) =>
    `min-h-10 rounded-full border px-3 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${ligado ? 'border-primary bg-primary/15 text-foreground' : 'border-border bg-card text-muted-foreground hover:text-foreground'}`;
  const gradeDeProdutos = 'grid grid-cols-[repeat(auto-fill,minmax(8.75rem,1fr))] gap-2';

  return (
    <Shell fill>
      {/* No celular o Shell `fill` põe o botão do menu flutuando no canto: este espaço evita que ele
          cubra a faixa do terminal e o título (o botão some de 860 px para cima). */}
      <div className="h-10 min-[860px]:hidden" aria-hidden="true" />
      <TerminalGate>
      {/* Abaixo de lg a tela vira uma coluna só e rola inteira; de lg para cima são dois painéis,
          cada um com a sua rolagem (o `main` do Shell fill não rola). */}
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto lg:overflow-hidden">
        {/* Faixa do topo: título, caixa/turno, servidor e busca de cupom */}
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="font-display text-lg font-bold">Balcão</h1>
          {carregado && <CaixaPanel caixa={caixa} onChange={reloadCaixa} embedded />}
          <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
            <ServidorStatus />
            <BuscarCupom />
          </div>
        </div>
        {/* A receber do salão (mig 143): some sozinho quando não há pendência. Sem o módulo
            "Mesas e comandas" não há salão — nem se consulta. */}
        {mesasAtivo && <AcertosSalao />}
        {erro && <p className="text-sm text-destructive">{erro}</p>}

        <div className="grid grid-cols-1 gap-3 lg:min-h-0 lg:flex-1 lg:grid-cols-[minmax(0,1fr)_23.5rem] lg:grid-rows-[minmax(0,1fr)] xl:grid-cols-[minmax(0,1fr)_27.5rem]">
          {/* Cardápio */}
          <section aria-label="Cardápio" className="flex min-w-0 flex-col gap-2 lg:min-h-0">
            <label className="flex h-12 items-center gap-2 rounded-xl border border-input bg-card px-3 text-muted-foreground focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/30">
              <Search className="h-5 w-5 flex-none" aria-hidden="true" />
              <input
                id="busca-balcao"
                ref={buscaRef}
                type="search"
                autoComplete="off"
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                onKeyDown={teclaNaBusca}
                placeholder="Buscar por nome ou código"
                aria-label="Buscar produto por nome ou código; Enter adiciona o primeiro resultado"
                className="h-full min-w-0 flex-1 bg-transparent text-base text-foreground outline-none placeholder:text-muted-foreground [&::-webkit-search-cancel-button]:hidden"
              />
              <kbd className="rounded border border-border bg-secondary px-1.5 py-0.5 font-mono text-[11px] font-semibold">F2</kbd>
            </label>
            <div className="flex flex-wrap gap-1.5">
              <button type="button" aria-pressed={!catAtiva && !achados} onClick={() => { setCatAtiva(''); setBusca(''); }} className={pilula(!catAtiva && !achados)}>
                Todos
              </button>
              {catsTop.map((c, i) => (
                <button
                  key={c.id}
                  type="button"
                  aria-pressed={catAtiva === c.id && !achados}
                  draggable={organizando}
                  onDragStart={organizando ? () => setDragCat(i) : undefined}
                  onDragOver={organizando ? (e) => e.preventDefault() : undefined}
                  onDrop={organizando ? () => soltarCat(i) : undefined}
                  onClick={() => { if (!organizando) { setCatAtiva(c.id); setBusca(''); } }}
                  className={`${pilula(catAtiva === c.id && !achados)} ${organizando ? 'cursor-grab' : ''} ${dragCat === i ? 'opacity-50' : ''}`}
                >
                  {organizando && <span className="mr-1 text-muted-foreground" aria-hidden>⠿</span>}{c.nome}
                </button>
              ))}
              {/* Organizar: reordenar as categorias arrastando — a ordem é PESSOAL (por usuário),
                  não altera o catálogo. Salva em uiPrefs.pdvOrdemCategorias. */}
              <button
                type="button"
                onClick={() => setOrganizando((v) => !v)}
                aria-pressed={organizando}
                title="Reordene as categorias arrastando — a ordem é só sua (não muda o catálogo)."
                className={`ml-auto ${pilula(organizando)} text-xs`}
              >
                {organizando ? '✓ Concluir' : '↕ Organizar'}
              </button>
            </div>

            <div className="space-y-3 lg:min-h-0 lg:flex-1 lg:overflow-y-auto lg:pr-1">
              {!carregado && (
                <div className={gradeDeProdutos}>
                  {Array.from({ length: 10 }).map((_, i) => (
                    <div key={i} className="min-h-[5.5rem] rounded-xl border border-border bg-card p-3">
                      <Skeleton className="h-4 w-3/4" />
                      <Skeleton className="mt-3 h-4 w-1/3" />
                    </div>
                  ))}
                </div>
              )}
              {carregado && produtos.length === 0 && (
                <Card className="p-8 text-center text-sm text-muted-foreground">
                  Nenhum produto. Cadastre em Cadastros → Produtos & Catálogo.
                </Card>
              )}
              {carregado && achados && achados.length === 0 && (
                <Card className="p-8 text-center text-sm text-muted-foreground">
                  <b className="block text-base text-foreground">Nada encontrado para “{textoBusca}”</b>
                  Confira o nome ou o código do produto.
                </Card>
              )}
              {carregado && grupos.map((g) => g.itens.length > 0 && (
                <section key={g.nome} className="space-y-2">
                  <h3 className="font-display text-xs font-bold uppercase tracking-[.12em] text-muted-foreground">
                    {g.nome} <span className="font-mono font-normal">· {g.itens.length}</span>
                  </h3>
                  <div className={gradeDeProdutos}>
                    {g.itens.map((p) => {
                      const qtd = noPedido.get(p.id) ?? 0;
                      return (
                        <button
                          key={p.id}
                          type="button"
                          data-produto={p.id}
                          onClick={() => tap(p)}
                          aria-label={`${p.nome}, ${brl(Number(p.precoVenda))}${qtd ? `, ${qtd} no pedido` : ''}`}
                          className="relative flex min-h-[5.5rem] flex-col gap-1 rounded-xl border border-border bg-card p-2.5 text-left transition hover:border-primary hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-[.98]"
                        >
                          <span className="flex items-start gap-2">
                            {p.imagemRef && (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={p.imagemRef} alt="" className="h-10 w-10 flex-none rounded-lg object-cover" />
                            )}
                            <span className="min-w-0 flex-1">
                              {p.codigo && <span className="block font-mono text-[11px] leading-tight text-muted-foreground">{p.codigo}</span>}
                              <span className={`line-clamp-2 break-words text-sm font-bold leading-tight ${qtd ? 'pr-6' : ''}`}>{p.nome}</span>
                            </span>
                          </span>
                          <span className="mt-auto flex items-end justify-between gap-2">
                            <span className="font-mono text-sm font-bold leading-tight">
                              {p.tipo === 'variavel' && <span className="block font-sans text-[10.5px] font-medium text-muted-foreground">a partir de</span>}
                              {brl(Number(p.precoVenda))}
                            </span>
                            {p.tipo === 'variavel' && (
                              <span title="Tem tamanhos para escolher" className="grid h-6 w-6 flex-none place-items-center rounded-md border border-border bg-secondary text-muted-foreground">
                                <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
                              </span>
                            )}
                          </span>
                          {qtd > 0 && (
                            <span className="absolute right-1.5 top-1.5 grid h-6 min-w-6 place-items-center rounded-full bg-primary px-1.5 font-mono text-xs font-bold text-primary-foreground">{qtd}</span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </section>
              ))}
            </div>
          </section>

          {/* Pedido: a lista ocupa a altura que sobrar; valores e pagamento ficam compactos embaixo */}
          <Card id="pedido-balcao" aria-label="Pedido" className="flex min-w-0 flex-col gap-2 p-3 lg:min-h-0">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <h2 className="font-display text-lg font-bold">Pedido</h2>
              {mesasAtivo && (
                <>
                  <button
                    type="button"
                    aria-pressed={naMesa}
                    onClick={() => { const liga = !naMesa; setNaMesa(liga); if (liga) { setViagem(false); setTimeout(() => mesaRef.current?.focus(), 0); } }}
                    title="Com mesa, o pedido sai com o número da mesa no lugar da senha."
                    className={`${pilula(naMesa)} !min-h-9 text-xs`}
                  >
                    Mesa
                  </button>
                  {naMesa && (
                    <input
                      ref={mesaRef}
                      type="text"
                      inputMode="numeric"
                      maxLength={4}
                      value={mesa}
                      onChange={(e) => setMesa(e.target.value.replace(/\D/g, '').slice(0, 4))}
                      placeholder="nº"
                      aria-label="Número da mesa"
                      className="h-9 w-12 rounded-md border border-input bg-card text-center font-mono text-base font-bold"
                    />
                  )}
                </>
              )}
              <button
                type="button"
                aria-pressed={viagem}
                onClick={() => { const liga = !viagem; setViagem(liga); if (liga) setNaMesa(false); }}
                title="Para viagem: a cozinha vê a marca no cartão e no alto da via impressa."
                className={`${pilula(viagem)} !min-h-9 text-xs`}
              >
                Viagem
              </button>
              <span className="ml-auto flex items-center gap-1">
                <Button type="button" variant="outline" size="sm" className="h-9 px-2.5" onClick={emEspera} disabled={carrinho.length === 0} title="Guardar este pedido e atender o próximo (F8)">
                  <PauseCircle className="h-4 w-4" aria-hidden="true" />
                  Em espera
                </Button>
                {carrinho.length > 0 && (
                  <Button type="button" variant="ghost" size="sm" className="h-9 w-9 px-0 text-destructive" onClick={() => setDescartando(true)} aria-label="Descartar o pedido" title="Descartar o pedido">
                    <ListX className="h-5 w-5" aria-hidden="true" />
                  </Button>
                )}
              </span>
            </div>

            {espera.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5" data-teste="em-espera">
                <span className="text-xs text-muted-foreground">Em espera</span>
                {espera.map((p) => {
                  const t = p.carrinho.reduce((s, i) => s + i.preco * i.qtd, 0) * (p.taxa ? 1.1 : 1);
                  const n = p.carrinho.reduce((s, i) => s + i.qtd, 0);
                  return (
                    <button key={p.id} type="button" onClick={() => voltarAo(p)} title="Voltar para este pedido" className="min-h-9 rounded-full border border-border bg-card px-3 text-xs font-semibold hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                      {p.naMesa && p.mesa ? `Mesa ${p.mesa}` : p.viagem ? 'Viagem' : 'Balcão'} · {itensTxt(n)} · <span className="font-mono">{brl(t)}</span>
                    </button>
                  );
                })}
              </div>
            )}

            {/* A lista leva a altura livre do cartão e rola por dentro (de lg para cima). */}
            <ul aria-label="Itens do pedido" className="-mx-1 border-y border-border px-1 lg:min-h-[7rem] lg:flex-1 lg:overflow-y-auto">
              {carrinho.length === 0 && (
                <li className="py-10 text-center text-sm text-muted-foreground">
                  <b className="block text-base text-foreground">Nenhum item ainda</b>
                  Toque num produto, ou digite o nome e aperte Enter.
                </li>
              )}
              {carrinho.map((i) => (
                <LinhaDoPedido key={i.key} item={i} destaque={destaque === i.key} onQtd={(d) => mudarQtd(i.key, d)} onEditar={() => editar(i)} onTirar={() => tirar(i)} />
              ))}
            </ul>

            <div className="shrink-0 space-y-2">
              <div className="flex flex-wrap items-center gap-x-4">
                <label className="flex min-h-9 items-center gap-2 text-sm">
                  <input type="checkbox" checked={taxa} onChange={(e) => setTaxa(e.target.checked)} className="h-4 w-4 accent-primary" />
                  Taxa de serviço 10%
                </label>
                {carrinho.length > 0 && (
                  <label className="flex min-h-9 items-center gap-2 text-sm" title="Atacado: o que passar do estoque vira encomenda para a data combinada.">
                    <input type="checkbox" checked={encomendaAtiva} onChange={(e) => setEncomendaAtiva(e.target.checked)} className="h-4 w-4 accent-primary" />
                    Encomendar o que faltar
                  </label>
                )}
              </div>
              {encomendaAtiva && carrinho.length > 0 && (
                <div className="rounded-md border border-border bg-muted/40 p-2 text-xs">
                  <label className="block">
                    <span className="text-muted-foreground">Data de entrega/retirada</span>
                    <input
                      type="date"
                      value={encomendaData}
                      min={new Date().toISOString().slice(0, 10)}
                      onChange={(e) => setEncomendaData(e.target.value)}
                      className="mt-1 h-9 w-full rounded-md border border-input bg-card px-2 text-sm"
                    />
                  </label>
                  {previewEnc && previewEnc.length > 0 ? (
                    <ul className="mt-2 space-y-1">
                      {previewEnc.map((x: any) => (
                        <li key={x.produtoId} className="flex justify-between gap-2">
                          <span className="truncate">{x.nome}</span>
                          <span className="whitespace-nowrap font-mono">
                            {x.imediato} agora
                            {x.podeEncomendar ? ` · ${x.encomenda} encomenda` : ` · ${x.encomenda} sem ficha`}
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : previewEnc && previewEnc.length === 0 ? (
                    <p className="mt-2 text-muted-foreground">Estoque cobre tudo — nada a encomendar.</p>
                  ) : null}
                  <p className="mt-2 text-[11px] text-muted-foreground">
                    O disponível sai no ato; o excedente vira ordem de produção para a data. Só vale para produtos de atacado com ficha técnica.
                  </p>
                </div>
              )}

              <div role="group" aria-label="Forma de pagamento" className="flex flex-wrap gap-1.5">
                {formas.map((f) => (
                  <button key={f.id} type="button" aria-pressed={formaId === f.id} onClick={() => setFormaId(f.id)} className={`min-h-10 flex-[1_1_5rem] rounded-md border px-1.5 text-[13px] font-semibold leading-tight focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${formaId === f.id ? 'border-primary bg-primary/15 text-foreground' : 'border-border bg-card hover:bg-secondary'}`}>
                    {f.nome}
                  </button>
                ))}
                {formas.length === 0 && <span className="text-xs text-muted-foreground">Cadastre formas em Financeiro.</span>}
                <button
                  type="button"
                  onClick={() => (motivoBase ? toast.error(motivoBase) : setDividindo(true))}
                  className="flex min-h-10 flex-[1_1_5rem] items-center justify-center gap-1.5 rounded-md border border-dashed border-border bg-card px-1.5 text-[13px] font-semibold leading-tight hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <Users className="h-4 w-4" aria-hidden="true" />
                  Dividir conta
                </button>
              </div>

              {ehDinheiro && carrinho.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5">
                  <InputMoeda ariaLabel="Valor recebido em dinheiro" value={recebido} onChange={setRecebido} placeholder="recebido" className="w-28" />
                  {notasSugeridas(Number(total.toFixed(2))).slice(0, 3).map((nota) => (
                    <button key={nota} type="button" onClick={() => setRecebido(nota.toFixed(2))} className="min-h-10 rounded-full border border-border bg-card px-2 font-mono text-xs font-semibold hover:bg-secondary">
                      {brl(nota)}
                    </button>
                  ))}
                </div>
              )}

              <div className="flex items-stretch gap-3 border-t border-border pt-2">
                <div className="flex flex-none flex-col justify-center">
                  <span className="text-xs font-semibold text-muted-foreground">Total{carrinho.length > 0 ? ` · ${itensTxt(pecas)}` : ''}</span>
                  <span className="font-mono text-2xl font-bold leading-none" data-teste="total">{brl(total)}</span>
                  {ehDinheiro && valorRecebido != null && carrinho.length > 0 && (
                    <span className="mt-1 text-xs font-semibold" aria-live="polite" data-teste="troco">
                      {troco < 0 ? <>Faltam <b className="font-mono text-destructive">{brl(-troco)}</b></> : <>Troco <b className="font-mono text-ok">{brl(troco)}</b></>}
                    </span>
                  )}
                </div>
                <Button type="button" size="lg" className={`h-auto min-h-12 min-w-0 flex-1 whitespace-normal px-3 text-center leading-tight ${motivo ? 'opacity-60' : ''}`} onClick={() => finalizar()} disabled={enviando} aria-disabled={!!motivo} data-teste="receber">
                  {enviando ? 'Finalizando…' : motivo || 'Receber'}
                  <kbd className="rounded border border-current px-1 font-mono text-[10px] opacity-70">F9</kbd>
                </Button>
              </div>
            </div>
          </Card>
        </div>
      </div>

      {seletor && (
        <EditorDoItem
          produto={seletor.produto}
          variacoes={seletor.variacoes}
          complementos={seletor.complementos}
          editando={!!seletor.editando}
          inicial={seletor.editando ? { variacaoId: seletor.editando.variacaoId, complementos: seletor.editando.complementos, observacao: seletor.editando.observacao, qtd: seletor.editando.qtd } : undefined}
          aoConfirmar={confirmarSeletor}
          aoTirar={seletor.editando ? () => { const it = seletor.editando!; setSeletor(null); tirar(it); } : undefined}
          aoFechar={() => setSeletor(null)}
        />
      )}

      {dividindo && (
        <DividirConta
          total={Number(total.toFixed(2))}
          servico={Number((total - subtotal).toFixed(2))}
          itens={carrinho.map((i) => ({ key: i.key, rotulo: `${i.qtd}× ${i.nome}`, valor: Number((i.preco * i.qtd).toFixed(2)) }))}
          formas={formas}
          enviando={enviando}
          aoReceber={(pags) => finalizar(pags)}
          aoFechar={() => setDividindo(false)}
        />
      )}

      {descartando && (
        <Dialogo
          titulo="Descartar este pedido?"
          aoFechar={() => setDescartando(false)}
          largura="sm"
          alerta
          voltarPara="busca-balcao"
          rodape={
            <>
              <Button type="button" variant="outline" onClick={() => setDescartando(false)}>Voltar</Button>
              <Button type="button" variant="destructive" onClick={() => { setDescartando(false); limparPedido(); }}>Descartar pedido</Button>
            </>
          }
        >
          <p className="text-sm text-muted-foreground">{itensTxt(pecas)} saem da tela. Nada foi cobrado.</p>
        </Dialogo>
      )}

      {/* Aguardando maquininha (TEF) */}
      {tefStatus && (
        <div className="fixed inset-0 z-[60] grid place-items-center bg-black/60 p-4">
          <Card className="w-full max-w-sm p-6 text-center">
            <p className="font-display text-lg font-bold">Aguardando pagamento</p>
            <p className="mt-2 text-sm text-muted-foreground">
              Peça ao cliente para inserir ou aproximar o cartão na maquininha.
            </p>
            <p className="mt-4 font-mono text-2xl font-bold">{brl(total)}</p>
            <p className="mt-3 animate-pulse text-xs uppercase tracking-wide text-foreground">
              processando…
            </p>
          </Card>
        </div>
      )}

      {/* Comprovante */}
      {comprovante && (
        <Dialogo
          titulo="Venda concluída"
          aoFechar={novaVenda}
          largura="sm"
          voltarPara="busca-balcao"
          rodape={<Button type="button" className="w-full" data-foco-inicial="" onClick={novaVenda}>Nova venda</Button>}
        >
          <div className="text-center">
            {comprovante.senha != null ? (
              <div className="rounded-xl border border-primary/50 bg-primary/10 py-3">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Senha</p>
                <p className="font-mono text-4xl font-bold">{rotuloSenha(comprovante.senha, comprovante.senhaPrefixo)}</p>
              </div>
            ) : comprovante.mesaInformada ? (
              <div className="rounded-xl border border-primary/50 bg-primary/10 py-3">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Mesa</p>
                <p className="font-mono text-4xl font-bold">{comprovante.mesaInformada}</p>
              </div>
            ) : null}
            {comprovante.viagem && <p className="mt-2 text-sm font-bold uppercase tracking-wide">Para viagem</p>}
            <p className="mt-3 font-mono text-3xl font-bold">{brl(comprovante.total)}</p>
            {comprovante.taxaServicoPct > 0 && (
              <p className="mt-1 text-xs text-muted-foreground">inclui {comprovante.taxaServicoPct}% de serviço</p>
            )}
            {comprovante.trocoInformado > 0 && (
              <p className="mt-1 text-sm font-semibold">Troco <span className="font-mono text-ok">{brl(comprovante.trocoInformado)}</span></p>
            )}
            {comprovante.nfce && (
              <p className="mt-2 text-xs text-muted-foreground">
                NFC-e {comprovante.nfce.numero} · {comprovante.nfce.status}
                {comprovante.nfce.chave && (
                  <span className="mt-0.5 block break-all font-mono text-[10px]">{comprovante.nfce.chave}</span>
                )}
              </p>
            )}
            {comprovante.encomendas?.length > 0 && (
              <div className="mt-3 rounded-lg border border-primary/50 bg-primary/5 p-2 text-left text-xs">
                <p className="font-semibold">📅 Encomendas agendadas</p>
                <ul className="mt-1 space-y-0.5">
                  {comprovante.encomendas.map((e: any, i: number) => (
                    <li key={i} className="flex justify-between gap-2">
                      <span className="truncate">{e.quantidade}× {e.descricao}</span>
                      <span className="whitespace-nowrap font-mono">{e.dataEntrega}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </Dialogo>
      )}
      </TerminalGate>
    </Shell>
  );
}
