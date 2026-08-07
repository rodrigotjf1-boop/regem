'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, getToken, getCategoria } from '@/lib/api';
import { toast } from '@/lib/toast';
import { Shell } from '@/components/app-shell/shell';
import { CupomLayoutEditor, CupomPerfilEditor, Impressoras } from '@/components/delivery/config-panel';

/* eslint-disable @typescript-eslint/no-explicit-any */

// Impressoras e cupons — movido de Delivery → Configurações para o menu
// Configurações (é config de operação, não só do delivery). Junta o cabeçalho/
// rodapé, os perfis de cupom e o cadastro de impressoras.
export default function ImpressaoPage() {
  const router = useRouter();
  const [cat, setCat] = useState<string | null>(null);
  const [cfg, setCfg] = useState<any>({});
  const [impressoras, setImpressoras] = useState<any[]>([]);
  const [setores, setSetores] = useState<any[]>([]);
  const isGestor = ['presidente', 'gerente', 'supervisao'].includes(cat ?? '');

  const reload = useCallback(async () => {
    const [c, imp, ss] = await Promise.all([
      api.deliveryConfig().catch(() => ({})),
      api.impressoras().catch(() => []),
      api.setores().catch(() => []),
    ]);
    setCfg(c ?? {});
    setImpressoras((imp as any[]) ?? []);
    setSetores((ss as any[]) ?? []);
  }, []);

  useEffect(() => {
    setCat(getCategoria());
    if (!getToken()) {
      router.replace('/entrar');
      return;
    }
    reload();
  }, [reload, router]);

  async function toggleCfg(patch: any) {
    try {
      const c = await api.setDeliveryConfig({ ...cfg, ...patch });
      setCfg(c);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro ao salvar');
    }
  }

  async function salvarImpressora(row: any) {
    try {
      const r = await api.salvarImpressora(row);
      setImpressoras((await api.impressoras()) as any[]);
      toast.success('Impressora salva.');
      return r;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro ao salvar');
    }
  }

  async function removerImpressora(id: string) {
    try {
      await api.removerImpressora(id);
      setImpressoras((l) => l.filter((x) => x.id !== id));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro ao remover');
    }
  }

  return (
    <Shell eyebrow="Configurações" title="Impressoras e cupons">
      <div className="space-y-4">
        <CupomLayoutEditor cfg={cfg} onSave={toggleCfg} pode={isGestor} />
        <CupomPerfilEditor onSave={toggleCfg} pode={isGestor} />
        <Impressoras lista={impressoras} setores={setores} onSalvar={salvarImpressora} onRemover={removerImpressora} pode={isGestor} />
      </div>
    </Shell>
  );
}
