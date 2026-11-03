'use client';

import { useId, useState } from 'react';
import { api } from '@/lib/api';
import { getClienteToken } from '@/components/loja/tipos';
import type { Cardapio } from './use-cardapio';

// O ANIVERSÁRIO DO CLIENTE NO CARDÁPIO (Onda 3 · PR 3, mig 357; protótipo `mockups/regem-relacionamento.html`, telas 7 e
// 8): dia e mês, sem o ano, por seletor (nunca digitação). O cliente informa no Perfil ou na pergunta da confirmação do
// pedido (uma vez só; "Agora não" não pergunta de novo) e corrige UMA vez — depois, só a loja. A data vale para promoções
// 30 dias depois de informada (a proteção pedida pelo dono; a regra mora no servidor).

const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const DIAS_DO_MES = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const dataBr = (iso?: string | null) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '');

/** Dia + mês por seletor; o dia só oferece o que existe no mês escolhido. */
function SeletorDeData({ dia, mes, aoMudar, rotulo }: { dia: string; mes: string; aoMudar: (d: string, m: string) => void; rotulo: string }) {
  const id = useId();
  const maxDia = mes ? DIAS_DO_MES[Number(mes) - 1] : 31;
  return (
    <div className="c-f" role="group" aria-labelledby={`${id}-r`}>
      <span id={`${id}-r`} className="c-sub">{rotulo}</span>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1.6fr)', gap: 8 }}>
        <select aria-label="Dia" className="c-in" value={dia} onChange={(e) => aoMudar(e.target.value, mes)}>
          <option value="">Dia</option>
          {Array.from({ length: maxDia }, (_, i) => (
            <option key={i + 1} value={String(i + 1)}>
              {i + 1}
            </option>
          ))}
        </select>
        <select
          aria-label="Mês"
          className="c-in"
          value={mes}
          onChange={(e) => {
            const m = e.target.value;
            const limite = m ? DIAS_DO_MES[Number(m) - 1] : 31;
            aoMudar(dia && Number(dia) > limite ? '' : dia, m);
          }}
        >
          <option value="">Mês</option>
          {MESES.map((nome, i) => (
            <option key={nome} value={String(i + 1)}>
              {nome}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

/** Sua conta › Perfil: o aniversário, desde quando vale e o "corrigir" (uma vez). */
export function AniversarioNoPerfil({ c, perfil, aoSalvar }: { c: Cardapio; perfil: any; aoSalvar: () => void | Promise<void> }) {
  const a = perfil?.aniversario ?? null;
  const [editando, setEditando] = useState(false);
  const [dia, setDia] = useState('');
  const [mes, setMes] = useState('');
  const [erro, setErro] = useState('');
  const [salvando, setSalvando] = useState(false);
  if (!a) return null;
  const temData = !!a.dia;

  async function salvar() {
    const ct = getClienteToken(c.token);
    if (!ct || !dia || !mes || salvando) {
      if (!dia || !mes) setErro('Escolha o dia e o mês.');
      return;
    }
    setSalvando(true);
    setErro('');
    try {
      await api.clienteAniversario(c.token, ct, Number(dia), Number(mes), 'perfil');
      setEditando(false);
      c.avisar(temData ? 'Data corrigida. Vale para promoções daqui a 30 dias.' : 'Aniversário salvo. Vale para promoções daqui a 30 dias.');
      await aoSalvar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível salvar. Tente de novo.');
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="c-sec" data-aniversario-perfil>
      <h3 className="c-h">🎂 Aniversário</h3>
      {temData && !editando ? (
        <>
          <p className="c-note">
            <b>{a.texto}</b>
            {a.valeDesde ? ` · vale para promoções desde ${dataBr(a.valeDesde)}.` : '.'}
          </p>
          {a.podeCorrigir ? (
            <button
              type="button"
              className="lk"
              onClick={() => {
                setDia(String(a.dia));
                setMes(String(a.mes));
                setEditando(true);
              }}
            >
              Corrigir a data (uma vez)
            </button>
          ) : (
            <p className="c-note">Você já corrigiu a data uma vez. Para mudar de novo, fale com a loja.</p>
          )}
        </>
      ) : (
        <>
          <SeletorDeData
            rotulo={temData ? 'A data certa' : 'Dia e mês (sem o ano)'}
            dia={dia}
            mes={mes}
            aoMudar={(d, m) => {
              setDia(d);
              setMes(m);
            }}
          />
          <p className="c-note">
            {temData ? 'Você só pode corrigir uma vez. ' : ''}A data vale para promoções 30 dias depois de salva.
          </p>
          {erro && (
            <p className="c-msg err" role="alert">
              {erro}
            </p>
          )}
          <div className="ac-acts">
            <button type="button" className="p-btn c" onClick={() => void salvar()} disabled={salvando}>
              {salvando ? 'Salvando…' : 'Salvar'}
            </button>
            {editando && (
              <button type="button" className="p-btn2" onClick={() => setEditando(false)}>
                Cancelar
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

/** A pergunta da confirmação do pedido: uma vez, só com a automática ligada e sem data; "Agora não" não pergunta de novo. */
export function PerguntaDoAniversario({ c }: { c: Cardapio }) {
  const [dia, setDia] = useState('');
  const [mes, setMes] = useState('');
  const [estado, setEstado] = useState<'pergunta' | 'salvo' | 'fechado'>('pergunta');
  const [erro, setErro] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const perguntar = !!c.perfil?.aniversario?.perguntar;
  if (estado === 'fechado' || (!perguntar && estado === 'pergunta')) return null;
  if (estado === 'salvo')
    return (
      <p className="c-note" role="status" data-aniversario-pergunta>
        🎉 Anotado! Dá para corrigir uma vez em Sua conta › Perfil.
      </p>
    );

  async function salvar() {
    const ct = getClienteToken(c.token);
    if (!ct) return;
    if (!dia || !mes) return setErro('Escolha o dia e o mês.');
    setOcupado(true);
    setErro('');
    try {
      await api.clienteAniversario(c.token, ct, Number(dia), Number(mes), 'confirmacao');
      setEstado('salvo');
      void c.recarregarPerfil();
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível salvar. Tente de novo.');
    } finally {
      setOcupado(false);
    }
  }
  async function agoraNao() {
    const ct = getClienteToken(c.token);
    setEstado('fechado');
    if (ct) await api.clienteAniversarioAgoraNao(c.token, ct).catch(() => undefined);
    void c.recarregarPerfil();
  }

  return (
    <div className="c-sec" data-aniversario-pergunta>
      <h3 className="c-h">🎂 Quando é seu aniversário?</h3>
      <SeletorDeData
        rotulo="Dia e mês (sem o ano)"
        dia={dia}
        mes={mes}
        aoMudar={(d, m) => {
          setDia(d);
          setMes(m);
        }}
      />
      {erro && (
        <p className="c-msg err" role="alert">
          {erro}
        </p>
      )}
      <div className="ac-acts">
        <button type="button" className="p-btn c" onClick={() => void salvar()} disabled={ocupado}>
          Salvar
        </button>
        <button type="button" className="p-btn2" onClick={() => void agoraNao()} disabled={ocupado}>
          Agora não
        </button>
      </div>
      <p className="c-note">Perguntamos uma vez só. Dá para corrigir uma vez em Sua conta › Perfil. O presente vale a partir de 30 dias depois de hoje.</p>
    </div>
  );
}
