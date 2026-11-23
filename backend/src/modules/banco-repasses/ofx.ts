// LEITOR DE OFX do extrato do banco (R1 da versão 8 do Mister; decisão V8-1). Puro e sem dependência: recebe os bytes e
// devolve os lançamentos. Lê os dois formatos: SGML (OFX 1.x, com as tags de valor sem fechar) e XML (OFX 2.x).
//
// O arquivo vem de fora: tem limite de tamanho e de linhas, e a leitura é um percurso único pelo texto (`indexOf`), sem
// expressão regular sobre o arquivo inteiro. Nada daqui escreve em log: o conteúdo tem nome e documento de terceiros.

export const LIMITE_DE_BYTES = 5 * 1024 * 1024;
export const LIMITE_DE_LINHAS = 20_000;
/** Maior valor aceito numa linha (o mesmo teto de um numeric(14,2)). */
const TETO_DE_CENTAVOS = 999_999_999_999_99;
/** Um campo do extrato não passa disto; o resto é cortado antes de qualquer tratamento. */
const TETO_DO_CAMPO = 512;
const TETO_DA_TAG = 64;

export type MotivoDaRecusa = 'vazio' | 'pdf' | 'planilha' | 'nao_ofx' | 'grande' | 'muitas_linhas' | 'sem_conta' | 'varias_contas' | 'cartao';

/** O arquivo não pôde ser lido como extrato. `motivo` escolhe a frase da tela; a mensagem nunca traz conteúdo do arquivo. */
export class ArquivoRecusado extends Error {
  constructor(readonly motivo: MotivoDaRecusa) {
    super(`arquivo recusado: ${motivo}`);
    this.name = 'ArquivoRecusado';
  }
}

export interface LinhaOfx {
  tipo: string;
  data: string;
  valorCentavos: number;
  fitid: string;
  memo: string;
  nome: string;
  numeroDoCheque: string;
}

export interface ExtratoOfx {
  /** Código do banco (BANKID), sem zeros à esquerda. */
  banco: string;
  /** Só os 4 últimos dígitos: o número inteiro não sai daqui. */
  finalDaConta: string;
  periodoDe: string | null;
  periodoAte: string | null;
  saldoCentavos: number | null;
  saldoEm: string | null;
  linhas: LinhaOfx[];
  /** Linhas com valor ou data ilegível: ficaram de fora, e a tela diz quantas. */
  recusadas: number;
}

// ── valor e data ────────────────────────────────────────────────────────────────────────────────────────────────────

const ehDigito = (c: string) => c >= '0' && c <= '9';
const soDigitos = (s: string) => [...s].every(ehDigito);

/**
 * O valor em CENTAVOS, sem passar por ponto flutuante. Aceita `-1234.56`, `1234,56`, `1.234,56` e `1,234.56`. Um separador só
 * é o decimal, como manda o OFX. Com 3 dígitos depois (`12.500`) pode ser R$ 12,50 ou R$ 12.500: a linha é recusada e a tela
 * diz quantas, porque adivinhar erraria o valor em mil vezes. Ilegível = `null`.
 */
export function centavosDe(bruto: string): number | null {
  let t = (bruto ?? '').trim();
  if (!t || t.length > 24) return null;
  let negativo = false;
  if (t[0] === '-' || t[0] === '+') {
    negativo = t[0] === '-';
    t = t.slice(1).trim();
  }
  if (!t || !ehDigito(t[0])) return null;
  for (const c of t) if (!ehDigito(c) && c !== '.' && c !== ',') return null;

  const ultimoPonto = t.lastIndexOf('.');
  const ultimaVirgula = t.lastIndexOf(',');
  const temDois = ultimoPonto >= 0 && ultimaVirgula >= 0;
  let inteira = t;
  let decimal = '';
  if (temDois) {
    const corte = Math.max(ultimoPonto, ultimaVirgula);
    inteira = t.slice(0, corte);
    decimal = t.slice(corte + 1);
    const milhar = corte === ultimoPonto ? ',' : '.';
    if (inteira.includes(corte === ultimoPonto ? '.' : ',')) return null;
    if (!gruposDeMilhar(inteira.split(milhar))) return null;
    inteira = inteira.split(milhar).join('');
  } else if (ultimoPonto >= 0 || ultimaVirgula >= 0) {
    const sep = ultimoPonto >= 0 ? '.' : ',';
    const partes = t.split(sep);
    if (partes.length > 2) {
      if (!gruposDeMilhar(partes)) return null;
      inteira = partes.join('');
    } else {
      inteira = partes[0];
      decimal = partes[1];
    }
  }
  if (!inteira || !soDigitos(inteira) || decimal.length > 2 || (decimal && !soDigitos(decimal))) return null;
  const centavos = Number(inteira) * 100 + Number(decimal.padEnd(2, '0') || '0');
  if (!Number.isSafeInteger(centavos) || centavos > TETO_DE_CENTAVOS) return null;
  return negativo && centavos !== 0 ? -centavos : centavos;
}

function gruposDeMilhar(g: string[]): boolean {
  if (!g[0] || g[0].length > 3 || !soDigitos(g[0])) return false;
  return g.slice(1).every((x) => x.length === 3 && soDigitos(x));
}

/**
 * O DIA escrito no arquivo: `AAAAMMDD[HHMMSS[.xxx]][-3:BRT]`. Vale o dia no fuso que o próprio arquivo informa, então ele NÃO
 * é convertido: passar por `Date` faria a linha das 22h de Brasília cair no dia seguinte. Dia que não existe = `null`.
 */
export function diaDe(bruto: string): string | null {
  const t = (bruto ?? '').trim();
  if (t.length < 8) return null;
  const d = t.slice(0, 8);
  if (!soDigitos(d)) return null;
  // Depois do dia só pode vir a hora, os milésimos e o fuso.
  const resto = t.slice(8);
  for (const c of resto) if (!ehDigito(c) && !'.[]:+-ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz '.includes(c)) return null;
  const ano = Number(d.slice(0, 4));
  const mes = Number(d.slice(4, 6));
  const dia = Number(d.slice(6, 8));
  if (ano < 1990 || ano > 2100 || mes < 1 || mes > 12 || dia < 1) return null;
  const noMes = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
  if (dia > noMes) return null;
  return `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
}

// ── os bytes em texto ───────────────────────────────────────────────────────────────────────────────────────────────

function decodificar(buf: Buffer): string {
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) return new TextDecoder('utf-8').decode(buf.subarray(3));
  const cabecalho = buf.subarray(0, 1024).toString('latin1').toUpperCase();
  const declarado = (chave: string): string => {
    const i = cabecalho.indexOf(chave);
    if (i < 0) return '';
    let j = i + chave.length;
    while (j < cabecalho.length && ' :="\''.includes(cabecalho[j])) j++;
    let k = j;
    while (k < cabecalho.length && !' \r\n"\'?>'.includes(cabecalho[k])) k++;
    return cabecalho.slice(j, k);
  };
  const encoding = declarado('ENCODING');
  const charset = declarado('CHARSET');
  if (encoding === 'UTF-8' || encoding === 'UTF8' || charset === 'UTF-8' || charset === 'UTF8') {
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(buf);
    } catch {
      return new TextDecoder('windows-1252').decode(buf); // diz UTF-8 e não é: banco que grava em 1252
    }
  }
  if (charset === '1252' || charset === 'WINDOWS-1252') return new TextDecoder('windows-1252').decode(buf);
  if (charset === 'ISO-8859-1' || charset === 'LATIN1' || charset === '8859-1') return buf.toString('latin1');
  // Sem charset útil (USASCII / NONE): UTF-8 se for válido; senão, o 1252 que os bancos daqui usam.
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch {
    return new TextDecoder('windows-1252').decode(buf);
  }
}

const ENTIDADES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

/** Troca `&amp;`, `&#231;` e afins. Um percurso só; entidade desconhecida fica como está. */
function semEntidades(s: string): string {
  if (!s.includes('&')) return s;
  let saida = '';
  let i = 0;
  while (i < s.length) {
    const a = s.indexOf('&', i);
    if (a < 0) {
      saida += s.slice(i);
      break;
    }
    saida += s.slice(i, a);
    const f = s.indexOf(';', a);
    if (f < 0 || f - a > 9) {
      saida += '&';
      i = a + 1;
      continue;
    }
    const nome = s.slice(a + 1, f);
    let troca: string | undefined = ENTIDADES[nome.toLowerCase()];
    if (troca === undefined && nome[0] === '#') {
      const hexa = nome[1] === 'x' || nome[1] === 'X';
      const cod = hexa ? parseInt(nome.slice(2), 16) : parseInt(nome.slice(1), 10);
      if (Number.isInteger(cod) && cod > 0 && cod <= 0x10ffff) troca = String.fromCodePoint(cod);
    }
    if (troca === undefined) {
      saida += '&';
      i = a + 1;
    } else {
      saida += troca;
      i = f + 1;
    }
  }
  return saida;
}

const limparCampo = (s: string) => semEntidades(s.slice(0, TETO_DO_CAMPO)).trim();

// ── a leitura ───────────────────────────────────────────────────────────────────────────────────────────────────────

/** Reconhece pelo começo do arquivo o que claramente não é OFX, para a tela dizer "ele veio em PDF". */
function motivoPeloComeco(buf: Buffer): MotivoDaRecusa | null {
  if (buf.length === 0) return 'vazio';
  const a = buf.subarray(0, 8).toString('latin1');
  if (a.startsWith('%PDF')) return 'pdf';
  if (a.startsWith('PK\u0003\u0004') || (buf[0] === 0xd0 && buf[1] === 0xcf && buf[2] === 0x11 && buf[3] === 0xe0)) return 'planilha';
  return null;
}

type Campos = Record<string, string>;

/** Lê o extrato. Recusa com `ArquivoRecusado` o que não for um OFX de conta corrente de uma conta só. */
export function lerOfx(buf: Buffer): ExtratoOfx {
  if (buf.length > LIMITE_DE_BYTES) throw new ArquivoRecusado('grande');
  const pelocomeco = motivoPeloComeco(buf);
  if (pelocomeco) throw new ArquivoRecusado(pelocomeco);

  const texto = decodificar(buf);
  // A tag <OFX> tem de existir: é ela que separa o extrato de um texto qualquer.
  const inicio = acharTag(texto, 'OFX');
  if (inicio < 0) throw new ArquivoRecusado('nao_ofx');

  const pilhaDeBlocos: string[] = [];
  const contas = new Set<string>();
  let banco = '';
  let contaBruta = '';
  let temCartao = false;
  let temConta = false;
  let periodoDe: string | null = null;
  let periodoAte: string | null = null;
  let saldoCentavos: number | null = null;
  let saldoEm: string | null = null;
  const linhas: LinhaOfx[] = [];
  let recusadas = 0;
  let atual: Campos | null = null;
  let contaAtual: Campos | null = null;

  const fecharConta = () => {
    if (!contaAtual) return;
    const id = (contaAtual.ACCTID ?? '').trim();
    if (id) {
      contas.add(id);
      contaBruta = id;
      banco = (contaAtual.BANKID ?? '').trim().replace(/^0+(?=\d)/, '');
    }
    contaAtual = null;
  };
  const fecharLinha = () => {
    if (!atual) return;
    const campos = atual;
    atual = null;
    const data = diaDe(campos.DTPOSTED ?? '');
    const valor = centavosDe(campos.TRNAMT ?? '');
    if (data === null || valor === null) {
      recusadas++;
      return;
    }
    if (linhas.length >= LIMITE_DE_LINHAS) throw new ArquivoRecusado('muitas_linhas');
    linhas.push({
      tipo: (campos.TRNTYPE ?? '').trim().toUpperCase().slice(0, 16),
      data,
      valorCentavos: valor,
      fitid: (campos.FITID ?? '').trim().slice(0, 255),
      memo: campos.MEMO ?? '',
      nome: campos.NAME ?? '',
      numeroDoCheque: (campos.CHECKNUM ?? '').trim().slice(0, 32),
    });
  };

  let i = inicio;
  const n = texto.length;
  while (i < n) {
    const a = texto.indexOf('<', i);
    if (a < 0) break;
    // Comentário e CDATA do XML: pulam inteiros.
    if (texto.startsWith('<!--', a)) {
      const f = texto.indexOf('-->', a + 4);
      if (f < 0) break;
      i = f + 3;
      continue;
    }
    if (texto.startsWith('<?', a) || texto.startsWith('<!', a)) {
      const f = texto.indexOf('>', a + 2);
      if (f < 0) break;
      i = f + 1;
      continue;
    }
    const f = texto.indexOf('>', a + 1);
    if (f < 0) break;
    if (f - a > TETO_DA_TAG) {
      i = a + 1;
      continue;
    }
    const fecha = texto[a + 1] === '/';
    const nomeCru = texto.slice(a + (fecha ? 2 : 1), f);
    const autoFechada = nomeCru.endsWith('/');
    const nome = (autoFechada ? nomeCru.slice(0, -1) : nomeCru).trim().split(' ')[0].toUpperCase();
    i = f + 1;
    if (!nome) continue;

    if (fecha) {
      if (nome === 'STMTTRN') fecharLinha();
      else if (nome === 'BANKACCTFROM' || nome === 'CCACCTFROM') fecharConta();
      const p = pilhaDeBlocos.lastIndexOf(nome);
      if (p >= 0) pilhaDeBlocos.length = p;
      continue;
    }

    // Abertura de bloco.
    if (nome === 'STMTTRN') {
      fecharLinha(); // o SGML que não fechou a linha anterior
      atual = {};
      continue;
    }
    if (nome === 'BANKACCTFROM') {
      temConta = true;
      contaAtual = {};
      pilhaDeBlocos.push(nome);
      continue;
    }
    if (nome === 'CCACCTFROM' || nome === 'CCSTMTRS' || nome === 'CCSTMTTRNRS') {
      temCartao = true;
      if (nome === 'CCACCTFROM') contaAtual = {};
      pilhaDeBlocos.push(nome);
      continue;
    }
    if (nome === 'LEDGERBAL' || nome === 'BANKTRANLIST' || nome === 'AVAILBAL' || nome === 'STMTRS' || nome === 'OFX') {
      pilhaDeBlocos.push(nome);
      continue;
    }

    // Campo de valor: o texto até a próxima tag (no XML e no SGML).
    let proxima = texto.indexOf('<', i);
    if (proxima < 0) proxima = n;
    let valor = texto.slice(i, Math.min(proxima, i + TETO_DO_CAMPO * 2));
    // CDATA no meio do valor: o conteúdo vale como texto.
    if (texto.startsWith('<![CDATA[', proxima) && valor.trim() === '') {
      const fimCdata = texto.indexOf(']]>', proxima);
      if (fimCdata > 0) {
        valor = texto.slice(proxima + 9, Math.min(fimCdata, proxima + 9 + TETO_DO_CAMPO));
        i = fimCdata + 3;
      }
    }
    const limpo = limparCampo(valor);

    if (atual) {
      if (atual[nome] === undefined) atual[nome] = limpo;
    } else if (contaAtual) {
      if (contaAtual[nome] === undefined) contaAtual[nome] = limpo;
    } else if (pilhaDeBlocos.includes('LEDGERBAL')) {
      if (nome === 'BALAMT' && saldoCentavos === null) saldoCentavos = centavosDe(limpo);
      if (nome === 'DTASOF' && saldoEm === null) saldoEm = diaDe(limpo);
    } else if (pilhaDeBlocos.includes('BANKTRANLIST')) {
      if (nome === 'DTSTART' && periodoDe === null) periodoDe = diaDe(limpo);
      if (nome === 'DTEND' && periodoAte === null) periodoAte = diaDe(limpo);
    }
  }
  fecharLinha();
  fecharConta();

  if (temCartao && !temConta) throw new ArquivoRecusado('cartao');
  if (contas.size > 1) throw new ArquivoRecusado('varias_contas');
  const digitosDaConta = [...contaBruta].filter(ehDigito).join('');
  if (!digitosDaConta) throw new ArquivoRecusado('sem_conta');
  if (linhas.length === 0 && recusadas === 0 && saldoCentavos === null) throw new ArquivoRecusado('nao_ofx');

  // Banco que não informa o período: vale o primeiro e o último dia com lançamento.
  const dias = linhas.map((l) => l.data).sort();
  return {
    banco,
    finalDaConta: digitosDaConta.slice(-4),
    periodoDe: periodoDe ?? dias[0] ?? null,
    periodoAte: periodoAte ?? dias[dias.length - 1] ?? null,
    saldoCentavos,
    saldoEm,
    linhas,
    recusadas,
  };
}

/** A posição da tag `<NOME>` (sem diferenciar maiúscula) ou -1. Um percurso só. */
function acharTag(texto: string, nome: string): number {
  const alvo = `<${nome}`;
  let i = 0;
  while (i < texto.length) {
    const a = texto.indexOf('<', i);
    if (a < 0) return -1;
    if (texto.slice(a, a + alvo.length).toUpperCase() === alvo) {
      const c = texto[a + alvo.length];
      if (c === '>' || c === ' ' || c === '\r' || c === '\n' || c === '\t') return a;
    }
    i = a + 1;
  }
  return -1;
}
