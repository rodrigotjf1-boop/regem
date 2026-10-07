import { BadRequestException } from '@nestjs/common';

// Período de uma listagem que vem na consulta: `?inicio=2026-09-07&fim=2026-10-07`.
//
// Por que existe: as listas de histórico do estoque (desperdício, vistoria, recebimento, compra)
// devolviam TUDO, desde sempre — só cresciam. A tela passa a pedir uma janela (padrão: 30 dias) e
// o corte é feito no banco. Quem não manda nada continua recebendo tudo, como antes.

const ISO = /^\d{4}-\d{2}-\d{2}$/;

export type Periodo = { inicio: string | null; fim: string | null };

function lerData(valor: unknown, campo: string): string | null {
  if (valor === undefined || valor === null || valor === '') return null;
  // A data tem de existir de verdade: "2026-02-31" casa com o formato e não é dia nenhum.
  const ok =
    typeof valor === 'string' &&
    ISO.test(valor) &&
    new Date(`${valor}T00:00:00Z`).toISOString().slice(0, 10) === valor;
  if (!ok) throw new BadRequestException(`${campo}: use uma data no formato AAAA-MM-DD.`);
  return valor as string;
}

/** Valida e devolve o período. Ausente = sem aquele limite. Formato errado ou invertido = 400. */
export function periodoDaConsulta(inicio?: unknown, fim?: unknown): Periodo {
  let i: string | null;
  let f: string | null;
  try {
    i = lerData(inicio, 'inicio');
    f = lerData(fim, 'fim');
  } catch (e) {
    // `toISOString()` lança em data impossível ("2026-13-01"): é o mesmo erro de formato.
    if (e instanceof BadRequestException) throw e;
    throw new BadRequestException('Período: use datas no formato AAAA-MM-DD.');
  }
  if (i && f && i > f) throw new BadRequestException('O início do período é depois do fim.');
  return { inicio: i, fim: f };
}
