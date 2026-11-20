import { BadRequestException, Inject, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { AuthUser } from '../../auth/auth-user';
import { AuditoriaService } from '../auditoria/auditoria.service';
import {
  CONFIG_PADRAO,
  type ConfigDoClube,
  type DadosDoPremio,
  descricaoDoPremio,
  FERRAMENTAS_PRONTAS,
  FORMAS_DO_SURPRESA,
  type GatilhoEntregue,
  type GatilhoReclamacao,
  type GatilhosDoSurpresa,
  gatilhosDaLinha,
  lerConfigDoClube,
  lerGatilhoEntregue,
  lerGatilhoReclamacao,
  lerPremio,
  LIMITES_DA_RECLAMACAO,
  ligandoAntesDaHora,
  QUEM_MANDA_DESCULPAS,
  MINIMO_MAX,
  NIVEIS_MAX,
  NOME_MAX,
  ondeEstaEmUso,
  premiosCitados,
  PREMIOS_POR_ESCOLHA_MAX,
  regrasDoClube,
  SELOS,
  TIPOS_DE_PREMIO,
  VALIDADES_DA_META,
  VALIDADES_DO_PREMIO,
  VALIDADES_DO_SELO,
} from './clube.regras';

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Quantos prêmios uma empresa cadastra (o catálogo é uma lista curta que a loja consegue dar a todos). */
export const PREMIOS_MAX = 50;
/** Os produtos da gaveta do prêmio (produto grátis): os ativos da empresa, em ordem de nome. */
export const PRODUTOS_DA_GAVETA_MAX = 1000;

const COLUNA: Record<keyof ConfigDoClube, string> = {
  surpresaAtivo: 'surpresa_ativo',
  surpresaForma: 'surpresa_forma',
  albumAtivo: 'album_ativo',
  albumSelos: 'album_selos',
  albumValidadeMeses: 'album_validade_meses',
  albumPremios: 'album_premios',
  metaAtivo: 'meta_ativo',
  metaNiveis: 'meta_niveis',
  metaValidadeDias: 'meta_validade_dias',
  minimo: 'minimo',
};
const JSONB = new Set<keyof ConfigDoClube>(['albumPremios', 'metaNiveis']);

export type PremioNaLista = DadosDoPremio & { id: string; produtoNome: string | null; descricao: string; emUso: string[] };

// CLUBE DE RECOMPRA — a base (fase A0, mig 471): a configuração da empresa e o catálogo de prêmios. Só NUVEM (CLOUD_ONLY
// em app.module). Quem lê: presidente e gerente (Delivery › Marketing › Clube); quem muda: só o presidente — conferido
// no controller, não na tela. Cada mudança vai à auditoria.
@Injectable()
export class ClubeService {
  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    @Optional() private readonly auditoria?: AuditoriaService,
  ) {}

  private rows(r: any): any[] {
    return (r?.rows ?? r) as any[];
  }

  /** A configuração da empresa (sem linha, os padrões — tudo desligado). */
  async config(tenantId: string): Promise<ConfigDoClube> {
    const [l] = this.rows(await this.db.execute(sql`select * from clube_config where tenant_id = ${tenantId}::uuid`));
    if (!l) return { ...CONFIG_PADRAO, albumPremios: [], metaNiveis: CONFIG_PADRAO.metaNiveis.map((n) => ({ ...n, premios: [] })) };
    return {
      surpresaAtivo: l.surpresa_ativo === true,
      surpresaForma: l.surpresa_forma === 'roleta' ? 'roleta' : 'raspadinha',
      albumAtivo: l.album_ativo === true,
      albumSelos: Number(l.album_selos),
      albumValidadeMeses: Number(l.album_validade_meses),
      albumPremios: Array.isArray(l.album_premios) ? l.album_premios.map(String) : [],
      metaAtivo: l.meta_ativo === true,
      metaNiveis: Array.isArray(l.meta_niveis)
        ? l.meta_niveis.map((n: any) => ({ pedidos: Number(n?.pedidos), premios: Array.isArray(n?.premios) ? n.premios.map(String) : [] }))
        : CONFIG_PADRAO.metaNiveis,
      metaValidadeDias: Number(l.meta_validade_dias),
      minimo: Number(l.minimo),
    };
  }

  /** Os gatilhos do prêmio surpresa (mig 474; o jsonb `surpresa_gatilhos`), com os padrões no que faltar. */
  async gatilhos(tenantId: string): Promise<GatilhosDoSurpresa> {
    const [l] = this.rows(await this.db.execute(sql`select surpresa_gatilhos as g from clube_config where tenant_id = ${tenantId}::uuid`));
    return gatilhosDaLinha(l?.g);
  }

  /** Os prêmios da empresa (sem os excluídos), com o produto, a descrição e onde estão em uso. */
  async premios(tenantId: string, config?: ConfigDoClube, gatilhosJa?: GatilhosDoSurpresa): Promise<PremioNaLista[]> {
    const c = config ?? (await this.config(tenantId));
    const g = gatilhosJa ?? (await this.gatilhos(tenantId));
    const linhas = this.rows(
      await this.db.execute(sql`
        select p.id, p.nome, p.tipo, p.valor::float8 as valor, p.teto::float8 as teto, p.produto_id as "produtoId",
               p.minimo::float8 as minimo, p.validade_dias as "validadeDias", pr.nome as "produtoNome"
          from clube_premio p
          left join produto pr on pr.id = p.produto_id and pr.tenant_id = p.tenant_id
         where p.tenant_id = ${tenantId}::uuid and p.excluido_em is null
         order by p.criado_em, p.id
         limit ${PREMIOS_MAX}`),
    );
    return linhas.map((l) => {
      const p = {
        id: String(l.id),
        nome: String(l.nome),
        tipo: l.tipo,
        valor: Number(l.valor),
        teto: l.teto == null ? null : Number(l.teto),
        produtoId: l.produtoId ?? null,
        produtoNome: l.produtoNome ?? null,
        minimo: Number(l.minimo),
        validadeDias: Number(l.validadeDias),
      };
      return { ...p, descricao: descricaoDoPremio(p), emUso: ondeEstaEmUso(c, p.id, g) };
    });
  }

  /** Delivery › Marketing › Clube: a configuração, o que já pode ligar, os gatilhos, os prêmios, as regras e as opções. */
  async painel(tenantId: string) {
    const config = await this.config(tenantId);
    const gatilhos = await this.gatilhos(tenantId);
    const premios = await this.premios(tenantId, config, gatilhos);
    const nomes = new Map(premios.map((p) => [p.id, p.nome]));
    return {
      config,
      prontas: FERRAMENTAS_PRONTAS,
      gatilhos,
      premios,
      regras: regrasDoClube(config, (id) => nomes.get(id) ?? null, gatilhos),
      opcoes: {
        formas: FORMAS_DO_SURPRESA,
        tipos: TIPOS_DE_PREMIO,
        validadesDoPremio: VALIDADES_DO_PREMIO,
        selos: SELOS,
        validadesDoSelo: VALIDADES_DO_SELO,
        validadesDaMeta: VALIDADES_DA_META,
        minimoMax: MINIMO_MAX,
        nomeMax: NOME_MAX,
        niveisMax: NIVEIS_MAX,
        premiosPorEscolhaMax: PREMIOS_POR_ESCOLHA_MAX,
        premiosMax: PREMIOS_MAX,
        limitesDaReclamacao: Object.entries(LIMITES_DA_RECLAMACAO).map(([valor, l]) => ({ valor, rotulo: l.rotulo })),
        quemMandaDesculpas: Object.entries(QUEM_MANDA_DESCULPAS).map(([valor, q]) => ({ valor, rotulo: q.rotulo })),
      },
    };
  }

  /** Os produtos ativos da empresa, para escolher o "produto grátis" na gaveta do prêmio. */
  async produtos(tenantId: string): Promise<Array<{ id: string; nome: string }>> {
    return this.rows(
      await this.db.execute(sql`
        select id, nome from produto where tenant_id = ${tenantId}::uuid and ativo order by nome, id limit ${PRODUTOS_DA_GAVETA_MAX}`),
    ).map((l) => ({ id: String(l.id), nome: String(l.nome) }));
  }

  private auditar(user: AuthUser, acao: string, entidadeId: string, detalhe: Record<string, unknown>) {
    return this.auditoria?.registrar({
      tenantId: user.tenantId,
      atorId: user.colaboradorId,
      atorPerfil: user.categoria,
      tipo: 'config',
      acao,
      entidadeTipo: acao.startsWith('clube_premio') ? 'clube_premio' : 'clube_config',
      entidadeId,
      detalhe,
    });
  }

  /**
   * Salva o que veio da configuração (V16: ausente mantém; V15: liga/desliga só com booleano). TODA recusa antes de gravar
   * (V86): a ferramenta que ainda não existe não liga; os prêmios citados existem e são desta empresa; o álbum e a meta
   * ligados têm prêmio. Grava SÓ as colunas que mudaram (V82 — os gatilhos são de outras fases); cada mudança na auditoria.
   */
  async salvarConfig(user: AuthUser, dto: unknown): Promise<ConfigDoClube> {
    const parcial = lerConfigDoClube(dto);
    const fora = ligandoAntesDaHora(parcial);
    if (fora.length)
      throw new BadRequestException(
        `${fora.map((f) => ({ surpresa: 'O prêmio surpresa', album: 'O álbum de selos', meta: 'A meta do mês' })[f]).join(', ')} ainda não pode ser ligado: chega numa próxima entrega.`,
      );
    const antes = await this.config(user.tenantId);
    const depois: ConfigDoClube = { ...antes, ...parcial };
    const mudou = (Object.keys(parcial) as Array<keyof ConfigDoClube>).filter((k) => JSON.stringify(antes[k]) !== JSON.stringify(depois[k]));
    if (!mudou.length) return antes;
    const citados = premiosCitados(depois);
    if (citados.length) {
      const [{ n }] = this.rows(
        await this.db.execute(sql`
          select count(*)::int as n from clube_premio
           where tenant_id = ${user.tenantId}::uuid and excluido_em is null
             and id in (${sql.join(citados.map((id) => sql`${id}::uuid`), sql`, `)})`),
      );
      if (Number(n) !== citados.length) throw new BadRequestException('Um dos prêmios escolhidos não existe mais. Recarregue a página e escolha de novo.');
    }
    if (depois.albumAtivo && !depois.albumPremios.length) throw new BadRequestException('Escolha ao menos um prêmio para quem completa o álbum.');
    if (depois.metaAtivo && depois.metaNiveis.some((n) => !n.premios.length))
      throw new BadRequestException('Escolha ao menos um prêmio em cada nível da meta.');
    const valor = (k: keyof ConfigDoClube) => (JSONB.has(k) ? sql`${JSON.stringify(depois[k])}::jsonb` : sql`${depois[k] as any}`);
    const colunas = sql.join(mudou.map((k) => sql.raw(COLUNA[k])), sql`, `);
    const valores = sql.join(mudou.map(valor), sql`, `);
    const atualizar = sql.join(mudou.map((k) => sql.raw(`${COLUNA[k]} = excluded.${COLUNA[k]}`)), sql`, `);
    await this.db.execute(sql`
      insert into clube_config (tenant_id, ${colunas}, atualizado_por)
      values (${user.tenantId}::uuid, ${valores}, ${user.colaboradorId}::uuid)
      on conflict (tenant_id) do update
         set ${atualizar}, atualizado_por = excluded.atualizado_por, atualizado_em = now()`);
    for (const k of mudou) await this.auditar(user, 'clube_config_alterado', user.tenantId, { campo: k, de: antes[k], para: depois[k] });
    return this.config(user.tenantId);
  }

  /** O produto do "produto grátis" é desta empresa e está ativo. */
  private async conferirProduto(tenantId: string, p: DadosDoPremio) {
    if (p.tipo !== 'produto') return;
    const [l] = this.rows(
      await this.db.execute(sql`select 1 as ok from produto where id = ${p.produtoId}::uuid and tenant_id = ${tenantId}::uuid and ativo`),
    );
    if (!l) throw new BadRequestException('O produto escolhido não está ativo nesta empresa. Escolha outro.');
  }

  async criarPremio(user: AuthUser, dto: unknown): Promise<PremioNaLista[]> {
    const p = lerPremio(dto);
    await this.conferirProduto(user.tenantId, p);
    const [{ n }] = this.rows(
      await this.db.execute(sql`select count(*)::int as n from clube_premio where tenant_id = ${user.tenantId}::uuid and excluido_em is null`),
    );
    if (Number(n) >= PREMIOS_MAX) throw new BadRequestException(`O clube tem no máximo ${PREMIOS_MAX} prêmios. Exclua um que não usa antes de criar outro.`);
    const [{ id }] = this.rows(
      await this.db.execute(sql`
        insert into clube_premio (tenant_id, nome, tipo, valor, teto, produto_id, minimo, validade_dias, atualizado_por)
        values (${user.tenantId}::uuid, ${p.nome}, ${p.tipo}, ${p.valor}, ${p.teto}, ${p.produtoId}::uuid, ${p.minimo},
                ${p.validadeDias}, ${user.colaboradorId}::uuid)
        returning id`),
    );
    await this.auditar(user, 'clube_premio_criado', String(id), { ...p });
    return this.premios(user.tenantId);
  }

  private async premioDaEmpresa(tenantId: string, id: string) {
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new NotFoundException('Prêmio não encontrado.');
    const [l] = this.rows(
      await this.db.execute(sql`
        select id, nome, tipo, valor::float8 as valor, teto::float8 as teto, produto_id as "produtoId", minimo::float8 as minimo,
               validade_dias as "validadeDias"
          from clube_premio where id = ${id}::uuid and tenant_id = ${tenantId}::uuid and excluido_em is null`),
    );
    if (!l) throw new NotFoundException('Prêmio não encontrado.');
    return l;
  }

  async editarPremio(user: AuthUser, id: string, dto: unknown): Promise<PremioNaLista[]> {
    const p = lerPremio(dto);
    const antes = await this.premioDaEmpresa(user.tenantId, id);
    await this.conferirProduto(user.tenantId, p);
    if (p.tipo === 'produto') {
      const g = await this.gatilhos(user.tenantId);
      if (g.entregue.premioId === String(antes.id) || g.reclamacao.premios.includes(String(antes.id)))
        throw new BadRequestException(
          'Este prêmio está no prêmio surpresa, que ainda não dá produto grátis: troque o prêmio lá antes, ou escolha um desconto ou o frete grátis.',
        );
    }
    await this.db.execute(sql`
      update clube_premio
         set nome = ${p.nome}, tipo = ${p.tipo}, valor = ${p.valor}, teto = ${p.teto}, produto_id = ${p.produtoId}::uuid,
             minimo = ${p.minimo}, validade_dias = ${p.validadeDias}, atualizado_por = ${user.colaboradorId}::uuid, atualizado_em = now()
       where id = ${id}::uuid and tenant_id = ${user.tenantId}::uuid and excluido_em is null`);
    await this.auditar(user, 'clube_premio_alterado', id, { antes, depois: p });
    return this.premios(user.tenantId);
  }

  /**
   * Excluir só esconde (`excluido_em`): quem já ganhou continua usando até a validade (o cupom pessoal é dele). O prêmio
   * em uso no álbum ou na meta não sai — a pessoa troca lá antes (senão a ferramenta ficaria apontando para o nada).
   */
  async excluirPremio(user: AuthUser, id: string): Promise<PremioNaLista[]> {
    const antes = await this.premioDaEmpresa(user.tenantId, id);
    const onde = ondeEstaEmUso(await this.config(user.tenantId), String(antes.id), await this.gatilhos(user.tenantId));
    if (onde.length) throw new BadRequestException(`Este prêmio está em uso em: ${onde.join(', ')}. Troque o prêmio lá antes de excluir.`);
    await this.db.execute(sql`
      update clube_premio set excluido_em = now(), atualizado_por = ${user.colaboradorId}::uuid, atualizado_em = now()
       where id = ${id}::uuid and tenant_id = ${user.tenantId}::uuid and excluido_em is null`);
    await this.auditar(user, 'clube_premio_excluido', id, { nome: antes.nome });
    return this.premios(user.tenantId);
  }

  /**
   * Salva o gatilho "Pedido entregue" (mig 474). TODA recusa antes de gravar (V86): ligado precisa de prêmio; o prêmio
   * existe nesta empresa e não é "produto grátis" (o produto grátis no prêmio surpresa chega numa fase seguinte — ele
   * pede o produto no carrinho, e a conta do cupom ainda não sabe disso). Ao LIGAR, grava `desde` = agora: só os pedidos
   * concluídos depois dão prêmio. Grava SÓ a chave `entregue` do jsonb, mesclando no banco (V82). Auditado.
   */
  async salvarGatilhoEntregue(user: AuthUser, dto: unknown): Promise<GatilhosDoSurpresa> {
    const parcial = lerGatilhoEntregue(dto);
    const antes = (await this.gatilhos(user.tenantId)).entregue;
    const depois: GatilhoEntregue = { ...antes, ...parcial };
    if (depois.ativo && !depois.premioId) throw new BadRequestException('Escolha o prêmio de quem tem o pedido entregue.');
    // Sempre confere o prêmio escolhido (também o que já estava): ligar de novo com um prêmio que foi trocado para
    // "produto grátis" não pode passar calado — a rotina não daria nada.
    if (depois.premioId) {
      const [p] = this.rows(
        await this.db.execute(sql`
          select tipo from clube_premio where id = ${depois.premioId}::uuid and tenant_id = ${user.tenantId}::uuid and excluido_em is null`),
      );
      if (!p) throw new BadRequestException('O prêmio escolhido não existe mais. Recarregue a página e escolha de novo.');
      if (p.tipo === 'produto')
        throw new BadRequestException('O produto grátis no prêmio surpresa chega numa próxima entrega: escolha um desconto ou o frete grátis.');
    }
    depois.desde = depois.ativo ? (antes.ativo && antes.desde ? antes.desde : new Date().toISOString()) : null;
    if (JSON.stringify(antes) === JSON.stringify(depois)) return this.gatilhos(user.tenantId);
    const json = JSON.stringify({ entregue: depois });
    await this.db.execute(sql`
      insert into clube_config (tenant_id, surpresa_gatilhos, atualizado_por)
      values (${user.tenantId}::uuid, ${json}::jsonb, ${user.colaboradorId}::uuid)
      on conflict (tenant_id) do update
         set surpresa_gatilhos = coalesce(clube_config.surpresa_gatilhos, '{}'::jsonb) || ${json}::jsonb,
             atualizado_por = excluded.atualizado_por, atualizado_em = now()`);
    await this.auditar(user, 'clube_gatilho_alterado', user.tenantId, { gatilho: 'entregue', de: antes, para: depois });
    return this.gatilhos(user.tenantId);
  }

  /**
   * Salva o gatilho "Depois de uma reclamação" (A1b, sem migration). TODA recusa antes de gravar (V86): ligado precisa de
   * ao menos um prêmio; os prêmios existem nesta empresa e nenhum é "produto grátis" (o produto grátis no prêmio surpresa
   * chega depois). Grava SÓ a chave `reclamacao` do jsonb, mesclando no banco (V82). Auditado.
   */
  async salvarGatilhoReclamacao(user: AuthUser, dto: unknown): Promise<GatilhosDoSurpresa> {
    const parcial = lerGatilhoReclamacao(dto);
    const antes = (await this.gatilhos(user.tenantId)).reclamacao;
    const depois: GatilhoReclamacao = { ...antes, ...parcial };
    if (depois.ativo && !depois.premios.length) throw new BadRequestException('Escolha ao menos um prêmio que a equipe pode mandar.');
    if (depois.premios.length) {
      const linhas = this.rows(
        await this.db.execute(sql`
          select id, tipo from clube_premio
           where tenant_id = ${user.tenantId}::uuid and excluido_em is null
             and id in (${sql.join(depois.premios.map((id) => sql`${id}::uuid`), sql`, `)})`),
      );
      if (linhas.length !== depois.premios.length) throw new BadRequestException('Um dos prêmios escolhidos não existe mais. Recarregue a página e escolha de novo.');
      if (linhas.some((l) => l.tipo === 'produto'))
        throw new BadRequestException('O produto grátis no prêmio surpresa chega numa próxima entrega: escolha descontos ou o frete grátis.');
    }
    if (JSON.stringify(antes) === JSON.stringify(depois)) return this.gatilhos(user.tenantId);
    const json = JSON.stringify({ reclamacao: depois });
    await this.db.execute(sql`
      insert into clube_config (tenant_id, surpresa_gatilhos, atualizado_por)
      values (${user.tenantId}::uuid, ${json}::jsonb, ${user.colaboradorId}::uuid)
      on conflict (tenant_id) do update
         set surpresa_gatilhos = coalesce(clube_config.surpresa_gatilhos, '{}'::jsonb) || ${json}::jsonb,
             atualizado_por = excluded.atualizado_por, atualizado_em = now()`);
    await this.auditar(user, 'clube_gatilho_alterado', user.tenantId, { gatilho: 'reclamacao', de: antes, para: depois });
    return this.gatilhos(user.tenantId);
  }
}
