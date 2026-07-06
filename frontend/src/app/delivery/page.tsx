'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, getToken, getCategoria } from '@/lib/api';
import { toast } from '@/lib/toast';
import { Shell } from '@/components/app-shell/shell';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { CaixaPanel } from '@/components/pdv/caixa-panel';

/* eslint-disable @typescript-eslint/no-explicit-any */
const brl = (n: number) =>
  Number(n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const hora = (d?: string) =>
  d ? new Date(d).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '—';

const CANAL_LABEL: Record<string, string> = {
  ifood: 'iFood',
  cardapio: 'Cardápio',
  totem: 'Totem',
  whatsapp: 'WhatsApp',
};

// Colunas do quadro. `status` = quais estados do pedido caem na coluna.
const COLUNAS = [
  { key: 'chegada', titulo: 'Chegada', dica: 'aguardando aceite', cor: 'var(--info)', status: ['novo'] },
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
  const cat = getCategoria();
  const isGestor = ['presidente', 'gerente', 'supervisao'].includes(cat ?? '');
  const [pedidos, setPedidos] = useState<any[] | null>(null);
  const [cfg, setCfg] = useState<any>({ ativo: false, autoAceitar: false, colunas: { chegada: true, producao: true, rota: true, finalizado: true } });
  const [caixa, setCaixa] = useState<any>(null);
  const [erro, setErro] = useState('');
  const [filtros, setFiltros] = useState<Record<string, Filtro | null>>({});
  const [menuAberto, setMenuAberto] = useState<string | null>(null);
  const [configQuadro, setConfigQuadro] = useState(false);
  const [despacho, setDespacho] = useState<any>(null);
  const cfgRef = useRef(cfg);
  cfgRef.current = cfg;

  const reload = useCallback(async () => {
    try {
      const [ps, c, cx] = await Promise.all([
        api.deliveryPedidos(),
        api.deliveryConfig().catch(() => cfgRef.current),
        api.caixaAberta('delivery').catch(() => null),
      ]);
      setPedidos(ps as any[]);
      setCfg(c);
      setCaixa(cx);
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
    const t = setInterval(reload, 15000);
    return () => clearInterval(t);
  }, [reload, router]);

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

  function avancar(p: any) {
    // Despachar uma entrega abre o modal p/ escolher o entregador.
    if (p.status === 'pronto' && p.tipo !== 'retirada') {
      setDespacho(p);
      return;
    }
    acao(api.avancarDelivery(p.id), 'Status atualizado.');
  }

  function cancelar(p: any) {
    const m = window.prompt('Motivo do cancelamento:') ?? undefined;
    if (m !== undefined) acao(api.cancelarDelivery(p.id, m || undefined), 'Pedido cancelado.');
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
        .filter((p) => passaFiltro(p, filtros[col.key] ?? null));
    }
    return map;
  }, [pedidos, filtros]);

  const novosPendentes = (pedidos ?? []).filter((p) => p.status === 'novo').length;

  return (
    <Shell eyebrow="Delivery · central de entregas" title="Delivery">
      <div className="space-y-4">
        {erro && <p className="text-destructive">{erro}</p>}

        {/* Caixa próprio do delivery (fora do quadro) */}
        {(isGestor || cat === 'atendente') && (
          <CaixaPanel
            caixa={caixa}
            onChange={reload}
            origem="delivery"
            avisoVazio="Nenhum caixa de entregas aberto — abra para controlar troco e dinheiro na entrega."
          />
        )}

        {/* Barra de controle — FORA do quadro, sempre acessível */}
        <Card className="flex flex-wrap items-center gap-x-4 gap-y-2 p-3">
          <span className="font-display text-sm font-bold">Quadro de entregas</span>
          {novosPendentes > 0 && (
            <span className="rounded-full bg-info/15 px-2 py-0.5 text-xs font-bold text-info">
              {novosPendentes} novo(s) aguardando aceite
            </span>
          )}
          {isGestor && (
            <>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={!!cfg.ativo} onChange={(e) => toggleCfg({ ativo: e.target.checked })} className="h-4 w-4 accent-primary" />
                Delivery ativo
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={!!cfg.autoAceitar} onChange={(e) => toggleCfg({ autoAceitar: e.target.checked })} className="h-4 w-4 accent-primary" />
                Aceitar automaticamente
              </label>
            </>
          )}
          <div className="ml-auto flex gap-1.5">
            <Button type="button" variant="outline" size="sm" onClick={() => setConfigQuadro(true)}>
              ⚙️ Configurar quadro
            </Button>
            {isGestor && (
              <Button type="button" variant="outline" size="sm" onClick={() => acao(api.simularDelivery({ produto: 'Combo delivery', preco: 39.9 }), 'Pedido simulado recebido.')}>
                Simular pedido
              </Button>
            )}
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
                <div key={col.key} className="flex min-w-[290px] max-w-[320px] flex-1 flex-col">
                  {/* Cabeçalho da coluna */}
                  <div className="mb-2 rounded-lg border border-border bg-card p-2.5">
                    <div className="flex items-center gap-2">
                      <span className="h-2.5 w-2.5 rounded-full" style={{ background: `hsl(${col.cor})` }} />
                      <span className="font-display text-sm font-bold">{col.titulo}</span>
                      <span className="font-mono text-xs text-muted-foreground">{lista.length}</span>
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
                        p={p}
                        isGestor={isGestor}
                        onAceitar={() => acao(api.aceitarDelivery(p.id), 'Pedido aceito e enviado à produção.')}
                        onAvancar={() => avancar(p)}
                        onCancelar={() => cancelar(p)}
                      />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Modal: configurar visibilidade das colunas */}
      {configQuadro && (
        <div className="fixed inset-0 z-40 grid place-items-center bg-black/50 p-4" onClick={() => setConfigQuadro(false)}>
          <Card className="w-full max-w-sm p-5" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-display font-semibold">Configurar quadro</h3>
            <p className="mb-3 mt-0.5 text-xs text-muted-foreground">
              Escolha quais colunas ficam visíveis. {isGestor ? '' : 'Só um gestor pode salvar.'}
            </p>
            <div className="space-y-2">
              {COLUNAS.map((c) => (
                <label key={c.key} className={`flex items-center gap-2 rounded-lg border border-border p-2.5 text-sm ${isGestor ? '' : 'opacity-60'}`}>
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-primary"
                    disabled={!isGestor}
                    checked={cfg.colunas ? cfg.colunas[c.key] !== false : true}
                    onChange={(e) => toggleCfg({ colunas: { ...(cfg.colunas ?? {}), [c.key]: e.target.checked } })}
                  />
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: `hsl(${c.cor})` }} />
                  <span className="font-medium">{c.titulo}</span>
                  <span className="text-xs text-muted-foreground">· {c.dica}</span>
                </label>
              ))}
            </div>
            <Button type="button" className="mt-4 w-full" onClick={() => setConfigQuadro(false)}>Concluir</Button>
          </Card>
        </div>
      )}

      {/* Modal: despachar (escolher entregador) */}
      {despacho && (
        <DespachoModal
          pedido={despacho}
          onFechar={() => setDespacho(null)}
          onConfirmar={async (nome) => {
            await acao(api.avancarDelivery(despacho.id, { entregadorNome: nome }), 'Pedido despachado.');
            setDespacho(null);
          }}
        />
      )}
    </Shell>
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
  const [campo, setCampo] = useState(atual?.campo ?? 'entregador');
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

// ---- Modal de despacho: atribui o entregador ----
function DespachoModal({
  pedido,
  onFechar,
  onConfirmar,
}: {
  pedido: any;
  onFechar: () => void;
  onConfirmar: (nome: string) => void;
}) {
  const [nome, setNome] = useState('');
  return (
    <div className="fixed inset-0 z-40 grid place-items-center bg-black/50 p-4" onClick={onFechar}>
      <Card className="w-full max-w-sm p-5" onClick={(e) => e.stopPropagation()}>
        <h3 className="font-display font-semibold">Despachar {pedido.displayId ?? 'pedido'}</h3>
        <p className="mb-3 mt-0.5 text-xs text-muted-foreground">Quem vai levar? (habilita o filtro por entregador)</p>
        <div className="space-y-1">
          <Label className="text-xs">Entregador</Label>
          <Input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Nome do entregador" autoFocus />
        </div>
        <div className="mt-4 flex gap-2">
          <Button type="button" variant="ghost" className="flex-1" onClick={onFechar}>Cancelar</Button>
          <Button type="button" className="flex-1" onClick={() => onConfirmar(nome.trim())}>Despachar</Button>
        </div>
      </Card>
    </div>
  );
}

// ---- Card de pedido ----
function PedidoCard({
  p,
  isGestor,
  onAceitar,
  onAvancar,
  onCancelar,
}: {
  p: any;
  isGestor: boolean;
  onAceitar: () => void;
  onAvancar: () => void;
  onCancelar: () => void;
}) {
  const s = STATUS[p.status] ?? { label: p.status, cor: '' };
  const finalizado = p.status === 'concluido' || p.status === 'cancelado';
  const enderecoFmt = p.enderecoRua
    ? `${p.enderecoRua}${p.enderecoNumero ? `, ${p.enderecoNumero}` : ''}${p.enderecoBairro ? ` · ${p.enderecoBairro}` : ''}`
    : p.endereco;
  return (
    <div className={`rounded-lg border bg-card p-3 ${p.autoAceiteFalhou ? 'border-destructive/60' : 'border-border'}`}>
      {p.autoAceiteFalhou && (
        <p className="mb-2 rounded bg-destructive/10 px-2 py-1 text-[11px] font-bold text-destructive">
          ⚠️ Falha no aceite automático — revise e aceite manualmente
        </p>
      )}
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="font-semibold">{p.displayId ?? 'Pedido'}</span>
        <span className={`rounded px-1.5 py-0.5 text-[11px] ${s.cor}`}>{s.label}</span>
        <span className="rounded bg-secondary px-1.5 py-0.5 text-[11px] text-muted-foreground">{CANAL_LABEL[p.canal] ?? p.canal}</span>
        <span className="ml-auto font-mono text-sm font-bold">{brl(Number(p.total))}</span>
      </div>

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
      </div>

      {/* Cliente + endereço */}
      <div className="mt-1 text-xs text-muted-foreground">
        <span className="capitalize">{p.tipo}</span>
        {p.clienteNome ? ` · ${p.clienteNome}` : ''}
        {enderecoFmt ? ` · ${enderecoFmt}` : ''}
        {p.enderecoReferencia ? ` (${p.enderecoReferencia})` : ''}
      </div>
      {p.entregadorNome && <div className="mt-0.5 text-xs font-medium">🛵 {p.entregadorNome}</div>}
      {p.agendamento && <div className="mt-0.5 text-xs text-info">agendado p/ {hora(p.agendamento)}</div>}

      {/* Itens */}
      <div className="mt-1.5 space-y-0.5 border-t border-border pt-1.5">
        {(p.itens ?? []).map((it: any, k: number) => (
          <div key={k} className="text-xs">
            <span className="font-medium">{Number(it.quantidade)}× {it.descricao}</span>
            {it.observacao && <span className="text-muted-foreground"> · {it.observacao}</span>}
          </div>
        ))}
      </div>

      {p.status === 'cancelado' && p.motivoCancelamento && (
        <p className="mt-1 text-[11px] text-destructive">Motivo: {p.motivoCancelamento}</p>
      )}

      {/* Ações */}
      {!finalizado && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {p.status === 'novo' && (
            <Button type="button" size="sm" onClick={onAceitar}>Aceitar</Button>
          )}
          {AVANCAR[p.status] && (
            <Button type="button" size="sm" variant="outline" onClick={onAvancar}>{AVANCAR[p.status]}</Button>
          )}
          {isGestor && (
            <Button type="button" size="sm" variant="ghost" className="text-destructive" onClick={onCancelar}>Cancelar</Button>
          )}
        </div>
      )}
      <p className="mt-1.5 text-right font-mono text-[10px] text-muted-foreground">{hora(p.criadoEm)}</p>
    </div>
  );
}
