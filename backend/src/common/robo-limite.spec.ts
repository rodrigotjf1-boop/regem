import { baldeDoRobo } from './robo-limite';

/* eslint-disable @typescript-eslint/no-explicit-any */

// O robô (n8n) chama de UM IP para todas as lojas: com a senha dele, o limite passa a ser por LOJA (30/10/2026).
describe('limite do robô por loja (baldeDoRobo)', () => {
  const antes = process.env.BOT_RESOLVER_SECRET;
  beforeAll(() => {
    process.env.BOT_RESOLVER_SECRET = 'senha-certa';
  });
  afterAll(() => {
    if (antes === undefined) delete process.env.BOT_RESOLVER_SECRET;
    else process.env.BOT_RESOLVER_SECRET = antes;
  });
  const req = (url: string, extra: any = {}) => ({ originalUrl: url, headers: {}, query: {}, body: {}, ...extra });
  const comSenha = { 'x-regem-robo-segredo': 'senha-certa' };

  it('chamado e link do cliente: a loja é o token do cardápio na URL', () => {
    expect(baldeDoRobo(req('/api/v1/publico/cardapio/abc123/atendimento', { headers: comSenha }))).toBe('robo:abc123');
    expect(baldeDoRobo(req('/api/v1/publico/cardapio/abc123/cliente/link', { headers: comSenha }))).toBe('robo:abc123');
  });

  it('consultas e resposta do robô: a loja é o phoneNumberId ou a instância', () => {
    expect(baldeDoRobo(req('/api/v1/publico/bot/loja?phoneNumberId=1000000000000001', { headers: comSenha, query: { phoneNumberId: '1000000000000001' } }))).toBe(
      'robo:1000000000000001',
    );
    expect(baldeDoRobo(req('/api/v1/publico/bot/responder', { headers: comSenha, body: { instancia: 'Mister.ia' } }))).toBe('robo:Mister.ia');
  });

  it('a senha também vale no corpo ou na consulta (fluxos antigos)', () => {
    expect(baldeDoRobo(req('/api/v1/publico/cardapio/abc123/atendimento', { body: { secret: 'senha-certa' } }))).toBe('robo:abc123');
    expect(baldeDoRobo(req('/api/v1/publico/bot/pedidos?secret=senha-certa&instancia=x', { query: { secret: 'senha-certa', instancia: 'x' } }))).toBe('robo:x');
  });

  it('sem a senha, com a senha errada ou sem dizer a loja: continua no limite por IP', () => {
    expect(baldeDoRobo(req('/api/v1/publico/cardapio/abc123/atendimento'))).toBeNull();
    expect(baldeDoRobo(req('/api/v1/publico/cardapio/abc123/atendimento', { headers: { 'x-regem-robo-segredo': 'chute' } }))).toBeNull();
    expect(baldeDoRobo(req('/api/v1/publico/bot/loja', { headers: comSenha }))).toBeNull();
  });

  it('as outras rotas do cardápio público (o pedido do cliente, o menu) não mudam', () => {
    expect(baldeDoRobo(req('/api/v1/publico/cardapio/abc123', { headers: comSenha }))).toBeNull();
    expect(baldeDoRobo(req('/api/v1/publico/cardapio/abc123/pedido', { headers: comSenha }))).toBeNull();
    expect(baldeDoRobo(req('/api/v1/cardapio/config', { headers: comSenha }))).toBeNull();
  });

  it('sem senha configurada no servidor, ninguém sai do limite por IP', () => {
    delete process.env.BOT_RESOLVER_SECRET;
    expect(baldeDoRobo(req('/api/v1/publico/cardapio/abc123/atendimento', { headers: { 'x-regem-robo-segredo': '' } }))).toBeNull();
    process.env.BOT_RESOLVER_SECRET = 'senha-certa';
  });
});
