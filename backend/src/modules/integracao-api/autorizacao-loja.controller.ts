import { Body, Controller, Get, Header, HttpCode, Logger, Param, Post, Query, Req, Res, UseFilters, UseGuards } from '@nestjs/common';
import { ApiBody, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { CloudOnly } from '../../common/cloud-only.decorator';
import { bearerDe } from '../../common/integracao-limite';
import { ErroTokenDmsId, problemaDaParada } from '../../dms/integracao-dms';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { RolesGuard } from '../../auth/roles.guard';
import { Roles } from '../../auth/roles.decorator';
import { CurrentUser } from '../../auth/current-user.decorator';
import type { AuthUser } from '../../auth/auth-user';
import { AutorizacaoCliqueService } from './autorizacao-clique.service';
import { CLIQUE_DESLIGADO } from './autorizacao-clique.regras';
import { AutorizacaoLojaService } from './autorizacao-loja.service';
import { anotarChamada } from './chamada-integracao';
import { DmsIdService } from './dms-id.service';
import { HubDmsService } from './hub-dms.service';
import { desafioDaRecusa } from './ligacao.regras';
import { ProblemaException, ProblemaFilter } from './problema';

/* eslint-disable @typescript-eslint/no-explicit-any */

// AUTORIZAÇÃO PELA LOJA (trilha C, C1b) — o lado de quem está logado no Regem, SÓ NUVEM:
// a página "Autorizar o Liame" (`/integracoes/autorizar`) e a tela "Aplicativos conectados"
// (`/integracoes`). A empresa vem SEMPRE da sessão. Só o presidente autoriza, vê e revoga —
// o gerente e o técnico do suporte recebem 403 (o suporte é tratado como gerente no RolesGuard).
@ApiTags('Integração — autorização pela loja')
@Controller()
@CloudOnly()
@UseGuards(JwtAuthGuard, RolesGuard)
export class AutorizacaoLojaController {
  constructor(
    private readonly service: AutorizacaoLojaService,
    private readonly clique: AutorizacaoCliqueService,
  ) {}

  // ── A AUTORIZAÇÃO POR CLIQUE (Hub DMS, F3, parte C; nasce desligada: `AUTORIZACAO_POR_CLIQUE`). A página abre com
  // `?client_id=…&request_uri=…`, o pedido que o aplicativo empurrou. Qualquer nível lê (a página explica quem pode);
  // só o presidente autoriza; qualquer um recusa ("Voltar ao Liame" também gasta o pedido).

  @Get('integracoes/autorizacao')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'A autorização por clique: o que a página mostra, numa das situações (Hub DMS, F3).' })
  @ApiQuery({ name: 'client_id', description: 'O client_id do DMS ID do aplicativo que empurrou o pedido.' })
  @ApiQuery({ name: 'request_uri', description: 'O número do pedido (RFC 9126), de uso único.' })
  telaDoClique(@CurrentUser() user: AuthUser, @Query() q: any) {
    return this.clique.lerParaTela(user, q);
  }

  @Post('integracoes/autorizacao')
  @Roles('presidente')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @Throttle({ default: { ttl: 60000, limit: 10 } })
  @ApiOperation({ summary: 'O presidente autoriza com a senha: devolve o endereço cadastrado com o código, o state e o iss.' })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['clientId', 'requestUri', 'senha', 'lojas', 'opcionais', 'confirmoOutraEmpresa'],
      properties: {
        clientId: { type: 'string' },
        requestUri: { type: 'string' },
        senha: { type: 'string', description: 'A senha do Regem de quem está logado (nunca o PIN).' },
        lojas: { type: 'array', items: { type: 'string', format: 'uuid' } },
        opcionais: { type: 'array', items: { type: 'string' }, description: 'As opcionais que o presidente ligou.' },
        confirmoOutraEmpresa: { type: 'boolean' },
      },
    },
  })
  autorizarPorClique(@CurrentUser() user: AuthUser, @Body() dto: any, @Req() req: any) {
    const navegador = req?.headers?.['user-agent'];
    return this.clique.autorizar(user, dto, { ip: req?.ip ?? null, navegador: typeof navegador === 'string' ? navegador : null });
  }

  @Post('integracoes/autorizacao/recusar')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @Throttle({ default: { ttl: 60000, limit: 10 } })
  @ApiOperation({ summary: 'Recusa (ou volta sem autorizar): gasta o pedido e devolve o endereço com access_denied.' })
  @ApiBody({ schema: { type: 'object', required: ['clientId', 'requestUri'], properties: { clientId: { type: 'string' }, requestUri: { type: 'string' } } } })
  recusarPorClique(@CurrentUser() user: AuthUser, @Body() dto: any) {
    return this.clique.recusar(user, dto);
  }

  // Qualquer nível chega aqui (a página precisa dizer "só o presidente autoriza"): quem não é
  // presidente recebe só a recusa — sem lojas, sem escopos.
  @Get('integracao-autorizacao/pedido')
  @ApiOperation({ summary: 'O que a página de autorização mostra para quem está logado.' })
  @ApiQuery({ name: 'cliente', description: 'O aplicativo que pede a autorização (ex.: liame).' })
  @ApiQuery({ name: 'redirect_uri', description: 'Endereço de volta — tem de ser um dos cadastrados para o cliente.' })
  @ApiQuery({ name: 'state', description: 'Volta como veio.' })
  @ApiQuery({ name: 'code_challenge', description: 'Desafio do PKCE (S256).' })
  @ApiQuery({ name: 'code_challenge_method', description: 'Sempre S256.' })
  pedido(@CurrentUser() user: AuthUser, @Query() q: any) {
    return this.service.pedido(user, q);
  }

  @Post('integracao-autorizacao')
  @Roles('presidente')
  @HttpCode(200)
  @Throttle({ default: { ttl: 60000, limit: 10 } })
  @ApiOperation({ summary: 'O presidente autoriza: devolve o endereço de volta com o código de uso único.' })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['cliente', 'redirect_uri', 'state', 'code_challenge', 'code_challenge_method', 'lojas', 'custo', 'cupom'],
      properties: {
        cliente: { type: 'string' },
        redirect_uri: { type: 'string' },
        state: { type: 'string' },
        code_challenge: { type: 'string' },
        code_challenge_method: { type: 'string', enum: ['S256'] },
        lojas: { type: 'array', items: { type: 'string', format: 'uuid' } },
        custo: { type: 'boolean', description: 'Liberar o custo dos itens (exige "Ver valores em R$").' },
        cupom: { type: 'boolean', description: 'Liberar a criação de cupom de campanha.' },
      },
    },
  })
  autorizar(@CurrentUser() user: AuthUser, @Body() dto: any) {
    return this.service.autorizar(user, dto);
  }

  @Get('aplicativos-conectados')
  @Roles('presidente')
  @ApiOperation({ summary: 'Ferramentas que leem dados da empresa: acessos ativos e os últimos revogados.' })
  aplicativos(@CurrentUser() user: AuthUser) {
    return this.service.aplicativos(user);
  }

  @Post('aplicativos-conectados/revogar-todos')
  @Roles('presidente')
  @HttpCode(200)
  @ApiOperation({ summary: 'Revoga todos os acessos de um aplicativo nesta empresa.' })
  @ApiBody({ schema: { type: 'object', required: ['cliente'], properties: { cliente: { type: 'string' } } } })
  revogarTodos(@CurrentUser() user: AuthUser, @Body() dto: any) {
    return this.service.revogarTodos(user, dto?.cliente);
  }

  @Post('aplicativos-conectados/:id/revogar')
  @Roles('presidente')
  @HttpCode(200)
  @ApiOperation({ summary: 'Revoga um acesso (o aplicativo passa a receber 401 na chamada seguinte).' })
  revogar(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.revogar(user, id);
  }
}

// A TROCA DO CÓDIGO — `/api/v1/integracao/autorizacao/token`, SÓ NUVEM, entre servidores: quem
// chama é o servidor do aplicativo, com o segredo de cliente (não há sessão nem token de loja
// ainda). Erros em `application/problem+json`, como o resto da API de integração.
@ApiTags('Integração (token por loja)')
@Controller('integracao/autorizacao')
@CloudOnly()
@UseFilters(ProblemaFilter)
export class AutorizacaoTokenController {
  private readonly log = new Logger('AutorizacaoClique');

  constructor(
    private readonly service: AutorizacaoLojaService,
    private readonly clique: AutorizacaoCliqueService,
    private readonly dmsId: DmsIdService,
    private readonly hub: HubDmsService,
  ) {}

  /**
   * O lado do aplicativo da autorização por clique (Hub DMS, F3, parte C): o token do DMS ID dele no `Authorization`.
   * Desligada, 404 antes de tudo; a chave própria, 503 antes do token (Padrão §10); a recusa do token leva o
   * `WWW-Authenticate` com os metadados do recurso.
   */
  private async comTokenDoDmsId<T>(req: any, res: any, fazer: (doToken: Awaited<ReturnType<DmsIdService['conferir']>>) => Promise<T>): Promise<T> {
    if (!this.clique.ligada) throw new ProblemaException(404, 'nao-encontrado', CLIQUE_DESLIGADO);
    anotarChamada({ credencial: 'dms_id' });
    if (!this.hub.aceitaIntegracoes) throw problemaDaParada();
    const bearer = bearerDe(req);
    try {
      return await fazer(await this.dmsId.conferir(bearer));
    } catch (erro) {
      if (erro instanceof ErroTokenDmsId && bearer !== null) this.log.warn(`token do DMS ID recusado na autorização por clique: ${erro.motivo}`);
      const desafio = desafioDaRecusa(erro, { veioToken: bearer !== null, metadadosRecurso: this.dmsId.enderecoDosMetadados() });
      if (desafio) res.setHeader('WWW-Authenticate', desafio);
      throw erro;
    }
  }

  @Post('pedido')
  @HttpCode(201)
  @Header('Cache-Control', 'no-store')
  @Throttle({ default: { ttl: 60000, limit: 30 } })
  @ApiOperation({
    summary: 'A autorização por clique: o aplicativo empurra o pedido (RFC 9126) com o token do DMS ID.',
    description:
      'Corpo (formulário ou JSON): `response_type=code`, `client_id` (opcional; o do token), `redirect_uri` (um dos ' +
      'cadastrados), `scope` (separado por espaço), `state`, `code_challenge` e `code_challenge_method=S256`, e a conta ' +
      'que pede: `conta_nome`, `conta_cnpj` (opcional), `conta_email`, `conta_marca` (opcional). Resposta 201 ' +
      '`{ request_uri, expires_in: 600 }`: a pessoa abre a página com `?client_id=…&request_uri=…`. Desligada: 404.',
  })
  pedido(@Req() req: any, @Res({ passthrough: true }) res: any, @Body() corpo: unknown) {
    return this.comTokenDoDmsId(req, res, (doToken) => this.clique.criarPedido(doToken, corpo));
  }

  @Post('token')
  @HttpCode(200)
  @Throttle({ default: { ttl: 60000, limit: 20 } })
  @ApiOperation({
    summary: 'Troca o código da autorização: pelos tokens das lojas (01/10) ou, com o token do DMS ID, pelas ligações.',
    description:
      'Sem `Authorization`: a página de 01/10. Corpo `code`, `code_verifier` (PKCE S256), `redirect_uri` (o mesmo do ' +
      'pedido), `client_id` e `client_secret`; resposta `{ lojas: [{ loja_id, loja_nome, empresa_nome, fuso, moeda, ' +
      'escopos, cardapio_url, token }] }` — o token de cada loja aparece só aqui; a loja que já tinha um token deste ' +
      'cliente troca: o antigo passa a devolver 401. Com `Authorization: Bearer <token do DMS ID>`: a autorização por ' +
      'clique (Hub DMS). Corpo `grant_type=authorization_code`, `code`, `code_verifier`, `redirect_uri` e `client_id` ' +
      '(opcional); resposta `{ lojas: [{ …a loja, ligacao, prefixo, permissoes, segredo_em }] }` — o segredo da ligação ' +
      'de cada loja aparece só aqui; o acesso antigo da loja com o aplicativo é trocado.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['code', 'code_verifier', 'redirect_uri', 'client_id', 'client_secret'],
      properties: {
        code: { type: 'string' },
        code_verifier: { type: 'string' },
        redirect_uri: { type: 'string' },
        client_id: { type: 'string' },
        client_secret: { type: 'string' },
      },
    },
  })
  token(@Req() req: any, @Res({ passthrough: true }) res: any, @Body() body: any) {
    // Com o token do DMS ID no cabeçalho: a troca da autorização por clique. Sem ele: a de 01/10, com o segredo de cliente.
    if (bearerDe(req) === null) return this.service.trocar(body);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Pragma', 'no-cache');
    return this.comTokenDoDmsId(req, res, (doToken) => this.clique.trocarCodigo(doToken, body));
  }
}
