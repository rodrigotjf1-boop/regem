import {
  MAX_LETRAS_DO_RECADO,
  PREFIXO_DO_RECADO,
  TEXTOS_DO_RECADO,
  VALIDADE_DO_RECADO_MIN,
  botaoDoRecado,
  lerBotaoDoRecado,
  ondeVai,
  partesDoRecado,
  textoDoRecado,
} from './mister-recado';

// M3g parte 2 — o recado no mural pela conversa (mig 444). As regras puras: o texto, o comunicado e os botões.

const ID = '0f8fad5b-d9cb-469f-a165-70867728950e';

describe('o recado no mural do Mister (M3g parte 2, mig 444) — as regras', () => {
  it('o texto: limpa as pontas e as linhas em branco repetidas; de 2 a 500 letras; nunca com link', () => {
    expect(textoDoRecado('  📢 Amanhã, terça (17/11), a loja abre às 18h.  ')).toEqual({ texto: '📢 Amanhã, terça (17/11), a loja abre às 18h.' });
    expect(textoDoRecado('Reunião sexta\r\n\r\n\r\n\r\n  às 15h na loja  ')).toEqual({ texto: 'Reunião sexta\n\nàs 15h na loja' });
    expect(textoDoRecado('x'.repeat(MAX_LETRAS_DO_RECADO))).toEqual({ texto: 'x'.repeat(MAX_LETRAS_DO_RECADO) });
    expect(textoDoRecado('x'.repeat(MAX_LETRAS_DO_RECADO + 1))).toEqual({ erro: TEXTOS_DO_RECADO.longo });
    for (const vazio of [undefined, null, 12, '', ' ', 'a', ['texto'], { texto: 'oi' }]) expect(textoDoRecado(vazio)).toEqual({ erro: TEXTOS_DO_RECADO.vazio });
    for (const comLink of ['Veja https://exemplo.com/treino', 'Acesse www.exemplo.com.br hoje', 'HTTP://EXEMPLO.COM'])
      expect(textoDoRecado(comLink)).toEqual({ erro: TEXTOS_DO_RECADO.comLink });
    // Ponto sem espaço não é domínio: "dia.Com isso" é texto.
    expect(textoDoRecado('Bom dia.Com isso, a reunião fica às 15h.')).toEqual({ texto: 'Bom dia.Com isso, a reunião fica às 15h.' });
  });

  it('o comunicado: a primeira linha é o título e o resto é o corpo; a primeira linha comprida vira título encurtado e o recado vai inteiro no corpo', () => {
    expect(partesDoRecado('📢 Amanhã, terça (17/11), a loja abre às 18h.')).toEqual({ titulo: '📢 Amanhã, terça (17/11), a loja abre às 18h.', corpo: null });
    expect(partesDoRecado('Reunião de equipe\n\nSexta, 20/11, às 15h, na Loja Centro.')).toEqual({ titulo: 'Reunião de equipe', corpo: 'Sexta, 20/11, às 15h, na Loja Centro.' });
    const longa = `${'Atenção, equipe: '.repeat(12)}fim.`;
    const p = partesDoRecado(longa);
    expect(p.titulo.length).toBe(158);
    expect(p.titulo.endsWith('…')).toBe(true);
    expect(p.corpo).toBe(longa);
  });

  it('os botões: "Publicar" e "Mudar o texto" com o id do rascunho; o que não é do recado não se lê', () => {
    expect(botaoDoRecado('pub', ID)).toEqual({ id: `rec:pub:${ID}`, titulo: 'Publicar' });
    expect(botaoDoRecado('mudar', ID)).toEqual({ id: `rec:mudar:${ID}`, titulo: 'Mudar o texto' });
    expect(botaoDoRecado('pub', ID).id.startsWith(PREFIXO_DO_RECADO)).toBe(true);
    // O id cabe no botão da Meta (até 256 letras) e o título em 20.
    expect(botaoDoRecado('mudar', ID).id.length).toBeLessThanOrEqual(256);
    expect(botaoDoRecado('mudar', ID).titulo.length).toBeLessThanOrEqual(20);
    expect(lerBotaoDoRecado(`rec:pub:${ID}`)).toEqual({ acao: 'pub', id: ID });
    expect(lerBotaoDoRecado(`rec:mudar:${ID.toUpperCase()}`)).toEqual({ acao: 'mudar', id: ID });
    for (const torto of [`rec:apagar:${ID}`, `rec:pub:${ID}x`, 'rec:pub:123', `doc:lancar:${ID}`, '', null, undefined]) expect(lerBotaoDoRecado(torto)).toBeNull();
  });

  it('as frases: onde vai, o publicado com a hora e o vencido com o prazo', () => {
    expect(VALIDADE_DO_RECADO_MIN).toBe(30);
    expect(ondeVai('Loja Centro')).toBe('da Loja Centro');
    expect(ondeVai('todas as lojas')).toBe('de todas as lojas');
    expect(TEXTOS_DO_RECADO.publicado('Loja Centro', '23:06')).toBe('Publicado no Mural & clima da Loja Centro, às 23:06.');
    expect(TEXTOS_DO_RECADO.publicado('todas as lojas', '23:06')).toBe('Publicado no Mural & clima de todas as lojas, às 23:06.');
    expect(TEXTOS_DO_RECADO.venceu).toContain('30 minutos');
    // O caminho que a frase manda a pessoa seguir é o item do menu (V65): "Mural & clima".
    expect(TEXTOS_DO_RECADO.semBotao).toContain('em Mural & clima');
  });
});
