'use client';

import { useMemo, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { distintos, num, semAcento, texto2 } from '@/components/ui/lista';

/* eslint-disable @typescript-eslint/no-explicit-any */
/** Um produto marcado. Em Compras leva a quantidade e o custo; em Contagem, fica vazio. */
export type LinhaEscolhida = { quantidade: string; custoUnitario: string };
export type Escolha = Record<string, LinhaEscolhida>;

const unidadeDe = (i: any): string => i.unidadeLista ?? i.unidadeMedida ?? '';
const abaixo = (i: any) => i.abaixoMinimo ?? Number(i.saldo) < Number(i.estoqueMinimo);

// Escolher produtos numa lista longa: busca, categoria, "só abaixo do mínimo", marcar todos os
// que estão à vista e a contagem dos marcados. Usada pela lista de Contagem (só marca) e pela
// lista de Compras (cada marcado pede a quantidade e, opcional, o custo).
export function EscolhaProdutos({
  itens,
  valor,
  aoMudar,
  comQuantidade = false,
  rotulo = 'Produtos',
}: {
  itens: any[];
  /** A presença do id = marcado. */
  valor: Escolha;
  aoMudar: (v: Escolha) => void;
  comQuantidade?: boolean;
  rotulo?: string;
}) {
  const [busca, setBusca] = useState('');
  const [categoria, setCategoria] = useState('');
  const [soAbaixo, setSoAbaixo] = useState(false);
  const [soMarcados, setSoMarcados] = useState(false);

  const visiveis = useMemo(() => {
    const b = semAcento(busca);
    return itens.filter(
      (i) =>
        (!b || semAcento(i.nome).includes(b)) &&
        (!categoria || (i.categoriaNome ?? 'Sem categoria') === categoria) &&
        (!soAbaixo || abaixo(i)) &&
        (!soMarcados || !!valor[i.id]),
    );
  }, [itens, busca, categoria, soAbaixo, soMarcados, valor]);
  const marcados = Object.keys(valor).filter((id) => itens.some((i) => i.id === id)).length;

  const alternar = (id: string) => {
    const n = { ...valor };
    if (n[id]) delete n[id];
    else n[id] = { quantidade: '', custoUnitario: '' };
    aoMudar(n);
  };
  const marcarVisiveis = () => {
    const n = { ...valor };
    for (const i of visiveis) if (!n[i.id]) n[i.id] = { quantidade: '', custoUnitario: '' };
    aoMudar(n);
  };
  const ficha = (ligada: boolean) =>
    `inline-flex min-h-10 items-center rounded-full border px-3 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
      ligada ? 'border-primary bg-primary/15 text-foreground' : `border-input bg-card ${texto2} hover:border-secondary-foreground`
    }`;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-sm font-medium">{rotulo}</span>
        <span className={`text-sm ${texto2}`} role="status" aria-live="polite">{marcados} de {itens.length} marcados</span>
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <Input type="search" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar produto" aria-label="Buscar produto" autoComplete="off" />
        <Select value={categoria} onChange={(e) => setCategoria(e.target.value)} aria-label="Categoria">
          <option value="">Todas as categorias</option>
          {distintos(itens, (i) => i.categoriaNome ?? 'Sem categoria').map((c) => <option key={c} value={c}>{c}</option>)}
        </Select>
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="button" aria-pressed={soAbaixo} className={ficha(soAbaixo)} onClick={() => setSoAbaixo((v) => !v)}>Só abaixo do mínimo</button>
        <button type="button" aria-pressed={soMarcados} className={ficha(soMarcados)} onClick={() => setSoMarcados((v) => !v)}>Só os marcados</button>
        <Button type="button" variant="outline" size="sm" onClick={marcarVisiveis} disabled={!visiveis.length}>Marcar os da lista</Button>
        <Button type="button" variant="outline" size="sm" onClick={() => aoMudar({})} disabled={!marcados}>Desmarcar todos</Button>
      </div>
      <ul className="max-h-72 divide-y divide-border overflow-y-auto rounded-lg border border-border">
        {itens.length === 0 && <li className={`p-3 text-sm ${texto2}`}>Cadastre produtos primeiro, na aba Produtos.</li>}
        {itens.length > 0 && visiveis.length === 0 && <li className={`p-3 text-sm ${texto2}`}>Nenhum produto com esses filtros.</li>}
        {visiveis.map((i) => {
          const l = valor[i.id];
          return (
            <li key={i.id} className="flex flex-wrap items-center gap-2 px-3 py-2">
              <label className="flex min-h-10 min-w-0 flex-1 basis-56 items-center gap-2.5 text-sm">
                <input type="checkbox" className="h-5 w-5 flex-none accent-primary" checked={!!l} onChange={() => alternar(i.id)} />
                <span className="min-w-0">
                  <span className="font-semibold">{i.nome}</span>
                  <span className={`block text-xs ${texto2}`}>
                    {i.categoriaNome ?? 'Sem categoria'} · saldo {num(i.saldo)} {unidadeDe(i)}{abaixo(i) ? ' · abaixo do mínimo' : ''}
                  </span>
                </span>
              </label>
              {comQuantidade && l && (
                <span className="flex gap-2">
                  <Input type="number" min={0} step="any" inputMode="decimal" className="w-24" value={l.quantidade} placeholder="qtd"
                    aria-label={`Quantidade de ${i.nome}, em ${unidadeDe(i)}`} onChange={(e) => aoMudar({ ...valor, [i.id]: { ...l, quantidade: e.target.value } })} />
                  <Input type="number" min={0} step="any" inputMode="decimal" className="w-28" value={l.custoUnitario} placeholder="R$ / un."
                    aria-label={`Custo unitário de ${i.nome}`} onChange={(e) => aoMudar({ ...valor, [i.id]: { ...l, custoUnitario: e.target.value } })} />
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
