'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { toast } from '@/lib/toast';
import { Button } from '@/components/ui/button';
import { hora, type CasoDaFila } from '@/lib/atendimento';
import { BotaoCopiloto } from '@/components/atendimento/botao-copiloto';

/* eslint-disable @typescript-eslint/no-explicit-any */

// A CONVERSA DO INSTAGRAM DIRECT DENTRO DO CASO (mig 377 — protótipo `mockups/regem-central-atendimento.html` v7, bloco
// "Direct do Instagram com …"). As mensagens do cliente, as da loja (a equipe pelo Regem e quem respondeu no próprio app
// do Instagram) e a resposta, que sai na hora pela conta da loja — dentro da janela do Instagram (24 h depois da última
// mensagem do cliente). No Instagram a loja pode mandar link e telefone: o canal é dela. Relê a cada 5 s; "não li" aparece
// diferente de "vazio" (V37); só a leitura mais nova vale (V64). No servidor da loja o servidor busca na nuvem.

type Mensagem = {
  id: string;
  direcao: 'entrada' | 'saida';
  autor: 'cliente' | 'equipe' | 'loja' | 'robo';
  tipo: string;
  texto: string | null;
  midiaUrl: string | null;
  estado: string;
  erro: string | null;
  criadoEm: string;
  autorNome: string | null;
};
type Conversa = {
  mensagens: Mensagem[];
  perfil: { usuario: string | null; nome: string | null; segue: boolean | null } | null;
  conta: string | null;
  conectada: boolean;
  janela: { aberta: boolean; ate: string | null };
};

/** O texto vai em UTF-8 e com até 1.000 bytes (regra do Instagram) — a conta é a mesma do servidor. */
const MAX_BYTES = 1000;
const bytes = (s: string) => new TextEncoder().encode(s).length;
const DESCRICAO: Record<string, string> = {
  imagem: '[foto]',
  audio: '[áudio]',
  video: '[vídeo]',
  arquivo: '[arquivo]',
  compartilhamento: '[publicação compartilhada]',
  story: '[menção no story]',
  reel: '[reel]',
  outro: '[mensagem que o Instagram não mostra aqui]',
};

/** Pontos de partida para quem atende — vão para o campo; a pessoa ajusta e envia. */
const PRONTAS = [
  'Oi! Aqui é da equipe da loja. Como posso ajudar?',
  'Nosso cardápio está no link da bio. Pode pedir por lá!',
  'Vou confirmar e já te respondo por aqui.',
];

function quemDaLoja(m: Mensagem): string {
  if (m.autor === 'loja') return 'loja · pelo app do Instagram';
  if (m.autor === 'robo') return 'robô';
  return m.autorNome ?? 'equipe';
}

function dataHora(iso: string | null): string {
  if (!iso) return '';
  return new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export function ConversaDoInstagram({ caso: c, aberto, podeResponder }: { caso: CasoDaFila; aberto: boolean; podeResponder: boolean }) {
  const [conversa, setConversa] = useState<Conversa | null>(null);
  const [erro, setErro] = useState('');
  const [texto, setTexto] = useState('');
  const [aviso, setAviso] = useState('');
  const [enviando, setEnviando] = useState(false);
  const atual = useRef(c.id);
  const ultimaLeitura = useRef(0);
  const fim = useRef<HTMLDivElement>(null);
  const campo = useRef<HTMLTextAreaElement>(null);

  const ler = useCallback(async (id: string) => {
    const n = ++ultimaLeitura.current;
    try {
      const r = (await api.atendimentoInstagram(id)) as Conversa;
      if (atual.current !== id || n !== ultimaLeitura.current) return;
      setConversa(r);
      setErro('');
    } catch (e: any) {
      if (atual.current === id && n === ultimaLeitura.current) setErro(e?.message || 'não foi possível ler o Direct agora');
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

  const quantas = conversa?.mensagens.length ?? 0;
  useEffect(() => {
    const el = fim.current?.parentElement;
    if (el) el.scrollTop = el.scrollHeight;
  }, [quantas]);

  async function enviar() {
    const t = texto.trim();
    if (!t || enviando) return;
    if (bytes(t) > MAX_BYTES) return setAviso('Mensagem longa demais para o Instagram (até 1.000 caracteres simples).');
    setAviso('');
    setEnviando(true);
    try {
      await api.atendimentoResponderInstagram(c.id, t);
      setTexto('');
      toast.success('Enviada no Direct da loja.');
      await ler(c.id);
    } catch (e: any) {
      setAviso(e?.message || 'Não foi possível enviar agora.');
    } finally {
      setEnviando(false);
    }
  }

  const perfil = conversa?.perfil;
  const usuario = perfil?.usuario ? `@${perfil.usuario}` : c.detalhe?.instagram?.usuario ? `@${c.detalhe.instagram.usuario}` : null;
  const nome = perfil?.nome || c.cliente || 'o cliente';
  const janelaAberta = !!conversa?.janela.aberta;
  const podeEscrever = aberto && podeResponder && !!conversa?.conectada && janelaAberta;

  return (
    <section className="rounded-lg border border-border p-3 text-sm" aria-labelledby={`ig-${c.id}`}>
      <h4 id={`ig-${c.id}`} className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3 font-display text-sm font-bold">
        <span className="min-w-0 break-words">Direct do Instagram com {usuario ?? nome}</span>
        {conversa?.conta && <span className="font-body text-xs font-semibold text-secondary-foreground">pela conta @{conversa.conta}</span>}
      </h4>
      {perfil && (
        <p className="mb-2 text-xs text-secondary-foreground">
          {perfil.nome ? `${perfil.nome} · ` : ''}
          {perfil.segue === true ? 'segue a loja' : perfil.segue === false ? 'não segue a loja' : 'perfil do Instagram'} · o Instagram não manda telefone
        </p>
      )}

      {erro && (
        <p role="alert" className="mb-2 rounded-md bg-destructive/10 px-3 py-2 text-sm">
          Não consegui ler o Direct agora ({erro}). {conversa ? 'Mostrando a última leitura; ' : ''}tentando de novo em instantes.
        </p>
      )}
      {conversa && !conversa.conectada && (
        <p className="mb-2 rounded-md bg-secondary px-3 py-2 text-sm">
          O Instagram da loja não está conectado: para responder, conecte em Delivery › Configurações › Atendimento, grupo &quot;Instagram Direct&quot;, ou
          responda pelo app do Instagram.
        </p>
      )}

      <div className="max-h-80 min-h-24 space-y-1.5 overflow-y-auto overflow-x-hidden rounded-md bg-secondary/40 p-2" aria-live="polite" aria-label="Mensagens do Direct">
        {conversa === null ? (
          erro ? null : <p className="py-6 text-center text-xs text-secondary-foreground">Carregando o Direct…</p>
        ) : conversa.mensagens.length === 0 ? (
          <p className="py-6 text-center text-xs text-secondary-foreground">Ainda não há mensagens desta conversa.</p>
        ) : (
          conversa.mensagens.map((m) => {
            const daLoja = m.direcao === 'saida';
            const conteudo = m.estado === 'apagada' ? 'mensagem apagada pelo cliente' : m.texto || DESCRICAO[m.tipo] || '';
            return (
              <div key={m.id} className={`flex ${daLoja ? 'justify-end' : 'justify-start'}`}>
                <div
                  className={`min-w-0 max-w-[85%] rounded-lg px-2.5 py-1.5 ${
                    daLoja ? 'border border-primary/30 bg-primary/10 text-foreground' : 'border border-border bg-card text-foreground'
                  }`}
                >
                  <span className={`whitespace-pre-wrap break-words ${m.estado === 'apagada' ? 'italic text-secondary-foreground' : ''}`}>{conteudo}</span>
                  {m.midiaUrl && (
                    <a href={m.midiaUrl} target="_blank" rel="noopener noreferrer" className="ml-1 font-semibold underline underline-offset-2">
                      abrir
                    </a>
                  )}
                  <span className="mt-0.5 flex flex-wrap justify-end gap-x-1.5 text-[11px] text-secondary-foreground">
                    {daLoja && <span>{quemDaLoja(m)}</span>}
                    <span className="font-mono">{hora(m.criadoEm)}</span>
                    {daLoja && m.estado === 'enviada' && <span className="font-semibold text-foreground">✓ enviada</span>}
                    {daLoja && m.estado === 'falhou' && <span className="font-semibold text-destructive">✕ não saiu{m.erro ? `: ${m.erro}` : ''}</span>}
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
          <BotaoCopiloto
            casoId={c.id}
            mensagens={(conversa?.mensagens ?? [])
              .filter((m) => m.estado !== 'apagada')
              .map((m) => ({ de: m.autor === 'cliente' ? ('cliente' as const) : m.autor === 'robo' ? ('robo' as const) : ('loja' as const), texto: m.texto || DESCRICAO[m.tipo] || '' }))}
            prontas={PRONTAS}
            aoSugerir={(t) => {
              setTexto(t);
              setAviso('');
              campo.current?.focus();
            }}
          />
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
                aria-label={`Escrever para ${nome} no Instagram`}
                aria-describedby={`ig-janela-${c.id}`}
                placeholder={`Escreva para ${nome} (sai no Direct da loja)`}
                className="min-h-11 w-full min-w-0 resize-y rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
              <span className="block text-right font-mono text-[11px] text-secondary-foreground">
                {bytes(texto)}/{MAX_BYTES}
              </span>
            </div>
            <Button type="submit" disabled={enviando || !texto.trim()} className="min-h-11 shrink-0">
              {enviando ? 'Enviando…' : 'Enviar pelo Instagram'}
            </Button>
          </form>
          {aviso && (
            <p role="alert" className="mt-1 text-sm font-semibold text-destructive">
              {aviso}
            </p>
          )}
        </>
      ) : aberto && conversa?.conectada && janelaAberta && !podeResponder ? (
        <p className="mt-2 text-secondary-foreground">Quem responde no Instagram é a gerência ou a supervisão.</p>
      ) : null}

      {conversa && (
        <p id={`ig-janela-${c.id}`} className="mt-2 text-xs text-secondary-foreground">
          {janelaAberta
            ? `⏱️ Pode responder até ${dataHora(conversa.janela.ate)} (24 h depois da última mensagem do cliente — regra do Instagram). A mensagem também aparece no app do Instagram da loja.`
            : 'Passaram 24 h da última mensagem do cliente: o Instagram não deixa a loja responder agora. Quando ele escrever de novo, a conversa abre.'}
        </p>
      )}
    </section>
  );
}
