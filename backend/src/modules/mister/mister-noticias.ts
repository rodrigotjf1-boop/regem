import { sql } from 'drizzle-orm';
import { podeAcessar } from '../../auth/permissoes';
import { hojeISO, somarDias } from '../../common/data';
import type { DrizzleDB } from '../../db/drizzle.module';
import {
  RAMO_DA_EMPRESA_COM_BOLETIM,
  RAMO_DO_REGEM,
  type BoletimDoRamo,
  type IndicadorDoBoletim,
  type NoticiaDoBoletim,
} from '../pulso/pulso.regras';
import { noticiasNoMister } from './mister-agente.regras';
import type { EscopoDoMister, ResultadoDaFerramenta } from './mister-ferramentas.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

// PERGUNTAR AO MISTER SOBRE AS NOTÍCIAS DO RAMO (fase N3; protótipo `mockups/regem-noticias-do-ramo.html`, conversa 4). A
// consulta lê as cópias do boletim que a nuvem guardou (mig 494): nenhuma chamada ao Pulso. O título vai igual ao da fonte,
// com o crédito e o link, e o que está no Congresso leva o aviso. Nasce desligada (`MISTER_NOTICIAS_RAMO=1`): entra na
// avaliação de perguntas antes de ligar.

export const ASSUNTOS_DAS_NOTICIAS = ['impostos', 'trabalho', 'governo', 'economia', 'novidades'] as const;
export type AssuntoDasNoticias = (typeof ASSUNTOS_DAS_NOTICIAS)[number];
export const DIAS_DAS_NOTICIAS_PADRAO = 7;
export const DIAS_DAS_NOTICIAS_MAX = 30;
export const NOTICIAS_NA_RESPOSTA = 12;
export const CUIDADO_DAS_NOTICIAS =
  'Repita o que a notícia diz, com a fonte. O que tem "emDiscussao" ainda não é lei. Não diga o efeito na loja nem o que a pessoa deve pagar: para isso, oriente falar com o contador. Não escreva link: termine dizendo que os links estão em Relatórios › Notícias do ramo.';

const DE_NOVIDADE = new Set(['tendencias', 'tecnologia', 'plataformas']);
const diaCurto = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
const numero = (v: number) => v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const recusa = (erro: string): ResultadoDaFerramenta => ({ ok: false, dados: { erro } });

/** O assunto e o período pedidos — ou a frase da recusa. */
export function pedidoDasNoticias(en: Record<string, unknown>, hoje: string): { assunto: AssuntoDasNoticias | null; de: string; ate: string } | { erro: string } {
  const assunto = en.assunto === undefined || en.assunto === null || en.assunto === '' ? null : en.assunto;
  if (assunto !== null && !ASSUNTOS_DAS_NOTICIAS.includes(assunto as AssuntoDasNoticias)) {
    return { erro: `Diga o assunto: ${ASSUNTOS_DAS_NOTICIAS.map((a) => `"${a}"`).join(', ')}.` };
  }
  const dias = en.dias === undefined || en.dias === null || en.dias === '' ? DIAS_DAS_NOTICIAS_PADRAO : Number(en.dias);
  if (!Number.isInteger(dias) || dias < 1 || dias > DIAS_DAS_NOTICIAS_MAX) return { erro: `Diga de quantos dias: de 1 a ${DIAS_DAS_NOTICIAS_MAX}.` };
  return { assunto: assunto as AssuntoDasNoticias | null, de: somarDias(hoje, 1 - dias), ate: hoje };
}

const passaNoAssunto = (n: NoticiaDoBoletim, a: AssuntoDasNoticias | null) => !a || (a === 'novidades' ? DE_NOVIDADE.has(n.categoria) : n.categoria === a);

const indicadorNaResposta = (i: IndicadorDoBoletim) => ({
  nome: i.nome,
  valor: i.unidade.startsWith('%') ? `${numero(i.valor)}%` : `${numero(i.valor)} ${i.unidade}`,
  unidade: i.unidade.replace(/^%\s*/, ''),
  referencia: i.referencia,
  ...(i.acumulado12Meses !== null ? { acumulado12Meses: `${numero(i.acumulado12Meses)}%` } : {}),
  fonte: i.credito,
});

/** A resposta da consulta, das cópias do período (a mais nova primeiro). Sem IA: é o que a IA recebe para contar. */
export function montarNoticias(copias: BoletimDoRamo[], p: { assunto: AssuntoDasNoticias | null; de: string; ate: string }) {
  const vistas = new Set<string>();
  const todas: NoticiaDoBoletim[] = [];
  for (const b of copias) {
    for (const n of [...(b.destaques ?? []), ...(b.novidades ?? []), ...(b.mais ?? [])]) {
      if (vistas.has(n.id)) continue;
      vistas.add(n.id);
      todas.push(n);
    }
  }
  const doAssunto = todas.filter((n) => passaNoAssunto(n, p.assunto)).sort((a, b) => b.publicadoEm.localeCompare(a.publicadoEm));
  const comIndicadores = !p.assunto || p.assunto === 'economia';
  return {
    periodo: `de ${diaCurto(p.de)} a ${diaCurto(p.ate)}`,
    assunto: p.assunto ?? 'todos',
    total: doAssunto.length,
    mostrando: Math.min(doAssunto.length, NOTICIAS_NA_RESPOSTA),
    noticias: doAssunto.slice(0, NOTICIAS_NA_RESPOSTA).map((n) => ({
      titulo: n.titulo,
      assunto: n.categoriaNome,
      publicadaEm: n.publicadoEm,
      emDiscussao: n.emDiscussao,
      ...(n.aviso ? { aviso: n.aviso } : {}),
      // Sem o link: o filtro de saída do Mister tira todo link da resposta. A pessoa acha a matéria na tela do Regem.
      fonte: n.credito,
    })),
    ...(comIndicadores && copias[0]?.indicadores?.length ? { indicadores: copias[0].indicadores.map(indicadorNaResposta) } : {}),
    ...(doAssunto.length ? {} : { semNoticias: 'Nenhuma notícia desse assunto no período. Diga isso, sem inventar.' }),
    cuidado: CUIDADO_DAS_NOTICIAS,
  };
}

/** A consulta `noticias_do_ramo`: quem vê, o ramo e a leitura das cópias. Só lê. */
export async function consultarNoticias(db: DrizzleDB, e: Pick<EscopoDoMister, 'tenantId' | 'nivel' | 'permissoes'>, en: Record<string, unknown>, hoje = hojeISO()): Promise<ResultadoDaFerramenta> {
  if (!noticiasNoMister()) return recusa('Esta consulta ainda não está ligada no Regem.');
  if (e.nivel !== 'presidente' && !podeAcessar(e.permissoes, 'noticias_ramo')) {
    return recusa('O perfil desta pessoa no Regem não dá acesso às Notícias do ramo. Quem muda o perfil é o presidente.');
  }
  const p = pedidoDasNoticias(en, hoje);
  if ('erro' in p) return recusa(p.erro);
  const linhas = (r: any) => (r?.rows ?? r ?? []) as any[];
  const [emp] = linhas(await db.execute(sql`select ramo from empresa where id = ${e.tenantId}::uuid`));
  if (emp?.ramo !== RAMO_DA_EMPRESA_COM_BOLETIM) return recusa('Não há boletim para o ramo desta empresa.');
  const copias = linhas(
    await db.execute(sql`
      select corpo from pulso_boletim
       where ramo = ${RAMO_DO_REGEM} and dia between ${p.de}::date and ${p.ate}::date
       order by dia desc`),
  ).map((l) => l.corpo as BoletimDoRamo);
  return { ok: true, dados: montarNoticias(copias, p) };
}
