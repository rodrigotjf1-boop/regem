'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, getCategoria } from '@/lib/api';
import { toast } from '@/lib/toast';
import { Shell } from '@/components/app-shell/shell';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';

/* eslint-disable @typescript-eslint/no-explicit-any */
const brl = (c: number) =>
  (Number(c || 0) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const hojeLocal = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// Modelos de pagamento e quais campos cada um usa (rótulos claros por modelo).
const MODELOS: {
  k: string;
  t: string;
  campos: { diaria?: boolean; taxa?: boolean; fixa?: boolean; fixaLabel?: string };
}[] = [
  { k: 'diaria_taxas', t: 'Diária + taxa por entrega', campos: { diaria: true, taxa: true } },
  { k: 'so_diaria', t: 'Somente diária', campos: { diaria: true } },
  { k: 'so_taxas', t: 'Somente taxa por entrega', campos: { taxa: true } },
  { k: 'so_taxa_fixa', t: 'Somente valor fixo (por dia)', campos: { fixa: true, fixaLabel: 'Valor fixo por dia' } },
  {
    k: 'diaria_taxas_fixas',
    t: 'Diária + taxa fixa por entrega',
    campos: { diaria: true, fixa: true, fixaLabel: 'Taxa fixa por entrega' },
  },
];

// Input em reais ↔ centavos.
function MoedaInput({ label, centavos, onChange }: { label: string; centavos: number; onChange: (c: number) => void }) {
  const [txt, setTxt] = useState((centavos / 100).toFixed(2).replace('.', ','));
  useEffect(() => setTxt((centavos / 100).toFixed(2).replace('.', ',')), [centavos]);
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <div className="flex items-center gap-2">
        <span className="text-muted-foreground">R$</span>
        <Input
          inputMode="decimal"
          value={txt}
          onChange={(e) => {
            const v = e.target.value.replace(/[^\d,]/g, '');
            setTxt(v);
            const n = Math.round(parseFloat(v.replace(',', '.')) * 100);
            onChange(isFinite(n) ? n : 0);
          }}
        />
      </div>
    </label>
  );
}

export default function EntregadoresPage() {
  const podeConfig = ['presidente', 'gerente'].includes(getCategoria() ?? '');
  const [cfg, setCfg] = useState<any>(null);
  const [salvando, setSalvando] = useState(false);
  const [data, setData] = useState(hojeLocal());
  const [fech, setFech] = useState<any>(null);
  const [carregando, setCarregando] = useState(true);
  const [fechando, setFechando] = useState<string | null>(null);

  const carregarCfg = useCallback(async () => {
    if (!podeConfig) return;
    try {
      setCfg(await api.entregadorPagamentoConfig());
    } catch {
      /* sem permissão / vazio */
    }
  }, [podeConfig]);

  const carregarFech = useCallback(async () => {
    setCarregando(true);
    try {
      setFech(await api.entregadorFechamento(data));
    } catch (e: any) {
      toast.error(e?.message ?? 'Erro ao carregar fechamento.');
    } finally {
      setCarregando(false);
    }
  }, [data]);

  useEffect(() => {
    carregarCfg();
  }, [carregarCfg]);
  useEffect(() => {
    carregarFech();
  }, [carregarFech]);

  const salvarCfg = async () => {
    setSalvando(true);
    try {
      await api.entregadorPagamentoConfigSalvar({
        modelo: cfg.modelo,
        diariaCentavos: cfg.diariaCentavos,
        taxaEntregaCentavos: cfg.taxaEntregaCentavos,
        taxaFixaCentavos: cfg.taxaFixaCentavos,
        raioChegadaM: cfg.raioChegadaM ?? 70,
      });
      toast.success('Modelo de pagamento salvo.');
      carregarFech();
    } catch (e: any) {
      toast.error(e?.message ?? 'Erro ao salvar.');
    } finally {
      setSalvando(false);
    }
  };

  const fechar = async (colaboradorId: string) => {
    setFechando(colaboradorId);
    try {
      await api.entregadorFechar({ colaboradorId, data });
      toast.success('Fechamento registrado.');
      carregarFech();
    } catch (e: any) {
      toast.error(e?.message ?? 'Erro ao fechar.');
    } finally {
      setFechando(null);
    }
  };

  const modelo = MODELOS.find((m) => m.k === cfg?.modelo) ?? MODELOS[0];
  const linhas: any[] = fech?.entregadores ?? [];
  const totalGeral = linhas.reduce((s, l) => s + (l.pago ? 0 : Number(l.totalCentavos || 0)), 0);

  return (
    <Shell>
      <div className="mx-auto w-full max-w-5xl px-4 py-6">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Delivery</p>
        <h1 className="text-2xl font-bold">Entregadores · pagamento</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Modelo de pagamento da loja e fechamento do dia (quanto pagar por entregador).
        </p>

        {/* Config — só presidente/gerente (valores = financeiro). */}
        {podeConfig && cfg && (
          <Card className="mt-5 p-4">
            <h2 className="mb-3 text-sm font-semibold">Modelo de pagamento</h2>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <label className="flex flex-col gap-1 text-sm sm:col-span-2">
                <span className="text-muted-foreground">Como o entregador é pago</span>
                <Select value={cfg.modelo} onChange={(e) => setCfg({ ...cfg, modelo: e.target.value })}>
                  {MODELOS.map((m) => (
                    <option key={m.k} value={m.k}>
                      {m.t}
                    </option>
                  ))}
                </Select>
              </label>
              {modelo.campos.diaria && (
                <MoedaInput
                  label="Diária"
                  centavos={cfg.diariaCentavos}
                  onChange={(c) => setCfg({ ...cfg, diariaCentavos: c })}
                />
              )}
              {modelo.campos.taxa && (
                <MoedaInput
                  label="Taxa por entrega"
                  centavos={cfg.taxaEntregaCentavos}
                  onChange={(c) => setCfg({ ...cfg, taxaEntregaCentavos: c })}
                />
              )}
              {modelo.campos.fixa && (
                <MoedaInput
                  label={modelo.campos.fixaLabel ?? 'Valor fixo'}
                  centavos={cfg.taxaFixaCentavos}
                  onChange={(c) => setCfg({ ...cfg, taxaFixaCentavos: c })}
                />
              )}
              <label className="flex flex-col gap-1 text-sm sm:col-span-2">
                <span className="text-muted-foreground">Raio do aviso de chegada</span>
                <Select
                  value={String(cfg.raioChegadaM ?? 70)}
                  onChange={(e) => setCfg({ ...cfg, raioChegadaM: Number(e.target.value) })}
                >
                  {[70, 60, 40, 30, 20].map((m) => (
                    <option key={m} value={m}>
                      {m} metros
                    </option>
                  ))}
                </Select>
                <span className="text-xs text-muted-foreground">
                  Ao entrar nesse raio do endereço, o cliente é avisado automaticamente que o entregador está chegando.
                </span>
              </label>
            </div>
            <div className="mt-4">
              <Button onClick={salvarCfg} disabled={salvando}>
                {salvando ? 'Salvando…' : 'Salvar configurações'}
              </Button>
            </div>
          </Card>
        )}

        {/* Fechamento do dia. */}
        <Card className="mt-4 p-4">
          <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold">Fechamento do dia</h2>
              <p className="text-xs text-muted-foreground">Entregas concluídas e valor a pagar.</p>
            </div>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-muted-foreground">Dia</span>
              <Input type="date" value={data} max={hojeLocal()} onChange={(e) => setData(e.target.value)} />
            </label>
          </div>

          {carregando ? (
            <p className="text-sm text-muted-foreground">Carregando…</p>
          ) : linhas.length === 0 ? (
            <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
              Nenhuma entrega concluída neste dia.
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <caption className="sr-only">Fechamento de pagamento dos entregadores</caption>
                  <thead>
                    <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                      <th className="py-2 pr-3">Entregador</th>
                      <th className="py-2 pr-3 text-right">Entregas</th>
                      <th className="py-2 pr-3 text-right">Diária</th>
                      <th className="py-2 pr-3 text-right">Taxas</th>
                      <th className="py-2 pr-3 text-right">Total</th>
                      <th className="py-2 pl-3 text-right">Ação</th>
                    </tr>
                  </thead>
                  <tbody>
                    {linhas.map((l) => (
                      <tr key={l.colaboradorId} className="border-b last:border-0">
                        <td className="py-2 pr-3 font-medium">🛵 {l.nome}</td>
                        <td className="py-2 pr-3 text-right font-mono">{l.entregas}</td>
                        <td className="py-2 pr-3 text-right font-mono">{brl(l.diariaCentavos)}</td>
                        <td className="py-2 pr-3 text-right font-mono">{brl(l.taxasCentavos)}</td>
                        <td className="py-2 pr-3 text-right font-mono font-semibold">{brl(l.totalCentavos)}</td>
                        <td className="py-2 pl-3 text-right">
                          {l.pago ? (
                            <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700">
                              Pago
                            </span>
                          ) : (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => fechar(l.colaboradorId)}
                              disabled={fechando === l.colaboradorId}
                            >
                              {fechando === l.colaboradorId ? '…' : 'Fechar'}
                            </Button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="mt-3 flex justify-end text-sm">
                <span className="text-muted-foreground">A pagar (pendente):&nbsp;</span>
                <span className="font-mono font-semibold">{brl(totalGeral)}</span>
              </div>
            </>
          )}
        </Card>
      </div>
    </Shell>
  );
}
