'use client';

import { useEffect, useState } from 'react';
import { api, getCategoria } from '@/lib/api';
import { toast } from '@/lib/toast';
import { Button } from '@/components/ui/button';
import { Ajustes, alterados, type GrupoDeAjustes, type Valor, type Valores } from '@/components/ui/ajustes';
import { NO_SERVIDOR_DA_LOJA, SoPelaNuvem } from '@/components/ui/so-pela-nuvem';
import { texto2 } from '@/components/ui/lista';
import { MOTIVO_REEMBOLSO_99 } from '@/components/atendimento/pedido-99';

// AJUSTES DO ATENDIMENTO — Delivery › Configurações › Operação › Atendimento (protótipo
// `mockups/regem-central-atendimento.html`, vista "ajustes"; o grupo do "Cheguei" é do `mockups/regem-relacionamento.html`).
//  • "Retirada · cliente chegou" (Onda 3, mig 354): o botão "Cheguei" do cliente que retira, perguntar onde ele está,
//    onde a equipe é avisada e quando avisar de novo. Ficam no `cardapio_config` da LOJA EM USO (sincroniza com o servidor
//    da loja) — só aparecem com o cardápio online da loja.
// E os três grupos da central:
//  • "Fila e avisos" (Onda 2, mig 353): avisar o gerente se ninguém pegar o caso; dizer ao cliente a posição na fila.
//    Ficam na `robo_config` da empresa — sempre aparecem. O "Som do aviso no computador" é de cada computador (no sino).
//  • "iFood · disputas e chat": o chat do iFood na tela; avisar o gerente da disputa e de novo perto do prazo. Ficam na
//    integração do iFood — só aparecem com o iFood conectado.
//  • "99Food · pedidos do cliente" (Onda 1): o que o Regem faz com o pedido de cancelamento e de reembolso do cliente.
//    Ficam na integração da 99 — só aparecem com a 99 conectada.
// Tudo mora só na NUVEM: no servidor da loja a tela só explica. Só gerente e presidente mudam (o servidor confere).

const HORAS_PADRAO = [1, 2, 4, 8, 12, 20];
const MINUTOS_PADRAO = [0, 2, 3, 5, 10];
const DE_NOVO_PADRAO = [1, 2, 3];
const DE_NOVO_CHEGUEI_PADRAO = [3, 5, 10];
/** As chaves do grupo "Fila e avisos", as do iFood e as do "Cheguei" (o resto é da 99). */
const DA_FILA = ['avisarGerenteMin', 'dizerPosicao'];
const DO_IFOOD: Record<string, string> = { ifoodChat: 'chat', ifoodAvisarDisputa: 'avisarDisputa', ifoodAvisarDeNovoMin: 'avisarDeNovoMin' };
const DO_CHEGUEI: Record<string, string> = {
  chegueiAtivo: 'ativo',
  chegueiPerguntarOnde: 'perguntarOnde',
  chegueiTodasTelas: 'todasTelas',
  chegueiDeNovoMin: 'deNovoMin',
};

type Resposta = {
  conectado99: boolean;
  ajuste99: { decidirCancelamento: boolean; reembolsoRecusarEmHoras: number; reembolsoMotivo: string; reembolsoExplicacao: string } | null;
  horasPermitidas?: number[];
  fila?: { avisarGerenteMin: number; dizerPosicao: boolean };
  minutosDoAviso?: number[];
  conectadoIfood?: boolean;
  ajusteIfood?: { chat: boolean; avisarDisputa: boolean; avisarDeNovoMin: number } | null;
  minutosDeNovo?: number[];
  cheguei?: { ativo: boolean; perguntarOnde: boolean; todasTelas: boolean; deNovoMin: number; temCardapio: boolean };
  minutosDeNovoCheguei?: number[];
};

const paraValores = (r: Resposta): Valores => ({
  ...(r.cheguei?.temCardapio
    ? {
        chegueiAtivo: r.cheguei.ativo,
        chegueiPerguntarOnde: r.cheguei.perguntarOnde,
        chegueiTodasTelas: r.cheguei.todasTelas ? 'sim' : 'nao',
        chegueiDeNovoMin: String(r.cheguei.deNovoMin),
      }
    : {}),
  ...(r.fila ? { avisarGerenteMin: String(r.fila.avisarGerenteMin), dizerPosicao: r.fila.dizerPosicao } : {}),
  ...(r.ajusteIfood
    ? {
        ifoodChat: r.ajusteIfood.chat,
        ifoodAvisarDisputa: r.ajusteIfood.avisarDisputa,
        ifoodAvisarDeNovoMin: String(r.ajusteIfood.avisarDeNovoMin),
      }
    : {}),
  ...(r.ajuste99
    ? {
        decidirCancelamento: r.ajuste99.decidirCancelamento,
        reembolsoRecusarEmHoras: String(r.ajuste99.reembolsoRecusarEmHoras),
        reembolsoMotivo: r.ajuste99.reembolsoMotivo,
        reembolsoExplicacao: r.ajuste99.reembolsoExplicacao,
      }
    : {}),
});

export function AjustesDoAtendimento() {
  const [podeMudar, setPodeMudar] = useState<boolean | null>(null);
  const [estado, setEstado] = useState<'carregando' | 'pronto' | 'erro'>('carregando');
  const [resp, setResp] = useState<Resposta | null>(null);
  const [valores, setValores] = useState<Valores>({});
  const [salvos, setSalvos] = useState<Valores>({});
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState('');

  const ler = () => {
    setEstado('carregando');
    api
      .atendimentoAjustes()
      .then((r: Resposta) => {
        setResp(r);
        setValores(paraValores(r));
        setSalvos(paraValores(r));
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

  const horas = resp?.horasPermitidas?.length ? resp.horasPermitidas : HORAS_PADRAO;
  const minutos = resp?.minutosDoAviso?.length ? resp.minutosDoAviso : MINUTOS_PADRAO;
  const motivoSalvo = String(salvos.reembolsoMotivo ?? '');
  const opcoesMotivo = Object.entries(MOTIVO_REEMBOLSO_99).map(([v, rotulo]) => ({ v, rotulo }));
  if (motivoSalvo && !opcoesMotivo.some((o) => o.v.toLowerCase() === motivoSalvo.toLowerCase())) opcoesMotivo.push({ v: motivoSalvo, rotulo: motivoSalvo });

  const grupoDaFila: GrupoDeAjustes = {
    titulo: 'Fila e avisos',
    // O som é de cada computador (como o do pedido novo e o do KDS) — vale também com o servidor da loja.
    nota: 'O som do aviso é de cada computador: escolha no sino do topo da tela (Bipe curto, Campainha ou Sem som).',
    itens: [
      {
        id: 'avisarGerenteMin',
        rotulo: 'Avisar o gerente se ninguém pegar o caso em',
        tipo: 'selecao',
        opcoes: minutos.map((m) => ({ v: String(m), rotulo: m === 0 ? 'Não avisar' : `${m} min` })),
        ajuda:
          'O aviso vai para o app de atendimento de quem é gerente ou presidente. Vale para o caso que espera uma pessoa; disputa do iFood e pedido da 99 já chegam com o prazo da plataforma.',
        palavras: 'aviso gerente tempo minutos fila ninguém pegou',
      },
      {
        id: 'dizerPosicao',
        rotulo: 'Dizer ao cliente a posição na fila',
        tipo: 'chave',
        ajuda: 'No WhatsApp, o robô responde "Você é o 2º da fila". Nunca promete tempo. Só onde a loja pode escrever ao cliente.',
        palavras: 'posição fila robô whatsapp cliente',
      },
    ],
  };
  const grupoDa99: GrupoDeAjustes = {
    titulo: '99Food · pedidos do cliente',
    nota: 'Quem responde aos pedidos da 99 na tela Atendimento: gerente e presidente — no computador com a senha, no app com o PIN.',
    itens: [
      {
        id: 'decidirCancelamento',
        rotulo: 'Cancelamento pedido pelo cliente: decidir na fila',
        tipo: 'chave',
        ajuda: valores.decidirCancelamento
          ? 'Ligado (padrão): o pedido vira caso na fila; se ninguém responder em 5 min, a 99 recusa sozinha (regra da 99).'
          : 'Desligado: o Regem aceita o cancelamento na hora e o caso aparece em "Resolvidos hoje".',
        palavras: '99 cancelamento fila',
      },
      {
        id: 'reembolsoRecusarEmHoras',
        rotulo: 'Reembolso pedido pelo cliente: o Regem recusa se ninguém responder em',
        tipo: 'selecao',
        opcoes: horas.map((h) => ({ v: String(h), rotulo: `${h} h` })),
        ajuda: 'O pedido vira caso na fila, com as fotos do cliente. Sem o Regem, a 99 reembolsa sozinha em 24 h.',
        palavras: '99 reembolso tempo horas',
      },
      {
        id: 'reembolsoMotivo',
        rotulo: 'Motivo da recusa automática do reembolso',
        tipo: 'selecao',
        opcoes: opcoesMotivo,
        ajuda: 'Da lista da 99. Se o motivo não vier na lista do pedido, vai "Outro".',
        palavras: '99 reembolso motivo',
      },
      {
        id: 'reembolsoExplicacao',
        rotulo: 'Explicação que a 99 recebe',
        tipo: 'texto',
        opcional: true,
        maximo: 200,
        ajuda: 'Vai junto com o motivo da recusa automática.',
        palavras: '99 reembolso explicação texto',
      },
    ],
  };
  const deNovo = resp?.minutosDeNovo?.length ? resp.minutosDeNovo : DE_NOVO_PADRAO;
  const grupoDoIfood: GrupoDeAjustes = {
    titulo: 'iFood · disputas e chat',
    nota: 'Quem responde à disputa: gerente e presidente — no computador com a senha de quem decide, no app com o PIN.',
    itens: [
      {
        id: 'ifoodChat',
        rotulo: 'Chat do iFood na tela Atendimento',
        tipo: 'chave',
        ajuda: 'Mostra o botão "Chat do iFood" (o chat oficial do iFood). Cada computador autoriza uma vez, com um usuário "Dono" ou "Administrador" do iFood.',
        palavras: 'ifood chat widget conversa',
      },
      {
        id: 'ifoodAvisarDisputa',
        rotulo: 'Avisar o gerente quando chega uma disputa',
        tipo: 'chave',
        ajuda: 'No app de atendimento e no computador de quem é gerente ou presidente, na hora. Disputa sem resposta segue o que o iFood decidir sozinho.',
        palavras: 'ifood disputa aviso gerente',
      },
      {
        id: 'ifoodAvisarDeNovoMin',
        rotulo: 'Avisar de novo quando faltarem',
        tipo: 'selecao',
        opcoes: deNovo.map((m) => ({ v: String(m), rotulo: `${m} min` })),
        ajuda: 'Segundo aviso, se ninguém respondeu.',
        palavras: 'ifood disputa aviso de novo minutos prazo',
      },
    ],
  };
  const deNovoCheguei = resp?.minutosDeNovoCheguei?.length ? resp.minutosDeNovoCheguei : DE_NOVO_CHEGUEI_PADRAO;
  const grupoDoCheguei: GrupoDeAjustes = {
    titulo: 'Retirada · cliente chegou',
    nota: 'Vale para a loja em uso. O som do aviso é o que cada computador escolheu no sino do topo da tela.',
    itens: [
      {
        id: 'chegueiAtivo',
        rotulo: 'Botão "Cheguei" para quem retira',
        tipo: 'chave',
        ajuda:
          'Aparece na página do pedido, em Sua conta › Pedidos e no aviso de pronto do WhatsApp; o Regem também entende "cheguei" escrito. Só em pedido de retirada, no dia. A equipe vê em PDV · Balcão › Retirada / Encomendas.',
        palavras: 'cheguei retirada cliente chegou balcão porta',
      },
      {
        id: 'chegueiPerguntarOnde',
        rotulo: 'Perguntar onde o cliente está',
        tipo: 'chave',
        ajuda: 'No cardápio: no balcão ou na porta (moto ou carro), com "Como te achar?". No WhatsApp não pergunta: o que o cliente escrever vai junto.',
        palavras: 'cheguei onde balcão porta carro moto',
      },
      {
        id: 'chegueiTodasTelas',
        rotulo: 'Onde a equipe é avisada',
        tipo: 'selecao',
        opcoes: [
          { v: 'sim', rotulo: 'Na Retirada, no KDS e em qualquer tela do Regem' },
          { v: 'nao', rotulo: 'Só na Retirada e no KDS' },
        ],
        ajuda: 'O aviso em qualquer tela toca o som do sino de cada computador.',
        palavras: 'cheguei aviso telas kds retirada som',
      },
      {
        id: 'chegueiDeNovoMin',
        rotulo: 'Avisar de novo se ninguém entregar em',
        tipo: 'selecao',
        opcoes: deNovoCheguei.map((m) => ({ v: String(m), rotulo: `${m} min` })),
        ajuda: 'Uma vez, com o tempo de espera. O cliente também pode avisar de novo depois desse tempo.',
        palavras: 'cheguei avisar de novo minutos espera',
      },
    ],
  };
  const grupos: GrupoDeAjustes[] = [
    ...(resp?.cheguei?.temCardapio ? [grupoDoCheguei] : []),
    grupoDaFila,
    ...(resp?.conectadoIfood ? [grupoDoIfood] : []),
    ...(resp?.conectado99 ? [grupoDa99] : []),
  ];

  async function salvar() {
    const chaves = alterados(grupos, valores, salvos);
    if (!chaves.length || salvando) return;
    setSalvando(true);
    setErro('');
    // Cada grupo vai com o seu dono (a fila na configuração do robô, o iFood e a 99 nas integrações) — só o que mudou.
    const fila: Record<string, unknown> = {};
    const ifood: Record<string, unknown> = {};
    const ajuste99: Record<string, unknown> = {};
    const cheguei: Record<string, unknown> = {};
    for (const k of chaves) {
      if (DA_FILA.includes(k)) fila[k] = k === 'avisarGerenteMin' ? Number(valores[k]) : valores[k];
      else if (DO_IFOOD[k]) ifood[DO_IFOOD[k]] = k === 'ifoodAvisarDeNovoMin' ? Number(valores[k]) : valores[k];
      else if (DO_CHEGUEI[k])
        cheguei[DO_CHEGUEI[k]] =
          k === 'chegueiDeNovoMin' ? Number(valores[k]) : k === 'chegueiTodasTelas' ? valores[k] === 'sim' : valores[k];
      else ajuste99[k] = k === 'reembolsoRecusarEmHoras' ? Number(valores[k]) : valores[k];
    }
    try {
      const r: Resposta = await api.salvarAtendimentoAjustes({
        ...(Object.keys(fila).length ? { fila } : {}),
        ...(Object.keys(ifood).length ? { ifood } : {}),
        ...(Object.keys(ajuste99).length ? { ajuste99 } : {}),
        ...(Object.keys(cheguei).length ? { cheguei } : {}),
      });
      setResp(r);
      setValores(paraValores(r));
      setSalvos(paraValores(r));
      toast.success('Ajustes do atendimento salvos.');
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'tente de novo');
    } finally {
      setSalvando(false);
    }
  }

  const cabecalho = (texto: React.ReactNode) => (
    <section className="space-y-3" aria-labelledby="atend-ajustes-titulo">
      <h2 id="atend-ajustes-titulo" className="font-display text-xl font-bold">
        Atendimento
      </h2>
      {texto}
    </section>
  );

  if (NO_SERVIDOR_DA_LOJA) return cabecalho(<SoPelaNuvem />);
  if (podeMudar === null) return cabecalho(<p className={`text-sm ${texto2}`}>Carregando…</p>);
  if (!podeMudar) return cabecalho(<p className={`text-sm ${texto2}`}>Só gerente e presidente veem e mudam os ajustes do atendimento.</p>);
  if (estado === 'carregando') return cabecalho(<p className={`text-sm ${texto2}`} role="status">Carregando os ajustes…</p>);
  if (estado === 'erro')
    return cabecalho(
      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm" role="alert">
        <span>Não foi possível ler os ajustes do atendimento.</span>
        <Button type="button" size="sm" variant="outline" onClick={ler}>
          Tentar de novo
        </Button>
      </div>,
    );

  return (
    <div className="space-y-3">
      <Ajustes
        id="atend-ajustes"
        titulo="Atendimento"
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
      />
      {resp?.cheguei && !resp.cheguei.temCardapio && (
        <p className={`rounded-lg border border-border px-4 py-3 text-sm ${texto2}`}>
          A loja em uso ainda não tem cardápio online. O &quot;Cheguei&quot; da retirada aparece aqui depois de criar o cardápio em
          Delivery › Configurações › Cardápio.
        </p>
      )}
      {!resp?.conectado99 && (
        <p className={`rounded-lg border border-border px-4 py-3 text-sm ${texto2}`}>
          A 99 não está conectada nesta empresa. Os ajustes dos pedidos do cliente da 99 aparecem aqui depois de conectar em Delivery ›
          Configurações › Integrações.
        </p>
      )}
    </div>
  );
}
