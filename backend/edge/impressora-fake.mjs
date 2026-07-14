// Impressora termica FALSA para testar o worker sem hardware. Sobe um servidor
// TCP RAW (porta 9100 por padrao) que recebe os bytes ESC/POS, decodifica os
// comandos principais e imprime no console um preview legivel do ticket.
//   node edge/impressora-fake.mjs            # porta 9100
//   node edge/impressora-fake.mjs 9101       # outra porta (2a impressora)
import net from 'net';

const PORTA = Number(process.argv[2] || 9100);

// Traduz os comandos ESC/POS que o nosso escpos.mjs emite para marcadores legiveis.
function decodificar(buf) {
  const linhas = [];
  let atual = '';
  const flush = () => {
    linhas.push(atual);
    atual = '';
  };
  for (let i = 0; i < buf.length; i++) {
    const b = buf[i];
    if (b === 0x1b) {
      // ESC ...
      const c = buf[i + 1];
      if (c === 0x40) { i += 1; } // init
      else if (c === 0x45) { atual += buf[i + 2] ? '[B]' : '[/B]'; i += 2; } // bold
      else if (c === 0x61) { const a = buf[i + 2]; atual += a === 1 ? '[centro]' : a === 2 ? '[dir]' : ''; i += 2; }
      else if (c === 0x64) { i += 2; } // feed
      else if (c === 0x42) { atual += ' [BIP]'; i += 3; } // beep
      else { i += 1; }
    } else if (b === 0x1d) {
      // GS ...
      const c = buf[i + 1];
      if (c === 0x21) { atual += buf[i + 2] ? '[2x]' : ''; i += 2; } // size
      else if (c === 0x56) { atual += ' [CORTE]'; i += 3; } // cut
      else { i += 1; }
    } else if (b === 0x0a) {
      flush();
    } else if (b >= 0x20 && b <= 0x7e) {
      atual += String.fromCharCode(b);
    }
  }
  if (atual) flush();
  return linhas;
}

const srv = net.createServer((sock) => {
  const chunks = [];
  sock.on('data', (d) => chunks.push(d));
  sock.on('end', () => {
    const buf = Buffer.concat(chunks);
    const linhas = decodificar(buf);
    console.log(`\n===== ticket recebido (${buf.length} bytes) @ ${new Date().toLocaleTimeString('pt-BR')} =====`);
    for (const l of linhas) console.log('  ' + l);
    console.log('==================================================\n');
  });
  sock.on('error', () => {});
});

srv.listen(PORTA, () => console.log(`Impressora FALSA ouvindo em 0.0.0.0:${PORTA} (TCP RAW/9100)`));
