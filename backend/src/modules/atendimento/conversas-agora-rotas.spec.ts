import { ROLES_KEY } from '../../auth/roles.decorator';
import { CLOUD_ONLY } from '../../common/cloud-only.decorator';
import { AtendimentoController } from './atendimento.controller';

/* eslint-disable @typescript-eslint/no-explicit-any */

// "CONVERSAS AGORA" (ponte do chat): ver as conversas é de quem atende a fila; ASSUMIR é só de quem responde no chat — a
// gestão, como a resposta do caso (`POST :id/chat`). Assumir sem poder responder calaria o robô e deixaria o cliente sem
// ninguém. As duas só na nuvem (as mensagens moram lá).
describe('as rotas das Conversas agora', () => {
  const rota = (nome: string) => (AtendimentoController.prototype as any)[nome];

  it('ver: os quatro perfis da fila; assumir: só a gestão, a mesma de quem responde no chat', () => {
    expect(Reflect.getMetadata(ROLES_KEY, rota('conversasAgora'))).toEqual(['presidente', 'gerente', 'supervisao', 'execucao']);
    expect(Reflect.getMetadata(ROLES_KEY, rota('assumirConversa'))).toEqual(['presidente', 'gerente', 'supervisao']);
    expect(Reflect.getMetadata(ROLES_KEY, rota('assumirConversa'))).toEqual(Reflect.getMetadata(ROLES_KEY, rota('responderNoChat')));
  });

  it('só na nuvem', () => {
    for (const nome of ['conversasAgora', 'assumirConversa']) expect(Reflect.getMetadata(CLOUD_ONLY, rota(nome))).toBe(true);
  });
});
