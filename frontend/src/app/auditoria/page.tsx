'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, getCategoria, getToken } from '@/lib/api';
import { Shell } from '@/components/app-shell/shell';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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

// Rótulo amigável por tipo (fallback = o próprio tipo).
const TIPO_LABEL: Record<string, string> = {
  auth: 'Acesso',
  config: 'Configuração',
  ponto: 'Ponto',
  escala: 'Escala',
  estoque: 'Estoque',
  recebimento: 'Recebimento',
  cadastro: 'Cadastros',
  vistoria: 'Vistoria',
  gamificacao: 'Gamificação',
  modulos: 'Módulos & apps',
  producao: 'Produção',
};
const tipoLabel = (t?: string | null) =>
  (t && (TIPO_LABEL[t] ?? t)) || '—';

const TIPO_COR: Record<string, string> = {
  auth: 'var(--destructive)',
  config: 'var(--warn)',
  ponto: 'var(--info)',
  escala: 'var(--primary)',
  estoque: 'var(--ok)',
  recebimento: 'var(--ok)',
  cadastro: 'var(--ok)',
  vistoria: 'var(--info)',
  gamificacao: 'var(--primary)',
  modulos: 'var(--warn)',
  producao: 'var(--primary)',
};

// Ações conhecidas → texto legível. Fallback troca _ por espaço.
const ACAO_LABEL: Record<string, string> = {
  login: 'Entrou no sistema',
  login_falhou: 'Falha de login',
  pin_falhou: 'Falha de PIN',
  senha_alterada: 'Alterou a própria senha',
  senha_redefinida: 'Redefiniu senha (gestor)',
  perfil_atualizado: 'Editou um perfil de acesso',
  acesso_atualizado: 'Alterou acesso de colaborador',
  registrou_ocorrencia: 'Registrou ocorrência',
  anulou_ocorrencia: 'Anulou ocorrência',
  criou_alocacao: 'Criou alocação na escala',
  aplicou_template: 'Aplicou template de ramo',
  aplicou_wizard: 'Aplicou wizard por ramo',
  marcou_ponto: 'Marcou ponto',
  incluiu_marcacao: 'Incluiu marcação (ajuste)',
  aprovou_hora_extra: 'Aprovou hora extra',
  produziu_ficha: 'Produziu ficha técnica',
  cadastrou_equipamento: 'Cadastrou equipamento',
  revogou_equipamento: 'Revogou equipamento',
};
const acaoLabel = (a: string) => ACAO_LABEL[a] ?? a.replace(/_/g, ' ');

function quando(iso: string) {
  return new Date(iso).toLocaleString('pt-BR', {
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
    .map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`);
  return partes.length ? partes.join(' · ') : '—';
}

const hoje = () => new Date().toISOString().slice(0, 10);
const diasAtras = (d: number) =>
  new Date(Date.now() - d * 86400000).toISOString().slice(0, 10);

export default function AuditoriaPage() {
  const [rows, setRows] = useState<Registro[] | null>(null);
  const [tipos, setTipos] = useState<string[]>([]);
  const [tipo, setTipo] = useState('');
  const [busca, setBusca] = useState('');
  const [de, setDe] = useState(diasAtras(29));
  const [ate, setAte] = useState(hoje());
  const [erro, setErro] = useState('');
  const [cat, setCat] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    setErro('');
    try {
      const p = new URLSearchParams();
      if (tipo) p.set('tipo', tipo);
      if (busca.trim()) p.set('busca', busca.trim());
      if (de) p.set('de', de);
      if (ate) p.set('ate', ate);
      const q = p.toString();
      const res: any = await api.get(`/auditoria${q ? `?${q}` : ''}`);
      setRows(res.registros ?? []);
      if (res.tipos) setTipos(res.tipos);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao carregar');
    }
  }, [tipo, busca, de, ate]);

  // Autorização + recarga: tipo/de/ate recarregam na hora; busca com debounce.
  useEffect(() => {
    if (!getToken()) return;
    const c = getCategoria();
    setCat(c);
    if (c !== 'presidente' && c !== 'gerente') return;
    const t = setTimeout(carregar, busca ? 350 : 0);
    return () => clearTimeout(t);
  }, [carregar, busca]);

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
        <div className="space-y-4">
          {/* Filtros: busca + período */}
          <Card className="flex flex-wrap items-end gap-3 p-4">
            <div className="min-w-[220px] flex-1 space-y-1">
              <Label className="text-xs">Buscar</Label>
              <Input
                type="search"
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                placeholder="usuário, ação ou detalhe…"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">De</Label>
              <Input type="date" value={de} onChange={(e) => setDe(e.target.value)} className="w-40" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Até</Label>
              <Input type="date" value={ate} onChange={(e) => setAte(e.target.value)} className="w-40" />
            </div>
          </Card>

          {/* Chips dinâmicos por tipo (dos tipos realmente registrados) */}
          <div className="flex flex-wrap gap-2">
            {[{ v: '', l: 'Tudo' }, ...tipos.map((t) => ({ v: t, l: tipoLabel(t) }))].map((t) => (
              <button
                key={t.v || 'tudo'}
                type="button"
                onClick={() => setTipo(t.v)}
                aria-pressed={tipo === t.v ? 'true' : 'false'}
                className={cn(
                  'rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors',
                  tipo === t.v
                    ? 'border-primary bg-primary/15 text-primary'
                    : 'border-border bg-card text-muted-foreground hover:text-foreground',
                )}
              >
                {t.l}
              </button>
            ))}
          </div>

          {erro && <p className="text-destructive">{erro}</p>}

          <ResponsiveTable<Registro>
            caption="Trilha de eventos de auditoria"
            title="Trilha de eventos"
            subtitle="Ações sensíveis registradas de forma imutável · 300 mais recentes"
            loading={rows === null}
            rows={rows ?? []}
            rowKey={(r) => r.id}
            empty="Nenhum evento no filtro atual."
            variant="scroll-sticky"
            cardTitle={(r) => acaoLabel(r.acao)}
            columns={COLUNAS}
          />

          <p className="text-xs text-muted-foreground">
            🔒 Registros não podem ser editados ou apagados · retenção conforme LGPD.
          </p>
        </div>
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
    render: (r) => <span className="text-muted-foreground">{quando(r.criadoEm)}</span>,
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
          {tipoLabel(r.tipo)}
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
