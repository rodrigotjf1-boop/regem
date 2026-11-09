'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { api, getCategoria } from '@/lib/api';
import { toast } from '@/lib/toast';
import { Button } from '@/components/ui/button';
import { hora, type CasoDaFila } from '@/lib/atendimento';
import { perguntaAntes } from '@/lib/treino-do-atendente';
import { BotaoCopiloto } from '@/components/atendimento/botao-copiloto';
import { CorrigirResposta } from '@/components/atendimento/corrigir-resposta';

/* eslint-disable @typescript-eslint/no-explicit-any */

// A CONVERSA DO MESSENGER DENTRO DO CASO (mig 386 — protótipo `mockups/regem-central-atendimento.html` v17, bloco
// "Messenger com …"). O espelho da conversa do Direct: as mensagens do cliente, as da loja (a equipe pelo Regem e quem
// respondeu pela caixa de entrada da página no Facebook) e a resposta, que sai pela página — dentro da janela da Meta (24 h
// depois da última mensagem do cliente). "Corrigir" nas falas do robô (gerente e presidente). Relê a cada 5 s; "não li"
// aparece diferente de "vazio" (V37); só a leitura mais nova vale (V64). No servidor da loja o servidor busca na nuvem.

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
  perfil: { nome: string | null } | null;
  pagina: string | null;
  conectada: boolean;
  janela: { aberta: boolean; ate: string | null };
};

/** Até 2.000 caracteres por mensagem (regra do Messenger) — a mesma conta do servidor. */
const MAX = 2000;
const DESCRICAO: Record<string, string> = {
  imagem: '[foto]',
  audio: '[áudio]',
  video: '[vídeo]',
  arquivo: '[arquivo]',
  outro: '[mensagem que o Messenger não mostra aqui]',
};

/** Pontos de partida para quem atende — vão para o campo; a pessoa ajusta e envia. */
const PRONTAS = ['Oi! Aqui é da equipe da loja. Como posso ajudar?', 'Nosso cardápio está no link da página. Pode pedir por lá!', 'Vou confirmar e já te respondo por aqui.'];

function quemDaLoja(m: Mensagem): string {
  if (m.autor === 'loja') return 'loja · pela página no Facebook';
  if (m.autor === 'robo') return 'atendente virtual';
  return m.autorNome ?? 'equipe';
}

function dataHora(iso: string | null): string {
  if (!iso) return '';
  return new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export function ConversaDoMessenger({ caso: c, aberto, podeResponder }: { caso: CasoDaFila; aberto: boolean; podeResponder: boolean }) {
  const [conversa, setConversa] = useState<Conversa | null>(null);
  const [erro, setErro] = useState('');
  const [texto, setTexto] = useState('');
  const [aviso, setAviso] = useState('');
  const [enviando, setEnviando] = useState(false);
  const atual = useRef(c.id);
  const ultimaLeitura = useRef(0);
  const fim = useRef<HTMLDivElement>(null);
  const campo = useRef<HTMLTextAreaElement>(null);
  // "Corrigir" nas falas do robô: gerente e presidente ensinam o atendente (o servidor confere).
  const [podeEnsinar, setPodeEnsinar] = useState(false);
  useEffect(() => setPodeEnsinar(['presidente', 'gerente'].includes(getCategoria() ?? '')), []);
  const [corrigindo, setCorrigindo] = useState<{ id: string; pergunta: string; resposta: string } | null>(null);
  const [corrigidas, setCorrigidas] = useState<Set<string>>(() => new Set());

  const ler = useCallback(async (id: string) => {
    const n = ++ultimaLeitura.current;
    try {
      const r = (await api.atendimentoMessenger(id)) as Conversa;
      if (atual.current !== id || n !== ultimaLeitura.current) return;
      setConversa(r);
      setErro('');
    } catch (e: any) {
      if (atual.current === id && n === ultimaLeitura.current) setErro(e?.message || 'não foi possível ler o Messenger agora');
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
    if (t.length > MAX) return setAviso(`Mensagem longa demais para o Messenger (até ${MAX} caracteres).`);
    setAviso('');
    setEnviando(true);
    try {
      await api.atendimentoResponderMessenger(c.id, t);
      setTexto('');
      toast.success('Enviada no Messenger da página.');
      await ler(c.id);
    } catch (e: any) {
      setAviso(e?.code === 'FORA_DA_JANELA' ? 'Passaram 24 h da última mensagem do cliente: o Messenger não deixa responder agora.' : e?.message || 'Não foi possível enviar agora.');
    } finally {
      setEnviando(false);
    }
  }

  const nome = conversa?.perfil?.nome || c.detalhe?.messenger?.nome || c.cliente || 'o cliente';
  const janelaAberta = !!conversa?.janela.aberta;
  const podeEscrever = aberto && podeResponder && !!conversa?.conectada && janelaAberta;

  return (
    <section className="rounded-lg border border-border p-3 text-sm" aria-labelledby={`fb-${c.id}`}>
      <h4 id={`fb-${c.id}`} className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3 font-display text-sm font-bold">
        <span className="min-w-0 break-words">Messenger com {nome}</span>
        {conversa?.pagina && <span className="font-body text-xs font-semibold text-secondary-foreground">pela página {conversa.pagina}</span>}
      </h4>
      <p className="mb-2 text-xs text-secondary-foreground">O Facebook não manda telefone: sem pedido ligado.</p>

      {erro && (
        <p role="alert" className="mb-2 rounded-md bg-destructive/10 px-3 py-2 text-sm">
          Não consegui ler o Messenger agora ({erro}). {conversa ? 'Mostrando a última leitura; ' : ''}tentando de novo em instantes.
        </p>
      )}
      {conversa && !conversa.conectada && (
        <p className="mb-2 rounded-md bg-secondary px-3 py-2 text-sm">
          A página do Facebook não está conectada: para responder, conecte em Delivery › Configurações › Atendimento, grupo &quot;Messenger do Facebook&quot;, ou responda pela caixa
          de entrada da página.
        </p>
      )}

      <div className="max-h-80 min-h-24 space-y-1.5 overflow-y-auto overflow-x-hidden rounded-md bg-secondary/40 p-2" aria-live="polite" aria-label="Mensagens do Messenger">
        {conversa === null ? (
          erro ? null : <p className="py-6 text-center text-xs text-secondary-foreground">Carregando o Messenger…</p>
        ) : conversa.mensagens.length === 0 ? (
          <p className="py-6 text-center text-xs text-secondary-foreground">Ainda não há mensagens desta conversa.</p>
        ) : (
          conversa.mensagens.map((m, i) => {
            const daLoja = m.direcao === 'saida';
            const conteudo = m.texto || DESCRICAO[m.tipo] || '';
            const corrigivel = podeEnsinar && m.autor === 'robo' && !!m.texto;
            return (
              <div key={m.id} className={`flex ${daLoja ? 'justify-end' : 'justify-start'}`}>
                <div className={`min-w-0 max-w-[85%] rounded-lg px-2.5 py-1.5 ${daLoja ? 'border border-primary/30 bg-primary/10 text-foreground' : 'border border-border bg-card text-foreground'}`}>
                  <span className="whitespace-pre-wrap break-words">{conteudo}</span>
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
                  {corrigivel &&
                    (corrigidas.has(m.id) ? (
                      <span className="block pt-0.5 text-right text-xs font-semibold text-ok">✏️ Corrigida — o atendente já usa a resposta nova</span>
                    ) : (
                      <button
                        type="button"
                        className="mt-0.5 block min-h-6 text-xs font-semibold text-info underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        onClick={() =>
                          setCorrigindo({
                            id: m.id,
                            resposta: m.texto ?? '',
                            pergunta: perguntaAntes(
                              conversa.mensagens.map((x) => ({ autor: x.autor, texto: x.texto ?? '' })),
                              i,
                            ),
                          })
                        }
                      >
                        Corrigir
                      </button>
                    ))}
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
            mensagens={(conversa?.mensagens ?? []).map((m) => ({
              de: m.autor === 'cliente' ? ('cliente' as const) : m.autor === 'robo' ? ('robo' as const) : ('loja' as const),
              texto: m.texto || DESCRICAO[m.tipo] || '',
            }))}
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
                aria-label={`Escrever para ${nome} no Messenger`}
                aria-describedby={`fb-janela-${c.id}`}
                placeholder={`Escreva para ${nome} (sai no Messenger da página)`}
                className="min-h-11 w-full min-w-0 resize-y rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
              <span className="block text-right font-mono text-[11px] text-secondary-foreground">
                {texto.length}/{MAX}
              </span>
            </div>
            <Button type="submit" disabled={enviando || !texto.trim()} className="min-h-11 shrink-0">
              {enviando ? 'Enviando…' : 'Enviar pelo Messenger'}
            </Button>
          </form>
          {aviso && (
            <p role="alert" className="mt-1 text-sm font-semibold text-destructive">
              {aviso}
            </p>
          )}
        </>
      ) : aberto && conversa?.conectada && janelaAberta && !podeResponder ? (
        <p className="mt-2 text-secondary-foreground">Quem responde no Messenger é a gerência ou a supervisão.</p>
      ) : null}

      {conversa && (
        <p id={`fb-janela-${c.id}`} className="mt-2 text-xs text-secondary-foreground">
          {janelaAberta
            ? `⏱️ Pode responder até ${dataHora(conversa.janela.ate)} (24 h depois da última mensagem do cliente — regra da Meta). A mensagem também aparece na caixa de entrada da página no Facebook.`
            : 'Passaram 24 h da última mensagem do cliente: o Messenger não deixa a loja responder agora. Quando ele escrever de novo, a conversa abre.'}
        </p>
      )}

      {corrigindo && (
        <CorrigirResposta
          origem="caso"
          pergunta={corrigindo.pergunta}
          resposta={corrigindo.resposta}
          aoFechar={() => setCorrigindo(null)}
          aoSalvar={() => {
            setCorrigidas((s) => new Set(s).add(corrigindo.id));
            setCorrigindo(null);
          }}
        />
      )}
    </section>
  );
}
