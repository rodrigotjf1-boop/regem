import { FalhaDaIa, PedidoDeIa, RespostaDaIa } from '../ia/ia-empresa.service';
import { PRECOS_POR_MILHAO } from '../ia/ia.regras';
import { FERRAMENTAS, INSTRUCOES_DO_MISTER, MODELO_DAS_PERGUNTAS, MotivoSemResposta, RECURSO_DAS_PERGUNTAS, TETOS, TrocaDaMemoria, entradaParaATrilha, perguntaDaMemoria } from './mister-agente.regras';

/** O modelo das perguntas: o da distribuição (`MISTER_MODELO_PERGUNTAS`), se estiver na tabela de preços; senão o padrão. */
export function modeloDasPerguntas(): string {
  const pedido = String(process.env.MISTER_MODELO_PERGUNTAS ?? '').trim();
  return pedido && PRECOS_POR_MILHAO[pedido] ? pedido : MODELO_DAS_PERGUNTAS;
}
import type { ResultadoDaFerramenta } from './mister-ferramentas.service';
import type { Trilha } from './mister-fila.service';

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

export interface PortasDoLaco {
  /** O modelo desta pergunta. */
  modelo: string;
  /** O recurso no medidor (o relatório passa o dele). */
  recurso?: string;
  /** O bloco "Esta conversa", já montado (`blocoDaConversa`). */
  conversa: string;
  /** M2b (mig 435): o texto das instruções no ar (o do código com as trocas publicadas) ou o da candidata; sem ele, o do código. */
  instrucoes?: string;
  pedir(p: PedidoDeIa): Promise<RespostaDaIa>;
  executar(nome: unknown, entrada: unknown): Promise<ResultadoDaFerramenta>;
}

export type FimDaPergunta = { texto: string; motivo: null; trilha: Trilha; resultados: unknown[] } | { texto: null; motivo: MotivoSemResposta; trilha: Trilha };

/**
 * Uma pergunta ao modelo, com as ferramentas. Devolve o texto do modelo (ainda sem o filtro de saída) e o que as
 * ferramentas trouxeram — ou o motivo de não haver resposta. Não lança por falha da IA.
 */
export async function responderComFerramentas(portas: PortasDoLaco, memoria: TrocaDaMemoria[], pergunta: string): Promise<FimDaPergunta> {
  const modelo = portas.modelo;
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
      const r = await portas.pedir({
        // O relatório (mig 420) passa o recurso dele: cada um soma no seu no "Uso da IA".
        recurso: portas.recurso ?? RECURSO_DAS_PERGUNTAS,
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
        const feito = await portas.executar(p.name, p.input);
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
