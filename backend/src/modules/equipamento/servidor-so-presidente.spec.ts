import { ForbiddenException } from '@nestjs/common';
import { EquipamentoController } from './equipamento.controller';

/* eslint-disable @typescript-eslint/no-explicit-any */

// O token do servidor da loja lê e grava a empresa inteira (hashes de senha e PIN, financeiro, todas as lojas). Pela tela, só o
// presidente o cria: o gerente e a sessão de suporte recebiam esse token ao cadastrar um "servidor local" (auditoria de 22/11, S3-03).
describe('cadastrar servidor da loja pela tela', () => {
  const montar = () => {
    const criar = jest.fn(async () => ({ id: 'novo', token: 'token-de-teste' }));
    return { criar, controller: new EquipamentoController({ criar } as any) };
  };
  const quem = (categoria: string) => ({ tenantId: 't1', colaboradorId: 'c1', categoria }) as any;

  it.each(['gerente', 'suporte', 'supervisao', 'execucao'])('%s recebe 403 e nada é criado', (categoria) => {
    const { controller, criar } = montar();
    expect(() => controller.criar(quem(categoria), { tipo: 'servidor_local', nome: 'Teste' } as any)).toThrow(ForbiddenException);
    expect(criar).not.toHaveBeenCalled();
  });

  it('o presidente cadastra', async () => {
    const { controller, criar } = montar();
    await expect(controller.criar(quem('presidente'), { tipo: 'servidor_local', nome: 'Servidor' } as any)).resolves.toMatchObject({ id: 'novo' });
    expect(criar).toHaveBeenCalledTimes(1);
  });

  it('os outros equipamentos seguem com o gerente', async () => {
    const { controller, criar } = montar();
    await controller.criar(quem('gerente'), { tipo: 'kds', nome: 'KDS' } as any);
    expect(criar).toHaveBeenCalledTimes(1);
  });
});
