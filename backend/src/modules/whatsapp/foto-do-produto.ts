import { and, eq, isNull } from 'drizzle-orm';
import { produto } from '../../db/schema';
import { buscarUrlPublica } from '../../common/ssrf-guard';

/* eslint-disable @typescript-eslint/no-explicit-any */

// A FOTO DO PRODUTO NO LINK DO ROBÔ (F5 — decisão do dono, 31/10/2026: "sempre que falar de 1 produto"). Quando o robô
// manda o link DIRETO de um produto (`?produto=<id>`), a mensagem do botão "Ver no cardápio" leva a foto do cadastro em
// cima. No teste, o cliente pediu "tem foto do Trio 07?" e o robô respondeu que não conseguia mandar foto.
// A foto é um endereço que a LOJA cadastrou: só vai se for pública (V68 — `buscarUrlPublica`, que confere cada
// redirecionamento), JPEG ou PNG e até 5 MB (o limite de imagem da Meta). Senão a mensagem vai sem a foto — nunca falha.

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

/** A foto do produto do link (da mesma loja, não apagado), se servir; senão null. */
export async function fotoDoProduto(db: any, tenantId: string, link: string, buscar?: typeof buscarUrlPublica): Promise<string | null> {
  const id = produtoDoLink(link);
  if (!id) return null;
  const [p] = await db
    .select({ imagem: produto.imagemRef })
    .from(produto)
    .where(and(eq(produto.id, id), eq(produto.tenantId, tenantId), isNull(produto.deletedAt)));
  const imagem = String(p?.imagem ?? '').trim();
  if (!/^https:\/\//i.test(imagem)) return null;
  return (await fotoServe(imagem, buscar)) ? imagem : null;
}

/** Só para teste. */
export function esquecerFotosConferidas(): void {
  conferidas.clear();
}
