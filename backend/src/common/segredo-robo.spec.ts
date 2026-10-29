import { CABECALHO_SEGREDO_ROBO, segredoDaChamada, segredoDoRoboOk } from './segredo-robo';
import { urlParaLog } from './url-para-log';

// A senha do robô (n8n) vale para TODAS as lojas: não pode passar sem configuração, e não pode ficar
// gravada no log quando ainda vier na URL (ERR-318).
describe('senha do robô', () => {
  const antes = process.env.BOT_RESOLVER_SECRET;
  afterEach(() => {
    if (antes === undefined) delete process.env.BOT_RESOLVER_SECRET;
    else process.env.BOT_RESOLVER_SECRET = antes;
  });

  it('sem BOT_RESOLVER_SECRET configurado, nada passa — nem a senha vazia', () => {
    delete process.env.BOT_RESOLVER_SECRET;
    expect(segredoDoRoboOk('')).toBe(false);
    expect(segredoDoRoboOk(undefined)).toBe(false);
    expect(segredoDoRoboOk('qualquer')).toBe(false);
  });

  it('passa só a senha exata', () => {
    process.env.BOT_RESOLVER_SECRET = 'senha-do-robo';
    expect(segredoDoRoboOk('senha-do-robo')).toBe(true);
    expect(segredoDoRoboOk('senha-do-rob')).toBe(false);
    expect(segredoDoRoboOk('senha-do-robo ')).toBe(false);
    expect(segredoDoRoboOk(null)).toBe(false);
  });

  it('o cabeçalho vence a senha da URL/corpo; esta só vale quando o cabeçalho não veio', () => {
    expect(CABECALHO_SEGREDO_ROBO).toBe('x-regem-robo-segredo');
    expect(segredoDaChamada('do-cabecalho', 'da-url')).toBe('do-cabecalho');
    expect(segredoDaChamada(undefined, 'da-url')).toBe('da-url');
    expect(segredoDaChamada('   ', 'da-url')).toBe('da-url');
    expect(segredoDaChamada(undefined, undefined)).toBe('');
  });
});

describe('endereço no log', () => {
  it('tira a senha do robô e as credenciais do cliente; encurta o telefone', () => {
    const url =
      '/api/v1/publico/bot/pedidos?instancia=loja-1&secret=SENHA-REAL&telefone=5521999998888&clienteToken=abc.def';
    const log = urlParaLog(url);
    expect(log).not.toContain('SENHA-REAL');
    expect(log).not.toContain('abc.def');
    expect(log).not.toContain('5521999998888');
    expect(log).toBe(
      '/api/v1/publico/bot/pedidos?instancia=loja-1&secret=***&telefone=***8888&clienteToken=***',
    );
  });

  it('não mexe em endereço sem parâmetros nem nos parâmetros comuns', () => {
    expect(urlParaLog('/api/v1/publico/cardapio/abc123')).toBe('/api/v1/publico/cardapio/abc123');
    expect(urlParaLog('/api/v1/x?pagina=2&busca=pizza')).toBe('/api/v1/x?pagina=2&busca=pizza');
    expect(urlParaLog(undefined)).toBe('');
  });

  it('pega o nome do parâmetro em maiúsculas ou codificado', () => {
    expect(urlParaLog('/x?SECRET=a1&%73ecret=b2')).toBe('/x?SECRET=***&%73ecret=***');
  });
});
