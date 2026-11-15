import { sql } from 'drizzle-orm';
import { ehServidorLocal } from '../../common/modo';
import { PaginaDeVagas, paginaDaLinha } from './vagas';

/* eslint-disable @typescript-eslint/no-explicit-any */

// A PÁGINA DE VAGAS PARA O ROBÔ (F3 de `docs/plano-vagas-candidatos.md`, §10): no assunto "vaga" em "Explica as vagas e
// manda o link", o robô explica as funções abertas, os salários, as escalas e os benefícios — o MESMO que a página pública
// mostra — e manda o link da ficha com a origem do canal (`?o=whatsapp`, `?o=direct`, `?o=messenger`). Sem DI: o cardápio
// (que monta as instruções do robô) chama daqui sem importar o módulo de vagas.
//  • Só a página LIGADA e com o módulo "vagas" ligado na loja — a mesma régua da página pública (senão o link abriria
//    "não encontrada"). Sem página, null: o robô volta a deixar o recado.
//  • Qual página: a da loja do cardápio; cardápio da empresa inteira = a única página ligada da empresa (com mais de uma,
//    null — o robô não escolhe loja sozinho).

/** O módulo ativável das vagas (a página pública e a tela de candidatos só valem com ele ligado na loja). */
export const MODULO_VAGAS = 'vagas';

const DIA_NA_FRASE: Record<string, string> = { seg: 'seg', ter: 'ter', qua: 'qua', qui: 'qui', sex: 'sex', sab: 'sáb', dom: 'dom' };
const hora = (h: string) => h.replace(/^(\d{2}):00$/, '$1h').replace(/^(\d{2}):(\d{2})$/, '$1h$2');
const MAX = 700;

/** O resumo das vagas em poucas linhas, como o robô explica (só o que a página pública mostra). */
export function resumoDasVagasParaORobo(p: PaginaDeVagas): string {
  const funcoes = p.funcoes.filter((f) => f.aberta).map((f) => (String(f.salario ?? '').trim() ? `${f.nome} (${String(f.salario).trim()})` : f.nome));
  const partes: string[] = [];
  if (funcoes.length) partes.push(`Funções abertas: ${funcoes.join(', ')}.`);
  const escalas: string[] = [];
  if (p.vagaFixa) {
    for (const e of ['12x36', '5x2'] as const) if (p.horarios[e].ativa) escalas.push(`${e}, das ${hora(p.horarios[e].inicio)} às ${hora(p.horarios[e].fim)}`);
  }
  if (p.horista && p.horarios.horista.ativa) {
    const dias = p.horarios.horista.dias.map((d) => DIA_NA_FRASE[d] ?? d).join(', ');
    escalas.push(`horista${dias ? ` (${dias})` : ''}, das ${hora(p.horarios.horista.inicio)} às ${hora(p.horarios.horista.fim)}`);
  }
  if (escalas.length) partes.push(`Escalas: ${escalas.join('; ')}.`);
  const beneficios = p.beneficios.map((b) => String(b ?? '').trim()).filter(Boolean);
  if (beneficios.length) partes.push(`Benefícios: ${beneficios.join(', ')}.`);
  if (p.idadeMinima) partes.push(`Idade mínima: ${p.idadeMinima} anos.`);
  const t = partes.join(' ').replace(/\s+/g, ' ').trim();
  return t.length > MAX ? `${t.slice(0, MAX - 1).trim()}…` : t;
}

export interface PaginaParaORobo {
  /** O link da ficha, sem a origem (o robô põe a do canal). */
  url: string;
  resumo: string;
}

/** O endereço público do app (o mesmo dos links do cardápio), sem a barra do fim. */
export function baseDoApp(): string {
  return String(process.env.APP_URL || 'https://app.dmsregem.com').replace(/\/+$/, '');
}

const linhas = (r: any) => (r?.rows ?? r ?? []) as any[];

/**
 * A página de vagas que o robô explica, para a empresa e a loja do cardápio — ou null (sem página ligada, módulo
 * desligado, empresa com várias páginas e cardápio da empresa inteira, servidor da loja, banco sem a tabela). Nunca
 * rejeita por falta de tabela; outra falha sobe (quem chama decide).
 */
export async function paginaParaORobo(db: any, tenantId: string, unidadeId: string | null, moduloLigado: (tenantId: string, unidadeId: string) => Promise<boolean>): Promise<PaginaParaORobo | null> {
  if (ehServidorLocal() || !tenantId) return null;
  let ls: any[];
  try {
    ls = linhas(
      await db.execute(sql`
        select * from vaga_pagina
         where tenant_id = ${tenantId}::uuid and ligada = true ${unidadeId ? sql`and unidade_id = ${unidadeId}::uuid` : sql``}
         order by codigo
         limit 2`),
    );
  } catch (e: any) {
    if (e?.code === '42P01' || e?.cause?.code === '42P01') return null;
    throw e;
  }
  if (ls.length !== 1) return null;
  const l = ls[0];
  if (!(await moduloLigado(tenantId, String(l.unidade_id)))) return null;
  const pagina = paginaDaLinha(l);
  if (!pagina.ligada || !pagina.funcoes.some((f) => f.aberta)) return null;
  return { url: `${baseDoApp()}/v/${String(l.codigo)}`, resumo: resumoDasVagasParaORobo(pagina) };
}
