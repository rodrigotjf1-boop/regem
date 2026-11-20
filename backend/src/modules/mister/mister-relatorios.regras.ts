import { somarDias } from '../../common/data';

// OS RELATÓRIOS DO MISTER (mig 420; protótipo `mockups/regem-mister.html`, "Avisos e relatórios" › Relatórios): o resumo do
// dia e o resumo da semana, no horário que a empresa escolhe. Regras puras: o padrão, a conferência do que a tela manda,
// QUANDO cada relatório vence e a pergunta que o agente recebe para escrevê-lo.
// F4c das vagas (protótipo `mockups/regem-vagas-talentos.html`, aprovado 15/11): as FICHAS NOVAS de candidatos — só conta,
// sem a IA; vai a quem pode ver os candidatos (presidente e quem tem a permissão Candidatos); só no dia em que chegou ficha.

export const TIPOS_DE_RELATORIO = ['resumo_dia', 'resumo_semana', 'fichas_novas'] as const;
export type TipoDeRelatorio = (typeof TIPOS_DE_RELATORIO)[number];
/** Os relatórios que a IA escreve (o de fichas novas só conta, sem a IA). */
export type RelatorioDaIa = Exclude<TipoDeRelatorio, 'fichas_novas'>;
export const ehTipoDeRelatorio = (t: unknown): t is TipoDeRelatorio => TIPOS_DE_RELATORIO.includes(t as TipoDeRelatorio);

export interface RegraDoRelatorio {
  ligado: boolean;
  /** 'HH:MM' no relógio da operação. */
  hora: string;
  /** 1 = segunda … 7 = domingo (só o resumo da semana). */
  diaSemana: number | null;
}

/** Como o protótipo: todos desligados; o do dia às 23:30, o da semana na segunda às 09:00, o das fichas às 09:00. */
export const PADRAO_DO_RELATORIO: Record<TipoDeRelatorio, RegraDoRelatorio> = {
  resumo_dia: { ligado: false, hora: '23:30', diaSemana: null },
  resumo_semana: { ligado: false, hora: '09:00', diaSemana: 1 },
  fichas_novas: { ligado: false, hora: '09:00', diaSemana: null },
};

export const RELATORIO_NA_TELA: Record<TipoDeRelatorio, { titulo: string; descricao: string; vaiPara?: string; usaIa: boolean }> = {
  resumo_dia: { titulo: 'Resumo do dia', descricao: 'Pedidos, vendas, tempo médio, cancelamentos e o que saiu do lugar.', usaIa: true },
  resumo_semana: { titulo: 'Resumo da semana', descricao: 'Os 7 dias até a véspera contra os 7 anteriores.', usaIa: true },
  fichas_novas: {
    titulo: 'Fichas novas de candidatos',
    descricao:
      'As fichas que chegaram na Página de vagas desde o último resumo: nome, função, escala e distância. Só nos dias em que chegou ficha. Sem telefone nem endereço no WhatsApp.',
    vaiPara: 'o presidente e quem tem a permissão Candidatos, cada um só das lojas que vê',
    usaIa: false,
  },
};

/** O nome do recurso no medidor da IA ("Uso da IA"): cada relatório soma no seu. */
export const RECURSO_DO_RELATORIO: Record<RelatorioDaIa, string> = { resumo_dia: 'mister_resumo_dia', resumo_semana: 'mister_resumo_semana' };

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
  return {
    ligado: typeof salva.ligado === 'boolean' ? salva.ligado : p.ligado,
    hora: typeof salva.hora === 'string' && HORA.test(salva.hora) ? salva.hora : p.hora,
    diaSemana: tipo === 'resumo_semana' ? (Number.isInteger(dia) && dia >= 1 && dia <= 7 ? dia : p.diaSemana) : null,
  };
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
    if (x.tipo === 'resumo_semana') {
      if (!Number.isInteger(x.diaSemana) || x.diaSemana < 1 || x.diaSemana > 7) return { erro: `${nome}: escolha o dia da semana.` };
      diaSemana = x.diaSemana;
    }
    fora.push({ tipo: x.tipo, regra: { ligado: x.ligado, hora: x.hora, diaSemana } });
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
 *  • Resumo da semana: só no dia da semana escolhido; os 7 dias até a véspera do envio (na segunda, a semana passada
 *    inteira, de segunda a domingo).
 *  • Fichas novas: todo dia, o dia do envio e o horário marcado (as fichas das últimas 24 horas até esse horário).
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
  const titulo = `*Resumo da semana, ${diaMesDoRelatorio(d.referencia)} a ${diaMesDoRelatorio(d.ate)}*`;
  return [
    `Escreva o meu resumo da semana de ${diaMesDoRelatorio(d.referencia)} a ${diaMesDoRelatorio(d.ate)} (de ${d.referencia} até ${d.ate}).`,
    'Traga as vendas e o faturamento comparados com os 7 dias anteriores, os dias mais fortes e os mais fracos, os produtos que mais venderam, os cancelamentos e o que saiu do lugar.',
    `Comece com "${titulo}". Sem pergunta no fim.`,
    'Não use mostrar_grafico: este resumo vai só por escrito.',
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
