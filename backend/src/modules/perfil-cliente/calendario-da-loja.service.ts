import { BadRequestException, Inject, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { hojeISO } from '../../common/data';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { AuthUser } from '../../auth/auth-user';
import {
  GrupoDoEvento,
  NOME_DO_TIPO,
  diaValido,
  diasEntre,
  eventosDaRegra,
  lerEventoDaLoja,
  ocorrencias,
  somarDias,
} from './calendario-regra';

/* eslint-disable @typescript-eslint/no-explicit-any */

// O CALENDÁRIO DA LOJA (F2 do docs/plano-perfil-cliente.md, mig 461). Junta três fontes, sem duplicar nenhuma:
//  • a regra fixa (`calendario-regra.ts`): feriados por lei, pontos facultativos, comemorativas e dinheiro no bolso;
//  • o que a loja cadastra aqui (`evento_loja`): show, promoção da casa, feriado municipal, jogo do time, outro;
//  • os feriados e eventos de Escalas › Feriado / evento (`dia_especial`, os da loja inteira — sem colaborador): a loja
//    não cadastra o feriado da cidade duas vezes.
// Loja: a do usuário (`@UnidadeAtual()`) vê os dela e os sem loja (V4); "todas as lojas" vê tudo da empresa. Datas pelo
// `hojeISO()` (V46). A rotina noturna do perfil grava a cópia por loja e dia (`calendario_loja_dia`) — o que as fases
// seguintes cruzam com os pedidos.

export type ItemDoCalendario = {
  chave: string;
  dia: string;
  grupo: GrupoDoEvento;
  tipo: string;
  nome: string;
  detalhe: string;
  origem: 'regra' | 'loja' | 'escala';
  confianca?: 'lei' | 'costume';
  /** Só do evento da loja: o que a tela edita. */
  id?: string;
  hora?: string | null;
  repete?: string;
  diaDoCadastro?: string;
  unidadeId?: string | null;
  unidadeNome?: string | null;
  /** Quem lê pode editar/excluir (o evento da loja dele; o de "todas as lojas" só quem vê todas). */
  podeEditar?: boolean;
};

/** No máximo 120 dias por leitura da tela (a rotina noturna lê mais, em partes). */
const MAX_DIAS_TELA = 120;
/** A cópia por loja: 400 dias para trás (o cálculo do efeito precisa do histórico) e 60 para a frente. */
const COPIA = { antes: 400, depois: 60 };
const ORDEM_ORIGEM = { regra: 0, escala: 1, loja: 2 } as const;

@Injectable()
export class CalendarioDaLojaService {
  private readonly log = new Logger(CalendarioDaLojaService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    @Optional() private readonly auditoria?: AuditoriaService,
  ) {}

  private rows(r: any): any[] {
    return r?.rows ?? r ?? [];
  }

  /** O período da tela: de hoje (Brasília) a 60 dias, se não vier; até 120 dias. */
  periodo(de?: string, ate?: string): { de: string; ate: string } {
    const d = de ?? hojeISO();
    const a = ate ?? somarDias(d, 59);
    if (!diaValido(d) || !diaValido(a)) throw new BadRequestException('Período inválido (use AAAA-MM-DD).');
    if (a < d) throw new BadRequestException('O fim do período vem antes do começo.');
    if (diasEntre(d, a) >= MAX_DIAS_TELA) throw new BadRequestException(`Escolha no máximo ${MAX_DIAS_TELA} dias.`);
    return { de: d, ate: a };
  }

  /** O calendário da loja (ou de todas, com `unidadeId` nulo) entre `de` e `ate`, em ordem de dia. */
  async listar(tenantId: string, unidadeId: string | null, de: string, ate: string): Promise<ItemDoCalendario[]> {
    const daLoja = unidadeId ? sql`and (x.unidade_id = ${unidadeId}::uuid or x.unidade_id is null)` : sql``;
    const [loja, escala] = await Promise.all([
      this.db.execute(sql`
        select x.id, x.nome, x.tipo, to_char(x.dia, 'YYYY-MM-DD') as dia, to_char(x.hora, 'HH24:MI') as hora, x.repete,
               x.unidade_id, u.nome as unidade_nome
          from evento_loja x left join unidade u on u.id = x.unidade_id
         where x.tenant_id = ${tenantId}::uuid and x.excluido_em is null and x.dia <= ${ate}::date
           and (x.repete <> 'nao' or x.dia >= ${de}::date) ${daLoja}`),
      this.db.execute(sql`
        select x.id, x.nome, x.tipo, x.descricao, to_char(x.data, 'YYYY-MM-DD') as data,
               to_char(coalesce(x.data_fim, x.data), 'YYYY-MM-DD') as data_fim, x.unidade_id, u.nome as unidade_nome
          from dia_especial x left join unidade u on u.id = x.unidade_id
         where x.tenant_id = ${tenantId}::uuid and x.deleted_at is null and x.colaborador_id is null
           and x.tipo in ('feriado', 'evento') and x.data <= ${ate}::date and coalesce(x.data_fim, x.data) >= ${de}::date ${daLoja}`),
    ]);
    return this.montar(eventosDaRegra(de, ate), this.rows(loja), this.rows(escala), de, ate, unidadeId);
  }

  /** Junta as três fontes (puro, a partir das linhas já lidas). */
  montar(
    regra: ReturnType<typeof eventosDaRegra>,
    loja: any[],
    escala: any[],
    de: string,
    ate: string,
    unidadeId: string | null = null,
  ): ItemDoCalendario[] {
    const out: ItemDoCalendario[] = regra.map((e) => ({
      chave: e.chave,
      dia: e.dia,
      grupo: e.grupo,
      tipo: e.tipo,
      nome: e.nome,
      detalhe: e.fonte,
      origem: 'regra',
      confianca: e.confianca,
    }));
    for (const x of loja) {
      const repete = x.repete === 'semana' ? ' · toda semana' : x.repete === 'ano' ? ' · todo ano' : '';
      const onde = x.unidade_id ? '' : ' · todas as lojas';
      for (const dia of ocorrencias(x.dia, x.repete, de, ate)) {
        out.push({
          chave: `loja:${x.id}:${dia}`,
          dia,
          grupo: x.tipo === 'feriado_municipal' ? 'feriado' : 'loja',
          tipo: x.tipo,
          nome: x.nome,
          detalhe: `${(NOME_DO_TIPO as any)[x.tipo] ?? 'Evento'}${x.hora ? ` · ${x.hora}` : ''}${repete}${onde} · cadastrado pela loja`,
          origem: 'loja',
          id: x.id,
          hora: x.hora ?? null,
          repete: x.repete,
          diaDoCadastro: x.dia,
          unidadeId: x.unidade_id ?? null,
          unidadeNome: x.unidade_nome ?? null,
          podeEditar: !unidadeId || x.unidade_id === unidadeId,
        });
      }
    }
    for (const x of escala) {
      const ini = x.data > de ? x.data : de;
      const fim = x.data_fim < ate ? x.data_fim : ate;
      for (let dia = ini; dia <= fim; dia = somarDias(dia, 1)) {
        out.push({
          chave: `escala:${x.id}:${dia}`,
          dia,
          grupo: x.tipo === 'feriado' ? 'feriado' : 'loja',
          tipo: x.tipo === 'feriado' ? 'feriado_escala' : 'evento_escala',
          nome: x.nome,
          detalhe: `${x.tipo === 'feriado' ? 'Feriado' : 'Evento'} cadastrado em Escalas › Feriado / evento${x.descricao ? ` · ${String(x.descricao).slice(0, 120)}` : ''}`,
          origem: 'escala',
          unidadeId: x.unidade_id ?? null,
          unidadeNome: x.unidade_nome ?? null,
        });
      }
    }
    return out.sort((a, b) => (a.dia < b.dia ? -1 : a.dia > b.dia ? 1 : ORDEM_ORIGEM[a.origem] - ORDEM_ORIGEM[b.origem]));
  }

  async criar(user: AuthUser, unidadeId: string | null, dto: any) {
    const e = lerEventoDaLoja(dto);
    if (unidadeId) await this.conferirLoja(user.tenantId, unidadeId);
    const [row] = this.rows(await this.db.execute(sql`
      insert into evento_loja (tenant_id, unidade_id, nome, tipo, dia, hora, repete, criado_por)
      values (${user.tenantId}::uuid, ${unidadeId}::uuid, ${e.nome}, ${e.tipo}, ${e.dia}::date, ${e.hora}::time, ${e.repete},
              ${user.colaboradorId ?? null}::uuid)
      returning id`));
    await this.auditar(user, 'evento_loja_criado', row.id, unidadeId, e);
    return { id: row.id as string };
  }

  /** Só o evento da loja de quem pede; o de "todas as lojas" (sem loja) só quem vê todas (`unidadeId` nulo). */
  private daLojaDeQuemPede(unidadeId: string | null) {
    return unidadeId ? sql`and unidade_id = ${unidadeId}::uuid` : sql``;
  }

  async editar(user: AuthUser, unidadeId: string | null, id: string, dto: any) {
    const e = lerEventoDaLoja(dto);
    const [row] = this.rows(await this.db.execute(sql`
      update evento_loja set nome = ${e.nome}, tipo = ${e.tipo}, dia = ${e.dia}::date, hora = ${e.hora}::time,
             repete = ${e.repete}, atualizado_em = clock_timestamp()
       where id = ${id}::uuid and tenant_id = ${user.tenantId}::uuid and excluido_em is null ${this.daLojaDeQuemPede(unidadeId)}
      returning id, unidade_id`));
    if (!row) throw new NotFoundException('Evento não encontrado.');
    await this.auditar(user, 'evento_loja_alterado', id, row.unidade_id ?? null, e);
    return { id };
  }

  async excluir(user: AuthUser, unidadeId: string | null, id: string) {
    const [row] = this.rows(await this.db.execute(sql`
      update evento_loja set excluido_em = clock_timestamp(), atualizado_em = clock_timestamp()
       where id = ${id}::uuid and tenant_id = ${user.tenantId}::uuid and excluido_em is null ${this.daLojaDeQuemPede(unidadeId)}
      returning id, unidade_id, nome`));
    if (!row) throw new NotFoundException('Evento não encontrado.');
    await this.auditar(user, 'evento_loja_excluido', id, row.unidade_id ?? null, { nome: row.nome });
    return { ok: true };
  }

  /**
   * A cópia do calendário por loja e dia (`calendario_loja_dia`), para 400 dias atrás e 60 à frente — todos os dias, os
   * sem evento com `[]`. Idempotente pela chave (loja, dia): rodar de novo só reescreve. Chamada pela rotina noturna do perfil.
   */
  async materializar(tenantId: string): Promise<{ lojas: number; dias: number }> {
    const hoje = hojeISO();
    const de = somarDias(hoje, -COPIA.antes);
    const ate = somarDias(hoje, COPIA.depois);
    const lojas = this.rows(await this.db.execute(sql`
      select id from unidade where tenant_id = ${tenantId}::uuid and deleted_at is null order by id`));
    let dias = 0;
    for (const { id: unidadeId } of lojas) {
      const itens = await this.listar(tenantId, unidadeId, de, ate);
      const porDia = new Map<string, any[]>();
      for (let d = de; d <= ate; d = somarDias(d, 1)) porDia.set(d, []);
      for (const i of itens)
        porDia.get(i.dia)?.push({ chave: i.chave, grupo: i.grupo, tipo: i.tipo, nome: i.nome, origem: i.origem, ...(i.hora ? { hora: i.hora } : {}) });
      const linhas = Array.from(porDia, ([dia, eventos]) => ({ dia, eventos }));
      await this.db.execute(sql`
        insert into calendario_loja_dia (unidade_id, dia, tenant_id, eventos, calculado_em)
        select ${unidadeId}::uuid, x.dia::date, ${tenantId}::uuid, x.eventos, clock_timestamp()
          from jsonb_to_recordset(${JSON.stringify(linhas)}::jsonb) as x(dia text, eventos jsonb)
        on conflict (unidade_id, dia) do update set eventos = excluded.eventos, calculado_em = excluded.calculado_em`);
      dias += linhas.length;
    }
    return { lojas: lojas.length, dias };
  }

  private async conferirLoja(tenantId: string, unidadeId: string) {
    const [u] = this.rows(await this.db.execute(sql`
      select 1 from unidade where id = ${unidadeId}::uuid and tenant_id = ${tenantId}::uuid and deleted_at is null`));
    if (!u) throw new BadRequestException('Loja não encontrada nesta empresa.');
  }

  private async auditar(user: AuthUser, acao: string, id: string, unidadeId: string | null, detalhe: any) {
    if (!this.auditoria) return;
    await this.auditoria.registrar({
      tenantId: user.tenantId,
      atorId: user.colaboradorId,
      atorPerfil: user.categoria,
      tipo: 'config',
      acao,
      unidadeId,
      entidadeTipo: 'evento_loja',
      entidadeId: id,
      detalhe,
    });
  }
}
