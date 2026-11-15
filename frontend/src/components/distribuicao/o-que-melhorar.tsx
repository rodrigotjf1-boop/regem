// O QUE MELHORAR no fim da Qualidade do Mister (o Mentor do prompt do dono, parte 1; protótipo
// mockups/regem-mister-sentinela-mentor.html, vista "O que melhorar"). Os números da própria Qualidade, juntos em
// padrões: a observação, a causa provável e a proposta, por regras fixas do servidor. Só leitura: nada muda sozinho.

type Causa = 'falta_consulta' | 'erro_na_consulta' | 'instrucao' | 'da_empresa';
export type PadraoDoMister = { causa: Causa; observacao: string; porque: string; proposta: string };

const CAUSA: Record<Causa, { rotulo: string; cor: string }> = {
  falta_consulta: { rotulo: 'falta consulta', cor: 'bg-amber-500/15 text-amber-200' },
  erro_na_consulta: { rotulo: 'erro na consulta', cor: 'bg-red-500/15 text-red-300' },
  instrucao: { rotulo: 'instrução', cor: 'bg-amber-500/15 text-amber-200' },
  da_empresa: { rotulo: 'da empresa', cor: 'bg-slate-500/15 text-slate-300' },
};

export function OQueMelhorar({ padroes, dias }: { padroes: PadraoDoMister[]; dias: number }) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-4" aria-labelledby="mister-melhorar">
      <h3 id="mister-melhorar" className="text-sm font-semibold text-slate-100">
        O que melhorar · <span className="font-mono">{padroes.length}</span> {padroes.length === 1 ? 'padrão' : 'padrões'} nos últimos {dias} dias
      </h3>
      <p className="mb-2 mt-1 text-xs text-slate-400">Cada padrão com a observação, a causa provável e a proposta. Nada muda sozinho: a proposta vira tarefa do time, e mudança nas instruções só sai com a avaliação de regressão passando.</p>
      {padroes.length === 0 ? (
        <p className="text-sm text-slate-400">Nenhum padrão a melhorar neste período.</p>
      ) : (
        <ul className="space-y-2" aria-label="Os padrões a melhorar">
          {padroes.map((p) => (
            <li key={`${p.causa}-${p.observacao}`} className="rounded-lg border border-slate-800 p-3 text-sm">
              <p className="break-words font-semibold text-slate-100">{p.observacao}</p>
              <p className="mt-1 flex flex-wrap items-center gap-2 text-slate-300">
                <span className={`rounded-md px-2 py-0.5 text-xs font-bold ${CAUSA[p.causa]?.cor ?? 'bg-slate-500/15 text-slate-300'}`}>{CAUSA[p.causa]?.rotulo ?? p.causa}</span>
                <span className="min-w-0 break-words">{p.porque}</span>
              </p>
              <p className="mt-1 break-words text-slate-200">
                <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">Proposta </span>
                {p.proposta}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
