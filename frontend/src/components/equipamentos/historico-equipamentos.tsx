'use client';

import { useCallback, useState } from 'react';
import { api } from '@/lib/api';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ACOES_EQUIPAMENTO, resumoEquipamento } from '@/lib/auditoria-equipamentos';

/* eslint-disable @typescript-eslint/no-explicit-any */

// HISTÓRICO DO CADASTRO DE EQUIPAMENTOS — quem cadastrou, pareou, trocou, revogou ou alterou
// cada equipamento. Vem da auditoria (registro imutável). Fechado por padrão: só consulta o
// servidor quando o gestor abre.

const PERFIL: Record<string, string> = { presidente: 'Presidente', gerente: 'Gerente', supervisao: 'Supervisão', execucao: 'Execução', suporte: 'Suporte Regem', servico: 'Automático' };
const quando = (iso: string) => new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });

export function HistoricoEquipamentos() {
  const [aberto, setAberto] = useState(false);
  const [rows, setRows] = useState<any[] | null>(null);
  const [erro, setErro] = useState('');
  const [carregando, setCarregando] = useState(false);

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro('');
    try {
      const r: any = await api.equipamentosHistorico();
      setRows(Array.isArray(r) ? r : []);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível carregar o histórico.');
    } finally {
      setCarregando(false);
    }
  }, []);

  function alternar() {
    const abrir = !aberto;
    setAberto(abrir);
    if (abrir) void carregar();
  }

  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button
          type="button"
          onClick={alternar}
          aria-expanded={aberto ? 'true' : 'false'}
          aria-controls="historico-equipamentos"
          className="flex items-center gap-2 text-left text-sm font-medium text-muted-foreground hover:text-foreground"
        >
          <span aria-hidden>{aberto ? '▾' : '▸'}</span>
          Histórico de alterações
        </button>
        {aberto && (
          <Button type="button" variant="ghost" size="sm" onClick={carregar} disabled={carregando}>
            {carregando ? 'Atualizando…' : 'Atualizar'}
          </Button>
        )}
      </div>

      {aberto && (
        <div id="historico-equipamentos" className="mt-3">
          {erro && <p className="text-sm text-destructive">{erro}</p>}
          {!erro && rows === null && <p className="text-sm text-muted-foreground">Carregando…</p>}
          {rows && rows.length === 0 && (
            <p className="text-sm text-muted-foreground">
              Nenhuma alteração registrada ainda. Cadastrar, parear, revogar ou editar um equipamento passa a aparecer aqui.
            </p>
          )}
          {rows && rows.length > 0 && (
            <>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[560px] text-sm">
                  <caption className="sr-only">Histórico de alterações no cadastro de equipamentos</caption>
                  <thead>
                    <tr className="border-b border-border text-left text-xs text-muted-foreground">
                      <th className="py-1.5 pr-3 font-semibold">Quando</th>
                      <th className="py-1.5 pr-3 font-semibold">Quem</th>
                      <th className="py-1.5 pr-3 font-semibold">O que fez</th>
                      <th className="py-1.5 font-semibold">Equipamento</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.id} className="border-b border-border align-top last:border-0">
                        <td className="whitespace-nowrap py-1.5 pr-3 font-mono text-xs text-muted-foreground">{quando(r.criadoEm)}</td>
                        <td className="py-1.5 pr-3">
                          <span className="font-medium">{r.atorNome ?? (r.origem === 'terminal' ? 'O próprio terminal' : 'Sistema')}</span>
                          {r.atorPerfil && <span className="ml-1.5 text-[11px] text-muted-foreground">{PERFIL[r.atorPerfil] ?? r.atorPerfil}</span>}
                        </td>
                        <td className="py-1.5 pr-3">{ACOES_EQUIPAMENTO[r.acao] ?? String(r.acao).replace(/_/g, ' ')}</td>
                        <td className="py-1.5 text-muted-foreground">{resumoEquipamento(r.acao, r.detalhe)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                🔒 Os {rows.length} registros mais recentes. O registro é imutável; a trilha completa fica em Auditoria.
              </p>
            </>
          )}
        </div>
      )}
    </Card>
  );
}
