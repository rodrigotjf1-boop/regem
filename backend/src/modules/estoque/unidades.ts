import { BadRequestException } from '@nestjs/common';

// Unidades de medida do estoque — LISTA FECHADA. O cadastro de produto, as conversões e a
// importação de planilha só aceitam o que está aqui: com texto livre, cada loja escrevia de um
// jeito ("L", "litro", "pacotes") e a mesma unidade virava várias. A tela busca esta lista na
// rota `GET /estoque/unidades-medida` — a fonte é o servidor, não uma cópia no front.
export const UNIDADES_ESTOQUE = [
  'unidade',
  'caixa',
  'fardo',
  'pacote',
  'saco',
  'lata',
  'garrafa',
  'pote',
  'bisnaga',
  'bandeja',
  'galão',
  'balde',
  'rolo',
  'fita',
  'peça',
  'dúzia',
  'maço',
  'cartela',
  'porção',
  'kg',
  'grama',
  'litro',
  'ml',
] as const;
export type UnidadeEstoque = (typeof UNIDADES_ESTOQUE)[number];

// Outras formas de escrever a mesma unidade (o que já existe no banco e as abreviações das
// planilhas de outros sistemas). Chave sem acento, minúscula e sem ponto. Ficam DE FORA as
// abreviações ambíguas ("lt" é lata ou litro; "ct" é cartela ou cento): essas a pessoa escolhe.
const APELIDOS: Record<string, UnidadeEstoque> = {
  un: 'unidade', und: 'unidade', unid: 'unidade', uni: 'unidade', unidades: 'unidade',
  cx: 'caixa', cxa: 'caixa', caixas: 'caixa',
  fd: 'fardo', fardos: 'fardo',
  pct: 'pacote', pacotes: 'pacote',
  sc: 'saco', sacos: 'saco',
  latas: 'lata',
  gf: 'garrafa', grf: 'garrafa', garrafas: 'garrafa',
  pt: 'pote', potes: 'pote',
  bisnagas: 'bisnaga',
  bdj: 'bandeja', bandejas: 'bandeja',
  gl: 'galão', galoes: 'galão',
  bd: 'balde', baldes: 'balde',
  rl: 'rolo', rolos: 'rolo',
  fitas: 'fita',
  pc: 'peça', pca: 'peça', pecas: 'peça',
  dz: 'dúzia', duzias: 'dúzia',
  mc: 'maço', macos: 'maço',
  cartelas: 'cartela',
  porcoes: 'porção',
  kgs: 'kg', kilo: 'kg', kilos: 'kg', quilo: 'kg', quilos: 'kg', quilograma: 'kg', quilogramas: 'kg',
  g: 'grama', gr: 'grama', grs: 'grama', gramas: 'grama',
  l: 'litro', litros: 'litro',
  mililitro: 'ml', mililitros: 'ml',
};

const chave = (texto: string) =>
  texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\./g, '')
    .replace(/\s+/g, ' ')
    .trim();

const POR_CHAVE = new Map<string, UnidadeEstoque>([
  ...UNIDADES_ESTOQUE.map((u) => [chave(u), u] as [string, UnidadeEstoque]),
  ...Object.entries(APELIDOS),
]);

/** A unidade da lista que corresponde ao texto ("L" → litro, "Pct." → pacote); `null` se não há. */
export function normalizarUnidade(texto: unknown): UnidadeEstoque | null {
  if (typeof texto !== 'string') return null;
  return POR_CHAVE.get(chave(texto)) ?? null;
}

/** Outras formas de escrever → a unidade da lista (chave sem acento, minúscula, sem ponto). A tela
 *  usa para reconhecer o que já está gravado ("un", "porções") sem guardar cópia da regra. */
export function apelidosDeUnidade(): Record<string, UnidadeEstoque> {
  return Object.fromEntries(POR_CHAVE);
}

/** Campo que tem padrão: vazio vira `padrao`; o que veio preenchido tem de ser da lista (400). */
export function unidadeOuPadrao(texto: unknown, campo: string, padrao: UnidadeEstoque = 'unidade'): UnidadeEstoque {
  if (texto == null || (typeof texto === 'string' && !texto.trim())) return padrao;
  return exigirUnidade(texto, campo);
}

/** Idem, recusando (400) o que não é da lista — `campo` entra na frase do erro. */
export function exigirUnidade(texto: unknown, campo: string): UnidadeEstoque {
  const u = normalizarUnidade(texto);
  if (!u) {
    const visto = typeof texto === 'string' && texto.trim() ? `"${texto.trim().slice(0, 30)}"` : 'vazia';
    throw new BadRequestException(`${campo}: unidade de medida ${visto} não existe. Escolha uma da lista.`);
  }
  return u;
}
