import {
  AJUSTE_CHEGUEI_PADRAO,
  ajusteDaLinha,
  lerAjusteCheguei,
  lerCheguei,
  lerOnde,
  limparObs,
  textoDaResposta,
} from './chegada';

// "CHEGUEI" NA RETIRADA (Onda 3, mig 354) — as regras puras: o que conta como "cheguei" no WhatsApp (ERR-317: a palavra
// tem de ser inequívoca), o que o cliente pode mandar, o ajuste (V15/V16) e as respostas.

describe('o que conta como "cheguei" no WhatsApp', () => {
  it('as frases de chegada, com acento, maiúscula e pontuação, e o botão do aviso ("Cheguei")', () => {
    for (const t of [
      'cheguei', 'Cheguei', 'CHEGUEI!', 'Já cheguei', 'ja cheguei!!', 'chegamos', 'Tô aqui', 'to aqui', 'estou aqui',
      'Estou na porta', 'tô na porta', 'to na loja', 'estamos aqui', 'estou lá fora', 'tô em frente', 'cheguei?',
    ])
      expect([t, lerCheguei(t).ok]).toEqual([t, true]);
  });

  it('o que o cliente escreve junto vai para a equipe, no texto dele (com acento)', () => {
    expect(lerCheguei('Cheguei, tô de moto vermelha')).toEqual({ ok: true, resto: 'tô de moto vermelha' });
    expect(lerCheguei('Já cheguei! Carro prata na esquina')).toEqual({ ok: true, resto: 'Carro prata na esquina' });
    expect(lerCheguei('estou na porta - Fiat Uno')).toEqual({ ok: true, resto: 'Fiat Uno' });
    expect(lerCheguei('to-na-porta')).toEqual({ ok: true, resto: '' });
    expect(lerCheguei('Cheguei')).toEqual({ ok: true, resto: '' });
  });

  it('não é chegada: outra conversa, "cheguei em casa", mensagem longa, "chegou", "chegando"', () => {
    for (const t of [
      'cheguei em casa e faltou o refri', 'Cheguei em casa', 'cheguei na casa da minha mãe', 'o motoboy disse que cheguei',
      'chegou?', 'meu pedido chegou', 'to chegando', 'chegando em 5 min', 'aqui', 'quero cancelar', '', '   ',
      `cheguei ${'e queria saber uma coisa sobre o pedido de ontem que veio errado '.repeat(2)}`,
    ])
      expect([t, lerCheguei(t).ok]).toEqual([t, false]);
  });
});

describe('o que o cliente manda pelo cardápio', () => {
  it('"onde você está": balcão, porta ou nada; outra coisa é recusada', () => {
    expect(lerOnde('balcao')).toBe('balcao');
    expect(lerOnde('porta')).toBe('porta');
    for (const v of [undefined, null, '']) expect(lerOnde(v)).toBeNull();
    for (const v of ['carro', 'BALCAO', 1, true]) expect(() => lerOnde(v)).toThrow('Onde você está');
  });

  it('"como te achar": uma linha, sem caractere de controle, até 80', () => {
    expect(limparObs('  moto\nvermelha\t ')).toBe('moto vermelha');
    expect(limparObs('x'.repeat(200))).toHaveLength(80);
    for (const v of [undefined, null, '', '   ', 12]) expect(limparObs(v)).toBeNull();
  });
});

describe('o ajuste "Retirada · cliente chegou"', () => {
  it('V16: ausente fica de fora; V15: liga/desliga só com booleano; minutos 3, 5 ou 10', () => {
    expect(lerAjusteCheguei({})).toEqual({});
    expect(lerAjusteCheguei(null)).toEqual({});
    expect(lerAjusteCheguei({ ativo: true, deNovoMin: 10 })).toEqual({ ativo: true, deNovoMin: 10 });
    expect(lerAjusteCheguei({ perguntarOnde: false, todasTelas: false })).toEqual({ perguntarOnde: false, todasTelas: false });
    for (const ruim of [4, '5', 0, null, 5.5]) expect(() => lerAjusteCheguei({ deNovoMin: ruim })).toThrow('Avisar de novo: escolha 3, 5 ou 10 minutos.');
    expect(() => lerAjusteCheguei({ ativo: 'sim' })).toThrow('ativo');
    expect(() => lerAjusteCheguei({ todasTelas: 1 })).toThrow('todasTelas');
  });

  it('a linha do banco: sem linha, o padrão (desligado); valor torto, o padrão daquele campo', () => {
    expect(ajusteDaLinha(null)).toEqual(AJUSTE_CHEGUEI_PADRAO);
    expect(AJUSTE_CHEGUEI_PADRAO.ativo).toBe(false);
    expect(ajusteDaLinha({ cheguei_ativo: true, cheguei_perguntar_onde: false, cheguei_todas_telas: false, cheguei_de_novo_min: 10 })).toEqual({
      ativo: true,
      perguntarOnde: false,
      todasTelas: false,
      deNovoMin: 10,
    });
    expect(ajusteDaLinha({ chegueiAtivo: true, chegueiDeNovoMin: 7 }).deNovoMin).toBe(5);
  });
});

describe('a resposta ao cliente', () => {
  it('chegou com o pedido pronto, em preparo, de novo e já avisado', () => {
    expect(textoDaResposta({ situacao: 'novo', nome: 'Marina Lopes', numero: '1187', pronto: true })).toBe(
      'Avisamos a equipe, Marina! 🙋 Seu pedido #1187 está no balcão: diga o seu nome ou o número 1187.',
    );
    expect(textoDaResposta({ situacao: 'novo', nome: 'Paulo', numero: '1189', pronto: false })).toBe(
      'Avisamos a cozinha que você chegou, Paulo! Seu pedido #1189 ainda está em preparo.',
    );
    expect(textoDaResposta({ situacao: 'de_novo', nome: null, numero: '7', pronto: false })).toBe(
      'Avisamos a equipe de novo. Seu pedido #7 ainda está em preparo.',
    );
    expect(textoDaResposta({ situacao: 'ja_avisado', nome: 'Caio', numero: '9', pronto: true, hora: '19:42' })).toBe(
      'A equipe já sabe que você chegou (às 19:42), Caio. Já, já te atendem. 🙏',
    );
  });
});
