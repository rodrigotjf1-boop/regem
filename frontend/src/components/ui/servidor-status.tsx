'use client';

import { useEffect, useState } from 'react';
import { pingServidor } from '@/lib/api';

// Indicador de status do servidor para os apps clientes (KDS, PDV, Ponto, Garçom).
// Faz um heartbeat leve no /ping a cada 12s e mostra 🟢 online / 🔴 offline.
export function ServidorStatus({ className = '' }: { className?: string }) {
  const [online, setOnline] = useState<boolean | null>(null);

  useEffect(() => {
    let parar = false;
    const checar = async () => {
      const ok = await pingServidor();
      if (!parar) setOnline(ok);
    };
    checar();
    const t = setInterval(checar, 12000);
    // Reconfere ao voltar o foco/rede (volta rápido do offline).
    const onFoco = () => checar();
    window.addEventListener('online', onFoco);
    window.addEventListener('focus', onFoco);
    return () => {
      parar = true;
      clearInterval(t);
      window.removeEventListener('online', onFoco);
      window.removeEventListener('focus', onFoco);
    };
  }, []);

  const cor = online == null ? 'bg-neutral-400' : online ? 'bg-emerald-500' : 'bg-red-500';
  const txt = online == null ? 'Verificando…' : online ? 'Servidor online' : 'Servidor offline';

  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap text-xs font-semibold ${className}`}
      title={txt}
    >
      <span className={`h-2 w-2 flex-none rounded-full ${cor} ${online === false ? 'animate-pulse' : ''}`} />
      {txt}
    </span>
  );
}
