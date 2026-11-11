// A PAUSA DOS PEDIDOS POR CANAL (mig 392; protótipo `mockups/regem-pausa.html`): os tipos que a API devolve e o texto do
// aviso — o MESMO no cardápio online e na prévia do "⏸ Pausar" do painel. A regra (motivos, tempos, a volta) mora no
// servidor (`backend/src/common/pausa-do-canal.ts`); aqui só se escreve o que ele mandou.

export type VoltaDaPausa = { hora: string; amanha: boolean; texto: string };

/** A pausa que vale agora num canal (`GET /delivery/pausas`). */
export type PausaDoCanal = {
  canal: string;
  unidadeId: string | null;
  ate: string;
  motivo: string | null;
  motivoTexto: string | null;
  rotulo: string;
  frase: string;
  volta: VoltaDaPausa;
  pausadoEm: string | null;
  pausadoPorNome: string | null;
  /** Só no iFood e na 99 (F5): a pausa no canal — pedida, pausada lá, ou o erro. */
  externo?: ExternoDaPausa;
};

export type ExternoDaPausa = { situacao: 'pausando' | 'aplicada' | 'erro'; erro: string | null };

/** `motivo`: por que não dá para pausar daqui agora (o iFood e a 99: "escolha a loja", "sem conexão com a nuvem"). */
export type CanalNoPainel = { canal: string; nome: string; disponivel: boolean; motivo?: string | null; pausa: PausaDoCanal | null };

export type EstadoDasPausas = {
  canais: CanalNoPainel[];
  motivos: { motivo: string; rotulo: string; frase: string | null }[];
  motivoTextoMax: number;
  temposDoCardapio: number[];
  escolherLoja: boolean;
  /** F2 (mig 393): avisar N min antes de reabrir (0 = não avisa) e com que som. Ausente = servidor antigo (não avisa). */
  aviso?: { minutos: number; som: 'bipe' | 'campainha' };
  minutosParaEstender?: number[];
  /** F3 (mig 394): o modelo da mensagem ao cliente (o da loja ou o padrão), com {nome} {motivo} {volta}. */
  mensagemModelo?: string;
  /** F5: os tempos que a 99 aceita (o outro é "até o fim do dia"). */
  temposDa99?: number[];
};

/**
 * A pausa no canal (iFood e 99 — F5), como a faixa diz: pedida (a rotina da nuvem leva ao canal em segundos), pausada lá,
 * ou o erro que o canal deu. `tom` escolhe a cor (a da bolinha; o texto fica em tinta, pelo contraste).
 */
export function situacaoNoCanal(canal: string, e: ExternoDaPausa): { texto: string; tom: 'ok' | 'espera' | 'erro' } {
  const ao = canal === 'food99' ? 'à 99' : 'ao iFood';
  const no = canal === 'food99' ? 'na 99' : 'no iFood';
  if (e.situacao === 'aplicada')
    return { texto: canal === 'food99' ? 'Pausada na 99 pelo Regem (a 99 confirma em instantes)' : 'Pausado no iFood pelo Regem', tom: 'ok' };
  if (e.situacao === 'erro') return { texto: `Não pausou ${no}: ${e.erro ?? 'o canal recusou.'}`, tom: 'erro' };
  return { texto: `Pedindo a pausa ${ao}…${e.erro ? ` (${e.erro})` : ''}`, tom: 'espera' };
}

/**
 * O cartão "Todos os canais" (pedido do dono, 11/11): marca todos os que dá para pausar daqui ou, se já estão todos
 * marcados, desmarca todos. A combinação segue livre — marcar um a um também chega a "todos".
 */
export function alternarTodos(marcados: ReadonlySet<string>, disponiveis: readonly string[]): Set<string> {
  return todosMarcados(marcados, disponiveis) ? new Set() : new Set(disponiveis);
}

/** Todos os canais que dá para pausar estão marcados (com pelo menos dois — com um só, não há "todos"). */
export function todosMarcados(marcados: ReadonlySet<string>, disponiveis: readonly string[]): boolean {
  return disponiveis.length > 1 && disponiveis.every((c) => marcados.has(c));
}

/** "Cardápio digital, iFood e 99". */
export function listaDeNomes(nomes: readonly string[]): string {
  return nomes.length <= 1 ? (nomes[0] ?? '') : `${nomes.slice(0, -1).join(', ')} e ${nomes[nomes.length - 1]}`;
}

/** O botão de confirmar: "⏸ Pausar o iFood", "⏸ Pausar 2 canais", "⏸ Pausar todos os canais". */
export function rotuloDoPausar(marcados: readonly string[], disponiveis: readonly string[]): string {
  const n = marcados.length;
  if (n === 0) return '⏸ Pausar';
  if (n === 1) return `⏸ Pausar ${NOME_NA_FRASE[marcados[0]] ?? 'o canal'}`;
  return todosMarcados(new Set(marcados), disponiveis) ? '⏸ Pausar todos os canais' : `⏸ Pausar ${n} canais`;
}

/** A 99 pausada "até o fim do dia" não estende (faltam mais de 35 min: só pode ser ela). */
export const daPraEstender = (canal: string, segundos: number) => canal !== 'food99' || segundos <= 35 * 60;

/** O primeiro nome ("ANA PAULA" → "Ana"); nada que pareça nome → vazio. A MESMA regra de `primeiroNome` no servidor. */
export function primeiroNome(nome: unknown): string {
  const p = String(nome ?? '').trim().split(/\s+/)[0] ?? '';
  if (!/^[\p{L}][\p{L}'’-]{1,29}$/u.test(p)) return '';
  return p.charAt(0).toLocaleUpperCase('pt-BR') + p.slice(1).toLocaleLowerCase('pt-BR');
}

/**
 * A mensagem da pausa montada — a MESMA conta de `montarMensagemDaPausa` no servidor (`backend/src/common/pausa-do-canal.ts`,
 * que é quem manda de verdade; aqui é só a prévia). O `check:pausa` confere os mesmos casos dos dois lados.
 */
export function montarMensagemDaPausa(
  modelo: string,
  d: { nome?: string | null; frase: string; volta: { hora: string; amanha: boolean } },
  opcoes: { semDestaque?: boolean } = {},
): string {
  const nome = primeiroNome(d.nome);
  const volta = `${d.volta.amanha ? 'amanhã ' : ''}às *${d.volta.hora}*`;
  let t = nome
    ? modelo.replace(/\{nome\}/g, nome)
    : modelo
        .replace(/,\s*\{nome\}/g, '')
        .replace(/\{nome\}\s*,\s*(\p{L})/gu, (_m, l: string) => l.toLocaleUpperCase('pt-BR'))
        .replace(/\s*\{nome\}/g, '');
  t = t.replace(/\{motivo\}/g, d.frase).replace(/\{volta\}/g, volta);
  if (opcoes.semDestaque) t = t.replace(/\*/g, '');
  return t.replace(/\n{3,}/g, '\n\n').trim();
}

/** Segundos que faltam até o fim da pausa (0 quando já passou). */
export function segundosAte(ate: string, agora: number): number {
  return Math.max(0, Math.ceil((new Date(ate).getTime() - agora) / 1000));
}

/** O contador da faixa: "12:34", ou "1:02:03" com mais de uma hora. */
export function relogioDaPausa(segundos: number): string {
  const s = Math.max(0, Math.floor(segundos));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const dois = (n: number) => String(n).padStart(2, '0');
  return h ? `${h}:${dois(m)}:${dois(s % 60)}` : `${dois(m)}:${dois(s % 60)}`;
}

/** A faixa está na hora do aviso? (faltam N min ou menos e o aviso está ligado; depois do fim, não) */
export function naHoraDoAviso(segundos: number, avisoMin: number | undefined): boolean {
  return !!avisoMin && segundos > 0 && segundos <= avisoMin * 60;
}

/** "Faltam 3 min" / "Falta 1 min" / "Falta menos de 1 min" — o texto do aviso. */
export function faltamTexto(segundos: number): string {
  const min = Math.ceil(segundos / 60);
  if (segundos < 60) return 'Falta menos de 1 min';
  return min === 1 ? 'Falta 1 min' : `Faltam ${min} min`;
}

/** O que cada canal pausa, como o cartão do diálogo diz. */
export const DESCRICAO_DO_CANAL: Record<string, string> = {
  cardapio: 'Site, WhatsApp, Instagram e Messenger',
  ifood: 'A loja fica "fechada temporariamente" no iFood',
  food99: 'A loja fica pausada no app da 99',
};

/** O nome do canal na frase do botão ("Pausar o cardápio digital"). */
export const NOME_NA_FRASE: Record<string, string> = { cardapio: 'o cardápio digital', ifood: 'o iFood', food99: 'a 99' };

export const TITULO_DA_PAUSA = '⏸️ Pedidos pausados por alguns minutos';

/**
 * A frase do motivo para a PRÉVIA, antes de pausar: a pronta (que o servidor manda na lista de motivos) ou o texto
 * escrito no "Outro motivo…" — a mesma conta de `fraseDoMotivo` no servidor (maiúscula, em destaque, sem asterisco).
 */
export function fraseDaPrevia(frasePronta: string | null | undefined, textoOutro: string): string {
  if (frasePronta) return frasePronta;
  const t = textoOutro.replace(/\s+/g, ' ').trim().replace(/\*/g, '');
  return t ? `*${t.charAt(0).toUpperCase()}${t.slice(1)}*` : '*(o motivo que você escrever)*';
}

/** O aviso do cardápio online durante a pausa (e a prévia no painel). */
export function avisoDaPausa(p: { frase: string; volta: Pick<VoltaDaPausa, 'texto'> }) {
  return {
    titulo: TITULO_DA_PAUSA,
    motivo: `${p.frase} e pausamos para não atrasar ninguém.`,
    volta: `🕒 Voltamos ${p.volta.texto}`,
    rodape: 'Você pode olhar o cardápio à vontade. Assim que reabrirmos, é só pedir.',
  };
}

/** Separa o destaque do WhatsApp (`*assim*`) para a tela mostrar em negrito — sem `dangerouslySetInnerHTML`. */
export function trechosComDestaque(texto: string): { texto: string; destaque: boolean }[] {
  const out: { texto: string; destaque: boolean }[] = [];
  const re = /\*([^*]+)\*/g;
  let i = 0;
  for (let m = re.exec(texto); m; m = re.exec(texto)) {
    if (m.index > i) out.push({ texto: texto.slice(i, m.index), destaque: false });
    out.push({ texto: m[1], destaque: true });
    i = m.index + m[0].length;
  }
  if (i < texto.length) out.push({ texto: texto.slice(i), destaque: false });
  return out;
}

/** "às 21:40" / "amanhã às 00:30" de um instante, no relógio deste aparelho — só para a PRÉVIA (o servidor manda a real). */
export function voltaDaPrevia(ate: Date, agora: Date): VoltaDaPausa {
  const dois = (n: number) => String(n).padStart(2, '0');
  const hora = `${dois(ate.getHours())}:${dois(ate.getMinutes())}`;
  const amanha = ate.toDateString() !== agora.toDateString();
  return { hora, amanha, texto: amanha ? `amanhã às ${hora}` : `às ${hora}` };
}

/**
 * O fim da pausa escolhido no diálogo, para a prévia: N minutos, a próxima vez que o relógio marcar HH:MM, ou o fim do
 * dia (a 99).
 */
export function fimDaPrevia(tempo: { minutos?: number; ate?: string; fimDoDia?: boolean }, agora: Date): Date | null {
  if (tempo.fimDoDia) {
    const d = new Date(agora);
    d.setHours(23, 59, 0, 0);
    return d;
  }
  if (tempo.minutos) return new Date(agora.getTime() + tempo.minutos * 60_000);
  const m = /^(\d{2}):(\d{2})$/.exec(tempo.ate ?? '');
  if (!m) return null;
  const d = new Date(agora);
  d.setHours(Number(m[1]), Number(m[2]), 0, 0);
  if (d.getTime() - agora.getTime() < 60_000) d.setDate(d.getDate() + 1);
  return d;
}
