import { MAX_OBSERVACAO_DO_PEDIDO, textoDaObservacao } from './observacao-do-pedido';

// A OBSERVAÇÃO DO PEDIDO (mig 346): uma linha, sem caractere de controle, até 300 letras — a via impressa lê marcas no
// começo da linha (`@GAVETA` abre a gaveta de dinheiro), e o texto do cliente não pode virar comando da impressora.
describe('observação do pedido', () => {
  it('uma linha só: quebra de linha, tabulação e controle viram espaço', () => {
    expect(textoDaObservacao('interfone ruim\nligar ao chegar')).toBe('interfone ruim ligar ao chegar');
    expect(textoDaObservacao('não buzinar\r\n\tportão azul')).toBe('não buzinar portão azul');
    expect(textoDaObservacao('x\n@GAVETA')).toBe('x @GAVETA'); // nunca começa uma linha
    expect(textoDaObservacao('a\u001b@b')).toBe('a @b'); // ESC da impressora sai
  });
  it('vazia = null; corta em 300 letras', () => {
    for (const v of ['', '   ', null, undefined, '\n\n']) expect(textoDaObservacao(v)).toBeNull();
    expect(textoDaObservacao('a'.repeat(400))).toHaveLength(MAX_OBSERVACAO_DO_PEDIDO);
  });
});
