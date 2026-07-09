'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Pencil, ArrowRight } from 'lucide-react';
import { api, getToken, getCategoria } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { SkeletonList } from '@/components/ui/skeleton';
import { EntityForm, type FieldDef } from '@/components/cadastros/entity-form';
import { InsumoForm } from '@/components/estoque/insumo-form';
import { PainelSecao } from '@/components/estoque/painel-secao';
import { ContagemSecao } from '@/components/estoque/contagem-secao';
import { ComprasSecao } from '@/components/estoque/compras-secao';
import { RecebimentoForm } from '@/components/recebimento/recebimento-form';
import { Shell } from '@/components/app-shell/shell';

/* eslint-disable @typescript-eslint/no-explicit-any */
function validadeStatus(validade: string | null) {
  if (!validade) return { label: 'sem validade', cls: 'bg-secondary text-muted-foreground' };
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  const v = new Date(`${validade}T00:00:00`);
  const dias = Math.round((v.getTime() - hoje.getTime()) / 86400000);
  const dm = v.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
  if (dias < 0)
    return { label: `vencido há ${Math.abs(dias)}d`, cls: 'bg-destructive/10 text-destructive' };
  if (dias === 0) return { label: 'vence hoje', cls: 'bg-destructive/10 text-destructive' };
  if (dias <= 7) return { label: `vence em ${dias}d (${dm})`, cls: 'bg-warn/10 text-warn' };
  return { label: dm, cls: 'bg-ok/10 text-ok' };
}

const brl = (n: number) =>
  Number(n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

type Secao =
  | 'painel'
  | 'insumos'
  | 'contagem'
  | 'compras'
  | 'recebimento'
  | 'validades'
  | 'desperdicio'
  | 'vistorias';

const SECOES: { key: Secao; label: string }[] = [
  { key: 'painel', label: '📊 Painel' },
  { key: 'insumos', label: '📦 Insumos' },
  { key: 'contagem', label: '🧮 Contagem' },
  { key: 'compras', label: '🛒 Compras' },
  { key: 'recebimento', label: '🚚 Recebimento' },
  { key: 'validades', label: '🗓️ Validades' },
  { key: 'desperdicio', label: '♻️ Desperdício' },
  { key: 'vistorias', label: '✔️ Vistorias' },
];

export default function EstoquePage() {
  const router = useRouter();
  const [secao, setSecao] = useState<Secao>('painel');
  const [itens, setItens] = useState<any[]>([]);
  const [categorias, setCategorias] = useState<any[]>([]);
  const [fornecedores, setFornecedores] = useState<any[]>([]);
  const [desperdicios, setDesperdicios] = useState<any[]>([]);
  const [vistorias, setVistorias] = useState<any[]>([]);
  const [recebimentos, setRecebimentos] = useState<any[]>([]);
  const [lotes, setLotes] = useState<any[]>([]);
  const [showReceb, setShowReceb] = useState(false);
  const [novoInsumo, setNovoInsumo] = useState(false);
  const [editItem, setEditItem] = useState<any>(null);
  const [movItem, setMovItem] = useState(false);
  const [pronto, setPronto] = useState(false);
  const [erro, setErro] = useState('');
  const [ver, setVer] = useState(0);

  const reload = useCallback(async () => {
    try {
      const [it, ca, fo, de, vi, re, lo] = await Promise.all([
        api.get('/estoque/itens'),
        api.estoqueCategorias(),
        api.fornecedores(),
        api.get('/desperdicios'),
        api.get('/vistorias'),
        api.recebimentos(),
        api.lotes(),
      ]);
      setItens(it);
      setCategorias(ca);
      setFornecedores(fo);
      setDesperdicios(de);
      setVistorias(vi);
      setRecebimentos(re);
      setLotes(lo);
      setVer((v) => v + 1);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao carregar');
    } finally {
      setPronto(true);
    }
  }, []);

  async function confirmarRecebimento(id: string) {
    setErro('');
    try {
      await api.confirmarRecebimento(id);
      await reload();
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao confirmar');
    }
  }

  useEffect(() => {
    if (!getToken()) {
      router.replace('/entrar');
      return;
    }
    reload();
  }, [reload, router]);

  if (!pronto) {
    return (
      <Shell eyebrow="Insumos & produção" title="Estoque">
        <div className="max-w-3xl">
          <SkeletonList rows={6} />
        </div>
      </Shell>
    );
  }

  const optCat: { id: string; nome: string }[] = categorias.map((c: any) => ({ id: c.id, nome: c.nome }));
  const optForn: { id: string; nome: string }[] = fornecedores.map((f: any) => ({ id: f.id, nome: f.nome }));
  const optItens = itens.map((i: any) => ({ value: i.id, label: `${i.nome} (${i.saldo} ${i.unidadeMedida})` }));
  const hoje = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
  const TIPO_MOV = [
    { value: 'entrada', label: 'Entrada' },
    { value: 'saida', label: 'Saída' },
    { value: 'ajuste', label: 'Ajuste' },
  ];
  const TIPO_VIST = [
    { value: 'abertura', label: 'Abertura' },
    { value: 'fechamento', label: 'Fechamento' },
    { value: 'padrao', label: 'Padrão' },
  ];

  const verFin = getCategoria() === 'presidente'; // valor do estoque (R$) só p/ presidente
  const valorTotal = itens.reduce((s, i) => s + Number(i.valorEstoque ?? 0), 0);

  return (
    <Shell
      eyebrow="Insumos & produção"
      title="Estoque"
      actions={
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => router.push('/fichas')}>
            🧾 Fichas técnicas
          </Button>
          {/* Inteligência de estoque = motor de custo (financeiro) → só presidente/C&O */}
          {verFin && (
            <Button size="sm" variant="outline" onClick={() => router.push('/estoque')}>
              Inteligência <ArrowRight className="h-4 w-4" />
            </Button>
          )}
        </div>
      }
    >
      <div className="max-w-3xl space-y-4">
        {/* Navegação por seção (hub) */}
        <div className="flex flex-wrap gap-1.5">
          {SECOES.map((s) => (
            <button
              key={s.key}
              type="button"
              onClick={() => setSecao(s.key)}
              aria-pressed={secao === s.key ? 'true' : 'false'}
              className={`rounded-md border px-3 py-1.5 text-sm font-medium ${
                secao === s.key
                  ? 'border-primary bg-primary/15 text-primary'
                  : 'border-border text-muted-foreground hover:border-primary/50'
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>

        {erro && <p role="alert" className="text-destructive">{erro}</p>}

        {/* ---------- PAINEL (E4) ---------- */}
        {secao === 'painel' && <PainelSecao itens={itens} />}

        {/* ---------- INSUMOS ---------- */}
        {secao === 'insumos' && (
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="font-display font-semibold">Insumos</h2>
                <p className="text-xs text-muted-foreground">
                  {itens.length} itens{verFin ? ` · valor em estoque ${brl(valorTotal)}` : ''}
                </p>
              </div>
              {!novoInsumo && !editItem && (
                <Button size="sm" onClick={() => setNovoInsumo(true)}>
                  <Plus className="h-4 w-4" /> Novo insumo
                </Button>
              )}
            </div>

            {(novoInsumo || editItem) && (
              <InsumoForm
                item={editItem ?? undefined}
                categorias={optCat}
                fornecedores={optForn}
                onCancel={() => { setNovoInsumo(false); setEditItem(null); }}
                onReload={reload}
                onSaved={() => { setNovoInsumo(false); setEditItem(null); reload(); }}
              />
            )}

            {/* Registrar movimento */}
            {optItens.length > 0 && (
              <Card className="p-4">
                <button type="button" className="mb-2 text-sm font-medium text-primary hover:underline"
                  onClick={() => setMovItem((v) => !v)}>
                  {movItem ? 'Fechar movimento' : '↕ Registrar movimento (entrada/saída/ajuste)'}
                </button>
                {movItem && (
                  <EntityForm
                    key={`mov-${ver}`}
                    submitLabel="Registrar movimento"
                    fields={[
                      { name: 'itemId', label: 'Item', type: 'select', required: true, options: optItens, defaultValue: optItens[0]?.value },
                      { name: 'tipo', label: 'Tipo', type: 'select', options: TIPO_MOV, defaultValue: 'entrada' },
                      { name: 'quantidade', label: 'Quantidade', type: 'text', required: true, placeholder: '0' },
                      { name: 'data', label: 'Data', type: 'date', defaultValue: hoje },
                    ] as FieldDef[]}
                    onSubmit={async (v) => {
                      await api.post('/estoque/movimentos', { itemId: v.itemId, tipo: v.tipo, quantidade: Number(v.quantidade), data: v.data || undefined });
                      await reload();
                    }}
                  />
                )}
              </Card>
            )}

            {itens.length === 0 && !novoInsumo && (
              <Card className="p-6 text-center text-sm text-muted-foreground">
                Nenhum insumo cadastrado. Cadastre os produtos de ficha técnica, embalagens e limpeza.
              </Card>
            )}
            {itens.map((i: any) => {
              const abaixo = Number(i.saldo) < Number(i.estoqueMinimo);
              return (
                <Card key={i.id} className="flex items-center justify-between gap-3 p-4">
                  <div className="min-w-0">
                    <p className="flex items-center gap-1.5 font-medium">
                      {i.categoriaCor && (
                        <span className="h-2.5 w-2.5 flex-none rounded-full" style={{ background: i.categoriaCor }} />
                      )}
                      {i.nome}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {i.categoriaNome ? `${i.categoriaNome} · ` : ''}
                      {i.fornecedorNome ? `${i.fornecedorNome} · ` : ''}
                      mín. {i.estoqueMinimo} {i.unidadeMedida}
                      {Number(i.custoMedio) > 0 ? ` · custo méd. ${brl(Number(i.custoMedio))}` : ''}
                      {i.conversoes?.length ? ` · ${i.conversoes.length} conversão(ões)` : ''}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="text-right">
                      <Badge className={abaixo ? 'bg-destructive/10 text-destructive' : 'bg-ok/10 text-ok'}>
                        {i.saldo} {i.unidadeMedida}
                      </Badge>
                      {Number(i.valorEstoque) > 0 && (
                        <p className="mt-1 font-mono text-xs text-muted-foreground">{brl(Number(i.valorEstoque))}</p>
                      )}
                    </div>
                    <Button type="button" variant="ghost" size="icon" aria-label="Editar insumo"
                      onClick={() => { setEditItem(i); setNovoInsumo(false); }}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                  </div>
                </Card>
              );
            })}
          </section>
        )}

        {/* ---------- CONTAGEM (E2) ---------- */}
        {secao === 'contagem' && <ContagemSecao itens={itens} />}

        {/* ---------- COMPRAS (E3) ---------- */}
        {secao === 'compras' && <ComprasSecao itens={itens} fornecedores={fornecedores} />}

        {/* ---------- RECEBIMENTO ---------- */}
        {secao === 'recebimento' && (
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="font-display font-semibold">Recebimento</h2>
              <Button size="sm" onClick={() => setShowReceb((v) => !v)}>
                {showReceb ? 'Fechar' : (<><Plus className="h-4 w-4" /> Novo recebimento</>)}
              </Button>
            </div>
            {showReceb && (
              <RecebimentoForm
                fornecedores={fornecedores}
                itens={itens}
                onCancel={() => setShowReceb(false)}
                onCreated={() => { setShowReceb(false); reload(); }}
              />
            )}
            {recebimentos.length === 0 && !showReceb && (
              <Card className="p-6 text-center text-sm text-muted-foreground">Nenhum recebimento registrado.</Card>
            )}
            {recebimentos.map((r: any) => (
              <Card key={r.id} className="flex items-center justify-between gap-3 p-4">
                <div className="min-w-0">
                  <p className="font-medium">
                    {r.fornecedorNome ?? 'Sem fornecedor'}{' '}
                    <span className="text-xs font-normal text-muted-foreground">· {r.data}</span>
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {r.itens} item(ns){r.divergencias > 0 ? ` · ${r.divergencias} divergência(s)` : ''}
                  </p>
                </div>
                {r.status === 'conferido' ? (
                  <Badge className="bg-ok/10 text-ok">conferido</Badge>
                ) : (
                  <Button size="sm" variant="outline" onClick={() => confirmarRecebimento(r.id)}>Confirmar</Button>
                )}
              </Card>
            ))}
          </section>
        )}

        {/* ---------- VALIDADES ---------- */}
        {secao === 'validades' && (
          <section className="space-y-3">
            <h2 className="font-display font-semibold">Validades (FEFO)</h2>
            {lotes.length === 0 ? (
              <Card className="p-6 text-center text-sm text-muted-foreground">
                Nenhum lote com validade. Lotes nascem ao confirmar recebimentos com data de validade.
              </Card>
            ) : (
              lotes.map((l: any) => {
                const st = validadeStatus(l.validade);
                return (
                  <Card key={l.id} className="flex items-center justify-between gap-3 p-4">
                    <div className="min-w-0">
                      <p className="font-medium">{l.itemNome}</p>
                      <p className="text-xs text-muted-foreground">{l.quantidade} {l.unidade} · entrada {l.entrada}</p>
                    </div>
                    <Badge className={st.cls}>{st.label}</Badge>
                  </Card>
                );
              })
            )}
          </section>
        )}

        {/* ---------- DESPERDÍCIO ---------- */}
        {secao === 'desperdicio' && (
          <section className="space-y-3">
            <h2 className="font-display font-semibold">Desperdício</h2>
            <Card className="p-4">
              <EntityForm
                key={`desp-${ver}`}
                submitLabel="Registrar desperdício"
                fields={[
                  { name: 'descricao', label: 'Descrição', type: 'text', required: true, placeholder: 'Ex.: Pão queimado' },
                  { name: 'itemId', label: 'Item de estoque (opcional — baixa o estoque e entra no CMV)', type: 'select', defaultValue: '', options: [{ value: '', label: '— sem vínculo (só registro) —' }, ...itens.map((i: any) => ({ value: i.id, label: i.nome }))] },
                  { name: 'quantidade', label: 'Quantidade', type: 'text', placeholder: '0' },
                  { name: 'motivo', label: 'Motivo', type: 'text', placeholder: 'Ex.: forno' },
                  { name: 'fotoRef', label: 'Foto (opcional)', type: 'image' },
                  { name: 'data', label: 'Data', type: 'date', defaultValue: hoje },
                ] as FieldDef[]}
                onSubmit={async (v) => {
                  await api.post('/desperdicios', { descricao: v.descricao, itemId: v.itemId || undefined, quantidade: v.quantidade ? Number(v.quantidade) : undefined, motivo: v.motivo || undefined, fotoRef: v.fotoRef || undefined, data: v.data || undefined });
                  await reload();
                }}
              />
            </Card>
            {desperdicios.map((d: any) => (
              <Card key={d.id} className="flex items-center gap-3 p-4">
                {d.fotoRef && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={d.fotoRef} alt="Foto do desperdício" className="h-14 w-14 flex-none rounded-md object-cover" />
                )}
                <div>
                  <p className="font-medium">{d.descricao}</p>
                  <p className="text-sm text-muted-foreground">
                    {d.quantidade ?? '—'} {d.unidadeMedida ?? ''}{d.motivo ? ` · ${d.motivo}` : ''} · {d.data}
                    {d.custoUnitario && d.quantidade ? ` · perda ${brl(Number(d.custoUnitario) * Number(d.quantidade))}` : ''}
                  </p>
                </div>
              </Card>
            ))}
          </section>
        )}

        {/* ---------- VISTORIAS ---------- */}
        {secao === 'vistorias' && (
          <section className="space-y-3">
            <h2 className="font-display font-semibold">Vistorias</h2>
            <Card className="p-4">
              <EntityForm
                key={`vist-${ver}`}
                submitLabel="Registrar vistoria"
                fields={[
                  { name: 'tipo', label: 'Tipo', type: 'select', options: TIPO_VIST, defaultValue: 'abertura' },
                  { name: 'observacao', label: 'Observação', type: 'text', placeholder: 'Ex.: Tudo ok' },
                  { name: 'fotoRef', label: 'Foto (opcional)', type: 'image' },
                  { name: 'data', label: 'Data', type: 'date', defaultValue: hoje },
                ] as FieldDef[]}
                onSubmit={async (v) => {
                  await api.post('/vistorias', { tipo: v.tipo, observacao: v.observacao || undefined, fotoRef: v.fotoRef || undefined, data: v.data || undefined });
                  await reload();
                }}
              />
            </Card>
            {vistorias.map((vi: any) => (
              <Card key={vi.id} className="flex items-center gap-3 p-4">
                {vi.fotoRef && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={vi.fotoRef} alt="Foto da vistoria" className="h-14 w-14 flex-none rounded-md object-cover" />
                )}
                <div className="min-w-0 flex-1">
                  <p className="font-medium capitalize">{vi.tipo}</p>
                  <p className="text-sm text-muted-foreground">{vi.observacao ?? ''} · {vi.data}</p>
                </div>
                <Badge className="bg-ok/10 text-ok">{vi.status}</Badge>
              </Card>
            ))}
          </section>
        )}
      </div>
    </Shell>
  );
}
