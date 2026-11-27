/* eslint-disable @typescript-eslint/no-explicit-any */
import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { AuthUser } from '../../auth/auth-user';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { aberturasDoDia, agoraEmSaoPaulo, diaCurto, somarDias } from '../../common/horario-da-data';
import { instanteDeSaoPaulo } from '../../common/pedido-agendado';
import { eventosDaRegra, ocorrencias } from '../perfil-cliente/calendario-regra';
import { conferirDiaEspecial, deLinha, DIAS_A_FRENTE, type DiaEspecialConferido } from './dias-especiais';
import { diasDoPeriodo, feriadosSemResposta, type FeriadoSugerido, type RespostaDaLoja } from './feriados-sem-resposta';

// O CADASTRO DOS DIAS ESPECIAIS (fase H1; mig 512): Delivery › Configurações › Horários › Dias especiais. A lista com as
// situações (próximos e passados) e os agendados de cada dia, criar e editar em gaveta, excluir em diálogo, e os pedidos
// agendados de um período (o diálogo "Há 2 pedidos agendados", decisão 7: avisa e lista, nunca cancela).
// Escrita com a TRAVA DA EMPRESA (`for no key update`, ERR-159) antes de conferir os dias que se cruzam — duas telas
// salvando ao mesmo tempo não criam dois dias especiais para a mesma data. A tabela sincroniza: a nuvem e o servidor da
// loja escrevem; o índice único do dia é a segunda trava (V24).

const linhas = (r: any): any[] => (Array.isArray(r) ? r : (r?.rows ?? []));

export type SituacaoDaLista = 'proximos' | 'passados';

@Injectable()
export class DiasEspeciaisService {
  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly auditoria: AuditoriaService,
  ) {}

  private hoje(): string {
    return agoraEmSaoPaulo().dia;
  }

  /** Os pedidos agendados em aberto de cada dia especial (o selo "2 agendados" e o diálogo). */
  private agendadosDoPeriodo(tenantId: string, unidadeId: string | null, de: string, ate: string) {
    const inicio = instanteDeSaoPaulo(`${de}T00:00`)!;
    const fim = instanteDeSaoPaulo(`${somarDias(ate, 1)}T00:00`)!;
    return this.db.execute(sql`
      select id, display_id, cliente_nome, to_char(agendamento at time zone 'America/Sao_Paulo', 'YYYY-MM-DD"T"HH24:MI') as quando,
             total, forma_pagamento, status_pagamento
        from pedido_externo
       where tenant_id = ${tenantId}::uuid
         ${unidadeId ? sql`and (unidade_id = ${unidadeId}::uuid or unidade_id is null)` : sql``}
         and retirada_tipo = 'agendado' and status <> 'cancelado' and deleted_at is null
         and agendamento >= ${inicio.toISOString()}::timestamptz and agendamento < ${fim.toISOString()}::timestamptz
       order by agendamento
       limit 50`);
  }

  /** A lista no modelo do Estoque: a situação escolhida, a contagem de cada uma e os agendados de cada dia. */
  async listar(tenantId: string, unidadeId: string | null, situacao: SituacaoDaLista = 'proximos') {
    const hoje = this.hoje();
    const r: any = await this.db.execute(sql`
      select h.id, to_char(h.data, 'YYYY-MM-DD') as data, to_char(h.data_fim, 'YYYY-MM-DD') as data_fim, h.nome, h.funcionamento,
             h.abre, h.fecha, h.conjunto, h.aviso_antes, h.pausar_canais, h.feriado_chave, h.origem, h.criado_por_nome,
             h.created_at,
             (select count(*)::int from pedido_externo p
               where p.tenant_id = h.tenant_id
                 ${unidadeId ? sql`and (p.unidade_id = ${unidadeId}::uuid or p.unidade_id is null)` : sql``}
                 and p.retirada_tipo = 'agendado' and p.status <> 'cancelado' and p.deleted_at is null
                 and (p.agendamento at time zone 'America/Sao_Paulo')::date between h.data and coalesce(h.data_fim, h.data)
             ) as agendados
        from horario_especial h
       where h.tenant_id = ${tenantId}::uuid and h.unidade_id is not distinct from ${unidadeId}::uuid and h.deleted_at is null
         and ${situacao === 'passados' ? sql`coalesce(h.data_fim, h.data) < ${hoje}::date` : sql`coalesce(h.data_fim, h.data) >= ${hoje}::date`}
       order by ${situacao === 'passados' ? sql`h.data desc` : sql`h.data`}
       limit 200`);
    const c: any = await this.db.execute(sql`
      select count(*) filter (where coalesce(data_fim, data) >= ${hoje}::date)::int as proximos,
             count(*) filter (where coalesce(data_fim, data) < ${hoje}::date)::int as passados
        from horario_especial
       where tenant_id = ${tenantId}::uuid and unidade_id is not distinct from ${unidadeId}::uuid and deleted_at is null`);
    const cont = linhas(c)[0] ?? {};
    return {
      hoje,
      contagem: { proximos: Number(cont.proximos) || 0, passados: Number(cont.passados) || 0 },
      itens: linhas(r).map((x) => ({
        ...deLinha(x),
        feriadoChave: x.feriado_chave ?? null,
        origem: x.origem ?? 'tela',
        criadoPorNome: x.criado_por_nome ?? null,
        criadoEm: x.created_at,
        agendados: Number(x.agendados) || 0,
      })),
    };
  }

  /**
   * Os feriados sem resposta dos próximos `dias` (H2a): a lista "Próximos feriados sem resposta" (60 dias) e a faixa da tela
   * (10 dias). Fontes: a lei (calculada), o feriado da Escala e o feriado da cidade do Marketing — este só existe na nuvem:
   * no servidor da loja (ou sem a tabela) a resposta diz `fontes.calendario = false`, e a tela conta que não leu (V37).
   */
  async semResposta(tenantId: string, unidadeId: string | null, dias = DIAS_A_FRENTE) {
    const hoje = this.hoje();
    const ate = somarDias(hoje, Math.min(Math.max(Math.trunc(Number(dias) || DIAS_A_FRENTE), 1), DIAS_A_FRENTE));
    const loja = unidadeId ? sql`and (unidade_id = ${unidadeId}::uuid or unidade_id is null)` : sql``;
    const candidatos: FeriadoSugerido[] = eventosDaRegra(hoje, ate)
      .filter((e) => e.tipo === 'feriado' || e.tipo === 'ponto_facultativo')
      .map((e) => ({ chave: e.chave, data: e.dia, nome: e.nome, origem: e.tipo === 'feriado' ? 'lei' : 'ponto_facultativo' }));
    // O feriado da Escala (Escalas › Feriado / evento): o da empresa ou da loja, nunca o de uma pessoa (férias e folgas).
    const escala: any = await this.db.execute(sql`
      select id, to_char(data, 'YYYY-MM-DD') as data, to_char(data_fim, 'YYYY-MM-DD') as data_fim, nome
        from dia_especial
       where tenant_id = ${tenantId}::uuid and tipo = 'feriado' and colaborador_id is null and deleted_at is null
         and coalesce(data_fim, data) >= ${hoje}::date and data <= ${ate}::date ${loja}
       limit 200`);
    for (const x of linhas(escala))
      for (const d of diasDoPeriodo(String(x.data), x.data_fim ? String(x.data_fim) : null, somarDias))
        candidatos.push({ chave: `escala:${x.id}:${d}`, data: d, nome: String(x.nome ?? '').trim(), origem: 'escala' });
    // O feriado da cidade (Delivery › Clientes › Calendário de eventos; mig 461, só da nuvem). Repete todo ano ou não.
    let calendario = true;
    try {
      const cal: any = await this.db.execute(sql`
        select id, to_char(dia, 'YYYY-MM-DD') as dia, repete, nome
          from evento_loja
         where tenant_id = ${tenantId}::uuid and tipo = 'feriado_municipal' and excluido_em is null ${loja}
         limit 200`);
      for (const x of linhas(cal))
        for (const d of ocorrencias(String(x.dia), String(x.repete ?? 'nao'), hoje, ate))
          candidatos.push({ chave: `calendario:${x.id}:${d}`, data: d, nome: String(x.nome ?? '').trim(), origem: 'calendario' });
    } catch (e: any) {
      if (e?.code !== '42P01' && e?.cause?.code !== '42P01') throw e;
      calendario = false;
    }
    // O que já responde: todo dia especial que vale (inclusive o "horário normal", decisão 9).
    const resp: any = await this.db.execute(sql`
      select to_char(data, 'YYYY-MM-DD') as data, to_char(data_fim, 'YYYY-MM-DD') as data_fim, feriado_chave
        from horario_especial
       where tenant_id = ${tenantId}::uuid and deleted_at is null
         and (unidade_id is not distinct from ${unidadeId}::uuid or unidade_id is null)
         and coalesce(data_fim, data) >= ${hoje}::date and data <= ${ate}::date
       limit 500`);
    const respostas: RespostaDaLoja[] = linhas(resp).map((x) => ({ data: x.data, dataFim: x.data_fim ?? null, feriadoChave: x.feriado_chave ?? null }));
    // O horário da semana (o da entrega — o mesmo do "Aberta até" do cardápio): o que vale até alguém responder.
    const cfg: any = await this.db.execute(sql`
      select horarios from cardapio_config
       where tenant_id = ${tenantId}::uuid and unidade_id is not distinct from ${unidadeId}::uuid
       limit 1`);
    const semana = linhas(cfg)[0]?.horarios ?? [];
    const normalDoDia = (data: string): string | null => {
      const ab = aberturasDoDia(semana, [], data);
      if (ab === 'dia_inteiro') return 'o dia inteiro';
      return ab.length ? ab.map((a) => `${a.abre} às ${a.fecha}`).join(' e ') : null;
    };
    return { hoje, ate, fontes: { calendario }, itens: feriadosSemResposta({ hoje, ate, candidatos, respostas, normalDoDia }) };
  }

  /** Os pedidos agendados de um período (o diálogo "Há N pedidos agendados para…"): só leitura. */
  async agendados(tenantId: string, unidadeId: string | null, de: string, ate?: string) {
    const fim = ate || de;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(de) || !/^\d{4}-\d{2}-\d{2}$/.test(fim) || fim < de) throw new BadRequestException('Escolha o período.');
    if (somarDias(de, 62) < fim) throw new BadRequestException('O período pode ter até 60 dias.');
    const r: any = await this.agendadosDoPeriodo(tenantId, unidadeId, de, fim);
    return {
      itens: linhas(r).map((x) => ({
        id: String(x.id),
        numero: x.display_id ?? null,
        cliente: x.cliente_nome ?? null,
        quando: x.quando,
        total: Number(x.total) || 0,
        forma: x.forma_pagamento ?? null,
        pago: x.status_pagamento === 'pago' || x.status_pagamento === 'aprovado',
      })),
    };
  }

  /** Os dias da mesma loja que se cruzam com o período, no mesmo horário (o da empresa toda cruza com qualquer um). */
  private async cruzamento(tx: any, tenantId: string, unidadeId: string | null, v: DiaEspecialConferido, exceto: string | null) {
    const r: any = await tx.execute(sql`
      select to_char(data, 'YYYY-MM-DD') as data, nome from horario_especial
       where tenant_id = ${tenantId}::uuid and unidade_id is not distinct from ${unidadeId}::uuid and deleted_at is null
         ${exceto ? sql`and id <> ${exceto}::uuid` : sql``}
         and data <= ${v.dataFim ?? v.data}::date and coalesce(data_fim, data) >= ${v.data}::date
         and (conjunto = 'todos' or ${v.conjunto} = 'todos' or conjunto = ${v.conjunto})
       order by data limit 1`);
    const x = linhas(r)[0];
    if (x) throw new ConflictException(`Já há um dia especial em ${diaCurto(String(x.data))} (${x.nome}). Edite aquele ou escolha outro dia.`);
  }

  private async travarEmpresa(tx: any, tenantId: string) {
    await tx.execute(sql`select id from empresa where id = ${tenantId}::uuid for no key update`);
  }

  private quem(user: AuthUser) {
    return { id: user.colaboradorId ?? null, nome: (user as any).nome ?? null };
  }

  async criar(user: AuthUser, unidadeId: string | null, dto: any, origem: 'tela' | 'mister' | 'sugestao' = 'tela') {
    const c = conferirDiaEspecial(dto, this.hoje());
    if (!c.ok) throw new BadRequestException(c.erro);
    const v = c.v;
    const quem = this.quem(user);
    let id: string;
    try {
      id = await this.db.transaction(async (tx) => {
        await this.travarEmpresa(tx, user.tenantId);
        await this.cruzamento(tx, user.tenantId, unidadeId, v, null);
        const r: any = await tx.execute(sql`
          insert into horario_especial (tenant_id, unidade_id, data, data_fim, nome, funcionamento, abre, fecha, conjunto,
                                        pausar_canais, aviso_antes, feriado_chave, origem, criado_por, criado_por_nome)
          values (${user.tenantId}::uuid, ${unidadeId}::uuid, ${v.data}::date, ${v.dataFim}::date, ${v.nome}, ${v.funcionamento},
                  ${v.abre}, ${v.fecha}, ${v.conjunto}, ${v.pausarCanais}, ${v.avisoAntes}, ${v.feriadoChave}, ${origem},
                  ${quem.id}::uuid, ${quem.nome})
          returning id`);
        return String(linhas(r)[0].id);
      });
    } catch (e: any) {
      if (e?.code === '23505' || e?.cause?.code === '23505') throw new ConflictException('Já há um dia especial nesta data para este horário.');
      throw e;
    }
    await this.auditoria.registrar({
      tenantId: user.tenantId,
      unidadeId,
      atorId: user.colaboradorId,
      atorPerfil: user.categoria,
      tipo: 'config',
      acao: 'dia_especial_criado',
      entidadeTipo: 'horario_especial',
      entidadeId: id,
      detalhe: { ...v, origem },
    });
    return { id, ...v };
  }

  private async linhaDaEmpresa(tx: any, tenantId: string, id: string) {
    const r: any = await tx.execute(sql`
      select id, unidade_id, to_char(data, 'YYYY-MM-DD') as data, to_char(data_fim, 'YYYY-MM-DD') as data_fim, nome, funcionamento,
             abre, fecha, conjunto, aviso_antes, pausar_canais, feriado_chave
        from horario_especial where id = ${id}::uuid and tenant_id = ${tenantId}::uuid and deleted_at is null`);
    const x = linhas(r)[0];
    if (!x) throw new NotFoundException('Dia especial não encontrado.');
    return x;
  }

  async editar(user: AuthUser, id: string, dto: any) {
    const hoje = this.hoje();
    const r = await this.db.transaction(async (tx) => {
      await this.travarEmpresa(tx, user.tenantId);
      const antes = await this.linhaDaEmpresa(tx, user.tenantId, id);
      if ((antes.data_fim ?? antes.data) < hoje) throw new ConflictException('Este dia especial já passou: não se edita.');
      // Ausente mantém (V16): o que não vem no pedido fica como está — o Mister que muda só o nome não apaga o período, a
      // pausa dos canais, o aviso, o "vale para" nem o feriado ligado. A tela manda tudo; o Mister (C4) manda só o que muda.
      const atual = deLinha(antes);
      const base = {
        data: atual.data,
        dataFim: atual.dataFim,
        nome: atual.nome,
        funcionamento: atual.funcionamento,
        abre: atual.abre,
        fecha: atual.fecha,
        conjunto: atual.conjunto,
        avisoAntes: atual.avisoAntes,
        pausarCanais: atual.pausarCanais,
        feriadoChave: antes.feriado_chave ?? null,
      };
      const vem = Object.fromEntries(Object.entries(dto ?? {}).filter(([, v]) => v !== undefined));
      // Mudou para "outro horário" sem as horas: as do dia especial (se já era outro horário) — a conferência cobra as duas.
      // Um período que já começou mantém o começo: "hoje ou à frente" vale a partir do dia dele.
      const c = conferirDiaEspecial({ ...base, ...vem }, antes.data < hoje ? antes.data : hoje);
      if (!c.ok) throw new BadRequestException(c.erro);
      if (antes.data < hoje && c.v.data !== antes.data) throw new BadRequestException('Este período já começou: o primeiro dia não muda.');
      const v = c.v;
      await this.cruzamento(tx, user.tenantId, antes.unidade_id ?? null, v, id);
      await tx.execute(sql`
        update horario_especial
           set data = ${v.data}::date, data_fim = ${v.dataFim}::date, nome = ${v.nome}, funcionamento = ${v.funcionamento},
               abre = ${v.abre}, fecha = ${v.fecha}, conjunto = ${v.conjunto}, pausar_canais = ${v.pausarCanais},
               aviso_antes = ${v.avisoAntes}, feriado_chave = ${v.feriadoChave}
         where id = ${id}::uuid and tenant_id = ${user.tenantId}::uuid and deleted_at is null`);
      return { antes: deLinha(antes), depois: v, unidadeId: antes.unidade_id ?? null };
    }).catch((e: any) => {
      if (e?.code === '23505' || e?.cause?.code === '23505') throw new ConflictException('Já há um dia especial nesta data para este horário.');
      throw e;
    });
    await this.auditoria.registrar({
      tenantId: user.tenantId,
      unidadeId: r.unidadeId,
      atorId: user.colaboradorId,
      atorPerfil: user.categoria,
      tipo: 'config',
      acao: 'dia_especial_alterado',
      entidadeTipo: 'horario_especial',
      entidadeId: id,
      detalhe: { antes: r.antes, depois: r.depois },
    });
    return { id, ...r.depois };
  }

  async excluir(user: AuthUser, id: string) {
    const antes = await this.db.transaction(async (tx) => {
      await this.travarEmpresa(tx, user.tenantId);
      const x = await this.linhaDaEmpresa(tx, user.tenantId, id);
      await tx.execute(sql`update horario_especial set deleted_at = now() where id = ${id}::uuid and tenant_id = ${user.tenantId}::uuid and deleted_at is null`);
      return x;
    });
    await this.auditoria.registrar({
      tenantId: user.tenantId,
      unidadeId: antes.unidade_id ?? null,
      atorId: user.colaboradorId,
      atorPerfil: user.categoria,
      tipo: 'config',
      acao: 'dia_especial_excluido',
      entidadeTipo: 'horario_especial',
      entidadeId: id,
      detalhe: deLinha(antes),
    });
    return { ok: true };
  }
}
