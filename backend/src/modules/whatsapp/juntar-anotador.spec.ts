import { definirAnotadorDaConfirmacao, entregarJuntando, esquecerPendentes } from './juntar-mensagens';

/* eslint-disable @typescript-eslint/no-explicit-any */

// O ANOTADOR DA CONFIRMAÇÃO na entrega ao robô (mig 431 — o documento do dono de 16/11/2026): CADA mensagem do cliente
// passa por ele antes de ser juntada e antes da IA (o "sim" + "tira a cebola" em duas mensagens: o "sim" é visto sozinho);
// a falha dele nunca segura a mensagem; sem anotador (testes, servidor da loja), nada acontece.
describe('o anotador da confirmação na entrega ao robô', () => {
  const antes = process.env.ROBO_JUNTAR_MS;
  beforeEach(() => {
    process.env.ROBO_JUNTAR_MS = '30';
  });
  afterEach(() => {
    definirAnotadorDaConfirmacao(null);
    esquecerPendentes();
    if (antes === undefined) delete process.env.ROBO_JUNTAR_MS;
    else process.env.ROBO_JUNTAR_MS = antes;
  });
  const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

  it('vê cada mensagem, uma por uma, ANTES de juntar — e a IA recebe as duas juntas', async () => {
    const vistas: string[] = [];
    definirAnotadorDaConfirmacao(async (m: any) => void vistas.push(m.texto));
    const entregar = jest.fn(async () => true);
    await entregarJuntando({ tenantId: 't', de: '5521987654321', tipo: 'text', texto: 'sim', mensagemId: 'a' }, entregar);
    await entregarJuntando({ tenantId: 't', de: '5521987654321', tipo: 'text', texto: 'mas tira a cebola', mensagemId: 'b' }, entregar);
    expect(vistas).toEqual(['sim', 'mas tira a cebola']);
    expect(entregar).not.toHaveBeenCalled(); // ainda juntando
    await esperar(80);
    expect(entregar).toHaveBeenCalledTimes(1);
    expect((entregar.mock.calls[0] as any[])[0].texto).toBe('sim\nmas tira a cebola');
  });

  it('o anotador que falha não segura a mensagem', async () => {
    definirAnotadorDaConfirmacao(async () => {
      throw new Error('banco fora');
    });
    process.env.ROBO_JUNTAR_MS = '0';
    const entregar = jest.fn(async () => true);
    await entregarJuntando({ tenantId: 't', de: '1', tipo: 'text', texto: 'Pode registrar' }, entregar);
    expect(entregar).toHaveBeenCalledTimes(1);
  });

  it('sem anotador, entrega como sempre (mídia vai na hora)', async () => {
    process.env.ROBO_JUNTAR_MS = '0';
    const entregar = jest.fn(async () => true);
    await entregarJuntando({ tenantId: 't', de: '1', tipo: 'audio', texto: '' }, entregar);
    expect(entregar).toHaveBeenCalledTimes(1);
  });
});
