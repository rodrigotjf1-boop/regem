'use client';

import { useState } from 'react';
import { api } from '@/lib/api';
import { JanelasEscolha } from '@/components/agendado/janelas-escolha';

/* eslint-disable @typescript-eslint/no-explicit-any */

// O PEDIDO AGENDADO NA PÁGINA DO PEDIDO (mig 455, D4b — protótipo `regem-atendente-alergenos-agendado.html`, parte 2,
// "Precisa mudar?"; G6): o horário marcado, quando a cozinha começa e, até o preparo começar, "Mudar o horário" e
// "Cancelar o pedido" pelo próprio cliente. Depois, só a loja. O servidor confere de novo (a janela, o limite, o dono).

const SP = 'America/Sao_Paulo';
const hora = (iso: string) => new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: SP });
/** O instante → "AAAA-MM-DDTHH:MM" de São Paulo (o valor das janelas). */
function valorDe(iso: string): string {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: SP, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(iso));
  const g = (t: string) => p.find((x) => x.type === t)?.value ?? '';
  return `${g('year')}-${g('month')}-${g('day')}T${g('hour')}:${g('minute')}`;
}
function quandoTexto(iso: string): string {
  const v = valorDe(iso);
  const hoje = valorDe(new Date().toISOString()).slice(0, 10);
  const amanha = valorDe(new Date(Date.now() + 86_400_000).toISOString()).slice(0, 10);
  const dia = v.slice(0, 10) === hoje ? 'hoje' : v.slice(0, 10) === amanha ? 'amanhã' : `${v.slice(8, 10)}/${v.slice(5, 7)}`;
  return `${dia}, ${v.slice(11)}`;
}

export function AgendadoNoPedido({ token, pedidoId, refDoLink, ped, onMudou }: { token: string; pedidoId: string; refDoLink?: string; ped: any; onMudou: () => void }) {
  const [modo, setModo] = useState<'' | 'horario' | 'cancelar'>('');
  const [novo, setNovo] = useState('');
  const [fazendo, setFazendo] = useState(false);
  const [aviso, setAviso] = useState<{ tom: 'ok' | 'erro'; texto: string } | null>(null);
  if (!ped?.agendado || !ped.agendamento) return null;
  const fim = new Date(new Date(ped.agendamento).getTime() + 15 * 60_000).toISOString();
  const podeMudar = ped.agendado.podeMudar === true && !!refDoLink;
  const tipo = ped.tipo === 'entrega' ? 'entrega' : 'retirada';

  async function mudar() {
    if (!novo || fazendo) return;
    setFazendo(true);
    setAviso(null);
    try {
      await api.cardapioMudarHorario(token, pedidoId, novo, refDoLink);
      setAviso({ tom: 'ok', texto: `Pronto! O pedido agora está agendado para ${quandoTexto(`${novo}:00-03:00`)}.` });
      setModo('');
      setNovo('');
      onMudou();
    } catch (e) {
      setAviso({ tom: 'erro', texto: e instanceof Error ? e.message : 'Não deu para mudar o horário.' });
    } finally {
      setFazendo(false);
    }
  }

  async function cancelar() {
    if (fazendo) return;
    setFazendo(true);
    setAviso(null);
    try {
      await api.cardapioCancelarEncomenda(token, pedidoId, undefined, refDoLink);
      setAviso({ tom: 'ok', texto: 'Pedido cancelado. Se você pagou no Pix, o estorno já foi pedido; o prazo para cair é do seu banco.' });
      setModo('');
      onMudou();
    } catch (e) {
      setAviso({ tom: 'erro', texto: e instanceof Error ? e.message : 'Não deu para cancelar o pedido.' });
    } finally {
      setFazendo(false);
    }
  }

  return (
    <section className="mt-5 space-y-3 rounded-xl border border-neutral-200 bg-white p-4" aria-labelledby="agendado-pedido-titulo">
      <div>
        <h2 id="agendado-pedido-titulo" className="text-base font-bold">🗓️ Agendado para {quandoTexto(ped.agendamento)}</h2>
        <p className="text-sm text-neutral-600">
          Chega entre {hora(ped.agendamento)} e {hora(fim)}. A cozinha começa às {hora(ped.agendado.comeca)}.
        </p>
      </div>
      {aviso && (
        <p role={aviso.tom === 'erro' ? 'alert' : 'status'} className={`rounded-lg px-3 py-2 text-sm ${aviso.tom === 'erro' ? 'bg-red-50 text-red-700' : 'bg-emerald-50 text-emerald-800'}`}>
          {aviso.texto}
        </p>
      )}
      {podeMudar ? (
        <>
          <p className="text-sm font-semibold">Precisa mudar?</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" aria-expanded={modo === 'horario'} onClick={() => setModo(modo === 'horario' ? '' : 'horario')} className="rounded-lg border border-neutral-300 px-3 py-2 text-sm font-semibold">
              Mudar o horário
            </button>
            <button type="button" aria-expanded={modo === 'cancelar'} onClick={() => setModo(modo === 'cancelar' ? '' : 'cancelar')} className="rounded-lg border border-neutral-300 px-3 py-2 text-sm font-semibold text-red-700">
              Cancelar o pedido
            </button>
          </div>
          {modo === 'horario' && (
            <div className="space-y-3 border-t border-neutral-200 pt-3">
              <JanelasEscolha
                idBase="pedido-agendado"
                carregar={(dia) => api.cardapioJanelasAgendado(token, dia, tipo) as any}
                atual={valorDe(ped.agendamento)}
                escolhida={novo}
                aoEscolher={setNovo}
              />
              <button type="button" disabled={!novo || novo === valorDe(ped.agendamento) || fazendo} onClick={() => void mudar()} className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
                {fazendo ? 'Mudando…' : 'Confirmar o novo horário'}
              </button>
            </div>
          )}
          {modo === 'cancelar' && (
            <div className="space-y-2 border-t border-neutral-200 pt-3" role="alertdialog" aria-labelledby="agendado-cancelar-titulo">
              <p id="agendado-cancelar-titulo" className="text-sm">
                Cancelar o pedido {ped.displayId ?? ''}, agendado para {quandoTexto(ped.agendamento)}?
                {ped.statusPagamento === 'aprovado' ? ' O Pix volta para a mesma conta.' : ''}
              </p>
              <div className="flex flex-wrap gap-2">
                <button type="button" disabled={fazendo} onClick={() => void cancelar()} className="rounded-lg bg-red-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
                  {fazendo ? 'Cancelando…' : 'Sim, cancelar'}
                </button>
                <button type="button" onClick={() => setModo('')} className="rounded-lg border border-neutral-300 px-4 py-2 text-sm font-semibold">
                  Não cancelar
                </button>
              </div>
            </div>
          )}
        </>
      ) : ped.agendado.podeMudar === false ? (
        <p className="text-sm text-neutral-600">O pedido já está sendo preparado. Para mudar alguma coisa, fale com a loja pelo WhatsApp.</p>
      ) : null}
    </section>
  );
}
