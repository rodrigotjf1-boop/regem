'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, getCategoria, getToken } from '@/lib/api';
import { Shell } from '@/components/app-shell/shell';
import { Card } from '@/components/ui/card';
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
  { valor: 'cadastro', label: 'Cadastros' },
  { valor: 'escala', label: 'Escala' },
  { valor: 'gamificacao', label: 'Gamificação' },
];

const TIPO_COR: Record<string, string> = {
  cadastro: 'var(--ok)',
  escala: 'var(--primary)',
  gamificacao: 'var(--info)',
};

const ACAO_LABEL: Record<string, string> = {
  registrou_ocorrencia: 'Registrou ocorrência',
  anulou_ocorrencia: 'Anulou ocorrência',
  criou_alocacao: 'Criou alocação na escala',
  aplicou_template: 'Aplicou template de ramo',
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

          <Card className="p-0">
            <div className="border-b border-border px-5 py-3.5">
              <p className="font-display text-sm font-bold">
                Trilha de eventos
              </p>
              <p className="text-xs text-muted-foreground">
                Ações sensíveis registradas de forma imutável · 200 mais recentes
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left">
                    {['Quando', 'Ator', 'Tipo', 'Ação', 'Detalhe', 'Origem'].map(
                      (h) => (
                        <th
                          key={h}
                          className="whitespace-nowrap px-4 py-2.5 font-display text-[10px] font-bold uppercase tracking-[.1em] text-muted-foreground"
                        >
                          {h}
                        </th>
                      ),
                    )}
                  </tr>
                </thead>
                <tbody>
                  {rows === null && (
                    <tr>
                      <td
                        colSpan={6}
                        className="px-4 py-6 text-center text-muted-foreground"
                      >
                        Carregando…
                      </td>
                    </tr>
                  )}
                  {rows?.length === 0 && (
                    <tr>
                      <td
                        colSpan={6}
                        className="px-4 py-6 text-center text-muted-foreground"
                      >
                        Nenhum evento registrado ainda.
                      </td>
                    </tr>
                  )}
                  {rows?.map((r) => {
                    const cor = r.tipo ? TIPO_COR[r.tipo] : undefined;
                    return (
                      <tr
                        key={r.id}
                        className="border-b border-border last:border-0"
                      >
                        <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-muted-foreground">
                          {quando(r.criadoEm)}
                        </td>
                        <td className="px-4 py-3">
                          <span className="font-semibold">
                            {r.atorNome ?? 'Sistema'}
                          </span>
                          {r.atorPerfil && (
                            <span className="ml-1.5 text-[11px] uppercase tracking-wide text-muted-foreground">
                              {r.atorPerfil}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          {r.tipo && (
                            <span
                              className="rounded-md px-2 py-0.5 text-[11px] font-bold"
                              style={{
                                background: cor
                                  ? `hsl(${cor}/.15)`
                                  : 'hsl(var(--muted))',
                                color: cor
                                  ? `hsl(${cor})`
                                  : 'hsl(var(--muted-foreground))',
                              }}
                            >
                              {r.tipo}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 font-medium">
                          {acaoLabel(r.acao)}
                        </td>
                        <td
                          className="max-w-[260px] truncate px-4 py-3 font-mono text-xs text-muted-foreground"
                          title={resumoDetalhe(r.detalhe)}
                        >
                          {resumoDetalhe(r.detalhe)}
                        </td>
                        <td className="px-4 py-3 text-xs uppercase tracking-wide text-muted-foreground">
                          {r.origem ?? 'web'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
    </Shell>
  );
}
