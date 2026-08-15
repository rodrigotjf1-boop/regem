'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';

/* eslint-disable @typescript-eslint/no-explicit-any */
// QR do entregador (Fase 4) — página PÚBLICA aberta ao escanear o QR do cupom.
// O entregador se identifica e confirma a saída → o pedido vai para "em rota".

export default function DespachoPage({ params }: { params: { token: string } }) {
  const { token } = params;
  const [info, setInfo] = useState<any>(null);
  const [erro, setErro] = useState('');
  const [carregando, setCarregando] = useState(true);
  const [entregador, setEntregador] = useState('');
  const [nomeManual, setNomeManual] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [ok, setOk] = useState(false);

  const carregar = useCallback(async () => {
    try {
      setInfo(await api.despachoInfo(token));
    } catch (e: any) {
      setErro(e?.message ?? 'Pedido não encontrado.');
    } finally {
      setCarregando(false);
    }
  }, [token]);

  useEffect(() => {
    carregar();
  }, [carregar]);

  async function confirmar() {
    setEnviando(true);
    setErro('');
    try {
      const body =
        entregador === '__manual__' || !info?.entregadores?.length
          ? { entregadorNome: nomeManual.trim() }
          : { entregadorId: entregador };
      if (!(body as any).entregadorId && !(body as any).entregadorNome?.trim()) {
        setErro('Selecione ou informe o entregador.');
        setEnviando(false);
        return;
      }
      await api.despachoConfirmar(token, body);
      setOk(true);
    } catch (e: any) {
      setErro(e?.message ?? 'Não foi possível confirmar.');
    } finally {
      setEnviando(false);
    }
  }

  const box = 'min-h-dvh bg-[#0F2230] text-white flex items-center justify-center p-5';
  const card = 'w-full max-w-md rounded-2xl bg-white p-6 text-[#0F2230] shadow-2xl';

  if (carregando) return <main className={box}><div className={card}>Carregando…</div></main>;

  if (erro && !info)
    return (
      <main className={box}>
        <div className={card}>
          <p className="text-lg font-bold">Ops</p>
          <p className="mt-1 text-sm text-[#5B6B78]">{erro}</p>
        </div>
      </main>
    );

  if (ok || info?.jaDespachado)
    return (
      <main className={box}>
        <div className={`${card} text-center`}>
          <div className="mx-auto mb-3 grid h-16 w-16 place-items-center rounded-full bg-emerald-100 text-3xl">🛵</div>
          <p className="text-xl font-extrabold">Pedido em rota!</p>
          <p className="mt-1 text-sm text-[#5B6B78]">
            Pedido #{info?.numero ?? '—'} saiu para entrega
            {info?.entregadorNome ? ` com ${info.entregadorNome}` : ''}.
          </p>
        </div>
      </main>
    );

  if (info?.cancelado)
    return <main className={box}><div className={card}><p className="text-lg font-bold text-red-600">Pedido cancelado.</p></div></main>;

  return (
    <main className={box}>
      <div className={card}>
        <p className="text-xs font-bold uppercase tracking-wider text-[#E2A340]">Saída para entrega</p>
        <p className="mt-1 text-2xl font-extrabold">Pedido #{info?.numero ?? '—'}</p>

        <div className="mt-3 space-y-1 text-sm">
          {info?.cliente && <p><strong>{info.cliente}</strong></p>}
          {info?.endereco && <p className="text-[#5B6B78]">{info.endereco}</p>}
          {info?.telefone && <p className="text-[#5B6B78]">{info.telefone}</p>}
        </div>

        {Array.isArray(info?.itens) && info.itens.length > 0 && (
          <div className="mt-3 rounded-lg bg-[#F1F4F8] p-3 text-sm">
            {info.itens.map((it: any, i: number) => (
              <div key={i}>{Number(it.quantidade) || 1}× {it.descricao ?? it.nome}</div>
            ))}
          </div>
        )}

        {info?.status !== 'pronto' ? (
          <p className="mt-4 rounded-lg bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-800">
            Aguarde o pedido ficar <strong>pronto</strong> para sair.
          </p>
        ) : (
          <div className="mt-5">
            <label className="mb-1 block text-xs font-semibold text-[#5B6B78]">Quem vai levar?</label>
            {info?.entregadores?.length ? (
              <select
                value={entregador}
                onChange={(e) => setEntregador(e.target.value)}
                className="h-12 w-full rounded-xl border border-[#D8DEE6] bg-white px-3 text-base"
              >
                <option value="">Selecione o entregador…</option>
                {info.entregadores.map((e: any) => <option key={e.id} value={e.id}>{e.nome}</option>)}
                <option value="__manual__">Outro (digitar nome)</option>
              </select>
            ) : null}
            {(entregador === '__manual__' || !info?.entregadores?.length) && (
              <input
                value={nomeManual}
                onChange={(e) => setNomeManual(e.target.value)}
                placeholder="Nome do entregador"
                className="mt-2 h-12 w-full rounded-xl border border-[#D8DEE6] bg-white px-3 text-base"
              />
            )}
            {erro && <p className="mt-2 text-sm text-red-600">{erro}</p>}
            <button
              type="button"
              onClick={confirmar}
              disabled={enviando}
              className="mt-4 h-14 w-full rounded-2xl bg-[#E2A340] text-lg font-extrabold text-[#0F2230] disabled:opacity-50"
            >
              {enviando ? 'Confirmando…' : '🛵 Sair para entrega'}
            </button>
          </div>
        )}
      </div>
    </main>
  );
}
