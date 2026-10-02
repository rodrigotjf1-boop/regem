'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { ACOES_KDS, resumoKds } from '@/lib/auditoria-kds';

/* eslint-disable @typescript-eslint/no-explicit-any */

// HISTÓRICO DO KDS — quem finalizou todos os pedidos da tela, cancelou um pedido, mudou as
// etapas/destinos ou mexeu nos alertas. Vem da auditoria (registro imutável) da loja.
// Painel no mesmo lugar e no mesmo desenho do de configuração; as cores vêm do tema do KDS.

type Tema = { panel: string; panel2: string; border: string; text: string; muted: string };

const PERFIL: Record<string, string> = { presidente: 'presidente', gerente: 'gerente', supervisao: 'supervisão', execucao: 'execução', suporte: 'suporte Regem' };
const hora = (iso: string) => {
  const d = new Date(iso);
  const hoje = new Date().toDateString() === d.toDateString();
  return hoje
    ? d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
};

export function HistoricoKds({ T, onFechar }: { T: Tema; onFechar: () => void }) {
  const [rows, setRows] = useState<any[] | null>(null);
  const [erro, setErro] = useState('');
  const [carregando, setCarregando] = useState(false);

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro('');
    try {
      const r: any = await api.producaoHistorico();
      setRows(Array.isArray(r) ? r : []);
    } catch (e) {
      // 404 = servidor ainda sem esta rota (loja antes da atualização)
      setErro((e as any)?.status === 404 ? 'O histórico chega com a próxima atualização do servidor.' : e instanceof Error ? e.message : 'Não foi possível carregar.');
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  return (
    <div
      role="dialog"
      aria-label="Histórico do KDS"
      className="fixed right-4 top-[124px] z-30 max-h-[calc(100dvh-140px)] w-[380px] max-w-[calc(100vw-2rem)] overflow-y-auto border p-4 shadow-2xl"
      style={{ background: T.panel, borderColor: T.border, color: T.text }}
    >
      <div className="mb-3 flex items-center justify-between gap-2">
        <span className="text-[13px] font-bold uppercase tracking-wider" style={{ color: T.muted }}>Histórico</span>
        <div className="flex items-center gap-3">
          <button type="button" onClick={carregar} disabled={carregando} className="text-[12px] font-semibold" style={{ color: T.muted }}>
            {carregando ? 'Atualizando…' : 'Atualizar'}
          </button>
          <button type="button" onClick={onFechar} aria-label="Fechar o histórico" style={{ color: T.muted }}>✕</button>
        </div>
      </div>

      {erro && <p className="text-[13px]" style={{ color: '#FF5A4E' }}>{erro}</p>}
      {!erro && rows === null && <p className="text-[13px]" style={{ color: T.muted }}>Carregando…</p>}
      {rows && rows.length === 0 && (
        <p className="text-[13px] leading-relaxed" style={{ color: T.muted }}>
          Nada registrado ainda. Finalizar todos os pedidos da tela, cancelar um pedido ou mudar a configuração do KDS passa a aparecer aqui, com quem fez.
        </p>
      )}
      {rows && rows.length > 0 && (
        <ul className="space-y-2">
          {rows.map((r) => {
            const resumo = resumoKds(r.acao, r.detalhe);
            return (
              <li key={r.id} className="border px-3 py-2" style={{ background: T.panel2, borderColor: T.border }}>
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-[13px] font-semibold">{ACOES_KDS[r.acao] ?? String(r.acao).replace(/_/g, ' ')}</span>
                  <span className="flex-none text-[12px] tabular-nums" style={{ color: T.muted, fontFamily: 'JetBrains Mono, monospace' }}>{hora(r.criadoEm)}</span>
                </div>
                {resumo && <p className="mt-0.5 break-words text-[12.5px]" style={{ color: T.muted }}>{resumo}</p>}
                <p className="mt-0.5 text-[12px]" style={{ color: T.muted }}>
                  por <span style={{ color: T.text }}>{r.atorNome ?? 'Sistema'}</span>
                  {r.atorPerfil && PERFIL[r.atorPerfil] ? ` · ${PERFIL[r.atorPerfil]}` : ''}
                </p>
              </li>
            );
          })}
        </ul>
      )}
      <p className="mt-3 text-[11.5px] leading-relaxed" style={{ color: T.muted }}>
        🔒 Registro imutável, os {rows?.length ?? 0} mais recentes desta loja. O avanço de cada pedido não entra aqui.
      </p>
    </div>
  );
}
