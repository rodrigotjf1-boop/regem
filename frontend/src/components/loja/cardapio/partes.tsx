'use client';

import type { ReactNode } from 'react';
import { brl, SELO } from '@/components/loja/tipos';

/* eslint-disable @typescript-eslint/no-explicit-any, @next/next/no-img-element */

// Peças pequenas usadas pelos quatro templates do cardápio: ícones, foto, preço, selo e as contas
// de cor da loja (texto sobre a cor, tom suave).

const TRACOS = {
  search: (<><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></>),
  back: <path d="M15 18l-6-6 6-6" />,
  close: <path d="M18 6 6 18M6 6l12 12" />,
  plus: <path d="M12 5v14M5 12h14" />,
  minus: <path d="M5 12h14" />,
  check: <path d="m5 12 5 5 9-10" />,
  bag: (<><path d="M5 8h14l-1 12H6L5 8Z" /><path d="M9 8V6a3 3 0 0 1 6 0v2" /></>),
  trash: <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" />,
  gift: (<><rect x="3" y="8" width="18" height="13" rx="2" /><path d="M12 8v13M3 12h18M12 8S10 3 7.5 4.5 9 8 12 8Zm0 0s2-5 4.5-3.5S15 8 12 8Z" /></>),
  clock: (<><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>),
  moto: (<><circle cx="6" cy="17" r="3" /><circle cx="18" cy="17" r="3" /><path d="M9 17h6l-3-7H8M15 10h3l2 4" /></>),
  store: <path d="M4 10v10h16V10M3 10l2-6h14l2 6M3 10h18" />,
  chev: <path d="m9 6 6 6-6 6" />,
  down: <path d="m6 9 6 6 6-6" />,
  repeat: <path d="M4 12a8 8 0 0 1 14-5l2 2M20 12a8 8 0 0 1-14 5l-2-2M20 4v5h-5M4 20v-5h5" />,
  tag: (<><path d="M3 12V4h8l10 10-8 8L3 12Z" /><circle cx="7.5" cy="7.5" r="1.5" /></>),
  pin: (<><path d="M12 21s7-6.5 7-12a7 7 0 0 0-14 0c0 5.5 7 12 7 12Z" /><circle cx="12" cy="9" r="2.5" /></>),
  copy: (<><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V5a1 1 0 0 1 1-1h10" /></>),
  user: (<><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></>),
  cash: (<><rect x="2" y="6" width="20" height="12" rx="2" /><circle cx="12" cy="12" r="3" /></>),
  card: (<><rect x="2" y="5" width="20" height="14" rx="2" /><path d="M2 10h20" /></>),
  bell: <path d="M6 9a6 6 0 0 1 12 0c0 6 2 7 2 7H4s2-1 2-7Zm4 10a2 2 0 0 0 4 0" />,
  sun: (<><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>),
  moon: <path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5Z" />,
  chat: <path d="M4 5h16v11H9l-5 4V5Z" />,
  link: (<><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" /><path d="M14 10a4 4 0 0 0-5.7 0l-3 3A4 4 0 0 0 11 18.7l1-1" /></>),
} as const;
export type NomeIcone = keyof typeof TRACOS;

export function Ic({ n, s = 20 }: { n: NomeIcone; s?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={s} height={s} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {TRACOS[n]}
    </svg>
  );
}

export { brl };

/** Foto do produto; sem foto, um quadro neutro (nunca um emoji). */
export function Foto({ src, alt = '' }: { src?: string | null; alt?: string }) {
  if (src) return <img src={src} alt={alt} loading="lazy" />;
  return (
    <span className="p-semfoto" aria-hidden="true">
      <Ic n="bag" s={22} />
    </span>
  );
}

/** Logo da loja: a imagem, ou as iniciais do nome. */
export function Logo({ loja }: { loja: any }) {
  if (loja?.logoRef) return <img src={loja.logoRef} alt={loja?.nome ?? ''} />;
  return <>{siglaDe(loja?.nome)}</>;
}

export function siglaDe(nome?: string | null): string {
  const p = String(nome ?? '').trim().split(/\s+/).filter(Boolean);
  if (!p.length) return '';
  return (p.length === 1 ? p[0].slice(0, 2) : p[0][0] + p[1][0]).toUpperCase();
}

/** `#rgb` ou `#rrggbb` → [r, g, b]; qualquer outra coisa cai no dourado do Regem. */
function rgbDe(cor: string): [number, number, number] {
  let h = String(cor ?? '').trim().replace('#', '');
  if (/^[0-9a-f]{3}$/i.test(h)) h = h.split('').map((x) => x + x).join('');
  if (!/^[0-9a-f]{6}$/i.test(h)) h = 'E2A340';
  const n = parseInt(h, 16);
  return [n >> 16, (n >> 8) & 255, n & 255];
}
/** A cor do texto sobre a cor da loja: escura quando a cor é clara (luminância > 0,45). */
export function corSobre(cor: string): string {
  const l = rgbDe(cor).map((v) => {
    const x = v / 255;
    return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * l[0] + 0.7152 * l[1] + 0.0722 * l[2] > 0.45 ? '#1A1206' : '#FFFFFF';
}
export function corSuave(cor: string, a: number): string {
  const [r, g, b] = rgbDe(cor);
  return `rgba(${r},${g},${b},${a})`;
}

export const pctDesconto = (p: any): number =>
  p?.precoDe != null && Number(p.precoDe) > 0 ? Math.round((1 - Number(p.precoVenda) / Number(p.precoDe)) * 100) : 0;

/** Preço "de/por". */
export function Preco({ p }: { p: any }) {
  return (
    <>
      {p.precoDe != null && <s>{brl(p.precoDe)}</s>}
      <span>{brl(p.precoVenda)}</span>
    </>
  );
}

/** O texto do primeiro selo do produto (sem o emoji do cadastro antigo), ou "Sugerido". */
export function seloDe(p: any): string | null {
  const s = (p?.selos ?? [])[0];
  if (s) return rotuloSelo(s);
  return p?.destaque ? 'Sugerido' : null;
}
export function rotuloSelo(s: string): string {
  return String(SELO[s] ?? s).replace(/^[^\p{L}\p{N}]+/u, '').trim();
}
/** Todos os selos (tela do produto). */
export function selosDe(p: any): string[] {
  const l = (p?.selos ?? []).map(rotuloSelo);
  if (p?.destaque) l.push('Sugerido');
  return l;
}

/** Linha "N min · em até Nx" (serviços e parcelamento), quando existe. */
export function extrasDe(p: any, loja: any): string {
  return [p?.duracaoMin ? `${p.duracaoMin} min` : '', loja?.parcelasMax > 1 ? `em até ${loja.parcelasMax}x` : ''].filter(Boolean).join(' · ');
}

/** Caixa de seleção desenhada (o protótipo não usa `<input type=checkbox>`). */
export function Caixa({
  marcada,
  onMudar,
  children,
  className = '',
  rotulo,
}: {
  marcada: boolean;
  onMudar: (v: boolean) => void;
  children: ReactNode;
  className?: string;
  rotulo?: string;
}) {
  return (
    <button type="button" className={`c-chk ${className}`} aria-pressed={marcada} aria-label={rotulo} onClick={() => onMudar(!marcada)}>
      <i>{marcada && <Ic n="check" s={14} />}</i>
      <span>{children}</span>
    </button>
  );
}

/** Contador − n + (linha da sacola e quantidade do produto). */
export function Qtd({ n, onMenos, onMais, lixeira = false, max }: { n: number; onMenos: () => void; onMais: () => void; lixeira?: boolean; max?: number }) {
  return (
    <div className="qty">
      <button type="button" onClick={onMenos} aria-label={lixeira && n <= 1 ? 'Remover' : 'Diminuir'}>
        <Ic n={lixeira && n <= 1 ? 'trash' : 'minus'} s={15} />
      </button>
      <b>{n}</b>
      <button type="button" onClick={onMais} disabled={max != null && n >= max} aria-label="Aumentar">
        <Ic n="plus" s={15} />
      </button>
    </div>
  );
}

/** Rola até o campo que falta, destaca o bloco e foca o input (rodapé "o que falta"). */
export function irAoCampo(raiz: HTMLElement | null, campo: string) {
  if (!raiz || !campo) return;
  const alvo = raiz.querySelector<HTMLElement>(`[data-campo="${campo}"]`);
  if (!alvo) return;
  alvo.scrollIntoView({ behavior: 'smooth', block: 'center' });
  const bloco = alvo.closest<HTMLElement>('.pg,.c-f,.c-pay,.c-card,.c-sec') ?? alvo;
  bloco.classList.remove('flash');
  void bloco.offsetWidth;
  bloco.classList.add('flash');
  if (alvo.matches('input,select,textarea')) setTimeout(() => alvo.focus({ preventScroll: true }), 350);
}
