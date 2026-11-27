import { atrasoDaCozinha, tempoAgoraDoTipo } from './tempo-de-espera';

// O tempo de espera AGORA (26/11/2026): a faixa só quando a cozinha está mais lenta que o normal, nunca abaixo do configurado.
describe('o tempo de espera agora para o atendente', () => {
  const amostra = (medianaAgoraMin: number | null, medianaNormalMin: number | null, nAgora = 8, nNormal = 200) => ({ nAgora, medianaAgoraMin, nNormal, medianaNormalMin });

  it('cozinha 12 min mais lenta: o configurado + o atraso, de 5 em 5 min, com 10 min de folga', () => {
    const atraso = atrasoDaCozinha(amostra(26, 14));
    expect(atraso).toBe(12);
    expect(tempoAgoraDoTipo(40, atraso)).toEqual({ de: 55, ate: 65 }); // 40 + 12 = 52 → 55
    expect(tempoAgoraDoTipo(20, atraso)).toEqual({ de: 35, ate: 45 });
  });

  it('cozinha no ritmo normal ou mais rápida: nada (vale o configurado — nunca abaixo dele)', () => {
    expect(atrasoDaCozinha(amostra(14, 14))).toBeNull();
    expect(atrasoDaCozinha(amostra(17, 14))).toBeNull(); // 3 min é ruído
    expect(atrasoDaCozinha(amostra(8, 14))).toBeNull();
    expect(tempoAgoraDoTipo(40, null)).toBeNull();
  });

  it('amostra pequena ou sem mediana: nada', () => {
    expect(atrasoDaCozinha(amostra(40, 14, 3))).toBeNull(); // 3 pedidos na última hora
    expect(atrasoDaCozinha(amostra(40, 14, 8, 19))).toBeNull(); // histórico curto
    expect(atrasoDaCozinha(amostra(null, 14))).toBeNull();
    expect(atrasoDaCozinha(amostra(40, null))).toBeNull();
  });

  it('loja sem tempo configurado (ou zero): nada', () => {
    expect(tempoAgoraDoTipo(null, 12)).toBeNull();
    expect(tempoAgoraDoTipo(0, 12)).toBeNull();
    expect(tempoAgoraDoTipo('lixo', 12)).toBeNull();
  });
});
