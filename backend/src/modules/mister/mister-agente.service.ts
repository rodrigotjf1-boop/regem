import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ehServidorLocal } from '../../common/modo';
import { IaEmpresaService } from '../ia/ia-empresa.service';
import { MotivoSemResposta, TETOS, TEXTOS_DO_AGENTE, blocoDaConversa, filtrarSaida, fraseDoMotivo, TrocaDaMemoria, juntarPerguntas } from './mister-agente.regras';
import { EscopoDoMister, MisterFerramentasService } from './mister-ferramentas.service';
import { MisterFilaService, PerguntaNaFila, Trilha } from './mister-fila.service';
import { FimDaPergunta, modeloDasPerguntas, responderComFerramentas } from './mister-laco';
import { FalhaDoEnvioDoMister, MisterNumeroService } from './mister-numero.service';
import type { PropostaPendente } from './mister-propostas.service';

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

  constructor(
    private readonly fila: MisterFilaService,
    private readonly ferramentas: MisterFerramentasService,
    private readonly ia: IaEmpresaService,
    private readonly numero: MisterNumeroService,
  ) {}

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
      const enviada = await this.dizer(ultima.telefone, saida.texto);
      if (!enviada) return await fechar('envio', trilha);
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
      await this.fila.concluir(ids, { resposta: saida.texto, trilha, perguntaJunta: pergunta });
    } catch (e: any) {
      this.logger.error(`mister: a pergunta ${ultima.id} de ${mascarar(ultima.telefone)} não foi respondida — ${e?.message ?? e}`, e?.stack);
      await this.dizer(ultima.telefone, TEXTOS_DO_AGENTE.passageira);
      await fechar('erro').catch((erro) => this.logger.error(`mister: a pergunta ${ultima.id} não foi fechada — ${erro?.message ?? erro}`));
    }
  }

  /** Manda um texto pelo número do Mister. Devolve se saiu; a falha fica no log, com o motivo. */
  private async dizer(telefone: string, texto: string): Promise<boolean> {
    try {
      await this.numero.enviar(telefone, { texto });
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
  ): Promise<FimDaPergunta & { propostas: PropostaPendente[] }> {
    // O laço é o de `mister-laco.ts` (o mesmo da avaliação de regressão): aqui as portas são a IA da empresa, com o
    // medidor dela, e as ferramentas no escopo que o servidor resolveu. F4.3: a proposta que uma ferramenta criou fica
    // de lado (não vai ao modelo) — quem chamou manda os botões depois da resposta.
    const propostas: PropostaPendente[] = [];
    const fim = await responderComFerramentas(
      {
        modelo: this.modelo(),
        recurso: opcoes.recurso,
        conversa: blocoDaConversa(this.ferramentas.conversa(escopo)),
        pedir: (p) => this.ia.pedir(escopo.tenantId, p),
        executar: async (nome, entrada) => {
          const r = await this.ferramentas.executar(escopo, nome, entrada);
          if (r.proposta && !propostas.some((p) => p.id === r.proposta!.id)) propostas.push(r.proposta);
          return r;
        },
      },
      memoria,
      pergunta,
    );
    return { ...fim, propostas };
  }
}
