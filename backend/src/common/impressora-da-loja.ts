import { BadRequestException } from '@nestjs/common';
import { sql } from 'drizzle-orm';

/* eslint-disable @typescript-eslint/no-explicit-any */

// Escolha MANUAL de impressora (terminal do PDV, "Imprimir em…", ordem de produção) tem de ser
// uma impressora DA LOJA (ou sem loja). As impressoras de todas as lojas aparecem no mesmo
// cadastro; escolher a da outra loja fazia o servidor local encerrar cada job com "impressora
// de outra loja" — e no modo nuvem o agente mandava para um IP que, na rede desta loja, é outro
// aparelho. Recusar na hora de salvar é o único ponto em que alguém ainda pode corrigir.
// Sem loja no contexto (empresa de uma loja / usuário da rede) → não restringe.
export async function garantirImpressoraDaLoja(
  db: any,
  tenantId: string,
  impressoraId: string | null | undefined,
  unidadeId: string | null | undefined,
) {
  if (!impressoraId || !unidadeId) return;
  const r: any = await db.execute(sql`
    select unidade_id from equipamento
     where id = ${impressoraId} and tenant_id = ${tenantId} and tipo = 'impressora'`);
  const row = (r.rows ?? r)[0];
  if (!row) throw new BadRequestException('Impressora não encontrada.');
  if (row.unidade_id && row.unidade_id !== unidadeId)
    throw new BadRequestException('Esta impressora é de outra loja — escolha uma impressora desta loja.');
}
