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
};

export type CanalNoPainel = { canal: string; nome: string; disponivel: boolean; pausa: PausaDoCanal | null };

export type EstadoDasPausas = {
  canais: CanalNoPainel[];
  motivos: { motivo: string; rotulo: string; frase: string | null }[];
  motivoTextoMax: number;
  temposDoCardapio: number[];
  escolherLoja: boolean;
  /** F2 (mig 393): avisar N min antes de reabrir (0 = não avisa) e com que som. Ausente = servidor antigo (não avisa). */
  aviso?: { minutos: number; som: 'bipe' | 'campainha' };
  minutosParaEstender?: number[];
};

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

/** O fim da pausa escolhido no diálogo, para a prévia: N minutos, ou a próxima vez que o relógio marcar HH:MM. */
export function fimDaPrevia(tempo: { minutos?: number; ate?: string }, agora: Date): Date | null {
  if (tempo.minutos) return new Date(agora.getTime() + tempo.minutos * 60_000);
  const m = /^(\d{2}):(\d{2})$/.exec(tempo.ate ?? '');
  if (!m) return null;
  const d = new Date(agora);
  d.setHours(Number(m[1]), Number(m[2]), 0, 0);
  if (d.getTime() - agora.getTime() < 60_000) d.setDate(d.getDate() + 1);
  return d;
}
