import { GUARDS_METADATA } from '@nestjs/common/constants';
import { ROLES_KEY } from '../../auth/roles.decorator';
import { CLOUD_ONLY } from '../../common/cloud-only.decorator';
import { SyncTokenGuard } from '../sync/sync-token.guard';
import { AtendimentoController } from './atendimento.controller';
import { AtendimentoLojaController } from './atendimento-loja.controller';

/* eslint-disable @typescript-eslint/no-explicit-any */

// "CONVERSAS AGORA" (ponte do chat): ver as conversas é de quem atende a fila; ASSUMIR é só de quem responde no chat — a
// gestão, como a resposta do caso (`POST :id/chat`). Assumir sem poder responder calaria o robô e deixaria o cliente sem
// ninguém. As duas valem nas DUAS pontas: no servidor da loja o serviço pede à nuvem (V37) pelas rotas "da loja", que são
// só da nuvem e só com o token do servidor (a empresa vem do token).
describe('as rotas das Conversas agora', () => {
  const rota = (nome: string) => (AtendimentoController.prototype as any)[nome];
  const daLoja = (nome: string) => (AtendimentoLojaController.prototype as any)[nome];

  it('ver: os quatro perfis da fila; assumir: só a gestão, a mesma de quem responde no chat', () => {
    expect(Reflect.getMetadata(ROLES_KEY, rota('conversasAgora'))).toEqual(['presidente', 'gerente', 'supervisao', 'execucao']);
    expect(Reflect.getMetadata(ROLES_KEY, rota('assumirConversa'))).toEqual(['presidente', 'gerente', 'supervisao']);
    expect(Reflect.getMetadata(ROLES_KEY, rota('assumirConversa'))).toEqual(Reflect.getMetadata(ROLES_KEY, rota('responderNoChat')));
  });

  it('valem nas duas pontas (no servidor da loja o serviço pede à nuvem)', () => {
    for (const nome of ['conversasAgora', 'assumirConversa']) expect(Reflect.getMetadata(CLOUD_ONLY, rota(nome))).toBeUndefined();
  });

  it('a fila do servidor da loja leva a faixa da ponte e o alerta do Pix guardados (sem esperar a nuvem); a da nuvem lê os dois', async () => {
    const situacao = { ligada: true, pontes: 1, canais: {}, ultimaMensagemEm: null };
    const alerta = [{ id: 'a1', pedidoId: 'p1', numero: '57', descricao: '1x Coca lata', valor: 6, situacao: 'aguardando', expiraEm: 'x', texto: 'Segure' }];
    const lidas: string[] = [];
    const ctrl = new AtendimentoController(
      { fila: async () => ({ casos: [], contagens: null }) } as any,
      {} as any,
      {} as any,
      { avisos: async () => ({ disputa: { avisar: true, deNovoMin: 2 } }) } as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      { situacao: async () => (lidas.push('nuvem'), situacao) } as any,
      {
        ponteDaNuvem: (t: string, u: string | null) => (lidas.push(`loja:${t}:${u}`), situacao),
        // O alerta "segure o pedido" do Pix do adicional (mig 373): no servidor da loja, o guardado; na nuvem, a tabela.
        adicionaisDaNuvem: (t: string, u: string | null) => (lidas.push(`pix-loja:${t}:${u}`), alerta),
        adicionaisDaEmpresa: async (t: string, u: string | null) => (lidas.push(`pix-nuvem:${t}:${u}`), alerta),
      } as any,
    );
    const user = { tenantId: 'T1', colaboradorId: 'C1', categoria: 'gerente' } as any;
    const antes = process.env.EDGE_MODE;
    try {
      process.env.EDGE_MODE = 'true';
      const daLoja = await ctrl.fila(user, 'U1');
      expect(daLoja.ponte).toEqual(situacao);
      expect(daLoja.adicionaisPix).toEqual(alerta);
      delete process.env.EDGE_MODE;
      const daNuvem = await ctrl.fila(user, 'U1');
      expect(daNuvem.ponte).toEqual(situacao);
      expect(daNuvem.adicionaisPix).toEqual(alerta);
      expect(lidas).toEqual(['loja:T1:U1', 'pix-loja:T1:U1', 'nuvem', 'pix-nuvem:T1:U1']);
    } finally {
      if (antes === undefined) delete process.env.EDGE_MODE;
      else process.env.EDGE_MODE = antes;
    }
  });

  it('as rotas da loja: só na nuvem e só com o token do servidor', () => {
    for (const nome of ['ponteDaLoja', 'adicionaisPixDaLoja', 'conversasDaLoja', 'assumirDaLoja']) {
      expect(Reflect.getMetadata(CLOUD_ONLY, daLoja(nome))).toBe(true);
      expect(Reflect.getMetadata(GUARDS_METADATA, daLoja(nome))).toContain(SyncTokenGuard);
    }
  });
});
