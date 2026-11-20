'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { distApi } from '@/lib/api';

// Console da distribuição → aba "Mister" → "Pessoas de uma empresa" (versão 6, M6a; mig 468; protótipo aprovado
// `mockups/regem-mister-v6.html`, aba "Console da DMS"). Para quando ninguém da empresa consegue entrar no Regem (não
// existe "esqueci a senha"): a Diretoria vê quem fala com o Mister (só o FINAL do número) e desliga o WhatsApp de uma
// pessoa, com o motivo escrito — ele vai para a auditoria do console. Na empresa fica só "desligado pelo suporte da DMS".

type EmpresaDaLista = { tenantId: string; nome: string };
type Pessoa = {
  colaboradorId: string;
  nome: string;
  nivel: 'presidente' | 'gerente';
  final: string | null;
  situacao: 'ligado' | 'pausado' | 'desligado' | 'nunca';
  ligadoEm: string | null;
  desligado: { em: string; motivo: string } | null;
};
type Resposta = { empresa: string; pessoas: Pessoa[] };

const MOTIVO_MIN = 10;
const MOTIVO_MAX = 300;
const BOTAO = 'inline-flex min-h-10 items-center justify-center rounded-lg px-3.5 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-40';
const NEUTRO = `${BOTAO} border border-slate-600 text-slate-100 hover:bg-slate-800`;
const PERIGO = `${BOTAO} border border-red-500/60 text-red-200 hover:bg-red-500/10`;
const CARTAO = 'rounded-xl border border-slate-800 bg-slate-900/40 p-4';
const dia = (ts?: string | null) => (ts ? new Date(ts).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) : '');
const mensagem = (e: unknown, padrao: string) => (e instanceof Error && e.message ? e.message : padrao);

const SITUACAO: Record<Pessoa['situacao'], { rotulo: string; classe: string }> = {
  ligado: { rotulo: 'ligado', classe: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200' },
  pausado: { rotulo: 'avisos parados', classe: 'border-amber-500/50 bg-amber-500/10 text-amber-100' },
  desligado: { rotulo: 'desligado', classe: 'border-slate-600 bg-slate-800/60 text-slate-200' },
  nunca: { rotulo: 'não ligou', classe: 'border-slate-600 bg-slate-800/60 text-slate-200' },
};

function Situacao({ p }: { p: Pessoa }) {
  const s = SITUACAO[p.situacao];
  return (
    <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
      <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${s.classe}`}>{s.rotulo}</span>
      {p.desligado && (
        <span className="text-xs text-slate-300">
          em {dia(p.desligado.em)} · {p.desligado.motivo}
        </span>
      )}
    </span>
  );
}

export function PessoasDoMisterNoConsole({ empresas }: { empresas: EmpresaDaLista[] }) {
  const idEmpresa = useId();
  const [empresa, setEmpresa] = useState('');
  const [dados, setDados] = useState<Resposta | null>(null);
  const [erro, setErro] = useState('');
  const [lendo, setLendo] = useState(false);
  const [aviso, setAviso] = useState('');
  const [desligando, setDesligando] = useState<Pessoa | null>(null);
  const pedido = useRef(0);

  const ler = useCallback(async (t: string) => {
    const meu = ++pedido.current; // V64: só a resposta da leitura mais nova vale
    setErro('');
    setLendo(true);
    try {
      const r = (await distApi.misterPessoas(t)) as Resposta;
      if (meu === pedido.current) setDados(r);
    } catch (e) {
      if (meu === pedido.current) {
        setDados(null);
        setErro(mensagem(e, 'Não consegui ler as pessoas desta empresa agora.'));
      }
    } finally {
      if (meu === pedido.current) setLendo(false);
    }
  }, []);

  useEffect(() => {
    setAviso('');
    if (empresa) void ler(empresa);
    else setDados(null);
  }, [empresa, ler]);

  return (
    <section className="space-y-3 border-t border-slate-800 pt-6" aria-labelledby="mister-pessoas">
      <div>
        <h2 id="mister-pessoas" className="text-sm font-semibold text-slate-100">
          Pessoas de uma empresa
        </h2>
        <p className="mt-1 max-w-3xl text-xs text-slate-300">
          Para quando ninguém da empresa consegue entrar no Regem. O console vê só o final do número. Desligar pede o motivo, que vai para a auditoria do console.
        </p>
      </div>
      <div className="max-w-sm">
        <label htmlFor={idEmpresa} className="mb-1 block text-xs font-medium text-slate-300">
          Empresa
        </label>
        <select
          id={idEmpresa}
          value={empresa}
          onChange={(e) => setEmpresa(e.target.value)}
          className="min-h-10 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 text-sm text-slate-100"
        >
          <option value="">Escolha a empresa</option>
          {empresas.map((e) => (
            <option key={e.tenantId} value={e.tenantId}>
              {e.nome}
            </option>
          ))}
        </select>
      </div>
      {aviso && (
        <p className="text-sm text-emerald-200" role="status">
          {aviso}
        </p>
      )}
      {erro && (
        <div className={CARTAO} role="alert">
          <p className="text-sm text-red-300">{erro}</p>
          <button type="button" className={`${NEUTRO} mt-3`} onClick={() => void ler(empresa)}>
            Tentar de novo
          </button>
        </div>
      )}
      {empresa && !erro && lendo && !dados && <p className="text-sm text-slate-400">Carregando…</p>}
      {empresa && !erro && dados && dados.pessoas.length === 0 && (
        <p className={`${CARTAO} text-sm text-slate-300`}>Ninguém desta empresa ligou o WhatsApp ao Mister.</p>
      )}
      {empresa && !erro && dados && dados.pessoas.length > 0 && (
        <>
          {/* Largo: tabela. Estreito: um cartão por pessoa — nada rola para o lado (V45). */}
          <table className="hidden w-full text-left text-sm lg:table">
            <caption className="sr-only">Pessoas de {dados.empresa} que falam com o Mister, com o final do número e a situação</caption>
            <thead className="text-xs text-slate-400">
              <tr className="border-b border-slate-800">
                <th className="py-2 pr-3 font-medium">Pessoa</th>
                <th className="px-3 py-2 font-medium">Nível</th>
                <th className="px-3 py-2 font-medium">WhatsApp</th>
                <th className="px-3 py-2 font-medium">Situação</th>
                <th className="py-2 pl-3 font-medium">
                  <span className="sr-only">Ação</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {dados.pessoas.map((p) => (
                <tr key={`linha-${p.colaboradorId}`} className="border-b border-slate-800/70 align-top">
                  <td className="break-words py-2.5 pr-3 font-semibold text-slate-100">{p.nome}</td>
                  <td className="px-3 py-2.5 text-slate-200">{p.nivel}</td>
                  <td className="px-3 py-2.5 font-mono text-slate-100">{p.final ? `final ${p.final}` : '—'}</td>
                  <td className="px-3 py-2.5">
                    <Situacao p={p} />
                  </td>
                  <td className="py-2.5 pl-3 text-right">
                    {(p.situacao === 'ligado' || p.situacao === 'pausado') && (
                      <button type="button" className={PERIGO} onClick={() => setDesligando(p)}>
                        Desligar
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <ul className="space-y-2 lg:hidden">
            {dados.pessoas.map((p) => (
              <li key={`cartao-${p.colaboradorId}`} className={`${CARTAO} space-y-2`}>
                <p className="break-words text-sm font-semibold text-slate-100">
                  {p.nome} <span className="font-normal text-slate-300">· {p.nivel}</span>
                </p>
                <p className="font-mono text-sm text-slate-100">{p.final ? `final ${p.final}` : 'sem WhatsApp ligado'}</p>
                <Situacao p={p} />
                {(p.situacao === 'ligado' || p.situacao === 'pausado') && (
                  <div>
                    <button type="button" className={PERIGO} onClick={() => setDesligando(p)}>
                      Desligar
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
      {desligando && dados && (
        <DesligarPeloConsole
          empresa={{ id: empresa, nome: dados.empresa }}
          pessoa={desligando}
          onFechar={() => setDesligando(null)}
          onDesligou={async (final) => {
            setDesligando(null);
            setAviso(`WhatsApp final ${final ?? '—'} de ${desligando.nome} desligado do Mister.`);
            await ler(empresa);
          }}
        />
      )}
    </section>
  );
}

function DesligarPeloConsole(p: {
  empresa: { id: string; nome: string };
  pessoa: Pessoa;
  onFechar: () => void;
  onDesligou: (final: string | null) => void | Promise<void>;
}) {
  const idT = useId();
  const idMotivo = useId();
  const idAjuda = useId();
  const caixa = useRef<HTMLDivElement>(null);
  const campo = useRef<HTMLTextAreaElement>(null);
  const [motivo, setMotivo] = useState('');
  // Versão 6, M6c (mig 473): o "Perdi o celular" de quem não consegue entrar no Regem — nasce desmarcado.
  const [sessoes, setSessoes] = useState(false);
  const idSessoes = useId();
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState('');
  const { onFechar } = p;
  const valido = motivo.replace(/\s+/g, ' ').trim().length >= MOTIVO_MIN;

  useEffect(() => {
    const antes = document.activeElement as HTMLElement | null;
    campo.current?.focus();
    const tecla = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onFechar();
      } else if (e.key === 'Tab' && caixa.current) {
        // O foco não sai do diálogo: do último volta ao primeiro (e o contrário com Shift).
        const focos = [...caixa.current.querySelectorAll<HTMLElement>('textarea, input, button:not([disabled])')];
        if (!focos.length) return;
        const i = focos.indexOf(document.activeElement as HTMLElement);
        if (e.shiftKey && i <= 0) {
          e.preventDefault();
          focos[focos.length - 1].focus();
        } else if (!e.shiftKey && i === focos.length - 1) {
          e.preventDefault();
          focos[0].focus();
        }
      }
    };
    document.addEventListener('keydown', tecla, true);
    return () => {
      document.removeEventListener('keydown', tecla, true);
      antes?.focus?.();
    };
  }, [onFechar]);

  async function desligar() {
    setOcupado(true);
    setErro('');
    try {
      const r = (await distApi.misterDesligarPessoa(p.empresa.id, p.pessoa.colaboradorId, motivo, sessoes)) as {
        desligado: boolean;
        final: string | null;
        sessoesEncerradas?: boolean;
      };
      if (!r.desligado && !r.sessoesEncerradas) {
        setErro('Esta pessoa já não estava ligada ao Mister.');
        return;
      }
      await p.onDesligou(r.final);
    } catch (e) {
      setErro(mensagem(e, 'Não deu para desligar agora.'));
    } finally {
      setOcupado(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/80 p-4" onMouseDown={(e) => e.target === e.currentTarget && onFechar()}>
      <div ref={caixa} role="dialog" aria-modal="true" aria-labelledby={idT} className="max-h-full w-full max-w-md overflow-y-auto rounded-xl border border-slate-700 bg-slate-900 p-5 shadow-xl">
        <h3 id={idT} className="text-base font-semibold text-slate-100">
          Desligar do Mister
        </h3>
        <p className="mt-2 text-sm text-slate-300">
          O WhatsApp final <span className="font-mono">{p.pessoa.final}</span> de {p.pessoa.nome} ({p.empresa.nome}) deixa de falar com o Mister. Na empresa fica
          &quot;desligado pelo suporte da DMS&quot;; para voltar, a pessoa gera o código no Regem.
        </p>
        <label htmlFor={idMotivo} className="mt-4 block text-sm font-medium text-slate-200">
          Motivo (vai para a auditoria)
        </label>
        <textarea
          ref={campo}
          id={idMotivo}
          aria-describedby={idAjuda}
          rows={3}
          maxLength={MOTIVO_MAX}
          value={motivo}
          onChange={(e) => setMotivo(e.target.value)}
          className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100"
        />
        <p id={idAjuda} className="mt-1 text-xs text-slate-400">
          Pelo menos {MOTIVO_MIN} letras. Ex.: o presidente informou a perda do celular por telefone.
        </p>
        <div className="mt-3 flex items-start gap-2">
          <input
            id={idSessoes}
            type="checkbox"
            checked={sessoes}
            onChange={(e) => setSessoes(e.target.checked)}
            className="mt-1 h-4 w-4 shrink-0 accent-amber-500"
          />
          <label htmlFor={idSessoes} className="text-sm text-slate-200">
            Encerrar também todas as sessões do Regem desta pessoa, em todos os aparelhos (celular perdido). Ela entra de novo com a senha.
          </label>
        </div>
        {erro && (
          <p className="mt-2 text-sm text-red-300" role="alert">
            {erro}
          </p>
        )}
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <button type="button" className={NEUTRO} onClick={onFechar}>
            Cancelar
          </button>
          <button type="button" className={PERIGO} disabled={ocupado || !valido} onClick={() => void desligar()}>
            {ocupado ? 'Desligando…' : 'Desligar'}
          </button>
        </div>
      </div>
    </div>
  );
}
