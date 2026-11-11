import type { CSSProperties } from 'react';

// As cores da página de vagas: as da LOJA (Página de vagas › Identidade; vazias = a cor do cardápio online). Sem cor
// nenhuma, o verde e o dourado do Regem. A página é ESCURA (fundo `--vg-bg`): a cor principal vira a luz do topo e o
// fundo dos ícones; a de destaque, o botão e os números. O texto sobre cada cor sai do contraste (WCAG, mesma regra do
// cardápio — `corSobre` em `components/loja/cardapio/partes.tsx`), nunca branco fixo; e a cor usada como TEXTO sobre o
// fundo escuro é clareada até passar 4,5:1 (um destaque escuro, como vinho, sumiria).
const PRINCIPAL_PADRAO = '#0F6647';
const DESTAQUE_PADRAO = '#E8A845';
const HEX = /^#[0-9a-fA-F]{6}$/;
/** O fundo da página (também em `vagas.css` e no `themeColor` do layout). */
export const FUNDO_DAS_VAGAS = '#0D0D10';

const rgb = (hex: string): [number, number, number] => {
  const n = parseInt(hex.slice(1), 16);
  return [n >> 16, (n >> 8) & 255, n & 255];
};
const paraHex = (c: number[]) => `#${c.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('')}`;
function luminancia(hex: string): number {
  const l = rgb(hex).map((v) => {
    const x = v / 255;
    return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * l[0] + 0.7152 * l[1] + 0.0722 * l[2];
}
const contraste = (a: string, b: string) => {
  const [x, y] = [luminancia(a), luminancia(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
};
const textoSobre = (hex: string) => (luminancia(hex) > 0.45 ? '#1A1206' : '#FFFFFF');
const suave = (hex: string, a: number) => `rgba(${rgb(hex).join(',')},${a})`;
const misturar = (hex: string, com: string, quanto: number) => {
  const a = rgb(hex);
  const b = rgb(com);
  return paraHex(a.map((v, i) => v + (b[i] - v) * quanto));
};
/** A cor clareada (rumo ao branco) até ter `alvo`:1 sobre o fundo escuro. */
function legivelNoEscuro(hex: string, alvo = 4.5): string {
  let c = hex;
  for (let q = 0.1; contraste(c, FUNDO_DAS_VAGAS) < alvo && q <= 1; q += 0.1) c = misturar(hex, '#FFFFFF', q);
  return c;
}

export function varsDoTema(cores: { principal: string | null; destaque: string | null } | undefined): CSSProperties {
  const p = cores?.principal && HEX.test(cores.principal) ? cores.principal : PRINCIPAL_PADRAO;
  const d = cores?.destaque && HEX.test(cores.destaque) ? cores.destaque : DESTAQUE_PADRAO;
  const dClara = misturar(d, '#FFFFFF', 0.35);
  return {
    '--vg-p': p,
    '--vg-p-luz': suave(p, 0.75), // a luz do topo
    '--vg-p-ic': suave(p, 0.32), // fundo dos ícones das vagas
    '--vg-d': d,
    '--vg-d2': dClara, // o fim do degradê do botão e do título
    '--vg-d-luz': suave(d, 0.28),
    '--vg-dc': suave(d, 0.14), // escolha marcada
    '--vg-d-anel': suave(d, 0.24), // brilho do foco
    '--vg-dt': legivelNoEscuro(d), // destaque como texto (salário, números)
    '--vg-on-d': textoSobre(misturar(d, dClara, 0.5)), // texto sobre o botão em degradê
  } as CSSProperties;
}
