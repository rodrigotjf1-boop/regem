'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { api, getCategoria } from '@/lib/api';
import { toast } from '@/lib/toast';
import { Shell } from '@/components/app-shell/shell';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Dialogo, Gaveta, useQuantosSobrepostos } from '@/components/ui/sobreposto';
import { FiltroBusca, FiltroSelect, Filtros, semAcento } from '@/components/ui/lista';
import { ChipDoCanal } from '@/components/atendimento/chip-do-canal';
import { DecidirCancelamento } from '@/components/atendimento/decidir-cancelamento';
import { DisputaIfood } from '@/components/atendimento/disputa-ifood';
import { Pedido99 } from '@/components/atendimento/pedido-99';
import { ResumoDoRobo, resumoCurto } from '@/components/atendimento/resumo-do-robo';
import { ChatDoIfood } from '@/components/atendimento/chat-do-ifood';
import { FaixaDaPonte } from '@/components/atendimento/faixa-da-ponte';
import { ConversaDoCaso } from '@/components/atendimento/conversa-do-caso';
import { ChatDaPlataforma } from '@/components/atendimento/chat-da-plataforma';
import { EnderecoDepoisQueSaiu } from '@/components/atendimento/endereco-depois-que-saiu';
import { ListaDeConversas } from '@/components/atendimento/lista-de-conversas';
import { ConversaDoRobo } from '@/components/atendimento/conversa-do-robo';
import { enderecoDoCaso } from '@/lib/endereco-do-caso';
import {
  CASO_DA_PLATAFORMA,
  ROTULO_DO_CANAL,
  ROTULO_DO_TIPO,
  STATUS_DO_PEDIDO,
  escaladoDe,
  hora,
  idDaConversa,
  relerFila,
  resumoDasConversas,
  tempoAte,
  tempoDesde,
  tituloDaConversa,
  tituloDoCaso,
  useFilaDeAtendimento,
  type CasoDaFila,
  type ConversaAgora,
} from '@/lib/atendimento';

// CENTRAL DE ATENDIMENTO — a tela "Atendimento" (Onda 1, PR 1b; protótipo `mockups/regem-central-atendimento.html`,
// aprovado pelo dono em 02/11/2026). Uma fila só com o que precisa de uma pessoa, na ordem do servidor (prazo vencendo,
// urgente, quem espera há mais tempo); o caso ao lado quando a peça tem espaço (≥ 900 px), numa gaveta por cima quando
// não tem — decide-se pelo espaço da área, não pela janela (ERR-219). A fila vem do alerta do Shell (uma leitura só).

// "Conversas agora" (ponte do chat, protótipo v3): as conversas do chat do iFood e da 99 sem caso aberto — só aparece com
// a ponte ligada (na nuvem; no servidor da loja a situação da ponte não vem).
type Sit = 'abertos' | 'prazo' | 'fila' | 'comigo' | 'aguardando' | 'conversas' | 'resolvidos';
const SITUACOES: { k: Sit; rotulo: string; critico?: boolean }[] = [
  { k: 'abertos', rotulo: 'Abertos' },
  { k: 'prazo', rotulo: 'Com prazo', critico: true },
  { k: 'fila', rotulo: 'Na fila' },
  { k: 'comigo', rotulo: 'Comigo' },
  { k: 'aguardando', rotulo: 'Aguardando o cliente' },
  { k: 'conversas', rotulo: 'Conversas agora' },
  { k: 'resolvidos', rotulo: 'Resolvidos hoje' },
];
/** Quem responde no chat da plataforma (e por isso pode assumir a conversa do robô): a gestão — o servidor confere. */
const GESTAO = ['presidente', 'gerente', 'supervisao'];

export default function AtendimentoPage() {
  // `eu` vem do servidor com a fila: marca "Comigo" e "você" (o servidor confere tudo de novo em cada ação).
  const { casos, contagens, lida, erro, eu, ponte } = useFilaDeAtendimento();
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
  // "Conversas agora": a lista, se o robô do chat está ligado, a conversa aberta e se quem está na tela pode assumir.
  const [conversas, setConversas] = useState<ConversaAgora[] | null>(null);
  const [erroConversas, setErroConversas] = useState(false);
  const [roboResponde, setRoboResponde] = useState(false);
  // O WhatsApp em "Conversas agora": `null` = não entra para quem está na tela (não atende a caixa do WhatsApp).
  const [whatsapp, setWhatsapp] = useState<{ ligado: boolean; lida: boolean } | null>(null);
  const [conversaSel, setConversaSel] = useState<string | null>(null);
  const [podeAssumir, setPodeAssumir] = useState(false);
  const comPonte = ponte?.ligada === true;
  const comWhatsapp = whatsapp?.ligado === true;
  // A situação aparece com a ponte do chat ligada OU com o robô do WhatsApp ligado (para quem atende a caixa dele).
  const temConversas = comPonte || comWhatsapp;
  const naConversa = sit === 'conversas';

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
  const [largura, setLargura] = useState<number | null>(null);
  useEffect(() => {
    const el = corpo.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => setLargura(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  // Com um diálogo do caso aberto, o arranjo NÃO troca: trocar (coluna × gaveta) remonta o caso e o diálogo fecharia
  // sozinho — girar o tablet com o "Passar o caso" aberto (ERR-347). Fechado o diálogo, vale a largura de agora.
  const sobrepostos = useQuantosSobrepostos();
  const comDialogo = sobrepostos > (duplo ? 0 : folha ? 1 : 0);
  useEffect(() => {
    if (largura === null || comDialogo) return;
    setDuplo(largura >= 900);
  }, [largura, comDialogo]);
  // Segurado num arranjo que não cabe (as duas colunas numa tela que estreitou): o fundo, atrás do diálogo, é recortado —
  // sem barra lateral (V45) até o diálogo fechar e a tela trocar de arranjo.
  const segurado = comDialogo && largura !== null && largura >= 900 !== duplo;

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

  // Só a leitura mais nova vale (V64): a de 15 s e a que segue a fila podem se cruzar.
  const leituraDasConversas = useRef(0);
  const lerConversas = useCallback(async () => {
    const n = ++leituraDasConversas.current;
    try {
      const r: any = await api.atendimentoConversasAgora();
      if (n !== leituraDasConversas.current) return;
      setConversas(Array.isArray(r?.conversas) ? (r.conversas as ConversaAgora[]) : []);
      setRoboResponde(r?.roboResponde === true);
      setWhatsapp(r?.whatsapp && typeof r.whatsapp.ligado === 'boolean' ? { ligado: r.whatsapp.ligado, lida: r.whatsapp.lida !== false } : null);
      setErroConversas(false);
    } catch {
      // Falhou: o que já estava fica, marcado como "não li agora" — nunca vira "nenhuma conversa" (V37).
      if (n === leituraDasConversas.current) setErroConversas(true);
    }
  }, []);
  // Ao abrir e sempre que um caso do chat ou do WhatsApp abre ou fecha (a conversa sai daqui quando vira caso e volta quando
  // ele é resolvido); com a ponte ou o robô do WhatsApp ligados, a cada 15 s com a aba à vista. No servidor da loja a rota
  // pede à nuvem (V37) — a falha vira "não li", nunca "nenhuma conversa".
  const casosDasConversas = useMemo(
    () => casos.filter((c) => c.tipo === 'chat' || c.canal === 'whatsapp').map((c) => c.id).join(','),
    [casos],
  );
  useEffect(() => {
    void lerConversas();
  }, [comPonte, casosDasConversas, lerConversas]);
  useEffect(() => {
    if (!temConversas) return;
    const t = setInterval(() => {
      if (document.visibilityState === 'visible') void lerConversas();
    }, 15_000);
    return () => clearInterval(t);
  }, [temConversas, lerConversas]);
  // A ponte e o robô do WhatsApp desligados: a situação some e a tela volta para "Abertos".
  useEffect(() => {
    if (!temConversas && sit === 'conversas') setSit('abertos');
  }, [temConversas, sit]);
  useEffect(() => setPodeAssumir(GESTAO.includes(getCategoria() ?? '')), []);

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
    if (k === 'conversas') return conversas?.length ?? 0;
    return casos.filter((c) => c.situacao === 'aguardando').length;
  };
  const limpar = () => {
    setBusca('');
    setCanal('');
    setTipo('');
    setQuem('');
    setSit('abertos');
  };
  const irPara = (k: Sit) => {
    setSit(k);
    setFolha(false); // o que estava aberto por cima era da outra situação
  };

  // As conversas que passam na busca e no canal (motivo e "com quem" são de caso: nem aparecem nesta situação).
  const conversasVisiveis = useMemo(() => {
    const q = semAcento(busca.trim());
    return (conversas ?? []).filter(
      (c) => (!q || semAcento(`${tituloDaConversa(c)} ${c.telefone ?? ''}`).includes(q)) && (!canal || c.canal === canal),
    );
  }, [conversas, busca, canal]);
  const conversa = useMemo(() => (conversas ?? []).find((c) => idDaConversa(c) === conversaSel) ?? null, [conversas, conversaSel]);
  // A conversa aberta virou caso (ou saiu da última hora): na coluna da direita aparece a primeira da lista.
  const conversaNaColuna = conversa ?? conversasVisiveis[0] ?? null;
  const abrirConversa = (id: string) => {
    setConversaSel(id);
    if (!duplo) setFolha(true);
  };
  // Assumiu: a conversa virou caso com a pessoa — a tela vai para "Comigo" com ele aberto. Não deu (outra pessoa assumiu,
  // a conversa saiu do chat): relê as duas listas.
  const depoisDeAssumir = useCallback(
    async (casoId: string | null) => {
      await relerFila();
      void lerConversas();
      if (!casoId) return;
      setSit('comigo');
      setSelecionado(casoId);
      if (!duplo) setFolha(true);
    },
    [duplo, lerConversas],
  );

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
            {temConversas && conversas !== null && (
              <>
                {resumoDasConversas(conversas, { comWhatsapp, comPonte, roboResponde })} (
                <button
                  type="button"
                  onClick={() => irPara('conversas')}
                  className="font-semibold text-foreground underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  ver em Conversas agora
                </button>
                {') · '}
              </>
            )}
            {whatsapp ? 'a conversa inteira do WhatsApp fica em ' : `as conversas que o robô atende sozinho ${comPonte ? 'no WhatsApp ' : ''}ficam em `}
            <Link href="/whatsapp" className="font-semibold text-foreground underline underline-offset-2">
              Delivery › WhatsApp
            </Link>
          </p>
        </div>

        {/* A ponte do chat do iFood e da 99 (mig 366): só aparece ligada; sem sinal, o aviso. Vem com a fila. */}
        <FaixaDaPonte ponte={ponte} agora={agora} />

        {/* O chat oficial do iFood (PR 5): só aparece com o widget da distribuição e o iFood ligado na empresa. */}
        <ChatDoIfood />

        <div className="flex flex-wrap gap-2" role="group" aria-label="Situação">
          {SITUACOES.filter((s) => s.k !== 'conversas' || temConversas).map((s) => {
            const ligada = sit === s.k;
            return (
              <button
                key={s.k}
                type="button"
                aria-pressed={ligada}
                onClick={() => irPara(s.k)}
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
                  {/* "Conversas agora" antes da 1ª leitura: "…", nunca 0 — não ter lido não é não ter conversa (V37). */}
                  {s.k === 'conversas' && conversas === null ? '…' : contagemDe(s.k)}
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
          {!naConversa && (
            <>
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
            </>
          )}
        </Filtros>

        <div
          ref={corpo}
          className={`${duplo ? 'grid grid-cols-[minmax(300px,380px)_minmax(0,1fr)] items-start gap-4' : 'space-y-2'}${segurado ? ' overflow-hidden' : ''}`}
        >
          <section aria-labelledby="titulo-fila" className="min-w-0 space-y-2">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 px-0.5">
              <h3 id="titulo-fila" className="font-display text-base font-bold">
                {sit === 'resolvidos' ? 'Resolvidos hoje' : naConversa ? 'Conversas agora' : 'Fila'}
              </h3>
              {naConversa ? (
                <span className="text-xs text-secondary-foreground">
                  {[comWhatsapp ? 'WhatsApp' : '', comPonte ? 'chat do iFood e da 99' : ''].filter(Boolean).join(' e ')} · última hora · sem caso aberto
                </span>
              ) : (
                sit !== 'resolvidos' && (
                  <span className="text-xs text-secondary-foreground">Ordem: prazo vencendo, depois urgente, depois quem espera há mais tempo</span>
                )
              )}
            </div>
            {naConversa ? (
              <ListaDeConversas
                conversas={conversas === null ? null : conversasVisiveis}
                erro={erroConversas}
                vazioPorFiltro={(conversas?.length ?? 0) > 0}
                roboResponde={roboResponde}
                comWhatsapp={comWhatsapp}
                erroWhatsapp={whatsapp?.lida === false}
                selecionada={duplo ? (conversaNaColuna ? idDaConversa(conversaNaColuna) : null) : conversaSel}
                agora={agora}
                aoAbrir={abrirConversa}
                aoLimpar={() => {
                  setBusca('');
                  setCanal('');
                }}
              />
            ) : (
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
            )}
          </section>

          {duplo && naConversa && (
            <div className="min-w-0">
              {conversaNaColuna ? (
                <Card className="min-w-0">
                  <ConversaDoRobo
                    key={idDaConversa(conversaNaColuna)}
                    conversa={conversaNaColuna}
                    roboResponde={roboResponde}
                    podeAssumir={podeAssumir}
                    aoAssumir={depoisDeAssumir}
                  />
                </Card>
              ) : (
                <div className="rounded-lg border border-dashed border-input bg-card px-4 py-10 text-center text-sm text-secondary-foreground">
                  {conversas === null ? 'Carregando…' : 'Quando alguém escrever no chat do iFood ou da 99, a conversa abre aqui.'}
                </div>
              )}
            </div>
          )}
          {duplo && !naConversa && (
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

      {!duplo && folha && naConversa && conversa && (
        <Gaveta titulo={tituloDaConversa(conversa)} media aoFechar={() => setFolha(false)} fecharNoFundo>
          <ConversaDoRobo
            key={idDaConversa(conversa)}
            conversa={conversa}
            roboResponde={roboResponde}
            podeAssumir={podeAssumir}
            aoAssumir={depoisDeAssumir}
            semTitulo
          />
        </Gaveta>
      )}
      {!duplo && folha && !naConversa && caso && (
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
                {/* Ninguém pegou no tempo do ajuste (mig 353): o gerente foi avisado. */}
                {escaladoDe(c) && <span className="rounded-full bg-warn/15 px-2 py-0.5 text-xs font-bold text-foreground">⏰ Gerente avisado</span>}
                <span className="ml-auto flex items-center gap-2 font-mono text-sm font-bold">
                  {prazo && <span className={prazo === 'venceu' || (c.prazoEm && new Date(c.prazoEm).getTime() - (agora ?? 0) < 120_000) ? 'text-destructive' : 'text-foreground'}>{prazo}</span>}
                  {c.posicao ? <span>{c.posicao}º</span> : null}
                </span>
              </span>
              <span className="mt-1 block break-words font-bold">{tituloDoCaso(c)}</span>
              {(resumoCurto(c.detalhe?.robo) ?? c.mensagem) && (
                <span className="mt-0.5 line-clamp-2 block break-words text-sm text-secondary-foreground">{resumoCurto(c.detalhe?.robo) ?? c.mensagem}</span>
              )}
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
  // O rascunho que um bloco do caso leva ao campo da conversa ("Não dá: responder ao cliente"); `n` reaplica o mesmo texto.
  const [rascunho, setRascunho] = useState<{ texto: string; n: number } | null>(null);
  useEffect(() => setRascunho(null), [c.id]); // outro caso: o rascunho do anterior não vai junto
  const endereco = c.tipo === 'mudanca' ? enderecoDoCaso(c.detalhe) : null;
  // Quem responde pelo WhatsApp é a gestão (a caixa de conversas é de presidente, gerente e supervisão — o servidor confere).
  useEffect(() => setPodeResponder(['presidente', 'gerente', 'supervisao'].includes(getCategoria() ?? '')), []);
  const aberto = c.situacao !== 'resolvido';
  const meu = !!eu && c.responsavelId === eu;
  // O chat do iFood e da 99 pela ponte (Etapa 2): no caso "Mensagem no chat" sempre; na disputa e no pedido da 99, com a
  // ponte ligada (a conversa do mesmo pedido). Na fila do servidor da loja a situação da ponte não vem — só o caso do chat.
  const { ponte } = useFilaDeAtendimento();
  const daPlataforma = c.canal === 'ifood' || c.canal === '99food';
  const comChat = daPlataforma && (c.tipo === 'chat' || (CASO_DA_PLATAFORMA.has(c.tipo) && ponte?.ligada === true));

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
            {/* Disputa do iFood e pedido da 99 se resolvem pela resposta à plataforma (ou pelo prazo): "aguardar" e
                "resolver" à mão os esconderiam. */}
            {!CASO_DA_PLATAFORMA.has(c.tipo) && (
              <>
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
              </>
            )}
          </div>
        )}
      </header>

      <div className="space-y-4 p-4">
        {c.tipo === 'disputa' && c.detalhe?.disputa ? (
          <DisputaIfood caso={c} agora={agora} aoMudar={aoMudar} />
        ) : (c.tipo === 'cancelamento_99' || c.tipo === 'reembolso_99') && c.detalhe?.pedido99 ? (
          <Pedido99 caso={c} agora={agora} aoMudar={aoMudar} />
        ) : (
          <>
            {prazo && aberto && (
              <div className={`flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border px-4 py-3 ${prazo === 'venceu' ? 'border-destructive/40 bg-destructive/10' : 'border-warn/40 bg-warn/10'}`}>
                <span className="font-mono text-3xl font-bold leading-none">{prazo}</span>
                <span className="min-w-0 flex-1 basis-52 text-sm">Até {hora(c.prazoEm)} para responder. Passado o prazo, a plataforma decide sozinha.</span>
              </div>
            )}

            {/* O resumo do robô (PR 4) no lugar do texto corrido; o texto inteiro (com o que foi somado depois) fica a um clique. */}
            {c.detalhe?.robo && resumoCurto(c.detalhe.robo) ? (
              <div>
                <ResumoDoRobo robo={c.detalhe.robo} />
                {c.mensagem && (
                  <details className="mt-2 text-sm">
                    <summary className="cursor-pointer text-xs font-semibold text-secondary-foreground">Ver tudo o que o robô anotou</summary>
                    <p className="mt-1 whitespace-pre-line break-words">{c.mensagem}</p>
                  </details>
                )}
              </div>
            ) : c.tipo === 'chat' ? null : (
              <section className="rounded-lg border border-border bg-secondary/40 p-3">
                <h4 className="mb-1 font-display text-sm font-bold">O que o cliente precisa</h4>
                {c.mensagem ? (
                  <p className="whitespace-pre-line break-words text-sm">{c.mensagem}</p>
                ) : (
                  <p className="text-sm text-secondary-foreground">O caso chegou sem descrição.</p>
                )}
              </section>
            )}
          </>
        )}

        {c.tipo === 'cancelamento' && aberto && (
          <section className="space-y-2">
            <h4 className="font-display text-sm font-bold">Responder ao pedido de cancelamento</h4>
            <DecidirCancelamento caso={c} aoDecidir={() => void aoMudar()} />
          </section>
        )}

        {/* O endereço novo do pedido que já saiu (PR 3b-2): o robô anotou; a equipe muda e avisa o entregador. */}
        {endereco && (
          <EnderecoDepoisQueSaiu
            caso={c}
            endereco={endereco}
            aberto={aberto}
            aoMudar={aoMudar}
            aoResponder={
              c.telefone && c.canal === 'whatsapp' && aberto && podeResponder
                ? (texto) => setRascunho((r) => ({ texto, n: (r?.n ?? 0) + 1 }))
                : undefined
            }
          />
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

        {/* O chat do iFood e da 99 pela ponte (Etapa 2): a conversa do pedido e a resposta, que a ponte digita no chat. */}
        {comChat && <ChatDaPlataforma key={c.id} caso={c} aberto={aberto} podeResponder={podeResponder} />}

        {/* A conversa dentro do caso (2B): quem responde pelo WhatsApp é a gestão — a caixa de conversas confere. */}
        {c.telefone && c.canal === 'whatsapp' && aberto && podeResponder && <ConversaDoCaso key={c.id} caso={c} rascunho={rascunho} />}
        {c.telefone && c.canal === 'whatsapp' && aberto && !podeResponder && (
          <section className="rounded-lg border border-border p-3 text-sm">
            <h4 className="mb-1 font-display text-sm font-bold">Conversa no WhatsApp</h4>
            <p className="text-secondary-foreground">Quem responde pelo WhatsApp é a gerência ou a supervisão.</p>
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
              : c.tipo === 'chat'
                ? `O caso sai da fila. Se o cliente escrever de novo no chat ${c.canal === 'ifood' ? 'do iFood' : 'da 99'}, chega outro caso.`
                : 'O caso sai da fila.'}
          </p>
        </Dialogo>
      )}
    </article>
  );
}

function PassarCaso({ caso, aoFechar, aoPassar }: { caso: CasoDaFila; aoFechar: () => void; aoPassar: () => Promise<void> }) {
  // `presenca`: quem está no app de atendimento agora (mig 353, só na nuvem) — "disponível" ou "ocupado: caixa".
  const [equipe, setEquipe] = useState<
    { id: string; nome: string; eu: boolean; presenca?: { estado: string; motivo: string | null } | null }[] | null
  >(null);
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
            <span className="min-w-0 break-words">
              {p.nome}
              {p.eu ? ' (você)' : ''}
              {p.presenca && (
                <span className="text-secondary-foreground">
                  {' · '}
                  {p.presenca.estado === 'disponivel' ? 'disponível' : `ocupado${p.presenca.motivo ? `: ${p.presenca.motivo}` : ''}`}
                </span>
              )}
            </span>
          </label>
        ))}
        {equipe !== null && !opcoes.length && <p className="text-sm text-secondary-foreground">Ninguém mais ativo nesta loja.</p>}
      </fieldset>
      {erro && <p className="mt-2 text-sm text-destructive" role="alert">{erro}</p>}
    </Dialogo>
  );
}
