import { BadRequestException, ConflictException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { sql, type SQL } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { hojeISO, somarDias } from '../../common/data';
import { FUSO_SQL, instanteDe } from '../../common/fuso-sql';
import { repetirNoImpasse } from '../../common/repetir-no-impasse';
import type { AuthUser } from '../../auth/auth-user';
import { normalizarTexto, resumoComSal, type Fonte } from './mascara';
import { ArquivoRecusado, lerOfx, type ExtratoOfx } from './ofx';
import { CHAVES_DE_TIPO, FONTES, SITUACOES, TIPOS, diasComLancamento, fraseDaRecusa, fraseSemLancamento, maiorBuraco, prepararLinhas, situacaoDoTipo, type LancamentoPreparado, type Situacao } from './banco-repasses.regras';

/* eslint-disable @typescript-eslint/no-explicit-any */

// FINANCEIRO › BANCO E REPASSES (R1 da versão 8 do Mister; protótipo `mockups/regem-mister-v8.html`, aba "Na loja"; mig 499).
// Importar o extrato em OFX, listar, filtrar e dizer o que cada lançamento é. Só o presidente (V8-2: o controller recusa) e só
// na nuvem. A descrição crua e o número da conta NUNCA vão ao banco, ao log, à auditoria nem à IA (V8-3): só existem na memória
// enquanto a importação roda.

const rows = (r: any): any[] => r?.rows ?? r ?? [];
const POR_VEZ = 12;
const TETO_DA_PAGINA = 100;
const TETO_DO_DESLOCAMENTO = 1_000_000;
/** Número da consulta: inteiro e não negativo, ou o padrão (`1.5` ou `1e30` no `limit` daria erro 500). */
const inteiroOu = (v: unknown, padrao: number) => {
  const n = Number(v);
  return Number.isSafeInteger(n) && n >= 0 ? n : padrao;
};
/** Sem extrato há mais que isto, o Banco deixa de estar "Em dia" na faixa das fontes. */
const DIAS_EM_DIA = 7;
const NOVOS_NA_CONFERENCIA = 20;

export type CasoDoArquivo = 'ok' | 'repetido' | 'outra_conta' | 'nao_abre' | 'buraco';

export interface Filtros {
  /** `ultimo` = o mês do último extrato (quando `de` e `ate` não vêm). */
  periodo?: string;
  de?: string;
  ate?: string;
  situacao?: string;
  fonte?: string;
  busca?: string;
  limite?: string | number;
  deslocamento?: string | number;
}

const dataValida = (d: unknown): d is string =>
  typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(`${d}T12:00:00Z`)) && new Date(`${d}T12:00:00Z`).toISOString().slice(0, 10) === d;

@Injectable()
export class BancoRepassesService {
  private readonly log = new Logger(BancoRepassesService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly auditoria: AuditoriaService,
  ) {}

  // ── qual loja ────────────────────────────────────────────────────────────────────────────────────────────────────

  /**
   * A loja do extrato. Com "todas as lojas" numa empresa de várias, recusa: a conta é de uma loja (V86). Numa empresa de uma
   * loja, a sessão chega sem loja e é ela. A loja do cabeçalho é conferida na empresa.
   */
  private async lojaDoExtrato(tenantId: string, atual: string | null): Promise<string> {
    const lojas = rows(await this.db.execute(sql`select id from unidade where tenant_id = ${tenantId} and deleted_at is null`));
    if (atual) {
      if (!lojas.some((l) => l.id === atual)) throw new BadRequestException('Essa loja não é da sua empresa.');
      return atual;
    }
    if (lojas.length === 1) return lojas[0].id as string;
    if (!lojas.length) throw new BadRequestException('Cadastre a loja antes de importar o extrato.');
    throw new BadRequestException('Escolha a loja no topo da tela: cada loja tem a própria conta.');
  }

  // ── ler o arquivo ────────────────────────────────────────────────────────────────────────────────────────────────

  private lerArquivo(buf: Buffer): { extrato: ExtratoOfx } | { recusa: string } {
    try {
      const extrato = lerOfx(buf);
      if (!diasComLancamento(extrato).length) return { recusa: fraseSemLancamento(extrato.recusadas) };
      return { extrato };
    } catch (e) {
      if (e instanceof ArquivoRecusado) return { recusa: fraseDaRecusa(e.motivo) };
      throw e;
    }
  }

  /** Em quantos dias do trecho a loja vendeu: é o que separa "o banco cortou o arquivo" de "a loja estava fechada". */
  private async diasComVenda(tenantId: string, unidadeId: string, de: string, ate: string): Promise<number> {
    const r = rows(
      await this.db.execute(sql`
        select count(distinct (fechada_em at time zone ${FUSO_SQL})::date)::int as n
          from comanda
         where tenant_id = ${tenantId}
           and (unidade_id = ${unidadeId} or unidade_id is null)
           and status = 'fechada'
           and fechada_em >= ${instanteDe(`${de} 00:00:00`)}
           and fechada_em < ${instanteDe(`${somarDias(ate, 1)} 00:00:00`)}`),
    );
    return Number(r[0]?.n ?? 0);
  }

  /** O maior trecho sem lançamento, se a loja vendeu nele. A mesma conta no passo 2 e no passo 3 (V74). */
  private async buracoComVenda(tenantId: string, unidadeId: string, extrato: ExtratoOfx): Promise<{ de: string; ate: string } | null> {
    const b = maiorBuraco(diasComLancamento(extrato), extrato.periodoDe, extrato.periodoAte);
    if (!b) return null;
    return (await this.diasComVenda(tenantId, unidadeId, b.de, b.ate)) > 0 ? { de: b.de, ate: b.ate } : null;
  }

  // ── passo 2: conferir (não grava nada) ───────────────────────────────────────────────────────────────────────────

  async conferir(tenantId: string, atual: string | null, buf: Buffer) {
    const lido = this.lerArquivo(buf);
    if ('recusa' in lido) return { caso: 'nao_abre' as CasoDoArquivo, motivo: lido.recusa };
    const { extrato } = lido;
    const unidadeId = await this.lojaDoExtrato(tenantId, atual);

    const conta = rows(await this.db.execute(sql`select id, banco, final from banco_conta where tenant_id = ${tenantId} and unidade_id = ${unidadeId}`))[0];
    const contaDoArquivo = { banco: extrato.banco, final: extrato.finalDaConta };
    if (conta && (conta.final !== extrato.finalDaConta || conta.banco !== extrato.banco)) {
      return { caso: 'outra_conta' as CasoDoArquivo, conta: contaDoArquivo, contaDaLoja: { banco: conta.banco as string, final: conta.final as string } };
    }

    // O sal só é criado ao gravar. Sem ele ainda não há lançamento nenhum: um sal de passagem basta para contar as linhas.
    const salGravado = rows(await this.db.execute(sql`select sal from banco_empresa where tenant_id = ${tenantId}`))[0]?.sal as string | undefined;
    const sal = salGravado ?? randomBytes(32).toString('hex');
    const { lancamentos, informativas } = prepararLinhas(sal, extrato);

    const jaTem = new Set<string>();
    if (conta && lancamentos.length) {
      const achadas = rows(
        await this.db.execute(sql`
          select l.chave
            from jsonb_to_recordset(${JSON.stringify(lancamentos.map((x) => ({ chave: x.chave })))}::jsonb) as x(chave text)
            join banco_lancamento l on l.conta_id = ${conta.id} and l.chave = x.chave`),
      );
      for (const a of achadas) jaTem.add(a.chave as string);
    }
    const novos = lancamentos.filter((x) => !jaTem.has(x.chave));

    const arquivoHash = salGravado ? resumoComSal(salGravado, buf) : null;
    const anterior = conta && arquivoHash
      ? rows(await this.db.execute(sql`
          select min(criado_em) as em from banco_importacao where conta_id = ${conta.id} and arquivo_hash = ${arquivoHash}`))[0]?.em
      : null;

    const buraco = await this.buracoComVenda(tenantId, unidadeId, extrato);

    const saldoAnterior = conta ? await this.saldoAnterior(conta.id as string) : null;
    const fechamento = this.fechamento(saldoAnterior, novos, extrato);

    const caso: CasoDoArquivo = novos.length === 0 ? 'repetido' : buraco ? 'buraco' : 'ok';
    return {
      caso,
      conta: contaDoArquivo,
      periodo: { de: extrato.periodoDe, ate: extrato.periodoAte },
      total: lancamentos.length,
      jaEstavam: lancamentos.length - novos.length,
      novos: novos.length,
      recusados: extrato.recusadas,
      informativas,
      saldoFinal: extrato.saldoCentavos,
      saldoAnterior: saldoAnterior?.centavos ?? null,
      fecha: fechamento,
      entradasNovas: novos.filter((x) => x.valor > 0).reduce((s, x) => s + x.valor, 0),
      saidasNovas: -novos.filter((x) => x.valor < 0).reduce((s, x) => s + x.valor, 0),
      buraco,
      jaEntrouEm: anterior ? new Date(anterior as string).toISOString() : null,
      novosLista: novos.slice(0, NOVOS_NA_CONFERENCIA).map((x) => ({ data: x.data, descricao: x.descricao, valor: x.valor })),
    };
  }

  private async saldoAnterior(contaId: string): Promise<{ centavos: number; em: string } | null> {
    const r = rows(
      await this.db.execute(sql`
        select saldo_centavos, saldo_em::text as saldo_em
          from banco_importacao
         where conta_id = ${contaId} and saldo_centavos is not null and saldo_em is not null
         order by saldo_em desc, criado_em desc
         limit 1`),
    )[0];
    return r ? { centavos: Number(r.saldo_centavos), em: r.saldo_em as string } : null;
  }

  /**
   * "A conta fecha": saldo anterior + o que entrou de novo = saldo do arquivo. Só faz sentido com todos os novos DEPOIS do saldo
   * anterior; fora disso devolve `null` (não dá para afirmar nem que fecha nem que não fecha).
   */
  private fechamento(anterior: { centavos: number; em: string } | null, novos: LancamentoPreparado[], extrato: ExtratoOfx): boolean | null {
    if (!anterior || extrato.saldoCentavos === null || !novos.length) return null;
    if (novos.some((x) => x.data <= anterior.em)) return null;
    return anterior.centavos + novos.reduce((s, x) => s + x.valor, 0) === extrato.saldoCentavos;
  }

  // ── passo 3: gravar tudo numa transação ──────────────────────────────────────────────────────────────────────────

  async importar(user: AuthUser, atual: string | null, buf: Buffer) {
    const tenantId = user.tenantId;
    const lido = this.lerArquivo(buf);
    if ('recusa' in lido) throw new BadRequestException(`Não consegui abrir esse arquivo. ${lido.recusa} Nada foi gravado.`);
    const { extrato } = lido;
    const unidadeId = await this.lojaDoExtrato(tenantId, atual);

    // Ler o que depende do banco ANTES da transação: o trecho sem lançamento consulta as vendas, que não precisam de trava.
    const buraco = await this.buracoComVenda(tenantId, unidadeId, extrato);

    const r = await repetirNoImpasse(
      () =>
        this.db.transaction(async (tx: any) => {
          // O sal e a conta nascem aqui, com `on conflict`: dois envios juntos ficam com o mesmo sal e a mesma conta.
          await tx.execute(sql`insert into banco_empresa (tenant_id, sal) values (${tenantId}, ${randomBytes(32).toString('hex')}) on conflict (tenant_id) do nothing`);
          const sal = rows(await tx.execute(sql`select sal from banco_empresa where tenant_id = ${tenantId}`))[0].sal as string;
          await tx.execute(sql`
            insert into banco_conta (tenant_id, unidade_id, banco, final)
            values (${tenantId}, ${unidadeId}, ${extrato.banco}, ${extrato.finalDaConta})
            on conflict (tenant_id, unidade_id) do nothing`);
          const conta = rows(await tx.execute(sql`select id, banco, final from banco_conta where tenant_id = ${tenantId} and unidade_id = ${unidadeId}`))[0];
          if (conta.final !== extrato.finalDaConta || conta.banco !== extrato.banco) {
            throw new ConflictException(`Esse arquivo é da conta final ${extrato.finalDaConta}, e a loja usa a conta final ${conta.final}. Nada foi gravado.`);
          }

          const { lancamentos } = prepararLinhas(sal, extrato);
          const arquivoHash = resumoComSal(sal, buf);
          const imp = rows(
            await tx.execute(sql`
              insert into banco_importacao (tenant_id, unidade_id, conta_id, arquivo_hash, periodo_de, periodo_ate, linhas_arquivo, recusados,
                                            saldo_centavos, saldo_em, buraco_de, buraco_ate, criado_por)
              values (${tenantId}, ${unidadeId}, ${conta.id}, ${arquivoHash}, ${extrato.periodoDe}::date, ${extrato.periodoAte}::date, ${lancamentos.length}, ${extrato.recusadas},
                      ${extrato.saldoCentavos}, ${extrato.saldoEm}::date, ${buraco?.de ?? null}::date, ${buraco?.ate ?? null}::date, ${user.colaboradorId})
              returning id`),
          )[0];

          // Uma instrução só, na ordem da chave (duas importações juntas pegam as travas na mesma ordem). O índice único decide o
          // que entra: quem chegou depois não duplica.
          const ordenados = [...lancamentos].sort((a, b) => (a.chave < b.chave ? -1 : a.chave > b.chave ? 1 : 0));
          const inseridos = ordenados.length
            ? rows(
                await tx.execute(sql`
                  insert into banco_lancamento (tenant_id, unidade_id, conta_id, importacao_id, chave, data, valor_centavos, descricao, descricao_hash, fonte, situacao, tipo)
                  select ${tenantId}::uuid, ${unidadeId}::uuid, ${conta.id}::uuid, ${imp.id}::uuid, x.chave, x.data::date, x.valor, x.descricao, x.hash, x.fonte,
                         case when r.tipo = 'nao_e_da_loja' then 'nao_e_da_loja' else x.situacao end,
                         r.tipo
                    from jsonb_to_recordset(${JSON.stringify(ordenados)}::jsonb)
                         as x(chave text, data text, valor bigint, descricao text, hash text, fonte text, situacao text)
                    left join banco_regra r on r.tenant_id = ${tenantId} and r.descricao_hash = x.hash
                   order by x.chave
                  on conflict (conta_id, chave) do nothing
                  returning id`),
              )
            : [];

          if (!inseridos.length) {
            // Nada de novo: a importação não deixa rastro. Volta inteira.
            throw new SemNovidade(lancamentos.length);
          }
          await tx.execute(sql`
            update banco_importacao set novos = ${inseridos.length}, repetidos = ${lancamentos.length - inseridos.length}
             where id = ${imp.id}`);
          return { importacaoId: imp.id as string, novos: inseridos.length, repetidos: lancamentos.length - inseridos.length };
        }),
      { aoRepetir: (n) => this.log.warn(`importar extrato: impasse no banco, tentativa ${n}`) },
    ).catch((e) => {
      if (e instanceof SemNovidade) return { importacaoId: null, novos: 0, repetidos: e.linhas };
      throw e;
    });

    if (r.importacaoId) {
      await this.auditoria.registrar({
        tenantId,
        atorId: user.colaboradorId,
        atorPerfil: user.categoria,
        tipo: 'financeiro',
        acao: 'banco_importou_extrato',
        unidadeId,
        entidadeTipo: 'banco_importacao',
        entidadeId: r.importacaoId,
        detalhe: { novos: r.novos, repetidos: r.repetidos, recusados: extrato.recusadas, de: extrato.periodoDe, ate: extrato.periodoAte, incompleto: !!buraco },
      });
    }
    return { novos: r.novos, repetidos: r.repetidos, recusados: extrato.recusadas, buraco };
  }

  // ── a lista ──────────────────────────────────────────────────────────────────────────────────────────────────────

  async listar(tenantId: string, atual: string | null, f: Filtros) {
    let de = f.de ? (dataValida(f.de) ? f.de : this.recusar('de')) : null;
    let ate = f.ate ? (dataValida(f.ate) ? f.ate : this.recusar('ate')) : null;
    if (de && ate && de > ate) throw new BadRequestException('A data inicial vem depois da final.');
    // `periodo=ultimo`: o mês do último extrato, que é o que a tela abre mostrando.
    if (f.periodo === 'ultimo' && !de && !ate) {
      const m = rows(
        await this.db.execute(sql`
          select coalesce(
                   (select max(i.periodo_ate) from banco_importacao i where i.tenant_id = ${tenantId} ${atual ? sql`and i.unidade_id = ${atual}` : sql``}),
                   (select max(l.data) from banco_lancamento l where l.tenant_id = ${tenantId} ${atual ? sql`and l.unidade_id = ${atual}` : sql``})
                 )::text as ate`),
      )[0]?.ate as string | null | undefined;
      if (m) {
        de = `${m.slice(0, 7)}-01`;
        ate = somarDias(`${somarDias(`${m.slice(0, 7)}-28`, 4).slice(0, 7)}-01`, -1);
      }
    }
    const situacao = f.situacao ? ((SITUACOES as readonly string[]).includes(f.situacao) ? f.situacao : this.recusar('situacao')) : null;
    const fonte = f.fonte ? (FONTES.includes(f.fonte as Fonte) ? f.fonte : this.recusar('fonte')) : null;
    const limite = Math.min(inteiroOu(f.limite, POR_VEZ) || POR_VEZ, TETO_DA_PAGINA);
    const deslocamento = Math.min(inteiroOu(f.deslocamento, 0), TETO_DO_DESLOCAMENTO);

    const escopo: SQL = atual ? sql`l.tenant_id = ${tenantId} and l.unidade_id = ${atual}` : sql`l.tenant_id = ${tenantId}`;
    const condicoes: SQL[] = [escopo];
    if (de) condicoes.push(sql`l.data >= ${de}::date`);
    if (ate) condicoes.push(sql`l.data <= ${ate}::date`);
    if (fonte) condicoes.push(sql`l.fonte = ${fonte}`);
    const busca = normalizarTexto(String(f.busca ?? '')).slice(0, 80);
    if (busca) {
      const curinga = `%${busca.replace(/[\\%_]/g, '\\$&')}%`;
      const tipos = TIPOS.filter((t) => normalizarTexto(t.rotulo).includes(busca)).map((t) => t.chave as string);
      const porTipo = tipos.length ? sql` or l.tipo in (${sql.join(tipos.map((t) => sql`${t}`), sql`, `)})` : sql``;
      condicoes.push(sql`(l.descricao ilike ${curinga}${porTipo})`);
    }
    const base = sql.join(condicoes, sql` and `);
    const comSituacao = situacao ? sql`${base} and l.situacao = ${situacao}` : base;

    const noBanco = sql`l.situacao <> 'esperado'`;
    const naSituacao = situacao ? sql`l.situacao = ${situacao}` : sql`true`;
    const [resumo, linhas, geral, contas, fontes] = await Promise.all([
      this.db.execute(sql`
        select count(*)::int as base,
               count(*) filter (where ${naSituacao})::int as filtrados,
               count(*) filter (where l.situacao = 'casado')::int as casado,
               count(*) filter (where l.situacao = 'a_conferir')::int as a_conferir,
               count(*) filter (where l.situacao = 'so_no_banco')::int as so_no_banco,
               count(*) filter (where l.situacao = 'esperado')::int as esperado,
               count(*) filter (where l.situacao = 'nao_e_da_loja')::int as nao_e_da_loja,
               coalesce(sum(l.valor_centavos) filter (where ${naSituacao} and ${noBanco} and l.valor_centavos > 0), 0)::bigint as entrou,
               coalesce(-sum(l.valor_centavos) filter (where ${naSituacao} and ${noBanco} and l.valor_centavos < 0), 0)::bigint as saiu,
               coalesce(sum(l.valor_centavos) filter (where ${naSituacao} and l.situacao = 'esperado'), 0)::bigint as valor_esperado
          from banco_lancamento l
         where ${base}`),
      this.db.execute(sql`
        select l.id, l.data::text as data, l.valor_centavos, l.descricao, l.fonte, l.situacao, l.tipo
          from banco_lancamento l
         where ${comSituacao}
         order by l.data desc, l.criado_em desc, l.id
         limit ${limite} offset ${deslocamento}`),
      this.db.execute(sql`select count(*)::int as n from banco_lancamento l where ${escopo}`),
      this.db.execute(sql`
        select c.banco, c.final, c.unidade_id,
               coalesce((select max(i.periodo_ate) from banco_importacao i where i.conta_id = c.id),
                        (select max(x.data) from banco_lancamento x where x.conta_id = c.id))::text as lido_ate,
               (select max(i.criado_em) from banco_importacao i where i.conta_id = c.id) as importado_em
          from banco_conta c
         where c.tenant_id = ${tenantId} ${atual ? sql`and c.unidade_id = ${atual}` : sql``}
         order by c.criado_em`),
      this.db.execute(sql`select distinct l.fonte from banco_lancamento l where ${escopo}`),
    ]);

    const s = rows(resumo)[0] ?? {};
    const quantas = rows(contas).map((c) => ({
      banco: c.banco as string,
      final: c.final as string,
      unidadeId: c.unidade_id as string,
      lidoAte: (c.lido_ate as string | null) ?? null,
      importadoEm: c.importado_em ? new Date(c.importado_em as string).toISOString() : null,
    }));
    const ultimo = quantas.reduce<string | null>((m, c) => (c.lidoAte && (!m || c.lidoAte > m) ? c.lidoAte : m), null);
    const emDia = !!ultimo && ultimo >= somarDias(hojeISO(), -DIAS_EM_DIA);

    return {
      periodo: { de, ate },
      contas: quantas,
      fontes: {
        banco: { situacao: ultimo ? (emDia ? 'em_dia' : 'antigo') : 'nunca', lidoAte: ultimo },
        comDado: rows(fontes).map((x) => x.fonte as string).filter((x) => FONTES.includes(x as Fonte)),
      },
      total: Number(rows(geral)[0]?.n ?? 0),
      base: Number(s.base ?? 0),
      filtrados: Number(s.filtrados ?? 0),
      contagem: {
        casado: Number(s.casado ?? 0),
        a_conferir: Number(s.a_conferir ?? 0),
        so_no_banco: Number(s.so_no_banco ?? 0),
        esperado: Number(s.esperado ?? 0),
        nao_e_da_loja: Number(s.nao_e_da_loja ?? 0),
      },
      totais: {
        entrou: Number(s.entrou ?? 0),
        saiu: Number(s.saiu ?? 0),
        diferenca: Number(s.entrou ?? 0) - Number(s.saiu ?? 0),
        esperado: Number(s.valor_esperado ?? 0),
      },
      lista: rows(linhas).map((l) => ({
        id: l.id as string,
        data: l.data as string,
        valor: Number(l.valor_centavos),
        descricao: l.descricao as string,
        fonte: l.fonte as string,
        situacao: l.situacao as Situacao,
        tipo: (l.tipo as string | null) ?? null,
      })),
      tipos: TIPOS,
    };
  }

  private recusar(campo: string): never {
    throw new BadRequestException(`Filtro inválido: ${campo}.`);
  }

  // ── "Isso é o quê?" ──────────────────────────────────────────────────────────────────────────────────────────────

  async classificar(user: AuthUser, atual: string | null, id: string, dto: { tipo?: string | null; lembrar?: boolean }) {
    const tenantId = user.tenantId;
    if (dto.tipo !== undefined && dto.tipo !== null && !CHAVES_DE_TIPO.includes(dto.tipo)) throw new BadRequestException('Escolha um dos tipos da lista.');
    const lembrar = dto.lembrar === true;

    const r = await this.db.transaction(async (tx: any) => {
      const atualRow = rows(
        await tx.execute(sql`
          select id, unidade_id, fonte, tipo, situacao, descricao_hash
            from banco_lancamento
           where id = ${id} and tenant_id = ${tenantId} ${atual ? sql`and unidade_id = ${atual}` : sql``}
           for update`),
      )[0];
      if (!atualRow) throw new NotFoundException('Lançamento não encontrado.');

      // Ausente mantém (V16). Casado e Esperado (R3/R4) não mudam de situação por aqui.
      const tipo = dto.tipo === undefined ? ((atualRow.tipo as string | null) ?? null) : dto.tipo;
      if (lembrar && !tipo) throw new BadRequestException('Escolha o tipo para lembrar nos próximos.');
      const fixa = atualRow.situacao === 'casado' || atualRow.situacao === 'esperado';
      const situacao: Situacao = fixa ? (atualRow.situacao as Situacao) : situacaoDoTipo(tipo, atualRow.fonte as Fonte);

      const salvo = rows(
        await tx.execute(sql`
          update banco_lancamento
             set tipo = ${tipo}, situacao = ${situacao}, classificado_por = ${user.colaboradorId}, classificado_em = clock_timestamp()
           where id = ${id} and tenant_id = ${tenantId}
           returning id, data::text as data, valor_centavos, descricao, fonte, situacao, tipo`),
      )[0];

      if (lembrar) {
        await tx.execute(sql`
          insert into banco_regra (tenant_id, descricao_hash, tipo, criado_por)
          values (${tenantId}, ${atualRow.descricao_hash}, ${tipo}, ${user.colaboradorId})
          on conflict (tenant_id, descricao_hash) do update set tipo = excluded.tipo, atualizado_em = clock_timestamp()`);
      }
      return { salvo, unidadeId: atualRow.unidade_id as string, antes: (atualRow.tipo as string | null) ?? null };
    });

    await this.auditoria.registrar({
      tenantId,
      atorId: user.colaboradorId,
      atorPerfil: user.categoria,
      tipo: 'financeiro',
      acao: 'banco_classificou_lancamento',
      unidadeId: r.unidadeId,
      entidadeTipo: 'banco_lancamento',
      entidadeId: id,
      detalhe: { de: r.antes, para: r.salvo.tipo ?? null, lembrar },
    });

    return {
      id: r.salvo.id as string,
      data: r.salvo.data as string,
      valor: Number(r.salvo.valor_centavos),
      descricao: r.salvo.descricao as string,
      fonte: r.salvo.fonte as string,
      situacao: r.salvo.situacao as Situacao,
      tipo: (r.salvo.tipo as string | null) ?? null,
      lembrado: lembrar,
    };
  }
}

/** O arquivo não trouxe nada novo: desfaz a transação inteira, sem deixar a importação registrada. */
class SemNovidade extends Error {
  constructor(readonly linhas: number) {
    super('sem novidade');
  }
}
