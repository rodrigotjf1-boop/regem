import { impressaoJob } from '../db/schema';
import { edgeAtivo } from './edge-ativo';
import { enfileirarComandoEdge } from './edge-comando';

/* eslint-disable @typescript-eslint/no-explicit-any */

export type JobImpressao = {
  tenantId: string;
  unidadeId: string | null;
  equipamentoId: string;
  via: string;
  conteudo: string;
  comandaId?: string | null;
  pedidoId?: string | null;
};

// Grava um job de impressão ONDE ELE VAI SER IMPRESSO.
//
// A fila `impressao_job` é por banco e não sincroniza: a do servidor local é lida pelo worker
// da loja; a da nuvem, pelo agente dos caixas (lojas sem servidor local). Quem cria o job na
// NUVEM para uma loja com servidor local ATIVO gravava na fila da nuvem — que ninguém lê ali.
// Reproduzido: etiqueta de validade gerada pelo app da nuvem ficou 'pendente' para sempre (o
// mesmo valia para a ordem de produção e para a impressão por etapa do KDS feita na nuvem).
//
// Agora: no próprio servidor local → grava na fila local; na nuvem, com o servidor da loja
// ativo → manda por COMANDO para ele (mig 269: destino + dados), que grava na fila dele para a
// MESMA impressora (os ids de `equipamento` são os mesmos nos dois bancos); senão → fila da
// nuvem (agente dos caixas). Devolve onde foi parar.
export async function gravarOuEncaminharImpressao(db: any, job: JobImpressao): Promise<'local' | 'servidor_local'> {
  const noEdge = String(process.env.EDGE_MODE ?? '').toLowerCase() === 'true';
  if (!noEdge && (await edgeAtivo(db, job.tenantId, job.unidadeId))) {
    await enfileirarComandoEdge(db, job.tenantId, 'imprimir', {
      unidadeId: job.unidadeId,
      solicitadoPor: 'nuvem',
      dados: {
        equipamentoId: job.equipamentoId,
        via: job.via,
        conteudo: job.conteudo,
        comandaId: job.comandaId ?? null,
        pedidoId: job.pedidoId ?? null,
      },
    });
    return 'servidor_local';
  }
  await db.insert(impressaoJob).values({
    tenantId: job.tenantId,
    unidadeId: job.unidadeId ?? null,
    equipamentoId: job.equipamentoId,
    pedidoId: job.pedidoId ?? null,
    comandaId: job.comandaId ?? null,
    via: job.via,
    conteudo: job.conteudo,
  });
  return 'local';
}
