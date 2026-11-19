// O FORMATO DA RESPOSTA DO ROBÔ (17/11/2026 — pedido do dono: "respostas arrumadas e formatadas com emoticons quando
// necessário"). As instruções do atendente (.f25 — `cardapio/robo-instrucoes.ts`) pedem a formatação do WhatsApp:
// `*negrito*` no produto e no preço, listas uma por linha com o emoji do assunto. O modelo às vezes escreve markdown
// (`**negrito**`, `# título`, tabela, `[texto](link)`), que o WhatsApp mostra com os símbolos. Aqui, na porta única da
// resposta (`robo-resposta.service.ts`), o texto vira o do canal:
//  • WhatsApp (oficial e QR): `*negrito*`, `_itálico_`, `~riscado~` e listas com "•" — o markdown é convertido;
//  • Direct, Messenger, chat do iFood e da 99 e comentário: sem formatação (lá o asterisco aparece escrito).
// E duas linhas de controle que o modelo escreve e o cliente nunca vê: `REACAO: ❤️` (reagir à mensagem do cliente em vez
// de escrever) e `OPCOES: a | b` fora da última linha (o fluxo do n8n só tira a da última linha — com a REACAO depois
// dela, a linha das opções chegaria escrita ao cliente).
// Os links nunca são mexidos: saem do texto antes das trocas e voltam iguais (um `_` no meio do endereço não é itálico).

/** As reações que o robô pode mandar (as instruções listam estas). Outra coisa na linha REACAO: a linha sai e não reage. */
export const REACOES = ['❤️', '👍', '😊', '🙏', '😄', '🎉', '😋', '👏', '🔥'] as const;
export type Reacao = (typeof REACOES)[number];

/** Texto com menos letras que isso vai num balão só (a resposta curta não se parte). */
export const BALAO_MINIMO = 320;
/** Até quantos balões uma resposta vira. */
export const MAX_BALOES = 3;

const INI = '';
const FIM = '';
const LINK = /https?:\/\/[^\s<>"']+/gi;
const LINK_DO_MARKDOWN = /\[([^\]\n]{1,200})\]\((https?:\/\/[^\s)]+)\)/g;
const SEPARADOR_DE_TABELA = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;
const LINHA_DE_TABELA = /^\s*\|.*\|\s*$/;
const LINHA_DIVISORIA = /^\s*([-*_])(\s*\1){2,}\s*$/;
const TITULO = /^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/;
const MARCADOR_DE_LISTA = /^(\s*)[-*+]\s+(?=\S)/;
// Ênfase de markdown/WhatsApp entre limites de palavra (`nome_do_campo` não é itálico; `5*3*2` não é negrito).
const ENFASE = /(?<![\p{L}\p{N}*_~])(\*{1,3}|_{1,3}|~{1,2})(?=[^\s*_~])([^\n]*?[^\s*_~])\1(?![\p{L}\p{N}*_~])/gu;
const LINHA_DA_REACAO = /^[ \t]*REA[CÇ](?:[AÃ]O|[OÕ]ES)[ \t]*:[ \t]*(.*?)[ \t]*$/i;
const LINHA_DAS_OPCOES = /^[ \t]*OP[CÇ][OÕ]ES[ \t]*:(.*)$/i;

/** Tira do texto as linhas que casam com `linha` (a linha inteira, sem deixar linha em branco no lugar). */
function tirarLinhas(texto: unknown, linha: RegExp, achou: (m: RegExpExecArray) => void): string {
  return String(texto ?? '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .filter((l) => {
      const m = linha.exec(l);
      if (m) achou(m);
      return !m;
    })
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function guardarLinks(texto: string): { texto: string; links: string[] } {
  const links: string[] = [];
  const t = texto.replace(LINK, (u) => {
    links.push(u);
    return `${INI}${links.length - 1}${FIM}`;
  });
  return { texto: t, links };
}

function devolverLinks(texto: string, links: string[]): string {
  return texto.replace(/(\d+)/g, (_m, i) => links[Number(i)] ?? '');
}

/** `[o cardápio](https://…)` → `o cardápio: https://…` (nenhum dos canais mostra o link do markdown). */
function linksDoMarkdown(texto: string): string {
  return texto.replace(LINK_DO_MARKDOWN, (_m, rotulo: string, url: string) => {
    const r = String(rotulo).trim();
    return !r || r === url ? url : `${r}: ${url}`;
  });
}

/** Tira as marcas de ênfase (negrito, itálico, riscado), deixando o texto. */
function semEnfase(texto: string): string {
  let t = texto;
  for (let i = 0; i < 3; i++) {
    const antes = t;
    t = t.replace(ENFASE, '$2');
    if (t === antes) break;
  }
  return t;
}

/** As linhas, com tabela virando lista, título virando negrito (ou texto) e a linha divisória fora. */
function arrumarLinhas(texto: string, negrito: boolean): string[] {
  const linhas = texto.replace(/\r\n?/g, '\n').split('\n');
  const out: string[] = [];
  for (let i = 0; i < linhas.length; i++) {
    const l = linhas[i];
    if (l.includes('|') && SEPARADOR_DE_TABELA.test(l)) continue;
    if (LINHA_DIVISORIA.test(l)) continue;
    if (LINHA_DE_TABELA.test(l)) {
      const celulas = l
        .trim()
        .replace(/^\|/, '')
        .replace(/\|$/, '')
        .split('|')
        .map((c) => semEnfase(c.trim()))
        .filter(Boolean);
      if (!celulas.length) continue;
      const proxima = linhas[i + 1] ?? '';
      const cabeca = proxima.includes('|') && SEPARADOR_DE_TABELA.test(proxima);
      const juntas = celulas.join(' — ');
      out.push(cabeca ? (negrito ? `*${juntas}*` : juntas) : `• ${juntas}`);
      continue;
    }
    const titulo = TITULO.exec(l);
    if (titulo) {
      const t = semEnfase(titulo[1]).trim();
      out.push(negrito ? `*${t}*` : t);
      continue;
    }
    out.push(l.replace(MARCADOR_DE_LISTA, '$1• '));
  }
  return out;
}

function acabamento(linhas: string[]): string {
  return linhas
    .map((l) => l.replace(/[ \t]+$/, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * O texto para o WhatsApp: o markdown que o modelo escreveu vira a formatação do WhatsApp (`**x**` → `*x*`, `__x__` →
 * `_x_`, `~~x~~` → `~x~`, título → negrito, tabela → lista, `- ` → `• `, `[texto](link)` → `texto: link`). O que já
 * está no jeito do WhatsApp fica como está.
 */
export function paraOWhatsapp(texto: unknown): string {
  const bruto = String(texto ?? '');
  if (!bruto.trim()) return '';
  const { texto: semLinks, links } = guardarLinks(linksDoMarkdown(bruto));
  const t = acabamento(arrumarLinhas(semLinks, true))
    .replace(/\*\*\*(?=\S)([^\n]*?\S)\*\*\*/g, '*_$1_*')
    .replace(/\*\*(?=\S)([^\n]*?\S)\*\*/g, '*$1*')
    .replace(/(?<![\p{L}\p{N}])__(?=\S)([^\n]*?\S)__(?![\p{L}\p{N}])/gu, '_$1_')
    .replace(/~~(?=\S)([^\n]*?\S)~~/g, '~$1~');
  return devolverLinks(t, links);
}

/**
 * O texto para um canal sem formatação (Direct, Messenger, chat do iFood e da 99, comentário, título de botão): sem as
 * marcas de negrito, itálico e riscado, título e tabela em texto, listas com "•".
 */
export function semFormatacao(texto: unknown): string {
  const bruto = String(texto ?? '');
  if (!bruto.trim()) return '';
  const { texto: semLinks, links } = guardarLinks(linksDoMarkdown(bruto));
  return devolverLinks(semEnfase(acabamento(arrumarLinhas(semLinks, false))), links);
}

/** "❤" sem o seletor de emoji é o mesmo coração. */
function normalizarEmoji(e: string): string {
  const t = String(e ?? '').trim();
  return t === '❤' ? '❤️' : t;
}

/**
 * A linha `REACAO: ❤️` que o modelo escreve: sai do texto (o cliente nunca a vê, em canal nenhum) e, se o emoji é um
 * dos permitidos, vira a reação. Mais de uma linha: vale a primeira que serve.
 */
export function separarReacao(texto: unknown): { texto: string; reacao: Reacao | null } {
  let reacao: Reacao | null = null;
  const t = tirarLinhas(texto, LINHA_DA_REACAO, (m) => {
    const e = normalizarEmoji(m[1]);
    if (!reacao && (REACOES as readonly string[]).includes(e)) reacao = e as Reacao;
  });
  return { texto: t, reacao };
}

/**
 * A linha `OPCOES: a | b | c` que ficou no meio do texto (o fluxo do n8n só tira a da ÚLTIMA linha): sai do texto e
 * vira as opções (até 10). Mais de uma linha: vale a última.
 */
export function separarOpcoesSoltas(texto: unknown): { texto: string; opcoes: Array<{ titulo: string }> } {
  let opcoes: Array<{ titulo: string }> = [];
  const t = tirarLinhas(texto, LINHA_DAS_OPCOES, (m) => {
    const achadas = String(m[1] ?? '')
      .split('|')
      .map((s) => semFormatacao(s).trim())
      .filter(Boolean)
      .slice(0, 10)
      .map((titulo) => ({ titulo }));
    if (achadas.length) opcoes = achadas;
  });
  return { texto: t, opcoes };
}

/**
 * Os passos do PRINT DE AJUDA (D3 — protótipo `regem-atendente-alergenos-agendado.html`, parte 3, F2 opção A): uma imagem
 * pronta por passo do cardápio, com uma loja de demonstração, em `frontend/public/ajuda/print-<passo>.png`.
 */
export const PASSOS_DO_PRINT = ['produto', 'adicionais', 'carrinho', 'endereco', 'pagamento', 'acompanhar'] as const;
export type PassoDoPrint = (typeof PASSOS_DO_PRINT)[number];
const LINHA_DO_PRINT = /^[ \t]*PRINT[ \t]*:[ \t]*(.*?)[ \t]*$/i;
const semAcentoMinusculo = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/**
 * A linha `PRINT: carrinho` que o robô escreve: sai do texto em todo canal (o cliente nunca a vê) e, se o passo é um dos
 * seis, vira o print daquele passo (só no WhatsApp, só com a loja com o ajuste ligado — quem decide é a porta da
 * resposta). Mais de uma linha: vale a primeira que serve (F3: um print por resposta).
 */
export function separarPrint(texto: unknown): { texto: string; print: PassoDoPrint | null } {
  let print: PassoDoPrint | null = null;
  const t = tirarLinhas(texto, LINHA_DO_PRINT, (m) => {
    const p = semAcentoMinusculo(semFormatacao(m[1] ?? '').trim()).replace(/[^a-z]/g, '');
    if (!print && (PASSOS_DO_PRINT as readonly string[]).includes(p)) print = p as PassoDoPrint;
  });
  return { texto: t, print };
}

const LINHA_DO_LOCAL = /^[ \t]*LOCAL(?:IZA[CÇ][AÃ]O)?[ \t]*:[ \t]*(.*?)[ \t]*$/i;

/**
 * A linha `LOCAL: loja` que o robô escreve quando perguntam onde fica a loja (D5): sai do texto em todo canal e, no
 * WhatsApp, vira a localização da loja (o alfinete 📍 do mapa) — só com as coordenadas cadastradas.
 */
export function separarLocal(texto: unknown): { texto: string; local: boolean } {
  let local = false;
  const t = tirarLinhas(texto, LINHA_DO_LOCAL, (m) => {
    if (semAcentoMinusculo(semFormatacao(m[1] ?? '').trim()).replace(/[^a-z]/g, '') === 'loja') local = true;
  });
  return { texto: t, local };
}

/**
 * A localização da loja para mandar (D5): as coordenadas do cadastro (Delivery › Configurações › Dados da loja), o nome e o
 * endereço em texto. Sem coordenadas que sirvam (vazias, fora do mapa ou 0,0): null — não manda nada.
 */
export function localizacaoDaLoja(cfg: any): { latitude: number; longitude: number; nome: string; endereco: string } | null {
  const lat = Number(cfg?.endLat);
  const lng = Number(cfg?.endLng);
  if (cfg?.endLat == null || cfg?.endLng == null || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180 || (lat === 0 && lng === 0)) return null;
  const endereco = [
    [cfg?.endRua, cfg?.endNumero].filter(Boolean).join(', '),
    cfg?.endBairro,
    [cfg?.endCidade, cfg?.endEstado].filter(Boolean).join(' - '),
  ]
    .filter(Boolean)
    .join(' · ');
  return { latitude: lat, longitude: lng, nome: String(cfg?.nomePublico ?? '').trim() || 'Nossa loja', endereco };
}

/** O endereço público da imagem do passo (o app da nuvem serve `public/ajuda/`). */
export function urlDoPrint(passo: PassoDoPrint, env: NodeJS.ProcessEnv = process.env): string {
  // O app que serve `public/` (o mesmo endereço das imagens do "como faço" do Mister — `enderecoDoApp`).
  const base = (env.APP_URL || env.CARDAPIO_PUBLIC_URL || 'https://app.dmsregem.com').replace(/\/+$/, '');
  return `${base}/ajuda/print-${passo}.png`;
}

/** Os balões da resposta estão ligados nesta instalação (`ROBO_BALOES=1` — nasce desligado; o dono liga). */
export function baloesLigados(env: NodeJS.ProcessEnv = process.env): boolean {
  return /^(1|true|sim|ligado)$/i.test(String(env.ROBO_BALOES ?? '').trim());
}

/**
 * A resposta em balões, como uma pessoa escreve no WhatsApp: a resposta longa (a partir de `BALAO_MINIMO` letras) com
 * parágrafos vira até `MAX_BALOES` mensagens, pelas linhas em branco. O bloco que termina em ":" (o que apresenta uma
 * lista) fica junto do seguinte; com blocos demais, os do meio se juntam. Curta ou sem parágrafo: um balão só.
 */
export function emBaloes(texto: unknown, max = MAX_BALOES): string[] {
  const t = String(texto ?? '').trim();
  if (!t) return [];
  if (t.length < BALAO_MINIMO || max < 2) return [t];
  const blocos: string[] = [];
  for (const b of t.split(/\n[ \t]*\n+/).map((x) => x.trim()).filter(Boolean)) {
    const ultimo = blocos.length - 1;
    if (ultimo >= 0 && /:\s*$/.test(blocos[ultimo])) blocos[ultimo] = `${blocos[ultimo]}\n${b}`;
    else blocos.push(b);
  }
  if (blocos.length < 2) return [t];
  if (blocos.length <= max) return blocos;
  return [...blocos.slice(0, max - 2), blocos.slice(max - 2, -1).join('\n\n'), blocos[blocos.length - 1]];
}

/** Quanto esperar (com o "digitando…") antes do próximo balão: pelo tamanho dele, entre 0,8 s e 2,2 s. */
export function pausaAntesDoBalao(balao: string): number {
  return Math.min(2200, 800 + 8 * String(balao ?? '').length);
}
