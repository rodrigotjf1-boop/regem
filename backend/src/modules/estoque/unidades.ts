import { BadRequestException } from '@nestjs/common';
import { proporcaoFixa } from '../../common/conversao-unidade';

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
  // Pedido do dono (27/11/2026): "não tem opção de fatia, somente fita" — a fatia do queijo, do presunto, do bacon.
  'fatia',
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
  fatias: 'fatia',
  k: 'kg', kgs: 'kg', kilo: 'kg', kilos: 'kg', quilo: 'kg', quilos: 'kg',
  kilograma: 'kg', kilogramas: 'kg', quilograma: 'kg', quilogramas: 'kg',
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

/**
 * Conversões como vão ser gravadas (cadastro do estoque e rendimento da ficha técnica): fica só a
 * linha preenchida (unidades e fator > 0) e as duas unidades têm de ser da LISTA — o texto livre
 * aqui é o que criava "pacotes" ao lado de "pacote". Quilo e grama, litro e ml o sistema converte
 * sozinho (`common/conversao-unidade.ts`): a linha que repete a medida passa (não atrapalha); a que
 * a CONTRADIZ — "1 grama = 1000 kg", unidades trocadas — é recusada (400), porque valeria no lugar
 * da medida e erraria toda conta. Ausente = `undefined` (quem chama mantém o que está gravado).
 */
export function conferirConversoes(
  conversoes?: { unidadeDe: string; fator: number; unidadePara: string }[] | null,
): { unidadeDe: string; fator: number; unidadePara: string }[] | undefined {
  if (!conversoes) return undefined;
  const linhas = conversoes
    .filter((c) => c.unidadeDe?.trim() && c.unidadePara?.trim() && Number(c.fator) > 0)
    .map((c) => {
      const unidadeDe = exigirUnidade(c.unidadeDe, 'Conversão');
      const unidadePara = exigirUnidade(c.unidadePara, 'Conversão');
      if (unidadeDe === unidadePara)
        throw new BadRequestException(`Conversão: as duas unidades são "${unidadeDe}". Escolha unidades diferentes.`);
      const fixa = proporcaoFixa(unidadeDe, unidadePara);
      if (fixa != null && Math.abs(Number(c.fator) / fixa - 1) > 1e-9)
        throw new BadRequestException(
          `Conversão: 1 ${unidadeDe} = ${String(fixa).replace('.', ',')} ${unidadePara}, e o sistema já faz essa conta sozinho. Tire esta linha.`,
        );
      return { unidadeDe, fator: Number(c.fator), unidadePara };
    });
  conferirCaminhosDasConversoes(linhas);
  return linhas;
}

/**
 * As conversões, JUNTAS, não podem se contradizer (EST-A-02 da revisão de 25/11/2026): cada linha era conferida sozinha, e
 * "1 caixa = 2 kg", "1 pacote = 3 kg" e "1 caixa = 4 pacotes" passavam — o pacote valia 3 kg ou 0,5 kg conforme a ORDEM das
 * linhas (no servidor e na tela). Aqui cada unidade ganha um valor seguindo as linhas (e as medidas fixas entre as unidades de
 * massa ou de volume que aparecem: 1 kg = 1000 grama), e todo caminho tem de dar o mesmo valor, com tolerância de 1 parte em
 * um milhão. Recusa (400) dizendo as linhas que não fecham.
 */
export function conferirCaminhosDasConversoes(linhas: { unidadeDe: string; fator: number; unidadePara: string }[]): void {
  type Aresta = { de: string; para: string; fator: number; texto: string };
  const arestas: Aresta[] = linhas.map((l) => ({
    de: l.unidadeDe,
    para: l.unidadePara,
    fator: l.fator,
    texto: `1 ${l.unidadeDe} = ${String(l.fator).replace('.', ',')} ${l.unidadePara}`,
  }));
  const unidades = [...new Set(arestas.flatMap((a) => [a.de, a.para]))];
  for (let i = 0; i < unidades.length; i++)
    for (let j = i + 1; j < unidades.length; j++) {
      const fixa = proporcaoFixa(unidades[i], unidades[j]);
      if (fixa != null) arestas.push({ de: unidades[i], para: unidades[j], fator: fixa, texto: `1 ${unidades[i]} = ${String(fixa).replace('.', ',')} ${unidades[j]}` });
    }
  // valor(u) = quanto 1 u vale numa unidade de referência do grupo: 1 `de` = fator `para` ⇒ valor(para) = valor(de) / fator.
  const valor = new Map<string, number>();
  const usadas: Aresta[] = [];
  for (const inicio of unidades) {
    if (valor.has(inicio)) continue;
    valor.set(inicio, 1);
    for (let mudou = true; mudou; ) {
      mudou = false;
      for (const a of arestas) {
        const vDe = valor.get(a.de);
        const vPara = valor.get(a.para);
        if (vDe !== undefined && vPara === undefined) {
          valor.set(a.para, vDe / a.fator);
          usadas.push(a);
          mudou = true;
        } else if (vPara !== undefined && vDe === undefined) {
          valor.set(a.de, vPara * a.fator);
          usadas.push(a);
          mudou = true;
        }
      }
    }
  }
  for (const a of arestas) {
    const esperado = (valor.get(a.de) as number) / a.fator;
    const tem = valor.get(a.para) as number;
    if (Math.abs(esperado / tem - 1) > 1e-6) {
      const outras = usadas.filter((u) => u !== a && (u.de === a.de || u.para === a.para || u.de === a.para || u.para === a.de)).map((u) => u.texto);
      throw new BadRequestException(
        `Conversões que se contradizem: "${a.texto}" não fecha com ${outras.length ? `"${outras.join('", "')}"` : 'as outras linhas'}. ` +
          'Confira os números: cada unidade só pode valer um tanto.',
      );
    }
  }
}
