'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Pencil, Trash2 } from 'lucide-react';
import { api, getToken, podePerm } from '@/lib/api';
import { Shell } from '@/components/app-shell/shell';
import { Card } from '@/components/ui/card';
import { FormasPagamentoCard } from '@/components/financeiro/formas-pagamento-card';
import { SkeletonList } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { EntityForm, type FieldDef } from '@/components/cadastros/entity-form';
import { ResponsiveTable, type Column } from '@/components/ui/responsive-table';

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
  // Títulos/resumo/fluxo/DRE exigem a permissão "financeiro". Sem ela, o usuário
  // só gerencia as formas de pagamento (operacional). Trava real é no servidor.
  const isPresidente = podePerm('financeiro');
  const [resumo, setResumo] = useState<any>(null);
  const [fluxo, setFluxo] = useState<any>(null);
  const [dre, setDre] = useState<any>(null);
  const [titulos, setTitulos] = useState<any[] | null>(null);
  const [fornecedores, setFornecedores] = useState<any[]>([]);
  const [filtro, setFiltro] = useState('pagar');
  const [ver, setVer] = useState(0);
  const [erro, setErro] = useState('');
  const [editId, setEditId] = useState<string | null>(null);
  const [editVals, setEditVals] = useState<any>(null);

  const carregar = useCallback(async (f: string) => {
    // Gerente não acessa dados financeiros — só as formas de pagamento (card próprio).
    if (!isPresidente) return;
    setErro('');
    try {
      const [res, forn, flx, dr] = await Promise.all([
        api.financeiroResumo(),
        api.fornecedores(),
        api.financeiroFluxo(30),
        api.financeiroDre(),
      ]);
      setResumo(res);
      setFornecedores(forn);
      setFluxo(flx);
      setDre(dr);
      const t =
        f === 'pago'
          ? await api.financeiroTitulos(undefined, 'pago')
          : await api.financeiroTitulos(f, 'aberto');
      setTitulos(t);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao carregar');
    }
  }, [isPresidente]);

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
  function editar(t: any) {
    setEditId(t.id);
    setEditVals({
      tipo: t.tipo,
      descricao: t.descricao ?? '',
      categoria: t.categoria ?? '',
      valor: String(t.valor ?? '').replace('.', ','),
      vencimento: t.vencimento ?? '',
      recorrencia: t.recorrencia ?? 'nenhuma',
      fornecedorId: t.fornecedorId ?? '',
      fotoRef: t.fotoRef ?? '',
    });
    setVer((n) => n + 1);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  function cancelarEdicao() {
    setEditId(null);
    setEditVals(null);
    setVer((n) => n + 1);
  }
  async function excluir(id: string) {
    if (!confirm('Excluir esta conta? (fica cancelada, para auditoria)')) return;
    try {
      await api.excluirTitulo(id);
      if (editId === id) cancelarEdicao();
      await carregar(filtro);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao excluir');
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
      defaultValue: editVals?.tipo ?? 'pagar',
    },
    { name: 'descricao', label: 'Descrição', type: 'text', required: true, placeholder: 'Ex.: Aluguel', defaultValue: editVals?.descricao },
    { name: 'categoria', label: 'Tipo de conta', type: 'text', placeholder: 'Ex.: aluguel, energia, fornecedor', defaultValue: editVals?.categoria },
    { name: 'valor', label: 'Valor (R$)', type: 'text', required: true, placeholder: '0,00', defaultValue: editVals?.valor },
    { name: 'vencimento', label: 'Vencimento', type: 'date', defaultValue: editVals?.vencimento },
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
      defaultValue: editVals?.recorrencia ?? 'nenhuma',
    },
    { name: 'fornecedorId', label: 'Fornecedor', type: 'select', options: optForn, defaultValue: editVals?.fornecedorId },
    { name: 'fotoRef', label: 'Comprovante / boleto (opcional)', type: 'image', defaultValue: editVals?.fotoRef },
  ];

  return (
    <Shell eyebrow="Gestão · financeiro" title="Financeiro">
      <div className="space-y-5">
        <FormasPagamentoCard />

        {!isPresidente && (
          <Card className="p-5 text-sm text-muted-foreground">
            Contas a pagar/receber, fluxo de caixa e resultado são da alçada do
            presidente/C&O. Como gerente, você gerencia as formas de pagamento acima e
            opera o caixa/turno no PDV.
          </Card>
        )}

        {isPresidente && (
        <>
        {/* Resumo */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Kpi label="A pagar (aberto)" value={resumo ? brl(resumo.aPagar) : '—'} tone="warn" />
          <Kpi label="A receber (aberto)" value={resumo ? brl(resumo.aReceber) : '—'} tone="ok" />
          <Kpi label="Saldo de caixa" value={resumo ? brl(resumo.saldoCaixa) : '—'} />
        </div>

        {erro && <p className="text-destructive">{erro}</p>}

        {/* Fluxo de caixa projetado (H2) */}
        {fluxo && fluxo.projecao?.length > 0 && (
          <ResponsiveTable<any>
            caption="Projeção de caixa por vencimento"
            title="Fluxo de caixa projetado"
            subtitle={`próximos ${fluxo.horizonteDias} dias · saldo final ${brl(fluxo.saldoFinal)}`}
            variant="scroll-sticky"
            rows={fluxo.projecao}
            rowKey={(p) => p.data}
            columns={[
              { key: 'data', header: 'Data', mono: true, sticky: true },
              {
                key: 'aReceber',
                header: 'A receber',
                mono: true,
                align: 'right',
                render: (p) => (
                  <span className="text-muted-foreground">
                    {p.aReceber > 0 ? brl(p.aReceber) : '—'}
                  </span>
                ),
              },
              {
                key: 'aPagar',
                header: 'A pagar',
                mono: true,
                align: 'right',
                render: (p) => (
                  <span className="text-muted-foreground">
                    {p.aPagar > 0 ? brl(p.aPagar) : '—'}
                  </span>
                ),
              },
              {
                key: 'saldoProjetado',
                header: 'Saldo projetado',
                mono: true,
                align: 'right',
                render: (p) => (
                  <span
                    className="font-bold"
                    style={{ color: p.negativo ? 'hsl(var(--destructive))' : undefined }}
                  >
                    {brl(p.saldoProjetado)}
                  </span>
                ),
              },
            ] as Column<any>[]}
          />
        )}

        {/* DRE gerencial — regime de caixa (H3) */}
        {dre && (
          <Card className="p-5">
            <div className="mb-3 flex flex-wrap items-baseline gap-x-3">
              <h2 className="font-display text-lg font-semibold">Resultado do mês</h2>
              <span className="text-xs text-muted-foreground">regime de caixa · {dre.periodo?.inicio} a {dre.periodo?.fim}</span>
            </div>
            <div className="space-y-1.5 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Receitas (entradas)</span>
                <span className="font-mono" style={{ color: 'hsl(var(--ok))' }}>{brl(dre.receitas)}</span>
              </div>
              {dre.despesas?.map((d: any) => (
                <div key={d.categoria} className="flex justify-between">
                  <span className="text-muted-foreground capitalize">− {d.categoria}</span>
                  <span className="font-mono text-muted-foreground">{brl(d.valor)}</span>
                </div>
              ))}
              <div className="mt-2 flex justify-between border-t border-border pt-2 font-semibold">
                <span>Resultado</span>
                <span
                  className="font-mono"
                  style={{ color: dre.resultado < 0 ? 'hsl(var(--destructive))' : 'hsl(var(--ok))' }}
                >
                  {brl(dre.resultado)}
                </span>
              </div>
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              Valor pleno (receita de vendas, CMV, folha) chega com o PDV e a folha de pessoal.
            </p>
          </Card>
        )}

        {/* Novo/editar título */}
        <Card className="p-4">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h2 className="font-display text-lg font-semibold">
              {editId ? 'Editar conta' : 'Nova conta'}
            </h2>
            {editId && (
              <Button type="button" variant="ghost" size="sm" onClick={cancelarEdicao}>
                Cancelar edição
              </Button>
            )}
          </div>
          <EntityForm
            key={`tit-${ver}`}
            fields={campos}
            submitLabel={editId ? 'Salvar alterações' : 'Cadastrar conta'}
            onSubmit={async (v) => {
              const body = {
                tipo: v.tipo,
                descricao: v.descricao,
                categoria: v.categoria || undefined,
                valor: Number(String(v.valor).replace(',', '.')) || 0,
                vencimento: v.vencimento || undefined,
                recorrencia: v.recorrencia || 'nenhuma',
                fornecedorId: v.fornecedorId || undefined,
                fotoRef: v.fotoRef || undefined,
              };
              if (editId) {
                await api.atualizarTitulo(editId, body);
                cancelarEdicao();
              } else {
                await api.criarTitulo(body);
                setVer((n) => n + 1);
              }
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
          {titulos === null && <SkeletonList rows={4} />}
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
                <div className="flex items-center gap-1">
                  <Button type="button" size="sm" onClick={() => pagar(t.id)}>
                    {t.tipo === 'pagar' ? 'Pagar' : 'Receber'}
                  </Button>
                  <Button type="button" variant="ghost" size="icon" aria-label="Editar" onClick={() => editar(t)}>
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button type="button" variant="ghost" size="icon" aria-label="Excluir" onClick={() => excluir(t.id)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
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
        </>
        )}
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
