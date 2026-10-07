import { chaveNome, limparNome, maisParecido, semelhanca } from './produto-nome';

// Nome de produto: "é o mesmo?" (cadastro e importação recusam) e "é parecido?" (a importação
// separa para a pessoa decidir). Os nomes daqui são inventados.
describe('nome de produto do estoque', () => {
  it('limparNome tira espaço das pontas e o repetido; o que não é texto vira vazio', () => {
    expect(limparNome('  Molho   da  casa ')).toBe('Molho da casa');
    expect(limparNome(undefined)).toBe('');
    expect(limparNome(12)).toBe('');
  });

  it('a chave ignora maiúscula, acento, espaço e pontuação', () => {
    const esperado = chaveNome('Refrigerante Zeta-Cola lata 350 ml');
    for (const nome of ['refrigerante zeta cola LATA 350 ml', ' Refrigerante  Zéta-Cola lata 350 ml', 'REFRIGERANTE ZETA.COLA LATA 350 ML'])
      expect(chaveNome(limparNome(nome))).toBe(esperado);
  });

  it('a chave NÃO junta produtos que diferem no número ou no tamanho', () => {
    expect(chaveNome('Zeta-Cola lata 350 ml')).not.toBe(chaveNome('Zeta-Cola lata 220 ml'));
    expect(chaveNome('Zeta-Cola lata 350ml')).not.toBe(chaveNome('Zeta-Cola lata 350 ml')); // parecido, não igual
    expect(chaveNome('Açúcar')).not.toBe(chaveNome('Açúcar mascavo'));
  });

  it('parecido: o mesmo produto escrito com embalagem, medida ou marca a mais', () => {
    const pares: [string, string][] = [
      ['zeta cola lata 350ml 12 uni', 'Zeta cola lata 350ml'],
      ['suco de uva lata', 'Suco de Uva Lata 350ml'],
      ['calda de caramelo pote', 'Calda de caramelo [balde]'],
    ];
    for (const [a, b] of pares) expect([a, b, semelhanca(a, b) >= 0.6]).toEqual([a, b, true]);
  });

  it('NÃO é parecido: produtos diferentes que dividem uma palavra', () => {
    const pares: [string, string][] = [
      ['queijo prato fatiado', 'Queijo parmesão ralado'],
      ['molho de tomate', 'Tomate'],
      ['cobertura de morango', 'Cobertura de chocolate'],
      ['papel toalha', 'Papel alumínio'],
    ];
    for (const [a, b] of pares) expect([a, b, semelhanca(a, b) >= 0.6]).toEqual([a, b, false]);
  });

  it('nome só de palavras sem peso não é parecido com nada', () => {
    expect(semelhanca('caixa 12 un', 'Caixa de 12 unidades')).toBe(0);
    expect(semelhanca('', 'Tomate')).toBe(0);
  });

  it('maisParecido devolve o melhor candidato acima do limite, ou nada', () => {
    const cadastro = [{ id: '1', nome: 'Calda de caramelo [balde]' }, { id: '2', nome: 'Calda de menta' }, { id: '3', nome: 'Tomate' }];
    expect(maisParecido('calda de caramelo pote', cadastro)?.id).toBe('1');
    expect(maisParecido('farinha de rosca', cadastro)).toBeNull();
    expect(maisParecido('tomate', [])).toBeNull();
  });
});
