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
const selectCls = 'flex h-11 w-full rounded-md border border-input bg-card px-3 text-sm';

export default function FiscalConfigPage() {
  const router = useRouter();
  const [f, setF] = useState<any>({ ambiente: '2', regime: 'simples', ativo: false });
  const [erro, setErro] = useState('');
  const [salvando, setSalvando] = useState(false);
  // cat resolvido no cliente (evita divergência de hidratação com o SSR).
  const [cat, setCat] = useState<string | null>(null);
  const isPresidente = cat === 'presidente';
  const [caixaLivre, setCaixaLivre] = useState<boolean | null>(null);

  const reload = useCallback(async () => {
    try {
      const [fc, cc] = await Promise.all([
        api.fiscalConfig(),
        api.caixaConfig().catch(() => ({ caixaLivre: false })),
      ]);
      setF(fc);
      setCaixaLivre(!!(cc as any).caixaLivre);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao carregar');
    }
  }, []);

  useEffect(() => {
    if (!getToken()) {
      router.replace('/entrar');
      return;
    }
    setCat(getCategoria());
    reload();
  }, [reload, router]);

  async function toggleCaixaLivre(ativo: boolean) {
    try {
      await api.setCaixaLivre(ativo);
      setCaixaLivre(ativo);
      toast.success(ativo ? 'Atendente pode sangrar/suprir sem gerente.' : 'Sangria/suprimento exige gerente.');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro ao salvar');
    }
  }

  const set = (patch: any) => setF((s: any) => ({ ...s, ...patch }));

  async function salvar() {
    setSalvando(true);
    try {
      await api.setFiscalConfig({
        ativo: f.ativo,
        ambiente: f.ambiente,
        regime: f.regime,
        crt: f.regime === 'simples' ? 1 : 3,
        serie: f.serie ? Number(f.serie) : 1,
        cnpj: f.cnpj,
        razaoSocial: f.razaoSocial,
        nomeFantasia: f.nomeFantasia,
        ie: f.ie,
        uf: f.uf,
        codigoUf: f.codigoUf ? Number(f.codigoUf) : undefined,
        codigoMunicipio: f.codigoMunicipio ? Number(f.codigoMunicipio) : undefined,
        endereco: f.endereco,
        cscId: f.cscId,
        cscToken: f.cscToken,
        certRef: f.certRef,
      });
      toast.success('Configuração fiscal salva.');
      await reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro ao salvar');
    } finally {
      setSalvando(false);
    }
  }

  if (cat === null) {
    return (
      <Shell eyebrow="Fiscal" title="Configuração fiscal">
        <p className="text-sm text-muted-foreground">Carregando…</p>
      </Shell>
    );
  }

  if (!isPresidente) {
    return (
      <Shell eyebrow="Fiscal" title="Configuração fiscal">
        <p className="text-sm text-muted-foreground">Acesso restrito ao presidente.</p>
      </Shell>
    );
  }

  return (
    <Shell eyebrow="Fiscal · NFC-e" title="Configuração fiscal">
      <div className="space-y-4">
        {erro && <p className="text-destructive">{erro}</p>}

        <Card className="border-warn/40 bg-warn/5 p-4 text-sm">
          <p className="font-semibold">Emissão SEFAZ direto (pronto para plugar)</p>
          <p className="mt-1 text-muted-foreground">
            Sem o certificado A1 configurado, o sistema opera em <b>homologação simulada</b>
            (valida o fluxo, sem valor fiscal). Para emitir de verdade: informe o certificado
            (referência), CSC e mantenha o ambiente em produção só após validar em homologação.
          </p>
        </Card>

        <Card className="space-y-4 p-4">
          <label className="flex items-center gap-2 text-sm font-medium">
            <input type="checkbox" checked={!!f.ativo} onChange={(e) => set({ ativo: e.target.checked })} className="h-4 w-4 accent-primary" />
            Emitir NFC-e automaticamente nas vendas desta unidade
          </label>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label className="text-xs">Ambiente</Label>
              <select aria-label="Ambiente" className={selectCls} value={f.ambiente} onChange={(e) => set({ ambiente: e.target.value })}>
                <option value="2">Homologação (teste)</option>
                <option value="1">Produção</option>
              </select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Regime tributário</Label>
              <select aria-label="Regime" className={selectCls} value={f.regime} onChange={(e) => set({ regime: e.target.value })}>
                <option value="simples">Simples Nacional</option>
                <option value="normal">Regime Normal</option>
              </select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Série</Label>
              <Input value={f.serie ?? ''} onChange={(e) => set({ serie: e.target.value })} placeholder="1" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">CNPJ</Label>
              <Input value={f.cnpj ?? ''} onChange={(e) => set({ cnpj: e.target.value })} placeholder="00.000.000/0000-00" />
            </div>
            <div className="space-y-1 sm:col-span-2">
              <Label className="text-xs">Razão social</Label>
              <Input value={f.razaoSocial ?? ''} onChange={(e) => set({ razaoSocial: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Nome fantasia</Label>
              <Input value={f.nomeFantasia ?? ''} onChange={(e) => set({ nomeFantasia: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Inscrição estadual</Label>
              <Input value={f.ie ?? ''} onChange={(e) => set({ ie: e.target.value })} placeholder="ISENTO" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">UF</Label>
              <Input value={f.uf ?? ''} onChange={(e) => set({ uf: e.target.value })} placeholder="SP" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Código IBGE da UF</Label>
              <Input value={f.codigoUf ?? ''} onChange={(e) => set({ codigoUf: e.target.value })} placeholder="35" />
            </div>
            <div className="space-y-1 sm:col-span-2">
              <Label className="text-xs">Código IBGE do município</Label>
              <Input value={f.codigoMunicipio ?? ''} onChange={(e) => set({ codigoMunicipio: e.target.value })} placeholder="3550308" />
            </div>
            <div className="space-y-1 sm:col-span-2">
              <Label className="text-xs">Endereço</Label>
              <Input value={f.endereco ?? ''} onChange={(e) => set({ endereco: e.target.value })} />
            </div>
          </div>

          <div className="border-t border-border pt-3">
            <p className="mb-2 text-xs font-semibold text-muted-foreground">Credenciais (NFC-e)</p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label className="text-xs">CSC — idToken</Label>
                <Input value={f.cscId ?? ''} onChange={(e) => set({ cscId: e.target.value })} placeholder="000001" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">CSC — token</Label>
                <Input value={f.cscToken ?? ''} onChange={(e) => set({ cscToken: e.target.value })} placeholder="•••• (segredo)" />
              </div>
              <div className="space-y-1 sm:col-span-2">
                <Label className="text-xs">Certificado A1 (referência no edge)</Label>
                <Input value={f.certRef ?? ''} onChange={(e) => set({ certRef: e.target.value })} placeholder="deixe vazio p/ homologação simulada" />
              </div>
            </div>
          </div>

          <Button type="button" onClick={salvar} disabled={salvando}>
            {salvando ? 'Salvando…' : 'Salvar configuração'}
          </Button>
        </Card>

        <Card className="p-4">
          <h2 className="mb-1 font-display text-sm font-bold">Autorização de caixa</h2>
          <p className="mb-2 text-xs text-muted-foreground">
            Define se o atendente pode fazer sangria/suprimento no caixa sem autorização de um gerente.
          </p>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={!!caixaLivre}
              onChange={(e) => toggleCaixaLivre(e.target.checked)}
              className="h-4 w-4 accent-primary"
              aria-label="Permitir sangria/suprimento pelo atendente"
            />
            Atendente pode fazer sangria/suprimento sem autorização
          </label>
        </Card>
      </div>
    </Shell>
  );
}
