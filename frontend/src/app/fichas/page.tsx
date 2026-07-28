'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Trash2, Pencil, Copy, ArrowLeft } from 'lucide-react';
import { api, getToken } from '@/lib/api';
import { toast } from '@/lib/toast';
import { Shell } from '@/components/app-shell/shell';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { SkeletonList } from '@/components/ui/skeleton';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Ing = {
  insumoNome: string;
  quantidade: string;
  unidade: string;
  fatorCorrecao: string;
  custoUnitario: string;
  itemId?: string; // ingrediente = insumo do Estoque (baixa na produção)
  subFichaId?: string; // ingrediente = sub-receita (outra ficha)
  somenteDelivery?: boolean; // linha de custo só contabilizada em pedido externo (delivery)
};

const CATEGORIAS = [
  { value: 'base', label: 'Base / pré-preparo' },
  { value: 'prato', label: 'Prato do cardápio' },
  { value: 'drink', label: 'Drink / coquetel' },
  { value: 'sobremesa', label: 'Sobremesa' },
];

const brl = (v: number) =>
  v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const META_CMV = 31.5;

function linhaVazia(somenteDelivery = false): Ing {
  return { insumoNome: '', quantidade: '', unidade: '', fatorCorrecao: '1', custoUnitario: '', somenteDelivery };
}

export default function FichasPage() {
  const router = useRouter();
  const [fichas, setFichas] = useState<any[]>([]);
  const [insumos, setInsumos] = useState<any[]>([]);
  const [erro, setErro] = useState('');
  const [saving, setSaving] = useState(false);

  const [nome, setNome] = useState('');
  const [categoria, setCategoria] = useState('base');
  const [rendimento, setRendimento] = useState('10');
  const [rendUnidade, setRendUnidade] = useState('porções');
  const [precoVenda, setPrecoVenda] = useState('');
  const [metaCmvInput, setMetaCmvInput] = useState(String(META_CMV));
  const [ings, setIngs] = useState<Ing[]>([linhaVazia()]);
  const [editId, setEditId] = useState<string | null>(null);
  const [carregou, setCarregou] = useState(false);
  const [acAberto, setAcAberto] = useState<number | null>(null); // linha com autocomplete aberto

  const carregar = useCallback(async () => {
    try {
      const [fs, ins] = await Promise.all([api.get('/fichas'), api.estoqueItens()]);
      setFichas(fs);
      setInsumos(ins as any[]);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao carregar');
    } finally {
      setCarregou(true);
    }
  }, []);

  useEffect(() => {
    if (getToken()) carregar();
  }, [carregar]);

  function setIng(idx: number, campo: keyof Ing, valor: string) {
    setIngs((arr) => arr.map((i, n) => (n === idx ? { ...i, [campo]: valor } : i)));
  }

  // Tipo do ingrediente: '' = avulso · 'item:<id>' = insumo do Estoque
  // (baixa na produção, custo automático) · 'sub:<id>' = sub-receita.
  function escolherTipo(idx: number, value: string) {
    setIngs((arr) =>
      arr.map((i, n) => {
        if (n !== idx) return i;
        if (value.startsWith('item:')) {
          const item = insumos.find((x) => x.id === value.slice(5));
          return {
            ...i,
            itemId: item?.id,
            subFichaId: undefined,
            insumoNome: item?.nome ?? '',
            unidade: item?.unidadeMedida ?? i.unidade,
            custoUnitario: String(item?.custoMedio ?? 0),
          };
        }
        if (value.startsWith('sub:')) {
          const f = fichas.find((x) => x.id === value.slice(4));
          return {
            ...i,
            subFichaId: f?.id,
            itemId: undefined,
            insumoNome: f?.nome ?? 'Sub-receita',
            custoUnitario: String(f?.custoPorcao ?? 0),
          };
        }
        return { ...i, itemId: undefined, subFichaId: undefined, insumoNome: '', custoUnitario: '' };
      }),
    );
  }

  const custoLinha = (i: Ing) =>
    (Number(i.quantidade) || 0) * (Number(i.fatorCorrecao) || 1) * (Number(i.custoUnitario) || 0);
  // Balcão = linhas normais; delivery = balcão + linhas somente_delivery (embalagens).
  const custoTotal = ings.filter((i) => !i.somenteDelivery).reduce((s, i) => s + custoLinha(i), 0);
  const custoDeliveryExtra = ings.filter((i) => i.somenteDelivery).reduce((s, i) => s + custoLinha(i), 0);
  const custoTotalDelivery = custoTotal + custoDeliveryExtra;
  const temDelivery = ings.some((i) => i.somenteDelivery);
  const rend = Number(rendimento) || 1;
  const custoPorcao = custoTotal / rend;
  const custoPorcaoDelivery = custoTotalDelivery / rend;
  const pv = Number(precoVenda) || 0;
  const meta = Number(metaCmvInput) || META_CMV;
  const cmv = pv > 0 ? (custoPorcao / pv) * 100 : null;
  const cmvDelivery = pv > 0 ? (custoPorcaoDelivery / pv) * 100 : null;
  const cmvOk = cmv != null && cmv <= meta;
  const cmvDeliveryOk = cmvDelivery != null && cmvDelivery <= meta;
  // G5: preço sugerido pela meta de CMV + markup vs margem (base balcão).
  const precoSugerido = custoPorcao > 0 ? custoPorcao / (meta / 100) : null;
  const markup = pv > 0 && custoPorcao > 0 ? pv / custoPorcao : null;
  const margem = pv > 0 ? ((pv - custoPorcao) / pv) * 100 : null;

  function resetForm() {
    setEditId(null);
    setNome('');
    setCategoria('base');
    setRendimento('10');
    setRendUnidade('porções');
    setPrecoVenda('');
    setMetaCmvInput(String(META_CMV));
    setIngs([linhaVazia()]);
  }

  function editar(f: any) {
    setEditId(f.id);
    setNome(f.nome ?? '');
    setCategoria(f.categoria ?? 'base');
    setRendimento(String(f.rendimento ?? 1));
    setRendUnidade(f.rendimentoUnidade ?? 'porções');
    setPrecoVenda(f.precoVenda != null ? String(f.precoVenda) : '');
    setMetaCmvInput(String(f.metaCmv ?? META_CMV));
    setIngs(
      (f.ingredientes ?? []).length
        ? f.ingredientes.map((i: any) => ({
            insumoNome: i.insumoNome ?? '',
            quantidade: String(i.quantidade ?? ''),
            unidade: i.unidade ?? '',
            fatorCorrecao: String(i.fatorCorrecao ?? '1'),
            custoUnitario: String(i.custoUnitario ?? ''),
            itemId: i.itemId ?? undefined,
            subFichaId: i.subFichaId ?? undefined,
            somenteDelivery: !!i.somenteDelivery,
          }))
        : [linhaVazia()],
    );
    if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function salvar() {
    if (nome.trim().length < 2) {
      setErro('Informe o nome da ficha.');
      return;
    }
    setSaving(true);
    setErro('');
    const body = {
      nome,
      categoria,
      rendimento: rend,
      rendimentoUnidade: rendUnidade || undefined,
      precoVenda: pv || undefined,
      metaCmv: meta,
      ingredientes: ings
        .filter((i) => i.insumoNome.trim() || i.subFichaId || i.itemId)
        .map((i) => ({
          insumoNome: i.insumoNome,
          quantidade: Number(i.quantidade) || 0,
          unidade: i.unidade || undefined,
          fatorCorrecao: Number(i.fatorCorrecao) || 1,
          custoUnitario: Number(i.custoUnitario) || 0,
          itemId: i.itemId || undefined,
          subFichaId: i.subFichaId || undefined,
          somenteDelivery: !!i.somenteDelivery,
        })),
    };
    try {
      if (editId) await api.patch(`/fichas/${editId}`, body);
      else await api.post('/fichas', body);
      toast.success(editId ? 'Ficha atualizada.' : 'Ficha salva.');
      resetForm();
      await carregar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao salvar');
    } finally {
      setSaving(false);
    }
  }

  // Duplicar: carrega a ficha no formulário como NOVA (editId=null) com o sufixo
  // "(cópia)" no nome — o usuário revisa/ajusta e salva. Reaproveita o `editar`.
  function duplicar(f: any) {
    editar(f);
    setEditId(null);
    setNome(`${f.nome ?? 'Ficha'} (cópia)`.trim());
  }

  async function excluir(id: string) {
    if (editId === id) resetForm();
    await api.del(`/fichas/${id}`);
    carregar();
  }

  // Uma linha de insumo (usada tanto na seção balcão quanto na de delivery). O
  // `idx` é o índice REAL em `ings` — os handlers operam sobre o array inteiro.
  const renderLinha = (ing: Ing, idx: number) => (
    <div key={idx} className="space-y-2 rounded-lg border border-border p-2">
      <div className="flex items-center gap-2">
        <Select
          aria-label="Tipo de insumo"
          value={ing.itemId ? `item:${ing.itemId}` : ing.subFichaId ? `sub:${ing.subFichaId}` : ''}
          onChange={(e) => escolherTipo(idx, e.target.value)}
          className="flex-1"
        >
          <option value="">Insumo avulso (texto)</option>
          {insumos.length > 0 && (
            <optgroup label="Insumo do estoque">
              {insumos.map((it) => (
                <option key={it.id} value={`item:${it.id}`}>{it.nome}</option>
              ))}
            </optgroup>
          )}
          {fichas.length > 0 && (
            <optgroup label="Sub-receita">
              {fichas.map((f) => (
                <option key={f.id} value={`sub:${f.id}`}>{f.nome}</option>
              ))}
            </optgroup>
          )}
        </Select>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Remover"
          onClick={() => setIngs((a) => (a.length > 1 ? a.filter((_, n) => n !== idx) : a))}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-[1.6fr_.8fr_.7fr_.7fr_1fr]">
        {/* Autocomplete: ao digitar, filtra os insumos do estoque; escolher um
            vincula o item (baixa estoque) e puxa o custo médio automaticamente. */}
        <div className="relative">
          <Input
            placeholder="Insumo (digite p/ buscar)"
            value={ing.insumoNome}
            disabled={!!ing.subFichaId || !!ing.itemId}
            autoComplete="off"
            onChange={(e) => { setIng(idx, 'insumoNome', e.target.value); setAcAberto(idx); }}
            onFocus={() => setAcAberto(idx)}
            onBlur={() => setTimeout(() => setAcAberto((v) => (v === idx ? null : v)), 150)}
          />
          {acAberto === idx && !ing.itemId && !ing.subFichaId && ing.insumoNome.trim().length >= 1 && (() => {
            const q = ing.insumoNome.trim().toLowerCase();
            const matches = insumos.filter((it) => (it.nome ?? '').toLowerCase().includes(q)).slice(0, 8);
            if (!matches.length) return null;
            return (
              <ul className="absolute left-0 right-0 top-full z-20 mt-1 max-h-56 overflow-auto rounded-lg border border-border bg-card shadow-lg">
                {matches.map((it) => (
                  <li key={it.id}>
                    <button
                      type="button"
                      className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-primary/5"
                      onMouseDown={(e) => { e.preventDefault(); escolherTipo(idx, `item:${it.id}`); setAcAberto(null); }}
                    >
                      <span className="truncate">{it.nome}</span>
                      <span className="flex-none font-mono text-xs text-muted-foreground">{brl(Number(it.custoMedio ?? 0))}/{it.unidadeMedida ?? 'un'}</span>
                    </button>
                  </li>
                ))}
              </ul>
            );
          })()}
        </div>
        <Input type="number" placeholder="Qtd" value={ing.quantidade} onChange={(e) => setIng(idx, 'quantidade', e.target.value)} />
        <Input placeholder="un" value={ing.unidade} disabled={!!ing.itemId} onChange={(e) => setIng(idx, 'unidade', e.target.value)} />
        <Input type="number" placeholder="FC" value={ing.fatorCorrecao} onChange={(e) => setIng(idx, 'fatorCorrecao', e.target.value)} />
        <Input type="number" placeholder="R$/un" value={ing.custoUnitario} disabled={!!ing.subFichaId || !!ing.itemId} onChange={(e) => setIng(idx, 'custoUnitario', e.target.value)} />
      </div>
      {ing.itemId && (
        <p className="text-xs text-muted-foreground">
          📦 Insumo do estoque — custo pelo custo médio; <b>baixa o estoque</b> ao produzir.
        </p>
      )}
      {ing.subFichaId && (
        <p className="text-xs text-muted-foreground">
          🧩 Custo da sub-receita entra automático (por porção) e é recalculado ao produzir.
        </p>
      )}
    </div>
  );

  return (
    <Shell
      eyebrow="Estoque · produção"
      title="Fichas Técnicas"
      actions={
        <Button size="sm" variant="outline" onClick={() => router.push('/operacao')}>
          <ArrowLeft className="h-4 w-4" /> Estoque
        </Button>
      }
    >
      {erro && <p className="mb-4 text-destructive">{erro}</p>}

      <div className="grid gap-4 lg:grid-cols-[1.6fr_1fr]">
        {/* Formulário */}
        <Card className="p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-display text-lg font-bold">
              {editId ? 'Editar ficha técnica' : 'Nova ficha técnica'}
            </h2>
            {editId && (
              <Button type="button" variant="outline" size="sm" onClick={resetForm}>
                Cancelar edição
              </Button>
            )}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="nome">Nome da receita / produção</Label>
              <Input id="nome" value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Ex.: Molho base de tomate" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cat">Categoria</Label>
              <Select id="cat" value={categoria} onChange={(e) => setCategoria(e.target.value)}>
                {CATEGORIAS.map((c) => (
                  <option key={c.value} value={c.value}>{c.label}</option>
                ))}
              </Select>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="rend">Rendimento</Label>
                <Input id="rend" type="number" value={rendimento} onChange={(e) => setRendimento(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ru">Unidade</Label>
                <Input id="ru" value={rendUnidade} onChange={(e) => setRendUnidade(e.target.value)} placeholder="porções" />
              </div>
            </div>
          </div>

          <div className="mt-5">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="font-display text-sm font-bold">Ingredientes e custo</h3>
              <span className="font-mono text-xs text-muted-foreground">FC = fator de correção</span>
            </div>
            <div className="space-y-2">
              {ings.map((ing, idx) => (ing.somenteDelivery ? null : renderLinha(ing, idx)))}
            </div>
            <Button type="button" variant="outline" className="mt-2" onClick={() => setIngs((a) => [...a, linhaVazia(false)])}>
              <Plus className="h-4 w-4" /> Adicionar insumo
            </Button>
          </div>

          {/* Custos delivery — insumos/itens (ex.: embalagens) contabilizados SÓ em
              pedido externo (cardápio digital próprio/integrado + marketplaces). */}
          <div className="mt-5 rounded-xl border border-dashed border-info/40 bg-info/5 p-3">
            <div className="mb-1 flex items-center justify-between">
              <h3 className="font-display text-sm font-bold">🛵 Custos delivery</h3>
              <span className="font-mono text-[10px] text-muted-foreground">só em pedido externo</span>
            </div>
            <p className="mb-2 text-xs text-muted-foreground">
              Embalagens e itens que só entram no custo de pedidos de delivery/retirada externa (iFood, 99food, cardápio digital). O balcão/mesa não conta esses.
            </p>
            <div className="space-y-2">
              {ings.map((ing, idx) => (ing.somenteDelivery ? renderLinha(ing, idx) : null))}
              {!temDelivery && (
                <p className="py-1 text-xs text-muted-foreground">Nenhum custo de delivery. Adicione a embalagem, por exemplo.</p>
              )}
            </div>
            <Button type="button" variant="outline" className="mt-2" onClick={() => setIngs((a) => [...a, linhaVazia(true)])}>
              <Plus className="h-4 w-4" /> Adicionar custo de delivery
            </Button>
          </div>

          <Button className="mt-5 w-full" size="lg" disabled={saving} onClick={salvar}>
            {saving ? 'Salvando…' : editId ? 'Salvar alterações' : 'Salvar ficha'}
          </Button>
        </Card>

        {/* Custo calculado */}
        <Card className="h-fit border-t-4 border-t-primary p-5">
          <h2 className="mb-3 font-display text-lg font-bold">Custo calculado</h2>
          <div className="space-y-2 text-sm">
            <Row label="Custo total dos insumos" value={brl(custoTotal)} />
            <Row label="Rendimento" value={`${rend} ${rendUnidade}`} />
            <Row label={temDelivery ? 'Custo por porção (balcão)' : 'Custo por porção'} value={brl(custoPorcao)} strong />
            {temDelivery && (
              <>
                <Row label="+ Custos delivery" value={brl(custoDeliveryExtra)} />
                <Row label="Custo por porção (delivery)" value={brl(custoPorcaoDelivery)} strong />
              </>
            )}
          </div>
          <div className="mt-4 space-y-1.5">
            <Label htmlFor="pv">Preço de venda (R$)</Label>
            <Input id="pv" type="number" value={precoVenda} onChange={(e) => setPrecoVenda(e.target.value)} placeholder="0,00" />
          </div>
          <div className="mt-4 rounded-lg bg-secondary p-4 text-center">
            <p className="font-display text-[10px] font-bold uppercase tracking-[.14em] text-muted-foreground">
              CMV do item
            </p>
            <p
              className="font-mono text-3xl font-bold"
              style={{ color: cmv == null ? undefined : cmvOk ? 'hsl(var(--ok))' : 'hsl(var(--destructive))' }}
            >
              {cmv == null ? '—' : `${cmv.toFixed(1).replace('.', ',')}%`}
            </p>
            <span
              className="mt-1 inline-block rounded-md px-2 py-0.5 text-[11px] font-bold"
              style={{
                background: cmv == null ? 'hsl(var(--muted))' : cmvOk ? 'hsl(var(--ok)/.15)' : 'hsl(var(--destructive)/.12)',
                color: cmv == null ? 'hsl(var(--muted-foreground))' : cmvOk ? 'hsl(var(--ok))' : 'hsl(var(--destructive))',
              }}
            >
              {cmv == null ? 'Informe o preço' : cmvOk ? 'Dentro da meta' : 'Acima da meta'}
            </span>
          </div>
          <div className="mt-3 flex items-center justify-between gap-2">
            <Label htmlFor="meta" className="text-xs text-muted-foreground">Meta de CMV (%)</Label>
            <Input id="meta" type="number" value={metaCmvInput} onChange={(e) => setMetaCmvInput(e.target.value)} className="h-8 w-24" />
          </div>

          {temDelivery && (
            <div className="mt-2 flex items-center justify-between rounded-lg border border-info/30 bg-info/5 px-3 py-2">
              <span className="text-xs text-muted-foreground">CMV delivery (com embalagem)</span>
              <span
                className="font-mono text-sm font-bold"
                style={{ color: cmvDelivery == null ? undefined : cmvDeliveryOk ? 'hsl(var(--ok))' : 'hsl(var(--destructive))' }}
              >
                {cmvDelivery == null ? '—' : `${cmvDelivery.toFixed(1).replace('.', ',')}%`}
              </span>
            </div>
          )}

          {precoSugerido != null && (
            <div className="mt-3 rounded-lg border border-primary/40 bg-primary/5 p-3 text-center">
              <p className="font-display text-[10px] font-bold uppercase tracking-[.14em] text-muted-foreground">
                Preço sugerido (p/ meta {meta.toFixed(1).replace('.', ',')}%)
              </p>
              <p className="font-mono text-2xl font-bold text-primary">
                {brl(precoSugerido)}
              </p>
            </div>
          )}

          {(markup != null || margem != null) && (
            <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
              <Row
                label="Markup (preço÷custo)"
                value={markup != null ? `${markup.toFixed(2).replace('.', ',')}×` : '—'}
              />
              <Row
                label="Margem (lucro÷preço)"
                value={margem != null ? `${margem.toFixed(1).replace('.', ',')}%` : '—'}
              />
            </div>
          )}
        </Card>
      </div>

      {/* Fichas cadastradas */}
      <h2 className="mb-3 mt-8 font-display text-sm font-bold uppercase tracking-wide text-muted-foreground">
        Fichas cadastradas ({fichas.length})
      </h2>
      {!carregou ? (
        <SkeletonList rows={3} />
      ) : (
      <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-3">
        {fichas.length === 0 && (
          <p className="text-sm text-muted-foreground">Nenhuma ficha ainda.</p>
        )}
        {fichas.map((f) => {
          const ok = f.cmv != null && f.cmv <= Number(f.metaCmv ?? META_CMV);
          return (
            <Card key={f.id} className="p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate font-semibold">{f.nome}</p>
                  <p className="text-xs capitalize text-muted-foreground">
                    {f.categoria}
                    {f.ingredientes?.some((i: any) => i.subFichaId) && (
                      <span className="ml-1.5 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium normal-case text-muted-foreground">
                        🧩 usa sub-receita
                      </span>
                    )}
                  </p>
                </div>
                <div className="flex flex-none gap-0.5">
                  <Button variant="ghost" size="icon" aria-label="Duplicar" title="Duplicar ficha" onClick={() => duplicar(f)}>
                    <Copy className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="icon" aria-label="Editar" onClick={() => editar(f)}>
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="icon" aria-label="Excluir" className="text-destructive" onClick={() => excluir(f.id)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
              <div className="mt-3 flex items-center justify-between">
                <span className="text-xs text-muted-foreground">
                  {brl(Number(f.custoPorcao ?? 0))} / porção
                </span>
                <span
                  className="rounded-md px-2 py-0.5 font-mono text-xs font-bold"
                  style={{
                    background: f.cmv == null ? 'hsl(var(--muted))' : ok ? 'hsl(var(--ok)/.15)' : 'hsl(var(--destructive)/.12)',
                    color: f.cmv == null ? 'hsl(var(--muted-foreground))' : ok ? 'hsl(var(--ok))' : 'hsl(var(--destructive))',
                  }}
                >
                  {f.cmv == null ? 'sem preço' : `CMV ${String(f.cmv).replace('.', ',')}%`}
                </span>
              </div>
            </Card>
          );
        })}
      </div>
      )}
    </Shell>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between border-b border-border pb-2">
      <span className="text-muted-foreground">{label}</span>
      <span className={`font-mono ${strong ? 'text-base font-bold text-primary' : 'font-semibold'}`}>
        {value}
      </span>
    </div>
  );
}
