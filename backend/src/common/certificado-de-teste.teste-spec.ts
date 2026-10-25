// Um certificado autoassinado gerado na hora (ECDSA P-256, X.509 v3, com o nome no subjectAltName), para os testes do
// envio por TLS de verdade: o servidor de teste apresenta este certificado, e o cliente confia nele pela opção `ca`. A
// chave nasce na memória e some com o processo: nenhuma chave privada vai para o repositório. O DER é montado à mão
// porque o Node lê certificado (X509Certificate), mas não cria. Portado do hub (`servidor/test/certificado-de-teste.ts`).
// Ajudante de teste: o nome termina em `spec.ts` (fora do build) sem ser `.spec.ts` (o jest não o roda sozinho).
import { generateKeyPairSync, randomBytes, sign } from 'node:crypto';

function tamanho(n: number): Buffer {
  if (n < 0x80) return Buffer.from([n]);
  const bytes: number[] = [];
  for (let x = n; x > 0; x = Math.floor(x / 256)) bytes.unshift(x & 0xff);
  return Buffer.from([0x80 | bytes.length, ...bytes]);
}
const tlv = (tag: number, conteudo: Buffer) => Buffer.concat([Buffer.from([tag]), tamanho(conteudo.length), conteudo]);
const seq = (...itens: Buffer[]) => tlv(0x30, Buffer.concat(itens));
const conjunto = (...itens: Buffer[]) => tlv(0x31, Buffer.concat(itens));
const explicito = (n: number, item: Buffer) => tlv(0xa0 + n, item);

function inteiro(bytes: Buffer): Buffer {
  return tlv(0x02, (bytes[0] as number) & 0x80 ? Buffer.concat([Buffer.from([0]), bytes]) : bytes);
}

function oid(texto: string): Buffer {
  const [a, b, ...resto] = texto.split('.').map(Number) as [number, number, ...number[]];
  const bytes: number[] = [40 * a + b];
  for (const v of resto) {
    const pedaco: number[] = [v & 0x7f];
    for (let x = Math.floor(v / 128); x > 0; x = Math.floor(x / 128)) pedaco.unshift(0x80 | (x & 0x7f));
    bytes.push(...pedaco);
  }
  return tlv(0x06, Buffer.from(bytes));
}

const nome = (cn: string) => seq(conjunto(seq(oid('2.5.4.3'), tlv(0x0c, Buffer.from(cn, 'utf8')))));
function utc(d: Date): Buffer {
  const p = (n: number) => String(n).padStart(2, '0');
  return tlv(
    0x17,
    Buffer.from(`${p(d.getUTCFullYear() % 100)}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`, 'ascii'),
  );
}
const extensao = (id: string, critica: boolean, valor: Buffer) => seq(oid(id), ...(critica ? [tlv(0x01, Buffer.from([0xff]))] : []), tlv(0x04, valor));

function pem(der: Buffer, rotulo: string): string {
  const linhas = der.toString('base64').match(/.{1,64}/g) ?? [];
  return `-----BEGIN ${rotulo}-----\n${linhas.join('\n')}\n-----END ${rotulo}-----\n`;
}

/** O certificado (PEM) e a chave (PEM) para os nomes dados, valendo de 1 hora atrás a 1 dia à frente. */
export function certificadoDeTeste(nomes: readonly string[]): { cert: string; chave: string } {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const algoritmo = seq(oid('1.2.840.10045.4.3.2')); // ecdsa-with-SHA256
  const agora = Date.now();
  const tbs = seq(
    explicito(0, inteiro(Buffer.from([2]))), // v3
    inteiro(randomBytes(12)),
    algoritmo,
    nome(nomes[0] as string),
    seq(utc(new Date(agora - 3_600_000)), utc(new Date(agora + 86_400_000))),
    nome(nomes[0] as string),
    publicKey.export({ type: 'spki', format: 'der' }),
    explicito(
      3,
      seq(
        extensao('2.5.29.19', true, seq(tlv(0x01, Buffer.from([0xff])))), // basicConstraints: CA (é a própria raiz do teste)
        extensao('2.5.29.15', true, tlv(0x03, Buffer.from([0x02, 0x84]))), // keyUsage: digitalSignature, keyCertSign
        extensao('2.5.29.17', false, seq(...nomes.map((n) => tlv(0x82, Buffer.from(n, 'ascii'))))), // subjectAltName: dNSName
      ),
    ),
  );
  const assinatura = sign('sha256', tbs, privateKey);
  const der = seq(tbs, algoritmo, tlv(0x03, Buffer.concat([Buffer.from([0]), assinatura])));
  return { cert: pem(der, 'CERTIFICATE'), chave: privateKey.export({ type: 'pkcs8', format: 'pem' }) as string };
}
