'use client';

import { useCallback, useEffect, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { api, getToken } from '@/lib/api';
import { Shell } from '@/components/app-shell/shell';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Ing = {
  insumoNome: string;
  quantidade: string;
  unidade: string;
  fatorCorrecao: string;
  custoUnitario: string;
  subFichaId?: string; // ingrediente = sub-receita (outra ficha)
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

function linhaVazia(): Ing {
  return { insumoNome: '', quantidade: '', unidade: '', fatorCorrecao: '1', custoUnitario: '' };
}

export default function FichasPage() {
  const [fichas, setFichas] = useState<any[]>([]);
  const [erro, setErro] = useState('');
  const [saving, setSaving] = useState(false);

  const [nome, setNome] = useState('');
  const [categoria, setCategoria] = useState('base');
  const [rendimento, setRendimento] = useState('10');
  const [rendUnidade, setRendUnidade] = useState('porções');
  const [precoVenda, setPrecoVenda] = useState('');
  const [ings, setIngs] = useState<Ing[]>([linhaVazia()]);

  const carregar = useCallback(async () => {
    try {
      setFichas(await api.get('/fichas'));
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao carregar');
    }
  }, []);

  useEffect(() => {
    if (getToken()) carregar();
  }, [carregar]);

  function setIng(idx: number, campo: keyof Ing, valor: string) {
    setIngs((arr) => arr.map((i, n) => (n === idx ? { ...i, [campo]: valor } : i)));
  }

  // Escolhe uma sub-receita para o ingrediente: puxa nome + custo/porção da ficha.
  function escolherSub(idx: number, fichaId: string) {
    setIngs((arr) =>
      arr.map((i, n) => {
        if (n !== idx) return i;
        if (!fichaId)
          return { ...i, subFichaId: undefined, insumoNome: '', custoUnitario: '' };
        const f = fichas.find((x) => x.id === fichaId);
        return {
          ...i,
          subFichaId: fichaId,
          insumoNome: f?.nome ?? 'Sub-receita',
          custoUnitario: String(f?.custoPorcao ?? 0),
        };
      }),
    );
  }

  const custoTotal = ings.reduce(
    (s, i) =>
      s +
      (Number(i.quantidade) || 0) *
        (Number(i.fatorCorrecao) || 1) *
        (Number(i.custoUnitario) || 0),
    0,
  );
  const rend = Number(rendimento) || 1;
  const custoPorcao = custoTotal / rend;
  const pv = Number(precoVenda) || 0;
  const cmv = pv > 0 ? (custoPorcao / pv) * 100 : null;
  const cmvOk = cmv != null && cmv <= META_CMV;
  // G5: preço sugerido pela meta de CMV + markup vs margem.
  const precoSugerido = custoPorcao > 0 ? custoPorcao / (META_CMV / 100) : null;
  const markup = pv > 0 && custoPorcao > 0 ? pv / custoPorcao : null;
  const margem = pv > 0 ? ((pv - custoPorcao) / pv) * 100 : null;

  async function salvar() {
    if (nome.trim().length < 2) {
      setErro('Informe o nome da ficha.');
      return;
    }
    setSaving(true);
    setErro('');
    try {
      await api.post('/fichas', {
        nome,
        categoria,
        rendimento: rend,
        rendimentoUnidade: rendUnidade || undefined,
        precoVenda: pv || undefined,
        ingredientes: ings
          .filter((i) => i.insumoNome.trim() || i.subFichaId)
          .map((i) => ({
            insumoNome: i.insumoNome,
            quantidade: Number(i.quantidade) || 0,
            unidade: i.unidade || undefined,
            fatorCorrecao: Number(i.fatorCorrecao) || 1,
            custoUnitario: Number(i.custoUnitario) || 0,
            subFichaId: i.subFichaId || undefined,
          })),
      });
      setNome('');
      setPrecoVenda('');
      setIngs([linhaVazia()]);
      await carregar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao salvar');
    } finally {
      setSaving(false);
    }
  }

  async function excluir(id: string) {
    await api.del(`/fichas/${id}`);
    carregar();
  }

  return (
    <Shell eyebrow="Produção" title="Fichas Técnicas">
      {erro && <p className="mb-4 text-destructive">{erro}</p>}

      <div className="grid gap-4 lg:grid-cols-[1.6fr_1fr]">
        {/* Formulário */}
        <Card className="p-5">
          <h2 className="mb-4 font-display text-lg font-bold">Nova ficha técnica</h2>
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
            <div className="grid grid-cols-2 gap-3">
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
              {ings.map((ing, idx) => (
                <div key={idx} className="space-y-2 rounded-lg border border-border p-2">
                  <div className="flex items-center gap-2">
                    <Select
                      aria-label="Tipo de insumo"
                      value={ing.subFichaId ?? ''}
                      onChange={(e) => escolherSub(idx, e.target.value)}
                      className="flex-1"
                    >
                      <option value="">Insumo avulso</option>
                      {fichas.map((f) => (
                        <option key={f.id} value={f.id}>
                          Sub-receita: {f.nome}
                        </option>
                      ))}
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
                    <Input placeholder="Insumo" value={ing.insumoNome} disabled={!!ing.subFichaId} onChange={(e) => setIng(idx, 'insumoNome', e.target.value)} />
                    <Input type="number" placeholder="Qtd" value={ing.quantidade} onChange={(e) => setIng(idx, 'quantidade', e.target.value)} />
                    <Input placeholder="un" value={ing.unidade} onChange={(e) => setIng(idx, 'unidade', e.target.value)} />
                    <Input type="number" placeholder="FC" value={ing.fatorCorrecao} onChange={(e) => setIng(idx, 'fatorCorrecao', e.target.value)} />
                    <Input type="number" placeholder="R$/un" value={ing.custoUnitario} disabled={!!ing.subFichaId} onChange={(e) => setIng(idx, 'custoUnitario', e.target.value)} />
                  </div>
                  {ing.subFichaId && (
                    <p className="text-xs text-muted-foreground">
                      🧩 Custo da sub-receita entra automático (por porção) e é recalculado ao produzir.
                    </p>
                  )}
                </div>
              ))}
            </div>
            <Button type="button" variant="outline" className="mt-2" onClick={() => setIngs((a) => [...a, linhaVazia()])}>
              <Plus className="h-4 w-4" /> Adicionar insumo
            </Button>
          </div>

          <Button className="mt-5 w-full" size="lg" disabled={saving} onClick={salvar}>
            {saving ? 'Salvando…' : 'Salvar ficha'}
          </Button>
        </Card>

        {/* Custo calculado */}
        <Card className="h-fit border-t-4 border-t-primary p-5">
          <h2 className="mb-3 font-display text-lg font-bold">Custo calculado</h2>
          <div className="space-y-2 text-sm">
            <Row label="Custo total dos insumos" value={brl(custoTotal)} />
            <Row label="Rendimento" value={`${rend} ${rendUnidade}`} />
            <Row label="Custo por porção" value={brl(custoPorcao)} strong />
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
          <p className="mt-3 text-xs text-muted-foreground">
            Meta de CMV: <strong>{META_CMV.toFixed(1).replace('.', ',')}%</strong>
          </p>

          {precoSugerido != null && (
            <div className="mt-3 rounded-lg border border-primary/40 bg-primary/5 p-3 text-center">
              <p className="font-display text-[10px] font-bold uppercase tracking-[.14em] text-muted-foreground">
                Preço sugerido (p/ meta {META_CMV.toFixed(1).replace('.', ',')}%)
              </p>
              <p className="font-mono text-2xl font-bold text-primary">
                {brl(precoSugerido)}
              </p>
            </div>
          )}

          {(markup != null || margem != null) && (
            <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
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
                <Button variant="ghost" size="icon" aria-label="Excluir" onClick={() => excluir(f.id)}>
                  <Trash2 className="h-4 w-4" />
                </Button>
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
