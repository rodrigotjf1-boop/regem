'use client';

import { useEffect, useState } from 'react';
import { api, getCategoria } from '@/lib/api';
import { toast } from '@/lib/toast';
import { Button } from '@/components/ui/button';
import { Ajustes, alterados, type GrupoDeAjustes, type Valor, type Valores } from '@/components/ui/ajustes';
import { Dialogo } from '@/components/ui/sobreposto';
import { NO_SERVIDOR_DA_LOJA, SoPelaNuvem } from '@/components/ui/so-pela-nuvem';
import { texto2 } from '@/components/ui/lista';

// DELIVERY › MARKETING › AUTOMÁTICAS (Onda 3 · PR 2, mig 356; protótipo `mockups/regem-relacionamento.html`, vista
// "Automáticas", aprovado em 03/11/2026). Mensagens que saem sozinhas, todo dia, no horário da loja:
//  • "Para todas as automáticas": quem recebe (a regra das campanhas), uma oferta a cada N dias, mensagens por dia e o
//    horário do envio;
//  • "💰 Cashback vencendo": o aviso do saldo que vai vencer (nasce desligado), com a mensagem (o modelo de utilidade na
//    API oficial; texto pelo QR), a prévia ("Ver quem") e o resultado dos últimos 30 dias.
// O aniversário e o "sentimos sua falta" entram nos PRs seguintes. Tudo mora só na NUVEM; só gerente e presidente mudam
// (o servidor confere).

type Previa = { dia: string; hora: string; emDias: number; total: number; vagas: number; lista: { nome: string; detalhe: string }[] };
type Painel = {
  ajustes: {
    intervaloOfertasDias: number;
    maxPorDia: number;
    horario: string;
    cashbackAtivo: boolean;
    cashbackDiasAntes: number;
    cashbackSaldoMin: number;
  };
  opcoes: { intervalos: number[]; maxPorDia: number[]; horarios: string[]; cashbackDiasAntes: number[]; cashbackSaldoMin: number[] };
  envioHoje: { antes_de_abrir: string | null; ao_abrir: string | null };
  cashback: {
    provedor: 'cloud' | 'evolution';
    pronto: boolean;
    motivo: string | null;
    modelo: { nome: string; status: string; categoria: string; motivo: string | null } | null;
    previa: Previa | null;
    resultado: { mensagens: number; cliques: number; voltaram: number; valor: number };
  };
};

const NUMERICOS = ['intervaloOfertasDias', 'maxPorDia', 'cashbackDiasAntes', 'cashbackSaldoMin'];
const brl = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const DIAS_SEMANA = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];

const paraValores = (p: Painel): Valores => ({
  intervaloOfertasDias: String(p.ajustes.intervaloOfertasDias),
  maxPorDia: String(p.ajustes.maxPorDia),
  horario: p.ajustes.horario,
  cashbackAtivo: p.ajustes.cashbackAtivo,
  cashbackDiasAntes: String(p.ajustes.cashbackDiasAntes),
  cashbackSaldoMin: String(p.ajustes.cashbackSaldoMin),
});

/** "hoje às 17:00", "amanhã às 17:00", "sexta às 17:00". */
function quando(p: Previa): string {
  if (p.emDias === 0) return `Hoje às ${p.hora}`;
  if (p.emDias === 1) return `Amanhã às ${p.hora}`;
  const d = new Date(`${p.dia}T12:00:00`);
  return `${DIAS_SEMANA[d.getDay()].replace(/^./, (c) => c.toUpperCase())} às ${p.hora}`;
}

function SeloModelo({ painel, aoEnviar, enviando }: { painel: Painel; aoEnviar: () => void; enviando: boolean }) {
  const c = painel.cashback;
  if (c.provedor === 'evolution')
    return <span className="text-sm font-semibold">{c.pronto ? 'Pronta para sair (texto, sem modelo)' : 'Conecte o WhatsApp da loja em Delivery › Configurações › Robô'}</span>;
  const m = c.modelo;
  const selo = (texto: string, tom: 'ok' | 'aviso' | 'neutro' | 'erro') => (
    <span
      className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-bold ${
        tom === 'ok' ? 'bg-ok/15 text-ok' : tom === 'aviso' ? 'bg-warn/15 text-foreground' : tom === 'erro' ? 'bg-destructive/15 text-destructive' : 'bg-muted text-foreground/80'
      }`}
    >
      {texto}
    </span>
  );
  if (!m || m.status === 'rascunho')
    return (
      <span className="flex flex-wrap items-center gap-2">
        {selo('Ainda não enviada à Meta', 'neutro')}
        <Button type="button" size="sm" onClick={aoEnviar} disabled={enviando}>
          {enviando ? 'Enviando…' : 'Enviar à Meta'}
        </Button>
      </span>
    );
  const categoria = m.categoria === 'MARKETING' ? ' · a Meta classificou como marketing' : '';
  if (m.status === 'aprovado') return selo(`Aprovada pela Meta${categoria}`, 'ok');
  if (m.status === 'pendente') return selo('Em análise na Meta', 'aviso');
  if (m.status === 'rejeitado') return selo(`Recusada pela Meta${m.motivo ? `: ${m.motivo}` : ''} — corrija em Marketing › Modelos`, 'erro');
  return selo(`Na Meta: ${m.status}`, 'neutro');
}

export function Automaticas() {
  const [podeMudar, setPodeMudar] = useState<boolean | null>(null);
  const [estado, setEstado] = useState<'carregando' | 'pronto' | 'erro'>('carregando');
  const [painel, setPainel] = useState<Painel | null>(null);
  const [valores, setValores] = useState<Valores>({});
  const [salvos, setSalvos] = useState<Valores>({});
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState('');
  const [enviandoModelo, setEnviandoModelo] = useState(false);
  const [verQuem, setVerQuem] = useState(false);

  const aplicar = (p: Painel) => {
    setPainel(p);
    setValores(paraValores(p));
    setSalvos(paraValores(p));
  };
  const ler = () => {
    setEstado('carregando');
    api
      .marketingAutomaticas()
      .then((p: Painel) => {
        aplicar(p);
        setEstado('pronto');
      })
      .catch(() => setEstado('erro'));
  };

  // A categoria só existe no navegador: lida depois de montar (o primeiro desenho é o mesmo do servidor — V35).
  useEffect(() => {
    const pode = ['presidente', 'gerente'].includes(getCategoria() ?? '');
    setPodeMudar(pode);
    if (pode && !NO_SERVIDOR_DA_LOJA) ler();
  }, []);

  const cabecalho = (conteudo: React.ReactNode) => (
    <section className="space-y-3" aria-labelledby="automaticas-titulo">
      <h2 id="automaticas-titulo" className="font-display text-xl font-bold">
        Automáticas
      </h2>
      {conteudo}
    </section>
  );
  if (NO_SERVIDOR_DA_LOJA) return cabecalho(<SoPelaNuvem />);
  if (podeMudar === null) return cabecalho(<p className={`text-sm ${texto2}`}>Carregando…</p>);
  if (!podeMudar) return cabecalho(<p className={`text-sm ${texto2}`}>Só gerente e presidente veem e mudam as automáticas.</p>);
  if (estado === 'carregando' || !painel) {
    if (estado === 'erro')
      return cabecalho(
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm" role="alert">
          <span>Não foi possível ler as automáticas.</span>
          <Button type="button" size="sm" variant="outline" onClick={ler}>
            Tentar de novo
          </Button>
        </div>,
      );
    return cabecalho(<p className={`text-sm ${texto2}`} role="status">Carregando as automáticas…</p>);
  }

  const p = painel;
  const c = p.cashback;
  const horaHoje = (h: string) => {
    const x = h === 'antes_de_abrir' ? p.envioHoje.antes_de_abrir : h === 'ao_abrir' ? p.envioHoje.ao_abrir : null;
    const base = h === 'antes_de_abrir' ? '1 h antes de abrir' : h === 'ao_abrir' ? 'Na hora de abrir' : `Às ${h}`;
    if (h !== 'antes_de_abrir' && h !== 'ao_abrir') return base;
    return x ? `${base} (hoje, ${x})` : `${base} (hoje a loja não abre)`;
  };
  const r = c.resultado;
  const resultado =
    r.mensagens === 0
      ? 'Últimos 30 dias: ainda não mandou nenhuma.'
      : `Últimos 30 dias: ${r.mensagens} ${r.mensagens === 1 ? 'mensagem' : 'mensagens'} · ${r.cliques} ${r.cliques === 1 ? 'abriu' : 'abriram'} o saldo · ${r.voltaram} ${r.voltaram === 1 ? 'cliente pediu' : 'clientes pediram'} em até 7 dias (${brl(r.valor)}).`;

  async function enviarModelo() {
    if (enviandoModelo) return;
    setEnviandoModelo(true);
    try {
      aplicarSemPerderEdicao(await api.enviarModeloAutomatica('cashback'));
      toast.success('Modelo enviado à Meta. A mensagem começa a sair quando ela aprovar; a tela mostra a categoria que ela der.');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Não foi possível enviar o modelo à Meta.');
    } finally {
      setEnviandoModelo(false);
    }
  }
  // Depois do "Enviar à Meta", o painel volta do servidor — o que a pessoa já mudou e não salvou fica na tela.
  function aplicarSemPerderEdicao(novo: Painel) {
    setPainel(novo);
    setSalvos(paraValores(novo));
  }

  const grupoGeral: GrupoDeAjustes = {
    titulo: 'Para todas as automáticas',
    itens: [
      {
        id: 'quemRecebe',
        rotulo: 'Quem recebe',
        tipo: 'livre',
        ajuda:
          'Cliente da loja recebe até pedir para sair: SAIR no WhatsApp, a chave do Perfil no cardápio ou a marca no cadastro (regra de 01/10). Toda mensagem leva o jeito de sair. Quem só pediu pelo iFood ou pela 99 fica fora: o telefone é da plataforma.',
        desenhar: () => <span className="text-sm font-semibold">Clientes que não pediram para sair</span>,
        palavras: 'quem recebe sair opt-out ifood 99',
      },
      {
        id: 'intervaloOfertasDias',
        rotulo: 'No máximo uma oferta por cliente a cada',
        tipo: 'selecao',
        opcoes: p.opcoes.intervalos.map((d) => ({ v: String(d), rotulo: `${d} dias` })),
        ajuda: 'Soma o aniversário, o "sentimos sua falta" e as campanhas. O aviso do cashback não conta (se a Meta não o classificar como marketing).',
        palavras: 'frequência intervalo oferta dias',
      },
      {
        id: 'maxPorDia',
        rotulo: 'Mensagens por dia, no máximo',
        tipo: 'selecao',
        opcoes: p.opcoes.maxPorDia.map((n) => ({ v: String(n), rotulo: String(n) })),
        ajuda:
          c.provedor === 'cloud'
            ? 'Protege o seu número. A Meta também limita quantas conversas o número abre por dia: o Regem fica abaixo do limite dela.'
            : 'Protege o seu número: pelo QR, o Regem manda devagar, uma por minuto.',
        palavras: 'limite mensagens dia',
      },
      {
        id: 'horario',
        rotulo: 'Horário do envio',
        tipo: 'selecao',
        opcoes: p.opcoes.horarios.map((h) => ({ v: h, rotulo: horaHoje(h) })),
        ajuda: 'Só em dia que a loja abre (o horário do cardápio). Nunca antes das 9h nem depois das 21h.',
        palavras: 'horário envio abrir',
      },
    ],
  };

  const previa = c.previa;
  const grupoCashback: GrupoDeAjustes = {
    titulo: '💰 Cashback vencendo',
    nota: resultado,
    itens: [
      {
        id: 'cashbackAtivo',
        rotulo: 'Avisar o cashback que vai vencer',
        tipo: 'chave',
        ajuda:
          'Uma mensagem por vencimento. O saldo vence o prazo do seu Plano de cashback depois do último crédito (cada crédito renova) — Delivery › Configurações › Cashback.',
        palavras: 'cashback vencendo aviso saldo',
      },
      {
        id: 'cashbackDiasAntes',
        rotulo: 'Avisar quantos dias antes',
        tipo: 'selecao',
        opcoes: p.opcoes.cashbackDiasAntes.map((d) => ({ v: String(d), rotulo: d === 1 ? '1 dia' : `${d} dias` })),
        palavras: 'cashback dias antes vencer',
      },
      {
        id: 'cashbackSaldoMin',
        rotulo: 'Só se o saldo for de pelo menos',
        tipo: 'selecao',
        opcoes: p.opcoes.cashbackSaldoMin.map((v) => ({ v: String(v), rotulo: brl(v) })),
        ajuda: 'Saldo pequeno não vale a mensagem.',
        palavras: 'cashback saldo mínimo',
      },
      {
        id: 'cashbackMensagem',
        rotulo: 'A mensagem',
        tipo: 'livre',
        ajuda:
          c.provedor === 'cloud'
            ? 'Pedida à Meta como Utilidade (saldo, data e como usar, sem convite para comprar). A Meta confirma a categoria na aprovação.'
            : 'Mensagem de texto pelo QR, com o link de Sua conta › Benefícios e o "responda SAIR".',
        desenhar: () => <SeloModelo painel={p} aoEnviar={() => void enviarModelo()} enviando={enviandoModelo} />,
        palavras: 'mensagem modelo meta utilidade',
      },
      {
        id: 'cashbackPrevia',
        rotulo: 'Prévia',
        tipo: 'livre',
        ajuda: c.pronto ? 'Com os ajustes salvos.' : `Ainda não sai: ${c.motivo ?? 'falta conectar o WhatsApp'}.`,
        desenhar: () =>
          previa ? (
            <span className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold" data-previa-cashback>
                {quando(previa)}:{' '}
                {previa.total > previa.vagas ? `${previa.vagas} de ${previa.total} clientes` : `${previa.total} ${previa.total === 1 ? 'cliente' : 'clientes'}`}
              </span>
              <Button type="button" size="sm" variant="outline" onClick={() => setVerQuem(true)} disabled={!previa.total}>
                Ver quem
              </Button>
            </span>
          ) : (
            <span className="text-sm font-semibold">Nenhuma loja com horário no cardápio: sem envio.</span>
          ),
        palavras: 'prévia ver quem clientes',
      },
    ],
  };
  const grupos = [grupoGeral, grupoCashback];
  const ligadas = Number(!!valores.cashbackAtivo);

  async function salvar() {
    const chaves = alterados(grupos, valores, salvos).filter((k) => k in paraValores(p));
    if (!chaves.length || salvando) return;
    setSalvando(true);
    setErro('');
    const corpo: Record<string, unknown> = {};
    for (const k of chaves) corpo[k] = NUMERICOS.includes(k) ? Number(valores[k]) : valores[k];
    try {
      aplicar(await api.salvarMarketingAutomaticas(corpo));
      toast.success('Automáticas salvas.');
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'tente de novo');
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="space-y-3">
      <Ajustes
        id="automaticas"
        titulo="Automáticas"
        grupos={grupos}
        valores={valores}
        salvos={salvos}
        aoMudar={(k: string, v: Valor) => setValores((s) => ({ ...s, [k]: v }))}
        aoSalvar={() => void salvar()}
        aoDescartar={() => {
          setValores(salvos);
          setErro('');
        }}
        salvando={salvando}
        erro={erro}
        antes={
          <p className={`text-sm ${texto2}`}>
            Mensagens que saem sozinhas, todo dia, no horário da loja · 1 automática · {ligadas} {ligadas === 1 ? 'ligada' : 'ligadas'}. O aniversário e o
            &quot;sentimos sua falta&quot; chegam em seguida.
          </p>
        }
      />
      {verQuem && previa && (
        <Dialogo
          titulo={`Quem recebe · ${quando(previa).toLowerCase()} · cashback vencendo`}
          aoFechar={() => setVerQuem(false)}
          rodape={
            <Button type="button" variant="outline" data-foco-inicial onClick={() => setVerQuem(false)}>
              Fechar
            </Button>
          }
        >
          <ul className="divide-y divide-border rounded-lg border border-border text-sm">
            {previa.lista.map((x, i) => (
              <li key={`${x.nome}-${i}`} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 px-3 py-2">
                <b className="min-w-0">{x.nome}</b>
                <span className={`font-mono text-xs ${texto2}`}>{x.detalhe}</span>
              </li>
            ))}
          </ul>
          <p className={`mt-3 text-xs ${texto2}`}>
            {previa.total > previa.lista.length ? `E mais ${previa.total - previa.lista.length}. ` : ''}
            {previa.total > previa.vagas
              ? `O limite do dia é ${p.ajustes.maxPorDia} (todas as automáticas): os outros ficam para o dia seguinte, quem vence antes primeiro. `
              : ''}
            Ficam fora: quem pediu para sair, quem já recebeu o aviso deste vencimento, quem tem saldo abaixo de {brl(p.ajustes.cashbackSaldoMin)} e quem só pediu pelo iFood ou pela 99.
          </p>
        </Dialogo>
      )}
    </div>
  );
}
