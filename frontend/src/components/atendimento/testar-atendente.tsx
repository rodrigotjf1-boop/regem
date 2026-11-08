'use client';

import { useEffect, useRef, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Gaveta } from '@/components/ui/sobreposto';
import { NO_SERVIDOR_DA_LOJA } from '@/components/ui/so-pela-nuvem';
import { CorrigirResposta } from '@/components/atendimento/corrigir-resposta';
import { OQueAprendeu } from '@/components/atendimento/o-que-aprendeu';
import {
  MAX_MENSAGEM_DE_TESTE,
  perguntaAntes,
  type CanalDoTeste,
  type ConversaDeTeste,
  type ItemDeConhecimento,
  type MensagemDoTeste,
} from '@/lib/treino-do-atendente';

const EXEMPLOS = ['Qual o horário de hoje?', 'Vocês entregam no meu bairro?', 'Faltou um item no meu pedido', 'Sou fornecedor e quero falar com o responsável', 'Tem vaga de emprego?'];
const NOME_DO_CANAL: Record<CanalDoTeste, string> = { whatsapp: 'WhatsApp', direct: 'Direct', chat: 'Chat do iFood' };
/** O rótulo do botão do canal (curto, cabe três na linha). */
const BOTAO_DO_CANAL: Record<CanalDoTeste, string> = { whatsapp: 'WhatsApp', direct: 'Direct', chat: 'Chat iFood/99' };
/** De quanto em quanto tempo a tela lê a conversa enquanto o atendente responde (o servidor diz quando parar). */
const LER_A_CADA_MS = 1500;

const botaoDeEscolha = (ativo: boolean) =>
  `min-h-11 flex-1 basis-28 rounded-md border px-3 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
    ativo ? 'border-primary bg-primary/10 shadow-[inset_0_0_0_1px_hsl(var(--primary))]' : 'border-input bg-card hover:border-foreground/40'
  }`;

/**
 * "🧪 TESTAR O ATENDENTE" (F4, mig 382; protótipo v13): a conversa de teste com o MESMO atendente virtual da loja, no
 * canal escolhido (WhatsApp ou Direct) e, se quiser, como fora do horário. Nada sai para clientes: o servidor entrega ao
 * robô com uma chave de teste e devolve como linha "sistema" o que aconteceria na conversa real (equipe chamada, recado,
 * pedido). A conversa é criada na primeira mensagem; mudar o canal ou o horário começa outra. Em cada resposta,
 * "Corrigir" vira conhecimento; a aba "O que ele aprendeu" mostra a lista. Só gerente e presidente (o servidor confere).
 */
export function TestarAtendente({ aoFechar }: { aoFechar: () => void }) {
  const [aba, setAba] = useState<'conversa' | 'aprendido'>('conversa');
  const [canal, setCanal] = useState<CanalDoTeste>('whatsapp');
  const [fora, setFora] = useState(false);
  const [conversa, setConversa] = useState<ConversaDeTeste | null>(null);
  const [texto, setTexto] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState('');
  const [indisponivel, setIndisponivel] = useState('');
  const [lerDeNovo, setLerDeNovo] = useState(false);
  const [corrigindo, setCorrigindo] = useState<{ msg: MensagemDoTeste; pergunta: string } | null>(null);
  const [corrigidas, setCorrigidas] = useState<Set<string>>(() => new Set());
  const [itens, setItens] = useState<ItemDeConhecimento[] | null>(null);
  const [erroItens, setErroItens] = useState('');
  // Só a resposta da leitura mais nova vale (V64), e só se ainda for a conversa da tela.
  const leitura = useRef(0);
  const idAtual = useRef<string | null>(null);
  const fim = useRef<HTMLDivElement>(null);

  // O que ele aprendeu: lido ao abrir (a aba mostra a conta).
  useEffect(() => {
    if (NO_SERVIDOR_DA_LOJA) return;
    let vivo = true;
    api
      .atendimentoConhecimento()
      .then((r: { itens?: ItemDeConhecimento[] }) => vivo && setItens(Array.isArray(r?.itens) ? r.itens : []))
      .catch((e: Error) => vivo && setErroItens(e?.message || 'Não deu para ler o que o atendente aprendeu.'));
    return () => {
      vivo = false;
      leitura.current++;
    };
  }, []);

  async function lerConversa(id: string) {
    const n = ++leitura.current;
    try {
      const c: ConversaDeTeste = await api.atendimentoTeste(id);
      if (n === leitura.current && idAtual.current === id) {
        setConversa(c);
        setLerDeNovo(false);
      }
    } catch (e) {
      if (n === leitura.current && idAtual.current === id) {
        setErro((e as Error)?.message || 'Não deu para ler a resposta do atendente agora.');
        setLerDeNovo(true);
      }
    }
  }

  // Enquanto o atendente responde, a tela lê a conversa (o servidor diz `esperandoResposta` — até 90 s).
  useEffect(() => {
    if (!conversa?.esperandoResposta || lerDeNovo) return;
    const id = conversa.id;
    const t = setTimeout(() => void lerConversa(id), LER_A_CADA_MS);
    return () => clearTimeout(t);
  }, [conversa, lerDeNovo]);

  useEffect(() => {
    fim.current?.scrollIntoView({ block: 'nearest' });
  }, [conversa?.mensagens.length, conversa?.esperandoResposta]);

  function novaConversa() {
    idAtual.current = null;
    leitura.current++;
    setConversa(null);
    setErro('');
    setLerDeNovo(false);
    setCorrigidas(new Set());
  }

  async function enviar(bruto: string) {
    const t = bruto.trim().slice(0, MAX_MENSAGEM_DE_TESTE);
    if (!t || enviando || conversa?.esperandoResposta) return;
    setEnviando(true);
    setErro('');
    try {
      let c = conversa;
      if (!c) {
        c = (await api.atendimentoTesteCriar({ canal, foraDoHorario: fora })) as ConversaDeTeste;
        idAtual.current = c.id;
        setConversa(c);
      }
      const r: { entregue?: boolean; motivo?: string } = await api.atendimentoTesteMensagem(c.id, t);
      setTexto('');
      await lerConversa(c.id);
      // `robo_nao_recebeu`: o servidor já pôs na conversa a linha que explica ("mande de novo daqui a pouco").
      if (r && r.entregue === false && r.motivo !== 'robo_nao_recebeu') setErro('O atendente não recebeu a mensagem agora. Mande de novo daqui a pouco.');
    } catch (e) {
      const ae = e instanceof ApiError ? e : null;
      if (ae?.code === 'ROBO_INDISPONIVEL') setIndisponivel(ae.message || 'O atendente virtual não está disponível nesta instalação.');
      else if (ae?.code === 'SEM_CARDAPIO') setIndisponivel(ae.message || 'Ative o cardápio online da loja antes de testar o atendente.');
      else if (ae?.status === 429) setErro('Muitas mensagens de teste em pouco tempo. Espere um minuto e tente de novo.');
      else setErro((e as Error)?.message || 'Não deu para enviar agora. Tente de novo.');
    } finally {
      setEnviando(false);
    }
  }

  const esperando = !!conversa?.esperandoResposta;
  const indisponivelTexto = NO_SERVIDOR_DA_LOJA
    ? 'No servidor da loja o atendente virtual não roda: faça o teste no Regem na nuvem (app.dmsregem.com), na mesma tela.'
    : indisponivel;

  return (
    <Gaveta titulo="Testar o atendente" aoFechar={aoFechar}>
      {indisponivelTexto ? (
        <p role="note" className="rounded-md border-l-4 border-warn bg-warn/15 px-3 py-2 text-sm" data-teste-indisponivel>
          {indisponivelTexto}
        </p>
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2" role="group" aria-label="O que ver na gaveta">
            <button type="button" className={botaoDeEscolha(aba === 'conversa')} aria-pressed={aba === 'conversa'} onClick={() => setAba('conversa')}>
              Conversa de teste
            </button>
            <button type="button" className={botaoDeEscolha(aba === 'aprendido')} aria-pressed={aba === 'aprendido'} onClick={() => setAba('aprendido')}>
              O que ele aprendeu · <b>{itens ? itens.length : '…'}</b>
            </button>
          </div>

          {aba === 'conversa' ? (
            <div className="space-y-3" data-painel-teste>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                <div className="flex min-w-0 flex-1 basis-56 flex-wrap gap-2" role="group" aria-label="Canal do teste">
                  {(['whatsapp', 'direct', 'chat'] as const).map((k) => (
                    <button
                      key={k}
                      type="button"
                      className={botaoDeEscolha(canal === k)}
                      aria-pressed={canal === k}
                      disabled={enviando}
                      onClick={() => {
                        if (canal === k) return;
                        setCanal(k);
                        novaConversa();
                      }}
                    >
                      {BOTAO_DO_CANAL[k]}
                    </button>
                  ))}
                </div>
                <label className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold">
                  <input
                    type="checkbox"
                    className="h-5 w-5"
                    checked={fora}
                    disabled={enviando}
                    onChange={(e) => {
                      setFora(e.target.checked);
                      novaConversa();
                    }}
                  />
                  Simular fora do horário
                </label>
              </div>
              <p className="text-sm text-secondary-foreground">
                Escreva como um cliente. Responde o mesmo atendente virtual da loja, com o perfil do canal escolhido. <b className="text-foreground">Nada sai para clientes</b>:
                chamar a equipe, recados e pedidos viram simulação. Mudar o canal ou o horário começa outra conversa.
              </p>

              <div className="min-h-32 space-y-1.5 rounded-md bg-secondary/40 p-2" aria-live="polite" aria-label="Conversa de teste" data-msgs-teste>
                {!conversa || (conversa.mensagens.length === 0 && !esperando) ? (
                  <p className="py-8 text-center text-sm text-secondary-foreground">Escreva a primeira mensagem, como um cliente faria.</p>
                ) : (
                  conversa.mensagens.map((m, i) =>
                    m.autor === 'sistema' ? (
                      <p key={m.id} className="rounded-md bg-warn/15 px-3 py-1.5 text-center text-xs text-foreground" data-simulado>
                        {m.texto}
                      </p>
                    ) : m.autor === 'cliente' ? (
                      <div key={m.id} className="flex justify-start">
                        <div className="min-w-0 max-w-[85%] rounded-lg border border-border bg-card px-2.5 py-1.5">
                          <span className="whitespace-pre-wrap break-words">{m.texto}</span>
                          <span className="block text-[11px] text-secondary-foreground">você, como cliente · {NOME_DO_CANAL[conversa.canal]}</span>
                        </div>
                      </div>
                    ) : (
                      <div key={m.id} className="flex justify-end" data-resposta-robo>
                        <div className="min-w-0 max-w-[85%] rounded-lg border border-info/30 bg-info/10 px-2.5 py-1.5">
                          <span className="whitespace-pre-wrap break-words">{m.texto}</span>
                          {m.opcoes?.length ? (
                            <ol className="mt-1 list-decimal pl-5 text-sm">
                              {m.opcoes.map((o, j) => (
                                <li key={j} className="break-words">
                                  {o.titulo}
                                  {o.descricao ? ` — ${o.descricao}` : ''}
                                </li>
                              ))}
                            </ol>
                          ) : null}
                          <span className="block text-[11px] text-secondary-foreground">atendente virtual</span>
                          {corrigidas.has(m.id) ? (
                            <span className="block pt-0.5 text-xs font-semibold text-ok">✏️ Corrigida — pergunte de novo para ver</span>
                          ) : (
                            <button
                              type="button"
                              className="mt-0.5 min-h-6 text-xs font-semibold text-info underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                              onClick={() => setCorrigindo({ msg: m, pergunta: perguntaAntes(conversa.mensagens, i) })}
                            >
                              Corrigir
                            </button>
                          )}
                        </div>
                      </div>
                    ),
                  )
                )}
                {esperando && <p className="text-right text-sm italic text-secondary-foreground">escrevendo…</p>}
                <div ref={fim} />
              </div>

              {erro && (
                <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm">
                  {erro}{' '}
                  {lerDeNovo && conversa && (
                    <button type="button" className="font-semibold underline" onClick={() => void lerConversa(conversa.id)}>
                      Ler de novo
                    </button>
                  )}
                </p>
              )}

              <div className="flex flex-wrap gap-1.5" role="group" aria-label="Exemplos de pergunta">
                {EXEMPLOS.map((x) => (
                  <button
                    key={x}
                    type="button"
                    disabled={enviando || esperando}
                    onClick={() => void enviar(x)}
                    className="min-h-9 min-w-0 max-w-full rounded-full border border-input bg-card px-3 py-1 text-left text-xs hover:border-secondary-foreground disabled:opacity-60"
                  >
                    {x}
                  </button>
                ))}
              </div>
              <div className="flex items-end gap-2">
                <textarea
                  value={texto}
                  maxLength={MAX_MENSAGEM_DE_TESTE}
                  rows={2}
                  aria-label="Mensagem de teste, como cliente"
                  placeholder="Escreva como um cliente (Enter envia)"
                  autoFocus
                  onChange={(e) => setTexto(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      void enviar(texto);
                    }
                  }}
                  className="min-h-11 min-w-0 flex-1 resize-y rounded-md border border-input bg-card px-3 py-2 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
                <Button type="button" onClick={() => void enviar(texto)} disabled={enviando || esperando || !texto.trim()}>
                  {enviando ? 'Enviando…' : 'Enviar'}
                </Button>
              </div>
              <Button type="button" variant="outline" size="sm" onClick={novaConversa} disabled={enviando || !conversa}>
                Começar outra conversa
              </Button>
            </div>
          ) : (
            <OQueAprendeu itens={itens} erro={erroItens} aoMudar={setItens} />
          )}
        </div>
      )}

      {corrigindo && (
        <CorrigirResposta
          origem="teste"
          pergunta={corrigindo.pergunta}
          resposta={corrigindo.msg.texto}
          aoFechar={() => setCorrigindo(null)}
          aoSalvar={(salvo) => {
            setCorrigidas((s) => new Set(s).add(corrigindo.msg.id));
            setItens((l) => [...(l ?? []).filter((x) => x.id !== salvo.id), salvo]);
            setCorrigindo(null);
          }}
        />
      )}
    </Gaveta>
  );
}
