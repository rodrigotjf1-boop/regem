'use strict';

// O QUE A PONTE GUARDA NESTE PC (`ponte.json`, na pasta de dados do programa): o pareamento — o id do aparelho e o
// SEGREDO, cifrado pelo Windows para este usuário (safeStorage = DPAPI; nunca em texto claro) —, o nome que o gestor deu ao
// PC e o sal do diagnóstico. A sessão do iFood fica na sessão do navegador do programa, nunca aqui.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

class Configuracao {
  /** @param {string} pasta a pasta de dados do programa  @param {{ isEncryptionAvailable: () => boolean, encryptString: (s: string) => Buffer, decryptString: (b: Buffer) => string }} cofre */
  constructor(pasta, cofre) {
    this.arquivo = path.join(pasta, 'ponte.json');
    this.cofre = cofre;
  }

  ler() {
    try {
      const j = JSON.parse(fs.readFileSync(this.arquivo, 'utf8'));
      return j && typeof j === 'object' ? j : {};
    } catch {
      return {};
    }
  }

  gravar(cfg) {
    fs.mkdirSync(path.dirname(this.arquivo), { recursive: true });
    const tmp = `${this.arquivo}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(cfg, null, 2));
    fs.renameSync(tmp, this.arquivo); // troca de uma vez: nunca fica meio arquivo
  }

  /** O sal do diagnóstico (nasce na primeira vez e fica). */
  sal() {
    const cfg = this.ler();
    if (typeof cfg.sal === 'string' && cfg.sal.length >= 16) return cfg.sal;
    cfg.sal = crypto.randomBytes(16).toString('hex');
    this.gravar(cfg);
    return cfg.sal;
  }

  /** { terminalId, segredo } — ou null (não pareado, ou o Windows não decifra mais, ex.: outro usuário). */
  credencial() {
    const cfg = this.ler();
    if (!cfg.terminalId || !cfg.segredoCifrado) return null;
    try {
      return { terminalId: cfg.terminalId, segredo: this.cofre.decryptString(Buffer.from(cfg.segredoCifrado, 'base64')) };
    } catch {
      return null;
    }
  }

  /** Guarda o que o pareamento devolveu. Sem a cifra do Windows, não guarda (segredo em texto claro, nunca). */
  guardarPareamento(r) {
    if (!this.cofre.isEncryptionAvailable()) throw new Error('O Windows não ofereceu a proteção para guardar o segredo da ponte neste PC.');
    const cfg = this.ler();
    cfg.terminalId = String(r.terminalId);
    cfg.segredoCifrado = this.cofre.encryptString(String(r.segredo)).toString('base64');
    cfg.nome = r.nome ? String(r.nome) : null;
    cfg.unidadeId = r.unidadeId ? String(r.unidadeId) : null;
    cfg.pareadoEm = new Date().toISOString();
    this.gravar(cfg);
  }

  /** A ponte foi revogada no Regem: o PC esquece o pareamento (só nesse caso — V70). */
  esquecerPareamento() {
    const cfg = this.ler();
    delete cfg.terminalId;
    delete cfg.segredoCifrado;
    delete cfg.nome;
    delete cfg.unidadeId;
    delete cfg.pareadoEm;
    this.gravar(cfg);
  }

  nome() {
    return this.ler().nome || null;
  }

  /** Desde quando a ponte está PAUSADA neste PC (ISO) — ou null. Fica guardado: segue pausada depois de reiniciar. */
  pausadaEm() {
    const v = this.ler().pausadaEm;
    return typeof v === 'string' && !Number.isNaN(Date.parse(v)) ? v : null;
  }

  /** Pausa (guarda a hora, só se ainda não estava) ou retoma. Devolve a hora da pausa (ou null). */
  pausar(sim, agora = new Date()) {
    const cfg = this.ler();
    if (sim) {
      if (!(typeof cfg.pausadaEm === 'string' && !Number.isNaN(Date.parse(cfg.pausadaEm)))) cfg.pausadaEm = agora.toISOString();
    } else delete cfg.pausadaEm;
    this.gravar(cfg);
    return cfg.pausadaEm || null;
  }
}

module.exports = { Configuracao };
