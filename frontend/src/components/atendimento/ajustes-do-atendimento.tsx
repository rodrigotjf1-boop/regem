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
import { ContaDoInstagram, situacaoDoInstagram, useVoltaDoInstagram, type EstadoDoInstagram } from '@/components/atendimento/instagram-da-loja';
import { ContaDoMessenger, situacaoDoMessenger, useVoltaDoMessenger, type EstadoDoMessenger } from '@/components/atendimento/messenger-da-loja';
import { TestarAtendente } from '@/components/atendimento/testar-atendente';

// AJUSTES DO ATENDIMENTO — Delivery › Configurações › Operação › Atendimento (protótipo
// `mockups/regem-central-atendimento.html`, vista "ajustes"; o grupo do "Cheguei" é do `mockups/regem-relacionamento.html`).
//  • "Retirada · cliente chegou" (Onda 3, mig 354): o botão "Cheguei" do cliente que retira, perguntar onde ele está,
//    onde a equipe é avisada e quando avisar de novo. Ficam no `cardapio_config` da LOJA EM USO (sincroniza com o servidor
//    da loja) — só aparecem com o cardápio online da loja.
// E os três grupos da central:
//  • "Horário da equipe" (mig 379, F1 do atendente virtual; protótipo v10): a equipe atende sempre (como era) ou no
//    horário da loja, com a folga antes de abrir e depois de fechar, e o que o robô diz fora do horário. Fora dele, o que
//    o robô passaria para a equipe vira recado para a abertura. Na `robo_config` da empresa — o primeiro grupo da tela.
//  • "Perfil do atendente virtual" (mig 380, F2; protótipo v11): por canal onde o atendente virtual já fala (WhatsApp e
//    Direct), o perfil (Como hoje, Profissional, Cordial, Gentil, Descontraído, Objetivo, Acolhedor — com o exemplo), o de
//    fora do horário ("O mesmo" ou outro) e o "jeito da loja". Na `robo_config` da empresa; nasce em "Como hoje".
//  • "Assuntos que não são pedido" (mig 381, F3; protótipo v12): fornecedor, vaga e parceria — o que o robô faz (como hoje,
//    recado para o responsável ou "não é por aqui") e o que ele diz (o texto some com "como hoje"). Na `robo_config`.
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
// O horário da equipe (mig 379, F1 do atendente virtual; protótipo `mockups/regem-central-atendimento.html` v10, grupo
// "Horário da equipe"): o robô atende 24 h; a equipe só no horário. Na `robo_config` da empresa; nasce em "Sempre".
const DA_EQUIPE: Record<string, string> = {
  equipeAtende: 'atende',
  equipeAntesMin: 'antesMin',
  equipeDepoisMin: 'depoisMin',
  equipeTextoFora: 'textoFora',
};
/** O que o robô diz fora do horário quando a loja deixa o campo em branco (o mesmo padrão do servidor). */
const FORA_DO_HORARIO_PADRAO = 'Nossa equipe volta {volta}. Já deixei o seu recado aqui e respondemos assim que começarmos.';
// O PERFIL DO ATENDENTE POR CANAL (mig 380, F2; protótipo v11, grupo "Perfil do atendente virtual"): nos canais onde o
// atendente virtual já fala. Nasce em "Como hoje" — nada muda até a loja escolher. Na `robo_config` da empresa.
// F5 (protótipo v14): o chat do iFood e da 99 ganha o perfil — vale quando "Quem responde no chat" é o atendente virtual.
// F6 (protótipo v15): os comentários do Instagram ganham o perfil — vale quando "Robô responde comentários" está ligado.
// Messenger (protótipo v17): a página do Facebook ganha o perfil — vale quando "Robô responde no Messenger" está ligado.
type CanalDoPerfil = 'whatsapp' | 'direct' | 'chat' | 'comentarios' | 'messenger';
type PerfilDoCanal = { perfil: string; foraDoHorario: string; jeito: string | null };
const CANAIS_DO_PERFIL: { canal: CanalDoPerfil; nome: string; chave: string }[] = [
  { canal: 'whatsapp', nome: 'WhatsApp', chave: 'Wa' },
  { canal: 'direct', nome: 'Direct do Instagram', chave: 'Ig' },
  { canal: 'chat', nome: 'Chat do iFood e da 99', chave: 'Chat' },
  { canal: 'comentarios', nome: 'Comentários do Instagram', chave: 'Cm' },
  { canal: 'messenger', nome: 'Messenger do Facebook', chave: 'Fb' },
];
const PERFIS: { v: string; rotulo: string; exemplo: string }[] = [
  { v: 'hoje', rotulo: 'Como hoje', exemplo: 'Como hoje — simpático e objetivo: "Oi, Joana! Entregamos no Centro, sim — a taxa é R$ 7,00. O cardápio está aqui 👇"' },
  { v: 'profissional', rotulo: 'Profissional', exemplo: 'Exemplo: "Olá, Joana. Entregamos no Centro; a taxa é de R$ 7,00. Segue o link do cardápio."' },
  { v: 'cordial', rotulo: 'Cordial', exemplo: 'Exemplo: "Oi, Joana! Tudo bem? Entregamos no Centro, sim — a taxa é R$ 7,00. Fique à vontade para escolher pelo cardápio 😊"' },
  { v: 'gentil', rotulo: 'Gentil', exemplo: 'Exemplo: "Oi, Joana, que bom falar com você! Entregamos no Centro, sim, com taxa de R$ 7,00. Se quiser ajuda para escolher, é só me chamar."' },
  { v: 'descontraido', rotulo: 'Descontraído', exemplo: 'Exemplo: "Opa, Joana! O Centro tá no nosso mapa, sim 🙌 Taxa de R$ 7,00. Bora escolher?"' },
  { v: 'objetivo', rotulo: 'Objetivo', exemplo: 'Exemplo: "Entregamos no Centro. Taxa: R$ 7,00. Cardápio: (link)."' },
  { v: 'acolhedor', rotulo: 'Acolhedor', exemplo: 'Exemplo: "Oi, Joana! Que bom que você chamou. Entregamos no Centro, sim, a taxa é R$ 7,00 — e qualquer dúvida no pedido, conte comigo."' },
];
/** As chaves da tela → [canal, campo] do grupo "perfis" que o servidor recebe. */
const DO_PERFIL: Record<string, [CanalDoPerfil, keyof PerfilDoCanal]> = Object.fromEntries(
  CANAIS_DO_PERFIL.flatMap(({ canal, chave }) => [
    [`perfil${chave}`, [canal, 'perfil']],
    [`perfil${chave}Fora`, [canal, 'foraDoHorario']],
    [`perfil${chave}Jeito`, [canal, 'jeito']],
  ]),
) as Record<string, [CanalDoPerfil, keyof PerfilDoCanal]>;
// OS ASSUNTOS QUE NÃO SÃO PEDIDO (mig 381, F3; protótipo v12, grupo "Assuntos que não são pedido"): fornecedor, vaga e
// parceria — o que o robô faz (como hoje, recado para o responsável ou "não é por aqui") e o que ele diz. Nasce "como hoje".
type Assunto = 'fornecedor' | 'vaga' | 'parceria';
type AjusteDoAssunto = { modo: string; texto: string | null };
const ASSUNTOS: { assunto: Assunto; nome: string; chave: string; ajuda: string; padrao: string }[] = [
  {
    assunto: 'fornecedor',
    nome: 'Fornecedor ou proposta comercial',
    chave: 'Fornecedor',
    ajuda: 'Quem quer vender para a loja (produto, serviço, embalagem). Com recado, o robô pergunta o nome, a empresa, o que oferece e o melhor contato.',
    padrao: 'Obrigado pelo contato! Já passei a sua proposta ao responsável. Se houver interesse, ele fala com você por aqui.',
  },
  {
    assunto: 'vaga',
    nome: 'Vaga de emprego',
    chave: 'Vaga',
    ajuda: 'Quem quer trabalhar na loja. Com recado, o robô pergunta o nome, a função e o melhor contato. Se a loja recebe currículo por e-mail, escreva no texto.',
    padrao: 'Que bom que você quer trabalhar com a gente! Deixei o seu contato com o responsável. Quando abrir uma vaga, ele fala com você.',
  },
  {
    assunto: 'parceria',
    nome: 'Parceria, influenciador ou imprensa',
    chave: 'Parceria',
    ajuda: 'Divulgação, evento, permuta, reportagem. Com recado, o robô pergunta o nome, o perfil ou veículo, a proposta e o melhor contato.',
    padrao: 'Obrigado pelo interesse! Já passei ao responsável, que responde por aqui.',
  },
];
const MODOS_DO_ASSUNTO = [
  { v: 'hoje', rotulo: 'Como hoje: chama a equipe' },
  { v: 'recado', rotulo: 'Deixa recado para o responsável' },
  { v: 'nao', rotulo: 'Responde que não é por aqui' },
];
/** O texto do "não é por aqui" quando a loja não escreve o dela (o mesmo padrão do servidor). */
const NAO_E_POR_AQUI = 'Obrigado pelo contato! Esse assunto não é tratado por aqui.';
/** As chaves da tela → [assunto, campo] do grupo "assuntos" que o servidor recebe. */
const DO_ASSUNTO: Record<string, [Assunto, keyof AjusteDoAssunto]> = Object.fromEntries(
  ASSUNTOS.flatMap(({ assunto, chave }) => [
    [`assunto${chave}`, [assunto, 'modo']],
    [`assunto${chave}Texto`, [assunto, 'texto']],
  ]),
) as Record<string, [Assunto, keyof AjusteDoAssunto]>;
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
  /** Quem responde no chat (F5, mig 383): as frases prontas de hoje ou o atendente virtual — nasce 'regras'. */
  roboModo?: 'regras' | 'atendente';
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
  // O horário da equipe (mig 379): "sempre" (como era) ou "no horário da loja", com a folga antes e depois.
  equipe?: { atende: 'sempre' | 'loja'; antesMin: number; depoisMin: number; textoFora: string | null } | null;
  // O perfil do atendente por canal (mig 380): o servidor manda os dois canais, com os padrões.
  perfis?: Partial<Record<CanalDoPerfil, PerfilDoCanal>> | null;
  // Os assuntos que não são pedido (mig 381): o servidor manda os três, com os padrões.
  assuntos?: Partial<Record<Assunto, AjusteDoAssunto>> | null;
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
  // O Instagram Direct (mig 377): se a distribuição liberou e a conta conectada (nunca o acesso).
  instagram?: EstadoDoInstagram | null;
  messenger?: EstadoDoMessenger | null;
};

const paraValores = (r: Resposta): Valores => ({
  ...(r.copiloto ? { copilotoLigado: r.copiloto.ligado } : {}),
  ...(r.instagram?.conta
    ? {
        instagramFila: r.instagram.conta.filaLigada,
        instagramRobo: r.instagram.conta.roboResponde === true,
        instagramCardapio: r.instagram.conta.cardapioId ?? '',
      }
    : {}),
  ...(r.instagram?.conta && r.instagram.comentarios
    ? { instagramCmRobo: r.instagram.comentarios.roboResponde === true, instagramCmFila: r.instagram.comentarios.naFila !== false }
    : {}),
  ...(r.messenger?.conta
    ? {
        messengerFila: r.messenger.conta.filaLigada,
        messengerRobo: r.messenger.conta.roboResponde === true,
        messengerCardapio: r.messenger.conta.cardapioId ?? '',
      }
    : {}),
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
        ponteRoboModo: r.ponte.roboModo === 'atendente' ? 'atendente' : 'regras',
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
  ...Object.fromEntries(
    ASSUNTOS.flatMap(({ assunto, chave }) => {
      const a = r.assuntos?.[assunto];
      return a
        ? [
            [`assunto${chave}`, a.modo],
            [`assunto${chave}Texto`, a.texto ?? ''],
          ]
        : [];
    }),
  ),
  ...Object.fromEntries(
    CANAIS_DO_PERFIL.flatMap(({ canal, chave }) => {
      const p = r.perfis?.[canal];
      return p
        ? [
            [`perfil${chave}`, p.perfil],
            [`perfil${chave}Fora`, p.foraDoHorario],
            [`perfil${chave}Jeito`, p.jeito ?? ''],
          ]
        : [];
    }),
  ),
  ...(r.equipe
    ? {
        equipeAtende: r.equipe.atende,
        equipeAntesMin: String(r.equipe.antesMin),
        equipeDepoisMin: String(r.equipe.depoisMin),
        equipeTextoFora: r.equipe.textoFora ?? '',
      }
    : {}),
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
  // "🧪 Testar o atendente" (F4) a partir do grupo do perfil.
  const [testando, setTestando] = useState(false);
  // A volta do login do Instagram (`?instagram=`): avisa como foi (a tela já relê os ajustes ao montar).
  useVoltaDoInstagram(() => undefined);
  // A volta do login do Facebook (`?messenger=`): avisa; com mais de uma página, abre a escolha.
  const [escolherPagina, setEscolherPagina] = useState(false);
  useVoltaDoMessenger((escolher) => setEscolherPagina(escolher));

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
  // O perfil do atendente por canal (protótipo v11): o exemplo acompanha o perfil escolhido (a mesma resposta em cada jeito).
  const exemploDo = (perfil: unknown) => PERFIS.find((p) => p.v === perfil)?.exemplo ?? '';
  // Os assuntos que não são pedido (protótipo v12): o modo e o texto de cada um; o texto em branco vale o padrão do modo.
  const grupoDosAssuntos: GrupoDeAjustes = {
    titulo: 'Assuntos que não são pedido',
    nota: 'O recado para o responsável não entra na fila da equipe: vai para "📋 Recados", que só gerente e presidente veem — sem som e sem tempo de espera. Sempre vale: o robô pergunta só o necessário, uma pergunta por vez; nunca promete vaga, compra nem parceria; o recado não cala o robô; vale no WhatsApp e no Direct.',
    itens: ASSUNTOS.flatMap(({ nome, chave, ajuda, padrao }) => {
      const modo = String(valores[`assunto${chave}`] ?? 'hoje');
      return [
        {
          id: `assunto${chave}`,
          rotulo: nome,
          tipo: 'selecao' as const,
          opcoes: MODOS_DO_ASSUNTO,
          ajuda,
          palavras: `assunto recado responsável ${nome}`,
        },
        ...(modo === 'hoje'
          ? []
          : [
              {
                id: `assunto${chave}Texto`,
                rotulo: `${nome} · o robô diz`,
                tipo: 'texto' as const,
                opcional: true,
                maximo: 300,
                placeholder: modo === 'nao' ? NAO_E_POR_AQUI : padrao,
                ajuda: modo === 'nao' ? 'Sem recado: a resposta educada e o fim do assunto. Em branco, vale o texto de exemplo.' : 'O que o robô diz depois de deixar o recado. Em branco, vale o texto de exemplo.',
                palavras: `texto mensagem robô diz ${nome}`,
              },
            ]),
      ];
    }),
  };
  const grupoDoPerfil: GrupoDeAjustes = {
    titulo: 'Perfil do atendente virtual',
    nota: 'Sempre vale: o perfil muda o jeito de falar, nunca as regras — o robô nunca inventa preço, prazo, taxa nem promoção; segue as regras de cada canal; no máximo 1 emoji por mensagem; cliente chateado: o robô fica sério e chama a equipe. O perfil do chat do iFood e da 99 vale quando "Quem responde no chat" é o atendente virtual (grupo "iFood e 99 · chat pela ponte"); o dos comentários do Instagram, quando "Robô responde comentários" está ligado (grupo "Instagram · Direct e comentários"). O do Messenger do Facebook, quando "Robô responde no Messenger" está ligado (grupo "Messenger do Facebook").',
    itens: CANAIS_DO_PERFIL.flatMap(({ nome, chave }) => [
      {
        id: `perfil${chave}`,
        rotulo: `${nome} · perfil`,
        tipo: 'selecao' as const,
        opcoes: PERFIS.map((p) => ({ v: p.v, rotulo: p.rotulo })),
        ajuda: exemploDo(valores[`perfil${chave}`]),
        palavras: `perfil atendente tom jeito ${nome} profissional cordial gentil descontraído objetivo acolhedor`,
      },
      {
        id: `perfil${chave}Fora`,
        rotulo: `${nome} · fora do horário`,
        tipo: 'selecao' as const,
        opcoes: [{ v: 'mesmo', rotulo: 'O mesmo' }, ...PERFIS.filter((p) => p.v !== 'hoje').map((p) => ({ v: p.v, rotulo: p.rotulo }))],
        ajuda: 'O perfil quando a equipe não está (o grupo Horário da equipe). "O mesmo" mantém o de cima.',
        palavras: `perfil fora horário noite ${nome}`,
      },
      {
        id: `perfil${chave}Jeito`,
        rotulo: `${nome} · jeito da loja`,
        tipo: 'texto' as const,
        opcional: true,
        maximo: 300,
        placeholder: 'Como a loja gosta de falar (opcional)',
        ajuda: 'Opcional, até 300 letras. Ex.: "trate o cliente por você; assine como a loja; nunca prometa brinde". Vem depois do perfil.',
        palavras: `jeito da loja como falar ${nome}`,
      },
    ]),
    // F4 (protótipo v13): ver como fica — a conversa de teste usa o perfil SALVO (o servidor lê o que está gravado).
    depois: (
      <p className="flex flex-wrap items-center gap-2 text-sm text-secondary-foreground">
        Quer ver como fica? Salve antes: o teste usa o perfil gravado.
        <Button type="button" variant="outline" size="sm" onClick={() => setTestando(true)}>
          <span aria-hidden="true">🧪</span> Testar o atendente
        </Button>
      </p>
    ),
  };
  // O horário da equipe (protótipo v10): os três ajustes de baixo só aparecem com "No horário da loja".
  const noHorarioDaLoja = valores.equipeAtende === 'loja';
  const grupoDaEquipe: GrupoDeAjustes = {
    titulo: 'Horário da equipe',
    nota: noHorarioDaLoja
      ? 'Sempre vale: fora do horário nada toca, o gerente não é avisado (nem pelo WhatsApp) e o "3 min sem resposta" do Direct vira recado, sem tocar · o robô continua respondendo o que sabe (cardápio, horário, taxa, situação do pedido) · o recado guarda a conversa e o resumo · no chat do iFood e da 99 a frase segue a trava da plataforma.'
      : 'O robô atende 24 h no WhatsApp, no Direct e no chat do iFood e da 99. Aqui você diz quando tem gente para os casos.',
    itens: [
      {
        id: 'equipeAtende',
        rotulo: 'A equipe atende',
        tipo: 'selecao',
        opcoes: [
          { v: 'sempre', rotulo: 'Sempre (como hoje)' },
          { v: 'loja', rotulo: 'No horário da loja' },
        ],
        ajuda:
          '"No horário da loja" usa os horários de Delivery › Configurações › Horários de cada loja. Fora dele, o que o robô passaria para a equipe vira recado para a abertura.',
        palavras: 'horário equipe atendimento fora noite recado abertura funcionamento',
      },
      ...(noHorarioDaLoja
        ? ([
            {
              id: 'equipeAntesMin',
              rotulo: 'Começa a atender',
              tipo: 'selecao',
              opcoes: [
                { v: '0', rotulo: 'Quando a loja abre' },
                { v: '30', rotulo: '30 min antes de abrir' },
                { v: '60', rotulo: '1 h antes de abrir' },
              ],
              ajuda: 'Os recados da noite entram na fila nessa hora, pela ordem de chegada, e o aviso toca uma vez só.',
              palavras: 'começa abre antes recado noite fila',
            },
            {
              id: 'equipeDepoisMin',
              rotulo: 'Para de atender',
              tipo: 'selecao',
              opcoes: [
                { v: '0', rotulo: 'Quando a loja fecha' },
                { v: '30', rotulo: '30 min depois de fechar' },
                { v: '60', rotulo: '1 h depois de fechar' },
                { v: '120', rotulo: '2 h depois de fechar' },
              ],
              ajuda:
                'Depois de fechar, a equipe ainda entrega os últimos pedidos. Quem fala de um pedido em andamento vai para a fila na hora, mesmo depois desse tempo.',
              palavras: 'para fecha depois últimos pedidos entrega',
            },
            {
              id: 'equipeTextoFora',
              rotulo: 'Fora do horário, o robô diz',
              tipo: 'texto',
              opcional: true,
              maximo: 300,
              placeholder: FORA_DO_HORARIO_PADRAO,
              ajuda:
                'Quando ele passaria a conversa para a equipe. {volta} vira o dia e a hora em que a equipe volta: "hoje às 17:30", "amanhã às 17:30", "na terça às 17:30". Em branco, vale o texto de exemplo.',
              palavras: 'frase mensagem fora horário volta recado robô diz',
            },
          ] satisfies GrupoDeAjustes['itens'])
        : []),
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
      // F5 (mig 383; protótipo v14): as frases prontas de hoje ou o atendente virtual — o mesmo robô do WhatsApp.
      {
        id: 'ponteRoboModo',
        rotulo: 'Quem responde no chat',
        tipo: 'selecao',
        opcoes: [
          { v: 'regras', rotulo: 'Frases prontas (como hoje)' },
          { v: 'atendente', rotulo: 'Atendente virtual' },
        ],
        ajuda:
          'Vale com "Robô responde no chat" ligado. Frases prontas: o "cadê meu pedido?" com o dado do pedido; o resto chama a equipe (como hoje). Atendente virtual: o mesmo do WhatsApp, com o dado do pedido, o perfil do chat e o que a loja ensinou — tudo o que ele escreve passa pela trava da plataforma (o que ela barra vira a frase pronta); sem resposta dele em 2 min, o caso abre para a equipe.',
        palavras: 'quem responde chat atendente virtual ia inteligencia frases prontas ifood 99',
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
  // O Instagram Direct (mig 377; protótipo v7): conectar a conta profissional da loja e "Mensagens do Direct na fila".
  // O robô no Direct (mig 378; protótipo v8): "Robô responde no Direct" (nasce desligado) e "Cardápio que o robô usa"
  // (só com mais de um cardápio — com um, é ele).
  const ig = resp?.instagram ?? null;
  const cardapiosDoRobo = ig?.cardapios ?? [];
  const grupoDoInstagram: GrupoDeAjustes | null = ig
    ? {
        titulo: 'Instagram · Direct e comentários',
        nota: 'Sempre vale (regras do Instagram e do robô): a loja só responde a quem escreveu primeiro · até 24 h depois da última mensagem do cliente · as mensagens seguem no app do Instagram também · o acesso fica com a Regem, cifrado, e é renovado sozinho · o robô fica quieto enquanto a conversa está com alguém (caso aberto ou resposta da loja pelo app do Instagram) · se o robô não responder em 3 min, a conversa vira caso · nos comentários: uma resposta da loja por comentário, uma mensagem no Direct por comentário (até 7 dias depois dele), nada se apaga sozinho e os comentários da própria loja e das lives ficam de fora.',
        itens: [
          {
            id: 'instagramConta',
            rotulo: 'Instagram da loja',
            tipo: 'livre',
            ajuda: situacaoDoInstagram(ig),
            palavras: 'instagram direct conectar conta perfil mensagens',
            desenhar: () => <ContaDoInstagram estado={ig} aoMudar={(e) => setResp((r) => (r ? { ...r, instagram: e } : r))} />,
          },
          ...(ig.conta
            ? [
                {
                  id: 'instagramRobo',
                  rotulo: 'Robô responde no Direct',
                  tipo: 'chave' as const,
                  ajuda: `O mesmo robô do WhatsApp responde primeiro: horário, área de entrega e taxa, o que tem no cardápio e o link do cardápio para pedir. O Instagram não diz quem é o cliente, então no Direct o robô não vê pedido nem cadastro: "cadê meu pedido", reclamação, encomenda e "quero falar com alguém" viram caso, com o resumo. Sem áudio por enquanto (ele pede para escrever).${
                    ig.roboDisponivel === false ? ' A Regem ainda está ligando o robô no Direct: até lá, ligado aqui, as conversas viram caso para a equipe.' : ''
                  }`,
                  palavras: 'instagram direct robô robo responder automático ia',
                },
                ...(cardapiosDoRobo.length > 1
                  ? [
                      {
                        id: 'instagramCardapio',
                        rotulo: 'Cardápio que o robô usa',
                        tipo: 'selecao' as const,
                        opcoes: [{ v: '', rotulo: 'Escolha o cardápio' }, ...cardapiosDoRobo.map((c) => ({ v: c.id, rotulo: c.ativo ? c.nome : `${c.nome} (desligado)` }))],
                        ajuda: 'O Instagram é da empresa; o horário, a taxa e o link saem do cardápio desta loja. Sem escolher, o robô não liga no Direct.',
                        palavras: 'instagram direct robô cardápio loja',
                      },
                    ]
                  : []),
                {
                  id: 'instagramFila',
                  rotulo: 'Mensagens do Direct na fila',
                  tipo: 'chave' as const,
                  ajuda: 'Com o robô desligado: cada conversa nova do Direct vira caso, com o perfil do cliente. Com o robô ligado: vira caso só o que ele passa para a equipe ou quando alguém assume a conversa. A resposta sai pelo Instagram da loja. Desligado (e sem o robô), as mensagens continuam só no app do Instagram.',
                  palavras: 'instagram direct fila caso mensagens',
                },
                // F6 (mig 384; protótipo v15): os COMENTÁRIOS dos posts. Sem a permissão nova (conta conectada antes), a
                // linha pede para reconectar (o botão "Reconectar" fica na linha da conta, acima) e o robô não liga.
                {
                  id: 'instagramCmEstado',
                  rotulo: 'Comentários dos posts',
                  tipo: 'livre' as const,
                  ajuda: ig.comentarios?.permitido
                    ? 'Liberados: os comentários dos posts aparecem no botão "💬 Comentários", no topo do Atendimento.'
                    : 'Falta a permissão de comentários: o Instagram foi conectado antes de ela existir. Toque em "Reconectar" (acima) e permita os comentários.',
                  palavras: 'instagram comentários comentario post posts permissão reconectar',
                  desenhar: () => (
                    <span className={`text-sm font-semibold ${ig.comentarios?.permitido ? 'text-foreground' : 'text-destructive'}`}>
                      {ig.comentarios?.permitido ? '✅ Liberados' : 'Precisa reconectar'}
                    </span>
                  ),
                },
                ...(ig.comentarios?.permitido
                  ? [
                      {
                        id: 'instagramCmRobo',
                        rotulo: 'Robô responde comentários',
                        tipo: 'chave' as const,
                        ajuda: `O mesmo atendente virtual responde no post, em 1 ou 2 frases: agradece o elogio e tira a dúvida simples (horário, cardápio, entrega). Pedido, reclamação ou dado pessoal ele não trata em público: manda uma mensagem no Direct da pessoa e chama a equipe. Ofensivo ou propaganda ele não responde (a equipe decide esconder). Até 30 respostas por hora.${
                          ig.roboDisponivel === false ? ' A Regem ainda está ligando o robô: até lá, os comentários chegam todos em "Sem resposta".' : ''
                        }`,
                        palavras: 'instagram comentários robô robo responder automático ia post',
                      },
                      {
                        id: 'instagramCmFila',
                        rotulo: 'Comentário que pede a equipe vira caso',
                        tipo: 'chave' as const,
                        ajuda: 'Quando o robô chama a equipe por causa de um comentário, ele vira caso na fila, com o post e o resumo. Desligado, a pessoa recebe a mensagem no Direct e o comentário fica só na lista "💬 Comentários".',
                        palavras: 'instagram comentários fila caso equipe',
                      },
                    ]
                  : []),
              ]
            : []),
        ],
      }
    : null;
  // O Messenger da página do Facebook (mig 386; protótipo v17): conectar (com mais de uma página, escolher qual), o robô
  // (nasce desligado), o cardápio (só com mais de um) e "Mensagens do Messenger na fila".
  const fb = resp?.messenger ?? null;
  const cardapiosDoFb = fb?.cardapios ?? [];
  const grupoDoMessenger: GrupoDeAjustes | null = fb
    ? {
        titulo: 'Messenger do Facebook',
        nota: 'Sempre vale (regras do Messenger e do robô): a loja só responde a quem escreveu primeiro · até 24 h depois da última mensagem do cliente · as mensagens seguem na caixa de entrada da página também · o acesso fica com a Regem, cifrado · o robô fica quieto enquanto a conversa está com alguém (caso aberto ou resposta pela página no Facebook) · se o robô não responder em 3 min, a conversa vira caso.',
        itens: [
          {
            id: 'messengerConta',
            rotulo: 'Página do Facebook',
            tipo: 'livre',
            ajuda: situacaoDoMessenger(fb),
            palavras: 'facebook messenger página pagina conectar mensagens',
            desenhar: () => <ContaDoMessenger estado={fb} escolherAgora={escolherPagina} aoMudar={(e) => setResp((r) => (r ? { ...r, messenger: e } : r))} />,
          },
          ...(fb.conta
            ? [
                {
                  id: 'messengerRobo',
                  rotulo: 'Robô responde no Messenger',
                  tipo: 'chave' as const,
                  ajuda: `O mesmo atendente virtual do WhatsApp responde primeiro: horário, área de entrega e taxa, o cardápio e o link para pedir. O Facebook não diz quem é o cliente, então o robô não vê pedido nem cadastro: "cadê meu pedido", reclamação, encomenda e "quero falar com alguém" viram caso, com o resumo.${
                    fb.roboDisponivel === false ? ' A Regem ainda está ligando o robô: até lá, ligado aqui, as conversas viram caso para a equipe.' : ''
                  }`,
                  palavras: 'messenger facebook robô robo responder automático ia',
                },
                ...(cardapiosDoFb.length > 1
                  ? [
                      {
                        id: 'messengerCardapio',
                        rotulo: 'Cardápio que o robô usa',
                        tipo: 'selecao' as const,
                        opcoes: [{ v: '', rotulo: 'Escolha o cardápio' }, ...cardapiosDoFb.map((c) => ({ v: c.id, rotulo: c.ativo ? c.nome : `${c.nome} (desligado)` }))],
                        ajuda: 'A página é da empresa; o horário, a taxa e o link saem do cardápio desta loja. Sem escolher, o robô não liga no Messenger.',
                        palavras: 'messenger facebook robô cardápio loja',
                      },
                    ]
                  : []),
                {
                  id: 'messengerFila',
                  rotulo: 'Mensagens do Messenger na fila',
                  tipo: 'chave' as const,
                  ajuda: 'Com o robô desligado: cada conversa nova vira caso, com o nome do cliente. Com o robô ligado: vira caso só o que ele passa para a equipe. A resposta sai pela página. Desligado (e sem o robô), as mensagens ficam só na caixa de entrada da página.',
                  palavras: 'messenger facebook fila caso mensagens',
                },
              ]
            : []),
        ],
      }
    : null;
  const grupos: GrupoDeAjustes[] = [
    ...(resp?.equipe ? [grupoDaEquipe] : []),
    ...(resp?.perfis ? [grupoDoPerfil] : []),
    ...(resp?.assuntos ? [grupoDosAssuntos] : []),
    ...(resp?.cheguei?.temCardapio ? [grupoDoCheguei] : []),
    grupoDaFila,
    ...(grupoDoGestor ? [grupoDoGestor] : []),
    ...(grupoDoCopiloto ? [grupoDoCopiloto] : []),
    ...(grupoDoMessenger ? [grupoDoMessenger] : []),
    ...(grupoDoInstagram ? [grupoDoInstagram] : []),
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
    const equipe: Record<string, unknown> = {};
    const perfis: Partial<Record<CanalDoPerfil, Partial<PerfilDoCanal>>> = {};
    const assuntos: Partial<Record<Assunto, Partial<AjusteDoAssunto>>> = {};
    const ifood: Record<string, unknown> = {};
    const ajuste99: Record<string, unknown> = {};
    const cheguei: Record<string, unknown> = {};
    const repetido: Record<string, unknown> = {};
    let alterado: { som?: string; roboMuda?: boolean; roboCobraPix?: boolean } | null = null;
    const gestorWa: Record<string, boolean | number | null> = {};
    let copiloto: { ligado: boolean } | null = null;
    let instagram: {
      filaLigada?: boolean;
      roboResponde?: boolean;
      cardapioId?: string | null;
      comentarios?: { roboResponde?: boolean; naFila?: boolean };
    } | null = null;
    let messenger: { filaLigada?: boolean; roboResponde?: boolean; cardapioId?: string | null } | null = null;
    const ponte: {
      ligada?: boolean;
      roboResponde?: boolean;
      roboModo?: 'regras' | 'atendente';
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
      if (k === 'ponteRoboModo') {
        ponte.roboModo = valores[k] === 'atendente' ? 'atendente' : 'regras';
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
      if (k === 'instagramFila') {
        instagram = { ...(instagram ?? {}), filaLigada: valores[k] === true };
        continue;
      }
      if (k === 'instagramRobo') {
        instagram = { ...(instagram ?? {}), roboResponde: valores[k] === true };
        continue;
      }
      if (k === 'instagramCardapio') {
        instagram = { ...(instagram ?? {}), cardapioId: String(valores[k] ?? '') || null };
        continue;
      }
      if (k === 'instagramCmRobo' || k === 'instagramCmFila') {
        const campo = k === 'instagramCmRobo' ? 'roboResponde' : 'naFila';
        instagram = { ...(instagram ?? {}), comentarios: { ...(instagram?.comentarios ?? {}), [campo]: valores[k] === true } };
        continue;
      }
      if (k === 'instagramConta' || k === 'instagramCmEstado') continue; // mudam pelos botões da conta, não pelo salvar
      if (k === 'messengerFila') {
        messenger = { ...(messenger ?? {}), filaLigada: valores[k] === true };
        continue;
      }
      if (k === 'messengerRobo') {
        messenger = { ...(messenger ?? {}), roboResponde: valores[k] === true };
        continue;
      }
      if (k === 'messengerCardapio') {
        messenger = { ...(messenger ?? {}), cardapioId: String(valores[k] ?? '') || null };
        continue;
      }
      if (k === 'messengerConta') continue; // muda pelos botões da página, não pelo salvar
      if (DO_ASSUNTO[k]) {
        // Só o campo que mudou, do assunto dele; o texto em branco volta a null (o padrão).
        const [assunto, campo] = DO_ASSUNTO[k];
        assuntos[assunto] = { ...assuntos[assunto], [campo]: campo === 'texto' ? String(valores[k] ?? '').trim() || null : String(valores[k]) };
        continue;
      }
      if (DO_PERFIL[k]) {
        // Só o campo que mudou, do canal dele; o jeito em branco volta a null (sem jeito).
        const [canal, campo] = DO_PERFIL[k];
        const v = campo === 'jeito' ? String(valores[k] ?? '').trim() || null : String(valores[k]);
        perfis[canal] = { ...perfis[canal], [campo]: v };
        continue;
      }
      if (DA_EQUIPE[k]) {
        // As folgas vão em minutos; o texto em branco volta ao padrão (null).
        equipe[DA_EQUIPE[k]] =
          k === 'equipeAntesMin' || k === 'equipeDepoisMin' ? Number(valores[k]) : k === 'equipeTextoFora' ? String(valores[k] ?? '').trim() || null : valores[k];
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
        ...(Object.keys(equipe).length ? { equipe } : {}),
        ...(Object.keys(perfis).length ? { perfis } : {}),
        ...(Object.keys(assuntos).length ? { assuntos } : {}),
        ...(Object.keys(ifood).length ? { ifood } : {}),
        ...(Object.keys(ajuste99).length ? { ajuste99 } : {}),
        ...(Object.keys(cheguei).length ? { cheguei } : {}),
        ...(Object.keys(repetido).length ? { repetido } : {}),
        ...(alterado ? { alterado } : {}),
        ...(Object.keys(ponte).length ? { ponte } : {}),
        ...(Object.keys(gestorWa).length ? { gestorWa } : {}),
        ...(copiloto ? { copiloto } : {}),
        ...(instagram ? { instagram } : {}),
        ...(messenger ? { messenger } : {}),
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
      {testando && <TestarAtendente aoFechar={() => setTestando(false)} />}
    </div>
  );
}
