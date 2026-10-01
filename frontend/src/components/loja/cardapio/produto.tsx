'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { CartItem } from '@/components/loja/tipos';
import { OPCOES_TEMPLATE, type TemplateChave } from './tipos-template';
import { brl, extrasDe, Foto, Ic, irAoCampo, pctDesconto, Preco, Qtd, selosDe } from './partes';

/* eslint-disable @typescript-eslint/no-explicit-any */

// TELA DO PRODUTO dos quatro templates. A regra é a do `item-sheet` de sempre (variação obrigatória,
// grupos com mínimo e máximo, repetição, opção informativa, pré-marcadas, observação, quantidade) e
// o item sai para a sacola com a MESMA chave e os mesmos campos. Muda a apresentação: obrigatórios
// primeiro (base §3.2), pílula `n/máx`, e — no Regem Fluxo — grupos numerados, adicionais
// recolhidos e o botão que diz o que falta.

const permiteRepetir = (g: any) => g.regra === 'varias_com_repeticao';
const ehObrigatorio = (g: any) => !!(g.obrigatorio || g.min);

export function ProdutoTela({
  sel,
  template,
  loja,
  onFechar,
  onAdd,
}: {
  sel: any;
  template: TemplateChave;
  loja: any;
  onFechar: () => void;
  onAdd: (item: CartItem) => void;
}) {
  const op = OPCOES_TEMPLATE[template];
  const [pickVar, setPickVar] = useState<string | undefined>();
  const [pickOpc, setPickOpc] = useState<string[]>([]);
  const [obs, setObs] = useState('');
  const [obsAberta, setObsAberta] = useState(false);
  const [qtd, setQtd] = useState(1);
  const [opcAbertos, setOpcAbertos] = useState(false);
  const corpo = useRef<HTMLDivElement>(null);

  const grupos: any[] = useMemo(() => sel?.grupos ?? [], [sel]);
  const variacoes: any[] = useMemo(() => sel?.variacoes ?? [], [sel]);
  const opcoes = useMemo(() => grupos.flatMap((g: any) => (g.opcoes ?? []).map((o: any) => ({ ...o }))), [grupos]);
  // Obrigatórios primeiro, mantendo a ordem do cadastro dentro de cada bloco.
  const ordenados = useMemo(() => [...grupos.filter(ehObrigatorio), ...grupos.filter((g) => !ehObrigatorio(g))], [grupos]);
  const temObrigatorio = variacoes.length > 0 || grupos.some(ehObrigatorio);

  // Opções marcadas por padrão (mig 126) — ex.: "Talheres? Sim" já vem selecionado.
  // Respeita o max do grupo (não pré-marca além do permitido).
  useEffect(() => {
    const padrao = grupos.flatMap((g: any) => {
      const marcadas = (g.opcoes ?? []).filter((o: any) => o.padraoMarcada).map((o: any) => o.id);
      return g.max != null ? marcadas.slice(0, g.max) : marcadas;
    });
    setPickOpc(padrao);
  }, [grupos]);

  const variacao = variacoes.find((v: any) => v.id === pickVar);
  const base = variacao ? variacao.precoVenda : sel?.precoVenda ?? 0;
  const extra = pickOpc.reduce((s, id) => s + (opcoes.find((o: any) => o.id === id)?.precoDelta ?? 0), 0);
  const precoUnit = base + extra;

  const qtdNoGrupo = (s: string[], g: any) => s.filter((x) => (g.opcoes ?? []).some((o: any) => o.id === x)).length;
  const grupoOk = (g: any) => !ehObrigatorio(g) || qtdNoGrupo(pickOpc, g) >= (g.min || 1);
  // O que falta escolher, na ordem em que aparece na tela.
  const falta: { campo: string; rotulo: string } | null =
    variacoes.length && !pickVar
      ? { campo: 'g-variacao', rotulo: 'Escolha uma opção' }
      : (() => {
          const g = ordenados.find((x) => !grupoOk(x));
          return g ? { campo: `g-${g.id}`, rotulo: `Escolha: ${g.nome}` } : null;
        })();
  const valido = !falta;

  function toggleOpc(g: any, id: string) {
    setPickOpc((s) => {
      if (s.includes(id)) return s.filter((x) => x !== id);
      if (g.max === 1) {
        const outros = (g.opcoes ?? []).map((o: any) => o.id);
        return [...s.filter((x) => !outros.includes(x)), id];
      }
      if (g.max && qtdNoGrupo(s, g) >= g.max) return s;
      return [...s, id];
    });
  }
  function addOpc(g: any, id: string) {
    setPickOpc((s) => (g.max && qtdNoGrupo(s, g) >= g.max ? s : [...s, id]));
  }
  function removeOpc(id: string) {
    setPickOpc((s) => {
      const i = s.indexOf(id);
      if (i < 0) return s;
      const n = [...s];
      n.splice(i, 1);
      return n;
    });
  }

  function adicionar() {
    if (!valido) {
      if (falta) irAoCampo(corpo.current, falta.campo);
      return;
    }
    const partes: string[] = [];
    if (variacao) partes.push(variacao.nome);
    const contagem = new Map<string, number>();
    pickOpc.forEach((id) => contagem.set(id, (contagem.get(id) ?? 0) + 1));
    for (const [id, q] of contagem) {
      const o = opcoes.find((x: any) => x.id === id);
      if (o) partes.push(q > 1 ? `${q}x ${o.nome}` : o.nome);
    }
    const key = `${sel.id}:${pickVar ?? ''}:${[...pickOpc].sort().join(',')}:${obs}`;
    onAdd({
      key,
      produtoId: sel.id,
      variacaoId: pickVar,
      complementos: pickOpc,
      nome: sel.nome,
      sub: partes.join(' · '),
      preco: precoUnit,
      obs: obs.trim(),
      qtd,
    });
  }

  // ───────── grupos ─────────
  let numero = 0;
  const blocoVariacao = variacoes.length > 0 && (
    <section className="pg" data-campo="g-variacao">
      <div className="pg-h">
        <div>
          <b>
            {op.produtoGuiado && <i>{++numero}</i>}
            Escolha uma opção
          </b>
          <small className={op.produtoGuiado && !pickVar ? 'req' : ''}>Obrigatório · escolha 1</small>
        </div>
        <span className={`pg-pill ${pickVar ? 'ok' : ''}`}>
          {pickVar && <Ic n="check" s={13} />}
          {pickVar ? 1 : 0}/1
        </span>
      </div>
      <div className="pg-ops">
        {variacoes.map((v: any) => (
          <button key={v.id} type="button" className="po" aria-pressed={pickVar === v.id} onClick={() => setPickVar(v.id)}>
            <span className="po-n">
              {v.nome}
              {(v.atributos?.tamanho || v.atributos?.cor) && <small> {[v.atributos?.tamanho, v.atributos?.cor].filter(Boolean).join(' · ')}</small>}
            </span>
            <span className="po-p">{brl(v.precoVenda)}</span>
            <span className="po-r" />
          </button>
        ))}
      </div>
    </section>
  );

  const blocoGrupos = ordenados.map((g: any) => {
    const obr = ehObrigatorio(g);
    const radio = g.max === 1;
    const rep = permiteRepetir(g);
    const n = qtdNoGrupo(pickOpc, g);
    const ok = obr ? n >= (g.min || 1) : n > 0;
    const meta = g.max || g.min || 0;
    const num = op.produtoGuiado && obr ? ++numero : 0;
    // Adicionais recolhidos só quando há algo obrigatório antes (senão a tela ficaria vazia).
    const recolhivel = op.produtoGuiado && !obr && temObrigatorio;
    const recolhido = recolhivel && !opcAbertos;
    const regra = obr
      ? radio
        ? 'Obrigatório · escolha 1'
        : g.max && (g.min || 1) === g.max
          ? `Obrigatório · escolha ${g.max}`
          : `Obrigatório · mínimo ${g.min || 1}${g.max ? ` · até ${g.max}` : ''}`
      : radio
        ? 'Opcional · escolha 1'
        : g.max
          ? `Opcional · até ${g.max}`
          : 'Opcional';
    const cabeca = (
      <>
        <div>
          <b>
            {num > 0 && <i>{num}</i>}
            {g.nome}
          </b>
          <small className={obr && !ok && op.produtoGuiado ? 'req' : ''}>
            {regra}
            {recolhido && n > 0 ? ` · ${n} escolhido${n === 1 ? '' : 's'}` : ''}
          </small>
        </div>
        {recolhivel ? (
          <span className="f-opc">
            {recolhido ? 'Ver opções' : 'Recolher'} <Ic n={recolhido ? 'down' : 'minus'} s={16} />
          </span>
        ) : (
          <span className={`pg-pill ${obr && ok ? 'ok' : ''}`}>
            {obr && ok && <Ic n="check" s={13} />}
            {meta ? `${n}/${meta}` : n}
          </span>
        )}
      </>
    );
    return (
      <section key={g.id} className="pg" data-campo={`g-${g.id}`}>
        {recolhivel ? (
          <button type="button" className="pg-h" aria-expanded={!recolhido} onClick={() => setOpcAbertos((v) => !v)}>
            {cabeca}
          </button>
        ) : (
          <div className="pg-h">{cabeca}</div>
        )}
        {!recolhido && (
          <div className="pg-ops">
            {(g.opcoes ?? []).map((o: any) => {
              const cnt = pickOpc.filter((x) => x === o.id).length;
              const mini = o.imagemRef ? (
                <span className="po-th cut">
                  <Foto src={o.imagemRef} />
                </span>
              ) : null;
              const preco =
                o.precoDelta > 0 ? <span className="po-p">+ {brl(o.precoDelta)}</span> : o.informativa ? <span className="po-tag">obs</span> : null;
              if (rep) {
                const cheio = !!g.max && n >= g.max;
                return (
                  <div key={o.id} className={`po ${cnt ? 'on' : ''}`}>
                    {mini}
                    <span className="po-n">{o.nome}</span>
                    {preco}
                    <span className="po-st">
                      {cnt > 0 && (
                        <>
                          <button type="button" onClick={() => removeOpc(o.id)} aria-label={`Tirar ${o.nome}`}>
                            <Ic n="minus" s={16} />
                          </button>
                          <b>{cnt}</b>
                        </>
                      )}
                      <button type="button" onClick={() => addOpc(g, o.id)} disabled={cheio} aria-label={`Pôr ${o.nome}`}>
                        <Ic n="plus" s={16} />
                      </button>
                    </span>
                  </div>
                );
              }
              return (
                <button key={o.id} type="button" className="po" aria-pressed={cnt > 0} onClick={() => toggleOpc(g, o.id)}>
                  {mini}
                  <span className="po-n">{o.nome}</span>
                  {preco}
                  {radio ? <span className="po-r" /> : <span className="po-c">{cnt > 0 && <Ic n="check" s={14} />}</span>}
                </button>
              );
            })}
          </div>
        )}
      </section>
    );
  });

  const campoObs = (
    <div className="pp-obs">
      <label htmlFor="lp-obs">
        Alguma observação? <span className="pp-opc">(opcional)</span>
      </label>
      <textarea id="lp-obs" value={obs} onChange={(e) => setObs(e.target.value)} maxLength={140} placeholder="Ex.: sem cebola, ponto da carne bem passado" />
    </div>
  );
  const blocoObs =
    op.produtoGuiado && !obsAberta && !obs ? (
      <div className="f-obs">
        <button type="button" className="c-link" onClick={() => setObsAberta(true)}>
          <Ic n="plus" s={16} /> Adicionar observação
        </button>
      </div>
    ) : (
      campoObs
    );

  const selos = selosDe(sel);
  const extras = extrasDe(sel, loja);
  const linhaSelos = (selos.length > 0 || extras) && (
    <div className="p-selos">
      {selos.map((s) => (
        <span key={s}>{s}</span>
      ))}
      {extras && <em>{extras}</em>}
    </div>
  );
  const off = pctDesconto(sel);

  const rodape = (
    <div className="p-foot pf">
      <Qtd n={qtd} onMenos={() => setQtd((q) => Math.max(1, q - 1))} onMais={() => setQtd((q) => q + 1)} />
      {falta && op.botaoDizOQueFalta ? (
        <button type="button" className="p-btn falta c" onClick={adicionar}>
          {falta.rotulo} <Ic n="down" s={16} />
        </button>
      ) : (
        <button type="button" className="p-btn" onClick={adicionar} disabled={!valido}>
          <span>{valido ? 'Adicionar' : 'Escolha as opções'}</span>
          {valido && <span className="n">{brl(precoUnit * qtd)}</span>}
        </button>
      )}
    </div>
  );
  const corpoGrupos = (
    <>
      {blocoVariacao}
      {blocoGrupos}
      {blocoObs}
    </>
  );

  if (template === 'galeria') {
    return (
      <div className="p-panel g-prod" role="dialog" aria-label={sel.nome}>
        <div className="p-pbody" ref={corpo}>
          <div className={`g-pimg ${sel.imagemRef ? '' : 'sem'}`}>
            {sel.imagemRef && <Foto src={sel.imagemRef} alt={sel.nome} />}
            <button type="button" className="g-x" onClick={onFechar} aria-label="Fechar">
              <Ic n="back" />
            </button>
          </div>
          <div className="g-pinfo">
            <h2>{sel.nome}</h2>
            {sel.descricao && <p>{sel.descricao}</p>}
            <span className="g-pr g-pr-g">
              <Preco p={sel} />
            </span>
            {linhaSelos}
          </div>
          {corpoGrupos}
        </div>
        {rodape}
      </div>
    );
  }

  if (template === 'balcao') {
    return (
      <div className="p-panel" role="dialog" aria-label={sel.nome}>
        <div className="b-tb">
          <button type="button" className="ch-b" onClick={onFechar} aria-label="Voltar">
            <Ic n="back" />
          </button>
          <b>Detalhes do item</b>
        </div>
        <div className="p-pbody" ref={corpo}>
          {sel.imagemRef && (
            <div className="b-pimg">
              <Foto src={sel.imagemRef} alt={sel.nome} />
            </div>
          )}
          <div className="b-pinfo">
            <h2>{sel.nome}</h2>
            {sel.descricao && <p>{sel.descricao}</p>}
            <span className="b-pr b-pr-g">
              {sel.precoDe != null && <s>{brl(sel.precoDe)}</s>}
              {brl(sel.precoVenda)}
              {off > 0 && <span className="pct">-{off}%</span>}
            </span>
            {linhaSelos}
          </div>
          {corpoGrupos}
        </div>
        {rodape}
      </div>
    );
  }

  if (template === 'oferta') {
    return (
      <>
        <div className="p-dim" onClick={onFechar} />
        <div className="p-sheet" role="dialog" aria-label={sel.nome}>
          <div className="p-pbody" ref={corpo}>
            <div className={`o-pimg ${sel.imagemRef ? '' : 'sem'}`}>
              <span className="o-grab" />
              {sel.imagemRef && <Foto src={sel.imagemRef} alt={sel.nome} />}
              {off > 0 && <span className="o-off o-off-g">-{off}%</span>}
              <button type="button" className="o-x" onClick={onFechar} aria-label="Fechar">
                <Ic n="close" s={18} />
              </button>
            </div>
            <div className="o-pinfo">
              <h2>{sel.nome}</h2>
              {sel.descricao && <p>{sel.descricao}</p>}
              <span className="o-dp o-dp-g">
                {sel.precoDe != null && <s>{brl(sel.precoDe)}</s>}
                <b>{brl(sel.precoVenda)}</b>
              </span>
              {linhaSelos}
            </div>
            {corpoGrupos}
          </div>
          {rodape}
        </div>
      </>
    );
  }

  // Regem Fluxo
  return (
    <>
      <div className="p-dim" onClick={onFechar} />
      <div className="p-sheet" role="dialog" aria-label={sel.nome}>
        <div className="p-pbody" ref={corpo}>
          <div className="f-sh">
            {sel.imagemRef && (
              <div className="a">
                <Foto src={sel.imagemRef} alt={sel.nome} />
              </div>
            )}
            <div>
              <h2>{sel.nome}</h2>
              {sel.descricao && <p>{sel.descricao}</p>}
              <span className="pr f-pr">
                <Preco p={sel} />
              </span>
              {linhaSelos}
            </div>
            <button type="button" className="x" onClick={onFechar} aria-label="Fechar">
              <Ic n="close" s={18} />
            </button>
          </div>
          {corpoGrupos}
        </div>
        {rodape}
      </div>
    </>
  );
}
