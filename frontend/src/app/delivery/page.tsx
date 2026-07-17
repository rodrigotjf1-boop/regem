'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, getToken, getCategoria } from '@/lib/api';
import { toast } from '@/lib/toast';
import { Shell } from '@/components/app-shell/shell';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { CaixaPanel } from '@/components/pdv/caixa-panel';
import { PedidoDetalhe } from '@/components/delivery/pedido-detalhe';
import { NovoPedido } from '@/components/delivery/novo-pedido';
import { ConfigPanel } from '@/components/delivery/config-panel';

/* eslint-disable @typescript-eslint/no-explicit-any */
const brl = (n: number) =>
  Number(n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const hora = (d?: string) =>
  d ? new Date(d).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '—';
// Contador HH:MM:SS a partir de ms restantes (null quando estourou).
const countdown = (ms: number) => {
  if (ms <= 0) return null;
  const s = Math.floor(ms / 1000);
  const p2 = (n: number) => String(n).padStart(2, '0');
  return `${p2(Math.floor(s / 3600))}:${p2(Math.floor((s % 3600) / 60))}:${p2(s % 60)}`;
};

const CANAL_LABEL: Record<string, string> = {
  ifood: 'iFood',
  cardapio: 'Cardápio',
  totem: 'Totem',
  whatsapp: 'WhatsApp',
  manual: 'Manual',
};
// Cor do chip por plataforma (cor predominante da marca). Cardápio usa a cor da
// marca Regem (dourado/primária); demais integrações, a cor da própria plataforma.
const CANAL_ESTILO: Record<string, { bg: string; fg: string }> = {
  ifood: { bg: '#EA1D2C', fg: '#FFFFFF' },
  whatsapp: { bg: '#25D366', fg: '#0B241B' },
  totem: { bg: '#334155', fg: '#FFFFFF' },
  ubereats: { bg: '#06C167', fg: '#0B241B' },
  rappi: { bg: '#FF4E1B', fg: '#FFFFFF' },
  '99food': { bg: '#FFD400', fg: '#0B141B' },
};

// Colunas do quadro. `status` = quais estados do pedido caem na coluna.
const COLUNAS = [
  { key: 'chegada', titulo: 'Em análise', dica: 'aguardando aceite', cor: 'var(--info)', status: ['novo'] },
  { key: 'producao', titulo: 'Produção', dica: 'preparando', cor: 'var(--warn)', status: ['confirmado', 'pronto'] },
  { key: 'rota', titulo: 'Em rota', dica: 'saiu para entrega', cor: 'var(--primary)', status: ['despachado'] },
  { key: 'finalizado', titulo: 'Finalizado', dica: 'concluído/cancelado', cor: 'var(--muted-foreground)', status: ['concluido', 'cancelado'] },
] as const;

const STATUS: Record<string, { label: string; cor: string }> = {
  novo: { label: 'Novo', cor: 'bg-info/10 text-info' },
  confirmado: { label: 'Em produção', cor: 'bg-warn/10 text-warn' },
  pronto: { label: 'Pronto', cor: 'bg-ok/10 text-ok' },
  despachado: { label: 'Em rota', cor: 'bg-primary/10 text-primary' },
  concluido: { label: 'Concluído', cor: 'bg-secondary text-muted-foreground' },
  cancelado: { label: 'Cancelado', cor: 'bg-destructive/10 text-destructive' },
};
const AVANCAR: Record<string, string> = {
  confirmado: 'Marcar pronto',
  pronto: 'Despachar',
  despachado: 'Concluir',
};

// Campos de filtro por coluna (menu ancorado).
const CAMPOS = [
  { key: 'entregador', label: 'Entregador' },
  { key: 'bairro', label: 'Bairro' },
  { key: 'forma', label: 'Forma de pagamento' },
  { key: 'numero', label: 'Nº do pedido' },
] as const;

type Filtro = { campo: string; valor: string };

export default function DeliveryPage() {
  const router = useRouter();
  // Categoria vem do localStorage (cliente). Só depois de montar para não
  // divergir do HTML do servidor (evita erro de hidratação).
  const [cat, setCat] = useState<string | null>(null);
  const isGestor = ['presidente', 'gerente', 'supervisao'].includes(cat ?? '');
  const [pedidos, setPedidos] = useState<any[] | null>(null);
  const [cfg, setCfg] = useState<any>({ ativo: false, autoAceitar: false, colunas: { chegada: true, producao: true, rota: true, finalizado: true } });
  const [caixa, setCaixa] = useState<any>(null);
  const [erro, setErro] = useState('');
  const [filtros, setFiltros] = useState<Record<string, Filtro | null>>({});
  const [menuAberto, setMenuAberto] = useState<string | null>(null);
  const [configQuadro, setConfigQuadro] = useState(false);
  const [despacho, setDespacho] = useState<any>(null);
  const [detalhe, setDetalhe] = useState<any>(null);
  const [entregadores, setEntregadores] = useState<any[]>([]);
  const [tipoFiltro, setTipoFiltro] = useState<'todos' | 'entrega' | 'retirada'>('todos');
  const [novoPedido, setNovoPedido] = useState(false);
  const [pausarOpen, setPausarOpen] = useState(false);
  const [agora, setAgora] = useState(() => Date.now());
  // Alerta sonoro de pedido novo (o navegador exige um clique antes de tocar áudio).
  const [somAtivo, setSomAtivo] = useState(false);
  const audioRef = useRef<AudioContext | null>(null);
  const prevNovosRef = useRef<number | null>(null);
  const [piscar, setPiscar] = useState(false);
  const [atendimentos, setAtendimentos] = useState<any[]>([]);
  const [atendAberto, setAtendAberto] = useState(false);
  const [roboAtivo, setRoboAtivo] = useState(false); // status geral do robô (cardapio_config.roboAtivo)
  const cfgRef = useRef(cfg);
  cfgRef.current = cfg;

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
      if (lc) setRoboAtivo(!!(lc as any).roboAtivo);
      // Mantém o painel de detalhe sincronizado com os dados novos.
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
    const c = setInterval(() => setAgora(Date.now()), 1000); // contador "prepare em até"
    return () => { clearInterval(t); clearInterval(c); };
  }, [reload, router]);

  // Preferência de som (o áudio em si só destrava no 1º clique do usuário).
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
    garantirAudio(); // o clique é o gesto que destrava o áudio no navegador
    setSomAtivo(ligar);
    try { localStorage.setItem('som_pedido', ligar ? '1' : '0'); } catch {}
    if (ligar) tocarBeep();
  }

  async function acao(fn: Promise<any>, ok: string) {
    try {
      await fn;
      toast.success(ok);
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

  // Liga/desliga o robô de atendimento (geral, para qualquer cliente que mande msg).
  async function toggleRobo() {
    const novo = !roboAtivo;
    setRoboAtivo(novo); // otimista
    try {
      await api.setCardapioConfig({ roboAtivo: novo });
      toast.success(novo ? 'Robô online — respondendo os clientes.' : 'Robô offline — não responde os clientes.');
    } catch (e) {
      setRoboAtivo(!novo); // reverte em erro
      toast.error(e instanceof Error ? e.message : 'Erro ao salvar');
    }
  }

  function avancar(p: any) {
    // Despachar uma entrega abre o modal p/ escolher o entregador.
    if (p.status === 'pronto' && p.tipo !== 'retirada') {
      setDespacho(p);
      return;
    }
    acao(api.avancarDelivery(p.id), 'Status atualizado.');
  }

  function retornar(p: any) {
    acao(api.retornarDelivery(p.id), 'Pedido voltou para a produção.');
  }

  // Aplica o filtro da coluna a um pedido.
  function passaFiltro(p: any, f: Filtro | null) {
    if (!f || !f.valor.trim()) return true;
    const v = f.valor.trim().toLowerCase();
    const alvo =
      f.campo === 'entregador' ? p.entregadorNome
      : f.campo === 'bairro' ? p.enderecoBairro ?? p.endereco
      : f.campo === 'forma' ? p.formaPagamento
      : `${p.displayId ?? ''} ${p.externalId ?? ''}`;
    return String(alvo ?? '').toLowerCase().includes(v);
  }

  const colunasVisiveis = useMemo(
    () => COLUNAS.filter((c) => (cfg.colunas ? cfg.colunas[c.key] !== false : true)),
    [cfg.colunas],
  );

  const porColuna = useMemo(() => {
    const map: Record<string, any[]> = {};
    for (const col of COLUNAS) {
      map[col.key] = (pedidos ?? [])
        .filter((p) => (col.status as readonly string[]).includes(p.status))
        .filter((p) => tipoFiltro === 'todos' || p.tipo === tipoFiltro)
        .filter((p) => passaFiltro(p, filtros[col.key] ?? null));
    }
    return map;
  }, [pedidos, filtros, tipoFiltro]);

  const novosPendentes = (pedidos ?? []).filter((p) => p.status === 'novo').length;
  // Chegou pedido novo (a contagem subiu entre recargas): toca o som + pisca.
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

  return (
    <Shell eyebrow="Delivery · central de entregas" title="Delivery">
      <div className="space-y-4">
        {erro && <p className="text-destructive">{erro}</p>}

        {/* Banner de pausa */}
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

        {/* Header integrado (fino): caixa do delivery + controles do quadro */}
        <Card className="px-3 py-2">
          {(isGestor || cat === 'atendente') && (
            <div className="mb-2 border-b border-border pb-2">
              <CaixaPanel
                caixa={caixa}
                onChange={reload}
                origem="delivery"
                embedded
                avisoVazio="Caixa de entregas fechado — abra para controlar troco e dinheiro na entrega."
              />
            </div>
          )}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          {/* Filtro geral por tipo de pedido */}
          <div className="inline-flex rounded-lg border border-border p-0.5 text-sm" role="group" aria-label="Filtrar por tipo">
            {([['todos', 'Todos'], ['entrega', '🛵'], ['retirada', '🏪']] as const).map(([k, lb]) => {
              const ativo = tipoFiltro === k;
              return (
                <button
                  key={k}
                  type="button"
                  onClick={() => setTipoFiltro(k)}
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
            {isGestor && (
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
            <Button type="button" variant="outline" size="sm" className="h-8 px-2.5 text-sm" onClick={() => setConfigQuadro(true)}>⚙️</Button>
            {isGestor && (
              <Button type="button" variant="ghost" size="sm" className="h-8 text-sm" onClick={() => acao(api.simularDelivery({ produto: 'Combo delivery', preco: 39.9 }), 'Pedido simulado recebido.')}>
                Simular
              </Button>
            )}
          </div>
          </div>
        </Card>

        {!pedidos ? (
          <p className="text-sm text-muted-foreground">Carregando…</p>
        ) : colunasVisiveis.length === 0 ? (
          <Card className="p-8 text-center text-sm text-muted-foreground">
            Todas as colunas estão ocultas. Use <strong>⚙️ Configurar quadro</strong> para exibir alguma.
          </Card>
        ) : (
          <div className="flex gap-3 overflow-x-auto pb-2">
            {colunasVisiveis.map((col) => {
              const lista = porColuna[col.key] ?? [];
              const f = filtros[col.key] ?? null;
              const filtroAberto = menuAberto === col.key;
              return (
                <div
                  key={col.key}
                  className="flex min-w-[290px] max-w-[330px] flex-1 flex-col rounded-xl p-2"
                  style={{ background: `hsl(${col.cor} / 0.05)` }}
                >
                  {/* Cabeçalho da coluna */}
                  <div className="mb-2 rounded-lg px-2.5 py-2" style={{ background: `hsl(${col.cor} / 0.14)` }}>
                    <div className="flex items-center gap-2">
                      <span className="h-3 w-3 rounded-full" style={{ background: `hsl(${col.cor})` }} />
                      <span className="font-display text-base font-bold tracking-tight">{col.titulo}</span>
                      <span className="grid h-5 min-w-5 place-items-center rounded-full px-1 font-mono text-xs font-bold text-white" style={{ background: `hsl(${col.cor})` }}>{lista.length}</span>
                      <div className="relative ml-auto">
                        <button
                          type="button"
                          onClick={() => setMenuAberto(filtroAberto ? null : col.key)}
                          className={`rounded-md border px-2 py-1 text-xs ${f ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:border-primary/50'}`}
                          aria-expanded={filtroAberto}
                          aria-label={`Filtrar coluna ${col.titulo}`}
                        >
                          ⧩ Filtrar{f ? ' •' : ''}
                        </button>
                        {menuAberto === col.key && (
                          <FiltroMenu
                            atual={f}
                            onAplicar={(nf) => { setFiltros((s) => ({ ...s, [col.key]: nf })); setMenuAberto(null); }}
                            onLimpar={() => { setFiltros((s) => ({ ...s, [col.key]: null })); setMenuAberto(null); }}
                            onFechar={() => setMenuAberto(null)}
                          />
                        )}
                      </div>
                    </div>
                    <p className="mt-0.5 pl-4 text-[11px] text-muted-foreground">{col.dica}</p>
                  </div>

                  {/* Tempo de espera (topo da coluna "Em análise") */}
                  {col.key === 'chegada' && (
                    <PrepTempoCard cfg={cfg} podeEditar={isGestor} onSave={toggleCfg} />
                  )}

                  {/* Cards */}
                  <div className="flex flex-col gap-2">
                    {lista.length === 0 && (
                      <p className="rounded-lg border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
                        {f ? 'Nenhum pedido no filtro.' : 'Vazio.'}
                      </p>
                    )}
                    {lista.map((p) => (
                      <PedidoCard
                        key={p.id}
                        cfg={cfg}
                        agora={agora}
                        p={p}
                        onAbrir={() => setDetalhe(p)}
                        onAceitar={() => acao(api.aceitarDelivery(p.id), 'Pedido aceito e enviado à produção.')}
                        onAvancar={() => avancar(p)}
                        onRetornar={() => retornar(p)}
                        onNf={() => acao(api.nfDelivery(p.id), 'NF emitida.')}
                      />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Painel de configurações (menu lateral) */}
      {configQuadro && (
        <ConfigPanel
          deliveryCfg={cfg}
          onDeliveryToggle={toggleCfg}
          isGestor={isGestor}
          onClose={() => setConfigQuadro(false)}
        />
      )}

      {/* Modal: despachar (escolher entregador) */}
      {despacho && (
        <DespachoModal
          pedido={despacho}
          entregadores={entregadores}
          onFechar={() => setDespacho(null)}
          onConfirmar={async (ent) => {
            await acao(api.avancarDelivery(despacho.id, ent), 'Pedido despachado.');
            setDespacho(null);
          }}
        />
      )}

      {/* Painel flutuante: detalhe do pedido (reimprimir/alterar/cancelar) */}
      {detalhe && (
        <PedidoDetalhe pedido={detalhe} onClose={() => setDetalhe(null)} onChanged={reload} />
      )}

      {/* Novo pedido manual */}
      {novoPedido && <NovoPedido onFechar={() => setNovoPedido(false)} onCriado={reload} />}

      {/* Painel de chamados de atendimento (handoff do robô) */}
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

// ---- Painel de chamados de atendimento ----
const TIPO_ATEND: Record<string, string> = {
  mudanca: '✏️ Mudança no pedido',
  erro: '⚠️ Erro no recebimento',
  humano: '🙋 Falar com atendente',
  cancelamento: '🚫 Pedido de cancelamento',
  outro: '💬 Atendimento',
};
function AtendimentoPanel({
  lista,
  onFechar,
  onResolver,
  onDecidir,
}: {
  lista: any[];
  onFechar: () => void;
  onResolver: (id: string) => void;
  onDecidir: (id: string, aceita: boolean, senha?: string) => void;
}) {
  const [cancelId, setCancelId] = useState<string | null>(null); // chamado expandido p/ aceitar
  const [senha, setSenha] = useState('');
  const wpp = (tel?: string) => {
    const d = String(tel ?? '').replace(/\D/g, '');
    const num = d.length === 10 || d.length === 11 ? `55${d}` : d;
    return num ? `https://wa.me/${num}` : '#';
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
                  <a href={wpp(c.telefone)} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="rounded-md bg-ok/10 px-2.5 py-1 text-xs font-semibold text-ok hover:bg-ok/20">💬 Responder no WhatsApp</a>
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
                  <input
                    type="password"
                    value={senha}
                    onChange={(e) => setSenha(e.target.value)}
                    placeholder="Senha do gestor"
                    className="h-8 flex-1 rounded border border-border bg-background px-2 text-sm"
                  />
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

// ---- Menu de filtro ancorado (popover) ----
function FiltroMenu({
  atual,
  onAplicar,
  onLimpar,
  onFechar,
}: {
  atual: Filtro | null;
  onAplicar: (f: Filtro) => void;
  onLimpar: () => void;
  onFechar: () => void;
}) {
  const [campo, setCampo] = useState(atual?.campo ?? 'numero');
  const [valor, setValor] = useState(atual?.valor ?? '');
  return (
    <>
      <button type="button" className="fixed inset-0 z-40 cursor-default" aria-label="Fechar" onClick={onFechar} />
      <div className="absolute right-0 top-full z-50 mt-1 w-60 rounded-lg border border-border bg-card p-3 shadow-lg">
        <p className="mb-2 text-xs font-semibold text-muted-foreground">Filtrar por</p>
        <div className="space-y-2">
          <select
            value={campo}
            onChange={(e) => setCampo(e.target.value)}
            aria-label="Campo do filtro"
            className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
          >
            {CAMPOS.map((c) => (
              <option key={c.key} value={c.key}>{c.label}</option>
            ))}
          </select>
          <Input
            value={valor}
            onChange={(e) => setValor(e.target.value)}
            placeholder={campo === 'numero' ? 'Ex.: 1234' : 'Digite para filtrar'}
            autoFocus
            onKeyDown={(e) => { if (e.key === 'Enter' && valor.trim()) onAplicar({ campo, valor }); }}
          />
        </div>
        <div className="mt-3 flex gap-2">
          <Button type="button" variant="ghost" size="sm" className="flex-1" onClick={onLimpar}>Limpar</Button>
          <Button type="button" size="sm" className="flex-1" disabled={!valor.trim()} onClick={() => onAplicar({ campo, valor })}>Aplicar</Button>
        </div>
      </div>
    </>
  );
}

// ---- Modal de despacho: escolhe o entregador (função Entregador) ----
function DespachoModal({
  pedido,
  entregadores,
  onFechar,
  onConfirmar,
}: {
  pedido: any;
  entregadores: any[];
  onFechar: () => void;
  onConfirmar: (ent: { entregadorId?: string | null; entregadorNome: string; entregadorTelefone?: string | null }) => void;
}) {
  // "Nenhum" é a opção padrão predefinida quando não há entregador cadastrado.
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

// ---- Card de pedido (clicável → abre o detalhe) ----
function PedidoCard({
  p,
  cfg,
  agora,
  onAbrir,
  onAceitar,
  onAvancar,
  onRetornar,
  onNf,
}: {
  p: any;
  cfg: any;
  agora: number;
  onAbrir: () => void;
  onAceitar: () => void;
  onAvancar: () => void;
  onRetornar: () => void;
  onNf: () => void;
}) {
  const s = STATUS[p.status] ?? { label: p.status, cor: '' };
  const finalizado = p.status === 'concluido' || p.status === 'cancelado';
  const cancelado = p.status === 'cancelado';
  const enderecoFmt = p.enderecoRua
    ? `${p.enderecoRua}${p.enderecoNumero ? `, ${p.enderecoNumero}` : ''}${p.enderecoBairro ? ` · ${p.enderecoBairro}` : ''}`
    : p.endereco;
  // Ações não devem abrir o detalhe.
  const stop = (fn: () => void) => (e: React.MouseEvent) => { e.stopPropagation(); fn(); };
  // Contador "prepare em até" (só enquanto em análise/produção).
  const prepMax = p.tipo === 'retirada' ? cfg?.prepBalcaoMax ?? 25 : cfg?.prepDeliveryMax ?? 55;
  const emPreparo = ['novo', 'confirmado', 'pronto'].includes(p.status);
  const restanteMs = new Date(p.criadoEm).getTime() + prepMax * 60000 - agora;
  const cd = emPreparo ? countdown(restanteMs) : null;
  const atrasado = emPreparo && restanteMs <= 0;
  const mapa = enderecoFmt
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${enderecoFmt} ${p.enderecoBairro ?? ''}`)}`
    : null;
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onAbrir}
      onKeyDown={(e) => { if (e.key === 'Enter') onAbrir(); }}
      className={`cursor-pointer rounded-lg border bg-card p-3 text-left transition hover:border-primary/50 ${p.autoAceiteFalhou ? 'border-destructive/60' : 'border-border'}`}
    >
      {p.autoAceiteFalhou && (
        <p className="mb-2 rounded bg-destructive/10 px-2 py-1 text-[11px] font-bold text-destructive">
          ⚠️ Falha no aceite automático — revise e aceite manualmente
        </p>
      )}
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-xs">{p.tipo === 'retirada' ? '🏪' : '🛵'}</span>
        <span className={`font-semibold ${cancelado ? 'line-through opacity-70' : ''}`}>{p.displayId ?? 'Pedido'}</span>
        <span className={`rounded px-1.5 py-0.5 text-[11px] ${s.cor}`}>{s.label}</span>
        {p.alterado && <span className="rounded bg-warn/15 px-1.5 py-0.5 text-[10px] font-bold text-warn">ALTERADO</span>}
        {CANAL_ESTILO[p.canal] ? (
          <span className="rounded px-1.5 py-0.5 text-[11px] font-bold" style={{ background: CANAL_ESTILO[p.canal].bg, color: CANAL_ESTILO[p.canal].fg }}>
            {CANAL_LABEL[p.canal] ?? p.canal}
          </span>
        ) : p.canal === 'cardapio' ? (
          <span className="rounded bg-primary/15 px-1.5 py-0.5 text-[11px] font-bold text-primary">Cardápio</span>
        ) : (
          <span className="rounded bg-secondary px-1.5 py-0.5 text-[11px] text-muted-foreground">{CANAL_LABEL[p.canal] ?? p.canal}</span>
        )}
        <span className="ml-auto font-mono text-[11px] text-muted-foreground">{hora(p.criadoEm)}</span>
      </div>

      {/* Contador de preparo */}
      {emPreparo && (
        <div className={`mt-1.5 rounded px-2 py-1 text-center text-xs font-bold ${atrasado ? 'bg-destructive/10 text-destructive' : 'bg-info/10 text-info'}`}>
          {atrasado ? 'Atrasado — priorizar' : `Prepare em até ${cd}`}
        </div>
      )}

      {/* Pagamento */}
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px]">
        {p.pago ? (
          <span className="rounded bg-ok/10 px-1.5 py-0.5 font-bold text-ok">Pago</span>
        ) : (
          <span className="rounded bg-warn/10 px-1.5 py-0.5 font-bold text-warn">Paga na entrega</span>
        )}
        {p.formaPagamento && <span className="capitalize text-muted-foreground">{p.formaPagamento}</span>}
        {p.trocoPara != null && Number(p.trocoPara) > 0 && (
          <span className="text-muted-foreground">troco p/ {brl(Number(p.trocoPara))}</span>
        )}
        {Number(p.taxaEntrega) > 0 && <span className="text-muted-foreground">· taxa {brl(Number(p.taxaEntrega))}</span>}
        <span className="ml-auto font-mono text-sm font-bold text-foreground">{brl(Number(p.total))}</span>
      </div>

      {/* Cliente + endereço */}
      <div className="mt-1.5 flex items-start gap-1.5">
        {p.numero != null && (
          <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-secondary text-[10px] font-bold text-muted-foreground">{p.numero}</span>
        )}
        <div className={`min-w-0 flex-1 text-xs text-muted-foreground ${cancelado ? 'line-through' : ''}`}>
          <span className="text-sm font-bold text-foreground">{p.clienteNome ?? 'Cliente'}</span>
          {p.clientePedidosCount > 0 && (
            <span
              title={p.clientePedidosCount === 1 ? 'Primeiro pedido deste cliente' : 'Total de pedidos deste cliente'}
              className={`ml-1.5 inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 align-middle text-[10px] font-bold ${
                p.clientePedidosCount === 1 ? 'bg-emerald-500 text-white' : 'bg-primary/10 text-primary'
              }`}
            >
              🛍 {p.clientePedidosCount}
            </span>
          )}
          {p.clienteTelefone ? <span className="ml-1">· {p.clienteTelefone}</span> : null}
          {enderecoFmt ? <span className="block">{enderecoFmt}{p.enderecoReferencia ? ` (${p.enderecoReferencia})` : ''}</span> : null}
        </div>
        {mapa && (
          <a
            href={mapa}
            target="_blank"
            rel="noreferrer"
            onClick={(e) => e.stopPropagation()}
            title="Abrir no mapa"
            className="mt-0.5 shrink-0 rounded-md bg-primary/10 px-1.5 py-1 text-primary hover:bg-primary/20"
          >
            📍
          </a>
        )}
      </div>
      {p.entregadorNome && (
        <div className="mt-0.5 text-xs font-medium">
          🛵 {p.entregadorNome}{p.entregadorTelefone ? ` · 📞 ${p.entregadorTelefone}` : ''}
        </div>
      )}
      {p.agendamento && <div className="mt-0.5 text-xs text-info">agendado p/ {hora(p.agendamento)}</div>}

      {/* Itens */}
      <div className="mt-1.5 space-y-0.5 border-t border-border pt-1.5">
        {(p.itens ?? []).map((it: any, k: number) => (
          <div key={k} className={`text-xs ${cancelado ? 'line-through opacity-70' : ''}`}>
            <span className="font-medium">{Number(it.quantidade)}× {it.descricao}</span>
            {it.observacao && <span className="text-muted-foreground"> · {it.observacao}</span>}
          </div>
        ))}
      </div>

      {cancelado && p.motivoCancelamento && (
        <p className="mt-1 text-[11px] text-destructive">Cancelado — {p.motivoCancelamento}</p>
      )}

      {/* Ações */}
      {!finalizado && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {p.status === 'novo' && (
            <Button type="button" size="sm" onClick={stop(onAceitar)}>Aceitar</Button>
          )}
          {AVANCAR[p.status] && (
            <Button type="button" size="sm" variant="outline" onClick={stop(onAvancar)}>{AVANCAR[p.status]}</Button>
          )}
          {p.status === 'despachado' && (
            <Button type="button" size="sm" variant="ghost" onClick={stop(onRetornar)}>↩ Retornar à produção</Button>
          )}
          {p.comandaId && p.status !== 'novo' && (
            <Button type="button" size="sm" variant="ghost" className="ml-auto" onClick={stop(onNf)} title="Emitir nota fiscal">NF</Button>
          )}
        </div>
      )}
    </div>
  );
}

// ---- Card editável de tempo de preparo (topo da coluna "Em análise") ----
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
    <div className="mb-2 rounded-lg border border-border bg-card p-2.5 text-xs">
      {!editando ? (
        <div className="flex flex-wrap items-center gap-2">
          <span><strong>Balcão:</strong> {cfg?.prepBalcaoMin ?? 15} a {cfg?.prepBalcaoMax ?? 25} min</span>
          <span className="text-muted-foreground">·</span>
          <span><strong>Delivery:</strong> {cfg?.prepDeliveryMin ?? 45} a {cfg?.prepDeliveryMax ?? 55} min</span>
          {setorNome && (
            <>
              <span className="text-muted-foreground">·</span>
              <span><strong>Setor:</strong> {setorNome}</span>
            </>
          )}
          {podeEditar && (
            <button type="button" className="ml-auto font-semibold text-primary" onClick={abrir}>Editar</button>
          )}
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
            <select
              value={setorId}
              onChange={(e) => setSetorId(e.target.value)}
              className="h-7 flex-1 rounded-md border border-input bg-card px-2"
              aria-label="Setor de produção do delivery"
            >
              <option value="">— nenhum —</option>
              {setores.map((s) => (
                <option key={s.id} value={s.id}>{s.nome}</option>
              ))}
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
