// AS INSTRUÇÕES CANDIDATAS DO MISTER (M2b, o Mentor; mig 435; protótipo `mockups/regem-mister-mentor-parte2.html`, aprovado
// em 16/11/2026). Puro: sem banco, sem rede.
//
// As instruções moram no código (`INSTRUCOES_DO_MISTER`). Uma versão nova é uma TROCA de uma linha (a que sai, exata, e a
// que entra), aplicada por cima do texto do código — assim a mudança que o código fizer depois continua valendo. O texto
// "no ar" = o do código com as trocas publicadas, em ordem; a troca cuja linha sumiu do código fica de fora e é avisada.
// A candidata só se publica com a avaliação de regressão passando SEM ERRADA NOVA em relação à avaliação da versão no ar.

import { createHash } from 'crypto';
import { FERRAMENTAS } from './mister-agente.regras';

export interface TrocaPublicada {
  id: string;
  sai: string;
  entra: string;
}

/** Aplica as trocas, em ordem, sobre o texto do código. A que não acha a linha que sai (o código mudou) fica de fora. */
export function aplicarTrocas(base: string, trocas: TrocaPublicada[]): { texto: string; aplicadas: string[]; quebradas: string[] } {
  const linhas = base.split('\n');
  const aplicadas: string[] = [];
  const quebradas: string[] = [];
  for (const t of trocas) {
    const i = linhas.indexOf(t.sai);
    // Rodada 7, MIS-G-05: a linha que aparece mais de uma vez não diz QUAL trocar — fica de fora (avisada), nunca a primeira.
    if (i < 0 || !t.sai.trim() || linhas.indexOf(t.sai, i + 1) >= 0) {
      quebradas.push(t.id);
      continue;
    }
    linhas[i] = t.entra;
    aplicadas.push(t.id);
  }
  return { texto: linhas.join('\n'), aplicadas, quebradas };
}

/** A impressão do texto e das ferramentas (a MESMA conta de `versaoDasInstrucoes`: sem troca, a versão é a do código). */
export function versaoDoTexto(texto: string): string {
  return createHash('sha256').update(texto).update(JSON.stringify(FERRAMENTAS)).digest('hex').slice(0, 8);
}

// ───────────────────────────── o Mentor propõe a troca ─────────────────────────────

/** O modelo do Mentor: escrever instrução pede mais que responder pergunta. */
export const MODELO_DO_MENTOR = 'claude-sonnet-5-5';
export const RECURSO_DO_MENTOR = 'mister_mentor';
export const SAIDA_DO_MENTOR = 4000;

export const INSTRUCOES_DO_MENTOR = [
  'Você é o Mentor do Mister, o administrador virtual do Regem (um sistema de gestão de bares e restaurantes). O Mister responde pelo WhatsApp às perguntas do dono e do gerente, seguindo as instruções que você vai receber, numeradas por linha.',
  'Você recebe também as perguntas da avaliação de regressão que o Mister ERROU com essas instruções, com o que a conferência apontou.',
  'Proponha UMA troca de UMA linha que corrija o erro sem piorar o resto:',
  '- "sai": a linha que sai, copiada EXATAMENTE como está (sem o número da linha). Nunca uma linha vazia.',
  '- "entra": a linha nova, numa linha só, no mesmo estilo (português do Brasil, frases curtas; se a linha que sai é um item de lista, a nova também começa com "- "). Mantenha o que a linha já faz bem e acrescente o que falta.',
  '- "porque": em uma frase, o que a troca corrige.',
  'Não invente consulta, ferramenta nem dado que não está nas instruções.',
  'Responda SÓ com o JSON, sem texto antes nem depois: {"sai":"…","entra":"…","porque":"…"}',
].join('\n');

export interface ErradaDaAvaliacao {
  pergunta: string;
  falhas: string[];
}

/** O pedido ao Mentor: as instruções numeradas e as erradas (só a pergunta fixa e a falha — a loja de teste é inventada). */
export function mensagensDoMentor(texto: string, erradas: ErradaDaAvaliacao[]): Array<{ role: 'user'; content: string }> {
  const numeradas = texto
    .split('\n')
    .map((l, i) => `${i + 1}| ${l}`)
    .join('\n');
  const erros = erradas.map((e, i) => `${i + 1}. "${e.pergunta}" — ${e.falhas.join('; ')}`).join('\n');
  return [{ role: 'user', content: `Instruções do Mister:\n${numeradas}\n\nAs perguntas que ele errou:\n${erros}` }];
}

const umaLinha = (v: unknown, max: number) => {
  const t = typeof v === 'string' ? v.replace(/\s*\n\s*/g, ' ').trim() : '';
  return t.length > max ? '' : t;
};

/**
 * A troca que o Mentor devolveu, conferida: só o JSON pedido, a linha que sai EXISTE no texto (comparada sem os espaços
 * das pontas; guarda-se a linha exata do texto), a que entra é uma linha só, diferente e de tamanho razoável. Devolve null
 * quando não serve (a frase volta ao console).
 */
export function lerCandidata(resposta: string, texto: string): { sai: string; entra: string; porque: string } | null {
  const ini = resposta.indexOf('{');
  const fim = resposta.lastIndexOf('}');
  if (ini < 0 || fim <= ini) return null;
  let obj: any;
  try {
    obj = JSON.parse(resposta.slice(ini, fim + 1));
  } catch {
    return null;
  }
  const saiDita = typeof obj?.sai === 'string' ? obj.sai.replace(/^\d+\|\s?/, '').trim() : '';
  const linha = saiDita ? texto.split('\n').find((l) => l.trim() === saiDita) : undefined;
  const entra = umaLinha(obj?.entra, 1200);
  const porque = umaLinha(obj?.porque, 300) || 'sem explicação';
  if (!linha || !entra || entra.length < 10 || entra === linha.trim()) return null;
  return { sai: linha, entra, porque };
}

// ───────────────────────────── a comparação e a regra de publicar ─────────────────────────────

export interface CasoComparado {
  id: string;
  pergunta: string;
  ok: boolean;
}

/** As erradas NOVAS (acertou na versão no ar e errou na candidata) e as que melhoraram (o contrário). */
export function compararAvaliacoes(base: CasoComparado[], candidata: CasoComparado[]): { novas: CasoComparado[]; melhoraram: CasoComparado[] } {
  const naBase = new Map(base.map((c) => [c.id, c.ok]));
  return {
    novas: candidata.filter((c) => !c.ok && naBase.get(c.id) === true),
    melhoraram: candidata.filter((c) => c.ok && naBase.get(c.id) === false),
  };
}

export interface RodadaParaComparar {
  situacao: string;
  versao: string;
  total: number;
  feitas: number;
  casos: CasoComparado[];
  /** O modelo que respondeu na avaliação (mig 424). Ausente nas rodadas antigas. */
  modelo?: string | null;
}

/**
 * Pode publicar? A candidata nasceu sobre a versão no ar de AGORA; a avaliação dela terminou inteira com a versão dela; a
 * versão no ar tem uma avaliação terminada para comparar; e nenhuma errada nova. Devolve o motivo quando não pode.
 */
export function regraDePublicar(p: {
  versaoNoAr: string;
  candidata: { versaoBase: string; versao: string };
  base: RodadaParaComparar | null;
  daCandidata: RodadaParaComparar | null;
}): { pode: boolean; motivo: string | null; novas: CasoComparado[]; melhoraram: CasoComparado[] } {
  const nada = { novas: [] as CasoComparado[], melhoraram: [] as CasoComparado[] };
  if (p.candidata.versaoBase !== p.versaoNoAr)
    return { pode: false, motivo: 'A versão no ar mudou depois que a candidata nasceu. Descarte e peça outra.', ...nada };
  const c = p.daCandidata;
  if (!c || c.versao !== p.candidata.versao) return { pode: false, motivo: 'Rode a avaliação com a candidata antes de publicar.', ...nada };
  if (c.situacao === 'rodando') return { pode: false, motivo: 'A avaliação da candidata ainda está rodando.', ...nada };
  if (c.situacao !== 'terminou' || c.feitas < c.total) return { pode: false, motivo: 'A avaliação da candidata não terminou. Rode de novo.', ...nada };
  const b = p.base;
  if (!b || b.situacao !== 'terminou' || b.versao !== p.versaoNoAr || b.feitas < b.total)
    return { pode: false, motivo: 'A versão no ar ainda não tem uma avaliação inteira para comparar. Rode a avaliação dela antes.', ...nada };
  // Rodada 7, MIS-G-03 (ERR-659): a comparação só vale com a MESMA régua — o mesmo modelo e as mesmas perguntas. Antes, a base
  // escolhida pela versão do texto podia ter outro modelo ou menos casos, e a pergunta nova que a candidata errava ficava de
  // fora ("sem errada nova").
  if (b.modelo && c.modelo && b.modelo !== c.modelo)
    return { pode: false, motivo: 'As duas avaliações foram feitas com modelos diferentes. Rode a avaliação da versão no ar de novo.', ...nada };
  const naBase = new Map(b.casos.map((x) => [x.id, x.pergunta]));
  if (b.total !== c.total || c.casos.some((x) => naBase.get(x.id) !== x.pergunta))
    return { pode: false, motivo: 'As perguntas da avaliação mudaram desde a avaliação da versão no ar. Rode a avaliação dela de novo.', ...nada };
  const cmp = compararAvaliacoes(b.casos, c.casos);
  if (cmp.novas.length) return { pode: false, motivo: `${cmp.novas.length === 1 ? '1 pergunta passou' : `${cmp.novas.length} perguntas passaram`} a errar com a candidata.`, ...cmp };
  return { pode: true, motivo: null, ...cmp };
}
