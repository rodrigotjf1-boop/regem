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

// ---- Página de código (acentos) — mig 269, por impressora ----
// Sem página configurada, os acentos viram letra sem acento (seguro em qualquer impressora —
// comportamento de sempre). Com a página, o ticket sai acentuado: ESC t n seleciona a tabela
// (numeração Epson, seguida pelas térmicas ESC/POS nacionais — Elgin, Bematech em modo ESC/POS,
// Epson, Daruma) e cada caractere vira o byte dela. O que não existe na tabela cai na letra
// sem acento, então nunca sai lixo.
const PAGINAS = {
  // PC860 — Português
  cp860: {
    n: 3,
    mapa: {
      'Ç': 0x80, 'ü': 0x81, 'é': 0x82, 'â': 0x83, 'ã': 0x84, 'à': 0x85, 'Á': 0x86, 'ç': 0x87,
      'ê': 0x88, 'Ê': 0x89, 'è': 0x8a, 'Í': 0x8b, 'Ô': 0x8c, 'ì': 0x8d, 'Ã': 0x8e, 'Â': 0x8f,
      'É': 0x90, 'À': 0x91, 'È': 0x92, 'ô': 0x93, 'õ': 0x94, 'ò': 0x95, 'Ú': 0x96, 'ù': 0x97,
      'Ì': 0x98, 'Õ': 0x99, 'Ü': 0x9a, '¢': 0x9b, '£': 0x9c, 'Ù': 0x9d, 'Ó': 0x9f, 'á': 0xa0,
      'í': 0xa1, 'ó': 0xa2, 'ú': 0xa3, 'ñ': 0xa4, 'Ñ': 0xa5, 'ª': 0xa6, 'º': 0xa7, '¿': 0xa8,
      'Ò': 0xa9, '°': 0xf8,
    },
  },
  // PC850 — Multilíngue (Europa ocidental)
  cp850: {
    n: 2,
    mapa: {
      'Ç': 0x80, 'ü': 0x81, 'é': 0x82, 'â': 0x83, 'ä': 0x84, 'à': 0x85, 'ç': 0x87, 'ê': 0x88,
      'ë': 0x89, 'è': 0x8a, 'ï': 0x8b, 'î': 0x8c, 'ì': 0x8d, 'Ä': 0x8e, 'É': 0x90, 'ô': 0x93,
      'ö': 0x94, 'ò': 0x95, 'û': 0x96, 'ù': 0x97, 'Ö': 0x99, 'Ü': 0x9a, '£': 0x9c, 'á': 0xa0,
      'í': 0xa1, 'ó': 0xa2, 'ú': 0xa3, 'ñ': 0xa4, 'Ñ': 0xa5, 'ª': 0xa6, 'º': 0xa7, '¿': 0xa8,
      'Á': 0xb5, 'Â': 0xb6, 'À': 0xb7, 'ã': 0xc6, 'Ã': 0xc7, 'Ê': 0xd2, 'Ë': 0xd3, 'È': 0xd4,
      'Í': 0xd6, 'Î': 0xd7, 'Ï': 0xd8, 'Ì': 0xde, 'Ó': 0xe0, 'Ô': 0xe2, 'Ò': 0xe3, 'õ': 0xe4,
      'Õ': 0xe5, 'Ú': 0xe9, 'Û': 0xea, 'Ù': 0xeb, '°': 0xf8,
    },
  },
};
export function paginaDeCodigo(codepage) {
  return PAGINAS[String(codepage || '').toLowerCase()] ?? null;
}
// Texto → bytes: ASCII imprimível direto; acento pela página (se houver); o resto sem acento.
function codificar(s, pagina) {
  if (!pagina) return [...Buffer.from(ascii(s), 'ascii')];
  const out = [];
  for (const ch of String(s == null ? '' : s).normalize('NFC')) {
    const c = ch.charCodeAt(0);
    if (c >= 0x20 && c <= 0x7e) out.push(c);
    else if (pagina.mapa[ch] != null) out.push(pagina.mapa[ch]);
    else out.push(...Buffer.from(ascii(ch), 'ascii'));
  }
  return out;
}
// Mesmo comprimento que o texto impresso (para alinhar colunas): um caractere = um byte.
function limpo(s, pagina) {
  if (!pagina) return ascii(s);
  let r = '';
  for (const ch of String(s == null ? '' : s).normalize('NFC')) {
    const c = ch.charCodeAt(0);
    r += (c >= 0x20 && c <= 0x7e) || pagina.mapa[ch] != null ? ch : ascii(ch);
  }
  return r;
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
  const moderna = dadosDaEtiqueta(conteudo);
  if (moderna) return renderEtiquetaModernaBobina(moderna, largura);
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
export function renderEscpos(conteudo, largura = 80, linguagem, codepage) {
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
  const pagina = paginaDeCodigo(codepage);
  const texto = (s) => push(codificar(s, pagina));

  push(init());
  if (pagina) push([ESC, 0x74, pagina.n]); // ESC t n — seleciona a página de código
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
      const left = limpo(bar >= 0 ? body.slice(0, bar) : body, pagina);
      const right = limpo(bar >= 0 ? body.slice(bar + 1) : '', pagina);
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
  const moderna = dadosDaEtiqueta(conteudo);
  if (moderna && W >= MODERNO_MIN_W && L >= MODERNO_MIN_H) return Buffer.from(zplModerno(moderna, W, L), 'utf8');
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
    else out.push(zplCode128(code.valor, y, W));
  }
  out.push('^XZ');
  return Buffer.from(out.join('\n') + '\n', 'utf8');
}

// Code128 na etiquetadora ZPL, sempre dentro da largura do modelo.
//
// A largura das barras é conta fechada: (início + símbolos + verificador) × 11 módulos
// + parada de 13, a 2 pontos por módulo (^BY2). No modo normal do ^BC cada caractere é
// um símbolo: os 12 dígitos do código da etiqueta dão 334 pontos (41,8 mm). No modelo
// de 40 mm (^PW320) a impressora cortava os últimos 28 pontos — a parada inteira — e
// nenhum leitor lia a etiqueta.
//
// Cabe com a margem branca que o leitor exige (10 módulos de cada lado)? A linha sai
// IGUAL à de sempre. Não cabe e o código é só de dígitos em pares? Vai compactado
// ('>;' abre o subconjunto C: um símbolo a cada dois dígitos, 202 pontos), centralizado.
// Nem assim? QR, que é o que cabe.
const C128_MODULO = 2;
const C128_MARGEM = 10 * C128_MODULO;
const c128Largura = (simbolos) => ((simbolos + 2) * 11 + 13) * C128_MODULO;
function zplCode128(valor, y, W) {
  const v = zplEsc(valor);
  if (14 + c128Largura(v.length) + C128_MARGEM <= W) return `^FO14,${y}^BY2^BCN,60,Y,N,N^FD${v}^FS`;
  if (/^(\d\d)+$/.test(v)) {
    const largura = c128Largura(v.length / 2);
    if (largura + 2 * C128_MARGEM <= W) {
      return `^FO${Math.round((W - largura) / 2)},${y}^BY2^BCN,60,Y,N,N^FD>;${v}^FS`;
    }
  }
  return `^FO14,${y}^BQN,2,${W >= 139 ? 5 : 3}^FDLA,${v}^FS`;
}

// ---- Modelo MODERNO da etiqueta de validade (escolha do dono, 06/10/2026) ----
//
// O desenho clássico empilha tudo numa coluna e nunca conferiu a ALTURA: com seis linhas o
// QR passava do fim da etiqueta de 40 mm e saía cortado (ERR-156). O moderno segue o padrão
// dos sistemas de etiqueta de rede: faixa preta com o produto, quem/quando à esquerda, QR
// à direita, e a VALIDADE com o dia da semana em caixa preta ao lado da data grande.
//
// COMO OS DADOS CHEGAM: na própria linha do cabeçalho —
//   '@ETIQUETA:60x40;v=2;d=<JSON em base64url>'
// O servidor de loja ANTIGO lê só o tamanho dessa linha e ignora o resto, e as linhas
// clássicas continuam no corpo do job: versão antiga imprime o clássico, sem erro. Dado
// ausente ou ilegível, etiqueta menor que 40 x 25 mm e etiquetadora EPL → clássico também.
//
// Tudo é posicionado por conta, em pontos (203 dpi = 8 por mm): nada passa da largura nem
// da altura. Sem acento de propósito — sai igual em qualquer etiquetadora.
const MODERNO_MIN_W = 320; // 40 mm
const MODERNO_MIN_H = 200; // 25 mm — menor que isso não cabe o QR
const DIAS_SEMANA = ['DOM', 'SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SAB'];
const dataBr = (s) => /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(s ?? ''));
function diaDaSemana(br) {
  const m = dataBr(br);
  // Meio-dia UTC: o dia da semana não depende do fuso da máquina.
  return m ? DIAS_SEMANA[new Date(Date.UTC(+m[3], +m[2] - 1, +m[1], 12)).getUTCDay()] : '';
}
function dadosDaEtiqueta(conteudo) {
  const cabecalho = String(conteudo ?? '').split(/\r?\n/, 1)[0];
  const m = /;d=([A-Za-z0-9_-]+)/.exec(cabecalho);
  if (!m) return null;
  try {
    const d = JSON.parse(Buffer.from(m[1], 'base64url').toString('utf8'));
    if (d?.m !== 'moderno' || !String(d.produto ?? '').trim() || !dataBr(d.validade)) return null;
    return d;
  } catch {
    return null; // cabeçalho estragado nunca derruba a impressão: sai o clássico
  }
}

// Largura média de um caractere da fonte 0 do ZPL, em fração da altura.
const LARG_MAIUSC = 0.54;
const LARG_MISTA = 0.47;
const LARG_NUM = 0.45;
const cabem = (largura, h, fator = LARG_MISTA) => Math.max(1, Math.floor(largura / (h * fator)));
const cortar = (t, n) => (t.length > n ? t.slice(0, Math.max(1, n - 1)).trimEnd() + '.' : t);
// Corta o texto para caber na largura. Texto todo em maiúsculas (código de lote) é mais
// largo que nome com minúsculas — medir os dois igual deixava o lote invadir o QR. Quem
// decide é o texto JÁ cortado: "LOTE X-77  Fornecedor" cortado vira só maiúsculas.
const caber = (t, largura, h) => {
  const curto = cortar(t, cabem(largura, h, LARG_MISTA));
  return curto === curto.toUpperCase() ? cortar(t, cabem(largura, h, LARG_MAIUSC)) : curto;
};

function zplModerno(d, Wreal, Hreal) {
  // Maior que 60 x 40: o MESMO desenho, ampliado (até 2x). As contas são feitas em pontos
  // "lógicos" e `u()` converte na hora de escrever.
  const s = Math.min(2, Math.max(1, Math.min(Wreal / 480, Hreal / 320)));
  const u = (n) => Math.round(n * s);
  const W = Math.floor(Wreal / s);
  // Etiqueta muito mais alta que larga (100 x 150): o desenho ocupa o topo, não se espalha.
  const H = Math.min(Math.floor(Hreal / s), 330);
  const z = ['^XA', '^CI28', `^PW${Wreal}`, `^LL${Hreal}`, '^LH0,0'];
  const caixa = (x, y, w, h, espessura = Math.min(w, h)) =>
    z.push(`^FO${u(x)},${u(y)}^GB${u(w)},${u(h)},${Math.max(1, u(espessura))}^FS`);
  const texto = (x, y, h, t, o = {}) =>
    z.push(
      `^FO${u(x)},${u(y)}^A0N,${u(h)},${u(o.larg ?? h)}${o.inv ? '^FR' : ''}` +
        `${o.bloco ? `^FB${u(o.bloco)},${o.linhas ?? 1},0,${o.alinha ?? 'L'}` : ''}^FD${t}^FS`,
    );

  const M = 8;
  const X = 12;
  const alta = H >= 300; // 37,5 mm: tem rodapé
  const media = H >= 230; // 29 mm: tem o rótulo VALIDADE
  const status = zplEsc(d.status ?? '').toUpperCase().slice(0, 12);
  const loja = zplEsc(d.loja ?? '');

  // 1) Faixa preta com o produto: a maior letra que couber numa linha; senão, duas linhas.
  const faixaH = alta ? 60 : media ? 46 : 38;
  caixa(M, M, W - 2 * M, faixaH);
  const nome = zplEsc(d.produto).toUpperCase();
  const largNome = W - 2 * M - 20;
  const h1 = (alta ? [44, 38, 32, 28] : media ? [34, 30, 26, 22] : [28, 24, 20]).find(
    (h) => nome.length * h * LARG_MAIUSC <= largNome,
  );
  if (h1) texto(M + 10, M + Math.round((faixaH - h1) / 2) + 2, h1, nome, { inv: true });
  else {
    const h2 = Math.floor((faixaH - 6) / 2);
    // Corta com folga: texto que sobra do bloco de duas linhas seria impresso por cima.
    const limite = Math.floor(cabem(largNome, h2, LARG_MAIUSC) * 1.7);
    texto(M + 10, M + 4, h2, cortar(nome, limite), { inv: true, bloco: largNome, linhas: 2 });
  }

  // 2) Validade, ancorada embaixo: dia da semana em caixa preta + data grande.
  const temRodape = alta && Boolean(status || loja);
  const rodapeH = temRodape ? 34 : 0;
  let caixaH = alta ? 54 : media ? 46 : 40;
  if (W < 400) caixaH = Math.min(caixaH, 46);
  const yCaixa = H - M - rodapeH - caixaH;
  const rotuloH = media ? 18 : 0;
  const yRotulo = yCaixa - rotuloH - 3;
  const yLinha = (rotuloH ? yRotulo : yCaixa) - 7;
  const fonteDia = caixaH - 8;
  const caixaW = Math.round(fonteDia * 2.45);
  const xData = X + caixaW + 12;
  const hData =
    [64, 56, 48, 42, 36, 30].find(
      (h) => h <= caixaH + 10 && 10 * Math.round(h * 0.94) * LARG_NUM <= W - X - xData,
    ) ?? 30;
  caixa(X, yLinha, W - 2 * X, 2, 2);
  if (rotuloH) {
    texto(X, yRotulo, 18, 'VALIDADE');
    // Sem rodapé (etiqueta média), a situação vai na linha do rótulo, à direita.
    if (!alta && status) texto(X, yRotulo, 18, status, { bloco: W - 2 * X, alinha: 'R' });
  }
  caixa(X, yCaixa, caixaW, caixaH);
  texto(X, yCaixa + 7, fonteDia, diaDaSemana(d.validade), { inv: true, bloco: caixaW, alinha: 'C' });
  texto(xData, yCaixa + Math.round((caixaH - hData) / 2) + 3, hData, d.validade, { larg: Math.round(hData * 0.94) });

  // 3) Miolo: QR à direita (com o número embaixo, para digitar se o leitor faltar) e
  //    quem/quando à esquerda. O QR do ZPL desce 10 pontos REAIS a partir do ^FO.
  const yTopo = M + faixaH + 8;
  const area = yLinha - 4 - yTopo;
  const codigo = zplEsc(d.codigo ?? '').trim();
  let larguraTexto = W - 2 * X;
  if (d.cod !== 'nenhum' && codigo) {
    const mag = Math.max(2, Math.round((area >= 94 ? 4 : 3) * s));
    const lado = (21 * mag) / s;
    const recuo = 10 / s;
    const xQr = W - M - 22 - lado;
    z.push(`^FO${u(xQr)},${u(yTopo)}^BQN,2,${mag}^FDLA,${codigo}^FS`);
    if (area >= recuo + lado + 22) {
      texto(xQr - 20, yTopo + recuo + lado + 6, 16, codigo, { bloco: lado + 40, alinha: 'C' });
    }
    larguraTexto = xQr - 20 - X;
  }
  const quando = [d.manip, d.hora].map((v) => zplEsc(v ?? '').trim()).filter(Boolean).join(' ');
  const resp = zplEsc(d.resp ?? '').trim();
  const terceira = zplEsc(
    d.lote ? `LOTE ${d.lote}  ${d.fornecedor ?? ''}` : d.unidade ? `UNID. ${d.unidade}` : '',
  ).trim();
  if (area >= 112) {
    if (quando) {
      texto(X, yTopo + 4, 18, 'MANIPULADO');
      const hQ = [28, 26, 24, 22, 20].find((h) => quando.length * h * LARG_NUM <= larguraTexto) ?? 20;
      texto(X, yTopo + 24 + Math.round((28 - hQ) / 2), hQ, quando);
    }
    if (resp) {
      texto(X, yTopo + 60, 18, 'RESP.');
      texto(X + 58, yTopo + 56, 26, caber(resp, larguraTexto - 58, 26));
    }
    if (terceira) texto(X, yTopo + 88, 22, caber(terceira, larguraTexto, 22));
  } else {
    // Etiqueta baixa: linhas curtas, sem rótulo, quantas couberem.
    const linhas = [quando, resp ? `RESP. ${resp}` : '', media ? '' : status, terceira].filter(Boolean);
    const cabemLinhas = Math.max(1, Math.floor(area / 26));
    linhas.slice(0, cabemLinhas).forEach((t, i) => texto(X, yTopo + 2 + i * 26, 22, caber(t, larguraTexto, 22)));
  }

  // 4) Rodapé (etiqueta alta): situação em caixa preta + nome da loja.
  if (temRodape) {
    const y = H - M - 26;
    let x = X;
    if (status) {
      const larg = status.length * 13 + 22;
      caixa(X, y, larg, 26);
      texto(X, y + 4, 20, status, { inv: true, bloco: larg, alinha: 'C' });
      x = X + larg + 10;
    }
    if (loja) texto(x, y + 4, 20, caber(loja, W - X - x, 20));
  }
  z.push('^XZ');
  return z.join('\n') + '\n';
}

// Bobina (ESC/POS) no modelo moderno: a mesma informação, na mesma ordem, empilhada — só
// com os comandos que o resto deste arquivo já usa (negrito, letra dupla, QR).
function renderEtiquetaModernaBobina(d, largura) {
  const cols = colsDe(largura);
  const out = [];
  const push = (arr) => out.push(...arr);
  const escrever = (s, n) => {
    for (const parte of wrap(ascii(s), n)) {
      push([...Buffer.from(parte, 'ascii')]);
      push([0x0a]);
    }
  };
  const linha = (s) => escrever(s, cols);
  const grande = (s) => {
    push(boldOn());
    push(sizeDouble());
    escrever(s, Math.floor(cols / 2));
    push(sizeNormal());
    push(boldOff());
  };
  push(init());
  push(align(1));
  grande(String(d.produto).toUpperCase());
  const quando = [d.manip, d.hora].filter(Boolean).join(' ');
  if (quando) linha(`MANIPULADO ${quando}`);
  if (d.resp) linha(`RESP. ${d.resp}`);
  if (d.lote) linha(`LOTE ${d.lote} ${d.fornecedor ?? ''}`.trim());
  else if (d.unidade) linha(`UNID. ${d.unidade}`);
  linha('VALIDADE');
  grande(`${diaDaSemana(d.validade)} ${d.validade}`);
  if (d.cod !== 'nenhum' && d.codigo) {
    push(qrCode(String(d.codigo)));
    push([0x0a]);
    linha(String(d.codigo));
  }
  const pe = [d.status, d.loja].filter(Boolean).join(' - ');
  if (pe) linha(pe);
  push(sizeNormal());
  push(boldOff());
  push(align(0));
  push(feed(2));
  push(cut());
  return Buffer.from(out);
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
