import { Inject, Injectable, Logger, OnModuleInit, Optional } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { horaNoFuso } from '../../common/data';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { MuralService } from '../mural/mural.service';
import { MisterEntradaService, QuemTocou } from './mister-entrada.service';
import { MisterNumeroService } from './mister-numero.service';
import { PREFIXO_DO_RECADO, TEXTOS_DO_RECADO, VALIDADE_DO_RECADO_MIN, lerBotaoDoRecado, partesDoRecado } from './mister-recado';

/* eslint-disable @typescript-eslint/no-explicit-any */

// M3g parte 2 — O RECADO NO MURAL (mig 444; versão 3 do protótipo `mockups/regem-mister.html`, conversa 22). A ferramenta
// `escrever_recado` guarda o rascunho e a resposta leva "Publicar" e "Mudar o texto". O toque chega aqui pelo prefixo
// `rec:`: "Publicar" marca o rascunho (gravação condicional: o toque duplo publica uma vez) e publica pelo MESMO serviço
// da tela do Mural & clima, em nome de quem pediu; "Mudar o texto" descarta e a pessoa diz como quer.
//
// Quem toca tem de ser quem pediu, com o vínculo valendo agora; o gerente, só na loja dele. Só na nuvem (o módulo do
// agente só sobe lá); o comunicado desce para a loja pelo sync de sempre.

const linhas = (r: any) => (r?.rows ?? r ?? []) as any[];
const semTabela = (e: any) => ['42P01', '42703'].includes(e?.code) || ['42P01', '42703'].includes(e?.cause?.code);

export interface NovoRecado {
  /** A loja do mural; null = todas as lojas da empresa. */
  unidadeId: string | null;
  lojaNome: string;
  texto: string;
}

@Injectable()
export class MisterRecadosService implements OnModuleInit {
  private readonly logger = new Logger('MisterRecados');

  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    @Optional() private readonly mural?: MuralService,
    @Optional() private readonly entrada?: MisterEntradaService,
    @Optional() private readonly numero?: MisterNumeroService,
    @Optional() private readonly auditoria?: AuditoriaService,
  ) {}

  onModuleInit(): void {
    this.entrada?.registrarBotao(PREFIXO_DO_RECADO, (botaoId, quem) => this.tocou(botaoId, quem));
  }

  /**
   * Guarda o rascunho de quem pediu (o anterior dele, ainda esperando, é descartado na mesma transação: um botão velho
   * nunca publica um texto que a pessoa já trocou). Devolve o id e até quando vale.
   */
  async criar(quem: { tenantId: string; colaboradorId: string }, novo: NovoRecado): Promise<{ id: string; vence: Date } | { erro: string }> {
    try {
      const [r] = await this.db.transaction(async (tx: any) => {
        await tx.execute(sql`
          update mister_recado set situacao = 'descartado', respondido_em = clock_timestamp()
           where tenant_id = ${quem.tenantId}::uuid and colaborador_id = ${quem.colaboradorId}::uuid and situacao = 'rascunho'`);
        return linhas(
          await tx.execute(sql`
            insert into mister_recado (tenant_id, unidade_id, colaborador_id, texto, loja_nome, vence_em)
            values (${quem.tenantId}::uuid, ${novo.unidadeId}::uuid, ${quem.colaboradorId}::uuid, ${novo.texto}, ${novo.lojaNome},
                    clock_timestamp() + make_interval(mins => ${VALIDADE_DO_RECADO_MIN}::int))
            returning id::text as id, vence_em as "venceEm"`),
        );
      });
      return { id: r.id, vence: new Date(r.venceEm) };
    } catch (e: any) {
      if (!semTabela(e)) this.logger.error(`o rascunho do recado não foi guardado — ${e?.message ?? e}`, e?.stack);
      return { erro: TEXTOS_DO_RECADO.naoDa };
    }
  }

  /** O toque em "Publicar" ou "Mudar o texto". `false` = o botão não é deste serviço (ou o recado não existe). */
  async tocou(botaoId: string, quem: QuemTocou): Promise<boolean> {
    const b = lerBotaoDoRecado(botaoId);
    if (!b) return false;
    let r: any;
    try {
      [r] = linhas(await this.db.execute(sql`${this.colunas()} where id = ${b.id}::uuid`));
    } catch (e: any) {
      if (semTabela(e)) return false;
      throw e;
    }
    if (!r) return false;
    // Só quem pediu, com o vínculo valendo agora (rebaixado ou desligado não aparece entre os vínculos). O gerente presa a
    // uma loja só publica nela: se mudou de loja depois do rascunho, ou o recado é de todas as lojas, não publica. (O
    // gerente sem loja só existe na empresa de uma loja só.)
    const v = quem.vinculos.find((x) => x.tenantId === r.tenantId && x.colaboradorId === r.colaboradorId);
    if (!v || (v.nivel !== 'presidente' && v.unidadeId && r.unidadeId !== v.unidadeId)) {
      await this.dizer(quem.telefone, TEXTOS_DO_RECADO.naoDisponivel);
      return true;
    }

    if (b.acao === 'mudar') {
      const [d] = linhas(
        await this.db.execute(sql`
          update mister_recado set situacao = 'descartado', respondido_em = clock_timestamp()
           where id = ${b.id}::uuid and situacao = 'rascunho' and vence_em > now()
          returning id::text as id`),
      );
      await this.dizer(quem.telefone, d ? TEXTOS_DO_RECADO.mudar : await this.fraseDoEstado(b.id));
      return true;
    }

    // "Publicar": a gravação condicional reserva o rascunho (o toque duplo e a réplica a mais publicam uma vez).
    const [reservado] = linhas(
      await this.db.execute(sql`
        update mister_recado set situacao = 'publicado', respondido_em = clock_timestamp()
         where id = ${b.id}::uuid and situacao = 'rascunho' and vence_em > now()
        returning id::text as id`),
    );
    if (!reservado) {
      await this.dizer(quem.telefone, await this.fraseDoEstado(b.id));
      return true;
    }
    let comunicadoId: string;
    try {
      if (!this.mural) throw new Error('o serviço do mural não está neste servidor');
      const { titulo, corpo } = partesDoRecado(String(r.texto));
      // O MESMO serviço da tela, em nome de quem pediu: o mural mostra a pessoa como autora.
      const usuario = { tenantId: r.tenantId, colaboradorId: r.colaboradorId, unidadeId: r.unidadeId ?? null, categoria: v.nivel } as any;
      const com: any = await this.mural.publicar(
        usuario,
        r.unidadeId ? { titulo, corpo: corpo ?? undefined, audiencia: 'loja', unidadeId: r.unidadeId } : { titulo, corpo: corpo ?? undefined, audiencia: 'rede' },
      );
      comunicadoId = String(com.id);
    } catch (e: any) {
      // Não publicou: o rascunho volta a esperar (o toque seguinte tenta de novo).
      this.logger.error(`o recado ${b.id} não foi publicado — ${e?.message ?? e}`, e?.stack);
      await this.db.execute(sql`update mister_recado set situacao = 'rascunho', respondido_em = null where id = ${b.id}::uuid and situacao = 'publicado' and comunicado_id is null`);
      await this.dizer(quem.telefone, TEXTOS_DO_RECADO.falhou);
      return true;
    }
    const [feito] = linhas(
      await this.db.execute(sql`
        update mister_recado set comunicado_id = ${comunicadoId}::uuid where id = ${b.id}::uuid
        returning respondido_em as "respondidoEm"`),
    );
    await this.auditoria
      ?.registrar({
        tenantId: r.tenantId,
        atorId: r.colaboradorId,
        atorPerfil: v.nivel,
        tipo: 'mister',
        acao: 'mister_recado_publicado',
        entidadeTipo: 'comunicado',
        entidadeId: comunicadoId,
        detalhe: { recado: b.id, loja: r.lojaNome },
        origem: 'whatsapp',
      } as any)
      .catch((e: any) => this.logger.warn(`a auditoria do recado ${b.id} falhou — ${e?.message ?? e}`));
    await this.dizer(quem.telefone, TEXTOS_DO_RECADO.publicado(String(r.lojaNome), horaNoFuso(new Date(feito?.respondidoEm ?? Date.now()))));
    return true;
  }

  private colunas() {
    return sql`
      select id::text as id, tenant_id::text as "tenantId", unidade_id::text as "unidadeId", colaborador_id::text as "colaboradorId",
             texto, loja_nome as "lojaNome", situacao, (vence_em > now()) as "vale", respondido_em as "respondidoEm"
        from mister_recado`;
  }

  /** O que dizer ao toque que não pegou o rascunho esperando: já publicado, trocado ou vencido. */
  private async fraseDoEstado(id: string): Promise<string> {
    const [r] = linhas(await this.db.execute(sql`${this.colunas()} where id = ${id}::uuid`));
    if (r?.situacao === 'publicado') return TEXTOS_DO_RECADO.jaPublicado(horaNoFuso(new Date(r.respondidoEm)));
    if (r?.situacao === 'descartado') return TEXTOS_DO_RECADO.trocado;
    return TEXTOS_DO_RECADO.venceu;
  }

  private async dizer(telefone: string, texto: string): Promise<void> {
    try {
      await this.numero?.enviar(telefone, { texto });
    } catch (e: any) {
      this.logger.warn(`a resposta do recado não saiu (${e?.motivo ?? e?.message ?? e})`);
    }
  }
}
