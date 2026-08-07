'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { getToken, getCategoria } from '@/lib/api';
import { Shell } from '@/components/app-shell/shell';
import { Button } from '@/components/ui/button';
import { ConfigPanel } from '@/components/delivery/config-panel';

// Configurações do delivery em página cheia (antes era um modal). Abas no topo,
// "Cardápio digital" abre por padrão (o ConfigPanel já inicia nessa seção).
export default function DeliveryConfigPage() {
  const router = useRouter();
  const [cat, setCat] = useState<string | null>(null);
  const isGestor = ['presidente', 'gerente', 'supervisao'].includes(cat ?? '');

  useEffect(() => {
    setCat(getCategoria());
    if (!getToken()) {
      router.replace('/entrar');
      return;
    }
  }, [router]);

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
        isGestor={isGestor}
        onClose={() => router.push('/delivery')}
      />
    </Shell>
  );
}
