import { Inject, Injectable } from '@nestjs/common';
import { sql, type SQL } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { sqlRecebeMarketing } from '../../common/marketing-quem-recebe';
import { perfilLigado, SEGMENTOS_DO_PERFIL, sqlAceiteClicado } from '../../common/segmentos-do-perfil';
import type { IntegracaoCtxData } from './integracao-token.guard';

/* eslint-disable @typescript-eslint/no-explicit-any */

// OS PÚBLICOS DO PERFIL pela API de integração (Liame — escopo `clientes.audiencias.ler`, mig 483; F9 parte 1 do
// `docs/plano-perfil-cliente.md`, §11). O Liame planeja campanha e mídia pelo TAMANHO de cada público: "312 campeões",
// "88 pedem no dinheiro no bolso". Só os números — nenhum cliente, nome, telefone ou código sai.
//
// OS PÚBLICOS são os MESMOS da campanha "pelo perfil" e da lista de Delivery › Clientes (`SEGMENTOS_DO_PERFIL`, um lugar
// só): o segmento RFM, "atrasado no ritmo", os selos do que move o cliente e "olharam e não pediram". A chave da porta é a
// do segmento sem o `perfil_` (o contrato não muda se o nome interno mudar).
//
// QUEM ENTRA NA CONTA: só o cliente DIRETO com perfil calculado (a linha de `cliente_perfil`). Por isso ficam de fora,
// sem regra a mais: quem só pediu pelo iFood ou pela 99 (o perfil nasce só dos pedidos diretos — D1; e o contrato do iFood,
// cl. 16.3.3, proíbe passar a terceiros "mesmo de forma agregada"), quem pediu "não quero ser analisado" (a escolha apaga o
// perfil e os selos na hora — `privacidade-do-cliente.ts`) e quem foi esquecido (o `esquecer-cliente` apaga o perfil).
// Nada vem das conversas do WhatsApp (Termos da Meta 4.1(b)) nem da camada 6 (o jeito de conversar).
//
// A LOJA: o token do Liame é de UMA loja. Na empresa de uma loja só, todos os clientes com perfil; com mais de uma, os que
// têm esta loja como a principal (`cliente_perfil.unidade_id` = onde ele mais pede). Token da empresa inteira: todos.
//
// "ACEITARAM OFERTAS" = quem receberia hoje uma campanha montada com o perfil: recebe marketing (sem SAIR, com telefone,
// cliente direto — `sqlRecebeMarketing`) E o último consentimento é um aceite CLICADO pelo próprio cliente (D4/D15 —
// `sqlAceiteClicado`; a caixa que já vinha marcada no checkout não conta).
//
// O NÚMERO PEQUENO: de 1 a 4 não se informa (`null`), para ninguém ser reconhecido pela contagem num público pequeno;
// zero sai como zero. SÓ NUVEM (o controller é `@CloudOnly()`; as tabelas do perfil não existem no servidor da loja).
// Uma consulta só, lida na hora; o módulo "Perfil do cliente" desligado devolve `perfil_ligado: false` e nenhum público.

/** O menor número informado: de 1 até um a menos, a contagem sai como `null`. */
export const MINIMO_DA_CONTAGEM = 5;

export type PublicoIntegracao = {
  chave: string;
  rotulo: string;
  grupo: 'segmento' | 'ritmo' | 'evento' | 'interesse';
  clientes: number | null;
  aceitaram_ofertas: number | null;
};

export type AudienciasIntegracao = {
  perfil_ligado: boolean;
  calculado_em: string | null;
  minimo: number;
  clientes_com_perfil: number | null;
  aceitaram_ofertas: number | null;
  publicos: PublicoIntegracao[];
};

/** A contagem como sai pela porta: de 1 a `MINIMO_DA_CONTAGEM - 1` vira `null`. */
export function contagemSegura(n: unknown): number | null {
  const v = Number(n ?? 0);
  if (!Number.isFinite(v) || v <= 0) return 0;
  return v < MINIMO_DA_CONTAGEM ? null : Math.trunc(v);
}

/** A chave do público na porta: a do segmento sem o `perfil_`. */
export const chaveDoPublico = (segmento: string): string => segmento.replace(/^perfil_/, '');

@Injectable()
export class AudienciasIntegracaoService {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDB) {}

  /** `GET /integracao/clientes/audiencias`: o tamanho de cada público do perfil na loja do token. */
  async audiencias(ctx: IntegracaoCtxData): Promise<AudienciasIntegracao> {
    if (!(await perfilLigado(this.db, ctx.tenantId))) {
      return { perfil_ligado: false, calculado_em: null, minimo: MINIMO_DA_CONTAGEM, clientes_com_perfil: null, aceitaram_ofertas: null, publicos: [] };
    }
    const segmentos = Object.entries(SEGMENTOS_DO_PERFIL);
    const daLoja: SQL =
      ctx.unidadeId && !ctx.lojaUnica ? sql`and cp0.unidade_id = ${ctx.unidadeId}::uuid` : sql``;
    // Cada valor da linha UMA vez (ERR-549): o aceite e a presença em cada público num `lateral … offset 0`; as contagens
    // só leem os booleanos.
    const colunas = sql.join(
      segmentos.map(([, d], i) => sql`(true ${d.cond}) as ${sql.raw(`s${i}`)}`),
      sql`, `,
    );
    const contagens = sql.join(
      segmentos.map(
        (_, i) =>
          sql`count(*) filter (where sg.${sql.raw(`s${i}`)})::int as ${sql.raw(`n${i}`)},
              count(*) filter (where sg.${sql.raw(`s${i}`)} and ac.ok)::int as ${sql.raw(`a${i}`)}`,
      ),
      sql`, `,
    );
    const r: any = await this.db.execute(sql`
      select count(*)::int as base,
             count(*) filter (where ac.ok)::int as base_aceite,
             max(cp0.calculado_em) as calculado_em,
             ${contagens}
        from cliente c
        join cliente_perfil cp0 on cp0.cliente_id = c.id and cp0.tenant_id = c.tenant_id
        cross join lateral (select (true ${sqlRecebeMarketing()} ${sqlAceiteClicado()}) as ok offset 0) ac
        cross join lateral (select ${colunas} offset 0) sg
       where c.tenant_id = ${ctx.tenantId}::uuid ${daLoja}`);
    const l: any = (r?.rows ?? r ?? [])[0] ?? {};
    const calculado = l.calculado_em ? new Date(l.calculado_em) : null;
    return {
      perfil_ligado: true,
      calculado_em: calculado && !Number.isNaN(calculado.getTime()) ? calculado.toISOString() : null,
      minimo: MINIMO_DA_CONTAGEM,
      clientes_com_perfil: contagemSegura(l.base),
      aceitaram_ofertas: contagemSegura(l.base_aceite),
      publicos: segmentos.map(([chave, d], i) => ({
        chave: chaveDoPublico(chave),
        rotulo: d.rotulo,
        grupo: d.grupo,
        clientes: contagemSegura(l[`n${i}`]),
        aceitaram_ofertas: contagemSegura(l[`a${i}`]),
      })),
    };
  }
}
