import { Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { JwtService } from '@nestjs/jwt';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { randomUUID } from 'crypto';
import { Server, Socket } from 'socket.io';
import { EquipamentoService } from '../equipamento/equipamento.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

// Contexto anexado ao socket após o handshake autenticado.
interface SockCtx {
  tenantId: string;
  unidadeId?: string | null;
  role: 'gestor' | 'device';
  tipo?: string; // kds | terminal_ponto (quando device)
  equipamentoId?: string;
}

const corsOrigin = process.env.CORS_ORIGIN;

// Gateway de tempo real dos apps satélites (KDS / Terminal de Ponto) e do painel.
// Rooms por tenant (+ unidade e tipo de device). Handshake por JWT (gestor/web)
// ou por token de equipamento (device). Ver decisoes-design §5 e CLAUDE.md.
@WebSocketGateway({
  cors: corsOrigin ? { origin: corsOrigin.split(',').map((o) => o.trim()) } : { origin: true },
})
export class RealtimeGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  private readonly log = new Logger('Realtime');

  @WebSocketServer() server!: Server;

  constructor(
    private readonly jwt: JwtService,
    private readonly equipamentos: EquipamentoService,
  ) {}

  async handleConnection(socket: Socket) {
    try {
      const auth: any = socket.handshake.auth ?? {};
      if (auth.token) {
        const eq = await this.equipamentos.validarToken(auth.token);
        if (!eq) return this.recusar(socket, 'device inválido ou revogado');
        const ctx: SockCtx = {
          tenantId: eq.tenantId,
          unidadeId: eq.unidadeId,
          role: 'device',
          tipo: eq.tipo,
          equipamentoId: eq.id,
        };
        socket.data.ctx = ctx;
        this.entrarSalas(socket, ctx);
        await this.equipamentos.registrarPing(eq.id);
        this.server.to(`tenant:${ctx.tenantId}`).emit('device:status', {
          equipamentoId: eq.id,
          nome: eq.nome,
          tipo: eq.tipo,
          online: true,
        });
        this.log.log(`device conectado: ${eq.tipo} · ${eq.nome}`);
      } else if (auth.jwt) {
        const p: any = this.jwt.verify(auth.jwt);
        const ctx: SockCtx = { tenantId: p.tenant, role: 'gestor' };
        socket.data.ctx = ctx;
        this.entrarSalas(socket, ctx);
      } else {
        return this.recusar(socket, 'sem credenciais');
      }
    } catch {
      this.recusar(socket, 'handshake inválido');
    }
  }

  handleDisconnect(socket: Socket) {
    const ctx: SockCtx | undefined = socket.data?.ctx;
    if (ctx?.role === 'device') {
      this.server.to(`tenant:${ctx.tenantId}`).emit('device:status', {
        equipamentoId: ctx.equipamentoId,
        tipo: ctx.tipo,
        online: false,
      });
    }
  }

  private entrarSalas(socket: Socket, ctx: SockCtx) {
    socket.join(`tenant:${ctx.tenantId}`);
    if (ctx.unidadeId) socket.join(`unidade:${ctx.unidadeId}`);
    if (ctx.role === 'device' && ctx.tipo) {
      socket.join(`${ctx.tipo}:${ctx.tenantId}`);
    }
  }

  private recusar(socket: Socket, motivo: string) {
    socket.emit('erro', { motivo });
    socket.disconnect(true);
  }

  // Marcação de ponto gravada em qualquer origem (web/terminal/gestor) → broadcast ao vivo.
  @OnEvent('ponto.marcado')
  onPontoMarcado(p: {
    tenantId: string;
    unidadeId?: string | null;
    origem: string;
    comprovante: any;
  }) {
    if (!this.server) return;
    this.server.to(`tenant:${p.tenantId}`).emit('ponto:marcado', p);
  }

  // Pedido de produção (venda balcão/comanda) → KDS. Roteado por tenant/unidade.
  @OnEvent('kds.pedido')
  onKdsPedido(p: {
    tenantId: string;
    unidadeId?: string | null;
    comandaId: string;
    mesa?: string | null;
    itens: any[];
  }) {
    if (!this.server) return;
    this.server.to(`tenant:${p.tenantId}`).emit('kds:pedido', {
      ...p,
      em: new Date().toISOString(),
    });
  }

  // Alerta para o KDS (entra no topo da fila, com som). Emitido por gestor autenticado.
  @SubscribeMessage('kds:alerta')
  onAlerta(@ConnectedSocket() socket: Socket, @MessageBody() body: any) {
    const ctx: SockCtx | undefined = socket.data?.ctx;
    if (!ctx) return { ok: false };
    const alerta = {
      id: body?.id ?? randomUUID(),
      titulo: body?.titulo ?? 'Alerta',
      detalhe: body?.detalhe ?? '',
      prioridade: body?.prioridade ?? 'alta',
      som: body?.som ?? true,
      em: new Date().toISOString(),
    };
    this.server.to(`tenant:${ctx.tenantId}`).emit('kds:alerta', alerta);
    return { ok: true, alerta };
  }

  // Heartbeat do device — atualiza último ping (presença/telemetria).
  @SubscribeMessage('device:ping')
  async onPing(@ConnectedSocket() socket: Socket) {
    const ctx: SockCtx | undefined = socket.data?.ctx;
    if (ctx?.equipamentoId) await this.equipamentos.registrarPing(ctx.equipamentoId);
    return { ok: true };
  }
}
