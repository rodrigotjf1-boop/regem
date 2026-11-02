'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { api, getCategoria } from '@/lib/api';
import { toast } from '@/lib/toast';
import { Shell } from '@/components/app-shell/shell';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Dialogo, Gaveta } from '@/components/ui/sobreposto';
import { FiltroBusca, FiltroSelect, Filtros, semAcento } from '@/components/ui/lista';
import { ChipDoCanal } from '@/components/atendimento/chip-do-canal';
import { DecidirCancelamento } from '@/components/atendimento/decidir-cancelamento';
import {
  ROTULO_DO_CANAL,
  ROTULO_DO_TIPO,
  hora,
  relerFila,
  tempoAte,
  tempoDesde,
  tituloDoCaso,
  useFilaDeAtendimento,
  type CasoDaFila,
} from '@/lib/atendimento';

// CENTRAL DE ATENDIMENTO — a tela "Atendimento" (Onda 1, PR 1b; protótipo `mockups/regem-central-atendimento.html`,
// aprovado pelo dono em 02/11/2026). Uma fila só com o que precisa de uma pessoa, na ordem do servidor (prazo vencendo,
// urgente, quem espera há mais tempo); o caso ao lado quando a peça tem espaço (≥ 900 px), numa gaveta por cima quando
// não tem — decide-se pelo espaço da área, não pela janela (ERR-219). A fila vem do alerta do Shell (uma leitura só).

const STATUS_DO_PEDIDO: Record<string, string> = {
  novo: 'Novo',
  confirmado: 'Em produção',
  pronto: 'Pronto',
  despachado: 'Em rota',
  entregue: 'Entregue',
  concluido: 'Concluído',
  cancelado: 'Cancelado',
};

type Sit = 'abertos' | 'prazo' | 'fila' | 'comigo' | 'aguardando' | 'resolvidos';
const SITUACOES: { k: Sit; rotulo: string; critico?: boolean }[] = [
  { k: 'abertos', rotulo: 'Abertos' },
  { k: 'prazo', rotulo: 'Com prazo', critico: true },
  { k: 'fila', rotulo: 'Na fila' },
  { k: 'comigo', rotulo: 'Comigo' },
  { k: 'aguardando', rotulo: 'Aguardando o cliente' },
  { k: 'resolvidos', rotulo: 'Resolvidos hoje' },
];

export default function AtendimentoPage() {
  // `eu` vem do servidor com a fila: marca "Comigo" e "você" (o servidor confere tudo de novo em cada ação).
  const { casos, contagens, lida, erro, eu } = useFilaDeAtendimento();
  const [sit, setSit] = useState<Sit>('abertos');
  const [busca, setBusca] = useState('');
  const [canal, setCanal] = useState('');
  const [tipo, setTipo] = useState('');
  const [quem, setQuem] = useState('');
  const [resolvidos, setResolvidos] = useState<CasoDaFila[] | null>(null);
  const [selecionado, setSelecionado] = useState<string | null>(null);
  const [folha, setFolha] = useState(false); // o caso aberto por cima (tela estreita)
  const [agora, setAgora] = useState<number | null>(null); // hora só depois de montar (V35)
  const [duplo, setDuplo] = useState(true);
  const corpo = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setAgora(Date.now());
    const t = setInterval(() => setAgora(Date.now()), 1000);
    void relerFila();
    // Vindo do sino (`?caso=…`): abre aquele caso.
    const caso = new URLSearchParams(window.location.search).get('caso');
    if (caso) {
      setSelecionado(caso);
      setFolha(true);
    }
    return () => clearInterval(t);
  }, []);

  // Duas colunas só quando a ÁREA tem espaço (ERR-219): mede a peça, não a janela.
  useEffect(() => {
    const el = corpo.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => setDuplo(el.clientWidth >= 900));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const lerResolvidos = useCallback(async () => {
    try {
      setResolvidos((await api.atendimentoResolvidos()) as CasoDaFila[]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Não consegui ler os resolvidos de hoje.');
      setResolvidos([]);
    }
  }, []);
  useEffect(() => {
    if (sit === 'resolvidos') void lerResolvidos();
  }, [sit, lerResolvidos]);

  const base = sit === 'resolvidos' ? resolvidos ?? [] : casos;
  const responsaveis = useMemo(
    () => [...new Map(casos.filter((c) => c.responsavelId).map((c) => [c.responsavelId!, c.responsavelNome ?? 'Alguém'])).entries()],
    [casos],
  );
  const visiveis = useMemo(() => {
    const q = semAcento(busca.trim());
    return base.filter((c) => {
      if (q && !semAcento(`${tituloDoCaso(c)} ${c.telefone ?? ''} ${c.pedidoNumero ?? ''} ${c.pedidoNaPlataforma ?? ''}`).includes(q)) return false;
      if (canal && c.canal !== canal) return false;
      if (tipo && c.tipo !== tipo) return false;
      if (quem === '-' && c.responsavelId) return false;
      if (quem && quem !== '-' && c.responsavelId !== quem) return false;
      if (sit === 'prazo') return !!c.prazoEm;
      if (sit === 'fila') return c.situacao === 'fila' && !c.prazoEm;
      if (sit === 'comigo') return !!eu && c.responsavelId === eu;
      if (sit === 'aguardando') return c.situacao === 'aguardando';
      return true;
    });
  }, [base, busca, canal, tipo, quem, sit, eu]);

  const contagemDe = (k: Sit): number => {
    if (k === 'resolvidos') return contagens?.resolvidosHoje ?? 0;
    if (k === 'abertos') return casos.length;
    if (k === 'prazo') return casos.filter((c) => c.prazoEm).length;
    if (k === 'fila') return casos.filter((c) => c.situacao === 'fila' && !c.prazoEm).length;
    if (k === 'comigo') return casos.filter((c) => eu && c.responsavelId === eu).length;
    return casos.filter((c) => c.situacao === 'aguardando').length;
  };
  const limpar = () => {
    setBusca('');
    setCanal('');
    setTipo('');
    setQuem('');
    setSit('abertos');
  };

  const caso = useMemo(
    () => [...casos, ...(resolvidos ?? [])].find((c) => c.id === selecionado) ?? null,
    [casos, resolvidos, selecionado],
  );
  // O caso aberto saiu da lista (resolvido em outra tela): na coluna da direita aparece o primeiro da lista.
  const casoNaColuna = caso ?? visiveis[0] ?? null;

  const depoisDeMudar = useCallback(async () => {
    await relerFila();
    if (sit === 'resolvidos') await lerResolvidos();
  }, [sit, lerResolvidos]);

  const abrir = (id: string) => {
    setSelecionado(id);
    if (!duplo) setFolha(true);
  };

  const total = contagens?.abertos ?? casos.length;
  return (
    <Shell eyebrow="Atendimento" title="Atendimento">
      <div className="space-y-4">
        <div className="min-w-0">
          <h2 className="font-display text-xl font-bold">
            {total} {total === 1 ? 'caso aberto' : 'casos abertos'}
          </h2>
          <p className="text-sm text-secondary-foreground" role="status" aria-live="polite">
            {contagens ? `${contagens.comPrazo} com prazo · ${contagens.naFila} na fila · ` : ''}
            as conversas que o robô atende sozinho ficam em{' '}
            <Link href="/whatsapp" className="font-semibold text-foreground underline underline-offset-2">
              Delivery › WhatsApp
            </Link>
          </p>
        </div>

        <div className="flex flex-wrap gap-2" role="group" aria-label="Situação">
          {SITUACOES.map((s) => {
            const ligada = sit === s.k;
            return (
              <button
                key={s.k}
                type="button"
                aria-pressed={ligada}
                onClick={() => setSit(s.k)}
                className={`inline-flex min-h-10 items-center gap-2 whitespace-nowrap rounded-md border px-3 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                  ligada ? 'border-foreground bg-foreground text-background' : 'border-input bg-card text-secondary-foreground hover:text-foreground'
                }`}
              >
                {s.rotulo}
                <span
                  className={`rounded-full px-2 py-px font-mono text-xs ${
                    ligada ? 'bg-background/20 text-background' : s.critico && contagemDe(s.k) ? 'bg-destructive/15 text-foreground' : 'bg-secondary text-foreground'
                  }`}
                >
                  {contagemDe(s.k)}
                </span>
              </button>
            );
          })}
        </div>

        <Filtros>
          <FiltroBusca id="busca-atendimento" valor={busca} aoMudar={setBusca} placeholder="Cliente, pedido ou telefone" />
          <FiltroSelect
            id="filtro-canal"
            rotulo="Canal"
            valor={canal}
            aoMudar={setCanal}
            todos="Todos"
            opcoes={Object.entries(ROTULO_DO_CANAL).map(([v, rotulo]) => ({ v, rotulo }))}
          />
          <FiltroSelect
            id="filtro-motivo"
            rotulo="Motivo"
            valor={tipo}
            aoMudar={setTipo}
            todos="Todos"
            opcoes={Object.entries(ROTULO_DO_TIPO).map(([v, rotulo]) => ({ v, rotulo }))}
          />
          <FiltroSelect
            id="filtro-quem"
            rotulo="Com quem"
            valor={quem}
            aoMudar={setQuem}
            todos="Qualquer um"
            opcoes={[{ v: '-', rotulo: 'Ninguém ainda' }, ...responsaveis.map(([v, nome]) => ({ v, rotulo: v === eu ? `${nome} (você)` : nome }))]}
          />
        </Filtros>

        <div ref={corpo} className={duplo ? 'grid grid-cols-[minmax(300px,380px)_minmax(0,1fr)] items-start gap-4' : 'space-y-2'}>
          <section aria-labelledby="titulo-fila" className="min-w-0 space-y-2">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 px-0.5">
              <h3 id="titulo-fila" className="font-display text-base font-bold">
                {sit === 'resolvidos' ? 'Resolvidos hoje' : 'Fila'}
              </h3>
              {sit !== 'resolvidos' && (
                <span className="text-xs text-secondary-foreground">Ordem: prazo vencendo, depois urgente, depois quem espera há mais tempo</span>
              )}
            </div>
            <ListaDaFila
              casos={visiveis}
              lida={sit === 'resolvidos' ? resolvidos !== null : lida}
              erro={sit !== 'resolvidos' && erro}
              vazioPorFiltro={base.length > 0}
              selecionado={duplo ? casoNaColuna?.id ?? null : selecionado}
              agora={agora}
              eu={eu}
              aoAbrir={abrir}
              aoLimpar={limpar}
            />
          </section>

          {duplo && (
            <div className="min-w-0">
              {casoNaColuna ? (
                <Card className="min-w-0">
                  <Caso caso={casoNaColuna} agora={agora} eu={eu} aoMudar={depoisDeMudar} />
                </Card>
              ) : (
                <div className="rounded-lg border border-dashed border-input bg-card px-4 py-10 text-center text-sm text-secondary-foreground">
                  {lida ? 'Quando chegar um caso, ele abre aqui.' : 'Carregando…'}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {!duplo && folha && caso && (
        <Gaveta titulo={tituloDoCaso(caso)} media aoFechar={() => setFolha(false)} fecharNoFundo>
          <Caso caso={caso} agora={agora} eu={eu} aoMudar={depoisDeMudar} semTitulo />
        </Gaveta>
      )}
    </Shell>
  );
}

function ListaDaFila({
  casos,
  lida,
  erro,
  vazioPorFiltro,
  selecionado,
  agora,
  eu,
  aoAbrir,
  aoLimpar,
}: {
  casos: CasoDaFila[];
  lida: boolean;
  erro: boolean;
  vazioPorFiltro: boolean;
  selecionado: string | null;
  agora: number | null;
  eu: string | null;
  aoAbrir: (id: string) => void;
  aoLimpar: () => void;
}) {
  if (erro && !casos.length) {
    return (
      <div className="rounded-lg border border-dashed border-input bg-card px-4 py-8 text-center text-sm" role="status">
        <p className="font-semibold">Não consegui ler a fila agora.</p>
        <p className="text-secondary-foreground">Os casos continuam guardados. Tento de novo em instantes.</p>
        <Button type="button" variant="outline" className="mt-3" onClick={() => void relerFila()}>
          Tentar agora
        </Button>
      </div>
    );
  }
  if (!lida) return <p className="px-1 py-6 text-center text-sm text-secondary-foreground">Carregando…</p>;
  if (!casos.length) {
    return vazioPorFiltro ? (
      <div className="rounded-lg border border-dashed border-input bg-card px-4 py-8 text-center text-sm" role="status">
        <p className="font-semibold">Nenhum caso com este filtro.</p>
        <Button type="button" variant="outline" className="mt-3" onClick={aoLimpar}>
          Limpar filtros
        </Button>
      </div>
    ) : (
      <div className="rounded-lg border border-dashed border-input bg-card px-4 py-8 text-center text-sm" role="status">
        <p className="text-2xl" aria-hidden="true">🎉</p>
        <p className="font-semibold">Ninguém esperando.</p>
        <p className="text-secondary-foreground">Quando alguém precisar de uma pessoa, o caso aparece aqui e o sino toca.</p>
      </div>
    );
  }
  return (
    <ul className="space-y-2" aria-label="Casos">
      {erro && <li className="text-xs text-destructive">Não consegui atualizar agora; mostrando a última leitura.</li>}
      {casos.map((c) => {
        const atual = selecionado === c.id;
        const prazo = c.prazoEm && agora ? tempoAte(c.prazoEm, agora) : '';
        const quem = c.responsavelId ? `com ${c.responsavelId === eu ? 'você' : c.responsavelNome ?? 'alguém'}` : 'ninguém pegou';
        return (
          <li key={c.id}>
            <button
              type="button"
              aria-current={atual ? 'true' : undefined}
              onClick={() => aoAbrir(c.id)}
              className={`block w-full rounded-lg border bg-card p-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                c.prioridade === 'urgente' ? 'border-destructive/40 bg-destructive/[0.03]' : 'border-border'
              } ${atual ? 'shadow-[inset_4px_0_0_hsl(var(--primary))] ring-1 ring-primary' : 'hover:border-secondary-foreground'}`}
            >
              <span className="flex flex-wrap items-center gap-1.5">
                <ChipDoCanal canal={c.canal} />
                {c.prioridade === 'urgente' && (
                  <span className="rounded-full bg-destructive/15 px-2 py-0.5 text-xs font-bold text-destructive">🚨 Urgente</span>
                )}
                <span className="rounded-full bg-secondary px-2 py-0.5 text-xs font-bold text-secondary-foreground">
                  {ROTULO_DO_TIPO[c.tipo] ?? 'Atendimento'}
                </span>
                {c.situacao === 'aguardando' && (
                  <span className="rounded-full bg-info/15 px-2 py-0.5 text-xs font-bold text-foreground">Aguardando o cliente</span>
                )}
                <span className="ml-auto flex items-center gap-2 font-mono text-sm font-bold">
                  {prazo && <span className={prazo === 'venceu' || (c.prazoEm && new Date(c.prazoEm).getTime() - (agora ?? 0) < 120_000) ? 'text-destructive' : 'text-foreground'}>{prazo}</span>}
                  {c.posicao ? <span>{c.posicao}º</span> : null}
                </span>
              </span>
              <span className="mt-1 block break-words font-bold">{tituloDoCaso(c)}</span>
              {c.mensagem && <span className="mt-0.5 line-clamp-2 block break-words text-sm text-secondary-foreground">{c.mensagem}</span>}
              <span className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-secondary-foreground">
                <span>{c.situacao === 'resolvido' ? `resolvido às ${hora(c.resolvidoEm)}${c.resolvidoPorNome ? ` por ${c.resolvidoPorNome}` : ''}` : quem}</span>
                {c.situacao !== 'resolvido' && agora && <span>esperando há {tempoDesde(c.criadoEm, agora)}</span>}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function Caso({
  caso: c,
  agora,
  eu,
  aoMudar,
  semTitulo = false,
}: {
  caso: CasoDaFila;
  agora: number | null;
  eu: string | null;
  aoMudar: () => Promise<void>;
  semTitulo?: boolean;
}) {
  const [passando, setPassando] = useState(false);
  const [resolvendo, setResolvendo] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [podeResponder, setPodeResponder] = useState(false);
  // Quem responde pelo WhatsApp é a gestão (a caixa de conversas é de presidente, gerente e supervisão — o servidor confere).
  useEffect(() => setPodeResponder(['presidente', 'gerente', 'supervisao'].includes(getCategoria() ?? '')), []);
  const aberto = c.situacao !== 'resolvido';
  const meu = !!eu && c.responsavelId === eu;

  async function fazer(fn: () => Promise<unknown>, ok: string) {
    if (enviando) return;
    setEnviando(true);
    try {
      await fn();
      toast.success(ok);
      await aoMudar();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Não foi possível concluir.');
      await aoMudar();
    } finally {
      setEnviando(false);
    }
  }
  const numeroDoWhatsapp = () => {
    const d = String(c.telefone ?? '').replace(/\D/g, '');
    return d.length === 10 || d.length === 11 ? `55${d}` : d;
  };
  const prazo = c.prazoEm && agora ? tempoAte(c.prazoEm, agora) : '';

  return (
    <article className="min-w-0" aria-label={tituloDoCaso(c)}>
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-border p-4">
        <div className="min-w-0 flex-1 basis-64">
          <div className="flex flex-wrap items-center gap-1.5">
            <ChipDoCanal canal={c.canal} />
            {c.prioridade === 'urgente' && <span className="rounded-full bg-destructive/15 px-2 py-0.5 text-xs font-bold text-destructive">🚨 Urgente</span>}
            <span className="rounded-full bg-secondary px-2 py-0.5 text-xs font-bold text-secondary-foreground">{ROTULO_DO_TIPO[c.tipo] ?? 'Atendimento'}</span>
          </div>
          {!semTitulo && <h3 className="mt-1 break-words font-display text-lg font-bold">{tituloDoCaso(c)}</h3>}
          <p className="break-words text-sm text-secondary-foreground">
            {c.telefone ? `${c.telefone} · ` : ''}
            {!aberto ? 'resolvido' : c.responsavelId ? `com ${meu ? 'você' : c.responsavelNome ?? 'alguém'}` : 'ninguém pegou ainda'}
          </p>
        </div>
        {aberto && c.tipo !== 'cancelamento' && (
          <div className="flex flex-wrap gap-2">
            {!meu && (
              <Button type="button" disabled={enviando || (!!c.responsavelId && !meu)} onClick={() => fazer(() => api.atendimentoPegar(c.id), 'O caso é seu.')}>
                Pegar para mim
              </Button>
            )}
            <Button type="button" variant="outline" disabled={enviando} onClick={() => setPassando(true)}>
              Passar
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={enviando}
              aria-pressed={c.situacao === 'aguardando'}
              onClick={() =>
                fazer(
                  () => api.atendimentoAguardar(c.id, c.situacao !== 'aguardando'),
                  c.situacao === 'aguardando' ? 'O caso voltou para você.' : 'Aguardando o cliente: o caso volta quando ele responder.',
                )
              }
            >
              {c.situacao === 'aguardando' ? 'Parar de aguardar' : 'Aguardar o cliente'}
            </Button>
            <Button type="button" className="bg-ok text-foreground hover:bg-ok/90" disabled={enviando} onClick={() => setResolvendo(true)}>
              Resolver
            </Button>
          </div>
        )}
      </header>

      <div className="space-y-4 p-4">
        {prazo && aberto && (
          <div className={`flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border px-4 py-3 ${prazo === 'venceu' ? 'border-destructive/40 bg-destructive/10' : 'border-warn/40 bg-warn/10'}`}>
            <span className="font-mono text-3xl font-bold leading-none">{prazo}</span>
            <span className="min-w-0 flex-1 basis-52 text-sm">Até {hora(c.prazoEm)} para responder. Passado o prazo, a plataforma decide sozinha.</span>
          </div>
        )}

        <section className="rounded-lg border border-border bg-secondary/40 p-3">
          <h4 className="mb-1 font-display text-sm font-bold">O que o cliente precisa</h4>
          {c.mensagem ? (
            <p className="whitespace-pre-line break-words text-sm">{c.mensagem}</p>
          ) : (
            <p className="text-sm text-secondary-foreground">O caso chegou sem descrição.</p>
          )}
        </section>

        {c.tipo === 'cancelamento' && aberto && (
          <section className="space-y-2">
            <h4 className="font-display text-sm font-bold">Responder ao pedido de cancelamento</h4>
            <DecidirCancelamento caso={c} aoDecidir={() => void aoMudar()} />
          </section>
        )}

        {(c.pedidoNumero || c.pedidoNaPlataforma) && (
          <section className="rounded-lg border border-border p-3 text-sm">
            <h4 className="mb-1 font-display text-sm font-bold">Pedido ligado</h4>
            <p className="break-words">
              {c.canal === 'ifood' || c.canal === '99food'
                ? `${c.canal === 'ifood' ? 'iFood' : '99Food'} ${c.pedidoNaPlataforma ?? ''}${c.pedidoNumero ? ` · #${c.pedidoNumero} na loja` : ''}`
                : `#${c.pedidoNumero}`}
              {c.pedidoStatus ? ` · ${STATUS_DO_PEDIDO[c.pedidoStatus] ?? c.pedidoStatus}` : ''}
            </p>
            <Link href="/delivery" className="mt-1 inline-block font-semibold text-foreground underline underline-offset-2">
              Ver no painel do Delivery
            </Link>
          </section>
        )}

        {c.telefone && c.canal === 'whatsapp' && aberto && (
          <section className="rounded-lg border border-border p-3 text-sm">
            <h4 className="mb-1 font-display text-sm font-bold">Conversa no WhatsApp</h4>
            {podeResponder ? (
              <Link href={`/whatsapp?numero=${numeroDoWhatsapp()}`} className="font-semibold text-foreground underline underline-offset-2">
                Abrir a conversa com {c.cliente || 'o cliente'}
              </Link>
            ) : (
              <p className="text-secondary-foreground">Quem responde pelo WhatsApp é a gerência ou a supervisão.</p>
            )}
            <p className="mt-1 text-xs text-secondary-foreground">O robô fica quieto nesta conversa enquanto o caso está aberto, e volta quando ele for resolvido.</p>
          </section>
        )}

        <section className="text-sm">
          <h4 className="mb-1 font-display text-sm font-bold">Histórico do caso</h4>
          <ol className="space-y-0.5 text-secondary-foreground">
            <li>
              <span className="font-mono">{hora(c.criadoEm)}</span> · chegou o caso
            </li>
            {c.pegoEm && c.responsavelId && (
              <li>
                <span className="font-mono">{hora(c.pegoEm)}</span> · com {meu ? 'você' : c.responsavelNome ?? 'alguém'}
              </li>
            )}
            {c.aguardandoDesde && (
              <li>
                <span className="font-mono">{hora(c.aguardandoDesde)}</span> · aguardando o cliente
              </li>
            )}
            {c.resolvidoEm && (
              <li>
                <span className="font-mono">{hora(c.resolvidoEm)}</span> · resolvido{c.resolvidoPorNome ? ` por ${c.resolvidoPorNome}` : ''}
                {c.decisao ? ` (cancelamento ${c.decisao})` : ''}
              </li>
            )}
          </ol>
        </section>
      </div>

      {passando && <PassarCaso caso={c} aoFechar={() => setPassando(false)} aoPassar={aoMudar} />}
      {resolvendo && (
        <Dialogo
          titulo="Resolver o caso"
          aoFechar={() => setResolvendo(false)}
          rodape={
            <>
              <Button type="button" variant="outline" onClick={() => setResolvendo(false)}>Voltar</Button>
              <Button
                type="button"
                className="bg-ok text-foreground hover:bg-ok/90"
                disabled={enviando}
                onClick={() => {
                  setResolvendo(false);
                  void fazer(() => api.resolverAtendimento(c.id), 'Caso resolvido.');
                }}
              >
                Resolver
              </Button>
            </>
          }
        >
          <p className="text-sm">
            {c.canal === 'whatsapp'
              ? 'A conversa volta para o robô. Se o cliente escrever de novo, o robô atende e abre outro caso quando precisar.'
              : 'O caso sai da fila.'}
          </p>
        </Dialogo>
      )}
    </article>
  );
}

function PassarCaso({ caso, aoFechar, aoPassar }: { caso: CasoDaFila; aoFechar: () => void; aoPassar: () => Promise<void> }) {
  const [equipe, setEquipe] = useState<{ id: string; nome: string; eu: boolean }[] | null>(null);
  const [para, setPara] = useState<string>('');
  const [erro, setErro] = useState('');
  const [enviando, setEnviando] = useState(false);
  useEffect(() => {
    api
      .atendimentoEquipe()
      .then((r: any) => setEquipe(Array.isArray(r) ? r : []))
      .catch((e) => {
        setEquipe([]);
        setErro(e instanceof Error ? e.message : 'Não consegui ler a equipe.');
      });
  }, []);
  async function passar() {
    if (enviando) return;
    setEnviando(true);
    setErro('');
    try {
      await api.atendimentoPassar(caso.id, para === 'fila' ? null : para);
      toast.success(para === 'fila' ? 'O caso voltou para a fila.' : 'Caso passado.');
      aoFechar();
      await aoPassar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível passar o caso.');
    } finally {
      setEnviando(false);
    }
  }
  const opcoes = (equipe ?? []).filter((p) => p.id !== caso.responsavelId);
  return (
    <Dialogo
      titulo="Passar o caso"
      aoFechar={aoFechar}
      rodape={
        <>
          <Button type="button" variant="outline" onClick={aoFechar}>Voltar</Button>
          <Button type="button" disabled={!para || enviando} onClick={() => void passar()}>Passar</Button>
        </>
      }
    >
      <fieldset className="space-y-1.5">
        <legend className="mb-1 text-sm font-semibold">Para quem</legend>
        {equipe === null && <p className="text-sm text-secondary-foreground">Carregando a equipe…</p>}
        {caso.responsavelId && (
          <label className="flex min-h-11 cursor-pointer items-center gap-2 rounded-md border border-border px-3 text-sm has-[:checked]:border-primary has-[:checked]:bg-primary/10">
            <input type="radio" name="passar-para" value="fila" checked={para === 'fila'} onChange={() => setPara('fila')} />
            De volta para a fila (ninguém)
          </label>
        )}
        {opcoes.map((p) => (
          <label
            key={p.id}
            className="flex min-h-11 cursor-pointer items-center gap-2 rounded-md border border-border px-3 text-sm has-[:checked]:border-primary has-[:checked]:bg-primary/10"
          >
            <input type="radio" name="passar-para" value={p.id} checked={para === p.id} onChange={() => setPara(p.id)} />
            {p.nome}
            {p.eu ? ' (você)' : ''}
          </label>
        ))}
        {equipe !== null && !opcoes.length && <p className="text-sm text-secondary-foreground">Ninguém mais ativo nesta loja.</p>}
      </fieldset>
      {erro && <p className="mt-2 text-sm text-destructive" role="alert">{erro}</p>}
    </Dialogo>
  );
}
