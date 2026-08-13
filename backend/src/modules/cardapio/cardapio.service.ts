import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { and, desc, eq, gte, ilike, inArray, isNull, lt, or, sql } from 'drizzle-orm';
import { randomBytes } from 'crypto';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { verificarCliente, assinarCliente } from '../cliente/cliente-token';
import { paraCentavos, paraReais, somarCentavos } from '../../util/dinheiro';
import { geocode, montarEndereco } from '../../common/geocode';

// Estamos rodando no servidor EDGE (appliance da loja) e não na nuvem?
function ehEdge(): boolean {
  return String(process.env.EDGE_MODE ?? '').toLowerCase() === 'true';
}

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
  complemento,
  complementoGrupo,
  complementoOpcao,
  opcao,
  cardapioBairro,
  banner,
  cupom,
  cupomUso,
  pedidoExterno,
  edgeHeartbeat,
  comandaItem,
  mesa,
  comanda,
  cliente,
  formaPagamento,
  integracao,
  entitlement,
  alertaEstoque,
  produtoFaixaPreco,
  encomendaRegraSinal,
  encomendaRecorrencia,
} from '../../db/schema';
import { precoComAtacado } from '../../common/preco-atacado';
import { criarPixMP, consultarPagamentoMP, cancelarPagamentoMP, reembolsarPagamentoMP, assinaturaWebhookMPOk } from '../../common/mercadopago';
import { criarPixPagBank, consultarPagamentoPagBank, reembolsarPagamentoPagBank } from '../../common/pagbank';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import { Cron } from '@nestjs/schedule';
import { VendasService } from '../vendas/vendas.service';
import { DeliveryService } from '../delivery/delivery.service';
import { EdgeFlashSyncService } from '../sync/edge-flash-sync.service';
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
  private readonly logger = new Logger(CardapioService.name);
  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly vendas: VendasService,
    private readonly delivery: DeliveryService,
    private readonly atendimento: AtendimentoService,
    private readonly fidelidade: FidelidadeService,
    private readonly cashback: CashbackService,
    private readonly events: EventEmitter2,
    private readonly flash: EdgeFlashSyncService,
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
    const idsMudados: string[] = []; // p/ flash-sync (refletir no cardápio online já)
    for (const p of produtos) {
      const agora = esgotados.has(p.id);
      if (agora && !p.pausadoEstoque) {
        await this.db
          .update(produto)
          .set({ pausadoEstoque: true, pausaMotivo: 'Estoque do insumo esgotado', updatedAt: new Date() })
          .where(eq(produto.id, p.id));
        novos.push(p.nome);
        idsMudados.push(p.id);
      } else if (!agora && p.pausadoEstoque) {
        await this.db
          .update(produto)
          .set({ pausadoEstoque: false, pausaMotivo: null, updatedAt: new Date() })
          .where(eq(produto.id, p.id));
        idsMudados.push(p.id);
      }
    }
    // Flash-sync: no edge, empurra a disponibilidade para o cardápio ONLINE em
    // segundos (bloqueia novos pedidos do item esgotado) sem esperar o ciclo do sync.
    if (idsMudados.length) void this.flash.flashProdutos(idsMudados);

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
    // Base pública do cardápio digital: SEMPRE a nuvem (o cliente scaneia o QR com
    // o próprio celular, fora da rede da loja). Mesmo no edge/modo local, o link/QR
    // aponta para a nuvem; o pedido cai lá e o edge puxa via sync. Nunca é local.
    const cardapioBaseUrl = (
      process.env.CARDAPIO_PUBLIC_URL ||
      process.env.APP_URL ||
      'https://app.dmsregem.com'
    ).replace(/\/$/, '');
    const row = await this.configRaw(tenantId, unidadeId);
    return { ...(row ?? { ativo: false, modo: 'mesa', token: null }), cardapioBaseUrl };
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
      // Regras de estorno/empilhamento (mig 125) — a loja configura.
      cancelamentoEstornaCashback:
        dto.cancelamentoEstornaCashback != null
          ? !!dto.cancelamentoEstornaCashback
          : row?.cancelamentoEstornaCashback ?? true,
      cupomBloqueiaComResgate:
        dto.cupomBloqueiaComResgate != null
          ? !!dto.cupomBloqueiaComResgate
          : row?.cupomBloqueiaComResgate ?? false,
      // Front envia o teto em REAIS (null/'' = sem limite); guardamos em centavos.
      cupomMaxCashbackCent:
        'cupomMaxCashbackReais' in dto
          ? dto.cupomMaxCashbackReais == null ||
            dto.cupomMaxCashbackReais === '' ||
            Number(dto.cupomMaxCashbackReais) <= 0
            ? null
            : Math.round(Number(dto.cupomMaxCashbackReais) * 100)
          : row?.cupomMaxCashbackCent ?? null,
      fidelidadeIntervaloHoras:
        dto.fidelidadeIntervaloHoras != null
          ? Math.max(0, Math.floor(Number(dto.fidelidadeIntervaloHoras) || 0))
          : row?.fidelidadeIntervaloHoras ?? 3,
      // Modo Encomenda (mig 186) — opt-in + regras de data futura.
      encomendaAtiva:
        dto.encomendaAtiva != null ? !!dto.encomendaAtiva : row?.encomendaAtiva ?? false,
      encomendaAntecedenciaHoras:
        dto.encomendaAntecedenciaHoras != null
          ? Math.max(0, Math.floor(Number(dto.encomendaAntecedenciaHoras) || 0))
          : row?.encomendaAntecedenciaHoras ?? 24,
      encomendaHorizonteDias:
        dto.encomendaHorizonteDias != null
          ? Math.max(1, Math.floor(Number(dto.encomendaHorizonteDias) || 1))
          : row?.encomendaHorizonteDias ?? 30,
      encomendaCorte:
        'encomendaCorte' in dto
          ? (dto.encomendaCorte || null)
          : row?.encomendaCorte ?? null,
      encomendaCapacidadeDia:
        'encomendaCapacidadeDia' in dto
          ? (dto.encomendaCapacidadeDia == null || dto.encomendaCapacidadeDia === '' || Number(dto.encomendaCapacidadeDia) <= 0
              ? null
              : Math.floor(Number(dto.encomendaCapacidadeDia)))
          : row?.encomendaCapacidadeDia ?? null,
      // Sinal da encomenda — regra base (mig 187).
      encomendaExigeSinal:
        dto.encomendaExigeSinal != null ? !!dto.encomendaExigeSinal : row?.encomendaExigeSinal ?? false,
      encomendaSinalPct:
        'encomendaSinalPct' in dto
          ? (dto.encomendaSinalPct == null || dto.encomendaSinalPct === ''
              ? null
              : String(Math.min(Math.max(Number(dto.encomendaSinalPct) || 0, 0), 100)))
          : row?.encomendaSinalPct ?? null,
      encomendaCancelHoras:
        'encomendaCancelHoras' in dto
          ? (dto.encomendaCancelHoras == null || dto.encomendaCancelHoras === '' || Number(dto.encomendaCancelHoras) < 0
              ? null
              : Math.floor(Number(dto.encomendaCancelHoras)))
          : row?.encomendaCancelHoras ?? null,
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
      horariosRetirada: Array.isArray(dto.horariosRetirada) ? dto.horariosRetirada : row?.horariosRetirada ?? [],
      horarioUnico: dto.horarioUnico != null ? !!dto.horarioUnico : row?.horarioUnico ?? true,
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
  // Conjunto de horários do tipo do pedido: retirada/local usa `horariosRetirada`
  // quando o horário NÃO é único; senão (e p/ delivery) usa `horarios`.
  private horariosDoTipo(cfg: any, tipo?: string): any[] {
    if ((tipo === 'retirada' || tipo === 'local') && cfg.horarioUnico === false) {
      return (cfg.horariosRetirada ?? []) as any[];
    }
    return (cfg.horarios ?? []) as any[];
  }

  private estaAberta(cfg: any, tipo?: string): boolean {
    if (cfg.aberto === false) return false;
    const hs = this.horariosDoTipo(cfg, tipo);
    if (!Array.isArray(hs) || hs.length === 0) return true;
    return !!this.janelaAtual(hs);
  }

  // Janela de funcionamento que cobre AGORA (ou null). Uma janela que vira a
  // meia-noite (ex.: 18:00–02:00) pertence ao dia em que ABRE — então, depois da
  // meia-noite, quem vale é a janela de ONTEM, não a de hoje.
  private janelaAtual(hs: any[]): any | null {
    const { dia, hhmm } = this.agoraSp();
    const doDia = (d: number) => hs.filter((h) => Number(h.dia) === d && h.ativo && h.abre && h.fecha);
    // Começou hoje: mesmo dia, ou o trecho antes da meia-noite de uma janela virada.
    const hoje = doDia(dia).find((h) =>
      h.fecha > h.abre ? hhmm >= h.abre && hhmm <= h.fecha : hhmm >= h.abre,
    );
    if (hoje) return hoje;
    // Começou ontem e ainda não fechou (madrugada): só janelas que viram a meia-noite.
    const ontem = (dia + 6) % 7;
    return doDia(ontem).find((h) => h.fecha <= h.abre && hhmm <= h.fecha) ?? null;
  }

  private agoraSp(): { dia: number; hhmm: string } {
    const agora = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
    return {
      dia: agora.getDay(), // 0=Dom … 6=Sáb
      hhmm: `${String(agora.getHours()).padStart(2, '0')}:${String(agora.getMinutes()).padStart(2, '0')}`,
    };
  }

  // Rótulo de horário para o cabeçalho: "Aberta até 23:00" ou "Abre às 18:00"
  // (com dia abreviado quando não for hoje). null quando não há horários.
  private horarioLabel(cfg: any): string | null {
    if (cfg.aberto === false) return 'Fechada';
    const hs = (cfg.horarios ?? []) as any[];
    if (!Array.isArray(hs) || hs.length === 0) return null;
    const { dia, hhmm } = this.agoraSp();
    const DIAS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
    if (this.estaAberta(cfg)) {
      const win = this.janelaAtual(hs);
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

  // Faixas de atacado (mig 184) por produto: só as com desconto > 0, ordenadas.
  // Retorna Map<produtoId, {qtdMin, descontoPct}[]> para precificar/exibir em lote.
  private async faixasAtacadoPorProduto(tenantId: string, ids: string[]) {
    const map = new Map<string, { qtdMin: number; descontoPct: number }[]>();
    if (!ids.length) return map;
    const rows = await this.db
      .select({
        produtoId: produtoFaixaPreco.produtoId,
        qtdMin: produtoFaixaPreco.qtdMin,
        descontoPct: produtoFaixaPreco.descontoPct,
      })
      .from(produtoFaixaPreco)
      .where(
        and(
          eq(produtoFaixaPreco.tenantId, tenantId),
          inArray(produtoFaixaPreco.produtoId, ids),
        ),
      )
      .orderBy(produtoFaixaPreco.qtdMin);
    for (const r of rows) {
      const pct = Number(r.descontoPct) || 0;
      if (pct <= 0) continue;
      const arr = map.get(r.produtoId) ?? [];
      arr.push({ qtdMin: Number(r.qtdMin) || 0, descontoPct: pct });
      map.set(r.produtoId, arr);
    }
    return map;
  }

  // Regras de encomenda (mig 186): a antecedência é em HORAS (permite MESMO DIA em
  // horário mais à frente, não só data futura). Fonte única — exposta no menu (o
  // checkout monta a janela data+hora) e usada na validação do servidor. `corte`
  // (opcional) fecha encomendas para HOJE após aquele horário. `ativa:false` = loja
  // não trabalha com encomenda.
  private regrasEncomenda(cfg: any) {
    if (!cfg?.encomendaAtiva) return { ativa: false as const };
    return {
      ativa: true as const,
      antecedenciaHoras: Math.max(0, Number(cfg.encomendaAntecedenciaHoras) || 0),
      horizonteDias: Math.max(1, Number(cfg.encomendaHorizonteDias) || 30),
      corte: cfg.encomendaCorte ? String(cfg.encomendaCorte).slice(0, 5) : null,
      capacidadeDia: cfg.encomendaCapacidadeDia ?? null,
    };
  }

  // ===== Sinal da encomenda (mig 187): regra base (config) + faixas por qtd =====

  // Regras por faixa de quantidade, ordenadas por min_itens.
  regrasSinalDe(tenantId: string, unidadeId?: string | null) {
    return this.db
      .select()
      .from(encomendaRegraSinal)
      .where(
        and(
          eq(encomendaRegraSinal.tenantId, tenantId),
          ...(unidadeId ? [eq(encomendaRegraSinal.unidadeId, unidadeId)] : []),
        ),
      )
      .orderBy(encomendaRegraSinal.minItens);
  }

  // Replace-all das faixas de sinal (por unidade quando informada).
  async setRegrasSinal(
    tenantId: string,
    unidadeId: string | null,
    regras: {
      minItens: number;
      maxItens?: number | null;
      exigeSinal?: boolean;
      sinalPct?: number;
      cancelHoras?: number | null;
    }[],
  ) {
    await this.db
      .delete(encomendaRegraSinal)
      .where(
        and(
          eq(encomendaRegraSinal.tenantId, tenantId),
          ...(unidadeId ? [eq(encomendaRegraSinal.unidadeId, unidadeId)] : [isNull(encomendaRegraSinal.unidadeId)]),
        ),
      );
    const limpos = (regras ?? [])
      .filter((r) => Number(r.minItens) > 0)
      .map((r, i) => ({
        tenantId,
        unidadeId: unidadeId ?? null,
        minItens: Math.floor(Number(r.minItens)),
        maxItens:
          r.maxItens == null || r.maxItens === ('' as any) || Number(r.maxItens) <= 0
            ? null
            : Math.floor(Number(r.maxItens)),
        exigeSinal: r.exigeSinal !== false,
        sinalPct: String(Math.min(Math.max(Number(r.sinalPct) || 0, 0), 100)),
        cancelHoras:
          r.cancelHoras == null || r.cancelHoras === ('' as any) || Number(r.cancelHoras) < 0
            ? null
            : Math.floor(Number(r.cancelHoras)),
        ordem: i,
      }));
    if (limpos.length) await this.db.insert(encomendaRegraSinal).values(limpos);
    return this.regrasSinalDe(tenantId, unidadeId);
  }

  // Resolve o sinal aplicável a uma encomenda com `qtdItens` itens: vale a faixa
  // de MAIOR min_itens que contém a quantidade; senão, a regra base da config.
  private resolverSinal(cfg: any, regras: any[], qtdItens: number) {
    const cand = (regras ?? [])
      .filter((r) => {
        const min = Number(r.minItens) || 0;
        const max = r.maxItens == null ? Infinity : Number(r.maxItens);
        return qtdItens >= min && qtdItens <= max;
      })
      .sort((a, b) => (Number(b.minItens) || 0) - (Number(a.minItens) || 0));
    const r = cand[0];
    if (r) {
      return {
        exigeSinal: r.exigeSinal !== false,
        sinalPct: Number(r.sinalPct) || 0,
        cancelHoras: r.cancelHoras == null ? null : Number(r.cancelHoras),
        origem: 'faixa' as const,
      };
    }
    return {
      exigeSinal: cfg?.encomendaExigeSinal === true,
      sinalPct: Number(cfg?.encomendaSinalPct) || 0,
      cancelHoras: cfg?.encomendaCancelHoras == null ? null : Number(cfg.encomendaCancelHoras),
      origem: 'base' as const,
    };
  }

  // Quantas encomendas (não canceladas) já existem para uma data (fuso SP).
  private async contarEncomendasNaData(
    tenantId: string,
    unidadeId: string | null,
    data: string,
  ): Promise<number> {
    const r: any = await this.db.execute(sql`
      select count(*)::int as n from pedido_externo
      where tenant_id = ${tenantId}
        ${unidadeId ? sql`and unidade_id = ${unidadeId}` : sql``}
        and agendamento is not null
        and (agendamento at time zone 'America/Sao_Paulo')::date = ${data}::date
        and status <> 'cancelado'
    `);
    return Number((r?.rows ?? r)?.[0]?.n ?? 0);
  }

  async menu(token: string) {
    const cfg = await this.resolver(token);
    const catsRaw = await this.db
      .select()
      .from(categoriaProduto)
      .where(and(eq(categoriaProduto.tenantId, cfg.tenantId), isNull(categoriaProduto.deletedAt)))
      .orderBy(categoriaProduto.ordem);
    // Só as categorias disponíveis agora (janelas dias/horários); vazio = sempre.
    const cats = catsRaw.filter((c: any) => c.ativo !== false && categoriaDisponivelAgora(c.disponibilidade));
    const prods: any = await this.db.execute(sql`
      select id, nome, descricao, preco_venda as "precoVenda",
             preco_promocional as "precoPromocional", categoria_id as "categoriaId",
             imagem_ref as "imagemRef", selos, duracao_min as "duracaoMin",
             tipo, ficha_id as "fichaId", controla_estoque as "controlaEstoque",
             disponivel_cardapio as "disponivelCardapio", pausado_estoque as "pausadoEstoque",
             permite_negativo as "permiteNegativo", destaque,
             atacado_ativo as "atacadoAtivo"
      from produto
      where tenant_id = ${cfg.tenantId} and deleted_at is null
        and ativo = true
      order by nome
    `);
    const lista = (prods.rows ?? prods) as any[];
    const ids = lista.map((p) => p.id);
    // Faixas de atacado (mig 184) para exibir "a partir de N un, -X%" no cardápio.
    const faixasAtacado = await this.faixasAtacadoPorProduto(cfg.tenantId, ids);
    // Regras de sinal da encomenda (mig 187) — o checkout mostra o aviso pela qtd.
    const sinalRegras = cfg.encomendaAtiva
      ? await this.regrasSinalDe(cfg.tenantId, cfg.unidadeId)
      : [];

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
              isNull(complementoGrupo.deletedAt),
            ),
          )
          .orderBy(complementoGrupo.ordem)
      : [];
    const opcoes = grupos.length
      ? await this.db
          .select()
          .from(complementoOpcao)
          .where(and(eq(complementoOpcao.tenantId, cfg.tenantId), isNull(complementoOpcao.deletedAt)))
          .orderBy(complementoOpcao.ordem)
      : [];
    // Regra de cada grupo (uma / várias sem / várias COM repetição) — vem do
    // complemento reutilizável de origem (o grupo materializado não a guarda).
    const origemIds = [...new Set((grupos as any[]).map((g) => g.origemComplementoId).filter(Boolean))] as string[];
    const compRegras = origemIds.length
      ? await this.db
          .select({ id: complemento.id, regra: complemento.regra })
          .from(complemento)
          .where(and(eq(complemento.tenantId, cfg.tenantId), inArray(complemento.id, origemIds)))
      : [];
    const regraPorOrigem = new Map(compRegras.map((c) => [c.id, c.regra]));
    const regraDoGrupo = (g: any) =>
      (g.origemComplementoId && regraPorOrigem.get(g.origemComplementoId)) || (g.max === 1 ? 'uma' : 'varias_sem_repeticao');
    // Imagem da opção (para exibir no cardápio) — vem da opção reutilizável de origem
    // (o complemento_opcao materializado não guarda imagem).
    const opcaoOrigemIds = [...new Set((opcoes as any[]).map((o) => o.origemOpcaoId).filter(Boolean))] as string[];
    const imgs = opcaoOrigemIds.length
      ? await this.db
          .select({ id: opcao.id, imagemRef: opcao.imagemRef })
          .from(opcao)
          .where(and(eq(opcao.tenantId, cfg.tenantId), inArray(opcao.id, opcaoOrigemIds)))
      : [];
    const imgPorOrigem = new Map(imgs.map((o) => [o.id, o.imagemRef]));
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
        // Modo Encomenda (mig 186): regras p/ o checkout oferecer data futura.
        encomenda: {
          ...this.regrasEncomenda(cfg),
          // Sinal (mig 187): base + faixas por qtd; o checkout resolve pela qtd do carrinho.
          sinal: cfg.encomendaAtiva
            ? {
                base: {
                  exige: cfg.encomendaExigeSinal === true,
                  pct: Number(cfg.encomendaSinalPct) || 0,
                  cancelHoras: cfg.encomendaCancelHoras ?? null,
                },
                regras: (sinalRegras as any[]).map((r) => ({
                  minItens: r.minItens,
                  maxItens: r.maxItens,
                  exige: r.exigeSinal !== false,
                  pct: Number(r.sinalPct) || 0,
                  cancelHoras: r.cancelHoras ?? null,
                })),
              }
            : null,
        },
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
          // Atacado por volume (mig 184): faixas "a partir de N un → -X%" (só se ligado).
          atacado:
            p.atacadoAtivo === true ? faixasAtacado.get(p.id) ?? [] : [],
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
              regra: regraDoGrupo(g),
              opcoes: opcoes
                .filter((o) => o.grupoId === g.id)
                .map((o) => ({
                  id: o.id,
                  nome: o.nome,
                  precoDelta: Number(o.precoDelta),
                  // mig 126 — sem código PDV = opção INFORMATIVA (observação de preparo:
                  // "ponto de carne", "talheres"): não soma preço nem baixa estoque.
                  informativa: !(o.codigoPdv ?? '').trim(),
                  padraoMarcada: !!o.padraoMarcada, // já vem pré-selecionada
                  imagemRef: (o.origemOpcaoId && imgPorOrigem.get(o.origemOpcaoId)) || null,
                })),
            })),
        };
      }),
    };
  }

  // Público (robô): pedidos recentes de um telefone — pra responder "cadê meu pedido?".
  // Casa pelos últimos 8 dígitos (ignora formatação/DDI).
  // Resolve o TELEFONE do cliente a partir do clienteToken assinado (prova de
  // posse). Fecha a enumeração por telefone chutável: as consultas/resgates de PII
  // passam a usar SÓ o telefone do DONO do token. null = sem prova de identidade.
  private async telefoneDoTokenCliente(
    tenantId: string,
    clienteToken?: string,
  ): Promise<string | null> {
    const cli = verificarCliente(clienteToken);
    if (!cli || cli.tenant !== tenantId) return null;
    const [row] = await this.db
      .select({ telefone: cliente.telefone })
      .from(cliente)
      .where(and(eq(cliente.id, cli.cli), eq(cliente.tenantId, tenantId)));
    return row?.telefone ?? null;
  }

  async pedidosPorTelefone(token: string, clienteToken?: string) {
    const cfg = await this.resolver(token);
    const telefone = await this.telefoneDoTokenCliente(cfg.tenantId, clienteToken);
    if (!telefone) return []; // sem prova de dono → nada (era enumerável por telefone)
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
  async ultimoPedidoPublico(token: string, clienteToken?: string) {
    const cfg = await this.resolver(token);
    const telefone = await this.telefoneDoTokenCliente(cfg.tenantId, clienteToken);
    if (!telefone) return null; // sem prova de dono
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
      agendamento: p.agendamento ? new Date(p.agendamento).toISOString() : null,
      // Sinal da encomenda (mig 188).
      sinal:
        p.sinalStatus && p.sinalStatus !== 'nao'
          ? {
              status: p.sinalStatus,
              valor: p.sinalValor != null ? Number(p.sinalValor) : null,
              pct: p.sinalPct != null ? Number(p.sinalPct) : null,
              cancelavelAte: p.cancelavelAte ? new Date(p.cancelavelAte).toISOString() : null,
            }
          : null,
      criadoEm: p.criadoEm,
    };
  }

  // Token de um canal de integração do tenant (se ativo). null se não configurado.
  private async tokenCanal(tenantId: string, canal: string): Promise<string | null> {
    const [row] = await this.db
      .select({ token: integracao.token, ativo: integracao.ativo })
      .from(integracao)
      .where(and(eq(integracao.tenantId, tenantId), eq(integracao.canal, canal)));
    return row?.ativo && row.token ? row.token : null;
  }

  // Access token do Mercado Pago: por tenant (canal 'mercadopago') ou env.
  private async resolveMpToken(tenantId: string): Promise<string | null> {
    return (await this.tokenCanal(tenantId, 'mercadopago')) || process.env.MP_ACCESS_TOKEN || null;
  }

  // Assinatura secreta do webhook do MP: config DA LOJA (BYO) — guardada na coluna
  // client_secret da integração 'mercadopago'. Cada loja tem a sua (o token e o
  // segredo são da conta MP dela). Env fica só como override global opcional. null
  // = loja não cadastrou → verificação de assinatura desligada (a re-consulta ao
  // gateway continua sendo a proteção real).
  private async resolveMpWebhookSecret(tenantId: string): Promise<string | null> {
    const [row] = await this.db
      .select({ secret: integracao.clientSecret, ativo: integracao.ativo })
      .from(integracao)
      .where(and(eq(integracao.tenantId, tenantId), eq(integracao.canal, 'mercadopago')));
    return (row?.ativo && row.secret) || process.env.MP_WEBHOOK_SECRET || null;
  }

  // Token do PagBank/PagSeguro: SÓ por tenant (canal 'pagseguro'), BYO puro. Modo
  // distribuição — cada loja cola o token na integração; sem env/cadastro na API.
  private async resolvePagseguroToken(tenantId: string): Promise<string | null> {
    return (await this.tokenCanal(tenantId, 'pagseguro')) || null;
  }

  // Provedores de PIX ATIVOS do tenant, ORDENADOS por prioridade (primário → fallback).
  // A loja pode ter os dois configurados: `pix_gateway_prioritario` diz quem tenta
  // primeiro; o outro entra se o primário falhar ao gerar o QR. Vazio = [] (mock).
  private async resolveGateways(
    tenantId: string,
  ): Promise<{ provider: 'mercadopago' | 'pagseguro'; token: string }[]> {
    const [mp, ps] = await Promise.all([
      this.resolveMpToken(tenantId),
      this.resolvePagseguroToken(tenantId),
    ]);
    const disp: { provider: 'mercadopago' | 'pagseguro'; token: string }[] = [];
    if (mp) disp.push({ provider: 'mercadopago', token: mp });
    if (ps) disp.push({ provider: 'pagseguro', token: ps });
    // Primário conforme a config (null = mercadopago, incumbente).
    const [cfg] = await this.db
      .select({ prio: cardapioConfig.pixGatewayPrioritario })
      .from(cardapioConfig)
      .where(eq(cardapioConfig.tenantId, tenantId))
      .limit(1);
    const prim = cfg?.prio === 'pagseguro' ? 'pagseguro' : 'mercadopago';
    return disp.sort((a, b) => (a.provider === prim ? -1 : 0) - (b.provider === prim ? -1 : 0));
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
    if (p.sinalStatus === 'pago') return { ok: true, jaPago: true, sinalPago: true, statusPagamento: 'sinal_pago' };

    // Encomenda com sinal pendente: cobra SÓ o valor do sinal (resto na entrega).
    const ehSinal = p.sinalStatus === 'pendente' && p.sinalValor != null;
    const aCobrar = ehSinal ? Number(p.sinalValor) : Number(p.total);

    const gws = await this.resolveGateways(cfg.tenantId);
    if (!gws.length) {
      // Fallback mock (sem gateway): aprova imediatamente.
      const r = await this.aprovarPagamento(cfg.tenantId, pedidoId);
      return r.tipo === 'sinal'
        ? { ok: true, sinalPago: true, statusPagamento: 'sinal_pago', mock: true }
        : { ok: true, statusPagamento: 'aprovado', mock: true };
    }

    // Gera a cobrança PIX no gateway PRIMÁRIO; se falhar, cai no SECUNDÁRIO (fallback).
    const base = process.env.PUBLIC_API_URL || '';
    const descricao = `Pedido #${p.numero ?? ''} · ${cfg.nomePublico ?? 'Loja'}`;
    // Cardápio não coleta e-mail: deriva um válido do telefone (os gateways exigem
    // e-mail do pagador). Sem telefone, o helper usa o fallback interno.
    const email = p.clienteTelefone
      ? `cliente-${String(p.clienteTelefone).replace(/\D/g, '')}@dmsregem.com`
      : undefined;
    // Expira em 10 min (alinha com o cron que cancela o não pago).
    const expiraEm = new Date(Date.now() + 10 * 60 * 1000);
    const erros: string[] = [];
    for (const gw of gws) {
      try {
        const rota = gw.provider === 'pagseguro' ? 'pagbank' : 'mercadopago';
        const notificationUrl = base ? `${base}/api/v1/publico/cardapio/pagamento/${rota}/webhook` : undefined;
        const args = {
          valor: aCobrar, // sinal (encomenda) ou total
          descricao: ehSinal ? `Sinal · ${descricao}` : descricao,
          nome: p.clienteNome ?? undefined,
          email,
          referenciaExterna: p.id,
          notificationUrl,
          idempotencia: ehSinal ? `sinal-${p.id}` : `pedido-${p.id}`,
          expiraEm,
        };
        const pix =
          gw.provider === 'pagseguro'
            ? await criarPixPagBank(gw.token, args)
            : await criarPixMP(gw.token, args);
        await this.db
          .update(pedidoExterno)
          .set({ gatewayPaymentId: pix.id, gatewayProvider: gw.provider, statusPagamento: 'aguardando' })
          .where(eq(pedidoExterno.id, pedidoId));
        return {
          ok: true,
          statusPagamento: 'aguardando',
          gateway: gw.provider,
          sinal: ehSinal ? { valor: aCobrar } : undefined,
          pix: { qrCode: pix.qrCode, qrCodeBase64: pix.qrCodeBase64, ticketUrl: pix.ticketUrl },
        };
      } catch (e) {
        const motivo = e instanceof Error ? e.message : 'erro no gateway';
        // logger.error → TelemetriaLogger leva a falha de cobrança para a distribuição.
        this.logger.error(`PIX ${gw.provider} falhou (pedido ${p.id}, tenant ${cfg.tenantId}): ${motivo}`);
        erros.push(`${gw.provider}: ${motivo}`);
        // segue para o próximo gateway (fallback).
      }
    }
    throw new BadRequestException(`Não foi possível gerar o PIX: ${erros.join(' | ')}`);
  }

  // Público: verifica o pagamento SOB DEMANDA (consulta o gateway), sem depender do
  // webhook — o cliente clica "Verificar pagamento" e a página faz polling disto.
  // Se aprovado: marca pago + aceita (entra em produção). Robusto quando o webhook do
  // MP não chega (ex.: PUBLIC_API_URL não configurada / notificação atrasada).
  async verificarPagamentoPublico(token: string, pedidoId: string) {
    const cfg = await this.resolver(token);
    const [p] = await this.db
      .select()
      .from(pedidoExterno)
      .where(and(eq(pedidoExterno.id, pedidoId), eq(pedidoExterno.tenantId, cfg.tenantId)));
    if (!p) throw new NotFoundException('Pedido não encontrado.');
    if (p.pago) return { pago: true, statusPagamento: 'aprovado', status: p.status };
    if (p.statusPagamento !== 'aguardando' || !p.gatewayPaymentId)
      return { pago: false, statusPagamento: p.statusPagamento, status: p.status };
    try {
      // Consulta no gateway que GEROU o QR (é onde o pagamento cai).
      let aprovado = false;
      if (p.gatewayProvider === 'pagseguro') {
        const t = await this.resolvePagseguroToken(cfg.tenantId);
        if (t) aprovado = (await consultarPagamentoPagBank(t, p.gatewayPaymentId)).status === 'paid';
      } else {
        const t = await this.resolveMpToken(cfg.tenantId);
        if (t) aprovado = (await consultarPagamentoMP(t, p.gatewayPaymentId)).status === 'approved';
      }
      if (aprovado) {
        const r = await this.aprovarPagamento(cfg.tenantId, p.id);
        return r.tipo === 'sinal'
          ? { pago: false, sinalPago: true, statusPagamento: 'sinal_pago', status: 'confirmado' }
          : { pago: true, statusPagamento: 'aprovado', status: 'confirmado' };
      }
    } catch {
      /* consulta ao gateway falhou; segue aguardando */
    }
    return { pago: false, statusPagamento: 'aguardando', status: p.status };
  }

  // Webhook do Mercado Pago: confirma o pagamento. Descobre o tenant pelo pedido
  // correlacionado (gateway_payment_id) e consulta o status real no MP.
  async webhookMercadoPago(paymentId: string, xSignature?: string, xRequestId?: string) {
    if (!paymentId) return { ok: true, ignorado: true };
    // Correlaciona primeiro: o webhook chega só com o paymentId; o tenant (e a
    // assinatura secreta DELE) só é conhecido pelo pedido. Payment desconhecido =
    // ignora sem precisar de segredo.
    const [p] = await this.db
      .select({ id: pedidoExterno.id, tenantId: pedidoExterno.tenantId, pago: pedidoExterno.pago })
      .from(pedidoExterno)
      .where(eq(pedidoExterno.gatewayPaymentId, String(paymentId)));
    if (!p) return { ok: true, naoCorrelacionado: true };
    if (p.pago) return { ok: true, jaPago: true };
    // Defesa em profundidade: se ESTA loja cadastrou a assinatura secreta do webhook
    // (Integrações → Mercado Pago), rejeita corpo sem assinatura válida. Sem segredo
    // cadastrado, mantém o comportamento atual — a re-consulta ao gateway é a proteção.
    const webhookSecret = await this.resolveMpWebhookSecret(p.tenantId);
    if (webhookSecret && !assinaturaWebhookMPOk(xSignature, xRequestId, paymentId, webhookSecret)) {
      this.logger.warn(`Webhook MP com assinatura inválida (payment ${paymentId}) — ignorado.`);
      return { ok: true, assinaturaInvalida: true };
    }
    const mpToken = await this.resolveMpToken(p.tenantId);
    if (!mpToken) return { ok: true, semToken: true };
    const st = await consultarPagamentoMP(mpToken, String(paymentId));
    if (st.status === 'approved') {
      await this.aprovarPagamento(p.tenantId, p.id);
      return { ok: true, aprovado: true };
    }
    return { ok: true, status: st.status };
  }

  // Webhook do PagBank (Orders): correlaciona pelo gateway_payment_id (= id do pedido
  // PagBank) e RE-CONSULTA o pedido na API ('PAID' = aprovado). Não confia no corpo.
  async webhookPagBank(orderId: string) {
    if (!orderId) return { ok: true, ignorado: true };
    const [p] = await this.db
      .select({ id: pedidoExterno.id, tenantId: pedidoExterno.tenantId, pago: pedidoExterno.pago })
      .from(pedidoExterno)
      .where(eq(pedidoExterno.gatewayPaymentId, String(orderId)));
    if (!p) return { ok: true, naoCorrelacionado: true };
    if (p.pago) return { ok: true, jaPago: true };
    const token = await this.resolvePagseguroToken(p.tenantId);
    if (!token) return { ok: true, semToken: true };
    const st = await consultarPagamentoPagBank(token, String(orderId));
    if (st.status === 'paid') {
      await this.aprovarPagamento(p.tenantId, p.id);
      return { ok: true, aprovado: true };
    }
    return { ok: true, status: st.status };
  }

  // ===== Reembolso do sinal (S3) =====

  // Estorna o sinal PAGO de uma encomenda cancelada. Idempotente pelo status:
  // só age quando sinal_status='pago'. Sucesso → 'reembolsado'; falha do gateway
  // (ou sem token) → 'reembolso_pendente' (fallback manual do lojista).
  async reembolsarSinal(tenantId: string, pedidoId: string): Promise<{ ok: boolean; manual?: boolean }> {
    const [p] = await this.db
      .select({
        sinalStatus: pedidoExterno.sinalStatus,
        sinalValor: pedidoExterno.sinalValor,
        gatewayPaymentId: pedidoExterno.gatewayPaymentId,
        gatewayProvider: pedidoExterno.gatewayProvider,
      })
      .from(pedidoExterno)
      .where(and(eq(pedidoExterno.id, pedidoId), eq(pedidoExterno.tenantId, tenantId)));
    if (!p || p.sinalStatus !== 'pago') return { ok: false };
    const valor = p.sinalValor != null ? Number(p.sinalValor) : undefined;
    try {
      if (!p.gatewayPaymentId) throw new Error('sem id de pagamento do sinal');
      if (p.gatewayProvider === 'pagseguro') {
        const t = await this.resolvePagseguroToken(tenantId);
        if (!t) throw new Error('sem token PagBank');
        await reembolsarPagamentoPagBank(t, p.gatewayPaymentId, valor);
      } else {
        const t = await this.resolveMpToken(tenantId);
        if (!t) throw new Error('sem token Mercado Pago');
        await reembolsarPagamentoMP(t, p.gatewayPaymentId, valor);
      }
      await this.db
        .update(pedidoExterno)
        .set({ sinalStatus: 'reembolsado' })
        .where(eq(pedidoExterno.id, pedidoId));
      return { ok: true };
    } catch (e) {
      // Fallback manual: marca pendente e leva a falha para a distribuição.
      await this.db
        .update(pedidoExterno)
        .set({ sinalStatus: 'reembolso_pendente' })
        .where(eq(pedidoExterno.id, pedidoId));
      this.logger.error(
        `Reembolso do sinal falhou (pedido ${pedidoId}, tenant ${tenantId}): ${e instanceof Error ? e.message : e}`,
      );
      return { ok: false, manual: true };
    }
  }

  // Cancelamento da loja (delivery.cancelar) dispara este evento → estorna o sinal.
  @OnEvent('encomenda.sinal.reembolsar')
  async onReembolsarSinal(payload: { tenantId: string; pedidoId: string }) {
    if (!payload?.tenantId || !payload?.pedidoId) return;
    await this.reembolsarSinal(payload.tenantId, payload.pedidoId).catch(() => {});
  }

  // Público: o CLIENTE cancela a própria encomenda. Com sinal pago, só dentro do
  // prazo (cancelavel_ate) e com estorno; fora do prazo, bloqueia (sinal não volta).
  // Prova de dono: `clienteToken` (assinado) casando o cliente do pedido; na falta,
  // o `ref` (client_ref). Sem prova → 404 (não vaza/permite cancelar de terceiros).
  async cancelarEncomendaPublico(
    token: string,
    pedidoId: string,
    clienteToken?: string,
    ref?: string,
  ) {
    const cfg = await this.resolver(token);
    const [p] = await this.db
      .select()
      .from(pedidoExterno)
      .where(and(eq(pedidoExterno.id, pedidoId), eq(pedidoExterno.tenantId, cfg.tenantId)));
    if (!p) throw new NotFoundException('Pedido não encontrado.');
    // Autorização: cliente do token bate com o dono do pedido, OU o client_ref bate.
    const cli = verificarCliente(clienteToken);
    const donoPorToken = !!(cli && cli.tenant === cfg.tenantId && p.clienteId && cli.cli === p.clienteId);
    const donoPorRef = !!(ref && p.clientRef && ref === p.clientRef);
    if (!donoPorToken && !donoPorRef)
      throw new NotFoundException('Pedido não encontrado.');
    if (p.status === 'cancelado') return { ok: true, jaCancelado: true };
    if (p.status === 'concluido')
      throw new BadRequestException('Pedido já concluído não pode ser cancelado.');
    if (!p.agendamento)
      throw new BadRequestException('Só encomendas podem ser canceladas por aqui.');
    const temSinalPago = p.sinalStatus === 'pago';
    if (temSinalPago && p.cancelavelAte && Date.now() > new Date(p.cancelavelAte).getTime())
      throw new BadRequestException(
        'O prazo para cancelar com reembolso já passou. Fale com a loja.',
      );
    // Estorna o sinal ANTES de cancelar (para devolver o resultado ao cliente).
    const reembolso = temSinalPago ? await this.reembolsarSinal(cfg.tenantId, pedidoId) : null;
    await this.delivery.cancelarSistema(cfg.tenantId, pedidoId, 'Cancelado pelo cliente (encomenda)');
    return {
      ok: true,
      reembolso: reembolso
        ? reembolso.ok
          ? 'estornado'
          : 'estorno_pendente'
        : null,
    };
  }

  // ===== Notificações de encomenda via n8n (S4) =====

  private fmtDataBR(d: Date | string | null | undefined): string {
    if (!d) return '';
    return new Date(d).toLocaleString('pt-BR', {
      timeZone: 'America/Sao_Paulo',
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  }
  private brlTxt(n: any): string {
    return `R$ ${Number(n || 0).toFixed(2).replace('.', ',')}`;
  }

  // Aviso ao cliente (via webhook n8n → WhatsApp da loja) quando o SINAL é pago:
  // confirma a encomenda e informa o prazo de cancelamento com reembolso.
  private async avisarSinalPago(tenantId: string, pedidoId: string) {
    try {
      const [p] = await this.db
        .select({
          numero: pedidoExterno.numero,
          clienteNome: pedidoExterno.clienteNome,
          clienteTelefone: pedidoExterno.clienteTelefone,
          agendamento: pedidoExterno.agendamento,
          sinalValor: pedidoExterno.sinalValor,
          cancelavelAte: pedidoExterno.cancelavelAte,
          total: pedidoExterno.total,
        })
        .from(pedidoExterno)
        .where(eq(pedidoExterno.id, pedidoId));
      if (!p || !p.clienteTelefone) return;
      const data = this.fmtDataBR(p.agendamento);
      const prazo = this.fmtDataBR(p.cancelavelAte);
      const texto =
        `✅ Encomenda confirmada${data ? ` para ${data}` : ''}! Recebemos seu sinal de ${this.brlTxt(p.sinalValor)}.` +
        (prazo ? ` Você pode cancelar com reembolso até ${prazo}; depois disso o sinal não é reembolsado.` : '');
      await this.delivery.notificarN8n(tenantId, {
        evento: 'encomenda_sinal_pago',
        pedidoId,
        numero: p.numero,
        telefone: p.clienteTelefone,
        cliente: p.clienteNome,
        agendamento: p.agendamento ? new Date(p.agendamento).toISOString() : null,
        sinalValor: p.sinalValor != null ? Number(p.sinalValor) : null,
        cancelavelAte: p.cancelavelAte ? new Date(p.cancelavelAte).toISOString() : null,
        total: Number(p.total),
        texto,
      });
    } catch {
      /* aviso nunca quebra o fluxo */
    }
  }

  // Lembrete de prazo de cancelamento (S4): avisa o cliente quando faltam <= 6h para
  // o `cancelavel_ate` de uma encomenda com sinal PAGO. Idempotente por
  // `avisado_cancelamento_em`. Roda só na nuvem (instância única, sem lock).
  @Cron('*/15 * * * *')
  async lembrarCancelamentoEncomenda() {
    if (ehEdge()) return;
    const agora = new Date();
    const limite = new Date(agora.getTime() + 6 * 3600 * 1000);
    const rows = await this.db
      .select({
        id: pedidoExterno.id,
        tenantId: pedidoExterno.tenantId,
        numero: pedidoExterno.numero,
        clienteNome: pedidoExterno.clienteNome,
        clienteTelefone: pedidoExterno.clienteTelefone,
        agendamento: pedidoExterno.agendamento,
        cancelavelAte: pedidoExterno.cancelavelAte,
        status: pedidoExterno.status,
      })
      .from(pedidoExterno)
      .where(
        and(
          eq(pedidoExterno.sinalStatus, 'pago'),
          isNull(pedidoExterno.avisadoCancelamentoEm),
          gte(pedidoExterno.cancelavelAte, agora),
          lt(pedidoExterno.cancelavelAte, limite),
        ),
      );
    for (const p of rows) {
      // Marca como avisado ANTES (evita reenvio se o webhook demorar/repetir a rodada).
      await this.db
        .update(pedidoExterno)
        .set({ avisadoCancelamentoEm: new Date() })
        .where(eq(pedidoExterno.id, p.id));
      if (p.status === 'cancelado' || p.status === 'concluido' || !p.clienteTelefone) continue;
      const data = this.fmtDataBR(p.agendamento);
      const prazo = this.fmtDataBR(p.cancelavelAte);
      const texto =
        `⏰ Lembrete: sua encomenda${data ? ` de ${data}` : ''}. O prazo para cancelar com reembolso é ${prazo}. ` +
        `Depois disso o sinal não é reembolsável e o pedido não pode ser cancelado.`;
      await this.delivery.notificarN8n(p.tenantId, {
        evento: 'encomenda_lembrete_cancelamento',
        pedidoId: p.id,
        numero: p.numero,
        telefone: p.clienteTelefone,
        cliente: p.clienteNome,
        agendamento: p.agendamento ? new Date(p.agendamento).toISOString() : null,
        cancelavelAte: p.cancelavelAte ? new Date(p.cancelavelAte).toISOString() : null,
        texto,
      });
    }
  }

  // ===== Recorrência leve de encomenda (S5, mig 190) =====

  // Gera a ocorrência de cada recorrência ativa `antecedencia_dias` à frente,
  // reaproveitando o receberPedido (preço + sinal + cliente). Manda o LINK do sinal
  // por WhatsApp (n8n). Idempotente por (recorrencia_id, data). Só na nuvem.
  @Cron('40 5 * * *')
  async gerarEncomendasRecorrentes() {
    if (ehEdge()) return;
    const recs = await this.db
      .select()
      .from(encomendaRecorrencia)
      .where(eq(encomendaRecorrencia.status, 'ativa'));
    for (const rec of recs) {
      try {
        const antec = Math.max(0, Number(rec.antecedenciaDias) || 2);
        const alvo = new Date();
        alvo.setDate(alvo.getDate() + antec);
        const alvoISO = alvo.toISOString().slice(0, 10);
        const dias = Array.isArray(rec.dias) ? (rec.dias as any[]).map(Number) : [];
        if (!dias.includes(alvo.getDay())) continue;
        if (rec.inicio && alvoISO < String(rec.inicio)) continue;
        if (rec.fim && alvoISO > String(rec.fim)) continue;
        // Já gerada para esta data? (idempotência)
        const ex: any = await this.db.execute(sql`
          select 1 from pedido_externo
          where recorrencia_id = ${rec.id}
            and (agendamento at time zone 'America/Sao_Paulo')::date = ${alvoISO}::date
            and status <> 'cancelado' limit 1`);
        if ((ex.rows ?? ex).length) continue;
        const [cfgRow] = await this.db
          .select({ token: cardapioConfig.token })
          .from(cardapioConfig)
          .where(eq(cardapioConfig.tenantId, rec.tenantId))
          .limit(1);
        if (!cfgRow?.token) continue;
        let clienteNome: string | null = null;
        let clienteTel: string | null = null;
        let clienteToken: string | undefined;
        if (rec.clienteId) {
          const [cli] = await this.db
            .select({ nome: cliente.nome, telefone: cliente.telefone })
            .from(cliente)
            .where(eq(cliente.id, rec.clienteId));
          clienteNome = cli?.nome ?? null;
          clienteTel = cli?.telefone ?? null;
          clienteToken = assinarCliente(rec.clienteId, rec.tenantId);
        }
        const end: any = rec.endereco ?? {};
        const dto: any = {
          _sistema: true,
          itens: rec.itens,
          tipo: rec.tipo,
          agendamento: `${alvoISO}T${rec.hora || '12:00'}`,
          cliente: clienteNome ?? undefined,
          telefone: clienteTel ?? undefined,
          clienteToken,
          formaPagamento: rec.formaPagamento ?? undefined,
          ...(rec.tipo === 'entrega'
            ? { rua: end.rua, numero: end.numero, referencia: end.referencia, bairroId: end.bairroId }
            : {}),
        };
        const r: any = await this.receberPedido(cfgRow.token, dto).catch((e) => {
          this.logger.error(`Recorrência ${rec.id}: falha ao gerar ${alvoISO}: ${e?.message ?? e}`);
          return null;
        });
        if (!r?.pedidoId) continue;
        await this.db
          .update(pedidoExterno)
          .set({ recorrenciaId: rec.id })
          .where(eq(pedidoExterno.id, r.pedidoId));
        // Exige sinal → gera o PIX e manda o LINK por WhatsApp (n8n).
        if (r.sinal?.status === 'pendente' && clienteTel) {
          try {
            const pay: any = await this.pagarPedidoPublico(cfgRow.token, r.pedidoId);
            const link = pay?.pix?.ticketUrl || pay?.pix?.qrCode || null;
            const data = this.fmtDataBR(dto.agendamento);
            const texto =
              `🔔 Sua encomenda recorrente de ${data} está reservada! Para confirmar, pague o sinal de ` +
              `${this.brlTxt(r.sinal.valor)}${link ? `: ${link}` : ' pelo app'}.`;
            await this.delivery.notificarN8n(rec.tenantId, {
              evento: 'encomenda_sinal_link',
              pedidoId: r.pedidoId,
              telefone: clienteTel,
              cliente: clienteNome,
              agendamento: dto.agendamento,
              sinalValor: r.sinal.valor,
              ticketUrl: link,
              texto,
            });
          } catch (e) {
            this.logger.error(`Recorrência ${rec.id}: falha ao cobrar sinal: ${e instanceof Error ? e.message : e}`);
          }
        }
      } catch (e) {
        this.logger.error(`Recorrência ${rec.id}: erro geral: ${e instanceof Error ? e.message : e}`);
      }
    }
  }

  // Público: recorrências do cliente (para listar/gerenciar no app do cardápio).
  async recorrenciasDoCliente(token: string, clienteToken?: string) {
    const cfg = await this.resolver(token);
    const cli = verificarCliente(clienteToken);
    if (!cli || cli.tenant !== cfg.tenantId) return [];
    const rows = await this.db
      .select()
      .from(encomendaRecorrencia)
      .where(and(eq(encomendaRecorrencia.tenantId, cfg.tenantId), eq(encomendaRecorrencia.clienteId, cli.cli)))
      .orderBy(desc(encomendaRecorrencia.createdAt));
    return rows
      .filter((r) => r.status !== 'cancelada')
      .map((r) => ({
        id: r.id,
        tipo: r.tipo,
        dias: r.dias,
        hora: r.hora,
        status: r.status,
        itens: Array.isArray(r.itens) ? (r.itens as any[]).length : 0,
        fim: r.fim,
      }));
  }

  // Público: cliente pausa/retoma/cancela a própria recorrência.
  async alterarRecorrenciaCliente(
    token: string,
    id: string,
    clienteToken: string | undefined,
    acao: 'pausar' | 'retomar' | 'cancelar',
  ) {
    const cfg = await this.resolver(token);
    const cli = verificarCliente(clienteToken);
    const [rec] = await this.db
      .select()
      .from(encomendaRecorrencia)
      .where(and(eq(encomendaRecorrencia.id, id), eq(encomendaRecorrencia.tenantId, cfg.tenantId)));
    if (!rec) throw new NotFoundException('Recorrência não encontrada.');
    if (!cli || cli.tenant !== cfg.tenantId || rec.clienteId !== cli.cli)
      throw new NotFoundException('Recorrência não encontrada.');
    const novo =
      acao === 'pausar' ? 'pausada' : acao === 'retomar' ? 'ativa' : acao === 'cancelar' ? 'cancelada' : rec.status;
    await this.db
      .update(encomendaRecorrencia)
      .set({ status: novo })
      .where(eq(encomendaRecorrencia.id, id));
    return { ok: true, status: novo };
  }

  // Pagamento aprovado no gateway (mock/verificar/webhook) → decide se foi o SINAL
  // (encomenda: confirma e deixa o restante p/ a entrega) ou o pagamento TOTAL.
  // Idempotente: sinal já pago não vira pagamento total. Sempre confirma o pedido.
  private async aprovarPagamento(
    tenantId: string,
    pedidoId: string,
  ): Promise<{ tipo: 'sinal' | 'total' | 'nada' }> {
    const [p] = await this.db
      .select({ sinalStatus: pedidoExterno.sinalStatus, pago: pedidoExterno.pago })
      .from(pedidoExterno)
      .where(eq(pedidoExterno.id, pedidoId));
    if (!p) return { tipo: 'nada' };
    if (p.sinalStatus === 'pago') return { tipo: 'nada' }; // já confirmado via sinal
    let tipo: 'sinal' | 'total' | 'nada';
    if (p.sinalStatus === 'pendente') {
      await this.db
        .update(pedidoExterno)
        .set({ sinalStatus: 'pago', statusPagamento: 'sinal_pago' })
        .where(eq(pedidoExterno.id, pedidoId));
      tipo = 'sinal';
      // Confirma ao cliente por WhatsApp (n8n) — sinal pago + prazo de cancelamento.
      void this.avisarSinalPago(tenantId, pedidoId);
    } else if (!p.pago) {
      await this.db
        .update(pedidoExterno)
        .set({ pago: true, statusPagamento: 'aprovado' })
        .where(eq(pedidoExterno.id, pedidoId));
      tipo = 'total';
    } else {
      return { tipo: 'nada' };
    }
    await this.aoConfirmarPagamento(tenantId, pedidoId);
    return { tipo };
  }

  // Pagamento online confirmado → agora sim entra em produção (o pedido esperava em
  // 'novo'). Respeita autoKds e o modo edge (lá o edge processa o pedido já pago).
  private async aoConfirmarPagamento(tenantId: string, pedidoId: string) {
    try {
      const [row] = await this.db
        .select({ status: pedidoExterno.status })
        .from(pedidoExterno)
        .where(eq(pedidoExterno.id, pedidoId));
      if (!row || row.status !== 'novo') return; // já aceito/cancelado
      const [cfg] = await this.db
        .select({ autoKds: cardapioConfig.autoKds })
        .from(cardapioConfig)
        .where(eq(cardapioConfig.tenantId, tenantId))
        .limit(1);
      if (cfg?.autoKds === false) return; // loja aceita manualmente
      if (!ehEdge() && (await this.lojaComEdgeAtivo(tenantId))) return; // edge processa
      await this.delivery.aceitar(tenantId, null, pedidoId);
    } catch {
      /* pagamento confirmado nunca falha por causa da produção */
    }
  }

  // A cada 2 min: cancela pedidos de pagamento ONLINE que passaram do prazo (10 min)
  // sem pagar — evita produção/desperdício. Só na NUVEM (onde os webhooks chegam) e
  // cancela também a cobrança no gateway (impede pagamento tardio).
  @Cron('*/2 * * * *')
  async expirarPixNaoPagos() {
    if (ehEdge()) return;
    const limite = new Date(Date.now() - 10 * 60 * 1000);
    const vencidos = await this.db
      .select({
        id: pedidoExterno.id,
        tenantId: pedidoExterno.tenantId,
        gatewayProvider: pedidoExterno.gatewayProvider,
        gatewayPaymentId: pedidoExterno.gatewayPaymentId,
      })
      .from(pedidoExterno)
      .where(
        and(
          eq(pedidoExterno.status, 'novo'),
          eq(pedidoExterno.statusPagamento, 'aguardando'),
          lt(pedidoExterno.criadoEm, limite),
        ),
      );
    for (const v of vencidos) {
      try {
        if (v.gatewayPaymentId && v.gatewayProvider === 'mercadopago') {
          const t = await this.resolveMpToken(v.tenantId);
          if (t) await cancelarPagamentoMP(t, v.gatewayPaymentId);
        }
      } catch {
        /* segue e cancela o pedido de qualquer forma */
      }
      await this.delivery
        .cancelarSistema(v.tenantId, v.id, 'Pagamento PIX não recebido no prazo (10 min)')
        .catch(() => {});
    }
  }

  // Resolve as opções escolhidas (por id) para UM produto. Preço SEMPRE do banco.
  // Valida no SERVIDOR (não confia no front):
  //   • a opção pertence a um grupo/etapa DESTE produto;
  //   • min/max/obrigatório de cada etapa são respeitados.
  // Opção INFORMATIVA (sem código PDV) entra como observação: não soma preço.
  private async resolverOpcoes(tenantId: string, produtoId: string, opcaoIds: string[]) {
    // MANTÉM repetições: a mesma opção pode vir N vezes quando o grupo é
    // 'varias_com_repeticao' (ex.: 3× Bacon). Onde a regra não permite, a
    // quantidade é travada em 1 mais abaixo.
    const brutas = (opcaoIds ?? []).filter(Boolean);
    const distintas = [...new Set(brutas)];
    // Etapas do produto + opções (o motor materializado é a fonte da verdade).
    const grupos = await this.db
      .select({
        id: complementoGrupo.id,
        nome: complementoGrupo.nome,
        min: complementoGrupo.min,
        max: complementoGrupo.max,
        obrigatorio: complementoGrupo.obrigatorio,
        origemComplementoId: complementoGrupo.origemComplementoId,
      })
      .from(complementoGrupo)
      .where(
        and(
          eq(complementoGrupo.tenantId, tenantId),
          eq(complementoGrupo.produtoId, produtoId),
          isNull(complementoGrupo.deletedAt),
        ),
      );
    const ops = grupos.length
      ? await this.db
          .select({
            id: complementoOpcao.id,
            grupoId: complementoOpcao.grupoId,
            nome: complementoOpcao.nome,
            precoDelta: complementoOpcao.precoDelta,
            codigoPdv: complementoOpcao.codigoPdv,
          })
          .from(complementoOpcao)
          .where(
            and(
              eq(complementoOpcao.tenantId, tenantId),
              inArray(
                complementoOpcao.grupoId,
                grupos.map((g) => g.id),
              ),
              isNull(complementoOpcao.deletedAt),
            ),
          )
      : [];
    const porId = new Map(ops.map((o) => [o.id, o]));

    // Regra por grupo: `complemento_grupo` não guarda `regra` — vem do complemento
    // reutilizável de origem (materializado). Sem origem, deriva do max.
    const origemIds = [...new Set(grupos.map((g) => g.origemComplementoId).filter(Boolean))] as string[];
    const compRegras = origemIds.length
      ? await this.db
          .select({ id: complemento.id, regra: complemento.regra })
          .from(complemento)
          .where(and(eq(complemento.tenantId, tenantId), inArray(complemento.id, origemIds)))
      : [];
    const regraPorOrigem = new Map(compRegras.map((c) => [c.id, c.regra]));
    const regraDoGrupoId = new Map(
      grupos.map((g) => [
        g.id,
        (g.origemComplementoId && regraPorOrigem.get(g.origemComplementoId)) || (g.max === 1 ? 'uma' : 'varias_sem_repeticao'),
      ]),
    );
    const regraDe = (id: string) => regraDoGrupoId.get(porId.get(id)?.grupoId ?? '');

    // 1) Pertencimento: toda opção escolhida tem de ser deste produto.
    const invalida = distintas.find((id) => !porId.has(id));
    if (invalida) throw new BadRequestException('Opção inválida para este produto.');

    // Quantidade por opção (conta repetições). Fora de 'varias_com_repeticao' a
    // quantidade é travada em 1 — repetição só vale onde a loja liberou.
    const qtdPorOpcao = new Map<string, number>();
    for (const id of brutas) qtdPorOpcao.set(id, (qtdPorOpcao.get(id) ?? 0) + 1);
    for (const [id, q] of qtdPorOpcao) {
      if (q > 1 && regraDe(id) !== 'varias_com_repeticao') qtdPorOpcao.set(id, 1);
    }

    // 2) Obrigatoriedade por etapa (min/max = SOMA das quantidades no grupo).
    for (const g of grupos) {
      const n = [...qtdPorOpcao.entries()]
        .filter(([id]) => porId.get(id)!.grupoId === g.id)
        .reduce((s, [, q]) => s + q, 0);
      const min = g.obrigatorio ? Math.max(1, g.min ?? 1) : g.min ?? 0;
      if (n < min) {
        throw new BadRequestException(
          `Escolha ${min === 1 ? 'uma opção' : `pelo menos ${min} opções`} em "${g.nome}".`,
        );
      }
      if (g.max != null && n > g.max) {
        throw new BadRequestException(`Escolha no máximo ${g.max} em "${g.nome}".`);
      }
    }

    let precoDelta = 0;
    const labels: string[] = [];
    for (const [id, q] of qtdPorOpcao) {
      const o = porId.get(id)!;
      // Informativa (sem código PDV) não altera o preço.
      if ((o.codigoPdv ?? '').trim()) precoDelta += Number(o.precoDelta) * q;
      labels.push(q > 1 ? `${q}x ${o.nome}` : o.nome);
    }
    return { precoDelta, labels };
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
      // Sinal da encomenda (mig 188): o front mostra "pague o sinal" + o prazo.
      sinal:
        row.sinalStatus && row.sinalStatus !== 'nao'
          ? {
              status: row.sinalStatus,
              valor: row.sinalValor != null ? Number(row.sinalValor) : null,
              pct: row.sinalPct != null ? Number(row.sinalPct) : null,
              cancelavelAte: row.cancelavelAte ? new Date(row.cancelavelAte).toISOString() : null,
            }
          : null,
      clienteToken: row.clienteId ? assinarCliente(row.clienteId, cfg.tenantId) : undefined,
      reenvio: true, // sinaliza ao front que é o mesmo pedido (não duplicou)
    };
  }

  // A loja está operando em MODO LOCAL? = tem um servidor edge com heartbeat recente
  // (últimos ~3 min). Usado pela nuvem para adiar a materialização e deixar o edge
  // processar o pedido online localmente.
  private async lojaComEdgeAtivo(tenantId: string): Promise<boolean> {
    const limite = new Date(Date.now() - 3 * 60 * 1000);
    const [hb] = await this.db
      .select({ id: edgeHeartbeat.id })
      .from(edgeHeartbeat)
      .where(and(eq(edgeHeartbeat.tenantId, tenantId), gte(edgeHeartbeat.recebidoEm, limite)))
      .limit(1);
    return !!hb;
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
      // Recorrência leve da encomenda (mig 190): repete nos dias da semana.
      recorrencia?: { dias: number[]; hora?: string; ate?: string; antecedenciaDias?: number };
      _sistema?: boolean; // uso interno: ocorrência gerada pelo cron (pula validações)
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
    // Loja fechada (para o TIPO do pedido): bloqueia (pedidos agendados passam).
    if (!dto.agendamento && !this.estaAberta(cfg, dto.tipo))
      throw new BadRequestException('A loja está fechada no momento. Volte no horário de funcionamento.');

    // Encomenda (mig 186): para food/varejo, `agendamento` = pedido para data
    // FUTURA e só vale se a loja liga o modo Encomenda, dentro das regras. Serviços
    // mantém o agendamento de HORÁRIO (consulta/atendimento), sem essas regras.
    const ehEncomenda = !!dto.agendamento && cfg.ramo !== 'servicos';
    // Sinal aplicável (mig 187/188): resolvido pela quantidade de itens. Preenchido
    // dentro do bloco de encomenda; usado depois para forçar cobrança e gravar prazo.
    let sinalRule: { exigeSinal: boolean; sinalPct: number; cancelHoras: number | null } | null = null;
    if (ehEncomenda) {
      // Ocorrência gerada pelo sistema (recorrência, mig 190) PULA as validações de
      // prazo/horizonte/corte/capacidade — a data já foi combinada na assinatura.
      if (!(dto as any)._sistema) {
        const regras = this.regrasEncomenda(cfg);
        if (!regras.ativa)
          throw new BadRequestException('Esta loja não aceita encomendas.');
        const quando = new Date(dto.agendamento as string); // data+hora escolhida
        if (isNaN(quando.getTime()))
          throw new BadRequestException('Data/hora da encomenda inválida.');
        const agora = new Date();
        // Antecedência em HORAS (permite mesmo dia mais tarde). 1 min de folga.
        const minMs = agora.getTime() + regras.antecedenciaHoras * 3600_000;
        if (quando.getTime() < minMs - 60_000)
          throw new BadRequestException(
            `A encomenda precisa de ao menos ${regras.antecedenciaHoras}h de antecedência.`,
          );
        const maxDia = new Date(agora);
        maxDia.setDate(maxDia.getDate() + regras.horizonteDias);
        maxDia.setHours(23, 59, 59, 999);
        if (quando.getTime() > maxDia.getTime())
          throw new BadRequestException(
            `A encomenda pode ser feita com no máximo ${regras.horizonteDias} dias de antecedência.`,
          );
        // Corte (opcional): encomenda para HOJE só até o horário de corte.
        const mesmoDia = quando.toDateString() === agora.toDateString();
        if (regras.corte && mesmoDia) {
          const [hh, mm] = regras.corte.split(':').map((x) => Number(x) || 0);
          if (agora.getHours() > hh || (agora.getHours() === hh && agora.getMinutes() >= mm))
            throw new BadRequestException(
              `As encomendas para hoje encerraram (após ${regras.corte}). Escolha outro dia.`,
            );
        }
        if (regras.capacidadeDia != null) {
          const dataPedido = String(dto.agendamento).slice(0, 10); // YYYY-MM-DD escolhido
          const usados = await this.contarEncomendasNaData(cfg.tenantId, cfg.unidadeId, dataPedido);
          if (usados >= regras.capacidadeDia)
            throw new BadRequestException('As encomendas para esta data esgotaram. Escolha outra data.');
        }
      }
      // Sinal (mig 187/188): resolve pela quantidade TOTAL de itens do pedido.
      const qtdItens = dto.itens.reduce((s, it) => s + (Number(it.quantidade) || 1), 0);
      const regrasSinal = await this.regrasSinalDe(cfg.tenantId, cfg.unidadeId);
      sinalRule = this.resolverSinal(cfg, regrasSinal, qtdItens);
    }
    const ids = [...new Set(dto.itens.map((i) => i.produtoId))];
    const prods = await this.db
      .select({
        id: produto.id,
        nome: produto.nome,
        precoVenda: produto.precoVenda,
        precoPromocional: produto.precoPromocional,
        ativo: produto.ativo,
        disponivelCardapio: produto.disponivelCardapio,
        atacadoAtivo: produto.atacadoAtivo,
      })
      .from(produto)
      .where(and(eq(produto.tenantId, cfg.tenantId), inArray(produto.id, ids)));
    const porId = new Map(prods.map((p) => [p.id, p]));
    // Faixas de atacado (mig 184) para aplicar o desconto por quantidade na linha.
    const faixasAtacado = await this.faixasAtacadoPorProduto(cfg.tenantId, ids);
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
      const { precoDelta, labels } = await this.resolverOpcoes(
        cfg.tenantId,
        it.produtoId,
        it.complementos ?? [],
      );
      const qtd = Number(it.quantidade) || 1;
      let preco = base + precoDelta;
      // Atacado por volume (mig 184): aplica a faixa "a partir de N un" sobre o
      // preço unitário da linha antes de somar o subtotal (base de cupom/cashback).
      if (p.atacadoAtivo) preco = precoComAtacado(preco, faixasAtacado.get(p.id), qtd);
      totalCent += paraCentavos(preco) * qtd;
      itensOut.push({
        produtoId: it.produtoId,
        variacaoId: it.variacaoId,
        descricao: labels.length ? `${desc} (${labels.join(', ')})` : desc,
        quantidade: qtd,
        precoUnitario: preco,
        observacao: it.observacao,
        opcaoIds: it.complementos ?? [], // ids das opções → roteamento por opção/etapa (Fase 1)
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
    const avisos: string[] = [];
    // ── Prêmio de fidelidade (resgate) — avaliado ANTES do cupom p/ aplicar as regras.
    let premio: any = cfg.fidelidadeAtiva
      ? await this.fidelidade.avaliarPremio(cfg.tenantId, dto.resgateId, dto.telefone ?? '', itensOut, total)
      : { desconto: 0 };
    // Regra: em ENTREGA o resgate exige o PEDIDO MÍNIMO em ITENS (a taxa não conta).
    if ((premio.desconto || 0) > 0 && tipo === 'entrega' && cfg.pedidoMinimo != null) {
      const minimo = Number(cfg.pedidoMinimo) || 0;
      if (total < minimo) {
        premio = { desconto: 0 };
        avisos.push(
          `O resgate da fidelidade exige pedido mínimo de R$ ${minimo.toFixed(2)} em itens ` +
            `(a taxa de entrega não conta). Complete o mínimo para usar o resgate.`,
        );
      }
    }
    const temResgate = (premio.desconto || 0) > 0;

    // ── Cashback (PREVIEW) sobre o que sobra após o prêmio — base p/ a regra do cupom.
    const baseCashbackPrev = Math.max(
      0,
      paraReais(somarCentavos(totalCent, -paraCentavos(premio.desconto || 0))),
    );
    const cbPrev =
      dto.usarCashback === false
        ? { saldoUsado: 0 }
        : await this.cashback.avaliarDescontos(cfg.tenantId, dto.telefone ?? '', baseCashbackPrev);
    const cashbackUsadoCent = paraCentavos(cbPrev.saldoUsado || 0);

    // ── Cupom — com as regras configuráveis de empilhamento.
    let cup: any = await this.avaliarCupom(cfg.tenantId, dto.cupom ?? '', total, {
      telefone: dto.telefone,
    });
    if (cup.valido && cfg.cupomBloqueiaComResgate && temResgate) {
      avisos.push('Cupom não pode ser usado em pedido com resgate de fidelidade.');
      cup = { valido: false, desconto: 0, freteGratis: false };
    } else if (
      cup.valido &&
      cfg.cupomMaxCashbackCent != null &&
      cashbackUsadoCent > Number(cfg.cupomMaxCashbackCent)
    ) {
      avisos.push(
        `Cupom não permitido: o cashback usado (R$ ${(cashbackUsadoCent / 100).toFixed(2)}) passa do ` +
          `limite de R$ ${(Number(cfg.cupomMaxCashbackCent) / 100).toFixed(2)} definido pela loja.`,
      );
      cup = { valido: false, desconto: 0, freteGratis: false };
    }

    // ── Descontos acumulados em CENTAVOS: cupom → prêmio → cashback (sem drift).
    let descontoCent = cup.valido ? paraCentavos(cup.desconto) : 0;
    if (cup.valido && cup.freteGratis) taxa = 0; // cupom de frete grátis zera a entrega
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
    // Trava contábil: o desconto total nunca passa do subtotal dos itens.
    if (descontoCent > totalCent) descontoCent = totalCent;
    const desconto = paraReais(descontoCent); // reais na fronteira (gravação/resposta)
    // Indústria (B2B): pedido é ORÇAMENTO — sem cobrança online, fatura por CNPJ.
    const orcamento = cfg.ramo === 'industria';
    // Sem forma escolhida = "pagar na entrega, a combinar" (NÃO 'entrega', que é o
    // tipo de entrega e vazava no campo de pagamento).
    const forma = orcamento ? 'faturamento' : dto.formaPagamento ?? 'a_combinar';
    // Encomenda com sinal (mig 188): força pagamento online do sinal (aguardando).
    const exigeSinal = !!(sinalRule && sinalRule.exigeSinal && (Number(sinalRule.sinalPct) || 0) > 0);
    const online = !orcamento && (forma === 'pix' || forma === 'cartao' || exigeSinal);
    const grande = paraReais(Math.max(0, somarCentavos(totalCent, -descontoCent, paraCentavos(taxa))));

    // Senha PRÓPRIA do cardápio — contador ATÔMICO por tenant/canal. O upsert
    // "on conflict do update ... returning" serializa no banco: dois pedidos
    // simultâneos nunca recebem a mesma senha (corrige a colisão do count(*)+1).
    const seq: any = await this.db.execute(sql`
      insert into cardapio_senha_seq (tenant_id, canal, ultimo) values (${cfg.tenantId}, 'cardapio', 1)
      on conflict (tenant_id, canal) do update set ultimo = cardapio_senha_seq.ultimo + 1
      returning ultimo
    `);
    const senhaCardapio = String((seq.rows ?? seq)[0]?.ultimo ?? 1);

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
        retiradaTipo: ehEncomenda ? 'encomenda' : undefined,
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

    // Sinal da encomenda (mig 188): grava % / valor / prazo de cancelamento. O
    // pedido já nasce 'aguardando' (via `online`); a cobrança do sinal é o pagar.
    if (exigeSinal && ped?.id && sinalRule) {
      const pct = Number(sinalRule.sinalPct) || 0;
      const sinalValor = Math.round(grande * (pct / 100) * 100) / 100;
      const cancelavelAte =
        sinalRule.cancelHoras != null
          ? new Date(new Date(dto.agendamento as string).getTime() - sinalRule.cancelHoras * 3600_000)
          : null;
      await this.db
        .update(pedidoExterno)
        .set({
          sinalPct: String(pct),
          sinalValor: sinalValor.toFixed(2),
          sinalStatus: 'pendente',
          cancelavelAte,
        })
        .where(eq(pedidoExterno.id, ped.id));
    }

    // Recorrência leve (mig 190): guarda o molde e liga este pedido como a 1ª
    // ocorrência (o cron não a regera porque já existe pedido com recorrencia_id).
    if (ehEncomenda && dto.recorrencia?.dias?.length && ped?.id) {
      const hora = dto.recorrencia.hora || String(dto.agendamento).slice(11, 16) || '12:00';
      const [rec] = await this.db
        .insert(encomendaRecorrencia)
        .values({
          tenantId: cfg.tenantId,
          unidadeId: cfg.unidadeId ?? null,
          clienteId: clienteId ?? null,
          tipo,
          endereco:
            tipo === 'entrega'
              ? { rua: dto.rua, numero: dto.numero, referencia: dto.referencia, bairroId: dto.bairroId, bairroNome }
              : null,
          formaPagamento: forma,
          itens: dto.itens as any,
          dias: [...new Set((dto.recorrencia.dias || []).map((d) => Number(d)).filter((d) => d >= 0 && d <= 6))],
          hora,
          inicio: String(dto.agendamento).slice(0, 10),
          fim: dto.recorrencia.ate || null,
          antecedenciaDias: Math.max(0, Math.floor(Number(dto.recorrencia.antecedenciaDias) || 2)),
        })
        .returning();
      if (rec?.id)
        await this.db
          .update(pedidoExterno)
          .set({ recorrenciaId: rec.id })
          .where(eq(pedidoExterno.id, ped.id));
    }

    const clienteTokenOut = clienteId
      ? assinarCliente(clienteId, cfg.tenantId)
      : dto.clienteToken;

    // Envio automático ao KDS: aceita o pedido na hora (cria comanda + produção
    // com senha local + selo da plataforma). Orçamento (indústria) não produz.
    // P1: se a loja tem servidor EDGE ativo (modo local), a NUVEM NÃO materializa —
    // deixa o pedido em 'novo' para DESCER pelo sync e o edge processá-lo localmente
    // (o processador do edge chama aceitar lá). No próprio edge (EDGE_MODE) sempre aceita.
    // Pagamento ONLINE (pix/cartão): NÃO entra em produção agora — fica 'novo'
    // aguardando a confirmação do pagamento (webhook). Sem isso, produzia antes de
    // pagar (desperdício). O webhook chama aoConfirmarPagamento() → aceita aí.
    const deferirParaEdge = !ehEdge() && (await this.lojaComEdgeAtivo(cfg.tenantId));
    if (cfg.autoKds !== false && !orcamento && !online && (ped as any)?.status === 'novo' && !deferirParaEdge) {
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

    // Fidelidade (L5): pontua os planos que o pedido atende (dedupe por pedido),
    // respeitando o intervalo mínimo entre pedidos (config da loja, padrão 3h).
    let fidelidade: any;
    if (cfg.fidelidadeAtiva && dto.telefone && ped?.id) {
      try {
        fidelidade = await this.fidelidade.pontuarPedido(
          cfg.tenantId,
          {
            telefone: dto.telefone,
            clienteId: clienteId ?? undefined,
            nome: dto.cliente,
            pedidoId: ped.id,
            produtoIds: ids,
          },
          cfg.fidelidadeIntervaloHoras ?? 3,
        );
        if (fidelidade?.aguardeIntervalo) {
          avisos.push(
            `Este pedido não pontuou na fidelidade: aguarde ao menos ` +
              `${fidelidade.intervaloHoras ?? cfg.fidelidadeIntervaloHoras ?? 3}h entre pedidos para acumular pontos.`,
          );
        }
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
      // Sinal da encomenda (mig 188): valor a pagar agora + prazo de cancelamento.
      sinal:
        exigeSinal && sinalRule
          ? {
              status: 'pendente',
              pct: Number(sinalRule.sinalPct) || 0,
              valor: Math.round(grande * ((Number(sinalRule.sinalPct) || 0) / 100) * 100) / 100,
              cancelavelAte:
                sinalRule.cancelHoras != null
                  ? new Date(new Date(dto.agendamento as string).getTime() - sinalRule.cancelHoras * 3600_000).toISOString()
                  : null,
            }
          : null,
      pontos: fidelidade?.pontosGanhos ?? undefined,
      fidelidade: fidelidade ?? null,
      premioAplicado: (premio as any).desconto > 0 ? { plano: (premio as any).plano, desconto: (premio as any).desconto } : null,
      avisos, // mensagens informativas (regras de cupom/resgate/pontuação) p/ o cliente
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
  // Exige clienteToken (prova de dono) — não expõe saldo por telefone chutável.
  async pontosPublico(token: string, clienteToken?: string) {
    const cfg = await this.resolver(token);
    if (!cfg.fidelidadeAtiva) return { ativo: false, planos: [], resgates: [] };
    const telefone = await this.telefoneDoTokenCliente(cfg.tenantId, clienteToken);
    if (!telefone) return { ativo: true, planos: [], resgates: [] };
    return { ativo: true, ...(await this.fidelidade.statusCliente(cfg.tenantId, telefone)) };
  }

  // Público: resgata um prêmio de fidelidade — só o DONO do token (não por telefone).
  async resgatarFidelidade(token: string, resgateId: string, clienteToken?: string) {
    const cfg = await this.resolver(token);
    const telefone = await this.telefoneDoTokenCliente(cfg.tenantId, clienteToken);
    if (!telefone) throw new BadRequestException('Identifique-se para resgatar.');
    return this.fidelidade.resgatar(cfg.tenantId, resgateId, telefone);
  }

  // Público: prêmios já resgatados, prontos para abater no próximo pedido.
  async premiosFidelidade(token: string, clienteToken?: string) {
    const cfg = await this.resolver(token);
    if (!cfg.fidelidadeAtiva) return [];
    const telefone = await this.telefoneDoTokenCliente(cfg.tenantId, clienteToken);
    if (!telefone) return [];
    return this.fidelidade.premiosParaUsar(cfg.tenantId, telefone);
  }

  // Público: saldo de cashback do cliente (valor, pontos, vales, planos).
  async cashbackSaldoPublico(token: string, clienteToken?: string) {
    const cfg = await this.resolver(token);
    const telefone = await this.telefoneDoTokenCliente(cfg.tenantId, clienteToken);
    if (!telefone) return { valor: 0, pontos: 0, vales: [], planos: [] };
    return this.cashback.saldoCliente(cfg.tenantId, telefone);
  }

  // Público: troca pontos de cashback por um produto — só o DONO do token.
  async cashbackResgatarProduto(token: string, clienteToken: string | undefined, produtoId: string) {
    const cfg = await this.resolver(token);
    const telefone = await this.telefoneDoTokenCliente(cfg.tenantId, clienteToken);
    if (!telefone) throw new BadRequestException('Identifique-se para resgatar.');
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
