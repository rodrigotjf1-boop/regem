'use client';

import { useState } from 'react';
import { api } from '@/lib/api';
import { toast } from '@/lib/toast';
import { Button } from '@/components/ui/button';
import { hora, type CasoDaFila } from '@/lib/atendimento';
import {
  brl,
  emUmaLinha,
  escolhaQueVale,
  linkDoEntregador,
  porQueNaoCobraANova,
  rascunhoNaoDa,
  taxaDaEscolha,
  textoAoCliente,
  textoDaDistancia,
  textoDoPagamento,
  valoresDaEscolha,
  type EnderecoDoCaso,
  type EscolhaDaTaxa,
} from '@/lib/endereco-do-caso';

// ENDEREÇO DEPOIS QUE O PEDIDO SAIU (PR 3b-2; decisão 8 aprovada pelo dono em 03/11/2026 — protótipo
// `mockups/regem-alteracao-pedido.html`, vista "Painel da loja" › "endereço depois que saiu"). O caso urgente que o robô
// abre quando o cliente pede outro endereço com o pedido já na rua: o endereço do pedido, o novo, a distância entre os
// dois, a taxa da área nova, o pagamento e o entregador. "Mudar o endereço e avisar o entregador" muda pelo servidor (a
// mesma alteração do painel, só o endereço) e abre a mensagem pronta para o WhatsApp do entregador; o cliente recebe
// "Endereço atualizado!" quando a mudança vale. "Não dá: responder ao cliente" leva um rascunho para a conversa do caso.

export function EnderecoDepoisQueSaiu({
  caso: c,
  endereco: e,
  aberto,
  aoMudar,
  aoResponder,
}: {
  caso: CasoDaFila;
  endereco: EnderecoDoCaso;
  aberto: boolean;
  aoMudar: () => Promise<void>;
  /** Leva o texto ao campo da conversa do caso (ausente = quem está aqui não responde pelo WhatsApp). */
  aoResponder?: (texto: string) => void;
}) {
  const [escolha, setEscolha] = useState<EscolhaDaTaxa>('manter');
  const [enviando, setEnviando] = useState(false);
  const semNova = porQueNaoCobraANova(e);
  const vale = escolhaQueVale(e, escolha);
  const entregador = e.entregador?.nome?.trim() || null;
  const primeiroNome = entregador ? entregador.split(' ')[0] : null;
  const estado = c.mudancaDoEndereco ?? null;
  const mudado = e.mudado ?? null;
  // Recusada ou vencida: a equipe pode tentar de novo (o servidor confere a mesma regra).
  const podeMudar = aberto && (!mudado || estado?.situacao === 'recusada' || estado?.situacao === 'vencida');
  const naRua = !c.pedidoStatus || c.pedidoStatus === 'despachado';
  const taxaGravada = mudado ? mudado.taxa : taxaDaEscolha(e, vale);
  const linkAgora = linkDoEntregador(e, vale);
  const linkDoMudado = mudado ? linkDoEntregador(e, mudado.taxa !== e.taxaAntes ? 'nova' : 'manter') : null;
  const n = e.numero ? `nº ${e.numero}` : '';

  async function mudar() {
    if (enviando) return;
    setEnviando(true);
    try {
      const r: any = await api.atendimentoMudarEnderecoDepoisQueSaiu(c.id, vale);
      if (r?.repetido) toast.success('Este endereço já tinha sido mudado.');
      else if (r?.situacao === 'pedida') toast.success('Mudança enviada ao servidor da loja: vale quando a loja aplicar.');
      else toast.success('Endereço mudado. Avise o entregador pela mensagem pronta.');
      // A mensagem pronta para o entregador (o link continua na gaveta, se o navegador barrar a janela).
      if (linkAgora && !r?.repetido) window.open(linkAgora, '_blank', 'noopener,noreferrer');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Não foi possível mudar o endereço.');
    } finally {
      setEnviando(false);
      await aoMudar();
    }
  }

  return (
    <section className="rounded-lg border border-warn/40 bg-warn/5 p-3 text-sm" aria-labelledby={`endereco-${c.id}`} data-endereco-do-caso>
      <div className="flex flex-wrap items-center gap-2">
        <h4 id={`endereco-${c.id}`} className="font-display text-sm font-bold">
          Endereço novo{n ? ` · pedido ${n}` : ''}
        </h4>
        {/* Texto escuro sobre o laranja claro: o laranja de aviso como letra pequena fica abaixo do contraste mínimo. */}
        {naRua && (
          <span className="rounded-full border border-warn/50 bg-warn/15 px-2 py-0.5 text-xs font-bold text-foreground">🛵 Já saiu para entrega</span>
        )}
      </div>

      <dl className="mt-2 grid grid-cols-1 gap-x-3 gap-y-1 sm:grid-cols-[auto_minmax(0,1fr)]">
        <dt className="text-secondary-foreground">Endereço do pedido</dt>
        <dd className="break-words">{emUmaLinha(e.de) || 'sem endereço no pedido'}</dd>
        <dt className="text-secondary-foreground">Endereço novo</dt>
        <dd className="break-words">
          <strong>{emUmaLinha(e.para)}</strong>
          {e.para.referencia ? ` (${e.para.referencia})` : ''}
        </dd>
        <dt className="text-secondary-foreground">Distância entre os dois</dt>
        <dd className="break-words" data-distancia>
          {textoDaDistancia(e.distancia)}
        </dd>
        <dt className="text-secondary-foreground">Taxa da área nova</dt>
        <dd className="break-words">
          {e.taxaNova == null ? (
            <span className="font-semibold text-destructive">fora da área de entrega</span>
          ) : (
            <>
              <span className="font-mono">{brl(e.taxaNova)}</span> (o pedido pagou <span className="font-mono">{brl(e.taxaAntes)}</span>)
            </>
          )}
        </dd>
        <dt className="text-secondary-foreground">Pagamento</dt>
        <dd className="break-words">{textoDoPagamento(e)}</dd>
        <dt className="text-secondary-foreground">Entregador</dt>
        <dd className="break-words">
          {entregador ? `${entregador}${e.entregador?.saiuEm ? ` · saiu às ${hora(e.entregador.saiuEm)}` : ''}` : 'não informado no despacho'}
        </dd>
      </dl>

      {mudado && <EstadoDaMudanca caso={c} endereco={e} taxa={taxaGravada} link={linkDoMudado} primeiroNome={primeiroNome} />}

      {podeMudar && (
        <div className="mt-3 space-y-2 border-t border-warn/30 pt-3">
          {!naRua && (
            <p className="font-semibold text-destructive" role="status">
              O pedido já não está na rua: a mudança de endereço não vale mais. Responda ao cliente.
            </p>
          )}
          <div className="flex flex-wrap items-end justify-between gap-2">
            <div className="min-w-0 flex-1 basis-56">
              <label htmlFor={`taxa-${c.id}`} className="font-semibold">
                Taxa da entrega
              </label>
              <p className="text-xs text-secondary-foreground">A diferença fica a seu critério.</p>
            </div>
            <select
              id={`taxa-${c.id}`}
              value={vale}
              onChange={(ev) => setEscolha(ev.target.value === 'nova' ? 'nova' : 'manter')}
              className="h-10 w-full min-w-0 rounded-md border border-input bg-background px-3 sm:w-auto"
            >
              <option value="manter">Manter {brl(e.taxaAntes)}</option>
              {!semNova && e.taxaNova != null && <option value="nova">Cobrar a nova ({brl(e.taxaNova)}) na entrega</option>}
            </select>
          </div>
          {semNova && e.taxaNova != null && !r2Igual(e.taxaNova, e.taxaAntes) && (
            <p className="text-xs text-secondary-foreground">Cobrar a taxa nova não dá: {semNova}.</p>
          )}
          {vale === 'nova' && (
            <p className="text-xs text-secondary-foreground">
              O pedido passa para <span className="font-mono">{brl(valoresDaEscolha(e, vale).total)}</span>.
            </p>
          )}
          {/* Os botões quebram a linha no estreito (o texto é longo — em 320 px não cabia numa linha só). */}
          <div className="flex flex-wrap gap-2">
            <Button type="button" className="h-auto min-h-10 whitespace-normal py-2" disabled={enviando || !naRua} onClick={() => void mudar()}>
              Mudar o endereço e avisar o entregador
            </Button>
            {linkAgora ? (
              <a
                href={linkAgora}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex h-10 items-center rounded-md border border-input px-4 font-semibold hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                WhatsApp {primeiroNome ? `do ${primeiroNome}` : 'do entregador'}
              </a>
            ) : (
              <span className="inline-flex h-10 items-center text-xs text-secondary-foreground">O entregador não tem telefone no despacho.</span>
            )}
            {aoResponder && (
              <Button type="button" variant="outline" className="h-auto min-h-10 whitespace-normal py-2" onClick={() => aoResponder(rascunhoNaoDa(e))}>
                Não dá: responder ao cliente
              </Button>
            )}
          </div>
          <p className="text-xs text-secondary-foreground">
            “Mudar” troca o endereço do pedido, apaga a posição do endereço antigo (o app do entregador refaz o caminho pelo novo) e abre a
            mensagem pronta para o WhatsApp {primeiroNome ? `do ${primeiroNome}` : 'do entregador'}. O cliente recebe “{textoAoCliente(e)}” quando a
            mudança vale.
          </p>
        </div>
      )}
    </section>
  );
}

const r2Igual = (a: number, b: number) => Math.round(a * 100) === Math.round(b * 100);

/** Em que pé está a mudança feita pelo caso: a loja aplicou, recusou ou ainda não respondeu; o cliente recebeu o aviso. */
function EstadoDaMudanca({
  caso: c,
  endereco: e,
  taxa,
  link,
  primeiroNome,
}: {
  caso: CasoDaFila;
  endereco: EnderecoDoCaso;
  taxa: number;
  link: string | null;
  primeiroNome: string | null;
}) {
  const m = e.mudado!;
  const estado = c.mudancaDoEndereco ?? null;
  const quem = `às ${hora(m.em)}${m.porNome ? ` por ${m.porNome}` : ''}`;
  const taxaTexto = r2Igual(taxa, e.taxaAntes) ? `taxa mantida em ${brl(taxa)}` : `entrega passou para ${brl(taxa)}`;
  if (!estado || estado.situacao === 'pedida')
    return (
      <p className="mt-3 break-words rounded-lg bg-secondary px-3 py-2 font-semibold" role="status" data-endereco-situacao="pedida">
        ⏳ Mudança enviada ao servidor da loja {quem}: vale quando a loja aplicar. O cliente recebe a mensagem depois disso.
      </p>
    );
  if (estado.situacao === 'recusada' || estado.situacao === 'vencida')
    return (
      <p className="mt-3 break-words rounded-lg bg-destructive/10 px-3 py-2 font-semibold text-destructive" role="status" data-endereco-situacao={estado.situacao}>
        {estado.situacao === 'recusada'
          ? `✕ A loja recusou a mudança feita ${quem}: ${estado.motivo || 'sem motivo informado'}.`
          : `A loja não respondeu à mudança feita ${quem}.`}{' '}
        Avise o entregador pelo WhatsApp dele — ou tente de novo.
      </p>
    );
  const a = estado.aviso;
  // O motivo como o envio devolveu ("Falha ao enviar (sem resposta): ") vira uma frase só, sem a pontuação solta do fim.
  const motivo = String(a?.falhou ?? '').replace(/[\s:;,.–-]+$/, '');
  const aviso = !a
    ? 'O cliente recebe a mensagem em instantes.'
    : a.falhou
      ? `A mensagem ao cliente não saiu${motivo ? `: ${motivo.charAt(0).toLowerCase()}${motivo.slice(1)}` : ''}. Responda pela conversa.`
      : a.expirou
        ? 'A mensagem ao cliente não saiu (a mudança chegou tarde à nuvem): responda pela conversa.'
        : a.semTelefone
          ? 'O caso não tem o telefone do cliente: avise por outro meio.'
          : `O cliente recebeu: “${textoAoCliente(e)}”.`;
  return (
    <div className="mt-3 space-y-2 rounded-lg border border-ok/40 bg-ok/10 px-3 py-2" role="status" data-endereco-situacao="aplicada">
      <p className="break-words font-semibold">
        ✓ Endereço mudado {quem}: {emUmaLinha(e.para)}, {taxaTexto}. O app do entregador já mostra o endereço novo.
      </p>
      <p className="break-words" data-endereco-aviso>
        {aviso}
      </p>
      {link && (
        <a
          href={link}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex h-10 items-center rounded-md border border-input bg-background px-4 font-semibold hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Abrir a mensagem para {primeiroNome ? `o ${primeiroNome}` : 'o entregador'}
        </a>
      )}
    </div>
  );
}
