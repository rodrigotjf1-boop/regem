'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import QRCode from 'qrcode';
import { api, getToken, getCategoria } from '@/lib/api';
import { toast } from '@/lib/toast';
import { Shell } from '@/components/app-shell/shell';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

/* eslint-disable @typescript-eslint/no-explicit-any */
const selectCls = 'flex h-11 w-full rounded-md border border-input bg-card px-3 text-sm';

export default function CardapioConfigPage() {
  const router = useRouter();
  const isGestor = ['presidente', 'gerente'].includes(getCategoria() ?? '');
  const [cfg, setCfg] = useState<any>({ ativo: false, modo: 'mesa', token: null });
  const [mesaNum, setMesaNum] = useState('');
  const [qr, setQr] = useState('');
  const [salvando, setSalvando] = useState(false);

  const reload = useCallback(async () => {
    try {
      setCfg(await api.cardapioConfig());
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro ao carregar');
    }
  }, []);

  useEffect(() => {
    if (!getToken()) {
      router.replace('/entrar');
      return;
    }
    reload();
  }, [reload, router]);

  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const link =
    cfg.token
      ? `${origin}/c/${cfg.token}${cfg.modo === 'mesa' && mesaNum ? `?mesa=${mesaNum}` : ''}`
      : '';

  useEffect(() => {
    if (!link) {
      setQr('');
      return;
    }
    QRCode.toDataURL(link, { width: 240, margin: 1 }).then(setQr).catch(() => setQr(''));
  }, [link]);

  const set = (patch: any) => setCfg((s: any) => ({ ...s, ...patch }));

  async function salvar() {
    setSalvando(true);
    try {
      setCfg(await api.setCardapioConfig({ ativo: cfg.ativo, modo: cfg.modo, nomePublico: cfg.nomePublico }));
      toast.success('Cardápio salvo.');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro ao salvar');
    } finally {
      setSalvando(false);
    }
  }

  if (!isGestor) {
    return (
      <Shell eyebrow="Cardápio" title="Cardápio digital">
        <p className="text-sm text-muted-foreground">Acesso restrito à gerência.</p>
      </Shell>
    );
  }

  return (
    <Shell eyebrow="Cardápio · QR" title="Cardápio digital">
      <div className="max-w-2xl space-y-4">
        <Card className="space-y-4 p-4">
          <label className="flex items-center gap-2 text-sm font-medium">
            <input type="checkbox" checked={!!cfg.ativo} onChange={(e) => set({ ativo: e.target.checked })} className="h-4 w-4 accent-primary" />
            Cardápio digital ativo
          </label>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label className="text-xs">Modo</Label>
              <select aria-label="Modo do cardápio" className={selectCls} value={cfg.modo} onChange={(e) => set({ modo: e.target.value })}>
                <option value="mesa">Mesa (QR na mesa → vai para a comanda)</option>
                <option value="retirada">Retirada (pedido cai no delivery p/ aceitar)</option>
                <option value="totem">Totem (autoatendimento)</option>
              </select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Nome público</Label>
              <Input value={cfg.nomePublico ?? ''} onChange={(e) => set({ nomePublico: e.target.value })} placeholder="Ex.: Cardápio do Bar" />
            </div>
          </div>
          <Button type="button" onClick={salvar} disabled={salvando}>
            {salvando ? 'Salvando…' : cfg.token ? 'Salvar' : 'Gerar cardápio'}
          </Button>
        </Card>

        {cfg.token && (
          <Card className="space-y-3 p-4">
            <h2 className="font-display text-sm font-bold">Link & QR Code</h2>
            {cfg.modo === 'mesa' && (
              <div className="flex items-end gap-2">
                <div className="space-y-1">
                  <Label className="text-xs">Número da mesa (para o QR)</Label>
                  <Input value={mesaNum} onChange={(e) => setMesaNum(e.target.value)} placeholder="Ex.: 12" className="w-32" />
                </div>
              </div>
            )}
            <div className="flex flex-wrap items-center gap-4">
              {qr && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={qr} alt="QR Code do cardápio" width={200} height={200} className="rounded-lg border border-border" />
              )}
              <div className="min-w-0 flex-1 space-y-2">
                <code className="block break-all rounded-md bg-secondary px-3 py-2 text-xs">{link}</code>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={async () => {
                    await navigator.clipboard.writeText(link);
                    toast.success('Link copiado.');
                  }}
                >
                  Copiar link
                </Button>
                <p className="text-xs text-muted-foreground">
                  {cfg.modo === 'mesa'
                    ? 'Gere um QR por mesa (troque o número acima) e cole em cada mesa.'
                    : 'Imprima o QR no balcão / totem para o cliente pedir pelo celular.'}
                </p>
              </div>
            </div>
          </Card>
        )}
      </div>
    </Shell>
  );
}
