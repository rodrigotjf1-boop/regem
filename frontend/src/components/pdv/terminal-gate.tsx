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

  // Pareia por CÓDIGO de 6 dígitos (mig 142) — o gestor gera em Equipamentos e
  // dita por telefone. O PC recebe um segredo que passa a identificá-lo. Um token
  // longo colado ainda funciona, para quem já configurava assim.
  async function parear() {
    const v = token.trim();
    if (!v) return toast.error('Digite o código de 6 dígitos do terminal.');
    setPareando(true);
    try {
      const soDigitos = v.replace(/\D/g, '');
      if (soDigitos.length === 6) {
        const r: any = await api.parearPorCodigo(soDigitos);
        setTerminalAtual(r.terminalId, r.nome, r.segredo);
        toast.success(`Terminal "${r.nome}" pareado neste computador.`);
      } else {
        const r: any = await api.parearTerminal(v);
        setTerminalAtual(r.id, r.nome);
        toast.success(`Terminal "${r.nome}" pareado neste computador.`);
      }
      setToken('');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Código inválido ou expirado');
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
              Este computador ainda não está identificado como um caixa. Peça ao gestor o
              código de 6 dígitos em <b>Configurações → Equipamentos</b> e digite abaixo
              para liberar as vendas.
            </p>
          </div>
          <div className="space-y-1.5 text-left">
            <Label className="text-xs">Código do terminal</Label>
            <Input
              value={token}
              onChange={(e) => setToken(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && parear()}
              placeholder="000000"
              inputMode="numeric"
              autoFocus
            />
            <p className="text-[11px] text-muted-foreground">
              O código vale por 15 minutos e só pode ser usado uma vez.
            </p>
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
