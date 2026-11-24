// O SENTINELA, PARTE 2 — A ANÁLISE COM IA DA SEGURANÇA (S2; mig 434; protótipo `mockups/regem-mister-mentor-parte2.html`,
// aprovado em 16/11/2026). Puro: sem banco, sem rede.
//
// A Diretoria pede uma rodada no Console › Mister › Segurança. A IA (pela chave da DMS) lê SÓ os metadados que o servidor
// já anota — os desfechos da entrada, as notas do filtro de saída, os motivos de não responder, as contagens por empresa e
// o final de 4 dígitos do telefone — nunca o texto das lojas, e PROPÕE: cada proposta traz o que viu, a proposta, o
// impacto e como conferir. Nada age sozinho; uma pessoa decide ("Virou tarefa" ou "Descartar").

import { UsoDaChamada, custoEstimadoUsd } from '../ia/ia.regras';

export const DIAS_DA_ANALISE = 7;
/** A rodada "rodando" que passou disto virou "interrompida" (o processo caiu no meio). A regra é UMA, aqui (V80). */
export const PRAZO_DA_ANALISE_MIN = 5;
export const RECURSO_DA_ANALISE = 'mister_sentinela';
export const MAX_PROPOSTAS = 5;
export const NIVEIS_DA_PROPOSTA = ['critico', 'atencao', 'melhoria'] as const;
export type NivelDaPropostaDaAnalise = (typeof NIVEIS_DA_PROPOSTA)[number];
/** Quanto a IA pode escrever (as 5 propostas cabem com folga). */
export const SAIDA_MAX_TOKENS = 6000;

export interface PropostaDaAnalise {
  nivel: NivelDaPropostaDaAnalise;
  titulo: string;
  viu: string;
  proposta: string;
  impacto: string;
}

/** O que a IA lê: só contagens, notas, motivos, nomes de empresa e finais de telefone. */
export interface MetadadosDaAnalise {
  dias: number;
  /** O resumo da Segurança (parte 1), como a tela mostra. */
  seguranca: unknown;
  /** Os telefones com mais códigos errados para ligar (só o final). */
  telefonesComCodigoErrado: { final: string; vezes: number; de: string; ate: string }[];
  /** As notas do filtro de saída por consulta (o nome da consulta, nunca o que ela trouxe). */
  notasPorConsulta: { nota: string; consulta: string; vezes: number; empresas: number }[];
  /** Os motivos de não responder. */
  motivosSemResposta: { motivo: string; vezes: number }[];
}

const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);

/** Quantos eventos a rodada leu (o número "Eventos lidos" da tela): cada desfecho, nota, limite, bloqueio e motivo contado. */
export function contarEventos(m: MetadadosDaAnalise): number {
  const s: any = m.seguranca ?? {};
  const e = s.entrada ?? {};
  const entrada = num(e.codigoErrado?.quantas) + num(e.outraPessoa) + num(e.perdeuOAcesso) + num(e.naoLigado?.quantas);
  const saida = (Array.isArray(s.saida) ? s.saida : []).reduce((t: number, x: any) => t + num(x?.quantas), 0);
  const motivos = m.motivosSemResposta.reduce((t, x) => t + num(x.vezes), 0);
  return entrada + saida + num(s.limite) + num(s.linksComPin?.bloqueados) + motivos;
}

export const INSTRUCOES_DO_SENTINELA = [
  'Você é o Sentinela do Mister, o administrador virtual do Regem (um sistema de gestão de restaurantes e lojas de comida).',
  'Você lê os METADADOS de segurança do período — contagens do que as proteções do Mister barraram ou recusaram — e PROPÕE alertas e melhorias para a equipe da DMS (a empresa que distribui o Regem). Você nunca age: cada proposta é para uma pessoa decidir.',
  'Regras:',
  '- Use só os números do JSON. Não invente evento, empresa, telefone, hora nem número. Se um dado não está no JSON, ele não existe para você.',
  '- nivel: "critico" = possível vazamento de dado ou ataque em curso; "atencao" = comportamento suspeito ou repetido; "melhoria" = ajuste de regra, de consulta ou de instrução.',
  '- titulo: uma frase curta. viu: o que os números mostram, com os números e quando. proposta: o que fazer, concreto, que uma pessoa execute. impacto: quem é afetado e como conferir depois, com o número que deve mudar.',
  `- No máximo ${MAX_PROPOSTAS} propostas, a mais importante primeiro. Se nada pede ação, devolva a lista vazia.`,
  '- Nunca proponha agir sozinho, revogar chave, bloquear pessoa ou desligar integração sem uma pessoa decidir.',
  '- Escreva em português do Brasil.',
  '- Responda SÓ com o JSON, sem texto antes nem depois: {"propostas":[{"nivel":"…","titulo":"…","viu":"…","proposta":"…","impacto":"…"}]}',
].join('\n');

/** As mensagens do pedido: o JSON dos metadados, e nada mais. */
export function mensagensDaAnalise(m: MetadadosDaAnalise): Array<{ role: 'user'; content: string }> {
  return [{ role: 'user', content: `Metadados de segurança dos últimos ${m.dias} dias:\n${JSON.stringify(m)}` }];
}

const texto = (v: unknown, max: number) => {
  const t = typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '';
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
};

/**
 * As propostas que a IA devolveu, conferidas: só o JSON pedido, o nível da lista fechada, os quatro textos preenchidos (e
 * cortados), no máximo 5. Devolve null quando a resposta não é o JSON pedido (a rodada falha com a frase).
 */
export function lerPropostas(resposta: string): PropostaDaAnalise[] | null {
  const ini = resposta.indexOf('{');
  const fim = resposta.lastIndexOf('}');
  if (ini < 0 || fim <= ini) return null;
  let obj: any;
  try {
    obj = JSON.parse(resposta.slice(ini, fim + 1));
  } catch {
    return null;
  }
  if (!obj || !Array.isArray(obj.propostas)) return null;
  const lidas: PropostaDaAnalise[] = [];
  for (const p of obj.propostas) {
    const nivel = String(p?.nivel ?? '') as NivelDaPropostaDaAnalise;
    const prop = { nivel, titulo: texto(p?.titulo, 160), viu: texto(p?.viu, 600), proposta: texto(p?.proposta, 600), impacto: texto(p?.impacto, 600) };
    if (!(NIVEIS_DA_PROPOSTA as readonly string[]).includes(nivel) || !prop.titulo || !prop.viu || !prop.proposta || !prop.impacto) continue;
    lidas.push(prop);
    if (lidas.length >= MAX_PROPOSTAS) break;
  }
  return lidas;
}

/** O custo estimado ANTES de rodar (a tela mostra): o tamanho do pedido em tokens (≈ 3,5 letras cada) e a saída cheia. */
export function estimativaDaAnalise(modelo: string, m: MetadadosDaAnalise): number | null {
  const letras = INSTRUCOES_DO_SENTINELA.length + mensagensDaAnalise(m)[0].content.length;
  const uso: UsoDaChamada = { entrada: Math.ceil(letras / 3.5), cacheEscrita: 0, cacheLeitura: 0, saida: SAIDA_MAX_TOKENS };
  const c = custoEstimadoUsd(modelo, uso);
  return c === null ? null : Math.round(c * 10000) / 10000;
}

export interface DecisaoDaPropostaDaAnalise {
  id: string;
  decisao: 'tarefa' | 'descartada';
  tarefa: string | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A decisão da Diretoria, conferida antes de gravar; devolve a frase da recusa (ou a decisão pronta). */
export function conferirDecisaoDaAnalise(dto: unknown): DecisaoDaPropostaDaAnalise | { erro: string } {
  const d: any = dto ?? {};
  if (!UUID.test(String(d.id ?? ''))) return { erro: 'Proposta não encontrada.' };
  if (d.decisao !== 'tarefa' && d.decisao !== 'descartada') return { erro: 'Escolha "Virou tarefa" ou "Descartar".' };
  const tarefa = d.decisao === 'tarefa' ? texto(d.tarefa, 200) || null : null;
  return { id: String(d.id).toLowerCase(), decisao: d.decisao, tarefa };
}
