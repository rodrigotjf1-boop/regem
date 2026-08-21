'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { api, getCategoria, getPermissoes } from '@/lib/api';
import { toast } from '@/lib/toast';
import { Shell } from '@/components/app-shell/shell';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

/* eslint-disable @typescript-eslint/no-explicit-any */
const brl = (n: any) =>
  Number(n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtData = (d?: string) => (d ? new Date(d).toLocaleDateString('pt-BR') : '—');
const diasDesde = (d?: string) =>
  d ? Math.floor((Date.now() - new Date(d).getTime()) / 86400000) : null;

const CANAL_LABEL: Record<string, string> = {
  ifood: 'iFood',
  cardapio: 'Cardápio',
  cardapio_web: 'Cardápio Web',
  '99food': '99Food',
  anotaai: 'Anota Aí',
  delivery_direto: 'Open Delivery',
};

// Segmentos (a contagem vem do resumo, mapeada por `c`).
const SEGS: { k: string; t: string; c: string }[] = [
  { k: 'todos', t: 'Todos', c: 'total' },
  { k: 'mes', t: 'No mês', c: 'mes' },
  { k: '30d', t: 'Últimos 30 dias', c: 'd30' },
  { k: 'sem_30', t: '+30d sem pedir', c: 'sem30' },
  { k: 'sem_60', t: '+60d sem pedir', c: 'sem60' },
  { k: 'campeoes', t: 'Campeões', c: 'campeoes' },
];

export default function ClientesPage() {
  const [resumo, setResumo] = useState<any>({});
  const [seg, setSeg] = useState('todos');
  const [busca, setBusca] = useState('');
  const [lista, setLista] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [detalhe, setDetalhe] = useState<any | null>(null);
  const [historico, setHistorico] = useState<any[] | null>(null);
  const [campModal, setCampModal] = useState(false);
  const [campPrevia, setCampPrevia] = useState<number | null>(null);
  const [campMsg, setCampMsg] = useState('');
  const [campIntervalo, setCampIntervalo] = useState(7);
  const [campTeto, setCampTeto] = useState('');
  const [campEnviando, setCampEnviando] = useState(false);
  const [campanhas, setCampanhas] = useState<any[] | null>(null);
  const [funil, setFunil] = useState<any>(null);
  const [campInstancia, setCampInstancia] = useState<'loja' | 'marketing'>('loja');
  const [mktStatus, setMktStatus] = useState<any>(null);
  const [mktModal, setMktModal] = useState(false);
  const [mktQr, setMktQr] = useState<string | null>(null);
  // Bloco 2 — filtros, ordenação e seleção.
  const [canalF, setCanalF] = useState('');
  const [bairroF, setBairroF] = useState('');
  const [bairros, setBairros] = useState<string[]>([]);
  const [ordenar, setOrdenar] = useState('ultimo');
  const [direcao, setDirecao] = useState<'asc' | 'desc'>('desc');
  const [selec, setSelec] = useState<Set<string>>(new Set());
  // Bloco 3 — exportação.
  const [expModal, setExpModal] = useState<string | null>(null); // formato pendente de confirmação
  const [exportando, setExportando] = useState(false);
  const podeExportar = getCategoria() === 'presidente' || !!getPermissoes()?.clientes_exportar;
  const buscaRef = useRef(busca);
  buscaRef.current = busca;

  const carregarResumo = useCallback(async () => {
    try {
      setResumo(await api.crmResumo());
    } catch {
      /* silencioso — os segmentos aparecem sem contagem */
    }
  }, []);

  const carregar = useCallback(async () => {
    setLoading(true);
    try {
      const r: any = await api.crmClientes({
        segmento: seg,
        busca: buscaRef.current,
        canal: canalF,
        bairro: bairroF,
        ordenar,
        direcao,
        limite: 500,
      });
      setLista(Array.isArray(r) ? r : []);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro ao carregar clientes');
    } finally {
      setLoading(false);
    }
  }, [seg, canalF, bairroF, ordenar, direcao]);

  useEffect(() => {
    void carregarResumo();
  }, [carregarResumo]);
  useEffect(() => {
    api.crmFunil(30).then(setFunil).catch(() => {});
  }, []);
  useEffect(() => {
    api
      .crmBairros()
      .then((b: any) => setBairros(Array.isArray(b) ? b : []))
      .catch(() => {});
  }, []);
  useEffect(() => {
    void carregar();
  }, [carregar]);
  // Debounce da busca (recarrega 350ms após parar de digitar).
  useEffect(() => {
    const t = setTimeout(() => void carregar(), 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busca]);
  // Fecha o modal com Esc.
  useEffect(() => {
    if (!detalhe) return;
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setDetalhe(null);
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [detalhe]);
  // Enquanto o QR do marketing está na tela, poll do status até conectar.
  useEffect(() => {
    if (!mktModal || !mktQr || mktStatus?.conectado) return;
    const t = setInterval(async () => {
      try {
        const s = await api.whatsappMarketingStatus();
        setMktStatus(s);
        if (s?.conectado) setMktQr(null);
      } catch {
        /* ignora */
      }
    }, 3000);
    return () => clearInterval(t);
  }, [mktModal, mktQr, mktStatus?.conectado]);

  async function abrir(c: any) {
    setDetalhe(c);
    setHistorico(null);
    try {
      const h: any = await api.crmHistorico(c.id);
      setHistorico(Array.isArray(h) ? h : []);
    } catch {
      setHistorico([]);
    }
  }

  // Ordenação: clicar no topo alterna asc/desc (troca de coluna começa lógica).
  function ordenarPor(col: string) {
    if (ordenar === col) setDirecao((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setOrdenar(col);
      setDirecao(col === 'nome' ? 'asc' : 'desc');
    }
  }
  const seta = (col: string) => (ordenar === col ? (direcao === 'asc' ? ' ▲' : ' ▼') : '');

  function toggleSel(id: string) {
    setSelec((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }
  const todosSel = lista.length > 0 && lista.every((c) => selec.has(c.id));
  function toggleSelTodos() {
    setSelec(todosSel ? new Set() : new Set(lista.map((c) => c.id)));
  }

  function baixarArquivo(res: { filename: string; mime: string; base64: string }) {
    const bin = atob(res.base64);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    const url = URL.createObjectURL(new Blob([arr], { type: res.mime }));
    const a = document.createElement('a');
    a.href = url;
    a.download = res.filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function confirmarExport() {
    const formato = expModal;
    if (!formato) return;
    setExportando(true);
    try {
      const ids = selec.size > 0 ? Array.from(selec) : undefined;
      const res: any = await api.crmExportar({
        formato,
        segmento: seg,
        busca: buscaRef.current,
        canal: canalF,
        bairro: bairroF,
        ordenar,
        direcao,
        ids,
      });
      baixarArquivo(res);
      toast.success('Exportação gerada. Registrada na auditoria.');
      setExpModal(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro ao exportar');
    } finally {
      setExportando(false);
    }
  }

  async function abrirCampanha() {
    setCampModal(true);
    setCampPrevia(null);
    setCampInstancia('loja');
    api.whatsappMarketingStatus().then(setMktStatus).catch(() => setMktStatus(null));
    try {
      const r: any = await api.crmCampanhaPrevia(seg);
      setCampPrevia(r?.total ?? 0);
    } catch {
      setCampPrevia(0);
    }
  }

  async function enviarCampanha() {
    if (campMsg.trim().length < 3) return toast.error('Escreva a mensagem da campanha.');
    setCampEnviando(true);
    try {
      const r: any = await api.crmCampanhaCriar({
        segmento: seg,
        mensagem: campMsg.trim(),
        intervaloSeg: campIntervalo,
        tetoDia: campTeto ? Number(campTeto) : null,
        instanciaTipo: campInstancia,
      });
      toast.success(`Campanha criada — ${r?.total ?? 0} destinatários. O envio começa pausado.`);
      setCampModal(false);
      setCampMsg('');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro ao criar campanha');
    } finally {
      setCampEnviando(false);
    }
  }

  async function abrirCampanhas() {
    setCampanhas(null);
    try {
      const r: any = await api.crmCampanhas();
      setCampanhas(Array.isArray(r) ? r : []);
    } catch {
      setCampanhas([]);
    }
  }

  async function toggleOptOut(c: any) {
    try {
      await api.crmOptOut(c.id, !c.opt_out_marketing);
      setDetalhe({ ...c, opt_out_marketing: !c.opt_out_marketing });
      void carregar();
      toast.success(
        !c.opt_out_marketing
          ? 'Cliente não receberá campanhas.'
          : 'Cliente reativado para campanhas.',
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro ao atualizar');
    }
  }

  async function abrirMkt() {
    setMktModal(true);
    setMktQr(null);
    try {
      setMktStatus(await api.whatsappMarketingStatus());
    } catch {
      setMktStatus(null);
    }
  }
  async function conectarMkt() {
    try {
      const r: any = await api.whatsappMarketingConectar();
      setMktQr(r?.qr ?? null);
      if (!r?.qr) toast.error('Não veio o QR — tente de novo em instantes.');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro ao conectar');
    }
  }
  async function desconectarMkt() {
    try {
      await api.whatsappMarketingDesconectar();
      setMktQr(null);
      setMktStatus(await api.whatsappMarketingStatus());
      toast.success('Número de marketing desconectado.');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro ao desconectar');
    }
  }

  return (
    <Shell eyebrow="Delivery" title="Clientes">
      <div className="space-y-4">
        <p className="max-w-2xl text-sm text-muted-foreground">
          Base de clientes da sua loja — unificada por telefone, somando todos os canais de
          delivery. Uso interno para métricas e campanhas.
        </p>

        {/* Funil de conversão do cardápio (últimos 30 dias) */}
        {funil && (
          <Card className="p-4">
            <div className="mb-3 flex items-center justify-between">
              <p className="text-sm font-semibold">Funil do cardápio · últimos 30 dias</p>
              <p className="text-xs text-muted-foreground">
                conversão{' '}
                <strong className="text-foreground">
                  {Number(funil.visitas) > 0
                    ? Math.round((Number(funil.pedidos) / Number(funil.visitas)) * 100)
                    : 0}
                  %
                </strong>
              </p>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {(
                [
                  ['Visitas', 'visitas'],
                  ['Carrinho', 'carrinho'],
                  ['Checkout', 'checkout'],
                  ['Pedidos', 'pedidos'],
                ] as [string, string][]
              ).map(([label, key], i) => {
                const v = Number(funil[key] ?? 0);
                const base = Number(funil.visitas ?? 0);
                const pct = base > 0 ? Math.round((v / base) * 100) : 0;
                return (
                  <div key={key} className="rounded-lg border border-border p-2.5">
                    <p className="font-mono text-xl font-bold tabular-nums">{v}</p>
                    <p className="text-[11px] text-muted-foreground">
                      {label}
                      {i > 0 && <span className="ml-1 text-primary">{pct}%</span>}
                    </p>
                  </div>
                );
              })}
            </div>
          </Card>
        )}

        {/* Segmentos */}
        <div className="flex flex-wrap gap-2">
          {SEGS.map((s) => {
            const n = resumo?.[s.c];
            const ativo = seg === s.k;
            return (
              <button
                key={s.k}
                type="button"
                onClick={() => setSeg(s.k)}
                aria-pressed={ativo}
                className={`rounded-full border px-3 py-1.5 text-sm font-medium transition-colors ${
                  ativo
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-border hover:bg-muted/50'
                }`}
              >
                {s.t}
                {n != null && <span className="ml-1.5 font-mono text-xs text-muted-foreground">{n}</span>}
              </button>
            );
          })}
        </div>

        {/* Busca + ações */}
        <div className="flex flex-wrap items-center gap-2">
          <Input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar por nome ou telefone…"
            className="max-w-sm flex-1"
            aria-label="Buscar cliente"
          />
          <Button variant="outline" onClick={abrirMkt}>
            Nº de marketing
          </Button>
          <Button variant="outline" onClick={abrirCampanhas}>
            Campanhas
          </Button>
          <Button onClick={abrirCampanha}>Nova campanha</Button>
        </div>

        {/* Filtros + exportação */}
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={canalF}
            onChange={(e) => setCanalF(e.target.value)}
            aria-label="Filtrar por canal"
            className="h-10 rounded-md border border-border bg-card px-2 text-sm"
          >
            <option value="">Todos os canais</option>
            {Object.entries(CANAL_LABEL)
              .filter(([k]) => k !== 'delivery_direto') /* Open Delivery = integração, não canal */
              .map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
          </select>
          <select
            value={bairroF}
            onChange={(e) => setBairroF(e.target.value)}
            aria-label="Filtrar por bairro"
            className="h-10 max-w-[200px] rounded-md border border-border bg-card px-2 text-sm"
          >
            <option value="">Todos os bairros</option>
            {bairros.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>
          {(canalF || bairroF) && (
            <button
              type="button"
              onClick={() => {
                setCanalF('');
                setBairroF('');
              }}
              className="text-xs text-muted-foreground underline"
            >
              limpar filtros
            </button>
          )}
          {selec.size > 0 && (
            <span className="text-xs font-medium text-primary">{selec.size} selecionado(s)</span>
          )}
          {podeExportar && (
            <div className="ml-auto flex items-center gap-2">
              <span className="text-xs text-muted-foreground">Exportar:</span>
              {(
                [
                  ['csv', 'CSV'],
                  ['excel', 'Excel'],
                  ['pdf', 'PDF'],
                ] as [string, string][]
              ).map(([f, t]) => (
                <Button key={f} variant="outline" size="sm" onClick={() => setExpModal(f)}>
                  {t}
                </Button>
              ))}
            </div>
          )}
        </div>

        {/* Tabela */}
        <Card className="overflow-hidden p-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-sm">
              <caption className="sr-only">Lista de clientes por segmento</caption>
              <thead className="border-b border-border bg-card text-[11px] uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th scope="col" className="w-8 px-3 py-2">
                    <input
                      type="checkbox"
                      checked={todosSel}
                      onChange={toggleSelTodos}
                      aria-label="Selecionar todos"
                    />
                  </th>
                  <th scope="col" className="px-3 py-2 font-semibold">
                    <button type="button" onClick={() => ordenarPor('nome')} className="hover:text-foreground">
                      Cliente{seta('nome')}
                    </button>
                  </th>
                  <th scope="col" className="px-3 py-2 font-semibold">Telefone</th>
                  <th scope="col" className="px-3 py-2 text-right font-semibold">
                    <button type="button" onClick={() => ordenarPor('pedidos')} className="hover:text-foreground">
                      Pedidos{seta('pedidos')}
                    </button>
                  </th>
                  <th scope="col" className="px-3 py-2 font-semibold">
                    <button type="button" onClick={() => ordenarPor('ultimo')} className="hover:text-foreground">
                      Último pedido{seta('ultimo')}
                    </button>
                  </th>
                  <th scope="col" className="px-3 py-2 text-right font-semibold">
                    <button type="button" onClick={() => ordenarPor('ticket')} className="hover:text-foreground">
                      Ticket médio{seta('ticket')}
                    </button>
                  </th>
                  <th scope="col" className="px-3 py-2 text-right font-semibold">
                    <button type="button" onClick={() => ordenarPor('total')} className="hover:text-foreground">
                      Total gasto{seta('total')}
                    </button>
                  </th>
                  <th scope="col" className="px-3 py-2 font-semibold">Canais</th>
                </tr>
              </thead>
              <tbody>
                {loading && (
                  <tr>
                    <td colSpan={8} className="px-3 py-6 text-center text-xs text-muted-foreground">
                      Carregando…
                    </td>
                  </tr>
                )}
                {!loading && lista.length === 0 && (
                  <tr>
                    <td colSpan={8} className="px-3 py-8 text-center text-sm text-muted-foreground">
                      Nenhum cliente neste segmento.
                    </td>
                  </tr>
                )}
                {!loading &&
                  lista.map((c) => {
                    const dias = diasDesde(c.ultimo_pedido_em);
                    const ticket =
                      Number(c.total_pedidos) > 0
                        ? Number(c.total_gasto) / Number(c.total_pedidos)
                        : 0;
                    const canais: string[] = Array.isArray(c.canais) ? c.canais : [];
                    return (
                      <tr
                        key={c.id}
                        onClick={() => abrir(c)}
                        tabIndex={0}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') abrir(c);
                        }}
                        className="cursor-pointer border-b border-border/60 hover:bg-muted/50"
                      >
                        <td
                          className="px-3 py-2"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <input
                            type="checkbox"
                            checked={selec.has(c.id)}
                            onChange={() => toggleSel(c.id)}
                            aria-label={`Selecionar ${c.nome || 'cliente'}`}
                          />
                        </td>
                        <td className="px-3 py-2 font-medium">
                          {c.nome || 'Cliente'}
                          {Number(c.pedidos_30d) >= 3 && (
                            <span
                              title="Campeão — 3+ pedidos em 30 dias"
                              className="ml-1.5 rounded-full bg-primary/15 px-1.5 text-[10px] font-bold text-primary"
                            >
                              ★
                            </span>
                          )}
                          {c.opt_out_marketing && (
                            <span
                              title="Optou por não receber campanhas"
                              className="ml-1.5 rounded-full bg-muted px-1.5 text-[10px] text-muted-foreground"
                            >
                              opt-out
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2 font-mono text-xs text-muted-foreground">
                          {c.telefone}
                        </td>
                        <td className="px-3 py-2 text-right font-mono tabular-nums">
                          {c.total_pedidos ?? 0}
                        </td>
                        <td className="px-3 py-2 text-xs">
                          {fmtData(c.ultimo_pedido_em)}
                          {dias != null && <span className="ml-1 text-muted-foreground">({dias}d)</span>}
                        </td>
                        <td className="px-3 py-2 text-right font-mono tabular-nums">{brl(ticket)}</td>
                        <td className="px-3 py-2 text-right font-mono tabular-nums">
                          {brl(c.total_gasto)}
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex flex-wrap gap-1">
                            {canais.map((ch) => (
                              <span key={ch} className="rounded bg-muted px-1.5 py-0.5 text-[10px]">
                                {CANAL_LABEL[ch] ?? ch}
                              </span>
                            ))}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
              {!loading && lista.length > 0 && (
                <tfoot className="border-t-2 border-border bg-muted/40 font-semibold">
                  {(() => {
                    const totPed = lista.reduce((s, c) => s + (Number(c.total_pedidos) || 0), 0);
                    const totGasto = lista.reduce((s, c) => s + (Number(c.total_gasto) || 0), 0);
                    const ticketGeral = totPed > 0 ? totGasto / totPed : 0;
                    return (
                      <tr>
                        <td className="px-3 py-2" />
                        <td className="px-3 py-2 text-xs uppercase tracking-wide text-muted-foreground">
                          Total · {lista.length} cliente(s)
                        </td>
                        <td className="px-3 py-2" />
                        <td className="px-3 py-2 text-right font-mono tabular-nums">{totPed}</td>
                        <td className="px-3 py-2" />
                        <td className="px-3 py-2 text-right font-mono tabular-nums">{brl(ticketGeral)}</td>
                        <td className="px-3 py-2 text-right font-mono tabular-nums">{brl(totGasto)}</td>
                        <td className="px-3 py-2" />
                      </tr>
                    );
                  })()}
                </tfoot>
              )}
            </table>
          </div>
        </Card>
      </div>

      {/* Modal de detalhe / histórico */}
      {detalhe && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4"
          onClick={() => setDetalhe(null)}
          role="dialog"
          aria-modal="true"
          aria-label={`Cliente ${detalhe.nome || detalhe.telefone}`}
        >
          <div onClick={(e) => e.stopPropagation()} className="w-full max-w-lg">
            <Card className="max-h-[85vh] overflow-hidden p-0">
              <div className="flex items-center gap-2 border-b border-border px-4 py-3">
                <div>
                  <p className="font-display font-bold">{detalhe.nome || 'Cliente'}</p>
                  <p className="font-mono text-xs text-muted-foreground">{detalhe.telefone}</p>
                </div>
                <button
                  type="button"
                  onClick={() => setDetalhe(null)}
                  className="ml-auto text-muted-foreground hover:text-foreground"
                  aria-label="Fechar"
                >
                  ✕
                </button>
              </div>
              <div className="grid grid-cols-3 gap-2 border-b border-border px-4 py-3 text-center">
                <div>
                  <p className="font-mono text-lg font-bold">{detalhe.total_pedidos ?? 0}</p>
                  <p className="text-[11px] text-muted-foreground">pedidos</p>
                </div>
                <div>
                  <p className="font-mono text-lg font-bold">{brl(detalhe.total_gasto)}</p>
                  <p className="text-[11px] text-muted-foreground">total gasto</p>
                </div>
                <div>
                  <p className="font-mono text-sm font-bold">{fmtData(detalhe.ultimo_pedido_em)}</p>
                  <p className="text-[11px] text-muted-foreground">último pedido</p>
                </div>
              </div>
              <div className="border-b border-border px-4 py-2">
                <button
                  type="button"
                  onClick={() => toggleOptOut(detalhe)}
                  className="text-xs font-semibold text-primary hover:underline"
                >
                  {detalhe.opt_out_marketing
                    ? 'Reativar para campanhas'
                    : 'Não enviar campanhas a este cliente'}
                </button>
              </div>
              <div className="scroll-fino max-h-[50vh] overflow-y-auto px-4 py-3">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Histórico de pedidos
                </p>
                {historico == null && <p className="text-sm text-muted-foreground">Carregando…</p>}
                {historico != null && historico.length === 0 && (
                  <p className="text-sm text-muted-foreground">Nenhum pedido.</p>
                )}
                <ul className="space-y-1">
                  {(historico ?? []).map((h) => (
                    <li
                      key={h.id}
                      className="flex items-center justify-between gap-2 border-b border-border/50 py-1 text-sm"
                    >
                      <span>
                        <span className="font-mono">#{h.numero ?? '—'}</span>
                        <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-[10px]">
                          {CANAL_LABEL[h.canal] ?? h.canal}
                        </span>
                        <span className="ml-2 text-xs text-muted-foreground">{fmtData(h.criado_em)}</span>
                      </span>
                      <span className="font-mono">{brl(h.total)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </Card>
          </div>
        </div>
      )}
      {/* Modal: nova campanha */}
      {campModal && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4"
          onClick={() => setCampModal(false)}
          role="dialog"
          aria-modal="true"
          aria-label="Nova campanha"
        >
          <div onClick={(e) => e.stopPropagation()} className="w-full max-w-md">
            <Card className="overflow-hidden p-0">
              <div className="flex items-center gap-2 border-b border-border px-4 py-3">
                <p className="font-display font-bold">Nova campanha</p>
                <button
                  type="button"
                  onClick={() => setCampModal(false)}
                  className="ml-auto text-muted-foreground hover:text-foreground"
                  aria-label="Fechar"
                >
                  ✕
                </button>
              </div>
              <div className="space-y-3 px-4 py-3">
                <p className="text-sm text-muted-foreground">
                  Segmento{' '}
                  <strong className="text-foreground">{SEGS.find((s) => s.k === seg)?.t}</strong> ·{' '}
                  {campPrevia == null ? (
                    'calculando público…'
                  ) : (
                    <>
                      <strong className="text-foreground">{campPrevia}</strong> destinatários (exclui
                      opt-out)
                    </>
                  )}
                </p>
                <textarea
                  value={campMsg}
                  onChange={(e) => setCampMsg(e.target.value)}
                  rows={4}
                  maxLength={900}
                  placeholder="Escreva a mensagem… Ex: Oi! Sentimos sua falta 😊 Confira as novidades da [sua loja]: <link>. Responda SAIR para não receber."
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                  aria-label="Mensagem da campanha"
                />
                <div className="text-xs">
                  <span className="mb-1 block text-muted-foreground">Enviar de</span>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => setCampInstancia('loja')}
                      aria-pressed={campInstancia === 'loja'}
                      className={`rounded-md border px-3 py-1.5 ${
                        campInstancia === 'loja'
                          ? 'border-primary bg-primary/10 text-primary'
                          : 'border-border'
                      }`}
                    >
                      Número da loja
                    </button>
                    <button
                      type="button"
                      disabled={!mktStatus?.conectado}
                      onClick={() => setCampInstancia('marketing')}
                      aria-pressed={campInstancia === 'marketing'}
                      className={`rounded-md border px-3 py-1.5 disabled:opacity-40 ${
                        campInstancia === 'marketing'
                          ? 'border-primary bg-primary/10 text-primary'
                          : 'border-border'
                      }`}
                    >
                      Número de marketing
                    </button>
                  </div>
                  {!mktStatus?.conectado && (
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      Conecte um número de marketing (botão &quot;Nº de marketing&quot;) para isolar o
                      risco de ban do número principal.
                    </p>
                  )}
                </div>
                <div className="flex flex-wrap gap-3">
                  <label className="text-xs">
                    <span className="mb-1 block text-muted-foreground">Pausa entre envios (s)</span>
                    <input
                      type="number"
                      min={3}
                      max={120}
                      value={campIntervalo}
                      onChange={(e) => setCampIntervalo(Number(e.target.value) || 7)}
                      className="w-24 rounded-md border border-border bg-background px-2 py-1 text-sm"
                    />
                  </label>
                  <label className="text-xs">
                    <span className="mb-1 block text-muted-foreground">Teto por dia (opcional)</span>
                    <input
                      type="number"
                      min={1}
                      value={campTeto}
                      onChange={(e) => setCampTeto(e.target.value)}
                      placeholder="sem limite"
                      className="w-28 rounded-md border border-border bg-background px-2 py-1 text-sm"
                    />
                  </label>
                </div>
                <p className="rounded-md bg-warn/10 px-3 py-2 text-xs text-muted-foreground">
                  ⚠️ Envio em massa pode marcar seu número. Enviamos pausado, só para quem já pediu; a
                  mensagem deve identificar a loja e incluir &quot;responda SAIR&quot;.
                </p>
              </div>
              <div className="flex justify-end gap-2 border-t border-border px-4 py-3">
                <Button variant="outline" onClick={() => setCampModal(false)}>
                  Cancelar
                </Button>
                <Button onClick={enviarCampanha} disabled={campEnviando || !campPrevia}>
                  {campEnviando ? 'Criando…' : `Enviar p/ ${campPrevia ?? 0}`}
                </Button>
              </div>
            </Card>
          </div>
        </div>
      )}

      {/* Modal: campanhas enviadas */}
      {campanhas != null && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4"
          onClick={() => setCampanhas(null)}
          role="dialog"
          aria-modal="true"
          aria-label="Campanhas"
        >
          <div onClick={(e) => e.stopPropagation()} className="w-full max-w-lg">
            <Card className="max-h-[85vh] overflow-hidden p-0">
              <div className="flex items-center gap-2 border-b border-border px-4 py-3">
                <p className="font-display font-bold">Campanhas</p>
                <button
                  type="button"
                  onClick={() => setCampanhas(null)}
                  className="ml-auto text-muted-foreground hover:text-foreground"
                  aria-label="Fechar"
                >
                  ✕
                </button>
              </div>
              <div className="scroll-fino max-h-[60vh] overflow-y-auto px-4 py-3">
                {campanhas.length === 0 && (
                  <p className="text-sm text-muted-foreground">Nenhuma campanha ainda.</p>
                )}
                <ul className="space-y-2">
                  {campanhas.map((k) => (
                    <li key={k.id} className="rounded-md border border-border p-3 text-sm">
                      <div className="flex items-center gap-2">
                        <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold uppercase">
                          {SEGS.find((s) => s.k === k.segmento)?.t ?? k.segmento}
                        </span>
                        <span
                          className={`ml-auto rounded-full px-2 py-0.5 text-[10px] font-bold ${
                            k.status === 'concluida' ? 'bg-ok/15 text-ok' : 'bg-primary/15 text-primary'
                          }`}
                        >
                          {k.status}
                        </span>
                      </div>
                      <p className="mt-1 break-words text-xs text-muted-foreground">{k.mensagem}</p>
                      <p className="mt-1 font-mono text-xs">
                        {k.enviados}/{k.total} enviados
                        {Number(k.falhas) > 0 && ` · ${k.falhas} falhas`}
                      </p>
                    </li>
                  ))}
                </ul>
              </div>
            </Card>
          </div>
        </div>
      )}
      {/* Modal: número de marketing */}
      {mktModal && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4"
          onClick={() => setMktModal(false)}
          role="dialog"
          aria-modal="true"
          aria-label="Número de marketing"
        >
          <div onClick={(e) => e.stopPropagation()} className="w-full max-w-sm">
            <Card className="overflow-hidden p-0">
              <div className="flex items-center gap-2 border-b border-border px-4 py-3">
                <p className="font-display font-bold">Número de marketing</p>
                <button
                  type="button"
                  onClick={() => setMktModal(false)}
                  className="ml-auto text-muted-foreground hover:text-foreground"
                  aria-label="Fechar"
                >
                  ✕
                </button>
              </div>
              <div className="space-y-3 px-4 py-4 text-center">
                <p className="text-sm text-muted-foreground">
                  Um 2º WhatsApp só para campanhas — isola o risco de ban do número principal
                  (bot/pedidos). Ele não responde mensagens, só envia.
                </p>
                {mktStatus?.conectado ? (
                  <>
                    <p className="rounded-md bg-ok/10 px-3 py-2 text-sm font-semibold text-ok">
                      ✓ Conectado
                    </p>
                    <Button variant="outline" onClick={desconectarMkt}>
                      Desconectar
                    </Button>
                  </>
                ) : mktQr ? (
                  <>
                    <p className="text-xs text-muted-foreground">
                      No WhatsApp do número de marketing: Aparelhos conectados → escaneie:
                    </p>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={mktQr}
                      alt="QR do número de marketing"
                      className="mx-auto h-56 w-56 rounded-md border border-border"
                    />
                    <p className="text-[11px] text-muted-foreground">Aguardando pareamento…</p>
                  </>
                ) : (
                  <Button onClick={conectarMkt}>Conectar número de marketing</Button>
                )}
              </div>
            </Card>
          </div>
        </div>
      )}

      {/* Modal: aviso de responsabilidade antes de exportar (LGPD) */}
      {expModal && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4"
          onClick={() => !exportando && setExpModal(null)}
          role="dialog"
          aria-modal="true"
          aria-label="Confirmar exportação"
        >
          <div onClick={(e) => e.stopPropagation()} className="w-full max-w-md">
            <Card className="overflow-hidden p-0">
              <div className="flex items-center gap-2 border-b border-border px-4 py-3">
                <p className="font-display font-bold">
                  Exportar {expModal.toUpperCase()} · {selec.size > 0 ? `${selec.size} selecionado(s)` : 'lista filtrada'}
                </p>
                <button
                  type="button"
                  onClick={() => setExpModal(null)}
                  className="ml-auto text-muted-foreground hover:text-foreground"
                  aria-label="Fechar"
                >
                  ✕
                </button>
              </div>
              <div className="space-y-3 px-4 py-4">
                <p className="rounded-md bg-warn/10 px-3 py-3 text-sm">
                  <strong className="text-foreground">Dados sensíveis — sua responsabilidade.</strong> Estes
                  dados de clientes são da sua loja e de <strong>uso interno</strong>. Ao exportar, você se
                  responsabiliza pelo uso e por qualquer compartilhamento, conforme a LGPD.
                </p>
                <p className="text-xs text-muted-foreground">
                  Esta exportação é <strong className="text-foreground">registrada na auditoria</strong> com
                  seu usuário, data e hora.
                </p>
              </div>
              <div className="flex justify-end gap-2 border-t border-border px-4 py-3">
                <Button variant="outline" onClick={() => setExpModal(null)} disabled={exportando}>
                  Cancelar
                </Button>
                <Button onClick={confirmarExport} disabled={exportando}>
                  {exportando ? 'Gerando…' : 'Concordo e exportar'}
                </Button>
              </div>
            </Card>
          </div>
        </div>
      )}
    </Shell>
  );
}
