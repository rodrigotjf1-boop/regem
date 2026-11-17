import { crc16Pix, lerBoleto, lerPixCopiaECola, modulo10, modulo11Arrecadacao, modulo11Bancario, vencimentoDoFator } from './boleto';

// LER O BOLETO SEM IA (M3a). Os exemplos que provam as contas vêm de fora do código:
//  · os da FEBRABAN (layout de código de barras de arrecadação, versão 8, lido em 17/11/2026): a sequência 01230067896
//    dá 3 no módulo 10 e 0 no módulo 11, e os 43 dígitos do exemplo do DV geral dão 1 no módulo 10 e 0 no módulo 11;
//  · um boleto bancário e uma conta de luz montados e calculados À MÃO (a soma de cada dígito está anotada no PR):
//    o DV geral do bancário dá 796 → resto 4 → 7; os DVs dos campos dão 4, 7 e 7; a conta de luz dá 156 → 4 e os blocos
//    5, 9, 2 e 6;
//  · o exemplo de Pix estático do Manual de Padrões para Iniciação do Pix (Banco Central), com o CRC 1D3D.

const HOJE = new Date(Date.UTC(2026, 10, 17)); // 17/11/2026

describe('os módulos, pelos exemplos da FEBRABAN', () => {
  it('módulo 10 de 01230067896 = 3 (soma 37)', () => expect(modulo10('01230067896')).toBe(3));
  it('módulo 11 da arrecadação de 01230067896 = 0 (soma 176, resto 0)', () => expect(modulo11Arrecadacao('01230067896')).toBe(0));
  it('o DV geral do exemplo: módulo 10 = 1 (soma 139) e módulo 11 = 0 (soma 705, resto 1)', () => {
    const digitos43 = '822' + '0000215048200974123220154098290108605940';
    expect(digitos43).toHaveLength(43);
    expect(modulo10(digitos43)).toBe(1);
    expect(modulo11Arrecadacao(digitos43)).toBe(0);
  });
  it('módulo 11 da arrecadação: resto 10 dá 1 e resto 1 dá 0', () => {
    expect(modulo11Arrecadacao('5')).toBe(1); // 5 × 2 = 10 → resto 10
    expect(modulo11Arrecadacao('6')).toBe(0); // 6 × 2 = 12 → resto 1
  });
  it('módulo 11 do bancário: 0 ou maior que 9 vira 1', () => {
    expect(modulo11Bancario('0')).toBe(1); // 11 − 0 = 11 → 1
    expect(modulo11Bancario('5')).toBe(1); // soma 10, resto 10 → 11 − 10 = 1
    expect(modulo11Bancario('6')).toBe(1); // soma 12, resto 1 → 10 → 1
    expect(modulo11Bancario('4')).toBe(3); // soma 8 → 11 − 8 = 3
  });
});

describe('o fator de vencimento', () => {
  it('a volta de 22/02/2025: o fator 1000 de agora é 22/02/2025, e o 1641 é 25/11/2026', () => {
    expect(vencimentoDoFator(1000, HOJE)).toBe('2025-02-22');
    expect(vencimentoDoFator(1641, HOJE)).toBe('2026-11-25');
  });
  it('perto da data antiga, o ciclo antigo: o fator 1000 lido em 2001 é 03/07/2000', () => {
    expect(vencimentoDoFator(1000, new Date(Date.UTC(2001, 0, 1)))).toBe('2000-07-03');
    expect(vencimentoDoFator(9999, new Date(Date.UTC(2025, 1, 1)))).toBe('2025-02-21');
  });
  it('fator 0 = sem vencimento', () => expect(vencimentoDoFator(0, HOJE)).toBeNull());
});

describe('o boleto bancário (calculado à mão)', () => {
  const CODIGO = '00197164100001284901234567890123456789012345';
  const LINHA = '00191.23454 67890.123457 67890.123457 7 16410000128490';

  it('pela linha digitável: valor, vencimento, banco e as duas formas do número', () => {
    const r = lerBoleto(LINHA, HOJE);
    expect(r).toEqual({
      ok: true,
      tipo: 'bancario',
      codigoDeBarras: CODIGO,
      linhaDigitavel: LINHA,
      valorCentavos: 128490,
      vencimento: '2026-11-25',
      banco: '001',
    });
  });
  it('pelo código de barras chega ao mesmo, e sem pontos nem espaços também', () => {
    expect(lerBoleto(CODIGO, HOJE)).toEqual(lerBoleto(LINHA, HOJE));
    expect(lerBoleto(LINHA.replace(/\D/g, ''), HOJE)).toEqual(lerBoleto(LINHA, HOJE));
  });
  it('um número lido errado em qualquer posição da linha é recusado, nunca vira outro boleto', () => {
    const digitos = LINHA.replace(/\D/g, '');
    for (let i = 0; i < digitos.length; i++) {
      const errado = digitos.slice(0, i) + String((Number(digitos[i]) + 1) % 10) + digitos.slice(i + 1);
      const r = lerBoleto(errado, HOJE);
      expect([i, r.ok]).toEqual([i, false]);
    }
  });
  it('um número errado no código de barras é recusado pelo DV geral', () => {
    const errado = CODIGO.slice(0, 20) + (CODIGO[20] === '9' ? '0' : '9') + CODIGO.slice(21);
    expect(lerBoleto(errado, HOJE)).toMatchObject({ ok: false, motivo: 'digito' });
  });
  it('moeda que não é o real é recusada', () => {
    expect(lerBoleto('0018' + CODIGO.slice(4), HOJE)).toMatchObject({ ok: false, motivo: 'formato' });
  });
});

describe('a conta de consumo (arrecadação, calculada à mão)', () => {
  const CODIGO = '83640000004800001234567890123456789012345678';
  const LINHA = '83640000004-5 80000123456-9 78901234567-2 89012345678-6';

  it('pela linha de 48: valor efetivo, segmento energia e gás, sem vencimento no código', () => {
    expect(lerBoleto(LINHA, HOJE)).toEqual({
      ok: true,
      tipo: 'arrecadacao',
      codigoDeBarras: CODIGO,
      linhaDigitavel: LINHA,
      valorCentavos: 48000,
      vencimento: null,
      segmento: 3,
    });
  });
  it('pelo código de 44 chega ao mesmo', () => expect(lerBoleto(CODIGO, HOJE)).toEqual(lerBoleto(LINHA, HOJE)));
  it('um número lido errado em qualquer posição é recusado', () => {
    const digitos = LINHA.replace(/\D/g, '');
    for (let i = 0; i < digitos.length; i++) {
      const errado = digitos.slice(0, i) + String((Number(digitos[i]) + 1) % 10) + digitos.slice(i + 1);
      expect([i, lerBoleto(errado, HOJE).ok]).toEqual([i, false]);
    }
  });
  it('identificador 7 (só referência): o valor não vira valor a pagar', () => {
    // mesma conta com identificador 7 (módulo 10): recalcula o DV geral e lê sem valor
    const semDv = '837' + CODIGO.slice(4);
    const codigo7 = '837' + String(modulo10(semDv)) + CODIGO.slice(4);
    const r = lerBoleto(codigo7, HOJE);
    expect(r).toMatchObject({ ok: true, tipo: 'arrecadacao', valorCentavos: null });
  });
  it('identificador desconhecido é recusado', () => {
    expect(lerBoleto('835' + CODIGO.slice(3), HOJE)).toMatchObject({ ok: false, motivo: 'formato' });
  });
});

describe('tamanhos', () => {
  it('nem 44, nem 47, nem 48 dígitos: recusa dizendo quantos vieram', () => {
    expect(lerBoleto('123', HOJE)).toMatchObject({ ok: false, motivo: 'tamanho', explicacao: expect.stringContaining('3 dígitos') });
    expect(lerBoleto(undefined, HOJE)).toMatchObject({ ok: false, motivo: 'tamanho' });
  });
});

describe('o Pix copia e cola', () => {
  // Exemplo de Pix estático do Manual de Padrões para Iniciação do Pix (Banco Central).
  const EXEMPLO = '00020126580014br.gov.bcb.pix0136123e4567-e12b-12d1-a456-4266554400005204000053039865802BR5913Fulano de Tal6008BRASILIA62070503***63041D3D';

  it('o CRC do exemplo do Banco Central confere', () => {
    expect(crc16Pix(EXEMPLO.slice(0, -4))).toBe('1D3D');
  });
  it('lê o exemplo: chave, nome, cidade, sem valor e sem txid', () => {
    expect(lerPixCopiaECola(EXEMPLO)).toEqual({
      ok: true,
      copiaECola: EXEMPLO,
      valorCentavos: null,
      nome: 'Fulano de Tal',
      cidade: 'BRASILIA',
      chave: '123e4567-e12b-12d1-a456-426655440000',
      url: null,
      txid: null,
    });
  });
  it('com o valor (campo 54), lê em centavos', () => {
    const corpo = '00020126580014br.gov.bcb.pix0136123e4567-e12b-12d1-a456-42665544000052040000530398654071284.905802BR5913Fulano de Tal6008BRASILIA62070503***6304';
    expect(lerPixCopiaECola(corpo + crc16Pix(corpo))).toMatchObject({ ok: true, valorCentavos: 128490 });
  });
  it('um caractere mudado derruba o CRC: não vira Pix', () => {
    expect(lerPixCopiaECola(EXEMPLO.replace('Fulano', 'Fulana'))).toBeNull();
  });
  it('código que não é do Pix, curto ou sem o CRC no fim: nada', () => {
    const outro = EXEMPLO.replace('br.gov.bcb.pix', 'br.gov.bcb.pax');
    expect(lerPixCopiaECola(outro.slice(0, -4) + crc16Pix(outro.slice(0, -4)))).toBeNull();
    expect(lerPixCopiaECola('000201abc')).toBeNull();
    expect(lerPixCopiaECola(EXEMPLO.slice(0, -2))).toBeNull();
    expect(lerPixCopiaECola(null)).toBeNull();
  });
});
