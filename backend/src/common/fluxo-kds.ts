import { BadRequestException } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { equipamento } from '../db/schema';

/* eslint-disable @typescript-eslint/no-explicit-any */

// COZINHA EM ESTAÇÕES, entrega 2 (decisão do dono, 21/10/2026) — as regras do "lugar no fluxo" de um KDS, as MESMAS na
// gaveta "Configurar este KDS" (producao-pedido) e no cadastro do equipamento (Configurações › Equipamentos):
//  · "Quando ficar pronto, vai para" = `proximo_kds_id` (vazio = termina aqui);
//  · o KDS de despacho (`escopo = 'despacho'`) vê o pedido inteiro e é a última etapa — não manda para outro KDS.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Uma passagem do cartão por uma estação (`producao_pedido.estacoes`, mig 334). */
export type PassagemKds = { kds: string; pronto: string; forcado?: boolean };

/** As passagens gravadas no cartão (coluna nula, de antes da mig 334 ou torta → nenhuma). */
export function lerEstacoes(valor: unknown): PassagemKds[] {
  return Array.isArray(valor) ? valor.filter((x: any) => x && typeof x.kds === 'string' && typeof x.pronto === 'string') : [];
}

/**
 * Os KDS cujo caminho ("vai para", um atrás do outro) chega a `alvoId` — ele incluso. Para o despacho saber quais
 * cartões vêm para ele. Um círculo antigo no cadastro não trava: cada KDS é visitado uma vez.
 */
export function kdsQueChegamA(alvoId: string, proximoDe: Map<string, string | null>): Set<string> {
  const chegam = new Set<string>();
  for (const inicio of proximoDe.keys()) {
    const vistos = new Set<string>();
    let atual: string | null = inicio;
    while (atual && !vistos.has(atual)) {
      if (atual === alvoId) {
        chegam.add(inicio);
        break;
      }
      vistos.add(atual);
      atual = proximoDe.get(atual) ?? null;
    }
  }
  chegam.add(alvoId);
  return chegam;
}

/**
 * Confere o "vai para" de um KDS antes de gravar: é um KDS ligado desta empresa, da mesma loja (ou da rede), não é ele
 * mesmo e não fecha um círculo (Chapa → Montagem → Chapa deixaria o pedido rodando). Recusa com o motivo (400).
 */
export async function conferirProximoKds(
  db: any,
  tenantId: string,
  kds: { id: string; unidadeId: string | null },
  proximoId: string,
): Promise<void> {
  if (typeof proximoId !== 'string' || !UUID_RE.test(proximoId)) throw new BadRequestException('Escolha um KDS da lista.');
  if (proximoId === kds.id) throw new BadRequestException('Um KDS não pode mandar o pedido para ele mesmo.');
  const telas: any[] = await db
    .select({
      id: equipamento.id,
      nome: equipamento.nome,
      ativo: equipamento.ativo,
      unidadeId: equipamento.unidadeId,
      proximoKdsId: equipamento.proximoKdsId,
      revogadoEm: equipamento.revogadoEm,
    })
    .from(equipamento)
    .where(and(eq(equipamento.tenantId, tenantId), eq(equipamento.tipo, 'kds')));
  const alvo = telas.find((t) => t.id === proximoId);
  if (!alvo || !alvo.ativo || alvo.revogadoEm) throw new BadRequestException('O KDS escolhido não existe ou está desligado.');
  if (kds.unidadeId && alvo.unidadeId && alvo.unidadeId !== kds.unidadeId)
    throw new BadRequestException('O KDS escolhido é de outra loja.');
  const proximoDe = new Map<string, string | null>(telas.map((t) => [t.id, t.proximoKdsId ?? null]));
  proximoDe.set(kds.id, proximoId);
  const nome = new Map<string, string>(telas.map((t) => [t.id, t.nome]));
  const caminho = [kds.id];
  const vistos = new Set<string>([kds.id]);
  let atual: string | null = proximoId;
  while (atual && !vistos.has(atual)) {
    caminho.push(atual);
    vistos.add(atual);
    atual = proximoDe.get(atual) ?? null;
  }
  if (atual === kds.id) {
    const nomes = [...caminho, kds.id].map((id) => nome.get(id) ?? 'KDS');
    throw new BadRequestException(`Assim o pedido ficaria rodando em círculo: ${nomes.join(' → ')}.`);
  }
}
