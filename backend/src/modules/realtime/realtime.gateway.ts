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
import { lerCookieSessao } from '../../auth/cookie-sessao';

/* eslint-disable @typescript-eslint/no-explicit-any */

// Contexto anexado ao socket após o handshake autenticado.
interface SockCtx {
  tenantId: string;
  unidadeId?: string | null;
  role: 'gestor' | 'device';
  tipo?: string; // kds | terminal_ponto (quando device)
  equipamentoId?: string;
  colaboradorId?: string; // PDV logado (dono de mesa) — para roteio garçom → PDV
}

const corsOrigin = process.env.CORS_ORIGIN;

// Gateway de tempo real dos apps satélites (KDS / Terminal de Ponto) e do painel.
// Rooms por tenant (+ unidade e tipo de device). Handshake por JWT (gestor/web)
// ou por token de equipamento (device). Ver decisoes-design §5 e CLAUDE.md.
@WebSocketGateway({
  // Nuvem (lista fixa): credentials:true p/ o cookie httpOnly ir no handshake.
  // Edge ('*'/sem lista): origin:true, auth por jwt/device (sem cookie).
  cors:
    corsOrigin && corsOrigin.trim() !== '*'
      ? { origin: corsOrigin.split(',').map((o) => o.trim()), credentials: true }
      : { origin: true },
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
      } else {
        // Gestor: JWT no handshake (edge/Bearer) OU cookie httpOnly (nuvem, Fase B).
        const jwt =
          auth.jwt || lerCookieSessao({ headers: socket.handshake.headers } as any);
        if (!jwt) return this.recusar(socket, 'sem credenciais');
        const p: any = this.jwt.verify(jwt);
        const ctx: SockCtx = {
          tenantId: p.tenant,
          role: 'gestor',
          colaboradorId: p.sub,
        };
        socket.data.ctx = ctx;
        this.entrarSalas(socket, ctx);
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
    // PDV logado entra na própria sala → recebe avisos das mesas que abriu.
    if (ctx.role === 'gestor' && ctx.colaboradorId) {
      socket.join(`pdv:${ctx.colaboradorId}`);
    }
  }

  private recusar(socket: Socket, motivo: string) {
    socket.emit('erro', { motivo });
    socket.disconnect(true);
  }

  // Sanitiza texto vindo do socket (W1): remove caracteres de controle e corta no limite —
  // evita injeção de conteúdo arbitrário nas telas do KDS de todo o tenant.
  private sanitizar(v: any, max: number): string {
    let out = '';
    for (const ch of String(v ?? '')) {
      const c = ch.charCodeAt(0);
      out += c < 32 || c === 127 ? ' ' : ch; // troca controles por espaco
    }
    return out.trim().slice(0, max);
  }

  // Rate-limit simples por socket+ação (in-memory no próprio socket): true se já passou o
  // intervalo desde a última vez (W1 — evita flood de alerta/ping = DoS intra-tenant + escrita).
  private permitido(socket: Socket, acao: string, intervaloMs: number): boolean {
    const agora = Date.now();
    const mapa: Record<string, number> = (socket.data._rl ??= {});
    if (agora - (mapa[acao] ?? 0) < intervaloMs) return false;
    mapa[acao] = agora;
    return true;
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

  // Alerta gerado por job do sistema (ROP, validades FEFO) → fila do KDS/gestor.
  @OnEvent('kds.alerta.sistema')
  onAlertaSistema(p: {
    tenantId: string;
    titulo: string;
    detalhe?: string;
    prioridade?: string;
    duracaoSeg?: number; // quanto tempo fica no rodapé do KDS (motor de alertas, Fase B)
  }) {
    if (!this.server) return;
    this.server.to(`tenant:${p.tenantId}`).emit('kds:alerta', {
      id: randomUUID(),
      titulo: p.titulo,
      detalhe: p.detalhe ?? '',
      prioridade: p.prioridade ?? 'alta',
      duracaoSeg: Number(p.duracaoSeg) > 0 ? Number(p.duracaoSeg) : 60,
      som: true,
      em: new Date().toISOString(),
    });
  }

  // Produção durável (Fase F1): novo pedido / mudança de status / cancelamento.
  // Nudge para tenant → KDS e PDV refazem o GET (fonte da verdade no servidor).
  @OnEvent('producao.evento')
  onProducaoEvento(p: {
    tenantId: string;
    unidadeId?: string | null;
    setorId?: string | null;
    destinoEquipamentoId?: string | null;
    pedidoId?: string;
    tipo: 'novo' | 'status' | 'cancelado';
    status?: string;
  }) {
    if (!this.server) return;
    this.server.to(`tenant:${p.tenantId}`).emit('producao:atualizado', {
      ...p,
      em: new Date().toISOString(),
    });
  }

  // Chamado de atendimento aberto (handoff do robô) → sino no app do tenant.
  @OnEvent('atendimento.novo')
  onAtendimentoNovo(p: { tenantId: string; chamado: any }) {
    if (!this.server) return;
    this.server.to(`tenant:${p.tenantId}`).emit('atendimento:novo', {
      chamado: p.chamado,
      em: new Date().toISOString(),
    });
  }

  // Garçom lançou item numa mesa → avisa o PDV dono (e o tenant como fallback).
  @OnEvent('mesa.evento')
  onMesaEvento(p: {
    tenantId: string;
    donoId?: string | null;
    mesaId: string;
    comandaId?: string;
    tipo: string;
    descricao?: string;
    quantidade?: number;
  }) {
    if (!this.server) return;
    const payload = { ...p, em: new Date().toISOString() };
    if (p.donoId) this.server.to(`pdv:${p.donoId}`).emit('mesa:atualizada', payload);
    // fallback: quem estiver na tela de mesas do tenant também atualiza
    this.server.to(`tenant:${p.tenantId}`).emit('mesa:atualizada', payload);
  }

  // Alerta para o KDS (entra no topo da fila, com som). Emitido por gestor autenticado.
  @SubscribeMessage('kds:alerta')
  onAlerta(@ConnectedSocket() socket: Socket, @MessageBody() body: any) {
    const ctx: SockCtx | undefined = socket.data?.ctx;
    if (!ctx) return { ok: false };
    // RBAC (W1): só GESTOR dispara alerta ao KDS. Um device (token de KDS/ponto) NÃO pode
    // broadcastar conteúdo arbitrário para todo o tenant.
    if (ctx.role !== 'gestor') return { ok: false, erro: 'sem permissão' };
    // Rate-limit: no máx. ~1 alerta/2s por socket (evita flood intra-tenant).
    if (!this.permitido(socket, 'alerta', 2000)) return { ok: false, erro: 'muito rápido, aguarde' };
    const alerta = {
      id: this.sanitizar(body?.id, 64) || randomUUID(),
      titulo: this.sanitizar(body?.titulo, 80) || 'Alerta',
      detalhe: this.sanitizar(body?.detalhe, 300),
      prioridade: ['alta', 'media', 'baixa'].includes(body?.prioridade) ? body.prioridade : 'alta',
      som: body?.som !== false,
      em: new Date().toISOString(),
    };
    this.server.to(`tenant:${ctx.tenantId}`).emit('kds:alerta', alerta);
    return { ok: true, alerta };
  }

  // Heartbeat do device — atualiza último ping (presença/telemetria).
  @SubscribeMessage('device:ping')
  async onPing(@ConnectedSocket() socket: Socket) {
    const ctx: SockCtx | undefined = socket.data?.ctx;
    // Rate-limit (W1): o ping GRAVA no banco → no máx. 1 escrita/10s por socket (um device não
    // pode floodar escrita). O ACK volta sempre; só a persistência é limitada.
    if (ctx?.equipamentoId && this.permitido(socket, 'ping', 10000)) {
      await this.equipamentos.registrarPing(ctx.equipamentoId);
    }
    return { ok: true };
  }
}
