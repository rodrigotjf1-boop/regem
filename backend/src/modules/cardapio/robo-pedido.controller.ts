import { Body, Controller, Get, Headers, HttpCode, Post, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { CloudOnly } from '../../common/cloud-only.decorator';
import { CABECALHO_SEGREDO_ROBO } from '../../common/segredo-robo';
import { CABECALHO_CONVERSA } from '../../common/conversa-do-robo';
import { RoboPedidoService } from './robo-pedido.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

// O PEDIDO PELO WHATSAPP (Fase 5, F3/F4 do robô — robo-pedido.service.ts). Senha do robô no cabeçalho
// `x-regem-robo-segredo` (só no cabeçalho: rota nova não aceita a senha na URL) e a FICHA DA CONVERSA em
// `x-regem-conversa` (a loja e o telefone do cliente saem dela). A loja pela chave do número — `instancia` (Evolution)
// ou `phoneNumberId` (API oficial) —, na URL ou no corpo, como nas outras consultas do robô. Só na nuvem.
// Toda recusa de regra (produto que não existe, fora da área, troco) volta 200 com `ok: false`, `motivo` e `mensagem`
// — e o pedido como está —, para o robô explicar ao cliente em vez de tropeçar num erro.
const LIMITE = { default: { ttl: 60000, limit: 240 } };

@Controller('publico/bot')
@CloudOnly()
export class RoboPedidoController {
  constructor(private readonly service: RoboPedidoService) {}

  private contexto(segredo: string | undefined, ficha: string | undefined, q: any, corpo?: any) {
    return this.service.contexto(
      String(segredo ?? '').trim(),
      ficha,
      String(q?.instancia ?? corpo?.instancia ?? '') || undefined,
      String(q?.phoneNumberId ?? corpo?.phoneNumberId ?? '') || undefined,
    );
  }

  /** Quem é o cliente (nome, cliente novo?), os endereços salvos numerados e o pedido em montagem. */
  @Get('pedido')
  @Throttle(LIMITE)
  async ver(@Query() q: any, @Headers(CABECALHO_SEGREDO_ROBO) segredo?: string, @Headers(CABECALHO_CONVERSA) ficha?: string) {
    return this.service.ver(await this.contexto(segredo, ficha, q));
  }

  /**
   * Itens: `acao` adicionar | escolher (a resposta de uma escolha ou um adicional) | concluir (sem mais extras no item) |
   * fechar ("só isso") | alterar | remover | observacao_do_pedido | limpar; `produto`, `versao`, `adicionais`,
   * `quantidade`, `observacao`, `linha`…
   */
  @Post('pedido/itens')
  @HttpCode(200)
  @Throttle(LIMITE)
  async itens(@Body() b: any, @Query() q: any, @Headers(CABECALHO_SEGREDO_ROBO) segredo?: string, @Headers(CABECALHO_CONVERSA) ficha?: string) {
    return this.service.mexerNosItens(await this.contexto(segredo, ficha, q, b), b ?? {});
  }

  /** Entrega ou retirada; endereço salvo (`endereco: n`) ou novo (rua, número, bairro), referência, localização. */
  @Post('pedido/entrega')
  @HttpCode(200)
  @Throttle(LIMITE)
  async entrega(@Body() b: any, @Query() q: any, @Headers(CABECALHO_SEGREDO_ROBO) segredo?: string, @Headers(CABECALHO_CONVERSA) ficha?: string) {
    return this.service.definirEntrega(await this.contexto(segredo, ficha, q, b), b ?? {});
  }

  /** A forma de pagamento (as do cardápio, de pagar na entrega/retirada) e o troco. */
  @Post('pedido/pagamento')
  @HttpCode(200)
  @Throttle(LIMITE)
  async pagamento(@Body() b: any, @Query() q: any, @Headers(CABECALHO_SEGREDO_ROBO) segredo?: string, @Headers(CABECALHO_CONVERSA) ficha?: string) {
    return this.service.definirPagamento(await this.contexto(segredo, ficha, q, b), b ?? {});
  }

  /** O nome do cliente para o pedido. */
  @Post('pedido/nome')
  @HttpCode(200)
  @Throttle(LIMITE)
  async nome(@Body() b: any, @Query() q: any, @Headers(CABECALHO_SEGREDO_ROBO) segredo?: string, @Headers(CABECALHO_CONVERSA) ficha?: string) {
    return this.service.definirNome(await this.contexto(segredo, ficha, q, b), b ?? {});
  }

  /** Registra o pedido que o cliente confirmou no resumo que o Regem mandou (F5: sem a versão da IA) e manda o resumo final. */
  @Post('pedido/registrar')
  @HttpCode(200)
  @Throttle({ default: { ttl: 60000, limit: 60 } })
  async registrar(@Body() b: any, @Query() q: any, @Headers(CABECALHO_SEGREDO_ROBO) segredo?: string, @Headers(CABECALHO_CONVERSA) ficha?: string) {
    return this.service.registrar(await this.contexto(segredo, ficha, q, b), b ?? {});
  }

  /** O cliente desistiu: o pedido em montagem é cancelado (nada foi para a loja). */
  @Post('pedido/cancelar')
  @HttpCode(200)
  @Throttle(LIMITE)
  async cancelar(@Body() b: any, @Query() q: any, @Headers(CABECALHO_SEGREDO_ROBO) segredo?: string, @Headers(CABECALHO_CONVERSA) ficha?: string) {
    return this.service.cancelar(await this.contexto(segredo, ficha, q, b));
  }
}
