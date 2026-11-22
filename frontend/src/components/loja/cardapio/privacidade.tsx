'use client';

import { useEffect, useId, useState } from 'react';
import { api } from '@/lib/api';
import { TextoDoAviso } from './escolhas-da-entrada';

/* eslint-disable @typescript-eslint/no-explicit-any */

// PRIVACIDADE NO PERFIL DO CARDÁPIO (F1c do docs/plano-perfil-cliente.md, §3.6, D11, D14, D15; protótipo, aba "No
// cardápio", o celular "Perfil"). O que a loja sabe do cliente e as escolhas dele sobre os próprios dados — cada escolha é um
// "sim" CLICADO (as chaves nascem desligadas), menos "Recomendações", que vem ligada por legítimo interesse (D16) e se
// desliga aqui; o servidor guarda o texto mostrado. Só aparece na loja com o módulo
// "Perfil do cliente" ligado (`ativo` na resposta).

type Estado = {
  ativo: boolean;
  escolhas: Record<string, boolean>;
  declarado: Record<string, any>;
  textos: Record<string, string>;
  /** O aviso do perfil (`null` com a regra `PERFIL_SO_COM_AVISO` desligada). */
  avisoPerfil?: { texto: string; visto: boolean } | null;
};

function Chave({ rotulo, ligado, ocupado, aoMudar, descricao }: { rotulo: string; ligado: boolean; ocupado: boolean; aoMudar: () => void; descricao?: string }) {
  const id = useId();
  return (
    <div>
      <div className="ac-row">
        <b id={id}>{rotulo}</b>
        <button type="button" className="ac-sw" role="switch" aria-checked={ligado} aria-labelledby={id} disabled={ocupado} onClick={aoMudar} />
      </div>
      {descricao && <p className="c-note">{descricao}</p>}
    </div>
  );
}

export function PrivacidadeNaConta({ token, clienteToken, setErro }: { token: string; clienteToken: string | null | undefined; setErro: (m: string) => void }) {
  const [estado, setEstado] = useState<Estado | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [time, setTime] = useState('');
  const idTime = useId();

  useEffect(() => {
    if (!clienteToken) return;
    let vivo = true;
    api
      .clientePrivacidade(token, clienteToken)
      .then((r: any) => {
        if (!vivo) return;
        setEstado(r);
        setTime(typeof r?.declarado?.time === 'string' ? r.declarado.time : '');
      })
      .catch(() => vivo && setEstado(null));
    return () => {
      vivo = false;
    };
  }, [token, clienteToken]);

  if (!clienteToken || !estado?.ativo) return null;

  async function salvar(corpo: any) {
    if (!clienteToken || ocupado) return;
    setOcupado(true);
    setErro('');
    try {
      const r: any = await api.clienteDefinirPrivacidade(token, { clienteToken, origem: 'cardapio_perfil', ...corpo });
      setEstado((e) => (e ? { ...e, ...r, ativo: true } : e));
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível salvar a sua escolha. Tente de novo.');
    } finally {
      setOcupado(false);
    }
  }

  const esc = estado.escolhas ?? {};
  const dec = estado.declarado ?? {};
  const naoAnalisar = !!esc.nao_analisar;

  return (
    <div className="c-sec">
      <b>Privacidade</b>
      <p className="c-note">O que a loja sabe de você e como ela pode usar. Mude quando quiser.</p>

      {/* Quem já estava com a conta aberta quando a regra do aviso foi ligada responde aqui. */}
      {estado.avisoPerfil && !estado.avisoPerfil.visto && (
        <div>
          <TextoDoAviso texto={estado.avisoPerfil.texto} />
          <button type="button" className="p-btn c" disabled={ocupado} onClick={() => salvar({ avisoPerfil: 'continuou' })}>
            Continuar
          </button>
          <button type="button" className="p-btn c" disabled={ocupado} onClick={() => salvar({ avisoPerfil: 'recusou' })}>
            Não quero esse resumo
          </button>
        </div>
      )}

      <Chave
        rotulo="Recomendações do meu jeito"
        ligado={!!esc.recomendacoes}
        ocupado={ocupado || naoAnalisar}
        aoMudar={() => salvar({ escolhas: { recomendacoes: !esc.recomendacoes } })}
        descricao={estado.textos?.recomendacoes}
      />

      <Chave
        rotulo="Prefiro respostas curtas"
        ligado={dec.respostas_curtas === true}
        ocupado={ocupado}
        aoMudar={() => salvar({ declarado: { respostas_curtas: dec.respostas_curtas === true ? null : true } })}
      />
      {/* Sem a chave "prefiro áudio" (decisão do dono, 19/11/2026): o atendente responde em áudio SÓ quando o cliente manda
          áudio — já é assim; uma chave aqui prometeria áudio para quem escreve. */}

      <div>
        <label htmlFor={idTime}>
          <b>Seu time</b>
        </label>
        <div className="ac-row">
          <input id={idTime} className="c-in" type="text" maxLength={40} value={time} onChange={(e) => setTime(e.target.value)} placeholder="Para te avisar das promoções de dia de jogo" />
          <button type="button" className="ac-sair" disabled={ocupado || time.trim() === (dec.time ?? '')} onClick={() => salvar({ declarado: { time: time.trim() || null } })}>
            Salvar
          </button>
        </div>
      </div>

      {dec.alergia && (
        <div>
          <div className="ac-row">
            <span>
              <b>Alergia guardada a seu pedido:</b> {String(dec.alergia)}
            </span>
            <button type="button" className="ac-del" disabled={ocupado} onClick={() => salvar({ declarado: { alergia: null } })}>
              Apagar
            </button>
          </div>
        </div>
      )}
      {Array.isArray(dec.gostaria) && dec.gostaria.length > 0 && (
        <p className="c-note">
          <b>Gostaria de encontrar:</b> {dec.gostaria.join(', ')}
        </p>
      )}

      <Chave
        rotulo="Não quero ser analisado"
        ligado={naoAnalisar}
        ocupado={ocupado}
        aoMudar={() => salvar({ escolhas: { nao_analisar: !naoAnalisar } })}
        descricao={naoAnalisar ? 'Seu perfil foi apagado. A loja usa só o pedido em curso.' : estado.textos?.nao_analisar}
      />
    </div>
  );
}
