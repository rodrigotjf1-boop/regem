import { JANELA_DO_ECO_MS, ecoDeAvisoAutomatico, esquecerAvisosAutomaticos, marcarAvisoAutomatico } from './avisos-automaticos';

// O ECO DO AVISO AUTOMÁTICO NÃO PAUSA O ROBÔ (ERR-332, teste do dono em 31/10/2026): o "código de entrega" saiu pelo n8n
// pela Evolution, voltou como eco da coexistência e o robô ficou pausado depois do pedido.
describe('eco de aviso automático', () => {
  beforeEach(() => esquecerAvisosAutomaticos());
  const T = '11111111-2222-4333-8444-555555555555';

  it('o número que acabou de receber um aviso: o eco dos minutos seguintes não pausa — em qualquer forma do número', () => {
    const agora = 1_000_000;
    marcarAvisoAutomatico(T, '21987654321', agora); // como o pedido guarda
    expect(ecoDeAvisoAutomatico(T, '5521987654321', agora + 5_000)).toBe(true); // como a Meta manda o eco
    expect(ecoDeAvisoAutomatico(T, '552187654321', agora + 5_000)).toBe(true); // wa_id sem o nono dígito (ERR-134)
    expect(ecoDeAvisoAutomatico(T, '5521987654321', agora + JANELA_DO_ECO_MS + 1)).toBe(false); // passou a janela
  });

  it('outro número, outra loja ou sem aviso: o eco pausa como sempre (é a loja respondendo pelo celular)', () => {
    marcarAvisoAutomatico(T, '21987654321', 0);
    expect(ecoDeAvisoAutomatico(T, '21912345678', 1)).toBe(false);
    expect(ecoDeAvisoAutomatico('outra-loja', '21987654321', 1)).toBe(false);
    expect(ecoDeAvisoAutomatico(T, '', 1)).toBe(false);
    marcarAvisoAutomatico(T, '', 0); // sem telefone não marca nada
    expect(ecoDeAvisoAutomatico(T, '', 1)).toBe(false);
  });
});
