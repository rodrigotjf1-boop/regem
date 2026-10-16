// ERR-234: download que FALHA no meio, ligado ao descompactador como na restauração por arquivo do
// sync-daemon, com o mesmo pega-tudo de erros do daemon (registra e segue). Mede se o `for await`
// do descompactador termina (erro repassado) ou fica pendurado. Roda em Node puro; o
// restauracao-trava.spec.ts confere o JSON da última linha.
import zlib from 'node:zlib';
import { Readable, pipeline } from 'node:stream';

// Igual ao sync-daemon.mjs: o erro sem dono é só registrado e o processo segue.
process.on('uncaughtException', () => undefined);

const dados = zlib.gzipSync(Buffer.from('{"__t":"comanda"}\n'.repeat(20000)));
const metade = dados.subarray(0, Math.floor(dados.length / 2));

function downloadQueCai() {
  let enviado = false;
  return new ReadableStream({
    pull(ctrl) {
      if (!enviado) { enviado = true; ctrl.enqueue(new Uint8Array(metade)); return; }
      ctrl.error(new Error('conexão caiu no meio do download'));
    },
  });
}

async function caso(ligar) {
  const gunzip = zlib.createGunzip();
  ligar(Readable.fromWeb(downloadQueCai()), gunzip);
  const ler = (async () => { for await (const _ of gunzip) { /* consome */ } return 'terminou sem erro'; })()
    .catch((e) => `erro: ${e.message}`);
  const limite = new Promise((r) => setTimeout(() => r('pendurado'), 5000));
  return Promise.race([ler, limite]);
}

const resultado = {
  pipe: await caso((src, gz) => src.pipe(gz)),
  pipeline: await caso((src, gz) => pipeline(src, gz, () => undefined)),
};
console.log(JSON.stringify(resultado));
process.exit(0);
