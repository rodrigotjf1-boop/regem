import {
  AGRADECIMENTO_PADRAO,
  MAX_SUGESTAO,
  avisosDeComentarioNaoLidos,
  decidirStory,
  ehMencaoNoStory,
  hostDaMeta,
  instrucoesDaAnalise,
  lerAnalise,
  mencionaALoja,
  resumoDoCasoDoStory,
  textoDaAnalise,
  textoDaMarcacao,
  tipoDaImagem,
  tipoDaMidia,
} from './marcacoes';

// AS MARCAÇÕES DO INSTAGRAM (mig 387) — as regras puras: quem é marcação (a menção no story, o @ da loja inteiro), o host
// da mídia (só o CDN da Meta), o tipo da imagem, o pedido à IA (nunca pessoas), a leitura da resposta dela (a trava do
// público), a decisão no story, o texto que a equipe publica e o diagnóstico do aviso (só os nomes dos campos).

describe('quem é marcação', () => {
  it('a menção no story: só a do cliente (o eco e a apagada não contam)', () => {
    expect(ehMencaoNoStory({ tipo: 'story', eco: false, apagada: false })).toBe(true);
    expect(ehMencaoNoStory({ tipo: 'story', eco: true, apagada: false })).toBe(false);
    expect(ehMencaoNoStory({ tipo: 'story', eco: false, apagada: true })).toBe(false);
    for (const tipo of ['texto', 'imagem', 'reel', 'compartilhamento']) expect(ehMencaoNoStory({ tipo, eco: false, apagada: false })).toBe(false);
  });

  it('o @ da loja inteiro, sem diferença de maiúscula; outra conta, e-mail e @ inválido não', () => {
    const sim = ['@burgerdapraca que delícia', 'Que delícia @BurgerDaPraca!', 'olha (@burgerdapraca), vem', 'fui no @burgerdapraca.', '@burgerdapraca'];
    for (const t of sim) expect(mencionaALoja(t, 'burgerdapraca')).toBe(true);
    const nao = ['@burgerdapraca2 top', '@burgerdapraca.rio', 'contato@burgerdapraca.com', '@@burgerdapracax', 'burgerdapraca sem arroba', '@burger_dapraca'];
    for (const t of nao) expect(mencionaALoja(t, 'burgerdapraca')).toBe(false);
    expect(mencionaALoja('olha o @burger.da.praca', '@burger.da.praca')).toBe(true); // o @ guardado com ou sem "@"
    expect(mencionaALoja('olha o @burgerxdaxpraca', 'burger.da.praca')).toBe(false); // o ponto não vira "qualquer letra"
    for (const u of ['', null, 'conta com espaço', 'x'.repeat(31)]) expect(mencionaALoja('@x', u)).toBe(false);
  });

  it('post ou reels pelo `media_product_type`', () => {
    expect(tipoDaMidia('REELS')).toBe('reels');
    expect(tipoDaMidia('reels')).toBe('reels');
    for (const v of ['FEED', 'AD', null, undefined]) expect(tipoDaMidia(v)).toBe('post');
  });
});

describe('a mídia', () => {
  it('só o CDN da Meta, em HTTPS', () => {
    for (const u of [
      'https://scontent.cdninstagram.com/v/t51/foto.jpg',
      'https://scontent-gru2-1.cdninstagram.com/x.jpg',
      'https://scontent-gru1-2.xx.fbcdn.net/v/foto.jpg',
      'https://lookaside.fbsbx.com/ig_messaging_cdn/?asset_id=1',
      'https://lookaside.instagram.com/seo/x',
    ])
      expect(hostDaMeta(u)).toBe(true);
    for (const u of [
      'http://scontent.cdninstagram.com/foto.jpg',
      'https://cdninstagram.com.ataque.net/foto.jpg',
      'https://evil.com/fbcdn.net/foto.jpg',
      'https://127.0.0.1/foto.jpg',
      'não é endereço',
      null,
    ])
      expect(hostDaMeta(u)).toBe(false);
  });

  it('o tipo da imagem pelo cabeçalho; vídeo e o resto não', () => {
    expect(tipoDaImagem('image/jpeg; charset=binary')).toBe('image/jpeg');
    expect(tipoDaImagem('IMAGE/PNG')).toBe('image/png');
    expect(tipoDaImagem('image/webp')).toBe('image/webp');
    for (const v of ['video/mp4', 'image/svg+xml', 'text/html', '', null]) expect(tipoDaImagem(v)).toBeNull();
  });
});

describe('o pedido à IA e a resposta dela', () => {
  it('as instruções: a loja, onde marcaram, o JSON, NUNCA pessoas, o clima, a resposta curta e o jeito do canal', () => {
    const s = instrucoesDaAnalise({ loja: 'Burger da Praça', tipo: 'story', jeito: 'PERFIL DE ATENDIMENTO (escolhido pela loja): CORDIAL.', temImagem: true });
    expect(s).toContain('Burger da Praça');
    expect(s).toContain('num story');
    expect(s).toContain('Direct');
    expect(s).toContain('{"viu"');
    expect(s).toContain('NUNCA descreva nem identifique pessoas');
    expect(s).toContain('"negativo" quando parece reclamação');
    expect(s).toContain(`até ${MAX_SUGESTAO} letras`);
    expect(s).toContain('não invente preço');
    expect(s.trim().endsWith('CORDIAL.')).toBe(true);
    const c = instrucoesDaAnalise({ loja: null, tipo: 'comentario', jeito: '', temImagem: false });
    expect(c).toContain('a loja, um restaurante');
    expect(c).toContain('resposta pública ao comentário');
    expect(c).toContain('Não há imagem');
    expect(textoDaAnalise({ usuario: 'ana.lopes', texto: '  Sexta é dia de smash \n @burgerdapraca ' })).toBe('Quem marcou: @ana.lopes.\nO que estava escrito: "Sexta é dia de smash @burgerdapraca"');
    expect(textoDaAnalise({ usuario: null, texto: null })).toBe('Quem marcou: não informado.\nNada escrito.');
  });

  it('a resposta: o primeiro JSON; clima inválido não serve; negativo não leva resposta; a trava do público corta link e contato', () => {
    expect(lerAnalise('Claro! {"viu": "Um smash com cheddar.", "clima": "positivo", "resposta": "Que smash, hein! Obrigado por marcar a gente 🧡"} pronto')).toEqual({
      viu: 'Um smash com cheddar.',
      clima: 'positivo',
      resposta: 'Que smash, hein! Obrigado por marcar a gente 🧡',
    });
    expect(lerAnalise('{"viu": "x", "clima": "talvez", "resposta": "oi"}')).toBeNull();
    expect(lerAnalise('nada de JSON aqui')).toBeNull();
    expect(lerAnalise('{"viu": "quebrado", ')).toBeNull();
    expect(lerAnalise('{"viu": "Lanche amassado.", "clima": "NEGATIVO", "resposta": "Sentimos muito!"}')).toEqual({ viu: 'Lanche amassado.', clima: 'negativo', resposta: null });
    expect(lerAnalise('{"viu": "x", "clima": "positivo", "resposta": "Peça em www.loja.com.br"}')?.resposta).toBeNull();
    expect(lerAnalise('{"viu": "x", "clima": "positivo", "resposta": "Chama no 21 99999-8888"}')?.resposta).toBeNull();
    expect(lerAnalise('{"viu": "x", "clima": "positivo", "resposta": "Valeu @ana.lopes!"}')?.resposta).toBeNull();
    const longo = lerAnalise(JSON.stringify({ viu: 'v'.repeat(500), clima: 'neutro', resposta: `${'Muito obrigado pela marcação. '.repeat(15)}` }))!;
    expect(Array.from(longo.viu ?? '').length).toBe(300);
    expect(Array.from(longo.resposta ?? '').length).toBeLessThanOrEqual(MAX_SUGESTAO);
    expect(lerAnalise('{"viu": "  ", "clima": "neutro", "resposta": ""}')).toEqual({ viu: null, clima: 'neutro', resposta: null });
  });
});

describe('a decisão no story', () => {
  const a = (clima: 'positivo' | 'neutro' | 'negativo', resposta: string | null) => ({ viu: 'algo', clima, resposta });
  it('conversa com alguém → nada; reclamação → caso; a IA escreveu → ela; sem IA ou sem resposta → o padrão', () => {
    expect(decidirStory({ conversaComAlguem: true, analise: a('positivo', 'Valeu!') })).toEqual({ acao: 'nada', motivo: 'conversa_com_alguem' });
    expect(decidirStory({ conversaComAlguem: false, analise: a('negativo', null) })).toEqual({ acao: 'caso' });
    expect(decidirStory({ conversaComAlguem: false, analise: a('positivo', 'Que bom que curtiu!') })).toEqual({ acao: 'agradecer', texto: 'Que bom que curtiu!', padrao: false });
    expect(decidirStory({ conversaComAlguem: false, analise: a('neutro', null) })).toEqual({ acao: 'agradecer', texto: AGRADECIMENTO_PADRAO, padrao: true });
    expect(decidirStory({ conversaComAlguem: false, analise: null })).toEqual({ acao: 'agradecer', texto: AGRADECIMENTO_PADRAO, padrao: true });
  });

  it('o resumo do caso: o motivo, o que a IA viu, o que foi feito e o cliente chateado', () => {
    expect(resumoDoCasoDoStory('Hambúrguer amassado.')).toEqual({
      motivo: 'Menção no story · parece reclamação',
      viu: 'Hambúrguer amassado.',
      jaFez: 'Nada: não agradeci, porque parece reclamação',
      humor: 'chateado',
    });
    expect(resumoDoCasoDoStory(null).viu).toBeNull();
  });
});

describe('o que a equipe publica', () => {
  it('de 1 a 300 letras numa linha, sem link e sem contato; o longo é recusado (não cortado)', () => {
    expect(textoDaMarcacao('  Que sexta!\n Obrigado por marcar 🧡  ')).toEqual({ ok: true, texto: 'Que sexta! Obrigado por marcar 🧡' });
    expect(textoDaMarcacao('')).toEqual({ ok: false, erro: 'Escreva o comentário.' });
    expect(textoDaMarcacao(42)).toEqual({ ok: false, erro: 'Escreva o comentário.' });
    expect(textoDaMarcacao('a'.repeat(301))).toEqual({ ok: false, erro: 'Comentário longo demais (até 300 letras).' });
    expect(textoDaMarcacao('a'.repeat(300)).ok).toBe(true);
    expect(textoDaMarcacao('Peça em bit.ly/burger')).toEqual({ ok: false, erro: 'No comentário público não vai link (o Instagram não deixa clicar).' });
    expect(textoDaMarcacao('Chama no zap 21 98877-1200')).toEqual({ ok: false, erro: 'Telefone, WhatsApp, e-mail ou @ de alguém não vão no comentário público.' });
    expect(textoDaMarcacao('Valeu @ana!')).toEqual({ ok: false, erro: 'Telefone, WhatsApp, e-mail ou @ de alguém não vão no comentário público.' });
  });
});

describe('o diagnóstico do aviso', () => {
  it('lista os avisos `comments` que a leitura descarta — só os NOMES dos campos, nunca o conteúdo', () => {
    const corpo = {
      object: 'instagram',
      entry: [
        {
          id: '17841400000000001',
          changes: [
            { field: 'comments', value: { id: '1', text: 'normal', media: { id: '2' } } }, // lido: não entra
            { field: 'comments', value: { media_id: '18000000000000001', from: { username: 'segredo.da.pessoa' } } },
            { field: 'comments', value: { id: '3', text: '', media: { id: '4', media_product_type: 'FEED' } } },
            { field: 'live_comments', value: { id: '5' } }, // outro campo: fora
          ],
        },
      ],
    };
    const r = avisosDeComentarioNaoLidos(corpo);
    expect(r).toEqual(['value={from,media_id} media={undefined}', 'value={id,media,text} media={id,media_product_type}']);
    expect(r.join(' ')).not.toContain('segredo');
    expect(avisosDeComentarioNaoLidos({ object: 'page', entry: [] })).toEqual([]);
    expect(avisosDeComentarioNaoLidos(null)).toEqual([]);
  });
});
