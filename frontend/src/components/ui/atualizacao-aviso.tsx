'use client';

import { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { toast } from '@/lib/toast';

// Aviso de atualização disponível (SÓ no app do EDGE). O daemon de sync pergunta
// à nuvem a cada ~10 min e marca `update_disponivel`; aqui a gente lê esse estado
// e mostra uma faixa no topo com a opção de baixar/instalar. Na nuvem some.
//   - Só age quando NEXT_PUBLIC_EDGE=1.
//   - O usuário pode dispensar (fica quieto até a próxima versão).
const EDGE = process.env.NEXT_PUBLIC_EDGE === '1';
const DISPENSADO_KEY = 'regem_update_dispensado';

export function AtualizacaoAviso() {
  const [info, setInfo] = useState<any>(null);
  const [aplicando, setAplicando] = useState(false);
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

  async function baixarInstalar() {
    setAplicando(true);
    try {
      await api.edgeAplicarAtualizacao();
      toast.success('Baixando e instalando a atualização. O servidor reinicia ao concluir.');
      setInfo(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao iniciar a atualização.');
      setAplicando(false);
    }
  }

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
        <button
          type="button"
          onClick={baixarInstalar}
          disabled={aplicando}
          className="rounded-md bg-amber-500 px-3 py-1 text-xs font-semibold text-white hover:bg-amber-600 disabled:opacity-70"
        >
          {aplicando ? 'Baixando…' : 'Baixar e atualizar'}
        </button>
        <button type="button" onClick={dispensar} className="text-xs text-amber-600 hover:underline">
          Agora não
        </button>
      </div>
    </div>
  );
}
