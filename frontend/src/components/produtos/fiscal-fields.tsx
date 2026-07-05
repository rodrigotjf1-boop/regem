'use client';

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

/* eslint-disable @typescript-eslint/no-explicit-any */

export function FiscalFields({
  f,
  set,
}: {
  f: any;
  set: (patch: any) => void;
}) {
  return (
    <details className="rounded-lg border border-border p-3">
      <summary className="cursor-pointer text-xs font-semibold text-muted-foreground">
        Fiscal (NFC-e) — NCM, CFOP, tributação
      </summary>
      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
        <div className="space-y-1">
          <Label className="text-xs">NCM</Label>
          <Input value={f.ncm} onChange={(e) => set({ ncm: e.target.value })} placeholder="21069090" />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">CFOP</Label>
          <Input value={f.cfop} onChange={(e) => set({ cfop: e.target.value })} placeholder="5102" />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Origem</Label>
          <Input value={f.origem} onChange={(e) => set({ origem: e.target.value })} placeholder="0" />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">CSOSN (Simples)</Label>
          <Input value={f.csosn} onChange={(e) => set({ csosn: e.target.value })} placeholder="102" />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">CST ICMS (Normal)</Label>
          <Input value={f.cstIcms} onChange={(e) => set({ cstIcms: e.target.value })} placeholder="—" />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">GTIN / EAN</Label>
          <Input value={f.gtin} onChange={(e) => set({ gtin: e.target.value })} placeholder="cód. de barras" />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">CST PIS</Label>
          <Input value={f.cstPis} onChange={(e) => set({ cstPis: e.target.value })} placeholder="07" />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Alíq. PIS %</Label>
          <Input type="number" value={f.aliqPis} onChange={(e) => set({ aliqPis: e.target.value })} placeholder="0" />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">CST COFINS</Label>
          <Input value={f.cstCofins} onChange={(e) => set({ cstCofins: e.target.value })} placeholder="07" />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Alíq. COFINS %</Label>
          <Input type="number" value={f.aliqCofins} onChange={(e) => set({ aliqCofins: e.target.value })} placeholder="0" />
        </div>
      </div>
      <p className="mt-2 text-[11px] text-muted-foreground">NCM é obrigatório para emitir NFC-e.</p>
    </details>
  );
}
