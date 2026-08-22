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
import { AuditoriaService } from '../auditoria/auditoria.service';
import { AuthUser } from '../../auth/auth-user';
import PDFDocument from 'pdfkit';

/* eslint-disable @typescript-eslint/no-explicit-any */
const soDigitos = (s?: string) => (s ?? '').replace(/\D/g, '');
const OTP_MIN = 5; // validade do código em minutos

@Injectable()
export class ClienteService {
  private readonly logger = new Logger('ClienteOtp');
  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly atendimento: AtendimentoService,
    private readonly auditoria: AuditoriaService,
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

  // Dispara um evento genérico no webhook do n8n da loja (ex.: 'chegando' do
  // entregador). Reusa a resolução (integração da loja / OTP_WEBHOOK_URL), HMAC e
  // anti-SSRF. Devolve true só se 2xx.
  async enviarEventoWebhook(tenantId: string, payload: any): Promise<boolean> {
    const wh = await this.resolverWebhook(tenantId);
    if (!wh) return false;
    return this.dispararWebhook(wh.url, payload, wh.secret);
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

  // ===== CRM / segmentação (F3) — base do lojista, USO INTERNO, sempre por tenant =====
  // Contagem por segmento (recência/frequência) para os cartões/abas da tela.
  async crmResumo(tenantId: string) {
    const r: any = await this.db.execute(sql`
      with camp as (
        select cliente_id from pedido_externo
        where tenant_id = ${tenantId} and cliente_id is not null and status <> 'cancelado'
          and criado_em >= now() - interval '30 days'
        group by cliente_id having count(*) >= 3
      )
      select
        count(*)::int as total,
        count(*) filter (where c.ultimo_pedido_em >= date_trunc('month', now() at time zone 'America/Sao_Paulo'))::int as mes,
        count(*) filter (where c.ultimo_pedido_em >= now() - interval '30 days')::int as d30,
        count(*) filter (where c.ultimo_pedido_em < now() - interval '30 days')::int as sem30,
        count(*) filter (where c.ultimo_pedido_em < now() - interval '60 days')::int as sem60,
        (select count(*)::int from camp) as campeoes
      from cliente c where c.tenant_id = ${tenantId}`);
    return (r.rows ?? r)[0] ?? { total: 0, mes: 0, d30: 0, sem30: 0, sem60: 0, campeoes: 0 };
  }

  // Lista de clientes por segmento + busca (nome/telefone). Escopo por tenant.
  // Fragmentos de filtro compartilhados (lista + exportação): segmento, busca,
  // canal e bairro. Retorna um único SQL para o WHERE.
  private filtrosCrm(opts: {
    segmento?: string;
    busca?: string;
    canal?: string;
    bairro?: string;
    ids?: string[];
  }) {
    const seg: Record<string, any> = {
      mes: sql`and c.ultimo_pedido_em >= date_trunc('month', now() at time zone 'America/Sao_Paulo')`,
      '30d': sql`and c.ultimo_pedido_em >= now() - interval '30 days'`,
      sem_30: sql`and c.ultimo_pedido_em < now() - interval '30 days'`,
      sem_60: sql`and c.ultimo_pedido_em < now() - interval '60 days'`,
      campeoes: sql`and (select count(*) from pedido_externo p where p.cliente_id = c.id and p.status <> 'cancelado' and p.criado_em >= now() - interval '30 days') >= 3`,
    };
    const segFrag = seg[String(opts.segmento ?? '')] ?? sql``;
    const busca = (opts.busca ?? '').trim();
    const buscaFrag = busca
      ? sql`and (c.nome ilike ${'%' + busca + '%'} or c.telefone ilike ${'%' + busca.replace(/\D/g, '') + '%'})`
      : sql``;
    const canal = (opts.canal ?? '').trim();
    const canalFrag = canal
      ? sql`and exists (select 1 from pedido_externo p where p.cliente_id = c.id and p.canal = ${canal})`
      : sql``;
    const bairro = (opts.bairro ?? '').trim();
    const bairroFrag = bairro
      ? sql`and exists (select 1 from pedido_externo p where p.cliente_id = c.id and lower(p.endereco_bairro) = lower(${bairro}))`
      : sql``;
    // Seleção explícita (checkbox na tela) — restringe a estes ids.
    const idsFrag =
      opts.ids && opts.ids.length ? sql`and c.id = any(${opts.ids}::uuid[])` : sql``;
    return sql`${segFrag} ${buscaFrag} ${canalFrag} ${bairroFrag} ${idsFrag}`;
  }

  async crmClientes(
    tenantId: string,
    opts: {
      segmento?: string;
      busca?: string;
      canal?: string;
      bairro?: string;
      ids?: string[];
      ordenar?: string;
      direcao?: string;
      limite?: number;
      offset?: number;
    },
  ) {
    const limite = Math.min(Math.max(Number(opts.limite) || 50, 1), 5000);
    const offset = Math.max(Number(opts.offset) || 0, 0);
    const filtros = this.filtrosCrm(opts);
    // Ordenação por coluna (whitelist — nunca interpola input cru).
    const cols: Record<string, any> = {
      nome: sql`c.nome`,
      pedidos: sql`c.total_pedidos`,
      ultimo: sql`c.ultimo_pedido_em`,
      total: sql`c.total_gasto`,
      ticket: sql`(c.total_gasto / nullif(c.total_pedidos, 0))`,
    };
    const col = cols[String(opts.ordenar ?? '')] ?? sql`c.ultimo_pedido_em`;
    const dir = String(opts.direcao ?? '').toLowerCase() === 'asc' ? sql`asc` : sql`desc`;
    const r: any = await this.db.execute(sql`
      select c.id, c.nome, c.telefone, c.total_pedidos, c.total_gasto,
             c.ultimo_pedido_em, c.primeiro_pedido_em, c.opt_out_marketing,
             coalesce((select count(*) from pedido_externo p where p.cliente_id = c.id and p.status <> 'cancelado' and p.criado_em >= now() - interval '30 days'), 0)::int as pedidos_30d,
             coalesce((select array_agg(distinct p.canal) from pedido_externo p where p.cliente_id = c.id), '{}') as canais
      from cliente c
      where c.tenant_id = ${tenantId} ${filtros}
      order by ${col} ${dir} nulls last
      limit ${limite} offset ${offset}`);
    return r.rows ?? r;
  }

  // Bairros distintos (para o filtro do CRM), a partir dos pedidos do tenant.
  // Só NOMES de bairro — exclui faixas de distância (raio: "3 km", "0 a 2 km"…).
  async crmBairros(tenantId: string) {
    const r: any = await this.db.execute(sql`
      select distinct endereco_bairro as bairro from pedido_externo
      where tenant_id = ${tenantId}
        and coalesce(endereco_bairro, '') <> ''
        and endereco_bairro ~ '[A-Za-zÀ-ÿ]'   -- tem letra (é nome, não número)
        and endereco_bairro !~ '^[0-9]'        -- não começa com dígito (distância)
        and endereco_bairro !~* 'km|raio|metro'-- não é faixa de distância
      order by 1 limit 300`);
    return (r.rows ?? r).map((x: any) => x.bairro);
  }

  private brl(n: number) {
    return (Number(n) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  }

  private linhasExport(rows: any[]) {
    return rows.map((c: any) => ({
      nome: c.nome || 'Cliente',
      telefone: c.telefone || '',
      pedidos: Number(c.total_pedidos) || 0,
      ultimo: c.ultimo_pedido_em ? new Date(c.ultimo_pedido_em).toLocaleDateString('pt-BR') : '',
      ticket: Number(c.total_pedidos) > 0 ? Number(c.total_gasto) / Number(c.total_pedidos) : 0,
      total: Number(c.total_gasto) || 0,
      canais: Array.isArray(c.canais) ? c.canais.join(', ') : '',
    }));
  }

  private readonly EXPORT_HEAD = ['Nome', 'Telefone', 'Pedidos', 'Último pedido', 'Ticket médio', 'Total gasto', 'Canais'];

  private gerarCsv(linhas: any[]): string {
    const esc = (v: any) => {
      const s = String(v ?? '');
      return /[";\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    const body = linhas.map((l) =>
      [l.nome, l.telefone, l.pedidos, l.ultimo, this.brl(l.ticket), this.brl(l.total), l.canais]
        .map(esc)
        .join(';'),
    );
    return [this.EXPORT_HEAD.join(';'), ...body].join('\r\n');
  }

  private gerarXls(linhas: any[]): string {
    const esc = (v: any) =>
      String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const th = this.EXPORT_HEAD.map((h) => `<th>${esc(h)}</th>`).join('');
    const tr = linhas
      .map(
        (l) =>
          `<tr><td>${esc(l.nome)}</td><td>${esc(l.telefone)}</td><td>${l.pedidos}</td><td>${esc(l.ultimo)}</td><td>${esc(this.brl(l.ticket))}</td><td>${esc(this.brl(l.total))}</td><td>${esc(l.canais)}</td></tr>`,
      )
      .join('');
    return `<html><head><meta charset="utf-8"></head><body><table border="1"><thead><tr>${th}</tr></thead><tbody>${tr}</tbody></table></body></html>`;
  }

  private gerarPdf(linhas: any[]): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 36 });
      const chunks: Buffer[] = [];
      doc.on('data', (c: Buffer) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
      doc.fontSize(14).text('Base de clientes');
      doc
        .fontSize(8)
        .fillColor('#666')
        .text(
          `Exportado em ${new Date().toLocaleString('pt-BR')} · ${linhas.length} cliente(s) · uso interno (LGPD)`,
        );
      doc.moveDown(0.4).fillColor('#000').fontSize(8);
      linhas.forEach((l) => {
        doc.text(
          `${l.nome}  ·  ${l.telefone || '—'}  ·  ${l.pedidos} ped.  ·  ${l.ultimo || '—'}  ·  ticket ${this.brl(l.ticket)}  ·  total ${this.brl(l.total)}  ·  ${l.canais || '—'}`,
        );
      });
      doc.end();
    });
  }

  // Exporta a base filtrada/selecionada (CSV/Excel/PDF). AUDITA sempre (dado
  // sensível/LGPD). RBAC no controller (presidente/gerente + clientes_exportar).
  async exportar(
    user: AuthUser,
    opts: {
      formato?: string;
      segmento?: string;
      busca?: string;
      canal?: string;
      bairro?: string;
      ids?: string[];
      ordenar?: string;
      direcao?: string;
    },
  ) {
    const formato = ['csv', 'excel', 'pdf'].includes(String(opts.formato)) ? String(opts.formato) : 'csv';
    const rows = await this.crmClientes(user.tenantId, { ...opts, limite: 5000, offset: 0 });
    await this.auditoria.registrar({
      tenantId: user.tenantId,
      atorId: user.colaboradorId,
      atorPerfil: user.categoria,
      tipo: 'exportacao',
      acao: 'clientes.exportar',
      detalhe: {
        formato,
        total: rows.length,
        filtros: {
          segmento: opts.segmento || null,
          busca: opts.busca || null,
          canal: opts.canal || null,
          bairro: opts.bairro || null,
          selecionados: opts.ids?.length ?? null,
        },
      },
      origem: 'web',
    });
    const linhas = this.linhasExport(rows);
    const stamp = new Date().toISOString().slice(0, 10);
    if (formato === 'csv')
      return {
        filename: `clientes-${stamp}.csv`,
        mime: 'text/csv;charset=utf-8',
        base64: Buffer.from(String.fromCharCode(0xfeff) + this.gerarCsv(linhas), 'utf8').toString(
          'base64',
        ),
      };
    if (formato === 'excel')
      return {
        filename: `clientes-${stamp}.xls`,
        mime: 'application/vnd.ms-excel',
        base64: Buffer.from(this.gerarXls(linhas), 'utf8').toString('base64'),
      };
    const buf = await this.gerarPdf(linhas);
    return { filename: `clientes-${stamp}.pdf`, mime: 'application/pdf', base64: buf.toString('base64') };
  }

  // Histórico de pedidos de um cliente (drill-down). Escopo por tenant.
  async crmHistorico(tenantId: string, clienteId: string) {
    const r: any = await this.db.execute(sql`
      select id, numero, display_id, canal, tipo, status, total, criado_em
      from pedido_externo
      where tenant_id = ${tenantId} and cliente_id = ${clienteId}
      order by criado_em desc limit 100`);
    return r.rows ?? r;
  }

  // Funil de conversão do cardápio (F4) — sessões distintas por etapa, no período.
  async crmFunil(tenantId: string, dias: number) {
    const d = Math.min(Math.max(Number(dias) || 30, 1), 365);
    const vazio = { visitas: 0, carrinho: 0, checkout: 0, pedidos: 0 };
    // cardapio_evento é @cloud-only (mig 196) — não existe no edge, que roda o mesmo
    // backend. Abrir o funil no app local dava 500 (relation does not exist). Best-effort:
    // sem a tabela, o funil mostra estado vazio (o dado do funil é só da nuvem).
    try {
      const r: any = await this.db.execute(sql`
        select
          count(distinct sessao) filter (where tipo = 'view_menu')::int as visitas,
          count(distinct sessao) filter (where tipo = 'add_carrinho')::int as carrinho,
          count(distinct sessao) filter (where tipo = 'checkout')::int as checkout,
          count(distinct sessao) filter (where tipo = 'pedido')::int as pedidos
        from cardapio_evento
        where tenant_id = ${tenantId} and criado_em >= now() - (${d} || ' days')::interval`);
      return (r.rows ?? r)[0] ?? vazio;
    } catch {
      return vazio;
    }
  }

  async identificar(cardapioToken: string, dto: { telefone?: string; nome?: string }) {
    const tenantId = await this.tenantDoCardapio(cardapioToken);
    const c = await this.acharOuCriarCliente(tenantId, dto.telefone, dto.nome);
    // CL-4 (auditoria ago/2026): o token do cardápio fica na URL PÚBLICA, então
    // identificar só pelo telefone NÃO prova posse. Não emitimos mais sessão
    // (clienteToken) nem devolvemos endereços/PII aqui — senão qualquer um que
    // saiba o telefone da vítima lê o endereço de casa + histórico. Para receber
    // sessão + endereços é preciso confirmar o OTP (enviarOtp/confirmarOtp).
    // Aqui devolvemos só o mínimo para saudação/pré-preenchimento do nome.
    return {
      cliente: { id: c.id, nome: c.nome },
      requerOtp: true,
    };
  }

  // Link curto por cliente (slug ~8 chars). Reusa o slug se já existir.
  async criarLink(
    cardapioToken: string,
    dto: { telefone?: string; nome?: string },
  ): Promise<{ slug: string; url: string }> {
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
    // CL-4: NÃO devolvemos sessão aqui. O link (slug) é a credencial de posse — a
    // sessão é emitida só quando o próprio cliente ABRE o link (resolverLink).
    return {
      slug: link.slug,
      url: `${base}/c/${cardapioToken}?u=${link.slug}`,
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
