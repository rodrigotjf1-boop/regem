'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, getToken } from '@/lib/api';
import { toast } from '@/lib/toast';
import { uuid } from '@/lib/uuid';
import { Shell } from '@/components/app-shell/shell';
import { Card } from '@/components/ui/card';
import { ServidorStatus } from '@/components/ui/servidor-status';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { CaixaPanel } from '@/components/pdv/caixa-panel';
import { TerminalGate } from '@/components/pdv/terminal-gate';
import { BuscarCupom } from '@/components/pdv/buscar-cupom';

/* eslint-disable @typescript-eslint/no-explicit-any */
const brl = (n: number) =>
  Number(n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

type ItemCarrinho = {
  key: string;
  produtoId: string;
  variacaoId?: string;
  complementos?: string[]; // ids das opções escolhidas
  observacao?: string;
  nome: string;
  sub?: string; // "sem alface · + bacon"
  preco: number;
  qtd: number;
};

export default function PdvPage() {
  const router = useRouter();
  const [produtos, setProdutos] = useState<any[]>([]);
  const [carregado, setCarregado] = useState(false);
  const [categorias, setCategorias] = useState<any[]>([]);
  const [catAtiva, setCatAtiva] = useState('');
  const [carrinho, setCarrinho] = useState<ItemCarrinho[]>([]);
  const [taxa, setTaxa] = useState(false);
  const [formas, setFormas] = useState<any[]>([]); // formas de pagamento (cadastro)
  const [formaId, setFormaId] = useState(''); // forma selecionada (pgto único)
  const [dividir, setDividir] = useState(false); // dividir conta / multi-pagamento
  const [pagamentos, setPagamentos] = useState<{ forma: string; valor: string }[]>([]);
  const [picker, setPicker] = useState<any>(null); // produto com variação/complementos
  const [pickVar, setPickVar] = useState<string | undefined>(undefined);
  const [pickOpc, setPickOpc] = useState<string[]>([]);
  const [pickObs, setPickObs] = useState('');
  const [comprovante, setComprovante] = useState<any>(null);
  const [erro, setErro] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [tefAtivo, setTefAtivo] = useState(false);
  const [tefStatus, setTefStatus] = useState<string | null>(null); // aguardando maquininha
  const [caixa, setCaixa] = useState<any>(null); // caixa/turno aberto (ou null)
  const [recebido, setRecebido] = useState(''); // valor recebido (troco em dinheiro)

  const reloadCaixa = useCallback(async () => {
    const cx: any = await api.caixaAberta().catch(() => null);
    setCaixa(cx?.id ? cx : null);
  }, []);
  const chaveRef = useRef<string | null>(null); // chave idempotente da venda atual

  const reload = useCallback(async () => {
    try {
      const [ps, cs, tc, cx, fp] = await Promise.all([
        api.produtos(),
        api.produtoCategorias(),
        api.tefConfig().catch(() => ({ ativo: false })),
        api.caixaAberta().catch(() => null),
        api.formasPagamento().catch(() => []),
      ]);
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

  function addItem(item: Omit<ItemCarrinho, 'key' | 'qtd'>) {
    const key = `${item.produtoId}:${item.variacaoId ?? ''}:${(item.complementos ?? [])
      .slice()
      .sort()
      .join(',')}:${item.observacao ?? ''}`;
    setCarrinho((c) => {
      const ex = c.find((i) => i.key === key);
      if (ex) return c.map((i) => (i.key === key ? { ...i, qtd: i.qtd + 1 } : i));
      return [...c, { ...item, key, qtd: 1 }];
    });
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
      addItem({
        produtoId: p.id,
        variacaoId: undefined,
        complementos: [],
        observacao: undefined,
        nome: p.nome,
        sub: undefined,
        preco: Number(p.precoVenda),
      });
      return;
    }
    setPickVar(undefined);
    setPickOpc([]);
    setPickObs('');
    setPicker({ produto: p, variacoes, complementos });
  }

  function mudarQtd(key: string, d: number) {
    setCarrinho((c) =>
      c
        .map((i) => (i.key === key ? { ...i, qtd: i.qtd + d } : i))
        .filter((i) => i.qtd > 0),
    );
  }

  // Confirma a escolha do seletor (variação + opcionais/adicionais) → carrinho.
  function confirmarPicker() {
    const { produto, variacoes, complementos } = picker;
    const v = variacoes.find((x: any) => x.id === pickVar);
    let preco = v ? Number(v.precoVenda) : Number(produto.precoVenda);
    let nome = v ? `${produto.nome} · ${v.nome}` : produto.nome;
    const partes: string[] = [];
    const todasOpcoes = (complementos as any[]).flatMap((g) =>
      (g.opcoes ?? []).map((o: any) => ({ ...o, tipo: g.tipo })),
    );
    for (const id of pickOpc) {
      const o = todasOpcoes.find((x) => x.id === id);
      if (!o) continue;
      preco += Number(o.precoDelta) || 0;
      partes.push(o.tipo === 'remover' ? `sem ${o.nome}` : `+ ${o.nome}`);
    }
    const obs = pickObs.trim() || undefined;
    const subPartes = [...partes];
    if (obs) subPartes.push(`obs: ${obs}`);
    addItem({
      produtoId: produto.id,
      variacaoId: pickVar,
      complementos: pickOpc,
      observacao: obs,
      nome,
      sub: subPartes.join(' · ') || undefined,
      preco,
    });
    setPicker(null);
  }

  function toggleOpc(id: string) {
    setPickOpc((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  }

  const subtotal = carrinho.reduce((s, i) => s + i.preco * i.qtd, 0);
  const total = subtotal * (taxa ? 1.1 : 1);
  const troco = (Number(String(recebido).replace(',', '.')) || 0) - total;
  const formaSel = formas.find((f) => f.id === formaId);
  const ehDinheiro = formaSel?.tipo === 'dinheiro';
  const somaPag = pagamentos.reduce((s, p) => s + (Number(String(p.valor).replace(',', '.')) || 0), 0);
  const restante = Number((total - somaPag).toFixed(2));
  const pagamentoOk = !dividir || Math.abs(restante) < 0.05;

  // Monta o payload de pagamentos (sempre via `pagamentos`, uni ou multi).
  function montarPagamentos() {
    if (dividir)
      return pagamentos
        .filter((p) => Number(String(p.valor).replace(',', '.')) > 0)
        .map((p) => ({ forma: p.forma, valor: Number(String(p.valor).replace(',', '.')) }));
    return [{ forma: formaSel?.nome ?? 'Dinheiro', valor: Number(total.toFixed(2)), formaPagamentoId: formaSel?.id }];
  }

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

  async function enviarVenda(tefPagId?: string) {
    if (!chaveRef.current) chaveRef.current = uuid();
    const r: any = await api.vendaBalcao({
      itens: carrinho.map((i) => ({
        produtoId: i.produtoId,
        variacaoId: i.variacaoId,
        complementos: i.complementos,
        observacao: i.observacao,
        quantidade: i.qtd,
      })),
      pagamentos: montarPagamentos(),
      taxaServicoPct: taxa ? 10 : 0,
      idempotencyKey: chaveRef.current,
    });
    if (tefPagId && r?.comandaId) await api.tefVincular(tefPagId, r.comandaId).catch(() => {});
    setComprovante(r);
    setCarrinho([]);
    setTaxa(false);
    setRecebido('');
    setDividir(false);
    setPagamentos([]);
    chaveRef.current = null;
    toast.success(r?.idempotente ? 'Venda já registrada.' : 'Venda registrada.');
  }

  async function finalizar() {
    if (carrinho.length === 0) return;
    setErro('');
    setEnviando(true);
    try {
      // TEF (só pagamento único por cartão/pix): cobra na maquininha antes.
      const tipoTef = formaSel?.tipo;
      if (!dividir && tefAtivo && (tipoTef === 'credito' || tipoTef === 'debito' || tipoTef === 'pix')) {
        const pago = await cobrarTef();
        if (!pago) return; // negado/cancelado → não finaliza a venda
        await enviarVenda(pago.id);
      } else {
        await enviarVenda();
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

  const visiveis = catAtiva
    ? produtos.filter((p) => p.categoriaId === catAtiva)
    : produtos;

  // Agrupa por categoria (com cabeçalho), preservando a ordem dos produtos.
  const grupos = (() => {
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

  return (
    <Shell eyebrow="PDV · balcão" title="Venda rápida">
      <TerminalGate>
      {/* Topo compacto: caixa (fino) + status/busca, com as categorias coladas abaixo */}
      <div className="mb-3 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          {carregado && <CaixaPanel caixa={caixa} onChange={reloadCaixa} embedded />}
          <div className="ml-auto flex items-center gap-2">
            <ServidorStatus />
            <BuscarCupom />
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            onClick={() => setCatAtiva('')}
            className={`rounded-full border px-3 py-1 text-sm font-semibold ${!catAtiva ? 'border-primary bg-primary/15 text-primary' : 'border-border bg-card text-muted-foreground'}`}
          >
            Todos
          </button>
          {categorias.filter((c) => !c.parentId).map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => setCatAtiva(c.id)}
              className={`rounded-full border px-3 py-1 text-sm font-semibold ${catAtiva === c.id ? 'border-primary bg-primary/15 text-primary' : 'border-border bg-card text-muted-foreground'}`}
            >
              {c.nome}
            </button>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_340px]">
        {/* Produtos */}
        <div className="space-y-3">
          {erro && <p className="text-destructive">{erro}</p>}

          {!carregado && (
            <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-5 md:grid-cols-6 xl:grid-cols-8">
              {Array.from({ length: 9 }).map((_, i) => (
                <div key={i} className="rounded-xl border border-border bg-card p-3">
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="mt-2 h-4 w-1/3" />
                </div>
              ))}
            </div>
          )}
          {carregado && produtos.length === 0 && (
            <Card className="p-8 text-center text-sm text-muted-foreground">
              Nenhum produto. Cadastre em Cadastros → Produtos & Catálogo.
            </Card>
          )}
          {carregado && grupos.map((g) => (
            <section key={g.nome} className="space-y-2">
              <h3 className="font-display text-xs font-bold uppercase tracking-[.12em] text-muted-foreground">
                {g.nome} <span className="font-mono font-normal">· {g.itens.length}</span>
              </h3>
              <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-5 md:grid-cols-6 xl:grid-cols-8">
                {g.itens.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => tap(p)}
                    className="flex flex-col overflow-hidden rounded-xl border border-border bg-card text-left transition hover:border-primary/50 active:scale-95"
                  >
                    <div className="grid aspect-square w-full place-items-center overflow-hidden bg-muted/40 text-xl">
                      {p.imagemRef ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={p.imagemRef} alt={p.nome} className="h-full w-full object-cover" />
                      ) : (
                        <span aria-hidden>🍽️</span>
                      )}
                    </div>
                    <div className="flex flex-1 flex-col gap-0.5 p-1.5">
                      <span className="line-clamp-2 text-[11px] font-bold leading-tight">{p.nome}</span>
                      <span className="mt-auto font-mono text-xs font-bold text-primary">{brl(Number(p.precoVenda))}</span>
                      {p.tipo === 'variavel' && (
                        <span className="text-[10px] text-muted-foreground">escolher tamanho</span>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            </section>
          ))}
        </div>

        {/* Carrinho */}
        <Card className="flex h-fit flex-col gap-3 p-4 lg:sticky lg:top-4">
          <h2 className="font-display font-semibold">Comanda</h2>
          {carrinho.length === 0 && (
            <p className="py-6 text-center text-sm text-muted-foreground">Toque nos produtos para adicionar.</p>
          )}
          <div className="space-y-2">
            {carrinho.map((i) => (
              <div key={i.key} className="flex items-center gap-2 text-sm">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{i.nome}</p>
                  {i.sub && (
                    <p className="truncate text-[11px] text-muted-foreground">{i.sub}</p>
                  )}
                  <p className="font-mono text-xs text-muted-foreground">{brl(i.preco)}</p>
                </div>
                <button type="button" onClick={() => mudarQtd(i.key, -1)} className="grid h-7 w-7 place-items-center rounded border border-border">−</button>
                <span className="w-5 text-center font-mono">{i.qtd}</span>
                <button type="button" onClick={() => mudarQtd(i.key, 1)} className="grid h-7 w-7 place-items-center rounded border border-border">＋</button>
              </div>
            ))}
          </div>

          {carrinho.length > 0 && (
            <>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={taxa} onChange={(e) => setTaxa(e.target.checked)} className="h-4 w-4 accent-primary" />
                Taxa de serviço 10%
              </label>
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">Pagamento</span>
                  <button
                    type="button"
                    onClick={() => {
                      const nd = !dividir;
                      setDividir(nd);
                      setPagamentos(nd ? [{ forma: formaSel?.nome ?? formas[0]?.nome ?? 'Dinheiro', valor: total.toFixed(2) }] : []);
                    }}
                    className={`rounded-md border px-2 py-0.5 text-[11px] font-semibold ${dividir ? 'border-primary bg-primary/15 text-primary' : 'border-border text-muted-foreground'}`}
                  >
                    Dividir conta
                  </button>
                </div>

                {!dividir ? (
                  <>
                    <div className="flex flex-wrap gap-1.5">
                      {formas.map((f) => (
                        <button
                          key={f.id}
                          type="button"
                          onClick={() => setFormaId(f.id)}
                          className={`rounded-md border px-2.5 py-1 text-xs font-medium ${formaId === f.id ? 'border-primary bg-primary/15 text-primary' : 'border-border'}`}
                        >
                          {f.nome}
                        </button>
                      ))}
                      {formas.length === 0 && <span className="text-xs text-muted-foreground">Cadastre formas em Financeiro.</span>}
                    </div>
                    {ehDinheiro && (
                      <div className="space-y-1 pt-1">
                        <span className="text-xs text-muted-foreground">Valor recebido</span>
                        <input type="number" inputMode="decimal" value={recebido} onChange={(e) => setRecebido(e.target.value)} placeholder={brl(total)} className="w-full rounded-md border border-input bg-card px-3 py-2 text-sm" />
                        {recebido !== '' && (
                          <p className={`text-xs font-semibold ${troco < 0 ? 'text-destructive' : 'text-ok'}`}>
                            {troco < 0 ? `Faltam ${brl(-troco)}` : `Troco ${brl(troco)}`}
                          </p>
                        )}
                      </div>
                    )}
                  </>
                ) : (
                  <div className="space-y-2">
                    {pagamentos.map((p, i) => (
                      <div key={i} className="flex gap-1.5">
                        <select
                          aria-label="Forma"
                          value={p.forma}
                          onChange={(e) => setPagamentos((s) => s.map((x, j) => (j === i ? { ...x, forma: e.target.value } : x)))}
                          className="min-w-0 flex-1 rounded-md border border-input bg-card px-2 text-xs"
                        >
                          {formas.map((f) => <option key={f.id} value={f.nome}>{f.nome}</option>)}
                        </select>
                        <input
                          type="number"
                          inputMode="decimal"
                          value={p.valor}
                          onChange={(e) => setPagamentos((s) => s.map((x, j) => (j === i ? { ...x, valor: e.target.value } : x)))}
                          placeholder="0,00"
                          className="w-24 rounded-md border border-input bg-card px-2 py-1.5 text-xs"
                        />
                        <button type="button" onClick={() => setPagamentos((s) => s.filter((_, j) => j !== i))} className="grid h-8 w-8 place-items-center rounded border border-border text-destructive">×</button>
                      </div>
                    ))}
                    <div className="flex items-center justify-between">
                      <button
                        type="button"
                        onClick={() => setPagamentos((s) => [...s, { forma: formas[0]?.nome ?? 'Dinheiro', valor: (restante > 0 ? restante : 0).toFixed(2) }])}
                        className="rounded-md border border-border px-2 py-1 text-[11px] font-semibold"
                      >
                        ＋ pagamento
                      </button>
                      <span className={`text-xs font-semibold ${Math.abs(restante) < 0.05 ? 'text-ok' : 'text-destructive'}`}>
                        {Math.abs(restante) < 0.05 ? '✓ fecha o total' : restante > 0 ? `Falta ${brl(restante)}` : `Excede ${brl(-restante)}`}
                      </span>
                    </div>
                  </div>
                )}
              </div>
              <div className="flex items-baseline justify-between border-t border-border pt-2">
                <span className="font-semibold">Total</span>
                <span className="font-mono text-xl font-bold">{brl(total)}</span>
              </div>
              <Button type="button" size="lg" onClick={finalizar} disabled={enviando || !caixa || !pagamentoOk}>
                {enviando ? 'Finalizando…' : !caixa ? 'Abra o caixa para vender' : !pagamentoOk ? 'Pagamentos não fecham o total' : 'Receber e enviar à produção'}
              </Button>
            </>
          )}
        </Card>
      </div>

      {/* Seletor: variação + opcionais (remover) + adicionais (extra) */}
      {picker && (() => {
        const v = picker.variacoes.find((x: any) => x.id === pickVar);
        const base = v ? Number(v.precoVenda) : Number(picker.produto.precoVenda);
        const todas = (picker.complementos as any[]).flatMap((g) =>
          (g.opcoes ?? []).map((o: any) => ({ ...o, tipo: g.tipo })),
        );
        const extra = pickOpc.reduce(
          (s, id) => s + (Number(todas.find((o) => o.id === id)?.precoDelta) || 0),
          0,
        );
        const variacaoObrig = picker.variacoes.length > 0 && !pickVar;
        return (
          <div className="fixed inset-0 z-30 grid place-items-center overflow-y-auto bg-black/50 p-4" onClick={() => setPicker(null)}>
            <Card className="w-full max-w-sm p-5" onClick={(e) => e.stopPropagation()}>
              <h3 className="mb-3 font-display font-semibold">{picker.produto.nome}</h3>

              {picker.variacoes.length > 0 && (
                <div className="mb-3">
                  <p className="mb-1.5 text-xs font-semibold text-muted-foreground">Escolha</p>
                  <div className="space-y-1.5">
                    {picker.variacoes.map((vr: any) => (
                      <button
                        key={vr.id}
                        type="button"
                        onClick={() => setPickVar(vr.id)}
                        className={`flex w-full items-center justify-between rounded-lg border p-2.5 text-left ${pickVar === vr.id ? 'border-primary bg-primary/10' : 'border-border'}`}
                      >
                        <span className="font-medium">{vr.nome}</span>
                        <span className="font-mono text-primary">{brl(Number(vr.precoVenda))}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {(picker.complementos as any[]).map((g) => (
                <div key={g.id} className="mb-3">
                  <p className="mb-1.5 text-xs font-semibold text-muted-foreground">
                    {g.nome}{' '}
                    <span className="font-normal">
                      ({g.tipo === 'remover' ? 'retirar' : 'adicionar'})
                    </span>
                  </p>
                  <div className="space-y-1">
                    {(g.opcoes ?? []).map((o: any) => (
                      <label
                        key={o.id}
                        className={`flex cursor-pointer items-center gap-2 rounded-lg border p-2.5 ${pickOpc.includes(o.id) ? 'border-primary bg-primary/10' : 'border-border'}`}
                      >
                        <input
                          type="checkbox"
                          checked={pickOpc.includes(o.id)}
                          onChange={() => toggleOpc(o.id)}
                          className="h-4 w-4 accent-primary"
                        />
                        <span className="flex-1 text-sm">{o.nome}</span>
                        {Number(o.precoDelta) > 0 && (
                          <span className="font-mono text-xs text-primary">
                            + {brl(Number(o.precoDelta))}
                          </span>
                        )}
                      </label>
                    ))}
                  </div>
                </div>
              ))}

              <div className="mt-1">
                <p className="mb-1 text-xs font-semibold text-muted-foreground">Observação (opcional)</p>
                <input
                  type="text"
                  value={pickObs}
                  onChange={(e) => setPickObs(e.target.value)}
                  placeholder="Ex.: sem sal, bem passado"
                  className="w-full rounded-md border border-input bg-card px-3 py-2 text-sm"
                />
              </div>

              <div className="mt-3 flex items-center justify-between border-t border-border pt-3">
                <span className="text-sm text-muted-foreground">Total do item</span>
                <span className="font-mono text-lg font-bold">{brl(base + extra)}</span>
              </div>
              <Button
                type="button"
                className="mt-3 w-full"
                disabled={variacaoObrig}
                onClick={confirmarPicker}
              >
                {variacaoObrig ? 'Escolha uma opção' : 'Adicionar'}
              </Button>
            </Card>
          </div>
        );
      })()}

      {/* Aguardando maquininha (TEF) */}
      {tefStatus && (
        <div className="fixed inset-0 z-40 grid place-items-center bg-black/60 p-4">
          <Card className="w-full max-w-sm p-6 text-center">
            <p className="font-display text-lg font-bold">Aguardando pagamento</p>
            <p className="mt-2 text-sm text-muted-foreground">
              Peça ao cliente para inserir ou aproximar o cartão na maquininha.
            </p>
            <p className="mt-4 font-mono text-2xl font-bold">{brl(total)}</p>
            <p className="mt-3 animate-pulse text-xs uppercase tracking-wide text-primary">
              processando…
            </p>
          </Card>
        </div>
      )}

      {/* Comprovante */}
      {comprovante && (
        <div className="fixed inset-0 z-30 grid place-items-center bg-black/50 p-4" onClick={() => setComprovante(null)}>
          <Card className="w-full max-w-sm p-6 text-center" onClick={(e) => e.stopPropagation()}>
            <p className="font-display text-lg font-bold text-ok">Venda concluída ✓</p>
            {comprovante.senha != null && (
              <div className="mt-3 rounded-xl border border-primary/40 bg-primary/10 py-3">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Senha</p>
                <p className="font-mono text-4xl font-bold text-primary">{comprovante.senha}</p>
              </div>
            )}
            <p className="mt-3 font-mono text-3xl font-bold">{brl(comprovante.total)}</p>
            {comprovante.taxaServicoPct > 0 && (
              <p className="mt-1 text-xs text-muted-foreground">inclui {comprovante.taxaServicoPct}% de serviço</p>
            )}
            {comprovante.nfce && (
              <p className="mt-2 text-xs text-muted-foreground">
                NFC-e {comprovante.nfce.numero} · {comprovante.nfce.status}
                {comprovante.nfce.chave && (
                  <span className="mt-0.5 block break-all font-mono text-[10px]">{comprovante.nfce.chave}</span>
                )}
              </p>
            )}
            <Button type="button" className="mt-4 w-full" onClick={() => setComprovante(null)}>
              Nova venda
            </Button>
          </Card>
        </div>
      )}
      </TerminalGate>
    </Shell>
  );
}
