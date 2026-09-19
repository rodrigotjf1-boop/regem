'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import QRCode from 'qrcode';
import { api, ApiError, getToken, getCategoria, handleApiError } from '@/lib/api';
import { Shell } from '@/components/app-shell/shell';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

/* eslint-disable @typescript-eslint/no-explicit-any */

// Restauração do estado da nuvem — só no edge e só para o presidente/C&O. Usada
// ao voltar pro modo local depois de ter operado na nuvem (queda do edge/PC): faz
// os 2 tempos (empurra pendente local → puxa a nuvem), aditivo (não apaga local).
function RestaurarServidor() {
  const [status, setStatus] = useState<any>(null);
  const [enviando, setEnviando] = useState(false);
  const [msg, setMsg] = useState('');
  // Resolve o perfil no cliente (evita divergência de hidratação SSR/cliente).
  const [presidente, setPresidente] = useState(false);

  const carregar = useCallback(async () => {
    try {
      setStatus(await api.edgeRestaurarStatus());
    } catch {
      /* fora do edge / sem permissão */
    }
  }, []);
  useEffect(() => {
    setPresidente(getCategoria() === 'presidente');
    carregar();
    const t = setInterval(carregar, 10000); // acompanha o andamento
    return () => clearInterval(t);
  }, [carregar]);

  if (!presidente) return null; // restaurar é só do presidente/C&O

  async function restaurar() {
    if (
      !confirm(
        'Restaurar do estado da nuvem? Primeiro sobem as vendas locais pendentes, depois o sistema puxa o que foi feito na nuvem. É aditivo (não apaga o que é só local). Faça com a loja parada.',
      )
    )
      return;
    setEnviando(true);
    setMsg('');
    try {
      await api.edgeRestaurar();
      setMsg('Restauração iniciada. Ela roda no próximo ciclo de sync — acompanhe o status abaixo.');
      await carregar();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Erro ao iniciar restauração');
    } finally {
      setEnviando(false);
    }
  }

  const emAndamento = status?.restaurando || status?.solicitado;
  return (
    <Card className="p-6 lg:col-span-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-lg font-bold">Restaurar do estado da nuvem</h2>
          <p className="max-w-prose text-sm text-muted-foreground">
            Use ao voltar para o modo local depois de ter operado na nuvem (ex.: o servidor
            local caiu). Traz para cá o que foi feito na nuvem, sem apagar o que é local.
          </p>
        </div>
        <Button type="button" onClick={restaurar} disabled={enviando || emAndamento}>
          {status?.restaurando
            ? 'Restaurando…'
            : status?.solicitado
              ? 'Na fila…'
              : enviando
                ? 'Iniciando…'
                : 'Restaurar agora'}
        </Button>
      </div>
      {/* Andamento AO VIVO — some a caixa-preta: barra + contagem de linhas aplicadas. */}
      {status?.restaurando && (
        <div className="mt-3">
          <div className="mb-1 flex items-center justify-between text-xs text-muted-foreground">
            <span>Baixando o estado da nuvem…</span>
            <span className="font-mono">{Number(status.progresso || 0).toLocaleString('pt-BR')} linha(s)</span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-secondary" role="progressbar" aria-label="Restaurando">
            <div className="h-full w-full animate-pulse rounded-full bg-primary" />
          </div>
        </div>
      )}
      {status?.solicitado && !status?.restaurando && (
        <p className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
          <span className="h-2 w-2 animate-pulse rounded-full bg-warn" aria-hidden /> Na fila — começa no próximo ciclo de sync…
        </p>
      )}
      {/* ERRO da última restauração (antes era invisível — parecia que "não fazia nada"). */}
      {status?.erro && !status?.restaurando && !status?.solicitado && (
        <div className="mt-3 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive" role="alert">
          <p className="font-medium">A última restauração falhou.</p>
          <p className="mt-1 break-words font-mono text-xs">{status.erro}</p>
          <p className="mt-1 text-xs text-destructive/80">Clique em “Restaurar agora” para tentar de novo; se persistir, envie o log ao suporte.</p>
        </div>
      )}
      {status?.restauradoEm && !status?.restaurando && (
        <p className="mt-2 text-xs text-muted-foreground">
          Última restauração: {new Date(status.restauradoEm).toLocaleString('pt-BR')}
          {status?.progresso ? ` · ${Number(status.progresso).toLocaleString('pt-BR')} linha(s)` : ''}
        </p>
      )}
      {msg && <p className="mt-3 text-sm text-muted-foreground">{msg}</p>}
    </Card>
  );
}

// ===== Saúde do servidor (visão do lojista) =====
// Mostra, em linguagem de dono de loja, o que ele precisa saber do computador da loja:
// quando foi o último backup e se ainda cabe espaço. Diagnóstico de infraestrutura
// (checksum, limite de transações do banco) NÃO aparece aqui — vira uma única linha
// "precisa de manutenção", porque essa parte é da distribuição, não do cliente.
function espaco(mb: any) {
  const n = Number(mb);
  if (!Number.isFinite(n)) return null;
  return n >= 1024 ? `${(n / 1024).toFixed(n >= 10240 ? 0 : 1)} GB` : `${Math.round(n)} MB`;
}
// "hoje às 03:00" · "ontem às 03:00" · "há 3 dias".
function quandoBackup(iso?: string | null) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const hora = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  const dia = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const dias = Math.round((dia(new Date()) - dia(d)) / 86400000);
  if (dias <= 0) return `hoje às ${hora}`;
  if (dias === 1) return `ontem às ${hora}`;
  if (dias < 30) return `há ${dias} dias`;
  return d.toLocaleDateString('pt-BR');
}

function SaudeServidor() {
  const [srv, setSrv] = useState<any>(null);
  const [carregando, setCarregando] = useState(true);

  useEffect(() => {
    let vivo = true;
    api
      .meuServidor()
      .then((r) => { if (vivo) setSrv(r); })
      .catch(() => { if (vivo) setSrv(null); })
      .finally(() => { if (vivo) setCarregando(false); });
    return () => { vivo = false; };
  }, []);

  if (carregando || !srv?.instalado) return null; // sem servidor local não há o que mostrar

  const b = srv.backup ?? null;
  const horas = Number(b?.horas);
  const backupAtrasado = !b || b.ok === false || (Number.isFinite(horas) && horas > 48);
  const discoMb = Number(srv.discoLivreMb);
  const discoBaixo = Number.isFinite(discoMb) && discoMb < 2048;
  const quandoTxt = b?.ok !== false ? quandoBackup(b?.em) : null;

  return (
    <Card className="p-6 lg:col-span-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-lg font-bold">Saúde do servidor</h2>
          <p className="max-w-prose text-sm text-muted-foreground">
            O computador da loja guarda uma cópia dos seus dados todo dia. Aqui você confere se está tudo em dia.
          </p>
        </div>
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${srv.online ? 'bg-ok/15 text-ok' : 'bg-secondary text-muted-foreground'}`}>
          {srv.online ? '● servidor online' : '○ servidor offline'}
        </span>
      </div>

      <dl className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <div className="rounded-lg border border-border p-3">
          <dt className="text-xs uppercase tracking-wide text-muted-foreground">Último backup</dt>
          <dd className={`mt-1 font-semibold ${backupAtrasado ? 'text-destructive' : ''}`}>
            {!b ? 'Nunca foi feito' : b.ok === false ? 'Não foi concluído' : (quandoTxt ?? 'Concluído')}
          </dd>
          {b?.ok !== false && b?.mb ? (
            <p className="mt-1 text-xs text-muted-foreground">Cópia de {espaco(b.mb)}</p>
          ) : null}
        </div>

        <div className="rounded-lg border border-border p-3">
          <dt className="text-xs uppercase tracking-wide text-muted-foreground">Espaço livre no computador</dt>
          <dd className={`mt-1 font-semibold ${discoBaixo ? 'text-destructive' : ''}`}>
            {espaco(srv.discoLivreMb) ?? '—'}
          </dd>
          {discoBaixo && <p className="mt-1 text-xs text-destructive">Está acabando o espaço.</p>}
        </div>

        <div className="rounded-lg border border-border p-3">
          <dt className="text-xs uppercase tracking-wide text-muted-foreground">Tamanho dos seus dados</dt>
          <dd className="mt-1 font-semibold">{espaco(srv.bancoMb) ?? '—'}</dd>
        </div>
      </dl>

      {backupAtrasado && (
        <div className="mt-4 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm" role="alert">
          <p className="font-semibold text-destructive">O backup do seu servidor não está em dia.</p>
          <p className="mt-1 text-muted-foreground">
            {!b
              ? 'Ainda não recebemos nenhuma cópia de segurança deste computador.'
              : b.ok === false
                ? 'A última tentativa de cópia não terminou.'
                : 'A última cópia tem mais de dois dias.'}{' '}
            Se o computador da loja der problema agora, você pode perder o que foi feito desde então — acione o suporte.
          </p>
        </div>
      )}

      {discoBaixo && (
        <div className="mt-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm" role="alert">
          <p className="font-semibold">Falta espaço no computador da loja ({espaco(srv.discoLivreMb)} livres).</p>
          <p className="mt-1 text-muted-foreground">
            Sem espaço, o servidor para de gravar vendas e de fazer backup. Apague arquivos que não usa
            (fotos, vídeos, downloads) ou acione o suporte.
          </p>
        </div>
      )}

      {srv.precisaManutencao && (
        <p className="mt-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm font-medium" role="alert">
          O servidor precisa de manutenção — acione o suporte.
        </p>
      )}

      {!backupAtrasado && !discoBaixo && !srv.precisaManutencao && (
        <p className="mt-4 text-sm text-ok">✓ Está tudo em dia com o servidor da sua loja.</p>
      )}
    </Card>
  );
}

// Suporte: envia o log recente do servidor local para a distribuição (sob demanda),
// pra o técnico diagnosticar um problema. Só no edge.
function SuporteServidor() {
  const [enviando, setEnviando] = useState(false);
  const [msg, setMsg] = useState('');
  async function enviar() {
    setEnviando(true);
    setMsg('');
    try {
      const r: any = await api.edgeEnviarLogs();
      setMsg(r?.ok ? 'Log recente enviado para o suporte. ✅' : 'Não consegui enviar o log agora.');
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Erro ao enviar o log');
    } finally {
      setEnviando(false);
    }
  }
  return (
    <Card className="p-6 lg:col-span-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-lg font-bold">Suporte / diagnóstico</h2>
          <p className="max-w-prose text-sm text-muted-foreground">
            Se pedirem, envie o <strong>log recente do servidor</strong> para a equipe do Regem
            diagnosticar um problema. Nenhum dado pessoal do cliente é enviado (é redigido).
          </p>
        </div>
        <Button type="button" variant="outline" onClick={enviar} disabled={enviando}>
          {enviando ? 'Enviando…' : 'Enviar logs pro suporte'}
        </Button>
      </div>
      {msg && <p className="mt-3 text-sm text-muted-foreground">{msg}</p>}
    </Card>
  );
}

// Só aparece no app rodando NO edge (build com NEXT_PUBLIC_EDGE=1). Verifica na
// nuvem se há versão nova e, se houver, deixa o gestor INSTALAR (a tarefa SYSTEM
// do Windows faz a troca com backup + rollback). Na nuvem o card fica oculto.
// Estágios do atualizar.ps1 (update-status.json) → rótulo amigável.
const ESTAGIO_LABEL: Record<string, string> = {
  iniciando: 'Iniciando…',
  baixando: 'Baixando a atualização…',
  conferindo: 'Conferindo integridade…',
  preparando: 'Montando a versão nova (a loja segue operando)…',
  backup: 'Fazendo backup…',
  trocando: 'Trocando a versão…',
  migrando: 'Atualizando o banco…',
  subindo: 'Reiniciando os serviços…',
  verificando: 'Conferindo se a versão nova subiu…',
  revertendo: 'Voltando a versão anterior…',
  ok: 'Concluído!',
  erro: 'Falhou',
};

// datetime-local (horário local) → ISO; e o inverso para mostrar.
function paraIso(local: string): string | null {
  const t = Date.parse(local);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}
function hojeAs(h: number, m = 0): string {
  const d = new Date();
  d.setHours(h, m, 0, 0);
  if (d.getTime() < Date.now()) d.setDate(d.getDate() + 1);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
function formatarHora(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

type Bloqueio =
  | { tipo: 'operacao'; caixasAbertos: number; pedidosEmProducao: number; mensagem: string }
  | { tipo: 'revertida'; mensagem: string };

function AtualizacaoServidor() {
  const [status, setStatus] = useState<any>(null);
  const [carregando, setCarregando] = useState(false);
  const [aplicando, setAplicando] = useState(false);
  const [revertendo, setRevertendo] = useState(false);
  const [monitorando, setMonitorando] = useState(false);
  const [reconectando, setReconectando] = useState(false);
  const [msg, setMsg] = useState('');
  const [bloqueio, setBloqueio] = useState<Bloqueio | null>(null);
  const [agendarAberto, setAgendarAberto] = useState(false);
  const [horaAgenda, setHoraAgenda] = useState(() => hojeAs(23, 30));

  const carregar = useCallback(async () => {
    try {
      const s = await api.edgeAtualizacaoStatus();
      setStatus(s);
      setReconectando(false);
      return s;
    } catch {
      // API fora do ar (serviços reiniciando durante a instalação) — reconecta.
      setReconectando(true);
      return null;
    }
  }, []);
  useEffect(() => {
    carregar();
  }, [carregar]);

  // Uma instalação/reversão já em curso (outra aba, agendamento): acompanha também.
  useEffect(() => {
    const f = status?.progresso?.fase;
    if (f === 'baixando' || f === 'instalando') setMonitorando(true);
  }, [status?.progresso?.fase]);

  // Enquanto instala/reverte: acompanha o progresso (e reconecta no reinício).
  useEffect(() => {
    if (!monitorando) return;
    const id = setInterval(async () => {
      const s = await carregar();
      const fase = s?.progresso?.fase;
      if (s && (fase === 'ok' || fase === 'erro')) {
        setMonitorando(false);
        setMsg(s.progresso?.acaoFinal || (fase === 'ok' ? 'Concluído.' : `Falhou: ${s.progresso?.erro || 'erro desconhecido'}.`));
      }
    }, 2500);
    return () => clearInterval(id);
  }, [monitorando, carregar]);

  async function verificar() {
    setMsg('');
    setBloqueio(null);
    setCarregando(true);
    try {
      const r: any = await api.edgeVerificarAtualizacao();
      if (r.ok === false) setMsg(r.erro || 'Não consegui verificar agora. Tente de novo.');
      else if (!r.disponivel) setMsg('Você já está com a versão mais recente liberada para esta loja.');
      await carregar();
    } catch (e) {
      setMsg(handleApiError(e, 'Erro ao verificar'));
    } finally {
      setCarregando(false);
    }
  }

  async function instalar(forcar: boolean) {
    if (
      !forcar &&
      !confirm(
        'Instalar a atualização agora? Os serviços do servidor reiniciam por 1–2 minutos (KDS, PDV e ponto ficam indisponíveis nesse intervalo). A versão nova é montada antes, com a loja operando; se algo falhar, a anterior volta sozinha.',
      )
    )
      return;
    setAplicando(true);
    setMsg('');
    try {
      await api.edgeAplicarAtualizacao({ forcar });
      setBloqueio(null);
      setMonitorando(true); // acompanha a barra de progresso + reconexão
    } catch (e) {
      const d: any = e instanceof ApiError ? e.details : null;
      if (d?.emOperacao) {
        setBloqueio({ tipo: 'operacao', ...d.emOperacao, mensagem: handleApiError(e) });
      } else if (d?.revertida) {
        setBloqueio({ tipo: 'revertida', mensagem: handleApiError(e) });
      } else if (d?.emCurso) {
        setMonitorando(true);
      } else {
        setMsg(handleApiError(e, 'Erro ao iniciar'));
      }
    } finally {
      setAplicando(false);
    }
  }

  async function agendar() {
    const iso = paraIso(horaAgenda);
    if (!iso) return setMsg('Escolha data e hora.');
    try {
      await api.edgeAplicarAtualizacao({ agendarPara: iso });
      setAgendarAberto(false);
      setBloqueio(null);
      setMsg(`Instalação agendada para ${formatarHora(iso)}. Ela só começa com a loja parada (sem caixa aberto nem pedido em produção).`);
      await carregar();
    } catch (e) {
      setMsg(handleApiError(e, 'Não consegui agendar.'));
    }
  }

  async function cancelarAgenda() {
    try {
      await api.edgeAplicarAtualizacao({ agendarPara: null });
      setMsg('Agendamento cancelado.');
      await carregar();
    } catch (e) {
      setMsg(handleApiError(e, 'Não consegui cancelar o agendamento.'));
    }
  }

  async function reverter() {
    if (
      !confirm(
        'Reverter para a versão anterior?\n\nIsto desfaz a ÚLTIMA atualização e volta o servidor à versão que estava antes dela (código, app e dependências; o banco é mantido). Os serviços reiniciam por 1–2 minutos.\n\nSó confirme se algo passou a dar problema DEPOIS da última atualização.',
      )
    )
      return;
    setRevertendo(true);
    setMsg('');
    try {
      await api.edgeReverterAtualizacao();
      setMonitorando(true); // o reverter grava o mesmo progresso; a tela reconecta sozinha
    } catch (e) {
      setMsg(handleApiError(e, 'Erro ao reverter'));
    } finally {
      setRevertendo(false);
    }
  }

  const progresso = status?.progresso;
  const emAndamento = monitorando && progresso && progresso.fase !== 'ok' && progresso.fase !== 'erro';

  return (
    <Card className="p-6 lg:col-span-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-lg font-bold">Atualização do servidor</h2>
          <p className="text-sm text-muted-foreground">
            Versão instalada: <strong className="font-mono">{status?.atual ?? '—'}</strong>
            {status?.disponivel && status?.ultima ? (
              <>
                {' '}· nova disponível:{' '}
                <strong className="font-mono text-primary">{status.ultima}</strong>
              </>
            ) : null}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" onClick={verificar} disabled={carregando || !!emAndamento}>
            {carregando ? 'Verificando…' : 'Verificar atualização'}
          </Button>
          {status?.disponivel && (
            <>
              <Button type="button" onClick={() => instalar(false)} disabled={aplicando || !!emAndamento}>
                {aplicando ? 'Iniciando…' : 'Instalar agora'}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => setAgendarAberto((v) => !v)}
                aria-expanded={agendarAberto}
                disabled={!!emAndamento}
              >
                Agendar
              </Button>
            </>
          )}
          <Button
            type="button"
            variant="ghost"
            onClick={reverter}
            disabled={revertendo || !!emAndamento}
            className="text-muted-foreground"
          >
            {revertendo ? 'Revertendo…' : 'Reverter atualização'}
          </Button>
        </div>
      </div>
      <p className="mt-2 text-[11px] text-muted-foreground">
        <strong>Reverter atualização</strong> volta o servidor à versão anterior à última atualização (código, app e dependências; o banco é mantido). Use só se algo passou a dar problema depois de atualizar.
      </p>

      {status?.versaoAtualRecolhida && (
        <div className="mt-3 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm">
          <p className="font-semibold text-destructive">A versão instalada ({status.atual}) foi recolhida pela distribuição.</p>
          <p className="mt-1 text-muted-foreground">
            {status?.disponivel
              ? 'Instale a versão nova assim que possível.'
              : 'Se algo não estiver funcionando, use "Reverter atualização" e fale com o suporte.'}
          </p>
        </div>
      )}

      {status?.agendadaPara && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-secondary/40 p-3 text-sm">
          <span>
            Instalação agendada para <strong className="font-mono">{formatarHora(status.agendadaPara)}</strong> — começa só com a loja parada.
          </span>
          <Button type="button" variant="ghost" onClick={cancelarAgenda} className="text-muted-foreground">
            Cancelar agendamento
          </Button>
        </div>
      )}

      {agendarAberto && status?.disponivel && (
        <div className="mt-3 flex flex-wrap items-end gap-3 rounded-lg border border-border p-3">
          <div className="w-full max-w-xs">
            <Label htmlFor="hora-agenda">Instalar em</Label>
            <Input
              id="hora-agenda"
              type="datetime-local"
              value={horaAgenda}
              onChange={(e) => setHoraAgenda(e.target.value)}
            />
          </div>
          <Button type="button" onClick={agendar}>Confirmar agendamento</Button>
          <p className="w-full text-[11px] text-muted-foreground">
            No horário, a instalação espera não haver caixa aberto nem pedido em produção (por até 12 h).
          </p>
        </div>
      )}

      {bloqueio && (
        <div className="mt-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm" role="alert">
          <p className="font-semibold">{bloqueio.mensagem}</p>
          {bloqueio.tipo === 'operacao' && (
            <p className="mt-1 text-muted-foreground">
              Agora: {bloqueio.caixasAbertos} caixa(s) aberto(s) e {bloqueio.pedidosEmProducao} pedido(s) em produção.
            </p>
          )}
          <div className="mt-2 flex flex-wrap gap-2">
            {bloqueio.tipo === 'operacao' && (
              <Button type="button" variant="outline" onClick={() => { setBloqueio(null); setAgendarAberto(true); }}>
                Agendar para depois do fechamento
              </Button>
            )}
            <Button type="button" variant="ghost" onClick={() => instalar(true)} disabled={aplicando}>
              {bloqueio.tipo === 'revertida' ? 'Instalar de novo mesmo assim' : 'Instalar agora mesmo assim'}
            </Button>
          </div>
        </div>
      )}

      {status?.disponivel && status?.notas && !emAndamento && (
        <div className="mt-3 rounded-lg border border-border bg-secondary/40 p-3 text-sm">
          <p className="mb-1 text-xs font-bold uppercase text-muted-foreground">O que muda</p>
          <p className="whitespace-pre-line text-muted-foreground">{status.notas}</p>
        </div>
      )}

      {/* Barra de progresso durante a instalação/reversão (com reconexão no reinício) */}
      {emAndamento && (
        <div className="mt-4" aria-live="polite">
          <div className="mb-1 flex items-center justify-between text-xs">
            <span className="font-medium">
              {ESTAGIO_LABEL[progresso.estagio] ?? progresso.estagio}
              {reconectando && ' · reconectando…'}
            </span>
            <span className="font-mono text-muted-foreground">{progresso.pct}%</span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-secondary">
            <div
              className="h-2 rounded-full bg-primary transition-all duration-500 motion-reduce:transition-none"
              style={{ width: `${Math.min(100, Math.max(0, progresso.pct))}%` }}
            />
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">
            Os serviços (KDS, PDV, ponto) reiniciam por 1–2 minutos só na troca. Não feche esta tela — ela reconecta sozinha ao terminar.
          </p>
        </div>
      )}

      {/* Falhou: mostra o erro e o que o script fez (voltou sozinho ou não) */}
      {progresso?.fase === 'erro' && !monitorando && (
        <div className="mt-4 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm">
          <p className="font-semibold text-destructive">A última atualização falhou.</p>
          <p className="mt-1 text-muted-foreground">{progresso.erro || 'Erro desconhecido.'}</p>
          {progresso.acaoFinal && <p className="mt-1 text-[12px] text-muted-foreground">{progresso.acaoFinal}</p>}
          <p className="mt-1 text-[12px] text-muted-foreground">A distribuição do Regem já foi avisada do erro.</p>
        </div>
      )}

      {msg && <p className="mt-3 text-sm text-muted-foreground">{msg}</p>}
    </Card>
  );
}

// Botão do instalador (.exe) — SEMPRE visível. Ao clicar, o backend confere a URL
// padrão (EDGE_INSTALLER_URL) via HEAD (sem CORS): se existe, baixa; senão, avisa
// para contatar o distribuidor.
function BotaoInstalador() {
  const [buscando, setBuscando] = useState(false);
  const [aviso, setAviso] = useState('');
  async function baixar() {
    setBuscando(true);
    setAviso('');
    try {
      const r: any = await api.edgeInstalador();
      if (r?.disponivel && r?.url) {
        window.location.href = r.url; // inicia o download
      } else {
        setAviso('Sem arquivo de instalação disponível no momento. Contate o distribuidor do Regem.');
      }
    } catch {
      setAviso('Não consegui verificar o instalador agora. Tente de novo em instantes.');
    } finally {
      setBuscando(false);
    }
  }
  return (
    <div className="mt-5">
      <Button className="h-11 px-5" onClick={baixar} disabled={buscando}>
        {buscando ? 'Procurando…' : '⬇ Baixar o instalador (Windows)'}
      </Button>
      {aviso && (
        <p className="mt-2 rounded-lg border border-dashed border-border px-4 py-3 text-sm text-muted-foreground">
          {aviso}
        </p>
      )}
    </div>
  );
}

// F9 (C) — Self-service do C&O: o presidente cadastra o APP AUTENTICADOR (2º fator do
// anti-clone) e vê o estado do próprio servidor. Feito na NUVEM (app.dmsregem): a
// ativação/segredo TOTP moram só na nuvem — por isso este card NÃO aparece no edge.
// O presidente não liga/desliga a trava (isso é da distribuição); só enrola o app.
function AutenticadorAntiClone() {
  const [presidente, setPresidente] = useState(false);
  const [srv, setSrv] = useState<any>(null);
  const [carregando, setCarregando] = useState(true);
  const [qr, setQr] = useState('');
  const [secret, setSecret] = useState('');
  const [codigo, setCodigo] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  const carregar = useCallback(async () => {
    try { setSrv(await api.meuServidor()); } catch { setSrv(null); } finally { setCarregando(false); }
  }, []);
  useEffect(() => {
    setPresidente(getCategoria() === 'presidente');
    carregar();
  }, [carregar]);

  async function iniciar() {
    setBusy(true); setMsg('');
    try {
      const r: any = await api.meuTotpIniciar();
      setSecret(r.secret ?? '');
      setQr(await QRCode.toDataURL(r.otpauthUri, { width: 200, margin: 1 }));
    } catch (e) { setMsg(e instanceof Error ? e.message : 'Erro ao gerar o QR'); }
    finally { setBusy(false); }
  }
  async function confirmar() {
    if (codigo.trim().length !== 6) { setMsg('Digite o código de 6 dígitos do app.'); return; }
    setBusy(true); setMsg('');
    try {
      await api.meuTotpConfirmar(codigo.trim());
      setQr(''); setSecret(''); setCodigo('');
      setMsg('App autenticador cadastrado ✅ — a partir de agora, mover o servidor pede o código do app.');
      await carregar();
    } catch (e) { setMsg(e instanceof Error ? e.message : 'Código inválido'); }
    finally { setBusy(false); }
  }

  if (!presidente) return null; // só o C&O

  return (
    <Card className="p-6 lg:col-span-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-display text-lg font-bold">App autenticador (anti-clone)</h2>
          <p className="max-w-prose text-sm text-muted-foreground">
            Cadastre um <strong>app autenticador</strong> (Google Authenticator, Authy…) como 2º fator.
            Assim, se precisar mover o servidor para outro computador, você libera pelo <strong>código do app</strong>,
            sem depender de e-mail nem da distribuição. Ligar/desligar a trava continua com a distribuição.
          </p>
        </div>
        {!carregando && srv?.instalado && (
          <div className="flex flex-none flex-col items-end gap-1 text-xs text-muted-foreground">
            <span className={`rounded-full px-2 py-0.5 font-medium ${srv.online ? 'bg-ok/15 text-ok' : 'bg-secondary'}`}>
              {srv.online ? '● servidor online' : '○ servidor offline'}
            </span>
            {srv.versao && <span className="font-mono">v{srv.versao}</span>}
            <span>Trava: {srv.travaAtiva ? `ligada (${srv.metodo === 'totp' ? 'app' : 'e-mail'})` : 'desligada'}</span>
            {srv.temTotp && <span className="text-ok">✓ app já cadastrado</span>}
          </div>
        )}
      </div>

      {carregando ? (
        <p className="mt-3 text-sm text-muted-foreground">Carregando…</p>
      ) : !srv?.instalado ? (
        <p className="mt-3 rounded-lg border border-dashed border-border px-4 py-3 text-sm text-muted-foreground">
          Instale o servidor local primeiro (abaixo). Depois volte aqui para cadastrar o app autenticador.
        </p>
      ) : (
        <div className="mt-4 rounded-lg border border-dashed border-border p-4">
          {srv.temTotp && !qr && (
            <p className="mb-2 text-xs text-ok">App já configurado. Para trocar de aparelho, gere um novo QR.</p>
          )}
          {!qr ? (
            <Button type="button" variant="outline" onClick={iniciar} disabled={busy}>
              {busy ? 'Gerando…' : srv.temTotp ? 'Gerar novo QR' : 'Cadastrar app (gerar QR)'}
            </Button>
          ) : (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">Escaneie no app autenticador (ou digite a chave manualmente):</p>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={qr} alt="QR do app autenticador" className="rounded border border-border" width={200} height={200} />
              <p className="break-all font-mono text-[11px] text-muted-foreground">{secret}</p>
              <div className="flex flex-wrap items-end gap-2">
                <div>
                  <Label className="text-xs">Código do app</Label>
                  <Input inputMode="numeric" maxLength={6} value={codigo}
                    onChange={(e) => setCodigo(e.target.value.replace(/\D/g, ''))}
                    placeholder="000000" className="w-28 font-mono" />
                </div>
                <Button type="button" onClick={confirmar} disabled={busy}>{busy ? 'Confirmando…' : 'Confirmar'}</Button>
              </div>
            </div>
          )}
          {msg && <p className="mt-3 text-sm text-muted-foreground">{msg}</p>}
        </div>
      )}
    </Card>
  );
}

const PASSOS = [
  {
    t: 'Baixe e execute o instalador',
    d: 'Se o Windows avisar "protegeu o computador", clique em Mais informações → Executar assim mesmo.',
  },
  {
    t: 'Aceite o aviso de administrador',
    d: 'É preciso para instalar o servidor e o banco de dados no computador.',
  },
  {
    t: 'Entre com sua conta do Regem',
    d: 'O mesmo e-mail e senha que você usa no app. Pronto — ele configura e ativa tudo sozinho.',
  },
];

export default function ServidorPage() {
  const router = useRouter();
  useEffect(() => {
    if (!getToken()) router.replace('/entrar');
  }, [router]);

  return (
    <Shell eyebrow="Instalação" title="Servidor local">
      <div className="grid gap-4 lg:grid-cols-3">
        {/* Saúde do servidor (backup/disco) — vale na nuvem e no edge; some se não há servidor. */}
        <SaudeServidor />
        {process.env.NEXT_PUBLIC_EDGE === '1' && <AtualizacaoServidor />}
        {process.env.NEXT_PUBLIC_EDGE === '1' && <RestaurarServidor />}
        {process.env.NEXT_PUBLIC_EDGE === '1' && <SuporteServidor />}
        {/* App autenticador (anti-clone) — só na NUVEM (app.dmsregem): ativação/segredo moram lá. */}
        {process.env.NEXT_PUBLIC_EDGE !== '1' && <AutenticadorAntiClone />}
        <Card className="p-6 lg:col-span-2">
          <h2 className="font-display text-xl font-bold">Instale o Regem na sua loja</h2>
          <p className="mt-2 max-w-prose text-sm text-muted-foreground">
            O servidor local deixa o <strong>KDS, o PDV e o ponto</strong> funcionando na sua rede
            <strong> mesmo sem internet</strong> — os pedidos sobem para a nuvem quando reconecta. É opcional,
            mas recomendado para o dia a dia da operação.
          </p>

          <BotaoInstalador />

          <ol className="mt-6 flex flex-col gap-4">
            {PASSOS.map((p, i) => (
              <li key={p.t} className="flex gap-3">
                <span className="grid h-7 w-7 flex-none place-items-center rounded-full bg-primary/15 font-mono text-sm font-bold text-primary">
                  {i + 1}
                </span>
                <div>
                  <p className="font-semibold">{p.t}</p>
                  <p className="text-sm text-muted-foreground">{p.d}</p>
                </div>
              </li>
            ))}
          </ol>

          <p className="mt-6 text-xs text-muted-foreground">
            Ao final, o instalador mostra o <strong>endereço do servidor</strong> (ex.: <code>https://regem.local:3001</code>).
            Aponte os aparelhos da loja para esse endereço.
          </p>
        </Card>

        <Card className="h-fit p-6">
          <h3 className="font-display text-base font-bold">Antes de começar</h3>
          <ul className="mt-3 flex flex-col gap-2 text-sm text-muted-foreground">
            <li className="flex gap-2"><span className="text-ok">✓</span> Um PC com <strong>Windows</strong> na loja (fica ligado no horário de funcionamento).</li>
            <li className="flex gap-2"><span className="text-ok">✓</span> Na <strong>mesma rede</strong> (WiFi ou cabo) dos aparelhos.</li>
            <li className="flex gap-2"><span className="text-ok">✓</span> Cerca de <strong>2 GB livres</strong>.</li>
            <li className="flex gap-2"><span className="text-ok">✓</span> <strong>Internet só na instalação</strong> (para baixar e ativar). Depois, o servidor funciona <strong>sem internet</strong>.</li>
          </ul>
          <p className="mt-4 text-xs text-muted-foreground">
            A instalação leva alguns minutos e é automática — você só entra com a conta. Depois de pronta,
            a loja opera offline e sincroniza com a nuvem quando reconecta.
          </p>
        </Card>
      </div>
    </Shell>
  );
}
