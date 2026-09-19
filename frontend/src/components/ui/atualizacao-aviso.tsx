'use client';

import { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import Link from 'next/link';

// Aviso de atualização disponível (SÓ no app do EDGE). O daemon de sync pergunta
// à nuvem a cada ~10 min e marca `update_disponivel`; aqui a gente lê esse estado
// e mostra uma faixa no topo que leva à tela Servidor (instalar/agendar). Na nuvem some.
//   - Só age quando NEXT_PUBLIC_EDGE=1.
//   - O usuário pode dispensar (fica quieto até a próxima versão).
const EDGE = process.env.NEXT_PUBLIC_EDGE === '1';
const DISPENSADO_KEY = 'regem_update_dispensado';

export function AtualizacaoAviso() {
  const [info, setInfo] = useState<any>(null);
  const dispensadoRef = useRef<string>('');

  useEffect(() => {
    if (!EDGE) return;
    dispensadoRef.current =
      (typeof window !== 'undefined' && localStorage.getItem(DISPENSADO_KEY)) || '';
    let parar = false;
    const checar = async () => {
      try {
        const s: any = await api.edgeAtualizacaoStatus();
        if (parar) return;
        // Não reaparece para uma versão que o usuário já dispensou.
        if (s?.disponivel && s.ultima && s.ultima !== dispensadoRef.current) setInfo(s);
        else if (!s?.disponivel) setInfo(null);
      } catch {
        /* sem edge/sem rede: ignora */
      }
    };
    checar();
    const t = setInterval(checar, 5 * 60 * 1000); // reflete o estado a cada 5 min
    return () => {
      parar = true;
      clearInterval(t);
    };
  }, []);

  if (!EDGE || !info) return null;

  function dispensar() {
    if (info?.ultima) {
      localStorage.setItem(DISPENSADO_KEY, info.ultima);
      dispensadoRef.current = info.ultima;
    }
    setInfo(null);
  }

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-amber-500/40 bg-amber-500/10 px-4 py-2 text-sm text-amber-700">
      <span className="font-semibold">⬆️ Atualização disponível</span>
      <span className="text-amber-600">
        versão {info.ultima}
        {info.atual ? ` (você está na ${info.atual})` : ''}
      </span>
      <div className="ml-auto flex items-center gap-2">
        {/* Instalar reinicia os serviços: a decisão (agora, agendar, loja em operação) fica na tela
            Servidor, com confirmação — antes um clique aqui instalava na hora, em qualquer tela (ERR-052). */}
        <Link
          href="/servidor"
          className="rounded-md bg-amber-500 px-3 py-1 text-xs font-semibold text-white hover:bg-amber-600"
        >
          Ver e instalar
        </Link>
        <button type="button" onClick={dispensar} className="text-xs text-amber-600 hover:underline">
          Agora não
        </button>
      </div>
    </div>
  );
}
