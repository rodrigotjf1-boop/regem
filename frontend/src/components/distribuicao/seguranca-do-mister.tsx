'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { distApi } from '@/lib/api';
import { AnaliseDoSentinela } from './analise-do-sentinela';

// A SEGURANÇA DO MISTER no console (o Sentinela do prompt do dono, parte 1; protótipo
// mockups/regem-mister-sentinela-mentor.html, vista "Console › Mister › Segurança"). O que as proteções do Mister
// barraram ou recusaram, em todas as empresas, só contagens: nunca o telefone, o texto, o código digitado ou o que a
// consulta trouxe. As proteções agem sozinhas no servidor; esta parte mostra o que elas fizeram.

type Seguranca = {
  dias: 7 | 30;
  saida: { nota: string; texto: string; quantas: number }[];
  entrada: {
    codigoNaoVale: number;
    codigosDemais: number;
    codigoCalado: number;
    codigoErrado: { quantas: number; telefones: number; calados: number };
    outraPessoa: number;
    perdeuOAcesso: number;
    naoLigado: { quantas: number; telefones: number };
  };
  segredos: number;
  limite: number;
  /** F4.2a (mig 433): os links com PIN que o quinto PIN errado bloqueou. Ausente na API antes da 433. */
  linksComPin?: { bloqueados: number; empresas: number };
  atencao: { nivel: 'critico' | 'atencao'; texto: string }[];
  porEmpresa: { empresa: string; filtro: number; segredos: number; perdeuOAcesso: number; outraPessoa: number; limite: number }[];
};

const CARTAO = 'rounded-xl border border-slate-800 bg-slate-900/40 p-4';
const plural = (n: number, um: string, varios: string) => `${n.toLocaleString('pt-BR')} ${n === 1 ? um : varios}`;

export function SegurancaDoMister() {
  const [dias, setDias] = useState<7 | 30>(7);
  const [dados, setDados] = useState<Seguranca | null>(null);
  const [erro, setErro] = useState('');
  const leitura = useRef(0);

  const carregar = useCallback(async (d: 7 | 30) => {
    const vez = ++leitura.current;
    setErro('');
    try {
      const r = (await distApi.misterSeguranca(d)) as Seguranca;
      if (vez === leitura.current) setDados(r);
    } catch (e) {
      if (vez === leitura.current) setErro(e instanceof Error ? e.message : 'Não consegui carregar a segurança do Mister.');
    }
  }, []);

  useEffect(() => {
    void carregar(dias);
  }, [carregar, dias]);

  const d = dados && dados.dias === dias ? dados : null;
  const e = d?.entrada;
  const bloqueados = d?.linksComPin?.bloqueados ?? 0;
  const total = d ? d.saida.reduce((s, x) => s + x.quantas, 0) + (e!.codigoErrado.quantas + e!.outraPessoa + e!.perdeuOAcesso + e!.naoLigado.quantas) + d.limite + bloqueados : 0;
  const entradas = e
    ? [
        { nome: 'telefone não ligado (resposta fixa)', valor: e.naoLigado.quantas },
        { nome: 'código que não vale', valor: e.codigoNaoVale },
        { nome: 'códigos demais · calado por 1 hora', valor: e.codigosDemais + e.codigoCalado },
        { nome: 'perdeu o acesso e escreveu', valor: e.perdeuOAcesso },
        { nome: 'número de outra pessoa', valor: e.outraPessoa },
        { nome: `link com PIN bloqueado (5 PIN errados)${d?.linksComPin?.empresas ? ` · ${plural(d.linksComPin.empresas, 'empresa', 'empresas')}` : ''}`, valor: bloqueados },
      ].filter((x) => x.valor > 0)
    : [];
  const saidas = d ? d.saida.filter((x) => x.quantas > 0).map((x) => ({ nome: x.texto, valor: x.quantas })) : [];

  return (
    <section className="space-y-3 border-t border-slate-800 pt-6" aria-labelledby="mister-seguranca">
      <div>
        <h2 id="mister-seguranca" className="text-sm font-semibold text-slate-100">
          Segurança
        </h2>
        <p className="mt-1 max-w-3xl text-xs text-slate-300">
          O que as proteções do Mister barraram ou recusaram, em todas as empresas. Só contagens: nunca o telefone, o texto da mensagem, o código digitado ou o que a consulta trouxe. As proteções agem sozinhas no servidor; esta parte mostra o
          que elas fizeram.
        </p>
      </div>
      <div className="flex flex-wrap gap-2" role="group" aria-label="Período da segurança">
        {([7, 30] as const).map((x) => (
          <button
            key={x}
            type="button"
            aria-pressed={dias === x}
            onClick={() => setDias(x)}
            className={`min-h-10 rounded-full border px-3 text-sm font-semibold ${dias === x ? 'border-amber-500 bg-amber-500 text-slate-950' : 'border-slate-600 text-slate-300 hover:bg-slate-800'}`}
          >
            {x} dias
          </button>
        ))}
      </div>
      {erro && (
        <div className={`${CARTAO} flex flex-wrap items-center gap-3 text-sm text-red-300`} role="alert">
          <span className="min-w-0 flex-1">{erro}</span>
          <button type="button" className="min-h-10 rounded-md border border-slate-600 px-3 font-semibold text-slate-100 hover:bg-slate-800" onClick={() => void carregar(dias)}>
            Tentar de novo
          </button>
        </div>
      )}
      {!d && !erro && <p className="text-sm text-slate-400">Carregando…</p>}
      {d && total === 0 && <p className={`${CARTAO} text-center text-sm text-slate-400`}>Nada barrado ou recusado neste período.</p>}
      {d && total > 0 && (
        <>
          {d.atencao.length > 0 && (
            <div className={`${CARTAO} border-l-4 ${d.atencao.some((a) => a.nivel === 'critico') ? 'border-l-red-400' : 'border-l-amber-500'}`} role="note">
              <h3 className="text-sm font-semibold text-slate-100">
                Pede atenção · <span className="font-mono">{d.atencao.length}</span>
              </h3>
              <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-slate-200">
                {d.atencao.map((a) => (
                  <li key={a.texto} className={`break-words ${a.nivel === 'critico' ? 'text-red-200' : ''}`}>
                    {a.texto}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
            <Numero rotulo="Segredo tirado da resposta" valor={d.segredos} nota="o filtro tirou antes de sair" />
            <Numero rotulo="Código errado para ligar" valor={e!.codigoErrado.quantas} nota={`de ${plural(e!.codigoErrado.telefones, 'telefone', 'telefones')} · ${plural(e!.codigoErrado.calados, 'calado', 'calados')} por 1 hora`} />
            <Numero rotulo="Número de outra pessoa" valor={e!.outraPessoa} nota="o código era de outro telefone" />
            <Numero rotulo="Telefone não ligado" valor={e!.naoLigado.quantas} nota={`de ${plural(e!.naoLigado.telefones, 'telefone', 'telefones')} · recebeu a resposta fixa`} />
            <Numero rotulo="Limite de perguntas" valor={d.limite} nota="a pessoa chegou ao limite em 24 horas" />
          </dl>
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <div className={CARTAO}>
              <h3 className="mb-2 text-sm font-semibold text-slate-100">Na saída · o filtro das respostas</h3>
              {saidas.length ? <Barras itens={saidas} /> : <p className="text-sm text-slate-400">O filtro não precisou agir neste período.</p>}
            </div>
            <div className={CARTAO}>
              <h3 className="mb-2 text-sm font-semibold text-slate-100">Na entrada · quem tenta falar com o Mister</h3>
              {entradas.length ? <Barras itens={entradas} /> : <p className="text-sm text-slate-400">Ninguém barrado na entrada neste período.</p>}
            </div>
          </div>
          <div className={CARTAO}>
            <h3 className="mb-1 text-sm font-semibold text-slate-100">Por empresa</h3>
            <p className="mb-2 text-xs text-slate-400">Só o que se sabe de quem é. O telefone não ligado e o código que não vale não têm empresa: ficam só no total.</p>
            {d.porEmpresa.length ? (
              <ul className="divide-y divide-slate-800">
                {d.porEmpresa.map((p) => (
                  <li key={p.empresa} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2 text-sm">
                    <span className="min-w-0 flex-[1_1_220px] break-words text-slate-100">{p.empresa}</span>
                    <span className="text-slate-300">
                      <span className="font-mono">{p.filtro}</span> no filtro de saída
                    </span>
                    {p.segredos > 0 && <span className="rounded-md bg-red-500/15 px-2 py-0.5 text-xs font-bold text-red-300">{plural(p.segredos, 'segredo', 'segredos')}</span>}
                    <span className="text-slate-300">
                      <span className="font-mono">{p.perdeuOAcesso}</span> perdeu o acesso
                    </span>
                    <span className="text-slate-300">
                      <span className="font-mono">{p.outraPessoa}</span> outra pessoa
                    </span>
                    <span className="text-slate-300">
                      <span className="font-mono">{p.limite}</span> no limite
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-slate-400">Nada ligado a uma empresa neste período.</p>
            )}
          </div>
        </>
      )}
      {/* S2 (mig 434): a análise com IA dos mesmos eventos — sempre à vista, mesmo com nada barrado no período. */}
      <AnaliseDoSentinela />
    </section>
  );
}

function Numero({ rotulo, valor, nota }: { rotulo: string; valor: number; nota: string }) {
  return (
    <div className={`${CARTAO} min-w-0`}>
      <dt className="text-xs font-semibold uppercase tracking-wide text-slate-400">{rotulo}</dt>
      <dd className="mt-0.5 font-mono text-2xl font-bold text-slate-100">{valor.toLocaleString('pt-BR')}</dd>
      <dd className="text-xs text-slate-400">{nota}</dd>
    </div>
  );
}

function Barras({ itens }: { itens: { nome: string; valor: number }[] }) {
  const maior = Math.max(1, ...itens.map((i) => i.valor));
  return (
    <ul className="space-y-2">
      {itens.map((i) => (
        <li key={i.nome} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 text-sm">
          <span className="min-w-0 break-words text-slate-200">{i.nome}</span>
          <span className="font-mono text-slate-400">{i.valor.toLocaleString('pt-BR')}</span>
          <span className="col-span-2 h-2 overflow-hidden rounded bg-slate-800" aria-hidden="true">
            <span className="block h-full bg-amber-500" style={{ width: `${Math.round((i.valor / maior) * 100)}%` }} />
          </span>
        </li>
      ))}
    </ul>
  );
}
