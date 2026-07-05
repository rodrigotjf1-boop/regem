'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, getToken, getCategoria } from '@/lib/api';
import { toast } from '@/lib/toast';
import { Shell } from '@/components/app-shell/shell';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

/* eslint-disable @typescript-eslint/no-explicit-any */
const brl = (n: number) =>
  Number(n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export default function CaixaPage() {
  const router = useRouter();
  const [sessao, setSessao] = useState<any>(null);
  const [carregou, setCarregou] = useState(false);
  const [erro, setErro] = useState('');

  const [abertura, setAbertura] = useState('');
  const [movTipo, setMovTipo] = useState<'sangria' | 'suprimento'>('sangria');
  const [movValor, setMovValor] = useState('');
  const [movDesc, setMovDesc] = useState('');
  const [informado, setInformado] = useState('');
  const [obs, setObs] = useState('');
  const [resultado, setResultado] = useState<any>(null);
  const [caixaLivre, setCaixaLivre] = useState<boolean | null>(null);
  const isPresidente = getCategoria() === 'presidente';

  const carregar = useCallback(async () => {
    setErro('');
    try {
      const [s, cfg] = await Promise.all([
        api.caixaAberta(),
        api.caixaConfig().catch(() => ({ caixaLivre: false })),
      ]);
      setSessao(s);
      setCaixaLivre(!!(cfg as any).caixaLivre);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao carregar');
    } finally {
      setCarregou(true);
    }
  }, []);

  async function toggleLivre(ativo: boolean) {
    try {
      await api.setCaixaLivre(ativo);
      setCaixaLivre(ativo);
      toast.success(ativo ? 'Atendente pode sangrar/suprir.' : 'Sangria/suprimento exige gerente.');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro ao salvar');
    }
  }

  useEffect(() => {
    if (!getToken()) {
      router.replace('/entrar');
      return;
    }
    carregar();
  }, [carregar, router]);

  async function abrir() {
    try {
      await api.abrirCaixa({ valorAbertura: Number(String(abertura).replace(',', '.')) || 0 });
      setAbertura('');
      setResultado(null);
      await carregar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao abrir');
    }
  }
  async function movimentar() {
    if (!movValor) return;
    try {
      await api.movimentarCaixa({
        tipo: movTipo,
        valor: Number(String(movValor).replace(',', '.')) || 0,
        descricao: movDesc || undefined,
      });
      setMovValor('');
      setMovDesc('');
      await carregar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro na movimentação');
    }
  }
  async function fechar() {
    if (informado === '') {
      setErro('Informe o valor contado.');
      return;
    }
    try {
      const r: any = await api.fecharCaixa({
        valorInformado: Number(String(informado).replace(',', '.')) || 0,
        obs: obs || undefined,
      });
      setResultado(r);
      setInformado('');
      setObs('');
      await carregar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao fechar');
    }
  }

  return (
    <Shell eyebrow="Financeiro · caixa" title="Caixa">
      <div className="max-w-lg space-y-4">
        {erro && <p className="text-destructive">{erro}</p>}

        {/* Resultado do último fechamento (cego) */}
        {resultado && (
          <Card className="border-primary/40 bg-primary/5 p-5 text-center">
            <p className="font-display font-bold">Caixa fechado</p>
            <div className="mt-3 grid grid-cols-3 gap-2 text-sm">
              <div>
                <p className="text-xs text-muted-foreground">Esperado</p>
                <p className="font-mono font-bold">{brl(resultado.esperado)}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Contado</p>
                <p className="font-mono font-bold">{brl(resultado.informado)}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Diferença</p>
                <p
                  className="font-mono font-bold"
                  style={{
                    color:
                      resultado.diferenca === 0
                        ? 'hsl(var(--ok))'
                        : 'hsl(var(--destructive))',
                  }}
                >
                  {brl(resultado.diferenca)}
                </p>
              </div>
            </div>
            {(resultado.porForma ?? []).length > 0 && (
              <div className="mt-4 border-t border-border pt-3 text-left">
                <p className="mb-1 text-xs font-semibold text-muted-foreground">Vendas por forma</p>
                <div className="space-y-0.5">
                  {resultado.porForma.map((f: any) => (
                    <div key={f.forma} className="flex justify-between text-sm">
                      <span className="capitalize">{f.forma}</span>
                      <span className="font-mono">{brl(f.total)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </Card>
        )}

        {/* Config (presidente): liberar sangria/suprimento pelo atendente */}
        {isPresidente && (
          <Card className="p-4">
            <h2 className="mb-1 font-display text-sm font-bold">Autorização de caixa</h2>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={!!caixaLivre}
                onChange={(e) => toggleLivre(e.target.checked)}
                className="h-4 w-4 accent-primary"
                aria-label="Permitir sangria/suprimento pelo atendente"
              />
              Atendente pode fazer sangria/suprimento sem autorização
            </label>
          </Card>
        )}

        {!carregou ? (
          <p className="text-sm text-muted-foreground">Carregando…</p>
        ) : !sessao ? (
          <Card className="space-y-3 p-5">
            <h2 className="font-display font-semibold">Abrir caixa</h2>
            <div className="space-y-1">
              <Label htmlFor="ab" className="text-xs">Valor de abertura (fundo de troco)</Label>
              <Input id="ab" type="number" value={abertura} onChange={(e) => setAbertura(e.target.value)} placeholder="0,00" />
            </div>
            <Button type="button" onClick={abrir}>Abrir caixa</Button>
          </Card>
        ) : (
          <>
            <Card className="p-5">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-display font-semibold">Caixa aberto</p>
                  <p className="text-xs text-muted-foreground">
                    desde {new Date(sessao.abertaEm).toLocaleString('pt-BR')}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-xs text-muted-foreground">Abertura</p>
                  <p className="font-mono font-bold">{brl(Number(sessao.valorAbertura))}</p>
                </div>
              </div>
            </Card>

            {/* Sangria / suprimento */}
            <Card className="space-y-3 p-5">
              <h2 className="font-display text-sm font-bold">Sangria / suprimento</h2>
              <div className="flex gap-1.5">
                {(['sangria', 'suprimento'] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setMovTipo(t)}
                    className={`rounded-md border px-3 py-1.5 text-sm font-medium capitalize ${movTipo === t ? 'border-primary bg-primary/15 text-primary' : 'border-border'}`}
                  >
                    {t}
                  </button>
                ))}
              </div>
              <div className="flex gap-2">
                <Input type="number" value={movValor} onChange={(e) => setMovValor(e.target.value)} placeholder="Valor" />
                <Input value={movDesc} onChange={(e) => setMovDesc(e.target.value)} placeholder="Descrição (opcional)" />
              </div>
              <Button type="button" variant="outline" onClick={movimentar}>Registrar</Button>
            </Card>

            {/* Fechamento cego */}
            <Card className="space-y-3 p-5">
              <h2 className="font-display text-sm font-bold">Fechar caixa (cego)</h2>
              <p className="text-xs text-muted-foreground">
                Conte o dinheiro da gaveta e informe o total. O sistema compara com o esperado.
              </p>
              <div className="space-y-1">
                <Label htmlFor="inf" className="text-xs">Valor contado (dinheiro)</Label>
                <Input id="inf" type="number" value={informado} onChange={(e) => setInformado(e.target.value)} placeholder="0,00" />
              </div>
              <Input value={obs} onChange={(e) => setObs(e.target.value)} placeholder="Observação (opcional)" />
              <Button type="button" onClick={fechar}>Fechar caixa</Button>
            </Card>
          </>
        )}
      </div>
    </Shell>
  );
}
