'use client';

import { useEffect, useState } from 'react';
import { pingServidor } from '@/lib/api';

// Verificador do servidor local (só no app do EDGE). Se o servidor local cair
// COM o app aberto (queda do edge / problema no PC), avisa e oferece abrir o
// MODO NUVEM (espelho online). É o "escape hatch" da operação híbrida.
//   - Só age quando NEXT_PUBLIC_EDGE=1 (na nuvem não faz sentido).
//   - Exige 2 falhas seguidas para não reagir a um piscar de rede.
//   - "Abrir modo nuvem" = navegar para o app da nuvem (login acontece lá).
const EDGE = process.env.NEXT_PUBLIC_EDGE === '1';
const CLOUD = process.env.NEXT_PUBLIC_CLOUD_APP_URL || 'https://app.dmsregem.com';

export function ServidorOfflineAviso() {
  const [offline, setOffline] = useState(false);
  const [dispensado, setDispensado] = useState(false);

  useEffect(() => {
    if (!EDGE) return;
    let parar = false;
    let falhas = 0;
    const checar = async () => {
      const ok = await pingServidor();
      if (parar) return;
      if (ok) {
        falhas = 0;
        setOffline(false);
      } else {
        falhas += 1;
        if (falhas >= 2) setOffline(true); // 2 falhas seguidas (~10s) = offline de verdade
      }
    };
    checar();
    const t = setInterval(checar, 8000);
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

  if (!EDGE || !offline || dispensado) return null;

  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-amber-500/40 bg-amber-500/10 px-5 py-3">
      <span className="flex-1 text-sm font-medium text-amber-800 dark:text-amber-300">
        ⚠️ Servidor local indisponível. Você pode continuar operando na nuvem enquanto ele volta.
      </span>
      <a
        href={CLOUD}
        className="inline-flex items-center rounded-md bg-primary px-3 py-1.5 text-sm font-semibold text-primary-foreground hover:opacity-90"
      >
        ☁️ Abrir modo nuvem
      </a>
      <button
        type="button"
        onClick={() => setDispensado(true)}
        className="text-sm font-medium text-muted-foreground hover:text-foreground"
      >
        Continuar tentando o local
      </button>
    </div>
  );
}
