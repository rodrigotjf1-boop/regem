'use client';

import { useEffect, useState } from 'react';
import { MonitorSmartphone } from 'lucide-react';
import {
  api,
  getTerminalAtual,
  getTerminalNome,
  setTerminalAtual,
  clearTerminal,
} from '@/lib/api';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from '@/lib/toast';

/* eslint-disable @typescript-eslint/no-explicit-any */

// Pareamento OBRIGATÓRIO do terminal de PDV: este PC só vende depois de colar o
// token do terminal (gerado pelo gestor em Configurações → Equipamentos). A
// identidade fica no localStorage e vai no header X-Terminal-Id de cada request.
export function TerminalGate({ children }: { children: React.ReactNode }) {
  const [pronto, setPronto] = useState(false);
  const [terminalId, setTerminalId] = useState<string | null>(null);
  const [token, setToken] = useState('');
  const [pareando, setPareando] = useState(false);

  useEffect(() => {
    const sync = () => setTerminalId(getTerminalAtual());
    sync();
    setPronto(true);
    window.addEventListener('regem:terminal', sync);
    return () => window.removeEventListener('regem:terminal', sync);
  }, []);

  async function parear() {
    if (!token.trim()) return toast.error('Cole o token do terminal.');
    setPareando(true);
    try {
      const r: any = await api.parearTerminal(token.trim());
      setTerminalAtual(r.id, r.nome);
      setToken('');
      toast.success(`Terminal "${r.nome}" pareado neste computador.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Token inválido');
    } finally {
      setPareando(false);
    }
  }

  if (!pronto) return null;

  if (!terminalId) {
    return (
      <div className="grid min-h-[50vh] place-items-center">
        <Card className="w-full max-w-md space-y-4 p-6 text-center">
          <MonitorSmartphone className="mx-auto h-10 w-10 text-primary" />
          <div>
            <h2 className="font-display text-lg font-bold">Parear este terminal</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Este computador ainda não está identificado como um caixa. Cole o token do
              terminal (gerado pelo gestor em <b>Configurações → Equipamentos</b>) para
              liberar as vendas.
            </p>
          </div>
          <div className="space-y-1.5 text-left">
            <Label className="text-xs">Token do terminal</Label>
            <Input
              value={token}
              onChange={(e) => setToken(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && parear()}
              placeholder="cole o token aqui"
              autoFocus
            />
          </div>
          <Button type="button" onClick={parear} disabled={pareando} className="w-full">
            {pareando ? 'Pareando…' : 'Parear e liberar o caixa'}
          </Button>
        </Card>
      </div>
    );
  }

  return (
    <>
      <div className="mb-3 flex items-center gap-2 text-xs text-muted-foreground">
        <MonitorSmartphone className="h-3.5 w-3.5 text-primary" />
        <span>
          Terminal: <b className="text-foreground">{getTerminalNome()}</b>
        </span>
        <button
          type="button"
          onClick={() => {
            if (confirm('Desparear este PC? Será preciso o token de novo para vender.'))
              clearTerminal();
          }}
          className="ml-1 underline hover:text-foreground"
        >
          trocar
        </button>
      </div>
      {children}
    </>
  );
}
