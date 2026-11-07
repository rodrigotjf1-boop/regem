'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { toast } from '@/lib/toast';
import { Button } from '@/components/ui/button';
import { ChipDoCanal } from '@/components/atendimento/chip-do-canal';
import { STATUS_DO_PEDIDO, hora, telefoneLegivel, tituloDaConversa, type ConversaAgora, type MensagemDaConversa } from '@/lib/atendimento';

/* eslint-disable @typescript-eslint/no-explicit-any */

// A CONVERSA SEM CASO ("Conversas agora" — protótipo v3): as últimas mensagens da conversa, só leitura, e "Assumir a
// conversa", que abre o caso já com a pessoa e cala o robô nesta conversa (ele volta quando o caso for resolvido).
// iFood/99: as mensagens vêm com a lista; assume quem responde no chat — a gestão (o servidor confere). WhatsApp: a
// conversa a tela lê da caixa do WhatsApp ao abrir (a mesma rota de Delivery › WhatsApp); só quem atende a caixa vê.

const MOTIVO_DO_AVISO: Record<string, string> = { saiu: '"saiu para entrega"', chegando: '"chegando"', obrigado: '"obrigado"' };
const RELER_WHATSAPP_MS = 8000;

function quemFalou(m: MensagemDaConversa, direct = false): string | null {
  // Direct (mig 378): `loja` é quem respondeu pelo próprio app do Instagram.
  if (direct && m.autor === 'loja') return 'loja · pelo app do Instagram';
  if (m.direcao === 'entrada') return m.autor === 'cliente' ? null : 'loja · pelo app da plataforma';
  if (m.autor === 'aviso') return `aviso automático${m.motivo && MOTIVO_DO_AVISO[m.motivo] ? ` ${MOTIVO_DO_AVISO[m.motivo]}` : ''}`;
  if (m.autor === 'robo') return 'robô';
  return 'equipe';
}

function Bolha({ daLoja, texto, quem, em, enviada }: { daLoja: boolean; texto: string; quem: string | null; em: string; enviada?: boolean }) {
  return (
    <div className={`flex ${daLoja ? 'justify-end' : 'justify-start'}`}>
      <div className={`min-w-0 max-w-[85%] rounded-lg px-2.5 py-1.5 text-foreground ${daLoja ? 'border border-primary/30 bg-primary/10' : 'border border-border bg-card'}`}>
        <span className="whitespace-pre-wrap break-words">{texto}</span>
        <span className="mt-0.5 flex flex-wrap justify-end gap-x-1.5 text-[11px] text-secondary-foreground">
          {quem && <span>{quem}</span>}
          <span className="font-mono">{hora(em)}</span>
          {enviada && <span className="font-semibold text-foreground">✓ enviada</span>}
        </span>
      </div>
    </div>
  );
}

/** As mensagens do WhatsApp pela caixa (Evolution ou API oficial), relidas a cada 8 s — só a leitura mais nova vale (V64). */
function MensagensDoWhatsapp({ jids }: { jids: string[] }) {
  const [msgs, setMsgs] = useState<any[] | null>(null);
  const [erro, setErro] = useState(false);
  const leitura = useRef(0);
  const chave = jids.join(',');
  useEffect(() => {
    let vivo = true;
    const ler = async () => {
      const n = ++leitura.current;
      try {
        const r: any = await api.whatsappMensagens(chave);
        if (!vivo || n !== leitura.current) return;
        setMsgs(Array.isArray(r) ? r : []);
        setErro(false);
      } catch {
        if (vivo && n === leitura.current) setErro(true);
      }
    };
    void ler();
    const t = setInterval(() => {
      if (document.visibilityState === 'visible') void ler();
    }, RELER_WHATSAPP_MS);
    return () => {
      vivo = false;
      clearInterval(t);
    };
  }, [chave]);
  if (msgs === null) return <p className="px-1 py-4 text-center text-secondary-foreground">{erro ? 'Não consegui ler a conversa agora.' : 'Carregando a conversa…'}</p>;
  const ultimas = msgs.slice(-12);
  return (
    <>
      {erro && <p className="text-xs text-destructive">Não consegui atualizar agora; mostrando a última leitura.</p>}
      {!ultimas.length && <p className="px-1 py-4 text-center text-secondary-foreground">Sem mensagens para mostrar.</p>}
      {ultimas.map((m, i) => (
        <Bolha
          key={String(m.id ?? i)}
          daLoja={!!m.fromMe}
          texto={typeof m.texto === 'string' && m.texto ? m.texto : '[mídia]'}
          quem={m.fromMe ? 'loja' : null}
          em={m.timestamp ? new Date(Number(m.timestamp) * 1000).toISOString() : ''}
        />
      ))}
    </>
  );
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
  const whatsapp = c.canal === 'whatsapp';
  const direct = c.canal === 'instagram';
  const comRobo = c.comRobo ?? roboResponde;
  const doCanal = whatsapp ? 'no WhatsApp' : direct ? 'do Instagram' : c.canal === 'ifood' ? 'do iFood' : 'da 99';
  const plataforma = c.canal === 'ifood' ? 'iFood' : '99Food';

  async function assumir() {
    if (assumindo) return;
    setAssumindo(true);
    try {
      const r: any = await api.atendimentoAssumirConversa(c.canal, c.chave, whatsapp ? c.cliente : null);
      toast.success(comRobo ? 'A conversa é sua: o robô fica quieto nela.' : 'A conversa é sua.');
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
            <span className="rounded-full bg-secondary px-2 py-0.5 text-xs font-bold text-secondary-foreground">
              {whatsapp ? 'Conversa no WhatsApp' : direct ? 'Mensagem no Direct' : 'Mensagem no chat'}
            </span>
          </div>
          {!semTitulo && <h3 className="mt-1 break-words font-display text-lg font-bold">{tituloDaConversa(c)}</h3>}
          <p className="break-words text-sm text-secondary-foreground">
            {comRobo ? 'o robô está atendendo' : 'sem caso aberto · o robô do chat está desligado'}
          </p>
        </div>
        {podeAssumir && (
          <Button type="button" disabled={assumindo} onClick={() => void assumir()}>
            {assumindo ? 'Assumindo…' : 'Assumir a conversa'}
          </Button>
        )}
      </header>
      <div className="space-y-4 p-4">
        <section
          className="rounded-lg border border-border p-3 text-sm"
          aria-label={whatsapp ? 'Conversa no WhatsApp' : direct ? 'Direct do Instagram' : `Chat ${doCanal}`}
        >
          <h4 className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3 font-display text-sm font-bold">
            <span className="min-w-0 break-words">
              {whatsapp
                ? 'Conversa no WhatsApp'
                : direct
                  ? `Direct do Instagram${c.usuario || c.cliente ? ` com ${c.usuario || c.cliente}` : ''}`
                  : `Chat ${doCanal}${c.cliente ? ` com ${c.cliente}` : ''}`}
            </span>
            {comRobo && <span className="font-body text-xs font-semibold text-secondary-foreground">🤖 com o robô</span>}
          </h4>
          <div className="max-h-80 min-h-24 space-y-1.5 overflow-y-auto overflow-x-hidden rounded-md bg-secondary/40 p-2" aria-label="Mensagens da conversa">
            {whatsapp ? (
              <MensagensDoWhatsapp jids={c.jids?.length ? c.jids : [String(c.telefone ?? '')]} />
            ) : (
              c.mensagens.map((m) => (
                <Bolha
                  key={m.id}
                  daLoja={!(m.direcao === 'entrada' && m.autor === 'cliente')}
                  texto={m.texto}
                  quem={quemFalou(m, direct)}
                  em={m.em}
                  enviada={m.direcao === 'saida' && m.estado === 'enviada'}
                />
              ))
            )}
          </div>
          <p className="mt-2 text-xs text-secondary-foreground">
            {!podeAssumir
              ? `Quem responde no ${direct ? 'Direct' : 'chat'} é a gerência ou a supervisão.`
              : comRobo
                ? 'O robô está atendendo. "Assumir a conversa" cala o robô e põe o caso com você.'
                : '"Assumir a conversa" abre o caso com você para responder ao cliente por aqui.'}
          </p>
        </section>

        {direct && (
          <section className="rounded-lg border border-border p-3 text-sm">
            <h4 className="mb-1 font-display text-sm font-bold">Cliente</h4>
            <p className="break-words">
              {[c.cliente && c.cliente !== c.usuario ? c.cliente : null, c.usuario].filter(Boolean).join(' · ') || 'Cliente do Instagram'}
            </p>
            <p className="mt-1 text-xs text-secondary-foreground">
              {c.segue === true ? 'Segue a loja no Instagram. ' : c.segue === false ? 'Não segue a loja. ' : ''}O Instagram não manda telefone: no Direct o
              robô responde sobre a loja e o cardápio e manda o link para pedir. Pedido, reclamação e encomenda vão para a equipe.
            </p>
          </section>
        )}

        {whatsapp && (
          <section className="rounded-lg border border-border p-3 text-sm">
            <h4 className="mb-1 font-display text-sm font-bold">Cliente</h4>
            <p className="break-words">{[c.cliente, telefoneLegivel(c.telefone)].filter(Boolean).join(' · ')}</p>
            <p className="mt-1 text-xs text-secondary-foreground">
              {c.cliente ? 'O nome é o do perfil do WhatsApp.' : 'Sem nome no perfil do WhatsApp: aparece pelo número.'} A conversa inteira fica em{' '}
              <Link href="/whatsapp" className="font-semibold text-foreground underline underline-offset-2">
                Delivery › WhatsApp
              </Link>
              .
            </p>
          </section>
        )}

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
