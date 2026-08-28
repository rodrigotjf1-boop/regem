'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { toast } from '@/lib/toast';
import { Shell } from '@/components/app-shell/shell';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { CaixaPanel } from '@/components/pdv/caixa-panel';
import { PedidoDetalhe } from '@/components/delivery/pedido-detalhe';

/* eslint-disable @typescript-eslint/no-explicit-any */
const brl = (n: number) =>
  Number(n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const hora = (d?: string) =>
  d ? new Date(d).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '—';

const CANAL_LABEL: Record<string, string> = {
  ifood: 'iFood', cardapio: 'Cardápio', cardapio_web: 'Cardápio Web', anotaai: 'Anota Aí',
  keeta: 'Keeta', rappi: 'Rappi', '99food': '99Food', delivery_direto: 'Delivery Direto',
  manual: 'Manual', n8n: 'WhatsApp',
};
const CANAL_COR: Record<string, string> = {
  ifood: '#EA1D2C', rappi: '#FF4E1B', '99food': '#FFD400', anotaai: '#6C2BD9',
  cardapio_web: '#0F62FE', keeta: '#00B14F',
};

// Grupos de origem que o hub agrupa. Cada coluna só aparece se a origem está EM USO
// (integração conectada) ou tem pedido — ver `gruposVisiveis`.
const GRUPOS = [
  { key: 'regem', titulo: 'Cardápio Regem', dica: 'pedidos do seu cardápio', icone: '🟡' },
  { key: 'integrado', titulo: 'Cardápio integrado', dica: 'Anota Aí · Cardápio Web · Delivery Direto · Rappi', icone: '🔗' },
  { key: 'marketplace', titulo: 'Marketplaces', dica: 'iFood · 99Food · Keeta', icone: '🏬' },
  { key: 'totem', titulo: 'Totem GoGeM', dica: 'pedidos em dinheiro — cobrar no balcão', icone: '🕹️' },
] as const;

// Nº de colunas visíveis → classe de grid (Tailwind precisa de classes estáticas).
const GRID_COLS: Record<number, string> = {
  1: 'lg:grid-cols-1', 2: 'lg:grid-cols-2', 3: 'lg:grid-cols-3', 4: 'lg:grid-cols-4',
};

const STATUS_LABEL: Record<string, { txt: string; cls: string }> = {
  novo: { txt: 'Novo', cls: 'bg-info/10 text-info' },
  confirmado: { txt: 'Em preparo', cls: 'bg-warn/10 text-warn' },
  pronto: { txt: 'Pronto', cls: 'bg-primary/10 text-primary' },
  concluido: { txt: 'Concluído', cls: 'bg-ok/10 text-ok' },
  cancelado: { txt: 'Cancelado', cls: 'bg-danger/10 text-danger' },
};

export default function RetiradaPage() {
  const [pedidos, setPedidos] = useState<any[]>([]);
  const [caixa, setCaixa] = useState<any>(null);
  const [formas, setFormas] = useState<any[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [cobrar, setCobrar] = useState<any>(null); // pedido a-pagar em cobrança
  const [cancelar, setCancelar] = useState<any>(null); // pedido em cancelamento
  const [detalhe, setDetalhe] = useState<any>(null); // pedido aberto no painel de detalhe
  const [busy, setBusy] = useState<string | null>(null);
  const [origensEmUso, setOrigensEmUso] = useState<Record<string, boolean>>({});

  const reload = useCallback(async () => {
    try {
      const [p, c, f] = await Promise.all([
        api.retiradaPedidos(),
        api.caixaAberta('pdv').catch(() => null),
        api.formasPagamento().catch(() => []),
      ]);
      // Backend novo devolve { pedidos, origensEmUso }; compat com o array antigo.
      const pedidosArr = Array.isArray(p) ? p : ((p as any)?.pedidos ?? []);
      setPedidos(pedidosArr);
      setOrigensEmUso(Array.isArray(p) ? {} : ((p as any)?.origensEmUso ?? {}));
      setCaixa(c);
      setFormas(Array.isArray(f) ? f : []);
    } catch {
      /* silencioso — poll tenta de novo */
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => {
    reload();
    const t = setInterval(reload, 15000);
    return () => clearInterval(t);
  }, [reload]);

  const porGrupo = useMemo(() => {
    const m: Record<string, any[]> = { regem: [], integrado: [], marketplace: [], totem: [] };
    for (const p of pedidos) (m[p.grupoCanal] ?? m.regem).push(p);
    return m;
  }, [pedidos]);

  // Coluna visível: origem EM USO (integração conectada) OU tem pedido agora — nunca
  // esconde uma coluna que tenha pedido. Fallback: se o backend não informou origens
  // (edge sem as tabelas de config), mostra só as que têm pedido.
  const gruposVisiveis = GRUPOS.filter(
    (g) => origensEmUso[g.key] || porGrupo[g.key].length > 0,
  );

  const abertos = pedidos.filter((p) => p.status !== 'concluido' && p.status !== 'cancelado').length;

  async function aceitar(p: any) {
    setBusy(p.id);
    try {
      await api.aceitarDelivery(p.id);
      toast.success('Pedido aceito.');
      await reload();
    } catch (e: any) {
      toast.error(e?.message || 'Falha ao aceitar.');
    } finally {
      setBusy(null);
    }
  }

  async function avisarPronto(p: any) {
    setBusy(p.id);
    try {
      await api.avisarProntoDelivery(p.id);
      toast.success('Cliente avisado que está pronto.');
      await reload();
    } catch (e: any) {
      toast.error(e?.message || 'Falha ao avisar.');
    } finally {
      setBusy(null);
    }
  }

  // Entregar: pago online → conclui direto; a-pagar → abre a cobrança.
  async function entregar(p: any) {
    if (!p.pago) {
      setCobrar(p);
      return;
    }
    setBusy(p.id);
    try {
      await api.entregarBalcao(p.id);
      toast.success('Pedido entregue.');
      await reload();
    } catch (e: any) {
      toast.error(e?.message || 'Falha ao entregar.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <Shell eyebrow="PDV · balcão" title="Retirada / Encomendas">
      <div className="mb-4">
        <CaixaPanel caixa={caixa} onChange={reload} embedded origem="pdv" />
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
        <span className="rounded-full bg-primary/10 px-3 py-1 font-semibold text-primary">
          {abertos} aberto{abertos === 1 ? '' : 's'}
        </span>
        <span>Entregue e cobre os pedidos de retirada e encomenda no balcão.</span>
      </div>

      {carregando ? (
        <p className="text-sm text-muted-foreground">Carregando…</p>
      ) : abertos === 0 && pedidos.length === 0 ? (
        <Card className="p-8 text-center text-muted-foreground">
          <p className="text-lg">Nenhum pedido de retirada ou encomenda por enquanto.</p>
          <p className="mt-1 text-sm">Pedidos do seu cardápio e das integrações aparecem aqui.</p>
        </Card>
      ) : (
        <div className={`grid grid-cols-1 gap-4 md:grid-cols-2 ${GRID_COLS[gruposVisiveis.length] ?? 'lg:grid-cols-3'}`}>
          {gruposVisiveis.map((g) => (
            <div key={g.key} className="min-w-0">
              <div className="mb-2 flex items-baseline gap-2">
                <h2 className="text-sm font-bold uppercase tracking-wide">
                  {g.icone} {g.titulo}
                </h2>
                <span className="text-xs text-muted-foreground">{porGrupo[g.key].length}</span>
              </div>
              <p className="mb-3 text-xs text-muted-foreground">{g.dica}</p>
              <div className="flex flex-col gap-3">
                {porGrupo[g.key].length === 0 && (
                  <p className="rounded-lg border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
                    Vazio
                  </p>
                )}
                {porGrupo[g.key].map((p) => (
                  <PedidoCard
                    key={p.id}
                    p={p}
                    busy={busy === p.id}
                    onAbrir={() => setDetalhe(p)}
                    onAceitar={() => aceitar(p)}
                    onAvisar={() => avisarPronto(p)}
                    onEntregar={() => entregar(p)}
                    onCancelar={() => setCancelar(p)}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {cobrar && (
        <CobrarModal
          pedido={cobrar}
          formas={formas}
          temCaixa={!!caixa}
          onClose={() => setCobrar(null)}
          onDone={async () => {
            setCobrar(null);
            await reload();
          }}
        />
      )}
      {cancelar && (
        <CancelarModal
          pedido={cancelar}
          onClose={() => setCancelar(null)}
          onDone={async () => {
            setCancelar(null);
            await reload();
          }}
        />
      )}
      {detalhe && (
        <PedidoDetalhe
          pedido={detalhe}
          onClose={() => setDetalhe(null)}
          onChanged={async () => {
            setDetalhe(null);
            await reload();
          }}
        />
      )}
    </Shell>
  );
}

function ChipCanal({ canal }: { canal: string }) {
  const cor = CANAL_COR[canal];
  return (
    <span
      className="rounded-full px-2 py-0.5 text-[11px] font-semibold"
      style={cor ? { background: cor, color: '#fff' } : { background: 'var(--primary)', color: '#0F2230' }}
    >
      {CANAL_LABEL[canal] ?? canal}
    </span>
  );
}

function PedidoCard({
  p, busy, onAbrir, onAceitar, onAvisar, onEntregar, onCancelar,
}: {
  p: any; busy: boolean;
  onAbrir: () => void;
  onAceitar: () => void; onAvisar: () => void; onEntregar: () => void; onCancelar: () => void;
}) {
  const itens: any[] = Array.isArray(p.itens) ? p.itens : [];
  const st = STATUS_LABEL[p.status] ?? { txt: p.status, cls: 'bg-muted text-muted-foreground' };
  return (
    <Card
      className="cursor-pointer p-3 transition-colors hover:bg-secondary/40"
      role="button"
      tabIndex={0}
      onClick={onAbrir}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onAbrir(); } }}
      title="Ver detalhes do pedido"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="font-mono text-sm font-bold">#{p.numero ?? p.displayId ?? '—'}</span>
            <ChipCanal canal={p.canal} />
            <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium">
              {p.retiradaTipo === 'encomenda' ? '📅 Encomenda' : '🏪 Retirada'}
            </span>
          </div>
          <p className="mt-1 truncate text-sm font-medium">{p.clienteNome || 'Cliente'}</p>
          {p.clienteTelefone && (
            <p className="truncate text-xs text-muted-foreground">{p.clienteTelefone}</p>
          )}
        </div>
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${st.cls}`}>
          {st.txt}
        </span>
      </div>

      <ul className="mt-2 space-y-0.5 text-xs text-muted-foreground">
        {itens.slice(0, 4).map((it, i) => (
          <li key={i} className="truncate">
            {it.quantidade ?? it.qtd ?? 1}× {it.nome ?? it.descricao ?? 'item'}
          </li>
        ))}
        {itens.length > 4 && <li>+{itens.length - 4} item(ns)…</li>}
      </ul>

      <div className="mt-2 flex flex-wrap items-center justify-between gap-1 text-xs">
        <span className="font-mono font-bold">{brl(Number(p.total))}</span>
        {p.pago ? (
          <span className="rounded-full bg-ok/10 px-2 py-0.5 font-semibold text-ok">Pago online</span>
        ) : (
          <span className="rounded-full bg-warn/10 px-2 py-0.5 font-semibold text-warn">A pagar</span>
        )}
        {p.formaPagamentoLabel && (
          <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">{p.formaPagamentoLabel}</span>
        )}
        {p.agendamento && (
          <span className="text-muted-foreground">🕒 {hora(p.agendamento)}</span>
        )}
      </div>

      {p.avisadoProntoEm && (
        <p className="mt-1 text-[11px] text-primary">🔔 Cliente avisado às {hora(p.avisadoProntoEm)}</p>
      )}

      {p.status !== 'concluido' && p.status !== 'cancelado' && (
        <div className="mt-3 flex flex-wrap gap-1.5" onClick={(e) => e.stopPropagation()}>
          {p.status === 'novo' ? (
            <Button size="sm" onClick={onAceitar} disabled={busy}>Aceitar</Button>
          ) : (
            <>
              <Button size="sm" variant="outline" onClick={onAvisar} disabled={busy}>
                Avisar pronto
              </Button>
              <Button size="sm" onClick={onEntregar} disabled={busy}>
                {p.pago ? 'Entregar' : 'Cobrar e entregar'}
              </Button>
            </>
          )}
          <Button size="sm" variant="ghost" onClick={onCancelar} disabled={busy}>
            Cancelar
          </Button>
        </div>
      )}
    </Card>
  );
}

// Cobrança no balcão de um pedido a-pagar → valor entra no caixa do atendente.
function CobrarModal({
  pedido, formas, temCaixa, onClose, onDone,
}: {
  pedido: any; formas: any[]; temCaixa: boolean; onClose: () => void; onDone: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const opcoes = formas.length
    ? formas.map((f) => f.nome || f.tipo).filter(Boolean)
    : ['Dinheiro', 'Pix', 'Crédito', 'Débito'];
  // Inicia numa opção que EXISTE no select (senão o value controlado não casa
  // com nenhuma <option> e o estado envia algo diferente do que aparece).
  // Pré-seleciona pela forma UNIFICADA (Dinheiro/Pix/Cartão…) que casa com as opções.
  const sugerida = pedido.formaPagamentoLabel || pedido.formaPagamento;
  const [forma, setForma] = useState<string>(
    sugerida && opcoes.includes(sugerida) ? sugerida : opcoes[0],
  );

  async function confirmar() {
    setBusy(true);
    try {
      await api.entregarBalcao(pedido.id, forma);
      toast.success('Cobrado e entregue. Valor no seu caixa.');
      onDone();
    } catch (e: any) {
      toast.error(e?.message || 'Falha ao cobrar.');
      setBusy(false);
    }
  }

  return (
    <Modal onClose={onClose} titulo={`Cobrar retirada #${pedido.numero ?? ''}`}>
      <p className="text-sm text-muted-foreground">
        Total <span className="font-mono font-bold text-foreground">{brl(Number(pedido.total))}</span> —
        o valor entra no turno aberto do seu caixa.
      </p>
      {!temCaixa && (
        <p className="mt-2 rounded-lg bg-danger/10 p-2 text-xs text-danger">
          Abra o caixa do PDV antes de cobrar.
        </p>
      )}
      <label className="mt-3 block text-sm font-medium">Forma de pagamento</label>
      <select
        className="mt-1 w-full rounded-lg border border-border bg-background p-2 text-sm"
        value={forma}
        onChange={(e) => setForma(e.target.value)}
      >
        {opcoes.map((o: string) => (
          <option key={o} value={o}>{o}</option>
        ))}
      </select>
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose} disabled={busy}>Cancelar</Button>
        <Button onClick={confirmar} disabled={busy || !temCaixa}>Confirmar</Button>
      </div>
    </Modal>
  );
}

// Cancelamento com senha de gestor + decisão perda × reaproveitamento (mig 128).
function CancelarModal({
  pedido, onClose, onDone,
}: {
  pedido: any; onClose: () => void; onDone: () => void;
}) {
  const [motivo, setMotivo] = useState('');
  const [senha, setSenha] = useState('');
  const [reaproveitado, setReaproveitado] = useState(true);
  const [busy, setBusy] = useState(false);
  const jaProduziu = pedido.status === 'confirmado' || pedido.status === 'pronto' || pedido.status === 'despachado';

  async function confirmar() {
    if (!senha) return toast.error('Informe a senha de um gestor.');
    setBusy(true);
    try {
      const r: any = await api.cancelarDelivery(pedido.id, motivo, senha, reaproveitado);
      toast.success(r?.estoqueAviso || 'Pedido cancelado.');
      onDone();
    } catch (e: any) {
      toast.error(e?.message || 'Falha ao cancelar.');
      setBusy(false);
    }
  }

  return (
    <Modal onClose={onClose} titulo={`Cancelar pedido #${pedido.numero ?? ''}`}>
      <label className="block text-sm font-medium">Motivo</label>
      <Input value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Motivo do cancelamento" />

      {jaProduziu && (
        <>
          <p className="mt-3 text-sm font-medium">Os insumos já preparados:</p>
          <div className="mt-1 grid grid-cols-2 gap-2">
            <button
              type="button"
              aria-pressed={reaproveitado}
              onClick={() => setReaproveitado(true)}
              className={`rounded-lg border p-2 text-xs font-semibold ${reaproveitado ? 'border-ok bg-ok/10 text-ok' : 'border-border'}`}
            >
              ♻️ Reutilizados<br />(voltam ao estoque)
            </button>
            <button
              type="button"
              aria-pressed={!reaproveitado}
              onClick={() => setReaproveitado(false)}
              className={`rounded-lg border p-2 text-xs font-semibold ${!reaproveitado ? 'border-danger bg-danger/10 text-danger' : 'border-border'}`}
            >
              🗑️ Perda<br />(não voltam)
            </button>
          </div>
        </>
      )}

      <label className="mt-3 block text-sm font-medium">Senha do gestor</label>
      <Input type="password" value={senha} onChange={(e) => setSenha(e.target.value)} placeholder="Senha de autorização" />

      <div className="mt-4 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose} disabled={busy}>Voltar</Button>
        <Button variant="destructive" onClick={confirmar} disabled={busy}>Cancelar pedido</Button>
      </div>
    </Modal>
  );
}

function Modal({ titulo, children, onClose }: { titulo: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-t-2xl bg-background p-4 shadow-xl sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="mb-3 text-base font-bold">{titulo}</h3>
        {children}
      </div>
    </div>
  );
}
