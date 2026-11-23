import { lerRespostaDoFator, simOuNao } from './resposta-do-fator';

// ERR-584: "1 pacote tem quantos fardos?". O primeiro número da frase virou o fator, e 70 pacotes viraram 840 fardos.
describe('a resposta a "1 pacote tem quantos fardos?"', () => {
  const ler = (t: string) => lerRespostaDoFator(t, 'pacotes', 'fardo');

  it('o caso real: "são sinônimos e têm 12 unidades cada" é a mesma unidade, nunca 12', () => {
    expect(ler('Pacote e fardo sao sinônimos e tem 12 unidades cada')).toEqual({ tipo: 'confirmar', fator: 1 });
  });

  it.each([
    ['12', 12],
    ['12 fardos', 12],
    ['são 12', 12],
    ['tem 12 fardos.', 12],
    ['2,5', 2.5],
    ['1.000', 1000],
  ])('só o número vale direto: %s', (t, fator) => {
    expect(ler(t)).toEqual({ tipo: 'numero', fator });
  });

  it.each([
    ['1 pacote tem 12 fardos', 12],
    ['cada pacote tem 12 fardos', 12],
    ['1 pacote = 12 fardos', 12],
    ['2 pacotes fazem 1 fardo', 0.5],
    ['é a mesma coisa', 1],
    ['mesma unidade', 1],
    ['um pra um', 1],
  ])('a frase clara mostra a conta antes de valer: %s', (t, fator) => {
    expect(ler(t)).toEqual({ tipo: 'confirmar', fator });
  });

  it.each(['tem 12 unidades', '12 unidades', '12 pacotes', 'uns 12 eu acho', 'o pacote não é a mesma coisa que o fardo', 'pacote é diferente de fardo', '0'])(
    'o que não diz quantos fardos volta como pergunta: %s',
    (t) => {
      expect(ler(t)).toEqual({ tipo: 'duvida' });
    },
  );

  it.each(['qual foi a venda de ontem?', 'quanto vendi dia 12?', 'bom dia', ''])('o que não é resposta segue como conversa: "%s"', (t) => {
    expect(ler(t)).toEqual({ tipo: 'outro' });
  });

  it('a unidade do estoque em quilo aceita o apelido colado no número', () => {
    expect(lerRespostaDoFator('9kg', 'caixas', 'kg')).toEqual({ tipo: 'numero', fator: 9 });
    expect(lerRespostaDoFator('cada caixa tem 9 quilos', 'caixas', 'kg')).toEqual({ tipo: 'confirmar', fator: 9 });
  });

  it('sim e não à conta mostrada; o resto é resposta nova', () => {
    expect(['sim', 'Sim!', 'isso mesmo', 'certo', 'ok'].map(simOuNao)).toEqual(['sim', 'sim', 'sim', 'sim', 'sim']);
    expect(['não', 'nao', 'errado'].map(simOuNao)).toEqual(['nao', 'nao', 'nao']);
    expect(simOuNao('12')).toBeNull();
  });
});
