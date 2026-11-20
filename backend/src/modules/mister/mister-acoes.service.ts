import { Inject, Injectable, Logger, OnModuleInit, Optional } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { uuidDeChave } from '../../common/id-deterministico';
import { horaNoFuso } from '../../common/data';
import { pausaVigenteDoCanal, type CanalDaPausa } from '../../common/pausa-do-canal';
import { podeAcessar } from '../../auth/permissoes';
import type { AuthUser } from '../../auth/auth-user';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { DeliveryService } from '../delivery/delivery.service';
import { PausaDoCanalService } from '../delivery/pausa-do-canal.service';
import { pedidoComoNoQuadro } from './mister-agente.regras';
import {
  ACOES,
  AcaoDoMister,
  ParametrosDaAcao,
  TEXTOS_DAS_ACOES,
  conferirAcao,
  ehAcaoDoMister,
  nomesDosCanais,
  pedidoAndou,
  pedidoServe,
  resumoDoPedido,
} from './mister-acoes';
import { EscopoDoMister, MisterFerramentasService, ResultadoDaFerramenta } from './mister-ferramentas.service';
import { MisterNumeroService } from './mister-numero.service';
import { botoesDaProposta } from './mister-procedimentos';
import { MisterPropostasService } from './mister-propostas.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

// AS AÇÕES DO MISTER (versão 6, M6j; `mister-acoes.ts` tem o catálogo e as conferências). A ferramenta `propor_acao` confere
// a ação, a permissão do perfil (a MESMA da rota da tela) e o alvo, e grava a proposta de botão (`mister_proposta`, a mesma
// das F4.x) com QUEM pediu; o "Autorizar" dessa pessoa executa pelo MESMO serviço da tela e o efeito é conferido na hora,
// pelo estado que ficou. Sem migration: o procedimento da proposta é texto, e as ações entram no catálogo do código.

const linhas = (r: any) => (r?.rows ?? r ?? []) as any[];
const semTabela = (e: any) => ['42P01', '42703'].includes(e?.code) || ['42P01', '42703'].includes(e?.cause?.code);
const recusa = (erro: string): ResultadoDaFerramenta => ({ ok: false, dados: { erro } });
type AcaoDePedido = 'aceitar_pedido' | 'pedido_pronto' | 'despachar_pedido';
const NOME_DA_SITUACAO: Record<string, string> = { novo: 'aguardando aceite', confirmado: 'em preparo', pronto: 'pronto', despachado: 'a caminho', concluido: 'concluído', entregue: 'entregue', cancelado: 'cancelado' };

@Injectable()
export class MisterAcoesService implements OnModuleInit {
  private readonly logger = new Logger('MisterAcoes');

  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly ferramentas: MisterFerramentasService,
    private readonly propostas: MisterPropostasService,
    @Optional() private readonly numero?: MisterNumeroService,
    @Optional() private readonly delivery?: DeliveryService,
    @Optional() private readonly pausa?: PausaDoCanalService,
    @Optional() private readonly auditoria?: AuditoriaService,
  ) {}

  onModuleInit(): void {
    this.ferramentas.registrarAcoes((e, en, loja) => this.propor(e, en, loja));
    this.propostas.registrarAcao((p) => this.executar(p));
  }

  // ───────────────────────────── propor ─────────────────────────────

  /** A ferramenta `propor_acao`. Nunca lança: o erro vira a frase que volta à IA. */
  async propor(e: EscopoDoMister, en: Record<string, unknown>, loja: { atual: string | null; nome: string }): Promise<ResultadoDaFerramenta> {
    try {
      if (e.nivel !== 'presidente' && e.nivel !== 'gerente') return recusa(TEXTOS_DAS_ACOES.soGestor);
      const c = conferirAcao(en.acao, en);
      if ('erro' in c) return recusa(c.erro);
      const def = ACOES[c.parametros.acao];
      if (e.nivel !== 'presidente' && !podeAcessar(e.permissoes, def.permissao)) return recusa(TEXTOS_DAS_ACOES.semPermissao);
      if (this.numero && (await this.numero.ler()).provedor === 'evolution') return recusa(TEXTOS_DAS_ACOES.semBotao);
      // A loja: a da conversa (o gerente, a dele); a empresa de uma loja só, ela.
      const lojas = loja.atual ? [loja.atual] : e.lojas.map((l) => l.id);
      if (!lojas.length && !e.lojaUnica) return recusa(TEXTOS_DAS_ACOES.semPermissao);
      let unidadeId: string | null = loja.atual ?? (e.lojaUnica ? (e.lojas[0]?.id ?? null) : null);
      let resumo = c.resumo;
      const parametros: Record<string, unknown> = { ...c.parametros, colaboradorId: e.colaboradorId, nivel: e.nivel };
      let alvo: string = c.parametros.acao;
      if (c.parametros.acao === 'aceitar_pedido' || c.parametros.acao === 'pedido_pronto' || c.parametros.acao === 'despachar_pedido') {
        const achado = await this.acharPedido(e.tenantId, c.parametros.numero, e.lojaUnica && !loja.atual ? null : lojas);
        if ('erro' in achado) return recusa(achado.erro);
        const fora = pedidoServe(c.parametros.acao, achado);
        if (fora) return recusa(fora);
        unidadeId = achado.unidadeId;
        parametros.pedidoId = achado.id;
        parametros.pedido = achado.nome;
        resumo = resumoDoPedido(c.parametros.acao, achado.nome);
        alvo = achado.id;
      } else if ((c.parametros.acao === 'pausar_canal' || c.parametros.acao === 'reabrir_canal') && c.parametros.canais.includes('cardapio') && this.pausa) {
        // O cardápio digital é de cada loja: quem diz qual é o serviço da tela (o cadastro do cardápio), já na pergunta.
        try {
          const l = await this.pausa.lojaDoCardapio(e.tenantId, unidadeId);
          if (!l.tem) return recusa('Esta loja não tem cardápio digital para pausar.');
        } catch {
          return recusa('A empresa tem mais de um cardápio digital: diga de qual loja é a pausa.');
        }
      }
      const p = await this.gravar(e, c.parametros.acao, unidadeId, parametros, `${alvo}:${unidadeId ?? 'empresa'}`);
      if (!p) return recusa('Essa mesma ação já foi autorizada e está em andamento; o resultado chega na conversa.');
      return {
        ok: true,
        dados: {
          oQueVouFazer: resumo,
          siga: 'Mostre o "oQueVouFazer" como veio e diga que os botões "Autorizar" e "Não agora" chegam logo abaixo. Nada é feito sem o "Autorizar". Não diga que fez.',
        },
        mensagens: [{ texto: TEXTOS_DAS_ACOES.pergunta(resumo, def.prazoMin), botoes: botoesDaProposta(p) }],
      };
    } catch (err: any) {
      if (semTabela(err)) return recusa('As ações do Mister ainda não estão disponíveis neste servidor.');
      this.logger.error(`a ação não foi proposta: ${String(err?.message ?? err).slice(0, 300)}`, err?.stack);
      return recusa('Não consegui preparar a ação agora.');
    }
  }

  /** O pedido pelo número do painel, nas lojas da pessoa, nas últimas 24 horas (a mesma busca do cancelamento). */
  private async acharPedido(tenantId: string, dito: string, lojas: string[] | null): Promise<{ id: string; unidadeId: string | null; status: string; tipo: string | null; nome: string } | { erro: string }> {
    if (!/^[A-Za-z0-9-]{1,40}$/.test(dito)) return { erro: 'Diga o número do pedido como aparece no painel do Delivery.' };
    const numeroDoDia = /^\d{1,9}$/.test(dito) ? Number(dito) : null;
    const achados = linhas(
      await this.db.execute(sql`
        select pe.id::text as id, pe.unidade_id::text as "unidadeId", pe.canal, pe.numero, pe.display_id as "displayId", pe.status, pe.tipo
          from pedido_externo pe
         where pe.tenant_id = ${tenantId}::uuid and pe.deleted_at is null
           ${lojas ? sql`and (pe.unidade_id is null or pe.unidade_id in (${sql.join(lojas.map((l) => sql`${l}::uuid`), sql`, `)}))` : sql``}
           and pe.criado_em > now() - interval '24 hours'
           and (pe.display_id = ${dito} ${numeroDoDia != null ? sql`or pe.numero = ${numeroDoDia}` : sql``})
         order by pe.criado_em desc
         limit 6`),
    );
    if (!achados.length) return { erro: TEXTOS_DAS_ACOES.naoAchado };
    const abertos = achados.filter((a) => a.status !== 'concluido');
    if (abertos.length > 1) return { erro: TEXTOS_DAS_ACOES.maisDeUm };
    const a = abertos[0] ?? achados[0];
    return { id: a.id, unidadeId: a.unidadeId ?? null, status: String(a.status), tipo: a.tipo ?? null, nome: pedidoComoNoQuadro(a) };
  }

  /**
   * Grava a proposta de botão: uma por pessoa, ação e alvo (o "aviso" da linha é um id fixo pela chave — o índice único da 428
   * não deixa duas). Renova a que acabou (vencida, não autorizada, não deu ou feita: a mesma ação pode ser pedida de novo
   * depois); a autorizada e a executando não renovam (null).
   */
  private async gravar(e: EscopoDoMister, acao: AcaoDoMister, unidadeId: string | null, parametros: Record<string, unknown>, alvo: string): Promise<string | null> {
    const def = ACOES[acao];
    const avisoId = uuidDeChave('mister:acao:', e.tenantId, ':', e.colaboradorId, ':', acao, ':', alvo);
    await this.db.execute(sql`
      insert into mister_proposta (tenant_id, unidade_id, aviso_id, procedimento, parametros, nivel, vence_em)
      values (${e.tenantId}::uuid, ${unidadeId}::uuid, ${avisoId}::uuid, ${acao}, ${JSON.stringify(parametros)}::jsonb, ${def.nivel},
              clock_timestamp() + make_interval(mins => ${def.prazoMin}::int))
      on conflict (aviso_id, procedimento) do update
        set situacao = 'proposta', criada_em = clock_timestamp(), vence_em = excluded.vence_em, parametros = excluded.parametros,
            unidade_id = excluded.unidade_id, respondida_em = null, autorizada_por = null, telefone_final = null, executada_em = null,
            conferir_ate = null, concluida_em = null, resultado = null
        where mister_proposta.situacao in ('vencida', 'recusada', 'nao_deu', 'feita', 'proposta')`);
    const [p] = linhas(
      await this.db.execute(sql`
        select id::text as id from mister_proposta
         where aviso_id = ${avisoId}::uuid and procedimento = ${acao} and situacao = 'proposta' and vence_em > now()`),
    );
    return p?.id ?? null;
  }

  // ───────────────────────────── executar ─────────────────────────────

  /**
   * Executa a ação autorizada pelo MESMO serviço da tela, com a permissão conferida de novo (o perfil pode ter mudado desde a
   * pergunta) e confere o efeito pelo estado que ficou. Devolve o desfecho; quem grava "feita"/"não deu" e avisa a pessoa é
   * o serviço das propostas.
   */
  async executar(p: { id: string; tenantId: string; unidadeId: string | null; procedimento: string; parametros: any; autorizadaPor: string | null }): Promise<{ feita: boolean; texto: string }> {
    if (!ehAcaoDoMister(p.procedimento)) return { feita: false, texto: 'essa ação não existe mais. Nada foi feito.' };
    const quem = p.autorizadaPor;
    if (!quem || quem !== String(p.parametros?.colaboradorId ?? '')) return { feita: false, texto: 'a ação só vale com o "Autorizar" de quem pediu. Nada foi feito.' };
    const e = await this.ferramentas.escopoDaTela(p.tenantId, quem);
    const def = ACOES[p.procedimento];
    if (!e || (e.nivel !== 'presidente' && !podeAcessar(e.permissoes, def.permissao))) return { feita: false, texto: 'o seu perfil não dá mais acesso ao Delivery. Nada foi feito.' };
    const parametros = p.parametros as ParametrosDaAcao & { pedidoId?: string; pedido?: string };
    const user: AuthUser = { tenantId: p.tenantId, colaboradorId: quem, categoria: e.nivel, unidadeId: e.nivel === 'presidente' ? null : (p.unidadeId ?? null), nome: e.nome ?? null } as AuthUser;
    const motivo = (err: any) => String(err?.response?.message ?? err?.message ?? 'o serviço recusou').slice(0, 240);
    try {
      if (parametros.acao === 'pausar_canal' || parametros.acao === 'reabrir_canal') {
        if (!this.pausa) return { feita: false, texto: 'a pausa dos canais não está disponível agora. Nada foi feito.' };
        if (parametros.acao === 'pausar_canal') {
          await this.pausa.pausar(user, p.unidadeId, {
            canais: parametros.canais,
            motivo: parametros.motivo,
            motivoTexto: parametros.motivoTexto,
            tempo: parametros.minutos !== null ? { minutos: parametros.minutos } : { ate: parametros.ate },
            tempo99: parametros.fimDoDia ? { fimDoDia: true } : { minutos: parametros.minutos },
          } as any);
        } else {
          for (const canal of parametros.canais) await this.pausa.reabrir(user, p.unidadeId, canal);
        }
        return await this.conferirCanais(p.tenantId, p.unidadeId, parametros.canais, parametros.acao === 'pausar_canal');
      }
      if (!this.delivery) return { feita: false, texto: 'o painel do Delivery não está disponível agora. Nada foi feito.' };
      const pedidoId = String(parametros.pedidoId ?? '');
      const pedido = String(parametros.pedido ?? 'do Mister');
      if (parametros.acao === 'aceitar_pedido') await this.delivery.aceitar(p.tenantId, quem, pedidoId);
      else if (parametros.acao === 'pedido_pronto') await this.delivery.avancar(p.tenantId, pedidoId, { de: 'confirmado' });
      else await this.delivery.despachar(p.tenantId, pedidoId);
      return await this.conferirPedido(p.tenantId, pedidoId, parametros.acao, pedido);
    } catch (err: any) {
      // A recusa do serviço (outra pessoa já mexeu, o canal não está disponível) vem antes de mudar o que ele recusa. Se o
      // efeito apareceu mesmo assim, a conferência diz o que foi FEITO.
      const depois =
        parametros.acao === 'pausar_canal' || parametros.acao === 'reabrir_canal'
          ? await this.conferirCanais(p.tenantId, p.unidadeId, parametros.canais, parametros.acao === 'pausar_canal')
          : await this.conferirPedido(p.tenantId, String(parametros.pedidoId ?? ''), parametros.acao as AcaoDePedido, String(parametros.pedido ?? ''));
      if (depois.feita) return depois;
      return { feita: false, texto: TEXTOS_DAS_ACOES.recusado(motivo(err)) };
    } finally {
      await this.auditoria
        ?.registrar({ tenantId: p.tenantId, atorId: quem, atorPerfil: e.nivel, tipo: 'mister', acao: 'mister_acao', entidadeTipo: 'mister_proposta', entidadeId: p.id, origem: 'whatsapp', detalhe: { acao: p.procedimento } } as any)
        .catch(() => undefined);
    }
  }

  /** Os canais ficaram como a ação pediu? (a pausa que vale agora, da loja ou da empresa toda). */
  private async conferirCanais(tenantId: string, unidadeId: string | null, canais: CanalDaPausa[], pausados: boolean): Promise<{ feita: boolean; texto: string }> {
    const estado: { canal: CanalDaPausa; ate: Date | null }[] = [];
    for (const c of canais) {
      const v: any = await pausaVigenteDoCanal(this.db, tenantId, unidadeId, c);
      estado.push({ canal: c, ate: v?.ate ? new Date(v.ate) : null });
    }
    const certos = estado.filter((x) => (pausados ? !!x.ate : !x.ate));
    if (certos.length !== canais.length) {
      const faltam = estado.filter((x) => !certos.includes(x)).map((x) => x.canal);
      return { feita: false, texto: `${nomesDosCanais(faltam)} não ficou(aram) ${pausados ? 'pausado(s)' : 'aberto(s)'}. Confira no painel do Delivery.` };
    }
    if (!pausados) return { feita: true, texto: TEXTOS_DAS_ACOES.reaberto(nomesDosCanais(canais)) };
    const voltas = estado.map((x) => `${nomesDosCanais([x.canal])} até as ${horaNoFuso(x.ate!)}`).join('; ');
    return { feita: true, texto: `${TEXTOS_DAS_ACOES.pausado(nomesDosCanais(canais))} (${voltas}).` };
  }

  /** O pedido andou para a situação de depois da ação? */
  private async conferirPedido(tenantId: string, pedidoId: string, acao: AcaoDePedido, pedido: string): Promise<{ feita: boolean; texto: string }> {
    const [r] = linhas(await this.db.execute(sql`select status from pedido_externo where id = ${pedidoId}::uuid and tenant_id = ${tenantId}::uuid`));
    if (!r) return { feita: false, texto: 'o pedido não foi encontrado. Nada foi feito.' };
    if (pedidoAndou(acao, String(r.status))) return { feita: true, texto: TEXTOS_DAS_ACOES.pedidoFeito(acao, pedido) };
    return { feita: false, texto: TEXTOS_DAS_ACOES.naoAndou(pedido, NOME_DA_SITUACAO[String(r.status)] ?? String(r.status)) };
  }
}
