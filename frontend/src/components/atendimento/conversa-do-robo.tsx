'use client';

import { useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { toast } from '@/lib/toast';
import { Button } from '@/components/ui/button';
import { ChipDoCanal } from '@/components/atendimento/chip-do-canal';
import { STATUS_DO_PEDIDO, hora, tituloDaConversa, type ConversaAgora, type MensagemDaConversa } from '@/lib/atendimento';

// A CONVERSA SEM CASO ("Conversas agora" — protótipo v3): as últimas mensagens do chat do pedido, só leitura, e
// "Assumir a conversa", que abre o caso já com a pessoa e cala o robô nesta conversa (ele volta quando o caso for
// resolvido). Assume quem responde no chat — a gestão (o servidor confere).

const MOTIVO_DO_AVISO: Record<string, string> = { saiu: '"saiu para entrega"', chegando: '"chegando"', obrigado: '"obrigado"' };

function quemFalou(m: MensagemDaConversa): string | null {
  if (m.direcao === 'entrada') return m.autor === 'cliente' ? null : 'loja · pelo app da plataforma';
  if (m.autor === 'aviso') return `aviso automático${m.motivo && MOTIVO_DO_AVISO[m.motivo] ? ` ${MOTIVO_DO_AVISO[m.motivo]}` : ''}`;
  if (m.autor === 'robo') return 'robô';
  return 'equipe';
}

export function ConversaDoRobo({
  conversa: c,
  roboResponde,
  podeAssumir,
  aoAssumir,
  semTitulo = false,
}: {
  conversa: ConversaAgora;
  roboResponde: boolean;
  podeAssumir: boolean;
  /** O id do caso que nasceu (ou o que já existia sem ninguém); `null` quando não deu. */
  aoAssumir: (casoId: string | null) => Promise<void>;
  semTitulo?: boolean;
}) {
  const [assumindo, setAssumindo] = useState(false);
  const doCanal = c.canal === 'ifood' ? 'do iFood' : 'da 99';
  const plataforma = c.canal === 'ifood' ? 'iFood' : '99Food';

  async function assumir() {
    if (assumindo) return;
    setAssumindo(true);
    try {
      const r: any = await api.atendimentoAssumirConversa(c.canal, c.chave);
      toast.success(roboResponde ? 'A conversa é sua: o robô fica quieto nela.' : 'A conversa é sua.');
      await aoAssumir(typeof r?.id === 'string' ? r.id : null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Não foi possível assumir a conversa.');
      await aoAssumir(null);
    } finally {
      setAssumindo(false);
    }
  }

  return (
    <article className="min-w-0" aria-label={tituloDaConversa(c)}>
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-border p-4">
        <div className="min-w-0 flex-1 basis-64">
          <div className="flex flex-wrap items-center gap-1.5">
            <ChipDoCanal canal={c.canal} />
            <span className="rounded-full bg-secondary px-2 py-0.5 text-xs font-bold text-secondary-foreground">Mensagem no chat</span>
          </div>
          {!semTitulo && <h3 className="mt-1 break-words font-display text-lg font-bold">{tituloDaConversa(c)}</h3>}
          <p className="break-words text-sm text-secondary-foreground">
            {roboResponde ? 'o robô está atendendo' : 'sem caso aberto · o robô do chat está desligado'}
          </p>
        </div>
        {podeAssumir && (
          <Button type="button" disabled={assumindo} onClick={() => void assumir()}>
            {assumindo ? 'Assumindo…' : 'Assumir a conversa'}
          </Button>
        )}
      </header>
      <div className="space-y-4 p-4">
        <section className="rounded-lg border border-border p-3 text-sm" aria-label={`Chat ${doCanal}`}>
          <h4 className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3 font-display text-sm font-bold">
            <span className="min-w-0 break-words">
              Chat {doCanal}
              {c.cliente ? ` com ${c.cliente}` : ''}
            </span>
            {roboResponde && <span className="font-body text-xs font-semibold text-secondary-foreground">🤖 com o robô</span>}
          </h4>
          <div className="max-h-80 min-h-24 space-y-1.5 overflow-y-auto overflow-x-hidden rounded-md bg-secondary/40 p-2" aria-label="Mensagens do chat">
            {c.mensagens.map((m) => {
              const doCliente = m.direcao === 'entrada' && m.autor === 'cliente';
              const quem = quemFalou(m);
              return (
                <div key={m.id} className={`flex ${doCliente ? 'justify-start' : 'justify-end'}`}>
                  <div
                    className={`min-w-0 max-w-[85%] rounded-lg px-2.5 py-1.5 text-foreground ${
                      doCliente ? 'border border-border bg-card' : 'border border-primary/30 bg-primary/10'
                    }`}
                  >
                    <span className="whitespace-pre-wrap break-words">{m.texto}</span>
                    <span className="mt-0.5 flex flex-wrap justify-end gap-x-1.5 text-[11px] text-secondary-foreground">
                      {quem && <span>{quem}</span>}
                      <span className="font-mono">{hora(m.em)}</span>
                      {m.direcao === 'saida' && m.estado === 'enviada' && <span className="font-semibold text-foreground">✓ enviada</span>}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
          <p className="mt-2 text-xs text-secondary-foreground">
            {!podeAssumir
              ? 'Quem responde no chat é a gerência ou a supervisão.'
              : roboResponde
                ? 'O robô está atendendo. "Assumir a conversa" cala o robô e põe o caso com você.'
                : '"Assumir a conversa" abre o caso com você para responder ao cliente por aqui.'}
          </p>
        </section>

        {c.pedidoNumero && (
          <section className="rounded-lg border border-border p-3 text-sm">
            <h4 className="mb-1 font-display text-sm font-bold">Pedido ligado</h4>
            <p className="break-words">
              {plataforma} {c.pedidoNumero}
              {c.pedidoStatus ? ` · ${STATUS_DO_PEDIDO[c.pedidoStatus] ?? c.pedidoStatus}` : ''}
            </p>
            <Link href="/delivery" className="mt-1 inline-block font-semibold text-foreground underline underline-offset-2">
              Ver no painel do Delivery
            </Link>
          </section>
        )}
      </div>
    </article>
  );
}
