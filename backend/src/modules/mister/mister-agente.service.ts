import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ehServidorLocal } from '../../common/modo';
import { FalhaDaIa, IaEmpresaService } from '../ia/ia-empresa.service';
import { PRECOS_POR_MILHAO } from '../ia/ia.regras';
import {
  FERRAMENTAS,
  INSTRUCOES_DO_MISTER,
  MODELO_DAS_PERGUNTAS,
  MotivoSemResposta,
  RECURSO_DAS_PERGUNTAS,
  TETOS,
  TEXTOS_DO_AGENTE,
  blocoDaConversa,
  filtrarSaida,
  fraseDoMotivo,
  TrocaDaMemoria,
  entradaParaATrilha,
  juntarPerguntas,
  perguntaDaMemoria,
} from './mister-agente.regras';
import { EscopoDoMister, MisterFerramentasService } from './mister-ferramentas.service';
import { MisterFilaService, PerguntaNaFila, Trilha } from './mister-fila.service';
import { FalhaDoEnvioDoMister, MisterNumeroService } from './mister-numero.service';

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

export type FimDaPergunta = { texto: string; motivo: null; trilha: Trilha; resultados: unknown[] } | { texto: null; motivo: MotivoSemResposta; trilha: Trilha };

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
    const pedido = String(process.env.MISTER_MODELO_PERGUNTAS ?? '').trim();
    return pedido && PRECOS_POR_MILHAO[pedido] ? pedido : MODELO_DAS_PERGUNTAS;
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
  async responder(escopo: EscopoDoMister, memoria: TrocaDaMemoria[], pergunta: string): Promise<FimDaPergunta> {
    const modelo = this.modelo();
    const trilha: Required<Omit<Trilha, 'conferencia'>> = { modelo, chamadas: 0, tokensEntrada: 0, tokensSaida: 0, ferramentas: [] };
    const resultados: unknown[] = [];
    const inicio = Date.now();
    // As instruções fixas levam a marca de cache (as ferramentas, que vêm antes delas, entram no mesmo trecho); o
    // bloco da conversa muda de pessoa para pessoa e fica depois da marca.
    const system = [
      { type: 'text', text: INSTRUCOES_DO_MISTER, cache_control: { type: 'ephemeral' } },
      { type: 'text', text: blocoDaConversa(this.ferramentas.conversa(escopo)) },
    ];
    const messages: Array<{ role: 'user' | 'assistant'; content: any }> = [];
    // Cada pergunta antiga vai com a hora e as consultas feitas naquela hora (o modelo não vê os resultados antigos).
    for (const m of memoria) messages.push({ role: 'user', content: perguntaDaMemoria(m) }, { role: 'assistant', content: m.resposta });
    messages.push({ role: 'user', content: pergunta });

    try {
      for (let volta = 1; volta <= TETOS.voltas; volta++) {
        if (Date.now() - inicio > TETOS.prazoMs) return { texto: null, motivo: 'nao_fechou', trilha };
        const r = await this.ia.pedir(escopo.tenantId, {
          recurso: RECURSO_DAS_PERGUNTAS,
          modelo,
          maxTokens: TETOS.maxTokens,
          system,
          tools: FERRAMENTAS,
          messages,
          prazoMs: TETOS.prazoDaChamadaMs,
        });
        trilha.chamadas++;
        trilha.tokensEntrada += r.uso.entrada + r.uso.cacheEscrita + r.uso.cacheLeitura;
        trilha.tokensSaida += r.uso.saida;
        if (r.recusou) return { texto: null, motivo: 'recusou', trilha };

        const pedidos = r.conteudo.filter((b: any) => b?.type === 'tool_use');
        if (r.parou !== 'tool_use' || !pedidos.length) {
          // Resposta cortada pelo limite de tamanho não vai pela metade.
          if (r.parou === 'max_tokens' || !r.texto) return { texto: null, motivo: 'nao_fechou', trilha };
          return { texto: r.texto, motivo: null, trilha, resultados };
        }

        // O que o modelo disse volta INTEIRO (com os blocos de raciocínio), e cada pedido de ferramenta recebe a resposta.
        messages.push({ role: 'assistant', content: r.conteudo });
        const respostas: any[] = [];
        for (const p of pedidos) {
          if (trilha.ferramentas.length >= TETOS.ferramentas) {
            respostas.push({ type: 'tool_result', tool_use_id: p.id, content: JSON.stringify({ erro: 'Limite de consultas desta pergunta atingido. Responda com o que já tem.' }), is_error: true });
            continue;
          }
          const t0 = Date.now();
          const feito = await this.ferramentas.executar(escopo, p.name, p.input);
          trilha.ferramentas.push({ nome: String(p.name).slice(0, 60), ms: Date.now() - t0, ok: feito.ok, entrada: entradaParaATrilha(p.input) });
          if (feito.ok) resultados.push(feito.dados);
          respostas.push({ type: 'tool_result', tool_use_id: p.id, content: JSON.stringify(feito.dados), ...(feito.ok ? {} : { is_error: true }) });
        }
        messages.push({ role: 'user', content: respostas });
      }
      return { texto: null, motivo: 'nao_fechou', trilha };
    } catch (e: any) {
      if (e instanceof FalhaDaIa) return { texto: null, motivo: e.motivo, trilha };
      throw e;
    }
  }
}
