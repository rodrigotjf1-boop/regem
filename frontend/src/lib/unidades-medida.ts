import { api } from '@/lib/api';
import type { ListaDeUnidades } from '@/lib/unidade-da-lista';

export { unidadeDaLista, type ListaDeUnidades } from '@/lib/unidade-da-lista';

// Unidades de medida: LISTA FECHADA que vem do servidor (`GET /estoque/unidades-medida`) — a tela não
// guarda cópia. Junto vêm as outras formas de escrever cada uma ("un", "porções", "L"), para um valor
// gravado antes da lista abrir já como a unidade certa (`lib/unidade-da-lista.ts`).
let pedido: Promise<ListaDeUnidades> | null = null;

/** Busca a lista uma vez por sessão da página (falhou → a próxima chamada tenta de novo). */
export function carregarUnidadesDeMedida(): Promise<ListaDeUnidades> {
  if (!pedido)
    pedido = api
      .estoqueUnidades()
      .then((r) => ({ unidades: r?.unidades ?? [], apelidos: r?.apelidos ?? {} }))
      .catch((e) => {
        pedido = null;
        throw e;
      });
  return pedido;
}
