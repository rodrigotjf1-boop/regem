'use client';

import { useEffect } from 'react';

// Fronteira de erro de ROTA (App Router): captura erros de render/efeito no segmento e evita a
// TELA BRANCA (antes, um 200 com shape inesperado derrubava a rota inteira). A telemetria do
// cliente já reporta por conta própria (telemetria-cliente.tsx via window 'error').
export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string; requestId?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Ganchos futuros; a telemetria global já captura o erro.
  }, [error]);

  const rid = (error as { requestId?: string })?.requestId ?? error?.digest;
  return (
    <div className="flex min-h-[60vh] w-full items-center justify-center p-6" style={{ color: '#0F2230' }}>
      <div className="w-full max-w-md rounded-2xl border border-black/10 bg-white p-6 text-center shadow-sm">
        <div
          className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full"
          style={{ background: 'rgba(226,163,64,0.15)' }}
        >
          <span className="text-2xl">⚠️</span>
        </div>
        <h1 className="text-lg font-bold">Algo deu errado</h1>
        <p className="mt-1 text-sm text-black/60">
          Tivemos um problema ao carregar esta tela. Você pode tentar de novo.
        </p>
        {rid && <p className="mt-3 font-mono text-xs text-black/40">Código: {rid}</p>}
        <div className="mt-5 flex items-center justify-center gap-2">
          <button
            type="button"
            onClick={reset}
            className="rounded-lg px-4 py-2 text-sm font-bold text-white"
            style={{ background: '#E2A340' }}
          >
            Tentar de novo
          </button>
          <a href="/" className="rounded-lg border border-black/15 px-4 py-2 text-sm font-semibold">
            Início
          </a>
        </div>
      </div>
    </div>
  );
}
