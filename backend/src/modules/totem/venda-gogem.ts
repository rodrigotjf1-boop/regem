// R3b — TRADUTOR da venda: corpo que o totem GoGeM envia → corpo que o Regem espera.
//
// A diferença perigosa é o DINHEIRO: o totem manda CENTAVOS inteiros e o Regem espera
// REAIS decimais. É a mesma conversão que a nuvem do GoGeM faz hoje
// (`centavosParaReais` = Math.round(centavos)/100); aqui ela é explícita e testada,
// porque um fator de 100 errado passaria silencioso e cobraria 100x a mais ou a menos.
import { paraReais } from '../../util/dinheiro';

export type VendaTotemGogem = {
  idempotencyKey?: string;
  itens?: { codigoPdv?: string; quantidade?: number; observacao?: string }[];
  pagamentos?: {
    forma?: string;
    valor?: number; // CENTAVOS
    nsu?: string;
    autorizacao?: string;
    formaPagamentoId?: string;
  }[];
  cpf?: string;
  cliente?: string;
  consumo?: string;
  taxaServicoPct?: number;
  senhaLocal?: number | string;
};

/** Plataforma gravada na comanda — é o que aparece no cupom e no relatório. */
export const PLATAFORMA_TOTEM = 'GoGeM Totem';

/**
 * Pagamento 100% em dinheiro? Mesma regra da nuvem do GoGeM: TODAS as formas precisam
 * ser 'dinheiro'. Split (parte dinheiro, parte cartão) NÃO é dinheiro — o cartão já foi
 * capturado, então a venda é paga e segue pelo caminho normal.
 */
export function ehDinheiro(dto: VendaTotemGogem): boolean {
  const pags = dto.pagamentos ?? [];
  return (
    pags.length > 0 &&
    pags.every((p) => (p.forma ?? '').toString().trim().toLowerCase() === 'dinheiro')
  );
}

/** Soma dos pagamentos, em centavos (o total que o totem cobrou). */
export function totalCentavos(dto: VendaTotemGogem): number {
  return (dto.pagamentos ?? []).reduce(
    (s, p) => s + Math.round(Number(p.valor) || 0),
    0,
  );
}

/** Converte para número quando dá; senão `null` (nunca `NaN` no corpo da resposta). */
function numeroOuNulo(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Senha do totem como string — o DTO do Regem valida `@IsString` (nunca número). */
function senhaComoTexto(v: unknown): string | undefined {
  if (v == null || v === '') return undefined;
  const s = String(v).trim();
  return s || undefined;
}

/**
 * Pagamentos do totem (CENTAVOS) → pagamentos do Regem (REAIS). Usado tanto na venda
 * direta quanto na liberação de um pedido retido — a conversão é a mesma e mora num
 * lugar só, porque errar o fator de 100 aqui cobra cem vezes mais ou cem vezes menos.
 */
export function pagamentosParaReais(
  pags: VendaTotemGogem['pagamentos'],
): { forma: string; valor: number; nsu?: string; autorizacao?: string }[] {
  return (pags ?? []).map((p) => ({
    forma: (p.forma ?? '').toString(),
    valor: paraReais(Number(p.valor) || 0),
    ...(p.nsu ? { nsu: p.nsu } : {}),
    ...(p.autorizacao ? { autorizacao: p.autorizacao } : {}),
  }));
}

/** Venda PAGA (cartão/PIX) → corpo do `venderTotem` (`/vendas/externa-pdv`). */
export function paraVendaExternaPdv(dto: VendaTotemGogem) {
  return {
    idempotencyKey: (dto.idempotencyKey ?? '').toString(),
    itens: (dto.itens ?? []).map((i) => ({
      codigoPdv: (i.codigoPdv ?? '').toString().trim(),
      quantidade: Number(i.quantidade) || 1,
      ...(i.observacao ? { observacao: i.observacao } : {}),
    })),
    pagamentos: (dto.pagamentos ?? []).map((p) => ({
      forma: (p.forma ?? '').toString(),
      valor: paraReais(Number(p.valor) || 0), // CENTAVOS → REAIS
      ...(p.nsu ? { nsu: p.nsu } : {}),
      ...(p.autorizacao ? { autorizacao: p.autorizacao } : {}),
      ...(p.formaPagamentoId ? { formaPagamentoId: p.formaPagamentoId } : {}),
    })),
    ...(documentoParaNota(dto.cpf) ? { cpf: documentoParaNota(dto.cpf) } : {}),
    ...(dto.cliente ? { cliente: dto.cliente } : {}),
    ...(dto.consumo ? { consumo: dto.consumo } : {}),
    ...(dto.taxaServicoPct != null
      ? { taxaServicoPct: Number(dto.taxaServicoPct) }
      : {}),
    plataforma: PLATAFORMA_TOTEM,
    ...(senhaComoTexto(dto.senhaLocal)
      ? { senhaPlataforma: senhaComoTexto(dto.senhaLocal) }
      : {}),
  };
}

/**
 * CPF/CNPJ para a nota: só dígitos, e só com 11 ou 14 — o resto é descartado aqui mesmo.
 * Quem valida o dígito verificador antes de pôr no XML é o fiscal do Regem
 * (`documentoUtilizavel`); este filtro só impede lixo de chegar ao pedido.
 */
export function documentoParaNota(v: unknown): string | undefined {
  const d = String(v ?? '').replace(/\D/g, '');
  return d.length === 11 || d.length === 14 ? d : undefined;
}

/**
 * Pedido que nasce ANTES do pagamento (dinheiro, ou retido de cartão/PIX) → corpo do
 * `criarPedidoTotemDinheiro` / `criarPedidoTotemRetido`.
 *
 * O `cpf` vai junto: é ele que a NFC-e usa. Antes ficava de fora — o cliente digitava o CPF
 * no totem e a nota saía sem ele; acima do limite de identificação da UF (R$ 2.000 no RJ),
 * a emissão era recusada.
 */
export function paraPedidoDinheiro(dto: VendaTotemGogem) {
  const cpf = documentoParaNota(dto.cpf);
  return {
    idempotencyKey: (dto.idempotencyKey ?? '').toString(),
    itens: (dto.itens ?? []).map((i) => ({
      codigoPdv: (i.codigoPdv ?? '').toString().trim(),
      quantidade: Number(i.quantidade) || 1,
    })),
    ...(dto.cliente ? { cliente: dto.cliente } : {}),
    ...(cpf ? { cpf } : {}),
    ...(senhaComoTexto(dto.senhaLocal)
      ? { senhaPlataforma: senhaComoTexto(dto.senhaLocal) }
      : {}),
    totalCentavos: totalCentavos(dto),
  };
}

/**
 * Resposta ao totem no formato do contrato GoGeM (`{comandaId, senha, total}`).
 * Nada de campo interno do Regem: `producaoPayloads` é fila de produção e não pode
 * vazar para um aparelho de sala.
 */
export function respostaParaTotem(r: any) {
  if (!r) return { comandaId: null, senha: null, total: null };
  // `total` e `senha` SEMPRE numéricos: o caminho do dinheiro devolve a coluna `numeric`
  // do Postgres como string ("20.00") e o do cartão devolve number — o app receberia
  // tipos diferentes para o mesmo campo conforme a forma de pagamento.
  return {
    comandaId: r.comandaId ?? null,
    senha: numeroOuNulo(r.senha ?? r.numero),
    total: numeroOuNulo(r.total),
    ...(r.idempotente ? { idempotente: true } : {}),
    ...(r.nfce !== undefined ? { nfce: r.nfce } : {}),
  };
}
