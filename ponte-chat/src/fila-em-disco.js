'use strict';

// A FILA DE ENTRADA EM DISCO (0.8.0; análise de rede de 25–26/11/2026). A fila do que a ponte leu no chat e ainda não
// chegou à nuvem ficava só na memória: um reinício do PC (ou da ponte) no meio de uma queda de internet perdia mensagem
// de cliente. Agora ela é gravada num arquivo da pasta de dados da ponte a cada mudança e relida ao abrir.
//
// É conversa de cliente: o arquivo é CIFRADO pelo Windows para este usuário (o mesmo cofre do segredo da ponte —
// safeStorage = DPAPI); sem a cifra disponível, nada é gravado (a fila segue só na memória, como antes) — nunca em texto
// aberto. Fila vazia = arquivo apagado: só fica no disco o que ainda não chegou à nuvem. Gravação pelo arquivo .tmp +
// renomear (uma queda no meio não deixa o arquivo pela metade).

const fs = require('fs');

/**
 * @param {string} arquivo o caminho do arquivo da fila
 * @param {{ isEncryptionAvailable: () => boolean, encryptString: (s: string) => Buffer, decryptString: (b: Buffer) => string }} cofre
 */
function criarGuardaCifrada(arquivo, cofre) {
  const disponivel = () => {
    try {
      return !!cofre && cofre.isEncryptionAvailable();
    } catch {
      return false;
    }
  };
  return {
    /** O que ficou guardado da última vez ([] sem arquivo, sem cifra ou se não deu para ler). */
    carregar() {
      if (!disponivel()) return [];
      try {
        const lista = JSON.parse(cofre.decryptString(fs.readFileSync(arquivo)));
        return Array.isArray(lista) ? lista : [];
      } catch {
        return [];
      }
    },
    /** Grava a fila inteira (vazia = apaga o arquivo). true = gravou. */
    guardar(itens) {
      if (!disponivel()) return false;
      try {
        if (!itens || !itens.length) {
          fs.rmSync(arquivo, { force: true });
          return true;
        }
        const tmp = `${arquivo}.tmp`;
        fs.writeFileSync(tmp, cofre.encryptString(JSON.stringify(itens)));
        fs.renameSync(tmp, arquivo);
        return true;
      } catch {
        return false;
      }
    },
  };
}

module.exports = { criarGuardaCifrada };
