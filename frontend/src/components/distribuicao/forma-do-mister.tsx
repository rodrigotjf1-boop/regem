'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { distApi } from '@/lib/api';
import { Confirmar } from '@/components/distribuicao/confirmar-no-console';

// Console da distribuição → Mister → "Como o Mister fala no WhatsApp" (Q2 e Q3, mig 437; protótipo aprovado em 15/11/2026:
// `mockups/regem-mister-qr.html`). Duas formas, UMA em uso para todas as empresas: a API oficial da Meta (o bloco "Número do
// Mister" acima) e a conexão por QR Code (um celular no Evolution da distribuição). O servidor decide: a forma passa a ser
// o QR quando o celular CONECTA (até lá, a oficial segue falando) e a volta para a oficial é um botão. Trocar a forma não
// mexe nas ligações das pessoas. A tela nunca recebe o nome da instância nem a assinatura.

export type SituacaoDoQr = 'sem' | 'conectando' | 'conectado' | 'caiu' | 'bloqueado';
export type QrNoPainel = {
  pronto: boolean;
  situacao: SituacaoDoQr;
  motivo: string | null;
  numero: string | null;
  situacaoEm: string | null;
  conectadoEm: string | null;
  aceite: { por: string | null; em: string | null; versao: string | null } | null;
  textoDoAceite: string;
  versaoDoAceite: string;
};
type QrAgora = Pick<QrNoPainel, 'situacao' | 'motivo' | 'numero' | 'situacaoEm' | 'conectadoEm' | 'aceite'> & { provedor: 'oficial' | 'evolution' };
type Gerado = QrAgora & { qr: { imagem: string | null; codigo: string | null } | null };

const quando = (ts?: string | null) => (ts ? new Date(ts).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '—');

const BOTAO = 'inline-flex min-h-10 items-center justify-center rounded-lg px-3.5 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-40';
const PRIMARIO = `${BOTAO} bg-amber-500 text-slate-950 hover:bg-amber-400`;
const NEUTRO = `${BOTAO} border border-slate-600 text-slate-100 hover:bg-slate-800`;
const PERIGO = `${BOTAO} border border-red-500/60 text-red-200 hover:bg-red-500/10`;
const CARTAO = 'rounded-xl border border-slate-800 bg-slate-900/40 p-4';
const AVISO = 'rounded-lg border border-amber-600/50 bg-amber-500/10 p-3 text-sm text-amber-100';
const AVISO_CRIT = 'rounded-lg border border-red-500/50 bg-red-500/10 p-3 text-sm text-red-100';
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

/** A cada quantos segundos o QR troca (o do WhatsApp vale ~20 s) e quantas trocas antes de parar de esperar. */
const QR_SEGUNDOS = 20;
const QR_TROCAS = 6;
const CONFERIR_MS = 3000;

export function FormaDoMister(p: {
  provedor: 'oficial' | 'evolution';
  qr: QrNoPainel;
  /** O número da API oficial está conectado (sem ele, a volta para a oficial não pode). */
  oficialConectado: boolean;
  /** O telefone já formatado ("+55 21 90000-0000"); a formatação mora no painel. */
  formatar: (digitos: string | null) => string;
  /** Relê o painel inteiro (depois de conectar, trocar ou desconectar). */
  onMudou: () => void;
}) {
  const { onMudou, formatar } = p;
  const idAceite = useId();
  const [vista, setVista] = useState<'oficial' | 'qr'>(p.provedor === 'evolution' ? 'qr' : 'oficial');
  const [agora, setAgora] = useState<QrAgora>({ ...p.qr, provedor: p.provedor });
  const [marcado, setMarcado] = useState(false);
  const [imagem, setImagem] = useState<string | null>(null);
  const [segundos, setSegundos] = useState(QR_SEGUNDOS);
  const [expirou, setExpirou] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState('');
  const [aviso, setAviso] = useState('');
  const [dialogo, setDialogo] = useState<'oficial' | 'qr' | 'desconectar' | null>(null);
  const trocas = useRef(0);
  const conferindo = useRef(false);

  // O painel relido (depois de uma ação) vence a cópia local.
  useEffect(() => {
    setAgora({ ...p.qr, provedor: p.provedor });
  }, [p.qr, p.provedor]);

  const aceiteVale = !!agora.aceite && agora.aceite.versao === p.qr.versaoDoAceite;
  const emUso = agora.provedor === 'evolution';

  const parar = useCallback(() => {
    setImagem(null);
    trocas.current = 0;
  }, []);

  async function gerar(outroNumero = false) {
    setOcupado(true);
    setErro('');
    setAviso('');
    setExpirou(false);
    try {
      if (!aceiteVale) {
        if (!marcado) throw new Error('Marque o aceite do risco antes de gerar o QR Code.');
        setAgora((await distApi.misterQrAceite(p.qr.versaoDoAceite)) as QrAgora);
      }
      const r = (await distApi.misterQrGerar(outroNumero)) as Gerado;
      setAgora(r);
      if (!r.qr) {
        setAviso('O celular já estava conectado.');
        parar();
        onMudou();
      } else if (!r.qr.imagem) {
        throw new Error('O Evolution não devolveu a imagem do QR Code. Tente de novo em alguns segundos.');
      } else {
        setImagem(r.qr.imagem);
        setSegundos(QR_SEGUNDOS);
      }
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não consegui gerar o QR Code.');
      parar();
    } finally {
      setOcupado(false);
    }
  }

  // Com o QR na tela: confere a cada 3 s se o celular conectou; o QR troca a cada 20 s; depois de 6 trocas, para.
  useEffect(() => {
    if (!imagem) return;
    const conferir = setInterval(async () => {
      if (conferindo.current) return;
      conferindo.current = true;
      try {
        const r = (await distApi.misterQrConferir()) as QrAgora;
        setAgora(r);
        if (r.situacao === 'conectado') {
          parar();
          setAviso(
            r.provedor === 'evolution'
              ? 'Conectado. O Mister passou a falar por este número e manda a cada pessoa ligada "este é o novo número do Mister".'
              : 'Conectado.',
          );
          onMudou();
        }
      } catch {
        // Uma conferência que falhou não tira o QR da tela: a próxima tenta de novo.
      } finally {
        conferindo.current = false;
      }
    }, CONFERIR_MS);
    const relogio = setInterval(() => setSegundos((s) => (s > 0 ? s - 1 : 0)), 1000);
    return () => {
      clearInterval(conferir);
      clearInterval(relogio);
    };
  }, [imagem, onMudou, parar]);

  useEffect(() => {
    if (!imagem || segundos > 0 || ocupado) return;
    trocas.current += 1;
    if (trocas.current >= QR_TROCAS) {
      parar();
      setExpirou(true);
      return;
    }
    void (async () => {
      try {
        const r = (await distApi.misterQrGerar(false, true)) as Gerado;
        setAgora(r);
        if (!r.qr) {
          // O celular conectou entre duas conferências: a próxima leitura do painel mostra.
          parar();
          onMudou();
          return;
        }
        if (r.qr.imagem) setImagem(r.qr.imagem);
        setSegundos(QR_SEGUNDOS);
      } catch {
        setSegundos(QR_SEGUNDOS);
      }
    })();
  }, [segundos, imagem, ocupado, parar, onMudou]);

  async function trocar(para: 'oficial' | 'qr') {
    setOcupado(true);
    setErro('');
    setAviso('');
    try {
      setAgora((await distApi.misterQrTrocar(para)) as QrAgora);
      setDialogo(null);
      setAviso(para === 'qr' ? 'Forma trocada: o Mister fala pela conexão por QR Code.' : 'Forma trocada para a API oficial.');
      setVista(para);
      onMudou();
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não consegui trocar a forma.');
      setDialogo(null);
    } finally {
      setOcupado(false);
    }
  }

  async function desconectar() {
    setOcupado(true);
    setErro('');
    setAviso('');
    try {
      setAgora((await distApi.misterQrDesconectar()) as QrAgora);
      setDialogo(null);
      parar();
      setAviso('Desconectado. Gere o QR Code de novo para voltar.');
      onMudou();
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não consegui desconectar.');
      setDialogo(null);
    } finally {
      setOcupado(false);
    }
  }

  const fecharDialogo = useCallback(() => setDialogo(null), []);
  const numero = formatar(agora.numero);
  const textoAceite = p.qr.textoDoAceite.split('\n');
  const botaoParaOficial = (
    <button type="button" className={NEUTRO} disabled={ocupado || !p.oficialConectado} onClick={() => setDialogo('oficial')}>
      Trocar para a API oficial
    </button>
  );
  const semOficial = !p.oficialConectado && (
    <p className="w-full text-xs text-slate-400">A volta para a API oficial pede o número oficial conectado (no bloco &quot;Número do Mister&quot;).</p>
  );

  // O cartão do QR, pela situação (o QR na tela vence: a conexão ainda "conectando" sem a imagem pede um novo).
  let cartao: React.ReactNode;
  if (!p.qr.pronto && agora.situacao !== 'conectado') {
    cartao = (
      <div className={`${CARTAO} space-y-2`}>
        <p>
          <Selo tom="neutro">○ não disponível</Selo>
        </p>
        <p className={AVISO} role="status">
          O Evolution da distribuição não está configurado neste servidor (faltam EVOLUTION_API_URL, EVOLUTION_API_KEY ou BOT_RESOLVER_SECRET).
        </p>
      </div>
    );
  } else if (imagem) {
    cartao = (
      <div className={`${CARTAO} space-y-3`} data-qr="na-tela">
        <p>
          <Selo tom="warn">◐ esperando o celular</Selo>
        </p>
        <div className="grid grid-cols-1 items-start gap-4 md:grid-cols-[auto_minmax(0,1fr)]">
          <div className="w-max max-w-full rounded-xl bg-white p-3">
            {/* eslint-disable-next-line @next/next/no-img-element -- imagem em data: do Evolution, sem otimização */}
            <img src={imagem} alt="QR Code para conectar o número do Mister" className="block h-auto w-[min(220px,62vw)]" />
          </div>
          <div className="min-w-0 space-y-2 text-sm text-slate-200">
            <ol className="list-decimal space-y-1.5 pl-5">
              <li>No celular do número do Mister, abra o WhatsApp.</li>
              <li>
                Toque em <b>⋮</b> (ou em Configurações, no iPhone) › <b>Aparelhos conectados</b> › <b>Conectar um aparelho</b>.
              </li>
              <li>Aponte a câmera para este QR Code.</li>
            </ol>
            <p className="text-xs text-slate-400" aria-live="polite">
              O QR troca em <span className="font-mono text-amber-300">{segundos}</span> s. Ele vale só para esta conexão.
            </p>
            {!emUso && <p className="text-xs text-slate-400">Até o celular conectar, o Mister segue falando pela API oficial.</p>}
            <div className="flex flex-wrap gap-2">
              <button type="button" className={NEUTRO} onClick={parar}>
                Cancelar
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  } else if (agora.situacao === 'conectado') {
    cartao = (
      <div className={`${CARTAO} space-y-3`} data-qr="conectado">
        <p className="flex flex-wrap items-center gap-2">
          <Selo tom="ok">● conectado</Selo>
          <span className="whitespace-nowrap font-mono text-sm text-slate-100">{numero || 'número ainda não informado pelo Evolution'}</span>
          {emUso ? <Selo tom="ok">em uso</Selo> : <Selo tom="neutro">fora de uso</Selo>}
        </p>
        <dl className="grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
          <Dado rotulo="Forma">Conexão por QR Code</Dado>
          <Dado rotulo="Conectado desde">
            <span className="font-mono">{quando(agora.conectadoEm)}</span>
          </Dado>
          <Dado rotulo="Ritmo de envio">
            <span className="font-mono">até 20 por minuto</span>
          </Dado>
          <Dado rotulo="Aceite do risco">
            {agora.aceite ? `${agora.aceite.por ?? '—'} · ${quando(agora.aceite.em)} · texto ${agora.aceite.versao ?? '—'}` : '—'}
          </Dado>
        </dl>
        <p className={AVISO}>Deixe o celular ligado e com internet. Se ele ficar 14 dias sem abrir o WhatsApp, a conexão cai e o console mostra &quot;o celular saiu&quot;.</p>
        <div className="flex flex-wrap gap-2">
          {emUso ? (
            botaoParaOficial
          ) : (
            <button type="button" className={PRIMARIO} disabled={ocupado} onClick={() => setDialogo('qr')}>
              Trocar para a conexão por QR Code
            </button>
          )}
          <button type="button" className={PERIGO} disabled={ocupado} onClick={() => setDialogo('desconectar')}>
            Desconectar
          </button>
          {emUso && semOficial}
        </div>
      </div>
    );
  } else if (agora.situacao === 'caiu') {
    cartao = (
      <div className={`${CARTAO} space-y-3`} data-qr="caiu">
        <p className="flex flex-wrap items-center gap-2">
          <Selo tom="crit">● desconectado</Selo>
          {numero && <span className="whitespace-nowrap font-mono text-sm text-slate-100">{numero}</span>}
        </p>
        <p className="text-sm text-slate-200">
          A conexão caiu em {quando(agora.situacaoEm)}
          {agora.motivo ? `: ${agora.motivo.replace(/\.+$/, '').replace(/^./, (c) => c.toLowerCase())}.` : '.'}{' '}
          {emUso
            ? 'As empresas continuam recebendo os avisos dentro do Regem. Pelo WhatsApp, nada sai até conectar de novo ou trocar para a API oficial.'
            : 'O Mister segue falando pela API oficial.'}
        </p>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={PRIMARIO} disabled={ocupado} onClick={() => gerar(false)}>
            Gerar o QR Code de novo
          </button>
          {emUso && botaoParaOficial}
          {emUso && semOficial}
        </div>
      </div>
    );
  } else if (agora.situacao === 'bloqueado') {
    cartao = (
      <div className={`${CARTAO} space-y-3`} data-qr="bloqueado">
        <p className="flex flex-wrap items-center gap-2">
          <Selo tom="crit">● bloqueado pelo WhatsApp</Selo>
          {numero && <span className="whitespace-nowrap font-mono text-sm text-slate-100">{numero}</span>}
        </p>
        <p className={AVISO_CRIT} role="alert">
          O WhatsApp bloqueou este número em {quando(agora.situacaoEm)}. Ele não volta por aqui: só o WhatsApp, pelo pedido de revisão no próprio aplicativo.
        </p>
        <p className="text-sm text-slate-200">
          Os avisos seguem dentro do Regem. Para o Mister voltar a falar, conecte outro número pelo QR Code ou troque para a API oficial. Ninguém precisa ligar de novo:
          no número novo, o Mister manda a cada pessoa &quot;este é o novo número do Mister&quot;.
        </p>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={PRIMARIO} disabled={ocupado} onClick={() => gerar(true)}>
            Conectar outro número
          </button>
          {emUso && botaoParaOficial}
          {emUso && semOficial}
        </div>
      </div>
    );
  } else {
    // "sem" ou "conectando" sem o QR na tela (a página foi recarregada ou o QR expirou).
    cartao = (
      <div className={`${CARTAO} space-y-3`} data-qr="antes">
        <p>
          <Selo tom="neutro">○ não conectado</Selo>
        </p>
        {expirou && (
          <p className="text-sm text-amber-200" role="status">
            O QR Code expirou sem o celular ler. Gere de novo quando o celular estiver na mão.
          </p>
        )}
        <p className={AVISO}>{textoAceite[0]}</p>
        {textoAceite.slice(1).map((t) => (
          <p key={t} className="text-sm text-slate-300">
            {t}
          </p>
        ))}
        {aceiteVale ? (
          <p className="text-xs text-slate-400">
            Aceite do risco: {agora.aceite?.por ?? '—'} · {quando(agora.aceite?.em)} · texto {agora.aceite?.versao}
          </p>
        ) : (
          <label htmlFor={idAceite} className="flex items-start gap-2.5 text-sm text-slate-100">
            <input id={idAceite} type="checkbox" checked={marcado} onChange={(e) => setMarcado(e.target.checked)} className="mt-0.5 h-5 w-5 flex-none accent-amber-500" />
            <span>
              Entendi o risco de bloqueio e quero conectar o Mister pela conexão por QR Code.{' '}
              <span className="text-slate-400">(O aceite fica na auditoria com o seu nome, a data e a versão deste texto.)</span>
            </span>
          </label>
        )}
        <button type="button" className={PRIMARIO} disabled={ocupado || (!aceiteVale && !marcado)} onClick={() => gerar(false)}>
          Gerar o QR Code
        </button>
      </div>
    );
  }

  return (
    <section className="space-y-3 border-t border-slate-800 pt-6" aria-labelledby="mister-forma">
      <div>
        <h2 id="mister-forma" className="text-sm font-semibold text-slate-100">
          Como o Mister fala no WhatsApp
        </h2>
        <p className="mt-1 max-w-3xl text-xs text-slate-300">
          Uma forma por vez, para todas as empresas. As pessoas continuam ligadas pelo telefone delas: trocar a forma não pede que ninguém ligue de novo.
        </p>
      </div>
      {erro && (
        <p className="text-sm text-red-300" role="alert" id="forma-erro">
          {erro}
        </p>
      )}
      {aviso && (
        <p className="text-sm text-emerald-300" role="status" id="forma-aviso">
          {aviso}
        </p>
      )}
      <div className="grid grid-cols-1 gap-2 md:grid-cols-2" role="group" aria-label="Forma do número do Mister">
        {(
          [
            ['oficial', 'API oficial da Meta', 'pago por conversa', 'Homologada pela Meta, com modelos aprovados para falar fora das 24 horas.', ['Botões nas autorizações', 'Fora das 24 h, só pelos modelos aprovados']],
            [
              'qr',
              'Conexão por QR Code',
              'grátis',
              'Um celular com o WhatsApp do número do Mister, conectado como no WhatsApp Web (Evolution, no servidor da distribuição).',
              ['Fala a qualquer hora, sem modelo', 'Autorização por resposta "1" ou "2"', 'Risco de bloqueio do número pelo WhatsApp'],
            ],
          ] as const
        ).map(([valor, titulo, preco, texto, itens]) => {
          const esta = (valor === 'qr') === emUso;
          return (
            <button
              key={valor}
              type="button"
              aria-pressed={vista === valor}
              onClick={() => setVista(valor)}
              className={`flex min-w-0 flex-col gap-1 rounded-lg border p-3 text-left ${vista === valor ? 'border-amber-500 bg-amber-500/10' : 'border-slate-700 hover:border-slate-500'}`}
            >
              <span className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-semibold text-slate-100">{titulo}</span>
                <Selo tom={valor === 'qr' ? 'ok' : 'neutro'}>{preco}</Selo>
                {esta && <Selo tom="ok">em uso</Selo>}
              </span>
              <span className="text-xs text-slate-300">{texto}</span>
              <ul className="list-disc pl-4 text-xs text-slate-400">
                {itens.map((i) => (
                  <li key={i}>{i}</li>
                ))}
              </ul>
            </button>
          );
        })}
      </div>

      {vista === 'qr' ? (
        cartao
      ) : (
        <div className={`${CARTAO} space-y-2`} data-qr="oficial">
          <p className="flex flex-wrap items-center gap-2">
            <Selo tom={p.oficialConectado ? 'ok' : 'neutro'}>{p.oficialConectado ? '● conectada' : '○ não conectada'}</Selo>
            {!emUso && <Selo tom="ok">em uso</Selo>}
          </p>
          <p className="text-sm text-slate-300">
            A API oficial é o bloco &quot;Número do Mister&quot; acima: a coexistência ou só a API, os modelos da Meta e a qualidade do número.
          </p>
          {emUso ? (
            <div className="flex flex-wrap gap-2">
              {botaoParaOficial}
              {semOficial}
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className={NEUTRO}
                disabled={ocupado}
                onClick={() => (agora.situacao === 'conectado' ? setDialogo('qr') : setVista('qr'))}
              >
                Trocar para a conexão por QR Code
              </button>
            </div>
          )}
        </div>
      )}

      {dialogo === 'oficial' && (
        <Confirmar
          titulo="Trocar para a API oficial?"
          texto="O Mister passa a falar pelo número da API oficial em todas as empresas. Ninguém precisa ligar de novo. Fora das 24 horas, só pelos modelos aprovados pela Meta. O celular do QR Code segue conectado, fora de uso."
          acao="Trocar"
          ocupado={ocupado}
          onConfirmar={() => trocar('oficial')}
          onFechar={fecharDialogo}
        />
      )}
      {dialogo === 'qr' && (
        <Confirmar
          titulo="Trocar para a conexão por QR Code?"
          texto={`O Mister passa a falar pelo número ${numero || 'do celular conectado'} em todas as empresas. Ninguém precisa ligar de novo: o Mister manda a cada pessoa "este é o novo número do Mister".`}
          acao="Trocar"
          ocupado={ocupado}
          onConfirmar={() => trocar('qr')}
          onFechar={fecharDialogo}
        />
      )}
      {dialogo === 'desconectar' && (
        <Confirmar
          titulo="Desconectar o celular do Mister?"
          texto={
            emUso
              ? 'O celular sai da conexão e o Mister para de falar pelo WhatsApp em todas as empresas até conectar de novo ou trocar para a API oficial. Os avisos seguem dentro do Regem.'
              : 'O celular sai da conexão. O Mister segue falando pela API oficial.'
          }
          acao="Desconectar"
          ocupado={ocupado}
          onConfirmar={desconectar}
          onFechar={fecharDialogo}
        />
      )}
    </section>
  );
}

function Dado({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">{rotulo}</dt>
      <dd className="mt-0.5 break-words text-slate-100">{children}</dd>
    </div>
  );
}
