'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { Card } from '@/components/ui/card';

/* eslint-disable @typescript-eslint/no-explicit-any */

const TIPO_LABEL: Record<string, string> = {
  entrada: 'Entrada',
  saida: 'Saída',
  intervalo_inicio: 'Início de intervalo',
  intervalo_fim: 'Fim de intervalo',
};

function hora(iso?: string) {
  return iso
    ? new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
    : '—';
}
function fmtMin(min: number) {
  const a = Math.abs(min || 0);
  return `${Math.floor(a / 60)}h${String(a % 60).padStart(2, '0')}`;
}

// Card informativo do ponto de HOJE para o painel do gerente. Só resumo + atalho
// para gerir (Pessoas & Ponto). Degrada em silêncio se sem permissão.
export function CardPontoHoje() {
  const [pessoas, setPessoas] = useState<any[] | null>(null);

  useEffect(() => {
    api
      .pontoPessoas()
      .then((p) => setPessoas(Array.isArray(p) ? p : []))
      .catch(() => setPessoas([]));
  }, []);

  const trabalhando = pessoas?.filter((p) => p.status === 'trabalhando').length ?? 0;
  const total = pessoas?.length ?? 0;

  return (
    <Card className="p-0">
      <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-3.5">
        <div className="min-w-0">
          <p className="font-display text-sm font-bold">Ponto de hoje</p>
          <p className="text-xs text-muted-foreground">
            <span className="font-semibold text-[hsl(var(--ok))]">{trabalhando}</span>{' '}
            trabalhando agora · {total} marcaram
          </p>
        </div>
        <Link
          href="/pessoas"
          className="flex-none text-xs font-medium text-primary hover:underline"
        >
          Gerenciar →
        </Link>
      </div>
      <div className="divide-y divide-border">
        {pessoas === null && (
          <p className="px-5 py-6 text-sm text-muted-foreground">Carregando…</p>
        )}
        {pessoas?.length === 0 && (
          <p className="px-5 py-6 text-sm text-muted-foreground">
            Ninguém bateu ponto hoje ainda.
          </p>
        )}
        {pessoas?.slice(0, 6).map((p) => (
          <div key={p.colaboradorId} className="flex items-center gap-3 px-5 py-2.5">
            <span
              className={`h-2 w-2 flex-none rounded-full ${
                p.status === 'trabalhando'
                  ? 'bg-[hsl(var(--ok))]'
                  : 'bg-muted-foreground/40'
              }`}
            />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">{p.nome}</p>
              <p className="text-xs text-muted-foreground">
                {p.ultimaMarcacao
                  ? `${TIPO_LABEL[p.ultimaMarcacao.tipo] ?? p.ultimaMarcacao.tipo} ${hora(p.ultimaMarcacao.hora)}`
                  : '—'}
              </p>
            </div>
            <span className="font-mono text-xs font-bold tabular-nums">
              {fmtMin(p.trabalhadoMin)}
            </span>
          </div>
        ))}
        {pessoas && pessoas.length > 6 && (
          <Link
            href="/pessoas"
            className="block px-5 py-2.5 text-center text-xs font-medium text-primary hover:underline"
          >
            ver todos ({pessoas.length})
          </Link>
        )}
      </div>
    </Card>
  );
}
