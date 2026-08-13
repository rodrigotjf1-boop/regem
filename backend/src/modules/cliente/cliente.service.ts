import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { createHmac, createHash, randomBytes, randomInt } from 'crypto';

// SHA-256 do código OTP (o banco só guarda o hash; comparação hash-com-hash).
const hashOtp = (codigo: string) => createHash('sha256').update(codigo.trim()).digest('hex');
import { and, desc, eq, sql } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import {
  cardapioConfig,
  cashbackMovimento,
  cashbackVale,
  cliente,
  clienteEndereco,
  clienteLink,
  clienteOtp,
  fidelidadePonto,
  fidelidadeResgate,
  integracao,
  pedidoExterno,
} from '../../db/schema';
import { inArray } from 'drizzle-orm';
import { assinarCliente, verificarCliente } from './cliente-token';
import { urlPublicaSegura } from '../../common/ssrf-guard';
import { AtendimentoService } from '../atendimento/atendimento.service';

/* eslint-disable @typescript-eslint/no-explicit-any */
const soDigitos = (s?: string) => (s ?? '').replace(/\D/g, '');
const OTP_MIN = 5; // validade do código em minutos

@Injectable()
export class ClienteService {
  private readonly logger = new Logger('ClienteOtp');
  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly atendimento: AtendimentoService,
  ) {}

  // Resolve o webhook do n8n: prefere a integração n8n da loja (por tenant, com
  // secret p/ HMAC); cai no OTP_WEBHOOK_URL global se a loja não tiver integração.
  private async resolverWebhook(
    tenantId: string,
  ): Promise<{ url: string; secret?: string } | null> {
    const [row] = await this.db
      .select({
        ativo: integracao.ativo,
        merchantId: integracao.merchantId,
        clientSecret: integracao.clientSecret,
      })
      .from(integracao)
      .where(and(eq(integracao.tenantId, tenantId), eq(integracao.canal, 'n8n')));
    if (row?.ativo && row.merchantId)
      return { url: row.merchantId, secret: row.clientSecret ?? undefined };
    const env = process.env.OTP_WEBHOOK_URL;
    return env ? { url: env } : null;
  }

  // Dispara o webhook do n8n com log do resultado. Devolve true só se 2xx.
  // Assina com HMAC-SHA256 (X-Regem-Signature) quando há secret, igual ao status.
  private async dispararWebhook(
    url: string,
    payload: any,
    secret?: string,
  ): Promise<boolean> {
    try {
      // Anti-SSRF: a URL pode vir do lojista (integração n8n) — bloqueia interno.
      if (!(await urlPublicaSegura(url))) {
        this.logger.error(`webhook OTP bloqueado (URL não-pública): ${String(url).slice(0, 80)}`);
        return false;
      }
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 8000);
      const body = JSON.stringify(payload);
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (secret)
        headers['X-Regem-Signature'] = createHmac('sha256', secret).update(body).digest('hex');
      const res = await fetch(url, { method: 'POST', headers, body, signal: ctrl.signal });
      clearTimeout(t);
      if (!res.ok) {
        const b = await res.text().catch(() => '');
        this.logger.error(`webhook ${res.status}: ${b.slice(0, 200)}`);
        return false;
      }
      this.logger.log(`webhook OK (${res.status})`);
      return true;
    } catch (e: any) {
      this.logger.error(`webhook falhou: ${e?.message ?? e}`);
      return false;
    }
  }

  // Teste do webhook (presidente) — mostra exatamente o que o n8n responde.
  async testarWebhook(tenantId: string, telefone?: string) {
    const wh = await this.resolverWebhook(tenantId);
    if (!wh)
      return {
        configurado: false,
        msg: 'Nenhum webhook n8n configurado (integração da loja nem OTP_WEBHOOK_URL).',
      };
    const tel = soDigitos(telefone) || '21999999999';
    const whats = tel.startsWith('55') ? tel : `55${tel}`;
    try {
      const body = JSON.stringify({
        evento: 'otp',
        telefone: tel,
        telefoneWhatsapp: whats,
        codigo: '123456',
        loja: 'Teste Regem',
        teste: true,
        tenantId,
      });
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (wh.secret)
        headers['X-Regem-Signature'] = createHmac('sha256', wh.secret).update(body).digest('hex');
      const res = await fetch(wh.url, { method: 'POST', headers, body });
      const resp = await res.text().catch(() => '');
      return {
        configurado: true,
        url: wh.url.replace(/\/[^/]+$/, '/…'),
        status: res.status,
        ok: res.ok,
        resposta: resp.slice(0, 400),
      };
    } catch (e: any) {
      return { configurado: true, erro: e?.message ?? String(e) };
    }
  }

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
  // Acha (ou cria) o cliente pelo telefone; atualiza o nome se veio um novo.
  private async acharOuCriarCliente(tenantId: string, telefone?: string, nome?: string) {
    const tel = soDigitos(telefone);
    if (tel.length < 10) throw new BadRequestException('Telefone inválido.');
    let [c] = await this.db
      .select()
      .from(cliente)
      .where(and(eq(cliente.tenantId, tenantId), eq(cliente.telefone, tel)));
    if (!c) {
      [c] = await this.db
        .insert(cliente)
        .values({ tenantId, telefone: tel, nome: nome?.trim() || null, consentimentoLgpd: true })
        .returning();
    } else if (nome?.trim() && nome.trim() !== c.nome) {
      [c] = await this.db
        .update(cliente)
        .set({ nome: nome.trim(), atualizadoEm: new Date() })
        .where(eq(cliente.id, c.id))
        .returning();
    }
    return c;
  }

  async identificar(cardapioToken: string, dto: { telefone?: string; nome?: string }) {
    const tenantId = await this.tenantDoCardapio(cardapioToken);
    const c = await this.acharOuCriarCliente(tenantId, dto.telefone, dto.nome);
    return {
      clienteToken: assinarCliente(c.id, tenantId),
      cliente: { id: c.id, nome: c.nome, telefone: c.telefone },
      enderecos: await this.enderecosDe(c.id),
    };
  }

  // Link curto por cliente (slug ~8 chars). Reusa o slug se já existir.
  async criarLink(
    cardapioToken: string,
    dto: { telefone?: string; nome?: string },
  ): Promise<{ slug: string; url: string; clienteToken: string }> {
    const tenantId = await this.tenantDoCardapio(cardapioToken);
    const c = await this.acharOuCriarCliente(tenantId, dto.telefone, dto.nome);
    let [link] = await this.db
      .select()
      .from(clienteLink)
      .where(eq(clienteLink.clienteId, c.id));
    if (!link) {
      // slug base62 curto, com retry em caso de colisão (unique).
      for (let i = 0; i < 5 && !link; i++) {
        const slug = randomBytes(6).toString('base64url').slice(0, 8);
        try {
          [link] = await this.db
            .insert(clienteLink)
            .values({ tenantId, clienteId: c.id, slug })
            .returning();
        } catch {
          /* colisão de slug: tenta de novo */
        }
      }
    }
    const base = process.env.APP_URL ?? 'https://app.dmsregem.com';
    return {
      slug: link.slug,
      url: `${base}/c/${cardapioToken}?u=${link.slug}`,
      clienteToken: assinarCliente(c.id, tenantId),
    };
  }

  // Resolve um slug curto → clienteToken assinado (para o cardápio identificar).
  async resolverLink(cardapioToken: string, slug: string) {
    const tenantId = await this.tenantDoCardapio(cardapioToken);
    const [link] = await this.db
      .select()
      .from(clienteLink)
      .where(and(eq(clienteLink.tenantId, tenantId), eq(clienteLink.slug, slug)));
    if (!link) throw new NotFoundException('Link inválido.');
    return { clienteToken: assinarCliente(link.clienteId, tenantId) };
  }

  // ── OTP (confirmação do telefone por WhatsApp) ──────────────────────────────
  // Gera um código de 6 dígitos, guarda (expira em OTP_MIN) e dispara o webhook
  // do n8n (integração da loja ou OTP_WEBHOOK_URL) que envia pelo Evolution.
  async enviarOtp(cardapioToken: string, telefone?: string) {
    const tenantId = await this.tenantDoCardapio(cardapioToken);
    const tel = soDigitos(telefone);
    if (tel.length < 10) throw new BadRequestException('Telefone inválido.');

    // Código seguro (uniforme, imprevisível): randomInt em vez de Math.random.
    const codigo = String(randomInt(100000, 1000000)); // 6 dígitos [100000..999999]
    const expira = new Date(Date.now() + OTP_MIN * 60000);
    await this.db
      .delete(clienteOtp)
      .where(and(eq(clienteOtp.tenantId, tenantId), eq(clienteOtp.telefone, tel)));
    // Guarda só o HASH — o texto puro nunca vai ao banco.
    await this.db
      .insert(clienteOtp)
      .values({ tenantId, telefone: tel, codigoHash: hashOtp(codigo), expiraEm: expira });

    // Loja (para o texto da mensagem) + disparo do webhook (best-effort).
    const [cfg] = await this.db
      .select({ nome: cardapioConfig.nomePublico })
      .from(cardapioConfig)
      .where(eq(cardapioConfig.token, cardapioToken));
    const wh = await this.resolverWebhook(tenantId);
    let enviado = false;
    if (wh) {
      const whats = tel.startsWith('55') ? tel : `55${tel}`;
      enviado = await this.dispararWebhook(
        wh.url,
        {
          evento: 'otp', // n8n roteia: 'otp' → texto do código; 'status' → aviso de pedido
          telefone: tel,
          telefoneWhatsapp: whats, // com DDI 55, formato que o Evolution espera
          codigo,
          loja: cfg?.nome ?? 'Regem',
          tenantId,
        },
        wh.secret,
      );
    } else {
      this.logger.warn(
        'Nenhum webhook n8n configurado (integração da loja nem OTP_WEBHOOK_URL) — código gerado mas não enviado.',
      );
    }
    return { ok: true, expiraEm: expira, enviado };
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
    // Compara HASH com HASH (o banco não tem o código em claro).
    if (!otp.codigoHash || hashOtp(String(dto.codigo ?? '')) !== otp.codigoHash) {
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
  // O histórico traz total, desconto, taxa, endereço e forma de pagamento (detalhe
  // do pedido) e uma flag `resgate` (pedido que usou prêmio de fidelidade).
  async perfil(cardapioToken: string, clienteToken?: string) {
    const c = await this.clienteDoToken(cardapioToken, clienteToken);
    const historico = await this.db
      .select({
        id: pedidoExterno.id,
        numero: pedidoExterno.numero,
        total: pedidoExterno.total,
        desconto: pedidoExterno.desconto,
        taxaEntrega: pedidoExterno.taxaEntrega,
        cupom: pedidoExterno.cupom,
        trocoPara: pedidoExterno.trocoPara,
        status: pedidoExterno.status,
        statusPagamento: pedidoExterno.statusPagamento,
        pago: pedidoExterno.pago,
        tipo: pedidoExterno.tipo,
        itens: pedidoExterno.itens,
        formaPagamento: pedidoExterno.formaPagamento,
        bandeira: pedidoExterno.bandeira,
        endereco: pedidoExterno.endereco,
        enderecoRua: pedidoExterno.enderecoRua,
        enderecoNumero: pedidoExterno.enderecoNumero,
        enderecoBairro: pedidoExterno.enderecoBairro,
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

    // Marca quais pedidos foram resgate de fidelidade (prêmio "usado" no pedido).
    const ids = historico.map((p) => p.id);
    let resgates = new Set<string>();
    if (ids.length) {
      const rows = await this.db
        .select({ pedidoId: fidelidadeResgate.pedidoId })
        .from(fidelidadeResgate)
        .where(
          and(
            eq(fidelidadeResgate.tenantId, c.tenantId),
            eq(fidelidadeResgate.status, 'usado'),
            inArray(fidelidadeResgate.pedidoId, ids),
          ),
        );
      resgates = new Set(rows.map((r) => r.pedidoId).filter(Boolean) as string[]);
    }

    return {
      cliente: { id: c.id, nome: c.nome, telefone: c.telefone },
      enderecos: await this.enderecosDe(c.id),
      historico: historico.map((p) => ({ ...p, resgate: resgates.has(p.id) })),
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
        lat: dto.lat != null && dto.lat !== '' ? String(dto.lat) : null,
        lng: dto.lng != null && dto.lng !== '' ? String(dto.lng) : null,
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
  // Se o pedido foi um resgate de fidelidade e o cliente não tem mais prêmio
  // disponível para resgatar, bloqueia (não dá para repetir "de graça").
  async pedirDeNovo(cardapioToken: string, clienteToken: string | undefined, pedidoId: string) {
    const c = await this.clienteDoToken(cardapioToken, clienteToken);
    const [p] = await this.db
      .select({ itens: pedidoExterno.itens })
      .from(pedidoExterno)
      .where(and(eq(pedidoExterno.id, pedidoId), eq(pedidoExterno.clienteId, c.id)));
    if (!p) throw new NotFoundException('Pedido não encontrado.');

    // Foi resgate de fidelidade? (prêmio usado neste pedido)
    const [foiResgate] = await this.db
      .select({ id: fidelidadeResgate.id })
      .from(fidelidadeResgate)
      .where(
        and(
          eq(fidelidadeResgate.tenantId, c.tenantId),
          eq(fidelidadeResgate.status, 'usado'),
          eq(fidelidadeResgate.pedidoId, pedidoId),
        ),
      );
    if (foiResgate) {
      // Tem prêmio disponível para novo resgate? (disponivel ou já resgatado, ainda não usado)
      const tel = (c.telefone ?? '').replace(/\D/g, '');
      const disponiveis = tel
        ? await this.db
            .select({ id: fidelidadeResgate.id })
            .from(fidelidadeResgate)
            .where(
              and(
                eq(fidelidadeResgate.tenantId, c.tenantId),
                eq(fidelidadeResgate.telefone, tel),
                inArray(fidelidadeResgate.status, ['disponivel', 'resgatado']),
              ),
            )
        : [];
      if (disponiveis.length === 0) {
        throw new BadRequestException(
          'Este pedido foi um resgate de fidelidade e você não tem pontos para um novo resgate.',
        );
      }
    }
    return { itens: p.itens };
  }

  // Carrega um pedido do cliente garantindo posse, com dados p/ solicitações.
  private async pedidoDoCliente(cardapioToken: string, clienteToken: string | undefined, pedidoId: string) {
    const c = await this.clienteDoToken(cardapioToken, clienteToken);
    const [p] = await this.db
      .select()
      .from(pedidoExterno)
      .where(and(eq(pedidoExterno.id, pedidoId), eq(pedidoExterno.clienteId, c.id)));
    if (!p) throw new NotFoundException('Pedido não encontrado.');
    return { cliente: c, pedido: p };
  }

  // Cliente pede o CANCELAMENTO do pedido (só enquanto ainda dá — antes de sair
  // para entrega). Não cancela na hora: abre um chamado no sino, e a equipe decide.
  async solicitarCancelamento(cardapioToken: string, clienteToken: string | undefined, pedidoId: string) {
    const { cliente: c, pedido: p } = await this.pedidoDoCliente(cardapioToken, clienteToken, pedidoId);
    if (['despachado', 'concluido', 'cancelado'].includes(p.status)) {
      throw new BadRequestException('Este pedido não pode mais ser cancelado.');
    }
    // Transparência: avisa o cliente o que ele PERDE ao cancelar (antes de confirmar).
    const avisos = await this.avisosCancelamento(c.tenantId, p.id);
    const chamado = await this.atendimento.abrir(c.tenantId, p.unidadeId ?? null, {
      tipo: 'cancelamento',
      cliente: c.nome ?? undefined,
      telefone: c.telefone ?? undefined,
      pedidoNumero: p.numero != null ? String(p.numero) : undefined,
      pedidoId: p.id,
      mensagem: 'Cliente solicitou o cancelamento do pedido pelo cardápio.',
    });
    return { ...(chamado as any), avisos };
  }

  // Mensagens do que o cliente perde ao cancelar: cashback GASTO (se a loja não
  // devolve) e os pontos de fidelidade GANHOS no pedido (perda fixa). Só leitura.
  private async avisosCancelamento(tenantId: string, pedidoId: string): Promise<string[]> {
    const avisos: string[] = [];
    const [cfgLoja] = await this.db
      .select({ estorna: cardapioConfig.cancelamentoEstornaCashback })
      .from(cardapioConfig)
      .where(eq(cardapioConfig.tenantId, tenantId))
      .limit(1);
    if (cfgLoja?.estorna === false) {
      const movs = await this.db
        .select({ delta: cashbackMovimento.delta })
        .from(cashbackMovimento)
        .where(
          and(
            eq(cashbackMovimento.tenantId, tenantId),
            eq(cashbackMovimento.pedidoId, pedidoId),
            eq(cashbackMovimento.origem, 'resgate'),
            eq(cashbackMovimento.tipo, 'valor'),
          ),
        );
      const gasto = movs.reduce((a, m) => a + -Number(m.delta), 0);
      const vales = await this.db
        .select({ id: cashbackVale.id })
        .from(cashbackVale)
        .where(
          and(
            eq(cashbackVale.tenantId, tenantId),
            eq(cashbackVale.pedidoId, pedidoId),
            eq(cashbackVale.status, 'usado'),
          ),
        );
      if (gasto > 0 || vales.length) {
        avisos.push(
          `Ao cancelar você NÃO recebe de volta o cashback usado` +
            `${gasto > 0 ? ` (R$ ${gasto.toFixed(2)})` : ''}` +
            `${vales.length ? ` e perde ${vales.length} vale(s) resgatado(s)` : ''}.`,
        );
      }
    }
    const pts = await this.db
      .select({ id: fidelidadePonto.id })
      .from(fidelidadePonto)
      .where(
        and(
          eq(fidelidadePonto.tenantId, tenantId),
          eq(fidelidadePonto.pedidoId, pedidoId),
          eq(fidelidadePonto.estornado, false),
        ),
      );
    if (pts.length) {
      avisos.push('Os pontos de fidelidade ganhos neste pedido serão cancelados ao cancelar o pedido.');
    }
    return avisos;
  }

  // Cliente pede uma ALTERAÇÃO (endereço / no pedido / forma de pagamento).
  // Só avisa a equipe no sino — a alteração em si é feita pela equipe.
  async solicitarAlteracao(
    cardapioToken: string,
    clienteToken: string | undefined,
    pedidoId: string,
    dto: { alvo?: string; detalhe?: string },
  ) {
    const { cliente: c, pedido: p } = await this.pedidoDoCliente(cardapioToken, clienteToken, pedidoId);
    if (['concluido', 'cancelado'].includes(p.status)) {
      throw new BadRequestException('Este pedido já foi finalizado.');
    }
    const alvoLabel: Record<string, string> = {
      endereco: 'endereço de entrega',
      pedido: 'itens do pedido',
      pagamento: 'forma de pagamento',
    };
    const alvo = alvoLabel[dto.alvo ?? ''] ?? 'o pedido';
    const detalhe = (dto.detalhe ?? '').trim();
    return this.atendimento.abrir(c.tenantId, p.unidadeId ?? null, {
      tipo: 'mudanca',
      cliente: c.nome ?? undefined,
      telefone: c.telefone ?? undefined,
      pedidoNumero: p.numero != null ? String(p.numero) : undefined,
      pedidoId: p.id,
      mensagem: `Cliente pediu alteração em ${alvo}${detalhe ? `: ${detalhe}` : '.'}`,
    });
  }
}
