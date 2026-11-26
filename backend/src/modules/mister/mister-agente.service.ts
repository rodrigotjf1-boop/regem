import { Injectable, Logger, OnModuleInit, Optional } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ehServidorLocal } from '../../common/modo';
import { IaEmpresaService } from '../ia/ia-empresa.service';
import { MotivoSemResposta, TETOS, TEXTOS_DO_AGENTE, blocoDaConversa, filtrarSaida, fraseDoMotivo, TrocaDaMemoria, juntarPerguntas, semValoresNoTexto } from './mister-agente.regras';
import { EscopoDoMister, MisterFerramentasService } from './mister-ferramentas.service';
import { MisterFilaService, PerguntaNaFila, Trilha } from './mister-fila.service';
import { FimDaPergunta, Vagas, modeloDasAnalises, modeloDasPerguntas, responderComFerramentas } from './mister-laco';
import { FalhaDoEnvioDoMister, MisterNumeroService } from './mister-numero.service';
import { MisterInstrucoesService } from './mister-instrucoes.service';
import { MisterConversaConfigService } from './mister-conversa-config.service';
import { MisterMemoriaService } from './mister-memoria.service';
import { linhasDaMemoria } from './mister-memoria';
import { linhasDoAndamento, temTarefaAberta } from './mister-andamento';
import type { PropostaPendente } from './mister-propostas.service';
import { PedidoDoRelatorio, botaoDoPdf, linkDoRelatorio } from './insumo-vendido';
import { enviarPdfDoInsumo } from './mister-anexos.service';
import { GraficoDaConversa, imagemDoGrafico } from './grafico/grafico-do-insumo';
import { imagemDoPlano } from './grafico/imagem-do-plano';
import type { PlanoDoGrafico } from './grafico/plano-do-grafico';
import { linhaDoLinkNaConversa } from './mister-link-publico';
import { LINKS_PARA_ABRIR_MAX, LinkParaAbrir, linhasParaAbrir } from './mister-abrir';
import { linhaDaMidia, veioDeAudio } from './mister-midia.regras';
import { MisterMidiaService } from './mister-midia.service';
import { MisterAprendizadoService } from './mister-aprendizado.service';
import { MisterRelatoriosConfigService } from './mister-relatorios-config.service';
import { linhasDasIdeias } from './mister-relatorios.regras';

/** M3c.2: o balão da resposta leva o botão "PDF" só quando cabe no corpo de uma mensagem com botões (1024 na Meta). */
const CABE_COM_BOTAO = 1000;
/** M3c (mig 443): no máximo dois links para encaminhar escritos numa resposta. */
const LINKS_POR_RESPOSTA = 2;
/** M3c.4: o endereço do Regem (o mesmo do link "Abrir no Regem" das propostas). */
const baseDoApp = () => String(process.env.APP_URL || 'https://app.dmsregem.com').replace(/\/+$/, '');
/** M3c.3: no máximo duas imagens de gráfico por resposta (duas consultas comparadas). */
const IMAGENS_POR_RESPOSTA = 2;
type AnexoDaResposta = { pedido: PedidoDoRelatorio; enviarPdf: boolean; grafico?: GraficoDaConversa };

export type { FimDaPergunta } from './mister-laco';

/* eslint-disable @typescript-eslint/no-explicit-any */

// O AGENTE DO MISTER (mig 418): responde às perguntas da fila.
//
//  • Cada pergunta: confere de novo se a pessoa ainda fala com o Mister, confere os tetos, mostra "digitando", chama o
//    modelo pela porta única da IA da empresa (`IaEmpresaService.pedir` — a chave e o medidor são dela) e executa as
//    ferramentas que o modelo pedir, até ele fechar a resposta ou um teto parar o laço.
//  • O laço é manual de propósito: cada chamada passa pela porta da IA (o medidor conta todas) e cada ferramenta roda
//    dentro do escopo que o SERVIDOR resolveu. Os blocos do modelo voltam inteiros na vez seguinte, sem edição.
//  • O que sai para o WhatsApp passa pelo filtro de saída. Falha da IA nunca vira silêncio: a pessoa recebe a frase do
//    motivo (sem chave, sem crédito, fora do ar) — e a pergunta fica na trilha com o motivo.
//  • Só na nuvem. Nada daqui lança para a fila nem para a rotina: cada falha vira log e a pergunta é encerrada.

const mascarar = (t: string) => (t.length > 4 ? `***${t.slice(-4)}` : '***');


@Injectable()
export class MisterAgenteService implements OnModuleInit {
  private readonly logger = new Logger(MisterAgenteService.name);
  private emCurso = 0;
  /** As ferramentas de todas as conversas dividem estas vagas (as consultas de uma vez rodam juntas — `mister-laco.ts`). */
  private readonly vagas = new Vagas(TETOS.consultasNoProcesso);

  constructor(
    private readonly fila: MisterFilaService,
    private readonly ferramentas: MisterFerramentasService,
    private readonly ia: IaEmpresaService,
    private readonly numero: MisterNumeroService,
    // M2b (mig 435): as instruções NO AR (o código com as trocas publicadas). Sem o serviço, o texto do código.
    @Optional() private readonly instrucoes?: MisterInstrucoesService,
    // Versão 4, M4a (mig 447): o perfil e o jeito da empresa. Sem o serviço (ou sem a migration), como hoje.
    @Optional() private readonly conversaConfig?: MisterConversaConfigService,
    // Versão 4, M4b (mig 449): a memória da empresa e da pessoa. Sem o serviço (ou sem a migration), sem memória.
    @Optional() private readonly memoria?: MisterMemoriaService,
    // Versão 5, M5c: a resposta em áudio (a nota de voz pelo DMS Graph). Sem o serviço, só o texto, como antes.
    @Optional() private readonly midia?: MisterMidiaService,
    // Versão 10, C7: os exemplos aprendidos pela tarefa feita. Sem o serviço (ou sem a migration), sem exemplos.
    @Optional() private readonly aprendizado?: MisterAprendizadoService,
    // Versão 10, C8: as ideias da semana que saíram há pouco (o "faz a 2"). Sem o serviço, a conversa segue sem elas.
    @Optional() private readonly relatorios?: MisterRelatoriosConfigService,
  ) {}

  /** As linhas das ideias da semana recentes desta pessoa (C8). Nunca lança: sem ideias ou com erro, nada. */
  private async ideiasDaConversa(escopo: EscopoDoMister): Promise<string[]> {
    const r = await this.relatorios?.ideiasRecentes(escopo.tenantId, escopo.colaboradorId).catch(() => null);
    return r ? linhasDasIdeias(r.texto, r.em, escopo.verValores && !escopo.pinPendente, semValoresNoTexto) : [];
  }

  /** O perfil e o jeito da empresa para o bloco da conversa. A leitura que falha não segura a resposta: vai sem eles. */
  private async jeitoDaEmpresa(tenantId: string): Promise<{ perfil: string | null; jeito: string | null; analisesProfundas: boolean; iaForteNasTarefas: boolean }> {
    if (!this.conversaConfig) return { perfil: null, jeito: null, analisesProfundas: false, iaForteNasTarefas: false };
    try {
      const c = await this.conversaConfig.daEmpresa(tenantId);
      return { perfil: c.perfil, jeito: c.jeito, analisesProfundas: c.analisesProfundas === true, iaForteNasTarefas: c.iaForteNasTarefas === true };
    } catch (e: any) {
      this.logger.warn(`mister: o jeito da empresa não foi lido, a resposta vai sem ele — ${e?.message ?? e}`);
      return { perfil: null, jeito: null, analisesProfundas: false, iaForteNasTarefas: false };
    }
  }

  /** As linhas da memória (o que se sabe da empresa e desta pessoa). A leitura que falha não segura a resposta: vai sem ela. */
  private async memoriaDaConversa(escopo: EscopoDoMister): Promise<{ memoria: string[] }> {
    if (!this.memoria) return { memoria: [] };
    try {
      const m = await this.memoria.paraAConversa(escopo.tenantId, escopo.colaboradorId);
      return { memoria: linhasDaMemoria(m.empresa, m.pessoa, escopo.nome) };
    } catch (e: any) {
      this.logger.warn(`mister: a memória não foi lida, a resposta vai sem ela — ${e?.message ?? e}`);
      return { memoria: [] };
    }
  }

  /** ERR-588: o que está em andamento (documentos e listas). A leitura que falha não segura a resposta: vai sem o bloco. */
  private async andamentoDaConversa(escopo: EscopoDoMister): Promise<{ andamento: string[]; tarefaAberta: boolean }> {
    try {
      const a = await this.fila.andamento(escopo.tenantId, escopo.colaboradorId);
      return { andamento: linhasDoAndamento(a.documentos, a.listas, escopo.verValores && !escopo.pinPendente), tarefaAberta: temTarefaAberta(a.documentos, a.listas) };
    } catch (e: any) {
      this.logger.warn(`mister: o trabalho em andamento não foi lido, a resposta vai sem ele — ${e?.message ?? e}`);
      return { andamento: [], tarefaAberta: false };
    }
  }

  onModuleInit(): void {
    this.fila.registrar(() => this.acordar());
  }

  /** O modelo das perguntas: o da distribuição (variável de ambiente), se estiver na tabela de preços; senão o padrão. */
  private modelo(): string {
    return modeloDasPerguntas();
  }

  // ───────────────────────────── a fila ─────────────────────────────

  /** Chegou pergunta: começa a esvaziar a fila, se ainda cabe mais uma conversa em paralelo. Não espera e não lança. */
  acordar(): void {
    if (ehServidorLocal() || this.emCurso >= TETOS.paralelas) return;
    void this.esvaziar();
  }

  /** Responde às conversas da fila, uma depois da outra, até não haver mais. Devolve quantas respondeu. Nunca lança. */
  async esvaziar(): Promise<number> {
    if (ehServidorLocal()) return 0;
    this.emCurso++;
    let feitas = 0;
    try {
      for (;;) {
        const lote = await this.fila.pegar();
        if (!lote) return feitas;
        await this.tratar(lote);
        feitas++;
      }
    } catch (e: any) {
      // Banco sem a 418 (a migration ainda não entrou): não há fila. Qualquer outra falha aparece (V11).
      if (e?.code !== '42P01') this.logger.error(`mister: a fila das perguntas parou — ${e?.message ?? e}`, e?.stack);
      return feitas;
    } finally {
      this.emCurso--;
    }
  }

  /** A rede de segurança: a cada minuto, devolve as pegas vencidas e esvazia o que ficou na fila. */
  @Cron(CronExpression.EVERY_MINUTE)
  async rotina(): Promise<void> {
    if (ehServidorLocal()) return;
    try {
      for (const p of await this.fila.devolverVencidas()) await this.dizer(p.telefone, TEXTOS_DO_AGENTE.demorou);
    } catch (e: any) {
      // Banco sem a 418 (a migration ainda não entrou): não há fila — nada a fazer, e sem barulho no log.
      if (e?.code === '42P01') return;
      this.logger.warn(`mister: a conferência das pegas vencidas falhou — ${e?.message ?? e}`);
    }
    if (this.emCurso < TETOS.paralelas) await this.esvaziar();
  }

  // ───────────────────────────── uma conversa ─────────────────────────────

  /** As perguntas de uma pega (da mesma pessoa): responde uma vez e fecha todas. Nunca lança. */
  private async tratar(lote: PerguntaNaFila[]): Promise<void> {
    const ids = lote.map((p) => p.id);
    const ultima = lote[lote.length - 1];
    const pergunta = juntarPerguntas(lote.map((p) => p.pergunta));
    const fechar = (motivo: MotivoSemResposta, trilha?: Trilha) => this.fila.concluir(ids, { motivo, trilha, perguntaJunta: pergunta });
    try {
      // A chave geral e a pessoa, conferidas de novo: entre a pergunta e a resposta o acesso pode ter mudado.
      if (!(await this.numero.ler()).ligado) return await fechar('desligado');
      const escopo = await this.ferramentas.escopo(ultima.tenantId, ultima.colaboradorId, ultima.telefone);
      if (!escopo) return await fechar('sem_acesso');

      // A trava de emergência da distribuição (`MISTER_PERGUNTAS_DESLIGADAS=1`): as perguntas param sem novo código e
      // sem desligar o resto do Mister. A pessoa é avisada — nunca silêncio — e nenhuma IA é chamada.
      if (process.env.MISTER_PERGUNTAS_DESLIGADAS === '1') {
        await this.dizer(ultima.telefone, TEXTOS_DO_AGENTE.emManutencao);
        return await fechar('manutencao');
      }

      if (lote[0].esperaS > TETOS.esperaMaxMin * 60) {
        await this.dizer(ultima.telefone, TEXTOS_DO_AGENTE.demorou);
        return await fechar('demorou');
      }
      const uso = await this.fila.usoEm24h(ultima.tenantId, ultima.colaboradorId);
      if (uso.pessoa >= TETOS.porPessoaEm24h || uso.empresa >= TETOS.porEmpresaEm24h) {
        await this.dizer(ultima.telefone, uso.pessoa >= TETOS.porPessoaEm24h ? TEXTOS_DO_AGENTE.limite(TETOS.porPessoaEm24h) : TEXTOS_DO_AGENTE.limiteDaEmpresa);
        return await fechar('limite');
      }

      if (ultima.wamid) this.numero.mostrarDigitando(ultima.wamid);
      const memoria = await this.fila.memoria(ultima.tenantId, ultima.colaboradorId);
      const fim = await this.responder(escopo, memoria, pergunta);
      if (fim.motivo) {
        const frase = fraseDoMotivo(fim.motivo, escopo.nivel);
        if (frase) await this.dizer(ultima.telefone, frase);
        return await fechar(fim.motivo, fim.trilha);
      }

      const saida = filtrarSaida(fim.texto, fim.resultados);
      const trilha: Trilha = { ...fim.trilha, conferencia: saida.notas };
      if (saida.notas.length) this.logger.warn(`mister: a resposta a ${mascarar(ultima.telefone)} saiu com nota do filtro (${saida.notas.join(', ')})`);
      // Versão 4: a REAÇÃO (a linha REACAO da resposta, como no atendente) vai à mensagem da pessoa. Quando ela é a resposta
      // inteira (sem texto e sem nada que as ferramentas trouxeram) e não deu para reagir (QR, sem o id da mensagem, a Meta
      // recusou), o emoji vai como texto — nunca silêncio. Na memória fica o emoji (o modelo não aceita resposta vazia).
      const reagiu = saida.reacao && ultima.wamid ? await this.numero.reagir(ultima.telefone, ultima.wamid, saida.reacao) : false;
      const resposta = saida.texto || saida.reacao || '';
      const extras =
        fim.anexos.length + fim.imagens.length + fim.links.length + fim.abrir.length + fim.botoes.length + fim.propostas.length + fim.graficos.length + fim.mensagens.length;
      if (!saida.texto && saida.reacao && !extras) {
        if (!reagiu && !(await this.dizer(ultima.telefone, saida.reacao))) return await fechar('envio', trilha);
        return await this.fila.concluir(ids, { resposta, trilha, perguntaJunta: pergunta });
      }
      // M3c.2: o relatório da resposta. Pedido "em PDF": o PDF vai logo depois. Senão, o botão "PDF" no balão — só pela
      // API oficial (a conexão por QR não tem botão, e o "1" de lá é da autorização) e só quando o texto cabe.
      const pdfs = fim.anexos.filter((a) => a.enviarPdf);
      // M3c.4: com um relatório só, o link da página ("Ver no Regem") vai no fim do texto — depois do filtro de saída, que
      // tira link do que a IA escreve: este sai do código, para o próprio Regem, e abre com o usuário de quem toca.
      const comVerNoRegem = fim.anexos.length === 1 ? `${resposta}\n\nVer no Regem: ${linkDoRelatorio(baseDoApp(), fim.anexos[0].pedido)}` : resposta;
      // M3c (mig 443): o link para encaminhar a quem não tem usuário também sai do código (nunca passa pela IA nem fica
      // guardado na pergunta): uma linha por link, com a data até quando vale.
      const comEncaminhar = fim.links.slice(0, LINKS_POR_RESPOSTA).reduce((t, l) => `${t}\n\n${linhaDoLinkNaConversa(l.url, l.vence)}`, comVerNoRegem);
      // O link para abrir (`abrir_no_regem`): a tela do Regem ou a matéria da notícia, também escrito pelo código, depois do
      // filtro — a IA só disse o que abrir; o endereço veio do guia ou do boletim.
      const comLinks = fim.abrir.length ? `${comEncaminhar}\n\n${linhasParaAbrir(fim.abrir)}` : comEncaminhar;
      // Versão 5 (M5a): a pergunta que veio de uma foto abre com "📷 Vi: …" — escrito pelo código (o resumo do que a foto
      // mostrou), depois do filtro de saída, para a pessoa ver na hora se o Mister entendeu a foto.
      // M5b: o áudio abre com "🎧 Entendi: "…"" (o que foi transcrito), pela mesma regra.
      const vi = linhaDaMidia(pergunta);
      const texto = vi ? `${vi}\n\n${comLinks}` : comLinks;
      // M3g: os botões que as ferramentas trouxeram (o "Desfazer" da correção) vão no mesmo balão, antes do "PDF" (até 3).
      const pedidos = [...fim.botoes, ...(!pdfs.length && fim.anexos.length === 1 ? [{ id: botaoDoPdf(fim.anexos[0].pedido), titulo: 'PDF' }] : [])].slice(0, 3);
      const comBotao = pedidos.length && texto.length <= CABE_COM_BOTAO && (await this.numero.ler()).provedor !== 'evolution' ? pedidos : undefined;
      // M3c.3: a imagem do gráfico vai antes do texto (como no protótipo). A que falha não segura a resposta.
      for (const a of fim.anexos.filter((x) => x.grafico).slice(0, IMAGENS_POR_RESPOSTA)) await this.mandarGrafico(ultima.telefone, a.grafico!);
      // Versão 5, M5d.2: os gráficos de `mostrar_grafico` (vendas por dia, por hora, por canal, mais vendidos), também antes.
      for (const g of fim.graficos.slice(0, IMAGENS_POR_RESPOSTA)) await this.mandarPlano(ultima.telefone, g);
      // M3d: a imagem da tela do "como faço" (pelo endereço público), também antes do texto; uma por resposta.
      for (const im of fim.imagens.slice(0, 1)) await this.mandarTela(ultima.telefone, im);
      const enviada = await this.dizer(ultima.telefone, texto, comBotao);
      if (!enviada) return await fechar('envio', trilha);
      for (const a of pdfs) await enviarPdfDoInsumo(this.ferramentas, this.numero, escopo, a.pedido, ultima.telefone, this.logger);
      // Versão 5, M5c: a pergunta que veio por áudio, com "Responder em áudio" ligado na empresa: o principal da resposta
      // vira a nota de voz e vai DEPOIS do texto (decisão 2 — o texto vai sempre). O que não deu fica no log.
      // V7d: com "Voz com emoção" ligada, vão também as mensagens (o tom de cada uma está só na memória) e a pergunta (o tema).
      if (veioDeAudio(pergunta) && this.midia) {
        const ajustes = await this.conversaConfig?.daEmpresa(escopo.tenantId).catch(() => null);
        if (ajustes?.responderAudio) {
          if (ajustes.vozComEmocao) await this.midia.responderEmAudio(escopo.tenantId, ultima.telefone, resposta, { wamids: lote.map((p) => p.wamid), pergunta });
          else await this.midia.responderEmAudio(escopo.tenantId, ultima.telefone, resposta);
        }
      }
      // F4.3: a proposta que a pergunta criou sai logo depois da resposta, com os botões da F4.1 (só o presidente chega
      // aqui com proposta: a ferramenta recusa os outros). Falhou o envio: a proposta vence sozinha no prazo.
      for (const p of fim.propostas) {
        try {
          // F4.2: a de PIN (cancelar com o estorno) vai com o link "Abrir no Regem", nunca com botões.
          if (p.nivel === 'pin') await this.ferramentas.enviarLinkDaProposta(escopo, p, ultima.telefone);
          else await this.numero.enviar(ultima.telefone, { texto: p.pergunta, botoes: p.botoes });
        } catch (e: any) {
          this.logger.warn(`mister: a proposta ${p.id} não saiu para ${mascarar(ultima.telefone)} (${e instanceof FalhaDoEnvioDoMister ? e.motivo : (e?.message ?? e)})`);
        }
      }
      // Versão 6, M6g: as mensagens que uma ação montou (a primeira pergunta da lista de compras, com os botões) saem depois
      // da resposta, como a proposta. Falhou o envio: fica no log (a lista espera e vence sozinha).
      for (const m of fim.mensagens) {
        try {
          await this.numero.enviar(ultima.telefone, m.botoes?.length ? { texto: m.texto, botoes: m.botoes } : { texto: m.texto });
        } catch (e: any) {
          this.logger.warn(`mister: a mensagem da ação não saiu para ${mascarar(ultima.telefone)} (${e instanceof FalhaDoEnvioDoMister ? e.motivo : (e?.message ?? e)})`);
        }
      }
      // Versão 6, M6d: a sessão com PIN pendente — o link para confirmar, depois da resposta (uma vez por link que vale).
      if (escopo.pinPendente)
        await this.ferramentas.linkDaSessao(escopo, ultima.telefone).catch((e: any) => this.logger.warn(`mister: o link da sessão com PIN não saiu — ${e?.message ?? e}`));
      await this.fila.concluir(ids, { resposta, trilha, perguntaJunta: pergunta });
    } catch (e: any) {
      this.logger.error(`mister: a pergunta ${ultima.id} de ${mascarar(ultima.telefone)} não foi respondida — ${e?.message ?? e}`, e?.stack);
      await this.dizer(ultima.telefone, TEXTOS_DO_AGENTE.passageira);
      await fechar('erro').catch((erro) => this.logger.error(`mister: a pergunta ${ultima.id} não foi fechada — ${erro?.message ?? erro}`));
    }
  }

  /** M3c.3: a imagem do gráfico (o PNG feito pelo código). Nunca lança: a falha fica no log e a resposta segue sem ela. */
  /** M3d: a imagem da tela do "como faço". Nunca lança: a falha fica no log e a resposta segue sem ela. */
  private async mandarTela(telefone: string, im: { url: string; legenda: string }): Promise<void> {
    try {
      await this.numero.enviarImagemPorLink(telefone, im.url, im.legenda);
    } catch (e: any) {
      const motivo = e instanceof FalhaDoEnvioDoMister ? `${e.motivo}${e.status ? ` ${e.status}` : ''}` : String(e?.message ?? e);
      this.logger.warn(`mister: a imagem da tela não saiu para ${mascarar(telefone)} (${motivo})`);
    }
  }

  /** Versão 5, M5d.2: a imagem de um plano de gráfico. Nunca lança: a falha fica no log e a resposta segue sem ela. */
  private async mandarPlano(telefone: string, p: PlanoDoGrafico): Promise<void> {
    try {
      await this.numero.enviarImagem(telefone, imagemDoPlano(p));
    } catch (e: any) {
      const motivo = e instanceof FalhaDoEnvioDoMister ? `${e.motivo}${e.status ? ` ${e.status}` : ''}` : String(e?.message ?? e);
      this.logger.warn(`mister: a imagem do gráfico "${p.titulo}" não saiu para ${mascarar(telefone)} (${motivo})`);
    }
  }

  private async mandarGrafico(telefone: string, g: GraficoDaConversa): Promise<void> {
    try {
      await this.numero.enviarImagem(telefone, imagemDoGrafico(g));
    } catch (e: any) {
      const motivo = e instanceof FalhaDoEnvioDoMister ? `${e.motivo}${e.status ? ` ${e.status}` : ''}` : String(e?.message ?? e);
      this.logger.warn(`mister: a imagem do gráfico não saiu para ${mascarar(telefone)} (${motivo})`);
    }
  }

  /** Manda um texto pelo número do Mister (com botões, quando vierem). Devolve se saiu; a falha fica no log, com o motivo. */
  private async dizer(telefone: string, texto: string, botoes?: { id: string; titulo: string }[]): Promise<boolean> {
    try {
      await this.numero.enviar(telefone, botoes?.length ? { texto, botoes } : { texto });
      return true;
    } catch (e: any) {
      const motivo = e instanceof FalhaDoEnvioDoMister ? `${e.motivo}${e.status ? ` ${e.status}` : ''}${e.detalhe ? ` — ${e.detalhe}` : ''}` : String(e?.message ?? e);
      this.logger.warn(`mister: a resposta a ${mascarar(telefone)} não saiu (${motivo})`);
      return false;
    }
  }

  // ───────────────────────────── o laço do agente ─────────────────────────────

  /**
   * Uma pergunta ao modelo, com as ferramentas, dentro do escopo da pessoa. Devolve o texto do modelo (ainda sem o
   * filtro de saída) e o que as ferramentas trouxeram — ou o motivo de não haver resposta. Não lança por falha da IA.
   */
  async responder(
    escopo: EscopoDoMister,
    memoria: TrocaDaMemoria[],
    pergunta: string,
    opcoes: { recurso?: string } = {},
  ): Promise<
    FimDaPergunta & {
      propostas: PropostaPendente[];
      anexos: AnexoDaResposta[];
      botoes: { id: string; titulo: string }[];
      imagens: { url: string; legenda: string }[];
      links: { url: string; vence: Date }[];
      abrir: LinkParaAbrir[];
      graficos: PlanoDoGrafico[];
      mensagens: { texto: string; botoes?: { id: string; titulo: string }[] }[];
    }
  > {
    // O laço é o de `mister-laco.ts` (o mesmo da avaliação de regressão): aqui as portas são a IA da empresa, com o
    // medidor dela, e as ferramentas no escopo que o servidor resolveu. F4.3: a proposta que uma ferramenta criou fica
    // de lado (não vai ao modelo) — quem chamou manda os botões depois da resposta.
    const propostas: PropostaPendente[] = [];
    // M3c.2: o relatório que uma consulta trouxe (o mesmo pedido duas vezes conta uma).
    const anexos: AnexoDaResposta[] = [];
    // M3g: os botões da resposta (o "Desfazer" da correção), sem repetir.
    const botoes: { id: string; titulo: string }[] = [];
    // M3d: as imagens das telas do "como faço" (sem repetir).
    const imagens: { url: string; legenda: string }[] = [];
    // M3c (mig 443): os links para encaminhar que a pergunta criou (não vão ao modelo).
    const links: { url: string; vence: Date }[] = [];
    // Os links para abrir (a tela ou a matéria), sem repetir, até o teto (não vão ao modelo).
    const abrir: LinkParaAbrir[] = [];
    // Versão 5, M5d.2: os gráficos que `mostrar_grafico` montou (não vão ao modelo; a imagem vai antes do texto).
    const graficos: PlanoDoGrafico[] = [];
    // Versão 6, M6g: as mensagens que uma ação manda depois da resposta (não vão ao modelo).
    const mensagens: { texto: string; botoes?: { id: string; titulo: string }[]; chave?: string }[] = [];
    // M2b: o texto no ar. A leitura que falha não segura a resposta: vai o texto do código (e o log diz por quê).
    const instrucoes = this.instrucoes
      ? await this.instrucoes.noAr().then(
          (i) => i.texto,
          (e) => {
            this.logger.warn(`mister: as instruções no ar não foram lidas, vai o texto do código — ${e?.message ?? e}`);
            return undefined;
          },
        )
      : undefined;
    const { analisesProfundas, iaForteNasTarefas, ...jeito } = await this.jeitoDaEmpresa(escopo.tenantId);
    const { tarefaAberta, ...andamento } = await this.andamentoDaConversa(escopo);
    const fim = await responderComFerramentas(
      {
        modelo: this.modelo(),
        // Versão 7, V7e (V7-7): só nas perguntas (o relatório tem o recurso dele e fica no modelo de sempre).
        modeloDaAnalise: analisesProfundas && !opcoes.recurso ? modeloDasAnalises() : null,
        // Versão 9, O6: com uma tarefa em andamento (cupom, nota, lista), a pergunta inteira no modelo maior.
        modeloDaTarefa: iaForteNasTarefas && tarefaAberta && !opcoes.recurso ? modeloDasAnalises() : null,
        instrucoes,
        recurso: opcoes.recurso,
        conversa: blocoDaConversa({
          ...this.ferramentas.conversa(escopo),
          ...jeito,
          ...(await this.memoriaDaConversa(escopo)),
          ...andamento,
          // Versão 10, C7: até 3 exemplos de tarefas parecidas que a empresa confirmou (com "Aprender pela tarefa feita" ligado).
          // Não no relatório (não é pergunta de alguém).
          exemplos: this.aprendizado && !opcoes.recurso ? await this.aprendizado.exemplosParaAConversa(escopo.tenantId, pergunta, escopo.verValores && !escopo.pinPendente) : [],
          // Versão 10, C8: as ideias da semana dos últimos 3 dias, para o "faz a 2". Não no relatório.
          ideias: this.relatorios && !opcoes.recurso ? await this.ideiasDaConversa(escopo) : [],
        }),
        pedir: (p) => this.ia.pedir(escopo.tenantId, p),
        executar: (nome, entrada) => this.vagas.com(() => this.ferramentas.executar(escopo, nome, entrada)),
        // Na ordem do pedido (as consultas juntas terminam em qualquer ordem): os anexos e as imagens saem na ordem pedida.
        colher: (r) => {
          if (r.proposta && !propostas.some((p) => p.id === r.proposta!.id)) propostas.push(r.proposta);
          for (const b of r.botoes ?? []) if (!botoes.some((x) => x.id === b.id)) botoes.push(b);
          for (const im of r.imagens ?? []) if (!imagens.some((x) => x.url === im.url)) imagens.push(im);
          if (r.linkPublico) links.push(r.linkPublico);
          for (const l of r.abrir ?? []) if (abrir.length < LINKS_PARA_ABRIR_MAX && !abrir.some((x) => x.url === l.url)) abrir.push(l);
          for (const g of r.graficos ?? []) if (graficos.length < IMAGENS_POR_RESPOSTA) graficos.push(g);
          // ERR-594: duas alterações no mesmo documento numa resposta mandam só a última "próxima pergunta".
          for (const m of r.mensagens ?? []) {
            const ja = m.chave ? mensagens.findIndex((x) => x.chave === m.chave) : -1;
            if (ja >= 0) mensagens[ja] = m;
            else mensagens.push(m);
          }
          if (r.anexo) {
            const ja = anexos.find((a) => botaoDoPdf(a.pedido) === botaoDoPdf(r.anexo!.pedido));
            if (ja) ja.enviarPdf = ja.enviarPdf || r.anexo.enviarPdf;
            else anexos.push({ ...r.anexo });
          }
        },
      },
      memoria,
      pergunta,
    );
    return { ...fim, propostas, anexos, botoes, imagens, links, abrir, graficos, mensagens };
  }
}
