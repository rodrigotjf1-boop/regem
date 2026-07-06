'use client';

import { useState } from 'react';
import { api } from '@/lib/api';
import { toast } from '@/lib/toast';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

/* eslint-disable @typescript-eslint/no-explicit-any */
const brl = (n: number) =>
  Number(n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

// Painel de caixa/turno do PDV: abrir · sangria · suprimento · fechar (cego).
// O turno pertence ao operador que abriu (o backend trava sangria/fecho).
export function CaixaPanel({ caixa, onChange }: { caixa: any; onChange: () => void }) {
  const [busy, setBusy] = useState(false);
  const [mov, setMov] = useState<null | 'sangria' | 'suprimento'>(null);
  const [movValor, setMovValor] = useState('');
  const [movDesc, setMovDesc] = useState('');
  const [fechar, setFechar] = useState(false);
  const [informado, setInformado] = useState('');
  const [obs, setObs] = useState('');
  const [resultado, setResultado] = useState<any>(null);

  async function abrir() {
    const v = prompt('Valor de abertura (troco inicial) do caixa:', '0');
    if (v === null) return;
    setBusy(true);
    try {
      await api.abrirCaixa({ valorAbertura: Number(String(v).replace(',', '.')) || 0 });
      toast.success('Turno aberto.');
      onChange();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro ao abrir o caixa');
    } finally {
      setBusy(false);
    }
  }

  async function confirmarMov() {
    const valor = Number(String(movValor).replace(',', '.')) || 0;
    if (valor <= 0) return toast.error('Informe um valor válido.');
    setBusy(true);
    try {
      await api.movimentarCaixa({ tipo: mov, valor, descricao: movDesc.trim() || undefined });
      toast.success(mov === 'sangria' ? 'Sangria registrada.' : 'Suprimento registrado.');
      setMov(null);
      setMovValor('');
      setMovDesc('');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro ao movimentar o caixa');
    } finally {
      setBusy(false);
    }
  }

  async function confirmarFechar() {
    setBusy(true);
    try {
      const r: any = await api.fecharCaixa({
        valorInformado: Number(String(informado).replace(',', '.')) || 0,
        obs: obs.trim() || undefined,
      });
      setResultado(r);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro ao fechar o caixa');
    } finally {
      setBusy(false);
    }
  }

  function encerrarConferencia() {
    setFechar(false);
    setResultado(null);
    setInformado('');
    setObs('');
    onChange(); // caixa fechado → o pai recarrega (volta a "abrir")
  }

  // ----- Caixa fechado: CTA de abrir turno -----
  if (!caixa) {
    return (
      <div className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-warn/40 bg-warn/10 px-4 py-3">
        <span className="text-sm font-semibold text-warn">⚠️ Nenhum turno aberto — abra o caixa para vender.</span>
        <Button type="button" size="sm" onClick={abrir} disabled={busy} className="ml-auto">
          {busy ? 'Abrindo…' : 'Abrir turno'}
        </Button>
      </div>
    );
  }

  // ----- Turno aberto: info + ações -----
  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-ok/40 bg-ok/10 px-4 py-2.5">
        <span className="text-sm font-bold text-ok">
          🟢 Turno {String(caixa.turnoNumero ?? '—').padStart(2, '0')}
        </span>
        {caixa.operadorNome && <span className="text-xs font-semibold">Operador: {caixa.operadorNome}</span>}
        {caixa.abertaEm && (
          <span className="text-xs text-muted-foreground">desde {new Date(caixa.abertaEm).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</span>
        )}
        <div className="ml-auto flex flex-wrap gap-1.5">
          <Button type="button" size="sm" variant="outline" onClick={() => setMov('suprimento')}>Suprimento</Button>
          <Button type="button" size="sm" variant="outline" onClick={() => setMov('sangria')}>Sangria</Button>
          <Button type="button" size="sm" variant="outline" onClick={() => setFechar(true)}>Fechar turno</Button>
        </div>
      </div>

      {/* Modal sangria/suprimento */}
      {mov && (
        <div className="fixed inset-0 z-40 grid place-items-center bg-black/50 p-4" onClick={() => setMov(null)}>
          <Card className="w-full max-w-sm p-5" onClick={(e) => e.stopPropagation()}>
            <h3 className="mb-3 font-display font-semibold capitalize">{mov} (dinheiro)</h3>
            <div className="space-y-3">
              <div className="space-y-1">
                <Label className="text-xs">Valor</Label>
                <Input type="number" inputMode="decimal" value={movValor} onChange={(e) => setMovValor(e.target.value)} placeholder="0,00" autoFocus />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Descrição (opcional)</Label>
                <Input value={movDesc} onChange={(e) => setMovDesc(e.target.value)} placeholder={mov === 'sangria' ? 'Ex.: retirada p/ cofre' : 'Ex.: troco extra'} />
              </div>
            </div>
            <div className="mt-4 flex gap-2">
              <Button type="button" variant="ghost" className="flex-1" onClick={() => setMov(null)}>Cancelar</Button>
              <Button type="button" className="flex-1" onClick={confirmarMov} disabled={busy}>{busy ? '…' : 'Confirmar'}</Button>
            </div>
          </Card>
        </div>
      )}

      {/* Modal fechar (cego) + resultado */}
      {fechar && (
        <div className="fixed inset-0 z-40 grid place-items-center overflow-y-auto bg-black/50 p-4" onClick={() => (resultado ? encerrarConferencia() : setFechar(false))}>
          <Card className="w-full max-w-sm p-5" onClick={(e) => e.stopPropagation()}>
            {!resultado ? (
              <>
                <h3 className="font-display font-semibold">Fechar turno {String(caixa.turnoNumero ?? '').padStart(2, '0')}</h3>
                <p className="mb-3 mt-0.5 text-xs text-muted-foreground">Conte o dinheiro na gaveta e informe o total (conferência cega).</p>
                <div className="space-y-3">
                  <div className="space-y-1">
                    <Label className="text-xs">Dinheiro contado na gaveta</Label>
                    <Input type="number" inputMode="decimal" value={informado} onChange={(e) => setInformado(e.target.value)} placeholder="0,00" autoFocus />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Observação (opcional)</Label>
                    <Input value={obs} onChange={(e) => setObs(e.target.value)} placeholder="Ex.: falta de troco no início" />
                  </div>
                </div>
                <div className="mt-4 flex gap-2">
                  <Button type="button" variant="ghost" className="flex-1" onClick={() => setFechar(false)}>Cancelar</Button>
                  <Button type="button" className="flex-1" onClick={confirmarFechar} disabled={busy}>{busy ? '…' : 'Fechar turno'}</Button>
                </div>
              </>
            ) : (
              <>
                <h3 className="font-display font-semibold text-ok">Turno encerrado ✓</h3>
                <div className="mt-3 space-y-1.5 text-sm">
                  <div className="flex justify-between"><span className="text-muted-foreground">Esperado em gaveta</span><span className="font-mono">{brl(resultado.esperado)}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Contado</span><span className="font-mono">{brl(resultado.informado)}</span></div>
                  <div className={`flex justify-between font-bold ${Math.abs(resultado.diferenca) < 0.01 ? 'text-ok' : 'text-destructive'}`}>
                    <span>Diferença</span>
                    <span className="font-mono">{resultado.diferenca > 0 ? '+' : ''}{brl(resultado.diferenca)}</span>
                  </div>
                </div>
                {(resultado.porForma ?? []).length > 0 && (
                  <div className="mt-3 border-t border-border pt-2">
                    <p className="mb-1 text-xs font-semibold text-muted-foreground">Vendas por forma</p>
                    {resultado.porForma.map((f: any) => (
                      <div key={f.forma} className="flex justify-between text-xs"><span className="capitalize">{f.forma}</span><span className="font-mono">{brl(f.total)}</span></div>
                    ))}
                  </div>
                )}
                <Button type="button" className="mt-4 w-full" onClick={encerrarConferencia}>Concluir</Button>
              </>
            )}
          </Card>
        </div>
      )}
    </>
  );
}
