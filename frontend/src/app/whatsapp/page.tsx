'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, getToken } from '@/lib/api';
import { toast } from '@/lib/toast';
import { Shell } from '@/components/app-shell/shell';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ArrowLeft, Send, Bot, Play, FileText, Image as ImageIcon, ImageOff, Settings } from 'lucide-react';

/* eslint-disable @typescript-eslint/no-explicit-any */
const hora = (ts: number) =>
  ts ? new Date(ts * 1000).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '';
// Rótulo do separador de dia no chat (Hoje / Ontem / dd/mm/aaaa).
const rotuloDia = (d: Date) => {
  const hoje = new Date();
  const ontem = new Date();
  ontem.setDate(hoje.getDate() - 1);
  const eq = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  if (eq(d, hoje)) return 'Hoje';
  if (eq(d, ontem)) return 'Ontem';
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
};
const foneFmt = (f: string) => {
  const d = String(f ?? '').replace(/\D/g, '');
  if (d.length >= 12) return `+${d.slice(0, 2)} (${d.slice(2, 4)}) ${d.slice(4, 9)}-${d.slice(9)}`;
  if (d.length >= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  return f || '—';
};
const inicial = (s: string) => (s ?? '?').trim().slice(0, 1).toUpperCase() || '?';
// "1 h", "30 min", "até você retomar" — os tempos de pausa do robô (mig 342).
const rotuloMin = (min: number) => (!min ? 'até você retomar' : min < 60 ? `${min} min` : Number.isInteger(min / 60) ? `${min / 60} h` : `${min} min`);
const ROTULO_CHAMADO: Record<string, string> = {
  mudanca: 'mudança no pedido',
  erro: 'erro no recebimento',
  humano: 'quer falar com atendente',
  cancelamento: 'pedido de cancelamento',
  outro: 'atendimento',
};
// Linha de estado do robô na conversa: calado até quando, e por quê.
function estadoDoRobo(c: any): string {
  if (!c?.pausada) return '';
  const ate = c.pausadaAte ? new Date(c.pausadaAte) : null;
  const quando = ate && !Number.isNaN(ate.getTime())
    ? `até ${ate.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`
    : 'até alguém retomar';
  return c.pausaMotivo === 'chamado' ? `robô aguardando o atendente (${quando})` : `robô pausado ${quando}`;
}
const EH_LOJA = process.env.NEXT_PUBLIC_EDGE === '1';
const cid = (c: any) => c?.telefone || c?.jids?.[0] || '';
// Mesmo cliente? Tolera o 55 e o 9º dígito comparando o final do número.
const mesmoNumero = (a?: string, b?: string) => {
  const x = String(a ?? '').replace(/\D/g, '');
  const y = String(b ?? '').replace(/\D/g, '');
  if (!x || !y) return false;
  return x === y || x.endsWith(y) || y.endsWith(x) || x.slice(-8) === y.slice(-8);
};

// Miniatura de mídia no chat (igual ao WhatsApp): por padrão não baixa — mostra
// um cartão clicável; com "carregar fotos" ligado, baixa sozinha. Cache por id
// evita rebaixar ao rolar. `jid` = primeiro jid da conversa; a mídia é buscada
// sob demanda pelo backend (Evolution getBase64FromMediaMessage).
const midiaCache = new Map<string, string>();
function MidiaMsg({ m, jid, auto }: { m: any; jid: string; auto: boolean }) {
  const [src, setSrc] = useState<string | null>(midiaCache.get(m.id) ?? null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState(false);

  const carregar = useCallback(async () => {
    if (src || carregando) return;
    setCarregando(true);
    try {
      const r: any = await api.whatsappMidia(m.midiaKey?.id ?? m.id, jid, !!m.fromMe);
      if (r?.dataUrl) {
        midiaCache.set(m.id, r.dataUrl);
        setSrc(r.dataUrl);
      } else setErro(true);
    } catch {
      setErro(true);
    } finally {
      setCarregando(false);
    }
  }, [src, carregando, m, jid]);

  useEffect(() => {
    if (auto && m.midia === 'imagem' && !src) carregar();
  }, [auto, m.midia, src, carregar]);

  // Vídeo/áudio/documento: não tem miniatura — mostra só o rótulo (texto já vem).
  if (m.midia !== 'imagem' && m.midia !== 'figurinha') {
    return <span className="whitespace-pre-wrap break-words">{m.texto || '[mídia]'}</span>;
  }
  if (src) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt="imagem" className="max-h-52 max-w-full rounded-md" />;
  }
  return (
    <button
      type="button"
      onClick={carregar}
      disabled={carregando}
      className="flex items-center gap-2 rounded-md border border-current/20 px-3 py-2 text-xs"
      title="Carregar imagem"
    >
      <FileText className="h-4 w-4" />
      {erro ? 'Não consegui carregar' : carregando ? 'Carregando…' : `📷 ${m.midia === 'figurinha' ? 'Figurinha' : 'Toque para ver a imagem'}`}
    </button>
  );
}

function Avatar({ nome, telefone, foto, tam = 40 }: { nome?: string; telefone?: string; foto?: string; tam?: number }) {
  const [erro, setErro] = useState(false);
  if (foto && !erro) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={foto} alt="" onError={() => setErro(true)} className="shrink-0 rounded-full object-cover" style={{ width: tam, height: tam }} />;
  }
  return (
    <span className="grid shrink-0 place-items-center rounded-full bg-emerald-500/15 font-semibold text-emerald-600" style={{ width: tam, height: tam }}>
      {inicial(nome || telefone || '?')}
    </span>
  );
}

export default function WhatsappPage() {
  const router = useRouter();
  const [status, setStatus] = useState<any>(null);
  const [conversas, setConversas] = useState<any[]>([]);
  const [sel, setSel] = useState<any>(null);
  const [msgs, setMsgs] = useState<any[]>([]);
  const [texto, setTexto] = useState('');
  const [busca, setBusca] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [pausando, setPausando] = useState(false);
  const [menuPausa, setMenuPausa] = useState(false);
  const [resolvendo, setResolvendo] = useState(false);
  // Tempo de pausa da loja (robo-config) e as opções do "Pausar robô".
  const [pausaCfg, setPausaCfg] = useState<{ pausaMinutos: number; opcoesPausa: number[] }>({
    pausaMinutos: 60,
    opcoesPausa: [15, 30, 60, 120, 240, 0],
  });
  // A última leitura da lista falhou (sem nuvem, sem permissão…): a tela diz, em vez de "Nenhuma conversa".
  const [erroLista, setErroLista] = useState('');
  const [enviandoCard, setEnviandoCard] = useState(false);
  const [escolherCard, setEscolherCard] = useState<any[] | null>(null);
  // "Carregar fotos" (economia de dados, igual ao WhatsApp). Desligado por
  // padrão: fotos só baixam ao clicar. A escolha fica guardada neste navegador.
  const [autoFotos, setAutoFotos] = useState(false);
  // Config do histórico (retenção). 0 = manter tudo; N = manter só os últimos N dias.
  const [cfgHist, setCfgHist] = useState(false);
  const [retencao, setRetencao] = useState<number>(0);
  useEffect(() => {
    api.whatsappHistoricoConfig().then((r: any) => setRetencao(Number(r?.retencaoDias) || 0)).catch(() => {});
  }, []);
  async function salvarRetencao() {
    try {
      await api.whatsappHistoricoConfigSalvar(Number(retencao) || 0);
      toast.success('Retenção do histórico salva.');
      setCfgHist(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro ao salvar.');
    }
  }
  useEffect(() => {
    setAutoFotos(localStorage.getItem('regem_wa_fotos') === '1');
  }, []);
  function toggleFotos() {
    setAutoFotos((v) => {
      const n = !v;
      localStorage.setItem('regem_wa_fotos', n ? '1' : '0');
      return n;
    });
  }
  const [carregou, setCarregou] = useState(false);
  const [alvo, setAlvo] = useState<string | null>(null); // ?numero= vindo do sino
  const fimRef = useRef<HTMLDivElement>(null);

  const conectado = status?.conectado;
  const selJids = useMemo(() => (sel?.jids ?? []).join(','), [sel?.jids]);

  const carregarConversas = useCallback(async () => {
    try {
      const c = await api.whatsappConversas();
      setConversas(Array.isArray(c) ? c : []);
      setErroLista('');
    } catch (e: any) {
      // Mantém a última lista na tela e diz que ela pode estar velha (V37: "vazio" ≠ "não li").
      setErroLista(e?.message || 'Não consegui atualizar as conversas.');
    } finally {
      setCarregou(true);
    }
  }, []);

  // Guarda a conversa atualmente aberta para descartar respostas obsoletas:
  // uma requisição em voo da conversa A não pode sobrescrever as mensagens de B
  // se o usuário trocar de conversa antes de ela responder (race condition).
  const selJidsRef = useRef('');
  const carregarMsgs = useCallback(async (jids: string) => {
    try {
      const m = await api.whatsappMensagens(jids);
      if (selJidsRef.current !== jids) return; // conversa mudou durante a requisição
      setMsgs(Array.isArray(m) ? m : []);
    } catch {
      /* silencioso */
    }
  }, []);

  useEffect(() => {
    if (!getToken()) {
      router.replace('/entrar');
      return;
    }
    lerStatus();
    api.whatsappRoboConfig().then((r: any) => r && setPausaCfg(r)).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  // "Não conectado" (o número da loja não está pareado) é diferente de "não consegui perguntar" (sem nuvem, sem
  // permissão): o segundo mostra o motivo e um "Tentar de novo".
  function lerStatus() {
    setStatus(null);
    api
      .whatsappStatus()
      .then(setStatus)
      .catch((e: any) => setStatus({ conectado: false, erro: e?.message || 'Não foi possível consultar o WhatsApp da loja.' }));
  }

  useEffect(() => {
    if (!conectado) return;
    carregarConversas();
    const t = setInterval(carregarConversas, 8000);
    return () => clearInterval(t);
  }, [conectado, carregarConversas]);

  // Veio do sino de atendimento (?numero=...): abre direto a conversa do cliente.
  useEffect(() => {
    const n = new URLSearchParams(window.location.search).get('numero');
    if (n) setAlvo(n.replace(/\D/g, ''));
  }, []);

  useEffect(() => {
    if (!alvo || sel || !carregou) return;
    const achou = conversas.find((c) => mesmoNumero(c.telefone, alvo));
    // Sem conversa anterior com esse cliente, abre uma vazia — dá pra enviar assim mesmo.
    setSel(
      achou ?? { telefone: alvo, jids: [`${alvo}@s.whatsapp.net`], nome: null, foto: null, naoLidas: 0, pausada: false },
    );
    setAlvo(null); // uma vez só: não reabre quando o gestor voltar para a lista
  }, [alvo, sel, carregou, conversas]);

  useEffect(() => {
    selJidsRef.current = selJids;
    if (!selJids) {
      setMsgs([]);
      return;
    }
    // Troca de conversa: limpa as mensagens da anterior (não mostra histórico
    // errado até a nova carregar) e zera o rascunho (não vaza texto entre conversas).
    setMsgs([]);
    setTexto('');
    carregarMsgs(selJids);
    const t = setInterval(() => carregarMsgs(selJids), 4000);
    return () => clearInterval(t);
  }, [selJids, carregarMsgs]);

  useEffect(() => {
    fimRef.current?.scrollIntoView({ block: 'end' });
  }, [msgs.length]);

  // Sincroniza o estado do robô e o chamado da conversa aberta com o poll da lista.
  useEffect(() => {
    if (!sel) return;
    const atual = conversas.find((c) => cid(c) === cid(sel));
    if (!atual) return;
    const mudou =
      atual.pausada !== sel.pausada ||
      String(atual.pausadaAte ?? '') !== String(sel.pausadaAte ?? '') ||
      atual.pausaMotivo !== sel.pausaMotivo ||
      (atual.chamado?.id ?? null) !== (sel.chamado?.id ?? null) ||
      // o mesmo chamado pode VIRAR urgente (o robô soma ao aberto e sobe a prioridade — mig 343)
      (atual.chamado?.prioridade ?? null) !== (sel.chamado?.prioridade ?? null);
    if (mudou)
      setSel((s: any) => ({
        ...s,
        pausada: atual.pausada,
        pausadaAte: atual.pausadaAte ?? null,
        pausaMotivo: atual.pausaMotivo ?? null,
        chamado: atual.chamado ?? null,
      }));
  }, [conversas, sel]);

  // Fecha o menu do "Pausar robô" com Esc.
  useEffect(() => {
    if (!menuPausa) return;
    const f = (e: KeyboardEvent) => e.key === 'Escape' && setMenuPausa(false);
    window.addEventListener('keydown', f);
    return () => window.removeEventListener('keydown', f);
  }, [menuPausa]);

  const filtradas = useMemo(() => {
    const v = busca.trim().toLowerCase();
    if (!v) return conversas;
    return conversas.filter(
      (c) => (c.nome ?? '').toLowerCase().includes(v) || (c.telefone ?? '').includes(v.replace(/\D/g, '')),
    );
  }, [conversas, busca]);

  async function enviar() {
    const t = texto.trim();
    if (!t || !sel?.telefone) return;
    setEnviando(true);
    setTexto('');
    setMsgs((prev) => [...prev, { id: `tmp-${Date.now()}`, fromMe: true, texto: t, timestamp: Math.floor(Date.now() / 1000) }]);
    try {
      await api.whatsappEnviar(sel.telefone, t);
      setTimeout(() => carregarMsgs(selJids), 800);
      // O servidor pausa o robô nesta conversa ao enviar: a lista traz o "pausado até…".
      setTimeout(carregarConversas, 800);
    } catch (e: any) {
      toast.error(e?.message || 'Falha ao enviar.');
      setTexto(t);
    } finally {
      setEnviando(false);
    }
  }

  // Pausar (com o tempo escolhido; 0 = até retomar) ou retomar o robô nesta conversa.
  async function mudarPausa(pausar: boolean, minutos?: number) {
    if (!sel?.telefone) return;
    setMenuPausa(false);
    setPausando(true);
    try {
      const r: any = await api.whatsappPausarConversa(sel.telefone, pausar, minutos);
      setSel((s: any) => ({ ...s, pausada: !!r?.pausado, pausadaAte: r?.pausadoAte ?? null, pausaMotivo: r?.pausado ? 'manual' : null }));
      toast.success(
        pausar
          ? `Robô pausado nesta conversa ${minutos === undefined ? `por ${rotuloMin(pausaCfg.pausaMinutos)}` : minutos ? `por ${rotuloMin(minutos)}` : 'até você retomar'} — você assume.`
          : 'Robô retomado nesta conversa.',
      );
      carregarConversas();
    } catch (e: any) {
      toast.error(e?.message || (pausar ? 'Falha ao pausar.' : 'Falha ao retomar.'));
    } finally {
      setPausando(false);
    }
  }

  // Resolver o chamado aberto deste cliente: o robô volta a responder na conversa (regra da pausa, mig 342).
  async function resolverChamado() {
    if (!sel?.chamado?.id) return;
    setResolvendo(true);
    try {
      await api.resolverAtendimento(sel.chamado.id);
      setSel((s: any) => ({ ...s, chamado: null }));
      toast.success('Chamado resolvido — o robô volta a responder nesta conversa.');
      carregarConversas();
    } catch (e: any) {
      toast.error(e?.message || 'Não foi possível resolver o chamado.');
    } finally {
      setResolvendo(false);
    }
  }

  // Envia o cardápio em PDF. Com mais de um cardápio ativo, abre o seletor.
  async function enviarCardapio(cardapioId?: string) {
    if (!sel?.telefone) return;
    setEnviandoCard(true);
    try {
      if (!cardapioId) {
        const lista: any[] = await api.whatsappCardapios();
        if (Array.isArray(lista) && lista.length > 1) {
          setEscolherCard(lista); // pergunta de qual
          setEnviandoCard(false);
          return;
        }
      }
      const r: any = await api.whatsappEnviarCardapio(sel.telefone, cardapioId);
      toast.success(`Cardápio enviado (${r?.itens ?? 0} itens).`);
      setEscolherCard(null);
      setTimeout(() => carregarMsgs(selJids), 800);
    } catch (e: any) {
      toast.error(e?.message || 'Falha ao enviar o cardápio.');
    } finally {
      setEnviandoCard(false);
    }
  }

  const nomeConversa = (c: any) => c?.nome || foneFmt(c?.telefone ?? '');

  return (
    <Shell eyebrow="Delivery" title="WhatsApp">
      {status?.erro ? (
        <Card className="mx-auto max-w-md p-8 text-center" role="alert">
          <p className="text-4xl">⚠️</p>
          <p className="mt-2 font-display text-lg font-semibold">Não consegui abrir a caixa de conversas</p>
          <p className="mt-1 text-sm text-muted-foreground">{status.erro}</p>
          <Button className="mt-4" onClick={lerStatus}>Tentar de novo</Button>
        </Card>
      ) : status && !conectado ? (
        <Card className="mx-auto max-w-md p-8 text-center">
          <p className="text-4xl">💬</p>
          <p className="mt-2 font-display text-lg font-semibold">WhatsApp não conectado</p>
          {EH_LOJA ? (
            <p className="mt-1 text-sm text-muted-foreground">
              O número da loja se conecta pela nuvem: entre em <strong>app.dmsregem.com</strong> › <strong>Delivery</strong> ›{' '}
              <strong>Configurações</strong> › aba <strong>Robô de atendimento</strong>. Depois a caixa de conversas funciona aqui também.
            </p>
          ) : (
            <>
              <p className="mt-1 text-sm text-muted-foreground">
                Conecte o WhatsApp da loja em <strong>Delivery › Configurações</strong>, aba <strong>Robô de atendimento</strong>,
                para usar a caixa de conversas aqui.
              </p>
              <Button className="mt-4" onClick={() => router.push('/delivery/configuracoes?aba=robo')}>
                Ir para o Robô de atendimento
              </Button>
            </>
          )}
        </Card>
      ) : (
        <div className="flex h-[calc(100dvh-8rem)] min-h-[440px] w-full overflow-hidden rounded-xl border border-border">
          {/* ===== Lista ===== */}
          <div className={`flex w-full min-w-0 shrink-0 flex-col border-r border-border md:w-[340px] ${sel ? 'hidden md:flex' : 'flex'}`}>
            <div className="border-b border-border p-2">
              <Input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar conversa…" className="h-9" />
            </div>
            {erroLista && (
              <p role="status" className="border-b border-border bg-warn/10 px-3 py-1.5 text-xs text-warn">
                {erroLista} A lista pode estar desatualizada — tentando de novo.
              </p>
            )}
            <div className="min-h-0 flex-1 overflow-y-auto">
              {filtradas.length === 0 && (
                <p className="p-6 text-center text-sm text-muted-foreground">
                  {erroLista && !conversas.length ? 'Não consegui carregar as conversas.' : 'Nenhuma conversa.'}
                </p>
              )}
              {filtradas.map((c) => (
                <button
                  key={cid(c)}
                  onClick={() => setSel(c)}
                  className={`flex w-full items-center gap-3 border-b border-border/60 px-3 py-2.5 text-left hover:bg-secondary ${cid(sel) === cid(c) ? 'bg-secondary' : ''}`}
                >
                  <Avatar nome={c.nome} telefone={c.telefone} foto={c.foto} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-semibold">{nomeConversa(c)}</span>
                      {c.timestamp > 0 && <span className="shrink-0 text-[10px] text-muted-foreground">{hora(c.timestamp)}</span>}
                    </span>
                    <span className="flex items-center justify-between gap-2">
                      <span className="truncate text-xs text-muted-foreground">
                        {c.chamado &&
                          (c.chamado.prioridade === 'urgente' ? (
                            <span className="mr-1" title="Chamado URGENTE: cliente chateado" aria-label="Chamado urgente">🚨</span>
                          ) : (
                            <span className="mr-1" title="Chamado de atendimento aberto" aria-label="Chamado aberto">🔔</span>
                          ))}
                        {c.pausada && <span className="mr-1 text-amber-500" title={estadoDoRobo(c)} aria-label={estadoDoRobo(c)}>⏸</span>}
                        {c.ultimaMensagem ?? foneFmt(c.telefone)}
                      </span>
                      {c.naoLidas > 0 && (
                        <span className="grid h-4 min-w-4 shrink-0 place-items-center rounded-full bg-emerald-500 px-1 text-[10px] font-bold text-white">{c.naoLidas}</span>
                      )}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* ===== Conversa ===== */}
          <div className={`min-w-0 flex-1 flex-col ${sel ? 'flex' : 'hidden md:flex'}`}>
            {!sel ? (
              <div className="grid flex-1 place-items-center text-sm text-muted-foreground">
                Selecione uma conversa à esquerda.
              </div>
            ) : (
              <>
                <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
                  <button className="md:hidden" onClick={() => setSel(null)} title="Voltar" aria-label="Voltar para a lista"><ArrowLeft className="h-5 w-5" /></button>
                  <Avatar nome={sel.nome} telefone={sel.telefone} foto={sel.foto} tam={36} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">{nomeConversa(sel)}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {foneFmt(sel.telefone)}{sel.pausada ? ` · ${estadoDoRobo(sel)}` : ''}
                    </p>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant={autoFotos ? 'default' : 'outline'}
                    className="shrink-0"
                    onClick={toggleFotos}
                    title={autoFotos ? 'Fotos carregando automaticamente' : 'Carregar fotos automaticamente'}
                    aria-pressed={autoFotos}
                  >
                    {autoFotos ? <ImageIcon className="h-4 w-4" /> : <ImageOff className="h-4 w-4" />} Fotos
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="shrink-0"
                    disabled={enviandoCard}
                    onClick={() => enviarCardapio()}
                    title="Enviar o cardápio em PDF para este contato"
                  >
                    <FileText className="h-4 w-4" /> {enviandoCard ? 'Enviando…' : 'Enviar cardápio'}
                  </Button>
                  {sel.pausada ? (
                    <Button
                      type="button"
                      size="sm"
                      className="shrink-0"
                      disabled={pausando}
                      onClick={() => mudarPausa(false)}
                      title="Retomar o robô nesta conversa"
                    >
                      <Play className="h-4 w-4" /> Retomar robô
                    </Button>
                  ) : (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="shrink-0"
                      disabled={pausando}
                      onClick={() => setMenuPausa(true)}
                      aria-expanded={menuPausa}
                      aria-haspopup="dialog"
                      title="Pausar o robô só nesta conversa"
                    >
                      <Bot className="h-4 w-4" /> Pausar robô
                    </Button>
                  )}
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="shrink-0"
                    onClick={() => setCfgHist(true)}
                    title="Configurar o histórico de conversas"
                  >
                    <Settings className="h-4 w-4" /> Config
                  </Button>
                </div>

                {sel.chamado && (
                  <div
                    role="status"
                    className={`flex flex-wrap items-center gap-2 border-b px-3 py-1.5 text-xs ${
                      sel.chamado.prioridade === 'urgente'
                        ? 'border-destructive bg-destructive text-white'
                        : 'border-destructive/30 bg-destructive/10 text-destructive'
                    }`}
                  >
                    <span className="min-w-0 flex-1">
                      {sel.chamado.prioridade === 'urgente' ? (
                        <>
                          🚨 <strong>Chamado URGENTE</strong> — cliente chateado: {ROTULO_CHAMADO[sel.chamado.tipo] ?? 'atendimento'}
                        </>
                      ) : (
                        <>
                          🔔 <strong>Chamado aberto</strong>: {ROTULO_CHAMADO[sel.chamado.tipo] ?? 'atendimento'}
                        </>
                      )}
                      {sel.chamado.pedidoNumero ? ` · pedido #${sel.chamado.pedidoNumero}` : ''}
                    </span>
                    <Button type="button" size="sm" variant="outline" className="h-7 shrink-0" disabled={resolvendo} onClick={resolverChamado}>
                      {resolvendo ? 'Resolvendo…' : 'Resolver chamado'}
                    </Button>
                  </div>
                )}

                <div className="min-h-0 min-w-0 flex-1 space-y-1.5 overflow-y-auto bg-secondary/30 p-3">
                  {msgs.length === 0 && (
                    <p className="py-8 text-center text-xs text-muted-foreground">Sem mensagens carregadas.</p>
                  )}
                  {(() => {
                    let ultimoDia = '';
                    return msgs.map((m) => {
                      const d = new Date((m.timestamp || 0) * 1000);
                      const diaKey = d.toDateString();
                      const mostraDia = m.timestamp ? diaKey !== ultimoDia : false;
                      if (m.timestamp) ultimoDia = diaKey;
                      return (
                        <div key={m.id}>
                          {mostraDia && (
                            <div className="my-2 flex justify-center">
                              <span className="rounded-full bg-card px-3 py-0.5 text-[11px] text-muted-foreground shadow-sm">{rotuloDia(d)}</span>
                            </div>
                          )}
                          <div className={`flex ${m.fromMe ? 'justify-end' : 'justify-start'}`}>
                            <div className={`max-w-[75%] rounded-lg px-2.5 py-1.5 text-sm ${m.fromMe ? 'bg-emerald-500 text-white' : 'border border-border bg-card'}`}>
                              {m.midia ? (
                                <MidiaMsg m={m} jid={sel.jids?.[0] ?? ''} auto={autoFotos} />
                              ) : (
                                <span className="whitespace-pre-wrap break-words">{m.texto}</span>
                              )}
                              <span className={`ml-2 align-bottom text-[10px] ${m.fromMe ? 'text-white/70' : 'text-muted-foreground'}`}>{hora(m.timestamp)}</span>
                            </div>
                          </div>
                        </div>
                      );
                    });
                  })()}
                  <div ref={fimRef} />
                </div>

                <form
                  className="flex items-center gap-2 border-t border-border p-2"
                  onSubmit={(e) => { e.preventDefault(); enviar(); }}
                >
                  <Input value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Escreva uma mensagem…" aria-label="Mensagem" className="h-10" />
                  <Button type="submit" size="icon" className="h-10 w-10 shrink-0" disabled={enviando || !texto.trim()} title="Enviar" aria-label="Enviar">
                    <Send className="h-4 w-4" />
                  </Button>
                </form>
                {!sel.pausada && (
                  <p className="border-t border-border/60 px-3 py-1 text-[11px] text-muted-foreground">
                    Ao responder, o robô fica calado nesta conversa {pausaCfg.pausaMinutos ? `por ${rotuloMin(pausaCfg.pausaMinutos)}` : 'até você retomar'}.
                  </p>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {/* Por quanto tempo pausar o robô nesta conversa (mig 342). */}
      {menuPausa && sel && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4" onClick={() => setMenuPausa(false)}>
          <Card role="dialog" aria-modal="true" aria-labelledby="titulo-pausa" className="w-full max-w-sm space-y-3 p-5" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between gap-2">
              <h3 id="titulo-pausa" className="font-display text-base font-bold">Pausar o robô nesta conversa</h3>
              <button type="button" onClick={() => setMenuPausa(false)} className="shrink-0 text-sm text-muted-foreground hover:underline">Fechar ✕</button>
            </div>
            <p className="text-xs text-muted-foreground">Por quanto tempo? Depois o robô volta a responder sozinho — ou antes, se você clicar em Retomar ou resolver o chamado.</p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {pausaCfg.opcoesPausa.map((m) => (
                <Button key={m} type="button" variant={m === pausaCfg.pausaMinutos ? 'default' : 'outline'} disabled={pausando} onClick={() => mudarPausa(true, m)}>
                  {m ? rotuloMin(m) : 'Até eu retomar'}
                  {m === pausaCfg.pausaMinutos && <span className="ml-1 text-[10px] opacity-80">(padrão)</span>}
                </Button>
              ))}
            </div>
          </Card>
        </div>
      )}

      {/* Seletor de cardápio: só aparece quando há mais de um ativo. */}
      {escolherCard && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4" onClick={() => setEscolherCard(null)}>
          <Card className="w-full max-w-sm space-y-3 p-5" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="font-display text-base font-bold">Qual cardápio enviar?</h3>
              <button type="button" onClick={() => setEscolherCard(null)} className="text-sm text-muted-foreground hover:underline">Fechar ✕</button>
            </div>
            <div className="space-y-2">
              {escolherCard.map((c) => (
                <Button
                  key={c.id}
                  type="button"
                  variant="outline"
                  className="w-full justify-start"
                  disabled={enviandoCard}
                  onClick={() => enviarCardapio(c.id)}
                >
                  {c.nome}{c.unidadeNome ? ` · ${c.unidadeNome}` : ''}
                </Button>
              ))}
            </div>
          </Card>
        </div>
      )}

      {/* Config do histórico de conversas (retenção) — item 11 */}
      {cfgHist && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4" onClick={() => setCfgHist(false)}>
          <Card className="w-full max-w-sm space-y-3 p-5" onClick={(e) => e.stopPropagation()}>
            <div>
              <h3 className="font-display text-base font-bold">Histórico de conversas</h3>
              <p className="mt-0.5 text-xs text-muted-foreground">Por quanto tempo guardar as mensagens das conversas oficiais (WhatsApp API). O que passar do prazo é apagado automaticamente.</p>
            </div>
            <div className="space-y-2">
              {([['Manter tudo', 0], ['Só do dia (24h)', 1], ['Última semana', 7], ['Último mês', 30]] as [string, number][]).map(([lb, v]) => (
                <label key={v} className="flex items-center gap-2 text-sm">
                  <input type="radio" name="ret" className="accent-primary" checked={Number(retencao || 0) === v} onChange={() => setRetencao(v)} />
                  {lb}
                </label>
              ))}
              <label className="flex items-center gap-2 text-sm">
                <input type="radio" name="ret" className="accent-primary" checked={![0, 1, 7, 30].includes(Number(retencao || 0))} onChange={() => setRetencao(15)} />
                Personalizado:
                <Input className="w-20" type="number" min={1} value={![0, 1, 7, 30].includes(Number(retencao || 0)) ? String(retencao) : ''} onChange={(e) => setRetencao(Number(e.target.value) || 0)} />
                dias
              </label>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setCfgHist(false)}>Cancelar</Button>
              <Button onClick={salvarRetencao}>Salvar</Button>
            </div>
          </Card>
        </div>
      )}
    </Shell>
  );
}
