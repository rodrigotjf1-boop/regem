'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { toast } from '@/lib/toast';
import { Button } from '@/components/ui/button';
import { haQuanto } from '@/components/integracoes/textos';

// O CLIQUE REGEM → DMS GRAPH (G5b; mig 450; protótipo `mockups/regem-graph-clique.html`, aprovado em 18/11/2026 com as
// recomendadas GR-1 a GR-7): o cartão "DMS Graph" na grade de Delivery › Configurações › Integrações e a janela dele, e a
// linha "Quem lê as fotos agora" em Atendimento › Fotos do cliente. A ligação é da EMPRESA inteira (G-3). Só o presidente
// liga e desliga (GR-2, conferido no servidor); o gerente vê a situação. Sem o DMS Graph liberado para a empresa
// (`GRAPH_LIGADO` e o piloto `GRAPH_EMPRESAS`), nem o cartão nem a linha aparecem.

export type SituacaoDoGraph = {
  ligado: boolean;
  empresaNome: string | null;
  reservaIa: boolean;
  pronto: boolean;
  naNuvem: boolean;
  podeLigar: boolean;
  ligacao: null | {
    contaNome: string | null;
    desde: string;
    por: string | null;
    permissoes: string[];
    ultimoUso: string | null;
    ultimaLeitura: { em: string; resultado: string } | null;
    franquia: { mes: string; usados: number; total: number; em: string; doMesAtual: boolean } | null;
  };
  desligadaPeloGraphEm: string | null;
  permissoes: Array<{ id: string; frase: string; necessaria: boolean }>;
};

/** As cores da marca do DMS Graph (a do produto, como a do Orzuni no cartão dele). */
const FUNDO_GRAPH = '#101117';
const COR_GRAPH = '#B9A8FF';
const CAMINHO_DO_CARTAO = '/delivery/configuracoes?aba=integracoes';
const CAMINHO_DA_IA = '/mister?parte=ia';

const quando = (iso: string) => new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

/** "novembro" do "2026-11". */
export function nomeDoMes(mes: string): string {
  const [a, m] = mes.split('-').map(Number);
  if (!a || !m) return 'este mês';
  return new Date(a, m - 1, 1).toLocaleDateString('pt-BR', { month: 'long' });
}

/** "01/12" — o dia em que a franquia do mês "2026-11" volta. */
export function diaDaVolta(mes: string): string {
  const [a, m] = mes.split('-').map(Number);
  if (!a || !m) return 'o dia 1º';
  const d = new Date(a, m, 1);
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** A franquia do mês acabou (o último número que veio é deste mês e chegou ao total). */
export function franquiaAcabou(s: SituacaoDoGraph | null): boolean {
  const f = s?.ligacao?.franquia;
  return !!f && f.doMesAtual && f.total > 0 && f.usados >= f.total;
}

/** A última tentativa de leitura, em palavras (o resultado curto que o servidor grava). */
export function resultadoDaLeitura(r: string): string {
  if (r === 'lida') return 'lida pelo DMS Graph';
  if (r === 'franquia-esgotada') return 'a franquia do mês acabou; foi à IA da empresa';
  if (r === 'demora') return 'o DMS Graph demorou; foi à IA da empresa';
  if (r === 'tipo-nao-aceito') return 'tipo de imagem que o DMS Graph não lê; foi à IA da empresa';
  if (r === 'integracao-parada') return 'a DMS pausou o DMS Graph; foi à IA da empresa';
  if (r === 'ligacao-desfeita') return 'a ligação foi desfeita no DMS Graph';
  if (r === 'fora-do-formato') return 'o DMS Graph não descreveu; foi à IA da empresa';
  return 'o DMS Graph não leu; foi à IA da empresa';
}

/** Quem lê a foto agora (a linha de Atendimento › Fotos do cliente e a ajuda dela). */
export function quemLeAgora(s: SituacaoDoGraph): { selo: string; tom: 'ok' | 'off' | 'atencao'; texto: string } {
  const f = s.ligacao?.franquia;
  if (s.ligacao && franquiaAcabou(s) && f) {
    return {
      selo: `IA da empresa até ${diaDaVolta(f.mes)}`,
      tom: 'atencao',
      texto: s.reservaIa
        ? `A franquia do DMS Graph de ${nomeDoMes(f.mes)} acabou. Até ${diaDaVolta(f.mes)}, as fotos são lidas pela IA da empresa.`
        : `A franquia do DMS Graph de ${nomeDoMes(f.mes)} acabou e a empresa não tem chave de IA: até ${diaDaVolta(f.mes)}, o atendente pede para o cliente escrever, como antes.`,
    };
  }
  if (s.ligacao) {
    const uso = f && f.doMesAtual ? ` (${f.usados} de ${f.total} fotos neste mês)` : '';
    return {
      selo: 'DMS Graph',
      tom: 'ok',
      texto: `Quem lê agora: o DMS Graph${uso}. Se ele não ler em 10 segundos, ${s.reservaIa ? 'a foto vai à IA da empresa' : 'o atendente pede para o cliente escrever (a empresa não tem chave de IA)'}.`,
    };
  }
  if (s.reservaIa) {
    return {
      selo: 'IA da empresa',
      tom: 'off',
      texto: 'Quem lê agora: a chave de IA da empresa (o gasto aparece em Mister › IA e uso). Com o DMS Graph, a foto é lida dentro da franquia do mês.',
    };
  }
  return {
    selo: 'Ninguém',
    tom: 'off',
    texto: 'Sem o DMS Graph e sem a chave de IA da empresa, o atendente pede para o cliente escrever, como antes. Ligue o DMS Graph ou a chave de IA em Mister › IA e uso.',
  };
}

function LogoGraph({ grande = false }: { grande?: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={`flex flex-none items-center justify-center rounded-lg font-display font-extrabold ${grande ? 'h-20 w-20 text-2xl' : 'h-9 w-9 text-sm'}`}
      style={{ background: FUNDO_GRAPH, color: COR_GRAPH }}
    >
      G
    </span>
  );
}

function Selo({ tom, children }: { tom: 'ok' | 'off' | 'atencao'; children: React.ReactNode }) {
  const fundo = tom === 'ok' ? 'bg-ok/15 text-ok' : tom === 'atencao' ? 'bg-warn/15 text-foreground' : 'bg-secondary text-muted-foreground';
  const bolinha = tom === 'ok' ? 'bg-ok' : tom === 'atencao' ? 'bg-warn' : 'bg-muted-foreground/40';
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${fundo}`}>
      <span className={`h-2 w-2 flex-none rounded-full ${bolinha}`} />
      {children}
    </span>
  );
}

function seloDoCartao(s: SituacaoDoGraph): { tom: 'ok' | 'off' | 'atencao'; texto: string } {
  if (!s.ligacao) return { tom: 'off', texto: 'não ligado' };
  if (franquiaAcabou(s)) return { tom: 'atencao', texto: 'franquia acabou' };
  return { tom: 'ok', texto: 'ligado' };
}

function Aviso({ tipo, titulo, children }: { tipo: 'info' | 'erro' | 'atencao'; titulo: string; children?: React.ReactNode }) {
  const cor =
    tipo === 'erro' ? 'border-destructive bg-destructive/10' : tipo === 'atencao' ? 'border-warn bg-warn/10' : 'border-border bg-secondary';
  return (
    <div role={tipo === 'info' ? 'status' : 'alert'} className={`rounded-lg border-l-4 px-3 py-2.5 text-sm text-foreground ${cor}`}>
      <b className="block">{titulo}</b>
      {children}
    </div>
  );
}

/** O medidor da franquia do mês (GR-5): os números escritos, a barra só de apoio. */
function Franquia({ f }: { f: NonNullable<NonNullable<SituacaoDoGraph['ligacao']>['franquia']> | null }) {
  if (!f || !f.doMesAtual) {
    return <p className="m-0 text-sm text-muted-foreground">Neste mês, o DMS Graph ainda não leu nenhuma foto. A franquia volta a zero no dia 1º de cada mês.</p>;
  }
  const cheia = f.total > 0 && f.usados >= f.total;
  const pct = f.total > 0 ? Math.min(100, Math.round((f.usados / f.total) * 1000) / 10) : 0;
  const rotulo = `${f.usados} de ${f.total} fotos lidas em ${nomeDoMes(f.mes)}`;
  return (
    <div className="grid gap-1.5">
      <div className="flex flex-wrap justify-between gap-x-3 gap-y-1 text-sm text-muted-foreground">
        <span>Fotos lidas em {nomeDoMes(f.mes)}</span>
        <span>
          <b className="font-mono tabular-nums text-foreground">{f.usados}</b> de <b className="font-mono tabular-nums text-foreground">{f.total}</b>
        </span>
      </div>
      <div className="h-2.5 overflow-hidden rounded-full bg-secondary" role="img" aria-label={rotulo}>
        <i className={`block h-full rounded-full ${cheia ? 'bg-warn' : 'bg-ok'}`} style={{ width: `${pct}%` }} />
      </div>
      {!cheia && <p className="m-0 text-xs text-muted-foreground">A franquia volta a zero no dia 1º de cada mês.</p>}
    </div>
  );
}

/** A janela do DMS Graph: antes de ligar (GR-3) e ligado (GR-5, GR-6). Esc e o fundo fecham. */
function Janela({ s, onClose, onMudou }: { s: SituacaoDoGraph; onClose: () => void; onMudou: () => void }) {
  const [indo, setIndo] = useState(false);
  const [confirmarDesligar, setConfirmarDesligar] = useState(false);

  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onEsc);
    return () => window.removeEventListener('keydown', onEsc);
  }, [onClose]);

  async function conectar() {
    setIndo(true);
    try {
      const { url } = await api.graphCliqueIniciar();
      window.location.href = url; // a página do DMS Graph; a volta é /integracoes/graph/volta
    } catch (e: any) {
      toast.error(e?.message || 'Não foi possível abrir o DMS Graph agora.');
      setIndo(false);
    }
  }

  async function desligar() {
    setIndo(true);
    try {
      await api.graphCliqueDesligar();
      toast.success(s.reservaIa ? 'DMS Graph desligado. As fotos voltam a ser lidas pela IA da empresa.' : 'DMS Graph desligado. Sem a chave de IA da empresa, o atendente pede para o cliente escrever.');
      setConfirmarDesligar(false);
      onMudou();
    } catch (e: any) {
      toast.error(e?.message || 'Não foi possível desligar agora.');
    } finally {
      setIndo(false);
    }
  }

  const l = s.ligacao;
  const f = l?.franquia ?? null;
  const acabou = franquiaAcabou(s);
  const selo = seloDoCartao(s);
  const empresa = s.empresaNome || 'a empresa';

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label="DMS Graph">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 flex max-h-[88vh] w-full max-w-lg flex-col overflow-hidden rounded-t-2xl border border-border bg-card shadow-xl sm:rounded-2xl">
        <div className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3" style={{ boxShadow: `inset 0 3px 0 ${COR_GRAPH}` }}>
          <LogoGraph />
          <div className="font-display text-base font-bold">DMS Graph</div>
          <Selo tom={l ? selo.tom : 'off'}>{l ? selo.texto : s.desligadaPeloGraphEm ? 'desligado' : 'não ligado'}</Selo>
          <button type="button" onClick={onClose} className="ml-auto rounded-md p-1.5 text-muted-foreground hover:bg-secondary" aria-label="Fechar">
            ✕
          </button>
        </div>
        <div className="grid gap-4 overflow-y-auto p-4">
          {!s.naNuvem ? (
            <Aviso tipo="info" titulo="A ligação com o DMS Graph se faz no Regem na nuvem">
              Abra o Regem em app.dmsregem.com, entre com a sua conta e volte a esta tela.
            </Aviso>
          ) : l ? (
            <>
              {acabou && f && (
                <Aviso tipo="atencao" titulo={`A franquia de ${nomeDoMes(f.mes)} acabou`}>
                  {s.reservaIa
                    ? `Até ${diaDaVolta(f.mes)}, as fotos são lidas pela IA da empresa. Nada muda na conversa com o cliente.`
                    : `A empresa não tem chave de IA: até ${diaDaVolta(f.mes)}, o atendente pede para o cliente escrever, como antes.`}
                </Aviso>
              )}
              <dl className="m-0 grid grid-cols-1 gap-x-3 gap-y-1.5 text-sm sm:grid-cols-[minmax(110px,max-content)_1fr]">
                <dt className="text-muted-foreground">Empresa</dt>
                <dd className="m-0 min-w-0 break-words">{empresa} (todas as lojas)</dd>
                <dt className="text-muted-foreground">Ligado por</dt>
                <dd className="m-0 min-w-0 break-words">
                  {l.por ?? 'presidente'} em {quando(l.desde)}
                </dd>
                <dt className="text-muted-foreground">Última leitura</dt>
                <dd className="m-0 min-w-0 break-words">
                  {l.ultimaLeitura ? `${haQuanto(l.ultimaLeitura.em)} · ${resultadoDaLeitura(l.ultimaLeitura.resultado)}` : 'ainda não leu nenhuma foto'}
                </dd>
                <dt className="text-muted-foreground">Reserva</dt>
                <dd className="m-0 min-w-0 break-words">
                  {s.reservaIa ? (
                    <>
                      IA da empresa (a chave em <a className="font-semibold underline" href={CAMINHO_DA_IA}>Mister › IA e uso</a>)
                    </>
                  ) : (
                    <>
                      Nenhuma: sem a chave de IA da empresa, a foto que o DMS Graph não ler fica sem leitura (
                      <a className="font-semibold underline" href={CAMINHO_DA_IA}>Mister › IA e uso</a>)
                    </>
                  )}
                </dd>
              </dl>
              <Franquia f={f} />
              {!s.podeLigar ? (
                <Aviso tipo="info" titulo="Só quem é presidente desliga o DMS Graph">
                  Você vê aqui a situação da empresa.
                </Aviso>
              ) : confirmarDesligar ? (
                <div role="alertdialog" aria-label="Desligar o DMS Graph" className="grid gap-2 rounded-lg border border-border p-3">
                  <b className="font-display">Desligar o DMS Graph da empresa?</b>
                  <p className="m-0 text-sm text-muted-foreground">
                    As fotos voltam a ser lidas pela IA da empresa (ou o atendente pede para o cliente escrever, se a empresa não tiver chave). Para voltar, é só conectar de novo.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <Button variant="outline" onClick={() => setConfirmarDesligar(false)} disabled={indo}>
                      Cancelar
                    </Button>
                    <Button variant="destructive" onClick={desligar} disabled={indo}>
                      {indo ? 'Desligando…' : 'Desligar'}
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" className="text-destructive" onClick={() => setConfirmarDesligar(true)} disabled={indo}>
                    Desligar
                  </Button>
                </div>
              )}
            </>
          ) : (
            <>
              {s.desligadaPeloGraphEm && (
                <Aviso tipo="erro" titulo={`A ligação foi desligada no DMS Graph em ${quando(s.desligadaPeloGraphEm)}`}>
                  {s.reservaIa
                    ? 'As fotos voltaram a ser lidas pela IA da empresa. Para usar o DMS Graph de novo, conecte outra vez.'
                    : 'Sem a chave de IA da empresa, o atendente pede para o cliente escrever. Para usar o DMS Graph de novo, conecte outra vez.'}
                </Aviso>
              )}
              <p className="m-0 text-sm">
                Com o DMS Graph ligado, as fotos e os prints que os clientes mandam no WhatsApp são lidos por ele, dentro da franquia do mês. A IA da empresa fica de reserva.
              </p>
              <div className="text-sm text-muted-foreground">
                Vale para: <b className="text-foreground">{empresa}</b> (a empresa inteira, todas as lojas)
              </div>
              <div className="rounded-lg border border-border p-3">
                <h3 className="mb-2 font-display text-sm font-semibold">O que o Regem vai pedir ao DMS Graph</h3>
                <ul className="m-0 grid list-none gap-2 p-0 text-sm">
                  {s.permissoes.map((p) => (
                    <li key={p.id} className="flex items-start gap-2">
                      <span aria-hidden="true" className="font-bold text-ok">
                        ✓
                      </span>
                      <span className="min-w-0">
                        {p.frase.replace(/\.$/, '')}
                        <small className="block text-xs text-muted-foreground">O DMS Graph devolve só o que leu na foto; a foto continua na conversa do WhatsApp da loja.</small>
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
              {!s.podeLigar ? (
                <Aviso tipo="info" titulo="Só quem é presidente liga o DMS Graph">
                  Você vê aqui quando a empresa estiver ligada.
                </Aviso>
              ) : !s.pronto ? (
                <Aviso tipo="erro" titulo="A ligação do Regem com o DMS Graph não está pronta nesta nuvem">
                  Avise o suporte. As fotos seguem pela IA da empresa.
                </Aviso>
              ) : (
                <div className="grid gap-2">
                  <Button onClick={conectar} disabled={indo} className="w-full">
                    {indo ? 'Abrindo o DMS Graph…' : s.desligadaPeloGraphEm ? 'Conectar ao DMS Graph de novo' : 'Conectar ao DMS Graph'}
                  </Button>
                  <p className="m-0 text-xs text-muted-foreground">
                    Você vai para a página do DMS Graph, entra com o DMS ID, confere o pedido e autoriza. Ninguém copia chave.
                  </p>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * A situação do DMS Graph para esta empresa (null = ainda lendo, ou sem a situação: nada aparece). `ativo` falso não lê
 * (quem não vê a tela, ou o servidor da loja, onde a rota não existe).
 */
export function useSituacaoDoGraph(ativo = true): { s: SituacaoDoGraph | null; reler: () => void } {
  const [s, setS] = useState<SituacaoDoGraph | null>(null);
  const reler = useCallback(() => {
    api
      .graphCliqueSituacao()
      .then((r: SituacaoDoGraph) => setS(r))
      .catch(() => setS(null)); // sem a situação, o cartão e a linha não aparecem (o resto da tela segue)
  }, []);
  useEffect(() => {
    if (ativo) reler();
  }, [ativo, reler]);
  return { s, reler };
}

/** O cartão do DMS Graph na grade das integrações (só com o Graph liberado para a empresa) e a janela dele. */
export function GraphIntegracao() {
  const { s, reler } = useSituacaoDoGraph();
  const [aberto, setAberto] = useState(false);
  if (!s?.ligado) return null;
  const selo = seloDoCartao(s);
  return (
    <>
      <button
        type="button"
        onClick={() => setAberto(true)}
        aria-label="Configurar DMS Graph"
        className="group flex w-[200px] max-w-full flex-col items-center justify-center gap-3 rounded-2xl border border-border bg-card px-4 py-5 text-center transition hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md motion-reduce:transition-none motion-reduce:hover:translate-y-0"
      >
        <Selo tom={selo.tom}>{selo.texto}</Selo>
        <LogoGraph grande />
        <span className="text-center text-base font-semibold leading-tight">DMS Graph</span>
        <small className="text-xs text-muted-foreground">Lê as fotos que os clientes mandam no WhatsApp</small>
      </button>
      {aberto && <Janela s={s} onClose={() => setAberto(false)} onMudou={reler} />}
    </>
  );
}

/** A linha "Quem lê as fotos agora" (Atendimento › Fotos do cliente): o selo e o caminho para o cartão. */
export function QuemLeAsFotos({ s }: { s: SituacaoDoGraph }) {
  const q = quemLeAgora(s);
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
      <Selo tom={q.tom}>{q.selo}</Selo>
      <a className="text-sm font-semibold underline" href={CAMINHO_DO_CARTAO}>
        {s.ligacao ? 'Ver o DMS Graph' : s.podeLigar ? 'Ligar o DMS Graph' : 'Ver o DMS Graph'}
      </a>
    </div>
  );
}
