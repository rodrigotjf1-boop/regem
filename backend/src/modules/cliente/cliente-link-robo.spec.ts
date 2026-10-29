import { UnauthorizedException } from '@nestjs/common';
import { ClienteService } from './cliente.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

// ERR-316: o link curto do cliente vale uma SESSÃO (slug → clienteToken → endereços, histórico,
// código de entrega). A rota que cria o link era pública: quem tinha o token do cardápio — que está
// na URL e no QR — e um telefone recebia o slug e lia os dados da pessoa. Agora só o robô, com a
// senha dele, pede o link (e o manda ao próprio número do cliente pelo WhatsApp).
describe('link do cliente: só o robô pede', () => {
  const antes = process.env.BOT_RESOLVER_SECRET;
  let consultas = 0;
  // Banco que conta qualquer acesso: a recusa tem de vir ANTES de tocar no banco.
  const db: any = new Proxy(
    {},
    {
      get: () => () => {
        consultas += 1;
        throw new Error('o banco não devia ser consultado');
      },
    },
  );
  const svc = new ClienteService(db, {} as any, { registrar: async () => {} } as any);

  beforeEach(() => {
    consultas = 0;
    process.env.BOT_RESOLVER_SECRET = 'senha-do-robo';
  });
  afterAll(() => {
    if (antes === undefined) delete process.env.BOT_RESOLVER_SECRET;
    else process.env.BOT_RESOLVER_SECRET = antes;
  });

  it('sem a senha do robô: recusa, sem consultar o banco', async () => {
    await expect(svc.criarLink('token-publico', { telefone: '21999998888' }, '')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(consultas).toBe(0);
  });

  it('com a senha errada: recusa', async () => {
    await expect(
      svc.criarLink('token-publico', { telefone: '21999998888' }, 'chute'),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(consultas).toBe(0);
  });

  it('sem BOT_RESOLVER_SECRET configurado: recusa até a senha vazia', async () => {
    delete process.env.BOT_RESOLVER_SECRET;
    await expect(svc.criarLink('token-publico', { telefone: '21999998888' }, '')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });
});
