'use client';

import { useCallback, useEffect, useState } from 'react';
import { Clock, Coffee, LogIn, LogOut } from 'lucide-react';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';

/* eslint-disable @typescript-eslint/no-explicit-any */
const TIPOS = [
  { tipo: 'entrada', label: 'Entrada', icon: LogIn },
  { tipo: 'intervalo_inicio', label: 'Saída p/ intervalo', icon: Coffee },
  { tipo: 'intervalo_fim', label: 'Volta do intervalo', icon: Coffee },
  { tipo: 'saida', label: 'Saída', icon: LogOut },
];

export const TIPO_LABEL: Record<string, string> = {
  entrada: 'Entrada',
  intervalo_inicio: 'Saída p/ intervalo',
  intervalo_fim: 'Volta do intervalo',
  saida: 'Saída',
};

function hora(iso: string) {
  return new Date(iso).toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function PontoCard({
  colaboradorId,
  titulo = 'Bater ponto',
}: {
  colaboradorId?: string;
  titulo?: string;
}) {
  const [marcacoes, setMarcacoes] = useState<any[] | null>(null);
  const [comprovante, setComprovante] = useState<any | null>(null);
  const [erro, setErro] = useState('');
  const [saving, setSaving] = useState('');

  const carregar = useCallback(async () => {
    try {
      setMarcacoes(await api.pontoDia(undefined, colaboradorId));
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao carregar');
    }
  }, [colaboradorId]);

  useEffect(() => {
    carregar();
  }, [carregar]);

  async function bater(tipo: string) {
    setErro('');
    setSaving(tipo);
    try {
      const body: Record<string, unknown> = { tipo };
      if (colaboradorId) body.colaboradorId = colaboradorId;
      const c = await api.marcarPonto(body);
      setComprovante(c);
      await carregar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao marcar');
    } finally {
      setSaving('');
    }
  }

  return (
    <Card className="p-4">
      <div className="mb-3 flex items-center gap-2">
        <Clock className="h-4 w-4 text-primary" />
        <h2 className="font-display text-sm font-bold">{titulo}</h2>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {TIPOS.map((t) => (
          <Button
            key={t.tipo}
            variant="outline"
            onClick={() => bater(t.tipo)}
            disabled={!!saving}
            className="h-auto flex-col gap-1 py-3"
          >
            <t.icon className="h-4 w-4" />
            <span className="text-xs">{saving === t.tipo ? '…' : t.label}</span>
          </Button>
        ))}
      </div>

      {erro && <p className="mt-2 text-sm text-destructive">{erro}</p>}

      {comprovante && (
        <div className="mt-3 rounded-lg border border-[hsl(var(--ok)/.4)] bg-[hsl(var(--ok)/.08)] p-3 text-sm">
          <p className="font-semibold text-[hsl(var(--ok))]">
            ✓ {TIPO_LABEL[comprovante.tipo] ?? comprovante.tipo} registrada
          </p>
          <p className="mt-0.5 font-mono text-xs text-muted-foreground">
            NSR {comprovante.nsr} · {hora(comprovante.marcadoEm)} ·{' '}
            {comprovante.colaboradorNome}
          </p>
          <p className="truncate font-mono text-[10px] text-muted-foreground">
            hash {comprovante.hash}
          </p>
        </div>
      )}

      <div className="mt-3 border-t border-border pt-3">
        <p className="mb-1.5 text-xs font-medium text-muted-foreground">
          Marcações de hoje
        </p>
        {marcacoes === null ? (
          <p className="text-xs text-muted-foreground">Carregando…</p>
        ) : marcacoes.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            Nenhuma marcação registrada hoje.
          </p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {marcacoes.map((m) => (
              <span
                key={m.id}
                className="rounded-md bg-secondary px-2 py-1 font-mono text-[11px]"
                title={`NSR ${m.nsr}`}
              >
                {hora(m.marcadoEm)} · {TIPO_LABEL[m.tipo] ?? m.tipo}
              </span>
            ))}
          </div>
        )}
      </div>
    </Card>
  );
}
