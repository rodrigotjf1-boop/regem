import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, desc, eq, sql } from 'drizzle-orm';
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
      pago: p.pago,
      formaPagamento: p.formaPagamento,
      status: p.status,
      raw: p.raw ?? null, // p/ o app detectar entrega própria (código de entrega)
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
    if (codigo && codigo.trim()) {
      return this.delivery.confirmarEntregaComCodigo(user.tenantId, user.colaboradorId, id, codigo.trim());
    }
    await this.delivery.finalizar(user.tenantId, user.colaboradorId, id, {});
    return { ok: true };
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

  // Gestor: última posição de cada entregador ativo nos últimos 15 min + nº em rota.
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
    return r.rows ?? r;
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

  // Monta o payload e dispara o alerta de chegada no webhook (manual e automático).
  private async dispararChegada(user: AuthUser, ped: any): Promise<boolean> {
    if (!ped.clienteTelefone) return false;
    const r: any = await this.db.execute(
      sql`select telefone from colaborador where id = ${user.colaboradorId}`,
    );
    const entregadorTelefone = (r.rows ?? r)[0]?.telefone ?? null;
    return this.cliente.enviarEventoWebhook(user.tenantId, {
      evento: 'chegando',
      telefone: String(ped.clienteTelefone).replace(/\D/g, ''),
      cliente: ped.clienteNome,
      numero: ped.numero,
      entregadorNome: user.nome ?? ped.entregadorNome ?? 'Entregador',
      entregadorTelefone,
    });
  }

  // ===== E5 — pagamento do entregador =====
  private readonly MODELOS = [
    'diaria_taxas',
    'so_diaria',
    'so_taxas',
    'so_taxa_fixa',
    'diaria_taxas_fixas',
  ];

  // Config de pagamento da loja (default se ainda não configurou).
  async configPagamento(tenantId: string) {
    const r: any = await this.db.execute(
      sql`select modelo, diaria_centavos, taxa_entrega_centavos, taxa_fixa_centavos, raio_chegada_m
          from entregador_config where tenant_id = ${tenantId}`,
    );
    const c = (r.rows ?? r)[0];
    return {
      modelo: c?.modelo ?? 'diaria_taxas',
      diariaCentavos: Number(c?.diaria_centavos ?? 0),
      taxaEntregaCentavos: Number(c?.taxa_entrega_centavos ?? 0),
      taxaFixaCentavos: Number(c?.taxa_fixa_centavos ?? 0),
      raioChegadaM: Number(c?.raio_chegada_m ?? 70),
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
    },
  ) {
    const modelo = this.MODELOS.includes(String(dto?.modelo)) ? String(dto.modelo) : 'diaria_taxas';
    const cent = (v: any) => Math.max(0, Math.round(Number(v) || 0));
    const diaria = cent(dto?.diariaCentavos);
    const taxaEnt = cent(dto?.taxaEntregaCentavos);
    const taxaFix = cent(dto?.taxaFixaCentavos);
    // Raio do aviso de chegada: clamp defensivo (o app oferece 20/30/40/60/70m).
    const raio = Math.min(1000, Math.max(10, Math.round(Number(dto?.raioChegadaM) || 70)));
    await this.db.execute(sql`
      insert into entregador_config (tenant_id, modelo, diaria_centavos, taxa_entrega_centavos, taxa_fixa_centavos, raio_chegada_m)
      values (${tenantId}, ${modelo}, ${diaria}, ${taxaEnt}, ${taxaFix}, ${raio})
      on conflict (tenant_id) do update set
        modelo = excluded.modelo,
        diaria_centavos = excluded.diaria_centavos,
        taxa_entrega_centavos = excluded.taxa_entrega_centavos,
        taxa_fixa_centavos = excluded.taxa_fixa_centavos,
        raio_chegada_m = excluded.raio_chegada_m,
        atualizado_em = now()`);
    return { ok: true };
  }

  // Calcula (diaria, taxas, total) em centavos para um nº de entregas, dado o modelo.
  private calcular(cfg: any, entregas: number) {
    const d = Number(cfg.diariaCentavos) || 0;
    const te = Number(cfg.taxaEntregaCentavos) || 0;
    const tf = Number(cfg.taxaFixaCentavos) || 0;
    let diaria = 0;
    let taxas = 0;
    switch (cfg.modelo) {
      case 'so_diaria':
        diaria = d;
        break;
      case 'so_taxas':
        taxas = entregas * te;
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
        taxas = entregas * te;
        break;
    }
    return { diaria, taxas, total: diaria + taxas };
  }

  // Gestor: fechamento do dia — por entregador, entregas concluídas + valores calculados
  // + se já foi fechado (pago). data = 'YYYY-MM-DD'.
  async fechamentoDia(tenantId: string, data: string) {
    const dia = /^\d{4}-\d{2}-\d{2}$/.test(String(data)) ? String(data) : null;
    if (!dia) throw new BadRequestException('Data inválida (use YYYY-MM-DD).');
    const cfg = await this.configPagamento(tenantId);
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
      modelo: cfg.modelo,
      entregadores: linhas.map((l) => {
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
    const cfg = await this.configPagamento(tenantId);
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

  // App do entregador: meus ganhos de hoje (entregas + valor estimado pelo modelo da loja).
  async ganhos(user: AuthUser) {
    if (!this.ehEntregador(user)) throw new ForbiddenException('Apenas entregadores.');
    const cfg = await this.configPagamento(user.tenantId);
    const r: any = await this.db.execute(sql`
      select count(*)::int as entregas from pedido_externo
      where tenant_id = ${user.tenantId} and entregador_id = ${user.colaboradorId}
        and status = 'concluido'
        and (concluido_em at time zone 'America/Sao_Paulo')::date = (now() at time zone 'America/Sao_Paulo')::date`);
    const entregas = Number((r.rows ?? r)[0]?.entregas ?? 0);
    const v = this.calcular(cfg, entregas);
    return { entregas, ...v };
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
