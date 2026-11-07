'use client';

import { useEffect, useState } from 'react';
import { api, getCategoria } from '@/lib/api';
import { toast } from '@/lib/toast';
import { Button } from '@/components/ui/button';
import { Ajustes, alterados, type GrupoDeAjustes, type Valor, type Valores } from '@/components/ui/ajustes';
import { NO_SERVIDOR_DA_LOJA, SoPelaNuvem } from '@/components/ui/so-pela-nuvem';
import { texto2 } from '@/components/ui/lista';
import { MOTIVO_REEMBOLSO_99 } from '@/components/atendimento/pedido-99';
import { QuemRecebeNoWhatsapp, type GrupoDoWhatsapp } from '@/components/atendimento/whatsapp-do-gestor';

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
//  • "Pedido repetido" (mig 360; `mockups/regem-alteracao-pedido.html`): perguntar quando o mesmo cliente faz um pedido
//    igual e a janela (30 min de padrão). No `cardapio_config` da loja em uso, como o "Cheguei" — no fim da tela.
//  • "Pedido alterado" (mig 362; mesmo protótipo): "O robô faz mudanças simples" (mig 363 — `robo_config.muda_pedido`, da
//    EMPRESA: o robô é um só) e o som do KDS até a cozinha tocar em "Visto" (a cada 1 min de padrão — no ajuste do KDS da
//    loja em uso, `kds_cor_config`, sincroniza).
//  • "iFood e 99 · chat pela ponte" (mig 366, parte A2; protótipo v3): ligar a ponte, onde ela roda (automático ou a
//    principal e a reserva — das pontes da loja em uso) e os três avisos no chat com o texto de cada um. Liga/desliga e
//    textos na `robo_config` da empresa; o papel, em `chat_ponte`. Só aparece com o iFood ou a 99 conectados.
//  • "Gerente no WhatsApp" (mig 375, parte 5a; protótipo v4): os avisos ao WhatsApp de cada gestor (a decisão com prazo e
//    o caso que ninguém pegou, com o link) e quem recebe — cada um liga o próprio número. Na `robo_config` da empresa.
// Tudo mora só na NUVEM: no servidor da loja a tela só explica. Só gerente e presidente mudam (o servidor confere).

const HORAS_PADRAO = [1, 2, 4, 8, 12, 20];
const MINUTOS_PADRAO = [0, 2, 3, 5, 10];
const DE_NOVO_PADRAO = [1, 2, 3];
const DE_NOVO_CHEGUEI_PADRAO = [3, 5, 10];
/** As chaves do grupo "Fila e avisos", as do iFood e as do "Cheguei" (o resto é da 99). */
const DA_FILA = ['avisarGerenteMin', 'dizerPosicao'];
const DO_IFOOD: Record<string, string> = {
  ifoodChat: 'chat',
  ifoodAvisarDisputa: 'avisarDisputa',
  ifoodAvisarDeNovoMin: 'avisarDeNovoMin',
  ifoodAvaliacoes: 'avaliacoes', // as avaliações do iFood na fila (06/11/2026)
};
const DO_CHEGUEI: Record<string, string> = {
  chegueiAtivo: 'ativo',
  chegueiPerguntarOnde: 'perguntarOnde',
  chegueiTodasTelas: 'todasTelas',
  chegueiDeNovoMin: 'deNovoMin',
};
// Pedido igual em até 30 min (mig 360; protótipo `mockups/regem-alteracao-pedido.html`, vista "Ajustes").
const DO_REPETIDO: Record<string, string> = { repetidoAtivo: 'ativo', repetidoMin: 'minutos' };
const JANELAS_REPETIDO_PADRAO = [10, 15, 20, 30, 45, 60];
// Pedido alterado (mig 362): o som do KDS no pedido alterado.
const ROTULO_DO_SOM: Record<string, string> = {
  uma: 'Toca uma vez',
  '1min': 'Repete a cada 1 minuto até o Visto (padrão)',
  '2min': 'Repete a cada 2 minutos até o Visto',
};
// A ponte do chat (mig 366): a chave da tela → o aviso e o campo do servidor.
type MotivoDoAviso = 'saiu' | 'chegando' | 'obrigado';
const DO_AVISO_DA_PONTE: Record<string, [MotivoDoAviso, 'ligado' | 'texto']> = {
  ponteSaiu: ['saiu', 'ligado'],
  ponteSaiuTexto: ['saiu', 'texto'],
  ponteChegando: ['chegando', 'ligado'],
  ponteChegandoTexto: ['chegando', 'texto'],
  ponteObrigado: ['obrigado', 'ligado'],
  ponteObrigadoTexto: ['obrigado', 'texto'],
};
// Gerente no WhatsApp (mig 375): a chave da tela → o campo do servidor.
// "Aceitar pelo WhatsApp até" (parte 5b): centavos; "sem" = sem limite; "0" = não aceitar pelo WhatsApp.
const LIMITES_DO_GESTOR_WA = [
  { v: '0', rotulo: 'Não aceitar pelo WhatsApp' },
  { v: '3000', rotulo: 'R$ 30,00' },
  { v: '5000', rotulo: 'R$ 50,00' },
  { v: '10000', rotulo: 'R$ 100,00 (padrão)' },
  { v: '20000', rotulo: 'R$ 200,00' },
  { v: 'sem', rotulo: 'Sem limite' },
];
const DO_GESTOR_WA: Record<string, 'ligado' | 'decisoes' | 'ninguemPegou'> = {
  gestorWaLigado: 'ligado',
  gestorWaDecisoes: 'decisoes',
  gestorWaNinguemPegou: 'ninguemPegou',
};
/** O papel dos PCs vai junto (onde + principal + reserva): a escolha é uma só, e o servidor confere as três. */
const DO_PAPEL_DA_PONTE = ['ponteOnde', 'pontePrincipal', 'ponteReserva'];
type PonteDaLoja = { id: string; nome: string; maquina: string | null; vistoEm: string | null; viva: boolean; pausadaEm?: string | null; logado: { ifood: boolean; '99food': boolean } };
type AjusteDaPonte = {
  ligada: boolean;
  /** O robô responde no chat (ponte do chat, Etapa 3) — nasce desligado. */
  roboResponde?: boolean;
  avisos: Record<MotivoDoAviso, { ligado: boolean; texto: string | null }>;
  padroes: Record<MotivoDoAviso, string>;
  onde: 'auto' | 'escolher';
  principalId: string | null;
  reservaId: string | null;
  pontes: PonteDaLoja[];
};

type Resposta = {
  conectado99: boolean;
  ajuste99: { decidirCancelamento: boolean; reembolsoRecusarEmHoras: number; reembolsoMotivo: string; reembolsoExplicacao: string } | null;
  horasPermitidas?: number[];
  fila?: { avisarGerenteMin: number; dizerPosicao: boolean };
  minutosDoAviso?: number[];
  conectadoIfood?: boolean;
  ajusteIfood?: { chat: boolean; avisarDisputa: boolean; avisarDeNovoMin: number; avaliacoes?: boolean } | null;
  minutosDeNovo?: number[];
  cheguei?: { ativo: boolean; perguntarOnde: boolean; todasTelas: boolean; deNovoMin: number; temCardapio: boolean };
  minutosDeNovoCheguei?: number[];
  repetido?: { ativo: boolean; minutos: number; temCardapio: boolean; janelas?: number[] };
  alterado?: { som: string; sons?: string[]; roboMuda?: boolean; roboCobraPix?: boolean };
  ponte?: AjusteDaPonte | null;
  gestorWa?: GrupoDoWhatsapp | null;
  // O copiloto (mig 376): ligado na empresa; disponível = a distribuição ligou o modelo.
  copiloto?: { ligado: boolean; disponivel: boolean } | null;
};

const paraValores = (r: Resposta): Valores => ({
  ...(r.copiloto ? { copilotoLigado: r.copiloto.ligado } : {}),
  ...(r.gestorWa
    ? {
        gestorWaLigado: r.gestorWa.ligado,
        gestorWaDecisoes: r.gestorWa.decisoes,
        gestorWaNinguemPegou: r.gestorWa.ninguemPegou,
        gestorWaLimite: r.gestorWa.limiteCentavos === null ? 'sem' : String(r.gestorWa.limiteCentavos ?? 10000),
      }
    : {}),
  ...(r.ponte
    ? {
        ponteLigada: r.ponte.ligada,
        ponteOnde: r.ponte.onde,
        pontePrincipal: r.ponte.principalId ?? '',
        ponteReserva: r.ponte.reservaId ?? '',
        ponteSaiu: r.ponte.avisos.saiu.ligado,
        ponteSaiuTexto: r.ponte.avisos.saiu.texto ?? '',
        ponteChegando: r.ponte.avisos.chegando.ligado,
        ponteChegandoTexto: r.ponte.avisos.chegando.texto ?? '',
        ponteObrigado: r.ponte.avisos.obrigado.ligado,
        ponteObrigadoTexto: r.ponte.avisos.obrigado.texto ?? '',
        ponteRobo: r.ponte.roboResponde === true,
      }
    : {}),
  ...(r.repetido?.temCardapio ? { repetidoAtivo: r.repetido.ativo, repetidoMin: String(r.repetido.minutos) } : {}),
  ...(r.alterado ? { alteradoSom: r.alterado.som } : {}),
  ...(typeof r.alterado?.roboMuda === 'boolean' ? { alteradoRobo: r.alterado.roboMuda } : {}),
  ...(typeof r.alterado?.roboCobraPix === 'boolean' ? { alteradoRoboPix: r.alterado.roboCobraPix } : {}),
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
        ...(typeof r.ajusteIfood.avaliacoes === 'boolean' ? { ifoodAvaliacoes: r.ajusteIfood.avaliacoes } : {}),
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
        rotulo: 'Chat oficial do iFood na tela Atendimento',
        tipo: 'chave',
        ajuda: 'Mostra o botão "Chat oficial do iFood" (a tela de chat do próprio iFood). Cada computador autoriza uma vez, com um usuário "Dono" ou "Administrador" do iFood.',
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
      // As avaliações do iFood na fila (06/11/2026; protótipo da Central): nasce desligado.
      ...(typeof resp?.ajusteIfood?.avaliacoes === 'boolean'
        ? [
            {
              id: 'ifoodAvaliacoes',
              rotulo: 'Avaliações do iFood na fila',
              tipo: 'chave' as const,
              ajuda:
                'A avaliação com comentário ou nota até 3 vira caso (nota até 2, urgente), para responder pelo Regem. A resposta fica pública no iFood. Precisa do módulo de avaliações liberado no iFood.',
              palavras: 'ifood avaliação avaliacoes nota comentário estrelas review responder',
            },
          ]
        : []),
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
  // O valor gravado entra na lista mesmo fora das janelas oferecidas (nunca some da tela).
  const janelasRepetido = [
    ...new Set([...(resp?.repetido?.janelas?.length ? resp.repetido.janelas : JANELAS_REPETIDO_PADRAO), ...(resp?.repetido ? [resp.repetido.minutos] : [])]),
  ].sort((a, b) => a - b);
  const grupoDoRepetido: GrupoDeAjustes = {
    titulo: 'Pedido repetido',
    nota: 'Vale para a loja em uso. Nada vai para a cozinha antes de o cliente responder (cardápio e robô).',
    itens: [
      {
        id: 'repetidoAtivo',
        rotulo: 'Perguntar quando o mesmo cliente faz um pedido igual',
        tipo: 'chave',
        ajuda:
          'No cardápio online e no robô do WhatsApp, o cliente responde antes de o pedido entrar. Nos pedidos do Anota AI, iFood, 99 e Cardápio Web, o pedido entra com o aviso "Possível repetido" no painel, no KDS e na via, até alguém tocar em "São dois pedidos".',
        palavras: 'pedido repetido igual duplicado mesmo cliente perguntar',
      },
      {
        id: 'repetidoMin',
        rotulo: 'Igual dentro de',
        tipo: 'selecao',
        opcoes: janelasRepetido.map((m) => ({ v: String(m), rotulo: m === 30 ? '30 minutos (padrão)' : `${m} minutos` })),
        ajuda:
          'Contado do primeiro pedido. Mesmos produtos, tamanhos, adicionais e quantidades; a observação, o endereço e o pagamento não contam. Pedido cancelado não conta.',
        palavras: 'pedido repetido igual minutos janela tempo',
      },
    ],
  };
  const sonsDoAlterado = resp?.alterado?.sons?.length ? resp.alterado.sons : Object.keys(ROTULO_DO_SOM);
  const grupoDoAlterado: GrupoDeAjustes = {
    titulo: 'Pedido alterado',
    nota: 'O som vale para a loja em uso; o robô, para todas as lojas da empresa. A via "PEDIDO ALTERADO" sai nas impressoras que já imprimiram o pedido.',
    itens: [
      ...(typeof resp?.alterado?.roboMuda === 'boolean'
        ? [
            {
              id: 'alteradoRobo',
              rotulo: 'O robô faz mudanças simples',
              tipo: 'chave' as const,
              ajuda:
                'Pôr, tirar ou trocar um produto (uma vez por pedido) e mudar o endereço, com o pedido em produção e pago na entrega. Depois que o pedido sai, a mudança de endereço vai para a equipe avisar o entregador; o resto também vai para a equipe (Atendimento › Mudança no pedido).',
              palavras: 'robô whatsapp mudança pedido pôr tirar trocar produto alterar endereço entregador',
            },
          ]
        : []),
      ...(typeof resp?.alterado?.roboCobraPix === 'boolean'
        ? [
            {
              id: 'alteradoRoboPix',
              rotulo: 'O robô cobra no Pix o item posto em pedido já pago',
              tipo: 'chave' as const,
              ajuda:
                'Pedido do cardápio já pago no Pix e ainda em produção: o robô põe o item e manda ao cliente um Pix só da diferença, que vale 5 minutos. A Central recebe o aviso "segure o pedido" até o pagamento cair; pago, o item entra com a via "PEDIDO ALTERADO". Sem pagar, o pedido segue como estava. Precisa de "O robô faz mudanças simples" ligado.',
              palavras: 'robô whatsapp pix adicional item pago diferença cobrar pagamento segurar pedido',
            },
          ]
        : []),
      {
        id: 'alteradoSom',
        rotulo: 'Som do KDS no pedido alterado',
        tipo: 'selecao',
        opcoes: sonsDoAlterado.map((s) => ({ v: s, rotulo: ROTULO_DO_SOM[s] ?? s })),
        ajuda: 'O aviso grande "PEDIDO ALTERADO" fica no cartão até alguém da cozinha tocar em Visto.',
        palavras: 'pedido alterado mudança som kds visto cozinha aviso',
      },
    ],
  };
  // A ponte do chat (mig 366): as pontes da loja em uso; "Escolher os PCs" só com alguma cadastrada.
  const pontes = resp?.ponte?.pontes ?? [];
  const padroes = resp?.ponte?.padroes;
  const escolher = valores.ponteOnde === 'escolher';
  const principalAtual = String(valores.pontePrincipal ?? '');
  const rotuloDaPonte = (p: PonteDaLoja) => `${p.nome}${!p.viva ? ' · sem sinal agora' : p.pausadaEm ? ' · pausada no PC' : ''}`;
  const grupoDaPonte: GrupoDeAjustes = {
    titulo: 'iFood e 99 · chat pela ponte',
    nota: 'Sempre vale, não se desliga (protege a conta da loja na plataforma): nunca telefone, WhatsApp, Instagram nem link no chat · no máximo 3 avisos por pedido · a conversa não entra em campanha.',
    itens: [
      {
        id: 'ponteLigada',
        rotulo: 'Ponte do chat',
        tipo: 'chave',
        ajuda:
          'O programa Regem · Ponte do chat, no PC da loja, fica com o iFood e a 99 abertos e manda os avisos abaixo pelo chat de cada plataforma. Desligada, nada sai pelo chat do iFood nem da 99.',
        palavras: 'ponte chat ifood 99 programa pc ligar',
      },
      {
        id: 'ponteOnde',
        rotulo: 'Onde a ponte roda',
        tipo: 'selecao',
        opcoes: [{ v: 'auto', rotulo: 'Automático (recomendado)' }, ...(pontes.length || escolher ? [{ v: 'escolher', rotulo: 'Escolher os PCs' }] : [])],
        ajuda: pontes.length
          ? 'Automático: o Regem usa os PCs onde a ponte está aberta e logada. No iFood, a principal manda as mensagens; a reserva assume sozinha se a principal ficar 2 min sem sinal. A 99 aceita um login só: ela fica na ponte do PC onde a loja usa a 99, sem reserva. Vale para a loja em uso; cada PC aparece em Configurações › Equipamentos.'
          : 'Nenhum PC está cadastrado como ponte nesta loja: cadastre e pareie o PC em Configurações › Equipamentos, como "Ponte do chat".',
        palavras: 'ponte onde pc principal reserva automático escolher',
      },
      ...(escolher
        ? [
            {
              id: 'pontePrincipal',
              rotulo: 'PC principal',
              tipo: 'selecao' as const,
              opcoes: [...(principalAtual ? [] : [{ v: '', rotulo: 'Escolha o PC' }]), ...pontes.map((p) => ({ v: p.id, rotulo: rotuloDaPonte(p) }))],
              ajuda: 'Onde o iFood e a 99 ficam abertos no dia a dia.',
              palavras: 'ponte pc principal',
            },
            {
              id: 'ponteReserva',
              rotulo: 'PC de reserva (iFood)',
              tipo: 'selecao' as const,
              opcoes: [{ v: '', rotulo: 'Nenhum' }, ...pontes.filter((p) => p.id !== principalAtual).map((p) => ({ v: p.id, rotulo: rotuloDaPonte(p) }))],
              ajuda: 'Assume o chat do iFood quando a principal desliga, por exemplo o PC do delivery à noite. A 99 não tem reserva: ela aceita um login só.',
              palavras: 'ponte pc reserva ifood',
            },
          ]
        : []),
      {
        id: 'ponteSaiu',
        rotulo: 'Aviso "saiu para entrega" no chat',
        tipo: 'chave',
        ajuda: 'Sai quando o Regem despacha o pedido de entrega da loja, com a previsão do rastreio. Quando o entregador é do iFood ou da 99, quem avisa é a plataforma.',
        palavras: 'aviso saiu entrega despacho chat ifood 99',
      },
      {
        id: 'ponteSaiuTexto',
        rotulo: 'Texto do "saiu para entrega"',
        tipo: 'texto',
        opcional: true,
        maximo: 300,
        placeholder: padroes?.saiu,
        ajuda: 'Em branco, vai o texto padrão (o que aparece apagado no campo). {hora} vira a previsão — sem previsão, essa frase fica de fora; {nome}, o primeiro nome do cliente.',
        palavras: 'texto aviso saiu entrega',
      },
      {
        id: 'ponteChegando',
        rotulo: 'Aviso "o entregador está chegando" no chat',
        tipo: 'chave',
        ajuda:
          'Sai quando o entregador da loja chega perto da posição que o iFood e a 99 mandam no pedido (o raio de chegada do app do entregador, 70 m de padrão) ou toca em "estou chegando". Só em entrega da loja.',
        palavras: 'aviso chegando entregador chegou porta chat',
      },
      {
        id: 'ponteChegandoTexto',
        rotulo: 'Texto do "o entregador está chegando"',
        tipo: 'texto',
        opcional: true,
        maximo: 300,
        placeholder: padroes?.chegando,
        ajuda: 'Em branco, vai o texto padrão. {nome} vira o primeiro nome do cliente.',
        palavras: 'texto aviso chegando entregador',
      },
      {
        id: 'ponteObrigado',
        rotulo: 'Agradecer depois da entrega',
        tipo: 'chave',
        ajuda: 'Sai quando o pedido é entregue (ou concluído na plataforma). Só o agradecimento: a avaliação do iFood e da 99 é pedida pela própria plataforma.',
        palavras: 'agradecer obrigado entrega chat',
      },
      {
        id: 'ponteObrigadoTexto',
        rotulo: 'Texto do agradecimento',
        tipo: 'texto',
        opcional: true,
        maximo: 300,
        placeholder: padroes?.obrigado,
        ajuda: 'Em branco, vai o texto padrão. {nome} vira o primeiro nome do cliente.',
        palavras: 'texto agradecimento obrigado',
      },
      {
        id: 'ponteRobo',
        rotulo: 'Robô responde no chat',
        tipo: 'chave',
        ajuda:
          'O robô responde o "cadê meu pedido?" com o dado do pedido (em preparo, saiu às tantas, a previsão), no máximo 2 vezes por pedido por hora. Qualquer outra mensagem vira caso na fila do Atendimento, e o robô avisa o cliente que chamou a equipe. Com o caso aberto, ele fica quieto.',
        palavras: 'robo robô responder automatico chat ifood 99 cade pedido previsao',
      },
    ],
  };
  // Gerente no WhatsApp (mig 375): os avisos (5a) e a decisão por botão, com o limite do que devolve dinheiro (5b).
  const grupoDoGestor: GrupoDeAjustes | null = resp?.gestorWa
    ? {
        titulo: 'Gerente no WhatsApp',
        nota: 'Sempre vale: a resposta só vale do número ligado, de quem ainda é gerente ou presidente, com acesso · confirmação em dois toques · uma resposta por caso · fica no caso como "pelo WhatsApp" · o que o gestor responde aos avisos não vai ao robô nem vira conversa de cliente · PARAR AVISOS no WhatsApp para os avisos, VOLTAR AVISOS religa.',
        itens: [
          {
            id: 'gestorWaLigado',
            rotulo: 'Avisar e decidir pelo WhatsApp',
            tipo: 'chave',
            ajuda:
              'O WhatsApp da loja manda ao WhatsApp de cada gestor ligado abaixo o que pede uma decisão, com os botões para responder ali mesmo, e o caso que ninguém pegou. Desligado, o aviso fica só no Regem e no app de atendimento.',
            palavras: 'gerente whatsapp aviso decidir botão celular presidente decisão',
          },
          {
            id: 'gestorWaDecisoes',
            rotulo: 'Decisões com prazo',
            tipo: 'chave',
            ajuda:
              'Disputa do iFood, cancelamento e reembolso pedidos na 99 e cancelamento pedido no cardápio online, com os botões (na conexão por QR code, uma enquete). A primeira resposta vale; quem tocar depois fica sabendo quem já respondeu. A proposta da disputa (crédito, outro valor, mais tempo) fica no Regem.',
            palavras: 'gerente whatsapp disputa ifood 99 cancelamento reembolso prazo botões enquete',
          },
          {
            id: 'gestorWaNinguemPegou',
            rotulo: 'Caso que ninguém pegou',
            tipo: 'chave',
            ajuda: 'No tempo de "Avisar o gerente se ninguém pegar o caso em", do grupo Fila e avisos. Vai só o aviso, com o link do caso; não sai se alguém pegar antes.',
            palavras: 'gerente whatsapp ninguém pegou fila espera',
          },
          {
            id: 'gestorWaLimite',
            rotulo: 'Aceitar pelo WhatsApp até',
            tipo: 'selecao',
            opcoes: LIMITES_DO_GESTOR_WA,
            ajuda:
              'Vale para o que devolve dinheiro: aceitar a disputa, o cancelamento ou o reembolso. Acima disso, a mensagem traz só "Recusar" e o link para aceitar no Regem com a senha. Recusar não tem limite.',
            palavras: 'gerente whatsapp limite valor aceitar reembolso dinheiro',
          },
        ],
        depois: (
          <QuemRecebeNoWhatsapp
            grupo={resp.gestorWa}
            // Só a lista muda (ligar/desligar alguém): o que está na tela e ainda não foi salvo fica como está.
            aoMudar={(g) => setResp((r) => (r ? { ...r, gestorWa: g } : r))}
          />
        ),
      }
    : null;
  // O copiloto (mig 376; protótipo v5): a sugestão de resposta no caso; nasce desligado.
  const grupoDoCopiloto: GrupoDeAjustes | null = resp?.copiloto
    ? {
        titulo: 'Copiloto',
        nota: resp.copiloto.disponivel
          ? 'Sempre vale: ao modelo vai só o primeiro nome do cliente, a conversa e o pedido — nunca telefone, endereço nem pagamento · a sugestão nunca é enviada sozinha · cada sugestão pedida fica no histórico do caso.'
          : 'O copiloto ainda não está disponível: a distribuição Regem liga o modelo de IA. Você pode deixar ligado; o botão aparece quando ele estiver pronto.',
        itens: [
          {
            id: 'copilotoLigado',
            rotulo: 'Sugerir resposta no caso',
            tipo: 'chave',
            ajuda:
              'O botão "✨ Sugerir resposta" escreve uma sugestão com a conversa, o pedido (situação, horários, entregador) e as respostas prontas. Nada sai sozinho: a pessoa confere, muda e envia. No chat do iFood e da 99, a sugestão segue as regras da plataforma.',
            palavras: 'copiloto sugestão resposta ia inteligência artificial sugerir atendimento',
          },
        ],
      }
    : null;
  const grupos: GrupoDeAjustes[] = [
    ...(resp?.cheguei?.temCardapio ? [grupoDoCheguei] : []),
    grupoDaFila,
    ...(grupoDoGestor ? [grupoDoGestor] : []),
    ...(grupoDoCopiloto ? [grupoDoCopiloto] : []),
    ...(resp?.ponte && (resp.conectadoIfood || resp.conectado99) ? [grupoDaPonte] : []),
    ...(resp?.conectadoIfood ? [grupoDoIfood] : []),
    ...(resp?.conectado99 ? [grupoDa99] : []),
    ...(resp?.repetido?.temCardapio ? [grupoDoRepetido] : []),
    ...(resp?.alterado ? [grupoDoAlterado] : []),
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
    const repetido: Record<string, unknown> = {};
    let alterado: { som?: string; roboMuda?: boolean; roboCobraPix?: boolean } | null = null;
    const gestorWa: Record<string, boolean | number | null> = {};
    let copiloto: { ligado: boolean } | null = null;
    const ponte: {
      ligada?: boolean;
      roboResponde?: boolean;
      onde?: string;
      principalId?: string | null;
      reservaId?: string | null;
      avisos?: Partial<Record<MotivoDoAviso, { ligado?: boolean; texto?: string | null }>>;
    } = {};
    // O papel dos PCs vai inteiro quando qualquer parte mudou (a escolha é uma só; o servidor confere as três juntas).
    if (chaves.some((k) => DO_PAPEL_DA_PONTE.includes(k))) {
      ponte.onde = String(valores.ponteOnde);
      if (ponte.onde === 'escolher') {
        ponte.principalId = String(valores.pontePrincipal ?? '') || null;
        ponte.reservaId = String(valores.ponteReserva ?? '') || null;
      }
    }
    for (const k of chaves) {
      if (DO_PAPEL_DA_PONTE.includes(k)) continue;
      if (k === 'ponteLigada') {
        ponte.ligada = valores[k] === true;
        continue;
      }
      if (k === 'ponteRobo') {
        ponte.roboResponde = valores[k] === true;
        continue;
      }
      if (DO_AVISO_DA_PONTE[k]) {
        const [m, campo] = DO_AVISO_DA_PONTE[k];
        const avisos = (ponte.avisos ??= {});
        avisos[m] = { ...avisos[m], [campo]: campo === 'ligado' ? valores[k] === true : String(valores[k] ?? '').trim() || null };
        continue;
      }
      if (DO_GESTOR_WA[k]) {
        gestorWa[DO_GESTOR_WA[k]] = valores[k] === true;
        continue;
      }
      if (k === 'gestorWaLimite') {
        gestorWa.limiteCentavos = valores[k] === 'sem' ? null : Number(valores[k]);
        continue;
      }
      if (k === 'copilotoLigado') {
        copiloto = { ligado: valores[k] === true };
        continue;
      }
      if (k === 'alteradoSom') {
        alterado = { ...(alterado ?? {}), som: String(valores[k]) };
        continue;
      }
      if (k === 'alteradoRobo') {
        alterado = { ...(alterado ?? {}), roboMuda: valores[k] === true };
        continue;
      }
      if (k === 'alteradoRoboPix') {
        alterado = { ...(alterado ?? {}), roboCobraPix: valores[k] === true };
        continue;
      }
      if (DA_FILA.includes(k)) fila[k] = k === 'avisarGerenteMin' ? Number(valores[k]) : valores[k];
      else if (DO_IFOOD[k]) ifood[DO_IFOOD[k]] = k === 'ifoodAvisarDeNovoMin' ? Number(valores[k]) : valores[k];
      else if (DO_CHEGUEI[k])
        cheguei[DO_CHEGUEI[k]] =
          k === 'chegueiDeNovoMin' ? Number(valores[k]) : k === 'chegueiTodasTelas' ? valores[k] === 'sim' : valores[k];
      else if (DO_REPETIDO[k]) repetido[DO_REPETIDO[k]] = k === 'repetidoMin' ? Number(valores[k]) : valores[k];
      else ajuste99[k] = k === 'reembolsoRecusarEmHoras' ? Number(valores[k]) : valores[k];
    }
    try {
      const r: Resposta = await api.salvarAtendimentoAjustes({
        ...(Object.keys(fila).length ? { fila } : {}),
        ...(Object.keys(ifood).length ? { ifood } : {}),
        ...(Object.keys(ajuste99).length ? { ajuste99 } : {}),
        ...(Object.keys(cheguei).length ? { cheguei } : {}),
        ...(Object.keys(repetido).length ? { repetido } : {}),
        ...(alterado ? { alterado } : {}),
        ...(Object.keys(ponte).length ? { ponte } : {}),
        ...(Object.keys(gestorWa).length ? { gestorWa } : {}),
        ...(copiloto ? { copiloto } : {}),
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
        aoMudar={(k: string, v: Valor) =>
          setValores((s) => {
            const n = { ...s, [k]: v };
            // "Escolher os PCs" já vem com a primeira ponte de principal (o servidor exige a principal).
            if (k === 'ponteOnde' && v === 'escolher' && !n.pontePrincipal && pontes.length) n.pontePrincipal = pontes[0].id;
            // A reserva nunca é a principal.
            if (k === 'pontePrincipal' && v && v === n.ponteReserva) n.ponteReserva = '';
            return n;
          })
        }
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
