import { BadRequestException, Inject, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { AuthUser } from '../../auth/auth-user';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { hojeISO, somarDias } from '../../common/data';
import { chaveTelefone, sqlChaveTelefone } from '../../common/telefone-chave';
import { lerData, naSemanaDoAniversario, textoData, valeDesde } from '../../common/aniversario';

/* eslint-disable @typescript-eslint/no-explicit-any */

// O ANIVERSÁRIO DO CLIENTE (Onda 3 · PR 3, mig 357 — só NUVEM) e a PROTEÇÃO contra troca de data (pedido do dono em
// 03/11/2026): o cliente informa no Perfil ou na pergunta da confirmação e corrige UMA vez; depois, só gerente e
// presidente, em Delivery › Clientes, com o motivo. Toda troca recomeça a carência de 30 dias e fica na auditoria (quem,
// quando, a data de antes e a nova, o motivo). A regra das datas mora em `common/aniversario.ts`; aqui, o cadastro e as
// regras do cupom (pessoal e "só aniversariantes").

export type EstadoAniversario = {
  dia: number | null;
  mes: number | null;
  texto: string | null;
  informadoEm: string | null;
  origem: string | null;
  informadoPor: string | null;
  valeDesde: string | null;
  correcoesCliente: number;
  /** O cliente ainda pode corrigir (uma vez). */
  podeCorrigir: boolean;
  naoPerguntar: boolean;
  ultimoPresenteEm: string | null;
};

export type RegraDoCupom = {
  soAniversariantes: boolean;
  clienteId: string | null;
  chaveTelefone: string | null;
  origem: string | null;
};

/** Quem está usando o cupom: o cliente do token (cardápio) ou o número da conversa (robô — o WhatsApp prova o número). */
export type QuemUsa = { clienteId?: string | null; telefone?: string | null; telefoneVerificado?: boolean };

@Injectable()
export class AniversarioService {
  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    @Optional() private readonly auditoria?: AuditoriaService,
  ) {}

  private rows(r: any): any[] {
    return (r?.rows ?? r) as any[];
  }

  /**
   * As tabelas da mig 357 existem neste banco? (memorizado). Na nuvem, sim; num banco de LOJA (o do CI) elas não vêm —
   * e o cardápio e o perfil, que as leem, também rodam nas specs de lá: sem elas, nenhuma regra nova (como antes).
   */
  private readonly tabelas = new Map<string, Promise<boolean>>();
  existe(tabela: 'cupom_regra' | 'cliente_aniversario' | 'relacionamento_config'): Promise<boolean> {
    let p = this.tabelas.get(tabela);
    if (!p) {
      p = this.db
        .execute(sql`select to_regclass(${tabela}) is not null as t`)
        .then((r) => this.rows(r)[0]?.t === true)
        .catch(() => false);
      this.tabelas.set(tabela, p);
    }
    return p;
  }

  private estado(row: any): EstadoAniversario | null {
    if (!row) return null;
    const temData = row.dia != null && row.mes != null;
    const informadoEm = row.informado_em ? new Date(row.informado_em).toISOString() : null;
    const correcoes = Number(row.correcoes_cliente ?? 0);
    return {
      dia: temData ? Number(row.dia) : null,
      mes: temData ? Number(row.mes) : null,
      texto: temData ? textoData(Number(row.dia), Number(row.mes)) : null,
      informadoEm,
      origem: row.origem ?? null,
      informadoPor: row.informado_por ?? null,
      valeDesde: informadoEm ? valeDesde(informadoEm) : null,
      correcoesCliente: correcoes,
      podeCorrigir: temData && correcoes < 1,
      naoPerguntar: row.nao_perguntar === true,
      ultimoPresenteEm: row.ultimo_presente_em ? new Date(row.ultimo_presente_em).toISOString() : null,
    };
  }

  async doCliente(tenantId: string, clienteId: string): Promise<EstadoAniversario | null> {
    if (!(await this.existe('cliente_aniversario'))) return null;
    const r = this.rows(
      await this.db.execute(sql`
        select * from cliente_aniversario where cliente_id = ${clienteId}::uuid and tenant_id = ${tenantId}::uuid`),
    );
    return this.estado(r[0]);
  }

  /** A automática do aniversário está ligada na empresa? (a pergunta da confirmação só aparece com ela ligada) */
  async automaticaLigada(tenantId: string): Promise<boolean> {
    if (!(await this.existe('relacionamento_config'))) return false;
    const r = this.rows(
      await this.db.execute(sql`select aniversario_ativo from relacionamento_config where tenant_id = ${tenantId}::uuid`),
    );
    return r[0]?.aniversario_ativo === true;
  }

  /** O que o Perfil e a confirmação do pedido mostram ao cliente. */
  async paraOCliente(tenantId: string, clienteId: string) {
    const [e, ligada] = await Promise.all([this.doCliente(tenantId, clienteId), this.automaticaLigada(tenantId)]);
    return {
      dia: e?.dia ?? null,
      mes: e?.mes ?? null,
      texto: e?.texto ?? null,
      valeDesde: e?.dia ? e.valeDesde : null,
      podeCorrigir: e?.dia ? e.podeCorrigir : true,
      // A pergunta da confirmação: uma vez, só com a automática ligada e sem data; "Agora não" não pergunta de novo.
      perguntar: ligada && !e?.dia && !e?.naoPerguntar,
    };
  }

  private async auditar(tenantId: string, ator: { id: string | null; perfil: string }, acao: string, clienteId: string, detalhe: any) {
    await this.auditoria?.registrar({
      tenantId,
      unidadeId: null,
      atorId: ator.id,
      atorPerfil: ator.perfil,
      tipo: 'cadastro',
      acao,
      origem: ator.perfil === 'cliente' ? 'cardapio' : 'clientes',
      entidadeTipo: 'cliente_aniversario',
      entidadeId: clienteId,
      detalhe,
    });
  }

  /**
   * O cliente informa (Perfil ou a pergunta da confirmação). Sem data: grava. Com data: corrige UMA vez (a gravação só
   * passa com `correcoes_cliente < 1` — dois toques juntos não corrigem duas vezes); a correção recomeça a carência.
   */
  async peloCliente(tenantId: string, clienteId: string, dto: unknown) {
    const { dia, mes } = lerData(dto);
    const origem = (dto as any)?.origem === 'confirmacao' ? 'confirmacao' : 'perfil';
    const antes = await this.doCliente(tenantId, clienteId);
    if (antes?.dia === dia && antes?.mes === mes) return this.paraOCliente(tenantId, clienteId);
    if (antes?.dia) {
      const r = this.rows(
        await this.db.execute(sql`
          update cliente_aniversario
             set dia = ${dia}, mes = ${mes}, informado_em = now(), origem = ${origem}, informado_por = null,
                 correcoes_cliente = correcoes_cliente + 1, atualizado_em = now()
           where cliente_id = ${clienteId}::uuid and tenant_id = ${tenantId}::uuid and correcoes_cliente < 1
          returning cliente_id`),
      );
      if (!r.length) throw new BadRequestException('Você já corrigiu a data uma vez. Para mudar de novo, fale com a loja.');
      await this.auditar(tenantId, { id: null, perfil: 'cliente' }, 'cliente_corrigiu_aniversario', clienteId, {
        de: textoData(antes.dia, antes.mes as number),
        para: textoData(dia, mes),
        origem,
      });
    } else {
      // Sem data (ou só com o "Agora não"): grava — a gravação só pega a linha SEM data (dois toques juntos: o segundo
      // vira correção, pela regra de cima, na próxima vez).
      const r = this.rows(
        await this.db.execute(sql`
          insert into cliente_aniversario (cliente_id, tenant_id, dia, mes, informado_em, origem)
          values (${clienteId}::uuid, ${tenantId}::uuid, ${dia}, ${mes}, now(), ${origem})
          on conflict (cliente_id) do update
             set dia = excluded.dia, mes = excluded.mes, informado_em = excluded.informado_em, origem = excluded.origem,
                 informado_por = null, nao_perguntar = false, atualizado_em = now()
           where cliente_aniversario.dia is null
          returning cliente_id`),
      );
      if (!r.length) return this.peloCliente(tenantId, clienteId, dto);
      await this.auditar(tenantId, { id: null, perfil: 'cliente' }, 'cliente_informou_aniversario', clienteId, { para: textoData(dia, mes), origem });
    }
    return this.paraOCliente(tenantId, clienteId);
  }

  /** "Agora não" na pergunta da confirmação: não pergunta de novo (o Perfil continua aceitando). */
  async agoraNao(tenantId: string, clienteId: string) {
    await this.db.execute(sql`
      insert into cliente_aniversario (cliente_id, tenant_id, nao_perguntar) values (${clienteId}::uuid, ${tenantId}::uuid, true)
      on conflict (cliente_id) do update set nao_perguntar = true, atualizado_em = now()`);
    return this.paraOCliente(tenantId, clienteId);
  }

  /**
   * A loja anota ou corrige (Delivery › Clientes; gerente e presidente — o controller confere). Trocar data que já existe
   * pede o motivo. Recomeça a carência e fica na auditoria.
   */
  async pelaLoja(user: AuthUser, clienteId: string, dto: unknown) {
    const { dia, mes } = lerData(dto);
    const motivo = String((dto as any)?.motivo ?? '').trim().slice(0, 200);
    const [cli] = this.rows(
      await this.db.execute(sql`select id from cliente where id = ${clienteId}::uuid and tenant_id = ${user.tenantId}::uuid`),
    );
    if (!cli) throw new NotFoundException('Cliente não encontrado.');
    const antes = await this.doCliente(user.tenantId, clienteId);
    if (antes?.dia && motivo.length < 3) throw new BadRequestException('Escreva o motivo para corrigir.');
    if (antes?.dia === dia && antes?.mes === mes) return this.paraALoja(user.tenantId, clienteId);
    await this.db.execute(sql`
      insert into cliente_aniversario (cliente_id, tenant_id, dia, mes, informado_em, origem, informado_por)
      values (${clienteId}::uuid, ${user.tenantId}::uuid, ${dia}, ${mes}, now(), 'loja', ${user.colaboradorId ?? null})
      on conflict (cliente_id) do update
         set dia = excluded.dia, mes = excluded.mes, informado_em = excluded.informado_em, origem = 'loja',
             informado_por = excluded.informado_por, atualizado_em = now()`);
    await this.auditar(user.tenantId, { id: user.colaboradorId ?? null, perfil: user.categoria }, antes?.dia ? 'loja_corrigiu_aniversario' : 'loja_anotou_aniversario', clienteId, {
      de: antes?.dia ? textoData(antes.dia, antes.mes as number) : null,
      para: textoData(dia, mes),
      motivo: motivo || null,
    });
    return this.paraALoja(user.tenantId, clienteId);
  }

  /** O que a gaveta do cliente (Delivery › Clientes) mostra: a data, de onde veio, desde quando vale. */
  async paraALoja(tenantId: string, clienteId: string) {
    const e = await this.doCliente(tenantId, clienteId);
    if (!e?.dia) return { dia: null, mes: null, texto: null, informadoEm: null, origem: null, valeDesde: null, podeCorrigirCliente: true, quem: null };
    let quem: string | null = null;
    if (e.informadoPor) {
      const [c] = this.rows(await this.db.execute(sql`select nome from colaborador where id = ${e.informadoPor}::uuid`));
      quem = c?.nome ?? null;
    }
    return {
      dia: e.dia,
      mes: e.mes,
      texto: e.texto,
      informadoEm: e.informadoEm,
      origem: e.origem,
      valeDesde: e.valeDesde,
      podeCorrigirCliente: e.podeCorrigir,
      quem,
    };
  }

  // ===================== Cupom: pessoal e "só aniversariantes" =====================

  async regraDoCupom(cupomId: string): Promise<RegraDoCupom | null> {
    if (!(await this.existe('cupom_regra'))) return null;
    const [r] = this.rows(await this.db.execute(sql`select * from cupom_regra where cupom_id = ${cupomId}::uuid`));
    if (!r) return null;
    return { soAniversariantes: r.so_aniversariantes === true, clienteId: r.cliente_id ?? null, chaveTelefone: r.chave_telefone ?? null, origem: r.origem ?? null };
  }

  /** O cliente do cadastro pelo número da conversa (robô): a chave do telefone, o mais recente. */
  private async clientePeloTelefone(tenantId: string, telefone: string): Promise<string | null> {
    const chave = chaveTelefone(telefone);
    if (!chave) return null;
    const [c] = this.rows(
      await this.db.execute(sql`
        select id from cliente where tenant_id = ${tenantId}::uuid and ${sqlChaveTelefone(sql`telefone`)} = ${chave}
         order by ultimo_pedido_em desc nulls last limit 1`),
    );
    return c?.id ?? null;
  }

  /**
   * O cupom vale para quem está usando? Pessoal: só o dono — no cardápio, entrando com o código do WhatsApp (o token de
   * Sua conta); no robô, pelo número da conversa. "Só aniversariantes": a semana do aniversário VALENDO (carência de 30
   * dias) e uma vez a cada 12 meses por cliente.
   */
  async cupomValePara(tenantId: string, cupomId: string, quem: QuemUsa): Promise<{ ok: boolean; motivo?: string }> {
    const regra = await this.regraDoCupom(cupomId);
    if (!regra) return { ok: true };
    const telVerificado = quem.telefoneVerificado && quem.telefone ? chaveTelefone(quem.telefone) : null;
    if (regra.clienteId) {
      const dono = quem.clienteId ? quem.clienteId === regra.clienteId : !!telVerificado && telVerificado === regra.chaveTelefone;
      if (!dono)
        return {
          ok: false,
          motivo: quem.clienteId || telVerificado
            ? 'Este cupom é pessoal e não é seu.'
            : 'Este cupom é pessoal: entre em Sua conta com o código do WhatsApp para usar.',
        };
    }
    if (regra.soAniversariantes) {
      const clienteId = quem.clienteId ?? (telVerificado && quem.telefone ? await this.clientePeloTelefone(tenantId, quem.telefone) : null);
      if (!clienteId) return { ok: false, motivo: 'Cupom de aniversariante: entre em Sua conta com o código do WhatsApp para usar.' };
      const e = await this.doCliente(tenantId, clienteId);
      if (!naSemanaDoAniversario(e ? { dia: e.dia, mes: e.mes, informadoEm: e.informadoEm } : null, hojeISO()))
        return { ok: false, motivo: 'Cupom só para quem faz aniversário nesta semana (com a data informada há 30 dias ou mais).' };
      const [u] = this.rows(
        await this.db.execute(sql`
          select count(*)::int as n from cupom_uso u
           where u.cupom_id = ${cupomId}::uuid and u.usado_em > now() - interval '12 months'
             and (u.cliente_id = ${clienteId}::uuid
                  or ${sqlChaveTelefone(sql`u.telefone`)} = (select ${sqlChaveTelefone(sql`c.telefone`)} from cliente c where c.id = ${clienteId}::uuid))`),
      );
      if (Number(u?.n ?? 0) > 0) return { ok: false, motivo: 'Você já usou este cupom de aniversariante nos últimos 12 meses.' };
    }
    return { ok: true };
  }

  /** Os presentes (cupons pessoais) que o cliente ainda pode usar — o bloco de Sua conta › Benefícios. */
  async presentesDoCliente(tenantId: string, clienteId: string) {
    if (!(await this.existe('cupom_regra'))) return [];
    const r = this.rows(
      await this.db.execute(sql`
        select c.codigo, c.tipo, c.valor::float8 as valor, c.minimo::float8 as minimo, c.validade, r.origem
          from cupom_regra r join cupom c on c.id = r.cupom_id
         where r.tenant_id = ${tenantId}::uuid and r.cliente_id = ${clienteId}::uuid and c.ativo
           and (c.validade is null or c.validade >= ${hojeISO()}::date)
           and not exists (select 1 from cupom_uso u where u.cupom_id = c.id)
         order by c.validade nulls last`),
    );
    return r.map((x) => ({
      codigo: String(x.codigo),
      origem: x.origem ?? null,
      descricao: descricaoDoCupom(x.tipo, Number(x.valor), Number(x.minimo ?? 0)),
      validade: x.validade ? String(x.validade).slice(0, 10) : null,
    }));
  }
}

const reais = (v: number) => {
  const t = v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }).replace(/ /g, ' ');
  return t.endsWith(',00') ? t.slice(0, -3) : t;
};

/** "R$ 10 de desconto em pedido acima de R$ 40" · "10% de desconto" · "entrega grátis". */
export function descricaoDoCupom(tipo: string, valor: number, minimo: number): string {
  const base = tipo === 'fretegratis' ? 'entrega grátis' : tipo === 'valor' ? `${reais(valor)} de desconto` : `${valor}% de desconto`;
  return minimo > 0 ? `${base} em pedido acima de ${reais(minimo)}` : base;
}

/** A validade do presente: hoje + N dias (o último dia vale). */
export function validadeDoPresente(dias: number, hoje = hojeISO()): string {
  return somarDias(hoje, dias);
}
