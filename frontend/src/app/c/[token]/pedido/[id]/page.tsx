'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { api } from '@/lib/api';
import { ChegueiDoPedido } from '@/components/loja/cardapio/cheguei-do-pedido';
import { TEXTO_DO_ESTORNO } from '@/components/loja/cardapio/texto-do-estorno';

/* eslint-disable @typescript-eslint/no-explicit-any */

const brl = (n: any) =>
  Number(n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

// Os passos de cada tipo. A RETIRADA não passa por "saiu" (ela vai de pronto a concluído — `avancar` no servidor):
// a página mostrava "Retire no balcão" e "Entregue", que nunca aconteciam (Onda 3, 03/11/2026).
const PASSOS_ENTREGA = ['novo', 'confirmado', 'pronto', 'despachado', 'concluido'];
const PASSOS_RETIRADA = ['novo', 'confirmado', 'pronto', 'concluido'];
function rotulo(s: string, tipo: string) {
  const entrega = tipo === 'entrega';
  const m: Record<string, string> = {
    novo: 'Pedido recebido',
    confirmado: 'Em preparo',
    pronto: entrega ? 'Pronto' : 'Pronto para retirada',
    despachado: 'Saiu para entrega',
    concluido: entrega ? 'Entregue' : 'Retirado',
  };
  return m[s] ?? s;
}

export default function StatusPedidoPage() {
  const params = useParams();
  const sp = useSearchParams();
  const token = String(params.token);
  const id = String(params.id);
  const ref = sp.get('ref') ?? undefined;
  // Veio de Sua conta pelo botão "Cheguei": abre a pergunta assim que o pedido carrega.
  const abrirCheguei = sp.get('cheguei') === '1';

  const [ped, setPed] = useState<any>(null);
  const [erro, setErro] = useState('');
  // O pedido mais recente para o relógio de 8 s ler SEM ser dependência do efeito (ERR-349: com `ped` nas dependências,
  // cada leitura recriava o efeito e já lia de novo — ~12 leituras por segundo, até o 429 trocar a página pelo erro).
  const pedRef = useRef<any>(null);

  const carregar = useCallback(async () => {
    try {
      const r: any = await api.cardapioStatus(token, id, ref);
      pedRef.current = r;
      setPed(r);
      setErro('');
    } catch (e) {
      // Falha depois da primeira leitura (internet oscilando) não troca a página pelo erro: o próximo ciclo tenta de novo.
      if (!pedRef.current) setErro(e instanceof Error ? e.message : 'Pedido não encontrado.');
    }
  }, [token, id, ref]);

  // Tempo real por polling leve (8s); para quando o pedido finaliza/cancela.
  useEffect(() => {
    carregar();
    const t = setInterval(() => {
      const p = pedRef.current;
      if (p && (p.status === 'concluido' || p.status === 'cancelado')) return;
      carregar();
    }, 8000);
    return () => clearInterval(t);
  }, [carregar]);

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
  const passos = ped.tipo === 'entrega' ? PASSOS_ENTREGA : PASSOS_RETIRADA;
  const idx = cancelado ? -1 : Math.max(0, passos.indexOf(ped.status ?? 'novo'));
  const accent = '#E2A340';

  return (
    <main className="min-h-dvh bg-neutral-50 p-6 text-neutral-900">
      <div className="mx-auto max-w-md">
        <p className="text-4xl">{cancelado ? '❌' : ped.status === 'concluido' ? '🎉' : '🧾'}</p>
        <h1 className="mt-1 text-xl font-bold">
          Pedido {ped.displayId ?? ''}
        </h1>
        <p className="mt-0.5 text-sm text-neutral-600">
          {ped.tipo === 'entrega' ? 'Entrega' : 'Retirada'} · total {brl(ped.total)}
        </p>

        {cancelado ? (
          <p className="mt-6 rounded-xl bg-red-50 px-4 py-3 text-sm font-semibold text-red-600">
            Este pedido foi cancelado.
            {/* pago online: a nuvem pede o estorno total ao gateway sozinha (mig 372) */}
            {ped.statusPagamento === 'aprovado' && <span className="mt-1 block font-normal text-red-700">{TEXTO_DO_ESTORNO}</span>}
          </p>
        ) : (
          <>
            <div className="mt-5">
              <ChegueiDoPedido token={token} pedidoId={id} refDoLink={ref} ped={ped} abrirAoCarregar={abrirCheguei} onMudou={carregar} />
            </div>
            <ol className="mt-6" aria-label="Andamento do pedido">
              {passos.map((s, i) => (
                <li key={s} className="flex items-center gap-3 pb-4">
                  <span
                    className="grid h-6 w-6 flex-none place-items-center rounded-full text-xs text-white"
                    style={{ background: i <= idx ? accent : '#d4d4d4' }}
                    aria-hidden="true"
                  >
                    {i < idx ? '✓' : i === idx ? '●' : ''}
                  </span>
                  <span className={`text-sm ${i === idx ? 'font-bold' : i < idx ? 'text-neutral-600' : 'text-neutral-500'}`}>
                    {rotulo(s, ped.tipo)}
                  </span>
                </li>
              ))}
            </ol>
          </>
        )}

        <p className="mt-2 text-xs text-neutral-500">
          Atualiza sozinho. Você pode fechar e reabrir este link quando quiser.
        </p>
        <a href={`/c/${token}`} className="mt-6 inline-block rounded-xl px-5 py-2.5 text-sm font-semibold" style={{ background: accent, color: '#281B06' }}>
          Fazer outro pedido
        </a>
      </div>
    </main>
  );
}
