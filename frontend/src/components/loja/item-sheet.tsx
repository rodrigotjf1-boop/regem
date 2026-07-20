'use client';

import { useEffect, useMemo, useState } from 'react';
import { brl, type CartItem } from '@/components/loja/tipos';

/* eslint-disable @typescript-eslint/no-explicit-any, @next/next/no-img-element */

// Sheet de escolha do produto: variação + etapas obrigatórias (min/max) +
// observação + quantidade (stepper). Devolve o item pronto p/ o carrinho.
export function ItemSheet({
  sel,
  accent,
  menuTheme = 'classic',
  onClose,
  onAdd,
}: {
  sel: any;
  accent: string;
  menuTheme?: string;
  onClose: () => void;
  onAdd: (item: CartItem) => void;
}) {
  // fastfood e grid usam a mecânica rica de grupos (cabeçalho sticky + pílula x/y).
  const ff = menuTheme === 'fastfood' || menuTheme === 'grid';
  const [pickVar, setPickVar] = useState<string | undefined>();
  const [pickOpc, setPickOpc] = useState<string[]>([]);
  const [obs, setObs] = useState('');
  const [qtd, setQtd] = useState(1);

  const opcoes = useMemo(
    () => (sel?.grupos ?? []).flatMap((g: any) => (g.opcoes ?? []).map((o: any) => ({ ...o }))),
    [sel],
  );

  // Opções marcadas por padrão (mig 126) — ex.: "Talheres? Sim" já vem selecionado.
  // Respeita o max do grupo (não pré-marca além do permitido).
  useEffect(() => {
    const padrao = (sel?.grupos ?? []).flatMap((g: any) => {
      const marcadas = (g.opcoes ?? []).filter((o: any) => o.padraoMarcada).map((o: any) => o.id);
      return g.max != null ? marcadas.slice(0, g.max) : marcadas;
    });
    setPickOpc(padrao);
  }, [sel]);
  const variacao = (sel?.variacoes ?? []).find((v: any) => v.id === pickVar);
  const base = variacao ? variacao.precoVenda : sel?.precoVenda ?? 0;
  const extra = pickOpc.reduce((s, id) => s + (opcoes.find((o: any) => o.id === id)?.precoDelta ?? 0), 0);
  const precoUnit = base + extra;

  const valido =
    (sel?.variacoes?.length ? !!pickVar : true) &&
    (sel?.grupos ?? []).every((g: any) => {
      if (!g.obrigatorio && !g.min) return true;
      const n = pickOpc.filter((id) => (g.opcoes ?? []).some((o: any) => o.id === id)).length;
      return n >= (g.min || 1);
    });

  function toggleOpc(g: any, id: string) {
    setPickOpc((s) => {
      if (s.includes(id)) return s.filter((x) => x !== id);
      if (g.max === 1) {
        const outros = (g.opcoes ?? []).map((o: any) => o.id);
        return [...s.filter((x) => !outros.includes(x)), id];
      }
      const noGrupo = s.filter((x) => (g.opcoes ?? []).some((o: any) => o.id === x));
      if (g.max && noGrupo.length >= g.max) return s;
      return [...s, id];
    });
  }

  function adicionar() {
    if (!valido) return;
    const partes: string[] = [];
    if (variacao) partes.push(variacao.nome);
    pickOpc.forEach((id) => {
      const o = opcoes.find((x: any) => x.id === id);
      if (o) partes.push(o.nome);
    });
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

  return (
    <div className="fixed inset-0 z-30 flex items-end justify-center bg-black/50" onClick={onClose}>
      <div className="max-h-[92dvh] w-full max-w-lg overflow-y-auto rounded-t-3xl bg-white text-neutral-900" onClick={(e) => e.stopPropagation()}>
        {sel.imagemRef && (
          <div className="aspect-[16/9] w-full overflow-hidden bg-neutral-100">
            <img src={sel.imagemRef} alt={sel.nome} className="h-full w-full object-cover object-center" />
          </div>
        )}
        <div className="p-4">
          <div className="flex items-start justify-between gap-2">
            <h2 className="text-lg font-bold">{sel.nome}</h2>
            <button type="button" onClick={onClose} className="text-neutral-400">✕</button>
          </div>
          {sel.descricao && <p className="mt-1 text-sm text-neutral-500">{sel.descricao}</p>}

          {sel.variacoes?.length > 0 && (
            <div className="mt-4">
              <p className="mb-1 text-sm font-semibold">
                Escolha <span className="text-xs text-red-500">obrigatório</span>
              </p>
              {sel.variacoes.map((v: any) => (
                <button
                  key={v.id}
                  type="button"
                  onClick={() => setPickVar(v.id)}
                  className="mb-1.5 flex w-full items-center justify-between rounded-xl border p-3"
                  style={pickVar === v.id ? { borderColor: accent } : { borderColor: '#e5e5e5' }}
                >
                  <span className="text-sm">
                    {v.nome}
                    {(v.atributos?.tamanho || v.atributos?.cor) && (
                      <span className="ml-1 text-xs text-neutral-500">
                        {[v.atributos?.tamanho, v.atributos?.cor].filter(Boolean).join(' · ')}
                      </span>
                    )}
                  </span>
                  <span className="font-mono text-sm">{brl(v.precoVenda)}</span>
                </button>
              ))}
            </div>
          )}

          {(sel.grupos ?? []).map((g: any) => {
            const radio = g.max === 1;
            const selNoGrupo = (g.opcoes ?? []).filter((o: any) => pickOpc.includes(o.id)).length;
            const meta = g.max || g.min || 1;
            const obrig = !!(g.obrigatorio || g.min);
            const ok = obrig ? selNoGrupo >= (g.min || 1) : selNoGrupo > 0;
            return (
              <div key={g.id} className="mt-4">
                {ff ? (
                  // Fastfood: cabeçalho do grupo que gruda + pílula selecionados/máximo.
                  <div className="sticky top-0 z-10 -mx-4 flex items-center gap-2 border-b border-neutral-100 bg-white px-4 py-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-bold">{g.nome}</p>
                      <p className="text-[11px] font-semibold" style={{ color: accent }}>
                        {radio ? 'Escolha 1 item' : obrig ? `Escolha ${g.min || 1}${g.max ? ` a ${g.max}` : '+'}` : g.max ? `Escolha até ${g.max}` : 'Opcional'}
                      </p>
                    </div>
                    <span
                      className="ml-auto flex flex-none items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-bold"
                      style={ok ? { background: '#16a34a', color: '#fff' } : { background: '#f1f1f1', color: '#777' }}
                    >
                      {ok && '✓'} {selNoGrupo}/{meta}
                    </span>
                  </div>
                ) : (
                  <p className="mb-1 flex items-center gap-2 text-sm font-semibold">
                    {g.nome}
                    <span
                      className="rounded-full px-2 py-0.5 text-[10px] font-bold"
                      style={obrig ? { background: accent, color: '#fff' } : { background: '#f1f1f1', color: '#777' }}
                    >
                      {obrig ? 'OBRIGATÓRIO' : 'OPCIONAL'} · {radio ? 'escolha 1' : g.max ? `até ${g.max}` : 'vários'}
                    </span>
                  </p>
                )}
                {(g.opcoes ?? []).map((o: any) => {
                  const on = pickOpc.includes(o.id);
                  return (
                    <button
                      key={o.id}
                      type="button"
                      onClick={() => toggleOpc(g, o.id)}
                      className="mb-1.5 flex w-full items-center gap-3 rounded-xl border p-3 text-left"
                      style={on ? { borderColor: accent } : { borderColor: '#e5e5e5' }}
                    >
                      <span
                        className={`grid h-5 w-5 flex-none place-items-center border-2 ${radio ? 'rounded-full' : 'rounded-md'} text-[11px] font-bold text-white`}
                        style={on ? { background: accent, borderColor: accent } : { borderColor: '#d4d4d4' }}
                      >
                        {on ? '✓' : ''}
                      </span>
                      <span className="flex-1 text-sm">{o.nome}</span>
                      {o.precoDelta > 0 ? (
                        <span className="font-mono text-xs text-neutral-500">+ {brl(o.precoDelta)}</span>
                      ) : o.informativa ? (
                        // Opção informativa (sem código PDV): só observação de preparo.
                        <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-[10px] text-neutral-500">obs</span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            );
          })}

          <div className="mt-4">
            <p className="mb-1 text-sm font-semibold">Observação</p>
            <textarea
              value={obs}
              onChange={(e) => setObs(e.target.value)}
              placeholder="Ex.: tirar a cebola, ponto da carne…"
              className="min-h-[60px] w-full rounded-xl border border-neutral-200 px-3 py-2 text-sm"
            />
          </div>

          <div className="mt-5 flex items-center gap-3">
            <div className="flex items-center overflow-hidden rounded-xl border border-neutral-200">
              <button type="button" onClick={() => setQtd((q) => Math.max(1, q - 1))} className="h-11 w-11 text-xl font-bold" style={{ color: accent }}>−</button>
              <span className="w-10 text-center font-mono font-bold">{qtd}</span>
              <button type="button" onClick={() => setQtd((q) => q + 1)} className="h-11 w-11 text-xl font-bold" style={{ color: accent }}>+</button>
            </div>
            <button
              type="button"
              onClick={adicionar}
              disabled={!valido}
              className="flex flex-1 items-center justify-between rounded-xl px-5 py-3 font-semibold text-white disabled:opacity-50"
              style={{ background: accent }}
            >
              <span>{valido ? 'Adicionar' : 'Escolha as opções'}</span>
              <span className="font-mono">{brl(precoUnit * qtd)}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
