import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, desc, eq, ilike, inArray, isNull, or, sql } from 'drizzle-orm';
import { randomBytes } from 'crypto';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { verificarCliente, assinarCliente } from '../cliente/cliente-token';
import { paraCentavos, paraReais, somarCentavos } from '../../util/dinheiro';
import { geocode, montarEndereco } from '../../common/geocode';

// Categoria visível agora? Sem janelas = sempre. Senão, hoje (0=Dom..6=Sáb) precisa
// bater em alguma janela e o horário atual estar entre inicio e fim (HH:MM).
function categoriaDisponivelAgora(disp: any): boolean {
  if (!Array.isArray(disp) || disp.length === 0) return true;
  const agora = new Date();
  const dia = agora.getDay();
  const hhmm = `${String(agora.getHours()).padStart(2, '0')}:${String(agora.getMinutes()).padStart(2, '0')}`;
  return disp.some(
    (j: any) =>
      Array.isArray(j?.dias) &&
      j.dias.includes(dia) &&
      String(j?.inicio ?? '00:00') <= hhmm &&
      hhmm <= String(j?.fim ?? '23:59'),
  );
}
import {
  cardapioConfig,
  produto,
  produtoSugestao,
  produtoVariacao,
  categoriaProduto,
  complementoGrupo,
  complementoOpcao,
  cardapioBairro,
  banner,
  cupom,
  cupomUso,
  pedidoExterno,
  comandaItem,
  mesa,
  comanda,
  cliente,
  formaPagamento,
  integracao,
  entitlement,
  alertaEstoque,
} from '../../db/schema';
import { criarPixMP, consultarPagamentoMP } from '../../common/mercadopago';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import { VendasService } from '../vendas/vendas.service';
import { DeliveryService } from '../delivery/delivery.service';
import { AtendimentoService } from '../atendimento/atendimento.service';
import { FidelidadeService } from '../fidelidade/fidelidade.service';
import { CashbackService } from '../cashback/cashback.service';

/* eslint-disable @typescript-eslint/no-explicit-any */
// Distância entre duas coordenadas (km) — frete por raio.
function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(lat2 - lat1);
  const dLon = rad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

@Injectable()
export class CardapioService {
  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly vendas: VendasService,
    private readonly delivery: DeliveryService,
    private readonly atendimento: AtendimentoService,
    private readonly fidelidade: FidelidadeService,
    private readonly cashback: CashbackService,
    private readonly events: EventEmitter2,
  ) {}

  // ===== Gestão do cardápio: auto-pausa por esgotamento de estoque =====
  // Config do gestor (entitlement): auto-pausar produtos que controlam estoque
  // quando o insumo zera, emitindo um aviso geral. Default LIGADO.
  async autoPausaConfig(tenantId: string): Promise<{ ativo: boolean }> {
    const [e] = await this.db
      .select({ ativo: entitlement.ativo })
      .from(entitlement)
      .where(and(eq(entitlement.tenantId, tenantId), eq(entitlement.modulo, 'cardapio_auto_pausa')));
    return { ativo: e ? e.ativo : true }; // sem registro = ligado
  }

  async setAutoPausa(tenantId: string, ativo: boolean) {
    await this.db
      .insert(entitlement)
      .values({ tenantId, modulo: 'cardapio_auto_pausa', ativo })
      .onConflictDoUpdate({
        target: [entitlement.tenantId, entitlement.modulo],
        set: { ativo, updatedAt: new Date() },
      });
    return { ativo };
  }

  // Recalcula o esgotado por estoque e sincroniza `pausado_estoque`:
  //  - virou esgotado → pausa + aviso geral (KDS + alerta persistido);
  //  - voltou a ter estoque → despausa sozinho (só o que foi auto-pausado).
  // A pausa MANUAL (disponivel_cardapio=false) é independente e não é mexida aqui.
  async sincronizarEsgotados(tenantId: string) {
    if (!(await this.autoPausaConfig(tenantId)).ativo) return;
    const produtos = await this.db
      .select({
        id: produto.id,
        nome: produto.nome,
        tipo: produto.tipo,
        fichaId: produto.fichaId,
        controlaEstoque: produto.controlaEstoque,
        pausadoEstoque: produto.pausadoEstoque,
        permiteNegativo: produto.permiteNegativo,
      })
      .from(produto)
      .where(and(eq(produto.tenantId, tenantId), isNull(produto.deletedAt)));
    const esgotados = await this.computeEsgotados(tenantId, produtos);

    const novos: string[] = []; // nomes que acabaram de esgotar
    for (const p of produtos) {
      const agora = esgotados.has(p.id);
      if (agora && !p.pausadoEstoque) {
        await this.db
          .update(produto)
          .set({ pausadoEstoque: true, pausaMotivo: 'Estoque do insumo esgotado', updatedAt: new Date() })
          .where(eq(produto.id, p.id));
        novos.push(p.nome);
      } else if (!agora && p.pausadoEstoque) {
        await this.db
          .update(produto)
          .set({ pausadoEstoque: false, pausaMotivo: null, updatedAt: new Date() })
          .where(eq(produto.id, p.id));
      }
    }

    if (novos.length) {
      const titulo = `Produto esgotado no cardápio`;
      const detalhe = `${novos.join(', ')} — pausado(s) por falta de insumo em estoque.`;
      // Aviso geral em tempo real (KDS) + alerta persistido (dashboard).
      this.events.emit('kds.alerta.sistema', { tenantId, titulo, detalhe, prioridade: 'alta' });
      await this.db
        .insert(alertaEstoque)
        .values({ tenantId, tipo: 'produto_esgotado', titulo, detalhe, prioridade: 'alta' });
    }
  }

  // Gatilho: qualquer baixa/entrada de estoque dispara a sincronização.
  @OnEvent('estoque.baixado')
  async onEstoqueBaixado(payload: { tenantId: string }) {
    if (payload?.tenantId) await this.sincronizarEsgotados(payload.tenantId).catch(() => undefined);
  }

  // Público (robô): abre um chamado de atendimento (handoff) para a loja.
  async abrirAtendimento(token: string, dto: any) {
    const cfg = await this.resolver(token);
    return this.atendimento.abrir(cfg.tenantId, cfg.unidadeId, {
      tipo: dto?.tipo,
      cliente: dto?.cliente,
      telefone: dto?.telefone,
      pedidoNumero: dto?.pedidoNumero,
      mensagem: dto?.mensagem,
    });
  }

  // ===== Config (gestor) =====
  private async configRaw(tenantId: string, unidadeId?: string | null) {
    const [row] = await this.db
      .select()
      .from(cardapioConfig)
      .where(
        and(
          eq(cardapioConfig.tenantId, tenantId),
          unidadeId
            ? eq(cardapioConfig.unidadeId, unidadeId)
            : sql`unidade_id is null`,
        ),
      );
    return row;
  }

  async getConfig(tenantId: string, unidadeId?: string | null) {
    return (
      (await this.configRaw(tenantId, unidadeId)) ?? {
        ativo: false,
        modo: 'mesa',
        token: null,
      }
    );
  }

  // Campos de "dados da loja" (identidade + endereço + coords) — só o presidente/C&O
  // edita. Gerente pode salvar a config operacional do Delivery (bairros, robô,
  // pagamentos…), mas não a identidade da loja. RBAC no servidor.
  private static readonly CAMPOS_LOJA = [
    'nomePublico', 'logoEmoji', 'subtitulo', 'logoRef', 'documento',
    'responsavelNome', 'responsavelContato', 'contatoLoja', 'instagram', 'site', 'whatsapp',
    'endCep', 'endRua', 'endNumero', 'endBairro', 'endCidade', 'endEstado',
    'endReferencia', 'endComplemento', 'endLat', 'endLng',
  ];

  async setConfig(tenantId: string, unidadeId: string | null, dto: any, atorCategoria = 'presidente') {
    // Não-presidente não altera os dados da loja: ignora esses campos (mantém o atual).
    if (atorCategoria !== 'presidente') {
      for (const k of CardapioService.CAMPOS_LOJA) delete dto[k];
    }
    const row = await this.configRaw(tenantId, unidadeId);
    const vals: any = {
      ativo: dto.ativo != null ? !!dto.ativo : row?.ativo ?? false,
      modo: dto.modo ?? row?.modo ?? 'mesa',
      nomePublico: dto.nomePublico ?? row?.nomePublico ?? null,
      tema: dto.tema ?? row?.tema ?? 'claro',
      // Layout do cardápio (classic | fastfood). Fallback classic se inválido.
      menuTheme: ['classic', 'fastfood', 'grid'].includes(dto.menuTheme)
        ? dto.menuTheme
        : row?.menuTheme ?? 'classic',
      // Personalização do tema (cores + toggles + intervalo do banner). Merge com
      // o atual para permitir salvar só parte (ex.: só o intervalo pela tela de banners).
      temaConfig:
        dto.temaConfig && typeof dto.temaConfig === 'object'
          ? { ...(row?.temaConfig as any), ...dto.temaConfig }
          : row?.temaConfig ?? {},
      ramo: dto.ramo ?? row?.ramo ?? 'food',
      logoEmoji: dto.logoEmoji ?? row?.logoEmoji ?? null,
      subtitulo: dto.subtitulo ?? row?.subtitulo ?? null,
      aberto: dto.aberto != null ? !!dto.aberto : row?.aberto ?? true,
      tempoEntregaMin: dto.tempoEntregaMin ?? row?.tempoEntregaMin ?? null,
      tempoRetiradaMin: dto.tempoRetiradaMin ?? row?.tempoRetiradaMin ?? null,
      pedidoMinimo:
        dto.pedidoMinimo != null ? String(dto.pedidoMinimo) : row?.pedidoMinimo ?? null,
      avaliacao: dto.avaliacao != null ? String(dto.avaliacao) : row?.avaliacao ?? null,
      freteGratisAcima:
        dto.freteGratisAcima != null ? String(dto.freteGratisAcima) : row?.freteGratisAcima ?? null,
      pagamentos: dto.pagamentos ?? row?.pagamentos ?? [],
      fidelidadeAtiva: dto.fidelidadeAtiva != null ? !!dto.fidelidadeAtiva : row?.fidelidadeAtiva ?? false,
      whatsapp: dto.whatsapp ?? row?.whatsapp ?? null,
      parcelasMax:
        dto.parcelasMax != null ? Number(dto.parcelasMax) || null : row?.parcelasMax ?? null,
      autoKds: dto.autoKds != null ? !!dto.autoKds : row?.autoKds ?? true,
      formasCartao: Array.isArray(dto.formasCartao)
        ? dto.formasCartao.filter((x: any) => typeof x === 'string' && x.trim()).map((x: string) => x.trim())
        : row?.formasCartao ?? [],
      // Loja / contatos
      logoRef: dto.logoRef ?? row?.logoRef ?? null,
      documento: dto.documento ?? row?.documento ?? null,
      responsavelNome: dto.responsavelNome ?? row?.responsavelNome ?? null,
      responsavelContato: dto.responsavelContato ?? row?.responsavelContato ?? null,
      contatoLoja: dto.contatoLoja ?? row?.contatoLoja ?? null,
      instagram: dto.instagram ?? row?.instagram ?? null,
      site: dto.site ?? row?.site ?? null,
      // Endereço
      endCep: dto.endCep ?? row?.endCep ?? null,
      endRua: dto.endRua ?? row?.endRua ?? null,
      endNumero: dto.endNumero ?? row?.endNumero ?? null,
      endBairro: dto.endBairro ?? row?.endBairro ?? null,
      endCidade: dto.endCidade ?? row?.endCidade ?? null,
      endEstado: dto.endEstado ?? row?.endEstado ?? null,
      endReferencia: dto.endReferencia ?? row?.endReferencia ?? null,
      endComplemento: dto.endComplemento ?? row?.endComplemento ?? null,
      endLat: dto.endLat != null ? String(dto.endLat) : row?.endLat ?? null,
      endLng: dto.endLng != null ? String(dto.endLng) : row?.endLng ?? null,
      // Área de atendimento (bairro | raio)
      areaModo: dto.areaModo === 'raio' ? 'raio' : dto.areaModo === 'bairro' ? 'bairro' : row?.areaModo ?? 'bairro',
      raios: Array.isArray(dto.raios)
        ? dto.raios
            .map((r: any) => ({ ateKm: Number(r.ateKm) || 0, taxa: Number(r.taxa) || 0 }))
            .filter((r: any) => r.ateKm > 0)
            .sort((a: any, b: any) => a.ateKm - b.ateKm)
        : row?.raios ?? [],
      // Tipos de pedido
      tipoDelivery: dto.tipoDelivery != null ? !!dto.tipoDelivery : row?.tipoDelivery ?? true,
      tipoRetirada: dto.tipoRetirada != null ? !!dto.tipoRetirada : row?.tipoRetirada ?? false,
      tipoLocal: dto.tipoLocal != null ? !!dto.tipoLocal : row?.tipoLocal ?? false,
      // Horários
      horarios: Array.isArray(dto.horarios) ? dto.horarios : row?.horarios ?? [],
      // Robô de auto atendimento
      roboAtivo: dto.roboAtivo != null ? !!dto.roboAtivo : row?.roboAtivo ?? false,
      roboSaudacao: dto.roboSaudacao ?? row?.roboSaudacao ?? null,
      roboAusencia: dto.roboAusencia ?? row?.roboAusencia ?? null,
      roboPrompt: dto.roboPrompt ?? row?.roboPrompt ?? null,
      roboMensagens: Array.isArray(dto.roboMensagens)
        ? dto.roboMensagens
            .map((m: any) => ({ gatilho: String(m.gatilho ?? '').trim(), resposta: String(m.resposta ?? '').trim() }))
            .filter((m: any) => m.gatilho || m.resposta)
        : row?.roboMensagens ?? [],
    };
    // Coords da loja (necessárias p/ frete por raio): tem endereço mas não tem
    // lat/lng → geocoda uma vez (Nominatim). Falha → segue sem coords.
    if ((vals.endLat == null || vals.endLng == null) && vals.endRua) {
      const g = await geocode(
        montarEndereco([vals.endRua, vals.endNumero, vals.endBairro, vals.endCidade, vals.endEstado]),
      );
      if (g) {
        vals.endLat = String(g.lat);
        vals.endLng = String(g.lng);
      }
    }
    if (row) {
      await this.db
        .update(cardapioConfig)
        .set({ ...vals, updatedAt: new Date() })
        .where(eq(cardapioConfig.id, row.id));
    } else {
      vals.token = randomBytes(6).toString('hex'); // 12 chars
      await this.db.insert(cardapioConfig).values({ tenantId, unidadeId, ...vals });
    }
    return this.getConfig(tenantId, unidadeId);
  }

  // ===== Bairros (frete) — gestor =====
  listarBairros(tenantId: string, unidadeId?: string | null) {
    return this.db
      .select()
      .from(cardapioBairro)
      .where(eq(cardapioBairro.tenantId, tenantId))
      .orderBy(cardapioBairro.ordem);
  }

  async setBairros(
    tenantId: string,
    unidadeId: string | null,
    bairros: { nome: string; taxa: number; ativo?: boolean }[],
  ) {
    await this.db
      .delete(cardapioBairro)
      .where(eq(cardapioBairro.tenantId, tenantId));
    if (bairros?.length) {
      await this.db.insert(cardapioBairro).values(
        bairros
          .filter((b) => b.nome?.trim())
          .map((b, i) => ({
            tenantId,
            unidadeId,
            nome: b.nome.trim(),
            taxa: String(Number(b.taxa) || 0),
            ativo: b.ativo !== false,
            ordem: i,
          })),
      );
    }
    return this.listarBairros(tenantId, unidadeId);
  }

  // ===== Banners do cardápio (gestor) =====
  listarBanners(tenantId: string) {
    return this.db
      .select()
      .from(banner)
      .where(eq(banner.tenantId, tenantId))
      .orderBy(banner.ordem);
  }

  async setBanners(
    tenantId: string,
    unidadeId: string | null,
    banners: { imagemRef: string; titulo?: string; link?: string; ativo?: boolean }[],
  ) {
    await this.db.delete(banner).where(eq(banner.tenantId, tenantId));
    // Máximo de 3 banners no carrossel do cardápio.
    const validos = (banners ?? []).filter((b) => b.imagemRef?.trim()).slice(0, 3);
    if (validos.length) {
      await this.db.insert(banner).values(
        validos.map((b, i) => ({
          tenantId,
          unidadeId,
          imagemRef: b.imagemRef.trim(),
          titulo: b.titulo?.trim() || null,
          link: b.link?.trim() || null,
          ativo: b.ativo !== false,
          ordem: i,
        })),
      );
    }
    return this.listarBanners(tenantId);
  }

  // ===== Cupons — gestor =====
  listarCupons(tenantId: string) {
    return this.db.select().from(cupom).where(eq(cupom.tenantId, tenantId));
  }

  async criarCupom(tenantId: string, unidadeId: string | null, dto: any) {
    if (!dto?.codigo?.trim()) throw new BadRequestException('Informe o código.');
    const codigo = dto.codigo.trim().toUpperCase();
    const tipo = ['valor', 'fretegratis'].includes(dto.tipo) ? dto.tipo : 'percentual';
    const num = (v: any) => (v != null && v !== '' ? String(Number(v)) : null);
    const int = (v: any) => (v ? Number(v) || null : null);
    const vals = {
      tipo,
      valor: String(Number(dto.valor) || 0),
      tetoDesconto: tipo === 'percentual' ? num(dto.tetoDesconto) : null,
      minimo: num(dto.minimo),
      ativo: dto.ativo != null ? !!dto.ativo : true,
      validade: dto.validade || null,
      somenteNovos: !!dto.somenteNovos,
      maxPorCliente: int(dto.maxPorCliente),
      minDiasSemCompra: int(dto.minDiasSemCompra),
    };
    const [ja] = await this.db
      .select({ id: cupom.id })
      .from(cupom)
      .where(and(eq(cupom.tenantId, tenantId), sql`upper(codigo) = ${codigo}`));
    if (ja) {
      const [row] = await this.db
        .update(cupom)
        .set(vals)
        .where(eq(cupom.id, ja.id))
        .returning();
      return row;
    }
    const [row] = await this.db
      .insert(cupom)
      .values({ tenantId, unidadeId, codigo, ...vals })
      .returning();
    return row;
  }

  async removerCupom(tenantId: string, id: string) {
    await this.db
      .delete(cupom)
      .where(and(eq(cupom.id, id), eq(cupom.tenantId, tenantId)));
    return { ok: true };
  }

  // Histórico do cliente (por telefone): nº de pedidos válidos e data do último.
  // Usado nos condicionais de cupom (cliente novo / dias sem compra).
  private async historicoCliente(tenantId: string, tel: string) {
    if (!tel) return { total: 0, ultimoEm: null as Date | null };
    const [r]: any = await this.db.execute(sql`
      select count(*)::int as total, max(criado_em) as ultimo
      from pedido_externo
      where tenant_id = ${tenantId} and cliente_telefone = ${tel}
        and coalesce(status,'') <> 'cancelado'
    `);
    const row = (r?.rows ?? r)[0] ?? {};
    return { total: Number(row.total ?? 0), ultimoEm: row.ultimo ? new Date(row.ultimo) : null };
  }

  // Checa os condicionais do cupom (cliente novo, dias sem compra, máx por
  // cliente). Devolve { ok } ou { ok:false, motivo }.
  private async checarCondicoesCupom(
    tenantId: string,
    c: any,
    tel: string,
  ): Promise<{ ok: boolean; motivo?: string }> {
    if (!c.somenteNovos && !c.minDiasSemCompra && !c.maxPorCliente) return { ok: true };
    // Sem telefone não dá para avaliar cupom condicional.
    if (!tel) return { ok: false, motivo: 'Informe seu telefone para usar este cupom.' };
    const hist = await this.historicoCliente(tenantId, tel);
    if (c.somenteNovos && hist.total > 0)
      return { ok: false, motivo: 'Cupom exclusivo para o primeiro pedido.' };
    if (c.minDiasSemCompra && hist.ultimoEm) {
      const dias = (Date.now() - hist.ultimoEm.getTime()) / 86400000;
      if (dias < c.minDiasSemCompra)
        return { ok: false, motivo: `Válido só para quem está há ${c.minDiasSemCompra}+ dias sem comprar.` };
    }
    if (c.maxPorCliente) {
      const [u]: any = await this.db.execute(sql`
        select count(*)::int as n from cupom_uso
        where cupom_id = ${c.id} and telefone = ${tel}
      `);
      const usos = Number(((u?.rows ?? u)[0] ?? {}).n ?? 0);
      if (usos >= c.maxPorCliente)
        return { ok: false, motivo: 'Você já usou este cupom o máximo de vezes.' };
    }
    return { ok: true };
  }

  // Valida o cupom e devolve o desconto (e efeito no frete) para um subtotal.
  // ctx.telefone habilita a checagem dos condicionais.
  private async avaliarCupom(
    tenantId: string,
    codigo: string,
    subtotal: number,
    ctx: { telefone?: string } = {},
  ) {
    if (!codigo) return { valido: false, desconto: 0, freteGratis: false };
    const [c] = await this.db
      .select()
      .from(cupom)
      .where(
        and(
          eq(cupom.tenantId, tenantId),
          sql`upper(codigo) = upper(${codigo})`,
          eq(cupom.ativo, true),
        ),
      );
    if (!c) return { valido: false, desconto: 0, freteGratis: false, motivo: 'Cupom inválido.' };
    if (c.validade && new Date(c.validade) < new Date())
      return { valido: false, desconto: 0, freteGratis: false, motivo: 'Cupom expirado.' };
    if (c.minimo && subtotal < Number(c.minimo))
      return { valido: false, desconto: 0, freteGratis: false, motivo: `Mínimo de R$ ${Number(c.minimo).toFixed(2)}.` };
    const tel = (ctx.telefone ?? '').replace(/\D/g, '');
    const cond = await this.checarCondicoesCupom(tenantId, c, tel);
    if (!cond.ok) return { valido: false, desconto: 0, freteGratis: false, motivo: cond.motivo };
    let desconto = 0;
    let freteGratis = false;
    if (c.tipo === 'fretegratis') {
      freteGratis = true;
    } else if (c.tipo === 'valor') {
      desconto = Math.min(subtotal, Number(c.valor));
    } else {
      desconto = (subtotal * Number(c.valor)) / 100;
      if (c.tetoDesconto) desconto = Math.min(desconto, Number(c.tetoDesconto));
      desconto = Number(desconto.toFixed(2));
    }
    return {
      valido: true,
      desconto,
      freteGratis,
      codigo: c.codigo,
      tipo: c.tipo,
      valor: Number(c.valor),
      cupomId: c.id,
    };
  }

  // Público: cupons que o cliente PODE usar agora (passa nos condicionais e no
  // mínimo). Usado para sugerir no checkout. Sem telefone, oculta os condicionais.
  async cuponsDisponiveis(token: string, telefone: string | undefined, subtotal: number) {
    const cfg = await this.resolver(token);
    const tel = (telefone ?? '').replace(/\D/g, '');
    const lista = await this.db
      .select()
      .from(cupom)
      .where(
        and(
          eq(cupom.tenantId, cfg.tenantId),
          eq(cupom.ativo, true),
          or(sql`${cupom.validade} is null`, sql`${cupom.validade} >= current_date`),
        ),
      );
    const sub = Number(subtotal) || 0;
    const out: any[] = [];
    for (const c of lista) {
      const temCond = c.somenteNovos || c.minDiasSemCompra || c.maxPorCliente;
      if (temCond && !tel) continue; // condicional sem telefone: não sugere
      const cond = await this.checarCondicoesCupom(cfg.tenantId, c, tel);
      if (!cond.ok) continue;
      out.push({
        codigo: c.codigo,
        tipo: c.tipo,
        valor: Number(c.valor),
        tetoDesconto: c.tetoDesconto != null ? Number(c.tetoDesconto) : null,
        minimo: c.minimo != null ? Number(c.minimo) : null,
        atingeMinimo: !c.minimo || sub >= Number(c.minimo),
      });
    }
    return out;
  }

  // ===== Público (por token) =====
  private async resolver(token: string) {
    const [cfg] = await this.db
      .select()
      .from(cardapioConfig)
      .where(eq(cardapioConfig.token, token));
    if (!cfg || !cfg.ativo)
      throw new NotFoundException('Cardápio indisponível.');
    return cfg;
  }

  // Esgotado automático: para cada produto que controla estoque, resolve os
  // itens de insumo (via ficha, recursiva) e marca esgotado se algum tem saldo
  // <= 0. Combos consideram os insumos dos componentes. Saldo = ledger.
  private async computeEsgotados(
    tenantId: string,
    produtos: any[],
  ): Promise<Set<string>> {
    // permite_negativo = reativado sem estoque: não bloqueia por saldo (contagem negativa).
    const alvo = produtos.filter((p) => p.controlaEstoque && !p.permiteNegativo);
    if (!alvo.length) return new Set();

    // Saldo por item (mesmo sinal do módulo de estoque).
    const saldoRows: any = await this.db.execute(sql`
      select item_id as "itemId",
             coalesce(sum(case when tipo = 'saida' then -quantidade else quantidade end), 0) as saldo
      from movimento_estoque
      where tenant_id = ${tenantId}
      group by item_id
    `);
    const saldo = new Map<string, number>();
    for (const r of saldoRows.rows ?? saldoRows)
      saldo.set(r.itemId, Number(r.saldo) || 0);

    // Mapa de ingredientes por ficha (carregado uma vez para o tenant).
    const ingRows: any = await this.db.execute(sql`
      select fi.ficha_id as "fichaId", fi.item_id as "itemId",
             fi.sub_ficha_id as "subFichaId"
      from ficha_ingrediente fi
      join ficha_tecnica ft on ft.id = fi.ficha_id
      where ft.tenant_id = ${tenantId}
    `);
    const ingMap = new Map<string, any[]>();
    for (const r of ingRows.rows ?? ingRows) {
      const arr = ingMap.get(r.fichaId) ?? [];
      arr.push(r);
      ingMap.set(r.fichaId, arr);
    }

    // Itens de combo → componentes.
    const comboRows: any = await this.db.execute(sql`
      select pci.combo_produto_id as "comboId", p.ficha_id as "fichaId"
      from produto_combo_item pci
      join produto p on p.id = pci.componente_produto_id
      where p.tenant_id = ${tenantId}
    `);
    const comboMap = new Map<string, string[]>();
    for (const r of comboRows.rows ?? comboRows) {
      if (!r.fichaId) continue;
      const arr = comboMap.get(r.comboId) ?? [];
      arr.push(r.fichaId);
      comboMap.set(r.comboId, arr);
    }

    const itensDaFicha = (fichaId: string, vis: Set<string>): string[] => {
      if (!fichaId || vis.has(fichaId)) return [];
      vis.add(fichaId);
      const out: string[] = [];
      for (const ing of ingMap.get(fichaId) ?? []) {
        if (ing.subFichaId) out.push(...itensDaFicha(ing.subFichaId, vis));
        else if (ing.itemId) out.push(ing.itemId);
      }
      return out;
    };

    const esgotados = new Set<string>();
    for (const p of alvo) {
      const fichas =
        p.tipo === 'combo' ? comboMap.get(p.id) ?? [] : p.fichaId ? [p.fichaId] : [];
      const itens = fichas.flatMap((f) => itensDaFicha(f, new Set()));
      if (itens.length && itens.some((it) => (saldo.get(it) ?? 0) <= 0))
        esgotados.add(p.id);
    }
    return esgotados;
  }

  // Menu público rico: loja (tema/hero/frete/pagamento) + produtos com
  // complementos (grupos min/max) + variações. Preço sempre do banco.
  // A loja está aberta AGORA? Respeita o toggle manual (aberto) e os horários
  // por dia da semana (fuso SP). Sem horários cadastrados = sempre aberta.
  private estaAberta(cfg: any): boolean {
    if (cfg.aberto === false) return false;
    const hs = (cfg.horarios ?? []) as any[];
    if (!Array.isArray(hs) || hs.length === 0) return true;
    const agora = new Date(
      new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }),
    );
    const dia = agora.getDay(); // 0=Dom … 6=Sáb
    const hhmm = `${String(agora.getHours()).padStart(2, '0')}:${String(agora.getMinutes()).padStart(2, '0')}`;
    const doDia = hs.filter((h) => Number(h.dia) === dia && h.ativo && h.abre && h.fecha);
    if (!doDia.length) return false;
    return doDia.some((h) =>
      h.fecha > h.abre
        ? hhmm >= h.abre && hhmm <= h.fecha // mesmo dia
        : hhmm >= h.abre || hhmm <= h.fecha, // vira a meia-noite (ex.: 18:00–02:00)
    );
  }

  // Rótulo de horário para o cabeçalho: "Aberta até 23:00" ou "Abre às 18:00"
  // (com dia abreviado quando não for hoje). null quando não há horários.
  private horarioLabel(cfg: any): string | null {
    if (cfg.aberto === false) return 'Fechada';
    const hs = (cfg.horarios ?? []) as any[];
    if (!Array.isArray(hs) || hs.length === 0) return null;
    const agora = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
    const dia = agora.getDay();
    const hhmm = `${String(agora.getHours()).padStart(2, '0')}:${String(agora.getMinutes()).padStart(2, '0')}`;
    const DIAS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
    if (this.estaAberta(cfg)) {
      const doDia = hs.filter((h) => Number(h.dia) === dia && h.ativo && h.abre && h.fecha);
      const win = doDia.find((h) =>
        h.fecha > h.abre ? hhmm >= h.abre && hhmm <= h.fecha : hhmm >= h.abre || hhmm <= h.fecha,
      );
      return win ? `Aberta até ${win.fecha}` : 'Aberta';
    }
    // Fechada: procura a próxima abertura (hoje mais tarde, senão próximos dias).
    for (let d = 0; d < 7; d++) {
      const cd = (dia + d) % 7;
      const wins = hs
        .filter((h) => Number(h.dia) === cd && h.ativo && h.abre && h.fecha)
        .filter((h) => d > 0 || h.abre > hhmm)
        .sort((a, b) => (a.abre < b.abre ? -1 : 1));
      if (wins.length) return d === 0 ? `Abre às ${wins[0].abre}` : `Abre ${DIAS[cd]} ${wins[0].abre}`;
    }
    return 'Fechada';
  }

  async menu(token: string) {
    const cfg = await this.resolver(token);
    const catsRaw = await this.db
      .select()
      .from(categoriaProduto)
      .where(eq(categoriaProduto.tenantId, cfg.tenantId))
      .orderBy(categoriaProduto.ordem);
    // Só as categorias disponíveis agora (janelas dias/horários); vazio = sempre.
    const cats = catsRaw.filter((c: any) => c.ativo !== false && categoriaDisponivelAgora(c.disponibilidade));
    const prods: any = await this.db.execute(sql`
      select id, nome, descricao, preco_venda as "precoVenda",
             preco_promocional as "precoPromocional", categoria_id as "categoriaId",
             imagem_ref as "imagemRef", selos, duracao_min as "duracaoMin",
             tipo, ficha_id as "fichaId", controla_estoque as "controlaEstoque",
             disponivel_cardapio as "disponivelCardapio", pausado_estoque as "pausadoEstoque",
             permite_negativo as "permiteNegativo", destaque
      from produto
      where tenant_id = ${cfg.tenantId} and deleted_at is null
        and ativo = true
      order by nome
    `);
    const lista = (prods.rows ?? prods) as any[];
    const ids = lista.map((p) => p.id);

    // Esgotado automático pelo ledger: produto que controla estoque e cujo
    // insumo (item) tem saldo <= 0 fica marcado como esgotado no cardápio.
    const esgotados = await this.computeEsgotados(cfg.tenantId, lista);

    // Complementos (grupos + opções) e variações em lote.
    const grupos = ids.length
      ? await this.db
          .select()
          .from(complementoGrupo)
          .where(
            and(
              eq(complementoGrupo.tenantId, cfg.tenantId),
              inArray(complementoGrupo.produtoId, ids),
            ),
          )
          .orderBy(complementoGrupo.ordem)
      : [];
    const opcoes = grupos.length
      ? await this.db
          .select()
          .from(complementoOpcao)
          .where(eq(complementoOpcao.tenantId, cfg.tenantId))
          .orderBy(complementoOpcao.ordem)
      : [];
    const variacoes = ids.length
      ? await this.db
          .select()
          .from(produtoVariacao)
          .where(inArray(produtoVariacao.produtoId, ids))
      : [];

    // Formas de pagamento do cardápio = as `forma_pagamento` marcadas p/ cardápio.
    // Fallback: se nenhuma foi marcada ainda, usa o `pagamentos` legado (sem regressão).
    const formasCardapio = await this.db
      .select({ nome: formaPagamento.nome })
      .from(formaPagamento)
      .where(
        and(
          eq(formaPagamento.tenantId, cfg.tenantId),
          eq(formaPagamento.ativo, true),
          eq(formaPagamento.cardapio, true),
        ),
      )
      .orderBy(formaPagamento.ordem, formaPagamento.nome);
    const pagamentosCardapio = formasCardapio.map((f) => f.nome);

    return {
      loja: {
        nome: cfg.nomePublico ?? 'Cardápio',
        ramo: cfg.ramo,
        tema: cfg.tema ?? 'claro',
        menuTheme: ['classic', 'fastfood', 'grid'].includes(cfg.menuTheme) ? cfg.menuTheme : 'classic',
        // Personalização do tema (defaults quando ausente): cor primária + toggles
        // + intervalo do carrossel de banners (segundos, mínimo 1).
        temaConfig: (() => {
          const t = (cfg.temaConfig as any) ?? {};
          const cor = (v: any) => (typeof v === 'string' && v ? v : null);
          return {
            corPrimaria: cor(t.corPrimaria),
            corCabecalho: cor(t.corCabecalho), // fundo do cabeçalho (null = padrão do tema)
            corTextoCabecalho: cor(t.corTextoCabecalho), // cor da fonte do cabeçalho
            mostrarDestaques: t.mostrarDestaques !== false,
            mostrarBanner: t.mostrarBanner !== false,
            mostrarUltimos: t.mostrarUltimos !== false,
            bannerIntervalo: Math.max(1, Number(t.bannerIntervalo) || 2),
          };
        })(),
        logoEmoji: cfg.logoEmoji,
        subtitulo: cfg.subtitulo,
        aberto: cfg.aberto,
        tempoEntregaMin: cfg.tempoEntregaMin,
        tempoRetiradaMin: cfg.tempoRetiradaMin,
        pedidoMinimo: cfg.pedidoMinimo != null ? Number(cfg.pedidoMinimo) : null,
        avaliacao: cfg.avaliacao != null ? Number(cfg.avaliacao) : null,
        freteGratisAcima:
          cfg.freteGratisAcima != null ? Number(cfg.freteGratisAcima) : null,
        // Área de atendimento (para o frete no checkout do cardápio).
        areaModo: cfg.areaModo ?? 'bairro',
        raios: (cfg.raios as any[]) ?? [],
        lojaLat: cfg.endLat != null ? Number(cfg.endLat) : null,
        lojaLng: cfg.endLng != null ? Number(cfg.endLng) : null,
        pagamentos: pagamentosCardapio.length ? pagamentosCardapio : (cfg.pagamentos ?? []),
        formasCartao: cfg.formasCartao ?? [],
        fidelidadeAtiva: cfg.fidelidadeAtiva,
        whatsapp: cfg.whatsapp,
        parcelasMax: cfg.parcelasMax ?? null,
        logoRef: cfg.logoRef ?? null,
        instagram: cfg.instagram ?? null,
        site: cfg.site ?? null,
        documento: cfg.documento ?? null,
        responsavelNome: cfg.responsavelNome ?? null,
        contatoLoja: cfg.contatoLoja ?? null,
        // Endereço da loja (o robô responde "onde fica")
        endereco: {
          cep: cfg.endCep ?? null,
          rua: cfg.endRua ?? null,
          numero: cfg.endNumero ?? null,
          bairro: cfg.endBairro ?? null,
          cidade: cfg.endCidade ?? null,
          estado: cfg.endEstado ?? null,
          referencia: cfg.endReferencia ?? null,
          complemento: cfg.endComplemento ?? null,
          texto: [
            [cfg.endRua, cfg.endNumero].filter(Boolean).join(', '),
            cfg.endBairro,
            [cfg.endCidade, cfg.endEstado].filter(Boolean).join(' - '),
          ].filter((s) => s && s.trim()).join(', ') || null,
        },
      },
      // Aberta agora (respeita horários) — o storefront e o robô usam isto.
      abertaAgora: this.estaAberta(cfg),
      horarioLabel: this.horarioLabel(cfg), // "Aberta até 23:00" / "Abre às 18:00"
      // Contexto para o robô/atendimento (o n8n lê tudo com o token):
      horarios: cfg.horarios ?? [],
      tipos: {
        delivery: cfg.tipoDelivery !== false,
        retirada: !!cfg.tipoRetirada,
        local: !!cfg.tipoLocal,
      },
      robo: {
        ativo: !!cfg.roboAtivo,
        saudacao: cfg.roboSaudacao ?? null,
        ausencia: cfg.roboAusencia ?? null,
        prompt: cfg.roboPrompt ?? null,
        mensagens: cfg.roboMensagens ?? [],
      },
      modo: cfg.modo,
      bairros: (await this.listarBairros(cfg.tenantId, cfg.unidadeId)).map((b) => ({
        id: b.id,
        nome: b.nome,
        taxa: Number(b.taxa),
      })),
      categorias: cats.map((c: any) => ({ id: c.id, nome: c.nome, descricao: c.descricao ?? null, imagemRef: c.imagemRef ?? null })),
      // Banners ativos (aparecem no topo do cardápio no lugar da busca).
      banners: (await this.listarBanners(cfg.tenantId))
        .filter((b: any) => b.ativo !== false && b.imagemRef)
        .map((b: any) => ({ imagemRef: b.imagemRef, titulo: b.titulo ?? null, link: b.link ?? null })),
      produtos: lista.map((p: any) => {
        const promo = p.precoPromocional != null ? Number(p.precoPromocional) : null;
        return {
          id: p.id,
          nome: p.nome,
          descricao: p.descricao,
          precoVenda: promo ?? Number(p.precoVenda),
          precoDe: promo != null ? Number(p.precoVenda) : null,
          categoriaId: p.categoriaId,
          imagemRef: p.imagemRef,
          selos: p.selos ?? [],
          duracaoMin: p.duracaoMin,
          destaque: p.destaque === true,
          // Esgotado = auto por estoque OU pausa manual OU auto-pausa por estoque.
          esgotado: esgotados.has(p.id) || p.disponivelCardapio === false || p.pausadoEstoque === true,
          variacoes: variacoes
            .filter((v) => v.produtoId === p.id && v.ativo !== false)
            .map((v) => ({
              id: v.id,
              nome: v.nome,
              precoVenda: Number(v.precoVenda),
              atributos: v.atributos ?? {},
            })),
          grupos: grupos
            .filter((g) => g.produtoId === p.id)
            .map((g) => ({
              id: g.id,
              nome: g.nome,
              tipo: g.tipo,
              min: g.min,
              max: g.max,
              obrigatorio: g.obrigatorio,
              opcoes: opcoes
                .filter((o) => o.grupoId === g.id)
                .map((o) => ({
                  id: o.id,
                  nome: o.nome,
                  precoDelta: Number(o.precoDelta),
                })),
            })),
        };
      }),
    };
  }

  // Público (robô): pedidos recentes de um telefone — pra responder "cadê meu pedido?".
  // Casa pelos últimos 8 dígitos (ignora formatação/DDI).
  async pedidosPorTelefone(token: string, telefone: string) {
    const cfg = await this.resolver(token);
    const digits = String(telefone ?? '').replace(/\D/g, '');
    if (digits.length < 8) return [];
    const tail = digits.slice(-8);
    const rows = await this.db
      .select({
        id: pedidoExterno.id,
        numero: pedidoExterno.numero,
        displayId: pedidoExterno.displayId,
        status: pedidoExterno.status,
        tipo: pedidoExterno.tipo,
        total: pedidoExterno.total,
        entregadorNome: pedidoExterno.entregadorNome,
        criadoEm: pedidoExterno.criadoEm,
      })
      .from(pedidoExterno)
      .where(
        and(
          eq(pedidoExterno.tenantId, cfg.tenantId),
          or(
            ilike(pedidoExterno.clienteTelefone, `%${tail}%`),
            ilike(pedidoExterno.clienteTelefone2, `%${tail}%`),
          ),
        ),
      )
      .orderBy(desc(pedidoExterno.criadoEm))
      .limit(10);
    // Texto amigável do status + estimativa de entrega (min) para o robô.
    const LABEL: Record<string, string> = {
      novo: 'recebido', confirmado: 'em preparo', pronto: 'pronto',
      despachado: 'saiu para entrega', concluido: 'entregue', cancelado: 'cancelado',
    };
    const estimativaMin = cfg.tempoEntregaMin != null ? Number(cfg.tempoEntregaMin) : null;
    return rows.map((r) => ({
      ...r,
      statusTexto: LABEL[r.status] ?? r.status,
      estimativaMin: ['novo', 'confirmado', 'pronto', 'despachado'].includes(r.status) ? estimativaMin : null,
    }));
  }

  // Público: último pedido do cliente (com imagem dos produtos) — card do topo.
  async ultimoPedidoPublico(token: string, telefone: string) {
    const cfg = await this.resolver(token);
    const digits = String(telefone ?? '').replace(/\D/g, '');
    if (digits.length < 8) return null;
    const tail = digits.slice(-8);
    const [ped] = await this.db
      .select({
        id: pedidoExterno.id,
        displayId: pedidoExterno.displayId,
        total: pedidoExterno.total,
        criadoEm: pedidoExterno.criadoEm,
        itens: pedidoExterno.itens,
      })
      .from(pedidoExterno)
      .where(
        and(
          eq(pedidoExterno.tenantId, cfg.tenantId),
          or(
            ilike(pedidoExterno.clienteTelefone, `%${tail}%`),
            ilike(pedidoExterno.clienteTelefone2, `%${tail}%`),
          ),
        ),
      )
      .orderBy(desc(pedidoExterno.criadoEm))
      .limit(1);
    if (!ped) return null;
    const itens = Array.isArray(ped.itens) ? (ped.itens as any[]) : [];
    const ids = [...new Set(itens.map((i) => i.produtoId).filter(Boolean))];
    const imgs = ids.length
      ? await this.db
          .select({ id: produto.id, imagemRef: produto.imagemRef, nome: produto.nome })
          .from(produto)
          .where(and(eq(produto.tenantId, cfg.tenantId), inArray(produto.id, ids)))
      : [];
    const byId = new Map(imgs.map((p) => [p.id, p]));
    return {
      id: ped.id,
      displayId: ped.displayId,
      total: Number(ped.total),
      criadoEm: ped.criadoEm,
      itens: itens.map((i) => ({
        produtoId: i.produtoId,
        nome: i.descricao ?? byId.get(i.produtoId)?.nome ?? 'Item',
        quantidade: Number(i.quantidade) || 1,
        imagemRef: byId.get(i.produtoId)?.imagemRef ?? null,
      })),
    };
  }

  // Público: valida um cupom para um subtotal (com telefone p/ condicionais).
  async validarCupomPublico(
    token: string,
    codigo: string,
    subtotal: number,
    telefone?: string,
  ) {
    const cfg = await this.resolver(token);
    return this.avaliarCupom(cfg.tenantId, codigo, Number(subtotal) || 0, { telefone });
  }

  // Público: status do pedido (timeline) por id.
  async statusPedido(token: string, pedidoId: string, ref?: string) {
    const cfg = await this.resolver(token);
    const [p] = await this.db
      .select()
      .from(pedidoExterno)
      .where(
        and(
          eq(pedidoExterno.id, pedidoId),
          eq(pedidoExterno.tenantId, cfg.tenantId),
        ),
      );
    if (!p) throw new NotFoundException('Pedido não encontrado.');
    // Link reabrível/compartilhável: se veio `ref`, tem que bater com o client_ref
    // do pedido — evita ver pedido de outro cliente trocando o ID na URL.
    if (ref !== undefined && ref !== '' && p.clientRef && ref !== p.clientRef)
      throw new NotFoundException('Pedido não encontrado.');
    return {
      id: p.id,
      displayId: p.displayId,
      status: p.status,
      statusPagamento: p.statusPagamento,
      tipo: p.tipo,
      total: Number(p.total),
      taxaEntrega: Number(p.taxaEntrega),
      desconto: Number(p.desconto),
      itens: p.itens,
      criadoEm: p.criadoEm,
    };
  }

  // Access token do Mercado Pago: por tenant (integracao canal 'mercadopago',
  // ativo) ou fallback global do env MP_ACCESS_TOKEN. null = sem gateway (mock).
  private async resolveMpToken(tenantId: string): Promise<string | null> {
    const [row] = await this.db
      .select({ token: integracao.token, ativo: integracao.ativo })
      .from(integracao)
      .where(and(eq(integracao.tenantId, tenantId), eq(integracao.canal, 'mercadopago')));
    if (row?.ativo && row.token) return row.token;
    return process.env.MP_ACCESS_TOKEN || null;
  }

  // Público: pagamento online. Com Mercado Pago configurado → gera PIX (QR +
  // copia-e-cola) e fica "aguardando" a confirmação (webhook). SEM gateway →
  // fallback MOCK (aprova na hora), para demo/dev funcionarem sem credencial.
  async pagarPedidoPublico(token: string, pedidoId: string) {
    const cfg = await this.resolver(token);
    const [p] = await this.db
      .select()
      .from(pedidoExterno)
      .where(
        and(
          eq(pedidoExterno.id, pedidoId),
          eq(pedidoExterno.tenantId, cfg.tenantId),
        ),
      );
    if (!p) throw new NotFoundException('Pedido não encontrado.');
    if (p.pago) return { ok: true, jaPago: true, statusPagamento: 'aprovado' };

    const mpToken = await this.resolveMpToken(cfg.tenantId);
    if (!mpToken) {
      // Fallback mock (sem gateway): aprova imediatamente.
      await this.db
        .update(pedidoExterno)
        .set({ pago: true, statusPagamento: 'aprovado' })
        .where(eq(pedidoExterno.id, pedidoId));
      return { ok: true, statusPagamento: 'aprovado', mock: true };
    }

    // Gera (ou reaproveita) a cobrança PIX real no Mercado Pago.
    const base = process.env.PUBLIC_API_URL || '';
    try {
      const pix = await criarPixMP(mpToken, {
        valor: Number(p.total),
        descricao: `Pedido #${p.numero ?? ''} · ${cfg.nomePublico ?? 'Loja'}`,
        nome: p.clienteNome ?? undefined,
        referenciaExterna: p.id,
        notificationUrl: base ? `${base}/api/v1/publico/cardapio/pagamento/mercadopago/webhook` : undefined,
        idempotencia: `pedido-${p.id}`,
      });
      await this.db
        .update(pedidoExterno)
        .set({ gatewayPaymentId: pix.id, statusPagamento: 'aguardando' })
        .where(eq(pedidoExterno.id, pedidoId));
      return {
        ok: true,
        statusPagamento: 'aguardando',
        pix: { qrCode: pix.qrCode, qrCodeBase64: pix.qrCodeBase64, ticketUrl: pix.ticketUrl },
      };
    } catch (e) {
      throw new BadRequestException(
        `Não foi possível gerar o PIX: ${e instanceof Error ? e.message : 'erro no gateway'}`,
      );
    }
  }

  // Webhook do Mercado Pago: confirma o pagamento. Descobre o tenant pelo pedido
  // correlacionado (gateway_payment_id) e consulta o status real no MP.
  async webhookMercadoPago(paymentId: string) {
    if (!paymentId) return { ok: true, ignorado: true };
    const [p] = await this.db
      .select({ id: pedidoExterno.id, tenantId: pedidoExterno.tenantId, pago: pedidoExterno.pago })
      .from(pedidoExterno)
      .where(eq(pedidoExterno.gatewayPaymentId, String(paymentId)));
    if (!p) return { ok: true, naoCorrelacionado: true };
    if (p.pago) return { ok: true, jaPago: true };
    const mpToken = await this.resolveMpToken(p.tenantId);
    if (!mpToken) return { ok: true, semToken: true };
    const st = await consultarPagamentoMP(mpToken, String(paymentId));
    if (st.status === 'approved') {
      await this.db
        .update(pedidoExterno)
        .set({ pago: true, statusPagamento: 'aprovado' })
        .where(eq(pedidoExterno.id, p.id));
      return { ok: true, aprovado: true };
    }
    return { ok: true, status: st.status };
  }

  // Resolve as opções escolhidas (por id) validando o tenant. Preço do banco.
  private async resolverOpcoes(tenantId: string, opcaoIds: string[]) {
    if (!opcaoIds?.length) return { precoDelta: 0, labels: [] as string[] };
    const ops = await this.db
      .select({ nome: complementoOpcao.nome, precoDelta: complementoOpcao.precoDelta })
      .from(complementoOpcao)
      .where(
        and(
          eq(complementoOpcao.tenantId, tenantId),
          inArray(complementoOpcao.id, opcaoIds),
        ),
      );
    return {
      precoDelta: ops.reduce((s, o) => s + Number(o.precoDelta), 0),
      labels: ops.map((o) => o.nome),
    };
  }

  // Recebe o pedido do cliente. Preço/complementos vêm SEMPRE do banco.
  // "Peça também": sugestões para o carrinho. Prioridade = manual (cadastro
  // vinculado aos produtos do carrinho); se não houver, cai no automático (mais
  // pedidos). Sempre exclui o que já está no carrinho e o indisponível.
  async pecaTambem(token: string, produtosCsv?: string) {
    const cfg = await this.resolver(token);
    const carrinho = (produtosCsv ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    const excluir = new Set(carrinho);
    const disp = (p: any) => p.ativo !== false && p.disponivelCardapio !== false && !excluir.has(p.id);
    const mapProd = (p: any) => ({
      id: p.id,
      nome: p.nome,
      preco: p.precoPromocional != null ? Number(p.precoPromocional) : Number(p.precoVenda),
      precoDe: p.precoPromocional != null ? Number(p.precoVenda) : null,
      imagem: p.imagemRef ?? null,
    });
    const out: any[] = [];
    const vistos = new Set<string>();
    const add = (p: any) => {
      if (disp(p) && !vistos.has(p.id)) {
        vistos.add(p.id);
        out.push(mapProd(p));
      }
    };

    // 1) Manual (cadastro) — prioridade.
    if (carrinho.length) {
      const rows = await this.db
        .select({
          id: produto.id,
          nome: produto.nome,
          precoVenda: produto.precoVenda,
          precoPromocional: produto.precoPromocional,
          ativo: produto.ativo,
          disponivelCardapio: produto.disponivelCardapio,
          imagemRef: produto.imagemRef,
        })
        .from(produtoSugestao)
        .innerJoin(produto, eq(produto.id, produtoSugestao.sugeridoId))
        .where(and(eq(produtoSugestao.tenantId, cfg.tenantId), inArray(produtoSugestao.produtoId, carrinho)))
        .orderBy(produtoSugestao.ordem);
      for (const r of rows) add(r);
    }

    // 2) Automático (fallback): mais pedidos.
    if (!out.length) {
      const rank: any = await this.db.execute(sql`
        select ci.produto_id as id, count(*)::int as qtd
        from comanda_item ci join comanda c on c.id = ci.comanda_id
        where c.tenant_id = ${cfg.tenantId} and ci.produto_id is not null
        group by ci.produto_id order by qtd desc limit 30`);
      const ids = (rank.rows ?? rank).map((x: any) => x.id).filter((id: string) => id && !excluir.has(id));
      if (ids.length) {
        const prods = await this.db
          .select()
          .from(produto)
          .where(and(eq(produto.tenantId, cfg.tenantId), inArray(produto.id, ids)));
        const byId = new Map(prods.map((p: any) => [p.id, p]));
        for (const id of ids) {
          if (out.length >= 6) break;
          const p = byId.get(id);
          if (p) add(p);
        }
      }
    }
    return out.slice(0, 6);
  }

  // Resposta de um pedido já existente (replay idempotente por client_ref):
  // reconstrói o mesmo formato do fluxo normal a partir da linha gravada.
  private respostaPedido(cfg: { tenantId: string }, row: typeof pedidoExterno.$inferSelect) {
    return {
      ok: true,
      modo: row.tipo,
      pedidoId: row.id,
      displayId: row.displayId,
      total: Number(row.total),
      taxaEntrega: Number(row.taxaEntrega),
      desconto: Number(row.desconto),
      pagamentoOnline: row.statusPagamento === 'aguardando',
      orcamento: row.statusPagamento === 'orcamento',
      agendamento: row.agendamento ? new Date(row.agendamento).toISOString() : null,
      clienteToken: row.clienteId ? assinarCliente(row.clienteId, cfg.tenantId) : undefined,
      reenvio: true, // sinaliza ao front que é o mesmo pedido (não duplicou)
    };
  }

  async receberPedido(
    token: string,
    dto: {
      mesa?: string;
      cliente?: string;
      telefone?: string;
      clienteToken?: string; // link mágico: associa o pedido ao cliente identificado
      clientRef?: string; // idempotência: mesmo ref em retries = 1 pedido
      tipo?: string; // entrega | retirada
      endereco?: string; // texto livre (compat/legado)
      rua?: string;
      numero?: string;
      referencia?: string;
      telefone2?: string;
      bairroId?: string;
      lat?: number; // frete por raio
      lng?: number;
      formaPagamento?: string;
      bandeira?: string; // forma de cartão escolhida (rótulo)
      trocoPara?: number;
      cupom?: string;
      resgateId?: string; // prêmio de fidelidade a abater no pedido
      usarCashback?: boolean; // false = não usar o saldo de cashback
      agendamento?: string; // serviços: data/hora
      profissional?: string; // serviços
      cnpj?: string; // indústria: faturamento
      itens: {
        produtoId: string;
        variacaoId?: string;
        quantidade: number;
        complementos?: string[];
        observacao?: string;
      }[];
    },
  ) {
    const cfg = await this.resolver(token);
    // Idempotência: se este client_ref já virou pedido, devolve o mesmo (200) —
    // não recria nem recobra. Retry do cliente (rede ruim, duplo toque) é seguro.
    if (dto.clientRef) {
      const [ja] = await this.db
        .select()
        .from(pedidoExterno)
        .where(and(eq(pedidoExterno.tenantId, cfg.tenantId), eq(pedidoExterno.clientRef, dto.clientRef)));
      if (ja) return this.respostaPedido(cfg, ja);
    }
    if (!dto.itens?.length) throw new BadRequestException('Pedido vazio.');
    // Loja fechada: bloqueia (pedidos agendados passam).
    if (!dto.agendamento && !this.estaAberta(cfg))
      throw new BadRequestException('A loja está fechada no momento. Volte no horário de funcionamento.');
    const ids = [...new Set(dto.itens.map((i) => i.produtoId))];
    const prods = await this.db
      .select({
        id: produto.id,
        nome: produto.nome,
        precoVenda: produto.precoVenda,
        precoPromocional: produto.precoPromocional,
        ativo: produto.ativo,
        disponivelCardapio: produto.disponivelCardapio,
      })
      .from(produto)
      .where(and(eq(produto.tenantId, cfg.tenantId), inArray(produto.id, ids)));
    const porId = new Map(prods.map((p) => [p.id, p]));
    for (const it of dto.itens) {
      const p = porId.get(it.produtoId);
      // Só entra no cardápio produto ativo E marcado para o canal cardápio digital.
      if (!p || p.ativo === false || p.disponivelCardapio === false)
        throw new BadRequestException('Produto indisponível no pedido.');
    }

    // Modo MESA (QR na mesa): itens vão para a comanda (adicionarItem resolve
    // preço, variação e complementos internamente).
    if (cfg.modo === 'mesa' && dto.mesa) {
      const comandaId = await this.comandaDaMesa(cfg.tenantId, cfg.unidadeId, dto.mesa);
      for (const it of dto.itens) {
        await this.vendas.adicionarItem(cfg.tenantId, null as any, comandaId, {
          produtoId: it.produtoId,
          variacaoId: it.variacaoId,
          quantidade: Number(it.quantidade) || 1,
          complementos: it.complementos,
          observacao: it.observacao,
        });
      }
      return { ok: true, modo: 'mesa', mesa: dto.mesa };
    }

    // Modo RETIRADA/TOTEM: pedido externo com preço/rótulos calculados no servidor.
    const itensOut: any[] = [];
    let totalCent = 0; // subtotal dos itens em centavos (exato, sem drift)
    for (const it of dto.itens) {
      const p = porId.get(it.produtoId)!;
      let base = p.precoPromocional != null ? Number(p.precoPromocional) : Number(p.precoVenda);
      let desc = p.nome;
      if (it.variacaoId) {
        const [v] = await this.db
          .select()
          .from(produtoVariacao)
          .where(eq(produtoVariacao.id, it.variacaoId));
        if (v) {
          base = Number(v.precoVenda);
          desc = `${p.nome} · ${v.nome}`;
        }
      }
      const { precoDelta, labels } = await this.resolverOpcoes(cfg.tenantId, it.complementos ?? []);
      const qtd = Number(it.quantidade) || 1;
      const preco = base + precoDelta;
      totalCent += paraCentavos(preco) * qtd;
      itensOut.push({
        produtoId: it.produtoId,
        variacaoId: it.variacaoId,
        descricao: labels.length ? `${desc} (${labels.join(', ')})` : desc,
        quantidade: qtd,
        precoUnitario: preco,
        observacao: it.observacao,
      });
    }
    // Subtotal em reais (fronteira) — usado nos serviços de cupom/prêmio/cashback.
    const total = paraReais(totalCent);
    // Checkout: tipo, frete (bairro), cupom, pagamento.
    const tipo = dto.tipo === 'entrega' ? 'entrega' : 'retirada';
    let taxa = 0;
    let bairroNome: string | undefined;
    if (tipo === 'entrega') {
      if (cfg.areaModo === 'raio') {
        // Frete por raio: distância loja→cliente (Haversine) escolhe a faixa.
        let lat = Number(dto.lat);
        let lng = Number(dto.lng);
        // Sem GPS do navegador → geocoda o endereço digitado (Nominatim). A cidade/
        // estado da loja entram na busca para desambiguar. Falha → cai no fallback.
        if (!(Number.isFinite(lat) && Number.isFinite(lng))) {
          const q = montarEndereco([
            dto.endereco || montarEndereco([dto.rua, dto.numero]),
            cfg.endBairro,
            cfg.endCidade,
            cfg.endEstado,
          ]);
          const g = await geocode(q);
          if (g) {
            lat = g.lat;
            lng = g.lng;
          }
        }
        const slat = Number(cfg.endLat);
        const slng = Number(cfg.endLng);
        const raios = [...((cfg.raios as any[]) ?? [])].sort((a, b) => Number(a.ateKm) - Number(b.ateKm));
        if ([lat, lng, slat, slng].every((n) => Number.isFinite(n)) && raios.length) {
          const km = haversineKm(slat, slng, lat, lng);
          const faixa = raios.find((r) => km <= Number(r.ateKm)) ?? raios[raios.length - 1];
          taxa = Number(faixa.taxa) || 0;
          bairroNome = `~${km.toFixed(1)} km`;
        }
      } else if (dto.bairroId) {
        const [b] = await this.db
          .select()
          .from(cardapioBairro)
          .where(
            and(
              eq(cardapioBairro.id, dto.bairroId),
              eq(cardapioBairro.tenantId, cfg.tenantId),
            ),
          );
        taxa = b ? Number(b.taxa) : 0;
        bairroNome = b?.nome;
      }
      // frete grátis acima de X
      if (cfg.freteGratisAcima != null && total >= Number(cfg.freteGratisAcima)) taxa = 0;
    }
    // Endereço estruturado → compõe o texto p/ impressão/compatibilidade.
    const enderecoTexto =
      tipo === 'entrega'
        ? [
            [dto.rua, dto.numero].filter(Boolean).join(', '),
            bairroNome,
            dto.referencia ? `ref: ${dto.referencia}` : '',
          ]
            .filter((s) => s && s.trim())
            .join(' · ') || dto.endereco
        : undefined;
    const cup = await this.avaliarCupom(cfg.tenantId, dto.cupom ?? '', total, {
      telefone: dto.telefone,
    });
    // Descontos acumulados em CENTAVOS (cupom + prêmio + cashback) — sem drift.
    let descontoCent = cup.valido ? paraCentavos(cup.desconto) : 0;
    if (cup.valido && cup.freteGratis) taxa = 0; // cupom de frete grátis zera a entrega
    // Prêmio de fidelidade resgatado: abate automático no pedido.
    const premio = cfg.fidelidadeAtiva
      ? await this.fidelidade.avaliarPremio(cfg.tenantId, dto.resgateId, dto.telefone ?? '', itensOut, total)
      : { desconto: 0 };
    descontoCent = somarCentavos(descontoCent, paraCentavos(premio.desconto || 0));
    // Cashback: aplica saldo (valor) + vales (produto) sobre o que restou.
    // O cliente pode optar por NÃO usar o saldo (usarCashback=false).
    const cb =
      dto.usarCashback === false
        ? { saldoUsado: 0, vales: [] as any[], desconto: 0 }
        : await this.cashback.avaliarDescontos(
            cfg.tenantId,
            dto.telefone ?? '',
            Math.max(0, paraReais(somarCentavos(totalCent, -descontoCent))),
          );
    descontoCent = somarCentavos(descontoCent, paraCentavos(cb.desconto || 0));
    const desconto = paraReais(descontoCent); // reais na fronteira (gravação/resposta)
    // Indústria (B2B): pedido é ORÇAMENTO — sem cobrança online, fatura por CNPJ.
    const orcamento = cfg.ramo === 'industria';
    const forma = orcamento ? 'faturamento' : dto.formaPagamento ?? 'entrega';
    const online = !orcamento && (forma === 'pix' || forma === 'cartao');
    const grande = paraReais(Math.max(0, somarCentavos(totalCent, -descontoCent, paraCentavos(taxa))));

    // Senha PRÓPRIA do cardápio (contador sequencial por tenant do canal).
    const cnt: any = await this.db.execute(
      sql`select count(*)::int as c from pedido_externo where tenant_id = ${cfg.tenantId} and canal = 'cardapio'`,
    );
    const senhaCardapio = String((((cnt.rows ?? cnt)[0]?.c ?? 0) as number) + 1);

    const ped = await this.delivery.ingest(
      cfg.tenantId,
      cfg.unidadeId,
      'cardapio',
      {
        cliente: dto.cliente ?? 'Cardápio',
        clienteTelefone: dto.telefone,
        tipo,
        endereco: enderecoTexto ?? dto.endereco,
        formaPagamento: forma,
        total: grande,
        displayId: senhaCardapio,
        itens: itensOut,
      },
      {
        clientRef: dto.clientRef,
        taxaEntrega: taxa,
        cupom: cup.valido ? cup.codigo : undefined,
        desconto,
        trocoPara: dto.trocoPara,
        statusPagamento: orcamento
          ? 'orcamento'
          : online
            ? 'aguardando'
            : 'na_entrega',
        agendamento: dto.agendamento,
        profissional: dto.profissional,
        cnpj: dto.cnpj,
        clienteTelefone2: tipo === 'entrega' ? dto.telefone2 : undefined,
        enderecoRua: tipo === 'entrega' ? dto.rua : undefined,
        enderecoNumero: tipo === 'entrega' ? dto.numero : undefined,
        enderecoReferencia: tipo === 'entrega' ? dto.referencia : undefined,
        enderecoBairro: tipo === 'entrega' ? bairroNome : undefined,
        bandeira: dto.bandeira,
      },
    );

    // Cliente do cardápio: identidade por TELEFONE (obrigatório no pedido; um
    // cliente tem 1:N endereços). O token identifica sem expor os dados na URL.
    // Não há pedido anônimo — sempre acha/cria o cliente pelo telefone.
    const cli = verificarCliente(dto.clienteToken);
    let clienteId = cli && cli.tenant === cfg.tenantId ? cli.cli : null;
    if (!clienteId && ped?.id) {
      const tel = (dto.telefone ?? '').replace(/\D/g, '');
      if (tel.length >= 10) {
        const [ex] = await this.db
          .select({ id: cliente.id })
          .from(cliente)
          .where(and(eq(cliente.tenantId, cfg.tenantId), eq(cliente.telefone, tel)));
        if (ex) {
          clienteId = ex.id;
        } else {
          const nomeCli =
            dto.cliente && !['Cliente', 'Cardápio'].includes(dto.cliente) ? dto.cliente : null;
          const [c] = await this.db
            .insert(cliente)
            .values({ tenantId: cfg.tenantId, nome: nomeCli, telefone: tel })
            .returning();
          clienteId = c.id;
        }
      }
    }
    if (clienteId && ped?.id) {
      await this.db
        .update(pedidoExterno)
        .set({ clienteId })
        .where(eq(pedidoExterno.id, ped.id));
    }
    const clienteTokenOut = clienteId
      ? assinarCliente(clienteId, cfg.tenantId)
      : dto.clienteToken;

    // Envio automático ao KDS: aceita o pedido na hora (cria comanda + produção
    // com senha local + selo da plataforma). Orçamento (indústria) não produz.
    if (cfg.autoKds !== false && !orcamento && (ped as any)?.status === 'novo') {
      try {
        await this.delivery.aceitar(cfg.tenantId, null, ped.id);
      } catch {
        /* mantém o pedido em 'novo' se a produção falhar */
      }
    }

    // Registra o uso do cupom (para max_por_cliente e histórico).
    if (cup.valido && (cup as any).cupomId && ped?.id) {
      try {
        await this.db.insert(cupomUso).values({
          tenantId: cfg.tenantId,
          cupomId: (cup as any).cupomId,
          clienteId: clienteId ?? undefined,
          telefone: (dto.telefone ?? '').replace(/\D/g, '') || undefined,
          pedidoId: ped.id,
        });
      } catch {
        /* histórico de uso não bloqueia o pedido */
      }
    }

    // Prêmio de fidelidade consumido: marca como usado neste pedido.
    if ((premio as any).desconto > 0 && (premio as any).resgateId && ped?.id) {
      try {
        await this.fidelidade.marcarPremioUsado(cfg.tenantId, (premio as any).resgateId, ped.id);
      } catch {
        /* não bloqueia o pedido */
      }
    }

    // Cashback consumido: debita o saldo usado e marca os vales como usados.
    if (cb.desconto > 0 && dto.telefone && ped?.id) {
      try {
        await this.cashback.consumir(
          cfg.tenantId,
          dto.telefone,
          ped.id,
          cb.saldoUsado,
          cb.vales.map((v: any) => v.id),
        );
      } catch {
        /* não bloqueia o pedido */
      }
    }

    // Fidelidade (L5): pontua os planos que o pedido atende (dedupe por pedido).
    let fidelidade: any;
    if (cfg.fidelidadeAtiva && dto.telefone && ped?.id) {
      try {
        fidelidade = await this.fidelidade.pontuarPedido(cfg.tenantId, {
          telefone: dto.telefone,
          clienteId: clienteId ?? undefined,
          nome: dto.cliente,
          pedidoId: ped.id,
          produtoIds: ids,
        });
      } catch {
        /* fidelidade nunca quebra o pedido */
      }
    }

    return {
      ok: true,
      modo: tipo,
      pedidoId: ped.id,
      displayId: ped.displayId,
      total: grande,
      taxaEntrega: taxa,
      desconto,
      pagamentoOnline: online,
      orcamento,
      agendamento: dto.agendamento ?? null,
      pontos: fidelidade?.pontosGanhos ?? undefined,
      fidelidade: fidelidade ?? null,
      premioAplicado: (premio as any).desconto > 0 ? { plano: (premio as any).plano, desconto: (premio as any).desconto } : null,
      clienteToken: clienteTokenOut, // identidade do cliente (guardar no navegador)
    };
  }

  // Promoções públicas do cardápio: cupons ativos/vigentes + flag de fidelidade.
  // Produtos em promoção o front deriva do próprio menu (precoDe).
  async promosPublico(token: string) {
    const cfg = await this.resolver(token);
    const cupons = await this.db
      .select({
        codigo: cupom.codigo,
        tipo: cupom.tipo,
        valor: cupom.valor,
        minimo: cupom.minimo,
        validade: cupom.validade,
      })
      .from(cupom)
      .where(
        and(
          eq(cupom.tenantId, cfg.tenantId),
          eq(cupom.ativo, true),
          or(sql`${cupom.validade} is null`, sql`${cupom.validade} >= current_date`),
        ),
      );
    const planos = cfg.fidelidadeAtiva
      ? await this.fidelidade.planosPublicos(cfg.tenantId)
      : [];
    return {
      fidelidadeAtiva: !!cfg.fidelidadeAtiva,
      planos,
      cupons: cupons.map((c) => ({
        codigo: c.codigo,
        tipo: c.tipo,
        valor: Number(c.valor),
        minimo: c.minimo != null ? Number(c.minimo) : null,
        validade: c.validade,
      })),
    };
  }

  // Público: status de fidelidade do cliente (planos, progresso e prêmios).
  async pontosPublico(token: string, telefone: string) {
    const cfg = await this.resolver(token);
    if (!cfg.fidelidadeAtiva) return { ativo: false, planos: [], resgates: [] };
    return { ativo: true, ...(await this.fidelidade.statusCliente(cfg.tenantId, telefone)) };
  }

  // Público: resgata um prêmio de fidelidade disponível.
  async resgatarFidelidade(token: string, resgateId: string, telefone: string) {
    const cfg = await this.resolver(token);
    return this.fidelidade.resgatar(cfg.tenantId, resgateId, telefone);
  }

  // Público: prêmios já resgatados, prontos para abater no próximo pedido.
  async premiosFidelidade(token: string, telefone: string) {
    const cfg = await this.resolver(token);
    if (!cfg.fidelidadeAtiva) return [];
    return this.fidelidade.premiosParaUsar(cfg.tenantId, telefone);
  }

  // Público: saldo de cashback do cliente (valor, pontos, vales, planos).
  async cashbackSaldoPublico(token: string, telefone: string) {
    const cfg = await this.resolver(token);
    return this.cashback.saldoCliente(cfg.tenantId, telefone);
  }

  // Público: troca pontos de cashback por um produto (gera vale).
  async cashbackResgatarProduto(token: string, telefone: string, produtoId: string) {
    const cfg = await this.resolver(token);
    return this.cashback.resgatarProduto(cfg.tenantId, telefone, produtoId);
  }

  // Acha (ou abre) a mesa pelo número e devolve a comanda ativa dela.
  private async comandaDaMesa(
    tenantId: string,
    unidadeId: string | null,
    numero: string,
  ): Promise<string> {
    const [m] = await this.db
      .select()
      .from(mesa)
      .where(
        and(
          eq(mesa.tenantId, tenantId),
          eq(mesa.numero, String(numero)),
          eq(mesa.status, 'aberta'),
        ),
      );
    let mesaId = m?.id;
    if (!mesaId) {
      const nova = await this.vendas.abrirMesa(tenantId, null as any, {
        numero: String(numero),
        modo: 'mesa',
        unidadeId: unidadeId ?? undefined,
      });
      mesaId = nova.id;
    }
    const [c] = await this.db
      .select({ id: comanda.id })
      .from(comanda)
      .where(and(eq(comanda.mesaId, mesaId), eq(comanda.status, 'aberta')));
    if (c) return c.id;
    // mesa sem comanda aberta (ex.: modo comandas) → abre uma
    const nc = await this.vendas.abrirComandaNaMesa(tenantId, null as any, mesaId, {});
    return nc.id;
  }
}
