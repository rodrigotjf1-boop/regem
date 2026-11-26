import { FUSO_OPERACAO, somarDias } from '../../common/data';
import type { BoletimDoRamo, IndicadorDoBoletim, NoticiaDoBoletim } from '../pulso/pulso.regras';

// OS RELATÓRIOS DO MISTER (mig 420; protótipo `mockups/regem-mister.html`, "Avisos e relatórios" › Relatórios): o resumo do
// dia e o resumo da semana, no horário que a empresa escolhe. Regras puras: o padrão, a conferência do que a tela manda,
// QUANDO cada relatório vence e a pergunta que o agente recebe para escrevê-lo.
// F4c das vagas (protótipo `mockups/regem-vagas-talentos.html`, aprovado 15/11): as FICHAS NOVAS de candidatos — só conta,
// sem a IA; vai a quem pode ver os candidatos (presidente e quem tem a permissão Candidatos); só no dia em que chegou ficha.
// Fase N2 das Notícias do ramo (protótipo `mockups/regem-noticias-do-ramo.html`, aprovado 22/11): o BOLETIM DO RAMO — sem a
// IA, montado da cópia do Pulso; fora das 24 horas só vai o convite se a empresa escolher (mig 496).
// Versão 10, C7/C8 (protótipo `mockups/regem-mister-v10.html`, "Ideias da semana", decisão V10-6): as IDEIAS DA SEMANA — a IA olha
// os números dos 7 dias e manda até 3 ideias ao PRESIDENTE, cada uma com o que faria no Regem; "faz a 2" depois, na conversa.
// Semanal como o resumo da semana (o dia e a hora), sem migration: a mesma tabela da mig 420.

export const TIPOS_DE_RELATORIO = ['resumo_dia', 'resumo_semana', 'ideias_semana', 'fichas_novas', 'boletim_ramo', 'vespera'] as const;
export type TipoDeRelatorio = (typeof TIPOS_DE_RELATORIO)[number];
/** Os relatórios que a IA escreve (o de fichas novas só conta, e o boletim e a véspera são texto fixo, sem a IA). */
export type RelatorioDaIa = Exclude<TipoDeRelatorio, 'fichas_novas' | 'boletim_ramo' | 'vespera'>;
/** Quem só manda fora das 24 horas se a empresa escolheu o convite pago (mig 496). */
export const temConviteOpcional = (t: TipoDeRelatorio): boolean => t === 'boletim_ramo' || t === 'vespera';
export const ehTipoDeRelatorio = (t: unknown): t is TipoDeRelatorio => TIPOS_DE_RELATORIO.includes(t as TipoDeRelatorio);
/** Os semanais: escolhem o dia da semana e falam dos 7 dias até a véspera do envio. */
export const ehSemanal = (t: TipoDeRelatorio): boolean => t === 'resumo_semana' || t === 'ideias_semana';
/** Só ao presidente (as ideias falam da empresa inteira e pedem a decisão dele). */
export const soAoPresidente = (t: TipoDeRelatorio): boolean => t === 'ideias_semana';

export interface RegraDoRelatorio {
  ligado: boolean;
  /** 'HH:MM' no relógio da operação. */
  hora: string;
  /** 1 = segunda … 7 = domingo (só os semanais: o resumo e as ideias da semana). */
  diaSemana: number | null;
  /** No boletim do ramo e na véspera: fora das 24 horas, manda o convite pago pelo modelo da Meta. Nasce desligado. */
  convidarFora?: boolean;
  /** Só no resumo do dia (versão 8, E3; mig 498): termina com a linha "Amanhã", quando há algo para dizer. */
  linhaAmanha?: boolean;
}

/** O boletim fica pronto às 07:50 e a nuvem guarda a cópia às 08:05: antes disso não há o que mandar. */
export const HORA_MINIMA_DO_BOLETIM = '08:15';

/** Como o protótipo: todos desligados; o do dia às 23:30, o da semana na segunda às 09:00, o das fichas às 09:00, o boletim às 08:30. */
export const PADRAO_DO_RELATORIO: Record<TipoDeRelatorio, RegraDoRelatorio> = {
  resumo_dia: { ligado: false, hora: '23:30', diaSemana: null },
  resumo_semana: { ligado: false, hora: '09:00', diaSemana: 1 },
  ideias_semana: { ligado: false, hora: '09:00', diaSemana: 1 },
  fichas_novas: { ligado: false, hora: '09:00', diaSemana: null },
  boletim_ramo: { ligado: false, hora: '08:30', diaSemana: null, convidarFora: false },
  vespera: { ligado: false, hora: '18:00', diaSemana: null, convidarFora: false },
};

export const RELATORIO_NA_TELA: Record<TipoDeRelatorio, { titulo: string; descricao: string; vaiPara?: string; usaIa: boolean }> = {
  resumo_dia: { titulo: 'Resumo do dia', descricao: 'Pedidos, vendas, tempo médio, cancelamentos e o que saiu do lugar.', usaIa: true },
  resumo_semana: { titulo: 'Resumo da semana', descricao: 'Os 7 dias até a véspera contra os 7 anteriores.', usaIa: true },
  ideias_semana: {
    titulo: 'Ideias da semana',
    descricao:
      'Toda semana a IA olha os números da loja e manda até 3 ideias, cada uma com o número que a sustenta e o que ela faria no Regem. Para fazer uma, é só responder "faz a 2": o Mister propõe e você confirma.',
    vaiPara: 'o presidente, se ligou o próprio WhatsApp em Pessoas',
    usaIa: true,
  },
  fichas_novas: {
    titulo: 'Fichas novas de candidatos',
    descricao:
      'As fichas que chegaram na Página de vagas desde o último resumo: nome, função, escala e distância. Só nos dias em que chegou ficha. Sem telefone nem endereço no WhatsApp.',
    vaiPara: 'o presidente e quem tem a permissão Candidatos, cada um só das lojas que vê',
    usaIa: false,
  },
  boletim_ramo: {
    titulo: 'Boletim do ramo',
    descricao: 'Os indicadores, até 3 destaques e até 2 novidades do setor, com a fonte e o link de cada um. Só nos dias com novidade.',
    vaiPara: 'o presidente e o gerente com a permissão Notícias do ramo, se ligaram o próprio WhatsApp em Pessoas',
    usaIa: false,
  },
  vespera: {
    titulo: 'Avisar na véspera',
    descricao: 'No dia anterior, quando vem feriado, data forte, jogo na cidade ou chuva nas duas previsões. Só nos dias com algo para dizer. Texto fixo, sem IA.',
    vaiPara: 'o presidente e os gerentes que ligaram o próprio WhatsApp em Pessoas, cada um com as suas lojas',
    usaIa: false,
  },
};

/** O nome do recurso no medidor da IA ("Uso da IA"): cada relatório soma no seu. */
export const RECURSO_DO_RELATORIO: Record<RelatorioDaIa, string> = { resumo_dia: 'mister_resumo_dia', resumo_semana: 'mister_resumo_semana', ideias_semana: 'mister_ideias_semana' };

/** Passado disto depois do horário (o servidor parado, a rotina atrasada), o relatório do dia não sai mais. */
export const ATRASO_MAXIMO_DO_RELATORIO_MIN = 180;
/** Uma linha "fazendo" mais velha que isto foi interrompida (o servidor reiniciou no meio): vira "não enviado". */
export const RELATORIO_INTERROMPIDO_MIN = 30;
/** O resumo marcado antes das 6 h é da noite que passou (a mesma virada do "noite de" das perguntas). */
const VIRADA_DA_NOITE_MIN = 6 * 60;

const HORA = /^([01]\d|2[0-3]):[0-5]\d$/;
const minutos = (h: string) => Number(h.slice(0, 2)) * 60 + Number(h.slice(3, 5));

/** A regra que vale: a salva ou o padrão (campo ausente ou torto = o do padrão). */
export function regraDoRelatorioQueVale(tipo: TipoDeRelatorio, salva?: Partial<RegraDoRelatorio> | null): RegraDoRelatorio {
  const p = PADRAO_DO_RELATORIO[tipo];
  if (!salva) return { ...p };
  const dia = Number(salva.diaSemana);
  const regra: RegraDoRelatorio = {
    ligado: typeof salva.ligado === 'boolean' ? salva.ligado : p.ligado,
    hora: typeof salva.hora === 'string' && HORA.test(salva.hora) ? salva.hora : p.hora,
    diaSemana: ehSemanal(tipo) ? (Number.isInteger(dia) && dia >= 1 && dia <= 7 ? dia : p.diaSemana) : null,
  };
  if (temConviteOpcional(tipo)) return { ...regra, convidarFora: salva.convidarFora === true };
  return tipo === 'resumo_dia' && salva.linhaAmanha === true ? { ...regra, linhaAmanha: true } : regra;
}

/**
 * Confere o que a tela manda (`{ relatorios: [{ tipo, ligado, hora, diaSemana? }] }`): todo campo presente e certo (V15:
 * liga/desliga só booleano; hora só 'HH:MM'; o dia da semana só no resumo da semana) — senão a mensagem da recusa.
 */
export function conferirRelatorios(dto: unknown): Array<{ tipo: TipoDeRelatorio; regra: RegraDoRelatorio }> | { erro: string } {
  const lista = (dto as any)?.relatorios;
  if (!Array.isArray(lista) || !lista.length) return { erro: 'Nada para salvar.' };
  if (lista.length > TIPOS_DE_RELATORIO.length) return { erro: 'Relatórios demais.' };
  const vistos = new Set<string>();
  const fora: Array<{ tipo: TipoDeRelatorio; regra: RegraDoRelatorio }> = [];
  for (const x of lista) {
    if (!ehTipoDeRelatorio(x?.tipo)) return { erro: 'Relatório desconhecido.' };
    if (vistos.has(x.tipo)) return { erro: 'Relatório repetido.' };
    vistos.add(x.tipo);
    const nome = RELATORIO_NA_TELA[x.tipo as TipoDeRelatorio].titulo;
    if (typeof x.ligado !== 'boolean') return { erro: `${nome}: diga se fica ligado ou desligado.` };
    if (typeof x.hora !== 'string' || !HORA.test(x.hora)) return { erro: `${nome}: escolha o horário.` };
    let diaSemana: number | null = null;
    if (ehSemanal(x.tipo)) {
      if (!Number.isInteger(x.diaSemana) || x.diaSemana < 1 || x.diaSemana > 7) return { erro: `${nome}: escolha o dia da semana.` };
      diaSemana = x.diaSemana;
    }
    const regra: RegraDoRelatorio = { ligado: x.ligado, hora: x.hora, diaSemana };
    if (x.tipo === 'boletim_ramo' && x.hora < HORA_MINIMA_DO_BOLETIM) return { erro: `${nome}: escolha um horário a partir de ${HORA_MINIMA_DO_BOLETIM}, depois que o boletim fica pronto.` };
    // Ausente mantém o que está salvo (V16); presente, só booleano (V15).
    if (temConviteOpcional(x.tipo) && x.convidarFora !== undefined) {
      if (typeof x.convidarFora !== 'boolean') return { erro: `${nome}: diga se manda o convite fora das 24 horas.` };
      regra.convidarFora = x.convidarFora;
    }
    if (x.tipo === 'resumo_dia' && x.linhaAmanha !== undefined) {
      if (typeof x.linhaAmanha !== 'boolean') return { erro: `${nome}: diga se a linha "Amanhã" fica ligada ou desligada.` };
      regra.linhaAmanha = x.linhaAmanha;
    }
    fora.push({ tipo: x.tipo, regra });
  }
  return fora;
}

/** O relógio da operação agora: o dia, a hora e o dia da semana (1 = segunda … 7 = domingo). */
export interface AgoraNaOperacao {
  dia: string;
  hora: string;
  diaSemana: number;
}

export interface RelatorioDevido {
  /** O dia do resumo (ou o primeiro dos 7 dias do resumo da semana). */
  referencia: string;
  /** O último dia do resumo (o mesmo dia no resumo do dia). */
  ate: string;
  /** Só nas fichas novas: o horário marcado ('HH:MM') — a janela vai da véspera nesse horário até o dia nesse horário. */
  hora?: string;
}

/**
 * O relatório que vence AGORA — ou null. Vence a partir do horário escolhido e até 3 horas depois (passou disso, não sai:
 * resumo atrasado demais não serve). O horário pode ter sido ontem, quando a hora de agora já virou o dia (23:30 → 00:40).
 *  • Resumo do dia: o dia do envio; marcado antes das 6 h, a noite que passou (o dia anterior ao do envio).
 *  • Resumo da semana e ideias da semana: só no dia da semana escolhido; os 7 dias até a véspera do envio (na segunda, a
 *    semana passada inteira, de segunda a domingo).
 *  • Fichas novas: todo dia, o dia do envio e o horário marcado (as fichas das últimas 24 horas até esse horário).
 *  • Boletim do ramo: todo dia, o boletim do dia do envio.
 */
export function relatorioDevido(tipo: TipoDeRelatorio, regra: RegraDoRelatorio, agora: AgoraNaOperacao): RelatorioDevido | null {
  if (!regra.ligado || !HORA.test(regra.hora) || !HORA.test(agora.hora)) return null;
  let atraso = minutos(agora.hora) - minutos(regra.hora);
  let diaDoEnvio = agora.dia;
  let diaSemanaDoEnvio = agora.diaSemana;
  if (atraso < 0) {
    atraso += 24 * 60;
    diaDoEnvio = somarDias(agora.dia, -1);
    diaSemanaDoEnvio = agora.diaSemana === 1 ? 7 : agora.diaSemana - 1;
  }
  if (atraso > ATRASO_MAXIMO_DO_RELATORIO_MIN) return null;
  if (tipo === 'fichas_novas') return { referencia: diaDoEnvio, ate: diaDoEnvio, hora: regra.hora };
  if (tipo === 'boletim_ramo') return { referencia: diaDoEnvio, ate: diaDoEnvio };
  // A véspera: a referência é o dia do envio, e o aviso fala do dia seguinte.
  if (tipo === 'vespera') return { referencia: diaDoEnvio, ate: diaDoEnvio };
  if (tipo === 'resumo_dia') {
    const dia = minutos(regra.hora) < VIRADA_DA_NOITE_MIN ? somarDias(diaDoEnvio, -1) : diaDoEnvio;
    return { referencia: dia, ate: dia };
  }
  if (diaSemanaDoEnvio !== regra.diaSemana) return null;
  return { referencia: somarDias(diaDoEnvio, -7), ate: somarDias(diaDoEnvio, -1) };
}

const NOME_DO_DIA = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
/** 'AAAA-MM-DD' → 'quinta'. */
export const nomeDoDia = (dia: string): string => NOME_DO_DIA[new Date(`${dia}T12:00:00Z`).getUTCDay()];
/** 'AAAA-MM-DD' → '12/11'. */
export const diaMesDoRelatorio = (dia: string): string => `${dia.slice(8, 10)}/${dia.slice(5, 7)}`;

/**
 * A "pergunta" que o agente recebe para escrever o relatório: a mesma porta das perguntas (as consultas, o filtro de
 * saída, o medidor), com o período escrito por extenso e o começo da mensagem fixo, como no protótipo.
 */
export function perguntaDoRelatorio(tipo: RelatorioDaIa, d: RelatorioDevido): string {
  if (tipo === 'resumo_dia') {
    const titulo = `*Resumo de ${nomeDoDia(d.referencia)}, ${diaMesDoRelatorio(d.referencia)}*`;
    return [
      `Escreva o meu resumo do dia ${diaMesDoRelatorio(d.referencia)} (${d.referencia}), como no fim do expediente.`,
      'Traga os pedidos e as vendas, o faturamento e o ticket médio (se eu vejo valores), o tempo médio dos pedidos, os cancelamentos (quantos e o valor) e o que saiu do lugar: problema no servidor ou na impressora, estoque abaixo do mínimo, atraso fora do comum.',
      `Comece com "${titulo}". Sem pergunta no fim. Se não houve vendas no dia, diga isso em uma linha.`,
      // Versão 5: o texto do resumo vai por escrito; o PDF e o link dele saem do plano do Regem (M5e), nunca da IA.
      'Não use mostrar_grafico: este resumo vai só por escrito.',
    ].join('\n');
  }
  if (tipo === 'ideias_semana') return perguntaDasIdeias(d);
  const titulo = `*Resumo da semana, ${diaMesDoRelatorio(d.referencia)} a ${diaMesDoRelatorio(d.ate)}*`;
  return [
    `Escreva o meu resumo da semana de ${diaMesDoRelatorio(d.referencia)} a ${diaMesDoRelatorio(d.ate)} (de ${d.referencia} até ${d.ate}).`,
    'Traga as vendas e o faturamento comparados com os 7 dias anteriores, os dias mais fortes e os mais fracos, os produtos que mais venderam, os cancelamentos e o que saiu do lugar.',
    `Comece com "${titulo}". Sem pergunta no fim.`,
    'Não use mostrar_grafico: este resumo vai só por escrito.',
  ].join('\n');
}

/** O que a pessoa responde para fazer uma das ideias (fica no fim da mensagem e na instrução da conversa). */
export const FECHO_DAS_IDEIAS = 'Para fazer uma, é só me dizer: "faz a 1", "a 2" ou "a 3".';
/** Por quantos dias as ideias que saíram ficam no bloco da conversa (o "faz a 2" de depois). */
export const DIAS_DAS_IDEIAS_NA_CONVERSA = 3;
/** Até onde o texto das ideias entra no bloco da conversa. */
const IDEIAS_NA_CONVERSA_MAX = 2500;

/**
 * As linhas das ideias no bloco "Esta conversa": o texto que saiu (sem valores para quem não os vê) e o que fazer quando a pessoa
 * pede uma delas — o caminho de sempre, com o botão; os números conferidos de novo.
 */
export function linhasDasIdeias(texto: string, em: Date, verValores: boolean, semValores: (t: string) => string): string[] {
  const limpo = String(texto ?? '').replace(/\r/g, '').trim();
  if (!limpo) return [];
  const dia = em.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', timeZone: FUSO_OPERACAO });
  const corpo = (verValores ? limpo : semValores(limpo)).slice(0, IDEIAS_NA_CONVERSA_MAX);
  return [
    `- As ideias da semana que você mandou a esta pessoa em ${dia} (se ela pedir "faz a 1", "a 2", "a 3" ou falar de uma delas, é uma destas: confira os números de novo e proponha pela ferramenta de sempre, com o botão — nunca faça sem ele):`,
    ...corpo.split('\n').map((l) => `  ${l}`),
  ];
}

/**
 * Versão 10, C8: a "pergunta" das ideias da semana. A IA consulta os números (as mesmas consultas das perguntas) e escreve até 3
 * ideias numeradas, cada uma com o número que a sustenta e o que faria no Regem. Nada é proposto nem feito aqui: a pessoa pede
 * "faz a 2" depois, e aí vale o caminho de sempre (o "Vou fazer" e o botão).
 */
export function perguntaDasIdeias(d: RelatorioDevido): string {
  const titulo = `*Ideias da semana, ${diaMesDoRelatorio(d.referencia)} a ${diaMesDoRelatorio(d.ate)}*`;
  return [
    `Olhe os números da loja nos 7 dias de ${diaMesDoRelatorio(d.referencia)} a ${diaMesDoRelatorio(d.ate)} (de ${d.referencia} até ${d.ate}), comparados com as semanas anteriores, e me traga ATÉ 3 ideias práticas para a próxima semana.`,
    'Consulte o que ajudar: as vendas por dia e por hora, os produtos que mais e menos venderam, os cancelamentos e o motivo, o estoque abaixo do mínimo, o desperdício, as avaliações. Numere as ideias 1, 2 e 3; em cada uma, em poucas linhas: o que os números mostram (com o número e o período), a ideia e o que você faria no Regem para pôr em prática.',
    'Só ideia com número que veio de uma consulta. Sem dado para sustentar, traga menos ideias; se a semana não deu base para nenhuma, diga isso em uma linha.',
    `Não proponha nem faça nada agora (não use propor_acao nem fazer_no_regem). Comece com "${titulo}" e termine com: ${FECHO_DAS_IDEIAS}`,
    'Não use mostrar_grafico: vai só por escrito.',
  ].join('\n');
}

// ───────────────────────────── as fichas novas (F4c das vagas) ─────────────────────────────

/** Quantas fichas o resumo escreve uma a uma; as outras viram "e mais N". */
export const FICHAS_NO_RESUMO_MAX = 15;

/** A janela das fichas no relógio da operação: da véspera no horário marcado até o dia no horário marcado. */
export function janelaDasFichas(d: RelatorioDevido): { desde: string; ate: string } | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d.referencia) || !d.hora || !HORA.test(d.hora)) return null;
  return { desde: `${somarDias(d.referencia, -1)} ${d.hora}:00`, ate: `${d.referencia} ${d.hora}:00` };
}

/** Uma ficha no resumo — o que vai ao WhatsApp. Telefone e endereço NUNCA (decisão 6 do protótipo). */
export interface FichaNoResumo {
  nome: string;
  /** Os nomes das funções escolhidas (já traduzidos do código pela página da loja). */
  funcoes: string[];
  tipoVaga: string;
  escala: string | null;
  distanciaKm: number | null;
  comeca: string;
  loja: string;
}

/** "Bruno Silva Santos" → "Bruno S."; um nome só fica como está. */
export function primeiroNomeEInicial(nome: string): string {
  const partes = String(nome ?? '').trim().split(/\s+/).filter(Boolean);
  if (!partes.length) return 'Sem nome';
  const ultimo = partes.length > 1 ? partes[partes.length - 1] : '';
  return ultimo ? `${partes[0]} ${ultimo.charAt(0).toLocaleUpperCase('pt-BR')}.` : partes[0];
}

/** A vaga em poucas letras: "12x36", "horista", "12x36 ou 5x2", "5x2 ou horista". */
export function vagaDaFicha(f: Pick<FichaNoResumo, 'tipoVaga' | 'escala'>): string {
  const escala = f.escala === 'tanto' ? '12x36 ou 5x2' : f.escala;
  if (f.tipoVaga === 'horista') return 'horista';
  if (f.tipoVaga === 'tanto') return `${escala ?? 'fixa'} ou horista`;
  return escala ?? 'fixa';
}

/** "• Bruno S. — Chapeiro · 12x36 · 4,2 km · começa já" (com a loja no fim quando o resumo junta mais de uma). */
export function linhaDaFicha(f: FichaNoResumo, comLoja: boolean): string {
  const partes = [
    f.funcoes.length ? f.funcoes.join(' / ') : 'função não marcada',
    vagaDaFicha(f),
    f.distanciaKm !== null && Number.isFinite(f.distanciaKm) ? `${String(Math.round(f.distanciaKm * 10) / 10).replace('.', ',')} km` : null,
    f.comeca === 'imediato' ? 'começa já' : null,
    comLoja ? f.loja : null,
  ].filter(Boolean);
  return `• ${primeiroNomeEInicial(f.nome)} — ${partes.join(' · ')}`;
}

/** "Bom dia" até 11:59, "Boa tarde" até 17:59, "Boa noite" no resto. */
export function saudacao(hora: string): string {
  const m = HORA.test(hora) ? minutos(hora) : 9 * 60;
  return m < 12 * 60 ? 'Bom dia' : m < 18 * 60 ? 'Boa tarde' : 'Boa noite';
}

/** '09:00' → '9h'; '09:30' → '9h30'. */
export const horaCurta = (hora: string): string => `${Number(hora.slice(0, 2))}h${hora.slice(3, 5) === '00' ? '' : hora.slice(3, 5)}`;

/**
 * A mensagem do resumo das fichas novas (como no protótipo, caso 1): a saudação pelo horário, quantas chegaram, de qual
 * loja (ou "das suas lojas", com a loja em cada linha), uma linha por ficha até o teto e o endereço da tela.
 */
export function textoDasFichasNovas(p: { nome: string; hora: string; fichas: FichaNoResumo[]; total: number; link: string }): string {
  const lojas = [...new Set(p.fichas.map((f) => f.loja))];
  const varias = lojas.length > 1;
  const primeiro = String(p.nome ?? '').trim().split(/\s+/)[0] || '';
  const quantas = p.total === 1 ? 'Chegou *1 ficha nova*' : `Chegaram *${p.total} fichas novas*`;
  const onde = varias ? 'nas Páginas de vagas das suas lojas' : `na Página de vagas da ${lojas[0] ?? 'loja'}`;
  const linhas = p.fichas.slice(0, FICHAS_NO_RESUMO_MAX).map((f) => linhaDaFicha(f, varias));
  const resto = p.total - linhas.length;
  if (resto > 0) linhas.push(`• e mais ${resto} ${resto === 1 ? 'ficha' : 'fichas'}`);
  return [
    `${saudacao(p.hora)}${primeiro ? `, ${primeiro}` : ''}! ${quantas} ${onde} desde ontem às ${horaCurta(p.hora)}:`,
    '',
    ...linhas,
    '',
    `Ver as fichas: ${p.link}`,
  ].join('\n');
}

// ───────────────────────────── o boletim do ramo (fase N2) ───────────────────────────

export const DESTAQUES_NO_WHATSAPP = 3;
export const NOVIDADES_NO_WHATSAPP = 2;
/** O WhatsApp aceita até 4.096 letras: o que não couber fica para a tela, e o "Mais N notícias" conta. */
export const LIMITE_DO_BOLETIM_NO_WHATSAPP = 3800;

const DIA_CURTO = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
const MES_CURTO = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const ROTULO_DO_INDICADOR: Record<string, string> = { ipca_fora_do_domicilio: 'IPCA fora de casa', selic: 'Selic' };

function linhaDoIndicador(i: IndicadorDoBoletim): string {
  const valor = i.valor.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fonte = i.credito.replace(/^Fonte:\s*/i, '');
  const mes = /^(\d{4})-(\d{2})$/.exec(i.referencia);
  const quando = mes ? `${MES_CURTO[Number(mes[2]) - 1]}/${mes[1].slice(2)}, ` : '';
  return `${ROTULO_DO_INDICADOR[i.id]}: *${valor}%* ${i.unidade.replace(/^%\s*/, '')} (${quando}${fonte})`;
}

/** Uma notícia na mensagem: o título igual ao da fonte, o aviso de "ainda não é lei", o crédito e o link. */
const blocoDaNoticia = (n: NoticiaDoBoletim, antes = ''): string =>
  [`${antes}${n.titulo}`, n.aviso ? `_${n.aviso}_` : null, n.credito, n.link].filter(Boolean).join('\n');

/**
 * A mensagem do boletim, montada sem a IA — ou null quando o dia não tem destaque nem novidade (o Mister fica calado). O
 * título não muda e o crédito vai junto, como pedem os termos das fontes.
 */
export function textoDoBoletim(b: BoletimDoRamo, link: string): string | null {
  const destaques = (b.destaques ?? []).slice(0, DESTAQUES_NO_WHATSAPP);
  const novidades = (b.novidades ?? []).slice(0, NOVIDADES_NO_WHATSAPP);
  if (!destaques.length && !novidades.length) return null;
  const data = new Date(`${b.dia}T12:00:00Z`);
  const indicadores = ['ipca_fora_do_domicilio', 'selic']
    .map((id) => (b.indicadores ?? []).find((i) => i.id === id))
    .filter((i): i is IndicadorDoBoletim => !!i)
    .map(linhaDoIndicador);
  const partes = [`*Boletim do ramo · ${DIA_CURTO[data.getUTCDay()]}, ${diaMesDoRelatorio(b.dia)}*`];
  if (indicadores.length) partes.push(indicadores.join('\n'));
  const cabe = (t: string) => [...partes, t].join('\n\n').length + link.length + 40 <= LIMITE_DO_BOLETIM_NO_WHATSAPP;
  let mostradas = 0;
  destaques.forEach((n, i) => {
    const t = blocoDaNoticia(n, `*${i + 1}.* `);
    if (cabe(t)) {
      partes.push(t);
      mostradas++;
    }
  });
  let comTitulo = false;
  for (const n of novidades) {
    const t = comTitulo ? blocoDaNoticia(n) : `*Novidades e tendências*\n${blocoDaNoticia(n)}`;
    if (!cabe(t)) continue;
    partes.push(t);
    comTitulo = true;
    mostradas++;
  }
  const total = (b.destaques?.length ?? 0) + (b.novidades?.length ?? 0) + (b.mais?.length ?? 0);
  const resto = total - mostradas;
  partes.push(resto > 0 ? `Mais ${resto} ${resto === 1 ? 'notícia' : 'notícias'} no Regem:\n${link}` : `Ver no Regem:\n${link}`);
  return partes.join('\n\n');
}
