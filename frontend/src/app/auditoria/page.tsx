'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, getCategoria, getToken } from '@/lib/api';
import { Shell } from '@/components/app-shell/shell';
import { Card } from '@/components/ui/card';
import { ResponsiveTable, type Column } from '@/components/ui/responsive-table';
import { cn } from '@/lib/utils';

/* eslint-disable @typescript-eslint/no-explicit-any */

type Registro = {
  id: string;
  tipo: string | null;
  acao: string;
  detalhe: any;
  atorPerfil: string | null;
  origem: string | null;
  criadoEm: string;
  atorNome: string | null;
};

const TIPOS: { valor: string; label: string }[] = [
  { valor: '', label: 'Tudo' },
  { valor: 'ponto', label: 'Ponto' },
  { valor: 'escala', label: 'Escala' },
  { valor: 'modulos', label: 'Módulos & apps' },
  { valor: 'recebimento', label: 'Recebimento' },
  { valor: 'cadastro', label: 'Cadastros' },
  { valor: 'vistoria', label: 'Vistoria' },
  { valor: 'gamificacao', label: 'Gamificação' },
];

const TIPO_COR: Record<string, string> = {
  ponto: 'var(--info)',
  escala: 'var(--primary)',
  modulos: 'var(--warn)',
  recebimento: 'var(--ok)',
  cadastro: 'var(--ok)',
  vistoria: 'var(--info)',
  gamificacao: 'var(--primary)',
};

const ACAO_LABEL: Record<string, string> = {
  registrou_ocorrencia: 'Registrou ocorrência',
  anulou_ocorrencia: 'Anulou ocorrência',
  criou_alocacao: 'Criou alocação na escala',
  aplicou_template: 'Aplicou template de ramo',
  marcou_ponto: 'Marcou ponto',
  incluiu_marcacao: 'Incluiu marcação (ajuste)',
  aprovou_hora_extra: 'Aprovou hora extra',
  cadastrou_equipamento: 'Cadastrou equipamento',
  revogou_equipamento: 'Revogou equipamento',
};

function acaoLabel(a: string) {
  return ACAO_LABEL[a] ?? a.replace(/_/g, ' ');
}

function quando(iso: string) {
  const d = new Date(iso);
  return d.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function resumoDetalhe(d: any): string {
  if (!d || typeof d !== 'object') return '—';
  const partes = Object.entries(d)
    .filter(([, v]) => v !== null && v !== undefined && v !== '')
    .map(([k, v]) => `${k}: ${v}`);
  return partes.length ? partes.join(' · ') : '—';
}

export default function AuditoriaPage() {
  const [rows, setRows] = useState<Registro[] | null>(null);
  const [tipo, setTipo] = useState('');
  const [erro, setErro] = useState('');
  const [cat, setCat] = useState<string | null>(null);

  const carregar = useCallback(async (t: string) => {
    setErro('');
    try {
      const q = t ? `?tipo=${encodeURIComponent(t)}` : '';
      setRows(await api.get(`/auditoria${q}`));
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao carregar');
    }
  }, []);

  useEffect(() => {
    if (!getToken()) return;
    const c = getCategoria();
    setCat(c);
    if (c === 'presidente' || c === 'gerente') carregar(tipo);
  }, [carregar, tipo]);

  const autorizado = cat === 'presidente' || cat === 'gerente';

  return (
    <Shell eyebrow="Governança · registro imutável" title="Auditoria">
      {!autorizado ? (
        <Card className="p-10 text-center">
          <p className="font-display text-lg font-semibold">Área restrita</p>
          <p className="mt-1 text-sm text-muted-foreground">
            O histórico de auditoria é visível apenas para diretoria e gerência.
          </p>
        </Card>
      ) : (
        <>
          <div className="mb-4 flex flex-wrap gap-2">
            {TIPOS.map((t) => (
              <button
                key={t.valor}
                type="button"
                onClick={() => setTipo(t.valor)}
                className={cn(
                  'rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors',
                  tipo === t.valor
                    ? 'border-primary bg-primary/15 text-primary'
                    : 'border-border bg-card text-muted-foreground hover:text-foreground',
                )}
              >
                {t.label}
              </button>
            ))}
          </div>

          {erro && <p className="mb-4 text-destructive">{erro}</p>}

          <ResponsiveTable<Registro>
            caption="Trilha de eventos de auditoria"
            title="Trilha de eventos"
            subtitle="Ações sensíveis registradas de forma imutável · 200 mais recentes"
            loading={rows === null}
            rows={rows ?? []}
            rowKey={(r) => r.id}
            empty="Nenhum evento registrado ainda."
            variant="scroll-sticky"
            cardTitle={(r) => acaoLabel(r.acao)}
            columns={COLUNAS}
          />
        </>
      )}
    </Shell>
  );
}

const COLUNAS: Column<Registro>[] = [
  {
    key: 'quando',
    header: 'Quando',
    mono: true,
    sticky: true,
    render: (r) => (
      <span className="text-muted-foreground">{quando(r.criadoEm)}</span>
    ),
  },
  {
    key: 'ator',
    header: 'Ator',
    render: (r) => (
      <>
        <span className="font-semibold">{r.atorNome ?? 'Sistema'}</span>
        {r.atorPerfil && (
          <span className="ml-1.5 text-[11px] uppercase tracking-wide text-muted-foreground">
            {r.atorPerfil}
          </span>
        )}
      </>
    ),
  },
  {
    key: 'tipo',
    header: 'Tipo',
    render: (r) => {
      if (!r.tipo) return null;
      const cor = TIPO_COR[r.tipo];
      return (
        <span
          className="rounded-md px-2 py-0.5 text-[11px] font-bold"
          style={{
            background: cor ? `hsl(${cor}/.15)` : 'hsl(var(--muted))',
            color: cor ? `hsl(${cor})` : 'hsl(var(--muted-foreground))',
          }}
        >
          {r.tipo}
        </span>
      );
    },
  },
  { key: 'acao', header: 'Ação', render: (r) => acaoLabel(r.acao) },
  {
    key: 'detalhe',
    header: 'Detalhe',
    mono: true,
    render: (r) => (
      <span
        className="line-clamp-2 text-muted-foreground min-[700px]:block min-[700px]:max-w-[260px] min-[700px]:truncate"
        title={resumoDetalhe(r.detalhe)}
      >
        {resumoDetalhe(r.detalhe)}
      </span>
    ),
  },
  {
    key: 'origem',
    header: 'Origem',
    render: (r) => (
      <span className="text-xs uppercase tracking-wide text-muted-foreground">
        {r.origem ?? 'web'}
      </span>
    ),
  },
];
