'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { toast } from '@/lib/toast';
import { Button } from '@/components/ui/button';
import { hora, type CasoDaFila } from '@/lib/atendimento';
import { TEXTO_MAX_DO_CHAT, temContatoProibido } from '@/lib/texto-do-chat';

/* eslint-disable @typescript-eslint/no-explicit-any */

// O CHAT DO iFOOD E DA 99 DENTRO DO CASO (ponte do chat, Etapa 2 — protótipo `mockups/regem-central-atendimento.html` v3,
// bloco "Chat do iFood com …"). A conversa do pedido (o cliente, a loja pelo Gestor, os avisos automáticos e a equipe) e a
// resposta: ela entra na fila da PONTE, o programa do PC da loja que digita no chat da plataforma. Cada mensagem da loja
// mostra se saiu (✓ enviada), se está saindo ou esperando a ponte, ou por que não saiu. Relê a cada 5 s (como a conversa do
// WhatsApp do caso). No servidor da loja o servidor busca na nuvem; "não li" aparece diferente de "vazio" (V37).

type Mensagem = {
  id: string;
  direcao: 'entrada' | 'saida';
  autor: 'cliente' | 'loja' | 'robo' | 'equipe' | 'aviso';
  texto: string;
  estado: string;
  erro: string | null;
  motivo: string | null;
  quem: string | null;
  em: string;
  enviadoEm: string | null;
};
type Conversa = { disponivel: boolean; canal: 'ifood' | '99food' | null; ponte: { ligada: boolean; responde: boolean }; mensagens: Mensagem[] };

/** Pontos de partida para quem atende — vão para o campo; a pessoa ajusta e envia. */
const PRONTAS = [
  'Oi! Aqui é da equipe da loja. Já estamos vendo o seu pedido.',
  'Vou confirmar e já te respondo por aqui.',
  'Sentimos muito pelo transtorno.',
  'O entregador já está a caminho.',
];

const MOTIVO_DO_AVISO: Record<string, string> = { saiu: '"saiu para entrega"', chegando: '"chegando"', obrigado: '"obrigado"' };

function rotuloDaLoja(m: Mensagem): string {
  if (m.direcao === 'entrada') return 'loja · pelo app da plataforma';
  if (m.autor === 'aviso') return `aviso automático${m.motivo && MOTIVO_DO_AVISO[m.motivo] ? ` ${MOTIVO_DO_AVISO[m.motivo]}` : ''}`;
  if (m.autor === 'robo') return 'robô';
  return m.quem ?? 'equipe';
}

function SituacaoDoEnvio({ m, ponteResponde }: { m: Mensagem; ponteResponde: boolean }) {
  if (m.direcao !== 'saida') return null;
  // A cor da tinta (não o verde de "ok", fraco em 11 px sobre fundo claro): o ✓ e a palavra dizem o estado.
  if (m.estado === 'enviada') return <span className="font-semibold text-foreground">✓ enviada</span>;
  if (m.estado === 'enviando') return <span className="font-semibold">⏳ saindo pela ponte…</span>;
  if (m.estado === 'pendente') return <span className="font-semibold">{ponteResponde ? '⏳ na fila da ponte' : '⏳ esperando a ponte'}</span>;
  const porque = m.estado === 'cancelada' ? 'passou da hora (30 min)' : m.erro;
  return <span className="font-semibold text-destructive">✕ não saiu{porque ? `: ${porque}` : ''}</span>;
}

export function ChatDaPlataforma({ caso: c, aberto, podeResponder }: { caso: CasoDaFila; aberto: boolean; podeResponder: boolean }) {
  const doCanal = c.canal === 'ifood' ? 'do iFood' : 'da 99';
  const pelo = c.canal === 'ifood' ? 'pelo iFood' : 'pela 99';
  const ondeResponder = c.canal === 'ifood' ? 'Gestor de Pedidos do iFood' : 'portal da 99';
  const numero = c.pedidoNaPlataforma ?? c.detalhe?.chat?.pedidoNumero ?? c.pedidoNumero ?? null;
  const [conversa, setConversa] = useState<Conversa | null>(null);
  const [erro, setErro] = useState('');
  const [texto, setTexto] = useState('');
  const [aviso, setAviso] = useState('');
  const [enviando, setEnviando] = useState(false);
  const atual = useRef(c.id);
  // A conversa é lida pelo relógio (5 s) e logo depois de enviar: só a resposta da leitura MAIS NOVA vale (V64) — uma
  // leitura antiga que chega atrasada não volta a mostrar a conversa de antes.
  const ultimaLeitura = useRef(0);
  const fim = useRef<HTMLDivElement>(null);
  const campo = useRef<HTMLTextAreaElement>(null);

  const ler = useCallback(async (id: string) => {
    const n = ++ultimaLeitura.current;
    try {
      const r = (await api.atendimentoChat(id)) as Conversa;
      if (atual.current !== id || n !== ultimaLeitura.current) return; // trocou de caso, ou já há leitura mais nova
      setConversa(r);
      setErro('');
    } catch (e: any) {
      // A leitura falhou: o que já estava fica, marcado como "não li agora" — nunca vira "conversa vazia" (V37).
      if (atual.current === id && n === ultimaLeitura.current) setErro(e?.message || 'não foi possível ler o chat agora');
    }
  }, []);

  useEffect(() => {
    atual.current = c.id;
    setConversa(null);
    setErro('');
    setAviso('');
    void ler(c.id);
    const t = setInterval(() => void ler(c.id), 5000);
    return () => clearInterval(t);
  }, [c.id, ler]);

  // Desce até a última mensagem quando chega uma nova — só dentro da caixa da conversa (a página não pula).
  const quantas = conversa?.mensagens.length ?? 0;
  useEffect(() => {
    const el = fim.current?.parentElement;
    if (el) el.scrollTop = el.scrollHeight;
  }, [quantas]);

  async function enviar() {
    const t = texto.trim();
    if (!t || enviando) return;
    if (t.length > TEXTO_MAX_DO_CHAT) return setAviso(`No chat da plataforma cabem até ${TEXTO_MAX_DO_CHAT} letras.`);
    if (temContatoProibido(t)) {
      setAviso(`${c.canal === 'ifood' ? 'O iFood' : 'A 99'} proíbe telefone, WhatsApp, Instagram e link no chat. Tire isso da mensagem para enviar.`);
      campo.current?.focus();
      return;
    }
    setAviso('');
    setEnviando(true);
    try {
      await api.atendimentoResponderChat(c.id, t);
      setTexto('');
      toast.success(`Mensagem na fila da ponte: sai ${pelo}.`);
      await ler(c.id);
    } catch (e: any) {
      setAviso(e?.message || 'Não foi possível enviar agora.');
    } finally {
      setEnviando(false);
    }
  }

  const ligada = conversa?.ponte.ligada ?? true;
  const responde = conversa?.ponte.responde ?? true;
  const podeEscrever = aberto && podeResponder && !!conversa?.disponivel && ligada;

  return (
    <section className="rounded-lg border border-border p-3 text-sm" aria-labelledby={`chat-${c.id}`}>
      <h4 id={`chat-${c.id}`} className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3 font-display text-sm font-bold">
        <span className="min-w-0 break-words">
          Chat {doCanal} com {c.cliente || c.pedidoCliente || 'o cliente'}
        </span>
        <span className="font-body text-xs font-semibold text-secondary-foreground">
          {numero ? `pedido ${numero} · ` : ''}pela ponte
        </span>
      </h4>

      {erro && (
        <p role="alert" className="mb-2 rounded-md bg-destructive/10 px-3 py-2 text-sm">
          Não consegui ler o chat agora ({erro}). {conversa ? 'Mostrando a última leitura; ' : ''}tentando de novo em instantes.
        </p>
      )}
      {conversa && !conversa.ponte.ligada && (
        <p className="mb-2 rounded-md bg-secondary px-3 py-2 text-sm">
          A ponte do chat está desligada: as mensagens novas não chegam aqui. Para responder, use o {ondeResponder}.
        </p>
      )}
      {conversa?.ponte.ligada && !conversa.ponte.responde && (
        <p className="mb-2 rounded-md border border-warn/40 bg-warn/10 px-3 py-2 text-sm">
          Nenhum PC da loja está com a ponte {doCanal} agora: o que você escrever sai quando ela voltar (se passar de 30 min, não
          sai mais). Para responder já, use o {ondeResponder}.
        </p>
      )}

      <div className="max-h-80 min-h-24 space-y-1.5 overflow-y-auto overflow-x-hidden rounded-md bg-secondary/40 p-2" aria-live="polite" aria-label="Mensagens do chat">
        {conversa === null ? (
          erro ? null : <p className="py-6 text-center text-xs text-secondary-foreground">Carregando o chat…</p>
        ) : conversa.mensagens.length === 0 ? (
          <p className="py-6 text-center text-xs text-secondary-foreground">Ainda não há mensagens deste pedido no chat.</p>
        ) : (
          conversa.mensagens.map((m) => {
            const daLoja = !(m.direcao === 'entrada' && m.autor === 'cliente');
            return (
              <div key={m.id} className={`flex ${daLoja ? 'justify-end' : 'justify-start'}`}>
                <div
                  className={`min-w-0 max-w-[85%] rounded-lg px-2.5 py-1.5 ${
                    daLoja ? 'border border-primary/30 bg-primary/10 text-foreground' : 'border border-border bg-card text-foreground'
                  }`}
                >
                  <span className="whitespace-pre-wrap break-words">{m.texto}</span>
                  <span className="mt-0.5 flex flex-wrap justify-end gap-x-1.5 text-[11px] text-secondary-foreground">
                    {daLoja && <span>{rotuloDaLoja(m)}</span>}
                    <span className="font-mono">{hora(m.em)}</span>
                    <SituacaoDoEnvio m={m} ponteResponde={responde} />
                  </span>
                </div>
              </div>
            );
          })
        )}
        <div ref={fim} />
      </div>

      {podeEscrever ? (
        <>
          <div className="mt-2 flex flex-wrap gap-1.5" role="group" aria-label="Respostas prontas">
            {PRONTAS.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => {
                  setTexto(p);
                  setAviso('');
                  campo.current?.focus();
                }}
                className="min-h-9 min-w-0 max-w-full rounded-full border border-input bg-card px-3 py-1 text-left text-xs hover:border-secondary-foreground"
              >
                {p}
              </button>
            ))}
          </div>
          <form
            className="mt-2 flex flex-wrap items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void enviar();
            }}
          >
            <div className="min-w-0 flex-1 basis-56">
              <textarea
                ref={campo}
                value={texto}
                onChange={(e) => {
                  setTexto(e.target.value);
                  if (aviso) setAviso('');
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    void enviar();
                  }
                }}
                rows={2}
                maxLength={TEXTO_MAX_DO_CHAT}
                aria-label={`Escrever para ${c.cliente || 'o cliente'} no chat ${doCanal}`}
                aria-describedby={`chat-regra-${c.id}`}
                placeholder={`Escreva para ${c.cliente || 'o cliente'} (sai no chat ${doCanal})`}
                className="min-h-11 w-full min-w-0 resize-y rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
              <span className="block text-right font-mono text-[11px] text-secondary-foreground">
                {texto.length}/{TEXTO_MAX_DO_CHAT}
              </span>
            </div>
            <Button type="submit" disabled={enviando || !texto.trim()} className="min-h-11 shrink-0">
              {enviando ? 'Enviando…' : `Enviar ${pelo}`}
            </Button>
          </form>
          {aviso && (
            <p role="alert" className="mt-1 text-sm font-semibold text-destructive">
              {aviso}
            </p>
          )}
        </>
      ) : aberto && conversa?.disponivel && ligada && !podeResponder ? (
        <p className="mt-2 text-secondary-foreground">Quem responde no chat é a gerência ou a supervisão.</p>
      ) : null}

      <p id={`chat-regra-${c.id}`} className="mt-2 text-xs text-secondary-foreground">
        Sai pela ponte do PC da loja, como se alguém digitasse no chat {doCanal}. Telefone, WhatsApp, Instagram e link o Regem barra: a
        plataforma proíbe.
      </p>
    </section>
  );
}
