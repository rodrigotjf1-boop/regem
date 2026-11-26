import { CONVERSA_PADRAO, conferirConversa } from './mister-conversa-config.service';
import { TEXTOS_DAS_ACOES, imagemLigada } from './mister-acoes';

// VERSÃO 10, C10c (mig 509): "Imagem na conversa" por empresa — nasce desligada, liga só com booleano de verdade (V15), e a
// variável `MISTER_CRIAR_IMAGEM=1` continua sendo a chave da instalação. O caminho que a recusa manda é o da página (V65).

describe('Mister · C10c · imagem na conversa', () => {
  it('nasce desligada e liga só com booleano de verdade', () => {
    expect(CONVERSA_PADRAO.imagemNaConversa).toBe(false);
    expect(conferirConversa({ imagemNaConversa: true })).toEqual({ imagemNaConversa: true });
    expect(conferirConversa({ imagemNaConversa: false })).toEqual({ imagemNaConversa: false });
    expect(conferirConversa({ imagemNaConversa: 'sim' })).toHaveProperty('erro');
    expect(conferirConversa({ imagemNaConversa: 1 })).toHaveProperty('erro');
    // O ausente mantém o salvo (V16): mudar outro campo não mexe nela.
    expect(conferirConversa({ aprenderTarefas: true })).not.toHaveProperty('imagemNaConversa');
  });

  it('a chave da instalação segue a variável', () => {
    const antes = process.env.MISTER_CRIAR_IMAGEM;
    try {
      delete process.env.MISTER_CRIAR_IMAGEM;
      expect(imagemLigada()).toBe(false);
      process.env.MISTER_CRIAR_IMAGEM = '1';
      expect(imagemLigada()).toBe(true);
    } finally {
      if (antes === undefined) delete process.env.MISTER_CRIAR_IMAGEM;
      else process.env.MISTER_CRIAR_IMAGEM = antes;
    }
  });

  it('a recusa diz quem liga, onde, o preço e o que fazer no lugar', () => {
    const t = TEXTOS_DAS_ACOES.imagemDesligadaNaEmpresa;
    expect(t).toContain('o presidente');
    expect(t).toContain('Mister › Avisos e relatórios › Conversa › "Imagem na conversa"');
    expect(t).toContain('R$ 0,35 por imagem');
    expect(t).toContain('gráfico desenhado pelo Regem');
  });
});
