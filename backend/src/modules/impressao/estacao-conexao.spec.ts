import { spawn, ChildProcess } from 'node:child_process';
import { generateKeyPairSync, randomUUID } from 'node:crypto';
import * as http from 'node:http';
import * as https from 'node:https';
import * as net from 'node:net';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as forge from 'node-forge';

/* eslint-disable @typescript-eslint/no-explicit-any */

// CONEXÃO PC ↔ SERVIDOR, parte 2 — o SERVIÇO DA ESTAÇÃO de verdade (edge/estacao-impressao.mjs, um
// processo) contra um servidor da loja falso, com certificado de uma CA "da loja" emitido para
// regem.local e 127.0.0.1 (o "IP da instalação"). O servidor responde em outros IPs de loopback
// (127.0.0.3, 127.0.0.4): exatamente o caso do roteador que deu outro IP ao servidor. Prova:
//  • o endereço configurado morto → a estação acha o servidor pelo IP que a nuvem informou, confere o
//    certificado da loja pelo nome regem.local e anota o hosts (D2);
//  • o servidor muda de IP com a estação ligada → ela o segue;
//  • outro servidor na rede (certificado de outra CA) nunca é aceito;
//  • "Trocar endereço do servidor" e "Parear com código" pelo painel, a qualquer momento;
//  • a estação sem pareamento (instalada sem código — D1) acha o servidor pela rede e pareia pelo ícone.
jest.setTimeout(180_000);

const EDGE = join(__dirname, '..', '..', '..', 'edge');
const ID_1 = randomUUID();
const ID_NOVO = randomUUID();
const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));

function chaves() {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
  });
  return { publica: forge.pki.publicKeyFromPem(publicKey), privada: forge.pki.privateKeyFromPem(privateKey), privadaPem: privateKey };
}
function autoridade(nome: string) {
  const k = chaves();
  const c = forge.pki.createCertificate();
  c.publicKey = k.publica;
  c.serialNumber = '01';
  c.validity.notBefore = new Date(Date.now() - 86_400_000);
  c.validity.notAfter = new Date(Date.now() + 86_400_000);
  const s = [{ name: 'commonName', value: nome }];
  c.setSubject(s);
  c.setIssuer(s);
  c.setExtensions([{ name: 'basicConstraints', cA: true }, { name: 'keyUsage', keyCertSign: true, cRLSign: true }]);
  c.sign(k.privada, forge.md.sha256.create());
  return { k, c, pem: forge.pki.certificateToPem(c) };
}
// Como o gen-cert.mjs: regem.local + o IP da instalação (aqui 127.0.0.1 — NÃO é o IP em que o
// servidor responde no teste: só o nome regem.local faz o certificado valer).
function certificadoDoServidor(ca: ReturnType<typeof autoridade>) {
  const k = chaves();
  const c = forge.pki.createCertificate();
  c.publicKey = k.publica;
  c.serialNumber = '02';
  c.validity.notBefore = new Date(Date.now() - 86_400_000);
  c.validity.notAfter = new Date(Date.now() + 86_400_000);
  c.setSubject([{ name: 'commonName', value: 'regem.local' }]);
  c.setIssuer(ca.c.subject.attributes);
  c.setExtensions([{ name: 'subjectAltName', altNames: [{ type: 2, value: 'regem.local' }, { type: 7, ip: '127.0.0.1' }] }]);
  c.sign(ca.k.privada, forge.md.sha256.create());
  return { key: k.privadaPem, cert: forge.pki.certificateToPem(c) };
}

type Pedido = { caminho: string; estacao: string | null; host: string | null };
function servidorFalso(tls: { key: string; cert: string }, caPem: string) {
  const pedidos: Pedido[] = [];
  const srv = https.createServer(tls, async (req, res) => {
    const url = new URL(req.url || '/', 'https://x');
    pedidos.push({ caminho: url.pathname, estacao: (req.headers['x-estacao-id'] as string) ?? null, host: req.headers.host ?? null });
    for await (const _ of req) { /* lê o corpo */ }
    const json = (s: number, o: unknown) => {
      res.writeHead(s, { 'content-type': 'application/json' });
      res.end(JSON.stringify(o));
    };
    if (url.pathname === '/ca.pem') return res.end(caPem);
    if (url.pathname === '/api/v1/ping') return json(200, { regem: true, edge: true, versao: 'teste', banco: true });
    if (url.pathname === '/api/v1/publico/terminal/parear') {
      return json(201, { tipo: 'estacao_impressao', terminalId: ID_NOVO, segredo: 'segredo-novo', nome: 'PC do delivery' });
    }
    if (url.pathname === '/api/v1/impressao/pendentes') {
      await espera(400);
      return json(200, []);
    }
    if (url.pathname === '/api/v1/impressao/estacao/batida') return json(200, { impressoras: [] });
    if (url.pathname === '/api/v1/impressao/estacao/retidos') return json(200, []);
    return json(404, {});
  });
  return { srv, pedidos };
}
const ouvir = (srv: net.Server, porta: number, ip: string) =>
  new Promise<void>((ok, erro) => {
    srv.once('error', erro);
    srv.listen(porta, ip, () => ok());
  });
const fechar = (srv: http.Server | https.Server) =>
  new Promise<void>((ok) => {
    srv.closeAllConnections?.();
    srv.close(() => ok());
  });
async function portaLivre() {
  const s = net.createServer();
  await ouvir(s, 0, '127.0.0.1');
  const p = (s.address() as net.AddressInfo).port;
  await new Promise((r) => s.close(r));
  return p;
}
async function esperar<T>(oQue: string, f: () => Promise<T | null | false | undefined> | T | null | false | undefined, ms = 45_000): Promise<T> {
  const fim = Date.now() + ms;
  let ultimo: unknown;
  while (Date.now() < fim) {
    try {
      const v = await f();
      if (v) return v as T;
    } catch (e) {
      ultimo = e;
    }
    await espera(250);
  }
  throw new Error(`não aconteceu em ${ms / 1000} s: ${oQue}${ultimo ? ` (${String((ultimo as any)?.message ?? ultimo)})` : ''}`);
}

describe('estação de impressão: acha o servidor da loja quando o IP muda (processo real)', () => {
  const caLoja = autoridade('Regem Edge CA');
  const caOutra = autoridade('Outra CA');
  const tlsLoja = certificadoDoServidor(caLoja);
  const tlsOutro = certificadoDoServidor(caOutra);
  let P = 0; // a porta da API: a mesma em todo IP (como 3002 na loja)
  let ipNaNuvem: string | null = null;
  const pedidosNuvem: Array<string | null> = [];
  let nuvem: http.Server;
  let portaNuvem = 0;
  let impostor: ReturnType<typeof servidorFalso>;
  let loja: ReturnType<typeof servidorFalso>;
  const processos: ChildProcess[] = [];
  const pastas: string[] = [];

  beforeAll(async () => {
    loja = servidorFalso(tlsLoja, caLoja.pem);
    await ouvir(loja.srv, 0, '127.0.0.3');
    P = (loja.srv.address() as net.AddressInfo).port;
    impostor = servidorFalso(tlsOutro, caOutra.pem); // outro servidor Regem na rede, de outra loja
    await ouvir(impostor.srv, P, '127.0.0.2');
    nuvem = http.createServer((req, res) => {
      pedidosNuvem.push((req.headers['x-estacao-id'] as string) ?? null);
      res.writeHead(req.url === '/api/v1/impressao/estacao/servidor' ? 200 : 404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ip: ipNaNuvem, maquina: 'SERVIDOR-MB', vistoEm: new Date().toISOString() }));
    });
    await ouvir(nuvem, 0, '127.0.0.1');
    portaNuvem = (nuvem.address() as net.AddressInfo).port;
  });

  afterAll(async () => {
    for (const p of processos) p.kill();
    await espera(300);
    for (const s of [loja?.srv, impostor?.srv, nuvem]) if (s?.listening) await fechar(s);
    for (const d of pastas) rmSync(d, { recursive: true, force: true });
  });

  async function subirEstacao(pareada: boolean, extra: Record<string, string> = {}) {
    const raiz = mkdtempSync(join(tmpdir(), 'regem-estacao-'));
    pastas.push(raiz);
    mkdirSync(join(raiz, 'certs'));
    const caArq = join(raiz, 'certs', 'servidor-ca.pem');
    writeFileSync(caArq, caLoja.pem);
    if (pareada) {
      // Pareada com um IP que não responde mais (o roteador deu outro ao servidor).
      writeFileSync(
        join(raiz, '.env.local'),
        [`REGEM_API=https://127.0.0.5:${P}/api/v1`, `REGEM_CA=${caArq}`, `ESTACAO_ID=${ID_1}`, 'ESTACAO_SEGREDO=segredo-1', 'ESTACAO_NOME=estacao delivery', ''].join('\r\n'),
      );
    }
    writeFileSync(join(raiz, 'hosts'), '# Copyright (c) 1993-2009 Microsoft Corp.\r\n10.1.1.1 intranet.empresa\r\n', 'latin1');
    const painel = await portaLivre();
    const env: NodeJS.ProcessEnv = { ...process.env };
    for (const k of Object.keys(env)) if (/^(REGEM_|ESTACAO_|EDGE_)/.test(k)) delete env[k];
    Object.assign(env, {
      ESTACAO_RAIZ: raiz,
      ESTACAO_PAINEL_PORTA: String(painel),
      ESTACAO_HOSTS_ARQ: join(raiz, 'hosts'),
      ESTACAO_API_NUVEM: `http://127.0.0.1:${portaNuvem}/api/v1`,
      ESTACAO_REDE_TESTE: '127.0.0.2,127.0.0.3,127.0.0.4',
      ESTACAO_SEM_CIFRA: '1',
      ESTACAO_BATIDA_MS: '1500',
      ESTACAO_PROCURAR_MS: '500',
      REGEM_PORTA_API: String(P),
      REGEM_PORTA_WEB: String(P),
      APP_VERSION: 'teste-e2e',
      ...extra,
    });
    const p = spawn(process.execPath, [join(EDGE, 'estacao-impressao.mjs')], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    processos.push(p);
    let log = '';
    p.stdout!.on('data', (d) => (log += d));
    p.stderr!.on('data', (d) => (log += d));
    const chave = await esperar('a chave do painel', () => existsSync(join(raiz, 'painel.key')) && readFileSync(join(raiz, 'painel.key'), 'utf8').trim(), 15_000);
    const painelPedir = (metodo: string, caminho: string, corpo?: unknown) =>
      new Promise<any>((ok, erro) => {
        const dados = corpo === undefined ? null : Buffer.from(JSON.stringify(corpo));
        const req = http.request(
          { host: '127.0.0.1', port: painel, path: caminho, method: metodo, headers: { 'x-painel-chave': chave, ...(dados ? { 'content-type': 'application/json', 'content-length': dados.length } : {}) } },
          (res) => {
            let t = '';
            res.on('data', (d) => (t += d));
            res.on('end', () => ok({ status: res.statusCode, ...JSON.parse(t || '{}') }));
          },
        );
        req.on('error', erro);
        if (dados) req.write(dados);
        req.end();
      });
    const estado = () => painelPedir('GET', '/estado');
    return { raiz, p, log: () => log, painelPedir, estado };
  }

  it('o IP mudou: acha pela nuvem, confere a loja pelo nome, anota o hosts, segue o servidor e aceita o endereço de emergência', async () => {
    ipNaNuvem = '127.0.0.3';
    const e = await subirEstacao(true);
    try {
      // 1) Partida: 127.0.0.5 não responde → a nuvem informa 127.0.0.3 → conferido → em uso.
      const s1 = await esperar('a estação achar o servidor pela nuvem', async () => {
        const s = await e.estado();
        return s.conexao?.alvo === '127.0.0.3' && s;
      });
      expect(s1.conexao).toMatchObject({ como: 'nuvem', ip: '127.0.0.3', configurado: '127.0.0.5', local: true, hosts: { ip: '127.0.0.3' } });
      const passos = s1.conexao.busca.passos.map((x: any) => `${x.como}:${x.ok}`);
      expect(passos[0]).toBe('configurado:false');
      expect(passos).toContain('nome:false');
      expect(passos.at(-1)).toBe('nuvem:true');
      expect(pedidosNuvem).toContain(ID_1); // a nuvem é perguntada com a credencial da estação
      await esperar('a batida chegar ao servidor pelo IP novo', () =>
        loja.pedidos.find((x) => x.caminho === '/api/v1/impressao/estacao/batida' && x.estacao === ID_1 && x.host === `127.0.0.3:${P}`),
      );
      const hosts = readFileSync(join(e.raiz, 'hosts'), 'latin1');
      expect(hosts).toContain('10.1.1.1 intranet.empresa\r\n');
      expect(hosts).toMatch(/127\.0\.0\.3 regem\.local # regem: servidor da loja \(anotado pela estacao\)\r\n$/);
      expect(JSON.parse(readFileSync(join(e.raiz, 'conexao.json'), 'utf8')).ultimoIp).toBe('127.0.0.3');
      expect(impostor.pedidos).toEqual([]); // o servidor de outra loja nunca recebeu uma chamada

      // 2) "Testar conexão" do ícone.
      const t = await e.painelPedir('POST', '/testar');
      expect(t).toMatchObject({ ok: true, conferido: true, alvo: '127.0.0.3', ip: '127.0.0.3' });

      // 3) O roteador dá OUTRO IP ao servidor com a estação ligada: 127.0.0.3 → 127.0.0.4.
      await fechar(loja.srv);
      const pedidosAntes = loja.pedidos;
      loja = servidorFalso(tlsLoja, caLoja.pem);
      await ouvir(loja.srv, P, '127.0.0.4');
      ipNaNuvem = '127.0.0.4';
      const s3 = await esperar('a estação seguir o servidor para 127.0.0.4', async () => {
        const s = await e.estado();
        return s.conexao?.alvo === '127.0.0.4' && s;
      });
      expect(s3.conexao).toMatchObject({ como: 'nuvem', hosts: { ip: '127.0.0.4' } });
      expect(s3.conexao.busca.motivo).toBe('a fila parou de responder');
      await esperar('a fila voltar pelo IP novo', () => loja.pedidos.find((x) => x.caminho === '/api/v1/impressao/pendentes' && x.host === `127.0.0.4:${P}`));
      expect(readFileSync(join(e.raiz, 'hosts'), 'latin1').match(/regem\.local/g)).toHaveLength(1); // trocou a linha, sem repetir
      expect(pedidosAntes.length).toBeGreaterThan(0);

      // 4) Endereço de emergência: o de outra loja e o vazio são recusados, com o motivo.
      const outro = await e.painelPedir('POST', '/servidor', { endereco: '127.0.0.2', usar: true });
      expect(outro).toMatchObject({ ok: false, endereco: '127.0.0.2' });
      expect(outro.motivo).toContain('não é o servidor desta loja');
      const vazio = await e.painelPedir('POST', '/servidor', { endereco: '127.0.0.5' });
      expect(vazio.ok).toBe(false);
      expect((await e.estado()).conexao.alvo).toBe('127.0.0.4'); // nada mudou
      const ruim = await e.painelPedir('POST', '/servidor', { endereco: '999.1.1.1' });
      expect(ruim.status).toBe(400);

      // 5) O endereço certo, digitado: passa a ser o configurado (fica no .env.local; o segredo também).
      const bom = await e.painelPedir('POST', '/servidor', { endereco: `https://127.0.0.4:3001/balcao`, usar: true });
      expect(bom).toMatchObject({ ok: true, usado: true, endereco: '127.0.0.4', agora: '127.0.0.4' });
      const envLocal = readFileSync(join(e.raiz, '.env.local'), 'utf8');
      expect(envLocal).toContain(`REGEM_API=https://127.0.0.4:${P}/api/v1\r\n`);
      expect(envLocal).toContain('ESTACAO_SEGREDO=segredo-1');
      expect((await e.estado()).conexao).toMatchObject({ configurado: '127.0.0.4', como: 'digitado' });

      // 6) "Parear com código" com a estação JÁ pareada: pelo endereço que responde agora.
      const par = await e.painelPedir('POST', '/parear', { codigo: '123456' });
      expect(par).toMatchObject({ ok: true, nome: 'PC do delivery' });
      await esperar('a batida com a credencial nova', () => loja.pedidos.find((x) => x.caminho === '/api/v1/impressao/estacao/batida' && x.estacao === ID_NOVO));
      expect(readFileSync(join(e.raiz, '.env.local'), 'utf8')).toContain(`ESTACAO_ID=${ID_NOVO}`);
      expect((await e.painelPedir('POST', '/parear', { codigo: '12' })).status).toBe(400);
    } catch (err) {
      console.error(e.log());
      throw err;
    }
  });

  // ERR-249: o instalador (PowerShell 5.1) não baixava a CA (-SkipCertificateCheck não existe nele).
  it('o instalador baixa a CA da loja pelo node (--baixar-ca) para a pasta da estação; servidor errado sai com o motivo', async () => {
    const ip = (loja.srv.address() as net.AddressInfo).address;
    const raiz = mkdtempSync(join(tmpdir(), 'regem-ca-'));
    pastas.push(raiz);
    const rodar = (servidor: string) =>
      new Promise<{ codigo: number | null; saida: string }>((ok) => {
        const env: NodeJS.ProcessEnv = { ...process.env, ESTACAO_RAIZ: raiz, REGEM_PORTA_WEB: String(P) };
        const p = spawn(process.execPath, [join(EDGE, 'estacao-impressao.mjs'), '--baixar-ca', '--servidor', servidor], { env, stdio: ['ignore', 'pipe', 'pipe'] });
        let saida = '';
        p.stdout!.on('data', (d) => (saida += d));
        p.stderr!.on('data', (d) => (saida += d));
        p.on('close', (codigo) => ok({ codigo, saida }));
      });
    const bom = await rodar(ip);
    expect(bom.codigo).toBe(0);
    expect(readFileSync(join(raiz, 'certs', 'servidor-ca.pem'), 'utf8')).toBe(caLoja.pem);
    const ruim = await rodar('127.0.0.5');
    expect(ruim.codigo).toBe(1);
    expect(ruim.saida).toContain('Não baixei o certificado da loja');
  });

  it('sem impressora (D1, sem pareamento): o serviço testa sozinho, acha o servidor no IP novo e anota o hosts', async () => {
    ipNaNuvem = null;
    const ip = (loja.srv.address() as net.AddressInfo).address;
    const e = await subirEstacao(false, { ESTACAO_SERVIDOR: '127.0.0.5', ESTACAO_VIGIA_MS: '700' });
    try {
      // Ninguém clica em nada: duas falhas do teste de cada minuto (aqui 0,7 s) → a busca.
      const s = await esperar('o serviço achar o servidor sozinho', async () => {
        const x = await e.estado();
        return x.conexao?.alvo === ip && x;
      });
      expect(s).toMatchObject({ pareada: false, conexao: { como: 'varredura', hosts: { ip } } });
      expect(s.conexao.busca.motivo).toBe('o servidor parou de responder');
      expect(readFileSync(join(e.raiz, 'hosts'), 'latin1')).toContain(`${ip} regem.local`);
    } catch (err) {
      console.error(e.log());
      throw err;
    }
  });

  it('sem pareamento (instalada sem código) e sem internet: acha o servidor varrendo a rede e pareia pelo ícone', async () => {
    ipNaNuvem = null;
    const e = await subirEstacao(false, { ESTACAO_SERVIDOR: '127.0.0.5' });
    const ip = (loja.srv.address() as net.AddressInfo).address; // onde o servidor está agora (o teste de cima o move)
    try {
      const s0 = await esperar('o painel responder', () => e.estado());
      expect(s0).toMatchObject({ pareada: false, conexao: { configurado: '127.0.0.5', alvo: '127.0.0.5', local: true } });
      // "Testar conexão": o endereço do instalador não responde → procura → acha pela rede.
      const t = await e.painelPedir('POST', '/testar');
      expect(t).toMatchObject({ ok: false, alvo: '127.0.0.5', achou: ip, agora: ip });
      expect(t.busca.passos.map((x: any) => x.como)).toEqual(['configurado', 'nome', 'nuvem', 'varredura']);
      expect(t.busca.passos.at(-1)).toMatchObject({ como: 'varredura', host: ip, ok: true });
      expect(readFileSync(join(e.raiz, 'hosts'), 'latin1')).toContain(`${ip} regem.local`);
      // Pareia pelo ícone sem digitar o endereço: vai pelo que a busca achou.
      const par = await e.painelPedir('POST', '/parear', { codigo: '654321' });
      expect(par).toMatchObject({ ok: true });
      expect(readFileSync(join(e.raiz, '.env.local'), 'utf8')).toContain(`REGEM_API=https://${ip}:${P}/api/v1`);
      await esperar('a primeira batida', () => loja.pedidos.find((x) => x.caminho === '/api/v1/impressao/estacao/batida' && x.estacao === ID_NOVO && x.host === `${ip}:${P}`));
      expect((await e.estado()).pareada).toBe(true);
      expect(impostor.pedidos).toEqual([]);
    } catch (err) {
      console.error(e.log());
      throw err;
    }
  });
});
