import { Injectable, Logger, Optional } from '@nestjs/common';
import { GraphFotoService } from '../graph/graph-foto.service';
import { CardapioService } from './cardapio.service';
import { PRAZO_DA_VOZ_DO_ATENDENTE_MS, chaveDaFalaDoAtendente, estiloDaVozDoAtendente, textoDaFala, tomDoCliente } from './voz-do-atendente';

/* eslint-disable @typescript-eslint/no-explicit-any */

/** O que a rota devolve: o áudio (OGG/Opus em base64, no campo do Google — o fluxo não muda o nó seguinte) ou o motivo. */
export type FalaDoAtendente = { audioContent: string } | { motivo: string };

/**
 * A VOZ DO ATENDENTE PELO DMS GRAPH (fase A — `voz-do-atendente.ts`). A loja pela chave do fluxo (a mesma das consultas do
 * robô), a ligação com o Graph da EMPRESA (a mesma régua da foto: `GRAPH_LIGADO`, o piloto, a empresa viva e a ligação
 * não revogada) e a fala na voz FEMININA, com o estilo escolhido pelo código e as pausas. Nunca lança por falha da voz:
 * devolve o motivo, e o fluxo segue pela reserva (a voz de antes) e, depois, pelo texto — o cliente nunca fica sem resposta.
 *
 * DESEMPENHO NO PICO (o dono, 27/11: "o atendente vai administrar várias conversas simultâneas"): nada aqui serializa as
 * conversas — sem trava, sem fila e sem estado entre pedidos; o prazo é TOTAL (20 s, V106); a mesma fala repetida não gasta
 * de novo (a chave de idempotência); e no Graph a fala tem vagas próprias (contrato 1.8.0), fora das da leitura de foto.
 */
@Injectable()
export class VozDoAtendenteService {
  private readonly logger = new Logger('VozDoAtendente');
  /** O prazo total (o teste encurta). */
  prazoMs = PRAZO_DA_VOZ_DO_ATENDENTE_MS;

  constructor(
    private readonly cardapio: CardapioService,
    // Opcional: sem o módulo do Graph (testes, servidor da loja), a voz responde "sem-graph" e o fluxo usa a reserva.
    @Optional() private readonly graph?: GraphFotoService,
  ) {}

  async falar(token: string, entrada: { texto?: unknown; tom?: unknown; pergunta?: unknown }): Promise<FalaDoAtendente> {
    const texto = textoDaFala(entrada.texto);
    if (!texto) return { motivo: 'sem-texto' };
    if (!this.graph) return { motivo: 'sem-graph' };
    const cfg: any = await this.cardapio.resolver(token);
    const tenantId = String(cfg?.tenantId ?? '');
    if (!tenantId) return { motivo: 'sem-empresa' };
    const lig = await this.graph.ligacaoParaFoto(tenantId);
    if (!lig) return { motivo: 'sem-graph' };
    const estilo = estiloDaVozDoAtendente(tomDoCliente(entrada.tom), texto, String(entrada.pergunta ?? '').slice(0, 2000));
    let motivo = 'nao-falou';
    const ogg = await this.graph.falar(
      tenantId,
      lig,
      texto,
      chaveDaFalaDoAtendente(tenantId, texto, estilo),
      this.prazoMs,
      (m) => (motivo = m),
      estilo,
      { voz: 'feminina' },
    );
    if (!ogg) {
      // Só o motivo e a empresa no log: nada do texto nem do telefone (V11: a recusa da rota é 503 com o log local).
      this.logger.warn(`a voz do atendente não saiu pelo DMS Graph (empresa ${tenantId}): ${motivo} — o fluxo segue pela reserva`);
      return { motivo };
    }
    return { audioContent: ogg.toString('base64') };
  }
}
