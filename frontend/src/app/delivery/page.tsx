'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { api, getToken, getCategoria } from '@/lib/api';
import { toast } from '@/lib/toast';
import { Shell } from '@/components/app-shell/shell';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { CaixaPanel } from '@/components/pdv/caixa-panel';
import { PedidoDetalhe } from '@/components/delivery/pedido-detalhe';
import { NovoPedido } from '@/components/delivery/novo-pedido';
import { UnidadeSeletor } from '@/components/app-shell/unidade-seletor';
import { ModoOperacao } from '@/components/ui/modo-operacao';
import { Clock } from 'lucide-react';

/* eslint-disable @typescript-eslint/no-explicit-any */
const brl = (n: number) =>
  Number(n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const hora = (d?: string) =>
  d ? new Date(d).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '—';
const dataCurta = (d?: string) =>
  d ? new Date(d).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) : '';
const formaLabel = (f?: string | null) => {
  const s = String(f ?? '').trim();
  if (!s) return '';
  if (/dinheiro|cash|money|especie|espécie/i.test(s)) return 'Dinheiro';
  return s.charAt(0).toUpperCase() + s.slice(1);
};
const countdown = (ms: number) => {
  if (ms <= 0) return null;
  const s = Math.floor(ms / 1000);
  const p2 = (n: number) => String(n).padStart(2, '0');
  return `${p2(Math.floor(s / 3600))}:${p2(Math.floor((s % 3600) / 60))}:${p2(s % 60)}`;
};

const CANAL_LABEL: Record<string, string> = {
  ifood: 'iFood',
  cardapio: 'Cardápio',
  cardapio_web: 'Cardápio Web',
  anotaai: 'Anota Aí',
  keeta: 'Keeta',
  rappi: 'Rappi',
  '99food': '99Food',
  delivery_direto: 'Delivery Direto',
  totem: 'Totem',
  whatsapp: 'WhatsApp',
  manual: 'Manual',
};
const CANAL_ESTILO: Record<string, { bg: string; fg: string }> = {
  ifood: { bg: '#EA1D2C', fg: '#FFFFFF' },
  whatsapp: { bg: '#25D366', fg: '#0B241B' },
  totem: { bg: '#334155', fg: '#FFFFFF' },
  ubereats: { bg: '#06C167', fg: '#0B241B' },
  rappi: { bg: '#FF4E1B', fg: '#FFFFFF' },
  '99food': { bg: '#FFD400', fg: '#0B141B' },
};
const CANAL_LOGO: Record<string, string> = {
  ifood: '/integracoes/ifood.png',
  anotaai: '/integracoes/anotaai.png',
  '99food': '/integracoes/99food.png',
  cardapio_web: '/integracoes/cardapio-web.png',
  delivery_direto: '/integracoes/delivery-direto.png',
  rappi: '/integracoes/rappi.jpg',
  keeta: '/integracoes/keeta.png',
};

// Badge de status (cores vivas) usado nas listas.
const STATUS_VIVO: Record<string, { label: string; cls: string }> = {
  novo: { label: 'Em análise', cls: 'bg-sky-500 text-white' },
  confirmado: { label: 'Em produção', cls: 'bg-amber-500 text-white' },
  pronto: { label: 'Pronto', cls: 'bg-emerald-500 text-white' },
  despachado: { label: 'Em rota', cls: 'bg-indigo-500 text-white' },
  entregue: { label: 'Entregue · conferir', cls: 'bg-teal-500 text-white' },
  concluido: { label: 'Concluído', cls: 'bg-emerald-600 text-white' },
  cancelado: { label: 'Cancelado', cls: 'bg-red-500 text-white' },
};

// Pedidos "pendentes" (pré-despacho) e "em andamento" (em rota).
const ST_PENDENTES = ['novo', 'confirmado', 'pronto'];
const ORDEM_PENDENTE: Record<string, number> = { novo: 0, confirmado: 1, pronto: 2 };

export default function DeliveryPage() {
  const router = useRouter();
  const [cat, setCat] = useState<string | null>(null);
  const isGestor = ['presidente', 'gerente', 'supervisao'].includes(cat ?? '');
  const [pedidos, setPedidos] = useState<any[] | null>(null);
  const [cfg, setCfg] = useState<any>({ ativo: false, autoAceitar: false, finalizadoHoras: 5 });
  const [caixa, setCaixa] = useState<any>(null);
  const [erro, setErro] = useState('');
  const [sel, setSel] = useState<any>(null); // pedido selecionado (preview + botões)
  const [despacho, setDespacho] = useState<any>(null);
  const [detalhe, setDetalhe] = useState<any>(null); // modal detalhe (alterar/cancelar)
  const [filaConferencia, setFilaConferencia] = useState<any[]>([]); // fila de conferência (abre o 1º)
  const [codigoEntrega, setCodigoEntrega] = useState<{ pedido: any; codigo: string } | null>(null); // entrega própria 99food/iFood
  const [marcadosPend, setMarcadosPend] = useState<Set<string>>(new Set()); // seleção múltipla (pendentes)
  const [marcadosAnd, setMarcadosAnd] = useState<Set<string>>(new Set()); // seleção múltipla (em andamento)
  const [entregadores, setEntregadores] = useState<any[]>([]);
  const [tipoFiltro, setTipoFiltro] = useState<'todos' | 'entrega' | 'retirada'>('todos');
  const [novoPedido, setNovoPedido] = useState(false);
  const [pausarOpen, setPausarOpen] = useState(false);
  const [configOpen, setConfigOpen] = useState(false);
  const [agora, setAgora] = useState(() => Date.now());
  const [somAtivo, setSomAtivo] = useState(false);
  const audioRef = useRef<AudioContext | null>(null);
  const prevNovosRef = useRef<number | null>(null);
  const [piscar, setPiscar] = useState(false);
  const [atendimentos, setAtendimentos] = useState<any[]>([]);
  const [atendAberto, setAtendAberto] = useState(false);
  const [roboAtivo, setRoboAtivo] = useState(false);
  const [cardapioAtivo, setCardapioAtivo] = useState(false);
  const [lojaCfg, setLojaCfg] = useState<any>(null);
  const [integracoes, setIntegracoes] = useState<any[]>([]);
  const corPorCanal = useMemo(() => {
    const m: Record<string, string> = {};
    for (const it of integracoes) if (it?.cor) m[it.canal] = it.cor;
    return m;
  }, [integracoes]);
  const cfgRef = useRef(cfg);
  cfgRef.current = cfg;

  useEffect(() => {
    if (!isGestor) return;
    api.integracoesDelivery().then((list: any) => setIntegracoes((list as any[]) ?? [])).catch(() => {});
  }, [isGestor]);

  const reload = useCallback(async () => {
    try {
      const [ps, c, cx, ent, at, lc] = await Promise.all([
        api.deliveryPedidos(),
        api.deliveryConfig().catch(() => cfgRef.current),
        api.caixaAberta('delivery').catch(() => null),
        api.entregadoresDelivery().catch(() => []),
        api.atendimentos().catch(() => []),
        api.cardapioConfig().catch(() => null),
      ]);
      setPedidos(ps as any[]);
      setCfg(c);
      setCaixa(cx);
      setEntregadores(ent as any[]);
      setAtendimentos(at as any[]);
      if (lc) {
        setLojaCfg(lc);
        setRoboAtivo(!!(lc as any).roboAtivo);
        setCardapioAtivo(!!(lc as any).ativo);
      }
      // Mantém preview e modal sincronizados com os dados novos.
      setSel((s: any) => (s ? (ps as any[]).find((x) => x.id === s.id) ?? null : null));
      setDetalhe((d: any) => (d ? (ps as any[]).find((x) => x.id === d.id) ?? null : null));
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao carregar');
    }
  }, []);

  useEffect(() => {
    setCat(getCategoria());
    if (!getToken()) {
      router.replace('/entrar');
      return;
    }
    reload();
    const t = setInterval(reload, 15000);
    const c = setInterval(() => setAgora(Date.now()), 1000);
    return () => { clearInterval(t); clearInterval(c); };
  }, [reload, router]);

  useEffect(() => {
    try { setSomAtivo(localStorage.getItem('som_pedido') === '1'); } catch {}
  }, []);
  function garantirAudio() {
    try {
      if (!audioRef.current) {
        const AC = (window as any).AudioContext || (window as any).webkitAudioContext;
        if (AC) audioRef.current = new AC();
      }
      if (audioRef.current?.state === 'suspended') audioRef.current.resume();
    } catch {}
    return audioRef.current;
  }
  function tocarBeep() {
    const ctx = garantirAudio();
    if (!ctx || ctx.state !== 'running') return;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sine';
    o.frequency.value = 880;
    g.gain.setValueAtTime(0.0001, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.35);
    o.connect(g).connect(ctx.destination);
    o.start();
    o.stop(ctx.currentTime + 0.36);
  }
  function alternarSom() {
    const ligar = !somAtivo;
    garantirAudio();
    setSomAtivo(ligar);
    try { localStorage.setItem('som_pedido', ligar ? '1' : '0'); } catch {}
    if (ligar) tocarBeep();
  }

  async function acao(fn: Promise<any>, ok: string) {
    try {
      const res = await fn;
      // Impressão: o backend devolve { enfileirados, aviso }. 0 = nenhuma impressora
      // com alvo válido (erro); aviso com fallback = info; senão sucesso normal.
      if (res && typeof res === 'object' && 'enfileirados' in res && res.enfileirados === 0) {
        toast.error(res.aviso || 'Nenhuma impressora disponível.');
      } else if (res && typeof res === 'object' && res.aviso) {
        toast.info(res.aviso);
      } else {
        toast.success(ok);
      }
      await reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro');
    }
  }

  async function toggleCfg(patch: any) {
    try {
      const c = await api.setDeliveryConfig({ ...cfg, ...patch });
      setCfg(c);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro ao salvar');
    }
  }

  async function salvarTipo(patch: any) {
    try {
      const c = await api.setCardapioConfig({ ...(lojaCfg ?? {}), ...patch });
      setLojaCfg(c);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro ao salvar');
    }
  }

  async function toggleRobo() {
    const novo = !roboAtivo;
    setRoboAtivo(novo);
    try {
      await api.setCardapioConfig({ roboAtivo: novo });
      toast.success(novo ? 'Robô online — respondendo os clientes.' : 'Robô offline — não responde os clientes.');
    } catch (e) {
      setRoboAtivo(!novo);
      toast.error(e instanceof Error ? e.message : 'Erro ao salvar');
    }
  }

  // Avanço de UM passo (retirada e botão PRONTO usam este).
  function avancar(p: any) {
    acao(api.avancarDelivery(p.id), 'Status atualizado.');
  }
  // Despacha a entrega para "em rota" (AVANÇAR do delivery — pula 'pronto'):
  //  • QR ligado → despacha (o entregador confirma pelo QR do cupom);
  //  • QR desligado e há entregadores cadastrados → modal p/ escolher quem leva.
  function despacharFlow(p: any) {
    if (!cfg.qrDespacho && entregadores.length > 0) {
      setDespacho(p);
      return;
    }
    // Sem QR e sem entregador cadastrado: despacha direto, mas orienta como habilitar a escolha.
    const msg = !cfg.qrDespacho && entregadores.length === 0
      ? 'Pedido despachado — em rota. Para escolher quem leva, cadastre um colaborador com a função "Entregador".'
      : 'Pedido despachado — em rota.';
    acao(api.despacharDelivery(p.id), msg);
  }
  function retornar(p: any) {
    acao(api.retornarDelivery(p.id), 'Pedido voltou para a produção.');
  }
  function voltar(p: any) {
    const senha = window.prompt('Reabrir este pedido exige senha de gestor (presidente/C&O):');
    if (senha == null) return;
    if (!senha.trim()) return toast.error('Informe a senha de autorização.');
    acao(api.voltarDelivery(p.id, senha), 'Pedido reaberto.');
  }

  // Finalizar: só a ENTREGA PRÓPRIA (loja entrega) valida o código de 4 dígitos do
  // cliente → abre o modal. Detecta pelo bruto: 99food delivery_type=2; iFood
  // deliveredBy=MERCHANT (verifyDeliveryCode é do módulo Order, que o Regem tem).
  // Logística do marketplace: a loja não finaliza com código (conclui via webhook).
  async function finalizarFlow(p: any) {
    const raw = p?.raw ?? {};
    const entregaPropria =
      (p.canal === '99food' && Number(raw?.delivery_type) === 2) ||
      (p.canal === 'ifood' && String(raw?.delivery?.deliveredBy ?? '').toUpperCase() === 'MERCHANT');
    if (entregaPropria && p.tipo !== 'retirada') {
      setCodigoEntrega({ pedido: p, codigo: '' });
      return;
    }
    await finalizarDireto(p);
  }

  // Conclui direto (pago online conclui; a-receber abre a conferência valor + forma).
  async function finalizarDireto(p: any) {
    try {
      const r: any = await api.finalizarDelivery(p.id);
      if (r?.precisaConferencia) {
        setFilaConferencia([p]);
      } else {
        toast.success('Pedido finalizado.');
        await reload();
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro ao finalizar');
    }
  }

  // Valida o código de entrega no canal → se OK, conclui o pedido.
  async function confirmarCodigoEntrega() {
    if (!codigoEntrega) return;
    const { pedido, codigo } = codigoEntrega;
    if (!codigo.trim()) return toast.error('Digite o código de entrega.');
    try {
      const r: any = await api.confirmarCodigoDelivery(pedido.id, codigo.trim());
      if (!r?.valid) {
        toast.error(r?.msg || 'Código inválido — confira com o cliente.');
        return;
      }
      setCodigoEntrega(null);
      if (r?.precisaConferencia) setFilaConferencia([pedido]);
      else {
        toast.success('Entrega confirmada.');
        await reload();
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro ao confirmar a entrega');
    }
  }

  // ---- Seleção múltipla (checkbox) + ações em massa ----
  const toggleMarcado = (set: 'pend' | 'and', id: string) => {
    const upd = (s: Set<string>) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    };
    if (set === 'pend') setMarcadosPend(upd);
    else setMarcadosAnd(upd);
  };
  const marcarTodos = (set: 'pend' | 'and', ids: string[], marcar: boolean) => {
    const val = marcar ? new Set(ids) : new Set<string>();
    if (set === 'pend') setMarcadosPend(val);
    else setMarcadosAnd(val);
  };

  // Avança em massa os pendentes marcados (aceita/despacha conforme o status).
  async function avancarEmMassa() {
    const alvos = pendentes.filter((p) => marcadosPend.has(p.id));
    if (!alvos.length) return;
    await Promise.allSettled(
      alvos.map((p) => {
        if (p.status === 'novo') return api.aceitarDelivery(p.id);
        if (p.tipo !== 'retirada' && ['confirmado', 'pronto'].includes(p.status)) return api.despacharDelivery(p.id);
        return api.avancarDelivery(p.id);
      }),
    );
    setMarcadosPend(new Set());
    await reload();
    toast.success(`${alvos.length} pedido(s) avançado(s).`);
  }

  // Finaliza em massa os "em andamento" marcados. Pagos online concluem direto; os
  // a-receber entram na FILA de conferência (abre a tela p/ cada um antes de concluir).
  async function finalizarEmMassa() {
    const alvos = andamento.filter((p) => marcadosAnd.has(p.id) && ['despachado', 'entregue'].includes(p.status));
    if (!alvos.length) return;
    const online = alvos.filter((p) => p.pago);
    const aReceber = alvos.filter((p) => !p.pago);
    if (online.length) await Promise.allSettled(online.map((p) => api.finalizarDelivery(p.id)));
    if (aReceber.length) {
      setFilaConferencia(aReceber); // abre a conferência de cada a-receber
    } else {
      setMarcadosAnd(new Set());
      await reload();
      toast.success(`${online.length} pedido(s) finalizado(s).`);
    }
  }

  // ---- Botões do painel de ação (contexto = pedido selecionado `sel`) ----
  const st = sel?.status;
  const acoes = {
    avancar: {
      show: true,
      enabled: marcadosPend.size > 0 || (!!sel && ST_PENDENTES.includes(st)),
      onClick: () => {
        if (marcadosPend.size > 0) { avancarEmMassa(); return; }
        if (!sel) return;
        // Análise → aceita (fica em produção). Delivery em produção/pronto → despacha
        // direto para "em rota" (pula 'pronto'). Retirada → avança um passo normal.
        if (sel.status === 'novo') {
          acao(api.aceitarDelivery(sel.id), 'Pedido aceito e enviado à produção.');
        } else if (sel.tipo !== 'retirada' && ['confirmado', 'pronto'].includes(sel.status)) {
          despacharFlow(sel);
        } else {
          avancar(sel);
        }
      },
    },
    voltar: {
      show: true,
      enabled: !!sel && ['despachado', 'concluido', 'cancelado'].includes(st),
      onClick: () => {
        if (!sel) return;
        if (sel.status === 'despachado') retornar(sel);
        else voltar(sel);
      },
    },
    finalizar: {
      show: true,
      enabled: marcadosAnd.size > 0 || (!!sel && ['despachado', 'entregue'].includes(st ?? '')),
      onClick: () => {
        if (marcadosAnd.size > 0) { finalizarEmMassa(); return; }
        if (sel) finalizarFlow(sel);
      },
    },
    cancelar: {
      show: true,
      enabled: !!sel && !['concluido', 'cancelado'].includes(st),
      onClick: () => sel && setDetalhe(sel), // modal trata senha + motivo + reuso/perda
    },
    pronto: {
      show: true,
      enabled: !!sel && sel.status === 'confirmado',
      onClick: () => sel && acao(api.avancarDelivery(sel.id), 'Pedido marcado como pronto.'),
    },
    reimprimir: {
      show: true,
      enabled: !!sel && !!sel.comandaId,
      onClick: () => sel && acao(api.reimprimirDelivery(sel.id), 'Vias reenviadas à impressão.'),
    },
    cupomEntregador: {
      show: true,
      enabled: !!sel && sel.tipo !== 'retirada' && ['confirmado', 'pronto', 'despachado'].includes(st),
      onClick: () => sel && acao(api.imprimirCupomEntregador(sel.id), 'Cupom do entregador (QR) enviado à impressão.'),
    },
    nf: {
      show: true,
      enabled: !!sel && !!sel.comandaId,
      onClick: () => sel && acao(api.nfDelivery(sel.id), 'NF emitida.'),
    },
  };

  // ---- Listas ----
  const pendentes = useMemo(
    () =>
      (pedidos ?? [])
        .filter((p) => ST_PENDENTES.includes(p.status))
        .filter((p) => tipoFiltro === 'todos' || p.tipo === tipoFiltro)
        .sort((a, b) => {
          const oa = ORDEM_PENDENTE[a.status] ?? 9;
          const ob = ORDEM_PENDENTE[b.status] ?? 9;
          if (oa !== ob) return oa - ob;
          return new Date(a.criadoEm).getTime() - new Date(b.criadoEm).getTime();
        }),
    [pedidos, tipoFiltro],
  );
  const andamento = useMemo(
    () =>
      (pedidos ?? [])
        .filter((p) => ['despachado', 'entregue'].includes(p.status))
        .filter((p) => tipoFiltro === 'todos' || p.tipo === tipoFiltro),
    [pedidos, tipoFiltro],
  );
  const totais = useMemo(() => {
    const lista = pedidos ?? [];
    return {
      total: lista.length,
      cancelados: lista.filter((p) => p.status === 'cancelado').length,
      concluidos: lista.filter((p) => p.status === 'concluido').length,
    };
  }, [pedidos]);

  const novosPendentes = (pedidos ?? []).filter((p) => p.status === 'novo').length;
  useEffect(() => {
    if (prevNovosRef.current != null && novosPendentes > prevNovosRef.current && somAtivo) {
      tocarBeep();
      setPiscar(true);
      const t = setTimeout(() => setPiscar(false), 4000);
      prevNovosRef.current = novosPendentes;
      return () => clearTimeout(t);
    }
    prevNovosRef.current = novosPendentes;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [novosPendentes, somAtivo]);

  const rel = new Date(agora).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

  return (
    <Shell fill>
      <div className="flex h-full min-h-0 flex-col gap-2">
        {erro && <p className="text-destructive">{erro}</p>}

        {cfg.pausado && (
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-warn/40 bg-warn/10 px-4 py-2">
            <span className="text-sm font-bold text-warn">
              ⏸ Loja pausada{cfg.pausadoAte ? ` até ${hora(cfg.pausadoAte)}` : ''}
            </span>
            {cfg.pausaMotivo && <span className="text-xs text-muted-foreground">· {cfg.pausaMotivo}</span>}
            {isGestor && (
              <Button type="button" size="sm" variant="outline" className="ml-auto" onClick={() => acao(api.despausarDelivery(), 'Loja reativada.')}>
                Reativar agora
              </Button>
            )}
          </div>
        )}

        {/* Barra operacional: identidade + matriz/modo/hora + turno + filtros + recursos */}
        <Card className="px-3 py-2">
          {/* Turno (esq.) + matriz · modo nuvem · hora (dir.) na MESMA linha */}
          <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-border pb-2">
            {(isGestor || cat === 'atendente') && (
              <div className="min-w-0 flex-1">
                <CaixaPanel
                  caixa={caixa}
                  onChange={reload}
                  origem="delivery"
                  embedded
                  avisoVazio="Caixa de entregas fechado — abra para controlar troco e dinheiro na entrega."
                />
              </div>
            )}
            <div className="ml-auto flex items-center gap-2">
              <UnidadeSeletor />
              <ModoOperacao className="!py-1 !px-2" />
              <span className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-2 py-1 font-mono text-xs text-muted-foreground">
                <Clock className="h-3.5 w-3.5" /> {rel}
              </span>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <div className="inline-flex rounded-lg border border-border p-0.5 text-sm" role="group" aria-label="Filtrar por tipo">
              {([['todos', 'Todos'], ['entrega', '🛵'], ['retirada', '🏪']] as const).map(([k, lb]) => {
                const ativo = tipoFiltro === k;
                return (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setTipoFiltro(k)}
                    aria-pressed={ativo}
                    className={`rounded-md px-3 py-1 ${ativo ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'}`}
                    title={k === 'entrega' ? 'Delivery' : k === 'retirada' ? 'Retirada no balcão' : 'Todos'}
                  >
                    {lb}
                  </button>
                );
              })}
            </div>
            {novosPendentes > 0 && (
              <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${piscar ? 'animate-pulse bg-primary/20 text-primary' : 'bg-info/15 text-info'}`}>
                {novosPendentes} em análise
              </span>
            )}
            <button
              type="button"
              onClick={alternarSom}
              aria-pressed={somAtivo}
              title={somAtivo ? 'Som de pedido novo ligado' : 'Clique para ativar o som de pedido novo'}
              className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold ${somAtivo ? 'border-primary/40 bg-primary/10 text-primary' : 'border-border text-muted-foreground'}`}
            >
              {somAtivo ? '🔔 Som on' : '🔕 Ativar som'}
            </button>
            {isGestor && (
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={!!cfg.autoAceitar} onChange={(e) => toggleCfg({ autoAceitar: e.target.checked })} className="h-4 w-4 accent-primary" />
                Aceitar automaticamente
              </label>
            )}
            <div className="ml-auto flex items-center gap-1.5">
              {isGestor && cardapioAtivo && (
                <button
                  type="button"
                  role="switch"
                  aria-checked={roboAtivo}
                  aria-label={roboAtivo ? 'Robô online' : 'Robô offline'}
                  onClick={toggleRobo}
                  title={roboAtivo ? 'Robô respondendo os clientes — clique para desligar' : 'Robô sem responder — clique para ligar'}
                  className="flex h-8 items-center gap-2 rounded-md border border-border px-2 text-sm"
                >
                  <span className={`relative inline-flex h-4 w-7 items-center rounded-full transition-colors ${roboAtivo ? 'bg-ok' : 'bg-destructive'}`}>
                    <span className={`inline-block h-3 w-3 rounded-full bg-white transition-transform ${roboAtivo ? 'translate-x-3.5' : 'translate-x-0.5'}`} />
                  </span>
                  <span className={`font-medium ${roboAtivo ? 'text-ok' : 'text-destructive'}`}>
                    {roboAtivo ? 'Robô online' : 'Robô offline'}
                  </span>
                </button>
              )}
              <button
                type="button"
                onClick={() => setAtendAberto(true)}
                title="Chamados de atendimento"
                aria-label="Chamados de atendimento"
                className={`relative flex h-8 items-center rounded-md border px-2 text-sm ${atendimentos.length ? 'border-destructive/50 bg-destructive/10 text-destructive' : 'border-border text-muted-foreground hover:border-primary/50'}`}
              >
                🔔
                {atendimentos.length > 0 && (
                  <span className="ml-1 grid h-5 min-w-5 place-items-center rounded-full bg-destructive px-1 text-[11px] font-bold text-white">{atendimentos.length}</span>
                )}
              </button>
              <Button type="button" size="sm" className="h-8 text-sm" onClick={() => setNovoPedido(true)}>＋ Novo pedido</Button>
              {isGestor && (
                <div className="relative">
                  <Button type="button" variant="outline" size="sm" className="h-8 text-sm" onClick={() => setPausarOpen((v) => !v)}>
                    {cfg.pausado ? '⏸ Pausada' : '⏸ Pausar'}
                  </Button>
                  {pausarOpen && (
                    <PausarMenu
                      onFechar={() => setPausarOpen(false)}
                      onPausar={async (min, motivo) => { await acao(api.pausarDelivery(min, motivo), 'Loja pausada.'); setPausarOpen(false); }}
                    />
                  )}
                </div>
              )}
              <Button type="button" variant="outline" size="sm" className="h-8 px-2.5 text-sm" onClick={() => setConfigOpen(true)} title="Configurações do delivery">⚙️</Button>
            </div>
          </div>
        </Card>

        {configOpen && (
          <ConfigModal cfg={cfg} onToggle={toggleCfg} loja={lojaCfg} onTipo={salvarTipo} pode={isGestor} onClose={() => setConfigOpen(false)} />
        )}

        {/* Corpo: listas (esq.) + preview/ações (dir.) */}
        {!pedidos ? (
          <p className="text-sm text-muted-foreground">Carregando…</p>
        ) : (
          <div className="grid gap-3 lg:min-h-0 lg:flex-1 lg:grid-cols-[1.7fr_1fr] lg:grid-rows-[minmax(0,1fr)]">
            {/* Coluna esquerda: 2 listviews (rolam por dentro) */}
            <div className="flex min-w-0 flex-col gap-3 lg:min-h-0">
              <ListaPedidos
                className="lg:min-h-0 lg:flex-1"
                titulo="Pedidos pendentes"
                cor="var(--warn)"
                variante="pendentes"
                lista={pendentes}
                selId={sel?.id}
                agora={agora}
                cfg={cfg}
                corPorCanal={corPorCanal}
                onSelecionar={setSel}
                marcados={marcadosPend}
                onToggle={(id) => toggleMarcado('pend', id)}
                onToggleTodos={(m) => marcarTodos('pend', pendentes.map((p) => p.id), m)}
              />
              <ListaPedidos
                className="lg:min-h-0 lg:flex-1"
                titulo="Entregas em andamento"
                cor="var(--primary)"
                variante="andamento"
                lista={andamento}
                selId={sel?.id}
                agora={agora}
                cfg={cfg}
                corPorCanal={corPorCanal}
                onSelecionar={setSel}
                marcados={marcadosAnd}
                onToggle={(id) => toggleMarcado('and', id)}
                onToggleTodos={(m) => marcarTodos('and', andamento.map((p) => p.id), m)}
              />
            </div>

            {/* Coluna direita: preview + painel de botões */}
            <div className="flex min-w-0 flex-col gap-3 lg:min-h-0">
              <PreviewPedido className="lg:min-h-0 lg:flex-1" pedido={sel} onAbrirDetalhe={() => sel && setDetalhe(sel)} />
              <PainelAcoes acoes={acoes} temSel={!!sel} nPend={marcadosPend.size} nAnd={marcadosAnd.size} />
            </div>
          </div>
        )}

        {/* Rodapé: status por canal + totais */}
        {pedidos && (
          <RodapeDelivery
            integracoes={integracoes}
            cardapioAtivo={cardapioAtivo}
            totais={totais}
          />
        )}
      </div>

      {/* Modal: despachar (escolher entregador) */}
      {despacho && (
        <DespachoModal
          pedido={despacho}
          entregadores={entregadores}
          onFechar={() => setDespacho(null)}
          onConfirmar={async (ent) => {
            await acao(api.despacharDelivery(despacho.id, ent as any), 'Pedido despachado — em rota.');
            setDespacho(null);
          }}
        />
      )}

      {/* Fila de conferência do recebimento (a-receber na entrega) — abre um por vez */}
      {filaConferencia.length > 0 && (
        <ConferenciaModal
          pedido={filaConferencia[0]}
          restantes={filaConferencia.length}
          onFechar={async () => { setFilaConferencia([]); setMarcadosAnd(new Set()); await reload(); }}
          onConfirmar={async (forma, valorRecebido) => {
            const atual = filaConferencia[0];
            try {
              await api.finalizarDelivery(atual.id, { forma, valorRecebido });
            } catch (e) {
              toast.error(e instanceof Error ? e.message : 'Erro ao finalizar');
              return;
            }
            const resto = filaConferencia.slice(1);
            setFilaConferencia(resto);
            if (resto.length === 0) {
              setMarcadosAnd(new Set());
              await reload();
              toast.success('Recebimento(s) registrado(s) — finalizado(s).');
            }
          }}
        />
      )}

      {/* Modal detalhe do pedido (reimprimir/alterar/cancelar) */}
      {detalhe && (
        <PedidoDetalhe pedido={detalhe} onClose={() => setDetalhe(null)} onChanged={reload} />
      )}

      {/* Modal: confirmar entrega por CÓDIGO (entrega própria 99food/iFood) */}
      {codigoEntrega && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4" onClick={() => setCodigoEntrega(null)}>
          <div className="w-full max-w-sm rounded-xl border border-border bg-card p-5 shadow-lg" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-display text-lg font-bold">Código de entrega</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Peça o código ao cliente e digite abaixo para confirmar a entrega no{' '}
              <strong>{CANAL_LABEL[codigoEntrega.pedido.canal] ?? codigoEntrega.pedido.canal}</strong>.
            </p>
            <input
              autoFocus
              inputMode="numeric"
              value={codigoEntrega.codigo}
              onChange={(e) => setCodigoEntrega((s) => (s ? { ...s, codigo: e.target.value } : s))}
              onKeyDown={(e) => { if (e.key === 'Enter') confirmarCodigoEntrega(); }}
              placeholder="Código do cliente"
              className="mt-4 w-full rounded-lg border border-border bg-background px-3 py-2 text-center text-lg tracking-widest outline-none focus:ring-2 focus:ring-primary/40"
            />
            <div className="mt-4 flex flex-col gap-2">
              <button type="button" onClick={confirmarCodigoEntrega} className="h-10 rounded-lg bg-primary font-display font-semibold text-primary-foreground transition-opacity hover:opacity-90">
                Confirmar entrega
              </button>
              <button type="button" onClick={() => { const p = codigoEntrega.pedido; setCodigoEntrega(null); finalizarDireto(p); }} className="h-9 text-sm text-muted-foreground hover:underline">
                Finalizar sem código
              </button>
              <button type="button" onClick={() => setCodigoEntrega(null)} className="h-9 text-sm text-muted-foreground hover:underline">
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      {novoPedido && <NovoPedido onFechar={() => setNovoPedido(false)} onCriado={reload} />}

      {atendAberto && (
        <AtendimentoPanel
          lista={atendimentos}
          onFechar={() => setAtendAberto(false)}
          onResolver={(id) => acao(api.resolverAtendimento(id), 'Chamado resolvido.')}
          onDecidir={(id, aceita, senha) =>
            acao(
              api.decidirCancelamento(id, { aceita, senha }),
              aceita ? 'Pedido cancelado.' : 'Cancelamento recusado.',
            )
          }
        />
      )}
    </Shell>
  );
}

// ---- Listview de pedidos (tabela): seleção múltipla + ordenação por coluna ----
type ColDef = { k: string; t: string };
function ListaPedidos({
  titulo, cor, variante, lista, selId, agora, cfg, corPorCanal, onSelecionar, className,
  marcados, onToggle, onToggleTodos,
}: {
  titulo: string;
  cor: string;
  variante: 'pendentes' | 'andamento';
  lista: any[];
  selId?: string;
  agora: number;
  cfg: any;
  corPorCanal: Record<string, string>;
  onSelecionar: (p: any) => void;
  className?: string;
  marcados: Set<string>;
  onToggle: (id: string) => void;
  onToggleTodos: (marcar: boolean) => void;
}) {
  const cols: ColDef[] = variante === 'andamento'
    ? [{ k: 'numero', t: 'Pedido' }, { k: 'displayId', t: 'Cod. externo' }, { k: 'canal', t: 'Origem' }, { k: 'criadoEm', t: 'Hora' }, { k: 'clienteNome', t: 'Cliente' }, { k: 'entregadorNome', t: 'Entregador' }, { k: 'status', t: 'Status' }]
    : [{ k: 'numero', t: 'Pedido' }, { k: 'displayId', t: 'Cod. externo' }, { k: 'canal', t: 'Origem' }, { k: 'criadoEm', t: 'Hora' }, { k: 'clienteNome', t: 'Cliente' }, { k: 'endereco', t: 'Endereço' }, { k: 'status', t: 'Status' }];
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  function clickHeader(k: string) {
    if (sortKey === k) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(k); setSortDir('asc'); }
  }
  const valDe = (p: any, k: string): any => {
    if (k === 'numero') return Number(p.numero) || 0;
    if (k === 'criadoEm') return new Date(p.criadoEm).getTime() || 0;
    if (k === 'endereco') return String(p.endereco || p.enderecoBairro || '').toLowerCase();
    const v = p[k];
    return typeof v === 'string' ? v.toLowerCase() : v ?? '';
  };
  const ordenada = useMemo(() => {
    if (!sortKey) return lista;
    return [...lista].sort((a, b) => {
      const va = valDe(a, sortKey), vb = valDe(b, sortKey);
      const c = va < vb ? -1 : va > vb ? 1 : 0;
      return sortDir === 'asc' ? c : -c;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lista, sortKey, sortDir]);
  const todosMarcados = lista.length > 0 && lista.every((p) => marcados.has(p.id));
  const nCols = cols.length + 1; // +1 = coluna do checkbox
  return (
    <Card className={`flex max-h-[46vh] min-h-[160px] flex-col overflow-hidden p-0 lg:max-h-none ${className ?? ''}`}>
      <div className="flex flex-none items-center gap-2 border-b border-border px-3 py-2" style={{ background: `hsl(${cor} / 0.10)` }}>
        <span className="h-3 w-3 rounded-full" style={{ background: `hsl(${cor})` }} />
        <h2 className="font-display text-sm font-bold tracking-tight" style={{ color: `hsl(${cor})` }}>{titulo}</h2>
        <span className="grid h-5 min-w-5 place-items-center rounded-full px-1 font-mono text-xs font-bold text-white" style={{ background: `hsl(${cor})` }}>{lista.length}</span>
        {marcados.size > 0 && <span className="ml-1 text-xs font-semibold text-primary">{marcados.size} selecionado(s)</span>}
      </div>
      <div className="scroll-fino overflow-auto lg:min-h-0 lg:flex-1">
        <table className="w-full min-w-[660px] text-left text-[13px] [&_td]:!py-1 [&_th]:!py-1">
          <caption className="sr-only">{titulo}</caption>
          <thead className="sticky top-0 z-10 bg-card">
            <tr className="border-b border-border text-[10px] uppercase tracking-wide text-muted-foreground">
              <th scope="col" className="w-8 px-2">
                <input type="checkbox" className="h-4 w-4 accent-primary align-middle" checked={todosMarcados} onChange={(e) => onToggleTodos(e.target.checked)} aria-label="Selecionar todos" />
              </th>
              {cols.map((c) => (
                <th key={c.k} scope="col" className="px-2 font-semibold">
                  <button type="button" onClick={() => clickHeader(c.k)} className="inline-flex items-center gap-1 hover:text-foreground" aria-label={`Ordenar por ${c.t}`}>
                    {c.t}
                    <span className="text-[9px] opacity-70">{sortKey === c.k ? (sortDir === 'asc' ? '▲' : '▼') : '↕'}</span>
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ordenada.length === 0 && (
              <tr>
                <td colSpan={nCols} className="px-3 py-6 text-center text-xs text-muted-foreground">
                  Nenhum pedido.
                </td>
              </tr>
            )}
            {ordenada.map((p) => {
              const canalLabel = CANAL_LABEL[p.canal] ?? p.canal;
              const bg = corPorCanal[p.canal] ?? CANAL_ESTILO[p.canal]?.bg;
              const fg = corPorCanal[p.canal] ? '#FFFFFF' : CANAL_ESTILO[p.canal]?.fg ?? '#FFFFFF';
              const sv = STATUS_VIVO[p.status] ?? { label: p.status, cls: 'bg-muted text-foreground' };
              // Atraso (só nos pendentes): prazo de preparo estourado.
              const prepMax = p.tipo === 'retirada' ? cfg?.prepBalcaoMax ?? 25 : cfg?.prepDeliveryMax ?? 55;
              const restanteMs = new Date(p.criadoEm).getTime() + prepMax * 60000 - agora;
              const atrasado = variante === 'pendentes' && restanteMs <= 0;
              const cd = variante === 'pendentes' ? countdown(restanteMs) : null;
              const selecionado = selId === p.id;
              const marcado = marcados.has(p.id);
              return (
                <tr
                  key={p.id}
                  onClick={() => onSelecionar(p)}
                  tabIndex={0}
                  onKeyDown={(e) => { if (e.key === 'Enter') onSelecionar(p); }}
                  aria-selected={selecionado}
                  className={`cursor-pointer border-b border-border/60 transition-colors ${
                    selecionado
                      ? 'bg-primary/15 shadow-[inset_3px_0_0_hsl(var(--primary))]'
                      : marcado
                      ? 'bg-primary/5'
                      : 'hover:bg-muted/50'
                  }`}
                >
                  <td className="w-8 px-2" onClick={(e) => e.stopPropagation()}>
                    <input type="checkbox" className="h-4 w-4 accent-primary align-middle" checked={marcado} onChange={() => onToggle(p.id)} aria-label={`Selecionar pedido ${p.numero ?? ''}`} />
                  </td>
                  <td className="px-3">
                    <span className="font-mono font-bold">#{p.numero ?? '—'}</span>
                    <span className="ml-1.5 rounded-full bg-muted px-1.5 py-0.5 text-[10px]">{p.tipo === 'retirada' ? '🏪' : '🛵'}</span>
                    {p.alterado && <span className="ml-1 rounded bg-warn/15 px-1 text-[9px] font-bold text-warn">ALT</span>}
                    {p.autoAceiteFalhou && <span className="ml-1 text-[10px] font-bold text-destructive" title="Falha no aceite automático">⚠️</span>}
                  </td>
                  <td className="px-2 py-2 font-mono text-xs text-muted-foreground">{p.displayId ?? '—'}</td>
                  <td className="px-2 py-2">
                    <span className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-bold" style={bg ? { background: bg, color: fg } : { background: 'hsl(var(--secondary))', color: 'hsl(var(--muted-foreground))' }}>
                      {CANAL_LOGO[p.canal] && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={CANAL_LOGO[p.canal]} alt="" className="h-3.5 w-3.5 rounded-[3px] object-cover" onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }} />
                      )}
                      {canalLabel}
                    </span>
                  </td>
                  <td className="px-2 py-2 font-mono text-xs">
                    <span>{hora(p.criadoEm)}</span>
                    {cd && <span className={`ml-1 ${atrasado ? 'text-destructive' : 'text-muted-foreground'}`}>{atrasado ? '⏱!' : ''}</span>}
                    <span className="ml-1.5 text-[10px] font-normal text-muted-foreground">{dataCurta(p.criadoEm)}</span>
                  </td>
                  <td className="px-2 py-2">
                    <span className="font-medium">{p.clienteNome ?? 'Cliente'}</span>
                    {p.clientePedidosCount > 0 && (
                      p.clientePedidosCount === 1
                        ? <span title="Primeiro pedido deste cliente" className="ml-1.5 inline-grid h-4 w-4 place-items-center rounded-full bg-ok/15 align-middle text-[8px] font-bold text-ok">1º</span>
                        : <span title={`${p.clientePedidosCount} pedidos deste cliente`} className="ml-1.5 rounded-full bg-primary/15 px-1.5 align-middle text-[10px] font-bold text-primary">{p.clientePedidosCount}×</span>
                    )}
                  </td>
                  {variante === 'pendentes' && (
                    <td className="px-2 py-2 text-xs text-muted-foreground">
                      {p.tipo === 'retirada' ? 'Retirada no balcão' : (p.endereco || [p.enderecoRua, p.enderecoNumero, p.enderecoBairro].filter(Boolean).join(', ') || '—')}
                    </td>
                  )}
                  <td className="px-3 py-2">
                    {variante === 'andamento'
                      ? (p.entregadorNome ? <span className="text-xs font-medium">🛵 {p.entregadorNome}</span> : <span className="text-xs text-muted-foreground">—</span>)
                      : <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${sv.cls}`}>{sv.label}</span>}
                  </td>
                  {variante === 'andamento' && (
                    <td className="px-3 py-2">
                      <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${sv.cls}`}>{sv.label}</span>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

// ---- Preview do pedido (detalhe estilo cupom, painel direito) ----
function PreviewPedido({ pedido: p, onAbrirDetalhe, className }: { pedido: any; onAbrirDetalhe: () => void; className?: string }) {
  if (!p) {
    return (
      <Card className={`grid min-h-[200px] place-items-center p-6 text-center ${className ?? ''}`}>
        <div>
          <p className="text-3xl">🧾</p>
          <p className="mt-2 text-sm font-medium">Preview do pedido</p>
          <p className="text-xs text-muted-foreground">Clique em um pedido nas listas ao lado para ver todos os detalhes.</p>
        </div>
      </Card>
    );
  }
  const sv = STATUS_VIVO[p.status] ?? { label: p.status, cls: 'bg-muted text-foreground' };
  const itens: any[] = Array.isArray(p.itens) ? p.itens : [];
  const endereco = p.tipo === 'retirada' ? 'Retirada no balcão'
    : (p.endereco || [p.enderecoRua && `${p.enderecoRua}, ${p.enderecoNumero ?? ''}`, p.enderecoBairro, p.enderecoReferencia].filter(Boolean).join(' · ') || '—');
  return (
    <Card className={`flex flex-col overflow-hidden p-0 ${className ?? ''}`}>
      <div className="flex flex-none items-center gap-2 border-b border-border px-3 py-2">
        <span className="font-mono text-base font-bold">#{p.numero ?? '—'}</span>
        <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium">{p.tipo === 'retirada' ? '🏪 Retirada' : '🛵 Delivery'}</span>
        <span className="text-xs text-muted-foreground">{CANAL_LABEL[p.canal] ?? p.canal}{p.displayId ? ` · #${p.displayId}` : ''}</span>
        <span className={`ml-auto rounded-full px-2 py-0.5 text-[11px] font-bold ${sv.cls}`}>{sv.label}</span>
      </div>
      <div className="scroll-fino max-h-[50vh] flex-1 space-y-2 overflow-y-auto px-3 py-2.5 text-sm lg:max-h-none lg:min-h-0">
        <div>
          <p className="font-bold">
            {p.clienteNome ?? 'Cliente'}
            {p.clientePedidosCount > 0 && (
              p.clientePedidosCount === 1
                ? <span title="Primeiro pedido deste cliente" className="ml-1.5 inline-grid h-4 w-4 place-items-center rounded-full bg-ok/15 align-middle text-[8px] font-bold text-ok">1º</span>
                : <span title={`${p.clientePedidosCount} pedidos deste cliente`} className="ml-1.5 rounded-full bg-primary/15 px-1.5 align-middle text-[10px] font-bold text-primary">{p.clientePedidosCount}× pedidos</span>
            )}
          </p>
          {p.clienteTelefone && <p className="text-xs text-muted-foreground">{p.clienteTelefone}</p>}
          <p className="mt-0.5 text-xs text-muted-foreground">{endereco}</p>
        </div>
        <div className="flex flex-wrap gap-x-3 gap-y-0.5 border-y border-border py-1.5 text-xs">
          <span className="text-muted-foreground">{dataCurta(p.criadoEm)} · {hora(p.criadoEm)}</span>
          {p.pago ? <span className="font-bold text-ok">Pago online</span> : <span className="font-bold text-warn">A pagar {p.formaPagamento ? `· ${formaLabel(p.formaPagamento)}` : ''}</span>}
          {p.trocoPara != null && Number(p.trocoPara) > 0 && <span className="text-muted-foreground">troco p/ {brl(Number(p.trocoPara))}</span>}
          {p.entregadorNome && <span className="font-medium">🛵 {p.entregadorNome}</span>}
          {p.agendamento && <span className="text-info">agendado {hora(p.agendamento)}</span>}
          {p.cupom && <span className="text-muted-foreground">cupom {p.cupom}</span>}
        </div>
        <ul className="space-y-1">
          {itens.map((it, i) => (
            <li key={i} className="flex justify-between gap-2 text-xs">
              <span>
                <span className="font-mono">{it.quantidade ?? 1}×</span> {it.descricao ?? it.nome}
                {it.observacao && <span className="block text-[11px] text-muted-foreground">obs: {it.observacao}</span>}
              </span>
              {it.total != null && <span className="font-mono">{brl(Number(it.total))}</span>}
            </li>
          ))}
          {itens.length === 0 && <li className="text-xs text-muted-foreground">Itens não detalhados neste pedido.</li>}
        </ul>
        <div className="space-y-0.5 border-t border-border pt-1.5 text-xs">
          {p.desconto != null && Number(p.desconto) > 0 && <div className="flex justify-between text-ok"><span>Desconto</span><span className="font-mono">- {brl(Number(p.desconto))}</span></div>}
          {p.taxaEntrega != null && Number(p.taxaEntrega) > 0 && <div className="flex justify-between text-muted-foreground"><span>Taxa de entrega</span><span className="font-mono">{brl(Number(p.taxaEntrega))}</span></div>}
          <div className="flex justify-between text-sm font-bold"><span>Total</span><span className="font-mono">{brl(Number(p.total))}</span></div>
        </div>
      </div>
      <div className="flex-none border-t border-border px-3 py-2">
        <button type="button" onClick={onAbrirDetalhe} className="text-xs font-semibold text-primary hover:underline">Ver / editar detalhes completos →</button>
      </div>
    </Card>
  );
}

// ---- Painel de ações (botões do mockup) ----
function PainelAcoes({ acoes, temSel, nPend, nAnd }: { acoes: any; temSel: boolean; nPend: number; nAnd: number }) {
  const Btn = ({ a, label, variant = 'outline' as const }: { a: any; label: string; variant?: 'default' | 'outline' }) => (
    <Button
      type="button"
      variant={variant}
      className="h-12 justify-center text-sm font-bold"
      disabled={!a.enabled}
      onClick={a.onClick}
    >
      {label}
    </Button>
  );
  return (
    <Card className="p-3">
      {!temSel && nPend === 0 && nAnd === 0 && (
        <p className="mb-2 text-center text-xs text-muted-foreground">Selecione um pedido (ou marque vários com a caixinha) para agir.</p>
      )}
      <div className="grid grid-cols-2 gap-2">
        <Btn a={acoes.avancar} label={nPend > 0 ? `AVANÇAR (${nPend})` : 'AVANÇAR'} variant="default" />
        <Btn a={acoes.voltar} label="VOLTAR" />
        <Btn a={acoes.finalizar} label={nAnd > 0 ? `FINALIZAR (${nAnd})` : 'FINALIZAR'} variant="default" />
        <Btn a={acoes.cancelar} label="CANCELAR" />
        <Btn a={acoes.pronto} label="PRONTO" />
        <Btn a={acoes.reimprimir} label="REIMPRIMIR" />
        <Btn a={acoes.cupomEntregador} label="CUPOM ENTREGADOR" />
        <Btn a={acoes.nf} label="NF-e" />
      </div>
    </Card>
  );
}

// ---- Rodapé: status por canal + totais ----
function RodapeDelivery({ integracoes, cardapioAtivo, totais }: { integracoes: any[]; cardapioAtivo: boolean; totais: { total: number; cancelados: number; concluidos: number } }) {
  const canais = [
    { nome: 'Cardápio Regem', on: cardapioAtivo },
    ...integracoes.map((it) => ({ nome: CANAL_LABEL[it.canal] ?? it.canal, on: !!it.ativo })),
  ];
  return (
    <Card className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2 text-xs">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        {canais.map((c) => (
          <span key={c.nome} className="inline-flex items-center gap-1">
            <span className={`h-2 w-2 rounded-full ${c.on ? 'bg-ok' : 'bg-muted-foreground/40'}`} />
            {c.nome} <span className={c.on ? 'font-bold text-ok' : 'text-muted-foreground'}>{c.on ? 'on' : 'off'}</span>
          </span>
        ))}
      </div>
      <div className="ml-auto flex items-center gap-3 font-mono">
        <span>Total <strong>{totais.total}</strong></span>
        <span className="text-destructive">Cancelados <strong>{totais.cancelados}</strong></span>
        <span className="text-ok">Concluídos <strong>{totais.concluidos}</strong></span>
      </div>
    </Card>
  );
}

// ---- Painel de chamados de atendimento ----
const TIPO_ATEND: Record<string, string> = {
  mudanca: '✏️ Mudança no pedido',
  erro: '⚠️ Erro no recebimento',
  humano: '🙋 Falar com atendente',
  cancelamento: '🚫 Pedido de cancelamento',
  outro: '💬 Atendimento',
};
function AtendimentoPanel({ lista, onFechar, onResolver, onDecidir }: {
  lista: any[];
  onFechar: () => void;
  onResolver: (id: string) => void;
  onDecidir: (id: string, aceita: boolean, senha?: string) => void;
}) {
  const [cancelId, setCancelId] = useState<string | null>(null);
  const [senha, setSenha] = useState('');
  const inbox = (tel?: string) => {
    const d = String(tel ?? '').replace(/\D/g, '');
    const num = d.length === 10 || d.length === 11 ? `55${d}` : d;
    return `/whatsapp?numero=${num}`;
  };
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4" onClick={onFechar}>
      <Card className="max-h-[85vh] w-full max-w-md overflow-y-auto p-5" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center gap-2">
          <h3 className="font-display text-base font-bold">🔔 Atendimento</h3>
          <span className="font-mono text-xs text-muted-foreground">{lista.length} aberto(s)</span>
          <button type="button" onClick={onFechar} className="ml-auto text-sm text-muted-foreground hover:underline">Fechar ✕</button>
        </div>
        {lista.length === 0 && <p className="py-6 text-center text-sm text-muted-foreground">Nenhum chamado no momento. 🎉</p>}
        <div className="space-y-2">
          {lista.map((c) => (
            <div key={c.id} className="rounded-lg border border-border p-3">
              <div className="flex items-center gap-2">
                <span className="text-sm font-bold">{TIPO_ATEND[c.tipo] ?? c.tipo}</span>
                <span className="ml-auto font-mono text-[10px] text-muted-foreground">{hora(c.criadoEm)}</span>
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {c.cliente ?? 'Cliente'}{c.telefone ? ` · ${c.telefone}` : ''}{c.pedidoNumero ? ` · pedido #${c.pedidoNumero}` : ''}
              </p>
              {c.mensagem && <p className="mt-1.5 rounded bg-secondary px-2 py-1.5 text-sm">{c.mensagem}</p>}
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {c.telefone && (
                  <Link href={inbox(c.telefone)} onClick={(e) => e.stopPropagation()} className="rounded-md bg-ok/10 px-2.5 py-1 text-xs font-semibold text-ok hover:bg-ok/20">💬 Responder no WhatsApp</Link>
                )}
                {c.tipo === 'cancelamento' ? (
                  <>
                    <Button type="button" size="sm" variant="outline" className="ml-auto h-7 text-xs" onClick={() => onDecidir(c.id, false)}>Recusar</Button>
                    <Button type="button" size="sm" className="h-7 bg-destructive text-xs text-white hover:bg-destructive/90" onClick={() => { setCancelId(cancelId === c.id ? null : c.id); setSenha(''); }}>Aceitar cancelamento</Button>
                  </>
                ) : (
                  <Button type="button" size="sm" variant="outline" className="ml-auto h-7 text-xs" onClick={() => onResolver(c.id)}>Resolver</Button>
                )}
              </div>
              {c.tipo === 'cancelamento' && cancelId === c.id && (
                <div className="mt-2 flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-2">
                  <input type="password" value={senha} onChange={(e) => setSenha(e.target.value)} placeholder="Senha do gestor" className="h-8 flex-1 rounded border border-border bg-background px-2 text-sm" />
                  <Button type="button" size="sm" className="h-8 bg-destructive text-xs text-white hover:bg-destructive/90" disabled={!senha} onClick={() => { onDecidir(c.id, true, senha); setCancelId(null); setSenha(''); }}>
                    Confirmar cancelamento
                  </Button>
                </div>
              )}
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

// ---- Menu de pausa (30min / 1h / 12h + motivo) ----
function PausarMenu({ onFechar, onPausar }: { onFechar: () => void; onPausar: (min: number, motivo?: string) => void }) {
  const [motivo, setMotivo] = useState('');
  const opcoes: [number, string][] = [[30, '30 min'], [60, '1 hora'], [720, '12 horas']];
  return (
    <>
      <button type="button" className="fixed inset-0 z-40 cursor-default" aria-label="Fechar" onClick={onFechar} />
      <div className="absolute right-0 top-full z-50 mt-1 w-56 rounded-lg border border-border bg-card p-3 shadow-lg">
        <p className="mb-2 text-xs font-semibold text-muted-foreground">Pausar a loja por</p>
        <div className="space-y-1">
          <Input value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Motivo (opcional)" autoFocus />
          <div className="mt-2 flex flex-col gap-1.5">
            {opcoes.map(([min, lb]) => (
              <Button key={min} type="button" size="sm" variant="outline" onClick={() => onPausar(min, motivo.trim() || undefined)}>
                {lb}
              </Button>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}

// ---- Modal de despacho: escolhe o entregador (função Entregador) ----
function DespachoModal({ pedido, entregadores, onFechar, onConfirmar }: {
  pedido: any;
  entregadores: any[];
  onFechar: () => void;
  onConfirmar: (ent: { entregadorId?: string | null; entregadorNome: string; entregadorTelefone?: string | null }) => void;
}) {
  const opcoes = [{ id: '', nome: 'Nenhum', telefone: null }, ...entregadores];
  const [sel, setSel] = useState(opcoes[0]);
  return (
    <div className="fixed inset-0 z-40 grid place-items-center bg-black/50 p-4" onClick={onFechar}>
      <Card className="w-full max-w-sm p-5" onClick={(e) => e.stopPropagation()}>
        <h3 className="font-display font-semibold">Despachar {pedido.displayId ?? 'pedido'}</h3>
        <p className="mb-3 mt-0.5 text-xs text-muted-foreground">
          Quem vai levar? {entregadores.length === 0 && '(cadastre colaboradores com a função "Entregador" para aparecerem aqui)'}
        </p>
        <div className="space-y-1.5">
          {opcoes.map((e) => (
            <button
              key={e.id || 'nenhum'}
              type="button"
              onClick={() => setSel(e)}
              className={`flex w-full items-center justify-between rounded-lg border p-2.5 text-left text-sm ${sel.id === e.id ? 'border-primary bg-primary/10' : 'border-border'}`}
            >
              <span className="font-medium">{e.id ? '🛵 ' : ''}{e.nome}</span>
              {e.telefone && <span className="text-xs text-muted-foreground">📞 {e.telefone}</span>}
            </button>
          ))}
        </div>
        <div className="mt-4 flex gap-2">
          <Button type="button" variant="ghost" className="flex-1" onClick={onFechar}>Cancelar</Button>
          <Button type="button" className="flex-1" onClick={() => onConfirmar({ entregadorId: sel.id || null, entregadorNome: sel.nome, entregadorTelefone: sel.telefone })}>Despachar</Button>
        </div>
      </Card>
    </div>
  );
}

// ---- Modal de conferência do recebimento (entregador próprio, a-receber) ----
function ConferenciaModal({ pedido, onFechar, onConfirmar, restantes = 1 }: {
  pedido: any;
  onFechar: () => void;
  onConfirmar: (forma: string, valorRecebido: number) => void;
  restantes?: number;
}) {
  const total = Number(pedido.total) || 0;
  const [forma, setForma] = useState('dinheiro');
  const [valor, setValor] = useState(total.toFixed(2));
  const recebido = Number(String(valor).replace(',', '.')) || 0;
  const troco = forma === 'dinheiro' ? Math.max(0, recebido - total) : 0;
  const faltou = forma === 'dinheiro' && recebido < total;
  const FORMAS: [string, string][] = [['dinheiro', 'Dinheiro'], ['cartao', 'Cartão'], ['pix', 'Pix']];
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4" onClick={onFechar}>
      <Card className="w-full max-w-sm p-5" onClick={(e) => e.stopPropagation()}>
        <h3 className="font-display font-semibold">
          Conferência do recebimento
          {restantes > 1 && <span className="ml-2 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-bold text-primary">{restantes} na fila</span>}
        </h3>
        <p className="mb-3 mt-0.5 text-xs text-muted-foreground">
          Pedido #{pedido.numero ?? '—'} · a receber <strong className="text-warn">{brl(total)}</strong>
        </p>
        <div className="space-y-3">
          <div>
            <p className="mb-1 text-xs font-medium">Forma recebida</p>
            <div className="inline-flex flex-wrap gap-1.5">
              {FORMAS.map(([k, lb]) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setForma(k)}
                  aria-pressed={forma === k}
                  className={`rounded-lg border px-3 py-1.5 text-sm ${forma === k ? 'border-primary bg-primary/10 font-semibold' : 'border-border'}`}
                >
                  {lb}
                </button>
              ))}
            </div>
          </div>
          <label className="block">
            <span className="mb-1 block text-xs font-medium">Valor recebido</span>
            <Input value={valor} inputMode="decimal" onChange={(e) => setValor(e.target.value)} />
          </label>
          {forma === 'dinheiro' && (
            <p className={`text-sm ${faltou ? 'text-destructive' : 'text-muted-foreground'}`}>
              {faltou ? `Faltam ${brl(total - recebido)}` : `Troco: ${brl(troco)}`}
            </p>
          )}
        </div>
        <div className="mt-4 flex gap-2">
          <Button type="button" variant="ghost" className="flex-1" onClick={onFechar}>Cancelar</Button>
          <Button type="button" className="flex-1" onClick={() => onConfirmar(forma, recebido)}>Confirmar recebimento</Button>
        </div>
      </Card>
    </div>
  );
}

// ---- Modal ⚙️: tipos de delivery + tempos de preparo + retenção do histórico ----
const TIPOS_DELIVERY: { key: string; label: string; desc: string; def: boolean }[] = [
  { key: 'tipoDelivery', label: 'Delivery (entrega)', desc: 'Cliente pede para receber em casa.', def: true },
  { key: 'tipoRetirada', label: 'Retirar na loja', desc: 'Cliente busca o pedido no balcão.', def: false },
  { key: 'tipoLocal', label: 'Consumir no local', desc: 'Para lojas com salão.', def: false },
];
function ConfigModal({ cfg, onToggle, loja, onTipo, pode, onClose }: { cfg: any; onToggle: (patch: any) => void; loja: any; onTipo: (patch: any) => void; pode: boolean; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-t-2xl bg-background p-4 shadow-xl sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-base font-bold">Configurações do delivery</h3>
          <button type="button" onClick={onClose} className="text-muted-foreground hover:text-foreground" aria-label="Fechar">✕</button>
        </div>

        <div className="mb-3 border-b border-border pb-3">
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Tipos de delivery</p>
          <p className="mb-2 text-xs text-muted-foreground">O que o cliente pode escolher no cardápio digital.</p>
          <div className="flex flex-col gap-2">
            {TIPOS_DELIVERY.map((t) => (
              <label key={t.key} className={`flex items-center gap-2 text-sm ${pode ? '' : 'opacity-60'}`}>
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-primary"
                  disabled={!pode || !loja}
                  checked={loja && loja[t.key] != null ? !!loja[t.key] : t.def}
                  onChange={(e) => onTipo({ [t.key]: e.target.checked })}
                />
                <span>{t.label}<span className="ml-1 text-xs text-muted-foreground">— {t.desc}</span></span>
              </label>
            ))}
          </div>
        </div>

        <label className="mb-3 flex items-start gap-2 border-b border-border pb-3 text-sm">
          <input type="checkbox" className="mt-0.5 h-4 w-4 accent-primary" disabled={!pode} checked={!!cfg.qrDespacho} onChange={(e) => onToggle({ qrDespacho: e.target.checked })} />
          <span>
            Usar QR no cupom do entregador
            <span className="block text-xs text-muted-foreground">Ligado: o entregador lê o QR do cupom e despacha sozinho. Desligado: ao avançar, você escolhe o entregador na lista.</span>
          </span>
        </label>

        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Tempos de preparo</p>
        <PrepTempoCard cfg={cfg} podeEditar={pode} onSave={onToggle} />

        <label className="mt-3 flex flex-wrap items-center gap-2 border-t border-border pt-3 text-sm">
          <span className="font-medium">Manter finalizados no histórico por</span>
          <input
            type="number"
            min={1}
            max={240}
            disabled={!pode}
            value={cfg.finalizadoHoras ?? 5}
            onChange={(e) => onToggle({ finalizadoHoras: Number(e.target.value) || 5 })}
            className="h-8 w-16 rounded-md border border-input bg-card px-2 text-sm"
          />
          <span>horas</span>
        </label>

        <div className="mt-4 flex justify-end">
          <Button type="button" size="sm" onClick={onClose}>Fechar</Button>
        </div>
      </div>
    </div>
  );
}

// ---- Editor de tempos de preparo (balcão/delivery min–max + setor) ----
function PrepTempoCard({ cfg, podeEditar, onSave }: { cfg: any; podeEditar: boolean; onSave: (patch: any) => void }) {
  const [editando, setEditando] = useState(false);
  const [bMin, setBMin] = useState('');
  const [bMax, setBMax] = useState('');
  const [dMin, setDMin] = useState('');
  const [dMax, setDMax] = useState('');
  const [setorId, setSetorId] = useState('');
  const [setores, setSetores] = useState<any[]>([]);
  useEffect(() => {
    api.setores().then((r: any) => setSetores(r ?? [])).catch(() => {});
  }, []);
  const setorNome = setores.find((s) => s.id === cfg?.setorId)?.nome;
  function abrir() {
    setBMin(String(cfg?.prepBalcaoMin ?? 15));
    setBMax(String(cfg?.prepBalcaoMax ?? 25));
    setDMin(String(cfg?.prepDeliveryMin ?? 45));
    setDMax(String(cfg?.prepDeliveryMax ?? 55));
    setSetorId(cfg?.setorId ?? '');
    setEditando(true);
  }
  function salvar() {
    onSave({
      prepBalcaoMin: Number(bMin) || 0, prepBalcaoMax: Number(bMax) || 0,
      prepDeliveryMin: Number(dMin) || 0, prepDeliveryMax: Number(dMax) || 0,
      setorId: setorId || null,
    });
    setEditando(false);
  }
  return (
    <div className="rounded-lg border border-border bg-card p-2.5 text-xs">
      {!editando ? (
        <div className="flex flex-wrap items-center gap-2">
          <span><strong>Balcão:</strong> {cfg?.prepBalcaoMin ?? 15} a {cfg?.prepBalcaoMax ?? 25} min</span>
          <span className="text-muted-foreground">·</span>
          <span><strong>Delivery:</strong> {cfg?.prepDeliveryMin ?? 45} a {cfg?.prepDeliveryMax ?? 55} min</span>
          {setorNome && (<><span className="text-muted-foreground">·</span><span><strong>Setor:</strong> {setorNome}</span></>)}
          {podeEditar && <button type="button" className="ml-auto font-semibold text-primary" onClick={abrir}>Editar</button>}
        </div>
      ) : (
        <div className="space-y-2">
          <div className="flex items-center gap-1"><span className="w-16">Balcão</span>
            <Input value={bMin} onChange={(e) => setBMin(e.target.value)} inputMode="numeric" className="h-7" />
            <span>a</span>
            <Input value={bMax} onChange={(e) => setBMax(e.target.value)} inputMode="numeric" className="h-7" /><span>min</span>
          </div>
          <div className="flex items-center gap-1"><span className="w-16">Delivery</span>
            <Input value={dMin} onChange={(e) => setDMin(e.target.value)} inputMode="numeric" className="h-7" />
            <span>a</span>
            <Input value={dMax} onChange={(e) => setDMax(e.target.value)} inputMode="numeric" className="h-7" /><span>min</span>
          </div>
          <div className="flex items-center gap-1">
            <span className="w-16">Setor</span>
            <select value={setorId} onChange={(e) => setSetorId(e.target.value)} className="h-7 flex-1 rounded-md border border-input bg-card px-2" aria-label="Setor de produção do delivery">
              <option value="">— nenhum —</option>
              {setores.map((s) => (<option key={s.id} value={s.id}>{s.nome}</option>))}
            </select>
          </div>
          <div className="flex gap-1.5">
            <Button type="button" size="sm" variant="ghost" className="flex-1" onClick={() => setEditando(false)}>Cancelar</Button>
            <Button type="button" size="sm" className="flex-1" onClick={salvar}>Salvar</Button>
          </div>
        </div>
      )}
    </div>
  );
}
