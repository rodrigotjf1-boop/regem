'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { api } from '@/lib/api';

/* eslint-disable @typescript-eslint/no-explicit-any */

const brl = (n: any) =>
  Number(n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const PASSOS = ['novo', 'confirmado', 'pronto', 'despachado', 'concluido'];
function rotulo(s: string, tipo: string) {
  const entrega = tipo === 'entrega';
  const m: Record<string, string> = {
    novo: 'Pedido recebido',
    confirmado: 'Em preparo',
    pronto: entrega ? 'Pronto' : 'Pronto para retirada',
    despachado: entrega ? 'Saiu para entrega' : 'Retire no balcão',
    concluido: 'Entregue',
  };
  return m[s] ?? s;
}

export default function StatusPedidoPage() {
  const params = useParams();
  const sp = useSearchParams();
  const token = String(params.token);
  const id = String(params.id);
  const ref = sp.get('ref') ?? undefined;

  const [ped, setPed] = useState<any>(null);
  const [erro, setErro] = useState('');

  const carregar = useCallback(async () => {
    try {
      const r: any = await api.cardapioStatus(token, id, ref);
      setPed(r);
      setErro('');
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Pedido não encontrado.');
    }
  }, [token, id, ref]);

  // Tempo real por polling leve (8s); para quando o pedido finaliza/cancela.
  useEffect(() => {
    carregar();
    const t = setInterval(() => {
      if (ped && (ped.status === 'concluido' || ped.status === 'cancelado')) return;
      carregar();
    }, 8000);
    return () => clearInterval(t);
  }, [carregar, ped]);

  if (erro)
    return (
      <main className="grid min-h-dvh place-items-center bg-neutral-50 p-6 text-center">
        <div>
          <p className="text-4xl">🔍</p>
          <p className="mt-2 font-semibold text-neutral-700">{erro}</p>
          <a href={`/c/${token}`} className="mt-4 inline-block rounded-xl bg-neutral-900 px-5 py-2.5 text-sm font-semibold text-white">
            Voltar ao cardápio
          </a>
        </div>
      </main>
    );

  if (!ped)
    return (
      <main className="min-h-dvh bg-neutral-50 p-6">
        <div className="mx-auto max-w-md animate-pulse space-y-3">
          <div className="h-6 w-2/3 rounded bg-neutral-200" />
          <div className="h-4 w-1/2 rounded bg-neutral-100" />
          <div className="mt-6 space-y-4">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3">
                <div className="h-6 w-6 rounded-full bg-neutral-200" />
                <div className="h-4 w-40 rounded bg-neutral-200" />
              </div>
            ))}
          </div>
        </div>
      </main>
    );

  const cancelado = ped.status === 'cancelado';
  const idx = cancelado ? -1 : Math.max(0, PASSOS.indexOf(ped.status ?? 'novo'));
  const accent = '#E2A340';

  return (
    <main className="min-h-dvh bg-neutral-50 p-6 text-neutral-900">
      <div className="mx-auto max-w-md">
        <p className="text-4xl">{cancelado ? '❌' : ped.status === 'concluido' ? '🎉' : '🧾'}</p>
        <h1 className="mt-1 text-xl font-bold">
          Pedido {ped.displayId ?? ''}
        </h1>
        <p className="mt-0.5 text-sm text-neutral-500">
          {ped.tipo === 'entrega' ? 'Entrega' : 'Retirada'} · total {brl(ped.total)}
        </p>

        {cancelado ? (
          <p className="mt-6 rounded-xl bg-red-50 px-4 py-3 text-sm font-semibold text-red-600">
            Este pedido foi cancelado.
          </p>
        ) : (
          <div className="mt-6">
            {PASSOS.map((s, i) => (
              <div key={s} className="flex items-center gap-3 pb-4">
                <span
                  className="grid h-6 w-6 flex-none place-items-center rounded-full text-xs text-white"
                  style={{ background: i <= idx ? accent : '#d4d4d4' }}
                >
                  {i < idx ? '✓' : i === idx ? '●' : ''}
                </span>
                <span className={`text-sm ${i === idx ? 'font-bold' : i < idx ? 'text-neutral-500' : 'text-neutral-400'}`}>
                  {rotulo(s, ped.tipo)}
                </span>
              </div>
            ))}
          </div>
        )}

        <p className="mt-2 text-xs text-neutral-400">
          Atualiza sozinho. Você pode fechar e reabrir este link quando quiser.
        </p>
        <a href={`/c/${token}`} className="mt-6 inline-block rounded-xl px-5 py-2.5 text-sm font-semibold text-white" style={{ background: accent }}>
          Fazer outro pedido
        </a>
      </div>
    </main>
  );
}
