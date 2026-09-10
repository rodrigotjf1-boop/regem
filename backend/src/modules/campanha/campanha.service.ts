import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { and, eq, sql } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { campanha, campanhaEnvio, cliente, cupom, marketingOptout } from '../../db/schema';
import { WhatsappService } from '../whatsapp/whatsapp.service';
import { WhatsappNumeroService } from '../whatsapp/whatsapp-numero.service';
import { WhatsappCloudService } from '../whatsapp/whatsapp-cloud.service';

/* eslint-disable @typescript-eslint/no-explicit-any */
// Base pública p/ o link rastreado do clique (redireciona pro link real da campanha).
const PUB = (process.env.PUBLIC_API_BASE || 'https://api.dmsregem.com/api/v1').replace(/\/+$/, '');

// Campanhas de WhatsApp por segmento (épico 2 provedores). USO INTERNO do lojista,
// sempre por tenant. Envio pelo NÚMERO DE MARKETING (ou principal), resolvido pelo
// modelo novo (whatsapp_numero), PAUSADO (anti-ban), respeitando opt-out + lista de
// exclusão + agendamento (dias/horários/tetos). Worker resiliente (retoma pendentes).
@Injectable()
export class CampanhaService {
  private readonly logger = new Logger('Campanha');
  private rodando = false;
  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly whatsapp: WhatsappService,
    private readonly numeros: WhatsappNumeroService,
    private readonly cloud: WhatsappCloudService,
  ) {}

  // Fragmento SQL do segmento (mesma lógica do CRM; alias da tabela = `c`).
  // `recuperacaoDias` permite recência customizada ("não pede há N dias").
  private segFrag(segmento?: string, recuperacaoDias?: number) {
    if (segmento === 'recuperacao' && recuperacaoDias && recuperacaoDias > 0)
      return sql`and c.ultimo_pedido_em < now() - (${recuperacaoDias} || ' days')::interval`;
    const m: Record<string, any> = {
      mes: sql`and c.ultimo_pedido_em >= date_trunc('month', now() at time zone 'America/Sao_Paulo')`,
      '30d': sql`and c.ultimo_pedido_em >= now() - interval '30 days'`,
      sem_30: sql`and c.ultimo_pedido_em < now() - interval '30 days'`,
      sem_60: sql`and c.ultimo_pedido_em < now() - interval '60 days'`,
      campeoes: sql`and (select count(*) from pedido_externo p where p.cliente_id = c.id and p.status <> 'cancelado' and p.criado_em >= now() - interval '30 days') >= 3`,
    };
    return m[String(segmento ?? '')] ?? sql``;
  }

  // Dígitos do telefone SEM um eventual DDI 55 (12-13 dígitos) — normaliza p/ casar
  // números vindos do WhatsApp (chegam com 55) com os do cadastro (sem 55) e formatações.
  private telExpr(col: string): string {
    const d = `regexp_replace(coalesce(${col},''),'\\D','','g')`;
    return `(case when length(${d}) in (12,13) and left(${d},2)='55' then substr(${d},3) else ${d} end)`;
  }

  // Filtro de exclusão: sem opt-out de cliente E fora da lista de exclusão por telefone.
  // Compara telefones NORMALIZADOS (sem 55/formatação) — senão o opt-out por "SAIR"
  // (que chega com 55) nunca casaria com o cadastro (sem 55).
  private excluidos() {
    return sql`and c.opt_out_marketing = false and coalesce(c.telefone,'') <> ''
      and not exists (select 1 from marketing_optout mo where mo.tenant_id = c.tenant_id
        and ${sql.raw(this.telExpr('mo.telefone'))} = ${sql.raw(this.telExpr('c.telefone'))})`;
  }

  // Público estimado (quem receberia): do segmento, com telefone, exceto excluídos.
  async previa(tenantId: string, segmento: string, recuperacaoDias?: number) {
    const r: any = await this.db.execute(sql`
      select count(*)::int as total from cliente c
      where c.tenant_id = ${tenantId} ${this.excluidos()} ${this.segFrag(segmento, recuperacaoDias)}`);
    return { total: (r.rows ?? r)[0]?.total ?? 0 };
  }

  async listar(tenantId: string) {
    const r: any = await this.db.execute(sql`
      select id, segmento, tipo, mensagem, link, imagem_ref, intervalo_seg, teto_dia, teto_semana,
             teto_mes, agendada, dias_semana, hora_inicio, hora_fim, cupom_codigo,
             total, enviados, falhas, status, criado_em
      from campanha where tenant_id = ${tenantId} order by criado_em desc limit 50`);
    return r.rows ?? r;
  }

  // Métricas/ROI de uma campanha (Fase 5): enviados/falhas + cupons resgatados (se a
  // campanha vinculou cupom) + PEDIDOS ATRIBUÍDOS (quem recebeu e pediu até 7 dias depois
  // do envio) com valor. Atribuição por cliente_id + janela de tempo. Sem migration.
  async metricas(tenantId: string, campId: string) {
    const r: any = await this.db.execute(sql`
      select id, cupom_codigo, criado_em, total, enviados, falhas, status, cliques, mensagem_b
      from campanha where id = ${campId} and tenant_id = ${tenantId} limit 1`);
    const camp = (r.rows ?? r)[0];
    if (!camp) throw new BadRequestException('Campanha não encontrada.');

    let cupomResgates = 0;
    if (camp.cupom_codigo) {
      const cr: any = await this.db.execute(sql`
        select count(*)::int as n from cupom_uso cu
          join cupom c on c.id = cu.cupom_id
         where c.tenant_id = ${tenantId} and upper(c.codigo) = upper(${camp.cupom_codigo})
           and cu.usado_em >= ${camp.criado_em}`);
      cupomResgates = (cr.rows ?? cr)[0]?.n ?? 0;
    }

    const pa: any = await this.db.execute(sql`
      select count(distinct p.id)::int as pedidos, coalesce(sum(p.total), 0)::float as valor
      from campanha_envio e
      join pedido_externo p on p.cliente_id = e.cliente_id
      where e.campanha_id = ${campId} and e.status = 'enviado' and e.cliente_id is not null
        and p.criado_em >= e.enviado_em and p.criado_em <= e.enviado_em + interval '7 days'
        and p.status <> 'cancelado'`);
    const row = (pa.rows ?? pa)[0] ?? {};

    // Se houve teste A/B, quebra enviados/cliques/pedidos por variante.
    let ab: any = null;
    if (camp.mensagem_b) {
      const abr: any = await this.db.execute(sql`
        select e.variante,
               count(*) filter (where e.status = 'enviado')::int as enviados,
               count(*) filter (where e.clicou)::int as cliques,
               count(distinct p.id)::int as pedidos
        from campanha_envio e
        left join pedido_externo p on p.cliente_id = e.cliente_id and p.status <> 'cancelado'
             and p.criado_em >= e.enviado_em and p.criado_em <= e.enviado_em + interval '7 days'
        where e.campanha_id = ${campId} and e.variante is not null
        group by e.variante order by e.variante`);
      ab = (abr.rows ?? abr);
    }

    return {
      total: camp.total,
      enviados: camp.enviados,
      falhas: camp.falhas,
      status: camp.status,
      cupomCodigo: camp.cupom_codigo ?? null,
      cupomResgates,
      pedidos: row.pedidos ?? 0,
      valor: row.valor ?? 0,
      cliques: camp.cliques ?? 0,
      ab,
    };
  }

  // Registra o CLIQUE no link rastreado (uma vez por envio) e devolve o link real p/
  // o redirect público fazer o 302. Best-effort — não quebra o redirect se algo falhar.
  async registrarClique(envioId: string): Promise<string | null> {
    const cur: any = await this.db.execute(sql`
      select e.campanha_id, e.clicou, c.link
      from campanha_envio e join campanha c on c.id = e.campanha_id
      where e.id = ${envioId} limit 1`);
    const row = (cur.rows ?? cur)[0];
    if (!row) return null;
    if (!row.clicou) {
      await this.db.execute(sql`update campanha_envio set clicou = true, clicado_em = now() where id = ${envioId}`);
      await this.db.execute(sql`update campanha set cliques = cliques + 1, atualizado_em = now() where id = ${row.campanha_id}`);
    }
    return row.link ?? null;
  }

  // Cria (ou agenda) uma campanha e MATERIALIZA os destinatários numa única query
  // (set-based — nunca loop N), excluindo opt-out + lista de exclusão.
  async criar(
    tenantId: string,
    criadoPor: string | null,
    unidadeId: string | null,
    dto: {
      segmento?: string;
      recuperacaoDias?: number;
      tipo?: string;
      mensagem?: string;
      mensagemB?: string | null;
      link?: string | null;
      imagemRef?: string | null;
      intervaloSeg?: number;
      tetoDia?: number | null;
      tetoSemana?: number | null;
      tetoMes?: number | null;
      instanciaTipo?: string;
      agendada?: boolean;
      diasSemana?: number[] | null;
      horaInicio?: string | null;
      horaFim?: string | null;
      iniciaEm?: string | null;
      terminaEm?: string | null;
      // cupom automático
      criarCupom?: boolean;
      cupomCodigo?: string | null;
      cupomTipo?: string; // percentual | valor | fretegratis
      cupomValor?: number;
      cupomDuracaoDias?: number | null;
      cupomValidade?: string | null;
      cupomMaxPorCliente?: number | null;
      // API oficial (cloud): template aprovado + mapa de variáveis {{n}} -> campo/literal.
      templateNome?: string | null;
      templateIdioma?: string | null;
      templateVars?: Record<string, string> | null;
    },
  ) {
    const mensagem = String(dto.mensagem ?? '').trim();
    if (mensagem.length < 3) throw new BadRequestException('Mensagem muito curta.');
    if (mensagem.length > 900) throw new BadRequestException('Mensagem muito longa (máx. 900 caracteres).');
    const segmento = String(dto.segmento ?? 'todos');
    const tipo = String(dto.tipo ?? 'avulsa');
    const intervaloSeg = Math.min(Math.max(Number(dto.intervaloSeg) || 7, 3), 120);
    const tetoDia = dto.tetoDia != null && Number(dto.tetoDia) > 0 ? Number(dto.tetoDia) : null;
    const tetoSemana = dto.tetoSemana != null && Number(dto.tetoSemana) > 0 ? Number(dto.tetoSemana) : null;
    const tetoMes = dto.tetoMes != null && Number(dto.tetoMes) > 0 ? Number(dto.tetoMes) : null;
    const instanciaTipo = dto.instanciaTipo === 'marketing' ? 'marketing' : 'loja';
    const papel = instanciaTipo === 'marketing' ? 'marketing' : 'principal';

    // Resolve o NÚMERO por papel no modelo novo. Cloud (oficial) SÓ dispara via MODELO
    // aprovado (a Meta não aceita texto livre p/ iniciar). Evolution exige nº conectado.
    const num = await this.numeros.resolver(tenantId, papel);
    if (num.provedor === 'cloud') {
      if (!dto.templateNome)
        throw new BadRequestException(
          'Este número usa a API oficial da Meta: a campanha exige um MODELO (template) aprovado. ' +
            'Crie/selecione um modelo em Marketing · Modelos.',
        );
    } else if (!num.instancia) {
      throw new BadRequestException(
        instanciaTipo === 'marketing'
          ? 'Número de marketing não conectado. Conecte antes de enviar por ele.'
          : 'WhatsApp da loja não conectado.',
      );
    }

    // Cupom automático (frete grátis / cupom): cria se não existir e o lojista pediu.
    const cupomCodigo = await this.garantirCupom(tenantId, unidadeId, tipo, dto);

    const [camp] = await this.db
      .insert(campanha)
      .values({
        tenantId,
        criadoPor: criadoPor ?? null,
        segmento,
        tipo,
        mensagem,
        mensagemB: dto.mensagemB?.trim() || null,
        link: dto.link?.trim() || null,
        imagemRef: dto.imagemRef?.trim() || null,
        intervaloSeg,
        tetoDia,
        tetoSemana,
        tetoMes,
        instanciaTipo,
        agendada: !!dto.agendada,
        diasSemana: dto.diasSemana && dto.diasSemana.length ? dto.diasSemana : null,
        horaInicio: dto.horaInicio || null,
        horaFim: dto.horaFim || null,
        iniciaEm: dto.iniciaEm ? new Date(dto.iniciaEm) : null,
        terminaEm: dto.terminaEm ? new Date(dto.terminaEm) : null,
        cupomCodigo,
        templateNome: dto.templateNome || null,
        templateIdioma: dto.templateIdioma || 'pt_BR',
        templateVars: dto.templateVars ?? null,
      })
      .returning();

    // A/B: se tem mensagem B, sorteia a variante de cada destinatário (~50/50); senão, 'A'.
    const temAB = !!(dto.mensagemB && dto.mensagemB.trim());
    const varFrag = temAB ? sql`case when random() < 0.5 then 'B' else 'A' end` : sql`'A'`;
    const ins: any = await this.db.execute(sql`
      insert into campanha_envio (campanha_id, tenant_id, cliente_id, telefone, variante)
      select ${camp.id}, c.tenant_id, c.id, c.telefone, ${varFrag}
      from cliente c
      where c.tenant_id = ${tenantId} ${this.excluidos()} ${this.segFrag(segmento, dto.recuperacaoDias)}`);
    const total = ins.rowCount ?? 0;
    await this.db
      .update(campanha)
      .set({ total, status: total > 0 ? 'enviando' : 'concluida', atualizadoEm: new Date() })
      .where(eq(campanha.id, camp.id));
    return { id: camp.id, total, cupomCodigo };
  }

  // Cria o cupom da campanha se não existir (frete grátis vira 'fretegratis'). Duração
  // por dias (validade = hoje + N) ou data fixa. Se não pediu criar, só referencia o código.
  private async garantirCupom(tenantId: string, unidadeId: string | null, tipoCampanha: string, dto: any) {
    const codigo = String(dto.cupomCodigo ?? '').trim().toUpperCase();
    if (!codigo) return null;
    const [ja] = await this.db
      .select({ id: cupom.id })
      .from(cupom)
      .where(and(eq(cupom.tenantId, tenantId), sql`upper(codigo) = ${codigo}`));
    if (ja || !dto.criarCupom) return codigo;
    const tipo =
      tipoCampanha === 'frete_gratis'
        ? 'fretegratis'
        : ['valor', 'fretegratis'].includes(dto.cupomTipo)
          ? dto.cupomTipo
          : 'percentual';
    const validade = dto.cupomDuracaoDias
      ? new Date(Date.now() + Number(dto.cupomDuracaoDias) * 86400000).toISOString().slice(0, 10)
      : dto.cupomValidade || null;
    await this.db.insert(cupom).values({
      tenantId,
      unidadeId: unidadeId ?? null,
      codigo,
      tipo,
      valor: String(Number(dto.cupomValor) || 0),
      validade,
      maxPorCliente: dto.cupomMaxPorCliente ? Number(dto.cupomMaxPorCliente) : null,
      ativo: true,
    });
    return codigo;
  }

  // Cliente opta por não receber campanhas (LGPD). Escopo por tenant.
  async toggleOptOut(tenantId: string, clienteId: string, optOut: boolean) {
    if (!clienteId) throw new BadRequestException('Cliente inválido.');
    await this.db
      .update(cliente)
      .set({ optOutMarketing: !!optOut, atualizadoEm: new Date() })
      .where(and(eq(cliente.tenantId, tenantId), eq(cliente.id, clienteId)));
    return { ok: true, optOut: !!optOut };
  }

  // Adiciona um TELEFONE à lista de exclusão (opt-out). Cobre quem não é cliente
  // cadastrado (ex.: veio de "SAIR" numa conversa, ou de um link de descadastro).
  async optOutPorTelefone(tenantId: string, telefone: string, motivo = 'manual') {
    const tel = String(telefone ?? '').replace(/\D/g, '');
    if (!tel) throw new BadRequestException('Telefone inválido.');
    await this.db
      .insert(marketingOptout)
      .values({ tenantId, telefone: tel, motivo })
      .onConflictDoNothing();
    // Reflete no cliente cadastrado, se houver.
    await this.db.execute(sql`
      update cliente set opt_out_marketing = true, atualizado_em = now()
      where tenant_id = ${tenantId} and regexp_replace(coalesce(telefone,''), '\\D', '', 'g') = ${tel}`);
    return { ok: true };
  }

  // Lista de exclusão (opt-out) para VISIBILIDADE do lojista — só leitura. A lista
  // cresce sozinha (cliente clica "sair"); o lojista não adiciona nem edita. Junta o
  // nome do cliente cadastrado quando o telefone casa (normalizado).
  async listarOptout(tenantId: string) {
    const r: any = await this.db.execute(sql`
      select mo.telefone, mo.motivo, mo.criado_em,
        (select c.nome from cliente c where c.tenant_id = mo.tenant_id
          and ${sql.raw(this.telExpr('c.telefone'))} = ${sql.raw(this.telExpr('mo.telefone'))} limit 1) as nome
      from marketing_optout mo
      where mo.tenant_id = ${tenantId}
      order by mo.criado_em desc
      limit 500`);
    return (r.rows ?? r) as any[];
  }

  // Agora em São Paulo (dia 0=dom..6=sáb, hh:mm) — p/ a janela de agendamento.
  private agoraSp(): { dia: number; hhmm: string } {
    const agora = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
    return {
      dia: agora.getDay(),
      hhmm: `${String(agora.getHours()).padStart(2, '0')}:${String(agora.getMinutes()).padStart(2, '0')}`,
    };
  }

  // A campanha pode disparar AGORA? (só as agendadas têm janela; as demais mandam sempre.)
  private dentroDaJanela(camp: any): boolean {
    if (!camp.agendada) return true;
    const agora = new Date();
    if (camp.inicia_em && agora < new Date(camp.inicia_em)) return false;
    if (camp.termina_em && agora > new Date(camp.termina_em)) return false;
    const { dia, hhmm } = this.agoraSp();
    const dias: number[] | null = camp.dias_semana ?? null;
    if (Array.isArray(dias) && dias.length && !dias.map(Number).includes(dia)) return false;
    const ini = camp.hora_inicio as string | null;
    const fim = camp.hora_fim as string | null;
    if (ini && fim) {
      const h = hhmm + ':00';
      // Janela normal (ini<=fim) ou virando a meia-noite (ini>fim).
      if (ini <= fim ? !(h >= ini && h <= fim) : !(h >= ini || h <= fim)) return false;
    }
    return true;
  }

  // Conta enviados de uma campanha num período (dia/semana/mês, fuso SP) p/ os tetos.
  private async enviadosNoPeriodo(campId: string, trunc: 'day' | 'week' | 'month'): Promise<number> {
    const r: any = await this.db.execute(sql`
      select count(*)::int as n from campanha_envio
      where campanha_id = ${campId} and status = 'enviado'
        and enviado_em >= date_trunc(${trunc}, now() at time zone 'America/Sao_Paulo')`);
    return (r.rows ?? r)[0]?.n ?? 0;
  }

  // Monta os params ({{1}},{{2}}…) do template pela campanha: cada índice mapeia p/ um
  // campo do cliente ('nome') ou um literal. Só o 'nome' é lido do banco (sem PII extra).
  private async paramsTemplate(camp: any, clienteId: string | null): Promise<string[]> {
    const vars = (camp.template_vars ?? {}) as Record<string, string>;
    const idxs = Object.keys(vars)
      .map(Number)
      .filter((n) => !Number.isNaN(n))
      .sort((a, b) => a - b);
    if (!idxs.length) return [];
    let primeiro = 'cliente';
    if (clienteId && idxs.some((i) => String(vars[String(i)]) === 'nome')) {
      const r: any = await this.db.execute(sql`select nome from cliente where id = ${clienteId} limit 1`);
      const nome = String((r.rows ?? r)[0]?.nome ?? '').trim();
      if (nome) primeiro = nome.split(/\s+/)[0];
    }
    return idxs.map((i) => {
      const campo = String(vars[String(i)] ?? '');
      return campo === 'nome' ? primeiro : campo || primeiro;
    });
  }

  // Worker: a cada tick, envia 1 mensagem por campanha PRONTA (pacing por intervalo_seg),
  // respeitando janela de agendamento + tetos dia/semana/mês. Só na nuvem; nunca sobrepõe.
  @Interval(3000)
  async worker() {
    if (String(process.env.EDGE_MODE ?? '').toLowerCase() === 'true') return;
    if (this.rodando) return;
    this.rodando = true;
    try {
      const prontas: any = await this.db.execute(sql`
        select id, tenant_id, mensagem, mensagem_b, link, imagem_ref, intervalo_seg, teto_dia,
               teto_semana, teto_mes, instancia_tipo, agendada, dias_semana, hora_inicio, hora_fim,
               inicia_em, termina_em, template_nome, template_idioma, template_vars
        from campanha
        where status = 'enviando'
          and (select coalesce(max(enviado_em), to_timestamp(0)) from campanha_envio e
               where e.campanha_id = campanha.id and e.status = 'enviado')
              < now() - (intervalo_seg || ' seconds')::interval
        limit 20`);
      for (const camp of prontas.rows ?? prontas) {
        // Fora da janela de agendamento → não envia agora (fica 'enviando' p/ o próximo tick).
        if (!this.dentroDaJanela(camp)) continue;
        // Tetos por período.
        if (camp.teto_dia && (await this.enviadosNoPeriodo(camp.id, 'day')) >= camp.teto_dia) continue;
        if (camp.teto_semana && (await this.enviadosNoPeriodo(camp.id, 'week')) >= camp.teto_semana) continue;
        if (camp.teto_mes && (await this.enviadosNoPeriodo(camp.id, 'month')) >= camp.teto_mes) continue;

        const prox: any = await this.db.execute(sql`
          select id, telefone, cliente_id, variante from campanha_envio
          where campanha_id = ${camp.id} and status = 'pendente' order by id limit 1`);
        const envio = (prox.rows ?? prox)[0];
        if (!envio) {
          await this.db
            .update(campanha)
            .set({ status: 'concluida', atualizadoEm: new Date() })
            .where(eq(campanha.id, camp.id));
          continue;
        }
        const tel = String(envio.telefone).replace(/\D/g, '');
        // Reverifica o opt-out no MOMENTO do envio: o cliente pode ter saído DEPOIS da
        // criação da campanha. Sem isso, o envio pendente ainda seria disparado.
        const telN = (tel.length === 12 || tel.length === 13) && tel.startsWith('55') ? tel.slice(2) : tel;
        const optou: any = await this.db.execute(sql`
          select 1 from marketing_optout mo where mo.tenant_id = ${camp.tenant_id}
            and ${sql.raw(this.telExpr('mo.telefone'))} = ${telN} limit 1`);
        if ((optou.rows ?? optou).length) {
          await this.db
            .update(campanhaEnvio)
            .set({ status: 'excluido' })
            .where(eq(campanhaEnvio.id, envio.id));
          continue;
        }
        const numero = tel.length === 10 || tel.length === 11 ? '55' + tel : tel;
        // A/B: usa a mensagem da variante do destinatário. Link vai RASTREADO (redirect
        // por envio) p/ medir cliques; sem link, nada é anexado.
        const msgVar =
          envio.variante === 'B' && camp.mensagem_b ? String(camp.mensagem_b) : String(camp.mensagem ?? '');
        const linkTrack = camp.link ? `${PUB}/publico/campanha/r/${envio.id}` : '';
        const caption = [msgVar, linkTrack].filter(Boolean).join('\n');
        try {
          const papel = camp.instancia_tipo === 'marketing' ? 'marketing' : 'principal';
          const num = await this.numeros.resolver(camp.tenant_id, papel);
          if (num.provedor === 'cloud') {
            // API oficial: dispara o MODELO aprovado, preenchendo as variáveis.
            if (!camp.template_nome) throw new Error('Campanha oficial sem modelo.');
            const params = await this.paramsTemplate(camp, envio.cliente_id);
            await this.cloud.enviarTemplate(camp.tenant_id, numero, camp.template_nome, camp.template_idioma || 'pt_BR', params, {
              envioId: envio.id, // botão URL rastreado (.../r/:envioId) → clique medido
              cupom: camp.cupom_codigo, // botão "copiar cupom"
              phoneId: num.phoneId || undefined, // dispara pelo número do papel (marketing na Oficial)
            });
          } else {
            if (!num.instancia) throw new Error('Número não conectado.');
            if (camp.imagem_ref)
              await this.whatsapp.enviarMidiaPorInstancia(camp.tenant_id, num.instancia, numero, camp.imagem_ref, caption);
            else await this.whatsapp.enviarPorInstancia(camp.tenant_id, num.instancia, numero, caption);
          }
          await this.db
            .update(campanhaEnvio)
            .set({ status: 'enviado', enviadoEm: new Date() })
            .where(eq(campanhaEnvio.id, envio.id));
          await this.db.execute(sql`update campanha set enviados = enviados + 1, atualizado_em = now() where id = ${camp.id}`);
        } catch (e: any) {
          await this.db
            .update(campanhaEnvio)
            .set({ status: 'falha', erro: String(e?.message ?? e).slice(0, 300), enviadoEm: new Date() })
            .where(eq(campanhaEnvio.id, envio.id));
          await this.db.execute(sql`update campanha set falhas = falhas + 1, atualizado_em = now() where id = ${camp.id}`);
        }
      }
    } catch (e: any) {
      this.logger.warn(`worker: ${e?.message ?? e}`);
    } finally {
      this.rodando = false;
    }
  }
}
