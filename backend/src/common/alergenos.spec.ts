import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  ALERGENOS,
  FRASE_DE_CAUTELA_MAX,
  FRASE_DE_CAUTELA_PADRAO,
  alergenosDoProduto,
  alergenosParaOCardapio,
  alergenosParaORobo,
  fraseDeCautela,
  lerMarcacaoDeAlergenos,
  marcacaoGravada,
  seloQueContradiz,
  selosSemContradicao,
  type MarcacaoDeAlergenos,
} from './alergenos';

// A REGRA DOS ALÉRGENOS (mig 454, D2 — protótipo `regem-atendente-alergenos-agendado.html`, A1–A9).

const m = (contem: string[] = [], extra: Partial<MarcacaoDeAlergenos> = {}): MarcacaoDeAlergenos => ({
  conferido: true,
  contem,
  podeConter: [],
  gluten: null,
  lactose: null,
  ...extra,
});

describe('alérgenos: a marcação que chega da tela', () => {
  it('confere a lista, tira repetido, põe na ordem e tira do "pode conter" o que contém', () => {
    expect(lerMarcacaoDeAlergenos({ conferido: true, contem: ['Leite', 'Trigo', 'Leite'], podeConter: ['Soja', 'Leite'] })).toEqual({
      conferido: true,
      contem: ['Trigo', 'Leite'],
      podeConter: ['Soja'],
      gluten: 'sim', // trigo sempre tem glúten
      lactose: null, // o leite pode ser zero lactose: o que a pessoa marcar vale
    });
  });

  it('recusa o que não é da lista, o "conferido" que não é verdadeiro/falso e o glúten fora de sim/nao', () => {
    expect(() => lerMarcacaoDeAlergenos({ conferido: true, contem: ['Chocolate'] })).toThrow('não é um alérgeno da lista');
    expect(() => lerMarcacaoDeAlergenos({ conferido: 'sim', contem: [] })).toThrow('conferido');
    expect(() => lerMarcacaoDeAlergenos({ conferido: true, gluten: 'talvez' })).toThrow('glúten');
    expect(() => lerMarcacaoDeAlergenos({ conferido: true, contem: 'Leite' })).toThrow('lista');
  });

  it('aveia pode ser sem glúten; trigo, centeio e cevada não', () => {
    expect(lerMarcacaoDeAlergenos({ conferido: true, contem: ['Aveia'], gluten: 'nao' }).gluten).toBe('nao');
    expect(lerMarcacaoDeAlergenos({ conferido: true, contem: ['Cevada'], gluten: 'nao' }).gluten).toBe('sim');
  });

  it('a gravada fora da forma conta como não conferida', () => {
    expect(marcacaoGravada(null)).toBeNull();
    expect(marcacaoGravada({ conferido: 'x' })).toBeNull();
    expect(marcacaoGravada({ conferido: true, contem: ['Ovos'] })?.contem).toEqual(['Ovos']);
  });

  it('a tela usa a MESMA lista, na mesma ordem, e a mesma frase padrão (frontend/src/lib/alergenos.ts)', () => {
    const tela = readFileSync(resolve(__dirname, '../../../frontend/src/lib/alergenos.ts'), 'utf8');
    const bloco = tela.slice(tela.indexOf('GRUPOS_DE_ALERGENOS'), tela.indexOf('] as const;'));
    const nomes = [...bloco.matchAll(/\[\s*'[^']+',\s*\[([^\]]+)\]/g)].flatMap((m) => [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]));
    expect(nomes).toEqual([...ALERGENOS]);
    expect(tela).toContain(`'${FRASE_DE_CAUTELA_PADRAO}'`);
    expect(tela).toContain(`FRASE_DE_CAUTELA_MAX = ${FRASE_DE_CAUTELA_MAX}`);
  });

  it('a lista é a da ANVISA mais glúten e lactose (sem item repetido)', () => {
    expect(new Set(ALERGENOS).size).toBe(ALERGENOS.length);
    expect(ALERGENOS).toEqual(expect.arrayContaining(['Trigo', 'Leite', 'Ovos', 'Amendoim', 'Soja', 'Crustáceos', 'Peixes', 'Látex natural']));
  });
});

describe('alérgenos do produto pela ficha (A1–A3)', () => {
  it('um insumo contém → o produto contém; todos conferidos → o resto é "não contém" (informado)', () => {
    const a = alergenosDoProduto([{ nome: 'Pão', marcacao: m(['Trigo', 'Leite', 'Ovos']) }, { nome: 'Carne', marcacao: m() }], null);
    expect(a).toMatchObject({ situacao: 'informado', origem: 'ficha', contem: ['Trigo', 'Ovos', 'Leite'], naoInformados: [], gluten: 'sim', lactose: 'sim' });
  });

  it('A2: falta conferir um insumo → o que não se sabe fica "não informado", nunca "não contém"', () => {
    const a = alergenosDoProduto([{ nome: 'Pão', marcacao: m(['Trigo']) }, { nome: 'Batata', marcacao: null }], null);
    expect(a.situacao).toBe('parcial');
    expect(a.faltaConferir).toEqual(['Batata']);
    expect(a.naoInformados).toContain('Leite');
    expect(a.lactose).toBeNull();
    expect(a.gluten).toBe('sim');
    expect(alergenosDoProduto([{ nome: 'Batata', marcacao: null }], null).situacao).toBe('nao_informado');
  });

  it('o que o insumo marcou sem "conferi o rótulo" que CONTÉM vale, mas não responde o resto', () => {
    const a = alergenosDoProduto([{ nome: 'Molho', marcacao: m(['Soja'], { conferido: false }) }], null);
    expect(a).toMatchObject({ situacao: 'parcial', contem: ['Soja'], faltaConferir: ['Molho'] });
  });

  it('A3: o ajuste só soma — não apaga o "contém" da ficha', () => {
    const ajuste = m([], { conferido: false, podeConter: ['Amendoim', 'Leite'], lactose: 'nao' });
    const a = alergenosDoProduto([{ nome: 'Queijo', marcacao: m(['Leite']) }], ajuste);
    expect(a.contem).toEqual(['Leite']);
    expect(a.podeConter).toEqual(['Amendoim']); // leite já contém
    expect(a.lactose).toBe('sim');
  });

  it('o produto sem ficha: o ajuste conferido é a marcação (à mão); sem ele, não informado', () => {
    expect(alergenosDoProduto([], m(['Leite']))).toMatchObject({ situacao: 'informado', origem: 'mao', contem: ['Leite'], gluten: 'nao', lactose: 'sim' });
    expect(alergenosDoProduto([], null)).toMatchObject({ situacao: 'nao_informado', origem: 'nenhuma', faltaConferir: ['o próprio produto (sem ficha técnica)'] });
    expect(alergenosDoProduto([], m(['Ovos'], { conferido: false }))).toMatchObject({ situacao: 'parcial', origem: 'mao', contem: ['Ovos'] });
  });

  it('glúten e lactose: leite zero lactose marcado responde "não contém lactose"; "pode conter" leite deixa sem resposta', () => {
    expect(alergenosDoProduto([{ nome: 'Leite zero', marcacao: m(['Leite'], { lactose: 'nao' }) }], null).lactose).toBe('nao');
    const pode = alergenosDoProduto([{ nome: 'Chocolate', marcacao: m([], { podeConter: ['Leite'] }) }], null);
    expect(pode.lactose).toBeNull();
    expect(pode.situacao).toBe('informado');
  });
});

describe('alérgenos: selos, frase de cautela, cardápio e robô', () => {
  const informado = alergenosDoProduto([{ nome: 'Pão', marcacao: m(['Trigo', 'Leite']) }], null);

  it('A6: o selo que contradiz é recusado na tela e some do cardápio', () => {
    expect(seloQueContradiz(['S/ lactose'], informado)).toContain('S/ lactose');
    expect(seloQueContradiz(['sem glúten'], informado)).toContain('S/ glúten');
    expect(seloQueContradiz(['Vegano'], informado)).toBeNull();
    expect(selosSemContradicao(['S/ glúten', 'Vegano', 'S/ lactose'], informado)).toEqual(['Vegano']);
    expect(selosSemContradicao(['S/ glúten'], undefined)).toEqual(['S/ glúten']);
  });

  it('A9: a frase da loja ou a padrão, nunca vazia', () => {
    expect(fraseDeCautela(null)).toBe(FRASE_DE_CAUTELA_PADRAO);
    expect(fraseDeCautela('   ')).toBe(FRASE_DE_CAUTELA_PADRAO);
    expect(fraseDeCautela(' Cozinha  com leite. ')).toBe('Cozinha com leite.');
  });

  it('A4: só o produto informado vai ao cardápio, com os nomes como o cliente lê', () => {
    expect(alergenosParaOCardapio(informado)).toEqual({ contem: ['Trigo (glúten)', 'Leite'], podeConter: [], gluten: 'sim', lactose: 'sim' });
    expect(alergenosParaOCardapio(alergenosDoProduto([{ nome: 'X', marcacao: null }], null))).toBeNull();
    expect(alergenosParaOCardapio(undefined)).toBeNull();
  });

  it('o robô recebe uma linha curta nos três casos', () => {
    expect(alergenosParaORobo(informado)).toBe('contém trigo (glúten) e leite; não contém os outros alérgenos da lista; contém glúten; contém lactose');
    expect(alergenosParaORobo(alergenosDoProduto([{ nome: 'Carne', marcacao: m() }], null))).toBe(
      'não contém nenhum alérgeno da lista; não contém glúten; não contém lactose',
    );
    expect(alergenosParaORobo(alergenosDoProduto([{ nome: 'Pão', marcacao: m(['Ovos']) }, { nome: 'X', marcacao: null }], null))).toBe(
      'contém ovos; os outros alérgenos: não informado pela loja',
    );
    expect(alergenosParaORobo(undefined)).toBe('não informado pela loja');
  });
});
