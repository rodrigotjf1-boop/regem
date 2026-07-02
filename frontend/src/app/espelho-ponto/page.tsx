'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { TIPO_LABEL } from '@/components/ponto/ponto-card';

/* eslint-disable @typescript-eslint/no-explicit-any */
const AJUSTE_LABEL: Record<string, string> = {
  abono: 'Abono',
  atestado: 'Atestado',
  justificativa: 'Justificativa',
  desconsideracao: 'Desconsideração',
};

function fmtMin(min: number) {
  const s = min < 0 ? '-' : '';
  const a = Math.abs(min);
  return `${s}${Math.floor(a / 60)}h${String(a % 60).padStart(2, '0')}`;
}
function fmtData(d: string) {
  return new Date(`${d}T00:00:00`).toLocaleDateString('pt-BR', {
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}
function hora(isoStr: string) {
  return new Date(isoStr).toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function EspelhoPontoPrint() {
  const [dados, setDados] = useState<any>(null);
  const [nome, setNome] = useState('');
  const [empresa, setEmpresa] = useState('Regem');
  const [erro, setErro] = useState('');

  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const colaboradorId = p.get('colaboradorId');
    const inicio = p.get('inicio');
    const fim = p.get('fim');
    if (!colaboradorId || !inicio || !fim) {
      setErro('Parâmetros ausentes.');
      return;
    }
    (async () => {
      try {
        const [esp, colabs] = await Promise.all([
          api.pontoEspelho(colaboradorId, inicio, fim),
          api.colaboradores(),
        ]);
        setDados(esp);
        setNome(
          (colabs as any[]).find((c) => c.id === colaboradorId)?.nome ?? '',
        );
        try {
          const emp: any = await api.get('/empresas');
          if (emp?.[0]?.nome) setEmpresa(emp[0].nome);
        } catch {
          /* opcional */
        }
      } catch (e) {
        setErro(e instanceof Error ? e.message : 'Erro ao carregar');
      }
    })();
  }, []);

  return (
    <div className="min-h-dvh bg-white text-slate-900">
      <style>{`
        @media print {
          .no-print { display: none !important; }
          @page { size: A4; margin: 14mm; }
          body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        }
      `}</style>

      <div className="no-print sticky top-0 flex items-center justify-between border-b border-slate-200 bg-slate-50 px-4 py-2.5">
        <span className="text-sm font-semibold">Espelho de ponto</span>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => window.print()}
            className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-semibold text-white"
          >
            Imprimir / Salvar PDF
          </button>
          <button
            type="button"
            onClick={() => window.close()}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm"
          >
            Fechar
          </button>
        </div>
      </div>

      {erro && <p className="p-6 text-red-600">{erro}</p>}
      {!dados && !erro && <p className="p-6 text-slate-500">Carregando…</p>}

      {dados && (
        <div className="mx-auto max-w-3xl px-8 py-8">
          <div className="flex items-start justify-between border-b-2 border-slate-800 pb-3">
            <div>
              <p className="text-lg font-extrabold tracking-tight">{empresa}</p>
              <p className="text-xs text-slate-500">
                Espelho de ponto · gestão de jornada
              </p>
            </div>
            <div className="text-right text-xs text-slate-500">
              <p>
                Período: <strong>{fmtData(dados.inicio)}</strong> a{' '}
                <strong>{fmtData(dados.fim)}</strong>
              </p>
              <p>Emitido em {new Date().toLocaleString('pt-BR')}</p>
            </div>
          </div>

          <p className="mt-4 text-base font-bold">{nome || 'Colaborador'}</p>

          <div className="mt-3 grid grid-cols-3 border border-slate-300 text-center text-sm">
            <div className="border-r border-slate-300 py-2">
              <p className="text-[10px] font-bold uppercase text-slate-500">
                Trabalhado
              </p>
              <p className="font-mono text-base font-bold">
                {fmtMin(dados.totalTrabalhadoMin)}
              </p>
            </div>
            <div className="border-r border-slate-300 py-2">
              <p className="text-[10px] font-bold uppercase text-slate-500">
                Esperado
              </p>
              <p className="font-mono text-base font-bold">
                {fmtMin(dados.totalEsperadoMin)}
              </p>
            </div>
            <div className="py-2">
              <p className="text-[10px] font-bold uppercase text-slate-500">
                Saldo
              </p>
              <p
                className={`font-mono text-base font-bold ${
                  dados.saldoMin < 0 ? 'text-red-600' : 'text-emerald-700'
                }`}
              >
                {dados.saldoMin >= 0 ? '+' : ''}
                {fmtMin(dados.saldoMin)}
              </p>
            </div>
          </div>

          <table className="mt-4 w-full border-collapse text-xs">
            <thead>
              <tr className="border-y border-slate-300 text-left">
                <th className="py-1.5 pr-2 font-bold">Dia</th>
                <th className="py-1.5 pr-2 font-bold">Marcações</th>
                <th className="py-1.5 pr-2 text-right font-bold">Trab.</th>
                <th className="py-1.5 pr-2 text-right font-bold">Esp.</th>
                <th className="py-1.5 text-right font-bold">Saldo</th>
              </tr>
            </thead>
            <tbody>
              {dados.dias.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-4 text-center text-slate-500">
                    Sem marcações no período.
                  </td>
                </tr>
              )}
              {dados.dias.map((d: any) => (
                <tr
                  key={d.data}
                  className="border-b border-slate-200 align-top"
                >
                  <td className="py-1.5 pr-2 capitalize">{fmtData(d.data)}</td>
                  <td className="py-1.5 pr-2">
                    <span className="font-mono">
                      {d.marcacoes.map((m: any, i: number) => (
                        <span
                          key={m.id}
                          className={m.desconsiderada ? 'text-red-500 line-through' : ''}
                        >
                          {i > 0 ? ' · ' : ''}
                          {hora(m.hora)}
                        </span>
                      ))}
                      {d.marcacoes.length === 0 && '—'}
                    </span>
                    {d.ajustes.map((a: any) => (
                      <div key={a.id} className="text-[10px] text-slate-500">
                        {AJUSTE_LABEL[a.tipo] ?? a.tipo}
                        {a.minutos != null ? ` ${fmtMin(a.minutos)}` : ''} ·{' '}
                        {a.justificativa}
                      </div>
                    ))}
                  </td>
                  <td className="py-1.5 pr-2 text-right font-mono">
                    {fmtMin(d.efetivoMin)}
                  </td>
                  <td className="py-1.5 pr-2 text-right font-mono text-slate-500">
                    {fmtMin(d.esperadoMin)}
                  </td>
                  <td
                    className={`py-1.5 text-right font-mono font-bold ${
                      d.saldoMin < 0 ? 'text-red-600' : 'text-emerald-700'
                    }`}
                  >
                    {d.saldoMin >= 0 ? '+' : ''}
                    {fmtMin(d.saldoMin)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="mt-12 grid grid-cols-2 gap-10 text-center text-xs">
            <div className="border-t border-slate-400 pt-1">Colaborador</div>
            <div className="border-t border-slate-400 pt-1">
              Responsável / RH
            </div>
          </div>

          <p className="mt-6 text-[10px] leading-relaxed text-slate-400">
            Documento de gestão de jornada gerado pelo Regem (lógica da Portaria
            671, registros com NSR). Não substitui o espelho de um REP-P
            homologado. Marcações riscadas foram desconsideradas por ajuste
            registrado com justificativa e trilha de auditoria.
          </p>
        </div>
      )}
    </div>
  );
}
