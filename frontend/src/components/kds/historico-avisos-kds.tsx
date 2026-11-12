'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { AVISOS_DA_TELA, horaDoAviso, situacaoDoAviso, type AvisosDoKds } from '@/lib/kds-fila';

/* eslint-disable @typescript-eslint/no-explicit-any */

// HISTÓRICO DOS AVISOS DESTA TELA (auditoria do KDS de 11/11/2026, onda 3 — mig 412; protótipo aprovado, aba 1, gaveta
// "Histórico"): cada aviso que foi ao rodapé, com a hora, de onde veio e o que aconteceu — quem tocou "Ciente" e quando,
// se saiu sozinho, se ainda espera, ou se esta tela não o mostra (os tipos que ela não recebe, o alerta de outro KDS) —
// para ninguém achar que o aviso sumiu. As últimas 24 horas do servidor (guardado por 90 dias).

type Filtro = 'todos' | 'urg' | 'sem' | 'nao';

export function HistoricoAvisosKds({ avisos, kdsId }: { avisos: AvisosDoKds; kdsId: string | null }) {
  const [rows, setRows] = useState<any[] | null>(null);
  const [erro, setErro] = useState('');
  const [carregando, setCarregando] = useState(false);
  const [filtro, setFiltro] = useState<Filtro>('todos');

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro('');
    try {
      const r: any = await api.kdsAvisosHistorico();
      setRows(Array.isArray(r?.avisos) ? r.avisos : []);
    } catch (e) {
      // 404 = servidor ainda sem esta rota (servidor da loja antes da atualização)
      setErro((e as any)?.status === 404 ? 'O histórico dos avisos chega com a próxima atualização do servidor.' : e instanceof Error ? e.message : 'Não foi possível carregar.');
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  const lista = useMemo(
    () =>
      (rows ?? []).map((a) => {
        const s = situacaoDoAviso(a, avisos, kdsId);
        return { ...a, ...s, urg: a.prioridade === 'danger' || a.fica === true, ic: AVISOS_DA_TELA.find((t) => t.k === a.tipo)?.ic ?? '🔔' };
      }),
    [rows, avisos, kdsId],
  );
  const conta = {
    todos: lista.length,
    urg: lista.filter((a) => a.urg).length,
    sem: lista.filter((a) => a.semCiente).length,
    nao: lista.filter((a) => !a.mostrado).length,
  };
  const vistos = lista.filter(
    (a) => filtro === 'todos' || (filtro === 'urg' && a.urg) || (filtro === 'sem' && a.semCiente) || (filtro === 'nao' && !a.mostrado),
  );

  return (
    <>
      <div className="k-seg2" role="group" aria-label="Filtrar o histórico dos avisos">
        {(
          [
            ['todos', 'Todos'],
            ['urg', 'Urgentes'],
            ['sem', 'Sem ciente'],
            ['nao', 'Não mostrados'],
          ] as const
        ).map(([f, rotulo]) => (
          <button key={f} type="button" aria-pressed={filtro === f} onClick={() => setFiltro(f)}>
            {rotulo} {conta[f]}
          </button>
        ))}
      </div>
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
      {rows && vistos.length === 0 && (
        <p className="k-nota">{lista.length ? 'Nada com este filtro nas últimas 24 horas.' : 'Nenhum aviso nas últimas 24 horas.'}</p>
      )}
      {vistos.length > 0 && (
        <ol className="k-hist" aria-label="Avisos das últimas 24 horas">
          {vistos.map((a) => (
            <li key={a.id} className="k-h" data-aviso={a.id}>
              <time>{horaDoAviso(a.em)}</time>
              <b>
                <span aria-hidden="true">{a.ic} </span>
                {a.titulo}
              </b>
              <p>
                {a.origem ?? ''}
                {a.detalhe ? ` · ${a.detalhe}` : ''}
              </p>
              <span className="st">{a.texto}</span>
            </li>
          ))}
        </ol>
      )}
      <p className="k-nota">Últimas 24 horas desta loja · guardado por 90 dias.</p>
    </>
  );
}
