import { escritaForaDoToken, escritaSoPelaLigacaoLigada, fraseEscritaSoPelaLigacao } from './escrita-pela-ligacao';

// A escrita sai do token antigo (Hub DMS, F5 parte E): só a do Liame, só pelo `rgm_it_` e só com a chave ligada.
describe('a escrita que sai do token antigo (F5 parte E)', () => {
  const ligada = { LIAME_ESCRITA_SO_PELA_LIGACAO: 'true' } as NodeJS.ProcessEnv;

  it('a chave liga só com o texto "true"', () => {
    expect(escritaSoPelaLigacaoLigada(ligada)).toBe(true);
    for (const v of [undefined, '', 'false', 'TRUE', '1', 'sim', ' true']) {
      expect(escritaSoPelaLigacaoLigada({ LIAME_ESCRITA_SO_PELA_LIGACAO: v } as NodeJS.ProcessEnv)).toBe(false);
    }
  });

  it('ligada: o rgm_it_ do Liame perde o criar cupom; a ligação dele, não', () => {
    expect(escritaForaDoToken('liame', undefined, ligada)).toEqual(['cupons.criar']);
    expect(escritaForaDoToken('liame', 'ligacao', ligada)).toEqual([]);
  });

  it('desligada (o padrão), nada sai do token', () => {
    expect(escritaForaDoToken('liame', undefined, {} as NodeJS.ProcessEnv)).toEqual([]);
  });

  it('o GoGeM e os outros aplicativos seguem como estão (o GoGeM grava pelo rgm_it_ até a F6)', () => {
    for (const cliente of ['gogem', 'regemcast', 'farol', 'orzuni', 'toString', '__proto__']) {
      expect(escritaForaDoToken(cliente, undefined, ligada)).toEqual([]);
    }
  });

  it('a recusa diz por onde a escrita vai agora', () => {
    expect(fraseEscritaSoPelaLigacao(['cupons.criar'])).toBe(
      'Este token só lê: cupons.criar vai só pela ligação da loja (Hub DMS). Grave pela ligação, com o token do DMS ID e o segredo no cabeçalho DMS-Ligacao.',
    );
  });
});
