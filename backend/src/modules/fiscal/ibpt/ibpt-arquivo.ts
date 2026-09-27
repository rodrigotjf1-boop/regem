// LEITURA DOS ARQUIVOS DO IBPT (Lei 12.741) — o ZIP baixado no site "De Olho no Imposto" ou os CSVs
// soltos, um por UF. Formato conferido nos arquivos reais (base da skill `cupom-fiscal`, §5.7):
//   • nome `TabelaIBPTax{UF}{versão}.csv` — a UF só existe no NOME (as linhas não a têm);
//   • separador `;`, Windows-1252, CRLF, descrição entre aspas;
//   • cabeçalho `codigo;ex;tipo;descricao;nacionalfederal;importadosfederal;estadual;municipal;
//     vigenciainicio;vigenciafim;chave;versao;fonte`;
//   • `tipo` 0 = NCM, 1 = NBS, 2 = LC 116 — só o NCM interessa (a NFC-e não tem item de serviço);
//   • percentuais com ponto, datas DD/MM/AAAA; chave, versão, fonte e vigência iguais em todas as
//     linhas.
// O ZIP é lido com o zlib do Node (sem dependência nova no pacote da loja): diretório central,
// entradas guardadas (stored) ou comprimidas (deflate), e ZIP dentro de ZIP.
import { inflateRawSync } from 'zlib';

export type LinhaIbpt = {
  ncm: string;
  ex: string;
  nacionalFederal: number;
  importadosFederal: number;
  estadual: number;
  municipal: number;
};

export type TabelaIbptUf = {
  arquivo: string;
  uf: string;
  versao: string;
  chave: string;
  fonte: string;
  vigenciaInicio: string; // AAAA-MM-DD
  vigenciaFim: string; // AAAA-MM-DD
  linhas: LinhaIbpt[];
};

/** Arquivo que não é a tabela do IBPT como ela vem do site — a mensagem vai para quem enviou. */
export class ArquivoIbptInvalido extends Error {}

export const UFS = new Set([
  'AC', 'AL', 'AM', 'AP', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MG', 'MS', 'MT', 'PA', 'PB', 'PE',
  'PI', 'PR', 'RJ', 'RN', 'RO', 'RR', 'RS', 'SC', 'SE', 'SP', 'TO',
]);

const CABECALHO = [
  'codigo', 'ex', 'tipo', 'descricao', 'nacionalfederal', 'importadosfederal', 'estadual',
  'municipal', 'vigenciainicio', 'vigenciafim', 'chave', 'versao', 'fonte',
];

// Nome do arquivo da tabela, em qualquer pasta dentro do ZIP.
const NOME_TABELA = /TabelaIBPTax([A-Za-z]{2})([0-9]{2}\.[0-9]+\.[A-Za-z0-9]+)\.csv$/i;

// Uma UF real tem ~11 mil NCMs (RJ 26.2.B: 11.104). Bem menos que isso é arquivo cortado.
export const MINIMO_NCM_POR_UF = 5000;

// ----------------------------------------------------------------------------- ZIP

const SIG_FIM = 0x06054b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_LOCAL = 0x04034b50;

/** Entradas de um ZIP (só arquivos). Lança `ArquivoIbptInvalido` se não for um ZIP legível. */
export function lerZip(buf: Buffer): { nome: string; dados: Buffer }[] {
  // Fim do diretório central: nos últimos 22 bytes + até 64 KB de comentário.
  let fim = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 0xffff); i--) {
    if (buf.readUInt32LE(i) === SIG_FIM) {
      fim = i;
      break;
    }
  }
  if (fim < 0) throw new ArquivoIbptInvalido('O arquivo não é um ZIP válido.');
  const total = buf.readUInt16LE(fim + 10);
  let p = buf.readUInt32LE(fim + 16);
  const saida: { nome: string; dados: Buffer }[] = [];
  for (let n = 0; n < total; n++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== SIG_CENTRAL)
      throw new ArquivoIbptInvalido('O ZIP está corrompido (diretório central).');
    const metodo = buf.readUInt16LE(p + 10);
    const tamComp = buf.readUInt32LE(p + 20);
    const tamNome = buf.readUInt16LE(p + 28);
    const tamExtra = buf.readUInt16LE(p + 30);
    const tamComent = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const nome = buf.toString('utf8', p + 46, p + 46 + tamNome);
    p += 46 + tamNome + tamExtra + tamComent;
    if (nome.endsWith('/')) continue; // pasta
    if (tamComp === 0xffffffff || local === 0xffffffff)
      throw new ArquivoIbptInvalido('ZIP64 não é suportado — envie o ZIP como veio do site do IBPT.');
    if (local + 30 > buf.length || buf.readUInt32LE(local) !== SIG_LOCAL)
      throw new ArquivoIbptInvalido('O ZIP está corrompido (cabeçalho local).');
    const ini = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const comp = buf.subarray(ini, ini + tamComp);
    let dados: Buffer;
    if (metodo === 0) dados = Buffer.from(comp);
    else if (metodo === 8) {
      try {
        dados = inflateRawSync(comp);
      } catch {
        throw new ArquivoIbptInvalido(`O ZIP está corrompido (${nome}).`);
      }
    } else throw new ArquivoIbptInvalido(`Compressão ${metodo} não suportada (${nome}).`);
    saida.push({ nome, dados });
  }
  return saida;
}

// ----------------------------------------------------------------------------- CSV

// Uma linha do CSV em campos: `;` fora de aspas; `""` dentro de aspas é uma aspa.
function campos(linha: string): string[] {
  const out: string[] = [];
  let atual = '';
  let aspas = false;
  for (let i = 0; i < linha.length; i++) {
    const ch = linha[i];
    if (aspas) {
      if (ch === '"') {
        if (linha[i + 1] === '"') {
          atual += '"';
          i++;
        } else aspas = false;
      } else atual += ch;
    } else if (ch === '"') aspas = true;
    else if (ch === ';') {
      out.push(atual);
      atual = '';
    } else atual += ch;
  }
  out.push(atual);
  return out.map((c) => c.trim());
}

function data(ddmmaaaa: string, arquivo: string, campo: string): string {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(ddmmaaaa);
  if (!m) throw new ArquivoIbptInvalido(`${arquivo}: ${campo} "${ddmmaaaa}" não é uma data DD/MM/AAAA.`);
  return `${m[3]}-${m[2]}-${m[1]}`;
}

function pct(v: string, arquivo: string, n: number): number {
  const x = Number(String(v).replace(',', '.'));
  if (!Number.isFinite(x) || x < 0 || x > 100)
    throw new ArquivoIbptInvalido(`${arquivo}, linha ${n}: percentual "${v}" inválido.`);
  return x;
}

/** Uma tabela de UF a partir do CSV. `nome` é o nome do arquivo — é dele que sai a UF. */
export function lerCsvIbpt(
  nome: string,
  dados: Buffer,
  minimoNcm = MINIMO_NCM_POR_UF,
): TabelaIbptUf {
  const arquivo = nome.split(/[\\/]/).pop() ?? nome;
  const m = NOME_TABELA.exec(arquivo);
  if (!m)
    throw new ArquivoIbptInvalido(
      `${arquivo}: o nome precisa ser o do site do IBPT (TabelaIBPTax<UF><versão>.csv) — é dele que sai o estado.`,
    );
  const uf = m[1].toUpperCase();
  if (!UFS.has(uf)) throw new ArquivoIbptInvalido(`${arquivo}: "${uf}" não é uma UF.`);
  // Windows-1252 (latin1 cobre tudo o que lemos: números, datas, chave, versão, fonte — a
  // descrição é descartada). Se um dia vier em UTF-8 com BOM, o BOM é tirado.
  const texto =
    dados[0] === 0xef && dados[1] === 0xbb && dados[2] === 0xbf
      ? dados.subarray(3).toString('utf8')
      : dados.toString('latin1');
  const linhas = texto.split(/\r?\n/);
  const cab = campos(linhas[0] ?? '').map((c) => c.toLowerCase());
  if (cab.join(';') !== CABECALHO.join(';'))
    throw new ArquivoIbptInvalido(
      `${arquivo}: o cabeçalho não é o da tabela do IBPT (esperado: ${CABECALHO.join(';')}).`,
    );

  let meta: { versao: string; chave: string; fonte: string; ini: string; fim: string } | null = null;
  const porNcm = new Map<string, LinhaIbpt>();
  for (let i = 1; i < linhas.length; i++) {
    const bruta = linhas[i];
    if (!bruta.trim()) continue;
    const f = campos(bruta);
    if (f.length !== CABECALHO.length)
      throw new ArquivoIbptInvalido(`${arquivo}, linha ${i + 1}: ${f.length} campos (esperados ${CABECALHO.length}).`);
    const [codigo, ex, tipo, , nf, imf, est, mun, vini, vfim, chave, versao, fonte] = f;
    const atual = { versao, chave, fonte, ini: vini, fim: vfim };
    if (!meta) meta = atual;
    else if (meta.versao !== versao || meta.chave !== chave || meta.ini !== vini || meta.fim !== vfim)
      throw new ArquivoIbptInvalido(`${arquivo}, linha ${i + 1}: versão, chave ou vigência diferente das outras linhas.`);
    if (tipo !== '0') continue; // NBS e LC 116: serviço
    if (!/^\d{8}$/.test(codigo))
      throw new ArquivoIbptInvalido(`${arquivo}, linha ${i + 1}: NCM "${codigo}" não tem 8 dígitos.`);
    const exNorm = /^\d{1,3}$/.test(ex) ? ex.padStart(2, '0') : '';
    porNcm.set(`${codigo}|${exNorm}`, {
      ncm: codigo,
      ex: exNorm,
      nacionalFederal: pct(nf, arquivo, i + 1),
      importadosFederal: pct(imf, arquivo, i + 1),
      estadual: pct(est, arquivo, i + 1),
      municipal: pct(mun, arquivo, i + 1),
    });
  }
  if (!meta) throw new ArquivoIbptInvalido(`${arquivo}: o arquivo não tem linhas.`);
  if (m[2].toUpperCase() !== meta.versao.toUpperCase())
    throw new ArquivoIbptInvalido(`${arquivo}: o nome diz versão ${m[2]} e as linhas dizem ${meta.versao}.`);
  if (!meta.chave || !meta.fonte)
    throw new ArquivoIbptInvalido(`${arquivo}: faltam a chave ou a fonte — sem elas o cupom não pode citar a tabela.`);
  const vigenciaInicio = data(meta.ini, arquivo, 'vigenciainicio');
  const vigenciaFim = data(meta.fim, arquivo, 'vigenciafim');
  if (vigenciaFim < vigenciaInicio)
    throw new ArquivoIbptInvalido(`${arquivo}: a vigência termina antes de começar.`);
  const tabela = [...porNcm.values()];
  if (tabela.length < minimoNcm)
    throw new ArquivoIbptInvalido(
      `${arquivo}: só ${tabela.length} NCMs (uma UF tem cerca de 11 mil) — o arquivo parece cortado.`,
    );
  return {
    arquivo,
    uf,
    versao: meta.versao,
    chave: meta.chave,
    fonte: meta.fonte,
    vigenciaInicio,
    vigenciaFim,
    linhas: tabela,
  };
}

/**
 * Todas as tabelas de UF de um envio: ZIP (em qualquer pasta, e ZIP dentro de ZIP) ou CSVs soltos.
 * Cartazes, manuais e o que mais vier no ZIP são ignorados. Nenhuma tabela = erro.
 */
export function lerArquivosIbpt(
  arquivos: { nome: string; dados: Buffer }[],
  minimoNcm = MINIMO_NCM_POR_UF,
): TabelaIbptUf[] {
  const tabelas: TabelaIbptUf[] = [];
  const visitar = (nome: string, dados: Buffer, nivel: number) => {
    const base = nome.split(/[\\/]/).pop() ?? nome;
    if (/\.zip$/i.test(base) || (dados[0] === 0x50 && dados[1] === 0x4b && !/\.csv$/i.test(base))) {
      if (nivel > 2) return;
      for (const e of lerZip(dados)) visitar(e.nome, e.dados, nivel + 1);
    } else if (NOME_TABELA.test(base)) tabelas.push(lerCsvIbpt(base, dados, minimoNcm));
  };
  for (const a of arquivos) visitar(a.nome, a.dados, 0);
  if (!tabelas.length)
    throw new ArquivoIbptInvalido(
      'Nenhuma tabela do IBPT no envio — mande o ZIP baixado no site ou os arquivos TabelaIBPTax<UF><versão>.csv.',
    );
  return tabelas;
}
