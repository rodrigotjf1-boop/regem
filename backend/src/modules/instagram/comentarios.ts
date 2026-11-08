/* eslint-disable @typescript-eslint/no-explicit-any */
import { chaveDoComentario } from '../../common/conversa-do-robo';
import { partirParaOChat } from '../ponte-chat/texto-do-chat';
import { ErroDaMeta } from './instagram-graph';

// OS COMENTÁRIOS DOS POSTS DO INSTAGRAM (F6 do atendente virtual, mig 384 — protótipo `mockups/regem-central-atendimento.html`).
// Regras PURAS (os testes conferem cada uma sozinha): a leitura do aviso `comments`, o que não vai ao robô, a permissão da
// conta, a trava do que o robô publica, a mensagem que o robô recebe, a tradução do erro da Meta e o cursor da lista.
// Documentação da Meta (Instagram API with Instagram Login), conferida em 08/11/2026: o aviso vem em `entry[].changes[]` com
// `field: 'comments'` (o `live_comments` é de transmissão ao vivo — fica de fora) e `value: { id, from: { id, username },
// text, media: { id, media_product_type }, parent_id? }`; `entry.id` = a conta da loja.

/** A permissão dos comentários (a conta conectada antes da F6 não tem: a tela pede "Reconectar"). */
export const PERMISSAO_DOS_COMENTARIOS = 'instagram_business_manage_comments';
/** No máximo tantos comentários vão ao robô por hora, por conta (o resto fica "sem resposta", sem caso). */
export const LIMITE_DO_ROBO_POR_HORA = 30;
/** A resposta privada sai até 7 dias depois do comentário (regra do Instagram). */
export const PRAZO_DA_PRIVADA_MS = 7 * 86_400_000;
/** A resposta pública do robô: até 300 letras, numa linha só. */
export const MAX_LETRAS_DO_ROBO = 300;
/** O texto da equipe (resposta pública ou privada): até 1.000 letras (a privada, até 1.000 bytes — regra do Direct). */
export const MAX_TEXTO_DA_EQUIPE = 1000;
/** Uma resposta "em andamento" (já reservada, a Meta ainda não confirmou) vale isto; depois, outra pode tentar. */
export const RESERVA_VALE_MS = 2 * 60_000;
/** O robô responde o comentário entregue a ele há no máximo isto. */
export const ESPERA_DO_ROBO_MIN = 30;
/** A lista da tela: os últimos 30 dias, 50 por página. */
export const DIAS_DA_LISTA = 30;
export const ITENS_POR_PAGINA = 50;
/** A legenda do post que vai ao robô (o contexto do comentário). */
export const LEGENDA_PARA_O_ROBO = 200;
export const FILTROS = ['sem-resposta', 'respondidos', 'escondidos', 'todos'] as const;
export type FiltroDosComentarios = (typeof FILTROS)[number];

const ID = /^[0-9]{3,40}$/;

// ───────────────────────── o aviso ─────────────────────────

export type EventoDoComentario = {
  /** A conta da loja (o `entry.id`). */
  conta: string;
  comentarioId: string;
  /** O comentário de cima, quando este é resposta. */
  paiId: string | null;
  midiaId: string;
  midiaTipo: string | null;
  autorId: string | null;
  autorUsuario: string | null;
  texto: string;
  em: Date;
};

/** A hora do aviso: o `entry.time` vem em segundos (o das mensagens vem em milissegundos) — aceita os dois. */
function horaDoAviso(v: unknown): Date {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return new Date();
  return new Date(n < 1e12 ? n * 1000 : n);
}

/**
 * Os comentários de um aviso do Instagram (`object: "instagram"`): de `entry[].changes[]` só o `field === 'comments'` (o
 * `live_comments` e o resto ficam de fora). Sem id, sem texto ou sem o post = descartado. O aviso pode trazer várias contas
 * e vários comentários juntos — cada um sai sozinho.
 */
export function lerComentarios(body: any): EventoDoComentario[] {
  if (body?.object !== 'instagram' || !Array.isArray(body?.entry)) return [];
  const saida: EventoDoComentario[] = [];
  for (const entry of body.entry) {
    const conta = entry?.id != null ? String(entry.id) : '';
    if (!ID.test(conta)) continue;
    for (const ch of Array.isArray(entry?.changes) ? entry.changes : []) {
      if (ch?.field !== 'comments') continue;
      const v = ch?.value ?? {};
      const comentarioId = v?.id != null ? String(v.id) : '';
      const midiaId = v?.media?.id != null ? String(v.media.id) : '';
      const texto = typeof v?.text === 'string' ? v.text.trim() : '';
      if (!ID.test(comentarioId) || !ID.test(midiaId) || !texto) continue;
      const pai = v?.parent_id != null ? String(v.parent_id) : '';
      saida.push({
        conta,
        comentarioId,
        paiId: ID.test(pai) && pai !== comentarioId ? pai : null,
        midiaId,
        midiaTipo: typeof v?.media?.media_product_type === 'string' ? v.media.media_product_type.slice(0, 40) : null,
        autorId: v?.from?.id != null ? String(v.from.id) : null,
        autorUsuario: typeof v?.from?.username === 'string' && v.from.username.trim() ? v.from.username.trim().replace(/^@/, '').slice(0, 120) : null,
        texto: texto.slice(0, 2200),
        em: horaDoAviso(entry?.time),
      });
    }
  }
  return saida;
}

/**
 * O comentário não tem o que responder: só emoji, só pontuação, ou só marcação de amigos (`@fulano`) — nada de letra ou
 * número sobrando. Não vai ao robô (fica na lista, sem resposta).
 */
export function comentarioSemTexto(texto: unknown): boolean {
  const t = String(texto ?? '').replace(/@[\p{L}\p{N}_.]+/gu, ' ');
  return !/[\p{L}\p{N}]/u.test(t);
}

/** A conta conectada deu a permissão dos comentários (está na lista gravada na conexão)? */
export function podeComentarios(permissoes: string | null | undefined): boolean {
  return String(permissoes ?? '')
    .split(/[\s,]+/)
    .map((p) => p.trim().toLowerCase())
    .includes(PERMISSAO_DOS_COMENTARIOS);
}

/**
 * O comentário vai ao robô? Só com o robô ligado e disponível (a conta com a permissão, o fluxo do n8n, o cardápio ativo),
 * com texto que se responda, sem resposta da loja e dentro do limite de 30 por hora da conta.
 */
export function vaiAoRobo(e: { roboLigado: boolean; semTexto: boolean; jaRespondido: boolean; entreguesNaHora: number }): boolean {
  return e.roboLigado && !e.semTexto && !e.jaRespondido && e.entreguesNaHora < LIMITE_DO_ROBO_POR_HORA;
}

// ───────────────────────── a trava do que o robô publica ─────────────────────────

export type MotivoDaTravaDoComentario = 'vazio' | 'silencio' | 'link' | 'contato';
export type TravaDoComentario = { ok: true; texto: string; cortado: boolean } | { ok: false; motivo: MotivoDaTravaDoComentario };

/** Como o motivo aparece (no `erro` do comentário e no log) — sem o texto de ninguém. */
export const NOME_DO_MOTIVO_DO_COMENTARIO: Record<MotivoDaTravaDoComentario, string> = {
  vazio: 'O robô não escreveu nada para publicar.',
  silencio: 'O robô não respondeu: o comentário parecia ofensivo, spam ou fora do assunto da loja. A equipe decide se responde ou esconde.',
  link: 'O robô escreveu um link — no comentário público não sai link (o Instagram não deixa clicar). Não publicado.',
  contato: 'O robô escreveu telefone, WhatsApp, e-mail ou um @ — contato não sai em público. Não publicado.',
};

const TEM_LINK = /(https?:\/\/|www\.|\bwa\.me\b|\bbit\.ly\b|\b[a-z0-9-]+\.(com|com\.br|net|org|br)\b)/i;
// O telefone: 4 + 4 dígitos (com o 9 e o DDD opcionais, espaço, ponto ou traço entre eles) — "99999-9999", "(21) 3333-4444",
// "21999998888". O preço, a hora, a data e o CEP (5 + 3) passam.
const TEM_TELEFONE = /(?<!\d)(?:\+?55[\s.-]?)?(?:\(?\d{2}\)?[\s.-]?)?9?\d{4}[\s.-]?\d{4}(?!\d)/;
const TEM_CONTATO = /(\bwhats(app)?\b|\bwpp\b|\bzap\b|\bzapzap\b|[\w.+-]+@[\w-]+\.[\w.]+|(^|\s)@[\p{L}\p{N}_.]{2,})/iu;

/**
 * O que o robô quer publicar no comentário passa? Numa linha só, até 300 letras (cortado no fim de uma frase — senão num
 * espaço); link → não publica; telefone, WhatsApp, e-mail ou `@` de alguém → não publica. O texto INTEIRO é conferido antes
 * de cortar (o que tem contato não sai nem pela metade).
 */
export function travaDoComentario(texto: unknown): TravaDoComentario {
  const t = String(texto ?? '').replace(/\s+/g, ' ').trim();
  if (!t) return { ok: false, motivo: 'vazio' };
  // "SEM RESPOSTA" (as instruções dos comentários): o robô decidiu não responder — nada se publica.
  if (/^[\s.!:()[\]"'-]*sem resposta[\s.!:()[\]"'-]*$/i.test(t)) return { ok: false, motivo: 'silencio' };
  // O e-mail antes do link (o domínio dele pareceria um site).
  if (TEM_CONTATO.test(t)) return { ok: false, motivo: 'contato' };
  if (TEM_LINK.test(t)) return { ok: false, motivo: 'link' };
  if (TEM_TELEFONE.test(t)) return { ok: false, motivo: 'contato' };
  const { partes, cortado } = partirParaOChat(t, 1, MAX_LETRAS_DO_ROBO);
  if (!partes[0]) return { ok: false, motivo: 'vazio' };
  return { ok: true, texto: partes[0], cortado };
}

/** O texto da equipe (resposta pública): sem espaço sobrando, de 1 a 1.000 letras. */
export function textoDaEquipe(v: unknown): { ok: true; texto: string } | { ok: false; erro: string } {
  const texto = typeof v === 'string' ? v.replace(/\r\n/g, '\n').trim() : '';
  if (!texto) return { ok: false, erro: 'Escreva a resposta.' };
  if (Array.from(texto).length > MAX_TEXTO_DA_EQUIPE) return { ok: false, erro: 'Resposta longa demais (até 1.000 letras).' };
  return { ok: true, texto };
}

/** A resposta privada que o robô manda quando chama a equipe e não disse o que mandar. */
export function privadaPadrao(usuario: string | null | undefined): string {
  const u = String(usuario ?? '').trim().replace(/^@/, '');
  return `Oi${u ? `, @${u}` : ''}! Vimos o seu comentário e a nossa equipe vai continuar o atendimento por aqui, no Direct.`;
}

// ───────────────────────── a mensagem ao robô ─────────────────────────

/** O cardápio que o robô usa (o mesmo do Direct — `InstagramService.cardapioDoRobo`). */
export type CardapioDoComentario = {
  token: string;
  aberto: boolean;
  nomePublico: string | null;
  roboSaudacao: string | null;
  roboAusencia: string | null;
  roboPrompt: string | null;
  roboMensagens: any;
};

/**
 * O comentário no formato que o robô (n8n) recebe — o MESMO das outras vias (`MsgNormalizada`; o Direct em
 * `instagram.service.ts` › `mensagemParaORobo`; o chat em `atendente-no-chat.ts`): a chave `cm:<comentário de cima>` em
 * `instancia` e em `de` (a mesma na conversa do comentário), o comentário que ele responde em `mensagemId`, sem
 * `phoneNumberId` (o n8n acha a loja pela instância), `provedor` 'instagram' (só texto), `conversa` NULA (ver
 * `conversa-do-robo.ts`) e `comentario` = o tipo do post e a legenda (até 200 letras).
 */
export function mensagemDoComentarioParaORobo(o: {
  tenantId: string;
  comentarioId: string;
  paiId: string | null;
  autorUsuario: string | null;
  texto: string;
  em: Date | string;
  midiaTipo: string | null;
  legenda: string | null;
  cardapio: CardapioDoComentario;
}) {
  const chave = chaveDoComentario({ comentarioId: o.comentarioId, paiId: o.paiId });
  const c = o.cardapio;
  const legenda = String(o.legenda ?? '').replace(/\s+/g, ' ').trim();
  return {
    provedor: 'instagram' as const,
    tenantId: o.tenantId,
    cardapioToken: c.token,
    phoneNumberId: null,
    instancia: chave,
    jid: null,
    loja: { nome: c.nomePublico ?? null, aberto: c.aberto !== false },
    de: chave,
    nome: o.autorUsuario || null,
    tipo: 'text' as const,
    texto: o.texto,
    mensagemId: o.comentarioId,
    timestamp: Math.floor(new Date(o.em).getTime() / 1000),
    midiaId: null,
    opcaoId: null,
    roboSaudacao: c.roboSaudacao ?? null,
    roboAusencia: c.roboAusencia ?? null,
    roboPrompt: c.roboPrompt ?? null,
    roboMensagens: Array.isArray(c.roboMensagens) ? c.roboMensagens : [],
    conversa: null,
    comentario: { midiaTipo: o.midiaTipo ?? null, legenda: legenda ? Array.from(legenda).slice(0, LEGENDA_PARA_O_ROBO).join('') : null },
  };
}

// ───────────────────────── o erro da Meta ─────────────────────────

/** O erro da Meta em poucas palavras para a tela (o código em `code`), sem o acesso e sem o texto de ninguém. */
export function traduzirErroDaMeta(e: unknown): { code: string; message: string } {
  const m = e instanceof ErroDaMeta ? e : null;
  const cod = m?.codigo ?? null;
  if (!m || m.status === 0) return { code: 'META_FORA_DO_AR', message: 'O Instagram não respondeu agora. Tente de novo em instantes.' };
  if (cod === 190) return { code: 'META_ACESSO_VENCIDO', message: 'O acesso ao Instagram venceu: reconecte a conta em Delivery › Configurações › Atendimento.' };
  if (cod === 10 || cod === 200 || cod === 3 || (cod !== null && cod >= 200 && cod <= 299))
    return { code: 'META_SEM_PERMISSAO', message: 'A conta do Instagram não deu a permissão dos comentários: reconecte em Delivery › Configurações › Atendimento.' };
  if (cod === 4 || cod === 17 || cod === 32 || cod === 613)
    return { code: 'META_LIMITE', message: 'O Instagram limitou as respostas agora. Tente de novo daqui a pouco.' };
  if (cod === 100 || m.status === 404)
    return { code: 'META_COMENTARIO_INDISPONIVEL', message: 'O Instagram recusou: o comentário pode ter sido apagado ou escondido.' };
  if (cod === 551 || cod === 10903)
    return { code: 'META_PESSOA_INDISPONIVEL', message: 'O Instagram não deixou mandar para esta pessoa agora.' };
  return { code: 'META_RECUSOU', message: 'O Instagram recusou a ação.' };
}

// ───────────────────────── o cursor da lista ─────────────────────────

/** O cursor da próxima página: a data e o id do último item (a ordem é comentado_em desc, id desc). */
export function cursorDe(item: { comentadoEm: string | Date; id: string }): string {
  return Buffer.from(JSON.stringify({ e: new Date(item.comentadoEm).toISOString(), i: item.id })).toString('base64url');
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** O cursor que a tela mandou: válido → a data e o id; qualquer outra coisa → null (começa do início). */
export function lerCursor(v: unknown): { em: string; id: string } | null {
  if (typeof v !== 'string' || !v || v.length > 200) return null;
  try {
    const j = JSON.parse(Buffer.from(v, 'base64url').toString('utf8'));
    if (typeof j?.e !== 'string' || typeof j?.i !== 'string' || !UUID.test(j.i) || Number.isNaN(new Date(j.e).getTime())) return null;
    return { em: new Date(j.e).toISOString(), id: j.i };
  } catch {
    return null;
  }
}

/** O filtro da lista (o que não for um dos quatro = "sem resposta", o padrão da tela). */
export function filtroDaLista(v: unknown): FiltroDosComentarios {
  return (FILTROS as readonly string[]).includes(String(v)) ? (v as FiltroDosComentarios) : 'sem-resposta';
}
