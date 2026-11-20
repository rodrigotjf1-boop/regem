'use client';

import { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { Caixa } from './partes';

/* eslint-disable @typescript-eslint/no-explicit-any */

// AS ESCOLHAS NA ENTRADA DO CARDÁPIO (F1c do docs/plano-perfil-cliente.md, §3.6, D11 e D15; protótipo, aba "No cardápio",
// o celular "Entrar para pedir"). Logo depois do código do WhatsApp — o cliente já provou que o número é dele (V79) —, uma
// vez só (quem já respondeu, marcando ou não, não vê de novo), e só na loja com o módulo "Perfil do cliente" ligado.
//  • as caixas NUNCA vêm marcadas: caixa pré-marcada não vale como consentimento (ANPD, Guia de Cookies; D15);
//  • "Aceitar as três e continuar" e "Continuar sem marcar" têm o MESMO destaque; "Aceitar" marca as caixas na frente do
//    cliente antes de seguir;
//  • o servidor guarda o texto mostrado, a data e a origem `cardapio_entrada`; "Continuar sem marcar" grava o "não";
//  • as ofertas usam a MESMA chave do Perfil (`clientePromocoes`) e a caixa mostra a frase que ela grava; só aparece na loja
//    que manda promoção e para quem ainda não recebe.

export type Promocoes = { ativo: boolean; frase?: string } | null | undefined;

const MOSTRAR_MARCADAS_MS = 700;

export function EscolhasDaEntrada({
  token,
  clienteToken,
  textos,
  promocoes,
  onPronto,
}: {
  token: string;
  clienteToken: string;
  textos: Record<string, string> | undefined;
  promocoes: Promocoes;
  onPronto: () => void | Promise<void>;
}) {
  const [rec, setRec] = useState(false);
  const [conv, setConv] = useState(false);
  const [ofe, setOfe] = useState(false);
  const [maior, setMaior] = useState(false);
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState('');
  const vivo = useRef(true);
  useEffect(
    () => () => {
      vivo.current = false;
    },
    [],
  );

  const temOfertas = !!promocoes && !promocoes.ativo && !!promocoes.frase;
  const algumMarcado = rec || conv || (temOfertas && ofe) || maior;

  async function salvar(v: { rec: boolean; conv: boolean; ofe: boolean; maior: boolean }) {
    if ((v.rec || v.conv) && !v.maior) {
      setErro('Para as duas primeiras escolhas, marque "Tenho 18 anos ou mais" — ou desmarque-as.');
      return;
    }
    setBusy(true);
    setErro('');
    try {
      await api.clienteDefinirPrivacidade(token, {
        clienteToken,
        origem: 'cardapio_entrada',
        escolhas: { recomendacoes: v.rec, atendimento_personalizado: v.conv, maior_de_18: v.maior },
      });
      if (temOfertas && v.ofe) await api.clientePromocoes(token, clienteToken, true);
      await onPronto();
    } catch (e) {
      if (vivo.current) setErro(e instanceof Error ? e.message : 'Não foi possível salvar as suas escolhas. Tente de novo.');
    } finally {
      if (vivo.current) setBusy(false);
    }
  }

  function aceitarTodas() {
    if (busy) return;
    // Marca na frente do cliente e só então segue (o protótipo: "marca as caixas na sua frente antes de seguir").
    setRec(true);
    setConv(true);
    setOfe(true);
    setMaior(true);
    setBusy(true);
    window.setTimeout(() => {
      if (vivo.current) void salvar({ rec: true, conv: true, ofe: true, maior: true });
    }, MOSTRAR_MARCADAS_MS);
  }

  const quantas = temOfertas ? 'as três' : 'as duas';

  return (
    <div className="c-sec">
      <h3 className="c-h">Você escolhe · opcional</h3>
      <Caixa marcada={rec} onMudar={(v) => !busy && setRec(v)} className="promo">
        <b>Recomendações do meu jeito</b>
        {/* O texto que o servidor grava no histórico (o mesmo do Perfil): o que se mostra é o que fica guardado. */}
        <small>{textos?.recomendacoes ?? 'Usar o que eu vejo no cardápio para sugerir o que combina comigo.'}</small>
      </Caixa>
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
        Tenho 18 anos ou mais (vale para as duas primeiras escolhas)
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
      <button type="button" className="p-btn c" onClick={aceitarTodas} disabled={busy}>
        {`Aceitar ${quantas} e continuar`}
      </button>
      <button type="button" className="p-btn c" onClick={() => void salvar({ rec, conv, ofe, maior })} disabled={busy}>
        {busy ? 'Salvando…' : algumMarcado ? 'Continuar com o que marquei' : 'Continuar sem marcar'}
      </button>
    </div>
  );
}
