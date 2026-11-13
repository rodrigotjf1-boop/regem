'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { distApi } from '@/lib/api';
import { abrirCadastroDaMeta } from '@/lib/meta-sdk';

// Console da distribuição → aba "Mister" (mig 417; só Diretoria). Protótipo aprovado: `mockups/regem-mister.html`, aba
// "Console da distribuição". Três blocos: o NÚMERO do Mister (um só, da distribuição, para todas as empresas), a CHAVE
// GERAL "Mister nesta nuvem" (nasce desligada) e as EMPRESAS com o módulo. O painel mostra situação e volume de cada
// empresa — nunca a chave de IA, o telefone de alguém ou o que foi conversado (o servidor nem manda).

type Forma = 'coexistencia' | 'api';
type Situacao = 'modulo_desligado' | 'falta_chave_e_whatsapp' | 'falta_chave' | 'ia_parada' | 'falta_whatsapp' | 'funcionando';
type Empresa = {
  tenantId: string;
  nome: string;
  modulo: boolean;
  ia: { origem: 'propria' | 'incluida' | null; provedor: string | null };
  pessoas: number;
  usoUsd: number | null;
  situacao: Situacao;
  motivo: string | null;
};
type Painel = {
  numero: {
    situacao: 'sem' | 'conectado' | 'caiu';
    numero: string | null;
    nome: string | null;
    forma: Forma | null;
    motivo: string | null;
    conectadoEm: string | null;
    situacaoEm: string | null;
    ultimaEntradaEm: string | null;
    qualidade: string | null;
    avisosPorDia: number | 'ilimitado' | null;
  };
  liberado: boolean;
  cadastro: { appId: string; configId: string; graphVersion: string; pronto: boolean };
};
type Lista = { empresas: Empresa[]; total: number; limite: number };

const quando = (ts?: string | null) => (ts ? new Date(ts).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '—');
const dia = (ts?: string | null) => (ts ? new Date(ts).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) : '');
const inteiro = (n: number) => n.toLocaleString('pt-BR');
const emDolar = (n: number | null) => (n === null ? 'sem preço' : `US$ ${n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);

/** "5521900000000" → "+55 21 90000-0000". Número de outro país fica com o "+" e os dígitos. */
export function telefoneBonito(digitos: string | null): string {
  const d = String(digitos ?? '').replace(/\D/g, '');
  if (!d) return '';
  const m = /^55(\d{2})(\d{4,5})(\d{4})$/.exec(d);
  return m ? `+55 ${m[1]} ${m[2]}-${m[3]}` : `+${d}`;
}

const FORMA: Record<Forma, string> = { coexistencia: 'Coexistência (celular e API)', api: 'Só a API oficial' };
const QUALIDADE: Record<string, { rotulo: string; tom: Tom }> = {
  green: { rotulo: 'alta', tom: 'ok' },
  yellow: { rotulo: 'média', tom: 'warn' },
  red: { rotulo: 'baixa', tom: 'crit' },
};
const PROVEDOR: Record<string, string> = { anthropic: 'Anthropic', openai: 'OpenAI', gemini: 'Gemini' };
const IA_PARADA: Record<string, string> = { sem_credito: 'sem crédito', teto_atingido: 'teto atingido', chave_recusada: 'chave recusada' };

function situacaoDaEmpresa(e: Empresa): { rotulo: string; tom: Tom } {
  switch (e.situacao) {
    case 'funcionando':
      return { rotulo: 'funcionando', tom: 'ok' };
    case 'ia_parada':
      return { rotulo: `IA parada · ${IA_PARADA[e.motivo ?? ''] ?? 'chave com problema'}`, tom: 'warn' };
    case 'falta_chave':
      return { rotulo: 'falta a chave de IA', tom: 'neutro' };
    case 'falta_chave_e_whatsapp':
      return { rotulo: 'falta a chave e ligar o WhatsApp', tom: 'neutro' };
    case 'falta_whatsapp':
      return { rotulo: 'falta ligar o WhatsApp', tom: 'neutro' };
    default:
      return { rotulo: 'módulo desligado', tom: 'neutro' };
  }
}
const iaDaEmpresa = (e: Empresa) =>
  e.ia.origem === 'propria' ? `chave própria · ${PROVEDOR[e.ia.provedor ?? ''] ?? e.ia.provedor ?? 'IA'}` : e.ia.origem === 'incluida' ? 'IA incluída pela Regem' : 'sem chave';

type Tom = 'ok' | 'warn' | 'crit' | 'neutro';
const TOM: Record<Tom, string> = {
  ok: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200',
  warn: 'border-amber-500/50 bg-amber-500/10 text-amber-100',
  crit: 'border-red-500/50 bg-red-500/10 text-red-200',
  neutro: 'border-slate-600 bg-slate-800/60 text-slate-200',
};
function Selo({ tom, children }: { tom: Tom; children: React.ReactNode }) {
  return <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${TOM[tom]}`}>{children}</span>;
}

const BOTAO = 'inline-flex min-h-10 items-center justify-center rounded-lg px-3.5 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-40';
const PRIMARIO = `${BOTAO} bg-amber-500 text-slate-950 hover:bg-amber-400`;
const NEUTRO = `${BOTAO} border border-slate-600 text-slate-100 hover:bg-slate-800`;
const PERIGO = `${BOTAO} border border-red-500/60 text-red-200 hover:bg-red-500/10`;
const CARTAO = 'rounded-xl border border-slate-800 bg-slate-900/40 p-4';

/** Confirmação de ação que vale para todas as empresas. Esc e "Cancelar" fecham; o foco começa em "Cancelar". */
function Confirmar(p: { titulo: string; texto: string; acao: string; ocupado: boolean; onConfirmar: () => void; onFechar: () => void }) {
  const idT = useId();
  const idD = useId();
  const cancelar = useRef<HTMLButtonElement>(null);
  const confirmar = useRef<HTMLButtonElement>(null);
  const { onFechar } = p;
  useEffect(() => {
    const antes = document.activeElement as HTMLElement | null;
    cancelar.current?.focus();
    const tecla = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onFechar();
      } else if (e.key === 'Tab') {
        // Só há dois botões: o Tab alterna entre eles e não sai do diálogo.
        e.preventDefault();
        (document.activeElement === cancelar.current ? confirmar : cancelar).current?.focus();
      }
    };
    document.addEventListener('keydown', tecla, true);
    return () => {
      document.removeEventListener('keydown', tecla, true);
      antes?.focus?.();
    };
  }, [onFechar]);
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/80 p-4" onMouseDown={(e) => e.target === e.currentTarget && onFechar()}>
      <div role="alertdialog" aria-modal="true" aria-labelledby={idT} aria-describedby={idD} className="w-full max-w-md rounded-xl border border-slate-700 bg-slate-900 p-5 shadow-xl">
        <h3 id={idT} className="text-base font-semibold text-slate-100">
          {p.titulo}
        </h3>
        <p id={idD} className="mt-2 text-sm text-slate-300">
          {p.texto}
        </p>
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <button ref={cancelar} type="button" className={NEUTRO} onClick={onFechar}>
            Cancelar
          </button>
          <button ref={confirmar} type="button" className={PERIGO} disabled={p.ocupado} onClick={p.onConfirmar}>
            {p.acao}
          </button>
        </div>
      </div>
    </div>
  );
}

export function MisterNoConsole() {
  const idBusca = useId();
  const idPin = useId();
  const [painel, setPainel] = useState<Painel | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erroDoPainel, setErroDoPainel] = useState('');
  const [lista, setLista] = useState<Lista | null>(null);
  const [erroDaLista, setErroDaLista] = useState('');
  const [erro, setErro] = useState('');
  const [aviso, setAviso] = useState('');
  const [avisosDaMeta, setAvisosDaMeta] = useState<string[]>([]);
  const [ocupado, setOcupado] = useState(false);
  const [forma, setForma] = useState<Forma | null>(null);
  const [pin, setPin] = useState('');
  const [reconectando, setReconectando] = useState(false);
  const [busca, setBusca] = useState('');
  const [dialogo, setDialogo] = useState<'desconectar' | 'desligar' | null>(null);
  // Só a resposta da leitura mais nova vale (a busca dispara várias; a antiga pode chegar depois).
  const leitura = useRef(0);
  const buscaAtual = useRef('');

  // Duas leituras: o número (o servidor pergunta à Meta como ela o vê) e as empresas. A busca só refaz a segunda.
  const carregar = useCallback(async () => {
    setCarregando(true);
    setErroDoPainel('');
    try {
      setPainel((await distApi.misterPainel()) as Painel);
    } catch (e) {
      setErroDoPainel(e instanceof Error ? e.message : 'Não consegui carregar o painel do Mister.');
    } finally {
      setCarregando(false);
    }
  }, []);

  const carregarLista = useCallback(async (termo: string) => {
    const vez = ++leitura.current;
    setErroDaLista('');
    try {
      const l = (await distApi.misterEmpresas(termo)) as Lista;
      if (vez === leitura.current) setLista(l);
    } catch (e) {
      if (vez === leitura.current) setErroDaLista(e instanceof Error ? e.message : 'Não consegui carregar as empresas.');
    }
  }, []);

  useEffect(() => {
    carregar();
    carregarLista('');
  }, [carregar, carregarLista]);

  // A busca vai ao servidor (a lista tem teto de linhas), um instante depois de a pessoa parar de digitar.
  useEffect(() => {
    const termo = busca.trim();
    if (termo === buscaAtual.current) return;
    const t = setTimeout(() => {
      buscaAtual.current = termo;
      carregarLista(termo);
    }, 350);
    return () => clearTimeout(t);
  }, [busca, carregarLista]);

  const fecharDialogo = useCallback(() => setDialogo(null), []);

  async function conectar() {
    if (!painel || !forma) return;
    setOcupado(true);
    setErro('');
    setAviso('');
    setAvisosDaMeta([]);
    try {
      const r = await abrirCadastroDaMeta({ appId: painel.cadastro.appId, configId: painel.cadastro.configId, graphVersion: painel.cadastro.graphVersion, coexistencia: forma === 'coexistencia' });
      if (!r) {
        setErro('A janela da Meta foi fechada antes de concluir. Nada mudou.');
        return;
      }
      const resp = (await distApi.misterConectar({ code: r.code, phoneNumberId: r.phoneNumberId, wabaId: r.wabaId, forma, ...(forma === 'api' ? { pin } : {}) })) as { avisos?: string[] };
      setAvisosDaMeta(resp.avisos ?? []);
      setAviso('Número conectado. Conectar não liga o Mister: a chave geral fica logo abaixo, em "Mister nesta nuvem".');
      setReconectando(false);
      setPin('');
      await carregar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não consegui conectar o número.');
    } finally {
      setOcupado(false);
    }
  }

  async function desconectar() {
    setOcupado(true);
    setErro('');
    setAviso('');
    try {
      await distApi.misterDesconectar();
      setDialogo(null);
      setForma(null);
      setAvisosDaMeta([]);
      setAviso('Número desconectado.');
      await carregar();
    } catch (e) {
      setDialogo(null);
      setErro(e instanceof Error ? e.message : 'Não consegui desconectar o número.');
    } finally {
      setOcupado(false);
    }
  }

  async function liberar(ligado: boolean) {
    setOcupado(true);
    setErro('');
    setAviso('');
    try {
      await distApi.misterLiberacao(ligado);
      setDialogo(null);
      setAviso(ligado ? 'Mister ligado nesta nuvem.' : 'Mister desligado nesta nuvem.');
      await carregar();
    } catch (e) {
      setDialogo(null);
      setErro(e instanceof Error ? e.message : 'Não consegui mudar a chave geral.');
    } finally {
      setOcupado(false);
    }
  }

  if (!painel) {
    return (
      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-slate-100">Mister</h2>
        {carregando && <p className="text-sm text-slate-400">Carregando…</p>}
        {erroDoPainel && (
          <div className={CARTAO} role="alert">
            <p className="text-sm text-red-300">{erroDoPainel}</p>
            <button type="button" className={`${NEUTRO} mt-3`} onClick={() => carregar()}>
              Tentar de novo
            </button>
          </div>
        )}
      </section>
    );
  }

  const n = painel.numero;
  const qualidade = n.qualidade ? QUALIDADE[n.qualidade] : undefined;
  const pinOk = /^\d{6}$/.test(pin);
  const escolha = (
    <div className="space-y-3">
      <p className="text-sm font-semibold text-slate-100">Como este número vai funcionar?</p>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2" role="group" aria-label="Como este número vai funcionar">
        {(
          [
            ['coexistencia', 'Continua no WhatsApp Business do celular', 'Coexistência: o número segue no celular para você acompanhar, e o Regem usa a API oficial por trás.'],
            ['api', 'Só na API oficial', 'Número novo ou que sai do aplicativo do celular. Não depende de um aparelho.'],
          ] as const
        ).map(([valor, titulo, texto]) => (
          <button
            key={valor}
            type="button"
            aria-pressed={forma === valor}
            onClick={() => setForma(valor)}
            className={`rounded-lg border p-3 text-left ${forma === valor ? 'border-amber-500 bg-amber-500/10' : 'border-slate-700 hover:border-slate-500'}`}
          >
            <span className="block text-sm font-semibold text-slate-100">{titulo}</span>
            <span className="mt-1 block text-xs text-slate-300">{texto}</span>
          </button>
        ))}
      </div>
      {forma === 'coexistencia' && (
        <p className="text-xs text-slate-300">
          O número precisa estar no aplicativo WhatsApp Business (versão 2.24.17 ou mais nova). Na janela da Meta, conecte o WhatsApp Business existente.
        </p>
      )}
      {forma === 'api' && (
        <div>
          <label htmlFor={idPin} className="block text-xs text-slate-300">
            PIN de seis dígitos do número (a Meta exige para registrar o número na API; se ele já tem verificação em duas etapas, é o mesmo PIN)
          </label>
          <input
            id={idPin}
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
            inputMode="numeric"
            autoComplete="off"
            className="mt-1 w-32 rounded-lg border border-slate-700 bg-slate-900 px-2 py-2 font-mono text-sm text-slate-100"
          />
        </div>
      )}
      {!painel.cadastro.pronto && (
        <p className="rounded-lg border border-amber-600/50 bg-amber-500/10 p-3 text-xs text-amber-100" role="status">
          O cadastro oficial da Meta ainda não está configurado neste servidor (faltam WA_CLOUD_APP_ID, WA_CLOUD_CONFIG_ID ou WA_CLOUD_TOKEN).
        </p>
      )}
      <button type="button" className={PRIMARIO} disabled={ocupado || !forma || !painel.cadastro.pronto || (forma === 'api' && !pinOk)} onClick={conectar}>
        Conectar com a Meta
      </button>
    </div>
  );

  return (
    <div className="space-y-8">
      {erro && (
        <p className="text-sm text-red-300" role="alert">
          {erro}
        </p>
      )}
      {aviso && (
        <p className="text-sm text-emerald-300" role="status">
          {aviso}
        </p>
      )}
      {avisosDaMeta.map((a) => (
        <p key={a} className="rounded-lg border border-amber-600/50 bg-amber-500/10 p-3 text-sm text-amber-100" role="alert">
          {a}
        </p>
      ))}

      <section className="space-y-3" aria-labelledby="mister-numero">
        <div>
          <h2 id="mister-numero" className="text-sm font-semibold text-slate-100">
            Número do Mister
          </h2>
          <p className="mt-1 max-w-3xl text-xs text-slate-300">
            Um número de WhatsApp só, da distribuição, para todas as empresas. É o telefone de quem escreve que diz de qual empresa é a conversa.
          </p>
        </div>

        {n.situacao === 'sem' && (
          <div className={`${CARTAO} space-y-3`}>
            <p>
              <Selo tom="neutro">○ não conectado</Selo>
            </p>
            {escolha}
          </div>
        )}

        {n.situacao === 'conectado' && (
          <div className={`${CARTAO} space-y-4`}>
            <p className="flex flex-wrap items-center gap-2">
              <Selo tom="ok">● conectado</Selo>
              <span className="whitespace-nowrap font-mono text-sm text-slate-100">{telefoneBonito(n.numero) || 'número não informado pela Meta'}</span>
            </p>
            <dl className="grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
              <Dado rotulo="Nome que aparece">{n.nome || '—'}</Dado>
              <Dado rotulo="Forma">{n.forma ? FORMA[n.forma] : '—'}</Dado>
              <Dado rotulo="Qualidade na Meta">{qualidade ? <Selo tom={qualidade.tom}>{qualidade.rotulo}</Selo> : 'ainda sem avaliação'}</Dado>
              <Dado rotulo="Avisos por dia">
                <span className="font-mono">{n.avisosPorDia === 'ilimitado' ? 'sem limite' : n.avisosPorDia ? `até ${inteiro(n.avisosPorDia)} pessoas` : 'a Meta ainda não informou'}</span>
              </Dado>
              <Dado rotulo="Última mensagem recebida">
                <span className="font-mono">{n.ultimaEntradaEm ? quando(n.ultimaEntradaEm) : 'nenhuma ainda'}</span>
              </Dado>
              <Dado rotulo="Conectado em">
                <span className="font-mono">{quando(n.conectadoEm)}</span>
              </Dado>
            </dl>
            {n.forma === 'coexistencia' && (
              <p className="rounded-lg border border-amber-600/50 bg-amber-500/10 p-3 text-xs text-amber-100">
                Coexistência: abra o WhatsApp Business no celular pelo menos a cada 14 dias, senão a Meta desconecta o número.
              </p>
            )}
            {reconectando ? (
              <div className="border-t border-slate-800 pt-4">{escolha}</div>
            ) : (
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className={NEUTRO}
                  disabled={ocupado}
                  onClick={() => {
                    setForma(n.forma);
                    setReconectando(true);
                  }}
                >
                  Reconectar com a Meta
                </button>
                <button type="button" className={PERIGO} disabled={ocupado} onClick={() => setDialogo('desconectar')}>
                  Desconectar
                </button>
              </div>
            )}
          </div>
        )}

        {n.situacao === 'caiu' && (
          <div className={`${CARTAO} space-y-3`}>
            <p className="flex flex-wrap items-center gap-2">
              <Selo tom="crit">● desconectado pela Meta</Selo>
              <span className="whitespace-nowrap font-mono text-sm text-slate-100">{telefoneBonito(n.numero)}</span>
            </p>
            <p className="text-sm text-slate-200">
              A Meta deixou de reconhecer o número{n.situacaoEm ? ` em ${dia(n.situacaoEm)}` : ''}
              {n.motivo ? `: ${n.motivo.replace(/\.+$/, '')}.` : '.'} Pelo WhatsApp, nada sai até reconectar.
            </p>
            {reconectando ? (
              escolha
            ) : (
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className={PRIMARIO}
                  disabled={ocupado}
                  onClick={() => {
                    setForma(n.forma);
                    setReconectando(true);
                  }}
                >
                  Reconectar com a Meta
                </button>
                <button type="button" className={PERIGO} disabled={ocupado} onClick={() => setDialogo('desconectar')}>
                  Desconectar
                </button>
              </div>
            )}
          </div>
        )}
      </section>

      <section className="space-y-3 border-t border-slate-800 pt-6" aria-labelledby="mister-geral">
        <div>
          <h2 id="mister-geral" className="text-sm font-semibold text-slate-100">
            Mister nesta nuvem
          </h2>
          <p className="mt-1 max-w-3xl text-xs text-slate-300">
            A chave geral. Desligado, o Mister não responde nem avisa pelo WhatsApp em nenhuma empresa. O vigia continua, e nada do que já foi registrado é apagado.
          </p>
        </div>
        <div className={`${CARTAO} flex flex-wrap items-center justify-between gap-x-4 gap-y-3`}>
          <p className="text-sm text-slate-200">
            Liberação: <strong className={painel.liberado ? 'text-emerald-300' : 'text-slate-100'}>{painel.liberado ? 'ligada' : 'desligada'}</strong>
          </p>
          {painel.liberado ? (
            <button type="button" className={NEUTRO} disabled={ocupado} onClick={() => setDialogo('desligar')}>
              Desligar o Mister
            </button>
          ) : (
            <button type="button" className={PRIMARIO} disabled={ocupado} onClick={() => liberar(true)}>
              Ligar o Mister
            </button>
          )}
        </div>
        {!painel.liberado && n.situacao === 'conectado' && (
          <p className="text-xs text-slate-300">O número está conectado, mas o Mister só responde depois de ligado aqui.</p>
        )}
      </section>

      <section className="space-y-3 border-t border-slate-800 pt-6" aria-labelledby="mister-empresas">
        <div>
          <h2 id="mister-empresas" className="text-sm font-semibold text-slate-100">
            Empresas com o Mister
          </h2>
          <p className="mt-1 max-w-3xl text-xs text-slate-300">O console vê a situação e o volume de cada empresa. Nunca a chave de IA nem o que foi conversado.</p>
        </div>
        <div>
          <label htmlFor={idBusca} className="sr-only">
            Buscar empresa
          </label>
          <input
            id={idBusca}
            type="search"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar empresa"
            className="min-h-10 w-full max-w-sm rounded-lg border border-slate-700 bg-slate-900 px-3 text-sm text-slate-100 placeholder:text-slate-500"
          />
        </div>
        {erroDaLista && (
          <div className={CARTAO} role="alert">
            <p className="text-sm text-red-300">{erroDaLista}</p>
            <button type="button" className={`${NEUTRO} mt-3`} onClick={() => carregarLista(buscaAtual.current)}>
              Tentar de novo
            </button>
          </div>
        )}
        {!erroDaLista && !lista && <p className="text-sm text-slate-400">Carregando…</p>}
        {!erroDaLista && lista && lista.empresas.length === 0 && (
          <p className={`${CARTAO} text-sm text-slate-300`}>{buscaAtual.current ? 'Nenhuma empresa com esse nome.' : 'Nenhuma empresa nesta nuvem ainda.'}</p>
        )}
        {!erroDaLista && lista && lista.empresas.length > 0 && (
          <>
            {/* Largo: tabela. Estreito: um cartão por empresa — nada rola para o lado (V45). */}
            <table className="hidden w-full text-left text-sm lg:table">
              <caption className="sr-only">Empresas com o módulo Mister, a IA de cada uma, as pessoas ligadas e o uso em 30 dias</caption>
              <thead className="text-xs text-slate-400">
                <tr className="border-b border-slate-800">
                  <th className="py-2 pr-3 font-medium">Empresa</th>
                  <th className="px-3 py-2 font-medium">Módulo</th>
                  <th className="px-3 py-2 font-medium">IA</th>
                  <th className="px-3 py-2 text-right font-medium">Pessoas ligadas</th>
                  <th className="px-3 py-2 text-right font-medium">Uso em 30 dias</th>
                  <th className="py-2 pl-3 font-medium">Situação</th>
                </tr>
              </thead>
              <tbody>
                {lista.empresas.map((e) => {
                  const s = situacaoDaEmpresa(e);
                  return (
                    <tr key={e.tenantId} className="border-b border-slate-800/70 align-top">
                      <td className="break-words py-2.5 pr-3 font-semibold text-slate-100">{e.nome}</td>
                      <td className="px-3 py-2.5">
                        <Selo tom={e.modulo ? 'ok' : 'neutro'}>{e.modulo ? 'ligado' : 'desligado'}</Selo>
                      </td>
                      <td className="px-3 py-2.5 text-slate-200">{iaDaEmpresa(e)}</td>
                      <td className="px-3 py-2.5 text-right font-mono text-slate-100">{inteiro(e.pessoas)}</td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-right font-mono text-slate-100">{emDolar(e.usoUsd)}</td>
                      <td className="py-2.5 pl-3">
                        <Selo tom={s.tom}>{s.rotulo}</Selo>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <ul className="space-y-2 lg:hidden">
              {lista.empresas.map((e) => {
                const s = situacaoDaEmpresa(e);
                return (
                  <li key={e.tenantId} className={`${CARTAO} space-y-2`}>
                    <p className="break-words text-sm font-semibold text-slate-100">{e.nome}</p>
                    <p className="flex flex-wrap gap-2">
                      <Selo tom={e.modulo ? 'ok' : 'neutro'}>módulo {e.modulo ? 'ligado' : 'desligado'}</Selo>
                      {/* Com o módulo desligado, a situação é a mesma frase do selo ao lado: não repete. */}
                      {e.situacao !== 'modulo_desligado' && <Selo tom={s.tom}>{s.rotulo}</Selo>}
                    </p>
                    <dl className="grid grid-cols-1 gap-y-1 text-sm min-[420px]:grid-cols-2">
                      <Dado rotulo="IA">{iaDaEmpresa(e)}</Dado>
                      <Dado rotulo="Pessoas ligadas">
                        <span className="font-mono">{inteiro(e.pessoas)}</span>
                      </Dado>
                      <Dado rotulo="Uso em 30 dias">
                        <span className="font-mono">{emDolar(e.usoUsd)}</span>
                      </Dado>
                    </dl>
                  </li>
                );
              })}
            </ul>
            {lista.total > lista.empresas.length && (
              <p className="text-xs text-slate-300" role="status">
                Mostrando {inteiro(lista.empresas.length)} de {inteiro(lista.total)} empresas. Use a busca para achar as outras.
              </p>
            )}
          </>
        )}
      </section>

      {dialogo === 'desconectar' && (
        <Confirmar
          titulo="Desconectar o número do Mister"
          texto="O Mister para de falar pelo WhatsApp com todas as empresas. As pessoas ligadas continuam ligadas e voltam a ser atendidas quando um número for conectado de novo."
          acao="Desconectar"
          ocupado={ocupado}
          onConfirmar={desconectar}
          onFechar={fecharDialogo}
        />
      )}
      {dialogo === 'desligar' && (
        <Confirmar
          titulo="Desligar o Mister nesta nuvem"
          texto="Vale para todas as empresas, na hora. O Mister para de responder e de avisar pelo WhatsApp. O vigia continua, e nada do que já foi registrado é apagado."
          acao="Desligar o Mister"
          ocupado={ocupado}
          onConfirmar={() => liberar(false)}
          onFechar={fecharDialogo}
        />
      )}
    </div>
  );
}

function Dado({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-slate-400">{rotulo}</dt>
      <dd className="break-words text-slate-100">{children}</dd>
    </div>
  );
}
