'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, getToken } from '@/lib/api';
import { toast } from '@/lib/toast';
import { Shell } from '@/components/app-shell/shell';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ArrowLeft, Send, Bot, Play } from 'lucide-react';

/* eslint-disable @typescript-eslint/no-explicit-any */
const hora = (ts: number) =>
  ts ? new Date(ts * 1000).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '';
const foneFmt = (f: string) => {
  const d = String(f ?? '').replace(/\D/g, '');
  if (d.length >= 12) return `+${d.slice(0, 2)} (${d.slice(2, 4)}) ${d.slice(4, 9)}-${d.slice(9)}`;
  if (d.length >= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  return f || '—';
};
const inicial = (s: string) => (s ?? '?').trim().slice(0, 1).toUpperCase() || '?';
const cid = (c: any) => c?.telefone || c?.jids?.[0] || '';
// Mesmo cliente? Tolera o 55 e o 9º dígito comparando o final do número.
const mesmoNumero = (a?: string, b?: string) => {
  const x = String(a ?? '').replace(/\D/g, '');
  const y = String(b ?? '').replace(/\D/g, '');
  if (!x || !y) return false;
  return x === y || x.endsWith(y) || y.endsWith(x) || x.slice(-8) === y.slice(-8);
};

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
  const [carregou, setCarregou] = useState(false);
  const [alvo, setAlvo] = useState<string | null>(null); // ?numero= vindo do sino
  const fimRef = useRef<HTMLDivElement>(null);

  const conectado = status?.conectado;
  const selJids = useMemo(() => (sel?.jids ?? []).join(','), [sel?.jids]);

  const carregarConversas = useCallback(async () => {
    try {
      const c = await api.whatsappConversas();
      setConversas(Array.isArray(c) ? c : []);
    } catch {
      /* silencioso */
    } finally {
      setCarregou(true);
    }
  }, []);

  const carregarMsgs = useCallback(async (jids: string) => {
    try {
      const m = await api.whatsappMensagens(jids);
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
    api.whatsappStatus().then(setStatus).catch(() => setStatus({ conectado: false }));
  }, [router]);

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
    if (!selJids) return;
    carregarMsgs(selJids);
    const t = setInterval(() => carregarMsgs(selJids), 4000);
    return () => clearInterval(t);
  }, [selJids, carregarMsgs]);

  useEffect(() => {
    fimRef.current?.scrollIntoView({ block: 'end' });
  }, [msgs.length]);

  // Sincroniza a flag `pausada` da conversa aberta com o poll da lista.
  useEffect(() => {
    if (!sel) return;
    const atual = conversas.find((c) => cid(c) === cid(sel));
    if (atual && atual.pausada !== sel.pausada) setSel((s: any) => ({ ...s, pausada: atual.pausada }));
  }, [conversas, sel]);

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
    } catch (e: any) {
      toast.error(e?.message || 'Falha ao enviar.');
      setTexto(t);
    } finally {
      setEnviando(false);
    }
  }

  async function togglePausa() {
    if (!sel?.telefone) return;
    const novo = !sel.pausada;
    setPausando(true);
    setSel((s: any) => ({ ...s, pausada: novo }));
    try {
      await api.whatsappPausarConversa(sel.telefone, novo);
      toast.success(novo ? 'Robô pausado nesta conversa — você assume.' : 'Robô retomado nesta conversa.');
      carregarConversas();
    } catch (e: any) {
      toast.error(e?.message || 'Falha ao pausar.');
      setSel((s: any) => ({ ...s, pausada: !novo }));
    } finally {
      setPausando(false);
    }
  }

  const nomeConversa = (c: any) => c?.nome || foneFmt(c?.telefone ?? '');

  return (
    <Shell eyebrow="Delivery" title="WhatsApp">
      {status && !conectado ? (
        <Card className="mx-auto max-w-md p-8 text-center">
          <p className="text-4xl">💬</p>
          <p className="mt-2 font-display text-lg font-semibold">WhatsApp não conectado</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Conecte o WhatsApp da loja no card <strong>Robô de atendimento</strong> (escaneie o QR) para
            usar a caixa de entrada aqui.
          </p>
          <Button className="mt-4" onClick={() => router.push('/delivery/configuracoes')}>
            Ir para o Robô de atendimento
          </Button>
        </Card>
      ) : (
        <div className="flex h-[calc(100dvh-8rem)] min-h-[440px] w-full overflow-hidden rounded-xl border border-border">
          {/* ===== Lista ===== */}
          <div className={`flex w-full min-w-0 shrink-0 flex-col border-r border-border md:w-[340px] ${sel ? 'hidden md:flex' : 'flex'}`}>
            <div className="border-b border-border p-2">
              <Input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar conversa…" className="h-9" />
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
              {filtradas.length === 0 && (
                <p className="p-6 text-center text-sm text-muted-foreground">Nenhuma conversa.</p>
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
                        {c.pausada && <span className="mr-1 text-amber-500">⏸</span>}
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
                <div className="flex items-center gap-2 border-b border-border px-3 py-2">
                  <button className="md:hidden" onClick={() => setSel(null)} title="Voltar"><ArrowLeft className="h-5 w-5" /></button>
                  <Avatar nome={sel.nome} telefone={sel.telefone} foto={sel.foto} tam={36} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">{nomeConversa(sel)}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {foneFmt(sel.telefone)}{sel.pausada ? ' · robô pausado' : ''}
                    </p>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant={sel.pausada ? 'default' : 'outline'}
                    className="shrink-0"
                    disabled={pausando}
                    onClick={togglePausa}
                    title={sel.pausada ? 'Retomar o robô nesta conversa' : 'Pausar o robô só nesta conversa'}
                  >
                    {sel.pausada ? <><Play className="h-4 w-4" /> Retomar robô</> : <><Bot className="h-4 w-4" /> Pausar robô</>}
                  </Button>
                </div>

                <div className="min-h-0 min-w-0 flex-1 space-y-1.5 overflow-y-auto bg-secondary/30 p-3">
                  {msgs.length === 0 && (
                    <p className="py-8 text-center text-xs text-muted-foreground">Sem mensagens carregadas.</p>
                  )}
                  {msgs.map((m) => (
                    <div key={m.id} className={`flex ${m.fromMe ? 'justify-end' : 'justify-start'}`}>
                      <div className={`max-w-[75%] rounded-lg px-2.5 py-1.5 text-sm ${m.fromMe ? 'bg-emerald-500 text-white' : 'border border-border bg-card'}`}>
                        <span className="whitespace-pre-wrap break-words">{m.texto}</span>
                        <span className={`ml-2 align-bottom text-[10px] ${m.fromMe ? 'text-white/70' : 'text-muted-foreground'}`}>{hora(m.timestamp)}</span>
                      </div>
                    </div>
                  ))}
                  <div ref={fimRef} />
                </div>

                <form
                  className="flex items-center gap-2 border-t border-border p-2"
                  onSubmit={(e) => { e.preventDefault(); enviar(); }}
                >
                  <Input value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Escreva uma mensagem…" className="h-10" />
                  <Button type="submit" size="icon" className="h-10 w-10 shrink-0" disabled={enviando || !texto.trim()} title="Enviar">
                    <Send className="h-4 w-4" />
                  </Button>
                </form>
              </>
            )}
          </div>
        </div>
      )}
    </Shell>
  );
}
