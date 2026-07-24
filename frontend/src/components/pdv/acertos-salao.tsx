'use client';

import { useCallback, useEffect, useState } from 'react';
import { HandCoins } from 'lucide-react';
import { api } from '@/lib/api';
import { toast } from '@/lib/toast';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

/* eslint-disable @typescript-eslint/no-explicit-any */
// Fila de acerto do salão (mig 143). O sub-PDV fecha a mesa e fica com o
// dinheiro; aqui o caixa responsável confere o que o garçom traz e dá baixa —
// só nesse momento o valor entra na gaveta. Se o valor recebido for diferente do
// fechado, a diferença fica registrada (mesma lógica do fechamento cego).
const brl = (c: number) => (Number(c || 0) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const hora = (d?: string) =>
  d ? new Date(d).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '';

export function AcertosSalao() {
  const [lista, setLista] = useState<any[]>([]);
  const [conferindo, setConferindo] = useState<string | null>(null);
  const [recebido, setRecebido] = useState('');
  const [salvando, setSalvando] = useState(false);

  const carregar = useCallback(async () => {
    try {
      const r = await api.acertos();
      setLista(Array.isArray(r) ? r : []);
    } catch {
      /* silencioso: a fila é secundária na tela do caixa */
    }
  }, []);

  useEffect(() => {
    carregar();
    const t = setInterval(carregar, 20000);
    return () => clearInterval(t);
  }, [carregar]);

  async function baixar(a: any) {
    setSalvando(true);
    try {
      const centavos = recebido.trim()
        ? Math.round(Number(recebido.replace(',', '.')) * 100)
        : undefined;
      const r: any = await api.baixarAcerto(a.id, { recebidoCentavos: centavos });
      const dif = Number(r?.diferencaCentavos ?? 0);
      toast.success(
        dif === 0
          ? 'Acerto conferido e lançado no caixa.'
          : `Lançado com diferença de ${brl(Math.abs(dif))} ${dif < 0 ? 'a menos' : 'a mais'}.`,
      );
      setConferindo(null);
      setRecebido('');
      await carregar();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao dar baixa.');
    } finally {
      setSalvando(false);
    }
  }

  if (!lista.length) return null; // sem pendência, não ocupa espaço no caixa

  const total = lista.reduce((s, a) => s + Number(a.valorCentavos || 0), 0);

  return (
    <Card className="border-primary/40 p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <HandCoins className="h-4 w-4 text-primary" />
        <h3 className="font-display text-sm font-bold">A receber do salão</h3>
        <span className="text-xs text-muted-foreground">
          {lista.length} conta(s) · {brl(total)}
        </span>
      </div>
      <ul className="space-y-2">
        {lista.map((a) => (
          <li key={a.id} className="rounded-lg border border-border p-2.5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold">
                {a.mesa ? `Mesa ${a.mesa}` : 'Comanda'}
              </span>
              <span className="text-xs text-muted-foreground">
                {a.subPdvNome ?? '—'}
                {a.fechadoPorNome ? ` · ${a.fechadoPorNome}` : ''} · {hora(a.fechadoEm)}
              </span>
              <span className="ml-auto font-mono text-sm font-bold">{brl(a.valorCentavos)}</span>
              {a.forma && <span className="text-xs text-muted-foreground">{a.forma}</span>}
            </div>

            {conferindo === a.id ? (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <Input
                  value={recebido}
                  onChange={(e) => setRecebido(e.target.value)}
                  inputMode="decimal"
                  placeholder={`recebido (padrão ${(a.valorCentavos / 100).toFixed(2)})`}
                  className="h-8 w-48"
                  autoFocus
                />
                <Button type="button" size="sm" disabled={salvando} onClick={() => baixar(a)}>
                  {salvando ? 'Lançando…' : 'Confirmar e lançar'}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setConferindo(null);
                    setRecebido('');
                  }}
                >
                  Cancelar
                </Button>
              </div>
            ) : (
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="mt-2"
                onClick={() => {
                  setConferindo(a.id);
                  setRecebido('');
                }}
              >
                Receber e dar baixa
              </Button>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}
