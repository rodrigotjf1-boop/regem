import { Controller, Get, Headers, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { CloudOnly } from '../../common/cloud-only.decorator';
import { CABECALHO_SEGREDO_ROBO, segredoDaChamada } from '../../common/segredo-robo';
import { CardapioService } from './cardapio.service';
import { buscarNoCardapio, pontoDaLocalizacao, resumoDaLoja, taxaDoBairro, taxaDoEndereco } from './robo-consultas';
import { categoriasPorPapel, procurarNoCardapio } from './robo-busca';
import { aplicarNoResumo } from './situacao-da-loja';
import { situacaoAgoraParaAsInstrucoes } from './situacao-agora';
import { fluxoComFerramentas26, instrucoesDoChat, instrucoesDoDirect, instrucoesDoMessenger, instrucoesDosComentarios, instrucoesDoRobo } from './robo-instrucoes';
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
    const resumo = resumoDaLoja(menu, this.service.linkDoCardapio(token));
    // A loja está atendendo AGORA (15/11): o horário do cardápio é dado fixo — confere a 99, a pausa do Regem e o servidor
    // da loja; fechada pelos aplicativos dentro do horário = `abertaAgora` false (`situacao-da-loja.ts`).
    const [conferida, agora] = await Promise.all([
      this.service.situacaoConferida(token, resumo.abertaAgora && !resumo.pausadaPelaLoja),
      // O tempo de espera AGORA (26/11, `tempo-de-espera.ts`): com a cozinha mais lenta que o normal, a faixa de agora junto
      // do tempo configurado; sem isso, nada (vale o configurado).
      this.service.tempoDeEsperaAgora(token),
    ]);
    const comAgora = {
      ...resumo,
      atende: {
        ...resumo.atende,
        entrega: resumo.atende.entrega && agora.entrega ? { ...resumo.atende.entrega, tempoAgora: agora.entrega } : resumo.atende.entrega,
        retirada: resumo.atende.retirada && agora.retirada ? { ...resumo.atende.retirada, tempoAgora: agora.retirada } : resumo.atende.retirada,
      },
    };
    // + as categorias por papel (bebidas, sobremesas, porções): o que oferecer no fim do pedido (F2).
    return { ...aplicarNoResumo(comAgora, conferida), categoriasParaOferecer: categoriasPorPapel(menu) };
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
    // Item 4 (27/11): na loja por distância ou por área no mapa, o endereço (rua e número) ou a localização do WhatsApp
    // ("[localização] lat,lng") passam pela MESMA conta do cardápio e do `definir_entrega` — sem montar pedido.
    @Query('rua') rua?: string,
    @Query('numero') numero?: string,
    @Query('localizacao') localizacao?: string,
  ) {
    const { token, menu } = await this.cardapio(segredoDaChamada(segredo, secret), instancia, phoneNumberId);
    const porPonto = menu?.loja?.areaModo === 'raio' || menu?.loja?.areaModo === 'mapa';
    const ponto = pontoDaLocalizacao(localizacao);
    const r = String(rua ?? '').trim().slice(0, 120);
    const n = String(numero ?? '').trim().slice(0, 20);
    if (porPonto && (ponto || (r && n))) {
      const cfg = await this.service.resolver(token);
      const t = await this.service.taxaDeEntrega(cfg, ponto ? { lat: ponto.lat, lng: ponto.lng } : { rua: r, numero: n }, 0);
      return taxaDoEndereco(menu, t);
    }
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
    // A versão do fluxo do n8n (27/11): a 2.6 tem `promocoes_da_loja` e a taxa por endereço — só ela recebe o texto delas.
    @Query('versaoDoFluxo') versaoDoFluxo?: string,
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
    const [jeito, assuntos, conhecimento, printAjuda, pedidoAgendado] = await Promise.all([
      this.service.jeitoDoAtendenteDoRobo(token, canal, { foraDoHorario: teste?.foraDoHorario === true }),
      canal === 'chat' || canal === 'comentarios' ? Promise.resolve('') : this.service.assuntosDoAtendenteDoRobo(token, canal),
      this.service.conhecimentoDoRobo(token),
      // O print de ajuda (mig 442, D3): só no WhatsApp (as instruções do Direct, do Messenger, do chat e dos comentários não o usam).
      canal === 'whatsapp' ? this.service.printDeAjudaDoRobo(token) : Promise.resolve(false),
      // O pedido agendado (mig 455, D4c): só no WhatsApp, onde o robô monta e registra o pedido.
      canal === 'whatsapp' ? this.service.agendadoDoRobo(token) : Promise.resolve(false),
    ]);
    if (canal === 'comentarios') return instrucoesDosComentarios({ loja, jeito, conhecimento }, fluxo);
    if (canal === 'chat') return instrucoesDoChat({ loja, jeito, conhecimento, plataforma: chat?.plataforma ?? 'ifood', teste: !!teste }, fluxo);
    if (canal === 'messenger') return instrucoesDoMessenger({ loja, jeito, assuntos, conhecimento }, fluxo);
    if (canal === 'direct') return instrucoesDoDirect({ loja, jeito, assuntos, conhecimento }, fluxo);
    // A situação da loja AGORA (27/11, ERR-629): o que está aberto e as formas de pagamento, lidos nesta mensagem com o
    // veredito conferido — a mesma do `consultar_loja`. Falhou a conferência: o bloco sai só com o cardápio (nunca derruba
    // as instruções).
    // A mesma entrada do `consultar_loja`: aberta pelo horário e sem a loja fechada à mão nem pausada (`resumoDaLoja`).
    const abertaParaConferir = !!(menu as any)?.abertaAgora && (menu as any)?.loja?.aberto !== false && !(menu as any)?.pausa;
    let conferida: Awaited<ReturnType<CardapioService['situacaoConferida']>> | null = null;
    try {
      conferida = await this.service.situacaoConferida(token, abertaParaConferir);
    } catch {
      conferida = null;
    }
    const agora = situacaoAgoraParaAsInstrucoes(menu, conferida);
    return instrucoesDoRobo(
      { loja, jeito, assuntos, conhecimento, printAjuda, pedidoAgendado, ferramentas26: fluxoComFerramentas26(versaoDoFluxo), agora },
      fluxo,
    );
  }
}
