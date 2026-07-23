'use client';
import { useEffect } from 'react';
import { api } from '@/lib/api';

// Captura erros do NAVEGADOR (window.onerror + promessas rejeitadas) e envia pra
// telemetria — assim a distribuição enxerga também os erros de tela do cliente, não
// só os de API. Fire-and-forget, com dedup em memória (não floda se uma tela quebra).
export default function TelemetriaCliente() {
  useEffect(() => {
    const enviado = new Set<string>();
    const reportar = (mensagem: string, stack?: string) => {
      try {
        if (!mensagem) return;
        const key = mensagem.slice(0, 140);
        if (enviado.has(key)) return;
        enviado.add(key);
        api
          .telemetriaCliente({
            mensagem: mensagem.slice(0, 800),
            stack: stack ? String(stack).slice(0, 4000) : undefined,
            url: typeof location !== 'undefined' ? location.href : undefined,
            userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : undefined,
          })
          .catch(() => {});
      } catch {
        /* nunca deixa o handler de erro gerar outro erro */
      }
    };
    const onErr = (e: ErrorEvent) => reportar(String(e?.message || 'erro'), (e as any)?.error?.stack);
    const onRej = (e: PromiseRejectionEvent) => {
      const r: any = e?.reason;
      reportar('unhandledrejection: ' + String(r?.message ?? r ?? 'rejeição'), r?.stack);
    };
    window.addEventListener('error', onErr);
    window.addEventListener('unhandledrejection', onRej);
    return () => {
      window.removeEventListener('error', onErr);
      window.removeEventListener('unhandledrejection', onRej);
    };
  }, []);
  return null;
}
