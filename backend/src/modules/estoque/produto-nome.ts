// Nome de produto do estoque: como se compara ("é o mesmo?") e como se mede "é parecido?".
// Usado pelo cadastro (recusa nome repetido) e pela importação de planilha (não traz de novo o
// que já existe e separa os parecidos para a pessoa decidir).

/** Nome como a pessoa digitou, sem espaço sobrando nas pontas nem repetido no meio. */
export function limparNome(nome: unknown): string {
  return typeof nome === 'string' ? nome.replace(/\s+/g, ' ').trim() : '';
}

/** Chave de comparação: sem acento, minúscula, pontuação vira espaço. "Coca-Cola" = "coca cola". */
export function chaveNome(nome: string): string {
  return nome
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

// Palavras que não distinguem um produto do outro: preposições e nomes/abreviações de embalagem
// e de medida ("coca cola lata 350ml 12 uni" e "Coca cola lata 350ml" são o mesmo produto).
const SEM_PESO = new Set([
  'de', 'da', 'do', 'das', 'dos', 'com', 'e', 'em', 'para',
  'un', 'uni', 'und', 'unid', 'unidade', 'unidades', 'ml', 'kg', 'g', 'gr', 'l', 'lt',
  'lata', 'caixa', 'cx', 'pct', 'pacote', 'fardo', 'balde', 'saco', 'pote', 'garrafa',
]);

function palavras(nome: string): Set<string> {
  return new Set(
    chaveNome(nome)
      .split(' ')
      .filter((p) => p.length > 1 && !SEM_PESO.has(p) && !/^\d+$/.test(p)),
  );
}

/** De 0 a 1: quanto os dois nomes têm das mesmas palavras de peso. */
export function semelhanca(a: string, b: string): number {
  const pa = palavras(a);
  const pb = palavras(b);
  if (!pa.size || !pb.size) return 0;
  let comuns = 0;
  for (const p of pa) if (pb.has(p)) comuns++;
  const jaccard = comuns / (pa.size + pb.size - comuns);
  // Um nome inteiro dentro do outro, com pelo menos duas palavras em comum, é o caso típico
  // ("fanta uva lata" × "Fanta Uva Lata 350ml"): conta como parecido mesmo com jaccard menor.
  const contido = comuns >= 2 && (comuns === pa.size || comuns === pb.size);
  return Math.max(jaccard, contido ? 0.75 : 0);
}

export const LIMITE_PARECIDO = 0.6;

/** O nome já cadastrado mais parecido com `nome`, se passar do limite. */
export function maisParecido<T extends { nome: string }>(nome: string, existentes: T[]): T | null {
  let melhor: T | null = null;
  let nota = 0;
  for (const e of existentes) {
    const s = semelhanca(nome, e.nome);
    if (s > nota) {
      melhor = e;
      nota = s;
    }
  }
  return nota >= LIMITE_PARECIDO ? melhor : null;
}
