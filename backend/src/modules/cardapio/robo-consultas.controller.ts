import { Controller, Get, Headers, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { CloudOnly } from '../../common/cloud-only.decorator';
import { CABECALHO_SEGREDO_ROBO, segredoDaChamada } from '../../common/segredo-robo';
import { CardapioService } from './cardapio.service';
import { buscarNoCardapio, resumoDaLoja, taxaDoBairro } from './robo-consultas';
import { categoriasPorPapel, procurarNoCardapio } from './robo-busca';
import { instrucoesDoChat, instrucoesDoDirect, instrucoesDoMessenger, instrucoesDosComentarios, instrucoesDoRobo } from './robo-instrucoes';
import { ehChaveDeTeste, ehChaveDoChat, ehChaveDoComentario, ehChaveDoDirect, ehChaveDoMessenger } from '../../common/conversa-do-robo';

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
    // + as categorias por papel (bebidas, sobremesas, porções): o que oferecer no fim do pedido (F2).
    return { ...resumoDaLoja(menu, this.service.linkDoCardapio(token)), categoriasParaOferecer: categoriasPorPapel(menu) };
  }

  // Com texto: a busca da F2 (robo-busca.ts) — os que LEVAM (ficha > descrição > nome), onde entra como ADICIONAL (com o
  // preço), os combos e o link direto do produto. Sem texto: as categorias com os itens (o "o que tem aí?"), como antes.
  @Get('cardapio')
  @Throttle({ default: { ttl: 60000, limit: 240 } })
  async cardapioBusca(
    @Query('busca') busca?: string,
    @Query('instancia') instancia?: string,
    @Query('phoneNumberId') phoneNumberId?: string,
    @Query('secret') secret?: string,
    @Headers(CABECALHO_SEGREDO_ROBO) segredo?: string,
  ) {
    const { token, menu } = await this.cardapio(segredoDaChamada(segredo, secret), instancia, phoneNumberId);
    const texto = String(busca ?? '').slice(0, 80);
    if (!texto.trim()) return buscarNoCardapio(menu, '');
    const dados = await this.service.dadosDaBuscaDoRobo(token);
    return procurarNoCardapio(menu, texto, { ...dados, linkDoProduto: (id) => this.service.linkDoProduto(token, id) });
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
    const { token, menu } = await this.cardapio(segredoDaChamada(segredo, secret), instancia, phoneNumberId);
    const loja = (menu as any)?.loja?.nome ?? null;
    // O perfil do atendente virtual (mig 380): o do canal — o de fora do horário quando a equipe não está — e o jeito da
    // loja, logo depois da abertura. Falha ao ler = as instruções de hoje (o serviço nunca rejeita).
    // Os assuntos que não são pedido (mig 381): a seção do canal (fornecedor, vaga, parceria), quando a loja escolheu
    // algum. Falha ao ler = as instruções de hoje (o serviço nunca rejeita).
    // O Direct do Instagram (mig 378): a chave `ig:` recebe as instruções do Direct — sem as ferramentas de telefone.
    // A conversa de TESTE do atendente (mig 382): a chave `teste:` recebe as instruções do CANAL que o teste imita, com o
    // perfil dele — o de fora do horário com "simular fora do horário" (a mesma função do caminho de verdade, V74).
    // O que a loja ensinou (mig 382): a seção em TODOS os canais, quando há itens. Falha ao ler = as instruções de hoje.
    // O CHAT DO iFOOD E DA 99 (F5, mig 383): a chave `chat:` recebe as instruções do chat (a trava da plataforma, o pedido no
    // campo `pedido`), com o perfil do canal `chat`; os assuntos que não são pedido (F3) não se aplicam no chat. O teste do
    // chat (`teste:` com o canal `chat`) recebe as mesmas, dizendo que no teste não há pedido.
    // Os COMENTÁRIOS dos posts do Instagram (F6, mig 384): a chave `cm:` recebe as instruções dos comentários (públicos: curto,
    // sem link nem contato), com o perfil do canal `comentarios`; os assuntos que não são pedido (F3) não se aplicam.
    const semPid = !String(phoneNumberId ?? '').trim();
    const teste = semPid && ehChaveDeTeste(instancia) ? await this.service.testeDoRobo(instancia) : null;
    const chat = semPid && ehChaveDoChat(instancia) ? await this.service.chatDoRobo(instancia) : null;
    // O MESSENGER do Facebook (mig 386): a chave `fb:` recebe as instruções do Messenger (como as do Direct, sem as
    // ferramentas de telefone), com o perfil do canal `messenger` e os assuntos que não são pedido perguntando o contato.
    const comentario = semPid && ehChaveDoComentario(instancia);
    const messenger = semPid && ehChaveDoMessenger(instancia);
    const canal = teste
      ? teste.canal
      : chat
        ? 'chat'
        : comentario
          ? 'comentarios'
          : messenger
            ? 'messenger'
            : ehChaveDoDirect(instancia)
              ? 'direct'
              : 'whatsapp';
    const [jeito, assuntos, conhecimento] = await Promise.all([
      this.service.jeitoDoAtendenteDoRobo(token, canal, { foraDoHorario: teste?.foraDoHorario === true }),
      canal === 'chat' || canal === 'comentarios' ? Promise.resolve('') : this.service.assuntosDoAtendenteDoRobo(token, canal),
      this.service.conhecimentoDoRobo(token),
    ]);
    if (canal === 'comentarios') return instrucoesDosComentarios({ loja, jeito, conhecimento }, fluxo);
    if (canal === 'chat') return instrucoesDoChat({ loja, jeito, conhecimento, plataforma: chat?.plataforma ?? 'ifood', teste: !!teste }, fluxo);
    if (canal === 'messenger') return instrucoesDoMessenger({ loja, jeito, assuntos, conhecimento }, fluxo);
    if (canal === 'direct') return instrucoesDoDirect({ loja, jeito, assuntos, conhecimento }, fluxo);
    return instrucoesDoRobo({ loja, jeito, assuntos, conhecimento }, fluxo);
  }
}
