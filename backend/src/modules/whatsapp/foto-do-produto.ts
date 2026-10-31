import { sql } from 'drizzle-orm';
import { buscarUrlPublica } from '../../common/ssrf-guard';
import { chaveTelefone, formasDaChaveTelefone } from '../../common/telefone-chave';
import { normalizar } from '../cardapio/robo-consultas';
import { nomeJunto, palavrasComNumero } from '../cardapio/robo-busca';
import { hostDe } from './links-do-robo';

/* eslint-disable @typescript-eslint/no-explicit-any */

// A FOTO DO PRODUTO NO LINK DO ROBÔ (F5 — decisão do dono, 31/10/2026: "sempre que falar de 1 produto"). Quando o robô
// manda o link DIRETO de um produto (`?produto=<id>`), a mensagem do botão "Ver no cardápio" leva a foto do cadastro em
// cima. No teste, o cliente pediu "tem foto do Trio 07?" e o robô respondeu que não conseguia mandar foto.
// A foto é um endereço que a LOJA cadastrou: só vai se for pública (V68 — `buscarUrlPublica`, que confere cada
// redirecionamento), JPEG ou PNG e até 5 MB (o limite de imagem da Meta). Senão a mensagem vai sem a foto — nunca falha.
//
// O PRODUTO CERTO (31/10/2026, ERR-335 — 2º teste do dono): "Tem foto do trio 07?" saiu com o link (e a foto) do lanche
// "Numero 07"; logo depois, "Tem foto do trio 08?" saiu com um id que NÃO EXISTE (a IA inventou o link) e sem foto. O
// id no link é o que a IA escreve — chute, como tudo o que ela "lembra" (LIC-500). O Regem confere antes de enviar:
// o cliente pediu a FOTO de um produto pelo nome → vai a desse produto (também quando a IA mandou o link do cardápio
// todo); senão vale o link da IA se o produto existe; link inventado → o produto citado na resposta ou na pergunta;
// nada → o link do cardápio, sem foto.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LIMITE_BYTES = 5 * 1024 * 1024;
const MEMORIA_MS = 30 * 60_000;
const conferidas = new Map<string, { ok: boolean; ate: number }>(); // endereço da foto → serve? até quando lembrar

/** O id do produto no link direto do cardápio ("…/c/<token>?produto=<id>"), ou null. */
export function produtoDoLink(url: string): string | null {
  try {
    const id = new URL(url).searchParams.get('produto');
    return id && UUID.test(id) ? id : null;
  } catch {
    return null;
  }
}

/** A foto serve para a Meta: pública, JPEG/PNG, até 5 MB (pedido só do primeiro byte; lembra por 30 min). */
export async function fotoServe(url: string, buscar: typeof buscarUrlPublica = buscarUrlPublica): Promise<boolean> {
  const agora = Date.now();
  const lembrada = conferidas.get(url);
  if (lembrada && lembrada.ate > agora) return lembrada.ok;
  let ok = false;
  try {
    const res = await buscar(url, { headers: { Range: 'bytes=0-0' }, signal: AbortSignal.timeout(4000) });
    if (res && (res.status === 200 || res.status === 206)) {
      const tipo = String(res.headers.get('content-type') ?? '').toLowerCase();
      const faixa = String(res.headers.get('content-range') ?? '').split('/')[1];
      const total = Number(faixa ?? res.headers.get('content-length') ?? 0);
      ok = /^image\/(jpeg|jpg|png)\b/.test(tipo) && (!Number.isFinite(total) || total <= 0 || total <= LIMITE_BYTES);
    }
    await res?.body?.cancel().catch(() => undefined);
  } catch {
    ok = false;
  }
  if (conferidas.size > 500) for (const [k, v] of conferidas) if (v.ate <= agora) conferidas.delete(k);
  conferidas.set(url, { ok, ate: agora + MEMORIA_MS });
  return ok;
}

export type ProdutoDaLoja = { id: string; nome: string; imagem: string | null };

const linhasDe = (r: any): any[] => (Array.isArray(r) ? r : (r?.rows ?? []));

/** Os produtos que o cardápio mostra — a mesma regra do menu público (`CardapioService.menu`): ativos e não apagados. */
export async function produtosDaLoja(db: any, tenantId: string): Promise<ProdutoDaLoja[]> {
  const r = await db.execute(sql`
    select id, nome, imagem_ref as imagem
      from produto
     where tenant_id = ${tenantId}::uuid and deleted_at is null and ativo = true
     order by nome, id`);
  return linhasDe(r).map((x) => ({ id: String(x.id), nome: String(x.nome ?? '').trim(), imagem: x.imagem ?? null }));
}

/**
 * O que o cliente disse nesta vez: as mensagens dele depois da última resposta da loja (a API oficial grava a conversa
 * — mig 215, só nuvem), dos últimos 15 minutos. O que a loja mandou no MEIO desta vez (o resumo do pedido) não corta a
 * pergunta; a resposta anterior corta. Áudio não tem texto aqui (a transcrição fica no n8n).
 */
export async function perguntaDoCliente(db: any, tenantId: string, telefone: string): Promise<string | null> {
  const formas = formasDaChaveTelefone(chaveTelefone(telefone));
  if (!formas.length) return null;
  const r = await db.execute(sql`
    select direcao, texto
      from whatsapp_mensagem
     where tenant_id = ${tenantId}::uuid
       and telefone in (${sql.join(
         formas.map((f) => sql`${f}`),
         sql`, `,
       )})
       and criado_em > now() - interval '15 minutes'
     order by criado_em desc, id desc
     limit 12`);
  const partes: string[] = [];
  let achou = false;
  for (const l of linhasDe(r)) {
    if (l.direcao !== 'entrada') {
      if (achou) break;
      continue;
    }
    achou = true;
    if (l.texto) partes.unshift(String(l.texto));
  }
  return partes.join('\n').trim() || null;
}

/** O cliente pediu para VER: foto, imagem, "me mostra". */
export const pedeFoto = (texto: unknown): boolean =>
  /\b(fotos?|fotinh[ao]s?|imagem|imagens|mostr(a|e|ar|em))\b/.test(normalizar(texto));

/**
 * O produto que o texto cita PELO NOME — "tem foto do trio 07?" → TRIO 07 (não o "Numero 07"); "x bacon" = "X-Bacon";
 * o mesmo nome em duas categorias vem junto (as duas cópias). Dois produtos diferentes citados ("trio 07 e coca") →
 * null: não dá para saber de qual. O nome maior que contém o menor ("trio x-bacon" contém "x-bacon") é um só.
 */
export function produtoCitado(texto: unknown, produtos: ProdutoDaLoja[]): { nome: string; ids: string[] } | null {
  const t = palavrasComNumero(texto);
  if (!t.length) return null;
  const trechos = new Set<string>();
  for (let i = 0; i < t.length; i++) {
    let s = '';
    for (let j = i; j < t.length && j < i + 12; j++) trechos.add((s += t[j]));
  }
  const achados = new Map<string, { nome: string; ids: string[] }>();
  for (const p of produtos) {
    const alvo = nomeJunto(p.nome);
    if (alvo.length < 3 || !trechos.has(alvo)) continue;
    const g = achados.get(alvo) ?? { nome: p.nome, ids: [] };
    g.ids.push(p.id);
    achados.set(alvo, g);
  }
  const lista = [...achados.entries()].sort((a, b) => b[0].length - a[0].length);
  if (!lista.length) return null;
  const [maior, grupo] = lista[0];
  if (lista.slice(1).some(([alvo]) => !maior.includes(alvo))) return null;
  return grupo;
}

export type EscolhaDoProduto = {
  /** O produto a mostrar (as cópias de mesmo nome, na ordem do cadastro); vazio = nenhum. */
  ids: string[];
  nome: string | null;
  motivo:
    | 'link_do_robo'
    | 'foto_pedida'
    | 'citado_na_resposta'
    | 'citado_na_pergunta'
    | 'sem_produto'
    | 'sem_cadastro'
    | 'link_do_cardapio';
  /** O link sai trocado pelo do produto conferido. */
  trocou: boolean;
  /** O texto da IA sai trocado pela legenda do Regem (ela falava de outro produto ou de um que não existe). */
  legenda: boolean;
};

/**
 * Qual produto vai no botão "Ver no cardápio" (e a foto de qual) — a regra do comentário do topo. `linkDeProduto: false`
 * = a IA mandou o link do cardápio todo: só muda se o cliente pediu a foto de um produto pelo nome (vai esse produto).
 */
export function escolherProduto(e: {
  idDoLink: string | null;
  produtos: ProdutoDaLoja[];
  pergunta: string | null;
  resposta: string;
  linkDeProduto?: boolean;
}): EscolhaDoProduto {
  if (!e.produtos.length) return { ids: [], nome: null, motivo: 'sem_cadastro', trocou: false, legenda: false };
  const doLink = e.idDoLink ? (e.produtos.find((p) => p.id === e.idDoLink) ?? null) : null;
  const doRobo = (p: ProdutoDaLoja): EscolhaDoProduto => ({ ids: [p.id], nome: p.nome, motivo: 'link_do_robo', trocou: false, legenda: false });
  const naPergunta = e.pergunta ? produtoCitado(e.pergunta, e.produtos) : null;
  if (naPergunta && pedeFoto(e.pergunta)) {
    if (doLink && naPergunta.ids.includes(doLink.id)) return doRobo(doLink);
    return { ids: naPergunta.ids, nome: naPergunta.nome, motivo: 'foto_pedida', trocou: true, legenda: true };
  }
  if (e.linkDeProduto === false) return { ids: [], nome: null, motivo: 'link_do_cardapio', trocou: false, legenda: false };
  if (doLink) return doRobo(doLink);
  const naResposta = produtoCitado(e.resposta, e.produtos);
  if (naResposta) return { ids: naResposta.ids, nome: naResposta.nome, motivo: 'citado_na_resposta', trocou: true, legenda: false };
  if (naPergunta) return { ids: naPergunta.ids, nome: naPergunta.nome, motivo: 'citado_na_pergunta', trocou: true, legenda: false };
  return { ids: [], nome: null, motivo: 'sem_produto', trocou: true, legenda: true };
}

/**
 * O link que abre o produto conferido: o da IA com o `produto=` trocado, quando ele é o do cardápio DESTA loja (fica o
 * `u=` do link personalizado); senão, o link do cardápio da loja com o produto.
 */
export function linkComProduto(urlDaIa: string, linkDaLoja: string, produtoId: string): string {
  try {
    const u = new URL(urlDaIa);
    const loja = new URL(linkDaLoja);
    const caminho = (s: string) => s.replace(/\/+$/, '');
    if (hostDe(u.href) === hostDe(loja.href) && caminho(u.pathname) === caminho(loja.pathname)) {
      u.protocol = 'https:';
      u.searchParams.set('produto', produtoId);
      return u.toString();
    }
  } catch {
    /* link que não se lê: vai o da loja */
  }
  return `${linkDaLoja}?produto=${encodeURIComponent(produtoId)}`;
}

/** O texto do Regem no lugar do da IA: com o nome do produto conferido (e se tem foto), ou o convite ao cardápio. */
export function legendaDoProduto(nome: string | null, comFoto: boolean): string {
  if (!nome) return 'Dá uma olhada no cardápio 👇 Lá tem a foto e os detalhes de cada produto.';
  return comFoto
    ? `📸 *${nome}*\nToque em "Ver no cardápio" para ver os detalhes e pedir.`
    : `*${nome}* ainda não tem foto no cardápio 😕\nToque em "Ver no cardápio" para ver os detalhes e pedir.`;
}

/** Só para teste. */
export function esquecerFotosConferidas(): void {
  conferidas.clear();
}
