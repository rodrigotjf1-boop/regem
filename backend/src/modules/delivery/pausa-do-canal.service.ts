import { BadRequestException, Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { sql, type SQL } from 'drizzle-orm';
import { DRIZZLE, type DrizzleDB } from '../../db/drizzle.module';
import type { AuthUser } from '../../auth/auth-user';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { idPausaDoCanal } from '../../common/id-deterministico';
import { exigirBooleano } from '../../common/exigir';
import { ehServidorLocal } from '../../common/modo';
import { PausaNosCanaisService, type CanaisExternos, type CanalExterno } from './pausa-nos-canais.service';
import {
  ateDa99,
  ateDoCardapio,
  ateEstendido,
  ateEstendidoDa99,
  TEMPOS_DA_99,
  AVISO_MINUTOS,
  avisoDaLinha,
  lerAjusteDaPausa,
  lerMensagemDaPausa,
  MENSAGEM_DA_PAUSA_MAX,
  MENSAGEM_DA_PAUSA_PADRAO,
  MINUTOS_PARA_ESTENDER,
  SONS_DA_PAUSA,
  type AvisoDaPausa,
  CANAIS_DA_PAUSA,
  ehCanalDaPausa,
  lerMotivo,
  MOTIVOS,
  MOTIVOS_DA_PAUSA,
  MOTIVO_TEXTO_MAX,
  NOME_DO_CANAL,
  pausaDaLinha,
  TEMPOS_DO_CARDAPIO,
  type CanalDaPausa,
  type PausaVigente,
} from '../../common/pausa-do-canal';

/** Um canal no "⏸ Pausar" do painel: se dá para pausar daqui e a pausa que vale agora. */
export type CanalNoPainel = {
  canal: CanalDaPausa;
  nome: string;
  /**
   * Dá para pausar este canal pelo Regem: o cardápio digital sempre que a loja tem cardápio; o iFood e a 99 (F5) quando a
   * empresa tem o canal ligado para esta loja (`PausaNosCanaisService.canaisExternos`).
   */
  disponivel: boolean;
  /** Por que não dá (quando a tela tem o que dizer: "escolha a loja", "sem conexão com a nuvem"). */
  motivo?: string | null;
  pausa: PausaVigente | null;
};

/** Quanto tempo o servidor da loja guarda a resposta da nuvem sobre o iFood e a 99 (e a falha, menos). */
const CACHE_EXTERNOS_MS = 60_000;
const CACHE_EXTERNOS_FALHA_MS = 15_000;
const CANAIS_EXTERNOS = ['ifood', 'food99'] as const;
const ehExterno = (c: CanalDaPausa): c is 'ifood' | 'food99' => c === 'ifood' || c === 'food99';

/**
 * A pausa dos pedidos por canal e por loja (mig 392; protótipo `mockups/regem-pausa.html`). Quem pausa: o gestor, no
 * painel do Delivery. A pausa do cardápio digital fecha o cardápio online de verdade (`CardapioService.menu` e
 * `receberPedido` leem `pausaVigenteDoCanal`) e o atendente fica sabendo pelo `resumoDaLoja`. Cada pausa e cada reabertura
 * vão para a auditoria.
 *
 * A LOJA da pausa é a do cardápio que atende a loja em uso — o dela, ou o da empresa toda (sem loja, o caso de hoje). Assim
 * a pausa feita com a loja escolhida no topo vale para o cardápio que o cliente abre (V86).
 */
@Injectable()
export class PausaDoCanalService {
  private readonly log = new Logger('PausaDoCanal');
  /** Servidor da loja: a resposta da nuvem sobre o iFood e a 99, por empresa e loja. */
  private readonly cacheExternos = new Map<string, { ate: number; dados: Promise<CanaisExternos> }>();
  /** O fetch da rota da nuvem (servidor da loja) — os testes trocam por um falso. */
  buscar: typeof fetch = (url, init) => fetch(url, init);

  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly auditoria: AuditoriaService,
    // F5: a rotina que leva a pausa ao iFood e à 99 (e diz se dá para pausá-los). Opcional: os testes da F1–F4 não a montam.
    @Optional() private readonly nosCanais?: PausaNosCanaisService,
  ) {}

  /**
   * O iFood e a 99 na loja em uso (F5). Na nuvem: a própria rotina responde. No servidor da loja (sem as credenciais dos
   * canais): pergunta à nuvem pela rota da loja, com o token do sync, guardando por 1 min (V37); sem a nuvem, os dois ficam
   * indisponíveis com o motivo escrito — "não li" não vira "não tem".
   */
  async canaisExternosDaLoja(tenantId: string, unidadeAtual: string | null): Promise<CanaisExternos> {
    if (!ehServidorLocal()) {
      if (!this.nosCanais) return semExternos(null);
      return this.nosCanais.canaisExternos(tenantId, unidadeAtual);
    }
    const chave = `${tenantId}|${unidadeAtual ?? ''}`;
    const agora = Date.now();
    const c = this.cacheExternos.get(chave);
    if (c && c.ate > agora) return c.dados;
    const dados = this.externosDaNuvem(tenantId, unidadeAtual);
    const item = { ate: agora + CACHE_EXTERNOS_MS, dados };
    this.cacheExternos.set(chave, item);
    dados.then(
      (d) => {
        if (d.ifood.motivo === SEM_NUVEM) item.ate = Date.now() + CACHE_EXTERNOS_FALHA_MS;
      },
      () => undefined,
    );
    return dados;
  }

  /** Nunca rejeita: a falha vira "sem conexão com a nuvem" nos dois canais, com o motivo no log. */
  private async externosDaNuvem(tenantId: string, unidadeAtual: string | null): Promise<CanaisExternos> {
    const nuvem = String(process.env.CLOUD_API ?? '').replace(/\/$/, '');
    const token = process.env.SYNC_TOKEN ?? '';
    if (!nuvem || !token) {
      this.log.warn('iFood e 99 no "Pausar": sem CLOUD_API/SYNC_TOKEN neste servidor da loja');
      return semExternos(SEM_NUVEM);
    }
    try {
      const q = unidadeAtual ? `?unidade=${encodeURIComponent(unidadeAtual)}` : '';
      const r = await this.buscar(`${nuvem}/delivery/pausas/canais/loja${q}`, {
        headers: { 'x-sync-token': token },
        signal: AbortSignal.timeout(8_000),
      });
      if (!r.ok) throw new Error(`a nuvem respondeu ${r.status}`);
      const j: any = await r.json();
      // A nuvem responde pela empresa do TOKEN: outra empresa (servidor reaproveitado) não mostra nada de ninguém.
      if (j?.tenantId !== tenantId) return semExternos(null);
      return { ifood: externoLido(j?.ifood), food99: externoLido(j?.food99) };
    } catch (e: any) {
      this.log.warn(`iFood e 99 no "Pausar" sem a nuvem (${e?.message ?? e}) — o diálogo mostra "sem conexão"`);
      return semExternos(SEM_NUVEM);
    }
  }

  /** A loja da pausa de um canal: a do cardápio (cardápio digital) ou a da integração (iFood, 99). */
  private async lojaDoCanal(
    tenantId: string,
    unidadeAtual: string | null,
    canal: CanalDaPausa,
    externos?: CanaisExternos,
  ): Promise<string | null> {
    if (!ehExterno(canal)) return (await this.lojaDoCardapio(tenantId, unidadeAtual)).unidadeId;
    const e = (externos ?? (await this.canaisExternosDaLoja(tenantId, unidadeAtual)))[canal];
    return e.disponivel ? e.unidadeId : unidadeAtual;
  }

  /** Depois de mudar uma pausa do iFood ou da 99 na nuvem: a rotina leva ao canal já (no servidor da loja, o sync leva). */
  private levarAosCanais(canais: readonly CanalDaPausa[]) {
    if (canais.some(ehExterno) && !ehServidorLocal()) void this.nosCanais?.acordar();
  }

  /**
   * A loja do cardápio digital da loja em uso. Com uma loja escolhida: o cardápio dela, senão o da empresa toda. Sem loja
   * escolhida (todas, ou a rede de uma loja só): o da empresa toda; sem ele, o único cardápio de loja; com mais de um,
   * a loja tem de ser escolhida (uma pausa da rede inteira não é o que o botão diz).
   */
  async lojaDoCardapio(tenantId: string, unidadeAtual: string | null): Promise<{ tem: boolean; unidadeId: string | null }> {
    const r: any = await this.db.execute(sql`
      select distinct unidade_id from cardapio_config
       where tenant_id = ${tenantId}::uuid
         and (${unidadeAtual}::uuid is null or unidade_id is null or unidade_id = ${unidadeAtual}::uuid)`);
    const lojas: (string | null)[] = (r.rows ?? r).map((x: any) => x.unidade_id ?? null);
    if (!lojas.length) return { tem: false, unidadeId: null };
    if (unidadeAtual && lojas.includes(unidadeAtual)) return { tem: true, unidadeId: unidadeAtual };
    if (lojas.includes(null)) return { tem: true, unidadeId: null };
    if (lojas.length === 1) return { tem: true, unidadeId: lojas[0] };
    throw new BadRequestException('Escolha a loja no topo da tela para pausar o cardápio digital dela.');
  }

  /** Os canais do painel, com a pausa que vale agora em cada um. Os motivos e os tempos vão junto (a tela não os repete). */
  async estado(tenantId: string, unidadeAtual: string | null, agora: Date = new Date()) {
    const loja = await this.lojaDoCardapio(tenantId, unidadeAtual).catch((e) => {
      if (e instanceof BadRequestException) return { tem: true, unidadeId: undefined as string | null | undefined };
      throw e;
    });
    const externos = await this.canaisExternosDaLoja(tenantId, unidadeAtual);
    // `to_jsonb` nas colunas da F5: um servidor de loja ainda sem a 392 inteira não derruba o painel.
    const r: any = await this.db.execute(sql`
      select canal, unidade_id, ate, motivo, motivo_texto, pausado_em, pausado_por_nome,
             to_jsonb(p) ->> 'externo_situacao' as externo_situacao, to_jsonb(p) ->> 'externo_erro' as externo_erro
        from pausa_canal p
       where tenant_id = ${tenantId}::uuid and ate > ${agora.toISOString()}::timestamptz
       order by ate desc`);
    const linhas: any[] = r.rows ?? r;
    // A pausa que vale para a loja do canal: a dela ou a da empresa toda (a mesma regra de `pausaVigenteDoCanal`). A loja do
    // cardápio digital é a do cardápio; a do iFood e da 99, a da integração (sem ela, a loja em uso).
    const lojaDe = (canal: CanalDaPausa): string | null | undefined =>
      canal === 'cardapio' ? loja.unidadeId : externos[canal as 'ifood' | 'food99'].disponivel ? externos[canal as 'ifood' | 'food99'].unidadeId : unidadeAtual;
    const daLoja = (canal: CanalDaPausa) => {
      const u = lojaDe(canal);
      return pausaDaLinha(
        linhas.find((l) => l.canal === canal && (l.unidade_id == null || (u !== undefined && l.unidade_id === u))),
        agora,
      );
    };
    const canais: CanalNoPainel[] = CANAIS_DA_PAUSA.map((canal) => ({
      canal,
      nome: NOME_DO_CANAL[canal],
      disponivel: canal === 'cardapio' ? loja.tem : externos[canal].disponivel,
      ...(ehExterno(canal) && externos[canal].motivo ? { motivo: externos[canal].motivo } : {}),
      pausa: daLoja(canal),
    }));
    return {
      canais,
      // A frase pronta vai junto para a prévia do diálogo ("Outro" é o texto escrito: `frase` nula).
      motivos: MOTIVOS.map((m) => ({ motivo: m, rotulo: MOTIVOS_DA_PAUSA[m].rotulo, frase: MOTIVOS_DA_PAUSA[m].frase })),
      motivoTextoMax: MOTIVO_TEXTO_MAX,
      temposDoCardapio: [...TEMPOS_DO_CARDAPIO],
      // F5: a 99 só aceita estes tempos (ou "até o fim do dia").
      temposDa99: [...TEMPOS_DA_99],
      /** Precisa escolher a loja no topo antes de pausar (empresa com mais de um cardápio de loja). */
      escolherLoja: loja.unidadeId === undefined,
      // F2 (mig 393): quando o painel avisa antes de reabrir e com que som; os botões de estender.
      ...(await this.avisoEMensagem(tenantId, loja.unidadeId ?? unidadeAtual)),
      minutosParaEstender: [...MINUTOS_PARA_ESTENDER],
    };
  }

  /** O aviso (F2) e o modelo da mensagem ao cliente (F3: o da loja ou o padrão) — a prévia do diálogo usa o modelo. */
  private async avisoEMensagem(tenantId: string, unidadeId: string | null | undefined) {
    const row = await this.linhaDoAviso(tenantId, unidadeId);
    return { aviso: avisoDaLinha(row), mensagemModelo: mensagemDaLinha(row) ?? MENSAGEM_DA_PAUSA_PADRAO };
  }

  /**
   * A linha do cardápio que guarda o aviso: a da loja, senão a da empresa (a herança do "Cheguei", mig 354). `to_jsonb`
   * para o painel não cair num banco ainda sem a 393 (vale o padrão).
   */
  private async linhaDoAviso(tenantId: string, unidadeId: string | null | undefined) {
    const r: any = await this.db.execute(sql`
      select c.id, c.unidade_id, to_jsonb(c) ->> 'pausa_aviso_min' as pausa_aviso_min, to_jsonb(c) ->> 'pausa_som' as pausa_som,
             to_jsonb(c) ->> 'pausa_mensagem' as pausa_mensagem, to_jsonb(c) ->> 'pausa_audio' as pausa_audio
        from cardapio_config c
       where c.tenant_id = ${tenantId}::uuid
         and (${unidadeId ?? null}::uuid is not null and c.unidade_id = ${unidadeId ?? null}::uuid or c.unidade_id is null)
       order by (c.unidade_id is null), c.id
       limit 1`);
    return (r.rows ?? r)[0] ?? null;
  }

  /** O aviso antes de reabrir da loja (o padrão: 5 min, bipe). */
  async avisoDaLoja(tenantId: string, unidadeId: string | null | undefined): Promise<AvisoDaPausa> {
    return avisoDaLinha(await this.linhaDoAviso(tenantId, unidadeId));
  }

  /**
   * Pausa os canais escolhidos com o motivo e o tempo — o cardápio digital e o iFood pelo `tempo`; a 99 pelo `tempo99`
   * (10, 20 ou 30 min ou até o fim do dia: a 99 não aceita outro). Pausar de novo um canal já pausado troca o motivo e o
   * fim (é como se estende). Tudo é conferido ANTES de gravar (V86): um canal recusado não deixa o outro pausado pela metade.
   * O iFood e a 99 vão ao canal pela rotina da nuvem (`PausaNosCanaisService`); a linha guarda o id da pausa antiga no canal
   * (`externo_id`) para ela sair antes da nova.
   */
  async pausar(
    user: AuthUser,
    unidadeAtual: string | null,
    dto: {
      canais?: unknown;
      motivo?: unknown;
      motivoTexto?: unknown;
      tempo?: { minutos?: unknown; ate?: unknown };
      tempo99?: { minutos?: unknown; fimDoDia?: unknown };
    },
    agora: Date = new Date(),
  ) {
    const canais = Array.isArray(dto?.canais) ? [...new Set(dto.canais as unknown[])] : [];
    if (!canais.length) throw new BadRequestException('Escolha o que pausar.');
    for (const c of canais) if (!ehCanalDaPausa(c)) throw new BadRequestException('Canal desconhecido.');
    const escolhidos = canais as CanalDaPausa[];
    const m = lerMotivo(dto?.motivo, dto?.motivoTexto);
    if (!m.ok) throw new BadRequestException(m.erro);
    let ate: Date | null = null;
    if (escolhidos.some((c) => c !== 'food99')) {
      const t = ateDoCardapio(dto?.tempo, agora);
      if (!t.ok) throw new BadRequestException(t.erro);
      ate = t.ate;
    }
    let ate99: Date | null = null;
    if (escolhidos.includes('food99')) {
      const t = ateDa99(dto?.tempo99, agora);
      if (!t.ok) throw new BadRequestException(t.erro);
      ate99 = t.ate;
    }
    const externos = escolhidos.some(ehExterno) ? await this.canaisExternosDaLoja(user.tenantId, unidadeAtual) : undefined;
    const alvos: { canal: CanalDaPausa; unidadeId: string | null; ate: Date; tempo: string }[] = [];
    for (const canal of CANAIS_DA_PAUSA.filter((c) => escolhidos.includes(c))) {
      if (canal === 'cardapio') {
        const loja = await this.lojaDoCardapio(user.tenantId, unidadeAtual);
        if (!loja.tem) throw new BadRequestException('Esta loja não tem cardápio digital.');
        alvos.push({ canal, unidadeId: loja.unidadeId, ate: ate as Date, tempo: textoDoTempo(dto?.tempo) });
        continue;
      }
      const e = (externos as CanaisExternos)[canal];
      if (!e.disponivel)
        throw new BadRequestException(e.motivo ?? (canal === 'ifood' ? 'O iFood desta loja não está ligado para pausar pelo Regem.' : 'A 99 desta loja não está ligada para pausar pelo Regem.'));
      alvos.push(
        canal === 'food99'
          ? { canal, unidadeId: e.unidadeId, ate: ate99 as Date, tempo: textoDoTempo99(dto?.tempo99) }
          : { canal, unidadeId: e.unidadeId, ate: ate as Date, tempo: textoDoTempo(dto?.tempo) },
      );
    }

    const nome = String(user.nome ?? '').trim() || null;
    // Uma linha por empresa, loja e canal: a nuvem e o servidor da loja chegam ao mesmo id e o sync junta (mig 392). Todas
    // numa transação: ou pausa tudo o que foi escolhido, ou nada.
    await this.db.transaction(async (tx) => {
      for (const a of alvos)
        await tx.execute(sql`
          insert into pausa_canal (id, tenant_id, unidade_id, canal, ate, motivo, motivo_texto, pausado_em, pausado_por, pausado_por_nome)
          values (${idPausaDoCanal(user.tenantId, a.unidadeId, a.canal)}::uuid, ${user.tenantId}::uuid, ${a.unidadeId}::uuid, ${a.canal},
                  ${a.ate.toISOString()}::timestamptz, ${m.motivo}, ${m.motivoTexto}, ${agora.toISOString()}::timestamptz,
                  ${user.colaboradorId ?? null}::uuid, ${nome})
          on conflict (id) do update set
            ate = excluded.ate, motivo = excluded.motivo, motivo_texto = excluded.motivo_texto, pausado_em = excluded.pausado_em,
            pausado_por = excluded.pausado_por, pausado_por_nome = excluded.pausado_por_nome,
            externo_situacao = null, externo_erro = null`);
    });
    for (const a of alvos)
      await this.auditoria.registrar({
        tenantId: user.tenantId,
        atorId: user.colaboradorId,
        atorPerfil: user.categoria ?? '',
        tipo: 'delivery',
        acao: 'pausou_canal',
        unidadeId: a.unidadeId,
        entidadeTipo: 'pausa_canal',
        entidadeId: idPausaDoCanal(user.tenantId, a.unidadeId, a.canal),
        detalhe: { canal: a.canal, motivo: m.motivo, motivoTexto: m.motivoTexto, ate: a.ate.toISOString(), tempo: a.tempo },
      });
    this.levarAosCanais(escolhidos);
    return this.estado(user.tenantId, unidadeAtual, agora);
  }

  /** Reabre o canal agora. Já aberto (o tempo passou ou outra pessoa reabriu): nada muda e nada vai para a auditoria. */
  async reabrir(user: AuthUser, unidadeAtual: string | null, canal: unknown, agora: Date = new Date()) {
    if (!ehCanalDaPausa(canal)) throw new BadRequestException('Canal desconhecido.');
    const unidadeId = await this.lojaDoCanal(user.tenantId, unidadeAtual, canal);
    const id = idPausaDoCanal(user.tenantId, unidadeId, canal);
    // Gravação condicional: só a pausa que ainda vale é reaberta — duas pessoas no mesmo clique geram UM registro.
    // O `for update` espera quem está reabrindo junto e relê a linha depois: a segunda já a encontra aberta. No iFood e na
    // 99, a situação no canal volta a "a fazer": a rotina reabre lá.
    const r: any = await this.db.execute(sql`
      with antes as (
        select id, ate, motivo, motivo_texto from pausa_canal
         where id = ${id}::uuid and tenant_id = ${user.tenantId}::uuid and ate > ${agora.toISOString()}::timestamptz
         for update)
      update pausa_canal p set ate = null, externo_situacao = null, externo_erro = null from antes where p.id = antes.id
      returning antes.ate as era_ate, antes.motivo, antes.motivo_texto`);
    const antes = (r.rows ?? r)[0];
    if (antes) {
      await this.auditoria.registrar({
        tenantId: user.tenantId,
        atorId: user.colaboradorId,
        atorPerfil: user.categoria ?? '',
        tipo: 'delivery',
        acao: 'reabriu_canal',
        unidadeId,
        entidadeTipo: 'pausa_canal',
        entidadeId: id,
        detalhe: { canal, eraAte: new Date(antes.era_ate).toISOString(), motivo: antes.motivo ?? null, motivoTexto: antes.motivo_texto ?? null },
      });
      this.levarAosCanais([canal]);
    }
    return this.estado(user.tenantId, unidadeAtual, agora);
  }

  /**
   * "+10 min" / "+30 min" da faixa (F2): soma ao fim da pausa que vale agora (até 12 h à frente). A linha é lida com
   * `for update` na mesma transação: dois cliques juntos somam os dois, sem um apagar o outro. Já reaberto: recusa.
   */
  async estender(user: AuthUser, unidadeAtual: string | null, canal: unknown, minutos: unknown, agora: Date = new Date()) {
    if (!ehCanalDaPausa(canal)) throw new BadRequestException('Canal desconhecido.');
    const unidadeId = await this.lojaDoCanal(user.tenantId, unidadeAtual, canal);
    const id = idPausaDoCanal(user.tenantId, unidadeId, canal);
    const feito = await this.db.transaction(async (tx) => {
      const r: any = await tx.execute(sql`
        select ate from pausa_canal where id = ${id}::uuid and tenant_id = ${user.tenantId}::uuid for update`);
      const atual = (r.rows ?? r)[0]?.ate;
      // A 99 só pausa por 10, 20 ou 30 min a partir de agora: vale o tempo dela mais perto do fim pedido (F5).
      const e = canal === 'food99' ? ateEstendidoDa99(atual ? new Date(atual) : null, minutos, agora) : ateEstendido(atual ? new Date(atual) : null, minutos, agora);
      if (!e.ok) return e;
      // No iFood e na 99, a situação no canal volta a "a fazer": a rotina leva o fim novo (no iFood, remove e cria).
      await tx.execute(sql`
        update pausa_canal set ate = ${e.ate.toISOString()}::timestamptz, externo_situacao = null, externo_erro = null
         where id = ${id}::uuid`);
      return { ok: true as const, ate: e.ate, eraAte: new Date(atual) };
    });
    if (!feito.ok) throw new BadRequestException(feito.erro);
    this.levarAosCanais([canal]);
    await this.auditoria.registrar({
      tenantId: user.tenantId,
      atorId: user.colaboradorId,
      atorPerfil: user.categoria ?? '',
      tipo: 'delivery',
      acao: 'estendeu_canal',
      unidadeId,
      entidadeTipo: 'pausa_canal',
      entidadeId: id,
      detalhe: { canal, minutos: Number(minutos), eraAte: feito.eraAte.toISOString(), ate: feito.ate.toISOString() },
    });
    return this.estado(user.tenantId, unidadeAtual, agora);
  }

  /**
   * O grupo "Pausa dos pedidos" dos ajustes do atendimento: o aviso antes de reabrir (F2) e a mensagem pronta ao cliente
   * (F3 — `mensagem` nula = o texto padrão, que vai junto para a tela mostrar e para o "Voltar ao texto padrão").
   */
  async ajustes(tenantId: string, unidadeId: string | null) {
    const row = await this.linhaDoAviso(tenantId, unidadeId);
    return {
      ...avisoDaLinha(row),
      mensagem: mensagemDaLinha(row),
      // F4 (mig 396): responder em áudio quando o cliente insiste (o padrão do protótipo: ligado).
      audio: audioDaLinha(row),
      mensagemPadrao: MENSAGEM_DA_PAUSA_PADRAO,
      mensagemMax: MENSAGEM_DA_PAUSA_MAX,
      temCardapio: !!row,
      opcoes: { minutos: [...AVISO_MINUTOS], sons: [...SONS_DA_PAUSA] },
    };
  }

  /** Confere o ajuste sem gravar nada (a rota dos ajustes confere todos os grupos antes da 1ª gravação — V86). */
  conferirAjustes(dto: unknown): AjusteDaPausa {
    const a = lerAjusteDaPausa(dto);
    if (!a.ok) throw new BadRequestException(a.erro);
    const parcial: AjusteDaPausa = { ...a.parcial };
    const d = (dto ?? {}) as Record<string, unknown>;
    if (d.mensagem !== undefined) {
      const m = lerMensagemDaPausa(d.mensagem);
      if (!m.ok) throw new BadRequestException(m.erro);
      parcial.mensagem = m.mensagem;
    }
    // F4: liga/desliga só com booleano (V15).
    if (d.audio !== undefined) parcial.audio = exigirBooleano(d.audio, 'Responder em áudio quando o cliente insistir');
    return parcial;
  }

  /**
   * Grava só os campos que vieram (V16) e só as colunas deles, na linha do cardápio da loja em uso (sem ela, a da empresa).
   * Quem mudou e de quê para quê fica na auditoria. Sem cardápio: recusa, com o caminho para criar.
   */
  async salvarAjustes(user: AuthUser, unidadeId: string | null, parcial: AjusteDaPausa): Promise<void> {
    const row = await this.linhaDoAviso(user.tenantId, unidadeId);
    if (!row) throw new BadRequestException('A loja ainda não tem cardápio online: a pausa mora nele (Delivery › Configurações › Cardápio).');
    const antes = avisoDaLinha(row);
    const mensagemAntes = mensagemDaLinha(row);
    const sets: SQL[] = [];
    if (parcial.minutos !== undefined && parcial.minutos !== antes.minutos) sets.push(sql`pausa_aviso_min = ${parcial.minutos}`);
    if (parcial.som !== undefined && parcial.som !== antes.som) sets.push(sql`pausa_som = ${parcial.som}`);
    const mudouAviso = sets.length > 0;
    const mudouMensagem = parcial.mensagem !== undefined && parcial.mensagem !== mensagemAntes;
    if (mudouMensagem) sets.push(sql`pausa_mensagem = ${parcial.mensagem ?? null}`);
    const audioAntes = audioDaLinha(row);
    const mudouAudio = parcial.audio !== undefined && parcial.audio !== audioAntes;
    if (mudouAudio) sets.push(sql`pausa_audio = ${parcial.audio === true}`);
    if (!sets.length) return;
    await this.db.execute(sql`
      update cardapio_config set ${sql.join(sets, sql`, `)}, updated_at = now()
       where id = ${row.id}::uuid and tenant_id = ${user.tenantId}::uuid`);
    const base = {
      tenantId: user.tenantId,
      atorId: user.colaboradorId,
      atorPerfil: user.categoria ?? '',
      tipo: 'config',
      unidadeId: row.unidade_id ?? null,
      entidadeTipo: 'cardapio_config',
      entidadeId: row.id,
    };
    if (mudouAviso) {
      const { mensagem: _m, audio: _a, ...aviso } = parcial;
      await this.auditoria.registrar({ ...base, acao: 'alterou_aviso_da_pausa', detalhe: { antes, depois: { ...antes, ...aviso } } });
    }
    if (mudouMensagem)
      await this.auditoria.registrar({ ...base, acao: 'alterou_mensagem_da_pausa', detalhe: { antes: mensagemAntes, depois: parcial.mensagem ?? null } });
    if (mudouAudio)
      await this.auditoria.registrar({ ...base, acao: parcial.audio ? 'ligou_audio_da_pausa' : 'desligou_audio_da_pausa', detalhe: { audio: parcial.audio === true } });
  }
}

/** Os ajustes que a tela grava: o aviso (F2), a mensagem pronta (F3; nula = o texto padrão) e o áudio (F4). */
export type AjusteDaPausa = Partial<AvisoDaPausa> & { mensagem?: string | null; audio?: boolean };

/** Responder em áudio quando o cliente insiste (F4): ligado salvo quando a loja desligou (sem a coluna: o padrão, ligado). */
function audioDaLinha(row: any): boolean {
  return String(row?.pausa_audio ?? 'true') !== 'false';
}

/** O tempo escolhido, como vai para a auditoria ("30 min", "até 21:40", "até o fim do dia"). */
function textoDoTempo(tempo: { minutos?: unknown; ate?: unknown } | undefined): string {
  return tempo?.minutos != null && tempo?.minutos !== '' ? `${Number(tempo.minutos)} min` : `até ${String(tempo?.ate)}`;
}
function textoDoTempo99(tempo: { minutos?: unknown; fimDoDia?: unknown } | undefined): string {
  return tempo?.fimDoDia === true ? 'até o fim do dia' : `${Number(tempo?.minutos)} min`;
}

/** O motivo quando o servidor da loja não falou com a nuvem (o diálogo diz isso, não "não tem iFood"). */
const SEM_NUVEM = 'Sem conexão com a nuvem agora: o iFood e a 99 só pausam pelo Regem com internet.';

function semExternos(motivo: string | null): CanaisExternos {
  const nao: CanalExterno = { disponivel: false, unidadeId: null, motivo };
  return { ifood: nao, food99: { ...nao } };
}

/** Um canal como a nuvem respondeu (só o que se espera; o resto vira "não dá"). */
function externoLido(x: any): CanalExterno {
  return {
    disponivel: x?.disponivel === true,
    unidadeId: typeof x?.unidadeId === 'string' ? x.unidadeId : null,
    motivo: typeof x?.motivo === 'string' ? x.motivo.slice(0, 200) : null,
  };
}

/** A mensagem que a loja escreveu (nula = o texto padrão). */
function mensagemDaLinha(row: any): string | null {
  const t = String(row?.pausa_mensagem ?? '').trim();
  return t || null;
}
