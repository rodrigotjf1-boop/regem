'use client';

import type { Cardapio } from './use-cardapio';
import { brl, Ic } from './partes';

/* eslint-disable @typescript-eslint/no-explicit-any, @next/next/no-img-element */

// PEDIDO ENVIADO (base §5.7 e 05 §2.7). Os estados são os de sempre: Pix aguardando (QR, copia e
// cola, 10 minutos, "já paguei"), Pix expirado, Pix indisponível, pagamento confirmado, linha do
// tempo do status, avisos do servidor, link de acompanhamento e WhatsApp. O que mudou: a previsão
// de horário e os pontos "a caminho" (antes a tela dizia "você tem 0 pontos" logo após o pedido).

const PASSOS = ['novo', 'confirmado', 'pronto', 'despachado', 'concluido'];

export function Confirmacao({ c }: { c: Cardapio }) {
  const ped = c.ped;
  const loja = c.loja;
  const resumo = ped.resumo ?? {};
  const entrega = resumo.tipo === 'entrega';
  // Pago online ainda não confirmado: o pedido fica "aguardando pagamento" e só entra em produção
  // após o Pix cair (o servidor não aceita antes → sem desperdício).
  const aguardandoPag = ped.statusPagamento === 'aguardando';
  // Cronômetro de expiração do PIX (10 min). Expirado = cron cancelou (status) OU o relógio zerou.
  const restanteMs = aguardandoPag && ped.pixExpira ? Math.max(0, ped.pixExpira - c.agora) : null;
  const expirado = aguardandoPag && (ped.status === 'cancelado' || (restanteMs !== null && restanteMs <= 0));
  const mmss =
    restanteMs != null
      ? `${String(Math.floor(restanteMs / 60000)).padStart(2, '0')}:${String(Math.floor((restanteMs % 60000) / 1000)).padStart(2, '0')}`
      : '';
  const cancelado = ped.status === 'cancelado';
  const pixNaTela = !!ped.pix?.qrCode && aguardandoPag && !expirado;
  const mesa = ped.modo === 'mesa';
  const idx = mesa ? 0 : Math.max(0, PASSOS.indexOf(ped.status ?? 'novo'));
  const agendado = !!ped.agendamento;
  const rot: Record<string, string> = {
    novo: agendado ? 'Pedido agendado' : 'Pedido recebido',
    confirmado: 'Em preparo',
    pronto: entrega ? 'Pronto' : 'Pronto para retirar',
    despachado: entrega ? 'Saiu para entrega' : 'Aguardando retirada',
    concluido: entrega ? 'Entregue' : 'Concluído',
  };
  const titulo = expirado
    ? 'Tempo esgotado'
    : cancelado
      ? 'Pedido cancelado'
      : pixNaTela
        ? 'Falta só o Pix'
        : ped.orcamento
          ? 'Orçamento solicitado!'
          : agendado
            ? c.isServico
              ? 'Agendamento confirmado!'
              : 'Pedido agendado!'
            : 'Pedido enviado!';
  // Falar no WhatsApp só depois de pago (ou quando não é pagamento online).
  const msgWhats = encodeURIComponent(`Olá, acabei de fazer o pedido Nº ${ped.displayId ?? ''} e queria saber sobre o pedido.`);
  const previsao =
    !mesa && !agendado && !ped.orcamento && !aguardandoPag && !cancelado && resumo.tempoMin != null && resumo.enviadoEm
      ? new Date(resumo.enviadoEm + Number(resumo.tempoMin) * 60000).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
      : null;
  const temPontos = !!loja?.fidelidadeAtiva && !mesa && !ped.orcamento && !cancelado && !expirado;

  function copiarPix() {
    const fim = () => c.avisar('Código Pix copiado');
    try {
      navigator.clipboard.writeText(ped.pix.qrCode).then(fim, () => c.avisar('Selecione o código e copie pelo menu do aparelho.'));
    } catch {
      c.avisar('Selecione o código e copie pelo menu do aparelho.');
    }
  }

  return (
    <div className="p-panel p-conf">
      <div className="p-pbody">
        <div className="ok-top">
          <div className={`ok-badge ${pixNaTela ? 'wait' : ''} ${expirado || cancelado ? 'err' : ''}`}>
            <Ic n={pixNaTela || expirado ? 'clock' : cancelado ? 'close' : 'check'} s={30} />
          </div>
          <h2>{titulo}</h2>
          {mesa ? (
            <p>Foi para a cozinha (mesa {ped.mesa}).</p>
          ) : (
            <p>
              Senha <b>{ped.displayId}</b> · total {brl(ped.total ?? resumo.totalPrevisto)}
            </p>
          )}
        </div>
        <div className="ok-body">
          {/* Pagamento confirmado (online) — some o QR e libera o acompanhamento. */}
          {ped.pix?.qrCode && !aguardandoPag && !cancelado && (
            <div className="c-cb">
              <Ic n="check" s={16} />
              <span>
                <b>Pagamento confirmado.</b> A loja já pode preparar o pedido.
              </span>
            </div>
          )}
          {/* PIX: QR + copia e cola enquanto aguarda o pagamento (e não expirou). */}
          {pixNaTela && (
            <div className="ok-pix">
              <b>Pague com Pix para confirmar</b>
              {(ped.pix.qrCodeBase64 || ped.pix.ticketUrl) && (
                <div className="ok-qr">
                  {/* PagBank devolve o QR como link PNG (não base64). */}
                  <img src={ped.pix.qrCodeBase64 ? `data:image/png;base64,${ped.pix.qrCodeBase64}` : ped.pix.ticketUrl} alt="QR Code Pix" />
                </div>
              )}
              <code aria-label="Código Pix copia e cola">{ped.pix.qrCode}</code>
              <div className="row">
                <span>Expira em {mmss}</span>
                <span>{brl(ped.total ?? resumo.totalPrevisto)}</span>
              </div>
              <button type="button" className="p-btn c" onClick={copiarPix}>
                <Ic n="copy" s={18} /> Copiar código
              </button>
              <button type="button" className="p-btn2" onClick={c.verificarPagamento} disabled={c.verificando}>
                {c.verificando ? 'Verificando…' : 'Já paguei, verificar pagamento'}
              </button>
              <p className="p-hint">Depois de pagar, esta tela atualiza sozinha.</p>
            </div>
          )}
          {/* Tempo esgotado: o PIX de 10 min expirou (cron cancelou / relógio zerou). */}
          {expirado && (
            <div className="p-aviso fechada p-aviso-0" role="status">
              <Ic n="clock" s={18} />
              <div>
                <b>O prazo de 10 minutos para pagar o Pix acabou</b>
                <span>O pedido foi cancelado. Faça um novo pedido: você pode escolher outra forma de pagamento.</span>
              </div>
            </div>
          )}
          {/* Falha/indisponibilidade do pagamento online: o pedido foi registrado e a tela diz por quê. */}
          {!ped.pix?.qrCode && ped.pixErro && (
            <div className="p-aviso p-aviso-0" role="status">
              <Ic n="card" s={18} />
              <div>
                <span>{ped.pixErro}</span>
              </div>
            </div>
          )}
          {cancelado && !aguardandoPag && <p className="c-msg err">Pedido cancelado.</p>}

          {agendado && !cancelado && (
            <div className="ok-eta">
              <small>Agendado para</small>
              <b>{new Date(ped.agendamento).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</b>
            </div>
          )}
          {previsao && (
            <div className="ok-eta">
              <small>Previsão de {entrega ? 'entrega' : 'retirada'}</small>
              <b>{previsao}</b>
            </div>
          )}
          {ped.orcamento && <p className="c-note">Orçamento solicitado: em breve retornamos com a proposta.</p>}

          {ped.pedidoId && !cancelado && !aguardandoPag && (
            <ol className="ok-tl">
              {PASSOS.map((s, i) => (
                <li key={s} className={i === idx ? 'on' : i < idx ? 'feito' : ''}>
                  <span>
                    {rot[s]}
                    {i === idx && i === 0 && <small>A loja já recebeu seu pedido</small>}
                  </span>
                </li>
              ))}
            </ol>
          )}
          {pixNaTela && (
            <ol className="ok-tl">
              <li className="on">
                <span>
                  Aguardando o Pix
                  <small>Pague o Pix para a loja começar o preparo</small>
                </span>
              </li>
              <li>
                <span>{rot.novo}</span>
              </li>
              <li>
                <span>{rot.confirmado}</span>
              </li>
            </ol>
          )}

          {temPontos && resumo.pontosPrevistos > 0 && (
            <div className="c-pts">
              <Ic n="gift" s={16} />
              <span>
                <b>{resumo.pontosPrevistos} pontos a caminho.</b> Entram no seu saldo quando o pedido for concluído.
                {ped.pontos != null && ped.pontos > 0 ? ` Saldo atual: ${ped.pontos} pontos.` : ''}
              </span>
            </div>
          )}
          {Array.isArray(ped.avisos) && ped.avisos.length > 0 && (
            <div className="p-aviso p-aviso-0" role="status">
              <Ic n="bell" s={18} />
              <div>
                {ped.avisos.map((a: string, i: number) => (
                  <span key={i}>{a}</span>
                ))}
              </div>
            </div>
          )}
          {ped.pedidoId && !cancelado && !expirado && (
            <a className="p-btn2" href={`/c/${c.token}/pedido/${ped.pedidoId}${ped.ref ? `?ref=${encodeURIComponent(ped.ref)}` : ''}`}>
              <Ic n="link" s={18} /> Acompanhar pedido (guarde este link)
            </a>
          )}
          {loja?.whatsapp && !cancelado &&
            (!aguardandoPag ? (
              <a className="p-btn2" href={`https://wa.me/${String(loja.whatsapp).replace(/\D/g, '')}?text=${msgWhats}`}>
                <Ic n="chat" s={18} /> Falar com a loja no WhatsApp
              </a>
            ) : (
              <p className="ok-wa">O WhatsApp da loja fica disponível depois da confirmação do pagamento.</p>
            ))}
          <button type="button" className={expirado ? 'p-btn c' : 'p-btn2'} onClick={c.novoPedido}>
            {expirado ? 'Fazer novo pedido' : 'Fazer outro pedido'}
          </button>
        </div>
      </div>
    </div>
  );
}
