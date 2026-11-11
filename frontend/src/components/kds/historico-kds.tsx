'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { ACOES_KDS, resumoKds } from '@/lib/auditoria-kds';

/* eslint-disable @typescript-eslint/no-explicit-any */

// HISTÓRICO DO KDS — quem finalizou todos os pedidos da tela, cancelou um pedido, mudou as etapas/destinos ou mexeu nos
// alertas. Vem da auditoria (registro imutável) da loja. Aba "Histórico" da gaveta ⚙ da tela (onda 2 da auditoria do KDS,
// 11/11/2026); desenho em app/kds/kds-tela.css.

const PERFIL: Record<string, string> = { presidente: 'presidente', gerente: 'gerente', supervisao: 'supervisão', execucao: 'execução', suporte: 'suporte Regem' };
const hora = (iso: string) => {
  const d = new Date(iso);
  const hoje = new Date().toDateString() === d.toDateString();
  return hoje
    ? d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
};

export function HistoricoKds() {
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
    <>
      <div className="k-grupo">
        <button type="button" className="k-bt" onClick={carregar} disabled={carregando}>
          {carregando ? 'Atualizando…' : 'Atualizar'}
        </button>
      </div>
      {erro && (
        <p className="k-nota" role="alert" style={{ color: 'var(--k-erro)' }}>
          {erro}
        </p>
      )}
      {!erro && rows === null && <p className="k-nota">Carregando…</p>}
      {rows && rows.length === 0 && (
        <p className="k-nota">
          Nada registrado ainda. Finalizar todos os pedidos da tela, cancelar um pedido ou mudar a configuração do KDS passa a
          aparecer aqui, com quem fez.
        </p>
      )}
      {rows && rows.length > 0 && (
        <ol className="k-hist">
          {rows.map((r) => {
            const resumo = resumoKds(r.acao, r.detalhe);
            return (
              <li key={r.id} className="k-h">
                <time>{hora(r.criadoEm)}</time>
                <b>{ACOES_KDS[r.acao] ?? String(r.acao).replace(/_/g, ' ')}</b>
                {resumo && <p>{resumo}</p>}
                <span className="st">
                  por {r.atorNome ?? 'Sistema'}
                  {r.atorPerfil && PERFIL[r.atorPerfil] ? ` · ${PERFIL[r.atorPerfil]}` : ''}
                </span>
              </li>
            );
          })}
        </ol>
      )}
      <p className="k-nota">🔒 Registro imutável, os {rows?.length ?? 0} mais recentes desta loja. O avanço de cada pedido não entra aqui.</p>
    </>
  );
}
