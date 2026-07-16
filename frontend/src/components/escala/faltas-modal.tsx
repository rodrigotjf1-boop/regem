'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

/* eslint-disable @typescript-eslint/no-explicit-any */

const iso = (d: Date) => d.toISOString().slice(0, 10);
const fmt = (s: string) => String(s).split('-').reverse().join('/');
const TIPO = {
  falta_justificada: { l: 'Justificada', cls: 'text-warn' },
  falta_injustificada: { l: 'Injustificada', cls: 'text-destructive' },
} as Record<string, { l: string; cls: string }>;

// Relatório de faltas do período: resumo por colaborador + lista detalhada.
export function FaltasModal({ onClose }: { onClose: () => void }) {
  const hoje = new Date();
  const [de, setDe] = useState(iso(new Date(hoje.getFullYear(), hoje.getMonth(), 1)));
  const [ate, setAte] = useState(iso(new Date(hoje.getFullYear(), hoje.getMonth() + 1, 0)));
  const [data, setData] = useState<any>(null);

  const carregar = useCallback(async () => {
    setData(await api.faltasEscala(de, ate).catch(() => ({ faltas: [], resumo: [] })));
  }, [de, ate]);
  useEffect(() => {
    carregar();
  }, [carregar]);

  const resumo: any[] = data?.resumo ?? [];
  const faltas: any[] = data?.faltas ?? [];

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" onClick={onClose}>
      <Card className="max-h-[88vh] w-full max-w-lg space-y-4 overflow-y-auto p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-baseline justify-between">
          <h2 className="font-display text-base font-bold">Relatório de faltas</h2>
          <span className="font-mono text-xs text-muted-foreground">{faltas.length}</span>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1"><Label className="text-xs">De</Label><Input type="date" value={de} onChange={(e) => setDe(e.target.value)} /></div>
          <div className="space-y-1"><Label className="text-xs">Até</Label><Input type="date" value={ate} onChange={(e) => setAte(e.target.value)} /></div>
        </div>

        {resumo.length > 0 && (
          <div className="rounded-md border border-border">
            <table className="w-full text-sm">
              <caption className="sr-only">Faltas por colaborador</caption>
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted-foreground">
                  <th className="px-3 py-2 font-medium">Colaborador</th>
                  <th className="px-3 py-2 text-right font-medium">Justif.</th>
                  <th className="px-3 py-2 text-right font-medium">Injustif.</th>
                </tr>
              </thead>
              <tbody>
                {resumo.map((r) => (
                  <tr key={r.colaboradorId} className="border-b border-border/50 last:border-0">
                    <td className="px-3 py-2">{r.nome}</td>
                    <td className="px-3 py-2 text-right font-mono text-warn">{r.justificadas}</td>
                    <td className="px-3 py-2 text-right font-mono text-destructive">{r.injustificadas}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {faltas.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhuma falta no período.</p>
        ) : (
          <ul className="divide-y divide-border">
            {faltas.map((f) => (
              <li key={f.id} className="flex items-center gap-3 py-2 text-sm">
                <span className="w-16 flex-none font-mono text-xs text-muted-foreground">{fmt(f.data)}</span>
                <span className="min-w-0 flex-1 truncate">{f.colaboradorNome}</span>
                <span className={`flex-none text-xs font-medium ${TIPO[f.presenca]?.cls ?? ''}`}>
                  {TIPO[f.presenca]?.l ?? f.presenca}
                </span>
                {f.comprovanteRef && (
                  <a href={f.comprovanteRef} target="_blank" rel="noopener noreferrer" className="flex-none text-xs text-primary underline">
                    comprovante
                  </a>
                )}
              </li>
            ))}
          </ul>
        )}

        <div className="flex justify-end">
          <Button type="button" variant="outline" size="sm" onClick={onClose}>Fechar</Button>
        </div>
      </Card>
    </div>
  );
}
