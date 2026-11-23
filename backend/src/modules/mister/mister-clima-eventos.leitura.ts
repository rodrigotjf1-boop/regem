import { sql } from 'drizzle-orm';
import type { DrizzleDB } from '../../db/drizzle.module';
import { somarDias } from '../perfil-cliente/calendario-regra';
import { CalendarioDaLojaService } from '../perfil-cliente/calendario-da-loja.service';
import type { CidadeDaLoja, ClimaLido, EventoDaBase, ItemDaLoja } from './mister-clima-eventos';

/* eslint-disable @typescript-eslint/no-explicit-any */

// As leituras de clima e eventos (versão 8, E1). As tabelas do Pulso são só da nuvem; sem elas, a agenda segue com o calendário.

const linhas = (r: any): any[] => r?.rows ?? r ?? [];
const semTabela = (e: any) => ['42P01', '42703'].includes(e?.code) || ['42P01', '42703'].includes(e?.cause?.code);

/**
 * A cidade da loja, pela configuração fiscal. Com a loja escolhida, vale a dela e, sem ela, a da empresa. Sem loja escolhida e
 * com mais de uma cidade, a previsão pergunta qual: não mistura cidades.
 */
export async function lerCidadeDaLoja(db: DrizzleDB, tenantId: string, atual: string | null): Promise<CidadeDaLoja> {
  const rows = linhas(
    await db.execute(sql`
      select codigo_municipio as municipio, uf, unidade_id::text as unidade
        from fiscal_config
       where tenant_id = ${tenantId}::uuid and codigo_municipio is not null`),
  );
  const escolhidas = atual ? rows.filter((r) => r.unidade === atual) : [];
  const daEmpresa = rows.filter((r) => r.unidade == null);
  const candidatas = atual ? (escolhidas.length ? escolhidas : daEmpresa) : rows;
  const cidades = new Set(candidatas.map((r) => Number(r.municipio)));
  if (!cidades.size) return { situacao: 'sem_cidade', municipio: null, uf: null };
  if (cidades.size > 1) return { situacao: 'varias_cidades', municipio: null, uf: null };
  return { situacao: 'ok', municipio: Number(candidatas[0].municipio), uf: candidatas[0].uf ?? null };
}

/** Os eventos da base no período. O fim vai um dia além: o jogo da noite pode estar gravado no dia seguinte em UTC. */
export async function lerEventosDaBase(db: DrizzleDB, de: string, ate: string): Promise<EventoDaBase[]> {
  try {
    return linhas(
      await db.execute(sql`
        select tipo, nome, dia_inteiro, inicio, fuso, abrangencia, situacao
          from pulso_evento
         where situacao not in ('retirado', 'cancelado')
           and left(inicio, 10) between ${de} and ${somarDias(ate, 1)}
         order by inicio
         limit 500`),
    ) as EventoDaBase[];
  } catch (e: any) {
    if (semTabela(e)) return [];
    throw e;
  }
}

export async function lerClimaDaCidade(db: DrizzleDB, municipio: number | null, de: string, ate: string): Promise<ClimaLido[]> {
  if (municipio == null) return [];
  try {
    return linhas(
      await db.execute(sql`
        select to_char(dia, 'YYYY-MM-DD') as dia, inmet, cptec
          from clima_municipio_dia
         where municipio = ${municipio}::int and dia between ${de}::date and ${ate}::date
         order by dia`),
    ) as ClimaLido[];
  } catch (e: any) {
    if (semTabela(e)) return [];
    throw e;
  }
}

/** O calendário da loja: a regra fixa, o que a loja cadastrou e os feriados da escala. O mesmo da tela. */
export async function lerCalendarioDaLoja(db: DrizzleDB, tenantId: string, atual: string | null, de: string, ate: string): Promise<ItemDaLoja[]> {
  try {
    const itens = await new CalendarioDaLojaService(db).listar(tenantId, atual, de, ate);
    return itens.map((i) => ({ dia: i.dia, grupo: i.grupo, tipo: i.tipo, nome: i.nome, origem: i.origem, hora: i.hora ?? null }));
  } catch (e: any) {
    if (semTabela(e)) return [];
    throw e;
  }
}
