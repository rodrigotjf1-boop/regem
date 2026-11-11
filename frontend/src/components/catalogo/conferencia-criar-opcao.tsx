'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { toast } from '@/lib/toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Gaveta } from '@/components/ui/sobreposto';
import { texto2 } from '@/components/ui/lista';
import { chaveUnidade, comoFoiCadastrada, unidadesDoCadastro } from '@/lib/conversao-unidade';
import {
  APP, formDeCriarOpcao, pedidoDeCriarOpcao, precoNoApp, type BaixaDaOpcao, type CanalConferido, type FormCriarOpcao, type LinhaConferida,
} from '@/lib/conferencia-apps';

/* eslint-disable @typescript-eslint/no-explicit-any */

const BAIXAS: { k: BaixaDaOpcao; titulo: string; texto: string }[] = [
  { k: 'item', titulo: 'Item de estoque', texto: 'Baixa o próprio item (bacon, cheddar, lata).' },
  { k: 'ficha', titulo: 'Ficha técnica', texto: 'Preparado na loja: baixa os insumos da receita.' },
  { k: 'produto', titulo: 'Produto do Regem', texto: 'Baixa como o produto do cardápio (ex.: refrigerante do combo).' },
  { k: 'nada', titulo: 'Não baixa estoque', texto: 'Só para o que não tem estoque (ex.: ponto da carne).' },
];

// "Conferir com os apps" (R3 F4c) — a gaveta "Criar a opção no Regem" do complemento "só no app": a opção do catálogo nasce
// com o nome, o código PDV e o preço do app (o código e o preço não se editam) e a ligação com o estoque (V49: código +
// "Controlar estoque" + ligação). O preço do iFood vai na criação; o da 99 e a pausa do app, logo depois (as rotas de preço
// e pausa por canal da opção). A opção só cobra e baixa na venda dentro de um grupo do produto: a gaveta diz onde.
export function ConferenciaCriarOpcao({
  linha: l,
  canal,
  produtos,
  comIfood,
  aoFechar,
  aoCriar,
}: {
  linha: LinhaConferida;
  canal: CanalConferido;
  produtos: { id: string; nome: string }[];
  comIfood: boolean;
  aoFechar: () => void;
  aoCriar: () => void;
}) {
  const a = APP[canal];
  const [f, setF] = useState<FormCriarOpcao>(() => formDeCriarOpcao(l));
  const [fichas, setFichas] = useState<any[] | null>(null);
  const [itens, setItens] = useState<any[] | null>(null);
  const [erro, setErro] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const mudar = (m: Partial<FormCriarOpcao>) => setF((x) => ({ ...x, ...m }));

  useEffect(() => {
    let vivo = true;
    void api.fichasLista().then((r: any) => vivo && setFichas(Array.isArray(r) ? r : [])).catch(() => vivo && setFichas([]));
    void api.estoqueItens().then((r: any) => vivo && setItens(Array.isArray(r) ? r : [])).catch(() => vivo && setItens([]));
    return () => {
      vivo = false;
    };
  }, []);

  async function criar() {
    const p = pedidoDeCriarOpcao(f, l, canal, { comIfood });
    if (!p.ok) {
      setErro(p.erro);
      return;
    }
    setErro('');
    setOcupado(true);
    try {
      const nova: any = await api.criarOpcaoCatalogo(p.corpo);
      // O preço da 99 e a pausa do app vêm depois (rotas próprias da opção); a falha delas não desfaz a opção criada.
      const avisos: string[] = [];
      if (p.preco99 != null) await api.precoDaOpcaoNoCanal(nova.id, '99food', p.preco99).catch((e) => avisos.push(e instanceof Error ? e.message : 'o preço da 99 não foi gravado'));
      if (p.pausar) await api.pausaDaOpcaoNoCanal(nova.id, canal, true).catch((e) => avisos.push(e instanceof Error ? e.message : `a pausa ${a.do} não foi gravada`));
      toast.success(`Opção "${f.nome.trim()}" criada com o código ${l.pdv}.`);
      if (avisos.length) toast.error(`A opção foi criada, mas: ${avisos.join(' ')}`, 9000);
      aoCriar();
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Não foi possível criar a opção.');
    } finally {
      setOcupado(false);
    }
  }

  const item = (itens ?? []).find((x) => x.id === f.itemId);
  const unidades = item ? unidadesDoCadastro(item.unidadeMedida ?? 'un', item.conversoes ?? [], f.itemUnidade) : [];
  const escolhida = unidades.find((u) => chaveUnidade(u.unidade) === chaveUnidade(f.itemUnidade)) ?? unidades[0];
  const cadastrada = (unidade: string) => {
    const cad = comoFoiCadastrada(unidade, item?.unidadeMedida ?? 'un', item?.conversoes ?? []);
    const t = cad && (cad.equivale ?? (chaveUnidade(unidade) === chaveUnidade(item?.unidadeMedida ?? 'un') ? null : cad.frase));
    return t ? ` (${t})` : '';
  };

  return (
    <Gaveta
      titulo={`Criar a opção no Regem: ${l.nome}`}
      aoFechar={() => !ocupado && aoFechar()}
      rodape={
        <>
          <Button type="button" variant="outline" onClick={aoFechar} disabled={ocupado}>
            Cancelar
          </Button>
          <Button type="button" onClick={() => void criar()} disabled={ocupado}>
            {ocupado ? 'Criando…' : 'Criar a opção'}
          </Button>
        </>
      }
    >
      <div className="space-y-4 text-sm">
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 rounded-md border border-border bg-secondary/40 p-3">
          <dt className={texto2}>{a.no.replace(/^./, (x) => x.toUpperCase())}</dt>
          <dd className="min-w-0 break-words font-semibold">{l.nome}</dd>
          <dt className={texto2}>Grupos</dt>
          <dd className="min-w-0 break-words">{l.grupos.join(' · ') || '—'}</dd>
          <dt className={texto2}>Preço</dt>
          <dd className="font-mono">
            {precoNoApp(l)}
            {l.pausado ? ' · pausado lá' : ''}
          </dd>
        </dl>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="criar-op-nome">Nome no Regem</Label>
            <Input id="criar-op-nome" value={f.nome} onChange={(e) => mudar({ nome: e.target.value })} autoComplete="off" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="criar-op-codigo">Código PDV</Label>
            <Input id="criar-op-codigo" value={l.pdv ?? ''} readOnly aria-readonly="true" className="font-mono" />
            <p className={`text-xs ${texto2}`}>Vem {a.do}: é por ele que o complemento se liga.</p>
          </div>
        </div>

        <fieldset className="space-y-2">
          <legend className="text-sm font-bold">Como a venda baixa o estoque</legend>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {BAIXAS.map((b) => (
              <button
                key={b.k}
                type="button"
                aria-pressed={f.baixa === b.k}
                onClick={() => mudar({ baixa: b.k })}
                className={`rounded-md border px-3 py-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                  f.baixa === b.k ? 'border-primary bg-primary/10' : 'border-border hover:bg-secondary'
                }`}
              >
                <span className="block font-semibold">{b.titulo}</span>
                <span className={`block text-xs ${texto2}`}>{b.texto}</span>
              </button>
            ))}
          </div>
          {f.baixa === 'item' && (
            <div className="space-y-2">
              <div className="space-y-1">
                <Label htmlFor="criar-op-item">Item de estoque</Label>
                <Select id="criar-op-item" value={f.itemId} onChange={(e) => mudar({ itemId: e.target.value, itemUnidade: '' })}>
                  <option value="">{itens === null ? 'Carregando…' : itens.length ? 'Escolha…' : 'Nenhum item de estoque'}</option>
                  {(itens ?? []).map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.nome}
                    </option>
                  ))}
                </Select>
              </div>
              {unidades.length > 1 && escolhida && (
                <div className="space-y-1">
                  <Label htmlFor="criar-op-unidade">Sai a cada venda</Label>
                  <Select id="criar-op-unidade" value={escolhida.unidade} onChange={(e) => mudar({ itemUnidade: e.target.value })}>
                    {unidades.map((u) => (
                      <option key={u.unidade} value={u.unidade}>
                        1 {u.unidade}
                        {cadastrada(u.unidade)}
                      </option>
                    ))}
                  </Select>
                </div>
              )}
            </div>
          )}
          {f.baixa === 'ficha' && (
            <div className="space-y-1">
              <Label htmlFor="criar-op-ficha">Ficha técnica</Label>
              <Select id="criar-op-ficha" value={f.fichaId} onChange={(e) => mudar({ fichaId: e.target.value })}>
                <option value="">{fichas === null ? 'Carregando…' : fichas.length ? 'Escolha…' : 'Nenhuma ficha cadastrada'}</option>
                {(fichas ?? []).map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.nome}
                  </option>
                ))}
              </Select>
            </div>
          )}
          {f.baixa === 'produto' && (
            <div className="space-y-1">
              <Label htmlFor="criar-op-produto">Produto do Regem</Label>
              <Select id="criar-op-produto" value={f.produtoRefId} onChange={(e) => mudar({ produtoRefId: e.target.value })}>
                <option value="">Escolha…</option>
                {produtos.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nome}
                  </option>
                ))}
              </Select>
            </div>
          )}
          {f.baixa === 'nada' && (
            <p className="rounded-md border border-warn/40 bg-warn/10 px-3 py-2">
              A venda <b>não</b> vai baixar estoque por esta opção. Use só para o que não tem estoque (ex.: ponto da carne, &quot;sem
              cebola&quot;).
            </p>
          )}
        </fieldset>

        <p className={`rounded-md border border-info/40 bg-info/10 px-3 py-2 text-xs`}>
          A opção cobra e baixa na venda {canal === 'ifood' ? 'pelo iFood' : 'pela 99'} quando está no grupo de complementos do produto: ponha-a
          no grupo em Cadastros › Cardápio › Complementos.
        </p>

        {erro && (
          <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2">
            {erro}
          </p>
        )}
      </div>
    </Gaveta>
  );
}
