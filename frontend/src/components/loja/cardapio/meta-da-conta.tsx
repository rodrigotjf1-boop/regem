'use client';

import { useState } from 'react';
import { api } from '@/lib/api';

/* eslint-disable @typescript-eslint/no-explicit-any */

// A META DO MÊS em Sua conta › Benefícios (fase A3 do Clube; protótipo `mockups/regem-clube-banner.html`, "No cardápio" ›
// 3 e 6): a barra dos pedidos do mês, os níveis e, no nível batido, os prêmios para escolher (vira cupom para o próximo
// pedido). O nível batido no mês anterior ainda se escolhe até o dia 7. O servidor confere tudo de novo ao escolher.

type Premio = { id: string; nome: string; descricao: string };
type Nivel = { nivel: number; pedidos: number; falta: number; atingido: boolean; escolhido: boolean; premios: Premio[] };
export type MetaDoMesNaConta = {
  mes: string;
  mesNome: string;
  pedidos: number;
  niveis: Nivel[];
  proximo: { nivel: number; pedidos: number; falta: number } | null;
  pendente: boolean;
};
export type MetaDoCliente = { ativo: false } | { ativo: true; validadeDias: number; atual: MetaDoMesNaConta; anterior: MetaDoMesNaConta | null };

const ORDINAL = ['primeiro', 'segundo', 'terceiro'];

function EscolhaDoNivel({
  mes,
  nivel,
  validadeDias,
  token,
  clienteToken,
  aoEscolher,
  avisar,
}: {
  mes: string;
  nivel: Nivel;
  validadeDias: number;
  token: string;
  clienteToken: string;
  aoEscolher: () => void;
  avisar: (texto: string) => void;
}) {
  const [escolhido, setEscolhido] = useState('');
  const [mandando, setMandando] = useState(false);
  async function escolher() {
    if (!escolhido || mandando) return;
    setMandando(true);
    try {
      const r: any = await api.clienteEscolherDaMeta(token, clienteToken, mes, nivel.nivel, escolhido);
      avisar(`Prêmio escolhido: ${r?.premio ?? 'pronto'}. Já está nos seus benefícios.`);
      aoEscolher();
    } catch (e) {
      avisar(e instanceof Error ? e.message : 'Não deu para escolher agora.');
    } finally {
      setMandando(false);
    }
  }
  return (
    <div className="c-album-escolha">
      <div className="c-album-premios" role="group" aria-label={`Prêmios do nível ${nivel.nivel}`}>
        {nivel.premios.map((p) => (
          <button key={p.id} type="button" className="c-album-premio" aria-pressed={escolhido === p.id} onClick={() => setEscolhido(p.id)}>
            <b>{p.nome}</b>
            <small>{p.descricao}</small>
          </button>
        ))}
      </div>
      <button type="button" className="lk" onClick={() => void escolher()} disabled={!escolhido || mandando}>
        {mandando ? 'Escolhendo…' : 'Quero este'}
      </button>
      <p className="c-album-nota">Vale por {validadeDias} dias, no próximo pedido pelo cardápio ou pelo WhatsApp.</p>
    </div>
  );
}

export function MetaDaConta({
  meta,
  token,
  clienteToken,
  aoEscolher,
  avisar,
}: {
  meta: MetaDoCliente;
  token: string;
  clienteToken: string;
  aoEscolher: () => void;
  avisar: (texto: string) => void;
}) {
  if (!meta.ativo) return null;
  const { atual, anterior, validadeDias } = meta;
  const topo = atual.niveis[atual.niveis.length - 1]?.pedidos ?? 1;
  const largura = Math.min(100, Math.round((atual.pedidos / topo) * 100));
  const escolha = (mes: string, n: Nivel) => (
    <EscolhaDoNivel key={`${mes}-${n.nivel}`} mes={mes} nivel={n} validadeDias={validadeDias} token={token} clienteToken={clienteToken} aoEscolher={aoEscolher} avisar={avisar} />
  );

  return (
    <>
      {anterior && (
        <div className="c-sec">
          <h3 className="c-h">Meta de {anterior.mesNome} · você conseguiu!</h3>
          <p className="c-album-nota">Escolha o prêmio até o dia 7 deste mês.</p>
          {anterior.niveis.filter((n) => n.atingido && !n.escolhido).map((n) => (
            <div key={n.nivel} className="c-meta-nivel-escolha">
              {anterior.niveis.length > 1 && <b className="c-meta-sub">{n.pedidos} pedidos · nível {n.nivel}</b>}
              {escolha(anterior.mes, n)}
            </div>
          ))}
        </div>
      )}
      <div className="c-sec">
        <h3 className="c-h">Meta de {atual.mesNome}</h3>
        <p className="c-album-nota">
          {atual.proximo
            ? `${atual.pedidos} ${atual.pedidos === 1 ? 'pedido' : 'pedidos'} de ${atual.proximo.pedidos} para o ${ORDINAL[atual.proximo.nivel - 1] ?? 'próximo'} prêmio`
            : 'Você bateu todos os níveis deste mês!'}
        </p>
        <div className="c-barra" role="img" aria-label={`${atual.pedidos} de ${topo} pedidos`}>
          <span style={{ width: `${largura}%` }} />
        </div>
        <div className="c-niveis">
          {atual.niveis.map((n) => (
            <div key={n.nivel} className="c-nivel">
              <span>
                <b>{n.pedidos} pedidos</b> · {n.nivel === 1 ? 'escolha 1 prêmio' : 'prêmio maior'}
              </span>
              <span className={`c-nivel-s${n.atingido ? ' ok' : ''}`}>
                {n.escolhido ? '✓ escolhido' : n.atingido ? 'escolha abaixo' : n.falta === 1 ? 'falta 1' : `faltam ${n.falta}`}
              </span>
            </div>
          ))}
        </div>
        {atual.niveis.filter((n) => n.atingido && !n.escolhido).map((n) => (
          <div key={n.nivel} className="c-meta-nivel-escolha">
            <b className="c-meta-sub">Você bateu {n.pedidos} pedidos! Escolha 1 prêmio</b>
            {escolha(atual.mes, n)}
          </div>
        ))}
        <details className="c-meta-premios">
          <summary>Ver os prêmios da meta</summary>
          <ul>
            {atual.niveis.map((n) => (
              <li key={n.nivel}>
                <b>{n.pedidos} pedidos:</b> {n.premios.map((p) => p.nome).join(', ') || '—'}
              </li>
            ))}
          </ul>
        </details>
      </div>
    </>
  );
}
