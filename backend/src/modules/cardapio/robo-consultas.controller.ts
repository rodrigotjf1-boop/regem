import { Controller, Get, Headers, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { CloudOnly } from '../../common/cloud-only.decorator';
import { CABECALHO_SEGREDO_ROBO, segredoDaChamada } from '../../common/segredo-robo';
import { CardapioService } from './cardapio.service';
import { buscarNoCardapio, resumoDaLoja, taxaDoBairro } from './robo-consultas';
import { instrucoesDoRobo } from './robo-instrucoes';

/* eslint-disable @typescript-eslint/no-explicit-any */

// AS CONSULTAS DO ROBÔ (n8n) — Fase 2 do robô de WhatsApp. Resumo da loja, busca no cardápio e taxa por bairro, da
// MESMA fonte do cardápio online (`menu`). Senha do robô no cabeçalho `x-regem-robo-segredo`; a loja pela chave que
// o n8n recebeu (instância da Evolution ou phoneNumberId da API oficial). Só na nuvem.
@Controller('publico/bot')
@CloudOnly()
export class RoboConsultasController {
  constructor(private readonly service: CardapioService) {}

  private async cardapio(segredo: string, instancia?: string, phoneNumberId?: string) {
    const token = await this.service.tokenDaLojaDoRobo(segredo, instancia, phoneNumberId);
    return { token, menu: await this.service.menu(token) };
  }

  @Get('loja')
  @Throttle({ default: { ttl: 60000, limit: 240 } })
  async loja(
    @Query('instancia') instancia?: string,
    @Query('phoneNumberId') phoneNumberId?: string,
    @Query('secret') secret?: string,
    @Headers(CABECALHO_SEGREDO_ROBO) segredo?: string,
  ) {
    const { token, menu } = await this.cardapio(segredoDaChamada(segredo, secret), instancia, phoneNumberId);
    return resumoDaLoja(menu, this.service.linkDoCardapio(token));
  }

  @Get('cardapio')
  @Throttle({ default: { ttl: 60000, limit: 240 } })
  async cardapioBusca(
    @Query('busca') busca?: string,
    @Query('instancia') instancia?: string,
    @Query('phoneNumberId') phoneNumberId?: string,
    @Query('secret') secret?: string,
    @Headers(CABECALHO_SEGREDO_ROBO) segredo?: string,
  ) {
    const { menu } = await this.cardapio(segredoDaChamada(segredo, secret), instancia, phoneNumberId);
    return buscarNoCardapio(menu, String(busca ?? '').slice(0, 80));
  }

  @Get('taxa')
  @Throttle({ default: { ttl: 60000, limit: 240 } })
  async taxa(
    @Query('bairro') bairro?: string,
    @Query('instancia') instancia?: string,
    @Query('phoneNumberId') phoneNumberId?: string,
    @Query('secret') secret?: string,
    @Headers(CABECALHO_SEGREDO_ROBO) segredo?: string,
  ) {
    const { menu } = await this.cardapio(segredoDaChamada(segredo, secret), instancia, phoneNumberId);
    return taxaDoBairro(menu, String(bairro ?? '').slice(0, 80));
  }

  // As instruções do agente (a "mensagem do sistema") para o fluxo do n8n que pede — robo-instrucoes.ts. Uma por
  // conversa: o limite acompanha o das outras consultas.
  @Get('instrucoes')
  @Throttle({ default: { ttl: 60000, limit: 240 } })
  async instrucoes(
    @Query('fluxo') fluxo?: string,
    @Query('instancia') instancia?: string,
    @Query('phoneNumberId') phoneNumberId?: string,
    @Query('secret') secret?: string,
    @Headers(CABECALHO_SEGREDO_ROBO) segredo?: string,
  ) {
    const { menu } = await this.cardapio(segredoDaChamada(segredo, secret), instancia, phoneNumberId);
    return instrucoesDoRobo({ loja: (menu as any)?.loja?.nome ?? null }, fluxo);
  }
}
