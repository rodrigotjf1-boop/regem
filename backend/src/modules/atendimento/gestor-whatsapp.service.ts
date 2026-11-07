import { randomInt } from 'crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { Interval } from '@nestjs/schedule';
import { SQL, sql } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { AuthUser } from '../../auth/auth-user';
import { horaNoFuso } from '../../common/data';
import { ehServidorLocal } from '../../common/modo';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { WhatsappCloudService } from '../whatsapp/whatsapp-cloud.service';
import { WhatsappService } from '../whatsapp/whatsapp.service';
import { AtendimentoService } from './atendimento.service';
import { DisputaIfoodService } from './disputa-ifood.service';
import { Pedido99Service } from './pedido-99.service';
import { inicioDoCasoSql, recadoAtivoSql } from './horario-da-equipe';
import {
  AJUSTE_GESTOR_WA_PADRAO,
  AjusteGestorWa,
  CODIGO_VALE_MIN,
  CasoDoAviso,
  JANELA_HORAS,
  MODELO_DO_GESTOR,
  NIVEIS_DO_GESTOR_WA,
  TIPOS_DE_DECISAO,
  finalDoNumero,
  linkDoCaso,
  linkParaLigar,
  novoCodigo,
  resumoDoModelo,
  textoDoAviso,
} from './gestor-whatsapp';
import {
  CasoDaDecisao,
  Rascunho,
  aplicarEscolha,
  escolhaPeloTitulo,
  idDoBotao,
  lerIdDoBotao,
  lerLimite,
  lerRascunho,
  lerVotoDaEnquete,
  nomeNaEnquete,
  passoAtual,
  podeAceitar,
  textoDoFeito,
  valorDoAceite,
} from './gestor-whatsapp-decisao';
import { EVENTO_RESPOSTA_DO_GESTOR, RespostaDoGestor } from './gestor-whatsapp-entrada';

/* eslint-disable @typescript-eslint/no-explicit-any */

// GERENTE NO WHATSAPP (item 5 do checkpoint da Central, mig 375; protótipo `mockups/regem-central-atendimento.html`,
// versão 4, parte 5a): o que pede uma decisão (disputa do iFood, cancelamento e reembolso da 99, cancelamento do
// cardápio) e o caso que ninguém pegou chegam ao WhatsApp de cada gestor ligado, pelo WhatsApp principal da loja, com o
// link do caso. Os botões para decidir ali mesmo, o limite de valor e a confirmação são a parte 5b.
//  • LIGAR: o gestor pede o código aqui; o número que manda "REGEM 123456" à loja fica ligado a ele
//    (`gestor-whatsapp-entrada.ts`). Cada um liga o próprio — o número não vem do cadastro.
//  • A ROTINA (só na nuvem, de 15 em 15 s, e na hora do aviso de caso novo): escolhe, numa consulta, os pares (caso,
//    gestor) que ainda não têm aviso e GRAVA o aviso antes de mandar (id pela chave de negócio — V42): duas réplicas não
//    mandam em dobro. Quem recebe: gestor ligado, sem PARAR AVISOS, ativo, gerente ou presidente NA HORA (V75 — a mesma
//    régua da senha: excluído, bloqueado ou rebaixado não recebe), empresa e loja vivas; gerente só o da loja dele (ou
//    sem loja), presidente de todas.
//  • A VIA: na API oficial, texto dentro da janela de 24 h (a última mensagem dele) e o modelo "Atendimento" fora dela;
//    na Evolution, texto. Falha passageira tenta de novo, até 3 vezes, enquanto o caso vale.

/** Até quantos avisos novos por volta (todas as lojas juntas); o resto fica para a próxima. */
const AVISOS_POR_VOLTA = 40;
/** Decisão aberta há mais que isto não vai (ligar o ajuste não manda o atrasado do dia). */
const DECISAO_ATE_HORAS = 2;
/** O "ninguém pegou" que escalou há mais que isto não vai. */
const NINGUEM_PEGOU_ATE_MIN = 30;
const TENTATIVAS = 3;

const linhas = (r: any) => (r?.rows ?? r ?? []) as any[];
const niveis = sql.join(NIVEIS_DO_GESTOR_WA.map((n) => sql`${n}`), sql`, `);
const tiposDeDecisao = sql.join(TIPOS_DE_DECISAO.map((t) => sql`${t}`), sql`, `);
const semColuna = (e: any) => e?.code === '42703' || e?.code === '42P01'; // banco sem a 375
/** O total do pedido do caso, em centavos (o valor do aceite de um cancelamento). */
const DO_PEDIDO = sql`(select round(pe.total * 100)::int from pedido_externo pe where pe.id = ch.pedido_id and pe.tenant_id = ch.tenant_id)`;
/** A via do WhatsApp principal da empresa (uma linha de cardápio só — a da empresa antes da de uma loja). */
const PROVEDOR = sql`(select cc.provedor from cardapio_config cc where cc.tenant_id = a.tenant_id order by cc.unidade_id nulls first limit 1)`;

export type PessoaDoWhatsapp = {
  id: string;
  nome: string;
  nivel: string;
  loja: string | null;
  voce: boolean;
  ligado: boolean;
  final: string | null;
  desde: string | null;
  pausado: boolean;
};

@Injectable()
export class GestorWhatsappService {
  private readonly logger = new Logger('GestorWhatsapp');
  private rodando = false;
  private readonly agoraPorEmpresa = new Set<string>();

  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly cloud: WhatsappCloudService,
    private readonly evolution: WhatsappService,
    @Optional() private readonly auditoria?: AuditoriaService,
    // A decisão pelo WhatsApp (parte 5b) vai pelos MESMOS serviços da tela (V43).
    @Optional() private readonly disputa?: DisputaIfoodService,
    @Optional() private readonly pedido99?: Pedido99Service,
    @Optional() private readonly atendimento?: AtendimentoService,
  ) {}

  // ---------------------------------------------------------------- ajustes

  /** O ajuste da empresa (sem linha, ou banco sem a 375: o padrão — desligado). */
  async ajuste(tenantId: string): Promise<AjusteGestorWa> {
    try {
      const [r] = linhas(
        await this.db.execute(sql`
          select gestor_wa_ligado as ligado, gestor_wa_decisoes as decisoes, gestor_wa_ninguem_pegou as "ninguemPegou",
                 gestor_wa_limite_centavos as limite
            from robo_config where tenant_id = ${tenantId}::uuid`),
      );
      return r
        ? { ligado: r.ligado === true, decisoes: r.decisoes !== false, ninguemPegou: r.ninguemPegou !== false, limiteCentavos: lerLimite(r.limite, true) }
        : { ...AJUSTE_GESTOR_WA_PADRAO };
    } catch (e: any) {
      if (semColuna(e)) return { ...AJUSTE_GESTOR_WA_PADRAO };
      throw e;
    }
  }

  /** O grupo inteiro da tela: o ajuste, a via da loja, o modelo da Meta e quem recebe. */
  async grupo(user: AuthUser) {
    const [ajuste, via, pessoas] = await Promise.all([this.ajuste(user.tenantId), this.viaDaLoja(user.tenantId), this.pessoas(user)]);
    return { ...ajuste, via: via.provedor, numeroDaLoja: !!via.numero, modelo: via.provedor === 'cloud' ? await this.situacaoDoModelo(user.tenantId) : null, pessoas };
  }

  /** Grava SÓ as colunas dele (V82), cada mudança na auditoria. Ligado na API oficial: pede o modelo à Meta. */
  async salvar(user: AuthUser, parcial: Partial<AjusteGestorWa>): Promise<void> {
    const antes = await this.ajuste(user.tenantId);
    const depois = { ...antes, ...parcial };
    const mudou = (Object.keys(parcial) as (keyof AjusteGestorWa)[]).filter((k) => antes[k] !== depois[k]);
    if (!mudou.length) return;
    await this.db.execute(sql`
      insert into robo_config (tenant_id, gestor_wa_ligado, gestor_wa_decisoes, gestor_wa_ninguem_pegou, gestor_wa_limite_centavos,
                               atualizado_por)
      values (${user.tenantId}::uuid, ${depois.ligado}, ${depois.decisoes}, ${depois.ninguemPegou}, ${depois.limiteCentavos}::int,
              ${user.colaboradorId}::uuid)
      on conflict (tenant_id) do update
         set gestor_wa_ligado = excluded.gestor_wa_ligado, gestor_wa_decisoes = excluded.gestor_wa_decisoes,
             gestor_wa_ninguem_pegou = excluded.gestor_wa_ninguem_pegou,
             gestor_wa_limite_centavos = excluded.gestor_wa_limite_centavos, atualizado_por = excluded.atualizado_por,
             atualizado_em = now()`);
    for (const k of mudou)
      await this.auditoria?.registrar({
        tenantId: user.tenantId,
        atorId: user.colaboradorId,
        atorPerfil: user.categoria,
        tipo: 'config',
        acao: 'gestor_whatsapp_ajuste',
        entidadeTipo: 'robo_config',
        entidadeId: user.tenantId,
        detalhe: { ajuste: k, de: antes[k], para: depois[k] },
      });
    if (depois.ligado && !antes.ligado) await this.pedirModelo(user.tenantId);
  }

  /** O WhatsApp principal da loja: a via (API oficial ou QR) e o número para o link de ligar. */
  private async viaDaLoja(tenantId: string): Promise<{ provedor: 'cloud' | 'evolution' | null; numero: string | null }> {
    const [c] = linhas(
      await this.db.execute(sql`
        select provedor, wa_cloud_phone_id as "phoneId", wa_cloud_numero as "numeroCloud",
               evolution_instancia as instancia, evolution_numero as "numeroEvolution"
          from cardapio_config where tenant_id = ${tenantId}::uuid order by unidade_id nulls first limit 1`),
    );
    if (!c) return { provedor: null, numero: null };
    if (c.provedor === 'cloud') return { provedor: c.phoneId ? 'cloud' : null, numero: c.phoneId ? String(c.numeroCloud ?? '') || null : null };
    return { provedor: c.instancia ? 'evolution' : null, numero: c.instancia ? String(c.numeroEvolution ?? '') || null : null };
  }

  private async situacaoDoModelo(tenantId: string): Promise<string | null> {
    try {
      const [m] = linhas(
        await this.db.execute(sql`
          select status from whatsapp_template where tenant_id = ${tenantId}::uuid and nome = ${MODELO_DO_GESTOR} and idioma = 'pt_BR' limit 1`),
      );
      return m ? String(m.status) : null;
    } catch (e: any) {
      if (semColuna(e)) return null;
      throw e;
    }
  }

  /** Pede à Meta o modelo "Atendimento" (só API oficial; o que já foi pedido não é reenviado). Nunca derruba o salvar. */
  private async pedirModelo(tenantId: string): Promise<void> {
    try {
      if ((await this.viaDaLoja(tenantId)).provedor !== 'cloud') return;
      await this.cloud.garantirModeloRelacionamento(tenantId, MODELO_DO_GESTOR);
    } catch (e: any) {
      this.logger.warn(`modelo "${MODELO_DO_GESTOR}" não pedido à Meta (loja ${tenantId}): ${e?.message ?? e}`);
    }
  }

  /** Gerentes e presidente da empresa (ativos), com o WhatsApp de cada um — só o final do número. */
  private async pessoas(user: AuthUser): Promise<PessoaDoWhatsapp[]> {
    try {
      const r = linhas(
        await this.db.execute(sql`
          select c.id, c.nome, coalesce(p.nivel, f.categoria::text) as nivel, u.nome as loja,
                 g.telefone, g.ligado_em as "ligadoEm", g.pausado_em as "pausadoEm"
            from colaborador c
            left join funcao f on f.id = c.funcao_id
            left join perfil_acesso p on p.id = c.perfil_acesso_id
            left join unidade u on u.id = c.unidade_id
            left join gestor_whatsapp g on g.tenant_id = c.tenant_id and g.colaborador_id = c.id
           where c.tenant_id = ${user.tenantId}::uuid and c.deleted_at is null and c.status = 'ativo'
             and coalesce(p.nivel, f.categoria::text) in (${niveis})
           order by (c.id = ${user.colaboradorId}::uuid) desc, coalesce(p.nivel, f.categoria::text) = 'presidente' desc, c.nome
           limit 200`),
      );
      return r.map((x) => {
        const ligado = !!x.ligadoEm && !!x.telefone;
        return {
          id: x.id,
          nome: x.nome,
          nivel: x.nivel,
          loja: x.loja ?? null,
          voce: x.id === user.colaboradorId,
          ligado,
          final: ligado ? finalDoNumero(x.telefone) : null,
          desde: ligado ? new Date(x.ligadoEm).toISOString() : null,
          pausado: ligado && !!x.pausadoEm,
        };
      });
    } catch (e: any) {
      if (semColuna(e)) return [];
      throw e;
    }
  }

  // ---------------------------------------------------------------- ligar e desligar

  /**
   * O código para o gestor ligar o PRÓPRIO WhatsApp (vale 10 min, uma vez). Só quem é gerente ou presidente agora; a
   * loja precisa do WhatsApp conectado (é para ele que o gestor manda a mensagem).
   */
  async ligar(user: AuthUser): Promise<{ codigo: string; link: string; expiraEm: string; numeroDaLoja: string }> {
    const [eu] = linhas(
      await this.db.execute(sql`
        select c.id from colaborador c
          left join funcao f on f.id = c.funcao_id
          left join perfil_acesso p on p.id = c.perfil_acesso_id
         where c.id = ${user.colaboradorId}::uuid and c.tenant_id = ${user.tenantId}::uuid and c.deleted_at is null
           and c.status = 'ativo' and coalesce(p.nivel, f.categoria::text) in (${niveis})`),
    );
    if (!eu) throw new ForbiddenException('Só gerente e presidente ligam o WhatsApp para os avisos do atendimento.');
    const via = await this.viaDaLoja(user.tenantId);
    if (!via.provedor || !via.numero)
      throw new BadRequestException('O WhatsApp da loja não está conectado. Conecte em Delivery › WhatsApp e tente de novo.');
    for (let tentativa = 0; tentativa < 5; tentativa++) {
      const codigo = novoCodigo();
      try {
        const [r] = linhas(
          await this.db.execute(sql`
            insert into gestor_whatsapp (tenant_id, colaborador_id, codigo, codigo_expira_em)
            values (${user.tenantId}::uuid, ${user.colaboradorId}::uuid, ${codigo}, now() + make_interval(mins => ${CODIGO_VALE_MIN}))
            on conflict (tenant_id, colaborador_id) do update
               set codigo = excluded.codigo, codigo_expira_em = excluded.codigo_expira_em, atualizado_em = now()
            returning codigo_expira_em as "expiraEm"`),
        );
        await this.auditoria?.registrar({
          tenantId: user.tenantId,
          atorId: user.colaboradorId,
          atorPerfil: user.categoria,
          tipo: 'config',
          acao: 'gestor_whatsapp_codigo',
          entidadeTipo: 'gestor_whatsapp',
          entidadeId: user.colaboradorId,
          detalhe: {},
        });
        return { codigo, link: linkParaLigar(via.numero, codigo), expiraEm: new Date(r.expiraEm).toISOString(), numeroDaLoja: via.numero };
      } catch (e: any) {
        if (e?.code !== '23505') throw e; // o mesmo código aberto noutra pessoa: sorteia outro
      }
    }
    throw new BadRequestException('Não deu para gerar o código agora. Tente de novo.');
  }

  /** Desliga o WhatsApp de alguém (o próprio ou de outro gestor): para na hora, e o que esperava o toque não vale mais. */
  async desligar(user: AuthUser, colaboradorId: string): Promise<void> {
    const [g] = linhas(
      await this.db.execute(sql`
        update gestor_whatsapp
           set telefone = null, ligado_em = null, pausado_em = null, codigo = null, codigo_expira_em = null, atualizado_em = now()
         where tenant_id = ${user.tenantId}::uuid and colaborador_id = ${colaboradorId}::uuid
           and (telefone is not null or codigo is not null)
        returning id`),
    );
    if (!g) throw new NotFoundException('Este WhatsApp já não estava ligado.');
    await this.db.execute(sql`
      update aviso_gestor_whatsapp set situacao = 'expirado', atualizado_em = now()
       where tenant_id = ${user.tenantId}::uuid and colaborador_id = ${colaboradorId}::uuid
         and situacao in ('enviando', 'modelo', 'falhou')`);
    await this.auditoria?.registrar({
      tenantId: user.tenantId,
      atorId: user.colaboradorId,
      atorPerfil: user.categoria,
      tipo: 'config',
      acao: 'gestor_whatsapp_desligado',
      entidadeTipo: 'gestor_whatsapp',
      entidadeId: colaboradorId,
      detalhe: { proprio: colaboradorId === user.colaboradorId },
    });
  }

  // ---------------------------------------------------------------- a rotina

  @Interval(15_000)
  async tick() {
    if (ehServidorLocal() || this.rodando) return;
    this.rodando = true;
    try {
      await this.enviarPendentes();
    } catch (e: any) {
      if (!semColuna(e)) this.logger.warn(`avisos ao gestor no WhatsApp: ${e?.message ?? e}`);
    } finally {
      this.rodando = false;
    }
  }

  /** Caso novo, ou o que acabou de escalar: manda na hora, sem esperar a volta (nunca rejeita — V3). */
  @OnEvent('atendimento.novo')
  aoCasoNovo(p: { tenantId?: string }) {
    this.agora(p?.tenantId);
  }

  @OnEvent('atendimento.mudou')
  aoCasoMudar(p: { tenantId?: string; motivo?: string }) {
    if (p?.motivo === 'escalou') this.agora(p.tenantId);
  }

  private agora(tenantId?: string) {
    if (!tenantId || ehServidorLocal() || this.agoraPorEmpresa.has(tenantId)) return;
    this.agoraPorEmpresa.add(tenantId);
    void this.enviarPendentes([tenantId])
      .catch((e: any) => {
        if (!semColuna(e)) this.logger.warn(`aviso ao gestor na hora (loja ${tenantId}): ${e?.message ?? e}`);
      })
      .finally(() => this.agoraPorEmpresa.delete(tenantId));
  }

  /**
   * Grava e manda os avisos que faltam. `soEmpresas`: só estas (o aviso na hora, e o teste — no CI as specs dividem o
   * banco). Devolve quantos saíram (texto ou modelo).
   */
  async enviarPendentes(soEmpresas?: string[], limite: number = AVISOS_POR_VOLTA): Promise<number> {
    const empresas = soEmpresas?.length ? sql`and ch.tenant_id in (${sql.join(soEmpresas.map((t) => sql`${t}::uuid`), sql`, `)})` : sql``;
    // Os pares (caso, gestor) que valem AGORA e ainda não têm aviso — as condições dentro da seleção (V84: o limite só
    // pega quem vale). Gravar antes de mandar: a réplica que gravou é a que manda.
    const novos = linhas(
      await this.db.execute(sql`
        with alvo as (
          select ch.id as chamado_id, ch.tenant_id, ch.unidade_id, g.colaborador_id, g.telefone, t.tipo
            from atendimento_chamado ch
            join robo_config rc on rc.tenant_id = ch.tenant_id and rc.gestor_wa_ligado
            join empresa emp on emp.id = ch.tenant_id and emp.deleted_at is null
            cross join lateral (
              select case when ch.tipo in (${tiposDeDecisao}) then 'decisao' else 'ninguem_pegou' end as tipo) t
            join gestor_whatsapp g on g.tenant_id = ch.tenant_id and g.ligado_em is not null and g.telefone is not null
                                  and g.pausado_em is null
            join colaborador c on c.id = g.colaborador_id and c.deleted_at is null and c.status = 'ativo'
            left join funcao f on f.id = c.funcao_id
            left join perfil_acesso p on p.id = c.perfil_acesso_id
           where ch.status = 'aberto' and ch.decisao is null
             and coalesce(p.nivel, f.categoria::text) in (${niveis})
             and (coalesce(p.nivel, f.categoria::text) = 'presidente' or c.unidade_id is null or ch.unidade_id is null
                  or c.unidade_id = ch.unidade_id)
             and (ch.unidade_id is null
                  or exists (select 1 from unidade u where u.id = ch.unidade_id and u.tenant_id = ch.tenant_id and u.deleted_at is null))
             -- HORÁRIO DA EQUIPE (mig 379): fora do horário ninguém é avisado — o recado que espera a abertura não gera aviso
             -- (o "ninguém pegou" já não teria a marca; a decisão sem prazo, como um cancelamento, também não sai). A
             -- disputa e a 99 têm prazo e nunca nascem como recado. Depois da abertura, a decisão conta da volta da equipe.
             and not ${recadoAtivoSql('ch')}
             and (
                  (t.tipo = 'decisao' and rc.gestor_wa_decisoes
                     and ${inicioDoCasoSql('ch')} > now() - make_interval(hours => ${DECISAO_ATE_HORAS})
                     and (ch.prazo_em is null or ch.prazo_em > now()))
               or (t.tipo = 'ninguem_pegou' and rc.gestor_wa_ninguem_pegou
                     and ch.responsavel_id is null and ch.aguardando_desde is null
                     and ch.detalhe -> 'escalado' ->> 'em' is not null
                     and (ch.detalhe -> 'escalado' ->> 'em')::timestamptz > now() - make_interval(mins => ${NINGUEM_PEGOU_ATE_MIN}))
             )
             and not exists (select 1 from aviso_gestor_whatsapp a
                              where a.chamado_id = ch.id and a.colaborador_id = g.colaborador_id and a.tipo = t.tipo)
             ${empresas}
           order by ch.prazo_em nulls last, ch.criado_em
           limit ${limite}
        )
        insert into aviso_gestor_whatsapp (id, tenant_id, unidade_id, chamado_id, colaborador_id, telefone, tipo)
        select md5(chamado_id::text || ':' || colaborador_id::text || ':' || tipo)::uuid, tenant_id, unidade_id, chamado_id,
               colaborador_id, telefone, tipo
          from alvo
        on conflict (id) do nothing
        returning id`),
    );
    // As falhas passageiras (e o "enviando" de uma réplica que caiu no meio): de novo, até 3 vezes, enquanto valem.
    const deNovo = linhas(
      await this.db.execute(sql`
        update aviso_gestor_whatsapp a set situacao = 'enviando', tentativas = a.tentativas + 1, atualizado_em = now()
         where a.id in (
           select a2.id from aviso_gestor_whatsapp a2
            where a2.tentativas < ${TENTATIVAS}
              and ((a2.situacao = 'falhou' and a2.atualizado_em < now() - interval '1 minute')
                or (a2.situacao = 'enviando' and a2.atualizado_em < now() - interval '2 minutes'))
              ${soEmpresas?.length ? sql`and a2.tenant_id in (${sql.join(soEmpresas.map((t) => sql`${t}::uuid`), sql`, `)})` : sql``}
            order by a2.atualizado_em
            limit ${limite})
           and a.situacao in ('falhou', 'enviando')
        returning a.id`),
    );
    const ids = [...novos, ...deNovo].map((r) => r.id);
    if (!ids.length) return 0;
    let saiu = 0;
    for (const aviso of await this.paraMandar(ids)) if (await this.mandar(aviso)) saiu++;
    return saiu;
  }

  /** O aviso com o caso, o gestor e a via — e se ainda vale (o caso pode ter mudado entre gravar e mandar). */
  private async paraMandar(ids: string[]): Promise<any[]> {
    return linhas(
      await this.db.execute(sql`
        select a.id, a.tenant_id as "tenantId", a.telefone, a.tipo as "tipoDoAviso",
               ch.id as "chamadoId", ch.tipo, ch.canal, ch.cliente, ch.pedido_numero as "pedidoNumero", ch.mensagem,
               ch.prazo_em as "prazoEm", ch.criado_em as "criadoEm", ch.detalhe,
               (ch.status = 'aberto' and ch.decisao is null and (ch.prazo_em is null or ch.prazo_em > now())
                 and (a.tipo <> 'ninguem_pegou' or ch.responsavel_id is null)
                 and g.telefone = a.telefone and g.pausado_em is null) as vale,
               (g.ultima_entrada_em > now() - make_interval(mins => ${Math.round(JANELA_HORAS * 60)})
                 or exists (select 1 from whatsapp_mensagem wm
                             where wm.tenant_id = a.tenant_id and wm.telefone = a.telefone and wm.direcao = 'entrada'
                               and wm.criado_em > now() - make_interval(mins => ${Math.round(JANELA_HORAS * 60)}))) as "naJanela",
               ${PROVEDOR} as provedor, a.codigo, a.escolha,
               ${DO_PEDIDO} as "totalCentavos",
               rc.gestor_wa_limite_centavos as limite, (rc.tenant_id is not null) as "temAjuste"
          from aviso_gestor_whatsapp a
          join atendimento_chamado ch on ch.id = a.chamado_id
          left join gestor_whatsapp g on g.tenant_id = a.tenant_id and g.colaborador_id = a.colaborador_id
          left join robo_config rc on rc.tenant_id = a.tenant_id
         where a.id in (${sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `)}) and a.situacao = 'enviando'`),
    );
  }

  /** Manda UM aviso pela via da loja e grava como ficou. `true` = saiu. Nunca lança. */
  private async mandar(a: any): Promise<boolean> {
    const caso: CasoDoAviso = { ...a, id: a.chamadoId };
    try {
      if (a.vale !== true) {
        await this.marcar(a.id, 'expirado', null);
        return false;
      }
      let situacao: 'enviado' | 'modelo' = 'enviado';
      if (a.provedor === 'cloud' && a.naJanela !== true) {
        // Fora da janela de 24 h: o modelo "Atendimento"; o toque em "Ver por aqui" manda o texto e os botões.
        await this.cloud.enviarInterno(a.tenantId, a.telefone, { modelo: MODELO_DO_GESTOR, variaveis: [resumoDoModelo(caso, a.tipoDoAviso)] });
        situacao = 'modelo';
      } else if (a.tipoDoAviso === 'decisao') {
        await this.mandarDecisao(a, true);
      } else {
        await this.enviarTexto(a.tenantId, a.provedor, a.telefone, textoDoAviso(caso, a.tipoDoAviso));
      }
      await this.marcar(a.id, situacao, null);
      return true;
    } catch (e: any) {
      const motivo = String(e?.message ?? e).slice(0, 300);
      // Falha passageira (sem resposta, Meta fora): aviso no log, e a rotina tenta de novo (até 3 vezes).
      this.logger.warn(`aviso ${a.id} ao gestor (loja ${a.tenantId}) não saiu: ${motivo}`);
      await this.marcar(a.id, 'falhou', motivo).catch(() => undefined);
      return false;
    }
  }

  private async marcar(id: string, situacao: string, erro: string | null) {
    await this.db.execute(sql`
      update aviso_gestor_whatsapp
         set situacao = ${situacao}::text, erro = ${erro}::text,
             enviado_em = case when ${situacao}::text in ('enviado', 'modelo') then now() else enviado_em end,
             atualizado_em = now()
       where id = ${id}::uuid and situacao = 'enviando'`);
  }

  // ---------------------------------------------------------------- a decisão pelo WhatsApp (parte 5b)

  /** Texto livre ao gestor pela via da loja (sem entrar na caixa de conversas). */
  private async enviarTexto(tenantId: string, provedor: string | null, telefone: string, texto: string) {
    if (provedor === 'cloud') await this.cloud.enviarInterno(tenantId, telefone, { texto });
    else await this.evolution.enviar(tenantId, telefone, texto);
  }

  private casoDe(a: any): CasoDaDecisao {
    return {
      id: a.chamadoId,
      tipo: a.tipo,
      canal: a.canal,
      cliente: a.cliente,
      pedidoNumero: a.pedidoNumero,
      mensagem: a.mensagem,
      prazoEm: a.prazoEm,
      criadoEm: a.criadoEm,
      detalhe: a.detalhe,
      totalCentavos: a.totalCentavos == null ? null : Number(a.totalCentavos),
    };
  }

  /** O número curto do caso na enquete (4 dígitos, sem repetir entre as decisões abertas deste número). */
  private async darCodigo(avisoId: string, tenantId: string, telefone: string): Promise<string> {
    for (let i = 0; i < 8; i++) {
      const c = String(randomInt(1000, 10000));
      const [r] = linhas(
        await this.db.execute(sql`
          update aviso_gestor_whatsapp set codigo = ${c}
           where id = ${avisoId}::uuid and codigo is null
             and not exists (select 1 from aviso_gestor_whatsapp o
                              where o.tenant_id = ${tenantId}::uuid and o.telefone = ${telefone} and o.codigo = ${c}
                                and o.situacao in ('enviando', 'enviado', 'modelo') and o.id <> ${avisoId}::uuid)
          returning codigo`),
      );
      if (r) return String(r.codigo);
      const [ja] = linhas(await this.db.execute(sql`select codigo from aviso_gestor_whatsapp where id = ${avisoId}::uuid`));
      if (ja?.codigo) return String(ja.codigo);
    }
    throw new Error('sem número livre para a enquete');
  }

  /**
   * A decisão no passo em que está: na API oficial, o texto com os botões (ou a lista dos motivos); na conexão por QR, o
   * texto e a enquete com o número do caso em cada opção. `comAviso` = a primeira vez (com o texto do caso). Sem nada a
   * decidir por aqui (nem aceitar nem recusar), vai só o texto com o link.
   */
  private async mandarDecisao(a: any, comAviso: boolean): Promise<void> {
    const caso = this.casoDe(a);
    const limite = lerLimite(a.limite, a.temAjuste === true);
    const passo = passoAtual(caso, lerRascunho(a.escolha), limite);
    const texto = comAviso ? textoDoAviso(caso, 'decisao', new Date(), !!passo) : null;
    if (!passo) {
      if (texto) await this.enviarTexto(a.tenantId, a.provedor, a.telefone, texto);
      return;
    }
    if (a.provedor === 'cloud') {
      const corpo = [texto, passo.aviso, passo.pergunta].filter(Boolean).join('\n\n');
      const opcoes = passo.opcoes.map((o) => ({ id: idDoBotao(a.id, passo.passo, o.valor), titulo: o.titulo }));
      await this.cloud.enviarOpcoes(a.tenantId, a.telefone, corpo, opcoes, passo.passo === 'motivo' ? 'Ver os motivos' : 'Ver as opções', true);
      return;
    }
    const codigo = a.codigo ?? (await this.darCodigo(a.id, a.tenantId, a.telefone));
    a.codigo = codigo;
    const antes = [texto, passo.aviso].filter(Boolean).join('\n\n');
    if (antes) await this.evolution.enviar(a.tenantId, a.telefone, antes);
    await this.evolution.enviarEnquete(a.tenantId, a.telefone, passo.pergunta, passo.opcoes.map((o) => nomeNaEnquete(o.titulo, codigo)));
  }

  /**
   * Os avisos com o caso, o gestor e a régua de "pode decidir AGORA" (V75: ativo, nível, o número ainda ligado a ele, a
   * loja dele, empresa e loja vivas) e o ajuste (ligado, decisões ligadas, o limite).
   */
  private async carregarAvisos(onde: SQL, depois: SQL = sql``): Promise<any[]> {
    return linhas(
      await this.db.execute(sql`
        select a.id, a.tenant_id as "tenantId", a.telefone, a.tipo as "tipoDoAviso", a.situacao, a.codigo, a.escolha,
               a.decisao as "decisaoDoAviso", a.colaborador_id as "colaboradorId",
               ch.id as "chamadoId", ch.tipo, ch.canal, ch.cliente, ch.pedido_numero as "pedidoNumero", ch.mensagem,
               ch.prazo_em as "prazoEm", ch.criado_em as "criadoEm", ch.detalhe, ch.status as "statusDoCaso",
               ch.decisao as "decisaoDoCaso", ch.resolvido_em as "resolvidoEm", ch.responsavel_id as "responsavelId",
               (select r.nome from colaborador r where r.id = ch.resolvido_por_id) as "resolvidoPor",
               ${DO_PEDIDO} as "totalCentavos",
               c.nome, coalesce(p.nivel, f.categoria::text) as nivel,
               (c.deleted_at is null and c.status = 'ativo' and coalesce(p.nivel, f.categoria::text) in (${niveis})
                 and g.ligado_em is not null and g.telefone = a.telefone
                 and (coalesce(p.nivel, f.categoria::text) = 'presidente' or c.unidade_id is null or ch.unidade_id is null
                      or c.unidade_id = ch.unidade_id)
                 and emp.deleted_at is null
                 and (ch.unidade_id is null or exists (select 1 from unidade u where u.id = ch.unidade_id
                                                         and u.tenant_id = ch.tenant_id and u.deleted_at is null))
                 and coalesce(rc.gestor_wa_ligado, false)) as "acessoVale",
               coalesce(rc.gestor_wa_decisoes, true) as "decisoesLigadas",
               rc.gestor_wa_limite_centavos as limite, (rc.tenant_id is not null) as "temAjuste",
               ${PROVEDOR} as provedor
          from aviso_gestor_whatsapp a
          join atendimento_chamado ch on ch.id = a.chamado_id
          join colaborador c on c.id = a.colaborador_id
          left join funcao f on f.id = c.funcao_id
          left join perfil_acesso p on p.id = c.perfil_acesso_id
          left join gestor_whatsapp g on g.tenant_id = a.tenant_id and g.colaborador_id = a.colaborador_id
          left join robo_config rc on rc.tenant_id = a.tenant_id
          join empresa emp on emp.id = a.tenant_id
         where ${onde}
         ${depois}`),
    );
  }

  /** O caso já não espera esta resposta? A frase para o gestor (quem respondeu e quando), ou `null`. */
  private jaEncerrado(a: any): string | null {
    if (a.statusDoCaso !== 'aberto' || a.decisaoDoCaso) {
      const quando = a.resolvidoEm ? ` às ${horaNoFuso(new Date(a.resolvidoEm))}` : '';
      const via = a.detalhe?.resposta?.via === 'whatsapp' ? 'pelo WhatsApp' : 'no Regem';
      const verbo: Record<string, string> = { aceito: 'aceitou', recusado: 'recusou', proposta: 'fez uma proposta' };
      if (a.resolvidoPor)
        return `${a.resolvidoPor} já respondeu${quando}, ${via}: ${verbo[String(a.decisaoDoCaso)] ?? 'resolveu o caso'}. Nada foi enviado de novo.`;
      return `Este caso já foi encerrado${quando}. Nada foi enviado.`;
    }
    if (a.prazoEm && new Date(a.prazoEm).getTime() <= Date.now())
      return `O prazo acabou às ${horaNoFuso(new Date(a.prazoEm))}: a plataforma já decidiu sozinha. Nada foi enviado.`;
    return null;
  }

  private async expirar(id: string) {
    await this.db.execute(sql`
      update aviso_gestor_whatsapp set situacao = 'expirado', atualizado_em = now()
       where id = ${id}::uuid and situacao in ('enviando', 'enviado', 'modelo', 'falhou')`);
  }

  /** Grava o passo escolhido — com condição: o mesmo botão tocado duas vezes (ou em duas réplicas) grava uma vez. */
  private async gravarEscolha(id: string, antes: string | null, depois: Rascunho): Promise<boolean> {
    const [r] = linhas(
      await this.db.execute(sql`
        update aviso_gestor_whatsapp set escolha = ${JSON.stringify(depois)}::text, escolha_em = now(), atualizado_em = now()
         where id = ${id}::uuid and decisao is null and situacao = 'enviado' and escolha is not distinct from ${antes ?? null}::text
        returning id`),
    );
    return !!r;
  }

  /** O "Ver por aqui" e o toque numa decisão — vindos da entrada do WhatsApp (nunca rejeita: V3). */
  @OnEvent(EVENTO_RESPOSTA_DO_GESTOR)
  aoResponder(p: RespostaDoGestor) {
    void this.responder(p).catch((e: any) => this.logger.warn(`resposta do gestor (loja ${p?.tenantId}) não tratada: ${e?.message ?? e}`));
  }

  async responder(p: RespostaDoGestor): Promise<void> {
    const provedor = (await this.viaDaLoja(p.tenantId)).provedor;
    const dizer = (t: string) => this.enviarTexto(p.tenantId, provedor, p.telefone, t);
    if (p.tipo === 'ver') return this.verPorAqui(p, dizer);

    const botao = lerIdDoBotao(p.opcaoId);
    const voto = botao ? null : lerVotoDaEnquete(p.texto);
    if (!botao && !voto) return;
    // O aviso é o do botão — e só vale do MESMO número para onde saiu.
    const [a] = botao
      ? await this.carregarAvisos(sql`a.id = ${botao.avisoId}::uuid and a.tenant_id = ${p.tenantId}::uuid and a.telefone = ${p.telefone} and a.tipo = 'decisao'`)
      : await this.carregarAvisos(
          sql`a.tenant_id = ${p.tenantId}::uuid and a.telefone = ${p.telefone} and a.codigo = ${voto!.codigo} and a.tipo = 'decisao'`,
          sql`order by a.criado_em desc limit 1`,
        );
    if (!a) return dizer('Não achei a decisão deste botão. Abra o caso no Regem.');
    const link = linkDoCaso(a.chamadoId);
    if (a.acessoVale !== true || a.decisoesLigadas !== true)
      return dizer(`Este WhatsApp não decide mais por aqui: o acesso ou o ajuste mudou. Abra o caso no Regem: ${link}`);
    const encerrado = this.jaEncerrado(a);
    if (encerrado) {
      await this.expirar(a.id);
      return dizer(encerrado);
    }
    if (a.decisaoDoAviso === 'enviando') return dizer('Já estou enviando a sua resposta. Um instante.');
    if (a.situacao !== 'enviado') return dizer(`Esta decisão não vale mais por aqui. Abra o caso no Regem: ${link}`);

    const caso = this.casoDe(a);
    const limite = lerLimite(a.limite, a.temAjuste === true);
    const r = lerRascunho(a.escolha);
    const esc = botao ? { passo: botao.passo, valor: botao.valor } : escolhaPeloTitulo(caso, r, limite, voto!.titulo);
    const res = esc ? aplicarEscolha(caso, r, limite, esc.passo, esc.valor) : null;
    if (!res) {
      // Botão de uma mensagem anterior (ou o limite mudou): manda o passo de agora.
      await dizer('Esse botão é de uma mensagem anterior. Use o da mensagem abaixo.');
      return this.mandarDecisao(a, false);
    }
    if (res.tipo === 'confirmar') return this.executar(a, caso, r, limite, dizer);
    const novo: Rascunho = res.tipo === 'voltar' ? {} : res.rascunho;
    if (!(await this.gravarEscolha(a.id, a.escolha ?? null, novo))) return; // o mesmo toque já foi gravado
    a.escolha = JSON.stringify(novo);
    return this.mandarDecisao(a, false);
  }

  /**
   * Confirmado: executa pelo MESMO serviço da tela (V43), com quem decidiu já conferido — no lugar da senha. Uma vez só:
   * a vez é gravada antes (dois toques ou duas réplicas não mandam em dobro); falhou, a vez volta e o gestor pode tocar
   * de novo. O limite é conferido de novo aqui, com o valor de agora (V74).
   */
  private async executar(a: any, caso: CasoDaDecisao, r: Rascunho, limite: number | null, dizer: (t: string) => Promise<void>) {
    const link = linkDoCaso(a.chamadoId);
    const valor = valorDoAceite(caso);
    if (r.acao === 'aceitar' && !podeAceitar(valor, limite)) {
      await this.gravarEscolha(a.id, a.escolha ?? null, {});
      return dizer(`Acima do seu limite pelo WhatsApp: para aceitar, abra no Regem e confirme com a sua senha: ${link}`);
    }
    const [vez] = linhas(
      await this.db.execute(sql`
        update aviso_gestor_whatsapp set decisao = 'enviando', atualizado_em = now()
         where id = ${a.id}::uuid and decisao is null and situacao = 'enviado' and escolha is not distinct from ${a.escolha ?? null}::text
        returning id`),
    );
    if (!vez) return;
    const quem = { id: a.colaboradorId as string, nome: a.nome as string, nivel: a.nivel as string };
    try {
      if (caso.tipo === 'disputa') {
        if (!this.disputa) throw new Error('a resposta ao iFood não está disponível neste servidor');
        await this.disputa.responderComo(a.tenantId, a.chamadoId, { acao: r.acao, motivo: r.motivo }, quem);
      } else if (caso.tipo === 'cancelamento_99' || caso.tipo === 'reembolso_99') {
        if (!this.pedido99) throw new Error('a resposta à 99 não está disponível neste servidor');
        const motivo = caso.tipo === 'cancelamento_99' ? { motivo: r.motivo } : { motivoId: r.motivo };
        await this.pedido99.responderComo(a.tenantId, a.chamadoId, { aceita: r.acao === 'aceitar', ...motivo }, quem);
      } else {
        if (!this.atendimento) throw new Error('o cancelamento não está disponível neste servidor');
        await this.atendimento.decidirCancelamento(
          { tenantId: a.tenantId, colaboradorId: quem.id, categoria: quem.nivel } as AuthUser,
          a.chamadoId,
          { aceita: r.acao === 'aceitar', reaproveitado: r.reaproveitado !== false },
          null,
          { id: quem.id, nome: quem.nome },
        );
      }
    } catch (e: any) {
      const motivo = String(e?.message ?? e).slice(0, 300);
      await this.db.execute(sql`
        update aviso_gestor_whatsapp set decisao = null, erro = ${motivo}::text, atualizado_em = now()
         where id = ${a.id}::uuid and decisao = 'enviando'`);
      this.logger.warn(`decisão pelo WhatsApp (aviso ${a.id}, loja ${a.tenantId}) não saiu: ${motivo}`);
      if (e instanceof ConflictException) {
        await this.expirar(a.id);
        return dizer(`${e.message} Nada foi enviado de novo.`);
      }
      return dizer(`Não deu: ${motivo} Toque em Confirmar de novo ou responda pelo Regem: ${link}`);
    }
    await this.db.execute(sql`
      update aviso_gestor_whatsapp
         set situacao = 'respondido', decisao = ${r.acao === 'aceitar' ? 'aceito' : 'recusado'}::text, respondido_em = now(),
             erro = null, atualizado_em = now()
       where id = ${a.id}::uuid`);
    // Os outros gestores que receberam o mesmo caso: o botão deles fica sabendo quem respondeu (pelo caso encerrado).
    await this.db.execute(sql`
      update aviso_gestor_whatsapp set situacao = 'expirado', atualizado_em = now()
       where chamado_id = ${a.chamadoId}::uuid and id <> ${a.id}::uuid and situacao in ('enviando', 'enviado', 'modelo', 'falhou')`);
    await this.auditoria?.registrar({
      tenantId: a.tenantId,
      atorId: quem.id,
      atorPerfil: quem.nivel,
      tipo: 'atendimento',
      acao: 'decidiu_pelo_whatsapp',
      entidadeTipo: 'atendimento_chamado',
      entidadeId: a.chamadoId,
      origem: 'whatsapp',
      detalhe: {
        aviso: a.id,
        tipo: caso.tipo,
        acao: r.acao,
        motivo: r.motivo ?? null,
        reaproveitado: r.reaproveitado ?? null,
        valorCentavos: valor,
        limiteCentavos: limite,
        final: finalDoNumero(a.telefone),
      },
    });
    await dizer(`✅ Feito: ${textoDoFeito(caso, r, valor)}. No histórico do caso: ${a.nome}, pelo WhatsApp, ${horaNoFuso(new Date())}.`);
  }

  /** "Ver por aqui" (o botão do modelo): manda o texto — e os botões da decisão — do que ainda vale; o resto expira. */
  private async verPorAqui(p: RespostaDoGestor, dizer: (t: string) => Promise<void>) {
    const pendentes = await this.carregarAvisos(
      sql`a.tenant_id = ${p.tenantId}::uuid and a.colaborador_id = ${p.colaboradorId}::uuid and a.telefone = ${p.telefone} and a.situacao = 'modelo'`,
      sql`order by ch.prazo_em nulls last, ch.criado_em limit 10`,
    );
    const vale = (a: any) =>
      a.acessoVale === true &&
      !this.jaEncerrado(a) &&
      (a.tipoDoAviso !== 'ninguem_pegou' || !a.responsavelId) &&
      (a.tipoDoAviso !== 'decisao' || a.decisoesLigadas === true);
    for (const a of pendentes.filter((x) => !vale(x))) await this.expirar(a.id);
    const validos = pendentes.filter(vale);
    if (!validos.length) {
      await dizer('Nada esperando por você agora: o caso já foi respondido ou pegou alguém. O que chegar de novo aparece aqui.');
      return;
    }
    for (const a of validos) {
      // A vez de mandar (o "Ver por aqui" tocado duas vezes manda uma).
      const [vez] = linhas(
        await this.db.execute(sql`
          update aviso_gestor_whatsapp set situacao = 'enviado', enviado_em = now(), atualizado_em = now()
           where id = ${a.id}::uuid and situacao = 'modelo' returning id`),
      );
      if (!vez) continue;
      if (a.tipoDoAviso === 'decisao') await this.mandarDecisao({ ...a, situacao: 'enviado' }, true);
      else await dizer(textoDoAviso(this.casoDe(a), 'ninguem_pegou'));
    }
  }
}
