// TOTEM EM DINHEIRO ESPERANDO PAGAMENTO — as regras puras do ícone e do aviso do PDV (pedido do dono, 16/11/2026): "ao
// receber um pedido do totem que é pagamento em dinheiro, um alerta em todos os PDVs, um ícone que chame atenção com a
// notificação de pedido esperando ser pago; ao clicar, leva para Retirada / Encomendas"; e, quando a loja produz antes de
// cobrar, "o atendimento recebe a notificação do pedido do totem em dinheiro pronto e não pago".
// Sem import de propósito: o `check:balcao` transpila este arquivo sozinho e confere as regras.

export type PedidoTotemAPagar = {
  id: string;
  senha: string | null;
  clienteNome: string | null;
  total: number;
  minutos: number;
  /** novo | confirmado | pronto (servidor antigo: não vem — conta como esperando). */
  status?: string;
  pronto?: boolean;
  atrasado?: boolean;
};

export type DadosTotemAPagar = { pedidos: PedidoTotemAPagar[]; aposPagamento: boolean | null; minutos: number };

/** As telas do grupo PDV onde o ícone e o aviso aparecem. */
export const TELAS_DO_TOTEM = ['/pdv', '/mesas'];
export const naTelaDoTotem = (path: string) => TELAS_DO_TOTEM.some((t) => path === t || path.startsWith(t + '/'));

/** A resposta da rota como a tela usa. O servidor antigo só mandava pedidos com a loja em "após pagamento" (`ativo`). */
export function lerTotemAPagar(r: any): DadosTotemAPagar {
  const minutos = Number(r?.minutos) > 0 ? Number(r.minutos) : 8;
  const lista = r?.ativo && Array.isArray(r?.pedidos) ? r.pedidos : [];
  const pedidos: PedidoTotemAPagar[] = lista
    .filter((p: any) => p && typeof p.id === 'string')
    .map((p: any) => {
      const min = Math.max(0, Number(p.minutos) || 0);
      const pronto = p.pronto === true || p.status === 'pronto';
      return {
        id: p.id,
        senha: p.senha != null && String(p.senha).trim() ? String(p.senha) : null,
        clienteNome: p.clienteNome ?? null,
        total: Number(p.total) || 0,
        minutos: min,
        status: p.status ?? 'novo',
        pronto,
        atrasado: p.atrasado != null ? p.atrasado === true : min >= minutos,
      };
    });
  return { pedidos, aposPagamento: typeof r?.aposPagamento === 'boolean' ? r.aposPagamento : null, minutos };
}

export type ResumoTotemAPagar = { total: number; prontos: PedidoTotemAPagar[]; atrasados: PedidoTotemAPagar[] };

/** Quantos esperam, quais estão PRONTOS sem pagar (o urgente) e quais esperam além do limite (sem contar os prontos). */
export function resumoDoTotemAPagar(pedidos: PedidoTotemAPagar[]): ResumoTotemAPagar {
  const prontos = pedidos.filter((p) => p.pronto);
  const atrasados = pedidos.filter((p) => !p.pronto && p.atrasado);
  return { total: pedidos.length, prontos, atrasados };
}

/**
 * Toca o bipe? Quando entra pedido que esta tela ainda não tinha visto, ou quando um pedido fica PRONTO sem pagar.
 * Atualiza os conjuntos de vistos (quem chama guarda entre as leituras).
 */
export function precisaBipar(vistos: Set<string>, prontosVistos: Set<string>, pedidos: PedidoTotemAPagar[]): boolean {
  let bipa = false;
  for (const p of pedidos) {
    if (!vistos.has(p.id)) {
      vistos.add(p.id);
      bipa = true;
    }
    if (p.pronto && !prontosVistos.has(p.id)) {
      prontosVistos.add(p.id);
      bipa = true;
    }
  }
  return bipa;
}

export const senhaDoTotem = (p: PedidoTotemAPagar) => (p.senha ? `Senha ${p.senha}` : 'Sem senha');
const plural = (n: number, um: string, varios: string) => (n === 1 ? um : varios);

/** O nome do ícone para o leitor de tela (e a dica ao passar o mouse). */
export function rotuloDoIcone(r: ResumoTotemAPagar): string {
  const base = `Totem: ${r.total} ${plural(r.total, 'pedido esperando', 'pedidos esperando')} pagamento em dinheiro`;
  const prontos = r.prontos.length ? `, ${r.prontos.length} ${plural(r.prontos.length, 'pronto sem pagar', 'prontos sem pagar')}` : '';
  return `${base}${prontos}. Abrir Retirada / Encomendas`;
}

/** O texto da faixa: o pronto e não pago primeiro; senão, quem espera além do limite; nada = sem faixa. */
export function textoDaFaixa(r: ResumoTotemAPagar, minutos: number): { tom: 'urgente' | 'atencao'; texto: string } | null {
  if (r.prontos.length === 1)
    return { tom: 'urgente', texto: `${senhaDoTotem(r.prontos[0])} do totem está PRONTA e NÃO PAGA (dinheiro): cobre antes de entregar` };
  if (r.prontos.length > 1)
    return { tom: 'urgente', texto: `${r.prontos.length} pedidos do totem estão PRONTOS e NÃO PAGOS (dinheiro): cobre antes de entregar` };
  if (r.atrasados.length)
    return {
      tom: 'atencao',
      texto: `${r.atrasados.length === 1 ? '1 pedido do totem espera' : `${r.atrasados.length} pedidos do totem esperam`} pagamento em dinheiro há mais de ${minutos} min`,
    };
  return null;
}
