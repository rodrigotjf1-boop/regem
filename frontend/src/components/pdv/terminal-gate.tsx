'use client';

import { useEffect, useState } from 'react';
import { MonitorSmartphone, RefreshCw } from 'lucide-react';
import {
  api,
  getTerminalAtual,
  getTerminalNome,
  setTerminalAtual,
  clearTerminal,
  terminalSuspenso,
  tentarTerminalAgora,
  type SuspensaoDoTerminal,
} from '@/lib/api';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from '@/lib/toast';

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Com o caixa ainda não reconhecido, o PDV reconfere sozinho a cada tanto (o aviso de presença faz o mesmo no servidor da loja). */
const RECONFERIR_MS = 30_000;

// Pareamento OBRIGATÓRIO do terminal de PDV: este PC só vende depois de colar o
// token do terminal (gerado pelo gestor em Configurações → Equipamentos). A
// identidade fica no localStorage e vai no header X-Terminal-Id de cada request.
//
// Parear sem reinstalar (pedido do dono de 22/10/2026): quando o servidor ainda não reconhece este caixa (o servidor
// recém-reinstalado trazendo o cadastro da nuvem, ou o caixa pareado de novo noutro PC), o pareamento NÃO é apagado: a
// tela mostra "Reconhecendo este caixa", reconfere sozinha e volta às vendas quando o servidor o reconhece. Só a
// revogação apaga (e aí volta a pedir o código). Nada de vender sem o caixa identificado enquanto isso.
export function TerminalGate({ children }: { children: React.ReactNode }) {
  const [pronto, setPronto] = useState(false);
  const [terminalId, setTerminalId] = useState<string | null>(null);
  const [suspenso, setSuspenso] = useState<SuspensaoDoTerminal | null>(null);
  const [token, setToken] = useState('');
  const [pareando, setPareando] = useState(false);
  const [conferindo, setConferindo] = useState(false);
  const [codigoNovo, setCodigoNovo] = useState(false);

  useEffect(() => {
    const sync = () => {
      setTerminalId(getTerminalAtual());
      setSuspenso(terminalSuspenso());
    };
    sync();
    setPronto(true);
    window.addEventListener('regem:terminal', sync);
    return () => window.removeEventListener('regem:terminal', sync);
  }, []);

  // Suspenso: reconfere sozinho (a chamada leva o terminal; se o servidor o reconhecer, a suspensão acaba).
  useEffect(() => {
    if (!suspenso) return;
    const t = setInterval(() => void reconferir(false), RECONFERIR_MS);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!suspenso]);

  async function reconferir(peloBotao: boolean) {
    if (conferindo) return;
    setConferindo(true);
    tentarTerminalAgora();
    try {
      await api.edgePresenca();
      if (peloBotao && !terminalSuspenso()) toast.success('Caixa reconhecido pelo servidor.');
    } catch {
      /* segue suspenso: a mensagem da tela já diz o que fazer */
    } finally {
      setConferindo(false);
    }
  }

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
      setCodigoNovo(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Código inválido ou expirado');
    } finally {
      setPareando(false);
    }
  }

  const campoDoCodigo = (
    <>
      <div className="space-y-1.5 text-left">
        <Label htmlFor="codigo-terminal" className="text-xs">Código do terminal</Label>
        <Input
          id="codigo-terminal"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && parear()}
          placeholder="000000"
          inputMode="numeric"
          autoComplete="off"
          autoFocus
        />
        <p className="text-[11px] text-muted-foreground">
          O código vale por 15 minutos e só pode ser usado uma vez.
        </p>
      </div>
      <Button type="button" onClick={parear} disabled={pareando} className="w-full">
        {pareando ? 'Pareando…' : 'Parear e liberar o caixa'}
      </Button>
    </>
  );

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
          {campoDoCodigo}
        </Card>
      </div>
    );
  }

  if (suspenso) {
    const nome = getTerminalNome() || 'este caixa';
    return (
      <div className="grid min-h-[50vh] place-items-center">
        <Card className="w-full max-w-md space-y-4 p-6 text-center" role="status" aria-live="polite">
          <RefreshCw className="mx-auto h-10 w-10 text-primary motion-safe:animate-spin [animation-duration:2.5s]" aria-hidden="true" />
          <div>
            <h2 className="font-display text-lg font-bold">Reconhecendo este caixa</h2>
            {suspenso.code === 'LOJA_CARREGANDO' ? (
              <p className="mt-1 text-sm text-muted-foreground">
                O servidor da loja está carregando o cadastro da nuvem (acabou de ser reinstalado ou atualizado). O caixa
                “{nome}” volta sozinho em instantes — não precisa parear de novo.
              </p>
            ) : (
              <p className="mt-1 text-sm text-muted-foreground">
                O servidor não reconheceu o caixa “{nome}”. Se ele acabou de ser reinstalado, espere alguns minutos: o caixa
                volta sozinho quando o cadastro chegar da nuvem. Se continuar, peça um código novo ao gestor
                (<b>Configurações → Equipamentos</b> → {nome} → <b>Gerar código</b>) e digite abaixo.
              </p>
            )}
            <p className="mt-2 text-xs text-muted-foreground">As vendas ficam paradas até o servidor reconhecer o caixa. Conferindo de novo a cada 30 segundos.</p>
          </div>
          <Button type="button" variant="outline" className="w-full" onClick={() => void reconferir(true)} disabled={conferindo}>
            {conferindo ? 'Conferindo…' : 'Tentar agora'}
          </Button>
          {codigoNovo ? (
            campoDoCodigo
          ) : (
            <button type="button" className="text-sm underline hover:text-foreground" aria-expanded={false} onClick={() => setCodigoNovo(true)}>
              Parear com um código novo
            </button>
          )}
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
