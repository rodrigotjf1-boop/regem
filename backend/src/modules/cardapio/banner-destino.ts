import { BadRequestException } from '@nestjs/common';

// O DESTINO E O PERÍODO DO BANNER do cardápio online (fase B3 do `docs/plano-clube-e-banner.md`; mig 482). O destino mora
// no campo `link` como antes (`item:<id>`, `category:<id>`, `coupon:<código>`, `https://…`) e ganhou os novos do
// protótipo: a página de vagas da loja, o Clube (os prêmios e o álbum; as regras) e as páginas do Regem (avaliar o último
// pedido; as regras do clube). Vazio = "nada" (o banner não abre nada). Funções puras: o serviço e os testes usam.

/** Os destinos fixos (sem valor): o que cada um abre no cardápio. */
export const DESTINOS_FIXOS = {
  vagas: 'A página de vagas da loja',
  'clube:premios': 'Meus prêmios e o álbum',
  'clube:regras': 'Regras do clube',
  'regem:avaliar': 'Avaliar o último pedido',
  'regem:regras': 'Regras do clube',
} as const;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CUPOM = /^[A-Z0-9_-]{1,40}$/;
const DIA = /^\d{4}-\d{2}-\d{2}$/;
export const LINK_MAX = 500;

/** O destino do banner como fica gravado (`null` = nada). Recusa o que o cardápio não sabe abrir. */
export function lerDestinoDoBanner(link: unknown, n: number): string | null {
  const s = typeof link === 'string' ? link.trim() : '';
  if (!s) return null;
  const onde = `Banner ${n}`;
  if (s in DESTINOS_FIXOS) return s;
  const [tipo, ...resto] = s.split(':');
  const valor = resto.join(':');
  if (tipo === 'item' || tipo === 'category') {
    if (!UUID.test(valor)) throw new BadRequestException(`${onde}: escolha ${tipo === 'item' ? 'o produto' : 'a categoria'} de novo.`);
    return `${tipo}:${valor.toLowerCase()}`;
  }
  if (tipo === 'coupon') {
    const codigo = valor.trim().toUpperCase();
    if (!CUPOM.test(codigo)) throw new BadRequestException(`${onde}: escolha o cupom de novo.`);
    return `coupon:${codigo}`;
  }
  if (tipo === 'https' || tipo === 'http') {
    let u: URL;
    try {
      u = new URL(s);
    } catch {
      throw new BadRequestException(`${onde}: o endereço do link externo não é válido.`);
    }
    if (u.protocol !== 'https:') throw new BadRequestException(`${onde}: o link externo precisa começar com https://.`);
    if (s.length > LINK_MAX) throw new BadRequestException(`${onde}: o endereço do link externo passa de ${LINK_MAX} letras.`);
    return u.toString();
  }
  throw new BadRequestException(`${onde}: escolha para onde o banner leva de novo.`);
}

/** O período opcional (AAAA-MM-DD; vazio = sem limite daquele lado). "Até" não pode vir antes de "de". */
export function lerPeriodoDoBanner(de: unknown, ate: unknown, n: number): { de: string | null; ate: string | null } {
  const dia = (v: unknown, rotulo: string) => {
    const s = typeof v === 'string' ? v.trim().slice(0, 10) : '';
    if (!s) return null;
    if (!DIA.test(s) || Number.isNaN(Date.parse(`${s}T12:00:00Z`))) throw new BadRequestException(`Banner ${n}: a data "${rotulo}" não é válida.`);
    return s;
  };
  const p = { de: dia(de, 'aparece de'), ate: dia(ate, 'até') };
  if (p.de && p.ate && p.ate < p.de) throw new BadRequestException(`Banner ${n}: "até" vem antes de "aparece de".`);
  return p;
}

/** Quantos banners o carrossel do cardápio aceita por empresa (a tela de Banners tem o mesmo número). */
export const MAX_BANNERS = 6;

export const TITULO_DO_BANNER_MAX = 60;
export const CHAMADA_DO_BANNER_MAX = 90;
export const DESCRICAO_DO_BANNER_MAX = 200;

/** O texto por cima da imagem e a descrição para leitor de tela (B2, mig 485). Vazio = nulo; longo demais é recusado. */
export function lerTextoDoBanner(
  b: { textoTitulo?: unknown; textoChamada?: unknown; descricao?: unknown },
  n: number,
): { textoTitulo: string | null; textoChamada: string | null; descricao: string | null } {
  const campo = (v: unknown, max: number, rotulo: string) => {
    const s = typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '';
    if (s.length > max) throw new BadRequestException(`Banner ${n}: ${rotulo} passa de ${max} letras.`);
    return s || null;
  };
  return {
    textoTitulo: campo(b.textoTitulo, TITULO_DO_BANNER_MAX, 'o título'),
    textoChamada: campo(b.textoChamada, CHAMADA_DO_BANNER_MAX, 'a chamada'),
    descricao: campo(b.descricao, DESCRICAO_DO_BANNER_MAX, 'o texto para leitor de tela'),
  };
}

/** O GIF do banner (mig 487): vazio = sem animação; só um endereço https de um `.gif`, porque vai direto ao cardápio público. */
export function lerImagemAnimadaDoBanner(v: unknown, n: number): string | null {
  const s = typeof v === 'string' ? v.trim() : '';
  if (!s) return null;
  if (s.length > LINK_MAX || !/^https:\/\/\S+\.gif$/i.test(s)) throw new BadRequestException(`Banner ${n}: a animação precisa ser um GIF guardado na mídia.`);
  return s;
}

/** O banner aparece hoje (AAAA-MM-DD da operação)? Sem período, sempre. */
export function bannerNoPeriodo(b: { apareceDe?: string | Date | null; apareceAte?: string | Date | null }, hoje: string): boolean {
  // O Drizzle entrega a coluna `date` como texto; a data vinda de fora do Drizzle chega como Date.
  const dia = (v: string | Date | null | undefined) => (v instanceof Date ? v.toISOString().slice(0, 10) : v ? String(v).slice(0, 10) : null);
  const de = dia(b.apareceDe);
  const ate = dia(b.apareceAte);
  return (!de || de <= hoje) && (!ate || hoje <= ate);
}
