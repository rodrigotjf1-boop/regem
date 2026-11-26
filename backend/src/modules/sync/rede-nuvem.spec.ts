import { readFileSync } from 'node:fs';
import { createServer, Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { join } from 'node:path';

/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-require-imports */

// A CONEXÃO DO SERVIDOR DA LOJA COM A NUVEM (edge/rede-regras.mjs, 1.30.16 — análise de rede de 25–26/11/2026). Na loja,
// 35–50% das conexões novas ficavam sem resposta e o undici guardava a conexão só 4 s, com 10 s para abrir outra: quase
// toda chamada do ciclo pagava (e às vezes perdia) uma abertura. O arquivo é ESM puro sem import: avaliado como texto —
// é exatamente o código que o daemon usa.
const EDGE = join(__dirname, '..', '..', '..', 'edge');
function carregar(): Record<string, any> {
  const fonte = readFileSync(join(EDGE, 'rede-regras.mjs'), 'utf8');
  const nomes = [...fonte.matchAll(/^export (?:const|async function|function) (\w+)/gm)].map((m) => m[1]);
  const corpo = fonte.replace(/^export (const|async function|function) /gm, '$1 ') + `\nreturn { ${nomes.join(', ')} };`;
  return new Function(corpo)();
}
const r = carregar();

// Como o `causaErro` do daemon escreve a falha (código + mensagem, com as causas aninhadas do undici).
const ABERTURA = 'fetch failed <- UND_ERR_CONNECT_TIMEOUT Connect Timeout Error (attempted address: api.exemplo.test:443, timeout: 10000ms)';
const TEMPO_DA_CHAMADA = 'This operation was aborted <- TimeoutError The operation was aborted due to timeout';

describe('a conexão com a nuvem (edge/rede-regras.mjs)', () => {
  it('padrão: conexão aberta 60 s sem uso e 3 s para abrir; as variáveis mudam dentro dos limites', () => {
    expect(r.opcoesDoAgente({})).toEqual({ keepAliveTimeout: 60000, keepAliveMaxTimeout: 60000, connect: { timeout: 3000 } });
    expect(r.opcoesDoAgente({ SYNC_KEEPALIVE_MS: '30000', SYNC_CONEXAO_MS: '5000' })).toEqual({
      keepAliveTimeout: 30000, keepAliveMaxTimeout: 30000, connect: { timeout: 5000 },
    });
    // fora dos limites: keep-alive até 90 s (abaixo do ocioso da Cloudflare), abertura entre 1 e 30 s; lixo = padrão
    expect(r.opcoesDoAgente({ SYNC_KEEPALIVE_MS: '900000', SYNC_CONEXAO_MS: '10' })).toEqual({
      keepAliveTimeout: 90000, keepAliveMaxTimeout: 90000, connect: { timeout: 1000 },
    });
    expect(r.opcoesDoAgente({ SYNC_KEEPALIVE_MS: 'abc', SYNC_CONEXAO_MS: '-3' }).connect.timeout).toBe(3000);
  });

  it('falha de ABERTURA (o pedido nem saiu) tenta de novo na hora; o resto mantém a pausa de 0,6 s × n', () => {
    for (const c of [ABERTURA, 'fetch failed <- ECONNREFUSED connect ECONNREFUSED 104.21.0.1:443', 'getaddrinfo EAI_AGAIN api.exemplo.test', 'ENETUNREACH']) {
      expect([c, r.ehFalhaDeAbertura(c), r.pausaAntesDeTentarDeNovo(c, 2)]).toEqual([c, true, 0]);
    }
    // a chamada que passou do tempo (já saiu) e a conexão derrubada no meio NÃO são abertura
    for (const c of [TEMPO_DA_CHAMADA, 'fetch failed <- ECONNRESET read ECONNRESET', 'other side closed', '']) {
      expect([c, r.ehFalhaDeAbertura(c)]).toEqual([c, false]);
    }
    expect(r.pausaAntesDeTentarDeNovo('ECONNRESET', 1)).toBe(600);
    expect(r.pausaAntesDeTentarDeNovo('ECONNRESET', 2)).toBe(1200);
  });

  it('o daemon usa UM agente para todas as chamadas, que CONTA as aberturas e as falhas; nenhum fetch solto', () => {
    const daemon = readFileSync(join(EDGE, 'sync-daemon.mjs'), 'utf8').replace(/\/\/.*$/gm, '');
    expect(daemon).toMatch(/const OPCOES_NUVEM = opcoesDoAgente\(process\.env\);/);
    expect(daemon).toMatch(/const conectarNaNuvem = conectorDoUndici\(OPCOES_NUVEM\.connect\);/);
    expect(daemon).toMatch(/contagemNuvem\.aberturas \+= 1;\s*conectarNaNuvem\(opcoes, \(erro, socket\) => \{\s*if \(erro\) contagemNuvem\.falhas \+= 1;/);
    expect(daemon).toMatch(/contagemNuvem\.novasTentativas \+= 1;/);
    expect(daemon).toMatch(/fetchDoUndici\(url, \{ \.\.\.opts, dispatcher: AGENTE_NUVEM, signal: AbortSignal\.timeout\(ms\) \}\)/);
    expect(daemon).toMatch(/saude\.conexoesNuvem = resumoDaJanela\(historicoNuvem, agora\);/);
    expect(daemon.match(/(?<![\w.$])fetch\(/g) ?? []).toEqual([]);
  });

  it('a janela de 30 min: soma as batidas dentro dela; a rede ruim (25/11) e a sã; sem batida, null', () => {
    const agora = 10 * 60 * 60 * 1000;
    const min = (m: number) => agora - m * 60_000;
    const ruim = [
      { em: min(40), aberturas: 99, falhas: 99, novasTentativas: 99 }, // fora da janela
      { em: min(25), aberturas: 20, falhas: 9, novasTentativas: 12 },
      { em: min(10), aberturas: 15, falhas: 6, novasTentativas: 8 },
      { em: min(1), aberturas: 5, falhas: 2, novasTentativas: 3 },
    ];
    expect(r.resumoDaJanela(ruim, agora)).toEqual({ aberturas: 40, falhas: 17, falhasPct: 42.5, novasTentativas: 23, janelaMin: 25 });
    expect(r.resumoDaJanela([{ em: min(5), aberturas: 3, falhas: 0, novasTentativas: 0 }], agora)).toMatchObject({ falhasPct: 0 });
    expect(r.resumoDaJanela([{ em: min(5), aberturas: 0, falhas: 0, novasTentativas: 0 }], agora)).toMatchObject({ aberturas: 0, falhasPct: 0 });
    expect(r.resumoDaJanela([], agora)).toBeNull();
    expect(r.resumoDaJanela([{ em: min(31), aberturas: 9, falhas: 9 }], agora)).toBeNull();
  });
});

describe('a conexão aberta de verdade (undici contra um servidor HTTP local)', () => {
  jest.setTimeout(30000);
  const { Agent, fetch: fetchDoUndici } = require('undici');
  let servidor: Server;
  let conexoes = 0;
  let base = '';
  beforeAll(async () => {
    servidor = createServer((_req, res) => res.end('ok'));
    // 0 = o servidor não fecha a conexão ociosa e NÃO manda a dica `Keep-Alive: timeout=…` (a nuvem não manda: o que se
    // mediu na loja foi o padrão de 4 s do undici) — quem decide quanto tempo a conexão fica aberta é o cliente.
    servidor.keepAliveTimeout = 0;
    servidor.on('connection', () => (conexoes += 1));
    await new Promise<void>((ok) => servidor.listen(0, '127.0.0.1', () => ok()));
    base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}/`;
  });
  afterAll(async () => {
    servidor.closeAllConnections();
    await new Promise((ok) => servidor.close(ok));
  });

  async function duasChamadasComIntervalo(agente: any): Promise<number> {
    conexoes = 0;
    await (await fetchDoUndici(base, { dispatcher: agente })).text();
    await new Promise((ok) => setTimeout(ok, 4600)); // mais que os 4 s do padrão antigo
    await (await fetchDoUndici(base, { dispatcher: agente })).text();
    await agente.close();
    return conexoes;
  }

  it('com 4,6 s entre as chamadas: o padrão antigo abre 2 conexões; o agente novo reaproveita a mesma', async () => {
    expect(await duasChamadasComIntervalo(new Agent())).toBe(2);
    expect(await duasChamadasComIntervalo(new Agent(r.opcoesDoAgente({})))).toBe(1);
  });

  it('o conector que conta (como o do daemon): a conexão mantida conta 1 abertura; a porta fechada conta 1 falha', async () => {
    const { buildConnector } = require('undici');
    const conta = { aberturas: 0, falhas: 0 };
    const opc = r.opcoesDoAgente({});
    const conectar = buildConnector(opc.connect);
    const agente = new Agent({
      ...opc,
      connect: (o: any, pronto: any) => {
        conta.aberturas += 1;
        conectar(o, (erro: any, s: any) => {
          if (erro) conta.falhas += 1;
          pronto(erro, s);
        });
      },
    });
    // um instante entre as duas: a chamada colada na anterior acha o cliente ainda ocupado e o pool abre outra conexão
    // (normal, e contada também) — aqui o que se prova é que a contagem bate com as conexões que o servidor recebeu
    conexoes = 0;
    await (await fetchDoUndici(base, { dispatcher: agente })).text();
    await new Promise((ok) => setTimeout(ok, 200));
    await (await fetchDoUndici(base, { dispatcher: agente })).text();
    expect([conta, conexoes]).toEqual([{ aberturas: 1, falhas: 0 }, 1]);
    // uma porta sem ninguém: a abertura falha (ECONNREFUSED) e conta
    const fechado = createServer();
    await new Promise<void>((ok) => fechado.listen(0, '127.0.0.1', () => ok()));
    const porta = (fechado.address() as AddressInfo).port;
    await new Promise((ok) => fechado.close(ok));
    await expect(fetchDoUndici(`http://127.0.0.1:${porta}/`, { dispatcher: agente })).rejects.toThrow();
    expect(conta).toEqual({ aberturas: 2, falhas: 1 });
    await agente.close();
  });
});
