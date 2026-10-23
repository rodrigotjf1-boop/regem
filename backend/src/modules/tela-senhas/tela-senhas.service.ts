import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { and, eq, sql } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { equipamento } from '../../db/schema';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { edgeAtivo } from '../../common/edge-ativo';
import { idConfigDaLoja } from '../../common/id-deterministico';
import {
  CartaoDaTela,
  SOM_PADRAO,
  TEMPO_PRONTO_PADRAO,
  Tamanhos,
  erroDosTamanhos,
  montarQuadro,
  tamanhosDaTela,
  tempoProntoValido,
} from './tela-senhas.regras';

/* eslint-disable @typescript-eslint/no-explicit-any */

// Tela de senhas (Cozinha em estações, entrega 4): a TV do balcão com Preparando e Pronto, em /senhas, pareada como
// os outros equipamentos e SEM login. Só números — nada do cliente (LGPD).
//
// O que mora onde (mig 337):
//  · o tamanho das letras é de cada TV → `equipamento.tela_tamanhos` (a TV se configura no servidor da loja quando ele
//    está ligado, como o KDS, e não grava "último uso" a cada leitura — nada do outro lado desfaz o ajuste, ERR-235);
//  · o tempo em Pronto e o aviso sonoro valem para todas as telas → `kds_cor_config` (o ajuste do KDS, que sincroniza):
//    lidos campo a campo — loja → empresa → padrão (V59) — e gravados na linha da EMPRESA, a mesma que a tela de
//    ajustes do KDS grava. Criar a linha da LOJA aqui trocaria as cores do KDS daquela loja: a leitura do KDS pega a
//    linha da loja INTEIRA (auditoria do KDS, 20/10).

/** A janela da TV: a mesma da fila do KDS (os abertos das últimas 12 h). */
const JANELA_HORAS = 12;

export interface TelaDoQuadro {
  id: string;
  tenantId: string;
  unidadeId: string | null;
  nome: string;
  telaTamanhos: unknown;
}
type Ator = { id?: string | null; perfil?: string | null };

@Injectable()
export class TelaSenhasService {
  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly auditoria: AuditoriaService,
    @Optional() private readonly events?: EventEmitter2,
  ) {}

  /** O quadro da TV: a loja (logo e nome), os ajustes e as duas colunas. `agora` é a hora do servidor (a TV acerta o relógio por ela). */
  async quadro(tela: TelaDoQuadro) {
    const agora = new Date();
    const [ajustes, loja, cartoes] = await Promise.all([
      this.ajustesDaLoja(tela.tenantId, tela.unidadeId),
      this.lojaDaTela(tela.tenantId, tela.unidadeId),
      this.cartoes(tela.tenantId, tela.unidadeId),
    ]);
    return {
      agora: agora.toISOString(),
      tela: { id: tela.id, nome: tela.nome },
      loja,
      ajustes: { tamanhos: tamanhosDaTela(tela.telaTamanhos), prontoMin: ajustes.prontoMin, som: ajustes.som },
      ...montarQuadro(cartoes, agora, ajustes.prontoMin),
    };
  }

  /**
   * Os cartões de KDS dos pedidos que a TV olha: os que têm cartão aberto ou pronto nas últimas 12 h (a janela da fila
   * do KDS, com a encomenda cujo horário ainda não passou), com TODOS os cartões de KDS de cada um (o entregue conta
   * para saber se o pedido saiu). Da loja da TV ou sem loja (V4). Só o que a montagem usa — nada do cliente.
   */
  private async cartoes(tenantId: string, unidadeId: string | null): Promise<CartaoDaTela[]> {
    const daLoja = (a: string) => (unidadeId ? sql`and (${sql.raw(a)}.unidade_id = ${unidadeId}::uuid or ${sql.raw(a)}.unidade_id is null)` : sql``);
    const r: any = await this.db.execute(sql`
      select p.comanda_id::text as "comandaId", p.senha, p.senha_prefixo as "senhaPrefixo", p.status,
             p.criado_em as "criadoEm", p.pronto_em as "prontoEm"
        from producao_pedido p
       where p.tenant_id = ${tenantId} and p.destino_tipo = 'kds' and p.comanda_id is not null ${daLoja('p')}
         and p.comanda_id in (
               select q.comanda_id from producao_pedido q
                where q.tenant_id = ${tenantId} and q.destino_tipo = 'kds' and q.comanda_id is not null ${daLoja('q')}
                  and q.status in ('recebido', 'preparo', 'pronto')
                  and (q.criado_em > now() - interval '${sql.raw(String(JANELA_HORAS))} hours'
                       or exists (select 1 from pedido_externo pe
                                   where pe.tenant_id = q.tenant_id and pe.comanda_id = q.comanda_id
                                     and pe.agendamento > now() - interval '${sql.raw(String(JANELA_HORAS))} hours')))`);
    return (r.rows ?? r) as CartaoDaTela[];
  }

  /** Tempo em Pronto e aviso: campo a campo, loja → empresa → padrão. Lido por `to_jsonb`: não quebra num banco sem a 337. */
  async ajustesDaLoja(tenantId: string, unidadeId: string | null): Promise<{ prontoMin: number; som: boolean }> {
    const r: any = await this.db.execute(sql`
      select k.unidade_id is null as "daEmpresa", to_jsonb(k) ->> 'tela_pronto_min' as "prontoMin", to_jsonb(k) ->> 'tela_som' as som
        from kds_cor_config k
       where k.tenant_id = ${tenantId} and (k.unidade_id is null ${unidadeId ? sql`or k.unidade_id = ${unidadeId}::uuid` : sql``})`);
    const linhas = (r.rows ?? r) as { daEmpresa: boolean; prontoMin: string | null; som: string | null }[];
    const daLoja = unidadeId ? linhas.find((l) => !l.daEmpresa) : undefined;
    const daEmpresa = linhas.find((l) => l.daEmpresa);
    const tempo = (l?: { prontoMin: string | null }) => {
      const n = l?.prontoMin == null ? NaN : Number(l.prontoMin);
      return tempoProntoValido(n) ? n : undefined;
    };
    const som = (l?: { som: string | null }) => (l?.som === 'true' ? true : l?.som === 'false' ? false : undefined);
    return {
      prontoMin: tempo(daLoja) ?? tempo(daEmpresa) ?? TEMPO_PRONTO_PADRAO,
      som: som(daLoja) ?? som(daEmpresa) ?? SOM_PADRAO,
    };
  }

  /**
   * A logo e o nome da loja, os mesmos do cardápio online (Configurações › Loja): o da loja, senão o da empresa; sem nome
   * público, o nome da unidade e depois o da empresa. A logo é o endereço da imagem; na TV, se ela não carregar, entram
   * as iniciais.
   */
  async lojaDaTela(tenantId: string, unidadeId: string | null) {
    const r: any = await this.db.execute(sql`
      select c.unidade_id is null as "daEmpresa", c.nome_publico as "nomePublico", c.logo_ref as "logoRef", c.logo_emoji as "logoEmoji"
        from cardapio_config c
       where c.tenant_id = ${tenantId} and (c.unidade_id is null ${unidadeId ? sql`or c.unidade_id = ${unidadeId}::uuid` : sql``})`);
    const linhas = (r.rows ?? r) as { daEmpresa: boolean; nomePublico: string | null; logoRef: string | null; logoEmoji: string | null }[];
    const daLoja = unidadeId ? linhas.find((l) => !l.daEmpresa) : undefined;
    const daEmpresa = linhas.find((l) => l.daEmpresa);
    const campo = (k: 'nomePublico' | 'logoRef' | 'logoEmoji') => (daLoja?.[k] ?? '').trim() || (daEmpresa?.[k] ?? '').trim() || null;
    let nome = campo('nomePublico');
    if (!nome) {
      const n: any = await this.db.execute(sql`
        select (select u.nome from unidade u where u.id = ${unidadeId}::uuid and u.tenant_id = ${tenantId}) as unidade,
               (select e.nome from empresa e where e.id = ${tenantId}) as empresa`);
      const linha = (n.rows ?? n)[0] ?? {};
      nome = (linha.unidade ?? '').trim() || (linha.empresa ?? '').trim() || 'Senhas';
    }
    return { nome, logoRef: campo('logoRef'), logoEmoji: campo('logoEmoji') };
  }

  private async telaDaEmpresa(tenantId: string, id: string) {
    const [t] = await this.db
      .select()
      .from(equipamento)
      .where(and(eq(equipamento.id, id), eq(equipamento.tenantId, tenantId), eq(equipamento.tipo, 'tela_senhas')));
    if (!t) throw new NotFoundException('Tela de senhas não encontrada.');
    return t;
  }

  /** Os ajustes de uma TV para a gaveta do painel: os dela (tamanhos) e os de todas as telas (tempo e aviso), com a loja da prévia. */
  async ajustesDaTela(tenantId: string, id: string) {
    const t = await this.telaDaEmpresa(tenantId, id);
    const [loja, deTodas] = await Promise.all([this.lojaDaTela(tenantId, t.unidadeId ?? null), this.ajustesDaLoja(tenantId, t.unidadeId ?? null)]);
    return { tamanhos: tamanhosDaTela(t.telaTamanhos), prontoMin: deTodas.prontoMin, som: deTodas.som, loja };
  }

  /**
   * Salva os ajustes da TV. Ausente mantém (V16): só o que veio muda. Os tamanhos são desta TV; o tempo e o aviso valem
   * para todas as telas (linha da empresa do ajuste do KDS). Com o servidor da loja ligado, configura-se nele (como o KDS).
   * Mudou algo: auditoria (`configurou_tela_senhas`) e aviso às TVs, que se redesenham na hora.
   */
  async salvarAjustes(tenantId: string, id: string, dto: any, ator?: Ator) {
    const t = await this.telaDaEmpresa(tenantId, id);
    if (!t.ativo) throw new BadRequestException('Tela de senhas revogada não é editada.');
    if (await edgeAtivo(this.db, tenantId))
      throw new ForbiddenException('A tela de senhas desta loja é configurada pelo servidor local (edge) desta loja. Edite direto no servidor local.');
    const corpo = dto && typeof dto === 'object' ? dto : {};
    if (corpo.tamanhos !== undefined) {
      const erro = erroDosTamanhos(corpo.tamanhos);
      if (erro) throw new BadRequestException(erro);
    }
    if (corpo.prontoMin !== undefined && !tempoProntoValido(corpo.prontoMin))
      throw new BadRequestException('Tempo em Pronto inválido: escolha 2, 5, 10, 15, 20 ou 30 minutos, ou "até o balcão entregar".');
    if (corpo.som !== undefined && typeof corpo.som !== 'boolean') throw new BadRequestException('O aviso sonoro deve ser ligado ou desligado.');

    const antes = { tamanhos: tamanhosDaTela(t.telaTamanhos), ...(await this.ajustesDaLoja(tenantId, t.unidadeId ?? null)) };
    const depois = {
      tamanhos: corpo.tamanhos !== undefined ? (corpo.tamanhos as Tamanhos) : antes.tamanhos,
      prontoMin: corpo.prontoMin !== undefined ? (corpo.prontoMin as number) : antes.prontoMin,
      som: corpo.som !== undefined ? (corpo.som as boolean) : antes.som,
    };
    const mudouTamanho = JSON.stringify(depois.tamanhos) !== JSON.stringify(antes.tamanhos);
    const mudou = [
      ...(mudouTamanho ? ['tamanhos'] : []),
      ...(depois.prontoMin !== antes.prontoMin ? ['prontoMin'] : []),
      ...(depois.som !== antes.som ? ['som'] : []),
    ];
    if (!mudou.length) return depois;

    await this.db.transaction(async (tx: any) => {
      if (mudouTamanho)
        await tx.update(equipamento).set({ telaTamanhos: depois.tamanhos, updatedAt: new Date() }).where(eq(equipamento.id, t.id));
      if (mudou.includes('prontoMin') || mudou.includes('som')) {
        // Um comando só, pelo índice único da empresa e loja (mig 034, `uq_kds_cor_tenant_unidade`): duas gravações ao
        // mesmo tempo não criam duas linhas. Sem ajuste da empresa, a linha nasce com o padrão nas cores e etapas — o
        // mesmo que a leitura do KDS já usa quando não há linha.
        // id pela chave (mig 339): a linha que a nuvem e o servidor da loja criam é a MESMA.
        await tx.execute(sql`
          insert into kds_cor_config (id, tenant_id, unidade_id, tela_pronto_min, tela_som)
          values (${idConfigDaLoja('kds_cor_config', tenantId, null)}, ${tenantId}, null, ${depois.prontoMin}, ${depois.som})
          on conflict (tenant_id, (coalesce(unidade_id, '00000000-0000-0000-0000-000000000000'::uuid)))
          do update set tela_pronto_min = excluded.tela_pronto_min, tela_som = excluded.tela_som, updated_at = now()`);
      }
    });
    await this.auditoria.registrar({
      tenantId,
      unidadeId: t.unidadeId ?? null,
      atorId: ator?.id ?? null,
      atorPerfil: ator?.perfil ?? null,
      tipo: 'config',
      acao: 'configurou_tela_senhas',
      entidadeTipo: 'equipamento',
      entidadeId: t.id,
      detalhe: { nome: t.nome, antes, depois, mudou },
    });
    this.events?.emit('tela.senhas.mudou', { tenantId });
    return depois;
  }
}
