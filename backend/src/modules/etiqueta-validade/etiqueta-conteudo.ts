// O TEXTO do job de impressão da etiqueta de validade — o que o servidor da loja
// (`backend/edge/escpos.mjs`) recebe e transforma em comandos da impressora.
//
// Dois modelos de desenho (coluna `etiqueta_template.modelo`, migration 306):
//   • classico — o de sempre: uma linha por campo, na ordem do modelo, e o código embaixo.
//   • moderno  — faixa preta com o produto, quem/quando à esquerda, QR à direita e a
//     validade com o dia da semana em caixa preta (escolha do dono, 06/10/2026).
//
// COMPATIBILIDADE: os dados do moderno vão DENTRO da linha do cabeçalho
// ('@ETIQUETA:60x40;v=2;d=<JSON em base64url>') e as linhas clássicas continuam no corpo.
// O servidor de loja antigo lê só o tamanho do cabeçalho e imprime o clássico — nada
// quebra enquanto a loja não recebe a atualização.

export const MODELOS_ETIQUETA = ['classico', 'moderno'] as const;
export type ModeloEtiqueta = (typeof MODELOS_ETIQUETA)[number];

/** Campos padrão da etiqueta (RDC 216): produto, validade e a data são obrigatórios. */
export const CAMPOS_PADRAO = [
  { campo: 'loja', visivel: true, negrito: false },
  { campo: 'produto', visivel: true, negrito: true },
  { campo: 'unidade', visivel: true, negrito: false },
  { campo: 'fabricacao', visivel: true, negrito: false },
  { campo: 'compra', visivel: false, negrito: false },
  { campo: 'status', visivel: true, negrito: false },
  { campo: 'validade', visivel: true, negrito: true },
  { campo: 'responsavel', visivel: false, negrito: false },
];

export interface TemplateEtiqueta {
  campos?: unknown;
  tamanho?: string | null;
  codigoTipo?: string | null;
  modelo?: string | null;
}

export interface DadosEtiqueta {
  loja: string;
  descricao: string;
  unidadeMedida?: string | null;
  /** 'FECHADO' | 'EM USO' */
  tipoUso: string;
  fabricacao?: string | null;
  compra?: string | null;
  validade: string;
  codigo: string;
  /** HH:MM da manipulação — só quando a etiqueta nasce no dia da manipulação. */
  hora?: string | null;
  /** Nome curto de quem gerou a etiqueta. */
  responsavel?: string | null;
  /** Código do lote e fornecedor, quando a etiqueta nasce de um lote. */
  lote?: string | null;
  fornecedor?: string | null;
}

export function dataBr(iso?: string | null): string {
  if (!iso) return '—';
  const [y, m, d] = String(iso).slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
}

/** "Rodrigo de Oliveira" → "Rodrigo O." — cabe na etiqueta e identifica na cozinha. */
export function nomeCurto(nome?: string | null): string {
  const partes = String(nome ?? '').trim().split(/\s+/).filter(Boolean);
  if (partes.length === 0) return '';
  if (partes.length === 1) return partes[0];
  return `${partes[0]} ${partes[partes.length - 1][0].toUpperCase()}.`;
}

type Campo = { campo: string; visivel?: boolean; negrito?: boolean };
const camposDe = (template?: TemplateEtiqueta | null): Campo[] =>
  Array.isArray(template?.campos) && (template?.campos as unknown[]).length
    ? (template?.campos as Campo[])
    : CAMPOS_PADRAO;

/** Visível no modelo salvo; campo que o modelo salvo não lista segue o padrão. */
function visivel(campos: Campo[], campo: string): boolean {
  const c = campos.find((x) => x.campo === campo) ?? CAMPOS_PADRAO.find((x) => x.campo === campo);
  return c ? c.visivel !== false : false;
}

const limpo = (s: unknown, max: number) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

/** Os dados do modelo moderno, como vão no cabeçalho (só o que o modelo manda mostrar). */
export function dadosModerno(template: TemplateEtiqueta | null | undefined, d: DadosEtiqueta) {
  const campos = camposDe(template);
  const carga: Record<string, string> = {
    m: 'moderno',
    produto: limpo(d.descricao, 60),
    manip: d.fabricacao ? dataBr(d.fabricacao) : '',
    validade: dataBr(d.validade),
    codigo: limpo(d.codigo, 40),
    // O moderno usa QR (as barras não cabem ao lado do texto); "Sem código" tira o QR.
    cod: template?.codigoTipo === 'nenhum' ? 'nenhum' : 'qr',
  };
  if (d.hora) carga.hora = limpo(d.hora, 5);
  if (visivel(campos, 'loja') && d.loja) carga.loja = limpo(d.loja, 40);
  if (visivel(campos, 'unidade') && d.unidadeMedida) carga.unidade = limpo(d.unidadeMedida, 20);
  if (visivel(campos, 'status') && d.tipoUso) carga.status = limpo(d.tipoUso, 12);
  if (visivel(campos, 'responsavel') && d.responsavel) carga.resp = limpo(d.responsavel, 24);
  if (d.lote) {
    carga.lote = limpo(d.lote, 20);
    if (d.fornecedor) carga.fornecedor = limpo(d.fornecedor, 24);
  }
  return carga;
}

/** Texto do job: cabeçalho (tamanho + dados do moderno) e as linhas clássicas. */
export function montarConteudoEtiqueta(
  template: TemplateEtiqueta | null | undefined,
  d: DadosEtiqueta,
): string {
  const campos = camposDe(template);
  const val: Record<string, string> = {
    loja: d.loja,
    produto: d.descricao,
    unidade: d.unidadeMedida ? `Unid.: ${d.unidadeMedida}` : '',
    fabricacao: `Fabricacao: ${dataBr(d.fabricacao)}`,
    compra: d.compra ? `Compra: ${dataBr(d.compra)}` : '',
    status: `Status: ${d.tipoUso}`,
    validade: `VALIDADE: ${dataBr(d.validade)}`,
    // Antes saía sempre vazio: o campo existia no modelo e nunca era impresso.
    responsavel: d.responsavel ? `Resp.: ${d.responsavel}` : '',
  };
  // O cabeçalho carrega o TAMANHO (mm) do modelo — o servidor da loja aplica nas
  // etiquetadoras ZPL/EPL (a linguagem vem da impressora). Ex.: '@ETIQUETA:40x40'.
  let cabecalho = `@ETIQUETA:${template?.tamanho ?? '40x40'}`;
  if (template?.modelo === 'moderno') {
    const carga = Buffer.from(JSON.stringify(dadosModerno(template, d)), 'utf8').toString('base64url');
    cabecalho += `;v=2;d=${carga}`;
  }
  const linhas: string[] = [cabecalho];
  for (const c of campos) {
    if (c.visivel === false) continue;
    const texto = val[c.campo];
    if (!texto) continue;
    linhas.push(c.negrito ? `@B${texto}` : texto);
  }
  const tipo = template?.codigoTipo ?? 'code128';
  if (tipo === 'qr') linhas.push(`@QR:${d.codigo}`);
  else if (tipo && tipo !== 'nenhum') linhas.push(`@BARCODE:${tipo}:${d.codigo}`);
  else linhas.push(d.codigo);
  return linhas.join('\n');
}
