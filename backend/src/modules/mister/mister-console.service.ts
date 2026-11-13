import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { hojeISO } from '../../common/data';
import { IaEmpresaService } from '../ia/ia-empresa.service';
import { custoEstimadoUsd, periodoDoUso } from '../ia/ia.regras';
import { Autor, MisterNumeroService } from './mister-numero.service';
import { SituacaoDaEmpresa, situacaoDaEmpresa } from './mister.regras';

/* eslint-disable @typescript-eslint/no-explicit-any */

// O MISTER NO CONSOLE DA DISTRIBUIÇÃO (mig 417): o número, a chave geral e as empresas.
//  • O console vê a SITUAÇÃO e o VOLUME de cada empresa: se o módulo está ligado, de onde vem a IA, quantas pessoas
//    ligaram o WhatsApp e quanto a IA custou em 30 dias. Nunca a chave de IA (nem os 4 últimos caracteres), o telefone
//    de ninguém ou o que foi conversado.
//  • A lista é uma consulta só (nada de laço por empresa), com busca e teto de linhas.
//  • Duas leituras separadas: o número (que pergunta à Meta como ela o vê) e as empresas. A busca da lista não vai à Meta.

const linhas = (r: any) => (r?.rows ?? r ?? []) as any[];
const MODULO = 'mister';
export const EMPRESAS_NO_PAINEL = 200;

export interface EmpresaNoPainel {
  tenantId: string;
  nome: string;
  modulo: boolean;
  ia: { origem: 'propria' | 'incluida' | null; provedor: string | null };
  pessoas: number;
  /** O custo estimado da IA da empresa em 30 dias (todos os recursos); null = há modelo sem preço na tabela. */
  usoUsd: number | null;
  situacao: SituacaoDaEmpresa;
  motivo: string | null;
}

@Injectable()
export class MisterConsoleService {
  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly numero: MisterNumeroService,
    private readonly ia: IaEmpresaService,
  ) {}

  /** O número como a Meta o vê agora, a chave geral e o que a janela da Meta precisa para abrir. */
  async painel() {
    let n = await this.numero.ler();
    const meta = await this.numero.naMeta(n);
    // A leitura na Meta pode ter descoberto que o número caiu: o painel mostra o estado já corrigido.
    if (n.situacao === 'conectado' && !meta.lido) n = await this.numero.ler();
    return {
      numero: {
        situacao: n.situacao,
        numero: n.numero,
        nome: n.nome,
        forma: n.forma,
        motivo: n.motivo,
        conectadoEm: n.conectadoEm,
        situacaoEm: n.situacaoEm,
        ultimaEntradaEm: n.ultimaEntradaEm,
        qualidade: meta.qualidade,
        avisosPorDia: meta.avisosPorDia,
      },
      liberado: n.ligado,
      cadastro: this.numero.cadastroNaMeta(),
    };
  }

  /** As empresas com o Mister, as com o módulo ligado primeiro. `busca` filtra pelo nome; a lista tem teto de linhas. */
  async empresas(busca?: unknown): Promise<{ empresas: EmpresaNoPainel[]; total: number; limite: number }> {
    const termo = String(busca ?? '').trim().slice(0, 80);
    const filtro = termo ? sql`and e.nome ilike ${`%${termo.replace(/[\\%_]/g, (c) => `\\${c}`)}%`}` : sql``;
    const lidas = linhas(
      await this.db.execute(sql`
        select e.id as "tenantId", e.nome,
               coalesce(m.ligado, false) as modulo,
               k.provedor, k.situacao as "chaveSituacao",
               coalesce(v.pessoas, 0)::int as pessoas,
               count(*) over ()::int as total
          from empresa e
          left join (select tenant_id, bool_or(ativo) as ligado from modulo_ativacao where modulo = ${MODULO} group by tenant_id) m on m.tenant_id = e.id
          left join ia_credencial k on k.tenant_id = e.id
          left join (select tenant_id, count(*) as pessoas from mister_vinculo where telefone is not null and ligado_em is not null group by tenant_id) v
                 on v.tenant_id = e.id
         where e.deleted_at is null ${filtro}
         order by coalesce(m.ligado, false) desc, e.nome, e.id
         limit ${EMPRESAS_NO_PAINEL}`),
    );
    if (!lidas.length) return { empresas: [], total: 0, limite: EMPRESAS_NO_PAINEL };

    // O uso da IA em 30 dias, de todas as empresas da página numa consulta: soma por empresa e modelo; o preço é por modelo.
    const periodo = periodoDoUso(undefined, undefined, hojeISO()) as { de: string; ate: string };
    const ids = lidas.map((l) => String(l.tenantId));
    const usos = linhas(
      await this.db.execute(sql`
        select tenant_id as "tenantId", modelo,
               sum(tokens_entrada)::float8 as entrada, sum(tokens_cache_escrita)::float8 as "cacheEscrita",
               sum(tokens_cache_leitura)::float8 as "cacheLeitura", sum(tokens_saida)::float8 as saida
          from ia_uso_dia
         where tenant_id in (${sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `)}) and dia between ${periodo.de}::date and ${periodo.ate}::date
         group by tenant_id, modelo`),
    );
    const custo = new Map<string, number | null>();
    for (const u of usos) {
      const id = String(u.tenantId);
      const c = custoEstimadoUsd(String(u.modelo), {
        entrada: Number(u.entrada) || 0,
        cacheEscrita: Number(u.cacheEscrita) || 0,
        cacheLeitura: Number(u.cacheLeitura) || 0,
        saida: Number(u.saida) || 0,
      });
      const ate = custo.has(id) ? custo.get(id)! : 0;
      // Modelo sem preço na tabela: o total da empresa fica sem valor (nunca um preço inventado).
      custo.set(id, c === null || ate === null ? null : Math.round((ate + c) * 1_000_000) / 1_000_000);
    }

    const incluida = this.ia.iaIncluidaDisponivel();
    const empresas = lidas.map((l): EmpresaNoPainel => {
      const propria = !!l.provedor;
      const pessoas = Number(l.pessoas) || 0;
      const modulo = l.modulo === true;
      const s = situacaoDaEmpresa({ modulo, temIa: propria || incluida, chaveSituacao: propria ? String(l.chaveSituacao ?? '') : null, pessoas });
      const id = String(l.tenantId);
      return {
        tenantId: id,
        nome: String(l.nome),
        modulo,
        ia: { origem: propria ? 'propria' : incluida ? 'incluida' : null, provedor: propria ? String(l.provedor) : null },
        pessoas,
        usoUsd: custo.has(id) ? custo.get(id)! : 0,
        situacao: s.situacao,
        motivo: s.motivo,
      };
    });
    return { empresas, total: Number(lidas[0].total) || empresas.length, limite: EMPRESAS_NO_PAINEL };
  }

  conectar(dto: unknown, autor: Autor) {
    return this.numero.conectar(dto, autor);
  }

  desconectar(autor: Autor) {
    return this.numero.desconectar(autor);
  }

  liberacao(dto: unknown, autor: Autor) {
    return this.numero.liberacao(dto, autor);
  }
}
