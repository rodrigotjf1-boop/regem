'use client';

import { useId, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { api } from '@/lib/api';
import { toast } from '@/lib/toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Gaveta } from '@/components/ui/sobreposto';
import { arredondarInformado, unidadesDoProduto } from '@/lib/conversao-unidade';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Opt = { id: string; nome: string };
type Conversao = { unidadeDe: string; fator: string; unidadePara: string };

const num = (n: number) => n.toLocaleString('pt-BR', { maximumFractionDigits: 3 });

/** "5 fardo = 60 unidade", quando o produto tem a conversão da unidade principal. */
export function equivalencia(
  quantidade: number,
  unidade: string,
  conversoes: { unidadeDe: string; fator: number | string; unidadePara: string }[],
): string {
  const c = conversoes.find((x) => x.unidadeDe === unidade && Number(x.fator) > 0 && x.unidadePara);
  return c && quantidade > 0 ? `${num(quantidade * Number(c.fator))} ${c.unidadePara}` : '';
}

// Lista de unidades de um campo: a lista fechada do servidor e, se o que está gravado não é
// dela (texto livre de antes), o valor antigo marcado — para a pessoa ver e trocar.
function OpcoesUnidade({ unidades, atual }: { unidades: string[]; atual: string }) {
  return (
    <>
      {atual && !unidades.includes(atual) && <option value={atual}>{atual} (antiga — escolha outra)</option>}
      {unidades.map((u) => (
        <option key={u} value={u}>{u}</option>
      ))}
    </>
  );
}

// Fichas de marcar (fornecedores, setores): a 1ª marcada é a principal.
function Fichas({ opcoes, marcados, alternar }: { opcoes: Opt[]; marcados: string[]; alternar: (id: string) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {opcoes.map((o) => {
        const on = marcados.includes(o.id);
        return (
          <button
            key={o.id}
            type="button"
            aria-pressed={on}
            onClick={() => alternar(o.id)}
            className={`min-h-10 rounded-full border px-3 py-1 text-sm font-semibold ${
              on ? 'border-primary bg-primary/15 text-foreground' : 'border-input bg-card text-secondary-foreground hover:border-secondary-foreground'
            }`}
          >
            {on ? '✓ ' : ''}{o.nome}{on && marcados[0] === o.id ? ' · principal' : ''}
          </button>
        );
      })}
    </div>
  );
}

// Cadastro de produto do estoque, numa gaveta lateral (a lista continua à vista): categoria,
// fornecedores e setores (um ou mais), unidade e conversões pela lista fechada, estoque mínimo
// com a equivalência, validade e etiquetas. Serve para criar e para editar.
export function ProdutoForm({
  item,
  categorias,
  fornecedores,
  setores,
  unidades,
  onSaved,
  onCancel,
  onReload,
  voltarPara,
}: {
  item?: any;
  categorias: Opt[];
  fornecedores: Opt[];
  setores: Opt[];
  unidades: string[];
  onSaved: () => void;
  onCancel: () => void;
  onReload: () => void;
  voltarPara?: string;
}) {
  const formId = useId();
  const [nome, setNome] = useState(item?.nome ?? '');
  const [categoriaItemId, setCategoriaItemId] = useState(item?.categoriaItemId ?? '');
  // Múltiplos fornecedores (N:N). Prefere a lista; cai no legado quando só há 1.
  const [fornecedorIds, setFornecedorIds] = useState<string[]>(
    Array.isArray(item?.fornecedorIds) && item.fornecedorIds.length
      ? item.fornecedorIds
      : item?.fornecedorId
        ? [item.fornecedorId]
        : [],
  );
  // Setores de estoque onde o produto fica guardado (um ou mais — mig 307).
  const [setorIds, setSetorIds] = useState<string[]>(
    Array.isArray(item?.setorIds) ? item.setorIds : item?.setorId ? [item.setorId] : [],
  );
  // Unidade gravada em texto livre ("L") abre já na da lista ("litro"); salvar corrige.
  const [unidade, setUnidade] = useState<string>(item?.unidadeLista ?? item?.unidadeMedida ?? 'unidade');
  const [estoqueMinimo, setEstoqueMinimo] = useState(
    item?.estoqueMinimo != null ? String(Number(item.estoqueMinimo)) : '',
  );
  // Validade opcional (seletor nativo). A data vem como yyyy-mm-dd do backend.
  const [validade, setValidade] = useState(item?.validade ? String(item.validade).slice(0, 10) : '');
  // Validade após aberto (dias) — ao abrir a etiqueta, se encurtar, reimprime (E2).
  const [validadeAbertoDias, setValidadeAbertoDias] = useState(
    item?.validadeAbertoDias != null ? String(item.validadeAbertoDias) : '',
  );
  // Imprimir etiquetas de validade ao salvar (RDC 216). Só faz sentido com validade.
  const [imprimirEtiq, setImprimirEtiq] = useState(false);
  const [qtdEtiq, setQtdEtiq] = useState('1');
  const [conversoes, setConversoes] = useState<Conversao[]>(
    (item?.conversoes ?? []).map((c: any) => ({
      unidadeDe: c.unidadeDeLista ?? c.unidadeDe,
      fator: String(c.fator),
      unidadePara: c.unidadeParaLista ?? c.unidadePara,
    })),
  );
  const [cats, setCats] = useState<Opt[]>(categorias);
  const [forns, setForns] = useState<Opt[]>(fornecedores);
  const [novaCat, setNovaCat] = useState('');
  const [novoForn, setNovoForn] = useState('');
  const [erro, setErro] = useState('');
  const [saving, setSaving] = useState(false);

  const alternar = (set: React.Dispatch<React.SetStateAction<string[]>>) => (id: string) =>
    set((l) => (l.includes(id) ? l.filter((x) => x !== id) : [...l, id]));

  async function criarCategoria() {
    if (!novaCat.trim()) return;
    try {
      const c: any = await api.criarEstoqueCategoria({ nome: novaCat.trim() });
      setCats((l) => [...l, { id: c.id, nome: c.nome }]);
      setCategoriaItemId(c.id);
      setNovaCat('');
      onReload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro ao criar categoria');
    }
  }
  async function criarFornecedor() {
    if (!novoForn.trim()) return;
    try {
      const f: any = await api.post('/fornecedores', { nome: novoForn.trim() });
      setForns((l) => [...l, { id: f.id, nome: f.nome }]);
      setFornecedorIds((l) => [...l, f.id]);
      setNovoForn('');
      onReload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro ao criar fornecedor');
    }
  }

  const setConv = (i: number, patch: Partial<Conversao>) =>
    setConversoes((cs) => cs.map((c, idx) => (idx === i ? { ...c, ...patch } : c)));

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    if (saving) return;
    setErro('');
    setSaving(true);
    const body = {
      nome: nome.trim(),
      unidadeMedida: unidade || undefined,
      estoqueMinimo: estoqueMinimo ? Number(estoqueMinimo) : undefined,
      validade: validade || undefined,
      validadeAbertoDias: validadeAbertoDias ? Number(validadeAbertoDias) : undefined,
      categoriaItemId: categoriaItemId || undefined,
      setorIds, // o 1º é o principal; lista vazia tira o produto de todos os setores
      fornecedorIds, // lista N:N (o backend deriva o principal do 1º)
      conversoes: conversoes
        .filter((c) => c.unidadeDe && c.unidadePara && Number(c.fator) > 0)
        .map((c) => ({
          unidadeDe: c.unidadeDe,
          fator: Number(c.fator),
          unidadePara: c.unidadePara,
        })),
    };
    try {
      const salvo: any = item?.id
        ? await api.atualizarItem(item.id, body)
        : await api.post('/estoque/itens', body);
      toast.success(item?.id ? 'Produto atualizado.' : 'Produto cadastrado.');
      // A conversão mudou e havia ficha usando a unidade convertida: o servidor refez a quantidade
      // gravada para a ficha continuar com o que foi informado ("2 unidade").
      if (Number(salvo?.fichasAjustadas) > 0)
        toast.success(`${salvo.fichasAjustadas} linha(s) de ficha técnica acompanharam a nova conversão.`);
      // Imprime as etiquetas de validade do produto, se pedido (best-effort).
      const produtoId = salvo?.id ?? item?.id;
      if (imprimirEtiq && validade && produtoId) {
        try {
          const r: any = await api.criarEtiqueta({
            itemId: produtoId,
            quantidade: Number(qtdEtiq) || 1,
            fabricacao: new Date().toISOString().slice(0, 10),
          });
          toast.success(`${r?.criadas ?? 1} etiqueta(s) enviada(s) à impressão.`);
        } catch (err) {
          toast.error(err instanceof Error ? err.message : 'Produto salvo, mas falhou ao imprimir etiquetas.');
        }
      }
      onSaved();
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Erro ao salvar');
    } finally {
      setSaving(false);
    }
  }

  const ajuda = 'text-xs text-secondary-foreground';
  const conta = equivalencia(Number(estoqueMinimo), unidade, conversoes);
  const fatorDaUnidade = conversoes.find((c) => c.unidadeDe === unidade && Number(c.fator) > 0);
  // Custo por unidade convertida (decisão do dono, 08/10/2026): o custo do cadastro é o da
  // unidade principal (o do fardo); com "1 fardo = 12 unidade", a unidade custa o do fardo ÷ 12.
  // Só aparece para quem recebe o custo do servidor (sem "ver valores em R$" ele não vem).
  const custoPrincipal = Number(item?.custoMedio);
  const custosConvertidos =
    custoPrincipal > 0
      ? unidadesDoProduto(unidade, conversoes)
          .filter((u) => u.fator !== 1)
          .map((u) => ({ unidade: u.unidade, custo: arredondarInformado(custoPrincipal * u.fator) }))
      : [];
  const reais = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: v < 1 ? 4 : 2 });

  return (
    <Gaveta
      titulo={item?.id ? 'Editar produto' : 'Novo produto'}
      aoFechar={onCancel}
      voltarPara={voltarPara}
      rodape={
        <>
          <Button type="button" variant="outline" onClick={onCancel}>Cancelar</Button>
          <Button type="submit" form={formId} disabled={saving || !nome.trim()}>
            {saving ? 'Salvando…' : item?.id ? 'Salvar alterações' : 'Cadastrar produto'}
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={salvar} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="nome">Nome do produto</Label>
          <Input id="nome" data-foco-inicial value={nome} onChange={(e) => setNome(e.target.value)} required placeholder="Ex.: Pão brioche" autoComplete="off" />
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="cat">Categoria</Label>
            <Select id="cat" value={categoriaItemId} onChange={(e) => setCategoriaItemId(e.target.value)}>
              <option value="">— sem categoria —</option>
              {cats.map((c) => (
                <option key={c.id} value={c.id}>{c.nome}</option>
              ))}
            </Select>
            <div className="flex gap-1.5">
              <Input value={novaCat} onChange={(e) => setNovaCat(e.target.value)} placeholder="＋ nova categoria" aria-label="Nome da nova categoria" className="text-sm"
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); criarCategoria(); } }} />
              <Button type="button" variant="outline" size="sm" onClick={criarCategoria}>Criar</Button>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="un">Unidade principal</Label>
            <Select id="un" value={unidade} onChange={(e) => setUnidade(e.target.value)} aria-describedby="un-ajuda">
              <OpcoesUnidade unidades={unidades} atual={unidade} />
            </Select>
            <p id="un-ajuda" className={ajuda}>
              {unidades.length ? 'É nela que o saldo e o estoque mínimo são contados.' : 'Não consegui carregar a lista de unidades. Recarregue a tela.'}
            </p>
          </div>
        </div>

        <div className="space-y-1.5">
          <Label>Fornecedores</Label>
          <p className={ajuda}>Marque um ou mais. O 1º marcado é o principal.</p>
          {forns.length === 0 ? (
            <p className={ajuda}>Nenhum fornecedor cadastrado ainda — crie abaixo.</p>
          ) : (
            <Fichas opcoes={forns} marcados={fornecedorIds} alternar={alternar(setFornecedorIds)} />
          )}
          <div className="flex gap-1.5">
            <Input value={novoForn} onChange={(e) => setNovoForn(e.target.value)} placeholder="＋ novo fornecedor" aria-label="Nome do novo fornecedor" className="text-sm"
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); criarFornecedor(); } }} />
            <Button type="button" variant="outline" size="sm" onClick={criarFornecedor}>Criar</Button>
          </div>
        </div>

        <div className="space-y-1.5">
          <Label>Setores de estoque</Label>
          <p className={ajuda}>Onde o produto fica guardado. Pode ser mais de um; o 1º marcado é o principal.</p>
          {setores.length === 0 ? (
            <p className={ajuda}>Nenhum setor cadastrado. Os setores são criados em Cadastros.</p>
          ) : (
            <Fichas opcoes={setores} marcados={setorIds} alternar={alternar(setSetorIds)} />
          )}
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="min">Estoque mínimo, em {unidade || 'unidade'}</Label>
            <Input id="min" type="number" min={0} step="any" inputMode="decimal" value={estoqueMinimo} onChange={(e) => setEstoqueMinimo(e.target.value)} placeholder="0"
              disabled={!!item?.minimoPorLoja} aria-describedby="min-ajuda" />
            <div id="min-ajuda" className="space-y-1">
              {conta && fatorDaUnidade && (
                <p className="rounded-md bg-info/10 px-2.5 py-1.5 text-sm font-semibold text-foreground">
                  Mínimo de {num(Number(estoqueMinimo))} {unidade} = {conta}
                  <span className="font-normal"> (1 {unidade} = {num(Number(fatorDaUnidade.fator))} {fatorDaUnidade.unidadePara})</span>
                </p>
              )}
              {item?.minimoPorLoja && (
                <p className={ajuda}>Soma das lojas. Cada loja tem o próprio mínimo — escolha a loja para editar.</p>
              )}
              {item?.minimoDaLoja && (
                <p className={ajuda}>
                  Mínimo desta loja.{item?.unidadeId == null ? ' Cadastro compartilhado: nesta loja só o estoque mínimo é salvo.' : ''}
                </p>
              )}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="valAb">Validade após aberto (dias)</Label>
            <Input id="valAb" type="number" min={0} inputMode="numeric" value={validadeAbertoDias} onChange={(e) => setValidadeAbertoDias(e.target.value)} placeholder="ex.: 3" aria-describedby="valAb-ajuda" />
            <p id="valAb-ajuda" className={ajuda}>Ao <b>abrir</b> a etiqueta, se a validade encurtar, reimprime automático. Vazio = abrir não muda.</p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="val">Data de validade (opcional)</Label>
            <Input id="val" type="date" value={validade} onChange={(e) => setValidade(e.target.value)} />
          </div>
        </div>

        {/* Impressão de etiquetas de validade (RDC 216) — só com validade cadastrada. */}
        {validade && (
          <div className="space-y-1.5 rounded-lg border border-border bg-secondary p-3">
            <label className="flex items-center gap-2 text-sm font-medium">
              <input
                type="checkbox"
                className="h-4 w-4 accent-primary"
                checked={imprimirEtiq}
                onChange={(e) => setImprimirEtiq(e.target.checked)}
              />
              Imprimir etiquetas de validade ao salvar
            </label>
            {imprimirEtiq && (
              <div className="flex flex-wrap items-end gap-2">
                <div className="space-y-1">
                  <Label htmlFor="qtdEtiq" className="text-xs">Quantidade de etiquetas</Label>
                  <Input id="qtdEtiq" type="number" min={1} max={50} value={qtdEtiq} onChange={(e) => setQtdEtiq(e.target.value)} className="w-28" />
                </div>
                <p className={ajuda}>Saem na impressora de etiquetas com a data de validade cadastrada.</p>
              </div>
            )}
          </div>
        )}

        {/* Conversões: as duas unidades vêm da lista, não são digitadas. */}
        <div className="space-y-2 border-t border-border pt-3">
          <div className="flex items-center justify-between gap-2">
            <Label>Conversões</Label>
            <Button type="button" size="sm" variant="outline"
              onClick={() => setConversoes((cs) => [...cs, { unidadeDe: unidade || 'fardo', fator: '', unidadePara: unidade === 'unidade' ? 'kg' : 'unidade' }])}>
              <Plus className="h-4 w-4" /> Conversão
            </Button>
          </div>
          <p className={ajuda}>Quanto cabe em cada embalagem. Ex.: 1 <b>fardo</b> = 12 <b>unidade</b>. As unidades são escolhidas na lista.</p>
          {conversoes.map((c, i) => (
            <div key={i} className="grid grid-cols-[auto_minmax(0,1fr)_auto_5rem_minmax(0,1fr)_auto] items-center gap-1.5 text-sm">
              <span>1</span>
              <Select value={c.unidadeDe} onChange={(e) => setConv(i, { unidadeDe: e.target.value })} aria-label={`Conversão ${i + 1}: embalagem`}>
                <OpcoesUnidade unidades={unidades} atual={c.unidadeDe} />
              </Select>
              <span>=</span>
              <Input type="number" min={0} step="any" inputMode="decimal" value={c.fator} onChange={(e) => setConv(i, { fator: e.target.value })} placeholder="12" aria-label={`Conversão ${i + 1}: quanto cabe`} />
              <Select value={c.unidadePara} onChange={(e) => setConv(i, { unidadePara: e.target.value })} aria-label={`Conversão ${i + 1}: unidade de dentro`}>
                <OpcoesUnidade unidades={unidades} atual={c.unidadePara} />
              </Select>
              <Button type="button" variant="ghost" size="icon" aria-label={`Remover a conversão ${i + 1}`}
                onClick={() => setConversoes((cs) => cs.filter((_, idx) => idx !== i))}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
          {custosConvertidos.length > 0 && (
            <p className={ajuda} role="status" id="produto-custo-convertido">
              Custo: <b>{reais(custoPrincipal)}</b> por {unidade}
              {custosConvertidos.map((c) => (
                <span key={c.unidade}> · <b>{reais(c.custo)}</b> por {c.unidade}</span>
              ))}
              . Na ficha técnica você escolhe em qual unidade informa a quantidade.
            </p>
          )}
        </div>

        {erro && <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm font-medium text-destructive">{erro}</p>}
      </form>
    </Gaveta>
  );
}
