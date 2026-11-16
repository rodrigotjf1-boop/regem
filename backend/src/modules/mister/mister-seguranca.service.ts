import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { FUSO_SQL } from '../../common/fuso-sql';
import { ehConsulta } from './mister-agente.regras';
import { periodoDaQualidade } from './mister-qualidade';
import { DESFECHOS_DA_SEGURANCA, NOTA_NA_SEGURANCA, pedeAtencao } from './mister-seguranca';

/* eslint-disable @typescript-eslint/no-explicit-any */

// A SEGURANÇA DO MISTER (o Sentinela, parte 1): o que as proteções barraram ou recusaram, em TODAS as empresas, para o
// console da distribuição (Diretoria). Só contagens do que o servidor já anota — `mister_mensagem.desfecho` (30 dias,
// sem o texto), `mister_pergunta.conferencia` (as notas do filtro de saída) e `motivo` — nunca o telefone (só quantos
// telefones), o texto, o código digitado ou o que a consulta trouxe. Cada bloco é UMA consulta agregada.

const linhas = (r: any) => (r?.rows ?? r ?? []) as any[];
const semTabela = (e: any) => e?.code === '42P01' || e?.cause?.code === '42P01';
const NOTAS = sql`case when jsonb_typeof(p.conferencia) = 'array' then p.conferencia else '[]'::jsonb end`;
const TRILHA = sql`case when jsonb_typeof(p.ferramentas) = 'array' then p.ferramentas else '[]'::jsonb end`;

@Injectable()
export class MisterSegurancaService {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDB) {}

  async resumo(diasPedidos?: unknown) {
    const dias = periodoDaQualidade(diasPedidos);
    const desde = sql`now() - make_interval(days => ${dias})`;
    const desfechos = sql.join(DESFECHOS_DA_SEGURANCA.map((d) => sql`${d}`), sql`, `);

    // Na entrada: cada desfecho das proteções, com quantos telefones (nunca quais).
    let entrada: any[] = [];
    let porEmpresaEntrada: any[] = [];
    let telefones = { codigo: 0, naoLigado: 0 };
    try {
      // Os telefones distintos de cada grupo (o mesmo telefone em dois desfechos conta uma vez).
      const [t] = linhas(
        await this.db.execute(sql`
          select count(distinct telefone) filter (where desfecho in ('codigo_nao_vale', 'codigos_demais', 'codigo_calado'))::int as codigo,
                 count(distinct telefone) filter (where desfecho in ('fixa', 'fixa_calada'))::int as "naoLigado"
            from mister_mensagem
           where recebida_em > ${desde}`),
      );
      telefones = { codigo: Number(t?.codigo) || 0, naoLigado: Number(t?.naoLigado) || 0 };
      entrada = linhas(
        await this.db.execute(sql`
          select desfecho, count(*)::int as n, count(distinct telefone)::int as telefones
            from mister_mensagem
           where recebida_em > ${desde} and desfecho in (${desfechos})
           group by desfecho`),
      );
      porEmpresaEntrada = linhas(
        await this.db.execute(sql`
          select tenant_id::text as "tenantId",
                 count(*) filter (where desfecho = 'sem_acesso')::int as "perdeuOAcesso",
                 count(*) filter (where desfecho = 'numero_de_outra_pessoa')::int as "outraPessoa"
            from mister_mensagem
           where recebida_em > ${desde} and tenant_id is not null and desfecho in ('sem_acesso', 'numero_de_outra_pessoa')
           group by tenant_id`),
      );
    } catch (e: any) {
      if (!semTabela(e)) throw e;
    }

    // Na saída: as notas do filtro, o limite e os segredos tirados (com a consulta, a empresa e a hora).
    let notas: any[] = [];
    let limite = 0;
    let segredos: any[] = [];
    let porEmpresaSaida: any[] = [];
    try {
      notas = linhas(
        await this.db.execute(sql`
          select nota, count(*)::int as n
            from mister_pergunta p cross join lateral jsonb_array_elements_text(${NOTAS}) nota
           where p.criado_em > ${desde}
           group by nota`),
      );
      const [l] = linhas(await this.db.execute(sql`select count(*)::int as n from mister_pergunta where criado_em > ${desde} and motivo = 'limite'`));
      limite = Number(l?.n) || 0;
      segredos = linhas(
        await this.db.execute(sql`
          select emp.nome as empresa, to_char(p.criado_em at time zone ${FUSO_SQL}, 'DD/MM HH24:MI') as quando,
                 (select coalesce(jsonb_agg(distinct f ->> 'nome'), '[]'::jsonb) from jsonb_array_elements(${TRILHA}) f where (f ->> 'ok')::boolean) as consultas
            from mister_pergunta p
            join empresa emp on emp.id = p.tenant_id
           where p.criado_em > ${desde} and ${NOTAS} ? 'segredo'
           order by p.criado_em desc
           limit 3`),
      );
      porEmpresaSaida = linhas(
        await this.db.execute(sql`
          select p.tenant_id::text as "tenantId",
                 count(*) filter (where jsonb_array_length(${NOTAS}) > 0)::int as filtro,
                 count(*) filter (where ${NOTAS} ? 'segredo')::int as segredos,
                 count(*) filter (where p.motivo = 'limite')::int as limite
            from mister_pergunta p
           where p.criado_em > ${desde} and (jsonb_array_length(${NOTAS}) > 0 or p.motivo = 'limite')
           group by p.tenant_id`),
      );
    } catch (e: any) {
      if (!semTabela(e)) throw e;
    }

    // Os links com PIN bloqueados (F4.2a, mig 433): o quinto PIN errado bloqueou o link. Só a contagem e quantas empresas.
    let linksComPin = { bloqueados: 0, empresas: 0 };
    try {
      const [l] = linhas(
        await this.db.execute(sql`
          select count(*)::int as bloqueados, count(distinct tenant_id)::int as empresas from mister_proposta where bloqueada_em >= ${desde}`),
      );
      linksComPin = { bloqueados: Number(l?.bloqueados) || 0, empresas: Number(l?.empresas) || 0 };
    } catch (e: any) {
      // Sem a tabela (servidor da loja) ou sem a coluna (antes da 433): zero.
      if (!semTabela(e) && e?.code !== '42703' && e?.cause?.code !== '42703') throw e;
    }

    // Os nomes das empresas da lista — uma consulta, pela lista.
    const ids = [...new Set([...porEmpresaEntrada, ...porEmpresaSaida].map((e) => String(e.tenantId)))];
    const nomes = new Map<string, string>();
    if (ids.length) {
      const lidas = linhas(await this.db.execute(sql`select e.id::text as id, e.nome from unnest(${`{${ids.join(',')}}`}::uuid[]) as l(id) join empresa e on e.id = l.id`));
      for (const e of lidas) nomes.set(String(e.id), String(e.nome ?? ''));
    }

    const da = (d: string) => entrada.find((x) => x.desfecho === d) ?? { n: 0, telefones: 0 };
    const somar = (...ds: string[]) => ds.reduce((s, d) => s + (Number(da(d).n) || 0), 0);
    const nota = (n: string) => Number(notas.find((x) => x.nota === n)?.n) || 0;
    const totalDeSegredos = nota('segredo');
    const calados = Number(da('codigos_demais').telefones) || 0;

    const porEmpresa = ids
      .map((id) => {
        const e = porEmpresaEntrada.find((x) => String(x.tenantId) === id);
        const s = porEmpresaSaida.find((x) => String(x.tenantId) === id);
        return {
          empresa: nomes.get(id) ?? '',
          filtro: Number(s?.filtro) || 0,
          segredos: Number(s?.segredos) || 0,
          perdeuOAcesso: Number(e?.perdeuOAcesso) || 0,
          outraPessoa: Number(e?.outraPessoa) || 0,
          limite: Number(s?.limite) || 0,
        };
      })
      .sort((a, b) => b.segredos - a.segredos || b.filtro + b.perdeuOAcesso + b.outraPessoa + b.limite - (a.filtro + a.perdeuOAcesso + a.outraPessoa + a.limite) || a.empresa.localeCompare(b.empresa))
      .slice(0, 50);

    return {
      dias,
      saida: (Object.keys(NOTA_NA_SEGURANCA) as Array<keyof typeof NOTA_NA_SEGURANCA>).map((n) => ({ nota: n, texto: NOTA_NA_SEGURANCA[n], quantas: nota(n) })),
      entrada: {
        codigoNaoVale: Number(da('codigo_nao_vale').n) || 0,
        codigosDemais: Number(da('codigos_demais').n) || 0,
        codigoCalado: Number(da('codigo_calado').n) || 0,
        codigoErrado: { quantas: somar('codigo_nao_vale', 'codigos_demais', 'codigo_calado'), telefones: telefones.codigo, calados },
        outraPessoa: Number(da('numero_de_outra_pessoa').n) || 0,
        perdeuOAcesso: Number(da('sem_acesso').n) || 0,
        naoLigado: { quantas: somar('fixa', 'fixa_calada'), telefones: telefones.naoLigado },
      },
      segredos: totalDeSegredos,
      limite,
      linksComPin,
      atencao: pedeAtencao(
        segredos.map((s) => ({ empresa: String(s.empresa ?? ''), quando: String(s.quando ?? ''), consultas: (Array.isArray(s.consultas) ? s.consultas : []).map(String).filter(ehConsulta) })),
        totalDeSegredos,
        calados,
      ),
      porEmpresa,
    };
  }
}
