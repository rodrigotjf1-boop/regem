import { Body, Controller, Get, Header, HttpCode, Logger, Post, Req, Res, UseFilters } from '@nestjs/common';
import { ApiBody, ApiExcludeEndpoint, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { CloudOnly } from '../../common/cloud-only.decorator';
import { bearerDe } from '../../common/integracao-limite';
import { ErroTokenDmsId } from '../../dms/integracao-dms';
import { DmsIdService } from './dms-id.service';
import { LigacaoIntegracaoService, type LigacaoEntregue } from './ligacao-integracao.service';
import { CAMINHO_DOS_METADADOS, desafioDaRecusa, VIA_DESLIGADA } from './ligacao.regras';
import { ProblemaException, ProblemaFilter } from './problema';

/* eslint-disable @typescript-eslint/no-explicit-any */

// A VIA DO DMS ID (Hub DMS, F3, parte A), fora das rotas de leitura — SÓ NUVEM:
//
// - `GET /.well-known/oauth-protected-resource/api/v1/integracao` — os metadados do recurso protegido (RFC 9728), FORA
//   do prefixo `/api/v1` (`main.ts`). É por eles que o cliente acha o DMS ID: o 401 da API aponta para cá;
// - `POST /api/v1/integracao/dms-id/ligacao` — a troca automática: o aplicativo manda o token do DMS ID dele e o
//   `rgm_it_` que já usa na loja (`{ "token_integracao": "rgm_it_…" }`) e recebe o segredo da ligação.
//
// Desligada (`DMS_ID_LIGADO`), as duas respondem 404. As recusas saem em `application/problem+json`.
@ApiTags('Integração (token por loja)')
@Controller()
@CloudOnly()
@UseFilters(ProblemaFilter)
export class DmsIdController {
  private readonly log = new Logger('DmsId');

  constructor(
    private readonly dmsId: DmsIdService,
    private readonly ligacoes: LigacaoIntegracaoService,
  ) {}

  @Get(CAMINHO_DOS_METADADOS)
  @Header('Cache-Control', 'public, max-age=300')
  @ApiExcludeEndpoint()
  metadados() {
    const m = this.dmsId.metadados();
    if (!m) throw new ProblemaException(404, 'nao-encontrado', VIA_DESLIGADA);
    return m;
  }

  // 60 por minuto por IP: o aplicativo troca as lojas todas de UM endereço (o Liame liga a via para a rede inteira de
  // uma vez), e a troca já exige o token do DMS ID de um aplicativo da lista.
  @Post('integracao/dms-id/ligacao')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @Throttle({ default: { ttl: 60000, limit: 60 } })
  @ApiOperation({
    summary: 'Troca o token de integração da loja pelo segredo da ligação do DMS ID (Hub DMS).',
    description:
      'Só com a via do DMS ID ligada (senão, 404). Cabeçalho `Authorization: Bearer <token do DMS ID>` do aplicativo; ' +
      'corpo `{ "token_integracao": "rgm_it_…" }`, o token que o aplicativo já usa na loja. Resposta: `{ ligacao, ' +
      'prefixo, loja_id, permissoes, segredo_em }` — o segredo aparece só aqui. Depois, cada chamada leva o token do ' +
      'DMS ID no `Authorization` e o segredo no `DMS-Ligacao`. Repetir a troca gira o segredo (o anterior para de ' +
      'valer). 401 token-invalido: o token do DMS ID não vale; 401 ligacao-invalida: o token de integração não vale ' +
      'para este aplicativo.',
  })
  @ApiBody({
    schema: { type: 'object', required: ['token_integracao'], properties: { token_integracao: { type: 'string' } } },
  })
  async trocar(@Req() req: any, @Res({ passthrough: true }) res: any, @Body() corpo: unknown): Promise<LigacaoEntregue> {
    if (!this.dmsId.ligado) throw new ProblemaException(404, 'nao-encontrado', VIA_DESLIGADA);
    const bearer = bearerDe(req);
    try {
      const doToken = await this.dmsId.conferir(bearer);
      const tokenIntegracao = corpo !== null && typeof corpo === 'object' ? (corpo as any).token_integracao : undefined;
      return await this.ligacoes.trocar(tokenIntegracao, doToken.aplicativo, this.dmsId.aplicativos);
    } catch (erro) {
      if (erro instanceof ErroTokenDmsId && bearer !== null) this.log.warn(`token do DMS ID recusado na troca: ${erro.motivo}`);
      const desafio = desafioDaRecusa(erro, { veioToken: bearer !== null, metadadosRecurso: this.dmsId.enderecoDosMetadados() });
      if (desafio) res.setHeader('WWW-Authenticate', desafio);
      throw erro;
    }
  }
}
