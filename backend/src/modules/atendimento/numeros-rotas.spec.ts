import { GUARDS_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../../auth/roles.decorator';
import { RolesGuard } from '../../auth/roles.guard';
import { CLOUD_ONLY } from '../../common/cloud-only.decorator';
import { SyncTokenGuard } from '../sync/sync-token.guard';
import { AtendimentoController } from './atendimento.controller';
import { AtendimentoLojaController } from './atendimento-loja.controller';

/* eslint-disable @typescript-eslint/no-explicit-any */

// AS ROTAS DOS NÚMEROS DO ATENDIMENTO (item 8): os números (têm valor em R$) são só de gerente e presidente — supervisão e
// execução recebem 403 da guarda, não só o menu escondido; o "O que aconteceu?" é de quem resolve o caso (os quatro). As
// duas valem nas duas pontas (no servidor da loja o serviço pede à nuvem — V37), e as rotas "da loja" são só da nuvem e
// só com o token do servidor.
describe('as rotas dos Números do atendimento', () => {
  const rota = (nome: string) => (AtendimentoController.prototype as any)[nome];
  const daLoja = (nome: string) => (AtendimentoLojaController.prototype as any)[nome];
  const guarda = new RolesGuard(new Reflector());
  const pede = (nome: string, categoria: string) =>
    guarda.canActivate({
      getHandler: () => rota(nome),
      getClass: () => AtendimentoController,
      switchToHttp: () => ({ getRequest: () => ({ user: { categoria } }) }),
    } as any);

  it('os números: só gerente e presidente; supervisão e execução recebem 403', () => {
    for (const nome of ['numerosDoAtendimento', 'casosDoNumero']) {
      expect(Reflect.getMetadata(ROLES_KEY, rota(nome))).toEqual(['presidente', 'gerente']);
      expect(pede(nome, 'presidente')).toBe(true);
      expect(pede(nome, 'gerente')).toBe(true);
      expect(() => pede(nome, 'supervisao')).toThrow('Permissão insuficiente');
      expect(() => pede(nome, 'execucao')).toThrow('Permissão insuficiente');
    }
  });

  it('"O que aconteceu?": os quatro perfis, como o Resolver', () => {
    for (const nome of ['oQueAconteceu', 'marcarOQueAconteceu'])
      expect(Reflect.getMetadata(ROLES_KEY, rota(nome))).toEqual(Reflect.getMetadata(ROLES_KEY, rota('resolver')));
    expect(pede('marcarOQueAconteceu', 'execucao')).toBe(true);
  });

  it('valem nas duas pontas; as "da loja" são só da nuvem e pelo token do servidor', () => {
    for (const nome of ['numerosDoAtendimento', 'casosDoNumero', 'oQueAconteceu', 'marcarOQueAconteceu'])
      expect(Reflect.getMetadata(CLOUD_ONLY, rota(nome))).toBeUndefined();
    for (const nome of ['numerosDaLoja', 'casosDaLoja']) {
      expect(Reflect.getMetadata(CLOUD_ONLY, daLoja(nome))).toBe(true);
      expect(Reflect.getMetadata(GUARDS_METADATA, daLoja(nome))).toEqual([SyncTokenGuard]);
    }
  });

  it('a rota da loja passa a loja pedida (id válido) ou nenhuma, e a empresa vem do token', async () => {
    const chamadas: any[] = [];
    const ctrl = new AtendimentoLojaController({} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {
      numeros: async (...a: any[]) => (chamadas.push(['numeros', ...a]), { ok: 1 }),
      casos: async (...a: any[]) => (chamadas.push(['casos', ...a]), { ok: 2 }),
    } as any, {} as any);
    const U = '11111111-2222-4333-8444-555555555555';
    await ctrl.numerosDaLoja({ tenantId: 'T1' } as any, { periodo: 'mes', unidade: U });
    await ctrl.numerosDaLoja({ tenantId: 'T1' } as any, { periodo: '7', unidade: "x' or 1=1" });
    await ctrl.casosDaLoja({ tenantId: 'T1' } as any, { periodo: '30', motivo: 'atraso' });
    expect(chamadas).toEqual([
      ['numeros', 'T1', U, 'mes'],
      ['numeros', 'T1', null, '7'],
      ['casos', 'T1', null, { periodo: '30', motivo: 'atraso' }],
    ]);
  });
});
