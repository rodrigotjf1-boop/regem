'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { LogOut } from 'lucide-react';
import { api, clearToken, getToken } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { BottomNav } from '@/components/app-shell/bottom-nav';
import { EntityForm, type FieldDef } from '@/components/cadastros/entity-form';
import { RegemMark } from '@/components/brand/regem-mark';

/* eslint-disable @typescript-eslint/no-explicit-any */
export default function OperacaoPage() {
  const router = useRouter();
  const [itens, setItens] = useState<any[]>([]);
  const [desperdicios, setDesperdicios] = useState<any[]>([]);
  const [vistorias, setVistorias] = useState<any[]>([]);
  const [pronto, setPronto] = useState(false);
  const [erro, setErro] = useState('');
  const [ver, setVer] = useState(0);

  const reload = useCallback(async () => {
    try {
      const [it, de, vi] = await Promise.all([
        api.get('/estoque/itens'),
        api.get('/desperdicios'),
        api.get('/vistorias'),
      ]);
      setItens(it);
      setDesperdicios(de);
      setVistorias(vi);
      setVer((v) => v + 1);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao carregar');
    } finally {
      setPronto(true);
    }
  }, []);

  useEffect(() => {
    if (!getToken()) {
      router.replace('/');
      return;
    }
    reload();
  }, [reload, router]);

  function sair() {
    clearToken();
    router.replace('/');
  }

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
    <div className="min-h-dvh">
      <header className="sticky top-0 z-10 border-b border-border bg-card/80 backdrop-blur">
        <div className="mx-auto flex max-w-2xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2">
            <RegemMark className="h-8 w-8 text-foreground" />
            <p className="text-sm font-semibold">Operação</p>
          </div>
          <Button variant="ghost" size="icon" onClick={sair} aria-label="Sair">
            <LogOut className="h-5 w-5" />
          </Button>
        </div>
      </header>

      <main className="mx-auto max-w-2xl space-y-6 px-4 py-4 pb-24">
        {erro && (
          <p role="alert" className="text-destructive">
            {erro}
          </p>
        )}

        <section className="space-y-3">
          <h2 className="font-semibold">Estoque</h2>
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
                    ] as FieldDef[]
                  }
                  onSubmit={async (v) => {
                    await api.post('/estoque/movimentos', {
                      itemId: v.itemId,
                      tipo: v.tipo,
                      quantidade: Number(v.quantidade),
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
                  </p>
                </div>
                <Badge
                  className={
                    abaixo
                      ? 'bg-red-100 text-red-700'
                      : 'bg-emerald-100 text-emerald-700'
                  }
                >
                  {i.saldo} {i.unidadeMedida}
                </Badge>
              </Card>
            );
          })}
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
                  { name: 'quantidade', label: 'Quantidade', type: 'text', placeholder: '0' },
                  { name: 'motivo', label: 'Motivo', type: 'text', placeholder: 'Ex.: forno' },
                ] as FieldDef[]
              }
              onSubmit={async (v) => {
                await api.post('/desperdicios', {
                  descricao: v.descricao,
                  quantidade: v.quantidade ? Number(v.quantidade) : undefined,
                  motivo: v.motivo || undefined,
                });
                await reload();
              }}
            />
          </Card>
          {desperdicios.map((d: any) => (
            <Card key={d.id} className="p-4">
              <p className="font-medium">{d.descricao}</p>
              <p className="text-sm text-muted-foreground">
                {d.quantidade ?? '—'} {d.unidadeMedida ?? ''}
                {d.motivo ? ` · ${d.motivo}` : ''} · {d.data}
              </p>
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
                ] as FieldDef[]
              }
              onSubmit={async (v) => {
                await api.post('/vistorias', {
                  tipo: v.tipo,
                  observacao: v.observacao || undefined,
                });
                await reload();
              }}
            />
          </Card>
          {vistorias.map((vi: any) => (
            <Card key={vi.id} className="flex items-center justify-between gap-3 p-4">
              <div>
                <p className="font-medium capitalize">{vi.tipo}</p>
                <p className="text-sm text-muted-foreground">
                  {vi.observacao ?? ''} · {vi.data}
                </p>
              </div>
              <Badge className="bg-emerald-100 text-emerald-700">{vi.status}</Badge>
            </Card>
          ))}
        </section>
      </main>
      <BottomNav />
    </div>
  );
}
