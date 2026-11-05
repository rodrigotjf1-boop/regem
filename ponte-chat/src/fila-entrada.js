'use strict';

// A FILA DE ENTRADA: o que a ponte leu no chat vai para a nuvem em lotes (até 50 — o limite da rota `ponte-chat/mensagens`).
// Com a ponte DESLIGADA nos ajustes do Regem, nada vai e nada fica guardado aqui (é conversa de cliente: sem a ponte
// ligada, o chat fica só no Gestor). Falhou o envio (sem internet, nuvem fora): o lote fica e vai na próxima volta — a
// nuvem não grava a mesma mensagem duas vezes (canal + id da mensagem), então repetir é seguro.

const LOTE = 50;
const MAXIMO_NA_FILA = 1000; // muito tempo sem nuvem: as mais velhas saem (não enche a memória do PC)

class FilaDeEntrada {
  /** @param {(lote: object[]) => Promise<{ ok: boolean }>} enviar */
  constructor(enviar, { lote = LOTE, maximo = MAXIMO_NA_FILA } = {}) {
    this.enviar = enviar;
    this.lote = lote;
    this.maximo = maximo;
    this.itens = [];
    this.descartadas = 0;
    this.enviando = false;
  }

  /** Põe na fila — só com a ponte ligada (desligada, a mensagem nem entra). */
  por(msg, ligada) {
    if (!ligada) return false;
    this.itens.push(msg);
    if (this.itens.length > this.maximo) {
      const sobra = this.itens.length - this.maximo;
      this.itens.splice(0, sobra);
      this.descartadas += sobra;
    }
    return true;
  }

  /** A ponte foi desligada: a fila é esvaziada sem enviar. */
  esvaziar() {
    this.itens.length = 0;
  }

  /**
   * Manda o que estiver na fila, um lote por vez, até esvaziar ou falhar. Devolve quantas foram. Uma descarga por vez
   * (quem chama durante uma descarga não faz nada).
   */
  async descarregar(ligada) {
    if (!ligada) {
      this.esvaziar();
      return 0;
    }
    if (this.enviando) return 0;
    this.enviando = true;
    let foram = 0;
    try {
      while (this.itens.length) {
        const lote = this.itens.slice(0, this.lote);
        let r;
        try {
          r = await this.enviar(lote);
        } catch {
          r = { ok: false };
        }
        if (!r || !r.ok) break; // fica para a próxima volta
        this.itens.splice(0, lote.length);
        foram += lote.length;
      }
    } finally {
      this.enviando = false;
    }
    return foram;
  }
}

module.exports = { FilaDeEntrada, LOTE };
