import { Body, Controller, Delete, Get, Headers, HttpCode, Param, Post, Put, Query, Res, UseFilters, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiCreatedResponse,
  ApiHeader,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { CloudOnly } from '../../common/cloud-only.decorator';
import { Escopos, IntegracaoCtx, IntegracaoCtxData, IntegracaoTokenGuard } from './integracao-token.guard';
import { IntegracaoTokenService } from './integracao-token.service';
import { problemaGuardado, ProblemaFilter } from './problema';
import { VendasIntegracaoService } from './vendas-integracao.service';
import { CuponsIntegracaoService, ResultadoEscrita } from './cupons-integracao.service';
import { ClientesIntegracaoService } from './clientes-integracao.service';
import { PaginaClientesAnonimizadosIntegracao, PaginaVendasIntegracao } from './dto/vendas-integracao.dto';
import {
  CriarCupomIntegracao,
  CupomIntegracao,
  PaginaCuponsIntegracao,
  PaginaUsosCupomIntegracao,
} from './dto/cupons-integracao.dto';
import { WebhookIntegracaoService } from './webhook-integracao.service';
import { RegistrarWebhookIntegracao, WebhookIntegracao } from './dto/webhook-integracao.dto';

/* eslint-disable @typescript-eslint/no-explicit-any */

const CABECALHO_IDEMPOTENCIA = {
  name: 'Idempotency-Key',
  required: true,
  description:
    'Obrigatório (1 a 255 caracteres visíveis, até 24 h). Mesma chave e mesmo corpo → a mesma resposta ' +
    '(cabeçalho Idempotent-Replayed: true); outro corpo → 422 chave-reutilizada; a mesma chave ainda em curso → ' +
    '409 chave-em-uso.',
};

/** A resposta de uma escrita idempotente: a guardada (reenvio) ou a nova, com o status dela. */
function responder(res: any, r: ResultadoEscrita) {
  if (r.replay) res.setHeader('Idempotent-Replayed', 'true');
  if (r.status >= 400) throw problemaGuardado(r.corpo, r.status);
  res.status(r.status);
  return r.corpo;
}

// API DE INTEGRAÇÃO (trilha C) — `/api/v1/integracao/*`, SÓ NUVEM. Autentica pelo token POR
// LOJA (`Authorization: Bearer rgm_it_…`); a empresa e a loja vêm SEMPRE do token (não existe
// parâmetro de loja). Erros em `application/problem+json` (RFC 9457). Cada rota confere o seu
// escopo (`@Escopos`, 403).
@ApiTags('Integração (token por loja)')
@ApiBearerAuth()
@Controller('integracao')
@CloudOnly()
@UseGuards(IntegracaoTokenGuard)
@UseFilters(ProblemaFilter)
export class IntegracaoApiController {
  constructor(
    private readonly tokens: IntegracaoTokenService,
    private readonly vendas: VendasIntegracaoService,
    private readonly cupons: CuponsIntegracaoService,
    private readonly clientesSvc: ClientesIntegracaoService,
    private readonly webhooks: WebhookIntegracaoService,
  ) {}

  // Quem é a loja do token — qualquer escopo.
  @Get('loja')
  @ApiOperation({ summary: 'Loja do token: nome, fuso, moeda, escopos concedidos e o cardápio online.' })
  loja(@IntegracaoCtx() ctx: IntegracaoCtxData) {
    return this.tokens.dadosDaLoja(ctx);
  }

  // A integração desliga o próprio token (o Liame chama ao desconectar). Depois disso, toda
  // chamada com ele — inclusive repetir esta — volta 401, que é o sinal de "desconectada".
  @Post('autorizacao/revogar')
  @HttpCode(200)
  @ApiOperation({ summary: 'Revoga o próprio token (a chamada seguinte já volta 401).' })
  revogar(@IntegracaoCtx() ctx: IntegracaoCtxData) {
    return this.tokens.revogarPelaIntegracao(ctx);
  }

  // ───────────────────────────── aviso (webhook) — mig 304 ─────────────────────────────

  // A integração diz para onde o Regem avisa "algo mudou nesta loja" — qualquer escopo. O aviso é
  // só gatilho: quem recebe lê pela rota com cursor. O endereço tem de estar na lista do cliente.
  @Put('webhook')
  @ApiOperation({
    summary: 'Registra (ou troca) o endereço e o segredo do aviso deste token. Registrar de novo religa o que estava pausado.',
    description:
      'O Regem manda um POST assinado (Standard Webhooks: webhook-id, webhook-timestamp, webhook-signature) quando há ' +
      'venda, cupom, uso de cupom ou cliente anonimizado novo para a loja do token — só do que o escopo libera, no máximo ' +
      'um por minuto por loja, e um aviso pode valer por várias mudanças (o id é o da mais recente). Corpo: ' +
      '{ "tipo": "pedido.alterado" | "cupom.alterado", "id", "versao" }, { "tipo": "cupom.usado", "id", "cupom_id", ' +
      '"pedido_id" } ou { "tipo": "cliente.anonimizado", "id" } — todos com "loja_id" (a loja do token; o token da ' +
      'empresa inteira não manda). É só gatilho: aviso perdido ou repetido não muda nada. ' +
      '422 endereco-nao-permitido: endereço fora da lista da integração; 503 aviso-indisponivel: tente de novo mais tarde.',
  })
  @ApiBody({ type: RegistrarWebhookIntegracao })
  @ApiOkResponse({ type: WebhookIntegracao })
  registrarWebhook(@IntegracaoCtx() ctx: IntegracaoCtxData, @Body() corpo: unknown) {
    return this.webhooks.registrar(ctx, corpo);
  }

  @Get('webhook')
  @ApiOperation({ summary: 'Situação do aviso deste token (nunca o segredo). Sem registro → 404.' })
  @ApiOkResponse({ type: WebhookIntegracao })
  webhook(@IntegracaoCtx() ctx: IntegracaoCtxData) {
    return this.webhooks.ler(ctx);
  }

  @Delete('webhook')
  @HttpCode(204)
  @ApiOperation({ summary: 'Para de avisar (apaga o endereço e o segredo). Sem registro, responde 204 do mesmo jeito.' })
  @ApiNoContentResponse()
  async removerWebhook(@IntegracaoCtx() ctx: IntegracaoCtxData): Promise<void> {
    await this.webhooks.remover(ctx);
  }

  // Vendas da loja (confirmadas, canceladas depois de confirmadas e removidas), com cursor.
  @Get('pedidos')
  @Escopos('pedidos.ler')
  @ApiOperation({
    summary: 'Vendas da loja com cursor (ordem por atualizado_em, id; só o carimbado há mais de 15 s).',
    description:
      'Receita = "Faturamento" do Painel ao centavo (pedido: criação; comanda: fechamento — `faturado_em`). ' +
      'Cliente só com clientes.telefone.ler (marketplace: sempre null); custo por item só com custos.ler e ' +
      'se quem autorizou ainda vê valores em R$.',
  })
  @ApiQuery({ name: 'cursor', required: false, description: 'O `proximo_cursor` da página anterior.' })
  @ApiQuery({ name: 'limite', required: false, description: 'Itens por página: 1 a 500 (padrão 200).' })
  @ApiQuery({
    name: 'confirmados_desde',
    required: false,
    description: 'Instante ISO 8601 com fuso — só na primeira página da carga inicial; depois segue dentro do cursor.',
  })
  @ApiOkResponse({ type: PaginaVendasIntegracao })
  pedidos(
    @IntegracaoCtx() ctx: IntegracaoCtxData,
    @Query('cursor') cursor?: string,
    @Query('limite') limite?: string,
    @Query('confirmados_desde') confirmadosDesde?: string,
  ) {
    return this.vendas.pedidos(ctx, { cursor, limite, confirmados_desde: confirmadosDesde });
  }

  // Avisos de cliente anonimizado (o "esquecer" da LGPD): o Liame apaga o cliente dele em 1 dia.
  @Get('clientes/anonimizados')
  @Escopos('clientes.anonimizacao.ler')
  @ApiOperation({ summary: 'Clientes anonimizados (excluídos) da empresa, com cursor — só o id.' })
  @ApiQuery({ name: 'cursor', required: false })
  @ApiQuery({ name: 'limite', required: false, description: '1 a 500 (padrão 200).' })
  @ApiOkResponse({ type: PaginaClientesAnonimizadosIntegracao })
  clientesAnonimizados(
    @IntegracaoCtx() ctx: IntegracaoCtxData,
    @Query('cursor') cursor?: string,
    @Query('limite') limite?: string,
  ) {
    return this.vendas.clientesAnonimizados(ctx, { cursor, limite });
  }

  // Clientes da EMPRESA (RegemCast — mig 302), com cursor: ficha lida na hora; lápide de quem foi
  // esquecido (LGPD); quem só comprou por marketplace não sai (pela 99, só com vendas.99food.ler).
  @Get('clientes')
  @Escopos('clientes.ler')
  @ApiOperation({
    summary: 'Clientes da empresa com cursor (ordem por atualizado_em, id; só o carimbado há mais de 15 s).',
    description:
      'Telefone em E.164 (+55…) ou null; canais = onde o cliente fez pedido; opt_out = marca do cadastro ou lista de ' +
      'exclusão (com/sem o nono dígito); aceite_marketing = o último aceite/recusa (null = nunca respondeu). Cliente ' +
      'só de marketplace não sai; só da 99, só com vendas.99food.ler. removido: true = esquecido a pedido (LGPD).',
  })
  @ApiQuery({ name: 'cursor', required: false, description: 'O `proximo_cursor` da página anterior.' })
  @ApiQuery({ name: 'limite', required: false, description: 'Itens por página: 1 a 500 (padrão 200).' })
  clientes(
    @IntegracaoCtx() ctx: IntegracaoCtxData,
    @Query('cursor') cursor?: string,
    @Query('limite') limite?: string,
  ) {
    return this.clientesSvc.clientes(ctx, { cursor, limite });
  }

  // ───────────────────────────── cupons (contrato de cupons v1) ─────────────────────────────

  // Cupons que valem para a loja do token (os dela e os da empresa inteira), com cursor.
  @Get('cupons')
  @Escopos('cupons.ler')
  @ApiOperation({
    summary: 'Cupons da loja com regra, validade e usos, com cursor (só o carimbado há mais de 15 s).',
    description:
      'Os da loja do token e os cadastrados sem loja (empresa de uma loja: todos). Cupom apagado sai como lápide ' +
      '(mesmo id, versão nova, removido: true). todas_as_lojas é informativo: hoje o Regem aceita o cupom em ' +
      'qualquer loja da empresa, e só o cardápio online aplica cupom.',
  })
  @ApiQuery({ name: 'cursor', required: false, description: 'O `proximo_cursor` da página anterior.' })
  @ApiQuery({ name: 'limite', required: false, description: 'Itens por página: 1 a 500 (padrão 200).' })
  @ApiOkResponse({ type: PaginaCuponsIntegracao })
  cuponsDaLoja(
    @IntegracaoCtx() ctx: IntegracaoCtxData,
    @Query('cursor') cursor?: string,
    @Query('limite') limite?: string,
  ) {
    return this.cupons.cupons(ctx, { cursor, limite });
  }

  // Usos de cupom nos pedidos da loja (sem dado do cliente), com cursor.
  @Get('cupons/usos')
  @Escopos('cupons.uso.ler')
  @ApiOperation({
    summary: 'Usos de cupom nos pedidos da loja, com cursor — sem dado do cliente.',
    description:
      'A loja do uso é a do pedido (empresa de uma loja: todos). Uso apagado (pedido cancelado) sai como lápide ' +
      '(removido: true).',
  })
  @ApiQuery({ name: 'cursor', required: false })
  @ApiQuery({ name: 'limite', required: false, description: '1 a 500 (padrão 200).' })
  @ApiQuery({
    name: 'desde',
    required: false,
    description: 'Instante ISO 8601 com fuso (usado_em) — só na primeira página da carga inicial; depois segue no cursor.',
  })
  @ApiOkResponse({ type: PaginaUsosCupomIntegracao })
  usosDeCupom(
    @IntegracaoCtx() ctx: IntegracaoCtxData,
    @Query('cursor') cursor?: string,
    @Query('limite') limite?: string,
    @Query('desde') desde?: string,
  ) {
    return this.cupons.usos(ctx, { cursor, limite, desde });
  }

  // Cria um cupom NA LOJA DO TOKEN. Nunca altera um cupom existente pelo código (409).
  @Post('cupons')
  @Escopos('cupons.criar')
  @HttpCode(201)
  @ApiOperation({
    summary: 'Cria um cupom na loja do token (nunca atualiza cupom existente: código repetido → 409 codigo-em-uso).',
    description:
      '422 regra-invalida: código fora de [A-Z0-9]{3,30}, tipo fora de percentual/valor/frete_gratis, percentual fora ' +
      'de (0, 100], valor ≤ 0, data inválida, invertida ou com fim no passado, número negativo, campo desconhecido. ' +
      '403 conta-bloqueada: a conta da empresa no Regem está bloqueada.',
  })
  @ApiHeader(CABECALHO_IDEMPOTENCIA)
  @ApiBody({ type: CriarCupomIntegracao })
  @ApiCreatedResponse({ type: CupomIntegracao })
  async criarCupom(
    @IntegracaoCtx() ctx: IntegracaoCtxData,
    @Headers('idempotency-key') chave: string | undefined,
    @Body() corpo: unknown,
    @Res({ passthrough: true }) res: any,
  ) {
    return responder(res, await this.cupons.criar(ctx, chave, corpo));
  }

  // Desfaz a criação (compensação): só o cupom que esta integração criou; o resto → 404.
  @Post('cupons/:id/desativar')
  @Escopos('cupons.criar')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Desativa um cupom criado pela integração (ativo: false). Já inativo → 200 sem mudança; outro cupom → 404.',
  })
  @ApiParam({ name: 'id', description: 'Id do cupom (o da resposta do POST /cupons).' })
  @ApiHeader(CABECALHO_IDEMPOTENCIA)
  @ApiOkResponse({ type: CupomIntegracao })
  async desativarCupom(
    @IntegracaoCtx() ctx: IntegracaoCtxData,
    @Param('id') id: string,
    @Headers('idempotency-key') chave: string | undefined,
    @Body() corpo: unknown,
    @Res({ passthrough: true }) res: any,
  ) {
    return responder(res, await this.cupons.desativar(ctx, chave, id, corpo));
  }
}
