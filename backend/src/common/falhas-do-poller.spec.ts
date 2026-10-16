import { createServer, Server } from 'http';
import { AddressInfo } from 'net';
import { AppError } from './errors/app-error';
import { fetchExterno } from './fetch-externo';
import { ehFalhaDeRede, FalhasDoPoller, POLLER_ERRO_APOS_MS, POLLER_REPETE_ERRO_MS } from './falhas-do-poller';

// ERR-244: o poller do iFood mandava para a telemetria, como ERRO, a volta em que o iFood demorou
// 10 s — e na volta seguinte (30 s depois) estava tudo certo. 6 vezes veio só "Falha de rede ao
// falar com o serviço externo.", sem o porquê. Falha de rede passageira é aviso com o motivo;
// erro só quando a loja fica 5 min sem resposta.

const registro = () => ({ error: jest.fn(), warn: jest.fn(), log: jest.fn() });
const PREFIXO = 'poller iFood loja <loja>';

describe('ehFalhaDeRede — o que passa sozinho na próxima volta', () => {
  it('tempo esgotado e conexão caída (como o fetchExterno lança) são de rede', () => {
    expect(ehFalhaDeRede(AppError.externalTimeout())).toBe(true);
    const caiu = Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' }) });
    expect(ehFalhaDeRede(AppError.external('Falha de rede ao falar com o serviço externo.', caiu))).toBe(true);
    expect(ehFalhaDeRede(Object.assign(new Error('x'), { name: 'TimeoutError' }))).toBe(true);
  });

  it('erro de código, de banco ou recusa do canal não é', () => {
    expect(ehFalhaDeRede(new Error('column "x" does not exist'))).toBe(false);
    expect(ehFalhaDeRede(AppError.external('O canal recusou as credenciais.', new Error('401')))).toBe(false);
    expect(ehFalhaDeRede(new TypeError("Cannot read properties of undefined (reading 'id')"))).toBe(false);
    expect(ehFalhaDeRede(null)).toBe(false);
  });
});

describe('FalhasDoPoller', () => {
  it('a 1ª falha de rede vira AVISO com o motivo, não erro', () => {
    const r = registro();
    new FalhasDoPoller(r).falhou('ig1', PREFIXO, AppError.externalTimeout(), 0);
    expect(r.error).not.toHaveBeenCalled();
    expect(r.warn).toHaveBeenCalledWith(
      `${PREFIXO}: falha passageira (1ª seguida; tenta de novo na próxima volta) — O serviço externo demorou a responder. (tempo esgotado)`,
    );
  });

  it('5 min seguidos sem resposta → ERRO uma vez; continua → aviso; mais 30 min → erro de novo', () => {
    const r = registro();
    const f = new FalhasDoPoller(r);
    const e = AppError.externalTimeout();
    let t = 0;
    for (; t < POLLER_ERRO_APOS_MS; t += 30000) f.falhou('ig1', PREFIXO, e, t);
    expect(r.error).not.toHaveBeenCalled();
    expect(r.warn).toHaveBeenCalledTimes(10);
    f.falhou('ig1', PREFIXO, e, t); // 11ª volta, 5 min depois da 1ª
    expect(r.error).toHaveBeenCalledTimes(1);
    expect(r.error).toHaveBeenCalledWith(`${PREFIXO}: sem resposta há 5 min (11 tentativas seguidas) — O serviço externo demorou a responder. (tempo esgotado)`);
    f.falhou('ig1', PREFIXO, e, t + 30000);
    expect(r.error).toHaveBeenCalledTimes(1);
    f.falhou('ig1', PREFIXO, e, t + POLLER_REPETE_ERRO_MS);
    expect(r.error).toHaveBeenCalledTimes(2);
    expect(r.error.mock.calls[1][0]).toMatch(/sem resposta há 35 min \(13 tentativas seguidas\)/);
  });

  it('voltou a responder → uma linha e a contagem recomeça', () => {
    const r = registro();
    const f = new FalhasDoPoller(r);
    f.funcionou('ig1', PREFIXO, 0);
    expect(r.log).not.toHaveBeenCalled(); // sem falha antes, nada a dizer
    f.falhou('ig1', PREFIXO, AppError.externalTimeout(), 0);
    f.falhou('ig1', PREFIXO, AppError.externalTimeout(), 30000);
    f.funcionou('ig1', PREFIXO, 60000);
    expect(r.log).toHaveBeenCalledWith(`${PREFIXO}: voltou a responder depois de 2 falha(s) seguida(s) em 60 s`);
    f.falhou('ig1', PREFIXO, AppError.externalTimeout(), POLLER_ERRO_APOS_MS * 2);
    expect(r.warn.mock.calls[2][0]).toMatch(/\(1ª seguida;/);
    expect(r.error).not.toHaveBeenCalled();
  });

  it('cada loja conta a sua: uma fora do ar não leva a outra para o erro', () => {
    const r = registro();
    const f = new FalhasDoPoller(r);
    f.falhou('ig1', 'poller iFood loja A', AppError.externalTimeout(), 0);
    f.falhou('ig2', 'poller iFood loja B', AppError.externalTimeout(), POLLER_ERRO_APOS_MS);
    expect(r.error).not.toHaveBeenCalled();
    expect(r.warn.mock.calls[1][0]).toMatch(/^poller iFood loja B: falha passageira \(1ª seguida/);
  });

  it('o que não é de rede continua ERRO na hora, com o stack, como antes', () => {
    const r = registro();
    const f = new FalhasDoPoller(r);
    const e = new Error('column "x" does not exist');
    f.falhou('ig1', PREFIXO, e, 0);
    expect(r.error).toHaveBeenCalledWith(`${PREFIXO}: column "x" does not exist`, e.stack);
    expect(r.warn).not.toHaveBeenCalled();
    f.funcionou('ig1', PREFIXO, 1000);
    expect(r.log).not.toHaveBeenCalled(); // não entrou na contagem de rede
  });
});

describe('FalhasDoPoller com o fetchExterno de verdade', () => {
  let parado: Server;
  let porta = 0;
  beforeAll(async () => {
    // Responde nunca: o fetchExterno esgota o tempo.
    parado = createServer(() => undefined);
    await new Promise<void>((ok) => parado.listen(0, '127.0.0.1', ok));
    porta = (parado.address() as AddressInfo).port;
  });
  afterAll(async () => {
    parado.closeAllConnections?.();
    await new Promise((ok) => parado.close(ok));
  });

  it('servidor que não responde: aviso com "tempo esgotado"', async () => {
    const r = registro();
    const e = await fetchExterno(`http://127.0.0.1:${porta}/events:polling`, {}, 80).catch((x) => x);
    new FalhasDoPoller(r).falhou('ig1', PREFIXO, e, 0);
    expect(r.error).not.toHaveBeenCalled();
    expect(r.warn.mock.calls[0][0]).toMatch(/O serviço externo demorou a responder\. \(tempo esgotado\)$/);
  });

  it('porta fechada: aviso que diz QUAL falha de rede (ECONNREFUSED e o endereço)', async () => {
    const fechado = createServer();
    await new Promise<void>((ok) => fechado.listen(0, '127.0.0.1', ok));
    const p = (fechado.address() as AddressInfo).port;
    await new Promise((ok) => fechado.close(ok));
    const r = registro();
    const e = await fetchExterno(`http://127.0.0.1:${p}/events:polling`, {}, 2000).catch((x) => x);
    new FalhasDoPoller(r).falhou('ig1', PREFIXO, e, 0);
    expect(r.error).not.toHaveBeenCalled();
    expect(r.warn.mock.calls[0][0]).toContain(`Falha de rede ao falar com o serviço externo. (ECONNREFUSED 127.0.0.1:${p})`);
  });
});
