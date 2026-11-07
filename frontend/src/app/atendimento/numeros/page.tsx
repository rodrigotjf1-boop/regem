'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { api, getCategoria } from '@/lib/api';
import { toast } from '@/lib/toast';
import { Shell } from '@/components/app-shell/shell';
import { Button } from '@/components/ui/button';
import { Dialogo, Gaveta } from '@/components/ui/sobreposto';
import { ChipDoCanal } from '@/components/atendimento/chip-do-canal';
import { OQueAconteceu, type MarcaDoCaso } from '@/components/atendimento/o-que-aconteceu';
import { useEscopoDeLoja } from '@/components/relatorios/escopo';
import { brl } from '@/components/ui/lista';

/* eslint-disable @typescript-eslint/no-explicit-any */

// NÚMEROS DO ATENDIMENTO (item 8 da Central; protótipo `mockups/regem-central-atendimento.html`, versão 6): o PLACAR por
// canal (no chat do iFood, a mesma régua que o iFood mostra ao cliente: tempo médio e taxa de resposta, 30 dias), as
// RECLAMAÇÕES por motivo e por produto e QUANTO CUSTOU. Da loja em uso; o presidente pode somar as lojas. Só gerente e
// presidente (o servidor confere). Tudo se arruma pelo ESPAÇO da peça, não pela janela (V45, ERR-219).

type Periodo = '7' | '30' | 'mes' | 'ant';
const PERIODOS: { k: Periodo; rotulo: string; texto: string }[] = [
  { k: '7', rotulo: 'Últimos 7 dias', texto: 'nos últimos 7 dias' },
  { k: '30', rotulo: 'Últimos 30 dias', texto: 'nos últimos 30 dias' },
  { k: 'mes', rotulo: 'Este mês', texto: 'neste mês' },
  { k: 'ant', rotulo: 'Mês passado', texto: 'no mês passado' },
];
type Canal = { k: string; canal: string; nome: string; o: string; chegaram: number; respondidas: number; segMedio: number | null; semResposta: number; semMensagens?: boolean };
type MotivoN = { k: string; nome: string; casos: number; centavos: number; estimado: boolean; daPlataforma: number };
type ProdutoN = { nome: string; casos: number; centavos: number; motivos: { k: string; nome: string; casos: number }[] };
type Numeros = {
  canais: Canal[];
  motivos: MotivoN[];
  produtos: ProdutoN[];
  custou: { centavos: number; casos: number; estimado: boolean; semValor: number };
  reclamacoes: number;
  parcial: boolean;
};
type CasoN = { id: string; canal: string | null; titulo: string; criadoEm: string; motivo: string | null; fonte: string | null; produtos: string[]; centavos: number; estimado: boolean; aberto: boolean };
type Escolha = { grupo: 'motivo' | 'produto'; chave: string; titulo: string };

const NOME_DO_MOTIVO: Record<string, string> = {
  atraso: 'Atraso',
  faltou: 'Faltou item',
  errado: 'Item errado ou trocado',
  frio: 'Chegou frio',
  embalagem: 'Embalagem ou derramou',
  qualidade: 'Qualidade ou sabor',
  entregador: 'Entregador',
  cobranca: 'Cobrança ou valor',
  outro: 'Outro problema',
  nao: 'Não foi reclamação',
};

/** "2 min 40 s", "1 h 20 min", "45 s". */
function tempoDe(seg: number | null | undefined): string {
  if (seg == null || !Number.isFinite(seg)) return '—';
  const s = Math.max(0, Math.round(seg));
  if (s >= 3600) return `${Math.floor(s / 3600)} h ${String(Math.round((s % 3600) / 60)).padStart(2, '0')} min`;
  if (s >= 60) return `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, '0')} s`;
  return `${s} s`;
}
const pct = (c: Canal) => (c.chegaram ? `${Math.round((c.respondidas / c.chegaram) * 100)}%` : '—');
const dataHora = (iso: string) =>
  new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
const casos = (n: number) => `${n} ${n === 1 ? 'caso' : 'casos'}`;

/** A largura da peça (não da janela): o placar e as listas se arrumam por ela. */
function useLargura<T extends HTMLElement>(): [React.RefObject<T>, number] {
  const ref = useRef<T>(null);
  const [l, setL] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => setL(el.clientWidth));
    ro.observe(el);
    setL(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  return [ref, l];
}

export default function NumerosDoAtendimentoPage() {
  const [categoria, setCategoria] = useState<string | null | undefined>(undefined);
  useEffect(() => setCategoria(getCategoria()), []); // V35: o perfil só depois de montar
  const gestao = categoria === 'presidente' || categoria === 'gerente';
  const loja = useEscopoDeLoja();
  const [periodo, setPeriodo] = useState<Periodo>('30');
  const [dados, setDados] = useState<Numeros | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [gaveta, setGaveta] = useState<Escolha | null>(null);
  const [caixa, largura] = useLargura<HTMLDivElement>();
  // V64: só a resposta da leitura mais nova vale (trocar de período rápido não mistura os números).
  const vez = useRef(0);

  const ler = useCallback(async () => {
    const n = ++vez.current;
    setCarregando(true);
    setErro(null);
    try {
      const r: any = await api.atendimentoNumeros(periodo, loja.total);
      if (n !== vez.current) return;
      setDados({
        canais: Array.isArray(r?.canais) ? r.canais : [],
        motivos: Array.isArray(r?.motivos) ? r.motivos : [],
        produtos: Array.isArray(r?.produtos) ? r.produtos : [],
        custou: r?.custou ?? { centavos: 0, casos: 0, estimado: false, semValor: 0 },
        reclamacoes: Number(r?.reclamacoes) || 0,
        parcial: !!r?.parcial,
      });
    } catch (e: any) {
      if (n !== vez.current) return;
      setErro(e?.message || 'Não deu para ler os números agora.');
    } finally {
      if (n === vez.current) setCarregando(false);
    }
  }, [periodo, loja.total]);

  useEffect(() => {
    if (gestao) void ler();
  }, [gestao, ler]);

  const texto = PERIODOS.find((p) => p.k === periodo)!.texto;
  const kpis = largura >= 900 ? 'grid-cols-4' : largura >= 420 ? 'grid-cols-2' : 'grid-cols-1';
  const doisLados = largura >= 1000;

  return (
    <Shell eyebrow="Relatórios › Atendimento" title="Números do atendimento">
      <div ref={caixa} className="min-w-0 space-y-4">
        {categoria !== undefined && !gestao ? (
          <p className="rounded-md border border-dashed border-input bg-card px-4 py-6 text-center text-sm text-secondary-foreground">
            Os números do atendimento são de gerente e presidente.
          </p>
        ) : (
          <>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <p className="min-w-0 text-sm text-secondary-foreground" role="status" aria-live="polite">
                {loja.texto[0].toUpperCase() + loja.texto.slice(1)} · {texto} · o chat do iFood e da 99 só entra com a ponte do chat ligada
                {dados?.parcial ? ' · contando os 5.000 casos mais recentes' : ''}
              </p>
              <Link
                href="/atendimento"
                className="inline-flex min-h-10 items-center rounded-md border border-input bg-card px-3 text-sm font-semibold hover:border-foreground/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                Abrir o Atendimento
              </Link>
            </div>

            <div className="flex flex-wrap gap-2" role="group" aria-label="Período">
              {PERIODOS.map((p) => {
                const ligada = periodo === p.k;
                return (
                  <button
                    key={p.k}
                    type="button"
                    aria-pressed={ligada}
                    onClick={() => setPeriodo(p.k)}
                    className={`inline-flex min-h-10 items-center whitespace-nowrap rounded-md border px-3 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                      ligada ? 'border-foreground bg-foreground text-background' : 'border-input bg-card text-secondary-foreground hover:text-foreground'
                    }`}
                  >
                    {p.rotulo}
                  </button>
                );
              })}
              {loja.opcao && (
                <button
                  type="button"
                  aria-pressed={loja.opcao.ligado}
                  onClick={() => loja.opcao!.aoMudar(!loja.opcao!.ligado)}
                  className={`inline-flex min-h-10 items-center whitespace-nowrap rounded-md border px-3 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                    loja.opcao.ligado ? 'border-foreground bg-foreground text-background' : 'border-input bg-card text-secondary-foreground hover:text-foreground'
                  }`}
                >
                  Somar todas as lojas
                </button>
              )}
            </div>

            {erro ? (
              <div className="rounded-md border border-dashed border-input bg-card px-4 py-6 text-center">
                <p className="text-sm">{erro}</p>
                <Button type="button" className="mt-3" onClick={() => void ler()} disabled={carregando}>
                  Tentar de novo
                </Button>
              </div>
            ) : !dados ? (
              <p className="text-sm text-secondary-foreground">Contando os números…</p>
            ) : (
              <Corpo dados={dados} texto={texto} kpis={kpis} doisLados={doisLados} largura={largura} periodo={periodo} aoAbrir={setGaveta} />
            )}
          </>
        )}
      </div>
      {gaveta && <GavetaDosCasos g={gaveta} periodo={periodo} todas={loja.total} aoFechar={() => setGaveta(null)} aoMudar={() => void ler()} />}
    </Shell>
  );
}

function Corpo({
  dados,
  texto,
  kpis,
  doisLados,
  largura,
  periodo,
  aoAbrir,
}: {
  dados: Numeros;
  texto: string;
  kpis: string;
  doisLados: boolean;
  largura: number;
  periodo: Periodo;
  aoAbrir: (g: Escolha) => void;
}) {
  const nada = dados.canais.every((c) => !c.chegaram) && !dados.motivos.length && !dados.custou.centavos;
  if (nada)
    return (
      <div className="rounded-md border border-dashed border-input bg-card px-4 py-8 text-center">
        <p className="font-semibold">Nenhum caso {texto}.</p>
        <p className="mt-1 text-sm text-secondary-foreground">Quando chegar mensagem, disputa, avaliação ou caso do robô, os números aparecem aqui.</p>
      </div>
    );
  const ci = dados.canais.find((c) => c.k === 'chat-ifood');
  const disp = dados.canais.find((c) => c.k === 'disputa');
  const semChat = !ci || ci.semMensagens;
  const largo = largura >= 720;
  const maxM = Math.max(1, ...dados.motivos.map((m) => m.casos));
  const maxP = Math.max(1, ...dados.produtos.map((p) => p.casos));
  const tituloCusto = periodo === 'mes' ? 'Custou neste mês' : periodo === 'ant' ? 'Custou no mês passado' : 'Custou no período';
  return (
    <>
      <div className={`grid gap-3 ${kpis}`}>
        <Kpi destaque rotulo="1ª resposta no chat do iFood" valor={semChat || !ci?.respondidas ? '—' : tempoDe(ci.segMedio)} ajuda={semChat ? 'nenhuma mensagem no período (a ponte do chat estava ligada?)' : 'média · o cliente vê este número no iFood'} />
        <Kpi destaque rotulo="Taxa de resposta no chat do iFood" valor={semChat ? '—' : pct(ci!)} ajuda={semChat ? 'ligue a ponte do chat para medir' : `${ci!.respondidas} de ${ci!.chegaram} mensagens respondidas`} />
        <Kpi
          rotulo="Disputas do iFood sem resposta"
          valor={disp ? `${disp.semResposta} de ${disp.chegaram}` : '—'}
          critico={!!disp?.semResposta}
          ajuda={disp?.semResposta ? 'o iFood decidiu sozinho' : 'todas respondidas'}
        />
        <Kpi
          rotulo={tituloCusto}
          valor={`${dados.custou.estimado ? '≈ ' : ''}${brl(dados.custou.centavos / 100)}`}
          ajuda={`devolvido ou deixado de receber · ${casos(dados.custou.casos)}${dados.custou.semValor ? ` · ${casos(dados.custou.semValor)} sem o valor` : ''}`}
        />
      </div>

      <section className="rounded-lg border border-border bg-card" aria-labelledby="t-placar">
        <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border px-4 py-3">
          <h3 id="t-placar" className="font-display text-base font-bold">
            Placar por canal
          </h3>
          <span className="text-xs text-secondary-foreground">quanto chegou, quanto foi respondido e em quanto tempo</span>
        </header>
        <div role="table" aria-label="Placar por canal">
          {largo && (
            <div role="row" className="grid grid-cols-[minmax(0,2.2fr)_repeat(4,minmax(0,1fr))] gap-3 px-4 pb-1 pt-2 text-xs font-bold text-secondary-foreground">
              <span role="columnheader">Canal</span>
              <span role="columnheader">Chegaram</span>
              <span role="columnheader">Respondidas</span>
              <span role="columnheader">1ª resposta (média)</span>
              <span role="columnheader">Sem resposta</span>
            </div>
          )}
          {dados.canais.map((c) => {
            const fora = !!c.semMensagens;
            const celula = (rotulo: string, valor: React.ReactNode, critico = false) => (
              <div role="cell" className={`min-w-0 font-mono text-sm ${critico ? 'font-bold text-destructive' : ''}`}>
                {!largo && <span className="block font-sans text-xs font-bold text-secondary-foreground">{rotulo}</span>}
                {valor}
              </div>
            );
            return (
              <div
                key={c.k}
                role="row"
                className={`grid gap-x-3 gap-y-2 border-t border-border px-4 py-3 ${largo ? 'grid-cols-[minmax(0,2.2fr)_repeat(4,minmax(0,1fr))] items-center' : 'grid-cols-2'}`}
              >
                <div role="cell" className={`min-w-0 ${largo ? '' : 'col-span-2'}`}>
                  <div className="flex flex-wrap items-center gap-2">
                    <ChipDoCanal canal={c.canal} />
                    <b className="text-sm">{c.nome}</b>
                  </div>
                  <p className="mt-0.5 text-xs text-secondary-foreground">
                    {fora ? 'Nenhuma mensagem no período: a ponte do chat estava desligada, ou ninguém escreveu.' : c.o}
                  </p>
                </div>
                {celula('Chegaram', fora ? '—' : c.chegaram)}
                {celula(
                  'Respondidas',
                  fora ? '—' : (
                    <>
                      {c.respondidas}
                      <small className="ml-1 font-sans text-xs text-secondary-foreground">{pct(c)}</small>
                    </>
                  ),
                )}
                {celula('1ª resposta', fora || !c.respondidas ? '—' : tempoDe(c.segMedio))}
                {celula('Sem resposta', fora ? '—' : c.semResposta, !fora && c.semResposta > 0)}
              </div>
            );
          })}
        </div>
      </section>

      <div className={`grid gap-4 ${doisLados ? 'grid-cols-2' : 'grid-cols-1'}`}>
        <section className="min-w-0 rounded-lg border border-border bg-card" aria-labelledby="t-motivos">
          <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border px-4 py-3">
            <h3 id="t-motivos" className="font-display text-base font-bold">
              Reclamações por motivo
            </h3>
            <span className="text-xs text-secondary-foreground">e quanto cada uma custou</span>
          </header>
          {dados.motivos.length ? (
            dados.motivos.map((m) => (
              <Barra
                key={m.k}
                titulo={m.nome}
                ajuda={m.k === 'sem' ? 'marque ao resolver o caso' : m.daPlataforma ? `${m.daPlataforma} pelo que a plataforma disse` : undefined}
                casos={m.casos}
                max={maxM}
                valor={m.k === 'sem' ? 'ver e marcar' : `${m.estimado ? '≈ ' : ''}${brl(m.centavos / 100)}`}
                cinza={m.k === 'sem'}
                estreito={largura < 560}
                aoAbrir={() => aoAbrir({ grupo: 'motivo', chave: m.k, titulo: m.nome })}
              />
            ))
          ) : (
            <p className="px-4 py-3 text-sm text-secondary-foreground">Nenhuma reclamação {texto}.</p>
          )}
        </section>
        <section className="min-w-0 rounded-lg border border-border bg-card" aria-labelledby="t-produtos">
          <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border px-4 py-3">
            <h3 id="t-produtos" className="font-display text-base font-bold">
              Reclamações por produto
            </h3>
            <span className="text-xs text-secondary-foreground">para a cozinha e a ficha técnica</span>
          </header>
          {dados.produtos.length ? (
            dados.produtos.map((p) => (
              <Barra
                key={p.nome}
                titulo={p.nome}
                chips={p.motivos.map((m) => `${m.nome} ${m.casos}`)}
                casos={p.casos}
                max={maxP}
                valor={brl(p.centavos / 100)}
                estreito={largura < 560}
                aoAbrir={() => aoAbrir({ grupo: 'produto', chave: p.nome, titulo: p.nome })}
              />
            ))
          ) : (
            <p className="px-4 py-3 text-sm text-secondary-foreground">Nenhum produto apontado {texto}.</p>
          )}
          <p className="px-4 pb-3 pt-1 text-xs text-secondary-foreground">
            Vêm dos itens que o cliente apontou na disputa do iFood e dos que a equipe marcou ao resolver. Atraso não entra aqui: é do pedido, não do produto. O
            custo do caso se divide entre os produtos dele.
          </p>
        </section>
      </div>

      <p className="rounded-md border-l-4 border-info bg-info/10 px-4 py-3 text-sm">
        <b>Como contamos.</b> Chat: cada vez que o cliente escreve e espera, conta uma mensagem; respondida quando a loja escreve depois (a equipe, o robô ou
        quem respondeu direto no Gestor); os avisos automáticos (&quot;saiu&quot;, &quot;chegando&quot;) não contam. Casos: respondido quando uma pessoa pega,
        responde ou resolve. O que ainda está no prazo não conta como &quot;sem resposta&quot;. Custou: o pedido cancelado, os itens reembolsados e a proposta
        aceita pelo cliente{dados.custou.estimado ? '; "≈" = o reembolso da 99 sem o valor conta o pedido inteiro' : ''}.
      </p>
    </>
  );
}

function Kpi({ rotulo, valor, ajuda, destaque = false, critico = false }: { rotulo: string; valor: string; ajuda: string; destaque?: boolean; critico?: boolean }) {
  return (
    <div className={`min-w-0 rounded-lg border px-4 py-3 ${destaque ? 'border-primary/60 bg-primary/5' : 'border-border bg-card'}`}>
      <p className="text-xs font-bold text-secondary-foreground">{rotulo}</p>
      <p className={`mt-1 break-words font-mono text-2xl font-bold ${critico ? 'text-destructive' : ''}`}>{valor}</p>
      <p className="text-xs text-secondary-foreground">{ajuda}</p>
    </div>
  );
}

function Barra({
  titulo,
  ajuda,
  chips,
  casos: n,
  max,
  valor,
  cinza = false,
  estreito,
  aoAbrir,
}: {
  titulo: string;
  ajuda?: string;
  chips?: string[];
  casos: number;
  max: number;
  valor: string;
  cinza?: boolean;
  estreito: boolean;
  aoAbrir: () => void;
}) {
  return (
    <button
      type="button"
      onClick={aoAbrir}
      className={`grid w-full items-center gap-x-3 gap-y-2 border-t border-border px-4 py-3 text-left first-of-type:border-t-0 hover:bg-secondary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${
        estreito ? 'grid-cols-[minmax(0,1fr)_auto]' : 'grid-cols-[minmax(0,1.4fr)_minmax(0,2fr)_auto]'
      }`}
    >
      <span className="min-w-0">
        <span className="block text-sm font-bold">{titulo}</span>
        {ajuda && <span className="block text-xs text-secondary-foreground">{ajuda}</span>}
        {chips && chips.length > 0 && (
          <span className="mt-1 flex flex-wrap gap-1">
            {chips.map((c) => (
              <span key={c} className="whitespace-nowrap rounded-full bg-secondary px-2 py-px text-xs font-bold">
                {c}
              </span>
            ))}
          </span>
        )}
      </span>
      <span className={`h-3 min-w-0 overflow-hidden rounded-full bg-secondary ${estreito ? 'col-span-2 row-start-2' : ''}`} aria-hidden="true">
        <span className={`block h-full rounded-full ${cinza ? 'bg-input' : 'bg-primary'}`} style={{ width: `${Math.round((n / max) * 100)}%` }} />
      </span>
      <span className={`text-right font-mono text-sm ${estreito ? 'row-start-1 col-start-2' : ''}`}>
        {casos(n)}
        <small className="block font-sans text-xs text-secondary-foreground">{valor}</small>
      </span>
    </button>
  );
}

function GavetaDosCasos({ g, periodo, todas, aoFechar, aoMudar }: { g: Escolha; periodo: Periodo; todas: boolean; aoFechar: () => void; aoMudar: () => void }) {
  const [lista, setLista] = useState<{ casos: CasoN[]; total: number } | null>(null);
  const [erro, setErro] = useState(false);
  const [marcando, setMarcando] = useState<CasoN | null>(null);
  const [marca, setMarca] = useState<{ marca: MarcaDoCaso; mexeu: boolean }>({ marca: null, mexeu: false });
  const [salvando, setSalvando] = useState(false);

  const ler = useCallback(async () => {
    setErro(false);
    try {
      const r: any = await api.atendimentoNumerosCasos(periodo, g.grupo === 'motivo' ? { motivo: g.chave } : { produto: g.chave }, todas);
      setLista({ casos: Array.isArray(r?.casos) ? r.casos : [], total: Number(r?.total) || 0 });
    } catch {
      setErro(true);
    }
  }, [g, periodo, todas]);
  useEffect(() => {
    void ler();
  }, [ler]);

  async function salvar() {
    if (!marcando || salvando) return;
    setSalvando(true);
    try {
      await api.atendimentoMarcarOQueAconteceu(marcando.id, { motivo: marca.marca?.motivo ?? null, produtos: marca.marca?.produtos ?? [] });
      toast.success('Motivo salvo: entra nos Números do atendimento.');
      setMarcando(null);
      await ler();
      aoMudar();
    } catch (e: any) {
      toast.error(e?.message || 'Não deu para salvar o motivo agora.');
    } finally {
      setSalvando(false);
    }
  }

  const titulo = `${g.titulo}${lista ? ` · ${casos(lista.total)}` : ''}`;
  return (
    <Gaveta titulo={titulo} aoFechar={aoFechar} fecharNoFundo>
      <div className="space-y-3">
        {g.grupo === 'produto' && (
          <div className="space-y-2">
            <p className="text-sm">Leve à cozinha: o que se repete costuma estar na ficha técnica (porção, embalagem, tempo de preparo).</p>
            <Link
              href={`/fichas?busca=${encodeURIComponent(g.chave)}`}
              className="inline-flex min-h-10 items-center rounded-md border border-input bg-card px-3 text-sm font-semibold hover:border-foreground/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Abrir a ficha técnica
            </Link>
          </div>
        )}
        {g.chave === 'sem' && <p className="text-sm">Casos sem o motivo. Marque para eles entrarem na conta por motivo e por produto.</p>}
        {erro ? (
          <div className="rounded-md border border-dashed border-input px-3 py-4 text-center">
            <p className="text-sm">Não deu para ler os casos agora.</p>
            <Button type="button" className="mt-2" onClick={() => void ler()}>
              Tentar de novo
            </Button>
          </div>
        ) : !lista ? (
          <p className="text-sm text-secondary-foreground">Lendo os casos…</p>
        ) : !lista.casos.length ? (
          <p className="text-sm text-secondary-foreground">Nenhum caso no período.</p>
        ) : (
          <ul className="space-y-2">
            {lista.casos.map((c) => (
              <li key={c.id} className="space-y-1 rounded-md border border-border px-3 py-2">
                <div className="flex flex-wrap items-center gap-2">
                  <ChipDoCanal canal={c.canal} />
                  <b className="min-w-0 text-sm">{c.titulo}</b>
                  <span className="ml-auto text-xs text-secondary-foreground">{dataHora(c.criadoEm)}</span>
                </div>
                <p className="text-xs text-secondary-foreground">
                  {c.motivo ? NOME_DO_MOTIVO[c.motivo] ?? c.motivo : 'sem motivo'}
                  {c.produtos.length ? ` · ${c.produtos.join(', ')}` : ''}
                  {c.fonte === 'plataforma' ? ' · o que a plataforma disse' : c.fonte === 'equipe' ? ' · marcado pela equipe' : ''}
                  {c.centavos ? ` · custou ${c.estimado ? '≈ ' : ''}${brl(c.centavos / 100)}` : ''}
                  {c.aberto ? ' · ainda aberto' : ''}
                </p>
                <div className="flex flex-wrap gap-2 pt-1">
                  <Link
                    href={`/atendimento?caso=${c.id}`}
                    className="inline-flex min-h-10 items-center rounded-md border border-input bg-card px-3 text-sm font-semibold hover:border-foreground/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    Abrir o caso
                  </Link>
                  <Button
                    type="button"
                    variant={c.motivo ? 'outline' : 'default'}
                    onClick={() => {
                      setMarca({ marca: null, mexeu: false });
                      setMarcando(c);
                    }}
                  >
                    {c.motivo ? 'Mudar o motivo' : 'Marcar o motivo'}
                  </Button>
                </div>
              </li>
            ))}
            {lista.total > lista.casos.length && (
              <li className="text-xs text-secondary-foreground">Mostrando os {lista.casos.length} mais recentes de {lista.total}.</li>
            )}
          </ul>
        )}
      </div>
      {marcando && (
        <Dialogo
          titulo={`O que aconteceu · ${marcando.titulo}`}
          aoFechar={() => setMarcando(null)}
          fecharNoFundo={false}
          rodape={
            <>
              <Button type="button" variant="outline" onClick={() => setMarcando(null)}>
                Cancelar
              </Button>
              <Button type="button" onClick={() => void salvar()} disabled={salvando || !marca.mexeu}>
                Salvar
              </Button>
            </>
          }
        >
          <OQueAconteceu casoId={marcando.id} aoMudar={setMarca} resolvido={!marcando.aberto} sozinho />
        </Dialogo>
      )}
    </Gaveta>
  );
}
