'use client';

import { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { getClienteToken } from '@/components/loja/tipos';

/* eslint-disable @typescript-eslint/no-explicit-any */

// "CHEGUEI" NA RETIRADA (Onda 3, mig 354; protótipo `mockups/regem-relacionamento.html`, telas 1 a 3 do cliente).
// Na página do pedido de RETIRADA: "Já chegou à loja?" → (se a loja pergunta) "Onde você está?" → a loja é avisada.
// Depois do tempo do ajuste, "Avisar de novo". Só aparece com o "Cheguei" ligado na loja, com o pedido esperando o
// cliente, no dia da retirada e com a prova de dono (o `ref` do link ou o token de Sua conta) — sem ela o servidor recusa.

const ESPERANDO = ['novo', 'confirmado', 'pronto'];
const hhmm = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '';
const mesmoDia = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

export function ChegueiDoPedido({
  token,
  pedidoId,
  refDoLink,
  ped,
  abrirAoCarregar,
  onMudou,
}: {
  token: string;
  pedidoId: string;
  refDoLink?: string;
  ped: any;
  abrirAoCarregar?: boolean;
  onMudou: () => void;
}) {
  const [folha, setFolha] = useState(false);
  const [onde, setOnde] = useState<'balcao' | 'porta' | null>(null);
  const [obs, setObs] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState('');
  const [agora, setAgora] = useState(() => Date.now());
  const abriu = useRef(false);
  const primeiroBotao = useRef<HTMLButtonElement | null>(null);
  const botaoCheguei = useRef<HTMLButtonElement | null>(null);

  const c = ped?.cheguei;
  const clienteToken = typeof window !== 'undefined' ? getClienteToken(token) : null;
  const temProva = !!refDoLink || !!clienteToken;
  const dia = new Date(ped?.agendamento ?? ped?.criadoEm ?? 0);
  const mostra =
    ped?.tipo === 'retirada' && c?.ativo === true && ESPERANDO.includes(String(ped?.status)) && temProva && mesmoDia(dia, new Date(agora));
  const chegada = c?.chegada ?? null;
  const pronto = ped?.status === 'pronto';
  const podeDeNovoEm = chegada?.podeDeNovoEm ? Date.parse(chegada.podeDeNovoEm) : 0;
  const faltaMin = Math.max(0, Math.ceil((podeDeNovoEm - agora) / 60_000));

  // O relógio do "Avisar de novo" (o primeiro desenho é o do servidor: a hora entra depois de montar — V35).
  useEffect(() => {
    const t = setInterval(() => setAgora(Date.now()), 15_000);
    return () => clearInterval(t);
  }, []);
  // A cada leitura do pedido (a página relê a cada 8 s), o relógio acompanha — senão o "em X min" contava da abertura.
  useEffect(() => setAgora(Date.now()), [ped]);

  // Veio de Sua conta (`?cheguei=1`): abre a pergunta uma vez, quando os dados chegam.
  useEffect(() => {
    if (!abrirAoCarregar || abriu.current || !mostra || chegada) return;
    abriu.current = true;
    if (c?.perguntarOnde) setFolha(true);
  }, [abrirAoCarregar, mostra, chegada, c?.perguntarOnde]);

  useEffect(() => {
    if (!folha) return;
    primeiroBotao.current?.focus();
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setFolha(false);
    };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [folha]);

  if (!mostra) return null;

  function fechar() {
    setFolha(false);
    botaoCheguei.current?.focus();
  }

  async function avisar(deNovo = false) {
    setEnviando(true);
    setErro('');
    try {
      await api.cardapioCheguei(token, pedidoId, {
        ref: refDoLink || undefined,
        clienteToken: clienteToken || undefined,
        ...(c?.perguntarOnde && !deNovo ? { onde, obs: obs.trim() || undefined } : {}),
      });
      setFolha(false);
      onMudou();
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não deu para avisar a loja. Tente de novo.');
    } finally {
      setEnviando(false);
    }
  }

  if (chegada)
    return (
      <div className="space-y-3">
        <div role="status" className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-emerald-800">
          <p className="font-bold">A loja sabe que você chegou · {hhmm(chegada.chegouEm)}</p>
          <p className="mt-0.5 text-sm">
            {pronto
              ? `Seu pedido está no balcão. Diga o seu nome ou o número ${ped.displayId ?? ''}.`.replace(/ \.$/, '.')
              : 'Seu pedido ainda está em preparo. Avisamos a cozinha.'}
          </p>
        </div>
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
          <p className="font-bold">Ainda esperando?</p>
          <p className="mt-0.5 text-sm text-neutral-700">Depois de {c.deNovoMin} minutos, dá para avisar de novo.</p>
          <button
            type="button"
            onClick={() => avisar(true)}
            disabled={enviando || faltaMin > 0}
            className="mt-2 min-h-[44px] w-full rounded-xl border border-neutral-300 bg-white px-4 text-sm font-bold text-neutral-900 disabled:text-neutral-500"
          >
            {faltaMin > 0 ? `Avisar de novo · em ${faltaMin} min` : enviando ? 'Avisando…' : 'Avisar de novo'}
          </button>
          {erro && (
            <p role="alert" className="mt-2 text-sm font-semibold text-red-700">
              {erro}
            </p>
          )}
        </div>
      </div>
    );

  return (
    <>
      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
        <p className="font-bold">Já chegou à loja?</p>
        <p className="mt-0.5 text-sm text-neutral-700">Avise aqui e a equipe separa o seu pedido.</p>
        <button
          ref={botaoCheguei}
          type="button"
          onClick={() => (c.perguntarOnde ? setFolha(true) : avisar())}
          disabled={enviando}
          className="mt-2 min-h-[48px] w-full rounded-xl px-4 text-base font-extrabold"
          style={{ background: '#E2A340', color: '#281B06' }}
        >
          {enviando && !folha ? 'Avisando…' : '🙋 Cheguei'}
        </button>
        {erro && !folha && (
          <p role="alert" className="mt-2 text-sm font-semibold text-red-700">
            {erro}
          </p>
        )}
      </div>

      {folha && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40" onClick={(e) => e.target === e.currentTarget && fechar()}>
          <div role="dialog" aria-modal="true" aria-labelledby="cheguei-titulo" className="w-full max-w-md space-y-3 rounded-t-2xl bg-white p-4 pb-6 text-neutral-900 shadow-2xl">
            <p id="cheguei-titulo" className="text-lg font-extrabold">
              Onde você está?
            </p>
            <div className="grid grid-cols-2 gap-2" role="group" aria-label="Onde você está">
              {(
                [
                  ['balcao', '🏪', 'No balcão'],
                  ['porta', '🛵🚗', 'Na porta, de moto ou carro'],
                ] as const
              ).map(([k, icone, rotulo], i) => (
                <button
                  key={k}
                  ref={i === 0 ? primeiroBotao : undefined}
                  type="button"
                  aria-pressed={onde === k}
                  onClick={() => setOnde(onde === k ? null : k)}
                  className={`min-h-[68px] rounded-xl border px-2 text-sm font-bold ${
                    onde === k ? 'border-amber-500 bg-amber-50 ring-1 ring-amber-500' : 'border-neutral-300 bg-white'
                  }`}
                >
                  <span aria-hidden="true">{icone}</span>
                  <br />
                  {rotulo}
                </button>
              ))}
            </div>
            <div>
              <label htmlFor="cheguei-obs" className="text-xs font-bold text-neutral-700">
                Como te achar? (opcional)
              </label>
              <input
                id="cheguei-obs"
                value={obs}
                maxLength={80}
                onChange={(e) => setObs(e.target.value)}
                placeholder="Ex.: moto vermelha, carro prata"
                className="mt-1 min-h-[44px] w-full rounded-xl border border-neutral-300 px-3"
              />
            </div>
            {erro && (
              <p role="alert" className="text-sm font-semibold text-red-700">
                {erro}
              </p>
            )}
            <button
              type="button"
              onClick={() => avisar()}
              disabled={enviando}
              className="min-h-[48px] w-full rounded-xl px-4 text-base font-extrabold"
              style={{ background: '#E2A340', color: '#281B06' }}
            >
              {enviando ? 'Avisando…' : 'Avisar a loja'}
            </button>
            <button type="button" onClick={fechar} className="min-h-[44px] w-full rounded-xl border border-neutral-300 bg-white text-sm font-bold">
              Cancelar
            </button>
            <p className="text-xs text-neutral-600">Sem escolher nada, a loja recebe só &quot;chegou&quot;.</p>
          </div>
        </div>
      )}
    </>
  );
}
