import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { createHash } from 'crypto';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { pedidoExterno } from '../../db/schema';
import { AuthUser } from '../../auth/auth-user';
import { DeliveryService } from '../delivery/delivery.service';
import { ClienteService } from '../cliente/cliente.service';
import { geocode, montarEndereco } from '../../common/geocode';

/* eslint-disable @typescript-eslint/no-explicit-any */
// App do Entregador. Auth reusa o login de colaborador (JWT já traz nome/função/
// permissões). Sempre por tenant; reusa a lógica de despacho do DeliveryService.
@Injectable()
export class EntregadorService {
  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly delivery: DeliveryService,
    private readonly cliente: ClienteService,
  ) {}

  private ehEntregador(user: AuthUser): boolean {
    return /entregador/i.test(user.funcaoNome ?? '');
  }

  // O QR do cupom leva {base}/e/{token}; o app pode mandar a URL inteira ou só o token.
  private tokenDe(codigo: string): string {
    const s = String(codigo ?? '').trim();
    const m = s.match(/\/e\/([a-z0-9]+)/i);
    return (m ? m[1] : s).replace(/[^a-z0-9]/gi, '');
  }

  private resumo(p: any) {
    return {
      id: p.id,
      numero: p.numero,
      displayId: p.displayId,
      canal: p.canal,
      cliente: p.clienteNome,
      telefone: p.clienteTelefone,
      endereco:
        [p.endereco, p.enderecoNumero, p.enderecoBairro, p.enderecoReferencia]
          .filter(Boolean)
          .join(', ') || null,
      itens: p.itens ?? [],
      total: Number(p.total) || 0,
      taxaEntrega: Number(p.taxaEntrega) || 0, // taxa da entrega (compõe os ganhos do entregador)
      pago: p.pago,
      formaPagamento: p.formaPagamento,
      status: p.status,
      // Entrega própria (cardápio/local, não marketplace) com código de 4 díg. do cliente:
      // o app exige o código pra concluir. NÃO expõe o código em si (o cliente o informa).
      precisaCodigo:
        p.tipo !== 'retirada' &&
        !['ifood', '99food'].includes(String(p.canal)) &&
        !!p.codigoEntrega,
      // HASH (SHA-256) do código de entrega própria — o app verifica OFFLINE comparando o
      // hash do que o cliente digitar. NUNCA manda o código em texto (o entregador não vê).
      codigoEntregaHash:
        p.tipo !== 'retirada' &&
        !['ifood', '99food'].includes(String(p.canal)) &&
        p.codigoEntrega
          ? createHash('sha256').update(String(p.codigoEntrega)).digest('hex')
          : null,
      raw: p.raw ?? null, // p/ o app detectar entrega própria de marketplace (código do canal)
    };
  }

  // ===== E0 =====
  perfil(user: AuthUser) {
    const funcao = user.funcaoNome ?? '';
    const p: any = user.permissoes ?? {};
    return {
      nome: user.nome ?? null,
      funcao,
      ehEntregador: this.ehEntregador(user),
      permissoes: {
        pedidos: !!p.entregador_pedidos,
        taxas: !!p.entregador_taxas,
        ganhos: !!p.entregador_ganhos,
        tempo: !!p.entregador_tempo,
        relatorio: !!p.entregador_relatorio,
        tipos: !!p.entregador_tipos,
      },
    };
  }

  async registrarDispositivo(
    tenantId: string,
    colaboradorId: string,
    fcmToken: string,
    plataforma?: string,
  ) {
    const tok = String(fcmToken ?? '').trim();
    if (!tok) return { ok: false };
    await this.db.execute(sql`
      insert into entregador_dispositivo (tenant_id, colaborador_id, fcm_token, plataforma)
      values (${tenantId}, ${colaboradorId}, ${tok}, ${plataforma ?? null})
      on conflict (colaborador_id, fcm_token)
      do update set atualizado_em = now(), plataforma = excluded.plataforma`);
    return { ok: true };
  }

  // ===== E1 — scan (assumir pedido) / meus pedidos / finalizar =====
  // Escaneia o QR do cupom → assume o pedido (status "em rota"), atrelado a quem
  // escaneou. Escopo por tenant (não assume pedido de outra loja).
  async scan(user: AuthUser, codigo: string) {
    if (!this.ehEntregador(user))
      throw new ForbiddenException('Apenas entregadores podem escanear pedidos.');
    const token = this.tokenDe(codigo);
    if (!token) throw new BadRequestException('Código inválido.');
    const [ped] = await this.db
      .select()
      .from(pedidoExterno)
      .where(and(eq(pedidoExterno.tenantId, user.tenantId), eq(pedidoExterno.despachoToken, token)));
    if (!ped) throw new NotFoundException('Pedido não encontrado nesta loja.');
    if (['despachado', 'concluido'].includes(String(ped.status))) {
      return { ok: true, jaFeito: true, pedido: this.resumo(ped) };
    }
    if (ped.status === 'cancelado') throw new BadRequestException('Pedido cancelado.');
    if (ped.status !== 'pronto')
      throw new BadRequestException('O pedido ainda não está pronto para sair.');
    await this.delivery.avancar(user.tenantId, ped.id, {
      entregadorId: user.colaboradorId,
      entregadorNome: user.nome ?? 'Entregador',
    });
    const [atual] = await this.db.select().from(pedidoExterno).where(eq(pedidoExterno.id, ped.id));
    return { ok: true, pedido: this.resumo(atual ?? ped) };
  }

  // Meus pedidos em rota (despachado, atrelados a mim).
  async pedidos(user: AuthUser) {
    if (!this.ehEntregador(user)) return [];
    const rows = await this.db
      .select()
      .from(pedidoExterno)
      .where(
        and(
          eq(pedidoExterno.tenantId, user.tenantId),
          eq(pedidoExterno.entregadorId, user.colaboradorId),
          eq(pedidoExterno.status, 'despachado'),
        ),
      )
      .orderBy(desc(pedidoExterno.despachadoEm));
    return rows.map((p) => this.resumo(p));
  }

  // Finaliza a entrega. Com código (marketplace de entrega própria) valida no canal;
  // sem código, conclui direto (cardápio nativo). Reusa a lógica do DeliveryService.
  async finalizar(user: AuthUser, id: string, codigo?: string) {
    if (!this.ehEntregador(user)) throw new ForbiddenException('Apenas entregadores.');
    const cod = String(codigo ?? '').trim();
    // Carrega canal + código próprio do pedido (escopo tenant).
    const [ped] = await this.db
      .select({ canal: pedidoExterno.canal, codigoEntrega: pedidoExterno.codigoEntrega })
      .from(pedidoExterno)
      .where(and(eq(pedidoExterno.tenantId, user.tenantId), eq(pedidoExterno.id, id)));
    if (!ped) throw new NotFoundException('Pedido não encontrado.');
    // Marketplace (iFood/99food) com código do cliente: valida pela API do canal.
    if (['ifood', '99food'].includes(String(ped.canal)) && cod) {
      const r: any = await this.delivery.confirmarEntregaComCodigo(user.tenantId, user.colaboradorId, id, cod);
      if (r?.valid) await this.avancarSaida(user.tenantId, id).catch(() => {}); // dispara a próxima parada
      return r;
    }
    // Entrega própria (cardápio/local) com código de 4 díg.: exige e valida o código do
    // cliente (aleatório, gerado na criação) antes de marcar entregue.
    if (ped.codigoEntrega) {
      if (!cod) throw new BadRequestException('Digite o código de entrega do cliente.');
      if (cod !== String(ped.codigoEntrega))
        return { ok: false, valid: false, msg: 'Código inválido — confira com o cliente.' };
    }
    // Marca ENTREGUE (aguarda a conferência do atendente no Painel, que finaliza → concluído).
    await this.delivery.marcarEntregue(user.tenantId, user.colaboradorId, id);
    // Regra do usuário: só agora (parada entregue) o cliente da PRÓXIMA parada recebe o link.
    await this.avancarSaida(user.tenantId, id).catch(() => {});
    return { ok: true, valid: true };
  }

  // ===== E2 — GPS =====
  // O app manda a localização durante a entrega ativa. Só entregador; por tenant.
  async enviarLocalizacao(user: AuthUser, lat: number, lng: number, precisao?: number) {
    if (!this.ehEntregador(user)) throw new ForbiddenException('Apenas entregadores.');
    const la = Number(lat);
    const ln = Number(lng);
    if (!isFinite(la) || !isFinite(ln)) throw new BadRequestException('Coordenadas inválidas.');
    const prec = precisao != null && isFinite(Number(precisao)) ? Number(precisao) : null;
    await this.db.execute(sql`
      insert into entregador_localizacao (tenant_id, colaborador_id, lat, lng, precisao)
      values (${user.tenantId}, ${user.colaboradorId}, ${la}, ${ln}, ${prec})`);
    // Geofence automático do alerta de chegada (best-effort, não bloqueia o ping).
    void this.checarChegada(user, la, ln);
    return { ok: true };
  }

  // Gestor: última posição de cada entregador ativo nos últimos 15 min + nº em rota,
  // e o centro do mapa = coordenadas da loja (cardapio_config) p/ enquadrar de perto.
  async aoVivo(tenantId: string) {
    const r: any = await this.db.execute(sql`
      select distinct on (l.colaborador_id)
        l.colaborador_id, l.lat, l.lng, l.criado_em, c.nome,
        (select count(*)::int from pedido_externo p
           where p.tenant_id = l.tenant_id and p.entregador_id = l.colaborador_id
             and p.status = 'despachado') as em_rota
      from entregador_localizacao l
      join colaborador c on c.id = l.colaborador_id
      where l.tenant_id = ${tenantId} and l.criado_em >= now() - interval '15 minutes'
      order by l.colaborador_id, l.criado_em desc`);
    const cfg: any = await this.db.execute(
      sql`select end_lat, end_lng from cardapio_config where tenant_id = ${tenantId} limit 1`,
    );
    const loja = (cfg.rows ?? cfg)[0];
    const centro =
      loja?.end_lat != null && loja?.end_lng != null
        ? { lat: Number(loja.end_lat), lng: Number(loja.end_lng) }
        : null;
    return { centro, entregadores: r.rows ?? r };
  }

  // ===== E4 — alerta de chegada =====
  // O entregador avisa que está chegando → n8n/Evolution manda WhatsApp ao cliente
  // (com nome + contato do entregador). Reusa o webhook de notificação (evento
  // 'chegando'). Só o entregador do pedido, em rota. Por tenant.
  async avisarChegando(user: AuthUser, pedidoId: string) {
    if (!this.ehEntregador(user)) throw new ForbiddenException('Apenas entregadores.');
    const [ped] = await this.db
      .select()
      .from(pedidoExterno)
      .where(and(eq(pedidoExterno.tenantId, user.tenantId), eq(pedidoExterno.id, pedidoId)));
    if (!ped) throw new NotFoundException('Pedido não encontrado.');
    if (ped.entregadorId !== user.colaboradorId)
      throw new ForbiddenException('Este pedido não está atribuído a você.');
    if (ped.status !== 'despachado') throw new BadRequestException('O pedido não está em rota.');
    if (!ped.clienteTelefone) throw new BadRequestException('Pedido sem telefone do cliente.');
    const ok = await this.dispararChegada(user, ped);
    if (!ok)
      throw new BadRequestException('Não foi possível avisar o cliente (webhook do n8n).');
    return { ok: true };
  }

  // App do entregador: rota OSRM (traçado + ETA) da posição do entregador até o destino do
  // pedido, para desenhar no mapa IN-APP (sem depender do Google Maps). O app manda a sua
  // posição atual (lat/lng); sem ela, cai na última localização registrada. Carrega o pedido
  // em snake_case para o coordDoPedido usar as coords já geocodificadas do cliente. Rota null
  // se o OSRM estiver fora → o app mostra só os marcadores + o botão "Navegar" (app externo).
  async rotaEntregador(user: AuthUser, pedidoId: string, lat: number, lng: number) {
    if (!this.ehEntregador(user)) throw new ForbiddenException('Apenas entregadores.');
    const r: any = await this.db.execute(sql`
      select id, status, entregador_id, cliente_id, cliente_nome,
             endereco, endereco_rua, endereco_numero, endereco_bairro
        from pedido_externo where tenant_id = ${user.tenantId} and id = ${pedidoId} limit 1`);
    const ped = (r.rows ?? r)[0];
    if (!ped) throw new NotFoundException('Pedido não encontrado.');
    if (ped.entregador_id !== user.colaboradorId)
      throw new ForbiddenException('Este pedido não está atribuído a você.');
    const destino = await this.coordDoPedido(user.tenantId, ped);
    if (!destino) throw new BadRequestException('Endereço do pedido sem coordenadas.');
    let from: { lat: number; lng: number } | null =
      Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
    if (!from) {
      const loc: any = await this.db.execute(sql`
        select lat, lng from entregador_localizacao
        where colaborador_id = ${user.colaboradorId} order by criado_em desc limit 1`);
      const l = (loc.rows ?? loc)[0];
      if (l && l.lat != null && l.lng != null) from = { lat: Number(l.lat), lng: Number(l.lng) };
    }
    const rota = from ? await this.rotaOsrm(from, destino) : null;
    const endereco =
      montarEndereco([ped.endereco_rua || ped.endereco, ped.endereco_numero, ped.endereco_bairro]) ||
      String(ped.endereco ?? '') ||
      null;
    return { destino, from, rota, endereco, cliente: ped.cliente_nome ?? null };
  }

  // Monta o payload e dispara o alerta de chegada no webhook (manual e automático).
  // Sempre manda o nome fantasia da loja (p/ a mensagem "O entregador do <loja> está
  // chegando…"). Nome/contato do ENTREGADOR só vão se ele ativou o opt-in no app.
  private async dispararChegada(user: AuthUser, ped: any): Promise<boolean> {
    if (!ped.clienteTelefone) return false;
    // Nome da loja p/ a mensagem = "Nome do estabelecimento" (Config → Loja), que salva em
    // cardapio_config.nome_publico. Fallback pro empresa.nome se não houver.
    const cfg: any = await this.db.execute(
      sql`select nome_publico from cardapio_config where tenant_id = ${user.tenantId} limit 1`,
    );
    const emp: any = await this.db.execute(
      sql`select nome from empresa where id = ${user.tenantId}`,
    );
    const nomeFantasia =
      (cfg.rows ?? cfg)[0]?.nome_publico || (emp.rows ?? emp)[0]?.nome || null;
    const pref: any = await this.db.execute(
      sql`select compartilha_contato from entregador_preferencia where colaborador_id = ${user.colaboradorId}`,
    );
    const compartilha = (pref.rows ?? pref)[0]?.compartilha_contato === true;
    let entregadorTelefone: string | null = null;
    if (compartilha) {
      const r: any = await this.db.execute(
        sql`select telefone from colaborador where id = ${user.colaboradorId}`,
      );
      entregadorTelefone = (r.rows ?? r)[0]?.telefone ?? null;
    }
    return this.cliente.enviarEventoWebhook(user.tenantId, {
      evento: 'chegando',
      telefone: String(ped.clienteTelefone).replace(/\D/g, ''),
      cliente: ped.clienteNome,
      numero: ped.numero,
      nomeFantasia,
      compartilhaContato: compartilha,
      entregadorNome: compartilha ? user.nome ?? ped.entregadorNome ?? 'Entregador' : null,
      entregadorTelefone,
    });
  }

  // Preferência do próprio entregador (opt-in de compartilhar contato no aviso).
  async minhaPreferencia(user: AuthUser) {
    if (!this.ehEntregador(user)) throw new ForbiddenException('Apenas entregadores.');
    const r: any = await this.db.execute(
      sql`select compartilha_contato from entregador_preferencia where colaborador_id = ${user.colaboradorId}`,
    );
    return { compartilhaContato: (r.rows ?? r)[0]?.compartilha_contato === true };
  }

  async salvarPreferencia(user: AuthUser, compartilhaContato: boolean) {
    if (!this.ehEntregador(user)) throw new ForbiddenException('Apenas entregadores.');
    const v = compartilhaContato === true;
    await this.db.execute(sql`
      insert into entregador_preferencia (colaborador_id, tenant_id, compartilha_contato)
      values (${user.colaboradorId}, ${user.tenantId}, ${v})
      on conflict (colaborador_id) do update set compartilha_contato = ${v}, atualizado_em = now()`);
    return { ok: true, compartilhaContato: v };
  }

  // ===== E5 — pagamento do entregador =====
  private readonly MODELOS = [
    'diaria_taxas',
    'so_diaria',
    'so_taxas',
    'so_taxa_fixa',
    'diaria_taxas_fixas',
  ];

  private readonly BASES = ['real', 'fixa'];
  private readonly PERIODOS = ['dia', 'semana', 'quinzena'];

  // Config de pagamento da loja (default se ainda não configurou).
  async configPagamento(tenantId: string) {
    const r: any = await this.db.execute(
      sql`select modelo, diaria_centavos, taxa_entrega_centavos, taxa_fixa_centavos, raio_chegada_m, base_taxa, periodicidade, max_pedidos_entregador
          from entregador_config where tenant_id = ${tenantId}`,
    );
    const c = (r.rows ?? r)[0];
    return {
      modelo: c?.modelo ?? 'diaria_taxas',
      diariaCentavos: Number(c?.diaria_centavos ?? 0),
      taxaEntregaCentavos: Number(c?.taxa_entrega_centavos ?? 0),
      taxaFixaCentavos: Number(c?.taxa_fixa_centavos ?? 0),
      baseTaxa: c?.base_taxa ?? 'real',
      periodicidade: c?.periodicidade ?? 'dia',
      raioChegadaM: Number(c?.raio_chegada_m ?? 70),
      maxPedidosEntregador: Number(c?.max_pedidos_entregador ?? 1),
    };
  }

  async salvarConfigPagamento(
    tenantId: string,
    dto: {
      modelo?: string;
      diariaCentavos?: number;
      taxaEntregaCentavos?: number;
      taxaFixaCentavos?: number;
      raioChegadaM?: number;
      baseTaxa?: string;
      periodicidade?: string;
      maxPedidosEntregador?: number;
    },
  ) {
    const modelo = this.MODELOS.includes(String(dto?.modelo)) ? String(dto.modelo) : 'diaria_taxas';
    const cent = (v: any) => Math.max(0, Math.round(Number(v) || 0));
    const diaria = cent(dto?.diariaCentavos);
    const taxaEnt = cent(dto?.taxaEntregaCentavos);
    const taxaFix = cent(dto?.taxaFixaCentavos);
    const base = this.BASES.includes(String(dto?.baseTaxa)) ? String(dto.baseTaxa) : 'real';
    const periodo = this.PERIODOS.includes(String(dto?.periodicidade)) ? String(dto.periodicidade) : 'dia';
    // Raio do aviso de chegada: clamp defensivo (o app oferece 20/30/40/60/70m).
    const raio = Math.min(1000, Math.max(10, Math.round(Number(dto?.raioChegadaM) || 70)));
    // Lote da saída multi-parada: 1 (sem multi-parada) a 15.
    const maxPed = Math.min(15, Math.max(1, Math.round(Number(dto?.maxPedidosEntregador) || 1)));
    await this.db.execute(sql`
      insert into entregador_config (tenant_id, modelo, diaria_centavos, taxa_entrega_centavos, taxa_fixa_centavos, raio_chegada_m, base_taxa, periodicidade, max_pedidos_entregador)
      values (${tenantId}, ${modelo}, ${diaria}, ${taxaEnt}, ${taxaFix}, ${raio}, ${base}, ${periodo}, ${maxPed})
      on conflict (tenant_id) do update set
        modelo = excluded.modelo,
        diaria_centavos = excluded.diaria_centavos,
        taxa_entrega_centavos = excluded.taxa_entrega_centavos,
        taxa_fixa_centavos = excluded.taxa_fixa_centavos,
        raio_chegada_m = excluded.raio_chegada_m,
        base_taxa = excluded.base_taxa,
        periodicidade = excluded.periodicidade,
        max_pedidos_entregador = excluded.max_pedidos_entregador,
        atualizado_em = now()`);
    return { ok: true };
  }

  // Calcula (diaria, taxas, total) em centavos para um nº de entregas, dado o modelo.
  // taxasReaisCentavos = soma da taxa_entrega REAL dos pedidos (usada quando base='real').
  private calcular(cfg: any, entregas: number, taxasReaisCentavos = 0) {
    const d = Number(cfg.diariaCentavos) || 0;
    const te = Number(cfg.taxaEntregaCentavos) || 0;
    const tf = Number(cfg.taxaFixaCentavos) || 0;
    // Valor das taxas por entrega: 'real' = soma da taxa do pedido (padrão); 'fixa' =
    // nº de entregas × valor fixo configurado (taxa_entrega_centavos), na área de atendimento.
    const taxaVar = cfg.baseTaxa === 'fixa' ? entregas * te : Number(taxasReaisCentavos) || 0;
    let diaria = 0;
    let taxas = 0;
    switch (cfg.modelo) {
      case 'so_diaria':
        diaria = d;
        break;
      case 'so_taxas':
        taxas = taxaVar;
        break;
      case 'so_taxa_fixa':
        taxas = tf; // valor fixo por fechamento, independente da quantidade
        break;
      case 'diaria_taxas_fixas':
        diaria = d;
        taxas = entregas * tf;
        break;
      case 'diaria_taxas':
      default:
        diaria = d;
        taxas = taxaVar;
        break;
    }
    return { diaria, taxas, total: diaria + taxas };
  }

  // Janela do período de fechamento no fuso de SP (YYYY-MM-DD início/fim inclusivos).
  private periodoDe(periodicidade: string): { inicio: string; fim: string } {
    const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
    const iso = (d: Date) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    if (periodicidade === 'semana') {
      const dow = (now.getDay() + 6) % 7; // 0 = segunda
      const ini = new Date(now);
      ini.setDate(now.getDate() - dow);
      const fim = new Date(ini);
      fim.setDate(ini.getDate() + 6);
      return { inicio: iso(ini), fim: iso(fim) };
    }
    if (periodicidade === 'quinzena') {
      const dia = now.getDate();
      const y = now.getFullYear();
      const m = now.getMonth();
      if (dia <= 15) return { inicio: iso(new Date(y, m, 1)), fim: iso(new Date(y, m, 15)) };
      return { inicio: iso(new Date(y, m, 16)), fim: iso(new Date(y, m + 1, 0)) };
    }
    return { inicio: iso(now), fim: iso(now) }; // 'dia'
  }

  // Agrega as entregas CONCLUÍDAS e não acertadas de um entregador num período (nº e
  // soma da taxa_entrega real em centavos). Base do cálculo de ganhos e do fechamento.
  private async agregarPeriodo(
    tenantId: string,
    colaboradorId: string,
    inicio: string,
    fim: string,
  ): Promise<{ entregas: number; taxasReaisCentavos: number }> {
    const r: any = await this.db.execute(sql`
      select count(*)::int as entregas,
             coalesce(round(sum(coalesce(taxa_entrega, 0)) * 100), 0)::bigint as taxas_centavos
      from pedido_externo
      where tenant_id = ${tenantId}
        and entregador_id = ${colaboradorId}
        and status = 'concluido'
        and entregador_fechamento_id is null
        and (concluido_em at time zone 'America/Sao_Paulo')::date between ${inicio}::date and ${fim}::date`);
    const row = (r.rows ?? r)[0] ?? {};
    return { entregas: Number(row.entregas ?? 0), taxasReaisCentavos: Number(row.taxas_centavos ?? 0) };
  }

  // Perfil de pagamento EFETIVO de um entregador: o próprio (se configurado),
  // senão o padrão da loja (entregadorConfig).
  private async perfilDeEntregador(tenantId: string, colaboradorId: string) {
    const r: any = await this.db.execute(sql`
      select modelo, diaria_centavos, taxa_entrega_centavos, taxa_fixa_centavos, base_taxa, periodicidade
      from entregador_perfil_pagamento
      where tenant_id = ${tenantId} and colaborador_id = ${colaboradorId}`);
    const p = (r.rows ?? r)[0];
    if (!p) return await this.configPagamento(tenantId);
    return {
      modelo: p.modelo,
      diariaCentavos: Number(p.diaria_centavos),
      taxaEntregaCentavos: Number(p.taxa_entrega_centavos),
      taxaFixaCentavos: Number(p.taxa_fixa_centavos),
      baseTaxa: p.base_taxa ?? 'real',
      periodicidade: p.periodicidade ?? 'dia',
    };
  }

  // Gestor: lista entregadores + perfil de pagamento (próprio ou herdado do padrão).
  async listarPerfisPagamento(tenantId: string) {
    const ents = await this.delivery.listarEntregadores(tenantId);
    const padrao = await this.configPagamento(tenantId);
    const r: any = await this.db.execute(sql`
      select colaborador_id, modelo, diaria_centavos, taxa_entrega_centavos, taxa_fixa_centavos
      from entregador_perfil_pagamento where tenant_id = ${tenantId}`);
    const map = new Map<string, any>();
    for (const p of r.rows ?? r) map.set(String(p.colaborador_id), p);
    return {
      padrao,
      entregadores: (ents as any[]).map((e) => {
        const p = map.get(String(e.id));
        return {
          colaboradorId: e.id,
          nome: e.nome,
          proprio: !!p,
          modelo: p?.modelo ?? padrao.modelo,
          diariaCentavos: Number(p?.diaria_centavos ?? padrao.diariaCentavos),
          taxaEntregaCentavos: Number(p?.taxa_entrega_centavos ?? padrao.taxaEntregaCentavos),
          taxaFixaCentavos: Number(p?.taxa_fixa_centavos ?? padrao.taxaFixaCentavos),
        };
      }),
    };
  }

  // Gestor: grava o perfil próprio do entregador (ou volta a herdar o padrão).
  async salvarPerfilPagamento(
    tenantId: string,
    colaboradorId: string,
    dto: {
      usarPadrao?: boolean;
      modelo?: string;
      diariaCentavos?: number;
      taxaEntregaCentavos?: number;
      taxaFixaCentavos?: number;
    },
  ) {
    if (!colaboradorId) throw new BadRequestException('Entregador não informado.');
    if (dto?.usarPadrao) {
      await this.db.execute(
        sql`delete from entregador_perfil_pagamento where tenant_id = ${tenantId} and colaborador_id = ${colaboradorId}`,
      );
      return { ok: true, proprio: false };
    }
    const modelo = this.MODELOS.includes(String(dto?.modelo)) ? String(dto.modelo) : 'diaria_taxas';
    const cent = (v: any) => Math.max(0, Math.round(Number(v) || 0));
    await this.db.execute(sql`
      insert into entregador_perfil_pagamento
        (tenant_id, colaborador_id, modelo, diaria_centavos, taxa_entrega_centavos, taxa_fixa_centavos)
      values (${tenantId}, ${colaboradorId}, ${modelo}, ${cent(dto?.diariaCentavos)}, ${cent(dto?.taxaEntregaCentavos)}, ${cent(dto?.taxaFixaCentavos)})
      on conflict (colaborador_id) do update set
        modelo = excluded.modelo, diaria_centavos = excluded.diaria_centavos,
        taxa_entrega_centavos = excluded.taxa_entrega_centavos, taxa_fixa_centavos = excluded.taxa_fixa_centavos,
        atualizado_em = now()`);
    return { ok: true, proprio: true };
  }

  // Gestor: fechamento do dia — por entregador, entregas concluídas + valores calculados
  // + se já foi fechado (pago). data = 'YYYY-MM-DD'.
  async fechamentoDia(tenantId: string, data: string) {
    const dia = /^\d{4}-\d{2}-\d{2}$/.test(String(data)) ? String(data) : null;
    if (!dia) throw new BadRequestException('Data inválida (use YYYY-MM-DD).');
    const padrao = await this.configPagamento(tenantId);
    // Perfis próprios por entregador (sobrepõem o padrão).
    const pr: any = await this.db.execute(sql`
      select colaborador_id, modelo, diaria_centavos, taxa_entrega_centavos, taxa_fixa_centavos
      from entregador_perfil_pagamento where tenant_id = ${tenantId}`);
    const perfis = new Map<string, any>();
    for (const p of pr.rows ?? pr)
      perfis.set(String(p.colaborador_id), {
        modelo: p.modelo,
        diariaCentavos: Number(p.diaria_centavos),
        taxaEntregaCentavos: Number(p.taxa_entrega_centavos),
        taxaFixaCentavos: Number(p.taxa_fixa_centavos),
      });
    // Entregas concluídas no dia, por entregador (fuso America/Sao_Paulo).
    const r: any = await this.db.execute(sql`
      select p.entregador_id as colaborador_id, c.nome,
             count(*)::int as entregas
      from pedido_externo p
      join colaborador c on c.id = p.entregador_id
      where p.tenant_id = ${tenantId}
        and p.entregador_id is not null
        and p.status = 'concluido'
        and (p.concluido_em at time zone 'America/Sao_Paulo')::date = ${dia}::date
      group by p.entregador_id, c.nome
      order by c.nome`);
    const linhas = (r.rows ?? r) as any[];
    // Fechamentos já feitos nesse dia.
    const f: any = await this.db.execute(sql`
      select colaborador_id, total_centavos from entregador_fechamento
      where tenant_id = ${tenantId} and data_ref = ${dia}`);
    const pagos = new Map<string, number>();
    for (const row of f.rows ?? f) pagos.set(String(row.colaborador_id), Number(row.total_centavos));
    return {
      data: dia,
      modelo: padrao.modelo,
      entregadores: linhas.map((l) => {
        const cfg = perfis.get(String(l.colaborador_id)) ?? padrao;
        const v = this.calcular(cfg, Number(l.entregas));
        return {
          colaboradorId: l.colaborador_id,
          nome: l.nome,
          entregas: Number(l.entregas),
          diariaCentavos: v.diaria,
          taxasCentavos: v.taxas,
          totalCentavos: v.total,
          pago: pagos.has(String(l.colaborador_id)),
        };
      }),
    };
  }

  // Gestor: fecha (registra o pagamento) de um entregador no dia. Idempotente.
  async fechar(tenantId: string, atorId: string, colaboradorId: string, data: string) {
    const dia = /^\d{4}-\d{2}-\d{2}$/.test(String(data)) ? String(data) : null;
    if (!dia) throw new BadRequestException('Data inválida (use YYYY-MM-DD).');
    if (!colaboradorId) throw new BadRequestException('Entregador não informado.');
    const cfg = await this.perfilDeEntregador(tenantId, colaboradorId);
    const r: any = await this.db.execute(sql`
      select count(*)::int as entregas from pedido_externo
      where tenant_id = ${tenantId} and entregador_id = ${colaboradorId}
        and status = 'concluido'
        and (concluido_em at time zone 'America/Sao_Paulo')::date = ${dia}::date`);
    const entregas = Number((r.rows ?? r)[0]?.entregas ?? 0);
    const v = this.calcular(cfg, entregas);
    await this.db.execute(sql`
      insert into entregador_fechamento
        (tenant_id, colaborador_id, data_ref, modelo, entregas, diaria_centavos, taxas_centavos, total_centavos, criado_por)
      values (${tenantId}, ${colaboradorId}, ${dia}, ${cfg.modelo}, ${entregas}, ${v.diaria}, ${v.taxas}, ${v.total}, ${atorId})
      on conflict (tenant_id, colaborador_id, data_ref) do update set
        modelo = excluded.modelo, entregas = excluded.entregas,
        diaria_centavos = excluded.diaria_centavos, taxas_centavos = excluded.taxas_centavos,
        total_centavos = excluded.total_centavos, criado_por = excluded.criado_por, criado_em = now()`);
    return { ok: true, entregas, ...v };
  }

  // App do entregador: meus ganhos ESTIMADOS do período. Diferente do fechamento do gestor
  // (que só conta 'concluido' = conferido/pagável), a estimativa do app inclui as entregas
  // que o entregador já CONFIRMOU com código ('entregue'), ainda pendentes de conferência no
  // atendimento — assim a taxa entra no "Meus ganhos estimados" na hora. Se o pedido for
  // cancelado no atendimento, o status deixa de ser entregue/concluido → sai da estimativa
  // sozinho (e do pagamento, que já era só 'concluido'). Base 'real' soma a taxa do pedido;
  // 'fixa' usa o valor fixo por entrega do perfil.
  async ganhos(user: AuthUser) {
    if (!this.ehEntregador(user)) throw new ForbiddenException('Apenas entregadores.');
    const cfg = await this.perfilDeEntregador(user.tenantId, user.colaboradorId);
    const { inicio, fim } = this.periodoDe(cfg.periodicidade ?? 'dia');
    const r: any = await this.db.execute(sql`
      select
        count(*) filter (where status in ('entregue', 'concluido'))::int as entregas,
        coalesce(round(sum(coalesce(taxa_entrega, 0)) filter (where status in ('entregue', 'concluido')) * 100), 0)::bigint as taxas_centavos,
        count(*) filter (where status = 'entregue')::int as pendentes
      from pedido_externo
      where tenant_id = ${user.tenantId}
        and entregador_id = ${user.colaboradorId}
        and entregador_fechamento_id is null
        and (coalesce(concluido_em, entregue_em) at time zone 'America/Sao_Paulo')::date
            between ${inicio}::date and ${fim}::date`);
    const row = (r.rows ?? r)[0] ?? {};
    const entregas = Number(row.entregas ?? 0);
    const taxasReaisCentavos = Number(row.taxas_centavos ?? 0);
    const pendentesConferencia = Number(row.pendentes ?? 0);
    const v = this.calcular(cfg, entregas, taxasReaisCentavos);
    return {
      entregas,
      pendentesConferencia, // entregas confirmadas aguardando a conferência no atendimento
      estimado: pendentesConferencia > 0, // o app rotula "Meus ganhos estimados" quando há pendência
      periodicidade: cfg.periodicidade ?? 'dia',
      periodo: { inicio, fim },
      ...v,
    };
  }

  // ===== E5 (gestor) — fechamento e pagamento do entregador =====
  // Lista cada entregador com os ganhos PENDENTES (entregas concluídas e não acertadas)
  // do período dele. Base do "fechamento do dia/semana/quinzena" no Delivery.
  async fechamentoEntregadores(tenantId: string) {
    const ents = await this.delivery.listarEntregadores(tenantId);
    const linhas: any[] = [];
    for (const e of ents as any[]) {
      const cfg = await this.perfilDeEntregador(tenantId, e.id);
      const { inicio, fim } = this.periodoDe(cfg.periodicidade ?? 'dia');
      const { entregas, taxasReaisCentavos } = await this.agregarPeriodo(tenantId, e.id, inicio, fim);
      const v = this.calcular(cfg, entregas, taxasReaisCentavos);
      linhas.push({
        colaboradorId: e.id,
        nome: e.nome,
        modelo: cfg.modelo,
        baseTaxa: cfg.baseTaxa ?? 'real',
        periodicidade: cfg.periodicidade ?? 'dia',
        periodo: { inicio, fim },
        entregas,
        ...v,
      });
    }
    return linhas;
  }

  // Fecha e PAGA o entregador: soma as entregas pendentes do período, registra o
  // fechamento (append-only), gera a SANGRIA no caixa de entregas aberto e marca os
  // pedidos como acertados (não pagam de novo). Cancelados nunca entram (não são
  // 'concluido'), então o cancelamento na conferência já abate naturalmente.
  async pagarEntregador(tenantId: string, atorId: string | null, colaboradorId: string) {
    const cfg = await this.perfilDeEntregador(tenantId, colaboradorId);
    const { inicio, fim } = this.periodoDe(cfg.periodicidade ?? 'dia');
    // Pedidos a acertar (guarda os ids p/ marcar exatamente estes).
    const sel: any = await this.db.execute(sql`
      select id, coalesce(taxa_entrega, 0) as taxa
      from pedido_externo
      where tenant_id = ${tenantId} and entregador_id = ${colaboradorId}
        and status = 'concluido' and entregador_fechamento_id is null
        and (concluido_em at time zone 'America/Sao_Paulo')::date between ${inicio}::date and ${fim}::date`);
    const pedidos = sel.rows ?? sel;
    const entregas = pedidos.length;
    const taxasReaisCentavos = Math.round(
      pedidos.reduce((s: number, p: any) => s + Number(p.taxa || 0), 0) * 100,
    );
    const v = this.calcular(cfg, entregas, taxasReaisCentavos);
    if (v.total <= 0) throw new BadRequestException('Nada a pagar para este entregador no período.');

    // Caixa de entregas aberto (a sangria sai daqui).
    const cx: any = await this.db.execute(sql`
      select id from caixa_sessao
      where tenant_id = ${tenantId} and status = 'aberta' and origem = 'delivery' limit 1`);
    const sessaoId = (cx.rows ?? cx)[0]?.id ?? null;
    if (!sessaoId)
      throw new BadRequestException('Abra o caixa de entregas para registrar o pagamento (sangria).');

    const nomeRow: any = await this.db.execute(sql`select nome from colaborador where id = ${colaboradorId}`);
    const nomeEnt = (nomeRow.rows ?? nomeRow)[0]?.nome ?? 'Entregador';
    const rotulos: Record<string, string> = {
      diaria_taxas: 'diária + taxas',
      so_diaria: 'só diária',
      so_taxas: 'só taxas',
      so_taxa_fixa: 'só taxa fixa',
      diaria_taxas_fixas: 'diária + taxa fixa/entrega',
    };
    const descr = `Pagamento ao entregador ${nomeEnt} — ${rotulos[cfg.modelo] ?? cfg.modelo} · ${entregas} entrega(s) · ${inicio}..${fim}`;

    // 1) Fechamento (append-only).
    const fech: any = await this.db.execute(sql`
      insert into entregador_fechamento
        (tenant_id, colaborador_id, data_ref, modelo, entregas, diaria_centavos, taxas_centavos,
         total_centavos, periodo_inicio, periodo_fim, base_taxa, criado_por)
      values (${tenantId}, ${colaboradorId}, ${fim}, ${cfg.modelo}, ${entregas}, ${v.diaria}, ${v.taxas},
         ${v.total}, ${inicio}::date, ${fim}::date, ${cfg.baseTaxa ?? 'real'}, ${atorId})
      returning id`);
    const fechamentoId = (fech.rows ?? fech)[0].id;

    // 2) Sangria no caixa de entregas (saída em dinheiro).
    const lc: any = await this.db.execute(sql`
      insert into lancamento_caixa (tenant_id, tipo, valor, categoria, forma, descricao, sessao_id, criado_por_id)
      values (${tenantId}, 'saida', ${(v.total / 100).toFixed(2)}, 'pagamento_entregador', 'dinheiro',
              ${descr}, ${sessaoId}, ${atorId})
      returning id`);
    const lancamentoId = (lc.rows ?? lc)[0].id;
    await this.db.execute(sql`update entregador_fechamento set lancamento_caixa_id = ${lancamentoId} where id = ${fechamentoId}`);

    // 3) Marca os pedidos como acertados (não pagam de novo). Usa inArray do Drizzle — o
    // `id = any(${ids}::uuid[])` no template sql serializava o array errado (o ::uuid[] recebia
    // o UUID cru, sem chaves) → "malformed array literal". Set-based, 1 query.
    if (entregas > 0) {
      const ids = pedidos.map((p: any) => p.id as string);
      await this.db
        .update(pedidoExterno)
        .set({ entregadorFechamentoId: fechamentoId })
        .where(and(eq(pedidoExterno.tenantId, tenantId), inArray(pedidoExterno.id, ids)));
    }
    return { ok: true, fechamentoId, entregas, ...v, descricao: descr };
  }

  // ===== E6 — MULTI-PARADA (saída/roteiro) + rastreio =====
  private basePublica(): string {
    return (process.env.CARDAPIO_PUBLIC_URL || process.env.APP_URL || 'https://app.dmsregem.com').replace(/\/$/, '');
  }

  // Coord do pedido: cache (entregador_chegada) senão geocode (Nominatim) + cacheia.
  private async coordDoPedido(tenantId: string, p: any): Promise<{ lat: number; lng: number } | null> {
    const c: any = await this.db.execute(sql`select lat, lng from entregador_chegada where pedido_id = ${p.id}`);
    const row = (c.rows ?? c)[0];
    if (row && row.lat != null && row.lng != null) {
      const lat = Number(row.lat), lng = Number(row.lng);
      if (Number.isFinite(lat) && Number.isFinite(lng)) return { lat, lng };
    }
    // O endereço do cliente já vem GEOCODIFICADO (cliente_endereco.lat/lng, salvo p/ o frete
    // por raio) — usa direto, confiável, sem depender do Nominatim (que falhava sem rua/cidade
    // na query → destino null → sem rota). Prefere o endereço principal/mais recente.
    if (p.cliente_id) {
      const ce: any = await this.db.execute(sql`
        select lat, lng from cliente_endereco
        where cliente_id = ${p.cliente_id} and lat is not null and lng is not null
        order by principal desc, criado_em desc limit 1`);
      const e0 = (ce.rows ?? ce)[0];
      if (e0) {
        const lat = Number(e0.lat), lng = Number(e0.lng);
        if (Number.isFinite(lat) && Number.isFinite(lng)) {
          await this.db
            .execute(sql`insert into entregador_chegada (tenant_id, pedido_id, lat, lng)
                         values (${tenantId}, ${p.id}, ${lat}, ${lng}) on conflict (pedido_id) do nothing`)
            .catch(() => {});
          return { lat, lng };
        }
      }
    }
    // Fallback: geocode do endereço do pedido (a rua pode estar em endereco_rua OU endereco).
    const end =
      montarEndereco([p.endereco_rua || p.endereco, p.endereco_numero, p.endereco_bairro]) ||
      String(p.endereco ?? '');
    const g = end ? await geocode(end).catch(() => null) : null;
    if (g) {
      await this.db
        .execute(sql`insert into entregador_chegada (tenant_id, pedido_id, lat, lng)
                     values (${tenantId}, ${p.id}, ${g.lat}, ${g.lng}) on conflict (pedido_id) do nothing`)
        .catch(() => {});
      return g;
    }
    return null;
  }

  // Matriz de DURAÇÕES (segundos) entre todos os pontos via OSRM /table — 1 chamada pega
  // todos os pares (o `--max-table-size 3000` cobre de sobra uma saída de ≤15 paradas).
  // m[i][j] = seg de i→j. null se OSRM fora → o chamador cai na reta.
  private async matrizDuracaoOsrm(
    coords: { lat: number; lng: number }[],
  ): Promise<number[][] | null> {
    const base = (process.env.OSRM_URL || '').replace(/\/$/, '');
    if (!base || coords.length < 2) return null;
    try {
      const pts = coords.map((c) => `${c.lng},${c.lat}`).join(';');
      const url = `${base}/table/v1/driving/${pts}?annotations=duration`;
      const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
      if (!res.ok) return null;
      const j: any = await res.json();
      if (j?.code !== 'Ok' || !Array.isArray(j.durations)) return null;
      return j.durations as number[][]; // seg; pode ter null p/ par inalcançável
    } catch {
      return null; // OSRM fora / timeout → sem matriz
    }
  }

  // Fase 3 — ROTEIRIZAÇÃO POR PRAZO. A cada parada vai no pedido MAIS URGENTE (prazo mais
  // próximo do fim, mesmo o mais longe), MAS encaixa um mais PERTO antes se ele chega no
  // prazo dele E, depois dele, o urgente ainda chega a tempo (regra do gestor). Prazo =
  // confirmado_em (aceito) + cardapio_config.tempo_entrega_min; fallback criado_em. Tempos de
  // rua reais (OSRM /table); reta ÷ vel. urbana como fallback. Handover de 2 min por parada
  // entra na conta. Sem prazo (tempo_entrega_min vazio) / sem coords da loja → degrada pro
  // vizinho-mais-próximo. Pedidos sem coordenada vão pro fim.
  private async roteirizar(tenantId: string, prontos: any[]): Promise<any[]> {
    if (prontos.length <= 1) return prontos;
    const cfg: any = await this.db.execute(
      sql`select end_lat, end_lng, tempo_entrega_min from cardapio_config where tenant_id = ${tenantId} limit 1`,
    );
    const loja = (cfg.rows ?? cfg)[0];
    const origem = { lat: Number(loja?.end_lat), lng: Number(loja?.end_lng) };
    if (!Number.isFinite(origem.lat) || !Number.isFinite(origem.lng)) return prontos;

    // Coords + prazo (ms) de cada pedido.
    const tempoEntregaMin = Number(loja?.tempo_entrega_min);
    const temPrazo = Number.isFinite(tempoEntregaMin) && tempoEntregaMin > 0;
    const pts: { p: any; coord: { lat: number; lng: number } | null; prazo: number | null }[] = [];
    for (const p of prontos) {
      const coord = await this.coordDoPedido(tenantId, p);
      let prazo: number | null = null;
      if (temPrazo) {
        const base = p.confirmado_em ?? p.criado_em;
        const t = base ? new Date(base).getTime() : NaN;
        if (Number.isFinite(t)) prazo = t + tempoEntregaMin * 60000;
      }
      pts.push({ p, coord, prazo });
    }
    const comCoord = pts.filter((x) => x.coord);
    const semCoord = pts.filter((x) => !x.coord);
    if (comCoord.length <= 1) return prontos;

    // Matriz de durações: índice 0 = loja, 1..N = paradas. Reta ÷ velocidade se OSRM fora.
    const coordsAll = [origem, ...comCoord.map((x) => x.coord!)];
    const M = await this.matrizDuracaoOsrm(coordsAll);
    const VEL_MS = 6.1; // ~22 km/h urbano (fallback)
    const dur = (i: number, j: number): number => {
      const v = M?.[i]?.[j];
      if (v != null && Number.isFinite(v)) return v as number;
      const a = coordsAll[i], b = coordsAll[j];
      return this.distanciaM(a.lat, a.lng, b.lat, b.lng) / VEL_MS;
    };

    const SERVICE_S = 120; // handover por parada (2 min) — entra na conta do prazo
    const prazoDe = new Map<number, number | null>();
    comCoord.forEach((x, i) => prazoDe.set(i + 1, x.prazo));

    const ordem: number[] = []; // índices na matriz (1..N)
    const rest = comCoord.map((_, i) => i + 1);
    let cur = 0; // loja
    let t = Date.now();
    while (rest.length) {
      // Mais urgente = menor prazo (null = +Inf); desempata pelo mais perto.
      let U = rest[0];
      for (const i of rest) {
        const ci = prazoDe.get(i) ?? Infinity;
        const cu = prazoDe.get(U) ?? Infinity;
        if (ci < cu || (ci === cu && dur(cur, i) < dur(cur, U))) U = i;
      }
      // Atalho seguro: o mais perto que chega no prazo DELE e deixa o urgente no prazo.
      let escolhido = U;
      let melhor = dur(cur, U);
      for (const c of rest) {
        if (c === U) continue;
        const dcc = dur(cur, c);
        if (dcc >= melhor) continue;
        const pc = prazoDe.get(c);
        const cOk = pc == null || t + dcc * 1000 <= pc;
        const pu = prazoDe.get(U);
        const uOk = pu == null || t + (dcc + SERVICE_S + dur(c, U)) * 1000 <= pu;
        if (cOk && uOk) {
          escolhido = c;
          melhor = dcc;
        }
      }
      ordem.push(escolhido);
      t += (dur(cur, escolhido) + SERVICE_S) * 1000;
      cur = escolhido;
      rest.splice(rest.indexOf(escolhido), 1);
    }
    const ordenados = ordem.map((i) => comCoord[i - 1].p);
    return [...ordenados, ...semCoord.map((x) => x.p)];
  }

  // Saída ATIVA (em_rota) do entregador + paradas ordenadas. { saida:null } se não há.
  async saidaAtiva(tenantId: string, colaboradorId: string) {
    const s: any = await this.db.execute(sql`
      select id, status, total_paradas from entregador_saida
      where tenant_id = ${tenantId} and colaborador_id = ${colaboradorId} and status = 'em_rota'
      order by criado_em desc limit 1`);
    const saida = (s.rows ?? s)[0];
    if (!saida) return { saida: null, paradas: [] as any[] };
    const r: any = await this.db.execute(sql`
      select * from pedido_externo where tenant_id = ${tenantId} and saida_id = ${saida.id}
      order by ordem_parada asc`);
    const paradas = (r.rows ?? r).map((p: any) => ({
      ...this.resumo(p),
      ordemParada: p.ordem_parada,
      entregue: ['entregue', 'concluido'].includes(String(p.status)),
    }));
    return { saida: { id: saida.id, status: saida.status, totalParadas: saida.total_paradas }, paradas };
  }

  // O app pede a PRÓXIMA saída: se já há uma ativa, devolve; senão forma uma nova com os
  // pedidos prontos (até o máximo da loja), roteiriza e despacha atrelando ao entregador.
  // Envia o link de rastreio da PARADA 1 (o entregador está indo pra ela).
  async proximaSaida(user: AuthUser) {
    if (!this.ehEntregador(user)) throw new ForbiddenException('Apenas entregadores.');
    const ativa = await this.saidaAtiva(user.tenantId, user.colaboradorId);
    if (ativa.saida) return ativa;
    const max = Math.max(1, Number((await this.configPagamento(user.tenantId)).maxPedidosEntregador) || 1);
    const pr: any = await this.db.execute(sql`
      select * from pedido_externo
      where tenant_id = ${user.tenantId} and status = 'pronto' and tipo <> 'retirada' and saida_id is null
      order by criado_em asc limit ${max}`);
    const prontos = pr.rows ?? pr;
    if (!prontos.length) return { saida: null, paradas: [] as any[] };
    const ordenados = await this.roteirizar(user.tenantId, prontos);
    const ins: any = await this.db.execute(sql`
      insert into entregador_saida (tenant_id, colaborador_id, status, total_paradas)
      values (${user.tenantId}, ${user.colaboradorId}, 'em_rota', ${ordenados.length}) returning id`);
    const saidaId = (ins.rows ?? ins)[0].id;
    for (let i = 0; i < ordenados.length; i++) {
      const p = ordenados[i];
      try {
        await this.delivery.avancar(user.tenantId, p.id, {
          entregadorId: user.colaboradorId,
          entregadorNome: user.nome ?? 'Entregador',
          skipRastreio: true, // multi-parada envia o link por parada ativa (abaixo), não de uma vez
        });
      } catch { /* já despachado/estado inesperado — segue */ }
      await this.db.execute(sql`update pedido_externo set saida_id = ${saidaId}, ordem_parada = ${i + 1} where id = ${p.id}`);
    }
    await this.enviarLinkRastreio(user.tenantId, ordenados[0].id).catch(() => {});
    return this.saidaAtiva(user.tenantId, user.colaboradorId);
  }

  // Despacho ÚNICO (scan do app, /e/ web, painel) → manda o rastreio+código ao cliente.
  // Ouve o evento do DeliveryService (módulo cloud-only; no edge não há listener, e o
  // rastreio é conceito de nuvem mesmo). Multi-parada NÃO emite (envia por parada ativa).
  @OnEvent('pedido.despachado')
  async aoDespachar(p: { tenantId: string; pedidoId: string }) {
    await this.enviarLinkRastreio(p.tenantId, p.pedidoId).catch(() => {});
  }

  // Envia o link público de rastreio ao cliente (webhook n8n). Best-effort.
  private async enviarLinkRastreio(tenantId: string, pedidoId: string) {
    const [ped] = await this.db
      .select()
      .from(pedidoExterno)
      .where(and(eq(pedidoExterno.tenantId, tenantId), eq(pedidoExterno.id, pedidoId)));
    if (!ped || !ped.clienteTelefone || !ped.rastreioToken) return;
    const codigoEntrega =
      ped.tipo !== 'retirada' && !['ifood', '99food'].includes(String(ped.canal)) && ped.codigoEntrega
        ? String(ped.codigoEntrega)
        : null;
    await this.cliente.enviarEventoWebhook(tenantId, {
      evento: 'rastreio',
      telefone: String(ped.clienteTelefone).replace(/\D/g, ''),
      cliente: ped.clienteNome,
      numero: ped.numero,
      rastreioUrl: `${this.basePublica()}/r/${ped.rastreioToken}`,
      codigoEntrega, // o cliente informa ao entregador na entrega
    });
  }

  // Após uma parada virar ENTREGUE: manda o link da PRÓXIMA parada (o entregador agora vai
  // pra ela — regra do usuário: o cliente só recebe quando o entregador está a caminho DELE)
  // e, se era a última, conclui a saída. Chamado no finalizar do entregador.
  async avancarSaida(tenantId: string, pedidoId: string) {
    const [ped] = await this.db
      .select({ saidaId: pedidoExterno.saidaId, ordem: pedidoExterno.ordemParada })
      .from(pedidoExterno)
      .where(eq(pedidoExterno.id, pedidoId));
    if (!ped?.saidaId) return;
    const prox: any = await this.db.execute(sql`
      select id from pedido_externo
      where tenant_id = ${tenantId} and saida_id = ${ped.saidaId} and ordem_parada > ${ped.ordem ?? 0}
        and status not in ('entregue', 'concluido', 'cancelado')
      order by ordem_parada asc limit 1`);
    const proxId = (prox.rows ?? prox)[0]?.id;
    if (proxId) {
      await this.enviarLinkRastreio(tenantId, proxId).catch(() => {});
    } else {
      await this.db.execute(sql`update entregador_saida set status = 'concluida', concluida_em = now()
                                where id = ${ped.saidaId} and status = 'em_rota'`);
    }
  }

  // Rota real (OSRM self-hosted) do entregador até o destino, p/ desenhar no rastreio do
  // cliente. Geometria polyline6 (o front decodifica). FALLBACK: sem OSRM_URL ou OSRM fora
  // → null (o rastreio segue sem a linha, sem quebrar). Timeout curto p/ não pendurar.
  private async rotaOsrm(
    from: { lat: number; lng: number },
    to: { lat: number; lng: number },
  ): Promise<{ geometry: string; duracaoMin: number; distanciaM: number } | null> {
    const base = (process.env.OSRM_URL || '').replace(/\/$/, '');
    if (!base) return null;
    try {
      const url =
        `${base}/route/v1/driving/${from.lng},${from.lat};${to.lng},${to.lat}` +
        `?overview=full&geometries=polyline6`;
      const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
      if (!res.ok) return null;
      const j: any = await res.json();
      const rt = j?.routes?.[0];
      if (j?.code !== 'Ok' || !rt?.geometry) return null;
      return {
        geometry: String(rt.geometry),
        duracaoMin: Math.max(1, Math.round(Number(rt.duration) / 60)),
        distanciaM: Math.round(Number(rt.distance)),
      };
    } catch {
      return null; // OSRM fora / timeout → sem rota
    }
  }

  // Cache de rota por pedido: só RECALCULA quando o entregador ANDOU (> 100 m) desde o
  // último cálculo (regra do gestor: "quando o entregador andar"), ou sem cache / velho
  // demais. Evita bater no OSRM a cada poll de cada viewer. Se o OSRM falhar agora mas havia
  // cache, mantém o traçado anterior.
  private rotaCache = new Map<
    string,
    { pos: { lat: number; lng: number }; dest: { lat: number; lng: number }; rota: any; ts: number }
  >();
  private async rotaComCache(
    chave: string,
    pos: { lat: number; lng: number },
    dest: { lat: number; lng: number },
  ) {
    const MOVEU_M = 100;
    const MAX_MS = 5 * 60 * 1000;
    const c = this.rotaCache.get(chave);
    const agora = Date.now();
    if (
      c &&
      agora - c.ts < MAX_MS &&
      this.distanciaM(c.pos.lat, c.pos.lng, pos.lat, pos.lng) < MOVEU_M &&
      this.distanciaM(c.dest.lat, c.dest.lng, dest.lat, dest.lng) < MOVEU_M
    ) {
      return c.rota;
    }
    const rota = await this.rotaOsrm(pos, dest);
    if (rota) this.rotaCache.set(chave, { pos, dest, rota, ts: agora });
    return rota ?? c?.rota ?? null;
  }

  // Duração real (minutos) de uma rota por N waypoints via OSRM (só o tempo, sem geometria).
  // FALLBACK: null se sem OSRM_URL / fora / erro → o chamador usa a reta.
  private async duracaoRotaOsrm(coords: { lat: number; lng: number }[]): Promise<number | null> {
    const base = (process.env.OSRM_URL || '').replace(/\/$/, '');
    if (!base || coords.length < 2) return null;
    try {
      const pares = coords.map((c) => `${c.lng},${c.lat}`).join(';');
      const res = await fetch(`${base}/route/v1/driving/${pares}?overview=false`, {
        signal: AbortSignal.timeout(4000),
      });
      if (!res.ok) return null;
      const j: any = await res.json();
      const rt = j?.routes?.[0];
      if (j?.code !== 'Ok' || rt?.duration == null) return null;
      return Math.max(1, Math.round(Number(rt.duration) / 60));
    } catch {
      return null;
    }
  }

  // M5 — ETA acumulado (minutos): tempo REAL pelas ruas (OSRM) da posição do entregador
  // pelas paradas PENDENTES da saída até a deste pedido. Fallback: distância reta ÷ 25 km/h.
  private async etaAcumulado(
    tenantId: string,
    ped: any,
    driverPos: { lat: number; lng: number } | null,
  ): Promise<number | null> {
    if (!driverPos || !ped.saida_id || ped.ordem_parada == null) return null;
    const r: any = await this.db.execute(sql`
      select * from pedido_externo
      where tenant_id = ${tenantId} and saida_id = ${ped.saida_id} and ordem_parada <= ${ped.ordem_parada}
        and status not in ('entregue', 'concluido', 'cancelado')
      order by ordem_parada asc`);
    // Sequência: posição do entregador → paradas pendentes até esta (na ordem).
    const coords: { lat: number; lng: number }[] = [driverPos];
    for (const s of r.rows ?? r) {
      const c = await this.coordDoPedido(tenantId, s);
      if (c) coords.push(c);
    }
    if (coords.length < 2) return null;
    // ETA real pelas ruas (OSRM); fallback: distância reta ÷ 25 km/h se o OSRM estiver fora.
    const osrm = await this.duracaoRotaOsrm(coords);
    if (osrm != null) return osrm;
    let dist = 0;
    for (let i = 1; i < coords.length; i++) {
      dist += this.distanciaM(coords[i - 1].lat, coords[i - 1].lng, coords[i].lat, coords[i].lng);
    }
    const mPorMin = 25000 / 60; // 25 km/h (fallback)
    return dist > 0 ? Math.max(1, Math.round(dist / mPorMin)) : null;
  }

  // M4 — dados PÚBLICOS de rastreio pelo token (sem login, sem PII sensível). Nome do
  // entregador só se ele optou por compartilhar (Fase 4). Telefone nunca.
  async rastreioPublico(token: string) {
    const tk = String(token ?? '').replace(/[^a-z0-9]/gi, '');
    if (!tk) throw new NotFoundException('Rastreio não encontrado.');
    const r: any = await this.db.execute(sql`select * from pedido_externo where rastreio_token = ${tk} limit 1`);
    const ped = (r.rows ?? r)[0];
    if (!ped) throw new NotFoundException('Rastreio não encontrado.');
    const tenantId = ped.tenant_id;
    const rotulo: Record<string, string> = {
      confirmado: 'em preparo',
      pronto: 'pronto — aguardando entregador',
      despachado: 'a caminho',
      entregue: 'entregue',
      concluido: 'entregue',
      cancelado: 'cancelado',
    };
    // Posição do entregador (última) + nome só com opt-in.
    let entregador: any = null;
    let pos: { lat: number; lng: number } | null = null;
    if (ped.entregador_id) {
      const loc: any = await this.db.execute(sql`
        select lat, lng, criado_em from entregador_localizacao
        where colaborador_id = ${ped.entregador_id} order by criado_em desc limit 1`);
      const l = (loc.rows ?? loc)[0];
      if (l && l.lat != null && l.lng != null) pos = { lat: Number(l.lat), lng: Number(l.lng) };
      const pref: any = await this.db.execute(sql`select compartilha_contato from entregador_preferencia where colaborador_id = ${ped.entregador_id}`);
      const compartilha = (pref.rows ?? pref)[0]?.compartilha_contato === true;
      entregador = { pos, nome: compartilha ? ped.entregador_nome ?? null : null };
    }
    const destino = await this.coordDoPedido(tenantId, ped);
    let parada: { x: number; y: number } | null = null;
    if (ped.saida_id && ped.ordem_parada != null) {
      const t: any = await this.db.execute(sql`select count(*)::int as n from pedido_externo where saida_id = ${ped.saida_id}`);
      parada = { x: Number(ped.ordem_parada), y: Number((t.rows ?? t)[0]?.n ?? 0) };
    }
    const eta = ['despachado'].includes(String(ped.status)) ? await this.etaAcumulado(tenantId, ped, pos) : null;
    // Código de entrega (Fase 5) — o CLIENTE vê aqui p/ informar ao entregador. Só entrega
    // própria (não marketplace, que valida pela API do canal) e enquanto não foi entregue.
    const codigoEntrega =
      ped.tipo !== 'retirada' &&
      !['ifood', '99food'].includes(String(ped.canal)) &&
      ped.codigo_entrega &&
      !['entregue', 'concluido', 'cancelado'].includes(String(ped.status))
        ? String(ped.codigo_entrega)
        : null;
    // Rota real (OSRM) SÓ quando o entregador está a caminho (regra do gestor: rastreio só
    // quando indo até o cliente) — traçado entregador → este destino.
    const rota =
      String(ped.status) === 'despachado' && pos && destino
        ? await this.rotaComCache(String(ped.id ?? tk), pos, destino)
        : null;
    return {
      numero: ped.numero,
      status: String(ped.status),
      statusLabel: rotulo[String(ped.status)] ?? String(ped.status),
      entregador,
      destino, // { lat, lng } | null
      parada, // { x, y } | null
      etaMin: eta ?? rota?.duracaoMin ?? null, // saída multi-parada; senão a duração da rota (OSRM)
      rota, // { geometry(polyline6), duracaoMin, distanciaM } | null — traçado real p/ o mapa
      codigoEntrega, // o cliente informa ao entregador na entrega
    };
  }

  private distanciaM(lat1: number, lng1: number, lat2: number, lng2: number): number {
    const R = 6371000;
    const toRad = (x: number) => (x * Math.PI) / 180;
    const dLat = toRad(lat2 - lat1);
    const dLng = toRad(lng2 - lng1);
    const s =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(s));
  }

  // GEOFENCE AUTOMÁTICO: a cada ping, geocodifica o endereço do pedido (1x, cacheado
  // em entregador_chegada), mede a distância e dispara o alerta UMA vez ao chegar no
  // raio (70m). Best-effort — nunca atrapalha o ping.
  private async checarChegada(user: AuthUser, lat: number, lng: number) {
    try {
      const cfg = await this.configPagamento(user.tenantId);
      const RAIO = Number(cfg.raioChegadaM) || 70;
      const pedidos = await this.db
        .select()
        .from(pedidoExterno)
        .where(
          and(
            eq(pedidoExterno.tenantId, user.tenantId),
            eq(pedidoExterno.entregadorId, user.colaboradorId),
            eq(pedidoExterno.status, 'despachado'),
          ),
        );
      for (const ped of pedidos) {
        if (ped.tipo === 'retirada') continue;
        let ch: any = (
          await this.db.execute(
            sql`select lat, lng, avisada from entregador_chegada where pedido_id = ${ped.id}`,
          )
        ).rows?.[0];
        if (!ch) {
          const partes = [ped.enderecoRua, ped.enderecoNumero, ped.enderecoBairro].filter(
            Boolean,
          ) as string[];
          const end = partes.length ? montarEndereco(partes) : String(ped.endereco ?? '');
          const g = end ? await geocode(end).catch(() => null) : null;
          await this.db.execute(sql`
            insert into entregador_chegada (tenant_id, pedido_id, lat, lng)
            values (${user.tenantId}, ${ped.id}, ${g?.lat ?? null}, ${g?.lng ?? null})
            on conflict (pedido_id) do nothing`);
          ch = { lat: g?.lat ?? null, lng: g?.lng ?? null, avisada: false };
        }
        if (ch.avisada || ch.lat == null || ch.lng == null) continue;
        const dist = this.distanciaM(lat, lng, Number(ch.lat), Number(ch.lng));
        if (dist <= RAIO) {
          await this.db.execute(sql`update entregador_chegada set avisada = true where pedido_id = ${ped.id}`);
          await this.dispararChegada(user, ped);
        }
      }
    } catch {
      // silencioso
    }
  }
}
