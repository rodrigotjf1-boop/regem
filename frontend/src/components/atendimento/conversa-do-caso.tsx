'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { toast } from '@/lib/toast';
import { Button } from '@/components/ui/button';
import { MidiaMsg, mesmoNumero } from '@/components/whatsapp/midia-msg';
import { BotaoCopiloto } from '@/components/atendimento/botao-copiloto';
import { fraseDoRoboNoCaso, type CasoDaFila } from '@/lib/atendimento';

/* eslint-disable @typescript-eslint/no-explicit-any */

// A CONVERSA DO WHATSAPP DENTRO DO CASO (Onda 1 da central — o "2B": responder sem sair do caso; protótipo
// `mockups/regem-central-atendimento.html`, bloco "Conversa no WhatsApp"). Usa a MESMA caixa de conversas de Delivery ›
// WhatsApp (as mesmas rotas e travas: gestão com a permissão do robô; no servidor da loja, repassa à nuvem). Mostra as
// últimas mensagens, respostas prontas (vão para o campo — a pessoa ajusta antes de enviar) e o campo de escrever (Enter
// envia; Shift+Enter quebra a linha). Ao responder, o robô fica calado na conversa (regra da caixa).

/** Respostas prontas por motivo do caso — ponto de partida para quem atende, nunca enviadas sozinhas. */
const PRONTAS: Record<string, string[]> = {
  geral: ['Oi! Aqui é da equipe da loja, vou te ajudar por aqui.', 'Já estou verificando e te respondo em instantes.', 'Pode me mandar uma foto, por favor?', 'Prontinho, resolvido! Obrigado pela paciência.'],
  erro: ['Sinto muito pelo problema. Vou resolver agora com você.', 'Pode me mandar uma foto do pedido, por favor?', 'Já estou verificando com a cozinha e te respondo em instantes.'],
  mudanca: ['Consigo ver a mudança, sim. Me confirma o que você quer trocar?', 'Já estou verificando se ainda dá para mudar e te respondo em instantes.'],
  humano: ['Oi! Aqui é da equipe da loja. Em que posso ajudar?', 'Já estou verificando e te respondo em instantes.'],
  outro: ['Recebi, obrigado! Já estou verificando e te respondo em instantes.', 'O entregador já foi avisado.'],
};

type Mensagem = { id: string; fromMe: boolean; texto?: string; timestamp: number; midia?: string; midiaKey?: any };

const hora = (ts: number) => (ts ? new Date(ts * 1000).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' }) : '');
/** O número no formato do WhatsApp (55 + DDD + número). */
const numeroDoWhatsapp = (t: string | null | undefined) => {
  const d = String(t ?? '').replace(/\D/g, '');
  return d.length === 10 || d.length === 11 ? `55${d}` : d;
};

export function ConversaDoCaso({
  caso: c,
  rascunho,
}: {
  caso: CasoDaFila;
  /** Um texto que outro bloco do caso leva ao campo (ex.: "Não dá: responder ao cliente"); `n` novo = aplicar de novo. */
  rascunho?: { texto: string; n: number } | null;
}) {
  const numero = numeroDoWhatsapp(c.telefone);
  const [jids, setJids] = useState<string | null>(null);
  const [msgs, setMsgs] = useState<Mensagem[] | null>(null);
  const [erro, setErro] = useState('');
  const [texto, setTexto] = useState('');
  const [enviando, setEnviando] = useState(false);
  const atual = useRef('');
  const fim = useRef<HTMLDivElement>(null);
  const campo = useRef<HTMLTextAreaElement>(null);
  // O rascunho vai para o campo (nunca é enviado sozinho): só o que chegou DEPOIS de abrir esta conversa.
  const rascunhoAplicado = useRef(rascunho?.n ?? 0);
  useEffect(() => {
    if (!rascunho || rascunho.n === rascunhoAplicado.current) return;
    rascunhoAplicado.current = rascunho.n;
    setTexto(rascunho.texto);
    campo.current?.focus();
    campo.current?.scrollIntoView({ block: 'nearest' });
  }, [rascunho]);

  // A conversa do cliente na caixa (os jids dela: com ou sem o 9, ou o identificador novo do WhatsApp); sem conversa
  // anterior, o número dele — dá para escrever assim mesmo.
  useEffect(() => {
    let vivo = true;
    setJids(null);
    setMsgs(null);
    setErro('');
    api
      .whatsappConversas()
      .then((lista: any) => {
        if (!vivo) return;
        const achou = (Array.isArray(lista) ? lista : []).find((x: any) => mesmoNumero(x?.telefone, numero));
        setJids((achou?.jids?.length ? achou.jids : [`${numero}@s.whatsapp.net`]).join(','));
      })
      .catch((e: any) => vivo && setErro(e?.message || 'Não foi possível abrir a conversa.'));
    return () => {
      vivo = false;
    };
  }, [numero]);

  const ler = useCallback(async (j: string) => {
    try {
      const m = await api.whatsappMensagens(j);
      if (atual.current !== j) return; // trocou de caso durante a leitura
      setMsgs(Array.isArray(m) ? (m as Mensagem[]).slice(-40) : []);
    } catch (e: any) {
      if (atual.current === j) setErro(e?.message || 'Não foi possível ler a conversa.');
    }
  }, []);

  useEffect(() => {
    if (!jids) return;
    atual.current = jids;
    void ler(jids);
    const t = setInterval(() => void ler(jids), 5000);
    return () => clearInterval(t);
  }, [jids, ler]);

  // Desce até a última mensagem quando chega uma nova — só dentro da caixa da conversa (a página não pula).
  useEffect(() => {
    const el = fim.current?.parentElement;
    if (el) el.scrollTop = el.scrollHeight;
  }, [msgs?.length]);

  async function enviar() {
    const t = texto.trim();
    if (!t || enviando) return;
    setEnviando(true);
    setTexto('');
    setMsgs((m) => [...(m ?? []), { id: `tmp-${Date.now()}`, fromMe: true, texto: t, timestamp: Math.floor(Date.now() / 1000) }]);
    try {
      await api.whatsappEnviar(numero, t);
      setTimeout(() => jids && void ler(jids), 800);
    } catch (e: any) {
      toast.error(e?.message || 'Não foi possível enviar.');
      setTexto(t);
      if (jids) void ler(jids);
    } finally {
      setEnviando(false);
    }
  }

  const prontas = PRONTAS[c.tipo] ?? PRONTAS.geral;
  const jid = (jids ?? '').split(',')[0];

  return (
    <section className="rounded-lg border border-border p-3 text-sm" aria-labelledby={`conversa-${c.id}`}>
      <h4 id={`conversa-${c.id}`} className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3 font-display text-sm font-bold">
        Conversa no WhatsApp
        {c.situacao === 'aguardando' && (
          <span className="font-body text-xs font-semibold text-secondary-foreground">
            aguardando {c.cliente || 'o cliente'} · volta para a fila quando responder
          </span>
        )}
      </h4>

      {erro ? (
        <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm">
          {erro}{' '}
          <Link href={`/whatsapp?numero=${numero}`} className="font-semibold underline">
            Abrir em Delivery › WhatsApp
          </Link>
        </p>
      ) : (
        <>
          <div className="max-h-80 min-h-24 space-y-1.5 overflow-y-auto overflow-x-hidden rounded-md bg-secondary/40 p-2" aria-live="polite" aria-label="Mensagens">
            {msgs === null ? (
              <p className="py-6 text-center text-xs text-secondary-foreground">Carregando a conversa…</p>
            ) : msgs.length === 0 ? (
              <p className="py-6 text-center text-xs text-secondary-foreground">Ainda não há mensagens com este cliente. Você pode escrever a primeira.</p>
            ) : (
              msgs.map((m) => (
                <div key={m.id} className={`flex ${m.fromMe ? 'justify-end' : 'justify-start'}`}>
                  <div
                    className={`max-w-[85%] min-w-0 rounded-lg px-2.5 py-1.5 ${m.fromMe ? 'border border-ok/30 bg-ok/15 text-foreground' : 'border border-border bg-card text-foreground'}`}
                  >
                    {m.midia ? <MidiaMsg m={m} jid={jid} auto={false} /> : <span className="whitespace-pre-wrap break-words">{m.texto}</span>}
                    <span className="ml-2 align-bottom font-mono text-[11px] text-secondary-foreground">{hora(m.timestamp)}</span>
                  </div>
                </div>
              ))
            )}
            <div ref={fim} />
          </div>

          <div className="mt-2 flex flex-wrap gap-1.5" role="group" aria-label="Respostas prontas">
            {prontas.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setTexto(p)}
                className="min-h-9 min-w-0 max-w-full rounded-full border border-input bg-card px-3 py-1 text-left text-xs hover:border-secondary-foreground"
              >
                {p}
              </button>
            ))}
          </div>

          {/* O copiloto (mig 376): a sugestão vai para o campo; quem envia é a pessoa. */}
          <BotaoCopiloto
            casoId={c.id}
            mensagens={(msgs ?? [])
              .filter((m) => !m.midia && (m.texto ?? '').trim())
              .map((m) => ({ de: m.fromMe ? ('loja' as const) : ('cliente' as const), texto: m.texto ?? '' }))}
            prontas={prontas}
            aoSugerir={(t) => {
              setTexto(t);
              campo.current?.focus();
            }}
          />

          <form
            className="mt-2 flex items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void enviar();
            }}
          >
            <textarea
              ref={campo}
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void enviar();
                }
              }}
              rows={2}
              maxLength={1000}
              aria-label={`Escrever para ${c.cliente || 'o cliente'}`}
              placeholder="Escreva a resposta (Enter envia)"
              className="min-h-11 w-full min-w-0 flex-1 resize-y rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <Button type="submit" disabled={enviando || !texto.trim()} className="min-h-11 shrink-0">
              {enviando ? 'Enviando…' : 'Enviar'}
            </Button>
          </form>
        </>
      )}
      <p className="mt-2 text-xs text-secondary-foreground">
        {fraseDoRoboNoCaso(c)}{' '}
        <Link href={`/whatsapp?numero=${numero}`} className="font-semibold text-foreground underline underline-offset-2">
          Ver em Delivery › WhatsApp
        </Link>
      </p>
    </section>
  );
}
