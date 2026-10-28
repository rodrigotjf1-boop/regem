import { BadRequestException } from '@nestjs/common';

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Um item da venda na perda do cancelamento: qual (`comanda_item`) e quanto (sem `quantidade`, o item inteiro). */
export type ItemDaPerda = { comandaItemId: string; quantidade?: number | null };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A lista da perda como a tela manda (`perdaItens`/`itens`). Ausente = null (a tela antiga, que não manda a lista).
 * Formato errado = 400 — a conferência contra a venda (o item é dela? a quantidade cabe?) é do `VendasService`.
 */
export function lerItensDaPerda(v: unknown): ItemDaPerda[] | null {
  if (v == null) return null;
  if (!Array.isArray(v)) throw new BadRequestException('A lista dos itens perdidos veio num formato inválido.');
  if (v.length > 200) throw new BadRequestException('A lista dos itens perdidos é grande demais.');
  return v.map((x: any) => {
    const comandaItemId = String(x?.comandaItemId ?? '');
    if (!UUID.test(comandaItemId)) throw new BadRequestException('Um item da lista da perda veio sem identificação.');
    const q = x?.quantidade;
    if (q != null && !(Number.isFinite(Number(q)) && Number(q) > 0))
      throw new BadRequestException('A quantidade perdida de um item veio inválida.');
    return { comandaItemId, quantidade: q == null ? null : Number(q) };
  });
}
