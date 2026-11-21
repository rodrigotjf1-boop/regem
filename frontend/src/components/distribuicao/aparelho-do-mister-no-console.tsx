'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { distApi } from '@/lib/api';
import { Confirmar } from '@/components/distribuicao/confirmar-no-console';

// Console da distribuição → aba "Mister" → "Conferência do aparelho" (versão 6, M6b, peça A1.0; mig 484). A Meta pode
// mandar um hash do aparelho em cada mensagem; a doc não diz o que muda esse hash. Este bloco liga o recurso e mostra o
// que chegou, para o teste com um celular. Só observa: nenhuma resposta do Mister depende disto. O hash não vem à tela.

type Telefone = { final: string; vistoEm: string; mudouEm: string | null };
type Conferencia = {
  disponivel: boolean;
  ligado: boolean;
  em: string | null;
  por: string | null;
  vistos: number;
  mudaram: number;
  telefones: Telefone[];
};

const BOTAO = 'inline-flex min-h-10 items-center justify-center rounded-lg px-3.5 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-40';
const NEUTRO = `${BOTAO} border border-slate-600 text-slate-100 hover:bg-slate-800`;
const hora = (ts?: string | null) =>
  ts ? new Date(ts).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '';
const mensagem = (e: unknown, padrao: string) => (e instanceof Error && e.message ? e.message : padrao);

export function AparelhoDoMisterNoConsole() {
  const [dados, setDados] = useState<Conferencia | null>(null);
  const [erro, setErro] = useState('');
  const [lendo, setLendo] = useState(true);
  const [aviso, setAviso] = useState('');
  const [confirmando, setConfirmando] = useState(false);
  const [mudando, setMudando] = useState(false);
  const pedido = useRef(0);

  const ler = useCallback(async () => {
    const meu = ++pedido.current; // V64: só a resposta da leitura mais nova vale
    setErro('');
    setLendo(true);
    try {
      const r = (await distApi.misterAparelho()) as Conferencia;
      if (meu === pedido.current) setDados(r);
    } catch (e) {
      if (meu === pedido.current) setErro(mensagem(e, 'Não consegui ler a conferência do aparelho agora.'));
    } finally {
      if (meu === pedido.current) setLendo(false);
    }
  }, []);

  useEffect(() => {
    void ler();
  }, [ler]);

  const mudar = async () => {
    if (!dados) return;
    const ligar = !dados.ligado;
    pedido.current += 1; // uma leitura em curso não sobrescreve o resultado da mudança
    setMudando(true);
    setErro('');
    setAviso('');
    try {
      const r = (await distApi.misterMudarAparelho(ligar)) as Conferencia;
      setDados(r);
      setLendo(false);
      setAviso(ligar ? 'Conferência ligada na Meta.' : 'Conferência desligada na Meta.');
    } catch (e) {
      setErro(mensagem(e, 'Não consegui mudar a conferência. Nada mudou.'));
      setLendo(false);
    } finally {
      setMudando(false);
      setConfirmando(false);
    }
  };

  return (
    <section className="space-y-3 border-t border-slate-800 pt-6" aria-labelledby="mister-aparelho">
      <div>
        <h2 id="mister-aparelho" className="text-sm font-semibold text-slate-100">
          Conferência do aparelho
        </h2>
        <p className="mt-1 max-w-3xl text-xs text-slate-300">
          Teste para saber o que a Meta considera troca de aparelho. O Regem só anota o que chega: nenhuma regra de bloqueio está ligada.
        </p>
      </div>

      {lendo && !dados && <p className="text-sm text-slate-300">Carregando a conferência…</p>}
      {erro && (
        <p role="alert" className="text-sm text-red-200">
          {erro}
        </p>
      )}
      {aviso && (
        <p role="status" className="text-sm text-emerald-200">
          {aviso}
        </p>
      )}

      {dados && (
        <div className="space-y-3 rounded-xl border border-slate-800 bg-slate-900/40 p-4">
          <p className="text-sm text-slate-100">
            {dados.ligado ? 'Ligada' : 'Desligada'}
            {dados.em && (
              <span className="text-slate-300">
                {' '}
                · {hora(dados.em)}
                {dados.por ? ` · ${dados.por}` : ''}
              </span>
            )}
          </p>
          {!dados.disponivel && <p className="text-xs text-slate-300">Só funciona com o número do Mister conectado pela API oficial.</p>}
          <div className="flex flex-wrap gap-2">
            <button type="button" className={NEUTRO} disabled={!dados.disponivel || mudando} onClick={() => setConfirmando(true)}>
              {dados.ligado ? 'Desligar a conferência' : 'Ligar a conferência'}
            </button>
            <button type="button" className={NEUTRO} disabled={lendo || mudando} onClick={() => void ler()}>
              {lendo ? 'Atualizando…' : 'Atualizar'}
            </button>
          </div>

          <p className="text-xs text-slate-300">
            {dados.vistos === 1 ? '1 telefone visto' : `${dados.vistos} telefones vistos`} · {dados.mudaram === 1 ? '1 mudou de aparelho' : `${dados.mudaram} mudaram de aparelho`}
          </p>
          {dados.telefones.length === 0 ? (
            <p className="text-sm text-slate-300">Nenhum aparelho anotado ainda. Com a conferência ligada, mande uma mensagem ao Mister.</p>
          ) : (
            <ul className="divide-y divide-slate-800">
              {dados.telefones.map((t) => (
                <li key={`${t.final}-${t.vistoEm}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm text-slate-100">
                  <span className="font-mono">final {t.final}</span>
                  <span className="text-xs text-slate-300">visto {hora(t.vistoEm)}</span>
                  {t.mudouEm ? (
                    <span className="inline-flex items-center rounded-full border border-amber-500/50 bg-amber-500/10 px-2.5 py-0.5 text-xs font-semibold text-amber-100">
                      mudou {hora(t.mudouEm)}
                    </span>
                  ) : (
                    <span className="text-xs text-slate-300">mesmo aparelho</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {confirmando && dados && (
        <Confirmar
          titulo={dados.ligado ? 'Desligar a conferência do aparelho?' : 'Ligar a conferência do aparelho?'}
          texto={
            dados.ligado
              ? 'A Meta para de mandar o hash do aparelho. O que já foi anotado continua guardado.'
              : 'Vale para o número inteiro do Mister. A Meta passa a mandar o hash do aparelho em cada mensagem, e o Regem só anota. As respostas continuam saindo sem o hash.'
          }
          acao={dados.ligado ? 'Desligar' : 'Ligar'}
          ocupado={mudando}
          onConfirmar={() => void mudar()}
          onFechar={() => setConfirmando(false)}
        />
      )}
    </section>
  );
}
