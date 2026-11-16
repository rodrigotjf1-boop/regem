'use client';

import { Button } from '@/components/ui/button';
import { dataBr, texto2 } from '@/components/ui/lista';
import { Gaveta } from '@/components/ui/sobreposto';
import { brl, DIA_ROTULO, nomeDaFuncao, UBER_ROTULO, type ConducaoDosAprovados, type PessoaNaConducao } from '@/lib/vagas-ficha';
import { comoChega, diaNoFuso } from './lista-candidatos';

// F5b (protótipo `mockups/regem-vagas-talentos.html`, "Condução dos aprovados"): por pessoa, o valor da ida e da volta que
// ela informou na ficha × os dias de trabalho da escala no mês. A conta é do servidor (`conducaoDaPessoa`); a tela só mostra.
// Lista empilhada (nome e valor em cima, o resto embaixo): cabe em qualquer largura da gaveta, sem colunas que esmagam.

const dias = (n: number) => `${String(n).replace('.', ',')} ${n === 1 ? 'dia' : 'dias'}`;

/** "12x36", "horista (Sex, Sáb, Dom)", "12x36 ou 5x2 (a definir)". */
export function escalaDaConducao(p: Pick<PessoaNaConducao, 'escala' | 'dias' | 'tipoVaga'>): string {
  if (p.escala === 'horista') return `horista (${p.dias.map((d) => DIA_ROTULO[d] ?? d).join(', ')})`;
  if (p.escala === 'tanto') return '12x36 ou 5x2 (a definir)';
  if (!p.escala) return p.tipoVaga === 'horista' ? 'horista sem dias marcados' : 'escala a definir';
  return p.escala;
}

function situacaoDaPessoa(p: PessoaNaConducao): string {
  if (p.situacao === 'contratado') return p.contratadoEm ? `Contratado em ${dataBr(diaNoFuso(p.contratadoEm))}` : 'Contratado';
  return 'Aprovado';
}

function ValorDaPessoa({ p }: { p: PessoaNaConducao }) {
  if (p.porMes !== null)
    return (
      <span className="text-right">
        <span className="block font-mono font-semibold">{brl(p.porMes)}</span>
        <span className={`block text-xs ${texto2}`}>{p.porMes > 0 ? 'por mês' : 'sem custo'}</span>
      </span>
    );
  return (
    <span className="text-right">
      <span className="block font-mono font-semibold">—</span>
      <span className={`block text-xs ${texto2}`}>{p.motivo === 'sem_valor' ? 'sem o valor' : 'fora da soma'}</span>
    </span>
  );
}

function LinhaDaPessoa({ p, nomesDasFuncoes, comLoja }: { p: PessoaNaConducao; nomesDasFuncoes: Record<string, string>; comLoja: boolean }) {
  const meio = comoChega({ meios: p.meios, conducoes: p.conducoes, valorIda: null, valorVolta: null });
  const uber = p.uberMotivo ? UBER_ROTULO[p.uberMotivo] : '';
  const valores =
    p.valorIda !== null && p.valorVolta !== null
      ? `Ida ${brl(p.valorIda)} · volta ${brl(p.valorVolta)} · ${escalaDaConducao(p)}${p.diasNoMes !== null ? ` = ${dias(p.diasNoMes)}` : ''}`
      : 'Não informou o valor da ida e da volta na ficha.';
  return (
    <li className="space-y-1 border-b border-border py-3 last:border-b-0" data-conducao-pessoa>
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
        <div className="min-w-0">
          <span className="block font-semibold">{p.nome}</span>
          <span className={`block text-xs ${texto2}`}>
            {situacaoDaPessoa(p)}
            {p.funcoes.length ? ` · ${p.funcoes.map((f) => nomeDaFuncao(f, nomesDasFuncoes)).join(', ')}` : ''}
            {comLoja ? ` · ${p.loja}` : ''}
          </span>
        </div>
        <ValorDaPessoa p={p} />
      </div>
      {(meio || uber) && (
        <span className={`block text-sm ${texto2}`}>
          {meio || '—'}
          {uber ? ` (Uber: ${uber.toLowerCase()})` : ''}
        </span>
      )}
      <span className={`block text-xs ${texto2}`}>{valores}</span>
      {p.motivo === 'escala_a_definir' && p.porDia !== null && (
        <span className={`block text-xs ${texto2}`}>{brl(p.porDia)} por dia de trabalho; entra na soma quando a escala estiver definida.</span>
      )}
    </li>
  );
}

export function GavetaDaConducao({ dados, nomesDasFuncoes, aoFechar }: { dados: ConducaoDosAprovados; nomesDasFuncoes: Record<string, string>; aoFechar: () => void }) {
  const comLoja = new Set(dados.pessoas.map((p) => p.loja)).size > 1;
  return (
    <Gaveta
      titulo="Condução dos aprovados"
      aoFechar={aoFechar}
      rodape={
        <>
          <span className={`mr-auto self-center text-xs ${texto2}`}>Valores informados pelos candidatos; nada aqui vem do vale-transporte.</span>
          <Button type="button" variant="outline" onClick={aoFechar}>
            Fechar
          </Button>
        </>
      }
    >
      <div className="space-y-4" data-conducao-gaveta>
        <p className={`text-sm ${texto2}`}>
          O valor da ida e da volta que cada um informou na ficha, vezes os dias de trabalho da escala no mês (12x36 = 15 dias, 5x2 = 22, 6x1 = 26,
          horista = os dias marcados × 4,3). Entram os aprovados e os contratados nos últimos 30 dias. O vale-transporte de verdade se confere na
          contratação.
        </p>
        {dados.pessoas.length === 0 ? (
          <p className="rounded-md border border-dashed border-border p-4 text-sm">
            Nenhum aprovado nem contratado nos últimos 30 dias. A soma aparece quando alguém passa para Aprovado.
          </p>
        ) : (
          <>
            <ul aria-label="Condução por pessoa">
              {dados.pessoas.map((p) => (
                <LinhaDaPessoa key={p.id} p={p} nomesDasFuncoes={nomesDasFuncoes} comLoja={comLoja} />
              ))}
            </ul>
            <dl className="grid grid-cols-[repeat(auto-fit,minmax(140px,1fr))] gap-2 rounded-md bg-secondary p-3">
              <div className="min-w-0">
                <dt className={`text-xs font-bold ${texto2}`}>Por mês</dt>
                <dd className="font-mono text-lg font-semibold">{brl(dados.porMes)}</dd>
              </div>
              <div className="min-w-0">
                <dt className={`text-xs font-bold ${texto2}`}>Num dia em que todos trabalham</dt>
                <dd className="font-mono text-lg font-semibold">{brl(dados.porDia)}</dd>
              </div>
              <div className="min-w-0">
                <dt className={`text-xs font-bold ${texto2}`}>Pessoas na soma</dt>
                <dd className="font-mono text-lg font-semibold">{dados.somadas}</dd>
                {dados.foraDaSoma > 0 && <dd className={`text-xs ${texto2}`}>{dados.foraDaSoma} fora da soma (sem o valor ou com a escala a definir)</dd>}
              </div>
            </dl>
          </>
        )}
      </div>
    </Gaveta>
  );
}
