// Construtor de comandos ESC/POS para impressoras termicas (cozinha/cupom).
// Converte o TEXTO do job (renderTicket/renderViaCliente do backend) em bytes
// ESC/POS, interpretando as convencoes que o backend ja emite:
//   '*** ... ***'      -> titulo (centralizado, negrito, fonte dupla)
//   '>>> SENHA n <<<'  -> destaque (centralizado, fonte dupla)
//   '  ** OBS: ...'    -> observacao (negrito)
//   '  >> ...' / '   ' -> complemento/indentado (mantem recuo)
//   '----'             -> separador
// Acentos sao transliterados para ASCII: evita lixo por divergencia de codepage
// entre impressoras (robustez > acento; os tickets ja sao majoritariamente ASCII).

const ESC = 0x1b;
const GS = 0x1d;

// ---- primitivos ESC/POS ----
const init = () => [ESC, 0x40]; // ESC @  (reset)
const boldOn = () => [ESC, 0x45, 1]; // ESC E 1
const boldOff = () => [ESC, 0x45, 0]; // ESC E 0
const align = (n) => [ESC, 0x61, n]; // 0=esq 1=centro 2=dir
const fontA = () => [ESC, 0x4d, 0]; // ESC M 0 (fonte normal ~12x24)
const fontB = () => [ESC, 0x4d, 1]; // ESC M 1 (fonte pequena/condensada ~9x17)
const sizeNormal = () => [GS, 0x21, 0x00]; // GS ! 0
const sizeDouble = () => [GS, 0x21, 0x11]; // GS ! (dupla largura+altura)
// Magnificacao inteira 1..4 (GS ! n = (w-1)<<4 | (h-1)); 1=normal, 2=dupla.
const sizeMag = (n) => {
  const m = Math.max(0, Math.min(3, (Number(n) || 1) - 1));
  return [GS, 0x21, (m << 4) | m];
};
const feed = (n) => [ESC, 0x64, n]; // ESC d n  (avanca n linhas)
const beep = (n = 2, t = 3) => [ESC, 0x42, n, t]; // ESC B n t  (bipe)
// Corte parcial com avanco (compat. Epson/genericas): GS V 66 n
const cut = () => [GS, 0x56, 66, 0x00];
// Abre a gaveta de dinheiro (kick drawer): ESC p m t1 t2 — pino 0, pulso ~50/200ms. Emitido
// quando o conteudo do ticket tem uma linha '@GAVETA' (o gerador do cupom decide quando pedir).
const abrirGaveta = () => [ESC, 0x70, 0x00, 0x19, 0xfa];

// Remove acentos/diacriticos -> ASCII. Mantem legivel em qualquer codepage.
function ascii(s) {
  return String(s == null ? '' : s)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // remove diacriticos
    .replace(/[^\x20-\x7e]/g, ''); // descarta o que nao for ASCII imprimivel
}

const colsDe = (largura) => (Number(largura) === 58 ? 32 : 48);

// Quebra a linha em varias respeitando a largura e preservando o recuo.
function wrap(texto, cols) {
  const t = texto.replace(/\s+$/,'');
  if (t.length <= cols) return [t];
  const recuo = (t.match(/^\s*/) || [''])[0];
  const palavras = t.trim().split(/\s+/);
  const linhas = [];
  let atual = recuo;
  for (const p of palavras) {
    const cand = atual.trim() ? `${atual} ${p}` : `${recuo}${p}`;
    if (cand.length > cols && atual.trim()) {
      linhas.push(atual);
      atual = `${recuo}${p}`;
    } else {
      atual = cand;
    }
  }
  if (atual.trim()) linhas.push(atual);
  return linhas.length ? linhas : [''];
}

// Classifica a linha do ticket e devolve o estilo a aplicar.
function estilo(linhaBruta) {
  const l = linhaBruta.trim();
  if (/^\*{2,}.*\*{2,}$/.test(l) || /^\*{3}/.test(l))
    return { align: 1, bold: true, size: 'double' };
  if (/^>>>.*<<<$/.test(l) || /^>>> SENHA/i.test(l))
    return { align: 1, bold: true, size: 'double' };
  if (/^\*\*\s*OBS|OBS:/i.test(l) || /^\*\*/.test(l))
    return { align: 0, bold: true, size: 'normal' };
  return { align: 0, bold: false, size: 'normal' };
}

// ---- Código de barras / QR (etiquetas de validade, mig 136) ----
// Code128 (m=73), code set B: GS k 73 n {B<dados>
function barcode128(data) {
  const d = '{B' + String(data);
  const bytes = [...Buffer.from(ascii(d), 'ascii')];
  return [GS, 0x48, 0x02, GS, 0x77, 0x02, GS, 0x68, 0x50, GS, 0x6b, 73, bytes.length, ...bytes];
}
// EAN-13 (m=67): 12 dígitos (dígito verificador calculado pela impressora).
function barcodeEan13(data) {
  const d = String(data).replace(/\D/g, '').slice(0, 12).padStart(12, '0');
  const bytes = [...Buffer.from(d, 'ascii')];
  return [GS, 0x48, 0x02, GS, 0x77, 0x03, GS, 0x68, 0x50, GS, 0x6b, 67, bytes.length, ...bytes];
}
// QR Code via GS ( k (modelo 2).
function qrCode(data) {
  const d = [...Buffer.from(ascii(data), 'ascii')];
  const len = d.length + 3;
  const pL = len & 0xff, pH = (len >> 8) & 0xff;
  const model = [GS, 0x28, 0x6b, 4, 0, 0x31, 0x41, 0x32, 0x00];
  const size = [GS, 0x28, 0x6b, 3, 0, 0x31, 0x43, 6];
  const err = [GS, 0x28, 0x6b, 3, 0, 0x31, 0x45, 0x31];
  const store = [GS, 0x28, 0x6b, pL, pH, 0x31, 0x50, 0x30, ...d];
  const print = [GS, 0x28, 0x6b, 3, 0, 0x31, 0x51, 0x30];
  return [...model, ...size, ...err, ...store, ...print];
}

// Renderiza uma ETIQUETA de validade (texto + código de barras/QR). O backend emite:
//   '@ETIQUETA' (marcador), '@B<texto>' (negrito), texto puro,
//   '@BARCODE:code128|ean13:<cod>', '@QR:<payload>'.
function renderEtiqueta(conteudo, largura) {
  const cols = colsDe(largura);
  const out = [];
  const push = (arr) => out.push(...arr);
  const texto = (s) => push([...Buffer.from(ascii(s), 'ascii')]);
  push(init());
  push(align(1)); // etiqueta centralizada
  for (const raw of String(conteudo ?? '').split(/\r?\n/)) {
    if (raw.startsWith('@ETIQUETA')) continue; // header (@ETIQUETA:LxA) — bobina ignora o tamanho
    if (raw.startsWith('@QR:')) { push(qrCode(raw.slice(4))); push([0x0a]); continue; }
    if (raw.startsWith('@BARCODE:')) {
      const [, tipo, cod] = raw.split(':');
      push(tipo === 'ean13' ? barcodeEan13(cod) : barcode128(cod));
      push([0x0a]);
      continue;
    }
    const bold = raw.startsWith('@B');
    const linha = bold ? raw.slice(2) : raw;
    if (bold) push(boldOn());
    for (const parte of wrap(linha, cols)) { texto(parte); push([0x0a]); }
    if (bold) push(boldOff());
  }
  push(sizeNormal()); push(boldOff()); push(align(0));
  push(feed(2));
  push(cut());
  return Buffer.from(out);
}

// Monta o Buffer completo de um ticket a partir do texto do job.
// `linguagem` (mig 180) roteia a ETIQUETA por modelo de impressora:
//   'zpl' (Zebra/Elgin L42/Argox) | 'epl' (EPL2/PPLB) | 'escpos'/undefined (bobina).
export function renderEscpos(conteudo, largura = 80, linguagem) {
  const s = String(conteudo ?? '');
  // Etiqueta de validade: caminho próprio por MODELO da impressora.
  if (s.startsWith('@ETIQUETA')) {
    const lang = String(linguagem || 'escpos').toLowerCase();
    if (lang === 'zpl') return renderEtiquetaZpl(s);
    if (lang === 'epl') return renderEtiquetaEpl(s);
    return renderEtiqueta(s, largura); // térmica de bobina (ESC/POS)
  }
  const cols = colsDe(largura);
  const out = [];
  const push = (arr) => out.push(...arr);
  const texto = (s) => push([...Buffer.from(ascii(s), 'ascii')]);

  push(init());
  const linhas = String(conteudo ?? '').split(/\r?\n/);
  for (const linhaRaw of linhas) {
    // Gaveta de dinheiro (P4): linha '@GAVETA' abre a gaveta (kick drawer) sem imprimir nada.
    if (linhaRaw.trim() === '@GAVETA') {
      push(abrirGaveta());
      continue;
    }
    // QR do cupom por perfil (Fase 3): '@QR:<dados>' vira um QR centralizado.
    if (linhaRaw.startsWith('@QR:')) {
      push(align(1)); push(qrCode(linhaRaw.slice(4))); push([0x0a]); push(align(0));
      continue;
    }
    // Duas colunas (Fase 4): '@LR<esq>|<dir>' — esquerda + direita alinhada,
    // preenchendo a largura da bobina. Se não couber, corta.
    if (linhaRaw.startsWith('@LR')) {
      const body = linhaRaw.slice(3);
      const bar = body.indexOf('|');
      const left = ascii(bar >= 0 ? body.slice(0, bar) : body);
      const right = ascii(bar >= 0 ? body.slice(bar + 1) : '');
      const combined =
        left.length + right.length >= cols
          ? `${left} ${right}`.slice(0, cols)
          : left + ' '.repeat(cols - left.length - right.length) + right;
      push(align(0)); push(fontA()); push(sizeNormal()); texto(combined); push([0x0a]);
      continue;
    }
    // Marcadores LIMPOS do cupom por perfil (removidos do texto): @C centro, @R
    // direita, @B negrito — combináveis (@CB, @RB). Sem prefixo, cai no estilo()
    // legado (mantém '*** ***'/'** OBS' funcionando).
    let linha = linhaRaw;
    let alignForce = null;
    let boldForce = false;
    let sizeForce = null; // magnificacao 2..4, ou null
    let smallForce = false; // Font B (fonte pequena embutida)
    // Flags: C centro, R direita, B negrito, S fonte pequena (Font B), D fonte
    // grande. D sozinho = 2x (compat.); D3/D4 = 3x/4x. Combinaveis (@CBSD3).
    // Digito so vem depois do D.
    const pm = linha.match(/^@((?:[CRBS]|D[2-4]?)+)(?: |\b)/);
    if (pm) {
      const f = pm[1];
      if (f.includes('C')) alignForce = 1;
      if (f.includes('R')) alignForce = 2;
      if (f.includes('B')) boldForce = true;
      if (f.includes('S')) smallForce = true;
      if (f.includes('D')) { const md = f.match(/D([2-4])/); sizeForce = md ? Number(md[1]) : 2; }
      linha = linha.slice(pm[0].length);
    }
    const st = estilo(linha);
    const al = alignForce != null ? alignForce : st.align;
    const bold = boldForce || st.bold;
    // Normaliza tamanho para magnificacao numerica (estilo() legado usa 'double').
    const mag = sizeForce != null ? sizeForce : st.size === 'double' ? 2 : 1;
    push(align(al));
    push(smallForce ? fontB() : fontA());
    push(sizeMag(mag));
    if (bold) push(boldOn());
    // Font B (~2/3 da largura) cabe mais coluna por linha.
    const colsFonte = smallForce ? Math.floor((cols * 4) / 3) : cols;
    for (const parte of wrap(linha, Math.floor(colsFonte / mag))) {
      texto(parte);
      push([0x0a]); // LF
    }
    if (bold) push(boldOff());
  }
  // rodape: reseta estilo, avanca, bipa e corta
  push(sizeNormal());
  push(fontA());
  push(boldOff());
  push(align(0));
  push(feed(3));
  push(beep(2, 3));
  push(cut());
  return Buffer.from(out);
}

// ---- Etiquetadoras (ZPL / EPL) — mig 180 ----
// Interpreta o MESMO texto do job da etiqueta (@ETIQUETA:LxA, @B<texto>, texto,
// @BARCODE:tipo:cod, @QR:cod) e gera a linguagem da etiquetadora, usando o TAMANHO
// (mm) do header. 203 dpi = 8 dots/mm (padrão Elgin L42/Zebra desktop).
const DPMM = 8;
function parseEtiqueta(conteudo) {
  const linhas = String(conteudo ?? '').split(/\r?\n/);
  let tamanho = '40x40';
  const textos = []; // { texto, bold }
  let code = null; // { tipo:'code128'|'ean13'|'qr'|'plain', valor }
  for (const raw of linhas) {
    if (raw.startsWith('@ETIQUETA')) {
      const m = raw.match(/(\d+)\s*x\s*(\d+)/i);
      if (m) tamanho = `${m[1]}x${m[2]}`;
      continue;
    }
    if (raw.startsWith('@QR:')) { code = { tipo: 'qr', valor: raw.slice(4) }; continue; }
    if (raw.startsWith('@BARCODE:')) {
      const [, tipo, cod] = raw.split(':');
      code = { tipo: tipo || 'code128', valor: cod ?? '' };
      continue;
    }
    const bold = raw.startsWith('@B');
    const texto = bold ? raw.slice(2) : raw;
    if (texto.trim()) textos.push({ texto, bold });
    else if (!code && /^\d{6,}$/.test(raw.trim())) code = { tipo: 'plain', valor: raw.trim() };
  }
  const [w, h] = tamanho.split('x').map((x) => Number(x) || 40);
  return { textos, code, wMm: w, hMm: h };
}
const digits = (s) => String(s ?? '').replace(/\D/g, '').slice(0, 12).padStart(12, '0');
const zplEsc = (s) => ascii(s).replace(/[\^~]/g, ' '); // ^ e ~ são prefixos de comando ZPL
const eplEsc = (s) => ascii(s).replace(/"/g, "'"); // aspas fecham o dado EPL

function renderEtiquetaZpl(conteudo) {
  const { textos, code, wMm, hMm } = parseEtiqueta(conteudo);
  const W = Math.round(wMm * DPMM);
  const L = Math.round(hMm * DPMM);
  const out = ['^XA', '^CI28', `^PW${W}`, `^LL${L}`, '^LH0,0'];
  let y = 12;
  for (const t of textos) {
    const fh = t.bold ? 32 : 26;
    out.push(`^FO14,${y}^A0N,${fh},${fh}^FD${zplEsc(t.texto)}^FS`);
    y += fh + 6;
  }
  if (code) {
    y += 6;
    if (code.tipo === 'qr') out.push(`^FO14,${y}^BQN,2,5^FDLA,${zplEsc(code.valor)}^FS`);
    else if (code.tipo === 'ean13') out.push(`^FO14,${y}^BY2^BEN,60,Y,N^FD${digits(code.valor)}^FS`);
    else out.push(`^FO14,${y}^BY2^BCN,60,Y,N,N^FD${zplEsc(code.valor)}^FS`);
  }
  out.push('^XZ');
  return Buffer.from(out.join('\n') + '\n', 'utf8');
}

function renderEtiquetaEpl(conteudo) {
  const { textos, code, wMm, hMm } = parseEtiqueta(conteudo);
  const W = Math.round(wMm * DPMM);
  const L = Math.round(hMm * DPMM);
  // N=limpa buffer; q=largura; Q=altura,gap(~3mm). A=texto; B=código; P1=imprime 1.
  const out = ['', 'N', `q${W}`, `Q${L},24`];
  let y = 12;
  for (const t of textos) {
    out.push(`A14,${y},0,3,1,1,N,"${eplEsc(t.texto)}"`);
    y += 30;
  }
  if (code) {
    y += 8;
    if (code.tipo === 'ean13') out.push(`B14,${y},0,E30,2,4,60,N,"${digits(code.valor)}"`);
    else out.push(`B14,${y},0,1,2,4,60,N,"${eplEsc(code.valor)}"`); // Code128 (QR/plain caem aqui)
  }
  out.push('P1');
  return Buffer.from(out.join('\n') + '\n', 'ascii');
}

// Pagina de teste (botao "imprimir teste" do painel).
export function paginaTeste(nomeImpressora, largura = 80) {
  const linha = '-'.repeat(colsDe(largura));
  const txt = [
    '*** TESTE REGEM ***',
    linha,
    `Impressora: ${nomeImpressora || '-'}`,
    `Largura: ${largura}mm`,
    `Data: ${new Date().toLocaleString('pt-BR')}`,
    linha,
    'Acentuacao: cafe, acai, pao',
    '1x X-Salada',
    '  >> sem cebola',
    '  ** OBS: ponto da carne',
    linha,
    'Se leu isto, a impressora esta OK.',
  ].join('\n');
  return renderEscpos(txt, largura);
}
