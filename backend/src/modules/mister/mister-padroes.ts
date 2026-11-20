import { trechosDoDia, type HorarioDoDia } from '../../common/pedido-agendado';
import { somarDias } from '../../common/data';

// OS PADRÕES QUE O MISTER PERCEBE (versão 6, M6f parte 2; plano aprovado em 20/11/2026, `docs/plano-mister.md` § "Versão 6",
// "Padrões (a parte que aprende)"; protótipo `mockups/regem-mister-v6.html`, "Regras", conversas 8 e 9; decisão V6-12; mig
// 478). Pelo código e sem IA, uma vez por dia, com o que aconteceu até ontem. Aqui só o que é puro: achar o padrão, as
// frases, os botões e a regra que cada sugestão propõe (a linguagem da M6e, conferida por `conferirRegra` como a da
// conversa). O exemplo do dono: "uma impressora tem de estar ligada dentro do horário do expediente; caso alguém desligue
// antes, e acontece em várias situações, então é porque aquele equipamento é desligado antes do horário de fechamento".

/** Quantos dias para trás o Mister olha, e em quantos deles o padrão precisa ter acontecido. */
export const DIAS_OLHADOS = 14;
export const MINIMO_DE_DIAS = 3;
/** "Não, deixa assim" (e a sugestão sem resposta) cala o padrão por estes dias (decisão V6-12). */
export const CALADO_DIAS = 30;
/** Os avisos de pedido parado de ontem sem nenhuma resposta da pessoa, a partir dos quais o Mister sugere juntar. */
export const MINIMO_DE_AVISOS_SEM_RESPOSTA = 10;
/** A regra que junta os avisos: avisar quando forem estes ou mais ao mesmo tempo (o protótipo). */
export const JUNTAR_A_PARTIR_DE = 3;
/** Numa hora, quantos pedidos demorados fazem daquele dia um dia de atraso naquela faixa. */
export const ATRASOS_NA_HORA = 2;
/** A faixa do atraso tem no máximo estas horas seguidas. */
export const FAIXA_MAXIMA_H = 3;
/** O tempo do pedido parado quando a empresa não escolheu (o padrão do aviso, 15/20/30). */
export const TEMPO_PADRAO_DO_PEDIDO_MIN = 20;

export type TipoDoPadrao = 'impressora_antes_do_fechamento' | 'avisos_sem_resposta' | 'atrasos_na_faixa';

const HHMM_SP = (d: Date) => new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(d);
const hora2 = (h: number) => `${String(h).padStart(2, '0')}:00`;

// ───────────────────────────── 1. a impressora desligada antes do fechamento ─────────────────────────────

/** O nome da impressora no incidente do vigia — o MESMO da fonte `equipamentos` das regras (o filtro "nome" casa por ele). */
export const nomeDaImpressora = (evidencia: unknown): string => {
  const ev = (evidencia ?? {}) as { impressora?: unknown; nome?: unknown };
  return String(ev.impressora ?? ev.nome ?? 'impressora').trim();
};

/** Uma parada da impressora (um incidente `impressora_parada` do vigia): quando começou e quando voltou (null = não voltou). */
export interface ParadaDaImpressora {
  chave: string;
  nome: string;
  inicio: Date;
  voltou: Date | null;
}

export interface PadraoDaImpressora {
  chave: string;
  nome: string;
  /** Em quantos dos últimos `DIAS_OLHADOS` dias ela parou dentro do horário e não voltou até fechar. */
  dias: number;
  /** A faixa de horário em que as paradas começaram ("22:30" a "23:10"). */
  de: string;
  ate: string;
}

/**
 * A parada que começou DENTRO de um trecho do horário da loja e não voltou antes do fim dele, em `MINIMO_DE_DIAS` ou mais
 * dos últimos `DIAS_OLHADOS` dias. Uma linha por impressora; a faixa é a das horas em que as paradas começaram. `hoje` = o
 * dia de São Paulo (AAAA-MM-DD); hoje não conta (ainda não fechou). Sem horário cadastrado não há padrão: a loja que não
 * diz quando fecha não tem "antes do fechamento".
 */
export function padroesDaImpressora(paradas: ParadaDaImpressora[], horarios: HorarioDoDia[] | null | undefined, hoje: string): PadraoDaImpressora[] {
  if (!Array.isArray(horarios) || !horarios.length) return [];
  const porImpressora = new Map<string, { nome: string; dias: Set<string>; horas: string[] }>();
  // Do dia mais antigo ao mais novo, e cada parada conta UMA vez: no horário que vira a noite (18:00 às 02:00), a parada da
  // 01:00 está no trecho da véspera (o dia em que a loja abriu) e também no começo do dia seguinte — vale a véspera.
  const contadas = new Set<ParadaDaImpressora>();
  for (let k = DIAS_OLHADOS; k >= 1; k--) {
    const dia = somarDias(hoje, -k);
    for (const t of trechosDoDia(horarios, dia)) {
      for (const p of paradas) {
        if (contadas.has(p)) continue;
        const ini = p.inicio.getTime();
        if (ini < t.inicio.getTime() || ini >= t.fim.getTime()) continue;
        if (p.voltou && p.voltou.getTime() <= t.fim.getTime()) continue;
        contadas.add(p);
        const g = porImpressora.get(p.chave) ?? { nome: p.nome, dias: new Set<string>(), horas: [] };
        if (!g.dias.has(dia)) {
          g.dias.add(dia);
          g.horas.push(HHMM_SP(p.inicio));
        }
        porImpressora.set(p.chave, g);
      }
    }
  }
  // A faixa em ordem de expediente (a partir do meio-dia): 22:30 vem antes de 01:00, na loja que fecha de madrugada.
  const ordem = (hhmm: string) => (Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3)) + 720) % 1440;
  const fora: PadraoDaImpressora[] = [];
  for (const [chave, g] of porImpressora) {
    if (g.dias.size < MINIMO_DE_DIAS) continue;
    const horas = [...g.horas].sort((a, b) => ordem(a) - ordem(b));
    fora.push({ chave, nome: g.nome, dias: g.dias.size, de: horas[0], ate: horas[horas.length - 1] });
  }
  return fora.sort((a, b) => b.dias - a.dias || a.nome.localeCompare(b.nome));
}

// ───────────────────────────── 3. os atrasos na mesma faixa ─────────────────────────────

/** Quantos pedidos demoraram (do aceite até ficar pronto, além do tempo do pedido parado) num dia e numa hora de São Paulo. */
export interface AtrasosDaHora {
  dia: string;
  hora: number;
  n: number;
}

export interface PadraoDosAtrasos {
  /** "20:00" a "22:00" (o fim da faixa; "23:59" quando ela vai até a meia-noite). */
  de: string;
  ate: string;
  /** Em quantos dias a faixa teve `ATRASOS_NA_HORA` ou mais pedidos demorados numa hora. */
  dias: number;
}

/**
 * A faixa em que os pedidos demoram: cada hora conta os dias em que teve `ATRASOS_NA_HORA` ou mais pedidos demorados; vale
 * a hora que chegou a `MINIMO_DE_DIAS` dias. Das horas que valem, a sequência (até `FAIXA_MAXIMA_H` horas seguidas) com
 * mais dias; empate fica com a mais cedo. Não atravessa a meia-noite. Nenhuma hora vale → null.
 */
export function padraoDosAtrasos(linhas: AtrasosDaHora[]): PadraoDosAtrasos | null {
  const diasDaHora = new Map<number, Set<string>>();
  for (const l of linhas) {
    if (!(l.n >= ATRASOS_NA_HORA) || !Number.isInteger(l.hora) || l.hora < 0 || l.hora > 23) continue;
    const s = diasDaHora.get(l.hora) ?? new Set<string>();
    s.add(l.dia);
    diasDaHora.set(l.hora, s);
  }
  const vale = (h: number) => (diasDaHora.get(h)?.size ?? 0) >= MINIMO_DE_DIAS;
  let melhor: { de: number; ate: number; dias: number } | null = null;
  for (let h = 0; h < 24; h++) {
    if (!vale(h) || (h > 0 && vale(h - 1))) continue; // o começo de cada sequência
    let fim = h;
    while (fim + 1 < 24 && vale(fim + 1)) fim++;
    // A sequência longa vira janelas de até FAIXA_MAXIMA_H horas; fica a de mais dias.
    for (let ini = h; ini <= fim; ini++) {
      const ult = Math.min(fim, ini + FAIXA_MAXIMA_H - 1);
      const dias = new Set<string>();
      for (let x = ini; x <= ult; x++) for (const d of diasDaHora.get(x) ?? []) dias.add(d);
      if (!melhor || dias.size > melhor.dias) melhor = { de: ini, ate: ult, dias: dias.size };
      if (ult === fim) break;
    }
  }
  if (!melhor) return null;
  return { de: hora2(melhor.de), ate: melhor.ate + 1 >= 24 ? '23:59' : hora2(melhor.ate + 1), dias: melhor.dias };
}

// ───────────────────────────── a sugestão ─────────────────────────────
// Cada sugestão vai uma vez; "Não, deixa assim" cala aquele padrão por 30 dias. O Mister NUNCA muda uma regra sozinho: o
// botão propõe a regra (pelo mesmo caminho da conversa), que só liga no "Confirmar"; o recado só sai no "Publicar".

/** Os botões: `pad:regra:<id>` (propor a regra), `pad:rec:<id>` (escrever o recado) e `pad:nao:<id>` (calar 30 dias). */
export const PREFIXO_DO_PADRAO = 'pad:';
export type AcaoDoPadrao = 'regra' | 'rec' | 'nao';

export function botoesDoPadrao(tipo: TipoDoPadrao, padraoId: string, comRecado: boolean): { id: string; titulo: string }[] {
  const b = (acao: AcaoDoPadrao, titulo: string) => ({ id: `${PREFIXO_DO_PADRAO}${acao}:${padraoId}`, titulo });
  if (tipo === 'impressora_antes_do_fechamento')
    return [...(comRecado ? [b('rec', 'Escrever o recado')] : []), b('regra', 'Avisar na hora'), b('nao', 'Não, deixa assim')];
  return [b('regra', 'Quero'), b('nao', 'Não, deixa assim')];
}

export function lerBotaoDoPadrao(botaoId: unknown): { padraoId: string; acao: AcaoDoPadrao } | null {
  const m = /^pad:(regra|rec|nao):([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i.exec(String(botaoId ?? ''));
  return m ? { acao: m[1].toLowerCase() as AcaoDoPadrao, padraoId: m[2].toLowerCase() } : null;
}

/** Os números de cada padrão, como ficam em `mister_padrao.dados`. */
export type DadosDoPadrao =
  | ({ tipo: 'impressora_antes_do_fechamento' } & Pick<PadraoDaImpressora, 'nome' | 'dias' | 'de' | 'ate'>)
  | { tipo: 'avisos_sem_resposta'; avisos: number; parametro: number }
  | ({ tipo: 'atrasos_na_faixa'; parametro: number } & PadraoDosAtrasos);

const faixa = (de: string, ate: string) => (de === ate ? `sempre por volta das ${de}` : `sempre entre ${de} e ${ate}`);

/** A mensagem da sugestão (a conversa 8 e a 9 do protótipo). */
export function textoDaSugestao(d: DadosDoPadrao, comRecado = false): string {
  if (d.tipo === 'impressora_antes_do_fechamento')
    return (
      `🔎 *Percebi um padrão*\nA impressora ${d.nome} foi desligada antes do fechamento em ${d.dias} dos últimos ${DIAS_OLHADOS} dias, ${faixa(d.de, d.ate)}. ` +
      'Parece que alguém desliga antes da hora (ao limpar, ao fechar o caixa).\n\nPosso:\n' +
      (comRecado ? '• escrever um recado para o mural;\n' : '') +
      '• te avisar na hora, se ela parar dentro do horário da loja.'
    );
  if (d.tipo === 'avisos_sem_resposta')
    return (
      `Ontem você recebeu ${d.avisos} avisos de pedido parado e não respondeu a nenhum. ` +
      `Quer que eu só avise quando forem ${JUNTAR_A_PARTIR_DE} ou mais ao mesmo tempo, numa mensagem só?`
    );
  return (
    `🔎 *Percebi um padrão*\nOs pedidos demoram para ficar prontos quase sempre na mesma faixa: entre ${d.de} e ${d.ate}. ` +
    `Em ${d.dias} dos últimos ${DIAS_OLHADOS} dias, ${ATRASOS_NA_HORA} ou mais pedidos levaram mais de ${d.parametro} min do aceite até ficar prontos nessa faixa.\n\n` +
    `Quer que, nessa faixa, eu te avise na hora quando um pedido aceito passar de ${d.parametro} min sem ficar pronto?`
  );
}

export const TEXTOS_DOS_PADROES = {
  calado: `Certo: não falo mais desse padrão pelos próximos ${CALADO_DIAS} dias.`,
  jaRespondido: 'Esta sugestão já foi respondida.',
  naoDisponivel: 'Esta sugestão não está mais disponível para você.',
  confirme: (oQue: string) => `Para ligar, confirme:\n\n${oQue}`,
  recadoAntes: (texto: string, onde: string) => `"${texto}"\n\nPublico no Mural & clima ${onde}?`,
  falhou: 'Não consegui fazer isso agora. Tente de novo daqui a pouco.',
} as const;

/** O recado da impressora (o "Escrever o recado"): a primeira linha é o título do mural. */
export const recadoDaImpressora = (nome: string): string =>
  `Impressora ${nome} ligada até fechar\nA impressora ${nome} tem sido desligada antes de a loja fechar. Deixe-a ligada até o fechamento: os pedidos do fim do expediente também precisam sair impressos.`;

/**
 * A regra que o botão propõe (a linguagem da M6e). A conferência é a de sempre (`conferirRegra`, no `propor`); a pessoa vê
 * o "o que vou fazer" antes do "Confirmar".
 *  • impressora: a impressora pelo nome, parada dentro do horário da loja, um aviso por parada;
 *  • avisos sem resposta: 3 ou mais pedidos parados ao mesmo tempo, numa mensagem, NO LUGAR do aviso de pedido parado;
 *  • atrasos: na faixa, o pedido aceito há mais do tempo escolhido e ainda não pronto, numa mensagem com a lista.
 */
export function regraDoPadrao(d: DadosDoPadrao): Record<string, unknown> {
  if (d.tipo === 'impressora_antes_do_fechamento')
    return {
      fonte: 'equipamentos',
      titulo: `Impressora ${d.nome} parada no expediente`.slice(0, 80),
      filtros: [
        { campo: 'tipo', op: '=', valor: 'impressora' },
        { campo: 'nome', op: '=', valor: d.nome },
        { campo: 'no_expediente', op: '=', valor: true },
      ],
      medida: 'cada_item',
      quando: {},
      vezes: 'sempre',
      agrupar: false,
    };
  if (d.tipo === 'avisos_sem_resposta')
    return {
      fonte: 'pedidos',
      titulo: `${JUNTAR_A_PARTIR_DE} ou mais pedidos parados`,
      filtros: [
        { campo: 'situacao', op: 'em', valor: ['aguardando_aceite', 'em_preparo', 'pronto'] },
        { campo: 'min_desde_chegada', op: '>=', valor: d.parametro },
      ],
      medida: 'quantidade',
      condicao: { op: '>=', valor: JUNTAR_A_PARTIR_DE },
      quando: {},
      vezes: 'sempre',
      agrupar: true,
      substitui: ['pedido_parado'],
    };
  return {
    fonte: 'pedidos',
    titulo: `Pedido demorando entre ${d.de} e ${d.ate}`.slice(0, 80),
    filtros: [
      { campo: 'situacao', op: '=', valor: 'em_preparo' },
      { campo: 'min_desde_aceite', op: '>', valor: d.parametro },
    ],
    medida: 'cada_item',
    quando: { de: d.de, ate: d.ate },
    vezes: 'sempre',
    agrupar: true,
  };
}
