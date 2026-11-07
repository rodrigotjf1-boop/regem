'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api, getToken } from '@/lib/api';

// Aviso de trial + bloqueio (G-1b). Lê /licenca/status e mostra:
//  - trial ativo → faixa discreta com os dias restantes (fica vermelha perto do fim);
//  - trial expirado / bloqueado → faixa vermelha fixa avisando que as operações pararam.
// O bloqueio "duro" das escritas é no servidor (interceptor); aqui é só o aviso.
// Tela de operação (`Shell compacto` — o Atendimento, protótipo da Central v9): o trial em andamento vira um SELO na
// barra do topo (`LicencaSelo`), que não come a altura da tela; o bloqueio continua na faixa larga (as operações pararam).
export type StatusDaLicenca = {
  ativa: boolean;
  tipo: string;
  plano?: string | null;
  dias?: number;
  ate?: string;
};

/** Uma leitura para a faixa e o selo (revalida a cada 5 min). */
export function useLicencaStatus(): StatusDaLicenca | null {
  const [s, setS] = useState<StatusDaLicenca | null>(null);
  useEffect(() => {
    if (!getToken()) return;
    let vivo = true;
    const carregar = () =>
      api
        .licencaStatus()
        .then((r: StatusDaLicenca) => vivo && setS(r))
        .catch(() => {});
    carregar();
    const t = setInterval(carregar, 5 * 60 * 1000); // revalida a cada 5 min
    return () => {
      vivo = false;
      clearInterval(t);
    };
  }, []);
  return s;
}

const bloqueada = (s: StatusDaLicenca) => !s.ativa && (s.tipo === 'trial_expirado' || s.tipo === 'bloqueado');
const emTeste = (s: StatusDaLicenca): s is StatusDaLicenca & { dias: number } => s.tipo === 'trial' && typeof s.dias === 'number';
const diasDe = (n: number) => `${n} ${n === 1 ? 'dia' : 'dias'}`;

export function LicencaAviso({ status: s, compacto = false }: { status: StatusDaLicenca | null; compacto?: boolean }) {
  if (!s) return null;

  // Bloqueio (trial acabou ou conta bloqueada)
  if (bloqueada(s)) {
    return (
      <div data-licenca="faixa" className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-destructive/30 bg-destructive/10 px-5 py-2.5 text-sm text-destructive">
        <span className="font-bold">⛔ Seu teste do Regem terminou.</span>
        <span>Novas operações estão bloqueadas — a leitura continua liberada.</span>
        <Link href="/planos" className="font-bold underline underline-offset-2">Ver planos e reativar</Link>
      </div>
    );
  }

  // Aviso de trial em andamento (na tela de operação, é o selo da barra do topo)
  if (emTeste(s) && !compacto) {
    const urgente = s.dias <= 7;
    return (
      <div
        data-licenca="faixa"
        className={`flex flex-wrap items-center gap-x-2 gap-y-1 border-b px-5 py-2 text-sm ${
          urgente
            ? 'border-destructive/30 bg-destructive/10 text-destructive'
            : 'border-primary/25 bg-primary/10 text-primary'
        }`}
      >
        <span className="font-bold">
          {urgente ? '⏳' : '✨'} Teste grátis: {diasDe(s.dias)} restantes
        </span>
        <span className="text-muted-foreground">— sistema completo.</span>
        <Link href="/planos" className="font-semibold underline underline-offset-2">Ver planos</Link>
      </div>
    );
  }

  return null;
}

/** O selo do teste grátis na barra do topo (tela de operação): "✨ Teste grátis: 16 dias", leva a Ver planos. */
export function LicencaSelo({ status: s }: { status: StatusDaLicenca | null }) {
  if (!s || bloqueada(s) || !emTeste(s)) return null;
  const urgente = s.dias <= 7;
  return (
    <Link
      href="/planos"
      data-licenca="chip"
      data-urgente={urgente ? 'true' : 'false'}
      aria-label={`Teste grátis: ${diasDe(s.dias)} restantes — ver planos`}
      className={`inline-flex min-h-9 items-center gap-1.5 whitespace-nowrap rounded-full border px-3 text-xs font-bold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
        urgente ? 'border-destructive/40 bg-destructive/10 text-destructive' : 'border-primary/40 bg-primary/10 text-foreground'
      }`}
    >
      <span aria-hidden="true">{urgente ? '⏳' : '✨'}</span> Teste grátis: {diasDe(s.dias)}
    </Link>
  );
}
