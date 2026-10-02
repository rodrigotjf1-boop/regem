// Eventos sazonais do cardápio público (docs/templates-cardapio/06-eventos-sazonais.md): calendário,
// configuração da loja e o evento que está no ar. Funções puras — sem banco e sem relógio (quem
// chama passa a hora). A arte e os textos padrão de cada evento são do front; aqui só entra o que
// decide QUAL evento vale e o que o presidente personalizou.
//
// Regra de base: nenhum evento liga sozinho. Só entra no ar o que o presidente ligou em
// Delivery → Configurações → Eventos, e só dentro do período dele.

/** Ordem fixa: é também o desempate entre eventos de mesma prioridade (vale o primeiro). */
export const EVENTOS_CARDAPIO = [
  'reveillon', 'carnaval', 'pascoa', 'maes', 'hamburguer', 'namorados', 'junina', 'pais',
  'criancas', 'halloween', 'blackfriday', 'natal', 'jogo',
] as const;
export type EventoChave = (typeof EVENTOS_CARDAPIO)[number];

export const NOME_EVENTO: Record<EventoChave, string> = {
  reveillon: 'Réveillon',
  carnaval: 'Carnaval',
  pascoa: 'Páscoa',
  maes: 'Dia das Mães',
  hamburguer: 'Dia do Hambúrguer',
  namorados: 'Dia dos Namorados',
  junina: 'Festa Junina',
  pais: 'Dia dos Pais',
  criancas: 'Dia das Crianças',
  halloween: 'Halloween',
  blackfriday: 'Black Friday',
  natal: 'Natal',
  jogo: 'Dia de jogo',
};

/** Eventos com mini-jogo que libera um cupom da loja. */
export const EVENTOS_COM_JOGO: readonly EventoChave[] = ['pascoa', 'halloween'];

/** Quando dois períodos se cruzam: Namorados e Dia do Hambúrguer vencem; Festa Junina cede. */
const PRIORIDADE: Partial<Record<EventoChave, number>> = { namorados: 3, hamburguer: 3, junina: 1 };

export function ehEventoCardapio(v: unknown): v is EventoChave {
  return typeof v === 'string' && (EVENTOS_CARDAPIO as readonly string[]).includes(v);
}

// ---------- datas (dia civil 'AAAA-MM-DD', sem fuso: a conta é em UTC puro) ----------

const DIA_MS = 86_400_000;
const paraDia = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const deDia = (d: string) => Date.parse(`${d}T00:00:00Z`);
export const diaDe = (ano: number, mes: number, dia: number) => paraDia(Date.UTC(ano, mes - 1, dia));
export const somarDias = (d: string, n: number) => paraDia(deDia(d) + n * DIA_MS);
const diaDaSemana = (d: string) => new Date(deDia(d)).getUTCDay();

/** Domingo de Páscoa (cômputo gregoriano de Meeus/Jones/Butcher). */
export function pascoaDe(ano: number): string {
  const a = ano % 19;
  const b = Math.floor(ano / 100);
  const c = ano % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * m + 114) / 31);
  const dia = ((h + l - 7 * m + 114) % 31) + 1;
  return diaDe(ano, mes, dia);
}

/** O n-ésimo domingo do mês. */
export function domingoN(ano: number, mes: number, n: number): string {
  const primeiro = diaDe(ano, mes, 1);
  return somarDias(primeiro, ((7 - diaDaSemana(primeiro)) % 7) + 7 * (n - 1));
}

/** Sexta-feira seguinte à 4ª quinta-feira de novembro. */
export function blackFridayDe(ano: number): string {
  const primeiro = diaDe(ano, 11, 1);
  return somarDias(primeiro, ((4 - diaDaSemana(primeiro) + 7) % 7) + 22);
}

/**
 * O DIA de cada evento no ano e o período padrão em volta dele. O presidente muda só os "dias
 * antes" e os "dias depois" — por isso a regra serve igual para data fixa (Natal) e para data
 * móvel (Páscoa, Carnaval, Mães, Pais, Black Friday), e o Réveillon cruza o ano sem tratamento
 * especial (o dia é 1º de janeiro; o período começa 6 dias antes).
 */
const CALENDARIO: Record<Exclude<EventoChave, 'jogo'>, { dia: (ano: number) => string; antes: number; depois: number }> = {
  reveillon: { dia: (a) => diaDe(a, 1, 1), antes: 6, depois: 0 },
  carnaval: { dia: (a) => somarDias(pascoaDe(a), -47), antes: 4, depois: 1 }, // sexta até a quarta de cinzas
  pascoa: { dia: pascoaDe, antes: 7, depois: 0 },
  maes: { dia: (a) => domingoN(a, 5, 2), antes: 7, depois: 0 },
  hamburguer: { dia: (a) => diaDe(a, 5, 28), antes: 7, depois: 0 },
  namorados: { dia: (a) => diaDe(a, 6, 12), antes: 7, depois: 0 },
  junina: { dia: (a) => diaDe(a, 6, 24), antes: 23, depois: 6 }, // junho inteiro
  pais: { dia: (a) => domingoN(a, 8, 2), antes: 7, depois: 0 },
  criancas: { dia: (a) => diaDe(a, 10, 12), antes: 11, depois: 0 },
  halloween: { dia: (a) => diaDe(a, 10, 31), antes: 11, depois: 0 },
  blackfriday: { dia: blackFridayDe, antes: 4, depois: 2 }, // segunda a domingo
  natal: { dia: (a) => diaDe(a, 12, 25), antes: 24, depois: 0 },
};

export const MAX_DIAS_ANTES = 60;
export const MAX_DIAS_DEPOIS = 30;
/** Dia de jogo: o tema liga 3 h antes do horário e desliga 2h30 depois. */
export const JOGO_ANTES_MS = 3 * 3_600_000;
export const JOGO_DEPOIS_MS = 2.5 * 3_600_000;
export const MAX_JOGOS = 40;
export const MAX_CHAMADA = 40;
export const MAX_TITULO = 40;
export const MAX_TEXTO = 120;
export const MAX_COLECAO = 12;

// ---------- configuração guardada em `cardapio_config.tema_config.eventos` ----------

export interface EventoConfig {
  ativo: boolean;
  diasAntes?: number;
  diasDepois?: number;
  titulo?: string;
  texto?: string;
  colecao?: string[];
  /** Só Páscoa e Halloween: id do cupom da loja que o mini-jogo libera. */
  cupomJogo?: string | null;
}
export interface JogoCadastrado {
  /** Horário do jogo, sempre de Brasília: `AAAA-MM-DDTHH:MM:00-03:00`. */
  inicio: string;
  chamada?: string;
}
export interface EventosConfig {
  animacoes: boolean;
  coresDoEvento: boolean;
  jogos: JogoCadastrado[];
  porEvento: Partial<Record<EventoChave, EventoConfig>>;
}

export const EVENTOS_PADRAO: EventosConfig = { animacoes: true, coresDoEvento: true, jogos: [], porEvento: {} };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const inteiroEntre = (v: unknown, min: number, max: number): number | undefined => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isInteger(n) && n >= min && n <= max ? n : undefined;
};
const textoCurto = (v: unknown, max: number): string | undefined => {
  if (typeof v !== 'string') return undefined;
  const t = v.replace(/\s+/g, ' ').trim();
  return t ? t.slice(0, max) : undefined;
};

/** Horário de Brasília (`AAAA-MM-DDTHH:MM`, com ou sem segundos e fuso) → forma guardada. Brasília é UTC−3 o ano todo. */
export function normalizarHorarioJogo(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const m = v.trim().match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!m) return null;
  const iso = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:00-03:00`;
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  // `Date.parse` aceita 31/02 virando março: confere que o dia é o mesmo que foi escrito.
  if (new Date(ms - 3 * 3_600_000).toISOString().slice(0, 16) !== `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}`) return null;
  return iso;
}

/**
 * Lê o que está gravado (ou qualquer coisa) e devolve uma configuração bem formada. Tolerante:
 * campo torto é ignorado, nunca derruba o cardápio público.
 */
export function lerEventos(bruto: unknown): EventosConfig {
  const b = bruto && typeof bruto === 'object' ? (bruto as Record<string, unknown>) : {};
  const porEvento: EventosConfig['porEvento'] = {};
  const pe = b.porEvento && typeof b.porEvento === 'object' ? (b.porEvento as Record<string, unknown>) : {};
  for (const chave of EVENTOS_CARDAPIO) {
    const e = pe[chave];
    if (!e || typeof e !== 'object') continue;
    const r = e as Record<string, unknown>;
    const item: EventoConfig = { ativo: r.ativo === true };
    const antes = inteiroEntre(r.diasAntes, 0, MAX_DIAS_ANTES);
    const depois = inteiroEntre(r.diasDepois, 0, MAX_DIAS_DEPOIS);
    if (antes !== undefined) item.diasAntes = antes;
    if (depois !== undefined) item.diasDepois = depois;
    const titulo = textoCurto(r.titulo, MAX_TITULO);
    const texto = textoCurto(r.texto, MAX_TEXTO);
    if (titulo) item.titulo = titulo;
    if (texto) item.texto = texto;
    if (Array.isArray(r.colecao)) {
      const ids = [...new Set(r.colecao.filter((x): x is string => typeof x === 'string' && UUID.test(x)))].slice(0, MAX_COLECAO);
      if (ids.length) item.colecao = ids;
    }
    if (typeof r.cupomJogo === 'string' && UUID.test(r.cupomJogo) && EVENTOS_COM_JOGO.includes(chave)) item.cupomJogo = r.cupomJogo;
    porEvento[chave] = item;
  }
  const jogos: JogoCadastrado[] = [];
  if (Array.isArray(b.jogos)) {
    for (const j of b.jogos) {
      if (!j || typeof j !== 'object') continue;
      const inicio = normalizarHorarioJogo((j as Record<string, unknown>).inicio);
      if (!inicio) continue;
      const chamada = textoCurto((j as Record<string, unknown>).chamada, MAX_CHAMADA);
      jogos.push(chamada ? { inicio, chamada } : { inicio });
    }
  }
  jogos.sort((x, y) => Date.parse(x.inicio) - Date.parse(y.inicio));
  return {
    animacoes: b.animacoes !== false,
    coresDoEvento: b.coresDoEvento !== false,
    jogos: jogos.slice(0, MAX_JOGOS),
    porEvento,
  };
}

// ---------- Dia de jogo: nada de time nem de campeonato ----------

// A arte é neutra (gramado e bola) porque nome de clube e de campeonato é marca de terceiro. A
// chamada é o único texto livre do Dia de jogo: recusa os nomes mais prováveis. A lista não
// pretende ser completa — o aviso da tela é a regra; isto pega o descuido.
const TERMOS_PROIBIDOS = [
  'flamengo', 'fluminense', 'vasco', 'botafogo', 'palmeiras', 'corinthians', 'sao paulo fc', 'spfc', 'santos fc',
  'gremio', 'internacional', 'cruzeiro', 'atletico', 'athletico', 'bahia', 'bragantino', 'mirassol', 'coritiba',
  'chapecoense', 'avai', 'criciuma', 'ponte preta', 'guarani', 'novorizontino', 'paysandu', 'vila nova', 'ceara sc',
  'mengao', 'timao', 'verdao', 'tricolor', 'galo', 'fogao', 'vascao', 'colorado',
  'brasileirao', 'campeonato brasileiro', 'libertadores', 'copa do brasil', 'sul americana', 'sulamericana',
  'champions', 'copa do mundo', 'mundial de clubes', 'fifa', 'cbf', 'conmebol', 'uefa', 'premier league', 'la liga',
  'serie a', 'serie b', 'paulistao', 'cariocao', 'eurocopa', 'copa america',
];
const semAcento = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** O termo proibido que a chamada contém (palavra inteira), ou `null`. */
export function termoProibidoNaChamada(chamada: string): string | null {
  const alvo = ` ${semAcento(chamada)} `;
  for (const t of TERMOS_PROIBIDOS) if (alvo.includes(` ${t} `)) return t;
  return null;
}

// ---------- gravação: o que o presidente mandou, conferido ----------

export class EventosInvalidos extends Error {}

const booleano = (v: unknown, campo: string): boolean => {
  if (v === true || v === 'true') return true;
  if (v === false || v === 'false') return false;
  throw new EventosInvalidos(`Informe "${campo}" (true ou false).`);
};

/**
 * Junta o que veio na gravação com o que já estava guardado. Campo AUSENTE mantém o valor atual
 * (salvar só "ligar o Natal" não apaga os textos dele nem os jogos cadastrados); campo presente e
 * torto é recusado com a frase do motivo. `agora` serve só para descartar jogo que já passou.
 */
export function aplicarEventos(atual: EventosConfig, dto: unknown, agora: Date): EventosConfig {
  if (!dto || typeof dto !== 'object' || Array.isArray(dto)) throw new EventosInvalidos('Envie a configuração dos eventos.');
  const d = dto as Record<string, unknown>;
  const novo: EventosConfig = { ...atual, jogos: [...atual.jogos], porEvento: { ...atual.porEvento } };
  if ('animacoes' in d) novo.animacoes = booleano(d.animacoes, 'animacoes');
  if ('coresDoEvento' in d) novo.coresDoEvento = booleano(d.coresDoEvento, 'coresDoEvento');

  if ('porEvento' in d) {
    if (!d.porEvento || typeof d.porEvento !== 'object' || Array.isArray(d.porEvento)) throw new EventosInvalidos('"porEvento" tem de ser um objeto.');
    for (const [chave, bruto] of Object.entries(d.porEvento as Record<string, unknown>)) {
      if (!ehEventoCardapio(chave)) throw new EventosInvalidos(`Evento desconhecido: ${chave}.`);
      if (!bruto || typeof bruto !== 'object' || Array.isArray(bruto)) throw new EventosInvalidos(`Configuração inválida para ${NOME_EVENTO[chave]}.`);
      const r = bruto as Record<string, unknown>;
      const nome = NOME_EVENTO[chave];
      const item: EventoConfig = { ...(novo.porEvento[chave] ?? { ativo: false }) };
      if ('ativo' in r) item.ativo = booleano(r.ativo, `${nome}: ativo`);
      for (const [campo, max] of [['diasAntes', MAX_DIAS_ANTES], ['diasDepois', MAX_DIAS_DEPOIS]] as const) {
        if (!(campo in r)) continue;
        if (r[campo] === null || r[campo] === '') { delete item[campo]; continue; } // volta ao período padrão
        if (chave === 'jogo') throw new EventosInvalidos('O Dia de jogo não tem período: ele segue o horário de cada jogo.');
        const n = inteiroEntre(r[campo], 0, max);
        if (n === undefined) throw new EventosInvalidos(`${nome}: "${campo === 'diasAntes' ? 'dias antes' : 'dias depois'}" vai de 0 a ${max}.`);
        item[campo] = n;
      }
      for (const [campo, max] of [['titulo', MAX_TITULO], ['texto', MAX_TEXTO]] as const) {
        if (!(campo in r)) continue;
        if (r[campo] === null || r[campo] === '') { delete item[campo]; continue; } // volta ao texto padrão
        if (typeof r[campo] !== 'string') throw new EventosInvalidos(`${nome}: ${campo === 'titulo' ? 'título' : 'texto'} inválido.`);
        const t = String(r[campo]).replace(/\s+/g, ' ').trim();
        if (t.length > max) throw new EventosInvalidos(`${nome}: o ${campo === 'titulo' ? 'título' : 'texto'} tem no máximo ${max} caracteres.`);
        if (t) item[campo] = t;
        else delete item[campo];
      }
      if ('colecao' in r) {
        if (r.colecao === null) delete item.colecao;
        else {
          if (!Array.isArray(r.colecao) || r.colecao.some((x) => typeof x !== 'string' || !UUID.test(x))) throw new EventosInvalidos(`${nome}: a coleção é uma lista de produtos.`);
          const ids = [...new Set(r.colecao as string[])];
          if (ids.length > MAX_COLECAO) throw new EventosInvalidos(`${nome}: a coleção tem no máximo ${MAX_COLECAO} produtos.`);
          if (ids.length) item.colecao = ids;
          else delete item.colecao;
        }
      }
      if ('cupomJogo' in r) {
        if (r.cupomJogo === null || r.cupomJogo === '') delete item.cupomJogo;
        else {
          if (!EVENTOS_COM_JOGO.includes(chave)) throw new EventosInvalidos(`${nome} não tem jogo com cupom.`);
          if (typeof r.cupomJogo !== 'string' || !UUID.test(r.cupomJogo)) throw new EventosInvalidos(`${nome}: cupom do jogo inválido.`);
          item.cupomJogo = r.cupomJogo;
        }
      }
      novo.porEvento[chave] = item;
    }
  }

  if ('jogos' in d) {
    if (!Array.isArray(d.jogos)) throw new EventosInvalidos('"jogos" tem de ser uma lista.');
    if (d.jogos.length > MAX_JOGOS) throw new EventosInvalidos(`Cadastre no máximo ${MAX_JOGOS} jogos.`);
    const vistos = new Set<string>();
    const jogos: JogoCadastrado[] = [];
    for (const j of d.jogos) {
      const r = j && typeof j === 'object' ? (j as Record<string, unknown>) : {};
      const inicio = normalizarHorarioJogo(r.inicio);
      if (!inicio) throw new EventosInvalidos('Informe a data e a hora de cada jogo.');
      // Jogo que já acabou (janela encerrada) não volta a ser gravado.
      if (Date.parse(inicio) + JOGO_DEPOIS_MS < agora.getTime()) continue;
      if (vistos.has(inicio)) continue;
      vistos.add(inicio);
      let chamada: string | undefined;
      if (r.chamada !== undefined && r.chamada !== null && r.chamada !== '') {
        if (typeof r.chamada !== 'string') throw new EventosInvalidos('Chamada do jogo inválida.');
        const t = r.chamada.replace(/\s+/g, ' ').trim();
        if (t.length > MAX_CHAMADA) throw new EventosInvalidos(`A chamada do jogo tem no máximo ${MAX_CHAMADA} caracteres.`);
        const proibido = termoProibidoNaChamada(t);
        if (proibido) throw new EventosInvalidos(`Não use nome de time nem de campeonato na chamada do jogo ("${proibido}").`);
        if (t) chamada = t;
      }
      jogos.push(chamada ? { inicio, chamada } : { inicio });
    }
    jogos.sort((x, y) => Date.parse(x.inicio) - Date.parse(y.inicio));
    novo.jogos = jogos;
  }
  return novo;
}

// ---------- qual evento está no ar ----------

export interface JanelaEvento {
  /** Primeiro e último dia do período, e o dia do evento em si. */
  inicio: string;
  fim: string;
  dia: string;
}

const FORMATO_DIA_SP = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' });

/** O dia civil em Brasília (`AAAA-MM-DD`) de um instante — o mesmo para todo cliente, onde quer que esteja. */
export function diaEmBrasilia(agora: Date): string {
  return FORMATO_DIA_SP.format(agora);
}

function janelaNoAno(chave: Exclude<EventoChave, 'jogo'>, ano: number, cfg?: EventoConfig): JanelaEvento {
  const c = CALENDARIO[chave];
  const dia = c.dia(ano);
  return { inicio: somarDias(dia, -(cfg?.diasAntes ?? c.antes)), fim: somarDias(dia, cfg?.diasDepois ?? c.depois), dia };
}

/** O período padrão (dias antes e depois do dia do evento). */
export function periodoPadrao(chave: Exclude<EventoChave, 'jogo'>): { antes: number; depois: number } {
  const c = CALENDARIO[chave];
  return { antes: c.antes, depois: c.depois };
}

/** A próxima ocorrência do evento: a que está em curso hoje ou, se não houver, a seguinte. */
export function proximaJanela(chave: Exclude<EventoChave, 'jogo'>, hoje: string, cfg?: EventoConfig): JanelaEvento {
  const ano = Number(hoje.slice(0, 4));
  for (const a of [ano - 1, ano, ano + 1]) {
    const j = janelaNoAno(chave, a, cfg);
    if (j.fim >= hoje) return j;
  }
  return janelaNoAno(chave, ano + 2, cfg);
}

/** O jogo cuja janela (3 h antes até 2h30 depois) contém o instante. */
export function jogoNoAr(jogos: JogoCadastrado[], agora: Date): JogoCadastrado | null {
  const t = agora.getTime();
  return jogos.find((j) => { const i = Date.parse(j.inicio); return t >= i - JOGO_ANTES_MS && t <= i + JOGO_DEPOIS_MS; }) ?? null;
}

/** O próximo jogo que ainda não acabou. */
export function proximoJogo(jogos: JogoCadastrado[], agora: Date): JogoCadastrado | null {
  const t = agora.getTime();
  return jogos.find((j) => Date.parse(j.inicio) + JOGO_DEPOIS_MS >= t) ?? null;
}

/** O que o cardápio público recebe: o evento já decidido, com o que a loja personalizou. */
export interface EventoResolvido {
  chave: EventoChave;
  inicio: string;
  fim: string;
  dia: string;
  /** `null` = a tela usa o texto padrão do evento. */
  titulo: string | null;
  texto: string | null;
  /** Ids de produto escolhidos; vazio = a tela monta a coleção com os destaques da loja. */
  colecao: string[];
  cores: boolean;
  animacoes: boolean;
  /** Só no Dia de jogo: o horário do jogo, quando o tema sai do ar e a chamada. */
  partida: { inicio: string; fim: string; chamada: string | null } | null;
  /** Id do cupom do mini-jogo (o serviço troca pelo código antes de responder). */
  cupomJogoId: string | null;
  /** Veio pelo link de prévia (`?evento=`), fora do período ou desligado. */
  previa: boolean;
}

function resolvido(chave: EventoChave, cfg: EventosConfig, janela: JanelaEvento, partida: EventoResolvido['partida'], previa: boolean): EventoResolvido {
  const e = cfg.porEvento[chave];
  return {
    chave,
    ...janela,
    titulo: e?.titulo ?? null,
    texto: e?.texto ?? null,
    colecao: e?.colecao ?? [],
    cores: cfg.coresDoEvento,
    animacoes: cfg.animacoes,
    partida,
    cupomJogoId: EVENTOS_COM_JOGO.includes(chave) ? e?.cupomJogo ?? null : null,
    previa,
  };
}

const partidaDe = (j: JogoCadastrado): NonNullable<EventoResolvido['partida']> => ({
  inicio: j.inicio,
  fim: new Date(Date.parse(j.inicio) + JOGO_DEPOIS_MS).toISOString(),
  chamada: j.chamada ?? null,
});

/**
 * O evento que vale agora: só os que o presidente ligou, e só dentro do período. O Dia de jogo
 * vence qualquer outro enquanto durar a janela do jogo; entre os demais vale a prioridade e, no
 * empate, a ordem de `EVENTOS_CARDAPIO` (ex.: Black Friday e Natal em 01/12 → Black Friday).
 */
export function eventoNoAr(cfg: EventosConfig, agora: Date): EventoResolvido | null {
  if (cfg.porEvento.jogo?.ativo) {
    const j = jogoNoAr(cfg.jogos, agora);
    if (j) {
      const d = diaEmBrasilia(new Date(Date.parse(j.inicio)));
      return resolvido('jogo', cfg, { inicio: d, fim: d, dia: d }, partidaDe(j), false);
    }
  }
  const hoje = diaEmBrasilia(agora);
  let melhor: { chave: EventoChave; janela: JanelaEvento } | null = null;
  for (const chave of EVENTOS_CARDAPIO) {
    if (chave === 'jogo' || !cfg.porEvento[chave]?.ativo) continue;
    const janela = proximaJanela(chave, hoje, cfg.porEvento[chave]);
    if (hoje < janela.inicio || hoje > janela.fim) continue;
    if (!melhor || (PRIORIDADE[chave] ?? 2) > (PRIORIDADE[melhor.chave] ?? 2)) melhor = { chave, janela };
  }
  return melhor ? resolvido(melhor.chave, cfg, melhor.janela, null, false) : null;
}

/**
 * Prévia de um evento pelo link (`?evento=natal`): mostra o evento como ficaria, esteja ligado ou
 * não e em qualquer data — é o "Ver prévia" do painel. Não muda a escolha da loja.
 */
export function eventoEmPrevia(cfg: EventosConfig, chave: EventoChave, agora: Date): EventoResolvido {
  if (chave === 'jogo') {
    // Sem jogo cadastrado, simula um que começa em 45 minutos (a contagem aparece).
    const j = proximoJogo(cfg.jogos, agora) ?? { inicio: new Date(agora.getTime() + 45 * 60_000).toISOString() };
    const d = diaEmBrasilia(new Date(Date.parse(j.inicio)));
    return resolvido('jogo', cfg, { inicio: d, fim: d, dia: d }, partidaDe(j), true);
  }
  return resolvido(chave, cfg, proximaJanela(chave, diaEmBrasilia(agora), cfg.porEvento[chave]), null, true);
}

/** A agenda que o painel mostra: a próxima ocorrência de cada evento, na ordem em que acontecem. */
export function agendaDeEventos(cfg: EventosConfig, agora: Date) {
  const hoje = diaEmBrasilia(agora);
  const noAr = eventoNoAr(cfg, agora)?.chave ?? null;
  const linhas = EVENTOS_CARDAPIO.filter((c): c is Exclude<EventoChave, 'jogo'> => c !== 'jogo').map((chave) => {
    const janela = proximaJanela(chave, hoje, cfg.porEvento[chave]);
    return {
      chave,
      nome: NOME_EVENTO[chave],
      ...janela,
      ativo: cfg.porEvento[chave]?.ativo === true,
      noPeriodo: hoje >= janela.inicio && hoje <= janela.fim,
      noAr: noAr === chave,
      periodoPadrao: periodoPadrao(chave),
      temJogo: EVENTOS_COM_JOGO.includes(chave),
    };
  });
  linhas.sort((x, y) => (x.inicio < y.inicio ? -1 : x.inicio > y.inicio ? 1 : 0));
  return linhas;
}
