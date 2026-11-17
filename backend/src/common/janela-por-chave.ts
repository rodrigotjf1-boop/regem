// TETO POR IDENTIDADE numa janela de tempo, em memória (avaliação de segurança de 16/11/2026, segunda rodada, B-02).
//
// O limite por IP (`@Throttle`) não vê o ALVO: de vários IPs, alguém pede código atrás de código para o mesmo telefone
// ou e-mail — cada código novo zera as tentativas e custa uma mensagem a quem não pediu. Este teto conta por chave
// (o telefone, o e-mail), não por quem chama.
//
// É proteção de abuso, não a regra de segurança: a tentativa do código é reservada no banco, na mesma instrução que
// confere o teto dela. Por isso pode ficar em memória por processo (some no deploy; com N cópias, vale N vezes).

export class JanelaPorChave {
  private readonly contagem = new Map<string, { inicio: number; n: number }>();

  constructor(
    private readonly limite: number,
    private readonly janelaMs: number,
    private readonly maximoDeChaves = 50_000,
  ) {}

  /** Conta mais um para a chave. `false` = passou do teto nesta janela (e não conta). */
  contar(chave: string, agora = Date.now()): boolean {
    const c = this.contagem.get(chave);
    if (!c || agora - c.inicio >= this.janelaMs) {
      if (this.contagem.size >= this.maximoDeChaves) this.limpar(agora);
      this.contagem.set(chave, { inicio: agora, n: 1 });
      return true;
    }
    if (c.n >= this.limite) return false;
    c.n++;
    return true;
  }

  private limpar(agora: number) {
    for (const [chave, c] of this.contagem) if (agora - c.inicio >= this.janelaMs) this.contagem.delete(chave);
    // tudo ainda dentro da janela e o mapa cheio: esvazia (o teto por IP segue valendo) em vez de crescer sem fim
    if (this.contagem.size >= this.maximoDeChaves) this.contagem.clear();
  }
}
