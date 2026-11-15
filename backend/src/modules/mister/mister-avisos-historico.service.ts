import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { hojeISO, somarDias } from '../../common/data';
import { noPeriodo } from '../../common/fuso-sql';
import { Destino, NOME_DO_DESTINO, TIPOS_DE_AVISO } from './mister-avisos.regras';

/* eslint-disable @typescript-eslint/no-explicit-any */

// O HISTÓRICO DOS AVISOS (F1.4 parte B, protótipo `mockups/regem-avisos-na-tela.html` aprovado em 14/11/2026), só na
// nuvem (`mister_aviso`, mig 419):
//  • Mister › Histórico (só o presidente): os avisos da empresa, com a situação, o grupo, para onde foram e a trilha de
//    cada fase. Os abertos aparecem sempre; os resolvidos, pelo período escolhido (pela abertura, no horário da loja).
//  • Console da distribuição › Avisos (Diretoria e Técnico): os avisos com o destino "Suporte da DMS" de TODAS as
//    empresas — só a empresa, a loja e o aviso; nada de cliente, conversa, valor ou telefone.
// A trilha guarda só os 4 últimos dígitos de quem recebeu pelo WhatsApp; é o que a tela mostra.

const linhas = (r: any) => (r?.rows ?? r ?? []) as any[];
const iso = (c: string) => sql.raw(`to_char(${c} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')`);
/** Teto de linhas de cada lista (a busca e os filtros acham as outras). */
export const AVISOS_NO_HISTORICO_MAX = 200;
export const PERIODOS_DO_HISTORICO = [1, 7, 30] as const;
const SITUACOES = ['todos', 'aberto', 'resolvido'] as const;
type SituacaoDoFiltro = (typeof SITUACOES)[number];
const GRUPOS = [...new Set(TIPOS_DE_AVISO.map((t) => t.grupo))];

const FASE: Record<string, string> = { abriu: 'Abriu', escalou: 'Sem solução', lembrou: 'Lembrete', resolveu: 'Resolvido' };
const MOTIVO: Record<string, string> = {
  fora_da_janela_de_24h: 'fora das 24 horas do WhatsApp',
  fora_da_janela_e_sem_modelo: 'fora das 24 horas, e o modelo da Meta ainda não aprovado',
  ninguem_ligado: 'ninguém ligou o WhatsApp ao Mister',
  sem_gerente_ligado_foi_ao_presidente: 'sem gerente ligado: foi ao presidente',
  desligado: 'o Mister está desligado nesta nuvem',
  sem_numero: 'o número do Mister não está conectado',
  modelo_nao_aprovado: 'o modelo da Meta ainda não está aprovado',
  chega_na_proxima_entrega: 'ainda não chegava a este destino',
};

export interface PassoDaTrilha {
  fase: string;
  em: string;
  destino: string;
  ok: boolean;
  /** "pelo modelo da Meta, fora das 24 horas", o motivo de não ter saído… */
  nota: string | null;
}

/** O destino como a trilha mostra: o WhatsApp com os 4 últimos dígitos. Pura. */
export function nomeNaTrilha(e: { destino?: unknown; final?: unknown }): string {
  const d = String(e.destino ?? '') as Destino;
  const nome = NOME_DO_DESTINO[d] ?? String(e.destino ?? '');
  return (d === 'presidente' || d === 'gerente') && e.final ? `${nome} (••${String(e.final).slice(-4)})` : nome;
}

/** A trilha do aviso, na ordem. Pura. */
export function trilhaDoAviso(entregas: unknown): PassoDaTrilha[] {
  return (Array.isArray(entregas) ? entregas : []).map((e: any) => ({
    fase: FASE[String(e?.fase)] ?? String(e?.fase ?? ''),
    em: String(e?.em ?? ''),
    destino: nomeNaTrilha(e ?? {}),
    ok: e?.ok === true,
    nota: e?.via === 'modelo' ? 'pelo modelo da Meta, fora das 24 horas' : e?.motivo ? (MOTIVO[String(e.motivo)] ?? String(e.motivo)) : null,
  }));
}

/** Para onde o aviso foi (os destinos que receberam, sem repetir). Pura. */
export function foiPara(entregas: unknown): string[] {
  const vistos = new Set<string>();
  for (const e of Array.isArray(entregas) ? entregas : []) if ((e as any)?.ok === true) vistos.add(nomeNaTrilha(e as any));
  return [...vistos];
}

/** O texto da busca, para o `ilike` (sem curinga do usuário). */
const termo = (busca: unknown) => String(busca ?? '').trim().slice(0, 80).replace(/[\\%_]/g, (c) => `\\${c}`);

@Injectable()
export class MisterAvisosHistoricoService {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDB) {}

  /** Mister › Histórico: os avisos da empresa. `dias` 1 = hoje, 7, 30. */
  async historico(tenantId: string, filtros: { situacao?: unknown; busca?: unknown; grupo?: unknown; dias?: unknown }) {
    const situacao: SituacaoDoFiltro = (SITUACOES as readonly string[]).includes(String(filtros.situacao)) ? (filtros.situacao as SituacaoDoFiltro) : 'todos';
    const dias = Number(filtros.dias ?? 7);
    if (!(PERIODOS_DO_HISTORICO as readonly number[]).includes(dias)) throw new BadRequestException('O período é hoje, 7 ou 30 dias.');
    const grupo = filtros.grupo ? String(filtros.grupo) : '';
    if (grupo && !GRUPOS.includes(grupo as any)) throw new BadRequestException('Grupo de aviso desconhecido.');
    const tipos = grupo ? TIPOS_DE_AVISO.filter((t) => t.grupo === grupo).map((t) => t.tipo) : [];
    const hoje = hojeISO();
    const t = termo(filtros.busca);
    // Os abertos aparecem sempre; os resolvidos, pela abertura no período (no horário da loja).
    const base = sql`
      from mister_aviso a
     where a.tenant_id = ${tenantId}::uuid
       and (a.situacao = 'aberto' or ${noPeriodo('a.aberto_em', `${somarDias(hoje, -(dias - 1))} 00:00:00`, `${hoje} 23:59:59`)})
       ${tipos.length ? sql`and a.tipo in (${sql.join(tipos.map((x) => sql`${x}`), sql`, `)})` : sql``}
       ${t ? sql`and a.titulo ilike ${`%${t}%`}` : sql``}`;
    const [c] = linhas(
      await this.db.execute(sql`
        select count(*)::int as todos, count(*) filter (where a.situacao = 'aberto')::int as aberto,
               count(*) filter (where a.situacao = 'resolvido')::int as resolvido
          ${base}`),
    );
    const lidos = linhas(
      await this.db.execute(sql`
        select a.id::text as id, a.tipo, a.titulo, a.detalhe, a.situacao, a.entregas, a.dados ->> 'fechou' as fechou,
               ${iso('a.aberto_em')} as "abertoEm", ${iso('a.resolvido_em')} as "resolvidoEm", ${iso('a.escalado_em')} as "escaladoEm"
          ${base} ${situacao === 'todos' ? sql`` : sql`and a.situacao = ${situacao}`}
         order by (a.situacao = 'aberto') desc, a.aberto_em desc
         limit ${AVISOS_NO_HISTORICO_MAX}`),
    );
    const grupoDe = new Map(TIPOS_DE_AVISO.map((x) => [x.tipo as string, x.grupo as string]));
    return {
      contagens: { todos: Number(c?.todos) || 0, aberto: Number(c?.aberto) || 0, resolvido: Number(c?.resolvido) || 0 },
      limite: AVISOS_NO_HISTORICO_MAX,
      avisos: lidos.map((l) => ({
        id: l.id,
        grupo: grupoDe.get(String(l.tipo)) ?? 'Na loja',
        titulo: String(l.titulo),
        detalhe: l.detalhe ? String(l.detalhe) : null,
        situacao: l.situacao === 'aberto' ? 'aberto' : 'resolvido',
        /** Fechou porque o tipo ou o módulo foi desligado (não porque resolveu). */
        fechouDesligado: l.fechou === 'desligado',
        abertoEm: String(l.abertoEm),
        resolvidoEm: l.resolvidoEm ? String(l.resolvidoEm) : null,
        escaladoEm: l.escaladoEm ? String(l.escaladoEm) : null,
        foiPara: foiPara(l.entregas),
        trilha: trilhaDoAviso(l.entregas),
      })),
    };
  }

  /** Console › Avisos: os avisos para o suporte da DMS, de todas as empresas. `situacao`: abertos ou resolvidos nas 24 h. */
  async paraOSuporte(filtros: { situacao?: unknown; busca?: unknown }) {
    const resolvidos = filtros.situacao === 'resolvidos';
    const t = termo(filtros.busca);
    const base = sql`
      from mister_aviso a
      join empresa emp on emp.id = a.tenant_id and emp.deleted_at is null
      left join unidade u on u.id = a.unidade_id and u.tenant_id = a.tenant_id
     where a.entregas @> '[{"destino":"dms"}]'::jsonb
       ${t ? sql`and emp.nome ilike ${`%${t}%`}` : sql``}`;
    const [c] = linhas(
      await this.db.execute(sql`
        select count(*) filter (where a.situacao = 'aberto')::int as abertos,
               count(*) filter (where a.situacao = 'resolvido' and a.resolvido_em > now() - interval '24 hours')::int as resolvidos
          ${base}`),
    );
    const lidos = linhas(
      await this.db.execute(sql`
        select a.id::text as id, emp.nome as empresa, u.nome as loja, a.titulo, a.situacao,
               ${iso('a.aberto_em')} as "abertoEm", ${iso('a.resolvido_em')} as "resolvidoEm", (a.escalado_em is not null) as escalado
          ${base}
           and ${resolvidos ? sql`a.situacao = 'resolvido' and a.resolvido_em > now() - interval '24 hours'` : sql`a.situacao = 'aberto'`}
         order by ${resolvidos ? sql`a.resolvido_em desc` : sql`a.aberto_em`}
         limit ${AVISOS_NO_HISTORICO_MAX}`),
    );
    return {
      contagens: { abertos: Number(c?.abertos) || 0, resolvidos: Number(c?.resolvidos) || 0 },
      limite: AVISOS_NO_HISTORICO_MAX,
      avisos: lidos.map((l) => ({
        id: l.id,
        empresa: String(l.empresa),
        loja: l.loja ? String(l.loja) : null,
        // O título dos avisos começa pela loja ("Loja Centro · …"): a coluna Loja já diz.
        aviso: String(l.titulo).includes(' · ') ? String(l.titulo).slice(String(l.titulo).indexOf(' · ') + 3) : String(l.titulo),
        situacao: l.situacao === 'aberto' ? 'aberto' : 'resolvido',
        escalado: l.escalado === true,
        abertoEm: String(l.abertoEm),
        resolvidoEm: l.resolvidoEm ? String(l.resolvidoEm) : null,
      })),
    };
  }
}
