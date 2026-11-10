import { definirPorteiroDaPausa, entregarComPorteiro } from './juntar-mensagens';

/* eslint-disable @typescript-eslint/no-explicit-any */

// O PORTEIRO DA PAUSA na entrega ao robô (F3, mig 395): "respondido" = o Regem já respondeu (a mensagem pronta da pausa) e
// a mensagem NÃO vai ao robô; "segue" ou falha do porteiro = vai ao robô (nunca segura a mensagem por erro); sem porteiro
// (testes, servidor da loja), vai direto.
describe('o porteiro da pausa na entrega ao robô', () => {
  afterEach(() => definirPorteiroDaPausa(null));

  it('sem porteiro, entrega', async () => {
    const entregar = jest.fn(async () => true);
    await entregarComPorteiro({ de: '1' }, entregar);
    expect(entregar).toHaveBeenCalledWith({ de: '1' });
  });

  it('"respondido" não entrega; "segue" entrega', async () => {
    const entregar = jest.fn(async () => true);
    definirPorteiroDaPausa(async (m: any) => (m.de === 'avisado' ? 'respondido' : 'segue'));
    await expect(entregarComPorteiro({ de: 'avisado' }, entregar)).resolves.toBe(true);
    expect(entregar).not.toHaveBeenCalled();
    await entregarComPorteiro({ de: 'outro' }, entregar);
    expect(entregar).toHaveBeenCalledWith({ de: 'outro' });
  });

  it('o porteiro que falha não segura a mensagem: entrega ao robô', async () => {
    const entregar = jest.fn(async () => true);
    definirPorteiroDaPausa(async () => {
      throw new Error('banco fora');
    });
    await entregarComPorteiro({ de: '1' }, entregar);
    expect(entregar).toHaveBeenCalledTimes(1);
  });
});
