// ENFEITE DO TOPO de cada evento (pisca-pisca, bandeirinhas, teia com aranha, faixa de gramado…),
// montado na largura da tela. Vem do protótipo aprovado. O resultado é HTML fixo deste arquivo
// (nada do usuário), decorativo e sem toque — o componente o põe num bloco `aria-hidden`.
import { BALAO, BOLA, BURGER, GRAVATA, coracao, estrela, flor, ovo, sv } from './arte';
import type { DefEvento } from './catalogo';

/** Sorteio com semente: o enfeite sai igual a cada desenho (não "pula" quando a tela redesenha). */
function sorteio(semente: number) {
  let s = semente;
  return () => {
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Item { w: number; cls?: string; html: string }

/** Um varal de ponta a ponta com um item pendurado a cada `gap` pixels. */
function varal(W: number, o: { sag: number; gap: number; fio: string; item: (i: number) => Item }): string {
  const { sag, gap, fio, item } = o;
  const seg = W / 2;
  const n = Math.max(6, Math.floor(W / gap));
  let h = `<svg class="w" width="${W}" height="44" viewBox="0 0 ${W} 44"><path d="M0 3 Q${seg / 2} ${3 + 2 * sag} ${seg} 3 Q${seg * 1.5} ${3 + 2 * sag} ${W} 3" class="fv" fill="none" stroke="${fio}" stroke-width="1.3"/></svg>`;
  for (let i = 0; i < n; i++) {
    const x = ((i + 0.5) * W) / n;
    const t = (x % seg) / seg;
    const y = 3 + 4 * sag * t * (1 - t);
    const ang = Math.atan((4 * sag * (1 - 2 * t)) / seg) * 57.3;
    const it = item(i);
    h += `<span class="it" style="left:${x.toFixed(1)}px;top:${(y - 1.5).toFixed(1)}px;width:${it.w}px;margin-left:${-it.w / 2}px;transform:rotate(${ang.toFixed(1)}deg)"><span class="${it.cls || ''}" style="--d:${((i * 37) % 17) / -6}s">${it.html}</span></span>`;
  }
  return h;
}

function teia(): string {
  const cx = 90;
  const cy = 0;
  const rad = [200, 215, 232, 250, 268].map((a) => (a * Math.PI) / 180);
  const aneis = [16, 32, 50, 70, 92];
  let d = '';
  for (const a of rad) d += `M${cx} ${cy} L${cx + Math.cos(a) * 96} ${cy - Math.sin(a) * 96} `;
  for (const r of aneis)
    for (let i = 0; i < rad.length - 1; i++) {
      const a1 = rad[i];
      const a2 = rad[i + 1];
      const x1 = cx + Math.cos(a1) * r;
      const y1 = cy - Math.sin(a1) * r;
      const x2 = cx + Math.cos(a2) * r;
      const y2 = cy - Math.sin(a2) * r;
      const mx = cx + Math.cos((a1 + a2) / 2) * r * 0.82;
      const my = cy - Math.sin((a1 + a2) / 2) * r * 0.82;
      d += `M${x1.toFixed(1)} ${y1.toFixed(1)} Q${mx.toFixed(1)} ${my.toFixed(1)} ${x2.toFixed(1)} ${y2.toFixed(1)} `;
    }
  return `<svg class="web" viewBox="0 0 90 90"><path d="${d}" fill="none" stroke="rgba(70,60,90,.55)" stroke-width=".9"/></svg>`;
}

const COR = (n: number) => ['#E63946', '#FACC15', '#2EC4B6', '#3B82F6', '#F97316', '#E879F9'][n % 6];

/** O HTML do enfeite e a classe extra do bloco. `largura` em pixels (a da tela do cardápio). */
export function enfeiteDoTopo(tipo: DefEvento['topo'], largura: number): { html: string; classe: string } {
  const W = Math.max(280, Math.round(largura));
  let html = '';
  let classe = '';
  switch (tipo) {
    case 'luzes':
      html = varal(W, { sag: 9, gap: 24, fio: '#2F3B2C', item: (i) => ({ w: 9, html: `<i class="bulb" style="--c:${['#FF4D4D', '#FFD23F', '#3DDC97', '#4EA8FF', '#FF8FD8'][i % 5]}"></i>` }) });
      break;
    case 'bandeirinhas':
      html = varal(W, { sag: 10, gap: 19, fio: '#7C2D12', item: (i) => ({ w: 16, cls: 'sw', html: `<i class="flag" style="--c:${['#E63946', '#FACC15', '#2A9D8F', '#F4A261', '#3B82F6', '#EC4899'][i % 6]}"></i>` }) });
      break;
    case 'bandeirolas':
      html =
        varal(W, { sag: 10, gap: 20, fio: '#334155', item: (i) => ({ w: 14, cls: 'sw', html: `<i class="penn" style="--c:${COR(i)}"></i>` }) }) +
        `<span class="balc">${sv('0 0 60 70', BALAO(18, 20, 13, '#EF4444') + BALAO(40, 16, 13, '#FACC15') + BALAO(30, 34, 12, '#3B82F6'))}</span>`;
      break;
    case 'coracoes':
      html = varal(W, { sag: 9, gap: 24, fio: '#9F1239', item: (i) => ({ w: 15, cls: 'sw', html: sv('0 0 64 60', coracao(['#E11D48', '#FB7185', '#BE123C'][i % 3])) }) });
      break;
    case 'ovos':
      html = varal(W, { sag: 9, gap: 22, fio: '#8B6F4E', item: (i) => ({ w: 12, cls: 'sw', html: ovo(['#C4B5FD', '#F9A8D4', '#6EE7B7', '#FDE68A', '#93C5FD'][i % 5]) }) });
      break;
    case 'flores':
      html = varal(W, {
        sag: 8, gap: 22, fio: '#3E9C6A',
        item: (i) => ({
          w: 16,
          html: i % 2
            ? sv('0 0 24 24', `<ellipse cx="12" cy="10" rx="7" ry="3.2" fill="#4CAF7A" transform="rotate(${i % 4 ? 30 : -30} 12 10)"/>`)
            : sv('0 0 24 24', flor(12, 12, 11, ['#F27B8C', '#FBA6B5', '#fff'][((i / 2) | 0) % 3])),
        }),
      });
      break;
    case 'estrelas': {
      const r = sorteio(7);
      const n = Math.floor(W / 34);
      for (let i = 0; i < n; i++) {
        const x = ((i + 0.5) * W) / n;
        const len = 8 + Math.floor(r() * 26);
        const sz = 10 + Math.floor(r() * 8);
        html += `<span class="it" style="left:${x.toFixed(1)}px;top:0;width:${sz}px;margin-left:${-sz / 2}px"><span class="sw" style="--d:${-r() * 3}s;display:block"><i class="fio" style="height:${len}px"></i>${sv('0 0 24 24', estrela(12, 12, 11, i % 3 ? '#E7B53C' : '#F8E7A6'))}</span></span>`;
      }
      classe = 'est';
      break;
    }
    case 'serpentinas': {
      const r = sorteio(3);
      const fitas = ([['#FACC15', 8, 6, 30], ['#EC4899', 14, 7, 38], ['#10B981', 22, 5, 26]] as [string, number, number, number][])
        .map(([c, b, a, per]) => {
          let d = `M0 ${b}`;
          for (let x = 6; x <= W; x += 6) d += ` L${x} ${(b + Math.sin(((x / per) * 2 * Math.PI) / 2 + b) * a).toFixed(1)}`;
          return `<path d="${d}" stroke="${c}" stroke-width="3" fill="none" stroke-linecap="round"/>`;
        })
        .join('');
      let pontos = '';
      for (let i = 0; i < 22; i++) pontos += `<rect x="${(r() * W).toFixed(0)}" y="${(r() * 40).toFixed(0)}" width="5" height="3" fill="${COR(i)}" transform="rotate(${(r() * 180).toFixed(0)} ${(r() * W).toFixed(0)} 20)"/>`;
      html = `<svg class="w" width="${W}" height="44" viewBox="0 0 ${W} 44">${fitas}${pontos}</svg>`;
      break;
    }
    case 'teia':
      html = `${teia()}<span class="aranha"><i class="fio"></i>${sv('0 0 24 24', `<g stroke="#1B1028" stroke-width="1.4" fill="none"><path d="M8 10 L2 6 M8 12 L1 12 M8 14 L2 18 M16 10 L22 6 M16 12 L23 12 M16 14 L22 18"/></g><ellipse cx="12" cy="12" rx="5" ry="6" fill="#1B1028"/><circle cx="10.3" cy="10" r="1.1" fill="#F97316"/><circle cx="13.7" cy="10" r="1.1" fill="#F97316"/>`)}</span>`;
      break;
    case 'burgers':
      html = varal(W, { sag: 9, gap: 26, fio: '#6B3A1E', item: () => ({ w: 18, cls: 'sw', html: sv('0 0 64 60', BURGER()) }) });
      break;
    case 'gramado':
      html = `<div class="gramado" style="--ev-w:${W}px"><i class="linha"></i><span class="bolinha">${sv('0 0 40 40', BOLA(20, 20, 18))}</span></div>`;
      break;
    case 'xadrez':
      html = `<i class="xadrez"></i><span class="bow">${sv('0 0 40 32', GRAVATA)}</span>`;
      break;
    case 'fita':
      html = `<div class="fita"><span>${'BLACK FRIDAY · PREÇO BLACK · '.repeat(Math.max(8, Math.ceil(W / 90)))}</span></div>`;
      break;
  }
  return { html, classe };
}
