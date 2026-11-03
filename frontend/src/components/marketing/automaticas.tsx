'use client';

import { useEffect, useRef, useState } from 'react';
import { api, getCategoria } from '@/lib/api';
import { toast } from '@/lib/toast';
import { Button } from '@/components/ui/button';
import { Ajustes, alterados, type GrupoDeAjustes, type Valor, type Valores } from '@/components/ui/ajustes';
import { Dialogo } from '@/components/ui/sobreposto';
import { NO_SERVIDOR_DA_LOJA, SoPelaNuvem } from '@/components/ui/so-pela-nuvem';
import { texto2 } from '@/components/ui/lista';

// DELIVERY › MARKETING › AUTOMÁTICAS (Onda 3 — PR 2, mig 356; PR 3, mig 357; PR 4, mig 358; protótipo
// `mockups/regem-relacionamento.html`, vista "Automáticas", aprovado em 03/11/2026). Mensagens que saem sozinhas, todo
// dia, no horário da loja:
//  • "Para todas as automáticas": quem recebe (a regra das campanhas), uma oferta a cada N dias, mensagens por dia e o
//    horário do envio;
//  • "💰 Cashback vencendo": o aviso do saldo que vai vencer (nasce desligado);
//  • "🎂 Aniversário": os parabéns com o presente (cupom pessoal) ou só os parabéns (nasce desligado), e a PROTEÇÃO contra
//    troca de data, sempre ligada (pedido do dono em 03/11);
//  • "👋 Sentimos sua falta": quem não pede há N dias, com cupom pessoal opcional e no máximo 2 tentativas (nasce
//    desligado).
// Cada uma com a mensagem (o modelo na API oficial; texto pelo QR), a prévia ("Ver quem") e o resultado dos últimos 30
// dias, com o "Quem voltou". Tudo mora só na NUVEM; só gerente e presidente mudam (o servidor confere).

type Tipo = 'cashback' | 'aniversario' | 'volta';
type Item = { nome: string; detalhe: string };
type Previa = { dia: string; hora: string; emDias: number; total: number; vagas: number; lista: Item[] };
type Modelo = { nome?: string; status: string; categoria: string; motivo: string | null } | null;
type Resultado = { mensagens: number; cliques: number; voltaram: number; valor: number; cupons?: number };
type Painel = {
  ajustes: {
    intervaloOfertasDias: number;
    maxPorDia: number;
    horario: string;
    cashbackAtivo: boolean;
    cashbackDiasAntes: number;
    cashbackSaldoMin: number;
    aniversarioAtivo: boolean;
    aniversarioQuando: string;
    aniversarioPresente: string;
    aniversarioDesconto: string;
    aniversarioMinimo: number;
    aniversarioValidadeDias: number;
    voltaAtivo: boolean;
    voltaDias: number;
    voltaMinPedidos: number;
    voltaPresente: string;
    voltaDesconto: string;
    voltaMinimo: number;
    voltaValidadeDias: number;
    voltaTentativas: number;
  };
  opcoes: {
    intervalos: number[];
    maxPorDia: number[];
    horarios: string[];
    cashbackDiasAntes: number[];
    cashbackSaldoMin: number[];
    aniversarioQuando: string[];
    aniversarioDesconto: string[];
    aniversarioMinimo: number[];
    aniversarioValidade: number[];
    voltaDias: number[];
    voltaPedidos: number[];
    voltaDesconto: string[];
    voltaMinimo: number[];
    voltaValidade: number[];
    voltaTentativas: number[];
  };
  envioHoje: { antes_de_abrir: string | null; ao_abrir: string | null };
  cashback: {
    provedor: 'cloud' | 'evolution';
    pronto: boolean;
    motivo: string | null;
    modelo: Modelo;
    previa: Previa | null;
    resultado: Resultado;
  };
  aniversario: {
    provedor: 'cloud' | 'evolution';
    pronto: boolean;
    motivo: string | null;
    modelos: { presente: Modelo; parabens: Modelo } | null;
    informaram: number;
    previa: { inicio: string; fim: string; aniversarios: number; recebem: number; lista: Item[] };
    resultado: Resultado;
  };
  volta: {
    provedor: 'cloud' | 'evolution';
    pronto: boolean;
    motivo: string | null;
    modelos: { cupom: Modelo; lembrete: Modelo } | null;
    previa: Previa | null;
    resultado: Resultado;
  };
};

const NUMERICOS = [
  'intervaloOfertasDias',
  'maxPorDia',
  'cashbackDiasAntes',
  'cashbackSaldoMin',
  'aniversarioMinimo',
  'aniversarioValidadeDias',
  'voltaDias',
  'voltaMinPedidos',
  'voltaMinimo',
  'voltaValidadeDias',
  'voltaTentativas',
];
const brl = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const DIAS_SEMANA = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
const QUANDO: Record<string, string> = { no_dia: 'No dia', '3_antes': '3 dias antes', '7_antes': '7 dias antes' };
const DESCONTO: Record<string, string> = { v5: 'R$ 5,00', v8: 'R$ 8,00', v10: 'R$ 10,00', v15: 'R$ 15,00', p10: '10%', p15: '15%', frete: 'Entrega grátis' };
const NOME: Record<Tipo, string> = { cashback: 'cashback vencendo', aniversario: 'aniversário', volta: 'sentimos sua falta' };
/** O "Quem voltou" traz no máximo estes (os mais recentes) — o mesmo `limit` do servidor. */
const MAX_VOLTARAM = 50;

const paraValores = (p: Painel): Valores => ({
  intervaloOfertasDias: String(p.ajustes.intervaloOfertasDias),
  maxPorDia: String(p.ajustes.maxPorDia),
  horario: p.ajustes.horario,
  cashbackAtivo: p.ajustes.cashbackAtivo,
  cashbackDiasAntes: String(p.ajustes.cashbackDiasAntes),
  cashbackSaldoMin: String(p.ajustes.cashbackSaldoMin),
  aniversarioAtivo: p.ajustes.aniversarioAtivo,
  aniversarioQuando: p.ajustes.aniversarioQuando,
  aniversarioPresente: p.ajustes.aniversarioPresente,
  aniversarioDesconto: p.ajustes.aniversarioDesconto,
  aniversarioMinimo: String(p.ajustes.aniversarioMinimo),
  aniversarioValidadeDias: String(p.ajustes.aniversarioValidadeDias),
  voltaAtivo: p.ajustes.voltaAtivo,
  voltaDias: String(p.ajustes.voltaDias),
  voltaMinPedidos: String(p.ajustes.voltaMinPedidos),
  voltaPresente: p.ajustes.voltaPresente,
  voltaDesconto: p.ajustes.voltaDesconto,
  voltaMinimo: String(p.ajustes.voltaMinimo),
  voltaValidadeDias: String(p.ajustes.voltaValidadeDias),
  voltaTentativas: String(p.ajustes.voltaTentativas),
});

/** "hoje às 17:00", "amanhã às 17:00", "sexta às 17:00". */
function quando(p: Previa): string {
  if (p.emDias === 0) return `Hoje às ${p.hora}`;
  if (p.emDias === 1) return `Amanhã às ${p.hora}`;
  const d = new Date(`${p.dia}T12:00:00`);
  return `${DIAS_SEMANA[d.getDay()].replace(/^./, (c) => c.toUpperCase())} às ${p.hora}`;
}

/** "Últimos 30 dias: 42 mensagens · 12 abriram o cardápio · 9 clientes voltaram (21%) · R$ 486,30 em pedidos · 6 cupons usados." */
export function textoResultado(r: Resultado, oQueAbriu: string): string {
  if (r.mensagens === 0) return 'Últimos 30 dias: ainda não mandou nenhuma.';
  const pct = Math.round((r.voltaram / r.mensagens) * 100);
  const partes = [
    `${r.mensagens} ${r.mensagens === 1 ? 'mensagem' : 'mensagens'}`,
    `${r.cliques} ${r.cliques === 1 ? 'abriu' : 'abriram'} ${oQueAbriu}`,
    `${r.voltaram} ${r.voltaram === 1 ? 'cliente voltou' : 'clientes voltaram'} (${pct}%)`,
    `${brl(r.valor)} em pedidos`,
  ];
  if (r.cupons != null && r.cupons > 0) partes.push(`${r.cupons} ${r.cupons === 1 ? 'cupom usado' : 'cupons usados'}`);
  return `Últimos 30 dias: ${partes.join(' · ')}.`;
}

function Selo({ texto, tom }: { texto: string; tom: 'ok' | 'aviso' | 'neutro' | 'erro' }) {
  return (
    <span
      className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-bold ${
        tom === 'ok' ? 'bg-ok/15 text-ok' : tom === 'aviso' ? 'bg-warn/15 text-foreground' : tom === 'erro' ? 'bg-destructive/15 text-destructive' : 'bg-muted text-foreground/80'
      }`}
    >
      {texto}
    </span>
  );
}

/** O estado de um modelo na Meta (ou do texto pelo QR), com o "Enviar à Meta" quando ainda não foi. */
function SeloModelo({
  provedor,
  pronto,
  modelo,
  aoEnviar,
  enviando,
  semConexao,
}: {
  provedor: 'cloud' | 'evolution';
  pronto: boolean;
  modelo: Modelo;
  aoEnviar: () => void;
  enviando: boolean;
  semConexao: string;
}) {
  if (provedor === 'evolution') return <span className="text-sm font-semibold">{pronto ? 'Pronta para sair (texto, sem modelo)' : semConexao}</span>;
  const m = modelo;
  if (!m || m.status === 'rascunho')
    return (
      <span className="flex flex-wrap items-center gap-2">
        <Selo texto="Ainda não enviada à Meta" tom="neutro" />
        <Button type="button" size="sm" onClick={aoEnviar} disabled={enviando}>
          {enviando ? 'Enviando…' : 'Enviar à Meta'}
        </Button>
      </span>
    );
  const categoria = m.categoria === 'MARKETING' && m.nome === 'cashback_vencendo' ? ' · a Meta classificou como marketing' : '';
  if (m.status === 'aprovado') return <Selo texto={`Aprovada pela Meta${categoria}`} tom="ok" />;
  if (m.status === 'pendente') return <Selo texto="Em análise na Meta" tom="aviso" />;
  if (m.status === 'rejeitado') return <Selo texto={`Recusada pela Meta${m.motivo ? `: ${m.motivo}` : ''} — corrija em Marketing › Modelos`} tom="erro" />;
  return <Selo texto={`Na Meta: ${m.status}`} tom="neutro" />;
}

/** A lista do "Ver quem" e do "Quem voltou": nome à esquerda, o detalhe à direita (quebra a linha no estreito). */
function ListaQuem({ lista, mono }: { lista: Item[]; mono?: boolean }) {
  return (
    <ul className="divide-y divide-border rounded-lg border border-border text-sm">
      {lista.map((x, i) => (
        <li key={`${x.nome}-${i}`} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 px-3 py-2">
          <b className="min-w-0">{x.nome}</b>
          <span className={`min-w-0 text-xs ${mono ? 'font-mono' : ''} ${texto2}`}>{x.detalhe}</span>
        </li>
      ))}
    </ul>
  );
}

export function Automaticas() {
  const [podeMudar, setPodeMudar] = useState<boolean | null>(null);
  const [estado, setEstado] = useState<'carregando' | 'pronto' | 'erro'>('carregando');
  const [painel, setPainel] = useState<Painel | null>(null);
  const [valores, setValores] = useState<Valores>({});
  const [salvos, setSalvos] = useState<Valores>({});
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState('');
  const [enviandoModelo, setEnviandoModelo] = useState<'' | Tipo>('');
  const [verQuem, setVerQuem] = useState<'' | Tipo>('');
  const [voltou, setVoltou] = useState<{ tipo: Tipo; estado: 'carregando' | 'pronto' | 'erro'; lista: Item[] } | null>(null);
  // Só a resposta da leitura mais nova do "Quem voltou" vale (V64): abrir, fechar e abrir de novo não mistura listas.
  const leituraVoltou = useRef(0);

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
  const an = p.aniversario;
  const vo = p.volta;
  const horaHoje = (h: string) => {
    const x = h === 'antes_de_abrir' ? p.envioHoje.antes_de_abrir : h === 'ao_abrir' ? p.envioHoje.ao_abrir : null;
    const base = h === 'antes_de_abrir' ? '1 h antes de abrir' : h === 'ao_abrir' ? 'Na hora de abrir' : `Às ${h}`;
    if (h !== 'antes_de_abrir' && h !== 'ao_abrir') return base;
    return x ? `${base} (hoje, ${x})` : `${base} (hoje a loja não abre)`;
  };

  async function enviarModelo(tipo: Tipo) {
    if (enviandoModelo) return;
    setEnviandoModelo(tipo);
    try {
      // O painel volta do servidor — o que a pessoa já mudou e não salvou fica na tela.
      const novo: Painel = await api.enviarModeloAutomatica(tipo);
      setPainel(novo);
      setSalvos(paraValores(novo));
      toast.success('Modelo enviado à Meta. A mensagem começa a sair quando ela aprovar; a tela mostra a categoria que ela der.');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Não foi possível enviar o modelo à Meta.');
    } finally {
      setEnviandoModelo('');
    }
  }

  function abrirVoltou(tipo: Tipo) {
    const n = ++leituraVoltou.current;
    setVoltou({ tipo, estado: 'carregando', lista: [] });
    api
      .marketingQuemVoltou(tipo)
      .then((lista: Item[]) => {
        if (n === leituraVoltou.current) setVoltou({ tipo, estado: 'pronto', lista: Array.isArray(lista) ? lista : [] });
      })
      .catch(() => {
        if (n === leituraVoltou.current) setVoltou({ tipo, estado: 'erro', lista: [] });
      });
  }
  const fecharVoltou = () => {
    leituraVoltou.current += 1;
    setVoltou(null);
  };

  /** O resultado dos últimos 30 dias, com o "Quem voltou" quando alguém voltou. */
  const notaResultado = (r: Resultado, oQueAbriu: string, tipo: Tipo) => (
    <span className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
      <span>{textoResultado(r, oQueAbriu)}</span>
      {r.voltaram > 0 && (
        <Button type="button" size="sm" variant="outline" onClick={() => abrirVoltou(tipo)} aria-label={`Quem voltou · ${NOME[tipo]}`}>
          Quem voltou
        </Button>
      )}
    </span>
  );

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
            ? 'Todas as automáticas juntas. Protege o seu número: a Meta também limita quantas conversas o número abre por dia, e o Regem fica abaixo do limite dela.'
            : 'Todas as automáticas juntas. Protege o seu número: pelo QR, o Regem manda devagar, uma por minuto.',
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
    nota: notaResultado(c.resultado, 'o saldo', 'cashback'),
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
        desenhar: () => (
          <SeloModelo
            provedor={c.provedor}
            pronto={c.pronto}
            modelo={c.modelo}
            aoEnviar={() => void enviarModelo('cashback')}
            enviando={enviandoModelo === 'cashback'}
            semConexao="Conecte o WhatsApp da loja em Delivery › Configurações › Robô"
          />
        ),
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
              <Button type="button" size="sm" variant="outline" onClick={() => setVerQuem('cashback')} disabled={!previa.total} aria-label="Ver quem recebe o aviso do cashback">
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

  const comCupom = valores.aniversarioPresente === 'cupom';
  const modeloAniv = an.modelos ? (comCupom ? an.modelos.presente : an.modelos.parabens) : null;
  const grupoAniversario: GrupoDeAjustes = {
    titulo: '🎂 Aniversário',
    nota: notaResultado(an.resultado, 'o cardápio', 'aniversario'),
    itens: [
      {
        id: 'aniversarioAtivo',
        rotulo: 'Mandar os parabéns no aniversário',
        tipo: 'chave',
        ajuda: `Para quem informou o dia e o mês: no Perfil do cardápio, na pergunta da confirmação do pedido ou no cadastro em Delivery › Clientes. Hoje, ${an.informaram} ${an.informaram === 1 ? 'cliente informou' : 'clientes informaram'}. As travas contra troca de data estão logo abaixo.`,
        palavras: 'aniversário parabéns',
      },
      {
        id: 'aniversarioQuando',
        rotulo: 'Quando',
        tipo: 'selecao',
        opcoes: p.opcoes.aniversarioQuando.map((q) => ({ v: q, rotulo: QUANDO[q] ?? q })),
        ajuda: 'Loja fechada no dia: sai no próximo dia aberto, até 3 dias depois.',
        palavras: 'aniversário quando dia antes',
      },
      {
        id: 'aniversarioPresente',
        rotulo: 'Presente',
        tipo: 'selecao',
        opcoes: [
          { v: 'cupom', rotulo: 'Cupom de desconto' },
          { v: 'nada', rotulo: 'Sem presente, só os parabéns' },
        ],
        ajuda: 'Cupom pessoal, de uso único, que já vem aplicado no carrinho do cliente.',
        palavras: 'aniversário presente cupom',
      },
      ...(comCupom
        ? ([
            {
              id: 'aniversarioDesconto',
              rotulo: 'Desconto',
              tipo: 'selecao',
              opcoes: p.opcoes.aniversarioDesconto.map((d) => ({ v: d, rotulo: DESCONTO[d] ?? d })),
              palavras: 'aniversário desconto valor',
            },
            {
              id: 'aniversarioMinimo',
              rotulo: 'Pedido mínimo',
              tipo: 'selecao',
              opcoes: p.opcoes.aniversarioMinimo.map((v) => ({ v: String(v), rotulo: v === 0 ? 'Sem mínimo' : brl(v) })),
              palavras: 'aniversário pedido mínimo',
            },
            {
              id: 'aniversarioValidadeDias',
              rotulo: 'O cupom vale por',
              tipo: 'selecao',
              opcoes: p.opcoes.aniversarioValidade.map((d) => ({ v: String(d), rotulo: `${d} dias` })),
              ajuda: 'A partir do dia da mensagem.',
              palavras: 'aniversário validade cupom dias',
            },
          ] as GrupoDeAjustes['itens'])
        : []),
      {
        id: 'aniversarioMensagem',
        rotulo: 'A mensagem',
        tipo: 'livre',
        ajuda:
          an.provedor === 'cloud'
            ? 'Marketing para a Meta (aniversário está na lista de marketing dela). O botão manda os dois modelos: com o presente e só os parabéns.'
            : 'Mensagem de texto pelo número de marketing, com o link do cardápio, o cupom e o "responda SAIR".',
        desenhar: () => (
          <SeloModelo
            provedor={an.provedor}
            pronto={an.pronto}
            modelo={modeloAniv ? { ...modeloAniv, nome: comCupom ? 'aniversario_presente' : 'aniversario_parabens' } : null}
            aoEnviar={() => void enviarModelo('aniversario')}
            enviando={enviandoModelo === 'aniversario'}
            semConexao="Conecte o número de marketing em Delivery › Configurações › Robô"
          />
        ),
        palavras: 'aniversário mensagem modelo meta marketing',
      },
      {
        id: 'aniversarioPrevia',
        rotulo: 'Prévia',
        tipo: 'livre',
        ajuda: an.pronto ? 'Com os ajustes e a proteção salvos.' : `Ainda não sai: ${an.motivo ?? 'falta conectar o WhatsApp'}.`,
        desenhar: () => (
          <span className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold" data-previa-aniversario>
              Próximos 7 dias: {an.previa.recebem} {comCupom ? (an.previa.recebem === 1 ? 'presente' : 'presentes') : 'parabéns'} ({an.previa.aniversarios}{' '}
              {an.previa.aniversarios === 1 ? 'aniversário' : 'aniversários'})
            </span>
            <Button type="button" size="sm" variant="outline" onClick={() => setVerQuem('aniversario')} disabled={!an.previa.aniversarios} aria-label="Ver quem faz aniversário">
              Ver quem
            </Button>
          </span>
        ),
        palavras: 'aniversário prévia ver quem',
      },
    ],
  };

  // As travas: sempre ligadas, valem também para o cupom "Só aniversariantes" e para a campanha de aniversariantes.
  const fixo = (texto: string) => () => <span className="text-sm font-semibold">{texto}</span>;
  const grupoProtecao: GrupoDeAjustes = {
    titulo: '🎂 Aniversário · proteção contra troca de data',
    nota: 'Sempre ligada. Vale para o presente automático, para o cupom "Só aniversariantes" (Delivery › Configurações › Cupons) e para a campanha de aniversariantes.',
    itens: [
      {
        id: 'protCarencia',
        rotulo: 'A data vale 30 dias depois de informada',
        tipo: 'livre',
        ajuda: 'Quem informa (ou troca) a data a menos de 30 dias do aniversário ganha só no ano seguinte.',
        desenhar: fixo('30 dias'),
        palavras: 'proteção carência 30 dias',
      },
      {
        id: 'protTroca',
        rotulo: 'Troca de data',
        tipo: 'livre',
        ajuda: 'Toda troca espera os mesmos 30 dias e fica na auditoria: quem, quando, a data de antes e a nova, e o motivo.',
        desenhar: fixo('O cliente corrige uma vez; depois, só gerente e presidente'),
        palavras: 'proteção troca data corrigir',
      },
      {
        id: 'protDoze',
        rotulo: 'Um presente por cliente',
        tipo: 'livre',
        ajuda: 'Mesmo que a data mude.',
        desenhar: fixo('A cada 12 meses'),
        palavras: 'proteção presente 12 meses',
      },
      {
        id: 'protQuem',
        rotulo: 'Quem ganha',
        tipo: 'livre',
        ajuda: 'Cliente de verdade, não cadastro feito só para o brinde.',
        desenhar: fixo('Quem pediu nos últimos 12 meses'),
        palavras: 'proteção quem ganha pedido',
      },
      {
        id: 'protCupom',
        rotulo: 'O cupom',
        tipo: 'livre',
        ajuda: 'No cardápio, entrando com o código do WhatsApp; no WhatsApp, pelo número do cliente. Não serve para outra pessoa.',
        desenhar: fixo('Só do próprio cliente, uma vez'),
        palavras: 'proteção cupom pessoal',
      },
    ],
  };

  const voltaComCupom = valores.voltaPresente === 'cupom';
  const modeloVolta = vo.modelos ? (voltaComCupom ? vo.modelos.cupom : vo.modelos.lembrete) : null;
  const diasVolta = Number(valores.voltaDias) || p.ajustes.voltaDias;
  const previaVolta = vo.previa;
  const grupoVolta: GrupoDeAjustes = {
    titulo: '👋 Sentimos sua falta',
    nota: notaResultado(vo.resultado, 'o cardápio', 'volta'),
    itens: [
      {
        id: 'voltaAtivo',
        rotulo: 'Chamar de volta quem sumiu',
        tipo: 'chave',
        ajuda: 'Voltou = pediu em até 7 dias depois da mensagem (a mesma conta das campanhas).',
        palavras: 'sentimos sua falta volta sumiu',
      },
      {
        id: 'voltaDias',
        rotulo: 'Quem não pede há',
        tipo: 'selecao',
        opcoes: p.opcoes.voltaDias.map((d) => ({ v: String(d), rotulo: `${d} dias` })),
        ajuda: `Até 30 dias depois disso (com ${diasVolta}: de ${diasVolta} a ${diasVolta + 30} dias sem pedir). Quem sumiu há mais tempo fica para as campanhas.`,
        palavras: 'volta dias sem pedir sumiu',
      },
      {
        id: 'voltaMinPedidos',
        rotulo: 'Só quem já pediu',
        tipo: 'selecao',
        opcoes: p.opcoes.voltaPedidos.map((n) => ({ v: String(n), rotulo: n === 1 ? '1 vez ou mais' : `${n} vezes ou mais` })),
        palavras: 'volta pedidos vezes',
      },
      {
        id: 'voltaPresente',
        rotulo: 'Presente',
        tipo: 'selecao',
        opcoes: [
          { v: 'cupom', rotulo: 'Cupom de desconto' },
          { v: 'nada', rotulo: 'Sem cupom, só a mensagem' },
        ],
        ajuda: 'Cupom pessoal, de uso único, que já vem aplicado no carrinho do cliente.',
        palavras: 'volta presente cupom',
      },
      ...(voltaComCupom
        ? ([
            {
              id: 'voltaDesconto',
              rotulo: 'Desconto',
              tipo: 'selecao',
              opcoes: p.opcoes.voltaDesconto.map((d) => ({ v: d, rotulo: DESCONTO[d] ?? d })),
              palavras: 'volta desconto valor',
            },
            {
              id: 'voltaMinimo',
              rotulo: 'Pedido mínimo',
              tipo: 'selecao',
              opcoes: p.opcoes.voltaMinimo.map((v) => ({ v: String(v), rotulo: v === 0 ? 'Sem mínimo' : brl(v) })),
              palavras: 'volta pedido mínimo',
            },
            {
              id: 'voltaValidadeDias',
              rotulo: 'O cupom vale por',
              tipo: 'selecao',
              opcoes: p.opcoes.voltaValidade.map((d) => ({ v: String(d), rotulo: `${d} dias` })),
              ajuda: 'A partir do dia da mensagem.',
              palavras: 'volta validade cupom dias',
            },
          ] as GrupoDeAjustes['itens'])
        : []),
      {
        id: 'voltaTentativas',
        rotulo: 'Tentativas, no máximo',
        tipo: 'selecao',
        opcoes: p.opcoes.voltaTentativas.map((n) => ({ v: String(n), rotulo: String(n) })),
        ajuda: 'Com 60 dias entre uma e outra. Depois disso, para de chamar até o cliente pedir de novo. Nunca chama quem tem caso aberto no Atendimento.',
        palavras: 'volta tentativas',
      },
      {
        id: 'voltaMensagem',
        rotulo: 'A mensagem',
        tipo: 'livre',
        ajuda:
          vo.provedor === 'cloud'
            ? 'Marketing para a Meta. Com cupom, vai a versão com o valor e a validade. O botão manda os dois modelos: com o cupom e só o lembrete.'
            : 'Mensagem de texto pelo número de marketing, com o link do cardápio, o cupom e o "responda SAIR".',
        desenhar: () => (
          <SeloModelo
            provedor={vo.provedor}
            pronto={vo.pronto}
            modelo={modeloVolta ? { ...modeloVolta, nome: voltaComCupom ? 'volta_cupom' : 'volta_lembrete' } : null}
            aoEnviar={() => void enviarModelo('volta')}
            enviando={enviandoModelo === 'volta'}
            semConexao="Conecte o número de marketing em Delivery › Configurações › Robô"
          />
        ),
        palavras: 'volta mensagem modelo meta marketing',
      },
      {
        id: 'voltaPrevia',
        rotulo: 'Prévia',
        tipo: 'livre',
        ajuda: vo.pronto ? 'Com os ajustes salvos.' : `Ainda não sai: ${vo.motivo ?? 'falta conectar o WhatsApp'}.`,
        desenhar: () =>
          previaVolta ? (
            <span className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold" data-previa-volta>
                {quando(previaVolta)}:{' '}
                {previaVolta.total > previaVolta.vagas
                  ? `${previaVolta.vagas} de ${previaVolta.total} clientes`
                  : `${previaVolta.total} ${previaVolta.total === 1 ? 'cliente' : 'clientes'}`}
              </span>
              <Button type="button" size="sm" variant="outline" onClick={() => setVerQuem('volta')} disabled={!previaVolta.total} aria-label="Ver quem recebe o sentimos sua falta">
                Ver quem
              </Button>
            </span>
          ) : (
            <span className="text-sm font-semibold">Nenhuma loja com horário no cardápio: sem envio.</span>
          ),
        palavras: 'volta prévia ver quem',
      },
    ],
  };

  const grupos = [grupoGeral, grupoCashback, grupoAniversario, grupoProtecao, grupoVolta];
  const ligadas = Number(!!valores.cashbackAtivo) + Number(!!valores.aniversarioAtivo) + Number(!!valores.voltaAtivo);

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

  const fechar = (aoFechar: () => void) => (
    <Button type="button" variant="outline" data-foco-inicial onClick={aoFechar}>
      Fechar
    </Button>
  );
  const dlgCashback = verQuem === 'cashback' && previa;
  const dlgAniv = verQuem === 'aniversario';
  const dlgVolta = verQuem === 'volta' && previaVolta;
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
            Mensagens que saem sozinhas, todo dia, no horário da loja · 3 automáticas · {ligadas} {ligadas === 1 ? 'ligada' : 'ligadas'}.
          </p>
        }
      />
      {dlgCashback && (
        <Dialogo titulo={`Quem recebe · ${quando(previa).toLowerCase()} · cashback vencendo`} aoFechar={() => setVerQuem('')} rodape={fechar(() => setVerQuem(''))}>
          <ListaQuem lista={previa.lista} mono />
          <p className={`mt-3 text-xs ${texto2}`}>
            {previa.total > previa.lista.length ? `E mais ${previa.total - previa.lista.length}. ` : ''}
            {previa.total > previa.vagas
              ? `O limite do dia é ${p.ajustes.maxPorDia} (todas as automáticas): os outros ficam para o dia seguinte, quem vence antes primeiro. `
              : ''}
            Ficam fora: quem pediu para sair, quem já recebeu o aviso deste vencimento, quem tem saldo abaixo de {brl(p.ajustes.cashbackSaldoMin)} e quem só pediu pelo iFood ou pela 99.
          </p>
        </Dialogo>
      )}
      {dlgAniv && (
        <Dialogo titulo="Aniversários dos próximos 7 dias" aoFechar={() => setVerQuem('')} rodape={fechar(() => setVerQuem(''))}>
          <ListaQuem lista={an.previa.lista} />
          <p className={`mt-3 text-xs ${texto2}`}>
            {an.previa.aniversarios > an.previa.lista.length ? `E mais ${an.previa.aniversarios - an.previa.lista.length}. ` : ''}
            {an.previa.recebem} {comCupom ? (an.previa.recebem === 1 ? 'presente' : 'presentes') : 'parabéns'}. A data vem do Perfil do cardápio, da confirmação do pedido
            ou do cadastro da loja, e só vale 30 dias depois de informada.
          </p>
        </Dialogo>
      )}
      {dlgVolta && (
        <Dialogo titulo={`Quem recebe · ${quando(previaVolta).toLowerCase()} · sentimos sua falta`} aoFechar={() => setVerQuem('')} rodape={fechar(() => setVerQuem(''))}>
          <ListaQuem lista={previaVolta.lista} />
          <p className={`mt-3 text-xs ${texto2}`}>
            {previaVolta.total > previaVolta.lista.length ? `E mais ${previaVolta.total - previaVolta.lista.length}. ` : ''}
            {previaVolta.total > previaVolta.vagas
              ? `O limite do dia é ${p.ajustes.maxPorDia}, somando as três automáticas (o cashback e o aniversário saem antes): os outros ficam para os próximos dias, começando por quem sumiu há menos tempo. `
              : ''}
            Ficam fora: quem pediu para sair, quem recebeu uma oferta nos últimos {p.ajustes.intervaloOfertasDias} dias, quem tem caso aberto no Atendimento e quem só pediu pelo
            iFood ou pela 99.
          </p>
        </Dialogo>
      )}
      {voltou && (
        <Dialogo titulo={`Quem voltou · últimos 30 dias · ${NOME[voltou.tipo]}`} aoFechar={fecharVoltou} rodape={fechar(fecharVoltou)}>
          {voltou.estado === 'carregando' ? (
            <p className={`text-sm ${texto2}`} role="status">
              Carregando…
            </p>
          ) : voltou.estado === 'erro' ? (
            <div className="flex flex-wrap items-center gap-3 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm" role="alert">
              <span>Não foi possível ler quem voltou.</span>
              <Button type="button" size="sm" variant="outline" onClick={() => abrirVoltou(voltou.tipo)}>
                Tentar de novo
              </Button>
            </div>
          ) : voltou.lista.length === 0 ? (
            <p className="text-sm">Ninguém pediu em até 7 dias depois da mensagem.</p>
          ) : (
            <ListaQuem lista={voltou.lista} />
          )}
          <p className={`mt-3 text-xs ${texto2}`}>
            Voltou = pediu em até 7 dias depois da mensagem (a mesma conta das campanhas).
            {voltou.estado === 'pronto' && voltou.lista.length >= MAX_VOLTARAM ? ` Mostra os ${MAX_VOLTARAM} pedidos mais recentes.` : ''}
          </p>
        </Dialogo>
      )}
    </div>
  );
}
