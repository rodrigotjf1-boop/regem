import { BadRequestException } from '@nestjs/common';
import {
  TEXTO_PADRAO,
  ajustesDaLinha,
  ajustesNovos,
  linkDeAvaliacaoValido,
  textoDaAvaliacao,
  type AjustesDaAvaliacao,
} from './pedir-avaliacao';
import { PedirAvaliacaoProcessor } from './pedir-avaliacao.processor';

/* eslint-disable @typescript-eslint/no-explicit-any */

// PEDIR AVALIAÇÃO NO GOOGLE (mig 365): as regras puras — o link só do Google, a mensagem, os ajustes que a tela manda e o
// "por que não mandar" de cada pedido. A rotina inteira (banco, janela, réplicas, toque) está em pedir-avaliacao-pg.spec.

const LINK = 'https://g.page/r/CabcDEF123/review';
const DESLIGADO: AjustesDaAvaliacao = ajustesDaLinha(null);

describe('o link de avaliação: só HTTPS e só do Google', () => {
  it.each([
    LINK,
    'https://search.google.com/local/writereview?placeid=ChIJabc',
    'https://maps.app.goo.gl/AbCdEf',
    'https://goo.gl/maps/xyz',
    'https://www.google.com.br/maps/place/Loja',
    'https://google.com/maps',
    'https://GOOGLE.COM/maps',
  ])('aceita %p', (l) => {
    expect(linkDeAvaliacaoValido(l)).not.toBeNull();
  });

  it.each([
    ['http (sem o S)', 'http://g.page/r/x/review'],
    ['outro site com "google" no nome', 'https://evilgoogle.com/x'],
    ['subdomínio de outro site', 'https://g.page.evil.com/x'],
    ['usuário e senha no endereço', 'https://user:pw@g.page/r/x/review'],
    ['"google.com@" antes do site de verdade', 'https://google.com@evil.com/x'],
    ['javascript', 'javascript:alert(1)'],
    ['sem o https://', 'g.page/r/x/review'],
    ['vazio', ''],
    ['nada', null],
    ['longo demais', `https://g.page/r/${'x'.repeat(500)}`],
  ])('recusa: %s', (_, l) => {
    expect(linkDeAvaliacaoValido(l)).toBeNull();
  });
});

describe('a mensagem', () => {
  it('o primeiro nome no {nome} e o link no {link}', () => {
    expect(textoDaAvaliacao(TEXTO_PADRAO, '  Ana  Souza ', 'https://l/1')).toBe(
      'Obrigado pelo pedido, Ana! 😊 Se puder, deixe sua avaliação no Google — ajuda muito a gente: https://l/1',
    );
  });

  it('sem nome, a frase fica sem ele (sem vírgula sobrando)', () => {
    expect(textoDaAvaliacao(TEXTO_PADRAO, null, 'https://l/1')).toBe(
      'Obrigado pelo pedido! 😊 Se puder, deixe sua avaliação no Google — ajuda muito a gente: https://l/1',
    );
    expect(textoDaAvaliacao('{nome}, avalie: {link}', '', 'L')).toBe('avalie: L');
    expect(textoDaAvaliacao('Oi {nome}! Avalie: {link}', ' ', 'L')).toBe('Oi! Avalie: L');
    expect(textoDaAvaliacao('Olá {nome}, tudo bem? {link}', undefined, 'L')).toBe('Olá tudo bem? L');
  });

  it('nome com "$&" ou "$\'" não vira pedaço do modelo (o nome vem do cliente)', () => {
    expect(textoDaAvaliacao('Oi {nome}! {link}', "Ana$&$'", 'L')).toBe("Oi Ana$&$'! L");
  });
});

describe('os ajustes guardados (sem linha: desligado, com os padrões do dono)', () => {
  it('padrões: desligado, sem link, o texto padrão, 40 min, só sem problema, a partir do 2º pedido, de novo em 60 dias', () => {
    expect(DESLIGADO).toEqual({
      ativa: false,
      link: null,
      texto: TEXTO_PADRAO,
      depoisMin: 40,
      soSemProblema: true,
      aPartirDo: 2,
      deNovoDias: 60,
    });
  });

  it('número fora das opções volta ao padrão; "todos os pedidos" só com false', () => {
    const a = ajustesDaLinha({ avaliacao_depois_min: 33, avaliacao_a_partir_do: 9, avaliacao_de_novo_dias: 7, avaliacao_so_sem_problema: null });
    expect(a).toMatchObject({ depoisMin: 40, aPartirDo: 2, deNovoDias: 60, soSemProblema: true });
    expect(ajustesDaLinha({ avaliacao_so_sem_problema: false }).soSemProblema).toBe(false);
  });
});

describe('os ajustes que a tela manda', () => {
  const ligado: AjustesDaAvaliacao = { ...DESLIGADO, ativa: true, link: LINK };
  const motivo = (f: () => unknown) => {
    try {
      f();
    } catch (e) {
      expect(e).toBeInstanceOf(BadRequestException);
      return (e as Error).message;
    }
    throw new Error('não recusou');
  };

  it('nada para salvar: recusa', () => {
    expect(motivo(() => ajustesNovos(null, DESLIGADO))).toMatch(/Nada para salvar/);
    expect(motivo(() => ajustesNovos({}, DESLIGADO))).toMatch(/Nada para salvar/);
  });

  it('liga/desliga só com verdadeiro/falso (V15)', () => {
    expect(motivo(() => ajustesNovos({ ativa: 'sim' }, ligado))).toMatch(/true ou false/);
    expect(ajustesNovos({ ativa: false }, ligado).ativa).toBe(false);
  });

  it('ligar exige o link; tirar o link com ele ligado, também', () => {
    expect(motivo(() => ajustesNovos({ ativa: true }, DESLIGADO))).toMatch(/Cole o link de avaliação/);
    expect(motivo(() => ajustesNovos({ link: '' }, ligado))).toMatch(/Cole o link de avaliação/);
    expect(ajustesNovos({ ativa: true, link: LINK }, DESLIGADO)).toMatchObject({ ativa: true, link: LINK });
  });

  it('link só do Google', () => {
    expect(motivo(() => ajustesNovos({ link: 'https://meusite.com/avaliar' }, DESLIGADO))).toMatch(/link de avaliação do Google/);
  });

  it('a mensagem precisa do {link}, tem limite, e vazia volta ao padrão', () => {
    expect(motivo(() => ajustesNovos({ texto: 'Avalie a gente!' }, ligado))).toMatch(/\{link\}/);
    expect(motivo(() => ajustesNovos({ texto: `${'x'.repeat(500)} {link}` }, ligado))).toMatch(/500 letras/);
    expect(ajustesNovos({ texto: '   ' }, { ...ligado, texto: 'Avalie: {link}' }).texto).toBe(TEXTO_PADRAO);
    expect(ajustesNovos({ texto: ' Avalie: {link} ' }, ligado).texto).toBe('Avalie: {link}');
  });

  it('números só das opções, e só número', () => {
    expect(motivo(() => ajustesNovos({ depoisMin: 30 }, ligado))).toMatch(/20, 40, 60, 120/);
    expect(motivo(() => ajustesNovos({ depoisMin: '60' }, ligado))).toMatch(/escolha uma das opções/);
    expect(motivo(() => ajustesNovos({ aPartirDo: 0 }, ligado))).toMatch(/1, 2, 3, 4, 5/);
    expect(motivo(() => ajustesNovos({ deNovoDias: 45 }, ligado))).toMatch(/30, 60, 90, 180/);
    expect(motivo(() => ajustesNovos({ soSemProblema: 'nao' }, ligado))).toMatch(/true ou false/);
  });

  it('o ausente MANTÉM o que estava (V16)', () => {
    const antes: AjustesDaAvaliacao = { ...ligado, depoisMin: 120, aPartirDo: 3, deNovoDias: 180, soSemProblema: false, texto: 'Avalie: {link}' };
    expect(ajustesNovos({ depoisMin: 20 }, antes)).toEqual({ ...antes, depoisMin: 20 });
  });
});

describe('por que NÃO mandar a um pedido (a ordem da tela)', () => {
  const c = (o: Partial<any> = {}, a: Partial<AjustesDaAvaliacao> = {}): any => ({
    ajustes: { ...DESLIGADO, ativa: true, link: LINK, ...a },
    pedidosDoCliente: 3,
    teveProblema: false,
    jaTocou: false,
    diasDesdeOUltimo: null,
    ...o,
  });
  const motivo = (x: any) => PedirAvaliacaoProcessor.motivoDeNaoEnviar(x);

  it('o cliente recorrente sem problema e que nunca recebeu: manda', () => {
    expect(motivo(c())).toBeNull();
  });

  it('teve problema: não manda com "só sem problema"; manda com "todos"', () => {
    expect(motivo(c({ teveProblema: true }))).toBe('teve_problema');
    expect(motivo(c({ teveProblema: true }, { soSemProblema: false }))).toBeNull();
  });

  it('antes do Nº pedido do cliente: não manda ("1º pedido" = todos — a consulta conta este pedido, no mínimo 1)', () => {
    expect(motivo(c({ pedidosDoCliente: 1 }))).toBe('antes_do_pedido_minimo');
    expect(motivo(c({ pedidosDoCliente: 2 }, { aPartirDo: 3 }))).toBe('antes_do_pedido_minimo');
    expect(motivo(c({ pedidosDoCliente: 1 }, { aPartirDo: 1 }))).toBeNull();
  });

  it('já tocou no link: nunca mais', () => {
    expect(motivo(c({ jaTocou: true, diasDesdeOUltimo: 400 }))).toBe('ja_tocou_no_link');
  });

  it('recebeu há menos de N dias: espera; depois de N dias (sem ter tocado), pede de novo', () => {
    expect(motivo(c({ diasDesdeOUltimo: 59.9 }))).toBe('pedido_recente');
    expect(motivo(c({ diasDesdeOUltimo: 60 }))).toBeNull();
    expect(motivo(c({ diasDesdeOUltimo: 100 }, { deNovoDias: 180 }))).toBe('pedido_recente');
  });
});
