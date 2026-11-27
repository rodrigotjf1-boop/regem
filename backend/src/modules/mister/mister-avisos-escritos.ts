import { paraOWhatsapp } from '../whatsapp/formato-da-resposta';
import type { GrupoDeAvisoEscrito } from './mister-conversa-config.service';
import { TIPOS_DE_AVISO, type TipoDeAviso } from './mister-avisos.regras';

// OS AVISOS ESCRITOS PELO MISTER (versão 4, fase M4c; protótipo `mockups/regem-mister-jeito-memoria.html`, aprovado pelo
// dono em 18/11/2026, decisão 7). As regras puras:
//  • Quem DESCOBRE o problema continua sendo a regra, sem IA (`mister-avisos.regras.ts`). A IA só ESCREVE o texto do
//    WhatsApp, com o contexto (há quanto tempo, se é o único, o que fazer), no perfil e no jeito da empresa (M4a).
//  • Um ajuste por grupo de aviso (`mister_conversa_config.avisos_escritos`, mig 447), nascendo desligado.
//  • Sem IA, sem crédito, a IA passou de 10 segundos, ou o texto que ela escreveu não passa na conferência: vai o texto
//    fixo de hoje. Fora das 24 horas da Meta vai o modelo aprovado, como sempre (a IA nem é chamada).
//  • A conferência: nenhum número que o aviso não trouxe, nenhum link, o pedido e a loja como estão no título.

/** O nome no medidor da IA (Mister › IA e uso). */
export const RECURSO_DO_AVISO_ESCRITO = 'mister_aviso_escrito';
/** Passou disto, vai o texto fixo (decisão 7). */
export const PRAZO_DO_AVISO_ESCRITO_MS = 10_000;
/** O texto escrito cabe nisto; mais que isso, vai o fixo. */
export const AVISO_ESCRITO_MAX = 700;
export const SAIDA_DO_AVISO_ESCRITO = 1500;
/** Quantos outros avisos abertos da empresa vão no contexto ("é o único?"). */
export const OUTROS_ABERTOS_MAX = 5;

/** O grupo da tela de cada tipo → o grupo do ajuste. "Documentos e dinheiro" e "Pessoas e ponto" ficam no texto fixo. */
const GRUPO_ESCRITO: Record<string, GrupoDeAvisoEscrito> = {
  'Na loja': 'loja',
  'Servidor da loja': 'servidor',
  Fiscal: 'fiscal',
  'O próprio Mister': 'mister',
};
/** Os avisos que ficam SEMPRE no texto fixo, mesmo no grupo escrito (o protótipo diz "Sem IA: o texto é fixo"). */
const SEMPRE_FIXO = new Set<string>(['feriado_chegando']);
export function grupoEscritoDoTipo(tipo: string): GrupoDeAvisoEscrito | null {
  if (SEMPRE_FIXO.has(tipo)) return null;
  const t = TIPOS_DE_AVISO.find((x) => x.tipo === tipo);
  return (t && GRUPO_ESCRITO[t.grupo]) ?? null;
}

/** Este aviso, nesta fase, sai escrito pelo Mister? Só ao abrir e ao escalar (o lembrete e o desfecho ficam fixos). */
export function deveEscrever(tipo: string, fase: string, ligados: readonly string[]): boolean {
  if (fase !== 'abriu' && fase !== 'escalou') return false;
  const g = grupoEscritoDoTipo(tipo);
  return !!g && ligados.includes(g);
}

/** O que a IA recebe do aviso: só os fatos (nada de telefone, nada de id). */
export interface ContextoDoAviso {
  tipo: TipoDeAviso | string;
  /** O que o aviso é (o nome da tela), para a IA entender o assunto. */
  assunto: string;
  titulo: string;
  detalhe: string | null;
  fase: 'abriu' | 'escalou';
  minutosAberto: number;
  /** O tempo escolhido pela loja (o pedido parado: os minutos). */
  parametro: number | null;
  /** Os outros avisos abertos da empresa agora (até 5), para dizer se é o único. */
  outrosAbertos: { titulo: string; minutosAberto: number }[];
}

export function contextoDoAviso(
  a: { tipo: string; titulo: string; detalhe: string | null; abertoEm: Date | string },
  fase: 'abriu' | 'escalou',
  agora: Date,
  parametro: number | null,
  outros: { titulo: string; abertoEm: Date | string }[],
): ContextoDoAviso {
  // A volta lê o aviso do banco: a data chega como texto (como no resto do serviço, `new Date(...)`).
  const minutos = (d: Date | string) => Math.max(1, Math.round((agora.getTime() - new Date(d).getTime()) / 60_000));
  return {
    tipo: a.tipo,
    assunto: TIPOS_DE_AVISO.find((x) => x.tipo === a.tipo)?.titulo ?? a.tipo,
    titulo: a.titulo,
    detalhe: a.detalhe,
    fase,
    minutosAberto: minutos(a.abertoEm),
    parametro,
    outrosAbertos: outros.slice(0, OUTROS_ABERTOS_MAX).map((o) => ({ titulo: o.titulo, minutosAberto: minutos(o.abertoEm) })),
  };
}

/** As instruções fixas de quem escreve o aviso (o perfil e o jeito da empresa vão no fim, quando há). */
export function instrucoesDoAvisoEscrito(jeito: string[]): string {
  return [
    'Você é o Mister, o administrador virtual do Regem. Escreva UM aviso para o WhatsApp do dono ou do gerente da loja, a partir dos fatos do JSON.',
    'REGRAS:',
    '- Use só os fatos do JSON. Nenhum número que não esteja lá (nem soma, nem estimativa, nem horário calculado). Sem valor em reais que o JSON não traga.',
    '- Diga a loja e o pedido (ou a impressora, a nota, o canal) exatamente como estão no "titulo" — o "#284" fica "#284".',
    '- Diga há quanto tempo, com "minutosAberto". Se "fase" for "escalou", comece com "⏰" e diga que continua sem solução.',
    '- Se "outrosAbertos" estiver vazio, pode dizer que é o único aviso aberto agora; se não, diga quantos outros há, sem detalhar.',
    '- Termine com o que fazer, tirado do "detalhe" (o caminho do menu como está escrito). Não invente outro passo.',
    '- 2 a 4 frases curtas, sem título e sem saudação; no máximo 1 emoji; negrito do WhatsApp (*assim*) só no pedido ou na loja.',
    '- Sem link. Responda só com o texto do aviso.',
    ...(jeito.length ? ['', 'O JEITO DESTA EMPRESA (só o tom; as regras acima continuam valendo):', ...jeito] : []),
  ].join('\n');
}

const semAcento = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
/** Os números de um texto: cada sequência de algarismos e o número inteiro sem os separadores ("1.234,5" → 1, 234, 5, 12345). */
function numerosDe(t: string): Set<string> {
  const s = new Set<string>();
  for (const m of String(t).match(/\d+(?:[.,:]\d+)*/g) ?? []) {
    for (const parte of m.split(/[.,:]/)) s.add(String(Number(parte)));
    s.add(m.replace(/[.,:]/g, ''));
  }
  return s;
}

export type MotivoDaReserva = 'desligado' | 'sem_ia' | 'falhou' | 'vazio' | 'longo' | 'link' | 'numero' | 'pedido' | 'loja';

/**
 * Confere o texto que a IA escreveu. Passa: o texto no formato do WhatsApp. Não passa: o motivo (e vai o texto fixo).
 *  • nenhum número que os fatos não trouxeram; nenhum link;
 *  • o pedido ("#284", "nº 1234") e a loja (o começo do título, antes do " · ") do jeito que estão no título.
 */
export function conferirAvisoEscrito(escrito: unknown, ctx: ContextoDoAviso): { texto: string } | { motivo: MotivoDaReserva } {
  const texto = paraOWhatsapp(escrito).trim();
  if (!texto) return { motivo: 'vazio' };
  if (texto.length > AVISO_ESCRITO_MAX) return { motivo: 'longo' };
  if (/https?:\/\/|www\./i.test(texto)) return { motivo: 'link' };
  const fontes = numerosDe(JSON.stringify(ctx));
  for (const m of texto.match(/\d+(?:[.,:]\d+)*/g) ?? []) {
    const inteiro = m.replace(/[.,:]/g, '');
    const partes = m.split(/[.,:]/).map((p) => String(Number(p)));
    if (!fontes.has(inteiro) && !partes.every((p) => fontes.has(p))) return { motivo: 'numero' };
  }
  for (const id of ctx.titulo.match(/#\d+|nº\s*\d+/g) ?? []) if (!texto.replace(/\s+/g, ' ').includes(id.replace(/\s+/g, ' '))) return { motivo: 'pedido' };
  const [loja, ...resto] = ctx.titulo.split(' · ');
  if (resto.length && loja.trim() && !semAcento(texto).includes(semAcento(loja.trim()))) return { motivo: 'loja' };
  return { texto };
}
