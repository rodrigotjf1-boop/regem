'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus } from 'lucide-react';
import { api, getToken } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { EntityForm, type FieldDef } from '@/components/cadastros/entity-form';
import { RecebimentoForm } from '@/components/recebimento/recebimento-form';
import { Shell } from '@/components/app-shell/shell';

/* eslint-disable @typescript-eslint/no-explicit-any */
function validadeStatus(validade: string | null) {
  if (!validade) return { label: 'sem validade', cls: 'bg-slate-100 text-slate-600' };
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  const v = new Date(`${validade}T00:00:00`);
  const dias = Math.round((v.getTime() - hoje.getTime()) / 86400000);
  const dm = v.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
  if (dias < 0)
    return { label: `vencido há ${Math.abs(dias)}d`, cls: 'bg-red-100 text-red-700' };
  if (dias === 0) return { label: 'vence hoje', cls: 'bg-red-100 text-red-700' };
  if (dias <= 7)
    return { label: `vence em ${dias}d (${dm})`, cls: 'bg-amber-100 text-amber-800' };
  return { label: dm, cls: 'bg-emerald-100 text-emerald-700' };
}

export default function OperacaoPage() {
  const router = useRouter();
  const [itens, setItens] = useState<any[]>([]);
  const [desperdicios, setDesperdicios] = useState<any[]>([]);
  const [vistorias, setVistorias] = useState<any[]>([]);
  const [fornecedores, setFornecedores] = useState<any[]>([]);
  const [recebimentos, setRecebimentos] = useState<any[]>([]);
  const [lotes, setLotes] = useState<any[]>([]);
  const [showReceb, setShowReceb] = useState(false);
  const [pronto, setPronto] = useState(false);
  const [erro, setErro] = useState('');
  const [ver, setVer] = useState(0);

  const reload = useCallback(async () => {
    try {
      const [it, de, vi, fo, re, lo] = await Promise.all([
        api.get('/estoque/itens'),
        api.get('/desperdicios'),
        api.get('/vistorias'),
        api.fornecedores(),
        api.recebimentos(),
        api.lotes(),
      ]);
      setItens(it);
      setDesperdicios(de);
      setVistorias(vi);
      setFornecedores(fo);
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
      <div className="grid min-h-dvh place-items-center text-muted-foreground">
        Carregando…
      </div>
    );
  }

  const optItens = itens.map((i: any) => ({
    value: i.id,
    label: `${i.nome} (${i.saldo} ${i.unidadeMedida})`,
  }));
  const hoje = new Date().toISOString().slice(0, 10);
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

  return (
    <Shell eyebrow="Produção" title="Operação">
      <div className="max-w-3xl space-y-6">
        {erro && (
          <p role="alert" className="text-destructive">
            {erro}
          </p>
        )}

        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">Estoque</h2>
            <button
              type="button"
              onClick={() => router.push('/estoque')}
              className="text-sm font-medium text-primary hover:underline"
            >
              Inteligência de estoque →
            </button>
          </div>
          <Card className="space-y-4 p-4">
            <EntityForm
              key={`item-${ver}`}
              submitLabel="Novo item"
              fields={
                [
                  { name: 'nome', label: 'Item', type: 'text', required: true, placeholder: 'Ex.: Tomate' },
                  { name: 'unidadeMedida', label: 'Unidade', type: 'text', placeholder: 'kg' },
                  { name: 'estoqueMinimo', label: 'Estoque mínimo', type: 'text', placeholder: '0' },
                ] as FieldDef[]
              }
              onSubmit={async (v) => {
                await api.post('/estoque/itens', {
                  nome: v.nome,
                  unidadeMedida: v.unidadeMedida || undefined,
                  estoqueMinimo: v.estoqueMinimo ? Number(v.estoqueMinimo) : undefined,
                });
                await reload();
              }}
            />
            {optItens.length > 0 && (
              <div className="border-t border-border pt-4">
                <EntityForm
                  key={`mov-${ver}`}
                  submitLabel="Registrar movimento"
                  fields={
                    [
                      { name: 'itemId', label: 'Item', type: 'select', required: true, options: optItens, defaultValue: optItens[0]?.value },
                      { name: 'tipo', label: 'Tipo', type: 'select', options: TIPO_MOV, defaultValue: 'entrada' },
                      { name: 'quantidade', label: 'Quantidade', type: 'text', required: true, placeholder: '0' },
                      { name: 'data', label: 'Data', type: 'date', defaultValue: hoje },
                    ] as FieldDef[]
                  }
                  onSubmit={async (v) => {
                    await api.post('/estoque/movimentos', {
                      itemId: v.itemId,
                      tipo: v.tipo,
                      quantidade: Number(v.quantidade),
                      data: v.data || undefined,
                    });
                    await reload();
                  }}
                />
              </div>
            )}
          </Card>
          {itens.map((i: any) => {
            const abaixo = Number(i.saldo) < Number(i.estoqueMinimo);
            return (
              <Card key={i.id} className="flex items-center justify-between gap-3 p-4">
                <div>
                  <p className="font-medium">{i.nome}</p>
                  <p className="text-xs text-muted-foreground">
                    mín. {i.estoqueMinimo} {i.unidadeMedida}
                    {Number(i.custoMedio) > 0 && (
                      <>
                        {' · '}custo méd.{' '}
                        {Number(i.custoMedio).toLocaleString('pt-BR', {
                          style: 'currency',
                          currency: 'BRL',
                        })}
                      </>
                    )}
                  </p>
                </div>
                <div className="text-right">
                  <Badge
                    className={
                      abaixo
                        ? 'bg-red-100 text-red-700'
                        : 'bg-emerald-100 text-emerald-700'
                    }
                  >
                    {i.saldo} {i.unidadeMedida}
                  </Badge>
                  {Number(i.valorEstoque) > 0 && (
                    <p className="mt-1 font-mono text-xs text-muted-foreground">
                      {Number(i.valorEstoque).toLocaleString('pt-BR', {
                        style: 'currency',
                        currency: 'BRL',
                      })}
                    </p>
                  )}
                </div>
              </Card>
            );
          })}
        </section>

        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">Recebimento</h2>
            <Button size="sm" onClick={() => setShowReceb((v) => !v)}>
              {showReceb ? (
                'Fechar'
              ) : (
                <>
                  <Plus className="h-4 w-4" /> Novo recebimento
                </>
              )}
            </Button>
          </div>
          {showReceb && (
            <RecebimentoForm
              fornecedores={fornecedores}
              itens={itens}
              onCancel={() => setShowReceb(false)}
              onCreated={() => {
                setShowReceb(false);
                reload();
              }}
            />
          )}
          {recebimentos.length === 0 && !showReceb && (
            <Card className="p-6 text-center text-sm text-muted-foreground">
              Nenhum recebimento registrado.
            </Card>
          )}
          {recebimentos.map((r: any) => (
            <Card
              key={r.id}
              className="flex items-center justify-between gap-3 p-4"
            >
              <div className="min-w-0">
                <p className="font-medium">
                  {r.fornecedorNome ?? 'Sem fornecedor'}{' '}
                  <span className="text-xs font-normal text-muted-foreground">
                    · {r.data}
                  </span>
                </p>
                <p className="text-xs text-muted-foreground">
                  {r.itens} item(ns)
                  {r.divergencias > 0
                    ? ` · ${r.divergencias} divergência(s)`
                    : ''}
                </p>
              </div>
              {r.status === 'conferido' ? (
                <Badge className="bg-emerald-100 text-emerald-700">
                  conferido
                </Badge>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => confirmarRecebimento(r.id)}
                >
                  Confirmar
                </Button>
              )}
            </Card>
          ))}
        </section>

        <section className="space-y-3">
          <h2 className="font-semibold">Validades (FEFO)</h2>
          {lotes.length === 0 ? (
            <Card className="p-6 text-center text-sm text-muted-foreground">
              Nenhum lote com validade. Lotes nascem ao confirmar recebimentos
              com data de validade.
            </Card>
          ) : (
            lotes.map((l: any) => {
              const st = validadeStatus(l.validade);
              return (
                <Card
                  key={l.id}
                  className="flex items-center justify-between gap-3 p-4"
                >
                  <div className="min-w-0">
                    <p className="font-medium">{l.itemNome}</p>
                    <p className="text-xs text-muted-foreground">
                      {l.quantidade} {l.unidade} · entrada {l.entrada}
                    </p>
                  </div>
                  <Badge className={st.cls}>{st.label}</Badge>
                </Card>
              );
            })
          )}
        </section>

        <section className="space-y-3">
          <h2 className="font-semibold">Desperdício</h2>
          <Card className="p-4">
            <EntityForm
              key={`desp-${ver}`}
              submitLabel="Registrar desperdício"
              fields={
                [
                  { name: 'descricao', label: 'Descrição', type: 'text', required: true, placeholder: 'Ex.: Pão queimado' },
                  {
                    name: 'itemId',
                    label: 'Item de estoque (opcional — baixa o estoque e entra no CMV)',
                    type: 'select',
                    defaultValue: '',
                    options: [
                      { value: '', label: '— sem vínculo (só registro) —' },
                      ...itens.map((i: any) => ({ value: i.id, label: i.nome })),
                    ],
                  },
                  { name: 'quantidade', label: 'Quantidade', type: 'text', placeholder: '0' },
                  { name: 'motivo', label: 'Motivo', type: 'text', placeholder: 'Ex.: forno' },
                  { name: 'fotoRef', label: 'Foto (opcional)', type: 'image' },
                  { name: 'data', label: 'Data', type: 'date', defaultValue: hoje },
                ] as FieldDef[]
              }
              onSubmit={async (v) => {
                await api.post('/desperdicios', {
                  descricao: v.descricao,
                  itemId: v.itemId || undefined,
                  quantidade: v.quantidade ? Number(v.quantidade) : undefined,
                  motivo: v.motivo || undefined,
                  fotoRef: v.fotoRef || undefined,
                  data: v.data || undefined,
                });
                await reload();
              }}
            />
          </Card>
          {desperdicios.map((d: any) => (
            <Card key={d.id} className="flex items-center gap-3 p-4">
              {d.fotoRef && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={d.fotoRef}
                  alt="Foto do desperdício"
                  className="h-14 w-14 flex-none rounded-md object-cover"
                />
              )}
              <div>
                <p className="font-medium">{d.descricao}</p>
                <p className="text-sm text-muted-foreground">
                  {d.quantidade ?? '—'} {d.unidadeMedida ?? ''}
                  {d.motivo ? ` · ${d.motivo}` : ''} · {d.data}
                  {d.custoUnitario && d.quantidade
                    ? ` · perda ${(
                        Number(d.custoUnitario) * Number(d.quantidade)
                      ).toLocaleString('pt-BR', {
                        style: 'currency',
                        currency: 'BRL',
                      })}`
                    : ''}
                </p>
              </div>
            </Card>
          ))}
        </section>

        <section className="space-y-3">
          <h2 className="font-semibold">Vistorias</h2>
          <Card className="p-4">
            <EntityForm
              key={`vist-${ver}`}
              submitLabel="Registrar vistoria"
              fields={
                [
                  { name: 'tipo', label: 'Tipo', type: 'select', options: TIPO_VIST, defaultValue: 'abertura' },
                  { name: 'observacao', label: 'Observação', type: 'text', placeholder: 'Ex.: Tudo ok' },
                  { name: 'fotoRef', label: 'Foto (opcional)', type: 'image' },
                  { name: 'data', label: 'Data', type: 'date', defaultValue: hoje },
                ] as FieldDef[]
              }
              onSubmit={async (v) => {
                await api.post('/vistorias', {
                  tipo: v.tipo,
                  observacao: v.observacao || undefined,
                  fotoRef: v.fotoRef || undefined,
                  data: v.data || undefined,
                });
                await reload();
              }}
            />
          </Card>
          {vistorias.map((vi: any) => (
            <Card key={vi.id} className="flex items-center gap-3 p-4">
              {vi.fotoRef && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={vi.fotoRef}
                  alt="Foto da vistoria"
                  className="h-14 w-14 flex-none rounded-md object-cover"
                />
              )}
              <div className="min-w-0 flex-1">
                <p className="font-medium capitalize">{vi.tipo}</p>
                <p className="text-sm text-muted-foreground">
                  {vi.observacao ?? ''} · {vi.data}
                </p>
              </div>
              <Badge className="bg-emerald-100 text-emerald-700">{vi.status}</Badge>
            </Card>
          ))}
        </section>
      </div>
    </Shell>
  );
}
