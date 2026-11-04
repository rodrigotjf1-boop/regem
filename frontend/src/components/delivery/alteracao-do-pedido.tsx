'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import {
  antesAgora,
  brl,
  horaDaAlteracao,
  linhasDosItens,
  mudouACozinha,
  quemAlterou,
  resumoDaMudanca,
  textoDasVias,
  type HistoricoDaAlteracao,
} from '@/lib/pedido-alterado';

// PEDIDO ALTERADO (mig 362; protótipo `mockups/regem-alteracao-pedido.html`, vista "Painel da loja"): o que mudou na
// última alteração — os itens, o endereço, os valores de antes e de agora, as vias que saíram e se a cozinha já viu — e o
// histórico das alterações. Lê `GET /delivery/pedidos/:id/alteracoes`; separa "carregando", "não li" e "vazio" (V37).
export function AlteracaoDoPedido({ pedidoId, versao }: { pedidoId: string; versao?: string | null }) {
  const [dados, setDados] = useState<HistoricoDaAlteracao | null>(null);
  const [erro, setErro] = useState(false);

  useEffect(() => {
    let vivo = true;
    setErro(false);
    api
      .alteracoesDelivery(pedidoId)
      .then((r) => vivo && setDados(r as HistoricoDaAlteracao))
      .catch(() => vivo && setErro(true));
    return () => {
      vivo = false;
    };
  }, [pedidoId, versao]);

  if (erro && !dados) {
    return <p className="mt-3 text-xs text-muted-foreground">Não deu para ler o que mudou neste pedido. Feche e abra de novo.</p>;
  }
  if (!dados) return <p className="mt-3 text-xs text-muted-foreground">Carregando o que mudou…</p>;
  const [ultima, ...antes] = dados.alteracoes.filter((a) => a.situacao === 'aplicada');
  if (!ultima) return null;
  const m = ultima.mudanca;
  const itens = linhasDosItens(m);
  const vias = textoDasVias(ultima, dados.impressoras);
  const a = ultima.antes;
  const d = ultima.depois;

  return (
    <section className="mt-3 rounded-lg border border-warn/40 bg-warn/5 px-3 py-2 text-sm" aria-label="O que mudou no pedido" data-alteracao>
      <p className="font-bold text-warn">
        Alterado às {horaDaAlteracao(ultima.createdAt)} · {quemAlterou(ultima)}
      </p>
      {ultima.pedidoDoCliente && <p className="mt-1 break-words text-xs text-muted-foreground">O cliente pediu: “{ultima.pedidoDoCliente}”</p>}

      {(itens.length > 0 || m.endereco) && (
        <div className="mt-2">
          <p className="text-xs font-semibold">O que mudou</p>
          <ul className="mt-1 space-y-0.5">
            {itens.map((l, i) => (
              <li key={i} className="flex flex-wrap justify-between gap-x-2">
                <span className={l.sinal === '+' ? 'font-semibold text-ok' : 'font-semibold text-destructive'}>
                  {l.sinal} {l.texto}
                </span>
                <span className="font-mono text-xs">{l.valor}</span>
              </li>
            ))}
            {m.endereco && (
              <li className="break-words">
                📍 {m.endereco.de ? `${m.endereco.de} → ` : ''}
                <strong>{m.endereco.para}</strong>
                {m.endereco.referencia ? ` (${m.endereco.referencia})` : ''}
              </li>
            )}
          </ul>
        </div>
      )}

      <dl className="mt-2 grid grid-cols-1 gap-x-3 gap-y-0.5 text-xs sm:grid-cols-[auto_minmax(0,1fr)]">
        <dt className="text-muted-foreground">Total</dt>
        <dd className="font-mono">
          {antesAgora(a?.total, d?.total)}
          {m.taxa ? ` (entrega ${antesAgora(m.taxa.de, m.taxa.para)})` : ''}
        </dd>
        {m.troco && (
          <>
            <dt className="text-muted-foreground">Troco</dt>
            <dd>
              {m.troco.para != null ? `para ${brl(m.troco.para)}` : 'sem troco'}
              {m.troco.de != null ? ` (antes ${brl(m.troco.de)})` : ''}
            </dd>
          </>
        )}
        {(a?.cashback || d?.cashback) ? (
          <>
            <dt className="text-muted-foreground">Cashback do pedido</dt>
            <dd className="font-mono">{antesAgora(a?.cashback, d?.cashback)}</dd>
          </>
        ) : null}
        <dt className="text-muted-foreground">Vias</dt>
        <dd>{vias ? `${vias} ✓` : 'nenhuma via saiu (confira as impressoras)'}</dd>
        {(d?.cozinha ?? mudouACozinha(m)) && (
          <>
            <dt className="text-muted-foreground">Cozinha</dt>
            <dd className={dados.cozinha.pendente ? 'font-semibold text-warn' : 'text-ok'}>
              {dados.cozinha.pendente
                ? 'ainda não tocou em Visto'
                : dados.cozinha.vistoEm
                  ? `viu às ${horaDaAlteracao(dados.cozinha.vistoEm)}${dados.cozinha.vistoPor ? ` (${dados.cozinha.vistoPor})` : ''} ✓`
                  : 'viu ✓'}
            </dd>
          </>
        )}
        {m.endereco && (
          <>
            <dt className="text-muted-foreground">Entregador</dt>
            <dd>a posição do endereço antigo foi apagada e o caminho sai do novo</dd>
          </>
        )}
      </dl>

      {antes.length > 0 && (
        <details className="mt-2 text-xs">
          <summary className="cursor-pointer font-semibold">Alterações anteriores ({antes.length})</summary>
          <ul className="mt-1 space-y-0.5">
            {antes.map((x) => (
              <li key={x.id} className="break-words">
                <span className="font-mono">{horaDaAlteracao(x.createdAt)}</span> · {resumoDaMudanca(x.mudanca)} · {quemAlterou(x)}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
