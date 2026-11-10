import type { CSSProperties } from 'react';

// As cores da página de vagas: as da LOJA (Página de vagas › Identidade; vazias = a cor do cardápio online). Sem cor
// nenhuma, o verde e o dourado do Regem. O texto sobre cada cor sai do contraste (WCAG, mesma regra do cardápio —
// `corSobre` em `components/loja/cardapio/partes.tsx`), nunca branco fixo.
const PRINCIPAL_PADRAO = '#0F6647';
const DESTAQUE_PADRAO = '#E8A845';
const HEX = /^#[0-9a-fA-F]{6}$/;

const rgb = (hex: string): [number, number, number] => {
  const n = parseInt(hex.slice(1), 16);
  return [n >> 16, (n >> 8) & 255, n & 255];
};
function luminancia(hex: string): number {
  const l = rgb(hex).map((v) => {
    const x = v / 255;
    return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * l[0] + 0.7152 * l[1] + 0.0722 * l[2];
}
const textoSobre = (hex: string) => (luminancia(hex) > 0.45 ? '#1A1206' : '#FFFFFF');
const suave = (hex: string, a: number) => `rgba(${rgb(hex).join(',')},${a})`;
function escurecer(hex: string, quanto: number): string {
  return `#${rgb(hex).map((c) => Math.round(c * (1 - quanto)).toString(16).padStart(2, '0')).join('')}`;
}

export function varsDoTema(cores: { principal: string | null; destaque: string | null } | undefined): CSSProperties {
  const p = cores?.principal && HEX.test(cores.principal) ? cores.principal : PRINCIPAL_PADRAO;
  const d = cores?.destaque && HEX.test(cores.destaque) ? cores.destaque : DESTAQUE_PADRAO;
  return {
    '--vg-p': p,
    '--vg-p2': escurecer(p, 0.3),
    '--vg-pc': suave(p, 0.12),
    '--vg-on-p': textoSobre(p),
    '--vg-d': d,
    // texto na cor de destaque sobre fundo claro: escurecida até ter contraste (o laranja puro não passa)
    '--vg-dt': textoSobre(d) === '#FFFFFF' ? d : escurecer(d, 0.38),
    '--vg-dc': suave(d, 0.14),
    '--vg-on-d': textoSobre(d),
  } as CSSProperties;
}
