import { FalhaDaIa, PedidoDeIa, RespostaDaIa } from '../ia/ia-empresa.service';
import { PRECOS_POR_MILHAO } from '../ia/ia.regras';
import { FERRAMENTAS, FERRAMENTAS_DA_ANALISE, INSTRUCOES_DO_MISTER, MODELO_DAS_ANALISES, MODELO_DAS_PERGUNTAS, MotivoSemResposta, RECURSO_DAS_PERGUNTAS, TETOS, TrocaDaMemoria, entradaParaATrilha, ferramentasDaConversa, perguntaDaMemoria, podeRodarJunto } from './mister-agente.regras';

/** O modelo das perguntas: o da distribuição (`MISTER_MODELO_PERGUNTAS`), se estiver na tabela de preços; senão o padrão. */
export function modeloDasPerguntas(): string {
  const pedido = String(process.env.MISTER_MODELO_PERGUNTAS ?? '').trim();
  return pedido && PRECOS_POR_MILHAO[pedido] ? pedido : MODELO_DAS_PERGUNTAS;
}

/** Versão 7, V7e: o modelo maior das análises, só se ele tem preço na tabela (sem preço não há como medir o custo). */
export const modeloDasAnalises = (): string | null => (PRECOS_POR_MILHAO[MODELO_DAS_ANALISES] ? MODELO_DAS_ANALISES : null);
import { comAContaDasFases } from './mister-analises';
import { comOQueDeixaDeChegar } from './mister-regra';
import type { ResultadoDaFerramenta } from './mister-ferramentas.service';
import type { Trilha } from './mister-fila.service';
import { falaDaPessoa } from './mister-midia.regras';

/* eslint-disable @typescript-eslint/no-explicit-any */

// O LAÇO DO AGENTE DO MISTER (mig 418): uma pergunta ao modelo, com as ferramentas, até ele fechar a resposta ou um teto
// parar. Está à parte do `MisterAgenteService` para a AVALIAÇÃO DE REGRESSÃO (F5.3) rodar o MESMO laço — as mesmas
// instruções, as mesmas ferramentas, os mesmos tetos — com a chave da distribuição e os dados inventados da loja de
// teste, sem depender dos módulos de dados (Painel, Relatórios, Delivery…).
//
//  • As portas decidem de onde vem a IA (a da empresa, com o medidor dela; ou a da distribuição) e onde as ferramentas
//    rodam (no escopo que o SERVIDOR resolveu; ou nos dados da avaliação). O laço não sabe qual é qual.
//  • Os blocos do modelo voltam inteiros na vez seguinte, sem edição. Falha da IA vira o motivo (quem chama escolhe a
//    frase); qualquer outro erro sobe.
//  • As consultas que o modelo pede na MESMA vez rodam juntas (até `TETOS.consultasJuntas`), como o Hermes faz com as
//    ferramentas de uma mesma volta: a pergunta que pede o resumo, as vendas e o estoque não espera uma depois da outra.
//    Se a vez traz uma ação (propor, mandar o link, corrigir), tudo roda uma de cada vez, na ordem pedida. A resposta ao
//    modelo, a trilha e o `colher` seguem SEMPRE a ordem do pedido, termine quem terminar primeiro.

/** Quantas ferramentas rodam ao mesmo tempo NESTE PROCESSO, somadas todas as conversas. Quem espera não segura conexão. */
export class Vagas {
  private livres: number;
  private readonly espera: Array<() => void> = [];

  constructor(total: number) {
    this.livres = Math.max(1, Math.floor(total));
  }

  async com<T>(trabalho: () => Promise<T>): Promise<T> {
    if (this.livres > 0) this.livres--;
    else await new Promise<void>((entrar) => this.espera.push(entrar));
    try {
      return await trabalho();
    } finally {
      // A vaga passa direto a quem espera (sem voltar ao contador): ninguém fura a fila.
      const proximo = this.espera.shift();
      if (proximo) proximo();
      else this.livres++;
    }
  }
}

/**
 * Roda as tarefas com no máximo `juntas` ao mesmo tempo e devolve os resultados NA ORDEM das tarefas. Se uma falha, as
 * que já começaram terminam, nenhuma nova começa e o primeiro erro sobe (com `juntas` = 1, é o "uma de cada vez" de antes).
 */
export async function rodarNaOrdem<T>(tarefas: ReadonlyArray<() => Promise<T>>, juntas: number): Promise<T[]> {
  const fora = new Array<T>(tarefas.length);
  let proxima = 0;
  let falha: { erro: unknown } | null = null;
  const trabalhador = async () => {
    while (!falha && proxima < tarefas.length) {
      const i = proxima++;
      try {
        fora[i] = await tarefas[i]();
      } catch (erro) {
        falha ??= { erro };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(Math.max(1, Math.floor(juntas)), tarefas.length) }, trabalhador));
  if (falha) throw (falha as { erro: unknown }).erro;
  return fora;
}

export interface PortasDoLaco {
  /** O modelo desta pergunta. */
  modelo: string;
  /**
   * Versão 7, V7e ("Análises mais profundas", V7-7): o modelo das voltas DEPOIS que `analisar_vendas` ou `indicadores_financeiros` (V7f) trouxe dados. Sem ele, a
   * pergunta inteira fica em `modelo`. Cada chamada é medida pelo modelo que ela usou de fato.
   */
  modeloDaAnalise?: string | null;
  /**
   * Versão 9, O6 ("IA mais forte nas tarefas", o dono: "intercalar Haiku e Sonnet"): com um cupom, uma nota ou uma lista em
   * andamento e o ajuste ligado, a pergunta inteira começa neste modelo. Se ele falhar, segue no `modelo`.
   */
  modeloDaTarefa?: string | null;
  /** O recurso no medidor (o relatório passa o dele). */
  recurso?: string;
  /** O bloco "Esta conversa", já montado (`blocoDaConversa`). */
  conversa: string;
  /** M2b (mig 435): o texto das instruções no ar (o do código com as trocas publicadas) ou o da candidata; sem ele, o do código. */
  instrucoes?: string;
  /** A avaliação mede também a consulta que ainda não foi ligada nas conversas (fase N3 das Notícias do ramo). */
  todasAsFerramentas?: boolean;
  pedir(p: PedidoDeIa): Promise<RespostaDaIa>;
  executar(nome: unknown, entrada: unknown): Promise<ResultadoDaFerramenta>;
  /** Recebe cada resultado na ORDEM em que o modelo pediu (as consultas juntas terminam em qualquer ordem). */
  colher?(r: ResultadoDaFerramenta): void;
}

export type FimDaPergunta = { texto: string; motivo: null; trilha: Trilha; resultados: unknown[] } | { texto: null; motivo: MotivoSemResposta; trilha: Trilha };

/**
 * Uma pergunta ao modelo, com as ferramentas. Devolve o texto do modelo (ainda sem o filtro de saída) e o que as
 * ferramentas trouxeram — ou o motivo de não haver resposta. Não lança por falha da IA.
 */
export async function responderComFerramentas(portas: PortasDoLaco, memoria: TrocaDaMemoria[], pergunta: string): Promise<FimDaPergunta> {
  let modelo = portas.modeloDaTarefa ?? portas.modelo;
  const trilha: Required<Omit<Trilha, 'conferencia'>> = { modelo, chamadas: 0, tokensEntrada: 0, tokensSaida: 0, ferramentas: [] };
  const resultados: unknown[] = [];
  const inicio = Date.now();
  // As instruções fixas levam a marca de cache (as ferramentas, que vêm antes delas, entram no mesmo trecho); o
  // bloco da conversa muda de pessoa para pessoa e fica depois da marca.
  const system = [
    { type: 'text', text: portas.instrucoes ?? INSTRUCOES_DO_MISTER, cache_control: { type: 'ephemeral' } },
    { type: 'text', text: portas.conversa },
  ];
  const messages: Array<{ role: 'user' | 'assistant'; content: any }> = [];
  // Cada pergunta antiga vai com a hora e as consultas feitas naquela hora (o modelo não vê os resultados antigos).
  for (const m of memoria) messages.push({ role: 'user', content: perguntaDaMemoria(m) }, { role: 'assistant', content: m.resposta });
  messages.push({ role: 'user', content: pergunta });

  try {
    for (let volta = 1; volta <= TETOS.voltas; volta++) {
      if (Date.now() - inicio > TETOS.prazoMs) return { texto: null, motivo: 'nao_fechou', trilha };
      let r: RespostaDaIa;
      try {
        r = await portas.pedir({
          // O relatório (mig 420) passa o recurso dele: cada um soma no seu no "Uso da IA".
          recurso: portas.recurso ?? RECURSO_DAS_PERGUNTAS,
          modelo,
          maxTokens: modelo === portas.modelo ? TETOS.maxTokens : TETOS.maxTokensDaAnalise,
          system,
          tools: portas.todasAsFerramentas ? FERRAMENTAS : ferramentasDaConversa(),
          messages,
          prazoMs: TETOS.prazoDaChamadaMs,
        });
      } catch (e) {
        // V7e: o modelo maior falhou (sem acesso, limite, demora). A análise já está na conversa: o modelo de sempre responde.
        if (!(e instanceof FalhaDaIa) || modelo === portas.modelo) throw e;
        modelo = portas.modelo;
        continue;
      }
      trilha.chamadas++;
      trilha.modelo = modelo; // o da última chamada: é o que escreveu a resposta
      trilha.tokensEntrada += r.uso.entrada + r.uso.cacheEscrita + r.uso.cacheLeitura;
      trilha.tokensSaida += r.uso.saida;
      if (r.recusou) return { texto: null, motivo: 'recusou', trilha };

      const pedidos = r.conteudo.filter((b: any) => b?.type === 'tool_use');
      if (r.parou !== 'tool_use' || !pedidos.length) {
        // Resposta cortada pelo limite de tamanho não vai pela metade.
        if (r.parou === 'max_tokens' || !r.texto) return { texto: null, motivo: 'nao_fechou', trilha };
        return { texto: comAContaDasFases(comOQueDeixaDeChegar(r.texto, resultados), resultados), motivo: null, trilha, resultados };
      }

      // O que o modelo disse volta INTEIRO (com os blocos de raciocínio), e cada pedido de ferramenta recebe a resposta.
      messages.push({ role: 'assistant', content: r.conteudo });
      // O teto da pergunta decide-se na ordem do pedido, antes de rodar: o que passa dele nem roda.
      const rodam = pedidos.slice(0, Math.max(0, TETOS.ferramentas - trilha.ferramentas.length));
      const juntas = rodam.every((p: any) => podeRodarJunto(p.name)) ? TETOS.consultasJuntas : 1;
      // Versão 10, C10a e C10b: o `propor_acao` e o `grafico_livre` recebem a origem dos números (o que as consultas desta pergunta trouxeram e o que a
      // pessoa escreveu) para a imagem só levar número da loja que tem de onde vir. Sempre a do laço: o que o modelo puser
      // em `__origem` é sobrescrito. A trilha guarda a entrada do modelo, sem isto.
      // Rodada 7, MIS-E-09 (ERR-656): da pergunta com foto, só o que a pessoa escreveu vale como fala (o texto da foto, não).
      const falas = [falaDaPessoa(pergunta), ...memoria.map((m) => falaDaPessoa(m.pergunta))];
      const entradaDe = (p: any) => ((p.name === 'propor_acao' || p.name === 'grafico_livre' || p.name === 'fazer_no_regem') && p.input && typeof p.input === 'object' ? { ...p.input, __origem: { resultados: [...resultados], falas } } : p.input);
      const feitos = await rodarNaOrdem(
        rodam.map((p: any) => async () => {
          const t0 = Date.now();
          const feito = await portas.executar(p.name, entradaDe(p));
          return { feito, ms: Date.now() - t0 };
        }),
        juntas,
      );
      const respostas = pedidos.map((p: any, i: number) => {
        if (i >= feitos.length) {
          return { type: 'tool_result', tool_use_id: p.id, content: JSON.stringify({ erro: 'Limite de consultas desta pergunta atingido. Responda com o que já tem.' }), is_error: true };
        }
        const { feito, ms } = feitos[i];
        trilha.ferramentas.push({ nome: String(p.name).slice(0, 60), ms, ok: feito.ok, entrada: entradaParaATrilha(p.input) });
        portas.colher?.(feito);
        if (feito.ok) resultados.push(feito.dados);
        return { type: 'tool_result', tool_use_id: p.id, content: JSON.stringify(feito.dados), ...(feito.ok ? {} : { is_error: true }) };
      });
      messages.push({ role: 'user', content: respostas });
      // V7e: só a análise que trouxe dados troca o modelo. A que veio vazia, recusada ou com erro segue no modelo de sempre.
      if (portas.modeloDaAnalise && rodam.some((p: any, i: number) => FERRAMENTAS_DA_ANALISE.includes(p.name) && feitos[i].feito.ok && feitos[i].feito.dados?.semDados !== true)) modelo = portas.modeloDaAnalise;
    }
    return { texto: null, motivo: 'nao_fechou', trilha };
  } catch (e: any) {
    if (e instanceof FalhaDaIa) return { texto: null, motivo: e.motivo, trilha };
    throw e;
  }
}
