import { generateKeyPairSync, sign } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  CHAVE_PUBLICA_UPDATE,
  assinaturaConfere,
  chavesDoPem,
  mensagemV1,
  mensagemV2,
} from './update-assinatura';

// Assinatura dos releases do servidor local (ERR-046). A loja confere com edge/verify-update.mjs;
// o console da distribuição confere com update-assinatura.ts ANTES de publicar. Se os dois
// divergirem (mensagem, chave), a distribuição publica um release que todas as lojas recusam.
const EDGE = join(__dirname, '..', '..', 'edge');

function verificarNaLoja(args: string[], chavePem: string) {
  const r = spawnSync(process.execPath, [join(EDGE, 'verify-update.mjs'), ...args], {
    env: { ...process.env, EDGE_UPDATE_PUBLIC_KEY: chavePem },
    encoding: 'utf8',
  });
  return r.status;
}

describe('assinatura dos releases — nuvem e loja conferem igual', () => {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const pub = publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const chaves = chavesDoPem(pub);
  const v = '1.30.0';
  const sha = 'b'.repeat(64);
  const url = 'https://storage/regem-edge-1.30.0.zip';
  const futuro = new Date(Date.now() + 86400000).toISOString();
  const passado = new Date(Date.now() - 86400000).toISOString();
  const s1 = sign(null, Buffer.from(mensagemV1(v, sha, url)), privateKey).toString('base64');
  const s2 = sign(null, Buffer.from(mensagemV2(v, sha, url, futuro)), privateKey).toString('base64');
  const s2Vencida = sign(null, Buffer.from(mensagemV2(v, sha, url, passado)), privateKey).toString('base64');

  it('a chave embutida na API é a mesma do edge/update-pub.pem (o que vai no pacote)', () => {
    const arquivo = readFileSync(join(EDGE, 'update-pub.pem'), 'utf8').replace(/\r\n/g, '\n').trim();
    expect(CHAVE_PUBLICA_UPDATE.trim()).toBe(arquivo);
  });

  it('a assinatura v1 publicada para a 1.29.3 confere com a chave embutida (dado real)', () => {
    const ok = assinaturaConfere(
      mensagemV1(
        '1.29.3',
        'acada824cdf156477081b283f58721a371c93cd8f5850044c019e7ae64ccc394',
        'https://baglkwaahkjgwvnfabic.supabase.co/storage/v1/object/public/edge-updates/regem-edge-1.29.3.zip',
      ),
      'ouZUzBPYXRP8Mu1bgbhnzArPXR8AhSWxJuWkYK/Wsl5BL0SpFMnFjx6bKefyMH6pipyCdoQtcA6p/sl9awwaAw==',
    );
    expect(ok).toBe(true);
  });

  it('v1 e v2 válidas: a API aceita e a loja sai com 0', () => {
    expect(assinaturaConfere(mensagemV1(v, sha, url), s1, chaves)).toBe(true);
    expect(assinaturaConfere(mensagemV2(v, sha, url, futuro), s2, chaves)).toBe(true);
    expect(verificarNaLoja([v, sha, url, s1], pub)).toBe(0);
    expect(verificarNaLoja([v, sha, url, s2, futuro], pub)).toBe(0);
  });

  it('qualquer campo trocado invalida (API recusa, loja sai com 1)', () => {
    expect(assinaturaConfere(mensagemV1('1.30.1', sha, url), s1, chaves)).toBe(false);
    expect(verificarNaLoja(['1.30.1', sha, url, s1], pub)).toBe(1);
    expect(verificarNaLoja([v, 'c'.repeat(64), url, s1], pub)).toBe(1);
    expect(verificarNaLoja([v, sha, url + '?x', s1], pub)).toBe(1);
  });

  it('v1 não vale como v2 nem o contrário (prefixo separa as mensagens)', () => {
    expect(verificarNaLoja([v, sha, url, s1, futuro], pub)).toBe(1);
    expect(verificarNaLoja([v, sha, url, s2], pub)).toBe(1);
  });

  it('v2 vencida: a loja sai com 3 (recusa metadado velho reapresentado)', () => {
    expect(verificarNaLoja([v, sha, url, s2Vencida, passado], pub)).toBe(3);
    expect(verificarNaLoja([v, sha, url, s2, 'amanha'], pub)).toBe(3);
  });

  it('sem chave: a loja sai com 2 (o atualizar.ps1 decide)', () => {
    const r = spawnSync(process.execPath, [join(EDGE, 'verify-update.mjs'), v, sha, url, s1], {
      env: { ...process.env, EDGE_UPDATE_PUBLIC_KEY: 'nao-e-pem' },
      encoding: 'utf8',
    });
    expect(r.status).toBe(2);
  });

  it('troca de chave: arquivo com duas chaves aceita assinatura de qualquer uma', () => {
    const outra = generateKeyPairSync('ed25519').publicKey.export({ type: 'spki', format: 'pem' }).toString();
    expect(verificarNaLoja([v, sha, url, s1], `${outra}\n${pub}`)).toBe(0);
    expect(assinaturaConfere(mensagemV1(v, sha, url), s1, chavesDoPem(`${outra}\n${pub}`))).toBe(true);
  });

  it('o sign-update.mjs gera v1 e v2 que a API e a loja aceitam', () => {
    const r = spawnSync(process.execPath, [join(EDGE, 'sign-update.mjs'), v, sha, url, '--expira-dias=30'], {
      env: { ...process.env, EDGE_UPDATE_PRIVATE_KEY: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString() },
      encoding: 'utf8',
    });
    expect(r.status).toBe(0);
    const pega = (k: string) => new RegExp(`${k}=(\\S+)`).exec(r.stdout)?.[1] ?? '';
    const g1 = pega('EDGE_UPDATE_SIG');
    const g2 = pega('EDGE_UPDATE_SIG_V2');
    const exp = pega('EDGE_UPDATE_EXPIRA');
    expect(assinaturaConfere(mensagemV1(v, sha, url), g1, chaves)).toBe(true);
    expect(assinaturaConfere(mensagemV2(v, sha, url, exp), g2, chaves)).toBe(true);
    expect(verificarNaLoja([v, sha, url, g2, exp], pub)).toBe(0);
  });
});
