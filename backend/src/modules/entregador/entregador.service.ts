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

/* eslint-disable @typescript-eslint/no-explicit-any */
// App do Entregador. Auth reusa o login de colaborador (JWT já traz nome/função/
// permissões). Sempre por tenant; reusa a lógica de despacho do DeliveryService.
@Injectable()
export class EntregadorService {
  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly delivery: DeliveryService,
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
}
