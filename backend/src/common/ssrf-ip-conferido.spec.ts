import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { buscarUrlPublica, conferirUrlPublica, EnderecoNaoPublico, fetchNoIpConferido, type OpcoesDaConferencia } from './ssrf-guard';

/* eslint-disable @typescript-eslint/no-explicit-any */

// O ENVIO PRESO AO IP CONFERIDO (avaliação de segurança de 16/11/2026, A-05). Conferir o endereço e depois chamar o
// `fetch` deixava uma brecha: o `fetch` resolve o nome de NOVO, e um DNS que muda entre as duas consultas levava a
// conexão a um endereço interno. Aqui a conexão vai ao endereço que foi conferido. O servidor de teste fica em
// 127.0.0.1: o resolvedor e a regra de "é interno" são trocados POR CÓDIGO só nestes testes.

describe('envio preso ao IP conferido (A-05)', () => {
  let servidor: Server;
  let porta: number;
  const pedidos: { metodo: string; url: string; host: string; corpo: string; cabecalhos: IncomingMessage['headers'] }[] = [];
  const soquetes = new Set<any>();

  beforeAll(async () => {
    servidor = createServer((req, res) => {
      const partes: Buffer[] = [];
      req.on('data', (d: Buffer) => partes.push(d));
      req.on('end', () => {
        const bruto = Buffer.concat(partes);
        pedidos.push({ metodo: req.method ?? '', url: req.url ?? '', host: String(req.headers.host), corpo: bruto.toString('utf8'), cabecalhos: req.headers });
        if (req.url === '/redireciona') return void res.writeHead(302, { location: 'http://outro.teste/x' }).end();
        if (req.url === '/vazio') return void res.writeHead(204).end();
        if (req.url === '/dorme') return; // nunca responde
        res.writeHead(req.url === '/erro' ? 500 : 200, { 'content-type': 'application/json', 'x-teste': 'sim' });
        res.end(JSON.stringify({ recebido: bruto.length }));
      });
    });
    servidor.on('connection', (s) => {
      soquetes.add(s);
      s.on('close', () => soquetes.delete(s));
    });
    await new Promise<void>((ok) => servidor.listen(0, '127.0.0.1', ok));
    porta = (servidor.address() as AddressInfo).port;
  });
  afterAll(async () => {
    for (const s of soquetes) s.destroy(); // V71: destruir os soquetes anotados, senão o close espera
    await new Promise((ok) => servidor.close(ok));
  });
  beforeEach(() => {
    pedidos.length = 0;
  });

  /** O "nome público" de teste resolve para o servidor local, e a regra de interno deixa passar só ele. */
  const paraOServidor = (consultas: string[] = []): OpcoesDaConferencia => ({
    resolver: async (host) => {
      consultas.push(host);
      return [{ address: '127.0.0.1', family: 4 }];
    },
    ehInterno: () => false,
  });

  it('manda como o fetch mandava: método, corpo, cabeçalhos, o Host do NOME e o tamanho; a resposta é a de sempre', async () => {
    const consultas: string[] = [];
    const corpo = JSON.stringify({ evento: 'otp', acento: 'ção' });
    const res = await fetchNoIpConferido(
      `http://robo.teste:${porta}/webhook?x=1`,
      { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Regem-Signature': 'abc' }, body: corpo },
      paraOServidor(consultas),
    );
    expect([res.status, res.ok, res.headers.get('x-teste'), res.headers.get('content-type')]).toEqual([200, true, 'sim', 'application/json']);
    expect(await res.json()).toEqual({ recebido: Buffer.byteLength(corpo) });
    expect(pedidos).toHaveLength(1);
    expect(pedidos[0]).toMatchObject({ metodo: 'POST', url: '/webhook?x=1', host: `robo.teste:${porta}`, corpo });
    expect(pedidos[0].cabecalhos).toMatchObject({
      'content-type': 'application/json',
      'x-regem-signature': 'abc',
      'content-length': String(Buffer.byteLength(corpo)),
      accept: '*/*',
    });
    expect(pedidos[0].cabecalhos['transfer-encoding']).toBeUndefined();
    // UMA consulta ao nome: a conexão usou o endereço conferido, sem resolver de novo
    expect(consultas).toEqual(['robo.teste']);
  });

  it('o DNS que muda depois da conferência não leva a conexão a outro lugar', async () => {
    // 1ª consulta: o servidor de teste (conferido). Qualquer consulta depois diria outro endereço — e não pode acontecer.
    let n = 0;
    const o: OpcoesDaConferencia = {
      resolver: async () => (++n === 1 ? [{ address: '127.0.0.1', family: 4 }] : [{ address: '203.0.113.9', family: 4 }]),
      ehInterno: () => false,
    };
    const res = await fetchNoIpConferido(`http://muda.teste:${porta}/ok`, {}, o);
    expect(res.status).toBe(200);
    expect(n).toBe(1);
    expect(pedidos.map((p) => p.host)).toEqual([`muda.teste:${porta}`]);
  });

  it('endereço interno (pela regra de verdade): recusa ANTES de conectar', async () => {
    // sem trocar a regra: o nome resolve para o 127.0.0.1 do servidor de teste, que é interno
    const so = { resolver: async () => [{ address: '127.0.0.1', family: 4 }] };
    await expect(fetchNoIpConferido(`http://interno.teste:${porta}/ok`, {}, so)).rejects.toBeInstanceOf(EnderecoNaoPublico);
    // um endereço bom e um interno juntos: recusa (todos têm de ser públicos)
    const misto = { resolver: async () => [{ address: '93.184.216.34', family: 4 }, { address: '10.0.0.5', family: 4 }] };
    await expect(fetchNoIpConferido(`http://misto.teste:${porta}/ok`, {}, misto)).rejects.toBeInstanceOf(EnderecoNaoPublico);
    for (const u of [`http://127.0.0.1:${porta}/ok`, 'http://169.254.169.254/latest/meta-data', 'http://[::1]/x', 'http://localhost/x', 'ftp://exemplo.com/x', 'nada']) {
      await expect(fetchNoIpConferido(u)).rejects.toBeInstanceOf(EnderecoNaoPublico);
    }
    expect(pedidos).toHaveLength(0);
  });

  it('não segue redirecionamento (o 3xx é a resposta); 204 e 500 chegam como são; o prazo aborta', async () => {
    const r = await fetchNoIpConferido(`http://robo.teste:${porta}/redireciona`, { method: 'POST', body: '{}' }, paraOServidor());
    expect([r.status, r.ok, r.headers.get('location')]).toEqual([302, false, 'http://outro.teste/x']);
    expect(pedidos).toHaveLength(1);
    const vazio = await fetchNoIpConferido(`http://robo.teste:${porta}/vazio`, {}, paraOServidor());
    expect([vazio.status, await vazio.text()]).toEqual([204, '']);
    const erro = await fetchNoIpConferido(`http://robo.teste:${porta}/erro`, {}, paraOServidor());
    expect([erro.status, erro.ok]).toEqual([500, false]);
    await expect(
      fetchNoIpConferido(`http://robo.teste:${porta}/dorme`, { signal: AbortSignal.timeout(300) }, paraOServidor()),
    ).rejects.toMatchObject({ name: expect.stringMatching(/AbortError|TimeoutError/) });
  });

  it('conferirUrlPublica e buscarUrlPublica seguem recusando o que recusavam', async () => {
    expect(await conferirUrlPublica('http://10.1.2.3/x')).toBeNull();
    expect(await conferirUrlPublica('https://8.8.8.8/x')).toMatchObject({ enderecos: [{ address: '8.8.8.8', family: 4 }] });
    expect(await buscarUrlPublica(`http://127.0.0.1:${porta}/ok`)).toBeNull();
    expect(pedidos).toHaveLength(0);
  });
});
