'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { api, getToken, getCategoria } from '@/lib/api';
import { toast } from '@/lib/toast';
import { Shell } from '@/components/app-shell/shell';
import { Button } from '@/components/ui/button';
import { ConfigPanel } from '@/components/delivery/config-panel';

// Configurações do delivery em página cheia (antes era um modal). Abas no topo,
// "Cardápio digital" abre por padrão (o ConfigPanel já inicia nessa seção).
export default function DeliveryConfigPage() {
  const router = useRouter();
  const [cat, setCat] = useState<string | null>(null);
  const [cfg, setCfg] = useState<any>({ ativo: false, autoAceitar: false, colunas: {} });
  const isGestor = ['presidente', 'gerente', 'supervisao'].includes(cat ?? '');

  useEffect(() => {
    setCat(getCategoria());
    if (!getToken()) {
      router.replace('/entrar');
      return;
    }
    api.deliveryConfig().then((c: any) => setCfg(c)).catch(() => {});
  }, [router]);

  async function toggleCfg(patch: any) {
    try {
      const c = await api.setDeliveryConfig({ ...cfg, ...patch });
      setCfg(c);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro ao salvar');
    }
  }

  return (
    <Shell
      eyebrow="Delivery"
      title="Configurações do delivery"
      actions={
        <Button size="sm" variant="outline" onClick={() => router.push('/delivery')}>
          <ArrowLeft className="h-4 w-4" /> Delivery
        </Button>
      }
    >
      <ConfigPanel
        pagina
        deliveryCfg={cfg}
        onDeliveryToggle={toggleCfg}
        isGestor={isGestor}
        onClose={() => router.push('/delivery')}
      />
    </Shell>
  );
}
