import { senhaNaVia, rotuloSenha } from './senha-origem';
import { caixaAltaNaVia } from './texto-na-via';

// A VIA IMPRESSA (pedido do dono, 16/11/2026): "SENHA B - 5" era difícil de entender — a senha sai com o número e a origem
// por extenso ("SENHA 5 - BALCÃO", "SENHA 9 - DELIVERY"); e adicional e observação em caixa alta.
describe('a senha e o texto do pedido na via impressa', () => {
  it('a senha por extenso: o número e a origem; sem origem (pedido antigo), só o número; sem senha, nada', () => {
    expect(senhaNaVia(5, 'B')).toBe('SENHA 5 - BALCÃO');
    expect(senhaNaVia(9, 'D')).toBe('SENHA 9 - DELIVERY');
    expect(senhaNaVia('12', ' d ')).toBe('SENHA 12 - DELIVERY');
    expect(senhaNaVia(7, null)).toBe('SENHA 7');
    expect(senhaNaVia(3, 'X')).toBe('SENHA 3'); // origem desconhecida não inventa nome
    expect(senhaNaVia(null, 'B')).toBe('');
    expect(senhaNaVia('', 'B')).toBe('');
    // as telas (KDS, TV de senhas, PDV) seguem com o rótulo curto
    expect(rotuloSenha(5, 'B')).toBe('B-5');
  });

  it('caixa alta na via: acentos em maiúscula, e o texto do cliente continua sem virar comando da impressora', () => {
    expect(caixaAltaNaVia('sem cebola')).toBe('SEM CEBOLA');
    expect(caixaAltaNaVia('Batata média · ação')).toBe('BATATA MÉDIA · AÇÃO');
    expect(caixaAltaNaVia('\n@GAVETA abre')).toBe('GAVETA ABRE');
    expect(caixaAltaNaVia(null)).toBe('');
  });
});
