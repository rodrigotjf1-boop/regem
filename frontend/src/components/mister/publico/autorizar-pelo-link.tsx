'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { RegemMark } from '@/components/brand/regem-mark';
import { api } from '@/lib/api';
import { ESPERANDO, comMaiuscula, faltam, linhaDaResposta, pinCompleto, reais, soDigitosDoPin, type VistaDoLinkDoMister } from '@/lib/mister-link';
import { useSenhaSemSalvar } from '@/lib/use-senha-sem-salvar';

// A PÁGINA DO LINK COM PIN DO MISTER (F4.2a, mig 433; protótipo `mockups/regem-mister-pin.html`, aprovado em 16/11/2026).
// O que mexe com dinheiro, cancelamento ou configuração: o Mister manda o link, a página mostra o que vai acontecer e pede
// o PIN de quem recebeu. Isolada (sem o menu do Regem), sem login e sem guardar nada no aparelho. O estado vem decidido
// do servidor; o PIN é conferido lá (a página nunca sabe o PIN certo).
// Diferença do protótipo: o PIN do Regem tem de 4 a 6 dígitos, então é UM campo (com a máscara de pontos) no lugar dos
// 4 quadrinhos — os quadrinhos diriam o tamanho do PIN e não caberiam o de 6.

type Leitura = { tipo: 'carregando' } | { tipo: 'naoVale' } | { tipo: 'erro'; texto: string } | { tipo: 'ok'; v: VistaDoLinkDoMister };

const statusDe = (e: unknown) => (e && typeof e === 'object' && 'status' in e ? Number((e as { status: unknown }).status) : 0);
const mensagemDe = (e: unknown, padrao: string) => (e instanceof Error && e.message ? e.message : padrao);

export function AutorizarPeloLink({ codigo }: { codigo: string }) {
  const [l, setL] = useState<Leitura>({ tipo: 'carregando' });
  const [pin, setPin] = useState('');
  const [aviso, setAviso] = useState<string | null>(null);
  const [enviando, setEnviando] = useState<'autorizar' | 'nao' | null>(null);
  const [agora, setAgora] = useState<number | null>(null);
  const vez = useRef(0);
  const pinRef = useRef<HTMLInputElement>(null);
  const campoPin = useSenhaSemSalvar();

  // Só a resposta da leitura mais nova vale (V64): o acompanhamento e o toque podem se cruzar.
  const ler = useCallback(async () => {
    const n = ++vez.current;
    try {
      const v = await api.misterLinkVer(codigo);
      if (n === vez.current) setL({ tipo: 'ok', v });
    } catch (e) {
      if (n !== vez.current) return;
      setL(statusDe(e) === 404 ? { tipo: 'naoVale' } : { tipo: 'erro', texto: mensagemDe(e, 'Não consegui falar com o Regem.') });
    }
  }, [codigo]);

  useEffect(() => {
    void ler();
  }, [ler]);

  // O relógio da página só escreve o "faltam N min" (V35: fora do primeiro desenho).
  useEffect(() => {
    setAgora(Date.now());
    const t = setInterval(() => setAgora(Date.now()), 15_000);
    return () => clearInterval(t);
  }, []);

  const v = l.tipo === 'ok' ? l.v : null;
  const estado = v?.estado ?? null;
  const restante = v && agora != null ? faltam(v.valeAte, agora) : 'aguardando';

  // Enquanto o Regem executa, a página acompanha a cada 3 s (só com ela aberta).
  useEffect(() => {
    if (!estado || !ESPERANDO.includes(estado)) return;
    const t = setInterval(() => void ler(), 3_000);
    return () => clearInterval(t);
  }, [estado, ler]);

  // O prazo passou com a página aberta: o servidor é que diz "venceu".
  useEffect(() => {
    if (estado === 'proposta' && restante === null) void ler();
  }, [estado, restante, ler]);

  const responder = async (qual: 'autorizar' | 'nao') => {
    if (enviando || (qual === 'autorizar' && !pinCompleto(pin))) return;
    setEnviando(qual);
    setAviso(null);
    const n = ++vez.current;
    try {
      const r = qual === 'autorizar' ? await api.misterLinkAutorizar(codigo, pin) : await api.misterLinkNaoAutorizar(codigo);
      if (n !== vez.current) return;
      setL({ tipo: 'ok', v: r });
      setPin('');
      if (r.erro) {
        setAviso(r.erro);
        pinRef.current?.focus();
      }
    } catch (e) {
      if (n !== vez.current) return;
      const s = statusDe(e);
      if (s === 404) setL({ tipo: 'naoVale' });
      else if (s === 429) setAviso('Muitas tentativas agora. Espere um minuto e tente de novo.');
      else setAviso(mensagemDe(e, 'Não consegui falar com o Regem. Confira a internet e tente de novo.'));
    } finally {
      setEnviando(null);
    }
  };

  return (
    <div className="app-light min-h-screen bg-background font-sans text-foreground">
      <header className="bg-foreground text-card">
        <div className="mx-auto flex max-w-md items-center gap-3 px-4 py-3">
          <RegemMark className="h-8 w-8 flex-none" />
          <div className="min-w-0">
            <p className="font-display text-base font-bold">Mister</p>
            <p className="break-words text-xs text-card/80">Autorização no Regem{v?.empresa ? ` · ${v.empresa}` : ''}</p>
          </div>
        </div>
      </header>

      <main className="mx-auto grid max-w-md gap-3 px-4 py-4" data-link-do-mister data-estado={l.tipo === 'ok' ? l.v.estado : l.tipo}>
        {l.tipo === 'carregando' && (
          <p className="rounded-xl border border-border bg-card p-4 text-sm" role="status">
            Abrindo a autorização…
          </p>
        )}

        {l.tipo === 'naoVale' && (
          <Estado titulo="Este link não vale">
            <p>Ele pode ter sido trocado por um link novo, ou não vale mais para você. Nada foi feito.</p>
            <p className="text-foreground/75">Se ainda precisar, peça de novo ao Mister.</p>
          </Estado>
        )}

        {l.tipo === 'erro' && (
          <Estado titulo="Não consegui abrir esta autorização" tom="crit">
            <p className="break-words">{l.texto}</p>
            <div>
              <button type="button" className="mt-1 min-h-11 rounded-lg border border-border bg-card px-4 font-semibold" onClick={() => void ler()}>
                Tentar de novo
              </button>
            </div>
          </Estado>
        )}

        {v && v.estado === 'proposta' && (
          <>
            <section className="min-w-0 rounded-xl border border-border bg-card p-4" aria-labelledby="link-titulo">
              <h1 id="link-titulo" className="break-words font-display text-lg font-bold">
                {v.titulo}
              </h1>
              {(v.detalhe || v.valor != null) && (
                <div className="mt-1 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                  {v.detalhe && <span className="min-w-0 break-words text-sm text-foreground/75">{v.detalhe}</span>}
                  {v.valor != null && <span className="font-mono text-xl font-bold">{reais(v.valor)}</span>}
                </div>
              )}
              {v.itens.length > 0 && (
                <ul className="mt-2 grid gap-1.5 text-sm" aria-label="O que vai acontecer">
                  {v.itens.map((i) => (
                    <li key={i} className="flex gap-2">
                      <span aria-hidden="true">•</span>
                      <span className="min-w-0 break-words">{i}</span>
                    </li>
                  ))}
                </ul>
              )}
              <p className="mt-2 break-words text-sm text-foreground/75">{v.pedidoPor}</p>
            </section>

            <p className="flex flex-wrap items-center gap-x-2 rounded-xl border border-primary/50 bg-primary/10 px-4 py-2 text-sm" role="status">
              <span aria-hidden="true">⏱</span>
              <span>
                Vale até <b className="font-mono">{v.valeAteHora}</b>
                {restante && restante !== 'aguardando' ? ` · ${restante}` : ''}
              </span>
            </p>

            <section className="rounded-xl border border-border bg-card p-4">
              <label htmlFor="link-pin" className="block font-display font-semibold">
                Digite o seu PIN do Regem
              </label>
              <input
                id="link-pin"
                ref={pinRef}
                {...campoPin}
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={6}
                value={pin}
                onChange={(e) => setPin(soDigitosDoPin(e.target.value))}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void responder('autorizar');
                }}
                aria-describedby="link-pin-nota"
                aria-invalid={aviso ? true : undefined}
                className="mt-2 min-h-12 w-full max-w-56 rounded-lg border border-input bg-background px-3 text-center font-mono text-2xl tracking-[0.35em]"
              />
              {aviso ? (
                <p id="link-pin-nota" className="mt-2 break-words text-sm font-semibold text-destructive" role="alert">
                  {aviso}
                </p>
              ) : (
                <p id="link-pin-nota" className="mt-2 text-sm text-foreground/75">
                  O mesmo PIN que você usa para entrar no Regem e no PDV.
                </p>
              )}
            </section>

            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <button
                type="button"
                className="min-h-12 rounded-lg bg-primary px-4 font-semibold text-primary-foreground disabled:opacity-60"
                disabled={!pinCompleto(pin) || !!enviando}
                onClick={() => void responder('autorizar')}
              >
                {enviando === 'autorizar' ? 'Conferindo o PIN…' : v.botao}
              </button>
              <button
                type="button"
                className="min-h-12 rounded-lg border border-border bg-card px-4 font-semibold disabled:opacity-60"
                disabled={!!enviando}
                onClick={() => void responder('nao')}
              >
                {enviando === 'nao' ? 'Enviando…' : 'Não autorizar'}
              </button>
            </div>
          </>
        )}

        {v && v.estado === 'fazendo' && (
          <Estado titulo="Fazendo agora…">
            <span aria-hidden="true" className="mx-auto my-1 h-8 w-8 rounded-full border-4 border-primary/30 border-t-primary motion-safe:animate-spin" />
            <p>O PIN conferiu e o Regem está fazendo o que você autorizou.</p>
            <p className="text-foreground/75">Pode fechar: o resultado também chega no WhatsApp.</p>
          </Estado>
        )}

        {v && v.estado === 'feito' && (
          <Estado titulo={`Feito${v.concluidaHora ? ` às ${v.concluidaHora}` : ''}`} tom="ok">
            {v.resultado && <p className="break-words">{comMaiuscula(v.resultado)}</p>}
            <Resposta v={v} />
            <p className="text-foreground/75">O Mister também avisou no WhatsApp. Pode fechar esta página.</p>
          </Estado>
        )}

        {v && v.estado === 'naodeu' && (
          <Estado titulo="Não deu" tom="crit">
            {v.resultado && <p className="break-words">{comMaiuscula(v.resultado)}</p>}
            <Resposta v={v} />
            <p className="text-foreground/75">O Mister também avisou no WhatsApp.</p>
          </Estado>
        )}

        {v && v.estado === 'recusou' && (
          <Estado titulo="Você não autorizou">
            <p>Nada foi feito.</p>
            <Resposta v={v} />
            <p className="text-foreground/75">Se mudar de ideia, peça de novo ao Mister.</p>
          </Estado>
        )}

        {v && v.estado === 'venceu' && (
          <Estado titulo="Este pedido de autorização venceu">
            <p>Ele valia até {v.valeAteHora}. Nada foi feito.</p>
            <p className="text-foreground/75">Se ainda precisar, peça de novo ao Mister.</p>
          </Estado>
        )}

        {v && v.estado === 'bloqueado' && (
          <Estado titulo="Link bloqueado por segurança" tom="crit">
            <p>O PIN foi digitado errado 5 vezes. Nada foi feito.</p>
            <p className="text-foreground/75">Para tentar de novo, peça ao Mister outra vez. Se não foi você, avise o suporte.</p>
          </Estado>
        )}

        <p className="px-1 text-center text-xs text-foreground/75">Esta página é só desta autorização. Nada fica guardado neste aparelho.</p>
      </main>
    </div>
  );
}

function Estado({ titulo, tom = 'neutro', children }: { titulo: string; tom?: 'neutro' | 'ok' | 'crit'; children: React.ReactNode }) {
  const cor = tom === 'ok' ? 'border-ok/50 bg-ok/10' : tom === 'crit' ? 'border-destructive/50 bg-destructive/10' : 'border-border bg-card';
  return (
    <section className={`grid gap-1.5 rounded-xl border p-4 text-sm ${cor}`} role="status" aria-labelledby="link-estado">
      <h1 id="link-estado" className="break-words font-display text-lg font-bold">
        {titulo}
      </h1>
      {children}
    </section>
  );
}

function Resposta({ v }: { v: VistaDoLinkDoMister }) {
  const linha = linhaDaResposta(v);
  return linha ? <p className="break-words text-foreground/75">{linha}</p> : null;
}
