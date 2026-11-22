'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { Caixa } from './partes';

/* eslint-disable @typescript-eslint/no-explicit-any */

// AS ESCOLHAS NA ENTRADA DO CARDÁPIO (F1c do docs/plano-perfil-cliente.md, §3.6, D11 e D15; protótipo, aba "No cardápio",
// o celular "Entrar para pedir"). Logo depois do código do WhatsApp — o cliente já provou que o número é dele (V79) —, uma
// vez só (quem já respondeu, marcando ou não, não vê de novo), e só na loja com o módulo "Perfil do cliente" ligado.
//  • "Recomendações do seu jeito" NÃO é caixa: vem ligada por legítimo interesse (D16, decisão do dono em 20/11/2026) — a
//    entrada mostra o AVISO (o mesmo texto do servidor) e o Perfil tem a chave para desligar;
//  • as caixas (o jeito das conversas e as ofertas) NUNCA vêm marcadas: caixa pré-marcada não vale como consentimento
//    (ANPD, Guia de Cookies; D15);
//  • "Aceitar e continuar" e "Continuar sem marcar" têm o MESMO destaque; "Aceitar" marca as caixas na frente do cliente
//    antes de seguir;
//  • o servidor guarda o texto mostrado, a data e a origem `cardapio_entrada`; "Continuar sem marcar" grava o "não";
//  • as ofertas usam a MESMA chave do Perfil (`clientePromocoes`) e a caixa mostra a frase que ela grava; só aparece na loja
//    que manda promoção e para quem ainda não recebe;
//  • com a regra `PERFIL_SO_COM_AVISO` ligada, o aviso do perfil (o texto do servidor) vem primeiro, com "Não quero esse resumo"
//    no mesmo destaque. Quem já tinha respondido às caixas vê só o aviso: reenviar as caixas vazias desfaria um "sim" antigo.

export type Promocoes = { ativo: boolean; frase?: string } | null | undefined;

const MOSTRAR_MARCADAS_MS = 700;

/** O texto do aviso do perfil, com o caminho para a política inteira. */
export function TextoDoAviso({ texto }: { texto: string }) {
  return (
    <p className="c-note">
      {texto}{' '}
      {/* O sublinhado aqui direto: no tema do cardápio, o link sem ele parece texto comum. */}
      <a href="/privacidade" target="_blank" rel="noopener noreferrer" style={{ textDecoration: 'underline' }}>
        Ler a política completa
      </a>
    </p>
  );
}

/** O aviso do perfil num cartão, com as duas respostas no mesmo desenho: recusar não pode parecer menor que aceitar. */
export function CartaoDoAviso({
  texto,
  ocupado,
  aoResponder,
  rotuloContinuar = 'Continuar',
}: {
  texto: string;
  ocupado: boolean;
  aoResponder: (resposta: 'continuou' | 'recusou') => void;
  rotuloContinuar?: string;
}) {
  const id = useId();
  return (
    <div className="ac-aviso" role="group" aria-labelledby={id}>
      <h3 id={id} className="c-h">
        Como a loja usa seus dados
      </h3>
      <TextoDoAviso texto={texto} />
      <div className="ac-aviso-acoes">
        <button type="button" className="p-btn2" disabled={ocupado} onClick={() => aoResponder('continuou')}>
          {rotuloContinuar}
        </button>
        <button type="button" className="p-btn2" disabled={ocupado} onClick={() => aoResponder('recusou')}>
          Não quero esse resumo
        </button>
      </div>
    </div>
  );
}

export function EscolhasDaEntrada({
  token,
  clienteToken,
  textos,
  aviso,
  promocoes,
  avisoPerfil,
  soAviso,
  onPronto,
}: {
  token: string;
  clienteToken: string;
  textos: Record<string, string> | undefined;
  /** O aviso das recomendações (vem do servidor — o texto que vale). */
  aviso?: string;
  promocoes: Promocoes;
  /** O aviso do perfil ainda não visto (`null` = nada a avisar). */
  avisoPerfil?: { texto: string } | null;
  /** Já respondeu às caixas antes: mostra só o aviso. */
  soAviso?: boolean;
  onPronto: () => void | Promise<void>;
}) {
  const [conv, setConv] = useState(false);
  const [ofe, setOfe] = useState(false);
  const [maior, setMaior] = useState(false);
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState('');
  const idAviso = useId();
  const vivo = useRef(true);
  useEffect(
    () => () => {
      vivo.current = false;
    },
    [],
  );

  const temOfertas = !!promocoes && !promocoes.ativo && !!promocoes.frase;
  const algumMarcado = conv || (temOfertas && ofe) || maior;

  async function salvar(v: { conv: boolean; ofe: boolean; maior: boolean }) {
    if (v.conv && !v.maior) {
      setErro('Para "Lembrar como prefiro ser atendido", marque "Tenho 18 anos ou mais" — ou desmarque-a.');
      return;
    }
    setBusy(true);
    setErro('');
    try {
      await api.clienteDefinirPrivacidade(token, {
        clienteToken,
        origem: 'cardapio_entrada',
        // As recomendações não vão: ficam no padrão (ligadas — D16); o "Continuar sem marcar" não as desliga.
        escolhas: { atendimento_personalizado: v.conv, maior_de_18: v.maior },
        ...(avisoPerfil ? { avisoPerfil: 'continuou' } : {}),
      });
      if (temOfertas && v.ofe) await api.clientePromocoes(token, clienteToken, true);
      await onPronto();
    } catch (e) {
      if (vivo.current) setErro(e instanceof Error ? e.message : 'Não foi possível salvar as suas escolhas. Tente de novo.');
    } finally {
      if (vivo.current) setBusy(false);
    }
  }

  /** Responde só ao aviso: "Continuar" (quem já tinha respondido às caixas) ou "Não quero esse resumo". */
  async function responderAviso(resposta: 'continuou' | 'recusou') {
    if (busy) return;
    setBusy(true);
    setErro('');
    try {
      await api.clienteDefinirPrivacidade(token, { clienteToken, origem: 'cardapio_entrada', avisoPerfil: resposta });
      await onPronto();
    } catch (e) {
      if (vivo.current) setErro(e instanceof Error ? e.message : 'Não foi possível salvar a sua resposta. Tente de novo.');
    } finally {
      if (vivo.current) setBusy(false);
    }
  }

  function aceitarTodas() {
    if (busy) return;
    // Marca na frente do cliente e só então segue (o protótipo: "marca as caixas na sua frente antes de seguir").
    setConv(true);
    setOfe(true);
    setMaior(true);
    setBusy(true);
    window.setTimeout(() => {
      if (vivo.current) void salvar({ conv: true, ofe: true, maior: true });
    }, MOSTRAR_MARCADAS_MS);
  }

  const rotuloAceitar = temOfertas ? 'Aceitar as duas e continuar' : 'Aceitar e continuar';
  // Com o aviso na tela, todas as respostas têm o mesmo desenho; sem ele, a entrada continua como era.
  const classeDosBotoes = avisoPerfil ? 'p-btn2' : 'p-btn c';

  if (avisoPerfil && soAviso) {
    return (
      <div className="c-sec">
        <CartaoDoAviso texto={avisoPerfil.texto} ocupado={busy} aoResponder={(r) => void responderAviso(r)} rotuloContinuar={busy ? 'Salvando…' : 'Continuar'} />
        {erro && (
          <p className="c-msg err" role="alert">
            {erro}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="c-sec">
      {avisoPerfil && (
        <div className="ac-aviso" role="group" aria-labelledby={idAviso}>
          <h3 id={idAviso} className="c-h">
            Como a loja usa seus dados
          </h3>
          <TextoDoAviso texto={avisoPerfil.texto} />
        </div>
      )}
      <h3 className="c-h">Você escolhe · opcional</h3>
      {/* Não é caixa: as recomendações vêm ligadas por legítimo interesse (D16); o aviso é o texto do servidor. */}
      <p className="c-note">
        {aviso ??
          'Recomendações do seu jeito: a loja usa o que você vê no cardápio dela para sugerir o que combina com você. Você desliga quando quiser no Perfil ou mandando PRIVACIDADE no WhatsApp.'}
      </p>
      <Caixa marcada={conv} onMudar={(v) => !busy && setConv(v)} className="promo">
        <b>Lembrar como prefiro ser atendido</b>
        <small>{textos?.atendimento_personalizado ?? 'Aprender pelas nossas conversas se prefiro respostas curtas, áudio ou emoji.'}</small>
      </Caixa>
      {temOfertas && (
        <Caixa marcada={ofe} onMudar={(v) => !busy && setOfe(v)} className="promo">
          <b>{promocoes!.frase}</b>
          <small>Para sair depois, responda SAIR ou desligue no seu Perfil.</small>
        </Caixa>
      )}
      <Caixa marcada={maior} onMudar={(v) => !busy && setMaior(v)}>
        Tenho 18 anos ou mais (vale para “Lembrar como prefiro ser atendido”)
      </Caixa>
      <p className="c-note">
        Sem marcar nada, você pede normalmente. A loja usa seus pedidos para atender e melhorar o cardápio. Mude quando quiser
        no Perfil ou mandando PRIVACIDADE no WhatsApp.
      </p>
      {erro && (
        <p className="c-msg err" role="alert">
          {erro}
        </p>
      )}
      <button type="button" className={classeDosBotoes} onClick={aceitarTodas} disabled={busy}>
        {rotuloAceitar}
      </button>
      <button type="button" className={classeDosBotoes} onClick={() => void salvar({ conv, ofe, maior })} disabled={busy}>
        {busy ? 'Salvando…' : algumMarcado ? 'Continuar com o que marquei' : 'Continuar sem marcar'}
      </button>
      {avisoPerfil && (
        <button type="button" className={classeDosBotoes} onClick={() => void responderAviso('recusou')} disabled={busy}>
          Não quero esse resumo
        </button>
      )}
    </div>
  );
}
