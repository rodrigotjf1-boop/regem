// Os alérgenos do cardápio na TELA (mig 454, D2 — protótipo `mockups/regem-atendente-alergenos-agendado.html`, A1–A9).
// A regra de verdade (a herança pela ficha, a validação) mora no servidor: `backend/src/common/alergenos.ts`. Aqui só a
// lista na mesma ordem, os rótulos e os textos da tela — a lista tem de ser IGUAL à do servidor (o teste confere).

export const GRUPOS_DE_ALERGENOS: ReadonlyArray<readonly [string, readonly string[]]> = [
  ['Cereais (e suas estirpes)', ['Trigo', 'Centeio', 'Cevada', 'Aveia']],
  ['Outros', ['Crustáceos', 'Ovos', 'Peixes', 'Amendoim', 'Soja', 'Leite', 'Látex natural']],
  [
    'Castanhas',
    ['Amêndoa', 'Avelã', 'Castanha-de-caju', 'Castanha-do-pará', 'Macadâmia', 'Nozes', 'Pecã', 'Pistache', 'Pinoli', 'Castanhas (outras)'],
  ],
] as const;
export const ALERGENOS: readonly string[] = GRUPOS_DE_ALERGENOS.flatMap(([, itens]) => itens);
const ROTULO: Readonly<Record<string, string>> = { Trigo: 'Trigo (glúten)', 'Castanhas (outras)': 'Castanhas' };
export const rotuloDoAlergeno = (a: string) => ROTULO[a] ?? a;

export const FRASE_DE_CAUTELA_PADRAO =
  'Nossa cozinha prepara alimentos com leite, trigo, ovos, soja, amendoim e castanhas. Não garantimos a ausência de traços. Em caso de alergia, fale com a nossa equipe antes de pedir.';
export const FRASE_DE_CAUTELA_MAX = 240;

export type SimNao = 'sim' | 'nao';
export type MarcacaoDeAlergenos = { conferido: boolean; contem: string[]; podeConter: string[]; gluten: SimNao | null; lactose: SimNao | null };
export const MARCACAO_VAZIA: MarcacaoDeAlergenos = { conferido: false, contem: [], podeConter: [], gluten: null, lactose: null };

/** A marcação gravada → a da tela (o que não tem a forma vira a vazia). */
export function marcacaoDe(v: unknown): MarcacaoDeAlergenos {
  if (!v || typeof v !== 'object') return MARCACAO_VAZIA;
  const o = v as Record<string, unknown>;
  const lista = (x: unknown) => (Array.isArray(x) ? x.filter((a): a is string => typeof a === 'string' && ALERGENOS.includes(a)) : []);
  const sn = (x: unknown): SimNao | null => (x === 'sim' || x === 'nao' ? x : null);
  return { conferido: o.conferido === true, contem: lista(o.contem), podeConter: lista(o.podeConter), gluten: sn(o.gluten), lactose: sn(o.lactose) };
}

/** A marcação está vazia (nada a gravar: a tela manda null, "ninguém conferiu")? */
export const marcacaoVazia = (m: MarcacaoDeAlergenos) => !m.conferido && !m.contem.length && !m.podeConter.length && !m.gluten && !m.lactose;

const juntar = (itens: string[]) => (itens.length <= 1 ? itens.join('') : `${itens.slice(0, -1).join(', ')} e ${itens[itens.length - 1]}`);
/** "trigo (glúten), leite e ovos" — a lista como o cliente lê. */
export const listaParaLer = (itens: string[]) => juntar(itens.map((a) => rotuloDoAlergeno(a).toLowerCase()));
/** Primeira letra maiúscula ("Leite, trigo (glúten) e ovos"). */
export const comMaiuscula = (t: string) => (t ? t[0].toUpperCase() + t.slice(1) : t);
