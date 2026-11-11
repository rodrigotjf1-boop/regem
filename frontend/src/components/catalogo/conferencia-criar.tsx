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
import type { CategoriaDaGestao } from '@/lib/catalogo-gestao';
import {
  APP, formDeCriar, pedidoDeCriar, precoNoApp, type BaixaDoCriar, type CanalConferido, type FormCriar, type LinhaConferida,
} from '@/lib/conferencia-apps';

/* eslint-disable @typescript-eslint/no-explicit-any */

const NOVA = '__nova';
const BAIXAS: { k: BaixaDoCriar; titulo: string; texto: string }[] = [
  { k: 'ficha', titulo: 'Ficha técnica', texto: 'Feito na loja: baixa os insumos da receita.' },
  { k: 'item', titulo: 'Item de estoque', texto: 'Revenda: baixa o próprio item (lata, garrafa).' },
  { k: 'combo', titulo: 'Combo', texto: 'Baixa cada produto que o compõe.' },
  { k: 'nada', titulo: 'Não baixa estoque', texto: 'Só para o que não tem estoque.' },
];

// "Conferir com os apps" (R3 F4b) — a gaveta "Criar no Regem" da linha "só no app" (protótipo, decisões 1 e 2): o produto
// nasce com o nome, o código PDV e o preço do app (o código e o preço de lá não se editam), a categoria, o "Onde vende" (o
// app de onde veio marcado; o Regem não — desmarcado, ele fica fora do balcão e do cardápio digital) e como a venda baixa o
// estoque (ficha, item de estoque, combo ou nada). Grava pela criação de produto de sempre (`POST /produtos`).
export function ConferenciaCriar({
  linha: l,
  canal,
  categorias,
  produtos,
  comIfood,
  com99,
  aoFechar,
  aoCriar,
  aoNovaCategoria,
}: {
  linha: LinhaConferida;
  canal: CanalConferido;
  categorias: CategoriaDaGestao[];
  produtos: { id: string; nome: string }[];
  comIfood: boolean;
  com99: boolean;
  aoFechar: () => void;
  aoCriar: () => void;
  aoNovaCategoria: (c: CategoriaDaGestao) => void;
}) {
  const a = APP[canal];
  const [f, setF] = useState<FormCriar>(() => formDeCriar(l, canal, categorias));
  const [fichas, setFichas] = useState<any[] | null>(null);
  const [itens, setItens] = useState<any[] | null>(null);
  const [novaCat, setNovaCat] = useState<string | null>(null);
  const [criandoCat, setCriandoCat] = useState(false);
  const [erro, setErro] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const mudar = (m: Partial<FormCriar>) => setF((x) => ({ ...x, ...m }));

  useEffect(() => {
    let vivo = true;
    // As listas de ficha e de item de estoque só ao abrir a gaveta (não pesam na conferência).
    void api.fichasLista().then((r: any) => vivo && setFichas(Array.isArray(r) ? r : [])).catch(() => vivo && setFichas([]));
    void api.estoqueItens().then((r: any) => vivo && setItens(Array.isArray(r) ? r : [])).catch(() => vivo && setItens([]));
    return () => {
      vivo = false;
    };
  }, []);

  async function criarCategoria() {
    const nome = (novaCat ?? '').trim();
    if (!nome) return;
    setCriandoCat(true);
    try {
      const c: any = await api.criarCategoriaProduto({ nome });
      aoNovaCategoria({ id: c.id, nome: c.nome ?? nome, ordem: c.ordem });
      mudar({ categoriaId: c.id });
      setNovaCat(null);
      toast.success(`Categoria "${nome}" criada.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Não foi possível criar a categoria.');
    } finally {
      setCriandoCat(false);
    }
  }

  async function criar() {
    const p = pedidoDeCriar(f, l, canal, { comIfood, com99 });
    if (!p.ok) {
      setErro(p.erro);
      return;
    }
    setErro('');
    setOcupado(true);
    try {
      await api.criarProduto(p.corpo);
      toast.success(`"${f.nome.trim()}" criado no Regem com o código ${l.pdv}: a venda ${canal === 'ifood' ? 'pelo iFood' : 'pela 99'} já liga a ele.`);
      aoCriar();
    } catch (err: any) {
      // O código é único por empresa (índice `idx_produto_codigo`): 409 = outro produto pegou o código no meio.
      setErro(err?.status === 409 ? `Outro produto do Regem já tem o código ${l.pdv}. Leia ${a.o} de novo.` : err instanceof Error ? err.message : 'Não foi possível criar o produto.');
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
      titulo={`Criar no Regem: ${l.nome}`}
      aoFechar={() => !ocupado && aoFechar()}
      rodape={
        <>
          <Button type="button" variant="outline" onClick={aoFechar} disabled={ocupado}>
            Cancelar
          </Button>
          <Button type="button" onClick={() => void criar()} disabled={ocupado}>
            {ocupado ? 'Criando…' : 'Criar o produto'}
          </Button>
        </>
      }
    >
      <div className="space-y-4 text-sm">
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 rounded-md border border-border bg-secondary/40 p-3">
          <dt className={texto2}>{a.no.replace(/^./, (x) => x.toUpperCase())}</dt>
          <dd className="min-w-0 break-words font-semibold">{l.nome}</dd>
          <dt className={texto2}>Categoria</dt>
          <dd className="min-w-0 break-words">{l.grupos.join(' · ') || '—'}</dd>
          <dt className={texto2}>Preço</dt>
          <dd className="font-mono">
            {precoNoApp(l)}
            {l.pausado ? ' · pausado lá' : ''}
          </dd>
        </dl>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="criar-nome">Nome no Regem</Label>
            <Input id="criar-nome" value={f.nome} onChange={(e) => mudar({ nome: e.target.value })} autoComplete="off" />
            <p className={`text-xs ${texto2}`}>É o nome nos relatórios e na cozinha.</p>
          </div>
          <div className="space-y-1">
            <Label htmlFor="criar-codigo">Código PDV</Label>
            <Input id="criar-codigo" value={l.pdv ?? ''} readOnly aria-readonly="true" className="font-mono" />
            <p className={`text-xs ${texto2}`}>Vem {a.do}: é por ele que a venda se liga.</p>
          </div>
          <div className="space-y-1">
            <Label htmlFor="criar-cat">Categoria no Regem</Label>
            <Select
              id="criar-cat"
              value={novaCat !== null ? NOVA : f.categoriaId}
              onChange={(x) => (x.target.value === NOVA ? setNovaCat('') : (setNovaCat(null), mudar({ categoriaId: x.target.value })))}
            >
              {!f.categoriaId && <option value="">Escolha…</option>}
              {categorias.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nome}
                </option>
              ))}
              <option value={NOVA}>＋ Cadastrar nova categoria</option>
            </Select>
            {novaCat !== null && (
              <div className="flex flex-wrap items-end gap-2 pt-1">
                <div className="min-w-0 flex-1 basis-40 space-y-1">
                  <Label htmlFor="criar-nova-cat">Nome da nova categoria</Label>
                  <Input
                    id="criar-nova-cat"
                    autoFocus
                    value={novaCat}
                    onChange={(x) => setNovaCat(x.target.value)}
                    onKeyDown={(x) => {
                      if (x.key === 'Enter') {
                        x.preventDefault();
                        void criarCategoria();
                      }
                    }}
                    autoComplete="off"
                  />
                </div>
                <Button type="button" onClick={() => void criarCategoria()} disabled={criandoCat || !novaCat.trim()}>
                  {criandoCat ? 'Criando…' : 'Criar categoria'}
                </Button>
                <Button type="button" variant="outline" onClick={() => setNovaCat(null)}>
                  Cancelar
                </Button>
              </div>
            )}
          </div>
          <div className="space-y-1">
            <Label htmlFor="criar-preco-regem">Preço no Regem (balcão e cardápio digital)</Label>
            <Input id="criar-preco-regem" inputMode="decimal" value={f.precoRegem} onChange={(e) => mudar({ precoRegem: e.target.value })} autoComplete="off" />
            <p className={`text-xs ${texto2}`}>
              Começa com o {a.do}. O preço {a.do} no Regem fica o de lá ({precoNoApp(l)}).
            </p>
          </div>
        </div>

        <fieldset className="space-y-2">
          <legend className="text-sm font-bold">Onde vende</legend>
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            <label className="flex min-h-10 items-center gap-2">
              <input type="checkbox" className="h-4 w-4" checked={f.ondeRegem} onChange={(e) => mudar({ ondeRegem: e.target.checked })} />
              Regem (balcão e cardápio digital)
            </label>
            {comIfood && (
              <label className="flex min-h-10 items-center gap-2">
                <input type="checkbox" className="h-4 w-4" checked={f.ondeIfood} onChange={(e) => mudar({ ondeIfood: e.target.checked })} />
                iFood
              </label>
            )}
            {com99 && (
              <label className="flex min-h-10 items-center gap-2">
                <input type="checkbox" className="h-4 w-4" checked={f.onde99} onChange={(e) => mudar({ onde99: e.target.checked })} />
                99
              </label>
            )}
          </div>
          <p className={`text-xs ${texto2}`}>
            Vem marcado o app de onde o item veio. Sem o Regem marcado, o produto não aparece no balcão nem no cardápio digital — e isso
            não o pausa {a.no}.
          </p>
        </fieldset>

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
          {f.baixa === 'ficha' && (
            <div className="space-y-1">
              <Label htmlFor="criar-ficha">Ficha técnica</Label>
              <Select id="criar-ficha" value={f.fichaId} onChange={(e) => mudar({ fichaId: e.target.value })}>
                <option value="">{fichas === null ? 'Carregando…' : fichas.length ? 'Escolha…' : 'Nenhuma ficha cadastrada'}</option>
                {(fichas ?? []).map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.nome}
                  </option>
                ))}
              </Select>
              <p className={`text-xs ${texto2}`}>Cada venda baixa os insumos da ficha. Ficha nova: em Estoque › Fichas técnicas.</p>
            </div>
          )}
          {f.baixa === 'item' && (
            <div className="space-y-2">
              <div className="space-y-1">
                <Label htmlFor="criar-item">Item de estoque (revenda)</Label>
                <Select id="criar-item" value={f.itemId} onChange={(e) => mudar({ itemId: e.target.value, itemUnidade: '' })}>
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
                  <Label htmlFor="criar-unidade">Sai a cada venda</Label>
                  <Select id="criar-unidade" value={escolhida.unidade} onChange={(e) => mudar({ itemUnidade: e.target.value })}>
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
          {f.baixa === 'combo' && (
            <div className="space-y-2">
              <p className={`text-xs ${texto2}`}>Os produtos do combo: cada um baixa o estoque dele, como se fosse vendido sozinho.</p>
              {f.combo.map((c, i) => (
                <div key={i} className="flex flex-wrap items-end gap-2">
                  <div className="min-w-0 flex-1 basis-48 space-y-1">
                    <Label htmlFor={`criar-combo-${i}`}>Produto {i + 1} do combo</Label>
                    <Select
                      id={`criar-combo-${i}`}
                      value={c.componenteProdutoId}
                      onChange={(e) => mudar({ combo: f.combo.map((x, j) => (j === i ? { ...x, componenteProdutoId: e.target.value } : x)) })}
                    >
                      <option value="">Escolha…</option>
                      {produtos.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.nome}
                        </option>
                      ))}
                    </Select>
                  </div>
                  <div className="w-24 space-y-1">
                    <Label htmlFor={`criar-combo-qtd-${i}`}>Quantidade</Label>
                    <Input
                      id={`criar-combo-qtd-${i}`}
                      inputMode="decimal"
                      value={c.quantidade}
                      onChange={(e) => mudar({ combo: f.combo.map((x, j) => (j === i ? { ...x, quantidade: e.target.value } : x)) })}
                    />
                  </div>
                  {f.combo.length > 1 && (
                    <Button type="button" variant="outline" onClick={() => mudar({ combo: f.combo.filter((_, j) => j !== i) })}>
                      Tirar<span className="sr-only"> o produto {i + 1} do combo</span>
                    </Button>
                  )}
                </div>
              ))}
              <Button type="button" variant="outline" size="sm" onClick={() => mudar({ combo: [...f.combo, { componenteProdutoId: '', quantidade: '1' }] })}>
                ＋ Produto do combo
              </Button>
            </div>
          )}
          {f.baixa === 'nada' && (
            <p className="rounded-md border border-warn/40 bg-warn/10 px-3 py-2">
              A venda pelo app <b>não</b> vai baixar estoque deste produto. Use só para o que não tem estoque (ex.: taxa, brinde).
            </p>
          )}
        </fieldset>

        {erro && (
          <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2">
            {erro}
          </p>
        )}
      </div>
    </Gaveta>
  );
}
