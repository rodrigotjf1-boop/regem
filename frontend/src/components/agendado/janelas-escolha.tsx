'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/* eslint-disable @typescript-eslint/no-explicit-any */

// ESCOLHER O DIA E A JANELA DO PEDIDO AGENDADO (mig 455, D4b — "Mudar o horário", G6): na página do pedido (o cliente) e na
// gaveta do painel do Delivery (a loja). O dia pelo seletor nativo (só os dias permitidos); as janelas de 15 min do dia,
// a esgotada riscada e a de agora marcada. Quem carrega as janelas é quem usa (a porta pública ou a da loja).

export type JanelaDoDia = { valor: string; hora: string; rotulo: string; esgotada: boolean };
export type JanelasDoDia = { dias: string[]; dia: string | null; janelas: JanelaDoDia[] };

export function JanelasEscolha({
  idBase,
  carregar,
  atual,
  escolhida,
  aoEscolher,
}: {
  idBase: string;
  carregar: (dia: string) => Promise<JanelasDoDia>;
  /** O horário de agora do pedido ("AAAA-MM-DDTHH:MM" de São Paulo): aparece marcado como "agora". */
  atual?: string | null;
  escolhida: string;
  aoEscolher: (valor: string) => void;
}) {
  const [dia, setDia] = useState<string>(atual ? atual.slice(0, 10) : '');
  const [dados, setDados] = useState<JanelasDoDia | null>(null);
  const [erro, setErro] = useState(false);
  const leitura = useRef(0);

  // Só a resposta da leitura mais nova vale (V64).
  const ler = useCallback(async () => {
    const minha = ++leitura.current;
    setErro(false);
    setDados(null);
    try {
      const r = await carregar(dia);
      if (minha !== leitura.current) return;
      setDados(r);
      if (!dia && r.dia) setDia(r.dia);
    } catch {
      if (minha === leitura.current) setErro(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dia]);
  useEffect(() => {
    void ler();
  }, [ler]);

  const dias = dados?.dias ?? [];
  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <label htmlFor={`${idBase}-dia`} className="text-sm font-semibold">Dia</label>
        <input
          id={`${idBase}-dia`}
          type="date"
          className="block h-11 w-full rounded-md border border-neutral-300 bg-white px-3 text-sm text-neutral-900"
          min={dias[0]}
          max={dias[dias.length - 1]}
          value={dia}
          onChange={(e) => {
            if (!dias.length || dias.includes(e.target.value)) setDia(e.target.value);
          }}
        />
      </div>
      <div className="space-y-1">
        <p id={`${idBase}-janelas`} className="text-sm font-semibold">
          Horário <span className="font-normal text-neutral-500">(janelas de 15 min)</span>
        </p>
        {erro ? (
          <p className="text-sm" role="alert">
            Não deu para ler os horários.{' '}
            <button type="button" className="font-semibold underline underline-offset-2" onClick={() => void ler()}>
              Tentar de novo
            </button>
          </p>
        ) : !dados ? (
          <p className="text-sm text-neutral-500" role="status">Carregando os horários…</p>
        ) : !dados.janelas.length ? (
          <p className="text-sm text-neutral-500">Nenhum horário livre neste dia. Escolha outro dia.</p>
        ) : (
          <div className="flex flex-wrap gap-2" role="group" aria-labelledby={`${idBase}-janelas`}>
            {dados.janelas.map((j) => {
              const agora = atual === j.valor;
              const on = escolhida === j.valor;
              return (
                <button
                  key={j.valor}
                  type="button"
                  aria-pressed={on}
                  disabled={j.esgotada && !agora}
                  title={j.esgotada ? 'Esta janela já encheu' : `Chega entre ${j.rotulo.replace(' às ', ' e ')}`}
                  onClick={() => aoEscolher(j.valor)}
                  className={`rounded-full border px-3 py-1.5 text-sm font-semibold ${
                    on ? 'border-amber-600 bg-amber-100 text-neutral-900' : 'border-neutral-300 bg-white text-neutral-700'
                  } ${j.esgotada && !agora ? 'cursor-not-allowed line-through opacity-50' : ''}`}
                >
                  {j.hora}
                  {agora && <span className="font-normal"> · agora</span>}
                </button>
              );
            })}
          </div>
        )}
        <p className="text-xs text-neutral-500">&quot;19:30&quot; quer dizer que chega entre 19:30 e 19:45.</p>
      </div>
    </div>
  );
}
