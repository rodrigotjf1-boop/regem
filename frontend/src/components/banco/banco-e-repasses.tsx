'use client';

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { FiltroBusca, FiltroSelect, Filtros, TituloLista, texto2 } from '@/components/ui/lista';
import { cn } from '@/lib/utils';
import { SkeletonList } from '@/components/ui/skeleton';
import { api } from '@/lib/api';
import {
  NOME_DA_FONTE,
  SITUACOES,
  ORDEM_DAS_FONTES,
  brlDeCentavos,
  comSinal,
  opcoesDePeriodo,
  type Lancamento,
  type RespostaDoBanco,
  type SituacaoDoLancamento,
} from '@/lib/banco-repasses';
import { FaixaDasFontes } from './faixa-das-fontes';
import { GavetaDoLancamento } from './gaveta-do-lancamento';
import { ImportarExtrato } from './importar-extrato';
import { ListaDeLancamentos } from './lista-de-lancamentos';

// FINANCEIRO › BANCO E REPASSES: a tela no modelo do Estoque (título com a contagem, situações que filtram, busca e filtros,
// a linha que abre em gaveta). Os filtros e as contas ficam no servidor: a lista vem em páginas.
const POR_VEZ = 12;

function Total({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div className="min-w-0 rounded-lg border border-border bg-card px-3 py-2">
      <span className={`block text-xs ${texto2}`}>{rotulo}</span>
      <b className="block font-mono text-base font-bold tabular-nums [overflow-wrap:anywhere]">{valor}</b>
    </div>
  );
}

export function BancoERepasses() {
  const idDe = useId();
  const idAte = useId();
  const [dados, setDados] = useState<RespostaDoBanco | null>(null);
  const [linhas, setLinhas] = useState<Lancamento[]>([]);
  const [erro, setErro] = useState(false);
  const [lendo, setLendo] = useState(true);
  const [lendoMais, setLendoMais] = useState(false);
  const [situacao, setSituacao] = useState<SituacaoDoLancamento | ''>('');
  const [busca, setBusca] = useState('');
  const [buscaFirme, setBuscaFirme] = useState('');
  const [periodo, setPeriodo] = useState('mes');
  const [de, setDe] = useState('');
  const [ate, setAte] = useState('');
  const [fonte, setFonte] = useState('');
  const [importando, setImportando] = useState(false);
  const [aberto, setAberto] = useState<Lancamento | null>(null);
  // Só a resposta do pedido mais novo vale (V64).
  const pedido = useRef(0);

  useEffect(() => {
    const t = setTimeout(() => setBuscaFirme(busca.trim()), 250);
    return () => clearTimeout(t);
  }, [busca]);

  const lidoAte = dados?.fontes.banco.lidoAte ?? null;
  const periodos = useMemo(() => opcoesDePeriodo(lidoAte), [lidoAte]);
  const invertido = periodo === 'outro' && !!de && !!ate && de > ate;

  const consulta = useCallback(
    (deslocamento: number): Record<string, string> | null => {
      const q: Record<string, string> = { limite: String(POR_VEZ), deslocamento: String(deslocamento) };
      if (periodo === 'mes') q.periodo = 'ultimo';
      else if (periodo === 'outro') {
        if (de && ate && de > ate) return null;
        if (de) q.de = de;
        if (ate) q.ate = ate;
      } else if (periodo !== 'tudo') {
        const o = periodos.find((p) => p.v === periodo);
        if (o?.de) q.de = o.de;
        if (o?.ate) q.ate = o.ate;
      }
      if (situacao) q.situacao = situacao;
      if (fonte) q.fonte = fonte;
      if (buscaFirme) q.busca = buscaFirme;
      return q;
    },
    [periodo, de, ate, periodos, situacao, fonte, buscaFirme],
  );

  const ler = useCallback(async () => {
    const q = consulta(0);
    if (!q) return;
    const meu = ++pedido.current;
    setLendo(true);
    setErro(false);
    try {
      const r = (await api.bancoRepasses(q)) as RespostaDoBanco;
      if (meu !== pedido.current) return;
      setDados(r);
      setLinhas(r.lista);
    } catch {
      if (meu === pedido.current) setErro(true);
    } finally {
      if (meu === pedido.current) setLendo(false);
    }
  }, [consulta]);

  useEffect(() => {
    void ler();
  }, [ler]);

  async function verMais() {
    const q = consulta(linhas.length);
    if (!q || lendoMais) return;
    const meu = pedido.current;
    setLendoMais(true);
    try {
      const r = (await api.bancoRepasses(q)) as RespostaDoBanco;
      if (meu !== pedido.current) return;
      setLinhas((a) => {
        const ja = new Set(a.map((x) => x.id));
        return [...a, ...r.lista.filter((x) => !ja.has(x.id))];
      });
    } catch {
      if (meu === pedido.current) setErro(true);
    } finally {
      setLendoMais(false);
    }
  }

  function limpar() {
    setSituacao('');
    setBusca('');
    setBuscaFirme('');
    setPeriodo('mes');
    setDe('');
    setAte('');
    setFonte('');
  }

  const rotuloDoTipo = useCallback((t: string | null) => dados?.tipos.find((x) => x.chave === t)?.rotulo ?? '', [dados]);

  const gavetas = (
    <>
      {importando && (
        <ImportarExtrato
          aoFechar={() => setImportando(false)}
          aoImportar={() => {
            setImportando(false);
            void ler();
          }}
        />
      )}
      {aberto && dados && (
        <GavetaDoLancamento
          lancamento={aberto}
          tipos={dados.tipos}
          aoFechar={() => setAberto(null)}
          aoSalvar={() => {
            setAberto(null);
            void ler();
          }}
        />
      )}
    </>
  );

  if (erro && !dados)
    return (
      <Card role="alert" className="border-destructive/40 p-8 text-center text-sm">
        <b className="mb-1 block font-display text-base">Não consegui ler os lançamentos</b>
        <span className={texto2}>Nada se perdeu. Tente de novo em instantes.</span>
        <div className="mt-3"><Button type="button" variant="outline" onClick={() => void ler()}>Tentar de novo</Button></div>
      </Card>
    );
  if (!dados)
    return (
      <div role="status" aria-label="Carregando os lançamentos">
        <SkeletonList rows={5} />
      </div>
    );

  if (dados.total === 0)
    return (
      <div className="space-y-3">
        <TituloLista id="banco-titulo" titulo="Banco e repasses" total={0} mostrando={0} um="lançamento" varios="lançamentos">
          <Button type="button" onClick={() => setImportando(true)}>Importar extrato</Button>
        </TituloLista>
        <Card className="p-8 text-center text-sm">
          <b className="mb-1 block font-display text-base">Nenhum extrato importado ainda</b>
          <span className={texto2}>Baixe o extrato em OFX no site ou no app do banco e envie aqui. O Regem mostra tudo antes de gravar.</span>
          <div className="mt-3"><Button type="button" onClick={() => setImportando(true)}>Importar extrato</Button></div>
        </Card>
        {gavetas}
      </div>
    );

  const contaDaSituacao = (v: SituacaoDoLancamento) => dados.contagem[v];
  const opcoesDeFonte = ORDEM_DAS_FONTES
    .filter((f) => dados.fontes.comDado.includes(f))
    .map((f) => ({ v: f, rotulo: NOME_DA_FONTE[f] }));
  const ficha = (ligada: boolean) =>
    cn(
      'inline-flex min-h-10 items-center gap-2 whitespace-nowrap rounded-md border px-3 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
      ligada ? 'border-foreground bg-foreground text-background' : `border-input bg-card ${texto2} hover:border-secondary-foreground hover:text-foreground`,
    );
  const contaFicha = (ligada: boolean) => cn('rounded-full px-2 py-px font-mono text-xs', ligada ? 'bg-background/20 text-background' : 'bg-secondary text-foreground');

  return (
    <div className="min-w-0 space-y-3">
      <TituloLista id="banco-titulo" titulo="Banco e repasses" total={dados.total} mostrando={dados.filtrados} um="lançamento" varios="lançamentos">
        <Button type="button" onClick={() => setImportando(true)}>Importar extrato</Button>
      </TituloLista>

      <FaixaDasFontes banco={dados.fontes.banco} />

      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,150px),1fr))] gap-2">
        <Total rotulo="Entrou no banco" valor={brlDeCentavos(dados.totais.entrou)} />
        <Total rotulo="Saiu do banco" valor={brlDeCentavos(dados.totais.saiu)} />
        <Total rotulo="Diferença" valor={comSinal(dados.totais.diferenca)} />
        <Total rotulo="Esperado, ainda não caiu" valor={brlDeCentavos(dados.totais.esperado)} />
      </div>

      <div className="flex flex-wrap gap-2" role="group" aria-label="Filtrar por situação">
        <button type="button" aria-pressed={situacao === ''} className={ficha(situacao === '')} onClick={() => setSituacao('')}>
          Todos <span className={contaFicha(situacao === '')}>{dados.base}</span>
        </button>
        {SITUACOES.map((s) => (
          <button key={s.v} type="button" aria-pressed={situacao === s.v} className={ficha(situacao === s.v)} onClick={() => setSituacao(situacao === s.v ? '' : s.v)}>
            {s.rotulo} <span className={contaFicha(situacao === s.v)}>{contaDaSituacao(s.v)}</span>
          </button>
        ))}
      </div>

      <details className="text-sm">
        <summary className="min-h-11 cursor-pointer py-2.5 font-semibold text-foreground underline underline-offset-2">O que quer dizer cada situação</summary>
        <dl className="mt-1.5 grid grid-cols-[repeat(auto-fit,minmax(min(100%,220px),1fr))] gap-2">
          {SITUACOES.map((s) => (
            <div key={s.v} className="rounded-md border border-border bg-card px-2.5 py-1.5">
              <dt className="font-bold">{s.rotulo}</dt>
              <dd className={texto2}>{s.explica}</dd>
            </div>
          ))}
        </dl>
      </details>

      <Filtros emLinha>
        <FiltroBusca id="banco-busca" valor={busca} aoMudar={setBusca} placeholder="Buscar por descrição ou tipo" />
        <FiltroSelect id="banco-periodo" rotulo="Período" opcoes={periodos.map((p) => ({ v: p.v, rotulo: p.rotulo }))} valor={periodo} aoMudar={setPeriodo} />
        <FiltroSelect id="banco-fonte" rotulo="Fonte" todos="Todas as fontes" opcoes={opcoesDeFonte} valor={fonte} aoMudar={setFonte} />
      </Filtros>
      {periodo === 'outro' && (
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-0 space-y-1">
            <Label htmlFor={idDe}>De</Label>
            <Input id={idDe} type="date" value={de} onChange={(e) => setDe(e.target.value)} className="w-auto max-w-full" />
          </div>
          <div className="min-w-0 space-y-1">
            <Label htmlFor={idAte}>Até</Label>
            <Input id={idAte} type="date" value={ate} onChange={(e) => setAte(e.target.value)} className="w-auto max-w-full" />
          </div>
          {invertido && <p role="alert" className="pb-2 text-sm font-medium text-destructive">A data inicial vem depois da final.</p>}
        </div>
      )}

      {erro ? (
        <Card role="alert" className="border-destructive/40 p-6 text-center text-sm">
          <b className="mb-1 block font-display text-base">Não consegui ler os lançamentos</b>
          <span className={texto2}>Nada se perdeu. Tente de novo em instantes.</span>
          <div className="mt-3"><Button type="button" variant="outline" onClick={() => void ler()}>Tentar de novo</Button></div>
        </Card>
      ) : lendo && !linhas.length ? (
        <div role="status" aria-label="Carregando os lançamentos"><SkeletonList rows={4} /></div>
      ) : !linhas.length ? (
        <Card className="p-8 text-center text-sm">
          <b className="mb-1 block font-display text-base">Nenhum lançamento com esses filtros</b>
          <span className={texto2}>Troque o período, a fonte ou a situação.</span>
          <div className="mt-3"><Button type="button" variant="outline" onClick={limpar}>Limpar filtros</Button></div>
        </Card>
      ) : (
        <ListaDeLancamentos linhas={linhas} rotuloDoTipo={rotuloDoTipo} aoAbrir={setAberto} />
      )}

      {!erro && linhas.length > 0 && (
        <div className={`flex flex-wrap items-center justify-center gap-x-3.5 gap-y-2 text-sm ${texto2}`}>
          {dados.filtrados > linhas.length ? (
            <>
              <span>Mostrando {linhas.length} de {dados.filtrados}</span>
              <Button type="button" variant="outline" onClick={verMais} disabled={lendoMais}>
                {lendoMais ? 'Lendo…' : `Mostrar mais ${Math.min(POR_VEZ, dados.filtrados - linhas.length)}`}
              </Button>
            </>
          ) : dados.filtrados > POR_VEZ ? (
            <span>Mostrando todos os {dados.filtrados}</span>
          ) : null}
        </div>
      )}
      {gavetas}
    </div>
  );
}
