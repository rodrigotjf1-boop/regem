import { MAPA_DO_REGEM, type FuncaoDoMapa } from './mapa-do-regem';

// A BUSCA NO MAPA (Mister, versão 10, C3 — "procurar no mapa pelo sentido"; `docs/plano-mister.md` § "C3"). A IA descreve o
// dado que procura em palavras; a busca devolve as leituras do mapa que mais combinam, pela frase e pelo caminho. Sem IA e
// sem banco: é o mapa revisado pela DMS. Só entram as leituras que o Mister pode ler (`le`, sem `pessoal`).

/** As leituras que o Mister pode fazer pela C3. */
export const LEITURAS_DO_MISTER: readonly FuncaoDoMapa[] = MAPA_DO_REGEM.filter((f) => f.marca === 'le' && !f.pessoal);
/** As leituras com dado de pessoa (cliente, candidato, conversa): a busca só avisa que existem, nunca as oferece. */
const LEITURAS_PESSOAIS: readonly FuncaoDoMapa[] = MAPA_DO_REGEM.filter((f) => f.marca === 'le' && f.pessoal);

export const ACHADAS_NO_MAXIMO = 8;
const PALAVRAS_DA_BUSCA_NO_MAXIMO = 12;

/** As palavras que não dizem o assunto ("quais são os cupons do cardápio" → "cupons", "cardapio"). */
const SEM_ASSUNTO = new Set(
  'a o e de da do das dos em no na nos nas um uma uns umas com por para pra que qual quais quanto quantos quanta quantas como onde quando se me te meu minha meus minhas seu sua seus suas tem ter tenho esta este esse essa isso isto aqui hoje agora ver veja mostra mostrar mostre lista listar diga dizer sobre loja regem tela telas dado dados informacao'.split(
    ' ',
  ),
);

const semAcento = (t: string): string =>
  t
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

/** A raiz curta da palavra (plural e terminação fora), para "cupons" achar "cupom" e "vendas" achar "venda". */
export function raizDaPalavra(p: string): string {
  if (p.length <= 4) return p;
  return p.replace(/(oes|aes|ais|eis|ns|s)$/, '').slice(0, 6);
}

/** As palavras de um texto, sem acento, sem as que não dizem o assunto, com pelo menos 3 letras, já na raiz. */
export function palavrasDoTexto(t: unknown): string[] {
  const fora = semAcento(String(t ?? ''))
    .split(/[^a-z0-9]+/)
    .filter((p) => p.length >= 3 && !SEM_ASSUNTO.has(p))
    .map(raizDaPalavra);
  return [...new Set(fora)];
}

const caminhoDe = (rota: string): string => rota.split(' ')[1].replace(/^\/api\/v1\//, '');

/** O que se pede para ler a função: os parâmetros do caminho (`{id}`) e os de consulta (`?inicio=`). */
export const parametrosDoCaminho = (rota: string): string[] => [...rota.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);

interface Indice {
  f: FuncaoDoMapa;
  frase: Set<string>;
  caminho: Set<string>;
}
const indexar = (fs: readonly FuncaoDoMapa[]): Indice[] =>
  fs.map((f) => ({ f, frase: new Set(palavrasDoTexto(f.frase)), caminho: new Set(palavrasDoTexto(caminhoDe(f.rota).replace(/\{[^}]+\}/g, ' '))) }));
const INDICE = indexar(LEITURAS_DO_MISTER);
const INDICE_PESSOAL = indexar(LEITURAS_PESSOAIS);

/** A nota de uma função para as palavras: 3 por palavra na frase, 2 no caminho, 1 quando só o começo combina. */
function nota(ix: Indice, palavras: string[]): number {
  let n = 0;
  for (const p of palavras) {
    if (ix.frase.has(p)) n += 3;
    else if ([...ix.frase].some((x) => x.length >= 4 && p.length >= 4 && (x.startsWith(p) || p.startsWith(x)))) n += 1;
    if (ix.caminho.has(p)) n += 2;
  }
  return n;
}

export interface LeituraAchada {
  rota: string;
  frase: string;
  /** Os parâmetros do caminho que `ler_no_regem` precisa (ex.: "id"). */
  parametros: string[];
  /** Os parâmetros de consulta que a função aceita (ex.: "inicio", "fim"). */
  consulta: string[];
}

export interface ResultadoDaBusca {
  achadas: LeituraAchada[];
  /** Quantas telas com dado de pessoa combinam tanto quanto a melhor achada (o Mister não as lê: indica a tela). */
  comDadoDePessoa: number;
}

/** As leituras que mais combinam com o que a IA procura, da melhor para a pior (empate: pela rota). */
export function procurarNoMapa(busca: unknown, max = ACHADAS_NO_MAXIMO): ResultadoDaBusca {
  const palavras = palavrasDoTexto(busca).slice(0, PALAVRAS_DA_BUSCA_NO_MAXIMO);
  if (!palavras.length) return { achadas: [], comDadoDePessoa: 0 };
  const notas = INDICE.map((ix) => ({ ix, n: nota(ix, palavras) }))
    .filter((x) => x.n > 0)
    .sort((a, b) => b.n - a.n || a.ix.f.rota.localeCompare(b.ix.f.rota));
  const melhor = notas[0]?.n ?? 0;
  const pessoais = INDICE_PESSOAL.filter((ix) => {
    const n = nota(ix, palavras);
    return n > 0 && n >= melhor;
  }).length;
  return {
    achadas: notas.slice(0, Math.max(1, Math.min(max, ACHADAS_NO_MAXIMO))).map(({ ix }) => ({
      rota: ix.f.rota,
      frase: ix.f.frase,
      parametros: parametrosDoCaminho(ix.f.rota),
      consulta: [...(ix.f.consulta ?? [])],
    })),
    comDadoDePessoa: pessoais,
  };
}

/** A linha do mapa da rota pedida (qualquer marca), ou `undefined`. */
export const funcaoDoMapa = (rota: unknown): FuncaoDoMapa | undefined => (typeof rota === 'string' ? MAPA_DO_REGEM.find((f) => f.rota === rota.trim()) : undefined);
