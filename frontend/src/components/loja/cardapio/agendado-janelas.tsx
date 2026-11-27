'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import type { Cardapio } from './use-cardapio';
import { especialDoDia, faixaDeHoras } from '@/lib/dia-especial';

/* eslint-disable @typescript-eslint/no-explicit-any */

// O "PARA QUANDO?" DO PEDIDO AGENDADO (mig 455, D4 — protótipo `regem-atendente-alergenos-agendado.html`, parte 2, G2):
// o dia (seletor de data, só os dias que a loja deixa) e a lista das janelas de 15 min daquele dia — a janela cheia aparece
// "esgotado" e não se escolhe. As janelas vêm do servidor (`agendado/janelas`), que confere tudo de novo ao receber o pedido.

type Janela = { valor: string; hora: string; rotulo: string; esgotada: boolean };
// O dia especial do dia escolhido (H1b, mig 512; `especialDoDia` é a mesma escolha do servidor): o servidor já não
// oferece janela no dia fechado — aqui é só o porquê, e o primeiro dia oferecido pula o dia fechado.

export function AgendadoJanelas({ c }: { c: Cardapio }) {
  const dias: string[] = Array.isArray(c.agendado?.dias) ? c.agendado.dias : [];
  const set = (patch: any) => c.setChk((s: any) => ({ ...s, ...patch }));
  const escolhido = String(c.chk.agendamento ?? '');
  const tipo = c.chk.tipo === 'entrega' ? 'entrega' : 'retirada';
  const proximos = c.menu?.diasEspeciais?.proximos;
  const fechadoNo = (d: string) => especialDoDia(proximos, d, tipo)?.funcionamento === 'fechada';
  // O primeiro dia oferecido pula o dia fechado (o Natal não abre a lista com "nenhum horário").
  const [dia, setDia] = useState<string>(() => (dias.includes(escolhido.slice(0, 10)) ? escolhido.slice(0, 10) : dias.find((d) => !fechadoNo(d)) ?? dias[0] ?? ''));
  const [janelas, setJanelas] = useState<Janela[] | null>(null);
  const [erro, setErro] = useState(false);
  const leitura = useRef(0);
  const especial = dia ? especialDoDia(proximos, dia, tipo) : null;

  // Só a resposta da leitura mais nova vale (V64): trocar o dia ou o tipo no meio de uma leitura não mostra a velha.
  const carregar = useCallback(async () => {
    if (!dia) return;
    const minha = ++leitura.current;
    setErro(false);
    setJanelas(null);
    try {
      const r: any = await api.cardapioJanelasAgendado(c.token, dia, tipo);
      if (minha !== leitura.current) return;
      const lista: Janela[] = Array.isArray(r?.janelas) ? r.janelas : [];
      setJanelas(lista);
      // A janela escolhida que sumiu (outro dia, outro tipo, encheu) é desfeita: o cliente escolhe de novo.
      c.setChk((s: any) => (s.agendamento && !lista.some((j) => j.valor === s.agendamento && !j.esgotada) ? { ...s, agendamento: '' } : s));
    } catch {
      if (minha === leitura.current) setErro(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [c.token, dia, tipo]);
  useEffect(() => {
    void carregar();
  }, [carregar]);

  return (
    <>
      <div className="c-f">
        <label htmlFor="lp-agendado-dia">Dia</label>
        <input
          id="lp-agendado-dia"
          type="date"
          className="c-in"
          min={dias[0]}
          max={dias[dias.length - 1]}
          value={dia}
          onChange={(e) => {
            const v = e.target.value;
            if (dias.includes(v)) setDia(v);
          }}
          aria-describedby={especial ? 'lp-agendado-especial' : undefined}
        />
        {especial && (
          <p id="lp-agendado-especial" className="c-note" role="status">
            {especial.funcionamento === 'fechada'
              ? `Neste dia a loja está fechada (${especial.nome}). Escolha outro dia.`
              : especial.abre && especial.fecha
                ? `Neste dia a loja abre ${faixaDeHoras(especial.abre, especial.fecha)} (${especial.nome}).`
                : null}
          </p>
        )}
      </div>
      <div className="c-f" data-campo="agendamento">
        <span className="c-lab" id="lp-agendado-horario">
          Horário <em>(janelas de 15 min)</em>
        </span>
        {erro ? (
          <p className="c-note" role="alert">
            Não deu para ler os horários.{' '}
            <button type="button" className="c-link" onClick={() => void carregar()}>
              Tentar de novo
            </button>
          </p>
        ) : janelas === null ? (
          <p className="c-note" role="status">Carregando os horários…</p>
        ) : !janelas.length ? (
          <p className="c-note">{especial?.funcionamento === 'fechada' ? 'Nenhum horário: a loja está fechada neste dia.' : 'Nenhum horário livre neste dia. Escolha outro dia.'}</p>
        ) : (
          <div className="m-chips" role="group" aria-labelledby="lp-agendado-horario">
            {janelas.map((j) => (
              <button
                key={j.valor}
                type="button"
                aria-pressed={escolhido === j.valor}
                disabled={j.esgotada}
                title={j.esgotada ? 'Esta janela já encheu' : `Chega entre ${j.rotulo.replace(' às ', ' e ')}`}
                onClick={() => set({ agendamento: j.valor })}
              >
                {j.hora}
                {j.esgotada && <small> · esgotado</small>}
              </button>
            ))}
          </div>
        )}
        <p className="c-note">&quot;19:30&quot; quer dizer que chega entre 19:30 e 19:45.</p>
        {c.soPix && <p className="c-note">O pedido agendado é pago no Pix, na hora: o agendamento vale quando o Pix cai.</p>}
      </div>
    </>
  );
}
