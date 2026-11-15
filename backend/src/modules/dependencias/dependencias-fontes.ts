import { createHash } from 'node:crypto';
import { INTEGRACOES_EM_USO } from '../../common/integracoes-em-uso';

// AS FONTES OFICIAIS VIGIADAS (F3, parte 2 do docs/plano-mister.md; protótipo mockups/regem-dependencias-e-qualidade.html,
// vista "Console › Dependências"). Dado da distribuição, no código. Cada fonte foi aberta e conferida em 14/11/2026:
//  • a tabela de versões da Graph API da Meta (HTML, uma linha <tr> por versão: versão · lançamento · validade). A data
//    pode vir torta ("July 29,2028") e a tabela atrasa: em 14/11 ela ia até a v26.0, mas a API já aceitava a v27.0 — por
//    isso a versão em uso fora da tabela vira "a conferir", nunca "retirada";
//  • a tabela "Model status" da Anthropic (a página em Markdown: modelo · situação · deprecado · aposentadoria).
// O trecho vigiado é só a tabela (nunca a página inteira): mudança de visual não vira "mudou".

export type FonteVigiada = {
  id: string;
  integracoes: string[]; // os ids do inventário (`common/integracoes-em-uso.ts`) que esta fonte cobre
  nome: string;
  url: string;
  tipo: 'versoes_graph' | 'modelos_anthropic';
};

export const FONTES_VIGIADAS: FonteVigiada[] = [
  {
    id: 'meta-graph-versoes',
    integracoes: ['meta-whatsapp', 'meta-instagram', 'meta-messenger'],
    nome: 'Meta · tabela de versões da Graph API',
    url: 'https://developers.facebook.com/docs/graph-api/changelog/versions/?locale=en_US',
    tipo: 'versoes_graph',
  },
  {
    id: 'anthropic-modelos',
    integracoes: ['anthropic'],
    nome: 'Anthropic · situação dos modelos',
    url: 'https://platform.claude.com/docs/en/about-claude/model-deprecations.md',
    tipo: 'modelos_anthropic',
  },
];

/** Com quantos dias para a validade a versão em uso pede atenção. */
export const DIAS_DE_AVISO_DA_VERSAO = 180;
export const MAX_TRECHO = 40_000;

const MESES: Record<string, number> = { january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12 };

/** "July 29,2028" / "February 18, 2026" → "2028-07-29"; o resto (TBD, "To be announced", "N/A") → null. */
export function dataEmIngles(t: string): string | null {
  const m = /([A-Za-z]+)\s+(\d{1,2})\s*,\s*(\d{4})/.exec(String(t ?? ''));
  if (!m) return null;
  const mes = MESES[m[1].toLowerCase()];
  if (!mes) return null;
  return `${m[3]}-${String(mes).padStart(2, '0')}-${String(Number(m[2])).padStart(2, '0')}`;
}

const semTags = (h: string) =>
  h
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();

export type LinhaDaVersao = { versao: string; lancada: string | null; validaAte: string | null; textoDaValidade: string };

/** As linhas da tabela de versões da Graph API (HTML). Vazio = a página veio sem a tabela (formato mudou ou bloqueou). */
export function lerVersoesDaGraph(html: string): LinhaDaVersao[] {
  const linhas: LinhaDaVersao[] = [];
  for (const tr of String(html ?? '').matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const celulas = [...tr[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((c) => semTags(c[1]));
    if (celulas.length < 3) continue;
    const v = /^v(\d+\.\d+)$/.exec(celulas[0]);
    if (!v) continue;
    linhas.push({ versao: `v${v[1]}`, lancada: dataEmIngles(celulas[1]), validaAte: dataEmIngles(celulas[2]), textoDaValidade: celulas[2].slice(0, 60) });
  }
  return linhas;
}

export type LinhaDoModelo = { modelo: string; situacao: string; deprecadoEm: string | null; aposentadoria: string; aposentadoriaEm: string | null; naoAntesDe: boolean };

/** As linhas da tabela "Model status" (Markdown). */
export function lerModelosDaAnthropic(md: string): LinhaDoModelo[] {
  const linhas: LinhaDoModelo[] = [];
  for (const l of String(md ?? '').split(/\r?\n/)) {
    const c = l.split('|').map((x) => x.trim());
    // | modelo | situação | deprecado | aposentadoria |  → ['', modelo, situação, deprecado, aposentadoria, '']
    if (c.length < 6 || !/^claude-[a-z0-9.-]+$/i.test(c[1])) continue;
    linhas.push({
      modelo: c[1],
      situacao: c[2],
      deprecadoEm: dataEmIngles(c[3]),
      aposentadoria: c[4].slice(0, 60),
      aposentadoriaEm: dataEmIngles(c[4]),
      naoAntesDe: /not sooner than/i.test(c[4]),
    });
  }
  return linhas;
}

export const hashDoTrecho = (t: string) => createHash('sha256').update(t).digest('hex');

export type Achado = { integracao: string; usamos: string; situacao: 'em_dia' | 'vencendo' | 'a_conferir'; texto: string; data: string | null };

const diasAte = (iso: string, hoje: string) => Math.round((Date.parse(`${iso}T00:00:00Z`) - Date.parse(`${hoje}T00:00:00Z`)) / 86_400_000);
const br = (iso: string | null) => (iso ? iso.split('-').reverse().join('/') : null);

/** O que a tabela de versões diz das versões em uso (inventário). */
export function achadosDasVersoes(linhas: LinhaDaVersao[], hoje: string): Achado[] {
  return INTEGRACOES_EM_USO.filter((i) => i.versao && i.id.startsWith('meta-')).map((i) => {
    const l = linhas.find((x) => x.versao === i.versao);
    if (!l) return { integracao: i.id, usamos: i.versao!, situacao: 'a_conferir' as const, texto: `A ${i.versao} não está na tabela da Meta (a tabela pode estar atrasada: confirme pela API).`, data: null };
    if (!l.validaAte) return { integracao: i.id, usamos: i.versao!, situacao: 'em_dia' as const, texto: `A ${i.versao} ainda não tem data de validade (${l.textoDaValidade || 'a definir'}).`, data: null };
    const dias = diasAte(l.validaAte, hoje);
    return {
      integracao: i.id,
      usamos: i.versao!,
      situacao: dias <= DIAS_DE_AVISO_DA_VERSAO ? ('vencendo' as const) : ('em_dia' as const),
      texto: dias < 0 ? `A ${i.versao} venceu em ${br(l.validaAte)}.` : `A ${i.versao} vale até ${br(l.validaAte)} (${dias} dias).`,
      data: l.validaAte,
    };
  });
}

/** O que a tabela de modelos diz dos modelos em uso (inventário). */
export function achadosDosModelos(linhas: LinhaDoModelo[]): Achado[] {
  const modelos = INTEGRACOES_EM_USO.flatMap((i) => i.modelos ?? []);
  return modelos.map((m) => {
    const l = linhas.find((x) => x.modelo === m);
    if (!l) return { integracao: 'anthropic', usamos: m, situacao: 'a_conferir' as const, texto: `O ${m} não está na tabela da Anthropic.`, data: null };
    const ativo = /^active$/i.test(l.situacao);
    if (ativo) return { integracao: 'anthropic', usamos: m, situacao: 'em_dia' as const, texto: `${m}: ativo; aposentadoria ${l.naoAntesDe ? 'não antes de' : 'em'} ${br(l.aposentadoriaEm) ?? l.aposentadoria}.`, data: l.aposentadoriaEm };
    return { integracao: 'anthropic', usamos: m, situacao: 'vencendo' as const, texto: `${m}: ${l.situacao.toLowerCase()}; aposentadoria ${br(l.aposentadoriaEm) ?? l.aposentadoria}.`, data: l.aposentadoriaEm };
  });
}

/** O trecho vigiado de cada fonte: só a tabela, uma linha por versão/modelo (mudança de visual não muda o trecho). */
export function trechoDaFonte(f: FonteVigiada, corpo: string): string | null {
  if (f.tipo === 'versoes_graph') {
    const linhas = lerVersoesDaGraph(corpo);
    if (!linhas.length) return null;
    return linhas.map((l) => `${l.versao} | ${l.lancada ?? '-'} | ${l.validaAte ?? l.textoDaValidade}`).join('\n').slice(0, MAX_TRECHO);
  }
  const linhas = lerModelosDaAnthropic(corpo);
  if (!linhas.length) return null;
  return linhas.map((l) => `${l.modelo} | ${l.situacao} | ${l.deprecadoEm ?? '-'} | ${l.aposentadoriaEm ?? l.aposentadoria}`).join('\n').slice(0, MAX_TRECHO);
}

/** Os achados da fonte para hoje (a validade conta dias a partir de hoje). */
export function achadosDaFonte(f: FonteVigiada, corpo: string, hoje: string): Achado[] {
  return f.tipo === 'versoes_graph' ? achadosDasVersoes(lerVersoesDaGraph(corpo), hoje) : achadosDosModelos(lerModelosDaAnthropic(corpo));
}

/** As linhas que mudaram entre o trecho antigo e o novo (para o antes e o depois na gaveta). */
export function linhasQueMudaram(antes: string | null, depois: string | null): { saiu: string[]; entrou: string[] } {
  const a = new Set((antes ?? '').split('\n').filter(Boolean));
  const d = new Set((depois ?? '').split('\n').filter(Boolean));
  return { saiu: [...a].filter((x) => !d.has(x)).slice(0, 20), entrou: [...d].filter((x) => !a.has(x)).slice(0, 20) };
}
