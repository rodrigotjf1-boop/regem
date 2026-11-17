// UM DE CADA VEZ POR CHAVE, em memória, neste processo (avaliação de segurança de 16/11/2026, segunda rodada, B-02).
//
// Para a conferência que LÊ um contador, decide e só depois GRAVA a falha (o PIN: "10 erros em 5 minutos"): com pedidos
// em paralelo, todos leem o contador antes de qualquer falha ser gravada e passam juntos do teto. Em fila, cada um só
// lê depois que o anterior gravou.
//
// A fila é por chave (a loja, o aparelho): uma loja não espera a outra. Quem espera não segura conexão do banco. O
// tamanho é limitado: além dele, a chamada é recusada na hora (`FilaCheia`) — quem dispara dezenas em paralelo não
// empilha trabalho. É por processo: com N cópias do serviço, passam no máximo N ao mesmo tempo pela mesma chave, o que
// estoura o teto em N − 1 no pior caso (hoje a nuvem e o servidor da loja rodam uma cópia).

/** A fila desta chave está cheia: a chamada não entra (quem chama responde 429). */
export class FilaCheia extends Error {
  constructor() {
    super('fila cheia');
    this.name = 'FilaCheia';
  }
}

export class UmPorVez {
  private readonly filas = new Map<string, { cauda: Promise<unknown>; n: number }>();

  /** `maximo`: quantos cabem por chave, contando o que está rodando e os que esperam. */
  constructor(private readonly maximo: number) {}

  /** Roda `fn` depois de todos os que já estão na fila desta chave. Lança `FilaCheia` sem rodar quando não cabe. */
  async rodar<T>(chave: string, fn: () => Promise<T>): Promise<T> {
    const fila = this.filas.get(chave) ?? { cauda: Promise.resolve(), n: 0 };
    if (fila.n >= this.maximo) throw new FilaCheia();
    fila.n++;
    this.filas.set(chave, fila);
    // a cauda nunca rejeita (o erro de um não impede o próximo)
    const vez = fila.cauda.then(fn);
    fila.cauda = vez.catch(() => undefined);
    try {
      return await vez;
    } finally {
      if (--fila.n === 0) this.filas.delete(chave);
    }
  }

  /** Quantas chaves têm fila agora (para o teste: a fila vazia não fica na memória). */
  get chaves(): number {
    return this.filas.size;
  }
}
