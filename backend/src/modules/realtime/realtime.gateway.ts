import { Inject, Logger, Optional } from '@nestjs/common';
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
import { PresencaService, enderecoDoHost, ipDoPc, versaoInformada } from '../equipamento/presenca.service';
import { lerCookieSessao } from '../../auth/cookie-sessao';
import { ehServidorLocal } from '../../common/modo';
import { ehTipoDeAviso } from '../../common/avisos-do-kds';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { sql } from 'drizzle-orm';

/* eslint-disable @typescript-eslint/no-explicit-any */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * As prioridades que o KDS conhece (o rodapé ordena danger > alta > info > ok). Outros módulos mandavam 'media'/'baixa'
 * (contagem, compras) e o KDS, sem conhecer, ordenava por NaN — a "Compra recebida" passava na frente do "❌ CANCELADO"
 * (auditoria do KDS, 11/11/2026). 'media' vira alta, 'baixa' vira info; ausente ou desconhecida, alta (como sempre).
 */
export function prioridadeDoKds(p: unknown): 'danger' | 'alta' | 'info' | 'ok' {
  if (p === 'danger' || p === 'alta' || p === 'info' || p === 'ok') return p;
  if (p === 'baixa') return 'info';
  return 'alta';
}

// Contexto anexado ao socket após o handshake autenticado.
interface SockCtx {
  tenantId: string;
  unidadeId?: string | null;
  // 'tela' = a tela de senhas (mig 337): entra SÓ na sala `senhas:<empresa>` e recebe só "mudou" — nunca a sala da
  // empresa, que leva pedido, cliente e alerta. Ela relê o quadro (só números) pela rota com o segredo dela.
  role: 'gestor' | 'device' | 'tela';
  tipo?: string; // kds | terminal_ponto (quando device)
  equipamentoId?: string;
  colaboradorId?: string; // PDV logado (dono de mesa) — para roteio garçom → PDV
  categoria?: string | null; // nível de quem entrou com login (presidente, gerente…) — o envio de alerta pelo socket
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
    // Opcional: os testes montam o gateway só com os dois de cima.
    @Optional() private readonly presenca?: PresencaService,
    // As lojas da empresa, para pôr o socket de quem entra com login na sala da loja. Opcional pelos testes.
    @Optional() @Inject(DRIZZLE) private readonly db?: DrizzleDB,
  ) {}

  /**
   * As lojas cuja sala o socket de quem entrou com LOGIN recebe (auditoria do KDS, 11/11/2026). Antes ele entrava só na
   * sala da empresa, e o KDS (que sempre entra com login) nunca recebia o que vai para a sala da LOJA — o alerta de ponto
   * de pedido, de validade e de produto esgotado se perdiam, mesmo em empresa de uma loja só. A regra é a da loja em uso
   * (`UnidadeAtual`): quem tem loja fixa fica na dela (o pedido é ignorado); o presidente fica na loja escolhida — conferida
   * NA EMPRESA (V86) — ou, em "todas as lojas", em todas; outro nível sem loja não entra em sala de loja nenhuma.
   */
  async lojasDoLogin(tenantId: string, payload: any, pedida: unknown): Promise<string[]> {
    if (typeof payload?.uni === 'string' && UUID_RE.test(payload.uni)) return [payload.uni];
    if (payload?.cat !== 'presidente' || !this.db) return [];
    const r: any = await this.db.execute(sql`select id from unidade where tenant_id = ${tenantId}`);
    const lojas: string[] = ((r.rows ?? r) as any[]).map((x) => String(x.id));
    if (typeof pedida === 'string' && UUID_RE.test(pedida) && lojas.includes(pedida)) return [pedida];
    return lojas;
  }

  async handleConnection(socket: Socket) {
    try {
      const auth: any = socket.handshake.auth ?? {};
      if (auth.tela && typeof auth.tela === 'object') {
        // Tela de senhas: id + segredo do pareamento. Não grava no banco nem avisa "device:status" (ela não é aparelho
        // de operação, e cada gravação renovaria uma linha que sincroniza — ERR-235). A presença fica só na MEMÓRIA do
        // servidor da loja (o ícone do servidor mostra a TV conectada e a versão da tela).
        const tela = await this.equipamentos.validarTela(String(auth.tela.id ?? ''), auth.tela.segredo ? String(auth.tela.segredo) : null);
        if (!tela) return this.recusar(socket, 'tela de senhas inválida ou revogada');
        socket.data.ctx = { tenantId: tela.tenantId, unidadeId: tela.unidadeId, role: 'tela', tipo: 'tela_senhas', equipamentoId: tela.id } satisfies SockCtx;
        socket.join(`senhas:${tela.tenantId}`);
        this.anotarConexao(socket, tela.id, tela.tenantId, 'tela_senhas', auth.versao);
        return;
      }
      if (auth.token) {
        const eq = await this.equipamentos.validarToken(auth.token);
        if (!eq) return this.recusar(socket, 'device inválido ou revogado');
        // A credencial de um integrador (GoGeM, mig 290) é token de `servidor_local`, mas não é
        // aparelho da loja: na nuvem ela não entra nas salas da empresa (pedidos, cozinha, aparelhos)
        // — só nas rotas dela (`@AceitaIntegrador`). No servidor da loja ela nem existe.
        if (eq.integrador && !ehServidorLocal()) return this.recusar(socket, 'credencial de integração não abre o tempo real');
        const ctx: SockCtx = {
          tenantId: eq.tenantId,
          unidadeId: eq.unidadeId,
          role: 'device',
          tipo: eq.tipo,
          equipamentoId: eq.id,
        };
        socket.data.ctx = ctx;
        this.entrarSalas(socket, ctx);
        if (eq.tipo === 'kds') this.anotarConexao(socket, eq.id, eq.tenantId, 'kds', auth.versao);
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
        const lojas = await this.lojasDoLogin(p.tenant, p, auth.unidade);
        const ctx: SockCtx = {
          tenantId: p.tenant,
          role: 'gestor',
          colaboradorId: p.sub,
          categoria: typeof p.cat === 'string' ? p.cat : null,
          // Uma loja só (a fixa, ou a escolhida pelo presidente): é a loja do socket (o alerta pelo socket vai para ela).
          unidadeId: lojas.length === 1 ? lojas[0] : null,
        };
        socket.data.ctx = ctx;
        this.entrarSalas(socket, ctx);
        for (const loja of lojas) socket.join(`unidade:${loja}`);
      }
    } catch {
      this.recusar(socket, 'handshake inválido');
    }
  }

  /**
   * KDS e TV ficam conectados pelo tempo real: o servidor da loja anota na memória quando abrem e quando caem (o ícone do
   * servidor mostra "conectado agora" / "caiu há N min" e a versão da tela). Fora do servidor da loja não anota nada.
   */
  private anotarConexao(socket: Socket, id: string, tenantId: string, tipo: 'kds' | 'tela_senhas', versao: unknown) {
    if (!this.presenca) return;
    this.presenca.conectou({
      id,
      tenantId,
      tipo,
      ip: ipDoPc(socket.handshake?.address),
      endereco: enderecoDoHost(socket.handshake?.headers?.host),
      maquina: null,
      versao: versaoInformada(versao),
    });
    socket.data.presenca = id;
  }

  handleDisconnect(socket: Socket) {
    const ctx: SockCtx | undefined = socket.data?.ctx;
    if (socket.data?.presenca) this.presenca?.desconectou(String(socket.data.presenca));
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
    unidadeId?: string | null;
    titulo: string;
    detalhe?: string;
    prioridade?: string;
    duracaoSeg?: number; // quanto tempo fica no rodapé do KDS (motor de alertas, Fase B)
    // O tipo do aviso (onda 2 da auditoria do KDS, mig 408): cada tela de KDS escolhe os tipos que recebe
    // (`common/avisos-do-kds.ts`). Sem tipo = alerta da loja (o que sempre apareceu).
    tipo?: string;
  }) {
    if (!this.server) return;
    // Alerta de LOJA vai só para a sala da loja (mig 249). Na sala do tenant, o KDS de
    // todas as lojas tocaria o alerta de uma — com a lista de insumos dela. Sem unidade
    // (loja única, e os demais emissores deste evento), segue para o tenant como antes.
    const sala = p.unidadeId ? `unidade:${p.unidadeId}` : `tenant:${p.tenantId}`;
    this.server.to(sala).emit('kds:alerta', {
      id: randomUUID(),
      titulo: p.titulo,
      detalhe: p.detalhe ?? '',
      prioridade: prioridadeDoKds(p.prioridade),
      duracaoSeg: Number(p.duracaoSeg) > 0 ? Number(p.duracaoSeg) : 60,
      som: true,
      tipo: ehTipoDeAviso(p.tipo) ? p.tipo : 'loja',
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
    // A tela de senhas relê o quadro: só o aviso, sem o conteúdo (ela não está na sala da empresa).
    this.server.to(`senhas:${p.tenantId}`).emit('senhas:mudou', { em: new Date().toISOString() });
  }

  // Ajuste da tela de senhas salvo (tamanho, tempo em Pronto, aviso): as TVs relêem e se redesenham na hora.
  @OnEvent('tela.senhas.mudou')
  onTelaSenhasMudou(p: { tenantId: string }) {
    if (!this.server) return;
    this.server.to(`senhas:${p.tenantId}`).emit('senhas:mudou', { em: new Date().toISOString(), ajustes: true });
  }

  // O painel do Delivery mandou o mapa para KDS (ou tirou) — entrega 5: as telas de KDS relêem a lista e trocam na hora.
  // Só o aviso; o que cada tela mostra vem da lista (`GET /producao/kds/telas`).
  @OnEvent('kds.telas.mudou')
  onKdsTelasMudou(p: { tenantId: string }) {
    if (!this.server) return;
    this.server.to(`tenant:${p.tenantId}`).emit('kds:telas', { em: new Date().toISOString() });
  }

  // Pausaram, reabriram ou estenderam um canal (onda 2 da auditoria do KDS): a faixa da pausa no KDS relê na hora. Só o
  // aviso; o que a faixa mostra vem de `GET /delivery/pausas/kds` (a do outro servidor, pelo sync e pela releitura de 30 s).
  @OnEvent('kds.pausa.mudou')
  onKdsPausaMudou(p: { tenantId: string }) {
    if (!this.server) return;
    this.server.to(`tenant:${p.tenantId}`).emit('kds:pausa', { em: new Date().toISOString() });
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

  // Caso de atendimento mudou (pegou, passou, aguardando, cliente respondeu, resolveu) → as telas da fila relêem.
  // Só o aviso; o que a tela mostra vem da fila (`GET /atendimento/fila`), que filtra a loja e o perfil.
  @OnEvent('atendimento.mudou')
  onAtendimentoMudou(p: { tenantId: string; id: string; motivo?: string }) {
    if (!this.server) return;
    this.server.to(`tenant:${p.tenantId}`).emit('atendimento:mudou', {
      id: p.id,
      motivo: p.motivo ?? null,
      em: new Date().toISOString(),
    });
  }

  // Comentário de post do Instagram novo ou que mudou (F6, mig 384: chegou, o robô respondeu, a equipe respondeu, privada,
  // escondido) → a lista "Comentários" relê. Só o aviso; o que a tela mostra vem da lista (que confere o perfil).
  @OnEvent('instagram.comentario')
  onComentarioDoInstagram(p: { tenantId: string; id: string; motivo?: string }) {
    if (!this.server) return;
    this.server.to(`tenant:${p.tenantId}`).emit('instagram:comentario', {
      id: p.id,
      motivo: p.motivo ?? null,
      em: new Date().toISOString(),
    });
  }

  // Marcação do Instagram nova ou que mudou (mig 387: chegou, a IA sugeriu, agradecida, virou caso, publicada, ignorada) →
  // a lista "Marcações" relê. Só o aviso; o que a tela mostra vem da lista (que confere o perfil).
  @OnEvent('instagram.marcacao')
  onMarcacaoDoInstagram(p: { tenantId: string; id: string; motivo?: string }) {
    if (!this.server) return;
    this.server.to(`tenant:${p.tenantId}`).emit('instagram:marcacao', {
      id: p.id,
      motivo: p.motivo ?? null,
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
    // Só presidente e gerente mandam alerta a todas as telas — como a rota REST (auditoria do KDS, 11/11/2026: qualquer
    // login, até o da execução, mandava).
    if (ctx.categoria !== 'presidente' && ctx.categoria !== 'gerente') return { ok: false, erro: 'sem permissão' };
    // Rate-limit: no máx. ~1 alerta/2s por socket (evita flood intra-tenant).
    if (!this.permitido(socket, 'alerta', 2000)) return { ok: false, erro: 'muito rápido, aguarde' };
    const alerta = {
      id: this.sanitizar(body?.id, 64) || randomUUID(),
      titulo: this.sanitizar(body?.titulo, 80) || 'Alerta',
      detalhe: this.sanitizar(body?.detalhe, 300),
      prioridade: prioridadeDoKds(body?.prioridade),
      som: body?.som !== false,
      tipo: 'loja', // o gestor mandou à loja: um "alerta da loja" (mig 408)
      em: new Date().toISOString(),
    };
    // Da loja de quem mandou (loja fixa ou a escolhida); sem loja (presidente em "todas"), a empresa inteira.
    this.server.to(ctx.unidadeId ? `unidade:${ctx.unidadeId}` : `tenant:${ctx.tenantId}`).emit('kds:alerta', alerta);
    return { ok: true, alerta };
  }

  // Heartbeat do device — atualiza último ping (presença/telemetria).
  @SubscribeMessage('device:ping')
  async onPing(@ConnectedSocket() socket: Socket) {
    const ctx: SockCtx | undefined = socket.data?.ctx;
    // Rate-limit (W1): o ping GRAVA no banco → no máx. 1 escrita/10s por socket (um device não
    // pode floodar escrita). O ACK volta sempre; só a persistência é limitada.
    // A tela de senhas não grava ping: a linha dela sincroniza e o ajuste não pode ser desfeito pelo uso (ERR-235).
    if (ctx?.equipamentoId && ctx.role !== 'tela' && this.permitido(socket, 'ping', 10000)) {
      await this.equipamentos.registrarPing(ctx.equipamentoId);
    }
    return { ok: true };
  }
}
