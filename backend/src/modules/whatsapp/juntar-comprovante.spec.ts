import { definirPorteiroDoComprovante, entregarJuntando, esquecerPendentes } from './juntar-mensagens';

/* eslint-disable @typescript-eslint/no-explicit-any */

// O PORTEIRO DO COMPROVANTE na entrega ao robô (16/11/2026 — pedido do dono): a foto ou o documento passa por ele antes do
// robô, com o texto que esperava para juntar; 'respondido' = o Regem respondeu e a mídia NÃO vai ao robô; o texto que era
// só do pagamento também não; o texto com outro assunto segue; texto nunca passa pelo porteiro; a falha não segura.
describe('o porteiro do comprovante na entrega ao robô', () => {
  const antes = process.env.ROBO_JUNTAR_MS;
  beforeEach(() => {
    process.env.ROBO_JUNTAR_MS = '30';
  });
  afterEach(() => {
    definirPorteiroDoComprovante(null);
    esquecerPendentes();
    if (antes === undefined) delete process.env.ROBO_JUNTAR_MS;
    else process.env.ROBO_JUNTAR_MS = antes;
  });
  const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const msg = (o: any) => ({ tenantId: 't', de: '5521987654321', mensagemId: Math.random().toString(36), ...o });

  it('a foto que é comprovante não vai ao robô — e o "paguei" que esperava para juntar também não', async () => {
    const vistos: any[] = [];
    definirPorteiroDoComprovante(async (m: any, pend: string[]) => (vistos.push({ tipo: m.tipo, pend }), 'respondido'));
    const entregar = jest.fn(async () => true);
    await entregarJuntando(msg({ tipo: 'text', texto: 'paguei, segue o comprovante' }), entregar);
    await entregarJuntando(msg({ tipo: 'image', texto: '' }), entregar);
    await esperar(80);
    expect(vistos).toEqual([{ tipo: 'image', pend: ['paguei, segue o comprovante'] }]);
    expect(entregar).not.toHaveBeenCalled();
  });

  it('o texto com OUTRO assunto que esperava segue para o robô (o comprovante foi respondido à parte)', async () => {
    definirPorteiroDoComprovante(async () => 'respondido');
    const entregar = jest.fn(async () => true);
    await entregarJuntando(msg({ tipo: 'text', texto: 'paguei e quero mais uma coca' }), entregar);
    await entregarJuntando(msg({ tipo: 'document', texto: '' }), entregar);
    await esperar(80);
    expect(entregar).toHaveBeenCalledTimes(1);
    expect((entregar.mock.calls[0] as any[])[0]).toMatchObject({ tipo: 'text', texto: 'paguei e quero mais uma coca' });
  });

  it('"segue" (não é comprovante) e a falha do porteiro: tudo vai ao robô como sempre, o texto antes da foto', async () => {
    for (const porteiro of [async () => 'segue' as const, async () => Promise.reject(new Error('banco fora'))]) {
      definirPorteiroDoComprovante(porteiro as any);
      const entregar = jest.fn(async () => true);
      await entregarJuntando(msg({ tipo: 'text', texto: 'olha' }), entregar);
      await entregarJuntando(msg({ tipo: 'image', texto: '' }), entregar);
      expect(entregar.mock.calls.map((c: any[]) => c[0].tipo)).toEqual(['text', 'image']);
      esquecerPendentes();
    }
  });

  it('texto nunca passa pelo porteiro; com a junção desligada a foto passa por ele do mesmo jeito', async () => {
    const porteiro = jest.fn(async () => 'respondido' as const);
    definirPorteiroDoComprovante(porteiro);
    const entregar = jest.fn(async () => true);
    await entregarJuntando(msg({ tipo: 'text', texto: 'comprovante' }), entregar);
    expect(porteiro).not.toHaveBeenCalled();
    esquecerPendentes();
    process.env.ROBO_JUNTAR_MS = '0';
    await entregarJuntando(msg({ tipo: 'image', texto: 'pix' }), entregar);
    expect(porteiro).toHaveBeenCalledTimes(1);
    expect(entregar).not.toHaveBeenCalled();
  });
});
