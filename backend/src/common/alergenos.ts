// OS ALÉRGENOS DO CARDÁPIO (18/11/2026 — protótipo `mockups/regem-atendente-alergenos-agendado.html`, parte 1, decisões
// A1–A9 aprovadas pelo dono em 16/11 com as recomendadas; "pode" do D2 em 18/11 com a regra do dono: o atendente fala dos
// alérgenos SÓ quando o cliente pergunta — nunca por conta própria).
//
// A1: marca-se no INSUMO (Estoque › Produtos), uma vez, pelo rótulo; o produto do cardápio HERDA pela ficha técnica (as
//     sub-receitas e o insumo "feito na loja" pela ficha dele incluídos, as linhas de embalagem fora); o produto de revenda
//     (sem ficha, ligado a um item do estoque) herda do item; o combo herda dos produtos que leva. Todo produto tem um ajuste
//     próprio; o produto sem nada disso usa só o ajuste.
// A2: falta conferir um insumo → o produto fica "não informado" no que não se sabe; ausência NUNCA se presume (um
//     "não contém" errado é o pior erro desta tela).
// A3: o ajuste no produto não apaga um "contém" que vem da ficha: só soma ("pode conter", "contém") e, no produto sem ficha,
//     é a própria marcação.
// A4: só o produto "informado" mostra os alérgenos no cardápio online; o resto fica como é hoje.
// A6: o selo "S/ glúten" ou "S/ lactose" que contradiz o cadastro é recusado.
// A7: os adicionais não entram nesta versão — o cardápio diz "adicionais podem mudar".
// A9: a frase de cautela da loja (a padrão abaixo), editável e nunca vazia.
// A lista é a da ANVISA para a rotulagem de alergênicos (RDC 727/2022), mais o glúten e a lactose, que têm regra própria.

export const GRUPOS_DE_ALERGENOS: ReadonlyArray<readonly [string, readonly string[]]> = [
  ['Cereais (e suas estirpes)', ['Trigo', 'Centeio', 'Cevada', 'Aveia']],
  ['Outros', ['Crustáceos', 'Ovos', 'Peixes', 'Amendoim', 'Soja', 'Leite', 'Látex natural']],
  [
    'Castanhas',
    ['Amêndoa', 'Avelã', 'Castanha-de-caju', 'Castanha-do-pará', 'Macadâmia', 'Nozes', 'Pecã', 'Pistache', 'Pinoli', 'Castanhas (outras)'],
  ],
] as const;
export const ALERGENOS: readonly string[] = GRUPOS_DE_ALERGENOS.flatMap(([, itens]) => itens);
/** Os cereais com glúten: marcar um deles responde o glúten sozinho. */
export const CEREAIS_COM_GLUTEN: readonly string[] = GRUPOS_DE_ALERGENOS[0][1];
const GLUTEN_SEMPRE: readonly string[] = ['Trigo', 'Centeio', 'Cevada'];
/** Como o alérgeno aparece para o cliente ("Trigo" → "Trigo (glúten)"). */
const ROTULO_DO_ALERGENO: Readonly<Record<string, string>> = { Trigo: 'Trigo (glúten)', 'Castanhas (outras)': 'Castanhas' };
export const rotuloDoAlergeno = (a: string) => ROTULO_DO_ALERGENO[a] ?? a;

/** A frase de cautela padrão (A9): diz o que a cozinha manipula, não promete e manda falar com a equipe. */
export const FRASE_DE_CAUTELA_PADRAO =
  'Nossa cozinha prepara alimentos com leite, trigo, ovos, soja, amendoim e castanhas. Não garantimos a ausência de traços. Em caso de alergia, fale com a nossa equipe antes de pedir.';
export const FRASE_DE_CAUTELA_MAX = 240;

export type SimNao = 'sim' | 'nao';

/** A marcação de um insumo (pelo rótulo) ou o ajuste do produto. `conferido = false` = ninguém conferiu: nada se sabe. */
export type MarcacaoDeAlergenos = {
  conferido: boolean;
  contem: string[];
  podeConter: string[];
  gluten: SimNao | null;
  lactose: SimNao | null;
};

export type SituacaoDosAlergenos = 'informado' | 'parcial' | 'nao_informado';
/** De onde vem a resposta do produto (o filtro "De onde vem" da conferência). */
export type OrigemDosAlergenos = 'ficha' | 'mao' | 'nenhuma';

/** O que o produto diz ao cliente e ao atendente. */
export type AlergenosDoProduto = {
  situacao: SituacaoDosAlergenos;
  origem: OrigemDosAlergenos;
  contem: string[];
  podeConter: string[];
  /** Os alérgenos que não se sabe (algum insumo não conferido): nunca viram "não contém". */
  naoInformados: string[];
  gluten: SimNao | null;
  lactose: SimNao | null;
  /** Os insumos que faltam conferir (o nome), para a conferência mostrar onde corrigir. */
  faltaConferir: string[];
};

const ehSimNao = (v: unknown): v is SimNao => v === 'sim' || v === 'nao';
const naOrdem = (lista: Iterable<string>) => {
  const s = new Set(lista);
  return ALERGENOS.filter((a) => s.has(a));
};

/**
 * A marcação que chega da tela (insumo ou ajuste do produto), conferida: só os alérgenos da lista, sem repetir; o que
 * CONTÉM sai do "pode conter"; cereal com glúten responde o glúten (sim); leite responde a lactose (sim); `conferido` só
 * verdadeiro ou falso (V15). Lança `Error` com a mensagem para a tela (o serviço transforma em 400).
 */
export function lerMarcacaoDeAlergenos(dto: unknown): MarcacaoDeAlergenos {
  const d = (dto && typeof dto === 'object' ? dto : {}) as Record<string, unknown>;
  if (d.conferido !== true && d.conferido !== false) throw new Error('Alérgenos: diga se o rótulo foi conferido (verdadeiro ou falso).');
  const lista = (v: unknown, campo: string): string[] => {
    if (v == null) return [];
    if (!Array.isArray(v)) throw new Error(`Alérgenos: "${campo}" tem de ser uma lista.`);
    const fora = v.filter((a) => typeof a !== 'string' || !ALERGENOS.includes(a));
    if (fora.length) throw new Error(`Alérgenos: "${String(fora[0])}" não é um alérgeno da lista.`);
    return naOrdem(v as string[]);
  };
  const contem = lista(d.contem, 'contém');
  const podeConter = lista(d.podeConter, 'pode conter').filter((a) => !contem.includes(a));
  for (const [campo, v] of [['glúten', d.gluten], ['lactose', d.lactose]] as const)
    if (v != null && !ehSimNao(v)) throw new Error(`Alérgenos: ${campo} é "sim", "nao" ou vazio.`);
  // Trigo, centeio e cevada sempre têm glúten; a aveia pode ser "sem glúten" e o leite pode ser "zero lactose": nesses, o
  // que a pessoa marcou vale.
  const gluten = contem.some((a) => GLUTEN_SEMPRE.includes(a)) ? 'sim' : ehSimNao(d.gluten) ? d.gluten : null;
  const lactose = ehSimNao(d.lactose) ? d.lactose : null;
  return { conferido: d.conferido, contem, podeConter, gluten, lactose };
}

/** A marcação gravada (jsonb) → a forma de trabalho; o que não tem a forma certa conta como "não conferido" (null). */
export function marcacaoGravada(v: unknown): MarcacaoDeAlergenos | null {
  if (!v || typeof v !== 'object') return null;
  try {
    return lerMarcacaoDeAlergenos(v);
  } catch {
    return null;
  }
}

/**
 * Os alérgenos do PRODUTO (A1–A3), pelas folhas da árvore (cada insumo da ficha, o item de revenda, os produtos do combo)
 * e o ajuste.
 * - contém = o que alguma folha contém ∪ o que o ajuste soma;
 * - pode conter = o que alguma folha ou o ajuste diz que pode conter, menos o que contém;
 * - com TODA folha conferida (ou, sem folhas, o ajuste conferido): o resto da lista é "não contém" → `informado`;
 * - faltando conferir alguma folha: o resto fica `naoInformados` (A2) → `parcial` se já se sabe algo, senão `nao_informado`;
 * - glúten/lactose: "sim" se qualquer um diz sim (ou contém cereal/leite); "nao" só com tudo conferido e todos dizendo
 *   "nao" OU nenhum cereal com glúten/leite e ninguém dizendo sim (a lista completa conferida já responde).
 * `folhas` = a marcação de cada folha, com o nome (null = não conferido).
 */
export function alergenosDoProduto(
  folhas: Array<{ nome: string; marcacao: MarcacaoDeAlergenos | null }>,
  ajuste: MarcacaoDeAlergenos | null,
): AlergenosDoProduto {
  const fontes: MarcacaoDeAlergenos[] = [];
  const parciais: MarcacaoDeAlergenos[] = [];
  const faltaConferir: string[] = [];
  if (folhas.length) {
    for (const f of folhas) {
      if (f.marcacao?.conferido) fontes.push(f.marcacao);
      else {
        // Marcado sem "conferi o rótulo": o que diz que CONTÉM vale (nunca tira), mas não responde o resto.
        if (f.marcacao) parciais.push(f.marcacao);
        if (!faltaConferir.includes(f.nome)) faltaConferir.push(f.nome);
      }
    }
  } else if (!ajuste?.conferido) {
    faltaConferir.push('o próprio produto (sem ficha técnica)');
  }
  // O ajuste SOMA (A3): mesmo sem "conferido", o que ele diz que contém ou pode conter vale; só o "conferido" dele
  // responde pelo produto sem folhas.
  const todos = [...fontes, ...parciais, ...(ajuste ? [ajuste] : [])];
  const contem = naOrdem(todos.flatMap((f) => f.contem));
  const podeConter = naOrdem(todos.flatMap((f) => f.podeConter)).filter((a) => !contem.includes(a));
  const tudoConferido = faltaConferir.length === 0;
  const naoInformados = tudoConferido ? [] : ALERGENOS.filter((a) => !contem.includes(a) && !podeConter.includes(a));
  // Glúten e lactose de CADA fonte: o que ela marcou; sem marcar, contém cereal/leite = "sim", "pode conter" = sem
  // resposta e, na fonte conferida, nenhum dos dois = "nao" (a lista inteira foi olhada). O ajuste não conferido só soma.
  const daFonte = (f: MarcacaoDeAlergenos, campo: 'gluten' | 'lactose', porAlergeno: (a: string) => boolean): SimNao | null => {
    if (f[campo]) return f[campo];
    if (f.contem.some(porAlergeno)) return 'sim';
    if (!f.conferido || f.podeConter.some(porAlergeno)) return null;
    return 'nao';
  };
  const resposta = (campo: 'gluten' | 'lactose', porAlergeno: (a: string) => boolean): SimNao | null => {
    const respostas = todos.map((f) => daFonte(f, campo, porAlergeno));
    if (respostas.includes('sim')) return 'sim';
    if (!tudoConferido) return null;
    const conferidas = todos.filter((f) => f.conferido).map((f) => daFonte(f, campo, porAlergeno));
    if (!conferidas.length || conferidas.includes(null)) return null;
    // O ajuste não conferido que fala de cereal/leite como "pode conter" também deixa sem resposta.
    if (todos.some((f) => !f.conferido && f.podeConter.some(porAlergeno) && !f[campo])) return null;
    return 'nao';
  };
  const gluten = resposta('gluten', (a) => CEREAIS_COM_GLUTEN.includes(a));
  const lactose = resposta('lactose', (a) => a === 'Leite');
  const situacao: SituacaoDosAlergenos = tudoConferido ? 'informado' : contem.length || podeConter.length ? 'parcial' : 'nao_informado';
  const origem: OrigemDosAlergenos = fontes.length ? 'ficha' : ajuste && (ajuste.conferido || ajuste.contem.length || ajuste.podeConter.length) ? 'mao' : 'nenhuma';
  return { situacao, origem, contem, podeConter, naoInformados, gluten, lactose, faltaConferir };
}

/** O selo "S/ glúten" ou "S/ lactose" que contradiz o cadastro (A6): a mensagem da recusa, ou null. */
export function seloQueContradiz(selos: unknown, a: Pick<AlergenosDoProduto, 'gluten' | 'lactose'>): string | null {
  const s = (Array.isArray(selos) ? selos : []).map((x) => String(x ?? '').toLowerCase());
  const tem = (re: RegExp) => s.some((x) => re.test(x));
  if (tem(/(s\/|sem)\s*gl[uú]ten/) && a.gluten === 'sim') return 'O selo "S/ glúten" contradiz o cadastro dos alérgenos: o produto contém glúten.';
  if (tem(/(s\/|sem)\s*lactose/) && a.lactose === 'sim') return 'O selo "S/ lactose" contradiz o cadastro dos alérgenos: o produto contém lactose.';
  return null;
}

/**
 * Os selos que o cardápio online pode mostrar (A6): o "S/ glúten"/"S/ lactose" que passou a contradizer o cadastro (o
 * insumo mudou depois do selo) sai da página — a tela do produto recusa gravar, e aqui nunca se mostra o contraditório.
 */
export function selosSemContradicao(selos: unknown, a: Pick<AlergenosDoProduto, 'gluten' | 'lactose'> | undefined): unknown[] {
  const lista = Array.isArray(selos) ? selos : [];
  if (!a) return lista;
  return lista.filter((x) => {
    const s = String(x ?? '').toLowerCase();
    if (a.gluten === 'sim' && /(s\/|sem)\s*gl[uú]ten/.test(s)) return false;
    if (a.lactose === 'sim' && /(s\/|sem)\s*lactose/.test(s)) return false;
    return true;
  });
}

/** A frase de cautela da loja (A9): a gravada, ou a padrão quando vazia. */
export const fraseDeCautela = (gravada: unknown) => {
  const t = String(gravada ?? '').replace(/\s+/g, ' ').trim();
  return t ? t.slice(0, FRASE_DE_CAUTELA_MAX) : FRASE_DE_CAUTELA_PADRAO;
};

const juntar = (itens: string[]) => (itens.length <= 1 ? itens.join('') : `${itens.slice(0, -1).join(', ')} e ${itens[itens.length - 1]}`);
const minusculo = (itens: string[]) => itens.map((a) => rotuloDoAlergeno(a).toLowerCase());

/** O bloco do cardápio online (A4): só o produto "informado"; os nomes já como o cliente lê. */
export function alergenosParaOCardapio(a: AlergenosDoProduto | undefined) {
  if (!a || a.situacao !== 'informado') return null;
  return { contem: a.contem.map(rotuloDoAlergeno), podeConter: a.podeConter.map(rotuloDoAlergeno), gluten: a.gluten, lactose: a.lactose };
}

/**
 * O que a busca do robô devolve sobre os alérgenos de um produto (uma linha curta). O atendente só usa quando o cliente
 * PERGUNTA (instrução ALERGIA): o texto diz o que o cadastro sabe, nunca garante ausência de traços.
 */
export function alergenosParaORobo(a: AlergenosDoProduto | undefined): string {
  if (!a || a.situacao === 'nao_informado') return 'não informado pela loja';
  const partes: string[] = [];
  if (a.contem.length) partes.push(`contém ${juntar(minusculo(a.contem))}`);
  if (a.podeConter.length) partes.push(`pode conter ${juntar(minusculo(a.podeConter))}`);
  if (a.situacao === 'informado') partes.push(a.contem.length || a.podeConter.length ? 'não contém os outros alérgenos da lista' : 'não contém nenhum alérgeno da lista');
  else partes.push('os outros alérgenos: não informado pela loja');
  const gl = a.gluten === 'sim' ? 'contém glúten' : a.gluten === 'nao' ? 'não contém glúten' : null;
  const la = a.lactose === 'sim' ? 'contém lactose' : a.lactose === 'nao' ? 'não contém lactose' : null;
  return [...partes, ...[gl, la].filter(Boolean)].join('; ');
}
