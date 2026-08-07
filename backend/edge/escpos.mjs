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
const sizeNormal = () => [GS, 0x21, 0x00]; // GS ! 0
const sizeDouble = () => [GS, 0x21, 0x11]; // GS ! (dupla largura+altura)
const feed = (n) => [ESC, 0x64, n]; // ESC d n  (avanca n linhas)
const beep = (n = 2, t = 3) => [ESC, 0x42, n, t]; // ESC B n t  (bipe)
// Corte parcial com avanco (compat. Epson/genericas): GS V 66 n
const cut = () => [GS, 0x56, 66, 0x00];

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
    if (raw === '@ETIQUETA') continue;
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

// Monta o Buffer ESC/POS completo de um ticket a partir do texto do job.
export function renderEscpos(conteudo, largura = 80) {
  // Etiqueta de validade: caminho próprio (código de barras/QR).
  if (String(conteudo ?? '').startsWith('@ETIQUETA')) return renderEtiqueta(conteudo, largura);
  const cols = colsDe(largura);
  const out = [];
  const push = (arr) => out.push(...arr);
  const texto = (s) => push([...Buffer.from(ascii(s), 'ascii')]);

  push(init());
  const linhas = String(conteudo ?? '').split(/\r?\n/);
  for (const linhaRaw of linhas) {
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
      push(align(0)); push(sizeNormal()); texto(combined); push([0x0a]);
      continue;
    }
    // Marcadores LIMPOS do cupom por perfil (removidos do texto): @C centro, @R
    // direita, @B negrito — combináveis (@CB, @RB). Sem prefixo, cai no estilo()
    // legado (mantém '*** ***'/'** OBS' funcionando).
    let linha = linhaRaw;
    let alignForce = null;
    let boldForce = false;
    let sizeForce = null;
    // Flags: C centro, R direita, B negrito, D fonte grande (dupla) — combináveis.
    const pm = linha.match(/^@([CRBD]{1,4})(?: |\b)/);
    if (pm) {
      const f = pm[1];
      if (f.includes('C')) alignForce = 1;
      if (f.includes('R')) alignForce = 2;
      if (f.includes('B')) boldForce = true;
      if (f.includes('D')) sizeForce = 'double';
      linha = linha.slice(pm[0].length);
    }
    const st = estilo(linha);
    const al = alignForce != null ? alignForce : st.align;
    const bold = boldForce || st.bold;
    const size = sizeForce || st.size;
    push(align(al));
    push(size === 'double' ? sizeDouble() : sizeNormal());
    if (bold) push(boldOn());
    for (const parte of wrap(linha, size === 'double' ? Math.floor(cols / 2) : cols)) {
      texto(parte);
      push([0x0a]); // LF
    }
    if (bold) push(boldOff());
  }
  // rodape: reseta estilo, avanca, bipa e corta
  push(sizeNormal());
  push(boldOff());
  push(align(0));
  push(feed(3));
  push(beep(2, 3));
  push(cut());
  return Buffer.from(out);
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
