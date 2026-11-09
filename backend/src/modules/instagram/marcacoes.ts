/* eslint-disable @typescript-eslint/no-explicit-any */
import { travaDoComentario } from './comentarios';

// AS MARCAÇÕES DO INSTAGRAM (mig 387 — protótipo `mockups/regem-central-atendimento.html` versão 18). Pedido do dono
// (09/11/2026): "o atendente consegue interagir quando alguém marca a loja? a pessoa fez um vídeo ou uma foto e marca a
// loja… a análise do vídeo ou da foto pela nossa API da Anthropic e responder ou comentar".
// Regras PURAS (os testes conferem cada uma sozinha). Documentação da Meta conferida em 09/11/2026:
//   • A MENÇÃO NO STORY chega como mensagem do Direct, com o anexo `story_mention` e o endereço do story no CDN da Meta
//     (`payload.url`) — vale até o story sumir (24 h); o endereço pode ficar guardado, a MÍDIA NÃO ("You must not store or
//     cache the media content on your server"). Perfil privado só avisa se seguir a loja.
//   • Na conexão pelo Login do Instagram (a nossa), o @ da loja em post ou comentário de OUTRA pessoa chega DENTRO do aviso
//     `comments` ("Mentions… are included in the comments notifications"); a resposta sai por `POST /{conta}/mentions`
//     (`media_id` + `message`, e `comment_id` quando é comentário). Story e marcação na própria foto (sem o @) a Meta não
//     manda por aí.
// A IA (o modelo da DISTRIBUIÇÃO — a mesma chave do copiloto) olha a imagem e devolve o que viu, o clima e a resposta; a
// imagem é analisada e descartada. Ela fala do produto, do lugar e do clima e NUNCA identifica pessoas.

export const TIPOS_DE_MARCACAO = ['story', 'post', 'reels', 'comentario'] as const;
export type TipoDaMarcacao = (typeof TIPOS_DE_MARCACAO)[number];
export const CLIMAS = ['positivo', 'neutro', 'negativo'] as const;
export type ClimaDaMarcacao = (typeof CLIMAS)[number];
/** Os estados: a equipe decide (sugerida), publicada, ignorada; no story: agradecida, caso ou sem ação (conversa com alguém). */
export const ESTADOS_DA_MARCACAO = ['sugerida', 'publicada', 'ignorada', 'agradecida', 'caso', 'sem_acao', 'falhou'] as const;
export type EstadoDaMarcacao = (typeof ESTADOS_DA_MARCACAO)[number];

/** O que a IA viu: até 300 letras. A sugestão (comentário público ou agradecimento no Direct): até 300 letras. */
export const MAX_VIU = 300;
export const MAX_SUGESTAO = 300;
/** A imagem que vai à IA: até 5 MB (o limite da API) e só foto — vídeo não (a API não lê vídeo). */
export const MAX_BYTES_DA_IMAGEM = 5 * 1024 * 1024;
export const TIPOS_DE_IMAGEM = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] as const;
/** O agradecimento quando a IA não pode ver (vídeo, sem a IA, a imagem não baixou). */
export const AGRADECIMENTO_PADRAO = 'Obrigado por marcar a gente! 🧡';

// ───────────────────────── quem é marcação ─────────────────────────

/** A mensagem do Direct é a menção da loja num story (do cliente — o eco e a apagada não contam). */
export function ehMencaoNoStory(ev: { tipo: string; eco: boolean; apagada: boolean }): boolean {
  return ev.tipo === 'story' && ev.eco !== true && ev.apagada !== true;
}

/** O @ válido de uma conta do Instagram (letras, números, ponto e sublinhado, até 30). */
const USUARIO = /^[a-z0-9._]{1,30}$/;

/**
 * O texto marca a loja: o `@usuario` da conta inteiro (sem diferença de maiúscula) — `@burgerdapraca` sim; `@burgerdapraca2`
 * e `@burgerdapraca.rio` não (é outra conta); `email@burgerdapraca` não (não começa a palavra). Pontuação depois vale.
 */
export function mencionaALoja(texto: unknown, usuarioDaLoja: unknown): boolean {
  const u = String(usuarioDaLoja ?? '').trim().replace(/^@/, '').toLowerCase();
  if (!USUARIO.test(u)) return false;
  const esc = u.replace(/[.]/g, '\\.');
  return new RegExp(`(^|[^\\p{L}\\p{N}_.@])@${esc}(?![\\p{L}\\p{N}_]|\\.[\\p{L}\\p{N}_])`, 'iu').test(String(texto ?? ''));
}

/** Post ou reels, pelo `media_product_type` da Meta (o resto conta como post). */
export function tipoDaMidia(produto: unknown): 'post' | 'reels' {
  return String(produto ?? '').toUpperCase() === 'REELS' ? 'reels' : 'post';
}

/**
 * O endereço da mídia é do CDN da Meta (Instagram/Facebook) e em HTTPS. O resto não se baixa (V68): o endereço vem do aviso,
 * que é da Meta — mesmo assim só estes hosts. Os testes apontam `INSTAGRAM_MIDIA_TESTE` para um CDN de mentira local.
 */
const HOSTS_DA_META = [/(^|\.)cdninstagram\.com$/i, /(^|\.)fbcdn\.net$/i, /^lookaside\.fbsbx\.com$/i, /^lookaside\.instagram\.com$/i];
export function hostDaMeta(url: unknown): boolean {
  try {
    const u = new URL(String(url ?? ''));
    return u.protocol === 'https:' && HOSTS_DA_META.some((r) => r.test(u.hostname));
  } catch {
    return false;
  }
}

/** O tipo da imagem pelo cabeçalho (sem o `; charset`); vídeo e o resto → null. */
export function tipoDaImagem(contentType: unknown): (typeof TIPOS_DE_IMAGEM)[number] | null {
  const t = String(contentType ?? '').split(';')[0].trim().toLowerCase();
  return (TIPOS_DE_IMAGEM as readonly string[]).includes(t) ? (t as (typeof TIPOS_DE_IMAGEM)[number]) : null;
}

// ───────────────────────── o pedido à IA ─────────────────────────

const ONDE: Record<TipoDaMarcacao, string> = {
  story: 'num story (o agradecimento sai numa mensagem no Direct, que só a pessoa vê)',
  post: 'num post (a resposta sai como comentário público no post da pessoa)',
  reels: 'num reels (a resposta sai como comentário público no reels da pessoa; a imagem é a capa)',
  comentario: 'num comentário no post de outra pessoa (a resposta sai como resposta pública ao comentário)',
};

/**
 * As instruções da análise: a loja, onde marcaram, o perfil do canal (o jeito de falar) e as regras — o JSON de volta, o que
 * descrever (o produto, a embalagem, o lugar, o clima — NUNCA pessoas), quando é reclamação e como é a resposta.
 */
export function instrucoesDaAnalise(o: { loja: string | null; tipo: TipoDaMarcacao; jeito: string; temImagem: boolean }): string {
  const loja = String(o.loja ?? '').trim() || 'a loja';
  return [
    `Você é o atendente virtual de ${loja}, um restaurante. Alguém marcou a loja no Instagram ${ONDE[o.tipo]}.`,
    o.temImagem ? 'Olhe a imagem e o texto.' : 'Não há imagem: use só o texto (pode estar vazio).',
    'Responda SÓ com um objeto JSON, sem nada antes ou depois: {"viu": "...", "clima": "positivo" | "neutro" | "negativo", "resposta": "..."}.',
    '"viu": até 2 frases sobre o que aparece — o produto, a embalagem, o lugar e o clima. NUNCA descreva nem identifique pessoas (rosto, corpo, idade, roupa, quem é): fale só que há pessoas, se houver.',
    '"clima": "negativo" quando parece reclamação (comida amassada, fria, estragada, faltando, atraso, embalagem ruim, texto bravo ou irônico); "positivo" quando elogia ou mostra o produto com gosto; "neutro" no resto.',
    `"resposta": em português do Brasil, 1 ou 2 frases, até ${MAX_SUGESTAO} letras, agradecendo a marcação e falando do que aparece (o lanche, o lugar). Sem link, sem telefone, sem e-mail e sem @ de ninguém; no máximo 1 emoji; não invente preço, promoção, prazo nem brinde. Se o clima for "negativo", "resposta" = "" (a equipe responde).`,
    o.jeito ? o.jeito : '',
  ]
    .filter(Boolean)
    .join('\n');
}

/** O texto do pedido (junto da imagem): quem marcou e o que estava escrito (a legenda ou o comentário). */
export function textoDaAnalise(o: { usuario: string | null; texto: string | null }): string {
  const t = String(o.texto ?? '').replace(/\s+/g, ' ').trim().slice(0, 1000);
  return [`Quem marcou: ${o.usuario ? `@${String(o.usuario).replace(/^@/, '')}` : 'não informado'}.`, t ? `O que estava escrito: "${t}"` : 'Nada escrito.'].join('\n');
}

export type AnaliseDaMarcacao = { viu: string | null; clima: ClimaDaMarcacao; resposta: string | null };

/**
 * A resposta da IA: o primeiro objeto JSON do texto. Sem clima válido = não serve (null). "viu" até 300 letras; a resposta
 * passa pela MESMA trava do comentário público (uma linha, até 300, sem link nem contato nem @) — não passou, fica vazia;
 * clima negativo nunca leva resposta.
 */
export function lerAnalise(bruto: unknown): AnaliseDaMarcacao | null {
  const s = String(bruto ?? '');
  const ini = s.indexOf('{');
  const fim = s.lastIndexOf('}');
  if (ini < 0 || fim <= ini) return null;
  let j: any;
  try {
    j = JSON.parse(s.slice(ini, fim + 1));
  } catch {
    return null;
  }
  const clima = String(j?.clima ?? '').trim().toLowerCase();
  if (!(CLIMAS as readonly string[]).includes(clima)) return null;
  const viuBruto = typeof j?.viu === 'string' ? j.viu.replace(/\s+/g, ' ').trim() : '';
  const viu = viuBruto ? Array.from(viuBruto).slice(0, MAX_VIU).join('') : null;
  let resposta: string | null = null;
  if (clima !== 'negativo' && typeof j?.resposta === 'string' && j.resposta.trim()) {
    const t = travaDoComentario(j.resposta);
    resposta = t.ok ? t.texto : null;
  }
  return { viu, clima: clima as ClimaDaMarcacao, resposta };
}

// ───────────────────────── a decisão no story ─────────────────────────

export type DecisaoDoStory = { acao: 'agradecer'; texto: string; padrao: boolean } | { acao: 'caso' } | { acao: 'nada'; motivo: 'conversa_com_alguem' };

/**
 * O que fazer com a menção no story: a conversa com alguém (caso aberto ou a loja respondeu há pouco pelo app) → nada; a IA
 * viu reclamação → caso; a IA escreveu o agradecimento → ele; sem a IA, vídeo ou resposta vazia → o agradecimento padrão.
 */
export function decidirStory(o: { conversaComAlguem: boolean; analise: AnaliseDaMarcacao | null }): DecisaoDoStory {
  if (o.conversaComAlguem) return { acao: 'nada', motivo: 'conversa_com_alguem' };
  if (o.analise?.clima === 'negativo') return { acao: 'caso' };
  if (o.analise?.resposta) return { acao: 'agradecer', texto: o.analise.resposta, padrao: false };
  return { acao: 'agradecer', texto: AGRADECIMENTO_PADRAO, padrao: true };
}

/** O resumo do caso do story que parece reclamação ("O robô resumiu" na tela): o motivo, o que a IA viu e o que foi feito. */
export function resumoDoCasoDoStory(viu: string | null): { motivo: string; viu: string | null; jaFez: string; humor: 'chateado' } {
  return { motivo: 'Menção no story · parece reclamação', viu: viu ?? null, jaFez: 'Nada: não agradeci, porque parece reclamação', humor: 'chateado' };
}

// ───────────────────────── o que a equipe publica ─────────────────────────

/**
 * O comentário da equipe na marcação (público, no post de outra pessoa): de 1 a 300 letras, numa linha, sem link e sem
 * contato (telefone, WhatsApp, e-mail ou @ de alguém) — a MESMA trava do que o robô publica, mas o longo é recusado (a
 * pessoa escolhe onde cortar), não cortado.
 */
export function textoDaMarcacao(v: unknown): { ok: true; texto: string } | { ok: false; erro: string } {
  const bruto = typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '';
  if (!bruto) return { ok: false, erro: 'Escreva o comentário.' };
  if (Array.from(bruto).length > MAX_SUGESTAO) return { ok: false, erro: `Comentário longo demais (até ${MAX_SUGESTAO} letras).` };
  const t = travaDoComentario(bruto);
  if (t.ok) return { ok: true, texto: t.texto };
  if (t.motivo === 'link') return { ok: false, erro: 'No comentário público não vai link (o Instagram não deixa clicar).' };
  if (t.motivo === 'contato') return { ok: false, erro: 'Telefone, WhatsApp, e-mail ou @ de alguém não vão no comentário público.' };
  return { ok: false, erro: 'Escreva o comentário.' };
}

// ───────────────────────── o diagnóstico do aviso ─────────────────────────

/**
 * Os avisos `comments` que a leitura dos comentários DESCARTA (sem id, sem texto ou sem a mídia) — só os NOMES dos campos,
 * nunca o conteúdo. A documentação não mostra como o @ na LEGENDA chega no aviso `comments` (no Login do Instagram): o
 * registro desses formatos é o que o primeiro teste real lê para fechar essa parte.
 */
export function avisosDeComentarioNaoLidos(body: any): string[] {
  if (body?.object !== 'instagram' || !Array.isArray(body?.entry)) return [];
  const saida: string[] = [];
  for (const entry of body.entry)
    for (const ch of Array.isArray(entry?.changes) ? entry.changes : []) {
      if (ch?.field !== 'comments') continue;
      const v = ch?.value ?? {};
      const temTexto = typeof v?.text === 'string' && v.text.trim() !== '';
      if (v?.id != null && v?.media?.id != null && temTexto) continue;
      const campos = (o: any) => (o && typeof o === 'object' ? Object.keys(o).sort().join(',') : typeof o);
      saida.push(`value={${campos(v)}} media={${campos(v?.media)}}`);
    }
  return saida;
}

// ───────────────────────── a lista ─────────────────────────

/** A lista da tela: os últimos 30 dias, 50 por página (a mesma régua dos comentários). */
export const DIAS_DA_LISTA_DAS_MARCACOES = 30;
export const MARCACOES_POR_PAGINA = 50;
