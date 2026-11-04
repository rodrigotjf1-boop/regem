'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import {
  antesAgora,
  brl,
  depoisQueSaiu,
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
// `silencioso`: o pedido ainda não foi alterado — só aparece se houver uma alteração esperando a loja ou recusada (a da
// tela da nuvem de loja com servidor); enquanto lê, nada.
export function AlteracaoDoPedido({ pedidoId, versao, silencioso }: { pedidoId: string; versao?: string | null; silencioso?: boolean }) {
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
    if (silencioso) return null;
    return <p className="mt-3 text-xs text-muted-foreground">Não deu para ler o que mudou neste pedido. Feche e abra de novo.</p>;
  }
  if (!dados) return silencioso ? null : <p className="mt-3 text-xs text-muted-foreground">Carregando o que mudou…</p>;
  // A alteração feita na nuvem de uma loja com servidor (mig 362): vai como "pedida" e o servidor da loja aplica ou recusa.
  const maisNova = dados.alteracoes[0];
  const aviso =
    maisNova && maisNova.situacao !== 'aplicada' ? (
      <p
        role="status"
        className={`mt-3 break-words rounded-lg px-3 py-2 text-xs font-semibold ${maisNova.situacao === 'pedida' && !maisNova.vencida ? 'bg-secondary text-foreground' : 'bg-destructive/10 text-destructive'}`}
        data-alteracao-pedida={maisNova.situacao}
      >
        {maisNova.situacao === 'pedida'
          ? maisNova.vencida
            ? `A loja não respondeu à alteração das ${horaDaAlteracao(maisNova.createdAt)}: faça pelo painel no computador da loja.`
            : `⏳ Alteração enviada ao servidor da loja às ${horaDaAlteracao(maisNova.createdAt)}: aparece aqui quando a loja aplicar.`
          : `✕ A loja recusou a alteração das ${horaDaAlteracao(maisNova.createdAt)}: ${maisNova.motivo || 'sem motivo informado'}.`}
      </p>
    ) : null;
  const [ultima, ...antes] = dados.alteracoes.filter((a) => a.situacao === 'aplicada');
  if (!ultima) return aviso;
  const m = ultima.mudanca;
  const itens = linhasDosItens(m);
  const vias = textoDasVias(ultima, dados.impressoras);
  const saiu = depoisQueSaiu(ultima);
  const a = ultima.antes;
  const d = ultima.depois;

  return (
    <>
    {aviso}
    <section className="mt-3 rounded-lg border border-warn/40 bg-warn/5 px-3 py-2 text-sm" aria-label="O que mudou no pedido" data-alteracao>
      <p className="font-bold text-warn">
        Alterado às {horaDaAlteracao(ultima.createdAt)} · {quemAlterou(ultima)}
        {saiu ? ' · depois que saiu' : ''}
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
        <dd>
          {saiu
            ? 'nenhuma: o pedido já tinha saído (a equipe avisa o entregador pelo WhatsApp)'
            : vias
              ? `${vias} ✓`
              : 'nenhuma via saiu (confira as impressoras)'}
        </dd>
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
            <dd>
              {saiu
                ? 'já estava na rua: a equipe avisa pelo WhatsApp; o app dele refaz o caminho pelo endereço novo'
                : 'a posição do endereço antigo foi apagada e o caminho sai do novo'}
            </dd>
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
    </>
  );
}
