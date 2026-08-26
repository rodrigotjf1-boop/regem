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

// Editor do perfil de pagamento de UM entregador (expansível). proprio=false → herda o padrão.
function PerfilEntregadorRow({ ent, onSalvo }: { ent: any; onSalvo: () => void }) {
  const [aberto, setAberto] = useState(false);
  const [d, setD] = useState({
    modelo: ent.modelo,
    diariaCentavos: ent.diariaCentavos,
    taxaEntregaCentavos: ent.taxaEntregaCentavos,
    taxaFixaCentavos: ent.taxaFixaCentavos,
  });
  const [salvando, setSalvando] = useState(false);
  const m = MODELOS.find((x) => x.k === d.modelo) ?? MODELOS[0];

  const salvar = async (usarPadrao = false) => {
    setSalvando(true);
    try {
      await api.entregadorPerfilSalvar({ colaboradorId: ent.colaboradorId, usarPadrao, ...d });
      toast.success(usarPadrao ? 'Voltou ao padrão da loja.' : 'Perfil salvo.');
      setAberto(false);
      onSalvo();
    } catch (e: any) {
      toast.error(e?.message ?? 'Erro ao salvar.');
    } finally {
      setSalvando(false);
    }
  };

  return (
    <div className="rounded-lg border">
      <button
        type="button"
        className="flex w-full items-center justify-between px-3 py-2 text-left"
        onClick={() => setAberto((v) => !v)}
        aria-expanded={aberto}
      >
        <span className="text-sm font-medium">🛵 {ent.nome}</span>
        <span className="flex items-center gap-2">
          <span
            className={
              'rounded-full px-2 py-0.5 text-xs ' +
              (ent.proprio ? 'bg-amber-100 text-amber-800' : 'bg-muted text-muted-foreground')
            }
          >
            {ent.proprio ? 'perfil próprio' : 'padrão da loja'}
          </span>
          <span className="text-xs text-muted-foreground">{MODELOS.find((x) => x.k === ent.modelo)?.t}</span>
        </span>
      </button>
      {aberto && (
        <div className="border-t p-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-sm sm:col-span-2">
              <span className="text-muted-foreground">Como este entregador é pago</span>
              <Select value={d.modelo} onChange={(e) => setD({ ...d, modelo: e.target.value })}>
                {MODELOS.map((x) => (
                  <option key={x.k} value={x.k}>
                    {x.t}
                  </option>
                ))}
              </Select>
            </label>
            {m.campos.diaria && (
              <MoedaInput label="Diária" centavos={d.diariaCentavos} onChange={(c) => setD({ ...d, diariaCentavos: c })} />
            )}
            {m.campos.taxa && (
              <MoedaInput
                label="Taxa por entrega"
                centavos={d.taxaEntregaCentavos}
                onChange={(c) => setD({ ...d, taxaEntregaCentavos: c })}
              />
            )}
            {m.campos.fixa && (
              <MoedaInput
                label={m.campos.fixaLabel ?? 'Valor fixo'}
                centavos={d.taxaFixaCentavos}
                onChange={(c) => setD({ ...d, taxaFixaCentavos: c })}
              />
            )}
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" onClick={() => salvar(false)} disabled={salvando}>
              {salvando ? 'Salvando…' : 'Salvar perfil'}
            </Button>
            {ent.proprio && (
              <Button size="sm" variant="outline" onClick={() => salvar(true)} disabled={salvando}>
                Voltar ao padrão da loja
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default function EntregadoresPage() {
  const podeConfig = ['presidente', 'gerente'].includes(getCategoria() ?? '');
  const [cfg, setCfg] = useState<any>(null);
  const [salvando, setSalvando] = useState(false);
  const [fech, setFech] = useState<any>(null);
  const [carregando, setCarregando] = useState(true);
  const [fechando, setFechando] = useState<string | null>(null);
  const [perfis, setPerfis] = useState<any>(null);

  const carregarCfg = useCallback(async () => {
    if (!podeConfig) return;
    try {
      setCfg(await api.entregadorPagamentoConfig());
      setPerfis(await api.entregadorPerfisPagamento());
    } catch {
      /* sem permissão / vazio */
    }
  }, [podeConfig]);

  const carregarFech = useCallback(async () => {
    setCarregando(true);
    try {
      setFech(await api.entregadorFechamento());
    } catch (e: any) {
      toast.error(e?.message ?? 'Erro ao carregar fechamento.');
    } finally {
      setCarregando(false);
    }
  }, []);

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
        baseTaxa: cfg.baseTaxa ?? 'real',
        periodicidade: cfg.periodicidade ?? 'dia',
        maxPedidosEntregador: cfg.maxPedidosEntregador ?? 1,
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
      const r: any = await api.entregadorFechar({ colaboradorId });
      toast.success(`Entregador pago — sangria de R$ ${((r?.total ?? 0) / 100).toFixed(2)} no caixa de entregas.`);
      carregarFech();
    } catch (e: any) {
      toast.error(e?.message ?? 'Erro ao pagar entregador.');
    } finally {
      setFechando(null);
    }
  };

  const modelo = MODELOS.find((m) => m.k === cfg?.modelo) ?? MODELOS[0];
  // fechamentoEntregadores retorna um ARRAY (uma linha por entregador, valores em centavos).
  const linhas: any[] = Array.isArray(fech) ? fech : (fech?.entregadores ?? []);
  const totalGeral = linhas.reduce((s, l) => s + Number(l.total ?? l.totalCentavos ?? 0), 0);

  return (
    <Shell>
      <div className="mx-auto w-full max-w-5xl px-4 py-6">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Delivery</p>
        <h1 className="text-2xl font-bold">Entregadores · pagamento</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Modelo de pagamento da loja e fechamento do dia (quanto pagar por entregador).
        </p>

        {podeConfig && (
          <p className="mt-2 rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
            O que o entregador vê no app (pedidos, ganhos, etc.) é configurado em{' '}
            <a href="/config/acessos" className="font-medium underline">
              Configurações → Acessos e perfis
            </a>{' '}
            → grupo <span className="font-medium">“Entregador (app)”</span>, no perfil que o entregador usa.
          </p>
        )}

        {/* Config = PADRÃO da loja — só presidente/gerente (valores = financeiro). */}
        {podeConfig && cfg && (
          <Card className="mt-4 p-4">
            <h2 className="mb-1 text-sm font-semibold">Modelo de pagamento — padrão da loja</h2>
            <p className="mb-3 text-xs text-muted-foreground">
              Vale para todo entregador que não tiver perfil próprio abaixo.
            </p>
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
              {modelo.campos.taxa && (
                <label className="flex flex-col gap-1 text-sm">
                  <span className="text-muted-foreground">Base da taxa por entrega</span>
                  <Select
                    value={cfg.baseTaxa ?? 'real'}
                    onChange={(e) => setCfg({ ...cfg, baseTaxa: e.target.value })}
                  >
                    <option value="real">Taxa real do pedido</option>
                    <option value="fixa">Valor fixo por entrega (campo acima)</option>
                  </Select>
                  <span className="text-xs text-muted-foreground">
                    “Real” repassa a taxa que o cliente pagou naquele pedido; “fixo” usa o valor de “Taxa por entrega”.
                  </span>
                </label>
              )}
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-muted-foreground">Período de fechamento</span>
                <Select
                  value={cfg.periodicidade ?? 'dia'}
                  onChange={(e) => setCfg({ ...cfg, periodicidade: e.target.value })}
                >
                  <option value="dia">Diário</option>
                  <option value="semana">Semanal (seg–dom)</option>
                  <option value="quinzena">Quinzenal (1–15 / 16–fim)</option>
                </Select>
              </label>
              {/* "Máx. de pedidos por entregador (saída)" foi movido para o painel de
                  Delivery (stepper "Lote/entregador", ao lado do Aceitar automaticamente),
                  para ajuste rápido por demanda. O valor continua salvo aqui (preservado). */}
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

        {/* Pagamento POR entregador — sobrepõe o padrão da loja. */}
        {podeConfig && perfis && (
          <Card className="mt-4 p-4">
            <h2 className="mb-1 text-sm font-semibold">Pagamento por entregador</h2>
            <p className="mb-3 text-xs text-muted-foreground">
              Cada entregador pode ter seu próprio modelo (ex.: um só diária, outro só taxas). Sem perfil
              próprio, herda o padrão da loja.
            </p>
            {(perfis.entregadores ?? []).length === 0 ? (
              <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
                Nenhum entregador cadastrado. Cadastre um colaborador com função “entregador”.
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                {(perfis.entregadores ?? []).map((ent: any) => (
                  <PerfilEntregadorRow key={ent.colaboradorId} ent={ent} onSalvo={carregarCfg} />
                ))}
              </div>
            )}
          </Card>
        )}

        {/* Fechamento do período (dia/semana/quinzena, conforme cada entregador). */}
        <Card className="mt-4 p-4">
          <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold">Fechamento e pagamento</h2>
              <p className="text-xs text-muted-foreground">
                Entregas concluídas e ainda não acertadas, no período de cada entregador (dia/semana/quinzena).
                Pagar registra o fechamento e gera a <span className="font-medium">sangria no caixa de entregas</span>.
              </p>
            </div>
          </div>

          {carregando ? (
            <p className="text-sm text-muted-foreground">Carregando…</p>
          ) : linhas.length === 0 ? (
            <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
              Nenhuma entrega pendente de acerto.
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
                        <td className="py-2 pr-3 text-right font-mono">{brl(l.diaria ?? l.diariaCentavos)}</td>
                        <td className="py-2 pr-3 text-right font-mono">{brl(l.taxas ?? l.taxasCentavos)}</td>
                        <td className="py-2 pr-3 text-right font-mono font-semibold">{brl(l.total ?? l.totalCentavos)}</td>
                        <td className="py-2 pl-3 text-right">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => fechar(l.colaboradorId)}
                            disabled={fechando === l.colaboradorId || Number(l.total ?? l.totalCentavos ?? 0) <= 0}
                          >
                            {fechando === l.colaboradorId ? '…' : 'Finalizar e pagar'}
                          </Button>
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
