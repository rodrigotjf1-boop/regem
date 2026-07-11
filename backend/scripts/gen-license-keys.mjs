// Gera o par de chaves Ed25519 da LICENÇA (assinatura do lease).
// Rode LOCALMENTE:  node scripts/gen-license-keys.mjs
//
// SEGURANÇA: a PRIVADA é secreta — vai SÓ na nuvem (regem-api). NUNCA no edge,
// nunca em chat/ticket/git. A PÚBLICA vai no edge (verifica o lease offline).
import { generateKeyPairSync } from 'crypto';

const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const privPem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const pubPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
const b64 = (s) => Buffer.from(s).toString('base64');

console.log('\n=== LICENSE_PRIVATE_KEY_B64  (SÓ na nuvem / regem-api — SECRETO) ===');
console.log(b64(privPem));
console.log('\n=== LICENSE_PUBLIC_KEY_B64   (nuvem regem-api + no edge .env.local) ===');
console.log(b64(pubPem));
console.log('\n=== LICENSE_KID ===');
console.log('k1');
console.log('\nGuarde a PRIVADA num cofre. Se vazar, gere um novo par com LICENSE_KID=k2 e rotacione.\n');
