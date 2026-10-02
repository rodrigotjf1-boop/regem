// PARTÍCULAS DOS EVENTOS — um canvas só, lista fixa (no máximo 50 de fundo), sem alocar por quadro.
// Para de desenhar quando a aba está oculta ou quando não há nada na tela. Vem do protótipo
// aprovado; aqui virou uma classe presa ao canvas que o componente cria.
import type { Particula } from './catalogo';

interface P {
  k: Particula;
  c: string;
  x: number; y: number; vx: number; vy: number;
  s: number; ph: number; rot: number; vr: number; a: number; sw: number;
  dir?: number; base?: number; tw?: number;
  g?: number; life?: number; max?: number; temp?: boolean;
}

const MAX_FUNDO = 50;
const r = Math.random;

export class Particulas {
  private x: CanvasRenderingContext2D;
  private w = 0;
  private h = 0;
  private fundo: P[] = [];
  private soltas: P[] = [];
  private raf = 0;
  private paleta: string[] = ['#fff'];
  private fogosAoAcaso = false;
  /** Tema escuro: morcego e etiqueta pretos somem no fundo — trocam de cor. */
  escuro = false;
  private obs: ResizeObserver | null = null;
  private aoVoltar = () => { if (!document.hidden) this.acordar(); };

  constructor(private canvas: HTMLCanvasElement) {
    this.x = canvas.getContext('2d') as CanvasRenderingContext2D;
    this.medir();
    if (typeof ResizeObserver !== 'undefined') {
      this.obs = new ResizeObserver(() => this.medir());
      this.obs.observe(canvas);
    }
    document.addEventListener('visibilitychange', this.aoVoltar);
  }

  get largura() { return this.w; }
  get altura() { return this.h; }

  private medir() {
    const b = this.canvas.getBoundingClientRect();
    const d = Math.min(2, window.devicePixelRatio || 1);
    this.w = b.width;
    this.h = b.height;
    this.canvas.width = Math.round(b.width * d);
    this.canvas.height = Math.round(b.height * d);
    this.x.setTransform(d, 0, 0, d, 0, 0);
  }

  /** Liga o fundo do evento (ou desliga, com `null`). As partículas soltas terminam o voo. */
  definir(cfg: { particulas: [Particula, number][]; paleta: string[]; fogos?: boolean } | null) {
    this.fundo = [];
    this.fogosAoAcaso = false;
    if (cfg) {
      this.paleta = cfg.paleta.length ? cfg.paleta : ['#fff'];
      this.fogosAoAcaso = !!cfg.fogos;
      for (const [tipo, n] of cfg.particulas) for (let i = 0; i < n && this.fundo.length < MAX_FUNDO; i++) this.fundo.push(this.nascer(tipo, true));
    }
    this.acordar();
  }

  destruir() {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.obs?.disconnect();
    document.removeEventListener('visibilitychange', this.aoVoltar);
    this.fundo = [];
    this.soltas = [];
  }

  private acordar() {
    if (!this.raf && (this.fundo.length || this.soltas.length)) this.raf = requestAnimationFrame(() => this.quadro());
  }

  private nascer(k: Particula, inicial: boolean): P {
    const W = this.w;
    const H = this.h;
    const p: P = { k, c: this.paleta[Math.floor(r() * this.paleta.length)], x: r() * W, y: inicial ? r() * H : -20, ph: r() * 6.28, rot: r() * 6.28, vr: (r() - 0.5) * 0.06, a: 1, vx: 0, vy: 0, sw: 0, s: 3 };
    if (k === 'snow') { p.s = 1.3 + r() * 2.9; p.vy = 0.35 + p.s * 0.2; p.vx = (r() - 0.5) * 0.25; p.sw = 0.5 + r() * 0.8; p.c = '#fff'; }
    else if (k === 'confete') { p.s = 4 + r() * 4; p.vy = 0.8 + r() * 1.2; p.vx = (r() - 0.5) * 0.5; p.sw = 0.6; }
    else if (k === 'serp') { p.s = 12 + r() * 10; p.vy = 0.6 + r() * 0.6; p.vx = (r() - 0.5) * 0.4; p.vr = (r() - 0.5) * 0.03; }
    else if (k === 'heart') { p.s = 6 + r() * 7; if (!inicial) p.y = H + 20; p.vy = -(0.35 + r() * 0.6); p.sw = 0.8 + r(); p.a = 0.9; }
    else if (k === 'petal') { p.s = 4 + r() * 4; p.vy = 0.5 + r() * 0.6; p.vx = 0.15 + r() * 0.35; p.sw = 0.8; }
    else if (k === 'bat') { p.s = 9 + r() * 6; p.dir = r() < 0.5 ? 1 : -1; if (!inicial) p.x = p.dir > 0 ? -30 : W + 30; p.base = 40 + r() * H * 0.45; p.y = p.base; p.vx = p.dir * (0.7 + r() * 0.8); p.vy = 0; }
    else if (k === 'leaf') { p.s = 5 + r() * 4; p.vy = 0.6 + r() * 0.6; p.vx = (r() - 0.3) * 0.5; p.sw = 1; p.c = ['#EA580C', '#B45309', '#F59E0B', '#92400E'][Math.floor(r() * 4)]; }
    else if (k === 'pop') { p.s = 3 + r() * 2; p.vy = 0.6 + r() * 0.8; p.vx = (r() - 0.5) * 0.3; }
    else if (k === 'balloon') { p.s = 10 + r() * 6; if (!inicial) p.y = H + 40; p.vy = -(0.35 + r() * 0.35); p.sw = 0.5; }
    else if (k === 'star') { p.s = 2 + r() * 4; p.vy = 0.2 + r() * 0.35; p.vx = (r() - 0.5) * 0.2; p.tw = r() * 6; }
    else if (k === 'tag') { p.s = 9 + r() * 4; p.vy = 0.6 + r() * 0.7; p.vx = (r() - 0.5) * 0.3; }
    else if (k === 'egg') { p.s = 4 + r() * 3; p.vy = 0.5 + r() * 0.5; }
    else if (k === 'candy') { p.s = 4 + r() * 3; p.vy = 0.6; p.c = ['#F97316', '#A855F7', '#22C55E', '#FACC15'][Math.floor(r() * 4)]; }
    else if (k === 'spark') { p.s = 1.8; }
    else if (k === 'seed') { p.s = 2 + r() * 1.2; p.vy = 0.6 + r() * 0.7; p.vx = (r() - 0.5) * 0.3; p.sw = 0.5; }
    else if (k === 'burger') { p.s = 10 + r() * 5; p.vy = 0.5 + r() * 0.5; p.vx = (r() - 0.5) * 0.3; p.vr = (r() - 0.5) * 0.03; }
    return p;
  }

  private desenhar(p: P) {
    const x = this.x;
    const s = p.s;
    x.save();
    x.globalAlpha = Math.max(0, Math.min(1, p.a));
    x.translate(p.x, p.y);
    switch (p.k) {
      case 'snow': x.beginPath(); x.arc(0, 0, s, 0, 7); x.fillStyle = '#fff'; x.fill(); x.lineWidth = 0.8; x.strokeStyle = 'rgba(100,130,170,.5)'; x.stroke(); break;
      case 'confete': x.rotate(p.rot); x.scale(1, Math.cos(p.ph * 3)); x.fillStyle = p.c; x.fillRect(-s / 2, -s / 4, s, s / 2); break;
      case 'serp': x.rotate(p.rot); x.beginPath(); for (let i = 0; i <= 14; i++) { const t = i / 14; const xx = (t - 0.5) * s * 2; const yy = Math.sin(t * 10 + p.ph * 2) * 3; if (i) x.lineTo(xx, yy); else x.moveTo(xx, yy); } x.strokeStyle = p.c; x.lineWidth = 2.2; x.lineCap = 'round'; x.stroke(); break;
      case 'heart': x.rotate(Math.sin(p.ph) * 0.25); x.beginPath(); x.moveTo(0, s * 0.35); x.bezierCurveTo(-s * 1.2, -s * 0.4, -s * 0.5, -s * 1.1, 0, -s * 0.45); x.bezierCurveTo(s * 0.5, -s * 1.1, s * 1.2, -s * 0.4, 0, s * 0.35); x.fillStyle = p.c; x.fill(); break;
      case 'petal': x.rotate(p.rot); x.scale(1, 0.6 + 0.4 * Math.cos(p.ph * 2)); x.beginPath(); x.ellipse(0, 0, s, s * 0.55, 0, 0, 7); x.fillStyle = p.c; x.fill(); break;
      case 'bat': {
        const f = Math.sin(p.ph * 14);
        x.scale(p.dir ?? 1, 1); x.fillStyle = this.escuro ? '#C9B8E8' : '#2A1B3D'; x.beginPath(); x.ellipse(0, 0, s * 0.28, s * 0.4, 0, 0, 7); x.fill();
        for (const m of [-1, 1]) { x.beginPath(); x.moveTo(0, -s * 0.05); x.quadraticCurveTo(m * s * 0.6, -s * 0.5 * f - s * 0.25, m * s * 1.4, -s * 0.25 * f); x.quadraticCurveTo(m * s * 1.05, s * 0.05, m * s * 0.85, s * 0.3); x.quadraticCurveTo(m * s * 0.55, s * 0.05, 0, s * 0.2); x.fill(); }
        x.beginPath(); x.moveTo(-s * 0.18, -s * 0.3); x.lineTo(-s * 0.12, -s * 0.55); x.lineTo(-s * 0.02, -s * 0.36); x.moveTo(s * 0.18, -s * 0.3); x.lineTo(s * 0.12, -s * 0.55); x.lineTo(s * 0.02, -s * 0.36); x.fill();
        break;
      }
      case 'leaf': x.rotate(p.rot); x.beginPath(); x.ellipse(0, 0, s, s * 0.5, 0, 0, 7); x.fillStyle = p.c; x.fill(); x.beginPath(); x.moveTo(-s, 0); x.lineTo(s, 0); x.strokeStyle = 'rgba(0,0,0,.25)'; x.lineWidth = 0.8; x.stroke(); break;
      case 'pop':
        x.rotate(p.rot);
        for (const [dx, dy, k] of [[0, 0, 1], [s * 0.8, -s * 0.3, 0.8], [-s * 0.7, -s * 0.4, 0.8], [s * 0.1, -s * 0.9, 0.75]]) { x.beginPath(); x.arc(dx, dy, s * k, 0, 7); x.fillStyle = '#FFF8E6'; x.fill(); x.strokeStyle = 'rgba(190,140,60,.55)'; x.lineWidth = 0.8; x.stroke(); }
        x.beginPath(); x.arc(0, s * 0.2, s * 0.45, 0, 7); x.fillStyle = '#F6D365'; x.fill();
        break;
      case 'balloon': {
        const sw = Math.sin(p.ph) * 4;
        x.beginPath(); x.moveTo(0, s); x.quadraticCurveTo(sw, s * 1.7, -sw * 0.5, s * 2.4); x.strokeStyle = 'rgba(60,70,90,.35)'; x.lineWidth = 1; x.stroke();
        x.beginPath(); x.ellipse(0, 0, s * 0.85, s, 0, 0, 7); x.fillStyle = p.c; x.fill();
        x.beginPath(); x.ellipse(-s * 0.3, -s * 0.4, s * 0.17, s * 0.3, -0.4, 0, 7); x.fillStyle = 'rgba(255,255,255,.45)'; x.fill();
        break;
      }
      case 'star': x.globalAlpha *= 0.35 + 0.65 * Math.abs(Math.sin(p.ph * 2 + (p.tw || 0))); x.beginPath(); x.moveTo(0, -s); x.quadraticCurveTo(0, 0, s, 0); x.quadraticCurveTo(0, 0, 0, s); x.quadraticCurveTo(0, 0, -s, 0); x.quadraticCurveTo(0, 0, 0, -s); x.fillStyle = p.c; x.fill(); break;
      case 'tag': x.rotate(p.rot); x.fillStyle = this.escuro ? '#FACC15' : '#0A0A0A'; x.beginPath(); x.moveTo(-s * 0.5, -s * 0.42); x.lineTo(s * 0.8, -s * 0.42); x.lineTo(s * 0.8, s * 0.42); x.lineTo(-s * 0.5, s * 0.42); x.lineTo(-s * 0.9, 0); x.closePath(); x.fill(); x.fillStyle = this.escuro ? '#0A0A0A' : '#FACC15'; x.beginPath(); x.arc(-s * 0.55, 0, s * 0.11, 0, 7); x.fill(); x.font = `700 ${Math.round(s * 0.75)}px Anton, Impact, sans-serif`; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('%', s * 0.18, s * 0.04); break;
      case 'egg': x.rotate(p.rot); x.beginPath(); x.ellipse(0, 0, s * 0.75, s, 0, 0, 7); x.fillStyle = p.c; x.fill(); x.beginPath(); x.moveTo(-s * 0.72, 0); for (let i = 1; i <= 4; i++) x.lineTo(-s * 0.72 + i * s * 0.36, (i % 2 ? -1 : 1) * s * 0.18); x.strokeStyle = '#fff'; x.lineWidth = 1.2; x.stroke(); break;
      case 'candy': x.rotate(p.rot); x.fillStyle = p.c; x.beginPath(); x.moveTo(-s, 0); x.lineTo(-s * 1.8, -s * 0.6); x.lineTo(-s * 1.8, s * 0.6); x.closePath(); x.moveTo(s, 0); x.lineTo(s * 1.8, -s * 0.6); x.lineTo(s * 1.8, s * 0.6); x.closePath(); x.fill(); x.beginPath(); x.arc(0, 0, s, 0, 7); x.fill(); x.strokeStyle = 'rgba(255,255,255,.7)'; x.lineWidth = 1.2; x.beginPath(); x.arc(0, 0, s * 0.55, 0, 4); x.stroke(); break;
      case 'spark': x.beginPath(); x.arc(0, 0, s, 0, 7); x.fillStyle = p.c; x.fill(); break;
      case 'seed': x.rotate(p.rot); x.beginPath(); x.ellipse(0, 0, s * 1.6, s * 0.8, 0, 0, 7); x.fillStyle = '#FFF3D6'; x.fill(); x.strokeStyle = 'rgba(150,100,40,.6)'; x.lineWidth = 0.7; x.stroke(); break;
      case 'burger': x.rotate(Math.sin(p.ph) * 0.3 + p.rot * 0.2); x.fillStyle = '#F4A340'; x.beginPath(); x.ellipse(0, -s * 0.25, s, s * 0.55, 0, Math.PI, 0); x.fill(); x.fillStyle = '#4CAF50'; x.fillRect(-s, -s * 0.22, s * 2, s * 0.16); x.fillStyle = '#FACC15'; x.fillRect(-s * 0.9, -s * 0.08, s * 1.8, s * 0.14); x.fillStyle = '#6B3A1E'; x.fillRect(-s * 0.95, s * 0.04, s * 1.9, s * 0.3); x.fillStyle = '#E8902F'; x.beginPath(); x.ellipse(0, s * 0.36, s, s * 0.26, 0, 0, Math.PI); x.fill(); break;
    }
    x.restore();
  }

  /** Um fogo de artifício. */
  fogos(x0: number, y0: number) {
    const pal = ['#E7B53C', '#F8E7A6', '#FFFFFF', '#F472B6', '#60A5FA'];
    const c = pal[Math.floor(r() * pal.length)];
    for (let i = 0; i < 36; i++) {
      const a = (i / 36) * Math.PI * 2;
      const v = 1.4 + r() * 1.6;
      const p = this.nascer('spark', false);
      Object.assign(p, { x: x0, y: y0, vx: Math.cos(a) * v, vy: Math.sin(a) * v, g: 0.035, life: 60 + r() * 25, c: r() < 0.7 ? c : '#fff' });
      p.max = p.life;
      this.soltas.push(p);
    }
    this.acordar();
  }

  /** Estouro de partículas num ponto (item na sacola, confirmação, mini-jogo). */
  estouro(tipos: Particula[], pt: { x: number; y: number }, n: number, paleta?: string[]) {
    if (!this.w) return;
    if (paleta?.length) this.paleta = paleta;
    if (tipos.includes('spark')) {
      this.fogos(pt.x, pt.y);
      if (tipos.length === 1) return;
    }
    for (let i = 0; i < n; i++) {
      const bruto = tipos[i % tipos.length];
      const tipo: Particula = bruto === 'spark' ? 'star' : bruto;
      const a = r() * Math.PI * 2;
      const v = 1.6 + r() * 3.2;
      const p = this.nascer(tipo, false);
      Object.assign(p, { x: pt.x, y: pt.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 2.4, g: tipo === 'heart' || tipo === 'balloon' ? -0.015 : 0.13, life: 48 + r() * 30, vr: (r() - 0.5) * 0.2 });
      if (tipo === 'snow') p.s = 2 + r() * 2.5;
      p.max = p.life;
      this.soltas.push(p);
    }
    this.acordar();
  }

  /** Revoada de morcegos atravessando a tela (a "travessura" do Halloween). */
  morcegos(n: number) {
    for (let i = 0; i < n; i++) {
      const p = this.nascer('bat', false);
      p.temp = true;
      p.vx *= 2.4;
      p.base = 30 + r() * this.h * 0.7;
      this.fundo.push(p);
    }
    this.acordar();
  }

  private quadro() {
    this.raf = 0;
    if (document.hidden) return;
    const x = this.x;
    const W = this.w;
    const H = this.h;
    x.clearRect(0, 0, W, H);
    for (let i = this.fundo.length - 1; i >= 0; i--) {
      const p = this.fundo[i];
      p.ph += 0.02;
      p.rot += p.vr;
      if (p.k === 'bat') {
        p.x += p.vx;
        p.y = (p.base ?? 0) + Math.sin(p.ph * 3) * 10;
        if (p.x < -40 || p.x > W + 40) { if (p.temp) this.fundo.splice(i, 1); else this.fundo[i] = this.nascer('bat', false); continue; }
      } else {
        p.x += p.vx + Math.sin(p.ph) * p.sw * 0.4;
        p.y += p.vy;
        if (p.y > H + 30 || p.y < -60 || p.x < -40 || p.x > W + 40) { if (p.temp) this.fundo.splice(i, 1); else this.fundo[i] = this.nascer(p.k, false); continue; }
      }
      this.desenhar(p);
    }
    for (let i = this.soltas.length - 1; i >= 0; i--) {
      const p = this.soltas[i];
      p.vx *= 0.985;
      p.vy += p.g ?? 0;
      p.x += p.vx;
      p.y += p.vy;
      p.rot += p.vr * 3;
      p.ph += 0.05;
      p.life = (p.life ?? 0) - 1;
      p.a = Math.min(1, p.life / ((p.max ?? 1) * 0.5));
      if (p.life <= 0) { this.soltas.splice(i, 1); continue; }
      this.desenhar(p);
    }
    if (this.fogosAoAcaso && this.fundo.length && r() < 0.012) this.fogos(30 + r() * (W - 60), 60 + r() * H * 0.35);
    if (this.fundo.length || this.soltas.length) this.raf = requestAnimationFrame(() => this.quadro());
    else x.clearRect(0, 0, W, H);
  }
}
