import { MODELO_DA_FOTO_DO_MISTER } from './mister-midia.regras';
import { numerosDosResultados, valoresSemConta } from './mister-agente.regras';

// OS NÚMEROS DA IMAGEM DO DMS GRAPH (versão 10, fase C10a — o teste da imagem; aprovada pelo dono em 25/11/2026,
// `docs/plano-mister.md` § "Versão 10", protótipo `mockups/regem-mister-v10.html`, "No celular" › "Mostrar em imagem").
// Até aqui a imagem do Mister (M6l) não podia levar número da loja ("a IA de imagem erra número"). Agora pode, com duas travas:
//  1. ANTES: o número do pedido da imagem tem origem — veio de uma consulta desta pergunta (o que as ferramentas trouxeram)
//     ou foi dito pela pessoa. O valor em reais segue a régua do filtro de saída (`valoresSemConta`: soma, divisão, o redondo);
//     a porcentagem vale se é a conta de dois números da consulta; a contagem, se veio da consulta.
//  2. DEPOIS: a imagem gerada é lida pela IA da empresa e cada número do pedido tem de estar nela, sem valor em reais ou
//     porcentagem a mais. Errou, não vai à conversa. A conferência fica na auditoria (é o que mede o teste: 9 de 10).
// Puro: sem banco, sem IA.

export type TipoDoNumero = 'reais' | 'pct' | 'num';
export interface NumeroDoTexto {
  /** Como estava escrito ("R$ 98.400", "3.120", "43%"). */
  bruto: string;
  tipo: TipoDoNumero;
  /** O valor × 100, inteiro (R$ 98.400 → 9.840.000; 43% → 4.300; 3.120 → 312.000). */
  centavos: number;
  /** Escrito sem decimais e sem "mil" (o arredondamento ao inteiro vale para ele). */
  redondo: boolean;
}

/** Data (30/11, 30/11/2026), hora (11:02, 11h, 11h30), proporção (9:16) e ordinal (1º) não são números do negócio. */
const NAO_E_NUMERO = /\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b|\b\d{1,2}(?::\d{2}|h\d{0,2})\b|\b\d{1,2}:\d{1,2}\b|\b\d+\s?[ºª]/gi;
// O número com o que vem colado: "R$ " antes; os decimais; " mil" e "%" depois. Aceita o milhar com ponto (pt-BR) e com
// vírgula ("98,400", que a IA de imagem às vezes escreve à moda inglesa).
const NUMERO = /(R\$\s?)?(\d{1,3}(?:[.,]\d{3})+|\d+)(?:,(\d{1,2}))?(?!\d)(\s?mil\b)?(\s?%)?/gi;

/** Todos os números de um texto, já sem datas, horas e proporções. */
export function numerosDoTexto(texto: string): NumeroDoTexto[] {
  const limpo = String(texto ?? '').replace(NAO_E_NUMERO, (m) => ' '.repeat(m.length));
  const achados: NumeroDoTexto[] = [];
  for (const m of limpo.matchAll(NUMERO)) {
    const inteiro = Number(m[2].replace(/[.,]/g, ''));
    const decimais = m[3] ? Number(m[3].padEnd(2, '0')) : 0;
    let centavos = inteiro * 100 + decimais;
    if (m[4]) centavos *= 1000;
    if (!Number.isFinite(centavos)) continue;
    achados.push({ bruto: m[0].trim(), tipo: m[1] ? 'reais' : m[5] ? 'pct' : 'num', centavos, redondo: !m[3] && !m[4] });
  }
  return achados;
}

/**
 * O número que importa conferir: todo valor em reais e toda porcentagem; a contagem acima de 31 que não é um ano. "Os 5 mais
 * vendidos", o "dia 12" e o "2026" do título são apresentação, não dado da loja.
 */
export function ehNumeroDoNegocio(n: NumeroDoTexto): boolean {
  if (n.tipo !== 'num') return true;
  const v = n.centavos / 100;
  if (v <= 31) return false;
  return !(n.redondo && /^\d{4}$/.test(n.bruto) && v >= 1900 && v <= 2100);
}

/** Os números do pedido da imagem que serão conferidos nela (o bruto, na ordem, sem repetir). */
export function numerosParaConferir(pedido: string): string[] {
  return [...new Set(numerosDoTexto(pedido).filter(ehNumeroDoNegocio).map((n) => n.bruto))];
}

/** A origem dos números: o que as consultas desta pergunta trouxeram e o que a pessoa escreveu (esta pergunta e as anteriores). */
export interface OrigemDosNumeros {
  resultados: unknown[];
  falas: string[];
}

/** A origem que o laço do agente passa ao `propor_acao` (fora disso, vazia: nenhum número passa). */
export function origemDe(v: unknown): OrigemDosNumeros {
  const o = v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
  return {
    resultados: Array.isArray(o.resultados) ? o.resultados : [],
    falas: Array.isArray(o.falas) ? o.falas.filter((f): f is string => typeof f === 'string') : [],
  };
}

/** Teto de números da origem na conta da porcentagem (a conta é de pares). */
const TETO_DA_PORCENTAGEM = 300;

/** A porcentagem é a conta de dois números da origem (a parte de um total, ou a variação de um para o outro)? */
export function porcentagemDaConta(alvo: number, origem: number[]): boolean {
  const pct = alvo / 100;
  const tolerancia = alvo % 100 === 0 ? 0.5 : 0.05;
  const base = origem.map(Math.abs).filter((v) => v > 0).slice(0, TETO_DA_PORCENTAGEM);
  for (const a of base)
    for (const b of base) {
      if (a === b) continue;
      if (Math.abs((a / b) * 100 - pct) < tolerancia) return true;
      if (Math.abs(Math.abs((a - b) / b) * 100 - pct) < tolerancia) return true;
    }
  return false;
}

/** O bruto dos números do pedido da imagem que não têm origem (vazio = todos têm). */
export function numerosSemOrigem(pedido: string, origem: OrigemDosNumeros): string[] {
  const daFala = origem.falas.flatMap((f) => numerosDoTexto(f).map((n) => n.centavos / 100));
  const base = [...origem.resultados, { numerosDaFala: daFala }];
  const conhecidos = numerosDosResultados(base);
  for (const v of [...conhecidos]) conhecidos.add(Math.abs(v));
  const lista = [...conhecidos];
  const reaisSemOrigem = new Set(valoresSemConta(pedido, base));
  const sem: string[] = [];
  for (const n of numerosDoTexto(pedido).filter(ehNumeroDoNegocio)) {
    const ok =
      n.tipo === 'reais'
        ? !reaisSemOrigem.has(n.centavos)
        : n.tipo === 'pct'
          ? conhecidos.has(n.centavos) || porcentagemDaConta(n.centavos, lista)
          : conhecidos.has(n.centavos);
    if (!ok && !sem.includes(n.bruto)) sem.push(n.bruto);
  }
  return sem;
}

/** Pessoal no pedido da imagem: e-mail, CPF, CNPJ, telefone escrito como telefone, ou 10 dígitos seguidos. Uma lista de valores não é. */
export function pareceDadoPessoalNaImagem(t: string): boolean {
  const s = String(t ?? '');
  return (
    /[^\s@]+@[^\s@]+\.[^\s@]+/.test(s) ||
    /\b\d{3}\.?\d{3}\.?\d{3}-\d{2}\b/.test(s) ||
    /\b\d{2}\.?\d{3}\.?\d{3}\/\d{4}-?\d{2}\b/.test(s) ||
    /(?:\+?55\s?)?\(?\b\d{2}\)?\s?9?\d{4}[-\s]\d{4}\b/.test(s) ||
    /\d{10,}/.test(s)
  );
}

// ───────────────────────────── a conferência depois de gerar ─────────────────────────────

/** O nome no medidor da IA (Mister › IA e uso). */
export const RECURSO_DA_CONFERENCIA_DA_IMAGEM = 'mister_imagem_conferida';
/** A mesma IA que lê as fotos do Mister: ela já lê cupom tremido; número escrito por IA de imagem é mais fácil. */
export const MODELO_DA_CONFERENCIA_DA_IMAGEM = MODELO_DA_FOTO_DO_MISTER;
/** A pessoa espera a imagem: a conferência tem até isto (o raciocínio conta no teto de tokens — ERR-593). */
export const PRAZO_DA_CONFERENCIA_MS = 45_000;
export const MAX_TOKENS_DA_CONFERENCIA = 4000;
/** A ação gravada na auditoria a cada conferência (o que mede o teste). */
export const ACAO_DA_CONFERENCIA = 'mister_imagem_conferida';

export function instrucoesDaConferencia(): string {
  return [
    'Você confere uma imagem feita por uma IA de imagem (um cartaz ou um gráfico de uma loja).',
    'Transcreva TODOS os números escritos na imagem, exatamente como aparecem, cada um com o que estiver colado nele ("R$", "%", "mil").',
    'Não corrija, não arredonde, não complete e não deduza: copie o que está desenhado. Datas e horas também entram.',
    'Se algum número estiver borrado, cortado ou impossível de ler com certeza, marque "ilegivel": true.',
    'Responda só com JSON, sem texto fora dele: {"numeros": ["R$ 98.400", "3.120 pedidos"], "ilegivel": false}',
  ].join('\n');
}

export interface LeituraDaImagem {
  numeros: string[];
  ilegivel: boolean;
}

/** A resposta da IA: o JSON pedido, ou null (fora do formato). */
export function lerConferencia(texto: string): LeituraDaImagem | null {
  const m = /\{[\s\S]*\}/.exec(String(texto ?? ''));
  if (!m) return null;
  try {
    const j = JSON.parse(m[0]);
    if (!j || !Array.isArray(j.numeros)) return null;
    return { numeros: j.numeros.filter((n: unknown) => typeof n === 'string').map((n: string) => n.slice(0, 60)).slice(0, 80), ilegivel: j.ilegivel === true };
  } catch {
    return null;
  }
}

export type SituacaoDaConferencia = 'bateu' | 'errou' | 'ilegivel';
export interface ConferenciaDaImagem {
  situacao: SituacaoDaConferencia;
  /** Do pedido, e não está na imagem. */
  faltaram: string[];
  /** Valor em reais ou porcentagem na imagem que não estava no pedido. */
  sobraram: string[];
}

/** Compara os números do pedido com os lidos na imagem. "R$ 98.400" no pedido aceita "98.400" desenhado sem o "R$". */
export function conferirNumeros(pedido: string, leitura: LeituraDaImagem): ConferenciaDaImagem {
  const pedidos = numerosDoTexto(pedido).filter(ehNumeroDoNegocio);
  const vistos = leitura.numeros.flatMap((t) => numerosDoTexto(t));
  const casa = (a: NumeroDoTexto, b: NumeroDoTexto) => a.centavos === b.centavos && (a.tipo === 'pct') === (b.tipo === 'pct');
  const faltaram = [...new Set(pedidos.filter((p) => !vistos.some((v) => casa(p, v))).map((p) => p.bruto))];
  const sobraram = [...new Set(vistos.filter((v) => v.tipo !== 'num' && !pedidos.some((p) => casa(p, v))).map((v) => v.bruto))];
  if (leitura.ilegivel) return { situacao: 'ilegivel', faltaram, sobraram };
  return { situacao: faltaram.length || sobraram.length ? 'errou' : 'bateu', faltaram, sobraram };
}

const lista = (xs: string[]) => (xs.length <= 1 ? (xs[0] ?? '') : `${xs.slice(0, -1).join(', ')} e ${xs[xs.length - 1]}`);

/** O que deu errado, para o "Não deu" (começa minúsculo: o desfecho põe "Não deu: " antes). */
export function textoDaImagemErrada(c: ConferenciaDaImagem): string {
  const oQue =
    c.situacao === 'ilegivel'
      ? 'um número da imagem saiu borrado, sem dar para ler com certeza.'
      : c.faltaram.length === 1 && c.sobraram.length === 1
        ? `a imagem saiu com ${c.sobraram[0]} no lugar de ${c.faltaram[0]}.`
        : [c.faltaram.length ? `a imagem não trouxe ${lista(c.faltaram)} como no pedido` : '', c.sobraram.length ? `${c.faltaram.length ? 'e' : 'a imagem'} trouxe ${lista(c.sobraram)}, que não estava no pedido` : '']
            .filter(Boolean)
            .join(' ') + '.';
  return `${oQue} Não te mandei, para não circular número errado. Essa tentativa já usou 1 da franquia. Se quiser, peço de novo (usa mais 1) ou mudo o pedido.`;
}

/** O "feito" depois da conferência que bateu. */
export function textoDaImagemConferida(numeros: string[]): string {
  return numeros.length ? `Conferi os números da imagem: ${lista(numeros)}, como no Regem.` : '';
}

/** A imagem saiu, mas a conferência não rodou (sem a IA, prazo, recusa, formato). */
export const TEXTO_DA_IMAGEM_SEM_CONFERENCIA = 'Não consegui conferir os números desta imagem: confira antes de mandar adiante.';
