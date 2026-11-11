'use client';

import { useEffect, useId, useState } from 'react';
import { ArrowRight } from 'lucide-react';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { texto2 } from '@/components/ui/lista';
import { cn } from '@/lib/utils';
import { passosDoCaminho, type Rota } from '@/lib/rota-cozinha';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Resultado = Awaited<ReturnType<typeof api.kdsRotaSimular>>;
type Passo = { nome: string; detalhe: string; despacho?: boolean; tv?: boolean; papel?: boolean };

function Passos({ passos }: { passos: Passo[] }) {
  return (
    <ol className="flex min-w-0 flex-wrap items-stretch gap-1.5">
      {passos.map((p, i) => (
        <li key={`${p.nome}-${i}`} className="flex min-w-0 items-center gap-1.5">
          {i > 0 && <ArrowRight className={`h-4 w-4 flex-none ${texto2}`} aria-hidden="true" />}
          <span
            className={cn(
              'grid min-w-0 rounded-lg border px-2.5 py-1.5 text-sm',
              p.despacho && 'border-primary',
              p.tv && 'border-dashed',
              p.papel && 'border-dashed bg-secondary',
            )}
          >
            <b className="font-display [overflow-wrap:anywhere]">{p.nome}</b>
            <span className={`text-xs ${texto2} [overflow-wrap:anywhere]`}>{p.detalhe}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}

/**
 * "Por onde o pedido passa?": escolhe um produto e mostra o caminho DE VERDADE (o servidor roteia como na venda — produto,
 * setor e opção — e segue o "vai para" de cada KDS, pulando o desligado), o papel e a TV.
 */
export function Simulador({ rota }: { rota: Rota }) {
  const idSel = useId();
  const [produtos, setProdutos] = useState<{ id: string; nome: string; cat: string }[] | null>(null);
  const [erroLista, setErroLista] = useState('');
  const [produtoId, setProdutoId] = useState('');
  const [res, setRes] = useState<Resultado | null>(null);
  const [erro, setErro] = useState('');
  const [lendo, setLendo] = useState(false);
  const [tentativa, setTentativa] = useState(0);

  useEffect(() => {
    let vivo = true;
    api
      .direcionamento()
      .then((l: any) => {
        if (!vivo) return;
        const lista = (Array.isArray(l) ? l : [])
          .filter((p: any) => p.vaiParaProducao)
          .map((p: any) => ({ id: String(p.id), nome: String(p.nome), cat: String(p.categoriaNome || 'Sem categoria') }))
          .sort((a: any, b: any) => a.cat.localeCompare(b.cat, 'pt-BR') || a.nome.localeCompare(b.nome, 'pt-BR'));
        setProdutos(lista);
      })
      .catch((e: any) => vivo && (setProdutos([]), setErroLista(e?.message || 'Não consegui carregar os produtos.')));
    return () => {
      vivo = false;
    };
  }, []);

  // A resposta vale só para o produto escolhido agora (V64: a leitura mais nova vence).
  useEffect(() => {
    if (!produtoId) return;
    let vivo = true;
    setLendo(true);
    setErro('');
    api
      .kdsRotaSimular(produtoId)
      .then((r) => vivo && setRes(r))
      .catch((e: any) => vivo && (setRes(null), setErro(e?.message || 'Não consegui simular.')))
      .finally(() => vivo && setLendo(false));
    return () => {
      vivo = false;
    };
  }, [produtoId, rota, tentativa]);

  const nome = (id: string) => rota.kds.find((k) => k.id === id)?.nome ?? 'KDS';
  const tv: Passo[] = rota.tvs.length ? [{ nome: 'TV: Pronto', detalhe: 'quando nenhum KDS tem o pedido', tv: true }] : [];
  const grupos = new Map<string, { id: string; nome: string }[]>();
  for (const p of produtos ?? []) grupos.set(p.cat, [...(grupos.get(p.cat) ?? []), p]);

  return (
    <Card role="region" className="grid gap-3 p-4" aria-labelledby={`${idSel}-t`}>
      <h3 id={`${idSel}-t`} className="font-display text-base font-extrabold">
        Por onde o pedido passa?
      </h3>
      <div className="grid max-w-md gap-1">
        <label htmlFor={idSel} className="text-sm font-bold">
          Produto
        </label>
        <select
          id={idSel}
          value={produtoId}
          onChange={(e) => setProdutoId(e.target.value)}
          disabled={!produtos?.length}
          className="h-11 w-full min-w-0 rounded-md border border-input bg-card px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
        >
          <option value="">{produtos === null ? 'Carregando os produtos…' : produtos.length ? 'Escolha um produto' : 'Nenhum produto vai para a produção'}</option>
          {[...grupos.entries()].map(([cat, ps]) => (
            <optgroup key={cat} label={cat}>
              {ps.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nome}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        {erroLista && (
          <p role="alert" className="text-sm text-destructive">
            {erroLista}
          </p>
        )}
      </div>
      <div aria-live="polite" className="grid gap-2">
        {lendo && <p className={`text-sm ${texto2}`}>Simulando…</p>}
        {erro && (
          <p role="alert" className="flex flex-wrap items-center gap-2 text-sm text-destructive">
            {erro}
            <Button type="button" variant="outline" size="sm" onClick={() => setTentativa((t) => t + 1)}>
              Tentar de novo
            </Button>
          </p>
        )}
        {!lendo && !erro && res && <Resultado res={res} rota={rota} tv={tv} nome={nome} />}
      </div>
    </Card>
  );
}

function Resultado({ res, rota, tv, nome }: { res: Resultado; rota: Rota; tv: Passo[]; nome: (id: string) => string }) {
  const papel: Passo[] = res.impressoras.map((i) => ({ nome: `Papel · ${i.nome}`, detalhe: i.padrao ? 'impressora padrão, na hora da venda' : 'na hora da venda', papel: true }));
  if (!res.vaiParaProducao)
    return <p className="text-sm">{res.produto.nome} não vai para a produção: não aparece em KDS nem sai na via da cozinha.</p>;
  if (!res.caminhos.length)
    return (
      <div className="grid gap-2 rounded-lg border p-3">
        <b className="font-display">{res.produto.nome}</b>
        {papel.length ? <Passos passos={papel} /> : null}
        <p className={`text-sm ${texto2}`}>
          {res.estacoes
            ? papel.length
              ? 'Nenhum KDS marcou este produto: sai em papel.'
              : 'Nenhum KDS marcou este produto e nenhuma impressora de produção o recebe: ele não sai em lugar nenhum. Marque-o num KDS ou ligue uma impressora padrão.'
            : 'Nenhum KDS ligado começa a rota desta loja.'}
        </p>
      </div>
    );
  // Um KDS que também recebe o cartão que chega de outro do mesmo produto: sai duas vezes.
  const dobra = res.caminhos.filter((c) => res.caminhos.some((d) => d.inicio !== c.inicio && d.passos.includes(c.inicio)));
  return (
    <div className="grid gap-2 rounded-lg border p-3">
      <b className="font-display">{res.produto.nome}</b>
      {res.caminhos.map((c) => (
        <Passos key={c.inicio} passos={[...passosDoCaminho(rota.kds, rota.etapas, c.passos), ...tv]} />
      ))}
      {papel.length > 0 && (
        <>
          <p className={`text-sm ${texto2}`}>Também sai em papel, na hora da venda:</p>
          <Passos passos={papel} />
        </>
      )}
      {!res.estacoes && (
        <p className={`text-sm ${texto2}`}>
          Modo comum: o pedido inteiro aparece no começo da rota ({res.caminhos.map((c) => nome(c.inicio)).join(' e ')}) e segue o &quot;vai para&quot;.
        </p>
      )}
      {res.estacoes && res.caminhos.length > 1 && (
        <p className={`text-sm ${texto2}`}>Marcado em {res.caminhos.length} KDS: sai em cada um.</p>
      )}
      {dobra.map((c) => (
        <p key={c.inicio} className="text-sm font-bold text-foreground">
          ⚠ {nome(c.inicio)} recebe este produto direto e também o cartão que chega de{' '}
          {res.caminhos.filter((d) => d.inicio !== c.inicio && d.passos.includes(c.inicio)).map((d) => nome(d.inicio)).join(' e ')}: sai duas vezes.
        </p>
      ))}
    </div>
  );
}
