// Cenários do estado da impressora pela REDE (edge/impressora-estado.mjs) contra uma impressora
// FALSA que responde ao DLE EOT como uma térmica ESC/POS. Roda em Node puro (o módulo é ESM e o jest
// do backend é CommonJS): imprime UM JSON com o resultado de cada cenário, e o
// impressora-estado.spec.ts confere. Não usa banco nem impressora de verdade.
import net from 'node:net';
import {
  imprimirRedeComEstado,
  interpretarEstado,
  ehByteDeEstado,
  tempoDeImpressaoMs,
} from '../../../edge/impressora-estado.mjs';

// Bytes de estado (bits 1 e 4 sempre 1): pronta, e os bits de cada problema por cima.
const BASE = 0x12;
const ESTADOS = {
  pronta: [BASE, BASE, BASE, BASE],
  semPapel: [BASE | 0x08, BASE | 0x20, BASE, BASE | 0x60],
  tampa: [BASE | 0x08, BASE | 0x04, BASE, BASE],
  corte: [BASE | 0x08, BASE | 0x40, BASE | 0x08, BASE],
  acabando: [BASE, BASE, BASE, BASE | 0x0c],
};

// Impressora falsa: responde DLE EOT n com o byte do estado atual (ou não responde, `mudo`),
// guarda os bytes de impressão recebidos e pode acabar o papel depois de N bytes.
function impressoraFalsa({ estado = 'pronta', mudo = false, acabaDepoisDe = null } = {}) {
  let atual = ESTADOS[estado];
  let impressos = 0;
  let abertas = 0;
  const srv = net.createServer((sock) => {
    let resto = Buffer.alloc(0);
    abertas++;
    sock.on('close', () => abertas--);
    sock.on('error', () => undefined);
    sock.on('data', (chunk) => {
      let buf = Buffer.concat([resto, chunk]);
      resto = Buffer.alloc(0);
      let i = 0;
      while (i < buf.length) {
        if (buf[i] === 0x10) {
          if (i + 2 >= buf.length) {
            resto = buf.subarray(i);
            break;
          }
          if (buf[i + 1] === 0x04) {
            const n = buf[i + 2];
            if (!mudo && n >= 1 && n <= 4) sock.write(Buffer.from([atual[n - 1]]));
            i += 3;
            continue;
          }
        }
        impressos++;
        if (acabaDepoisDe != null && impressos >= acabaDepoisDe) atual = ESTADOS.semPapel;
        i++;
      }
    });
  });
  // Os bytes chegam do outro lado depois que o envio termina: espera a conexão fechar (até 1 s)
  // antes de contar o que a impressora recebeu.
  const recebeuTudo = async () => {
    for (let i = 0; i < 20 && abertas > 0; i++) await new Promise((r) => setTimeout(r, 50));
  };
  return new Promise((r) =>
    srv.listen(0, '127.0.0.1', () =>
      r({
        porta: srv.address().port,
        impressos: () => impressos,
        recebeuTudo,
        fechar: () => new Promise((f) => srv.close(() => f())),
      }),
    ),
  );
}

const cupom = Buffer.from('CUPOM DE TESTE\n'.repeat(40));
const resultado = {};

async function cenario(nome, opcoes, extra = {}) {
  const imp = await impressoraFalsa(opcoes);
  const ini = Date.now();
  try {
    const r = await imprimirRedeComEstado({
      host: '127.0.0.1', porta: imp.porta, buffer: cupom, conectarMs: 1500, estadoMs: 300, conferirMs: 600, ...extra,
    });
    const ms = Date.now() - ini;
    await imp.recebeuTudo();
    resultado[nome] = { ...r, impressos: imp.impressos(), ms };
  } catch (e) {
    resultado[nome] = { rejeitou: String(e?.message ?? e), impressos: imp.impressos() };
  } finally {
    await imp.fechar();
  }
}

await cenario('pronta', { estado: 'pronta' });
await cenario('semPapelAntes', { estado: 'semPapel' });
await cenario('tampaAntes', { estado: 'tampa' });
await cenario('corteAntes', { estado: 'corte' });
await cenario('acabaNoMeio', { estado: 'pronta', acabaDepoisDe: 50 });
await cenario('papelAcabando', { estado: 'acabando' });
await cenario('naoInforma', { mudo: true });

// Porta fechada: a impressora desligada não aceita conexão.
const fechada = await impressoraFalsa();
const portaFechada = fechada.porta;
await fechada.fechar();
try {
  await imprimirRedeComEstado({ host: '127.0.0.1', porta: portaFechada, buffer: cupom, conectarMs: 1000 });
  resultado.desligada = { rejeitou: null };
} catch (e) {
  resultado.desligada = { rejeitou: String(e?.message ?? e) };
}

resultado.puras = {
  byteValido: ehByteDeEstado(0x12),
  byteInvalido: ehByteDeEstado(0x00),
  lixoIgnorado: interpretarEstado(0x00, 0xff, undefined, 0x01).estado,
  tempoMin: tempoDeImpressaoMs(10),
  tempoMax: tempoDeImpressaoMs(10_000_000),
};

console.log(JSON.stringify(resultado));
