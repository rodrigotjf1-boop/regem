'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Ban, Check, CheckCheck, Play, Plus } from 'lucide-react';
import { api, getCategoria, getToken } from '@/lib/api';
import { toast } from '@/lib/toast';
import { Shell } from '@/components/app-shell/shell';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Partes } from '@/components/ui/partes';
import { SkeletonList } from '@/components/ui/skeleton';
import {
  FiltroBusca, FiltroSelect, Filtros, ListaDados, NomeComApoio, PERIODOS, PERIODO_PADRAO, Selo, Situacoes, TituloLista, Vazio, distintos, semAcento, texto2,
  type Acao, type Situacao,
} from '@/components/ui/lista';
import { CancelarOrdem } from '@/components/ordens/ordem-cancelar';
import { ConcluirOrdem } from '@/components/ordens/ordem-concluir';
import { NovaOrdem } from '@/components/ordens/ordem-form';
import { QuadroOrdens } from '@/components/ordens/quadro';
import { RelatorioOrdens } from '@/components/ordens/relatorio';
import {
  A_FAZER, EM_PRODUCAO, ENCERRADA, PENDENCIA, STATUS_TOM, apoioDe, diasAtras, fichaDe, grupoDe, podeCancelar, podeConcluir, podeIniciar, podeLiberar, quandoDe, rotuloDe,
  situacaoDe,
} from '@/components/ordens/ordem';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Parte = 'ordens' | 'quadro' | 'relatorio';
const ID_TITULO = 'ordens-titulo';
/** O servidor devolve no máximo esta quantidade por pedido. */
const LIMITE = 500;
const SITUACOES: Situacao<any>[] = [
  { rotulo: 'A fazer', filtro: (o) => grupoDe(o) === A_FAZER },
  { rotulo: 'Em produção', filtro: (o) => grupoDe(o) === EM_PRODUCAO },
  { rotulo: 'Pendências', filtro: (o) => grupoDe(o) === PENDENCIA, tom: 'critico' },
  { rotulo: 'Encerradas', filtro: (o) => grupoDe(o) === ENCERRADA },
];
const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;

// Tarefas → Pedidos de produção (mockup `mockups/regem-configuracoes.html`). Três partes:
//  • Ordens — a lista: o que ainda pede ação (a fazer, em produção e as pendências de lançamento),
//    sempre inteiro, e as encerradas do período escolhido.
//  • Quadro — as três colunas, como painel da produção interna.
//  • Relatório — planejado × produzido.
export default function OrdensProducaoPage() {
  const router = useRouter();
  const [parte, setParte] = useState<Parte>('ordens');
  const [gestao, setGestao] = useState(false);
  const [abertas, setAbertas] = useState<any[] | null>(null);
  const [encerradas, setEncerradas] = useState<any[] | null>(null);
  const [erroCarga, setErroCarga] = useState('');
  const [periodo, setPeriodo] = useState<string>(PERIODO_PADRAO);
  const [busca, setBusca] = useState('');
  const [sit, setSit] = useState(-1);
  const [filtroSituacao, setFiltroSituacao] = useState('');
  const [filtroSetor, setFiltroSetor] = useState('');
  const [filtroResp, setFiltroResp] = useState('');
  const [agindo, setAgindo] = useState<string | null>(null);
  const [nova, setNova] = useState(false);
  const [concluindo, setConcluindo] = useState<any | null>(null);
  const [cancelando, setCancelando] = useState<any | null>(null);

  // Duas leituras: o que está ABERTO (sem período — uma pendência antiga não pode sumir) e o
  // que foi ENCERRADO no período. O corte é do servidor, antes do limite dele.
  const carregar = useCallback(async (dias: string) => {
    setErroCarga('');
    try {
      const [a, e]: any = await Promise.all([
        api.ordensProducao('situacao=abertas'),
        api.ordensProducao(`situacao=encerradas${dias ? `&de=${diasAtras(Number(dias))}` : ''}`),
      ]);
      setAbertas(Array.isArray(a) ? a : []);
      setEncerradas(Array.isArray(e) ? e : []);
    } catch (e) {
      setErroCarga(e instanceof Error ? e.message : 'Erro ao carregar');
    }
  }, []);

  useEffect(() => {
    if (!getToken()) {
      router.replace('/entrar');
      return;
    }
    // Cancelar e "repetir todo dia" o servidor só aceita de presidente, gerente e supervisão.
    setGestao(['presidente', 'gerente', 'supervisao', 'suporte'].includes(getCategoria() ?? ''));
  }, [router]);
  useEffect(() => {
    if (getToken()) void carregar(periodo);
  }, [carregar, periodo]);

  const recarregar = () => carregar(periodo);
  async function agir(o: any, pedido: () => Promise<unknown>, feito: string) {
    if (agindo) return;
    setAgindo(o.id);
    try {
      await pedido();
      toast.success(feito);
      await recarregar();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro');
    } finally {
      setAgindo(null);
    }
  }
  const liberar = (o: any) => void agir(o, () => api.liberarOrdem(o.id), 'Ordem liberada.');
  const iniciar = (o: any) => void agir(o, () => api.iniciarOrdem(o.id), 'Produção iniciada.');

  if (erroCarga)
    return (
      <Shell eyebrow="Tarefas" title="Ordens de produção">
        <Card className="space-y-3 p-5 text-sm">
          <p role="alert">{erroCarga}</p>
          <Button type="button" variant="outline" size="sm" onClick={() => void recarregar()}>Tentar de novo</Button>
        </Card>
      </Shell>
    );
  if (!abertas || !encerradas)
    return (
      <Shell eyebrow="Tarefas" title="Ordens de produção">
        <SkeletonList rows={6} />
      </Shell>
    );

  const ordens = [...abertas, ...encerradas];
  const pendencias = abertas.filter((o) => grupoDe(o) === PENDENCIA).length;
  const b = semAcento(busca);
  const setorDe = (o: any) => o.setorNome ?? 'Sem setor';
  const respDe = (o: any) => o.colaboradorNome ?? 'Sem responsável';
  const base = ordens.filter(
    (o) =>
      (!b || semAcento(fichaDe(o)).includes(b)) &&
      (!filtroSituacao || situacaoDe(o) === filtroSituacao) &&
      (!filtroSetor || setorDe(o) === filtroSetor) &&
      (!filtroResp || respDe(o) === filtroResp),
  );
  const linhas = sit < 0 ? base : base.filter(SITUACOES[sit].filtro);
  const filtrando = !!(busca.trim() || filtroSituacao || filtroSetor || filtroResp || sit >= 0);
  const limpar = () => { setBusca(''); setFiltroSituacao(''); setFiltroSetor(''); setFiltroResp(''); setSit(-1); };
  const rotuloPeriodo = PERIODOS.find((p) => p.v === periodo)?.rotulo.toLowerCase() ?? '';
  const ocupada = (o: any) => agindo === o.id;
  const acoesDe = (o: any): Acao<any>[] => [
    ...(podeLiberar(o) ? [{ rotulo: 'Liberar', icone: Check, aoClicar: liberar, ocupada }] : []),
    ...(podeIniciar(o) ? [{ rotulo: 'Iniciar', icone: Play, aoClicar: iniciar, ocupada }] : []),
    ...(podeConcluir(o) ? [{ rotulo: 'Concluir', icone: CheckCheck, aoClicar: setConcluindo, tom: 'primaria' as const, ocupada }] : []),
    ...(gestao && podeCancelar(o) ? [{ rotulo: 'Cancelar', icone: Ban, aoClicar: setCancelando, tom: 'perigo' as const, ocupada }] : []),
  ];

  return (
    <Shell eyebrow="Tarefas" title="Ordens de produção">
      <div className="space-y-4">
        <Partes<Parte>
          rotulo="Partes de Ordens de produção"
          ativa={parte}
          aoEscolher={setParte}
          partes={[
            { key: 'ordens', label: 'Ordens', conta: abertas.length },
            { key: 'quadro', label: 'Quadro', conta: abertas.filter((o) => [A_FAZER, EM_PRODUCAO].includes(grupoDe(o))).length },
            { key: 'relatorio', label: 'Relatório' },
          ]}
        />

        {parte === 'ordens' && (
          <section className="space-y-3" aria-labelledby={ID_TITULO}>
            <TituloLista id={ID_TITULO} titulo="Ordens de produção" total={ordens.length} mostrando={linhas.length} um="ordem" varios="ordens"
              extra={`${pendencias ? `${plural(pendencias, 'pendência', 'pendências')} para lançar` : 'nenhuma pendência'} · encerradas: ${periodo ? rotuloPeriodo : 'todo o período'}`}>
              <Button type="button" onClick={() => setNova(true)}><Plus className="h-4 w-4" aria-hidden="true" /> Nova ordem</Button>
            </TituloLista>
            {pendencias > 0 && (
              <p className="rounded-md border-l-4 border-destructive bg-destructive/10 px-3 py-2 text-sm">
                <b>{plural(pendencias, 'ordem espera', 'ordens esperam')} lançamento.</b> São as que ficaram para lançar depois. Passado 1 dia da data prevista viram{' '}
                <b>pendência crítica</b> e exigem desfecho: lançar o resultado ou cancelar.
              </p>
            )}
            <Situacoes base={base} opcoes={SITUACOES} valor={sit} aoMudar={setSit} />
            <Filtros>
              <FiltroBusca id="ordens-busca" valor={busca} aoMudar={setBusca} placeholder="Nome da ficha" />
              <FiltroSelect id="ordens-situacao" rotulo="Situação" todos="Todas as situações" opcoes={distintos(ordens, situacaoDe)} valor={filtroSituacao} aoMudar={setFiltroSituacao} />
              <FiltroSelect id="ordens-setor" rotulo="Setor" todos="Todos os setores" opcoes={distintos(ordens, setorDe)} valor={filtroSetor} aoMudar={setFiltroSetor} />
              <FiltroSelect id="ordens-responsavel" rotulo="Responsável" todos="Todas as pessoas" opcoes={distintos(ordens, respDe)} valor={filtroResp} aoMudar={setFiltroResp} />
              <FiltroSelect id="ordens-periodo" rotulo="Encerradas no período" opcoes={PERIODOS} valor={periodo} aoMudar={setPeriodo} />
            </Filtros>
            {(abertas.length >= LIMITE || encerradas.length >= LIMITE) && (
              <p className="rounded-md border-l-4 border-warn bg-warn/10 px-3 py-2 text-sm" role="status">
                A lista traz no máximo {LIMITE} ordens {abertas.length >= LIMITE ? 'em aberto' : 'encerradas'} (as mais recentes).
                {encerradas.length >= LIMITE && abertas.length < LIMITE ? ' Escolha um período menor para ver todas as encerradas dele.' : ''}
              </p>
            )}

            {ordens.length === 0 ? (
              <Vazio>Nenhuma ordem em aberto nem encerrada neste período. Crie a primeira em “Nova ordem”.</Vazio>
            ) : linhas.length === 0 ? (
              <Vazio aoLimpar={limpar} />
            ) : (
              <ListaDados
                legenda="Ordens de produção"
                linhas={linhas}
                chave={(o) => o.id}
                nome={rotuloDe}
                colunas={[
                  { titulo: 'Ficha', celula: (o) => <NomeComApoio nome={fichaDe(o)} apoio={apoioDe(o)} /> },
                  { titulo: 'Data e hora', celula: (o) => <span className="whitespace-nowrap font-mono">{quandoDe(o)}</span> },
                  { titulo: 'Setor', celula: (o) => o.setorNome ?? '—' },
                  { titulo: 'Responsável', celula: (o) => o.colaboradorNome ?? '—' },
                  { titulo: 'Situação', celula: (o) => <Selo tom={STATUS_TOM[o.status] ?? 'neutro'}>{situacaoDe(o).toLowerCase()}</Selo> },
                ]}
                acoes={acoesDe}
              />
            )}
            {filtrando && linhas.length > 0 && (
              <p><Button type="button" variant="outline" size="sm" onClick={limpar}>Limpar filtros</Button></p>
            )}
          </section>
        )}

        {parte === 'quadro' && (
          <section className="space-y-3" aria-labelledby="quadro-titulo">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 id="quadro-titulo" tabIndex={-1} className="font-display text-xl font-bold outline-none">Quadro</h2>
                <p className={`text-sm ${texto2}`} role="status">
                  {abertas.filter((o) => grupoDe(o) === A_FAZER).length} a fazer · {abertas.filter((o) => grupoDe(o) === EM_PRODUCAO).length} em produção ·{' '}
                  {encerradas.length} {encerradas.length === 1 ? 'encerrada' : 'encerradas'} ({periodo ? rotuloPeriodo : 'todo o período'})
                  {pendencias > 0 ? ` · ${plural(pendencias, 'pendência', 'pendências')} na lista` : ''}
                </p>
              </div>
              <Button type="button" onClick={() => setNova(true)}><Plus className="h-4 w-4" aria-hidden="true" /> Nova ordem</Button>
            </div>
            <QuadroOrdens ordens={ordens} gestao={gestao} agindo={agindo} aoLiberar={liberar} aoIniciar={iniciar} aoConcluir={setConcluindo} aoCancelar={setCancelando} />
          </section>
        )}

        {parte === 'relatorio' && <RelatorioOrdens />}
      </div>

      {nova && <NovaOrdem gestao={gestao} voltarPara={ID_TITULO} aoFechar={() => setNova(false)} aoSalvar={() => { setNova(false); void recarregar(); }} />}
      {concluindo && <ConcluirOrdem ordem={concluindo} voltarPara={ID_TITULO} aoFechar={() => setConcluindo(null)} aoSalvar={() => { setConcluindo(null); void recarregar(); }} />}
      {cancelando && <CancelarOrdem ordem={cancelando} voltarPara={ID_TITULO} aoFechar={() => setCancelando(null)} aoCancelar={() => { setCancelando(null); void recarregar(); }} />}
    </Shell>
  );
}
