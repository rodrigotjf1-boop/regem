'use strict';

// O DIÁRIO DOS ENVIOS (v0.4) — `envios.jsonl` na pasta de dados do programa. Para cada aviso da fila da nuvem (o id que a
// NUVEM deu à mensagem — não é dado de cliente), anota quando o programa APERTOU "Enviar", o id do ECO (a mensagem no chat
// do iFood) e o FIM (a nuvem já sabe). Nenhum texto. Serve para o caso "apertou e caiu antes de avisar a nuvem": a nuvem
// devolve o aviso para a fila e o programa, reaberto, não digita de novo sem conferir. Arquivo com teto (reescreve só as
// últimas entradas quando passa do dobro).

const fs = require('fs');

class Jornal {
  constructor(arquivo, { max = 500 } = {}) {
    this.arquivo = arquivo;
    this.max = max;
    this.linhas = 0;
    this.envios = new Map(); // id → { apertouEm, ecoId, fimEm }
    this.carregar();
  }

  carregar() {
    let txt = '';
    try {
      txt = fs.readFileSync(this.arquivo, 'utf8');
    } catch {
      return;
    }
    for (const l of txt.split(/\r?\n/)) {
      if (!l.trim()) continue;
      let x;
      try {
        x = JSON.parse(l);
      } catch {
        continue; // linha cortada (o PC desligou no meio): segue
      }
      this.linhas += 1;
      this.aplicar(x);
    }
  }

  aplicar(x) {
    if (!x || typeof x.id !== 'string') return;
    const e = this.envios.get(x.id) || {};
    if (x.ev === 'apertou') e.apertouEm = x.t;
    if (x.ev === 'eco' && typeof x.eco === 'string') e.ecoId = x.eco;
    if (x.ev === 'fim') e.fimEm = x.t;
    this.envios.delete(x.id); // o mais recente vai para o fim (a ordem do Map é a da entrada)
    this.envios.set(x.id, e);
    while (this.envios.size > this.max) this.envios.delete(this.envios.keys().next().value);
  }

  anotar(x) {
    const linha = { t: Date.now(), ...x };
    this.aplicar(linha);
    try {
      fs.appendFileSync(this.arquivo, `${JSON.stringify(linha)}\n`);
      this.linhas += 1;
      if (this.linhas > this.max * 2) this.compactar();
    } catch {
      /* disco cheio: o diário em memória ainda vale nesta sessão */
    }
  }

  compactar() {
    const tmp = `${this.arquivo}.tmp`;
    const linhas = [];
    for (const [id, e] of this.envios) {
      if (e.apertouEm) linhas.push(JSON.stringify({ t: e.apertouEm, ev: 'apertou', id }));
      if (e.ecoId) linhas.push(JSON.stringify({ t: e.apertouEm || e.fimEm || 0, ev: 'eco', id, eco: e.ecoId }));
      if (e.fimEm) linhas.push(JSON.stringify({ t: e.fimEm, ev: 'fim', id }));
    }
    fs.writeFileSync(tmp, linhas.length ? `${linhas.join('\n')}\n` : '');
    fs.renameSync(tmp, this.arquivo);
    this.linhas = linhas.length;
  }

  /** O que se sabe do envio deste aviso — ou undefined. */
  de(id) {
    return this.envios.get(String(id));
  }

  apertou(id) {
    this.anotar({ ev: 'apertou', id: String(id) });
  }

  eco(id, ecoId) {
    this.anotar({ ev: 'eco', id: String(id), eco: String(ecoId) });
  }

  fim(id) {
    this.anotar({ ev: 'fim', id: String(id) });
  }
}

module.exports = { Jornal };
