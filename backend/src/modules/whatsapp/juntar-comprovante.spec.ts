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

  // A LEITURA DA FOTO (16/11): o porteiro devolve `{ texto }` — a foto segue ao robô COM a descrição no lugar da legenda.
  it('a foto lida pela IA vai ao robô com o texto da descrição; o texto que esperava vai antes, como sempre', async () => {
    definirPorteiroDoComprovante(async () => ({ texto: 'não consigo\n[o cliente mandou uma foto: um print… Aviso: Pedido mínimo R$ 20,00.]' }));
    const entregar = jest.fn(async () => true);
    await entregarJuntando(msg({ tipo: 'text', texto: 'oi' }), entregar);
    await entregarJuntando(msg({ tipo: 'image', texto: 'não consigo', midiaId: 'M1' }), entregar);
    const chamadas = entregar.mock.calls.map((c: any[]) => c[0]);
    expect(chamadas.map((m: any) => m.tipo)).toEqual(['text', 'image']);
    expect(chamadas[1]).toMatchObject({ tipo: 'image', midiaId: 'M1', fotoDescrita: true, texto: 'não consigo\n[o cliente mandou uma foto: um print… Aviso: Pedido mínimo R$ 20,00.]' });
    // texto vazio na decisão = a mensagem segue como chegou
    esquecerPendentes();
    definirPorteiroDoComprovante(async () => ({ texto: '   ' }));
    const outra = jest.fn(async () => true);
    await entregarJuntando(msg({ tipo: 'image', texto: 'legenda' }), outra);
    expect((outra.mock.calls[0] as any[])[0]).toMatchObject({ texto: 'legenda' });
    expect((outra.mock.calls[0] as any[])[0].fotoDescrita).toBeUndefined();
  });
});
