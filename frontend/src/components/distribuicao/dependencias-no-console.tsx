'use client';

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { distApi } from '@/lib/api';
import { Gaveta } from '@/components/ui/sobreposto';

// Console da distribuição → aba "Dependências" (F3, parte 2; protótipo `mockups/regem-dependencias-e-qualidade.html`,
// feito com as decisões recomendadas enquanto o dono estava fora). Cada integração que o Regem usa (o inventário do
// código), com a situação lida nas fontes oficiais todo dia às 06:07: a validade da versão da Graph API em uso, a
// situação dos modelos de IA, a tabela do IBPT por estado. Fonte que não responde fica "não verificada desde" — nunca
// "em dia" nem "retirada". Nada se atualiza sozinho. Diretoria e Técnico.

type Situacao = 'a_conferir' | 'vencida' | 'nao_verificada' | 'em_dia' | 'manual' | 'nunca_lida';
type Achado = { integracao: string; usamos: string; situacao: 'em_dia' | 'vencendo' | 'a_conferir'; texto: string; data: string | null };
type Item = {
  id: string;
  nome: string;
  tipo: string;
  usamos: string;
  versao: string | null;
  modelos: string[] | null;
  situacao: Situacao;
  achados: Achado[];
  fonte: { id: string; nome: string; url: string } | null;
  conferidaEm: string | null;
  lidaEm: string | null;
  falha: string | null;
  mudanca: { mudouEm: string; saiu: string[]; entrou: string[] } | null;
  decisao: { decisao: string; em: string; por: string | null; nota: string | null } | null;
};
type Lista = { semMigration: boolean; itens: Item[] };
type Filtro = 'todas' | 'a_conferir' | 'vencida' | 'nao_verificada' | 'em_dia' | 'manual';

const BOTAO = 'inline-flex min-h-10 items-center justify-center whitespace-nowrap rounded-lg px-3.5 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-40';
const PRIMARIO = `${BOTAO} bg-amber-500 text-slate-950 hover:bg-amber-400`;
const NEUTRO = `${BOTAO} border border-slate-600 text-slate-100 hover:bg-slate-800`;
const CARTAO = 'rounded-xl border border-slate-800 bg-slate-900/40 p-4';

const TIPOS: Record<string, string> = { mensagens: 'Mensagens', marketplaces: 'Marketplaces', pagamentos: 'Pagamentos', fiscal: 'Fiscal', ia: 'IA', plataforma: 'Plataforma' };
const dataCurta = (iso: string | null) => (iso ? new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : null);
const filtroDe = (s: Situacao): Filtro => (s === 'nunca_lida' ? 'nao_verificada' : s);

function SeloDaSituacao({ i }: { i: Item }) {
  const [tom, texto] =
    i.situacao === 'a_conferir'
      ? ['warn', i.mudanca && !i.decisao ? `mudou em ${dataCurta(i.mudanca.mudouEm)?.slice(0, 5)} · a conferir` : 'a conferir']
      : i.situacao === 'vencida'
        ? ['crit', 'vencida ou vencendo']
        : i.situacao === 'nao_verificada'
          ? ['neutro', i.conferidaEm ? `não verificada desde ${dataCurta(i.conferidaEm)?.slice(0, 5)}` : 'não verificada']
          : i.situacao === 'nunca_lida'
            ? ['neutro', 'ainda não lida']
            : i.situacao === 'manual'
              ? ['neutro', 'conferir à mão']
              : ['ok', 'em dia'];
  const cor =
    tom === 'crit'
      ? 'border-red-500/50 bg-red-500/10 text-red-200'
      : tom === 'warn'
        ? 'border-amber-500/50 bg-amber-500/10 text-amber-100'
        : tom === 'ok'
          ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200'
          : 'border-slate-600 bg-slate-800/60 text-slate-300';
  return <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${cor}`}>{texto}</span>;
}

export function DependenciasNoConsole() {
  const idBusca = useId();
  const idTipo = useId();
  const [lista, setLista] = useState<Lista | null>(null);
  const [erro, setErro] = useState('');
  const [filtro, setFiltro] = useState<Filtro>('todas');
  const [busca, setBusca] = useState('');
  const [tipo, setTipo] = useState('');
  const [aberto, setAberto] = useState<string | null>(null);
  const [lendo, setLendo] = useState(false);
  const [aviso, setAviso] = useState('');
  const leitura = useRef(0);

  const carregar = useCallback(async () => {
    const vez = ++leitura.current;
    setErro('');
    try {
      const l = (await distApi.dependencias()) as Lista;
      if (vez === leitura.current) setLista(l);
    } catch (e) {
      if (vez === leitura.current) setErro(e instanceof Error ? e.message : 'Não consegui carregar as dependências.');
    }
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  async function lerAgora() {
    setLendo(true);
    setAviso('');
    try {
      const r = (await distApi.lerDependencias()) as { lidas: { fonte: string; leu: boolean; mudou: boolean; falha: string | null }[] };
      const falhas = r.lidas.filter((x) => !x.leu).length;
      const mudaram = r.lidas.filter((x) => x.mudou).length;
      setAviso(`Leitura feita: ${r.lidas.length - falhas} de ${r.lidas.length} fontes lidas${mudaram ? `, ${mudaram} com mudança` : ''}${falhas ? `, ${falhas} sem resposta` : ''}.`);
      await carregar();
    } catch (e) {
      setAviso(e instanceof Error ? e.message : 'Não consegui ler as fontes agora.');
    } finally {
      setLendo(false);
    }
  }

  const contagens = useMemo(() => {
    const c: Record<Filtro, number> = { todas: 0, a_conferir: 0, vencida: 0, nao_verificada: 0, em_dia: 0, manual: 0 };
    for (const i of lista?.itens ?? []) {
      c.todas++;
      c[filtroDe(i.situacao)]++;
    }
    return c;
  }, [lista]);
  const visiveis = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    return (lista?.itens ?? []).filter((i) => (filtro === 'todas' || filtroDe(i.situacao) === filtro) && (!tipo || i.tipo === tipo) && (!termo || `${i.nome} ${i.usamos}`.toLowerCase().includes(termo)));
  }, [lista, filtro, busca, tipo]);
  const doAberto = lista?.itens.find((i) => i.id === aberto) ?? null;

  return (
    <section className="space-y-3" aria-labelledby="dependencias-titulo">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id="dependencias-titulo" className="text-sm font-semibold text-slate-100">
            Dependências e integrações{lista && <span className="ml-1.5 font-mono">{lista.itens.length}</span>}
          </h2>
          <p className="mt-1 max-w-3xl text-xs text-slate-300">
            Cada integração que o Regem usa, com as fontes oficiais lidas todo dia às 06:07. Quando o trecho vigiado muda, a fonte fica &quot;a conferir&quot; com o antes e o depois. Quando a fonte não responde, fica &quot;não verificada desde&quot; — isso nunca quer dizer que a API foi retirada. Nada é atualizado sozinho.
          </p>
        </div>
        <button type="button" className={NEUTRO} disabled={lendo || !lista || lista.semMigration} onClick={() => void lerAgora()}>
          {lendo ? 'Lendo as fontes…' : 'Ler agora'}
        </button>
      </div>
      {aviso && (
        <p className="text-sm text-slate-200" role="status">
          {aviso}
        </p>
      )}
      {lista?.semMigration && (
        <p className={`${CARTAO} text-sm text-amber-100`} role="status">
          A tabela da vigilância ainda não existe nesta nuvem (migration 423). A lista mostra o inventário e o IBPT; as fontes começam a ser lidas depois da migration.
        </p>
      )}
      <div className="flex flex-wrap gap-2" role="group" aria-label="Situação">
        {(
          [
            ['todas', 'Todas'],
            ['a_conferir', 'A conferir'],
            ['vencida', 'Vencidas ou vencendo'],
            ['nao_verificada', 'Não verificadas'],
            ['em_dia', 'Em dia'],
            ['manual', 'Conferir à mão'],
          ] as const
        ).map(([valor, rotulo]) => (
          <button
            key={valor}
            type="button"
            aria-pressed={filtro === valor}
            onClick={() => setFiltro(valor)}
            className={`min-h-10 rounded-full border px-3 text-sm font-semibold ${filtro === valor ? 'border-amber-500 bg-amber-500 text-slate-950' : 'border-slate-600 text-slate-300 hover:bg-slate-800'}`}
          >
            {rotulo}
            {lista && <span className="ml-1.5 font-mono">{contagens[valor]}</span>}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor={idBusca} className="sr-only">
          Buscar integração
        </label>
        <input
          id={idBusca}
          type="search"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Buscar integração"
          className="min-h-10 w-full max-w-sm flex-[1_1_220px] rounded-lg border border-slate-700 bg-slate-900 px-3 text-sm text-slate-100 placeholder:text-slate-500"
        />
        <label htmlFor={idTipo} className="sr-only">
          Tipo
        </label>
        <select id={idTipo} value={tipo} onChange={(e) => setTipo(e.target.value)} className="min-h-10 rounded-lg border border-slate-700 bg-slate-900 px-3 text-sm text-slate-100">
          <option value="">Todos os tipos</option>
          {Object.entries(TIPOS).map(([v, r]) => (
            <option key={v} value={v}>
              {r}
            </option>
          ))}
        </select>
      </div>
      {erro && (
        <div className={CARTAO} role="alert">
          <p className="text-sm text-red-300">{erro}</p>
          <button type="button" className={`${NEUTRO} mt-3`} onClick={() => void carregar()}>
            Tentar de novo
          </button>
        </div>
      )}
      {!erro && !lista && <p className="text-sm text-slate-400">Carregando…</p>}
      {!erro && lista && visiveis.length === 0 && <p className={`${CARTAO} text-center text-sm text-slate-300`}>Nenhuma integração com esses filtros.</p>}
      {!erro && lista && visiveis.length > 0 && (
        <>
          {/* Largo: tabela. Estreito: um cartão por integração — nada rola para o lado (V45). */}
          <table className="hidden w-full text-left text-sm lg:table">
            <caption className="sr-only">Integrações em uso, com a última conferência e a situação</caption>
            <thead className="text-xs text-slate-400">
              <tr className="border-b border-slate-800">
                <th className="py-2 pr-3 font-medium">Integração</th>
                <th className="px-3 py-2 font-medium">Usamos</th>
                <th className="px-3 py-2 font-medium">Conferida</th>
                <th className="px-3 py-2 font-medium">Situação</th>
                <th className="py-2 pl-3 font-medium">
                  <span className="sr-only">Ação</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {visiveis.map((i) => (
                <tr key={i.id} className="border-b border-slate-800/70 align-top">
                  <td className="break-words py-2.5 pr-3">
                    <span className="font-semibold text-slate-100">{i.nome}</span>
                    <span className="block text-xs text-slate-400">{TIPOS[i.tipo] ?? i.tipo}</span>
                  </td>
                  <td className="break-words px-3 py-2.5 text-slate-200">{usamosEmTexto(i)}</td>
                  <td className="whitespace-nowrap px-3 py-2.5 font-mono text-slate-200">{dataCurta(i.conferidaEm) ?? '—'}</td>
                  <td className="px-3 py-2.5">
                    <SeloDaSituacao i={i} />
                  </td>
                  <td className="py-2.5 pl-3 text-right">
                    <button type="button" className={NEUTRO} onClick={() => setAberto(i.id)}>
                      Ver
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <ul className="space-y-2 lg:hidden">
            {visiveis.map((i) => (
              <li key={i.id} className={`${CARTAO} space-y-1.5`}>
                <p className="break-words text-sm font-semibold text-slate-100">{i.nome}</p>
                <p className="text-xs text-slate-400">{TIPOS[i.tipo] ?? i.tipo}</p>
                <p className="break-words text-sm text-slate-200">{usamosEmTexto(i)}</p>
                <p className="flex flex-wrap items-center gap-2 text-xs text-slate-300">
                  <SeloDaSituacao i={i} />
                  {i.conferidaEm && <span className="font-mono">conferida {dataCurta(i.conferidaEm)}</span>}
                </p>
                <button type="button" className={`${NEUTRO} w-full`} onClick={() => setAberto(i.id)}>
                  Ver
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      {doAberto && <GavetaDaDependencia item={doAberto} aoFechar={() => setAberto(null)} aoDecidir={() => void carregar()} />}
    </section>
  );
}

function usamosEmTexto(i: Item): string {
  if (i.versao) return `Graph API ${i.versao}: ${i.usamos}`;
  if (i.modelos?.length) return `${i.modelos.join(', ')} — ${i.usamos}`;
  return i.usamos;
}

function GavetaDaDependencia({ item, aoFechar, aoDecidir }: { item: Item; aoFechar: () => void; aoDecidir: () => void }) {
  const idNota = useId();
  const [nota, setNota] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState('');
  const [feito, setFeito] = useState('');
  const podeDecidir = !!item.fonte && !!item.mudanca && !item.decisao;

  async function decidir(decisao: 'conferida' | 'nao_se_aplica') {
    if (!item.fonte) return;
    setOcupado(true);
    setErro('');
    try {
      await distApi.decidirDependencia(item.fonte.id, decisao, nota.trim());
      setFeito(decisao === 'conferida' ? 'Marcada como conferida.' : 'Marcada como "não se aplica ao Regem".');
      aoDecidir();
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não consegui gravar a decisão.');
    } finally {
      setOcupado(false);
    }
  }

  return (
    <Gaveta
      titulo={item.nome}
      aoFechar={aoFechar}
      rodape={
        podeDecidir ? (
          <>
            <button type="button" className={NEUTRO} disabled={ocupado || !nota.trim()} onClick={() => void decidir('nao_se_aplica')}>
              Não se aplica ao Regem
            </button>
            <button type="button" className={PRIMARIO} disabled={ocupado} onClick={() => void decidir('conferida')}>
              Marcar como conferida
            </button>
          </>
        ) : undefined
      }
    >
      <div className="space-y-4 text-sm">
        <p className="flex flex-wrap gap-2">
          <SeloDaSituacao i={item} />
        </p>
        <Bloco titulo="O que o Regem usa">
          <p className="break-words text-slate-200">{usamosEmTexto(item)}</p>
        </Bloco>
        {item.achados.length > 0 && (
          <Bloco titulo="O que a fonte diz">
            <ul className="list-disc space-y-1 pl-5 text-slate-200">
              {item.achados.map((a) => (
                <li key={`${a.integracao}-${a.usamos}`} className="break-words">
                  {a.texto}
                </li>
              ))}
            </ul>
          </Bloco>
        )}
        {item.mudanca && (
          <Bloco titulo={`O que mudou (visto em ${dataCurta(item.mudanca.mudouEm)})`}>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <div className="min-w-0 rounded-lg border border-slate-700 p-2.5">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Antes</p>
                {item.mudanca.saiu.length ? item.mudanca.saiu.map((l) => <p key={l} className="break-words font-mono text-xs text-slate-200">{l}</p>) : <p className="text-xs text-slate-400">nada saiu</p>}
              </div>
              <div className="min-w-0 rounded-lg border border-slate-700 p-2.5">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Depois</p>
                {item.mudanca.entrou.length ? item.mudanca.entrou.map((l) => <p key={l} className="break-words font-mono text-xs text-slate-200">{l}</p>) : <p className="text-xs text-slate-400">nada entrou</p>}
              </div>
            </div>
          </Bloco>
        )}
        <Bloco titulo="Fonte">
          {item.fonte ? (
            <>
              <p className="break-words text-slate-200">
                <a className="text-sky-300 underline" href={item.fonte.url} target="_blank" rel="noreferrer noopener">
                  {item.fonte.nome}
                </a>
              </p>
              <p className="text-xs text-slate-400">
                {item.conferidaEm ? `Última leitura certa: ${dataCurta(item.conferidaEm)}.` : 'Ainda não lida.'}
                {item.falha ? ` A última tentativa falhou: ${item.falha}.` : ''}
              </p>
            </>
          ) : item.id === 'ibpt' ? (
            <p className="text-slate-300">A tabela do IBPT é enviada pela DMS em Atualizações; a situação vem do banco, por estado com loja fiscal.</p>
          ) : (
            <p className="text-slate-300">A vigilância automática ainda não cobre esta integração: confira a documentação dela à mão.</p>
          )}
        </Bloco>
        {item.decisao && (
          <Bloco titulo="Decisão">
            <p className="text-slate-200">
              {item.decisao.decisao === 'conferida' ? 'Conferida' : 'Não se aplica ao Regem'}
              {item.decisao.por ? ` por ${item.decisao.por}` : ''} em {dataCurta(item.decisao.em)}.
            </p>
            {item.decisao.nota && <p className="break-words text-xs text-slate-300">{item.decisao.nota}</p>}
          </Bloco>
        )}
        {podeDecidir && (
          <div>
            <label htmlFor={idNota} className="text-xs text-slate-300">
              Nota (o critério, a tarefa — obrigatória para &quot;não se aplica&quot;)
            </label>
            <textarea id={idNota} value={nota} onChange={(e) => setNota(e.target.value)} maxLength={300} rows={3} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 p-2.5 text-sm text-slate-100" />
          </div>
        )}
        {erro && (
          <p className="text-sm text-red-300" role="alert">
            {erro}
          </p>
        )}
        {feito && (
          <p className="text-sm text-emerald-300" role="status">
            {feito}
          </p>
        )}
      </div>
    </Gaveta>
  );
}

function Bloco({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">{titulo}</h3>
      {children}
    </div>
  );
}
