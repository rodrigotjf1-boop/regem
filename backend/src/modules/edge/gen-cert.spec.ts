import { spawnSync } from 'node:child_process';
import { copyFileSync, cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { networkInterfaces, tmpdir } from 'node:os';
import { join } from 'node:path';

/* eslint-disable @typescript-eslint/no-var-requires, @typescript-eslint/no-explicit-any */
const forge = require('node-forge');

// Certificado HTTPS do servidor da loja (edge/gen-cert.mjs). Os aparelhos da loja (caixas,
// totem, KDS) confiam NESTA CA — a reinstalação na MESMA máquina tem de mantê-la. Antes toda
// instalação gerava CA nova e cada aparelho precisava confiar de novo (ERR-111).
const EDGE = join(__dirname, '..', '..', '..', 'edge');
const ARQUIVOS = ['ca.pem', 'server.crt', 'server.key'];
const FORA = '203.0.113.7'; // TEST-NET-3: nunca é IP de uma máquina de verdade

jest.setTimeout(120_000);

const pastas: string[] = [];
const pasta = () => {
  const d = mkdtempSync(join(tmpdir(), 'regem-cert-'));
  pastas.push(d);
  return d;
};
afterAll(() => pastas.forEach((d) => rmSync(d, { recursive: true, force: true })));

function gerar(dir: string, ...args: string[]): string {
  const r = spawnSync(process.execPath, [join(EDGE, 'gen-cert.mjs'), ...args], {
    env: { ...process.env, EDGE_CERT_DIR: dir },
    encoding: 'utf8',
  });
  if (r.status !== 0) throw new Error(`gen-cert saiu com ${r.status}: ${r.stderr}`);
  return r.stdout;
}
const conteudo = (dir: string) => ARQUIVOS.map((n) => readFileSync(join(dir, n), 'utf8')).join('\n');
const ipsDoCert = (dir: string): string[] => {
  const crt = forge.pki.certificateFromPem(readFileSync(join(dir, 'server.crt'), 'utf8'));
  return (crt.getExtension('subjectAltName')?.altNames ?? []).filter((a: any) => a.type === 7).map((a: any) => a.ip);
};
const ipsDaMaquina = () =>
  Object.values(networkInterfaces())
    .flat()
    .filter((a: any) => a && (a.family === 'IPv4' || a.family === 4) && !a.internal)
    .map((a: any) => a.address as string);
const copia = (de: string) => {
  const d = pasta();
  cpSync(de, d, { recursive: true });
  return d;
};

describe('certificado do servidor da loja (edge/gen-cert.mjs)', () => {
  let semIp: string; // conjunto válido, gerado sem IP
  let outro: string; // outro conjunto válido (outra CA)

  beforeAll(() => {
    semIp = pasta();
    gerar(semIp);
    outro = pasta();
    gerar(outro);
  });

  it('instalação nova gera o conjunto; reinstalar na mesma máquina o MANTÉM', () => {
    const d = pasta();
    const primeira = gerar(d);
    expect(primeira).toContain('Certificado NOVO');
    expect(primeira).toContain('nao havia certificado nesta maquina');
    const antes = conteudo(d);
    const segunda = gerar(d);
    expect(segunda).toContain('Certificado MANTIDO');
    expect(conteudo(d)).toBe(antes);
    expect(readdirSync(d).some((n) => n.startsWith('anterior-'))).toBe(false);
  });

  it('PC com duas placas de rede: a detecção pegou a outra, mas o IP do certificado ainda é desta máquina — mantém', () => {
    const ip = ipsDaMaquina()[0];
    if (!ip) return console.warn('gen-cert.spec: máquina sem IPv4 de rede — caso das duas placas PULADO');
    const d = pasta();
    gerar(d, ip);
    expect(ipsDoCert(d)).toContain(ip);
    const antes = conteudo(d);
    expect(gerar(d, FORA)).toContain('Certificado MANTIDO');
    expect(conteudo(d)).toBe(antes);
  });

  it('IP que não é desta máquina: conjunto novo, e o anterior fica guardado para o suporte devolver', () => {
    const d = copia(semIp);
    const antes = conteudo(d);
    const saida = gerar(d, FORA);
    expect(saida).toContain('Certificado NOVO');
    expect(saida).toContain(`nao cobre o IP ${FORA}`);
    expect(saida).toContain('precisam confiar neste');
    expect(ipsDoCert(d)).toContain(FORA);
    const guardada = readdirSync(d).find((n) => n.startsWith('anterior-'));
    expect(guardada).toBeDefined();
    expect(ARQUIVOS.map((n) => readFileSync(join(d, guardada!, n), 'utf8')).join('\n')).toBe(antes);

    // Rodando de novo: o IP gravado não é de nenhuma placa desta máquina. Sem rede nenhuma
    // agora não dá para julgar, e aí mantém (trocar a CA derrubaria todos os aparelhos).
    const denovo = gerar(d, FORA);
    if (ipsDaMaquina().length) {
      expect(denovo).toContain('Certificado NOVO');
      expect(denovo).toContain(`o IP do certificado (${FORA}) nao e mais desta maquina`);
    } else {
      expect(denovo).toContain('Certificado MANTIDO');
    }
  });

  it('certificado de outra CA, chave trocada ou arquivo ilegível: conjunto novo, com o motivo', () => {
    const d1 = copia(semIp);
    copyFileSync(join(outro, 'ca.pem'), join(d1, 'ca.pem'));
    expect(gerar(d1)).toContain('o certificado nao foi assinado por esta CA');

    const d2 = copia(semIp);
    copyFileSync(join(outro, 'server.key'), join(d2, 'server.key'));
    expect(gerar(d2)).toContain('a chave nao e a deste certificado');

    const d3 = copia(semIp);
    writeFileSync(join(d3, 'server.crt'), 'isto nao e um certificado');
    expect(gerar(d3)).toContain('arquivos do certificado ilegiveis');
  });

  it('vencendo em menos de 60 dias: conjunto novo', () => {
    const d = pasta();
    const caKeys = forge.pki.rsa.generateKeyPair(2048);
    const ca = forge.pki.createCertificate();
    ca.publicKey = caKeys.publicKey;
    ca.serialNumber = '01';
    ca.validity.notBefore = new Date(Date.now() - 86_400_000);
    ca.validity.notAfter = new Date(Date.now() + 365 * 86_400_000);
    const nomeCa = [{ name: 'commonName', value: 'Regem Edge CA' }];
    ca.setSubject(nomeCa);
    ca.setIssuer(nomeCa);
    ca.setExtensions([{ name: 'basicConstraints', cA: true }]);
    ca.sign(caKeys.privateKey, forge.md.sha256.create());
    const srvKeys = forge.pki.rsa.generateKeyPair(2048);
    const srv = forge.pki.createCertificate();
    srv.publicKey = srvKeys.publicKey;
    srv.serialNumber = '02';
    srv.validity.notBefore = new Date(Date.now() - 86_400_000);
    srv.validity.notAfter = new Date(Date.now() + 30 * 86_400_000); // vence em 30 dias
    srv.setSubject([{ name: 'commonName', value: 'regem.local' }]);
    srv.setIssuer(nomeCa);
    srv.sign(caKeys.privateKey, forge.md.sha256.create());
    writeFileSync(join(d, 'ca.pem'), forge.pki.certificateToPem(ca));
    writeFileSync(join(d, 'server.crt'), forge.pki.certificateToPem(srv));
    writeFileSync(join(d, 'server.key'), forge.pki.privateKeyToPem(srvKeys.privateKey));
    expect(gerar(d)).toMatch(/Certificado NOVO .*o certificado vence em \d{4}-\d{2}-\d{2}/);
  });

  it('--novo troca o conjunto mesmo quando ele ainda serve', () => {
    const d = copia(semIp);
    const antes = conteudo(d);
    const saida = gerar(d, '--novo');
    expect(saida).toContain('pedido um certificado novo (--novo)');
    expect(conteudo(d)).not.toBe(antes);
  });
});
