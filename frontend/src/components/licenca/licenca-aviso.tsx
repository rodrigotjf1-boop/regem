'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api, getToken } from '@/lib/api';

// Aviso de trial + bloqueio (G-1b). Lê /licenca/status e mostra:
//  - trial ativo → faixa discreta com os dias restantes (fica vermelha perto do fim);
//  - trial expirado / bloqueado → faixa vermelha fixa avisando que as operações pararam.
// O bloqueio "duro" das escritas é no servidor (interceptor); aqui é só o aviso.
type Status = {
  ativa: boolean;
  tipo: string;
  plano?: string | null;
  dias?: number;
  ate?: string;
};

export function LicencaAviso() {
  const [s, setS] = useState<Status | null>(null);

  useEffect(() => {
    if (!getToken()) return;
    let vivo = true;
    const carregar = () =>
      api
        .licencaStatus()
        .then((r: Status) => vivo && setS(r))
        .catch(() => {});
    carregar();
    const t = setInterval(carregar, 5 * 60 * 1000); // revalida a cada 5 min
    return () => {
      vivo = false;
      clearInterval(t);
    };
  }, []);

  if (!s) return null;

  // Bloqueio (trial acabou ou conta bloqueada)
  if (!s.ativa && (s.tipo === 'trial_expirado' || s.tipo === 'bloqueado')) {
    return (
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-destructive/30 bg-destructive/10 px-5 py-2.5 text-sm text-destructive">
        <span className="font-bold">⛔ Seu teste do Regem terminou.</span>
        <span>Novas operações estão bloqueadas — a leitura continua liberada.</span>
        <Link href="/planos" className="font-bold underline underline-offset-2">Ver planos e reativar</Link>
      </div>
    );
  }

  // Aviso de trial em andamento
  if (s.tipo === 'trial' && typeof s.dias === 'number') {
    const urgente = s.dias <= 7;
    return (
      <div
        className={`flex flex-wrap items-center gap-x-2 gap-y-1 border-b px-5 py-2 text-sm ${
          urgente
            ? 'border-destructive/30 bg-destructive/10 text-destructive'
            : 'border-primary/25 bg-primary/10 text-primary'
        }`}
      >
        <span className="font-bold">
          {urgente ? '⏳' : '✨'} Teste grátis: {s.dias} {s.dias === 1 ? 'dia' : 'dias'} restantes
        </span>
        <span className="text-muted-foreground">— sistema completo.</span>
        <Link href="/planos" className="font-semibold underline underline-offset-2">Ver planos</Link>
      </div>
    );
  }

  return null;
}
