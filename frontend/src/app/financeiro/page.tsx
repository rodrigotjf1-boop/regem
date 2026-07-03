'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, getToken } from '@/lib/api';
import { Shell } from '@/components/app-shell/shell';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { EntityForm, type FieldDef } from '@/components/cadastros/entity-form';

/* eslint-disable @typescript-eslint/no-explicit-any */

const brl = (n: number) =>
  Number(n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const RECORR: Record<string, string> = {
  nenhuma: '',
  semanal: 'semanal',
  quinzenal: 'quinzenal',
  mensal: 'mensal',
};

const FILTROS = [
  { valor: 'pagar', label: 'A pagar' },
  { valor: 'receber', label: 'A receber' },
  { valor: 'pago', label: 'Pagos' },
];

export default function FinanceiroPage() {
  const router = useRouter();
  const [resumo, setResumo] = useState<any>(null);
  const [titulos, setTitulos] = useState<any[] | null>(null);
  const [fornecedores, setFornecedores] = useState<any[]>([]);
  const [filtro, setFiltro] = useState('pagar');
  const [ver, setVer] = useState(0);
  const [erro, setErro] = useState('');

  const carregar = useCallback(async (f: string) => {
    setErro('');
    try {
      const [res, forn] = await Promise.all([
        api.financeiroResumo(),
        api.fornecedores(),
      ]);
      setResumo(res);
      setFornecedores(forn);
      const t =
        f === 'pago'
          ? await api.financeiroTitulos(undefined, 'pago')
          : await api.financeiroTitulos(f, 'aberto');
      setTitulos(t);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao carregar');
    }
  }, []);

  useEffect(() => {
    if (!getToken()) {
      router.replace('/entrar');
      return;
    }
    carregar(filtro);
  }, [carregar, filtro, router]);

  async function pagar(id: string) {
    try {
      await api.pagarTitulo(id, {});
      await carregar(filtro);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao pagar');
    }
  }
  async function estornar(id: string) {
    if (!confirm('Estornar este pagamento? Gera um lançamento inverso e reabre o título.'))
      return;
    try {
      await api.estornarTitulo(id);
      await carregar(filtro);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao estornar');
    }
  }

  const optForn = [
    { value: '', label: '— nenhum —' },
    ...fornecedores.map((f: any) => ({ value: f.id, label: f.nome })),
  ];

  const campos: FieldDef[] = [
    {
      name: 'tipo',
      label: 'Tipo',
      type: 'select',
      options: [
        { value: 'pagar', label: 'A pagar' },
        { value: 'receber', label: 'A receber' },
      ],
      defaultValue: 'pagar',
    },
    { name: 'descricao', label: 'Descrição', type: 'text', required: true, placeholder: 'Ex.: Aluguel' },
    { name: 'categoria', label: 'Tipo de conta', type: 'text', placeholder: 'Ex.: aluguel, energia, fornecedor' },
    { name: 'valor', label: 'Valor (R$)', type: 'text', required: true, placeholder: '0,00' },
    { name: 'vencimento', label: 'Vencimento', type: 'date' },
    {
      name: 'recorrencia',
      label: 'Recorrência',
      type: 'select',
      options: [
        { value: 'nenhuma', label: 'Não repete' },
        { value: 'semanal', label: 'Semanal' },
        { value: 'quinzenal', label: 'Quinzenal' },
        { value: 'mensal', label: 'Mensal' },
      ],
      defaultValue: 'nenhuma',
    },
    { name: 'fornecedorId', label: 'Fornecedor', type: 'select', options: optForn },
    { name: 'fotoRef', label: 'Comprovante / boleto (opcional)', type: 'image' },
  ];

  return (
    <Shell eyebrow="Gestão · financeiro" title="Financeiro">
      <div className="max-w-4xl space-y-5">
        {/* Resumo */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Kpi label="A pagar (aberto)" value={resumo ? brl(resumo.aPagar) : '—'} tone="warn" />
          <Kpi label="A receber (aberto)" value={resumo ? brl(resumo.aReceber) : '—'} tone="ok" />
          <Kpi label="Saldo de caixa" value={resumo ? brl(resumo.saldoCaixa) : '—'} />
        </div>

        {erro && <p className="text-destructive">{erro}</p>}

        {/* Novo título */}
        <Card className="p-4">
          <h2 className="mb-3 font-display text-lg font-semibold">Nova conta</h2>
          <EntityForm
            key={`tit-${ver}`}
            fields={campos}
            submitLabel="Cadastrar conta"
            onSubmit={async (v) => {
              await api.criarTitulo({
                tipo: v.tipo,
                descricao: v.descricao,
                categoria: v.categoria || undefined,
                valor: Number(String(v.valor).replace(',', '.')) || 0,
                vencimento: v.vencimento || undefined,
                recorrencia: v.recorrencia || 'nenhuma',
                fornecedorId: v.fornecedorId || undefined,
                fotoRef: v.fotoRef || undefined,
              });
              setVer((n) => n + 1);
              await carregar(filtro);
            }}
          />
        </Card>

        {/* Filtros */}
        <div className="flex flex-wrap gap-2">
          {FILTROS.map((f) => (
            <button
              key={f.valor}
              type="button"
              onClick={() => setFiltro(f.valor)}
              className={`rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors ${
                filtro === f.valor
                  ? 'border-primary bg-primary/15 text-primary'
                  : 'border-border bg-card text-muted-foreground hover:text-foreground'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        {/* Lista */}
        <div className="space-y-2">
          {titulos === null && <p className="text-sm text-muted-foreground">Carregando…</p>}
          {titulos?.length === 0 && (
            <Card className="p-8 text-center text-sm text-muted-foreground">
              Nenhuma conta {filtro === 'pago' ? 'paga' : 'em aberto'} aqui.
            </Card>
          )}
          {titulos?.map((t) => (
            <Card key={t.id} className="flex items-center gap-3 p-4">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="font-medium">{t.descricao}</p>
                  {t.categoria && (
                    <span className="rounded bg-secondary px-1.5 py-0.5 text-xs text-muted-foreground">
                      {t.categoria}
                    </span>
                  )}
                  {t.recorrencia && t.recorrencia !== 'nenhuma' && (
                    <span className="rounded bg-info/10 px-1.5 py-0.5 text-xs text-info">
                      {RECORR[t.recorrencia]}
                    </span>
                  )}
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {t.fornecedorNome ? `${t.fornecedorNome} · ` : ''}
                  {t.vencimento ? `vence ${t.vencimento}` : 'sem vencimento'}
                  {t.origem === 'recebimento' ? ' · do recebimento' : ''}
                </p>
              </div>
              <p
                className="font-mono text-sm font-bold"
                style={{ color: t.tipo === 'pagar' ? 'hsl(var(--warn))' : 'hsl(var(--ok))' }}
              >
                {brl(Number(t.valor))}
              </p>
              {t.status === 'aberto' ? (
                <Button type="button" size="sm" onClick={() => pagar(t.id)}>
                  {t.tipo === 'pagar' ? 'Pagar' : 'Receber'}
                </Button>
              ) : (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="text-muted-foreground"
                  onClick={() => estornar(t.id)}
                >
                  Estornar
                </Button>
              )}
            </Card>
          ))}
        </div>
      </div>
    </Shell>
  );
}

function Kpi({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: 'warn' | 'ok';
}) {
  const cor =
    tone === 'warn'
      ? 'hsl(var(--warn))'
      : tone === 'ok'
        ? 'hsl(var(--ok))'
        : undefined;
  return (
    <Card className="p-4">
      <p className="font-display text-[10px] font-bold uppercase tracking-[.14em] text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 font-mono text-2xl font-bold" style={{ color: cor }}>
        {value}
      </p>
    </Card>
  );
}
