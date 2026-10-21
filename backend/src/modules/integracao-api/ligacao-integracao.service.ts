import { Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { gerarChave } from '../../dms/integracao-dms';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { avisarLigacaoNova } from './aviso-ligacao';
import { anotarChamada } from './chamada-integracao';
import type { EscopoIntegracao } from './escopos';
import { podeTrocar, TROCA_RECUSADA } from './ligacao.regras';
import { ProblemaException } from './problema';
import { formatoTokenIntegracao } from './token-integracao';
import { validarTokenIntegracao } from './validar-token-integracao';

/* eslint-disable @typescript-eslint/no-explicit-any */

/** A ligação entregue na troca: o segredo em claro sai aqui e em mais lugar nenhum. */
export type LigacaoEntregue = {
  ligacao: string;
  prefixo: string;
  /** A loja da ligação (`null` = a empresa inteira, como o token de onde ela veio). */
  loja_id: string | null;
  /** O que a loja autorizou (a chamada vale com estas E as que o token do DMS ID tiver). */
  permissoes: EscopoIntegracao[];
  segredo_em: string;
};

/**
 * A TROCA AUTOMÁTICA do Hub DMS (F3, parte A; decisão F2-3): o aplicativo do DMS ID manda o token dele e o `rgm_it_`
 * que já usa naquela loja, e recebe o segredo da ligação (`dms_lg_regem_…`). A ligação é o MESMO acesso (o id do token,
 * com a loja, os escopos e quem autorizou de lá) apresentado de outra forma.
 *
 * Repetir a troca GIRA o segredo: o anterior para de valer na hora, e quem chama guarda o da última resposta (a
 * resposta perdida se resolve trocando de novo). Token inexistente, revogado, vencido, de loja apagada ou de outro
 * aplicativo: a mesma recusa (`ligacao-invalida`). Ligação revogada sozinha não volta pela troca.
 */
@Injectable()
export class LigacaoIntegracaoService {
  private readonly log = new Logger('LigacaoIntegracao');

  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly auditoria: AuditoriaService,
  ) {}

  private async rows(q: any): Promise<any[]> {
    const r: any = await this.db.execute(q);
    return r.rows ?? r;
  }

  async trocar(tokenIntegracao: unknown, aplicativo: string, aplicativos: Readonly<Record<string, string>>): Promise<LigacaoEntregue> {
    const recusar = (motivo: string): never => {
      this.log.warn(`troca automática recusada: ${motivo}`);
      throw new ProblemaException(401, 'ligacao-invalida', TROCA_RECUSADA);
    };
    if (!formatoTokenIntegracao(tokenIntegracao)) return recusar('token_integracao fora do formato');
    const t = await validarTokenIntegracao(this.db, tokenIntegracao);
    if (!t) return recusar('token desconhecido, revogado, vencido ou de loja apagada');
    if (!podeTrocar(t.cliente, aplicativo, aplicativos)) {
      return recusar(`token ${t.prefixo}… do cliente ${t.cliente}: o aplicativo não é o que a distribuição cadastrou para ele`);
    }

    // Uma instrução só: cria a ligação com o id do token ou gira o segredo dela. A empresa sai do token (nunca do
    // corpo); token revogado entre a conferência e aqui, ou ligação revogada sozinha, não devolvem linha.
    const { chave, resumo, prefixo } = gerarChave('lg', 'regem');
    // O registro do hub (F3 A2): a loja e o prefixo visível da ligação nova (nunca o segredo).
    anotarChamada({ conta: t.unidadeId ?? t.tenantId, tenantId: t.tenantId, ligacaoPrefixo: prefixo });
    const [feita] = await this.rows(sql`
      with token as (
        select id, tenant_id, criado_em from integracao_token_loja
         where id = ${t.tokenId}::uuid and revogado_em is null
      ), ligacao as (
        insert into integracao_ligacao (id, tenant_id, aplicativo, prefixo, segredo_hash)
        select token.id, token.tenant_id, ${aplicativo}, ${prefixo}, ${resumo} from token
        on conflict (id) do update
           set aplicativo = excluded.aplicativo, prefixo = excluded.prefixo,
               segredo_hash = excluded.segredo_hash, segredo_em = now()
         where integracao_ligacao.revogado_em is null
        returning criado_em = segredo_em as criada, segredo_em
      )
      select ligacao.criada, ligacao.segredo_em, token.criado_em as liberado_em
        from ligacao cross join token`);
    if (!feita) return recusar(`token ${t.prefixo}… revogado durante a troca, ou a ligação dele foi revogada`);

    await this.auditoria.registrar({
      tenantId: t.tenantId,
      unidadeId: t.unidadeId,
      atorTipo: 'integracao',
      tipo: 'integracao',
      acao: feita.criada ? 'integracao.ligacao_criada' : 'integracao.ligacao_girada',
      origem: 'integracao',
      entidadeTipo: 'integracao_ligacao',
      entidadeId: t.tokenId,
      detalhe: { cliente: t.cliente, prefixo, token: t.prefixo },
    });
    // A ligação nasceu agora de um token antigo: o dono fica sabendo que a forma mudou (o alcance, não). Nunca rejeita.
    if (feita.criada) {
      void avisarLigacaoNova(this.db, {
        tenantId: t.tenantId,
        unidadeId: t.unidadeId,
        cliente: t.cliente,
        liberadoEm: new Date(feita.liberado_em),
        desde: new Date(feita.segredo_em),
      });
    }
    return {
      ligacao: chave,
      prefixo,
      loja_id: t.unidadeId,
      permissoes: t.escopos,
      segredo_em: new Date(feita.segredo_em).toISOString(),
    };
  }
}
