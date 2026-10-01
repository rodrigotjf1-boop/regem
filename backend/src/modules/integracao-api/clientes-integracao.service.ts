import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { codificarCursor, lerCursor, lerLimite, vinculoCursor } from './cursor-integracao';
import type { IntegracaoCtxData } from './integracao-token.guard';
import { fichaDoContrato, sqlContatoVisivel, sqlFichasContato } from './contato-integracao';
import { sqlIso } from './venda-integracao';
import { ATRASO_LEITURA_SEG } from './vendas-integracao.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

// LEITURA DOS CLIENTES da API de integração (RegemCast — mig 302; contrato em
// docs/integracao-regemcast.md). Os clientes são da EMPRESA (todas as lojas). Lê a tabela de
// versões (recurso `contato`, carimbado pelo carimbador) com o cursor de sempre e monta a ficha
// NA HORA — nada pessoal fica guardado na versão. Quem só comprou por marketplace não sai; pela
// 99, só com o escopo `vendas.99food.ler`. A lápide (`removido: true`) é o "Excluir conta" da
// LGPD — hoje o único jeito de um cliente sumir do Regem.

type Consulta = { cursor?: unknown; limite?: unknown };

@Injectable()
export class ClientesIntegracaoService {
  /** Atraso aplicado nesta instância (os testes encurtam; em produção é o da leitura das vendas). */
  atrasoSeg = ATRASO_LEITURA_SEG;

  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDB) {}

  private rows(r: any): any[] {
    return r?.rows ?? r ?? [];
  }

  async clientes(ctx: IntegracaoCtxData, q: Consulta) {
    const limite = lerLimite(q.limite);
    const vinculo = vinculoCursor(ctx.tenantId, ctx.unidadeId);
    const temCursor = q.cursor !== undefined && q.cursor !== '';
    const cur = temCursor ? lerCursor(q.cursor, 'contato', vinculo) : { posicao: null, desde: null };
    const com99 = ctx.escopos.includes('vendas.99food.ler');

    const linhas = this.rows(
      await this.db.execute(sql`
        select v.recurso_id::text as id, v.versao::text as versao, v.situacao,
               ${sqlIso(sql`v.atualizado_em`)} as atualizado_em
          from integracao_versao v
         where v.tenant_id = ${ctx.tenantId}::uuid and v.recurso = 'contato'
           and v.atualizado_em is not null
           and v.atualizado_em <= now() - make_interval(secs => ${this.atrasoSeg})
           ${
             cur.posicao
               ? sql`and (v.atualizado_em, v.recurso_id) > (${cur.posicao.t}::timestamptz, ${cur.posicao.i}::uuid)`
               : sql``
           }
           and ${sqlContatoVisivel(com99)}
         order by v.atualizado_em, v.recurso_id
         limit ${limite + 1}`),
    );
    const pagina = linhas.slice(0, limite);

    // A ficha de quem está vivo, lida AGORA (uma consulta para a página inteira).
    const vivos = pagina.filter((l) => l.situacao !== 'removido').map((l) => l.id as string);
    const fichas = new Map<string, any>();
    if (vivos.length) {
      for (const f of this.rows(await this.db.execute(sqlFichasContato(vivos)))) {
        if (f.tenant_id === ctx.tenantId) fichas.set(f.id, f);
      }
    }

    const itens = pagina.map((l) => {
      const base = { id: l.id as string, versao: Number(l.versao), atualizado_em: l.atualizado_em as string };
      const f = fichas.get(l.id);
      // Lápide — ou o cadastro sumiu depois do carimbo (a versão nova da exclusão vem em seguida).
      if (l.situacao === 'removido' || !f) return { ...base, removido: true };
      return { ...base, ...fichaDoContrato(f), criado_em: f.criado_em ?? null, removido: false };
    });
    const ultimo = pagina[pagina.length - 1];
    return {
      itens,
      proximo_cursor: codificarCursor('contato', vinculo, {
        posicao: ultimo ? { t: ultimo.atualizado_em, i: ultimo.id } : cur.posicao,
        desde: null,
      }),
      tem_mais: linhas.length > limite,
    };
  }
}
