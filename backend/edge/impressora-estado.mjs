// ESTADO DA IMPRESSORA TÉRMICA PELA REDE (fase 1 da central de impressão, 15/10/2026).
//
// Até aqui o Regem marcava "impresso" quando os bytes chegavam à impressora: uma bobina que acabava
// no meio passava como impressa, e os cupons seguintes iam para uma impressora sem papel — perdidos.
// Pela REDE (TCP 9100) a térmica conversa nos dois sentidos: o comando de estado em TEMPO REAL do
// ESC/POS, DLE EOT n, é respondido mesmo com a impressora parada (sem papel, tampa aberta, erro),
// com 1 byte por pergunta. Antes do cupom: está pronta? Depois: continuou pronta até o fim?
//
// Usado pelo servidor da loja (impressao-daemon.mjs) e pela estação de impressão.
//
// Referência: Epson ESC/POS, DLE EOT — n=1 impressora, n=2 motivo de estar parada, n=3 erro, n=4
// sensor do papel. Nem toda impressora responde (genéricas): sem resposta = "não informa estado", e a
// impressão segue como sempre (os bytes entregues contam como impresso).
import net from 'node:net';

export const ESTADO = Object.freeze({
  PRONTA: 'pronta',
  PAPEL_ACABANDO: 'papel_acabando',
  SEM_PAPEL: 'sem_papel',
  TAMPA_ABERTA: 'tampa_aberta',
  ERRO: 'erro',
  PARADA: 'parada',
});

// Byte de estado do DLE EOT: bits 1 e 4 sempre 1, bits 0 e 7 sempre 0. Qualquer outro byte não é
// resposta de estado (eco, lixo da rede, resposta de outro comando) e é ignorado.
export const ehByteDeEstado = (b) => typeof b === 'number' && (b & 0x93) === 0x12;

// Os 4 bytes (n = 1..4) viram UM estado, do mais grave para o mais leve. Byte ausente ou inválido
// = sem informação daquele item.
export function interpretarEstado(b1, b2, b3, b4) {
  const ok = (b) => ehByteDeEstado(b);
  if (ok(b4) && b4 & 0x60) return { estado: ESTADO.SEM_PAPEL, detalhe: 'sem papel' };
  if (ok(b2) && b2 & 0x20) return { estado: ESTADO.SEM_PAPEL, detalhe: 'parou por falta de papel' };
  if (ok(b2) && b2 & 0x04) return { estado: ESTADO.TAMPA_ABERTA, detalhe: 'tampa aberta' };
  if (ok(b3) && b3 & 0x08) return { estado: ESTADO.ERRO, detalhe: 'erro na guilhotina ou papel preso' };
  if (ok(b3) && b3 & 0x20) return { estado: ESTADO.ERRO, detalhe: 'erro da impressora: desligue e ligue de novo' };
  if (ok(b3) && b3 & 0x40) return { estado: ESTADO.ERRO, detalhe: 'cabeça de impressão quente: aguarde' };
  if (ok(b2) && b2 & 0x40) return { estado: ESTADO.ERRO, detalhe: 'erro da impressora' };
  if (ok(b1) && b1 & 0x08) return { estado: ESTADO.PARADA, detalhe: 'impressora parada' };
  if (ok(b4) && b4 & 0x0c) return { estado: ESTADO.PAPEL_ACABANDO, detalhe: 'papel acabando' };
  return { estado: ESTADO.PRONTA, detalhe: null };
}

// Papel acabando ainda imprime (é aviso, não parada).
export const podeImprimir = (estado) => estado === ESTADO.PRONTA || estado === ESTADO.PAPEL_ACABANDO;

// Quanto esperar, depois de entregar o cupom, para conferir que ele saiu inteiro. A térmica
// imprime da memória dela depois que os bytes chegam; um cupom comum (~2 KB) leva 1 a 2 s.
// Sem um "terminei" padrão em todas as impressoras, a conferência dura o tempo provável do cupom.
export function tempoDeImpressaoMs(bytes) {
  return Math.min(4000, Math.max(800, Math.round(Number(bytes || 0) * 1.2)));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Uma conexão com a impressora que sabe perguntar o estado. Os bytes que chegam vão para uma fila;
// cada pergunta espera o PRÓXIMO byte válido de estado (ou desiste no prazo).
function conectar(host, porta, conectarMs) {
  return new Promise((resolve, reject) => {
    const sock = net.createConnection({ host, port: porta || 9100 });
    const chegados = [];
    let esperando = null;
    sock.on('data', (buf) => {
      for (const b of buf) {
        if (!ehByteDeEstado(b)) continue;
        if (esperando) {
          const w = esperando;
          esperando = null;
          w(b);
        } else chegados.push(b);
      }
    });
    const t = setTimeout(() => {
      sock.destroy();
      reject(new Error(`impressora não respondeu (sem conexão em ${conectarMs / 1000} s)`));
    }, conectarMs);
    sock.once('error', (e) => {
      clearTimeout(t);
      reject(e);
    });
    sock.once('connect', () => {
      clearTimeout(t);
      sock.on('error', () => undefined); // depois de conectada, o erro vira "conexão caiu" no uso
      // 8 s sem nenhum tráfego com a conexão aberta: a impressora travou segurando o buffer — corta
      // (a escrita pendente falha e a fila trata como "não recebeu").
      sock.setTimeout(8000, () => sock.destroy(new Error('a impressora parou de responder no meio do envio')));
      const proximoByte = (prazoMs) =>
        new Promise((r) => {
          if (chegados.length) return r(chegados.shift());
          const to = setTimeout(() => {
            esperando = null;
            r(undefined);
          }, prazoMs);
          esperando = (b) => {
            clearTimeout(to);
            r(b);
          };
        });
      resolve({
        sock,
        async estado(prazoMs = 700) {
          const b = [];
          for (const n of [1, 2, 3, 4]) {
            if (sock.destroyed) return { informa: false };
            sock.write(Buffer.from([0x10, 0x04, n]));
            b.push(await proximoByte(prazoMs));
            if (n === 1 && b[0] === undefined) return { informa: false }; // não responde estado
          }
          return { informa: true, bytes: b, ...interpretarEstado(...b) };
        },
        escrever: (buffer) =>
          new Promise((r, rej) => {
            if (sock.destroyed) return rej(new Error('a conexão com a impressora caiu'));
            sock.write(buffer, (e) => (e ? rej(e) : r()));
          }),
        fechar: () =>
          new Promise((r) => {
            if (sock.destroyed) return r();
            sock.end(() => r());
            setTimeout(() => {
              sock.destroy();
              r();
            }, 1500);
          }),
      });
    });
  });
}

/**
 * Imprime um cupom numa impressora de REDE conferindo o estado antes e depois.
 * Devolve:
 *   { saiu: true,  informa, estado, detalhe }            — saiu (informa=false: a impressora não diz o estado)
 *   { saiu: false, motivo: 'nao_pronta', estado, detalhe } — não estava pronta: NADA foi enviado
 *   { saiu: false, motivo: 'interrompido', estado, detalhe } — parou no meio (sem papel, tampa, erro)
 * Rejeita quando não conecta ou a conexão cai (impressora desligada / rede): a fila trata como antes.
 */
export async function imprimirRedeComEstado({ host, porta, buffer, conectarMs = 3000, estadoMs = 700, conferirMs }) {
  const c = await conectar(host, porta, conectarMs);
  try {
    const antes = await c.estado(estadoMs);
    if (antes.informa && !podeImprimir(antes.estado)) {
      return { saiu: false, motivo: 'nao_pronta', estado: antes.estado, detalhe: antes.detalhe };
    }
    await c.escrever(buffer);
    if (!antes.informa) return { saiu: true, informa: false, estado: null, detalhe: null };
    // Confere durante o tempo provável do cupom: se parar no meio, o cupom não saiu inteiro.
    const ate = Date.now() + (conferirMs ?? tempoDeImpressaoMs(buffer.length));
    let ultimo = antes;
    while (Date.now() < ate) {
      await sleep(250);
      const agora = await c.estado(estadoMs);
      if (!agora.informa) continue; // ocupada respondendo: tenta na próxima
      ultimo = agora;
      if (!podeImprimir(agora.estado)) {
        return { saiu: false, motivo: 'interrompido', estado: agora.estado, detalhe: agora.detalhe };
      }
    }
    return { saiu: true, informa: true, estado: ultimo.estado, detalhe: ultimo.detalhe };
  } finally {
    await c.fechar();
  }
}

/** Só pergunta o estado (sem imprimir). `{ informa:false }` quando a impressora não responde estado. */
export async function consultarEstadoRede({ host, porta, conectarMs = 3000, estadoMs = 700 }) {
  const c = await conectar(host, porta, conectarMs);
  try {
    return await c.estado(estadoMs);
  } finally {
    await c.fechar();
  }
}
