import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { sql, type SQL } from 'drizzle-orm';
import { DRIZZLE, type DrizzleDB } from '../../db/drizzle.module';
import type { AuthUser } from '../../auth/auth-user';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { idPausaDoCanal } from '../../common/id-deterministico';
import {
  ateDoCardapio,
  ateEstendido,
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
  /** Dá para pausar este canal pelo Regem (o cardápio digital sempre que a loja tem cardápio; iFood e 99 na fase da API). */
  disponivel: boolean;
  pausa: PausaVigente | null;
};

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
  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly auditoria: AuditoriaService,
  ) {}

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
    const r: any = await this.db.execute(sql`
      select canal, unidade_id, ate, motivo, motivo_texto, pausado_em, pausado_por_nome
        from pausa_canal
       where tenant_id = ${tenantId}::uuid and ate > ${agora.toISOString()}::timestamptz
       order by ate desc`);
    const linhas: any[] = r.rows ?? r;
    // A pausa que vale para a loja do cardápio: a dela ou a da empresa toda (a mesma regra de `pausaVigenteDoCanal`).
    const daLoja = (canal: CanalDaPausa) =>
      pausaDaLinha(
        linhas.find(
          (l) => l.canal === canal && (l.unidade_id == null || (loja.unidadeId !== undefined && l.unidade_id === loja.unidadeId)),
        ),
        agora,
      );
    const canais: CanalNoPainel[] = CANAIS_DA_PAUSA.map((canal) => ({
      canal,
      nome: NOME_DO_CANAL[canal],
      disponivel: canal === 'cardapio' ? loja.tem : false,
      pausa: daLoja(canal),
    }));
    return {
      canais,
      // A frase pronta vai junto para a prévia do diálogo ("Outro" é o texto escrito: `frase` nula).
      motivos: MOTIVOS.map((m) => ({ motivo: m, rotulo: MOTIVOS_DA_PAUSA[m].rotulo, frase: MOTIVOS_DA_PAUSA[m].frase })),
      motivoTextoMax: MOTIVO_TEXTO_MAX,
      temposDoCardapio: [...TEMPOS_DO_CARDAPIO],
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
             to_jsonb(c) ->> 'pausa_mensagem' as pausa_mensagem
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
   * Pausa os canais escolhidos com o motivo e o tempo. Pausar de novo um canal já pausado troca o motivo e o fim (é como
   * se estende). Tudo é conferido ANTES de gravar (V86): um canal recusado não deixa o outro pausado pela metade.
   */
  async pausar(
    user: AuthUser,
    unidadeAtual: string | null,
    dto: { canais?: unknown; motivo?: unknown; motivoTexto?: unknown; tempo?: { minutos?: unknown; ate?: unknown } },
    agora: Date = new Date(),
  ) {
    const canais = Array.isArray(dto?.canais) ? [...new Set(dto.canais as unknown[])] : [];
    if (!canais.length) throw new BadRequestException('Escolha o que pausar.');
    for (const c of canais) {
      if (!ehCanalDaPausa(c)) throw new BadRequestException('Canal desconhecido.');
      if (c !== 'cardapio') throw new BadRequestException(`A pausa ${c === 'ifood' ? 'do iFood' : 'da 99'} pelo Regem ainda não está ligada.`);
    }
    const m = lerMotivo(dto?.motivo, dto?.motivoTexto);
    if (!m.ok) throw new BadRequestException(m.erro);
    const t = ateDoCardapio(dto?.tempo, agora);
    if (!t.ok) throw new BadRequestException(t.erro);
    const loja = await this.lojaDoCardapio(user.tenantId, unidadeAtual);
    if (!loja.tem) throw new BadRequestException('Esta loja não tem cardápio digital.');

    const canal: CanalDaPausa = 'cardapio';
    const id = idPausaDoCanal(user.tenantId, loja.unidadeId, canal);
    const nome = String(user.nome ?? '').trim() || null;
    // Uma linha por empresa, loja e canal: a nuvem e o servidor da loja chegam ao mesmo id e o sync junta (mig 392).
    await this.db.execute(sql`
      insert into pausa_canal (id, tenant_id, unidade_id, canal, ate, motivo, motivo_texto, pausado_em, pausado_por, pausado_por_nome)
      values (${id}::uuid, ${user.tenantId}::uuid, ${loja.unidadeId}::uuid, ${canal}, ${t.ate.toISOString()}::timestamptz,
              ${m.motivo}, ${m.motivoTexto}, ${agora.toISOString()}::timestamptz, ${user.colaboradorId ?? null}::uuid, ${nome})
      on conflict (id) do update set
        ate = excluded.ate, motivo = excluded.motivo, motivo_texto = excluded.motivo_texto, pausado_em = excluded.pausado_em,
        pausado_por = excluded.pausado_por, pausado_por_nome = excluded.pausado_por_nome,
        externo_situacao = null, externo_id = null, externo_erro = null`);
    await this.auditoria.registrar({
      tenantId: user.tenantId,
      atorId: user.colaboradorId,
      atorPerfil: user.categoria ?? '',
      tipo: 'delivery',
      acao: 'pausou_canal',
      unidadeId: loja.unidadeId,
      entidadeTipo: 'pausa_canal',
      entidadeId: id,
      detalhe: {
        canal,
        motivo: m.motivo,
        motivoTexto: m.motivoTexto,
        ate: t.ate.toISOString(),
        tempo: dto?.tempo?.minutos != null && dto?.tempo?.minutos !== '' ? `${Number(dto.tempo.minutos)} min` : `até ${String(dto?.tempo?.ate)}`,
      },
    });
    return this.estado(user.tenantId, unidadeAtual, agora);
  }

  /** Reabre o canal agora. Já aberto (o tempo passou ou outra pessoa reabriu): nada muda e nada vai para a auditoria. */
  async reabrir(user: AuthUser, unidadeAtual: string | null, canal: unknown, agora: Date = new Date()) {
    if (!ehCanalDaPausa(canal)) throw new BadRequestException('Canal desconhecido.');
    const loja = await this.lojaDoCardapio(user.tenantId, unidadeAtual);
    const id = idPausaDoCanal(user.tenantId, loja.unidadeId, canal);
    // Gravação condicional: só a pausa que ainda vale é reaberta — duas pessoas no mesmo clique geram UM registro.
    // O `for update` espera quem está reabrindo junto e relê a linha depois: a segunda já a encontra aberta.
    const r: any = await this.db.execute(sql`
      with antes as (
        select id, ate, motivo, motivo_texto from pausa_canal
         where id = ${id}::uuid and tenant_id = ${user.tenantId}::uuid and ate > ${agora.toISOString()}::timestamptz
         for update)
      update pausa_canal p set ate = null from antes where p.id = antes.id
      returning antes.ate as era_ate, antes.motivo, antes.motivo_texto`);
    const antes = (r.rows ?? r)[0];
    if (antes) {
      await this.auditoria.registrar({
        tenantId: user.tenantId,
        atorId: user.colaboradorId,
        atorPerfil: user.categoria ?? '',
        tipo: 'delivery',
        acao: 'reabriu_canal',
        unidadeId: loja.unidadeId,
        entidadeTipo: 'pausa_canal',
        entidadeId: id,
        detalhe: { canal, eraAte: new Date(antes.era_ate).toISOString(), motivo: antes.motivo ?? null, motivoTexto: antes.motivo_texto ?? null },
      });
    }
    return this.estado(user.tenantId, unidadeAtual, agora);
  }

  /**
   * "+10 min" / "+30 min" da faixa (F2): soma ao fim da pausa que vale agora (até 12 h à frente). A linha é lida com
   * `for update` na mesma transação: dois cliques juntos somam os dois, sem um apagar o outro. Já reaberto: recusa.
   */
  async estender(user: AuthUser, unidadeAtual: string | null, canal: unknown, minutos: unknown, agora: Date = new Date()) {
    if (!ehCanalDaPausa(canal)) throw new BadRequestException('Canal desconhecido.');
    const loja = await this.lojaDoCardapio(user.tenantId, unidadeAtual);
    const id = idPausaDoCanal(user.tenantId, loja.unidadeId, canal);
    const feito = await this.db.transaction(async (tx) => {
      const r: any = await tx.execute(sql`
        select ate from pausa_canal where id = ${id}::uuid and tenant_id = ${user.tenantId}::uuid for update`);
      const atual = (r.rows ?? r)[0]?.ate;
      const e = ateEstendido(atual ? new Date(atual) : null, minutos, agora);
      if (!e.ok) return e;
      await tx.execute(sql`update pausa_canal set ate = ${e.ate.toISOString()}::timestamptz where id = ${id}::uuid`);
      return { ok: true as const, ate: e.ate, eraAte: new Date(atual) };
    });
    if (!feito.ok) throw new BadRequestException(feito.erro);
    await this.auditoria.registrar({
      tenantId: user.tenantId,
      atorId: user.colaboradorId,
      atorPerfil: user.categoria ?? '',
      tipo: 'delivery',
      acao: 'estendeu_canal',
      unidadeId: loja.unidadeId,
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
      const { mensagem: _m, ...aviso } = parcial;
      await this.auditoria.registrar({ ...base, acao: 'alterou_aviso_da_pausa', detalhe: { antes, depois: { ...antes, ...aviso } } });
    }
    if (mudouMensagem)
      await this.auditoria.registrar({ ...base, acao: 'alterou_mensagem_da_pausa', detalhe: { antes: mensagemAntes, depois: parcial.mensagem ?? null } });
  }
}

/** Os ajustes que a tela grava: o aviso (F2) e a mensagem pronta (F3; nula = o texto padrão). */
export type AjusteDaPausa = Partial<AvisoDaPausa> & { mensagem?: string | null };

/** A mensagem que a loja escreveu (nula = o texto padrão). */
function mensagemDaLinha(row: any): string | null {
  const t = String(row?.pausa_mensagem ?? '').trim();
  return t || null;
}
