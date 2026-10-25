// O envio seguro para o endereço que vem de fora (o aviso do aplicativo de parceiro, F4 parte F; Padrão §9), sem banco:
// cada recusa do endereço, as faixas de túnel do IPv6, o prazo da resolução, a fixação dos endereços conferidos (o nome
// nem resolve no sistema e a conexão vai ao IP que a conferência deu), o TLS de verdade conferindo o certificado pelo
// NOME mesmo conectando pelo IP, o redirecionamento que não se segue, o tempo esgotado, o teto da resposta e a falha de
// conexão. Fora o teste do TLS, a conexão é http (o `requisitar` trocado), na porta do servidor de teste; na produção,
// sempre https na 443. Portado do hub (`servidor/test/simulador-envio.spec.ts`).
import { X509Certificate } from 'node:crypto';
import * as http from 'node:http';
import * as https from 'node:https';
import type { AddressInfo } from 'node:net';
import type { TLSSocket } from 'node:tls';
import { certificadoDeTeste } from './certificado-de-teste.teste-spec';
import {
  conferirDestino,
  DOMINIOS_DA_DMS,
  enderecoRecusado,
  enviarAoDestino,
  enviarComSeguranca,
  type OpcoesDoEnvio,
  type Requisitar,
  TETO_DA_RESPOSTA,
  Vagas,
} from './envio-seguro';

/** A requisição do teste: o mesmo endereço, em http (o servidor de teste não tem certificado); o resto, igual. */
const emHttp: Requisitar = (url, opcoes, aoResponder) => http.request(new URL(url.href.replace(/^https:/, 'http:')), opcoes, aoResponder);

const publico =
  (ip = '198.51.100.20'): OpcoesDoEnvio['resolver'] =>
  async () => [{ address: ip, family: 4 }];
const motivo = async (endereco: string, o: OpcoesDoEnvio = { resolver: publico('8.8.8.8') }) => {
  const r = await conferirDestino(endereco, o);
  return 'motivo' in r ? r.motivo : null;
};

describe('a conferência do endereço do parceiro', () => {
  it('só https, porta padrão, sem usuário e senha, um nome completo, público e de fora da DMS', async () => {
    expect(await motivo('http://parceiro.exemplo/avisos/x')).toBe('o endereço precisa ser https');
    expect(await motivo('https://parceiro.exemplo:8443/avisos/x')).toBe('o endereço precisa usar a porta padrão do https (443)');
    expect(await motivo('https://quem:senha@parceiro.exemplo/avisos/x')).toBe('o endereço não pode ter usuário e senha');
    expect(await motivo('https://203.0.113.5/avisos/x')).toBe('o endereço precisa ser um nome, não um IP');
    expect(await motivo('https://[2001:db8::1]/avisos/x')).toBe('o endereço precisa ser um nome, não um IP');
    expect(await motivo('https://parceiro/avisos/x')).toBe('o endereço precisa ser um nome completo, sem ponto no fim');
    expect(await motivo('https://parceiro.exemplo./avisos/x')).toBe('o endereço precisa ser um nome completo, sem ponto no fim');
    for (const local of ['https://app.localhost/x', 'https://caixa.local/x', 'https://banco.internal/x', 'https://roteador.lan/x', 'https://nas.home.arpa/x']) {
      expect(await motivo(local)).toBe('o endereço precisa ser público, não de rede local');
    }
    for (const dms of [...DOMINIOS_DA_DMS.map((x) => `https://${x}/x`), 'https://api.dmsregem.com/x', 'https://API.DMSREGEM.COM/x']) {
      expect(await motivo(dms)).toBe('o Regem não manda aviso de parceiro para endereço da DMS');
    }
    // os serviços do próprio Regem (lidos do ambiente) também
    expect(await motivo('https://projeto.supabase.exemplo/x', { resolver: publico(), proibidos: ['projeto.supabase.exemplo'] })).toBe(
      'o Regem não manda aviso de parceiro para endereço da DMS',
    );
    expect(await motivo('https://outro.supabase.exemplo/x', { resolver: publico('8.8.8.8'), proibidos: ['projeto.supabase.exemplo'] })).toBeNull();
    // o domínio da DMS no MEIO do nome de outro não é da DMS
    expect(await motivo('https://dmsregem.com.parceiro.exemplo/x')).toBeNull();
    expect(await motivo('https://naodmsregem.com/x')).toBeNull();
    expect(await motivo('não é endereço')).toBe('não é um endereço');
  });

  it('resolve o nome e recusa se QUALQUER endereço for interno (a regra do pacote e os túneis do IPv6); nome que não resolve ou demora, recusa', async () => {
    const com = (...ips: string[]): OpcoesDoEnvio => ({ resolver: async () => ips.map((address) => ({ address, family: address.includes(':') ? 6 : 4 })) });
    for (const interno of [
      '10.0.0.5',
      '127.0.0.1',
      '169.254.169.254',
      '172.20.1.1',
      '192.168.0.10',
      '100.64.0.1',
      '::1',
      'fd00::5',
      'fe80::1',
      '::ffff:10.0.0.5',
      '64:ff9b::a00:5',
      '2002:a00:1::1',
      '2001:0:4136:e378::1',
      '::a00:1',
      '64:ff9b:1::a00:1',
    ]) {
      expect([interno, await motivo('https://parceiro.exemplo/x', com(interno))]).toEqual([interno, 'o nome do endereço aponta para uma rede interna']);
    }
    expect(enderecoRecusado('2001:4860:4860::8888')).toBe(false);
    expect(enderecoRecusado('8.8.8.8')).toBe(false);
    // um público e um interno: recusa (escolher só o público abriria a porta ao DNS que alterna)
    expect(await motivo('https://parceiro.exemplo/x', com('8.8.8.8', '10.0.0.5'))).toBe('o nome do endereço aponta para uma rede interna');
    expect(await motivo('https://parceiro.exemplo/x', com())).toBe('o nome do endereço não resolve');
    expect(
      await motivo('https://parceiro.exemplo/x', {
        resolver: async () => {
          throw Object.assign(new Error('ENOTFOUND'), { code: 'ENOTFOUND' });
        },
      }),
    ).toBe('o nome do endereço não resolve');
    // o DNS lento de propósito não segura o envio: prazo próprio
    const inicio = Date.now();
    expect(await motivo('https://parceiro.exemplo/x', { resolver: () => new Promise(() => undefined), prazoDnsMs: 150 })).toBe('o nome do endereço não resolveu a tempo');
    expect(Date.now() - inicio).toBeLessThan(1000);
    // os conferidos, com o IPv4 primeiro (a máquina sem IPv6 conecta de primeira)
    const ok = await conferirDestino('https://parceiro.exemplo/avisos/x', com('2001:4860:4860::8888', '8.8.4.4'));
    expect(ok).toMatchObject({
      host: 'parceiro.exemplo',
      enderecos: [
        { address: '8.8.4.4', family: 4 },
        { address: '2001:4860:4860::8888', family: 6 },
      ],
    });
  });
});

describe('o envio ao destino conferido', () => {
  let servidores: http.Server[] = [];
  afterEach(async () => {
    for (const s of servidores) {
      s.closeAllConnections();
      await new Promise<void>((r) => s.close(() => r()));
    }
    servidores = [];
  });
  async function servidor(responder: (req: http.IncomingMessage, res: http.ServerResponse, corpo: string) => void): Promise<number> {
    const s = http.createServer((req, res) => {
      const partes: Buffer[] = [];
      req.on('data', (b: Buffer) => partes.push(b));
      req.on('end', () => responder(req, res, Buffer.concat(partes).toString('utf8')));
    });
    servidores.push(s);
    await new Promise<void>((r) => s.listen(0, '127.0.0.1', () => r()));
    return (s.address() as AddressInfo).port;
  }
  // o nome não existe no sistema: só chega lá quem conecta no IP conferido
  const NOME = 'parceiro-que-nao-existe.exemplo';
  const opcoes = (porta: number, extra: Partial<OpcoesDoEnvio> = {}): OpcoesDoEnvio => ({
    resolver: publico('127.0.0.1'),
    ehInterno: () => false,
    requisitar: emHttp,
    porta,
    ...extra,
  });

  it('conecta no IP conferido, com o nome no Host, e manda os cabeçalhos e o corpo como estão; o IPv6 que não responde não atrapalha', async () => {
    let visto: { host?: string; assinatura?: string; corpo?: string; metodo?: string; caminho?: string } = {};
    const porta = await servidor((req, res, corpo) => {
      visto = { host: req.headers.host, assinatura: String(req.headers['webhook-signature']), corpo, metodo: req.method, caminho: req.url };
      res.writeHead(204).end();
    });
    const r = await enviarComSeguranca(
      `https://${NOME}/avisos/lig-1`,
      { 'content-type': 'application/json', 'webhook-signature': 'v1,abc' },
      '{"tipo":"pedido.alterado"}',
      opcoes(porta),
    );
    expect(r).toMatchObject({ status: 204, erro: null });
    expect(visto).toMatchObject({ metodo: 'POST', caminho: '/avisos/lig-1', assinatura: 'v1,abc', corpo: '{"tipo":"pedido.alterado"}' });
    expect(visto.host?.startsWith(NOME)).toBe(true);
    // o AAAA na frente, sem rota (documentação), e o A local: chega pelo IPv4
    const dois = await enviarComSeguranca(
      `https://${NOME}/avisos/lig-1`,
      {},
      '{}',
      opcoes(porta, {
        resolver: async () => [
          { address: '2001:db8::5', family: 6 },
          { address: '127.0.0.1', family: 4 },
        ],
      }),
    );
    expect(dois.status).toBe(204);
  });

  it('por TLS de verdade, conectando pelo IP: o certificado se confere pelo NOME (o SNI vai com ele); de outro nome ou sem confiança, recusa', async () => {
    const { cert, chave } = certificadoDeTeste(['parceiro.exemplo']);
    expect(new X509Certificate(cert).subjectAltName).toBe('DNS:parceiro.exemplo');
    let sni: string | false | null | undefined;
    const s = https.createServer({ key: chave, cert }, (req, res) => {
      sni = (req.socket as TLSSocket).servername;
      req.resume();
      req.on('end', () => res.writeHead(204).end());
    });
    servidores.push(s);
    await new Promise<void>((r) => s.listen(0, '127.0.0.1', () => r()));
    const porta = (s.address() as AddressInfo).port;
    const tls = (extra: Partial<OpcoesDoEnvio> = {}): OpcoesDoEnvio => ({ resolver: publico('127.0.0.1'), ehInterno: () => false, porta, ca: cert, ...extra });
    const certo = await enviarComSeguranca('https://parceiro.exemplo/avisos/lig-1', {}, '{}', tls());
    expect([certo.status, certo.erro]).toEqual([204, null]);
    expect(sni).toBe('parceiro.exemplo');
    // o mesmo IP, outro nome: o certificado não é dele
    const outroNome = await enviarComSeguranca('https://outro.exemplo/avisos/lig-1', {}, '{}', tls());
    expect([outroNome.status, outroNome.erro]).toEqual([null, 'falha de conexão (ERR_TLS_CERT_ALTNAME_INVALID)']);
    // sem a confiança no certificado de teste: o autoassinado é recusado
    const semConfianca = await enviarComSeguranca('https://parceiro.exemplo/avisos/lig-1', {}, '{}', tls({ ca: undefined }));
    expect(semConfianca.status).toBeNull();
    expect(semConfianca.erro).toMatch(/^falha de conexão \((DEPTH_ZERO_SELF_SIGNED_CERT|SELF_SIGNED_CERT_IN_CHAIN|UNABLE_TO_VERIFY_LEAF_SIGNATURE)\)$/);
  });

  it('o redirecionamento não se segue: o 302 é a resposta, e o outro endereço nunca é chamado', async () => {
    let outroChamado = false;
    const outra = await servidor((_q, res) => {
      outroChamado = true;
      res.writeHead(200).end();
    });
    const porta = await servidor((_q, res) => res.writeHead(302, { location: `http://127.0.0.1:${outra}/roubado` }).end());
    const r = await enviarComSeguranca(`https://${NOME}/avisos/lig-1`, {}, '{}', opcoes(porta));
    expect(r.status).toBe(302);
    expect(outroChamado).toBe(false);
  });

  it('o destino que não responde para no prazo; o que manda resposta grande é lido só até o teto; a conexão recusada vira motivo', async () => {
    const parado = await servidor(() => {
      // nunca responde
    });
    const lento = await enviarComSeguranca(`https://${NOME}/x`, {}, '{}', opcoes(parado, { prazoMs: 300 }));
    expect(lento).toMatchObject({ status: null, erro: 'o destino não respondeu em 300 ms' });
    expect(lento.duracaoMs).toBeGreaterThanOrEqual(250);

    const grande = await servidor((_q, res) => res.writeHead(200, { 'content-type': 'text/plain' }).end('x'.repeat(TETO_DA_RESPOSTA * 6)));
    const r = await enviarComSeguranca(`https://${NOME}/x`, {}, '{}', opcoes(grande));
    expect(r.status).toBe(200);
    expect(r.texto.length).toBe(TETO_DA_RESPOSTA);

    // a resposta sem fim (nunca termina): o teto encerra a leitura, com o status que chegou, antes do prazo
    const semFim = await servidor((_q, res) => {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.write('x'.repeat(TETO_DA_RESPOSTA * 2));
    });
    const inicio = Date.now();
    const r2 = await enviarComSeguranca(`https://${NOME}/x`, {}, '{}', opcoes(semFim, { prazoMs: 3000 }));
    expect([r2.status, r2.erro]).toEqual([200, null]);
    expect(Date.now() - inicio).toBeLessThan(2000);

    const fechada = await servidor(() => undefined);
    const s = servidores.pop() as http.Server;
    await new Promise<void>((x) => s.close(() => x()));
    const recusada = await enviarComSeguranca(`https://${NOME}/x`, {}, '{}', opcoes(fechada));
    expect(recusada.status).toBeNull();
    expect(recusada.erro).toMatch(/^falha de conexão/);
  });

  it('o endereço recusado não abre conexão nenhuma; o destino conferido vai ao IP dele, não ao que o nome resolveria depois', async () => {
    let chamado = false;
    const porta = await servidor((_q, res) => {
      chamado = true;
      res.writeHead(200).end();
    });
    const r = await enviarComSeguranca('https://hub.dmstecnologias.com/x', {}, '{}', opcoes(porta));
    expect(r).toMatchObject({ status: null, erro: 'o Regem não manda aviso de parceiro para endereço da DMS' });
    const interno = await enviarComSeguranca(`https://${NOME}/x`, {}, '{}', opcoes(porta, { ehInterno: () => true }));
    expect(interno.erro).toBe('o nome do endereço aponta para uma rede interna');
    expect(chamado).toBe(false);
    const destino = await conferirDestino(`https://${NOME}/x`, opcoes(porta));
    if ('motivo' in destino) throw new Error(destino.motivo);
    const depois = await enviarAoDestino(destino, {}, '{}', { requisitar: emHttp, porta, resolver: async () => [{ address: '10.9.9.9', family: 4 }] });
    expect(depois.status).toBe(200);
  });

  it('o teto de envios ao mesmo tempo: com uma vaga, o segundo espera o primeiro terminar', async () => {
    let aoMesmoTempo = 0;
    let maximo = 0;
    const porta = await servidor((_q, res) => {
      aoMesmoTempo += 1;
      maximo = Math.max(maximo, aoMesmoTempo);
      setTimeout(() => {
        aoMesmoTempo -= 1;
        res.writeHead(204).end();
      }, 150);
    });
    const vagas = new Vagas(1);
    const inicio = Date.now();
    const [a, b] = await Promise.all([1, 2].map(() => enviarComSeguranca(`https://${NOME}/x`, {}, '{}', opcoes(porta, { vagas }))));
    expect([a?.status, b?.status]).toEqual([204, 204]);
    expect(maximo).toBe(1);
    expect(Date.now() - inicio).toBeGreaterThanOrEqual(290);
  });

  it('o resolvedor padrão (c-ares) tem prazo: o nome que não existe volta como motivo, sem rejeitar', async () => {
    const r = await enviarComSeguranca('https://nome-que-nao-existe-regem.invalid/x', {}, '{}', { prazoMs: 2000 });
    expect(r.status).toBeNull();
    expect(['o nome do endereço não resolve', 'o nome do endereço não resolveu a tempo']).toContain(r.erro);
  });
});
