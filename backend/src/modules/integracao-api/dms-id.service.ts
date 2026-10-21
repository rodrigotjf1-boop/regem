import { Injectable, Logger } from '@nestjs/common';
import { ChavesDmsId, conferirTokenDmsId, ErroPermissaoFaltando, type TokenDmsId } from '../../dms/integracao-dms';
import type { EscopoIntegracao } from './escopos';
import {
  enderecoDosMetadados,
  lerConfigDmsId,
  PERMISSOES_DO_RECURSO,
  permissoesDoCatalogo,
  type ConfigDmsId,
} from './ligacao.regras';

// O DMS ID do lado do Regem (Hub DMS, F3, parte A): confere o token que chega na API de integração e diz onde estão os
// metadados do recurso (RFC 9728).
//
// Tudo nasce desligado (`DMS_ID_LIGADO`): desligado, a API segue só com o `rgm_it_`, como sempre foi. A configuração é
// lida do ambiente a cada chamada (relida só quando muda), e as chaves públicas do DMS ID ficam guardadas
// (`ChavesDmsId` do pacote comum): buscadas de novo a cada 10 minutos ou quando chega um `kid` novo e, se o DMS ID
// cair, o token já emitido continua conferível com as que estão guardadas. O Regem não chama o DMS ID a cada pedido.

/** O token conferido, com as permissões já recortadas no catálogo do Regem. */
export type TokenDmsIdDoRegem = TokenDmsId & { permissoes: EscopoIntegracao[] };

@Injectable()
export class DmsIdService {
  private readonly log = new Logger('DmsId');
  /** Uma `ChavesDmsId` por emissor: troca de emissor na configuração não confere com a chave do emissor antigo. */
  private guardadas: { emissor: string; chaves: ChavesDmsId } | null = null;
  private lida: { chave: string; config: ConfigDmsId } | null = null;

  /** A configuração do ambiente; relida só quando alguma das quatro variáveis muda. A torta vai ao log uma vez. */
  get config(): ConfigDmsId {
    const e = process.env;
    const chave = [e.DMS_ID_LIGADO, e.DMS_ID_EMISSOR, e.DMS_ID_RECURSO, e.DMS_ID_APLICATIVOS].join('\n');
    if (this.lida?.chave !== chave) {
      const config = lerConfigDmsId(e);
      if (!config.ligado && config.motivo) this.log.error(`via do DMS ID desligada: ${config.motivo}`);
      this.lida = { chave, config };
    }
    return this.lida.config;
  }

  get ligado(): boolean {
    return this.config.ligado;
  }

  /** Cliente → client_id dos aplicativos que a distribuição cadastrou no DMS ID (vazio com a via desligada). */
  get aplicativos(): Readonly<Record<string, string>> {
    const c = this.config;
    return c.ligado ? c.aplicativos : {};
  }

  /** O endereço que vai no `resource_metadata` do `WWW-Authenticate` (nulo com a via desligada). */
  enderecoDosMetadados(): string | null {
    const c = this.config;
    return c.ligado ? enderecoDosMetadados(c.recurso) : null;
  }

  /** Os metadados do recurso protegido (RFC 9728): é por eles que o cliente acha o DMS ID. Só com a via ligada. */
  metadados() {
    const c = this.config;
    if (!c.ligado) return null;
    return {
      resource: c.recurso,
      authorization_servers: [c.emissor],
      scopes_supported: [...PERMISSOES_DO_RECURSO],
      bearer_methods_supported: ['header'],
      resource_name: 'Regem (API de integração)',
    };
  }

  /**
   * Confere o token do DMS ID: forma, assinatura, emissor, destino (o recurso do Regem) e validade. Token que não vale →
   * `ErroTokenDmsId` (401). Token válido sem NENHUMA permissão do Regem → `ErroPermissaoFaltando` (403) com todas as
   * permissões: o DMS ID emite token para qualquer destino, até sem permissão (`scope` vazio), então o destino certo
   * sozinho não autoriza nada (Padrão §2.1). Só com a via ligada (quem chama confere antes).
   */
  async conferir(token: string | null): Promise<TokenDmsIdDoRegem> {
    const c = this.config;
    if (!c.ligado) throw new Error('A via do DMS ID está desligada.');
    const lido = await conferirTokenDmsId(token ?? '', { chaves: this.chaves(c.emissor), emissor: c.emissor, destino: c.recurso });
    const permissoes = permissoesDoCatalogo(lido.permissoes);
    if (!permissoes.length) throw new ErroPermissaoFaltando(PERMISSOES_DO_RECURSO);
    return { ...lido, permissoes };
  }

  private chaves(emissor: string): ChavesDmsId {
    if (this.guardadas?.emissor !== emissor) this.guardadas = { emissor, chaves: new ChavesDmsId({ jwks: `${emissor}/jwks` }) };
    return this.guardadas.chaves;
  }
}
