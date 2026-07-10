import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { and, desc, eq, sql } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import {
  cardapioConfig,
  cliente,
  clienteEndereco,
  clienteOtp,
  pedidoExterno,
} from '../../db/schema';
import { assinarCliente, verificarCliente } from './cliente-token';

/* eslint-disable @typescript-eslint/no-explicit-any */
const soDigitos = (s?: string) => (s ?? '').replace(/\D/g, '');
const OTP_MIN = 5; // validade do código em minutos

@Injectable()
export class ClienteService {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDB) {}

  // Token do cardápio → tenant da loja (endpoints são públicos).
  private async tenantDoCardapio(cardapioToken: string): Promise<string> {
    const [cfg] = await this.db
      .select({ tenantId: cardapioConfig.tenantId, ativo: cardapioConfig.ativo })
      .from(cardapioConfig)
      .where(eq(cardapioConfig.token, cardapioToken));
    if (!cfg || !cfg.ativo) throw new NotFoundException('Cardápio indisponível.');
    return cfg.tenantId;
  }

  // Valida o token do cliente contra o tenant da loja (evita usar em outra loja).
  private async clienteDoToken(cardapioToken: string, clienteToken?: string) {
    const tenantId = await this.tenantDoCardapio(cardapioToken);
    const v = verificarCliente(clienteToken);
    if (!v || v.tenant !== tenantId)
      throw new UnauthorizedException('Sessão de cliente inválida.');
    const [c] = await this.db
      .select()
      .from(cliente)
      .where(and(eq(cliente.id, v.cli), eq(cliente.tenantId, tenantId)));
    if (!c) throw new UnauthorizedException('Cliente não encontrado.');
    return c;
  }

  private async enderecosDe(clienteId: string) {
    return this.db
      .select()
      .from(clienteEndereco)
      .where(eq(clienteEndereco.clienteId, clienteId))
      .orderBy(desc(clienteEndereco.principal), desc(clienteEndereco.criadoEm));
  }

  // Busca autenticada (gestor) por telefone — autopreenchimento do "Novo pedido"
  // no Delivery. Devolve o cliente + endereços salvos (1:N), ou null.
  async buscarPorTelefone(tenantId: string, telefone: string) {
    const tel = (telefone ?? '').replace(/\D/g, '');
    if (tel.length < 8) return null;
    const [c] = await this.db
      .select()
      .from(cliente)
      .where(and(eq(cliente.tenantId, tenantId), eq(cliente.telefone, tel)));
    if (!c) return null;
    return {
      cliente: { id: c.id, nome: c.nome, telefone: c.telefone },
      enderecos: await this.enderecosDe(c.id),
    };
  }

  // Identifica pelo telefone: acha ou cria o cliente, devolve o token assinado.
  async identificar(cardapioToken: string, dto: { telefone?: string; nome?: string }) {
    const tenantId = await this.tenantDoCardapio(cardapioToken);
    const tel = soDigitos(dto.telefone);
    if (tel.length < 10) throw new BadRequestException('Telefone inválido.');

    let [c] = await this.db
      .select()
      .from(cliente)
      .where(and(eq(cliente.tenantId, tenantId), eq(cliente.telefone, tel)));
    if (!c) {
      [c] = await this.db
        .insert(cliente)
        .values({ tenantId, telefone: tel, nome: dto.nome?.trim() || null, consentimentoLgpd: true })
        .returning();
    } else if (dto.nome?.trim() && dto.nome.trim() !== c.nome) {
      [c] = await this.db
        .update(cliente)
        .set({ nome: dto.nome.trim(), atualizadoEm: new Date() })
        .where(eq(cliente.id, c.id))
        .returning();
    }

    return {
      clienteToken: assinarCliente(c.id, tenantId),
      cliente: { id: c.id, nome: c.nome, telefone: c.telefone },
      enderecos: await this.enderecosDe(c.id),
    };
  }

  // ── OTP (confirmação do telefone por WhatsApp) ──────────────────────────────
  // Gera um código de 6 dígitos, guarda (expira em OTP_MIN) e dispara o webhook
  // do n8n (OTP_WEBHOOK_URL) que envia pelo Evolution.
  async enviarOtp(cardapioToken: string, telefone?: string) {
    const tenantId = await this.tenantDoCardapio(cardapioToken);
    const tel = soDigitos(telefone);
    if (tel.length < 10) throw new BadRequestException('Telefone inválido.');

    const codigo = String(Math.floor(100000 + Math.random() * 900000));
    const expira = new Date(Date.now() + OTP_MIN * 60000);
    await this.db
      .delete(clienteOtp)
      .where(and(eq(clienteOtp.tenantId, tenantId), eq(clienteOtp.telefone, tel)));
    await this.db
      .insert(clienteOtp)
      .values({ tenantId, telefone: tel, codigo, expiraEm: expira });

    // Loja (para o texto da mensagem) + disparo do webhook (best-effort).
    const [cfg] = await this.db
      .select({ nome: cardapioConfig.nomePublico })
      .from(cardapioConfig)
      .where(eq(cardapioConfig.token, cardapioToken));
    const url = process.env.OTP_WEBHOOK_URL;
    if (url) {
      try {
        await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ telefone: tel, codigo, loja: cfg?.nome ?? 'Regem', tenantId }),
        });
      } catch {
        /* falha de rede no webhook não bloqueia o fluxo */
      }
    }
    return { ok: true, expiraEm: expira, enviado: !!url };
  }

  // Confirma o código e devolve a identidade (nome é obrigatório no cadastro).
  async confirmarOtp(
    cardapioToken: string,
    dto: { telefone?: string; codigo?: string; nome?: string },
  ) {
    const tenantId = await this.tenantDoCardapio(cardapioToken);
    const tel = soDigitos(dto.telefone);
    const [otp] = await this.db
      .select()
      .from(clienteOtp)
      .where(and(eq(clienteOtp.tenantId, tenantId), eq(clienteOtp.telefone, tel)));
    if (!otp || otp.expiraEm < new Date())
      throw new BadRequestException('Código expirado. Peça um novo.');
    if (otp.tentativas >= 5)
      throw new BadRequestException('Muitas tentativas. Peça um novo código.');
    if (String(dto.codigo ?? '').trim() !== otp.codigo) {
      await this.db
        .update(clienteOtp)
        .set({ tentativas: otp.tentativas + 1 })
        .where(eq(clienteOtp.id, otp.id));
      throw new BadRequestException('Código incorreto.');
    }

    // Código ok: acha/cria o cliente. Nome é obrigatório ao criar.
    let [c] = await this.db
      .select()
      .from(cliente)
      .where(and(eq(cliente.tenantId, tenantId), eq(cliente.telefone, tel)));
    if (!c) {
      const nome = dto.nome?.trim();
      if (!nome) throw new BadRequestException('Informe seu nome.');
      [c] = await this.db
        .insert(cliente)
        .values({ tenantId, telefone: tel, nome, consentimentoLgpd: true })
        .returning();
    } else if (dto.nome?.trim() && dto.nome.trim() !== c.nome) {
      [c] = await this.db
        .update(cliente)
        .set({ nome: dto.nome.trim(), atualizadoEm: new Date() })
        .where(eq(cliente.id, c.id))
        .returning();
    }
    await this.db.delete(clienteOtp).where(eq(clienteOtp.id, otp.id));

    return {
      clienteToken: assinarCliente(c.id, tenantId),
      cliente: { id: c.id, nome: c.nome, telefone: c.telefone },
      enderecos: await this.enderecosDe(c.id),
    };
  }

  // Perfil completo: dados + endereços + histórico (para "pedir de novo").
  async perfil(cardapioToken: string, clienteToken?: string) {
    const c = await this.clienteDoToken(cardapioToken, clienteToken);
    const historico = await this.db
      .select({
        id: pedidoExterno.id,
        numero: pedidoExterno.numero,
        total: pedidoExterno.total,
        status: pedidoExterno.status,
        tipo: pedidoExterno.tipo,
        itens: pedidoExterno.itens,
        formaPagamento: pedidoExterno.formaPagamento,
        criadoEm: pedidoExterno.criadoEm,
        confirmadoEm: pedidoExterno.confirmadoEm,
        despachadoEm: pedidoExterno.despachadoEm,
        concluidoEm: pedidoExterno.concluidoEm,
        canceladoEm: pedidoExterno.canceladoEm,
      })
      .from(pedidoExterno)
      .where(eq(pedidoExterno.clienteId, c.id))
      .orderBy(desc(pedidoExterno.criadoEm))
      .limit(10);
    return {
      cliente: { id: c.id, nome: c.nome, telefone: c.telefone },
      enderecos: await this.enderecosDe(c.id),
      historico,
    };
  }

  async adicionarEndereco(cardapioToken: string, clienteToken: string | undefined, dto: any) {
    const c = await this.clienteDoToken(cardapioToken, clienteToken);
    const primeiro = (await this.enderecosDe(c.id)).length === 0;
    const [e] = await this.db
      .insert(clienteEndereco)
      .values({
        tenantId: c.tenantId,
        clienteId: c.id,
        apelido: dto.apelido || null,
        cep: dto.cep || null,
        logradouro: dto.logradouro || null,
        numero: dto.numero || null,
        complemento: dto.complemento || null,
        bairro: dto.bairro || null,
        bairroId: dto.bairroId || null,
        cidade: dto.cidade || null,
        referencia: dto.referencia || null,
        principal: dto.principal ?? primeiro,
      })
      .returning();
    if (e.principal) await this.marcarPrincipal(c.id, e.id);
    return this.enderecosDe(c.id);
  }

  async removerEndereco(cardapioToken: string, clienteToken: string | undefined, id: string) {
    const c = await this.clienteDoToken(cardapioToken, clienteToken);
    await this.db
      .delete(clienteEndereco)
      .where(and(eq(clienteEndereco.id, id), eq(clienteEndereco.clienteId, c.id)));
    return this.enderecosDe(c.id);
  }

  async definirPrincipal(cardapioToken: string, clienteToken: string | undefined, id: string) {
    const c = await this.clienteDoToken(cardapioToken, clienteToken);
    await this.marcarPrincipal(c.id, id);
    return this.enderecosDe(c.id);
  }

  private async marcarPrincipal(clienteId: string, enderecoId: string) {
    await this.db
      .update(clienteEndereco)
      .set({ principal: false })
      .where(eq(clienteEndereco.clienteId, clienteId));
    await this.db
      .update(clienteEndereco)
      .set({ principal: true })
      .where(and(eq(clienteEndereco.id, enderecoId), eq(clienteEndereco.clienteId, clienteId)));
  }

  // LGPD: apaga o cliente (endereços em cascata) e desvincula os pedidos.
  async esquecer(cardapioToken: string, clienteToken?: string) {
    const c = await this.clienteDoToken(cardapioToken, clienteToken);
    await this.db
      .update(pedidoExterno)
      .set({ clienteId: null })
      .where(eq(pedidoExterno.clienteId, c.id));
    await this.db.delete(cliente).where(eq(cliente.id, c.id));
    return { ok: true };
  }

  // Itens de um pedido do cliente, para prefiler o carrinho ("pedir de novo").
  async pedirDeNovo(cardapioToken: string, clienteToken: string | undefined, pedidoId: string) {
    const c = await this.clienteDoToken(cardapioToken, clienteToken);
    const [p] = await this.db
      .select({ itens: pedidoExterno.itens })
      .from(pedidoExterno)
      .where(and(eq(pedidoExterno.id, pedidoId), eq(pedidoExterno.clienteId, c.id)));
    if (!p) throw new NotFoundException('Pedido não encontrado.');
    return { itens: p.itens };
  }
}
