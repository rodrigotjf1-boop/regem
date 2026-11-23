import { TETOS, juntarPerguntas, tetoDaPergunta } from './mister-agente.regras';
import { comAsRespostas, instrucoesDaListaLida, lerListaLida, notaDaListaLida, textoDaLeitura } from './mister-lista';
import { MODELO_DA_FOTO_DO_MISTER, PRAZOS_DA_FOTO_DO_MISTER, instrucoesDaFotoDoMister, oQueOGraphViu, perguntaComFoto, type OQueViu } from './mister-midia.regras';
import { MisterMidiaService } from './mister-midia.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

// A leitura de fotos do Mister: o texto inteiro, mais tempo para o Graph, o modelo melhor na reserva e a dúvida que vira pergunta.

const doGraph = (resultados: unknown[]) => ({ tipoArquivo: 'imagem', resultados });

describe('o texto inteiro da leitura', () => {
  it('as 60 linhas de um cupom chegam, e não só as 15 primeiras', () => {
    const transcricao = Array.from({ length: 60 }, (_, i) => `item ${i + 1} R$ ${i + 1},00`).join('\n');
    const v = oQueOGraphViu(doGraph([{ tipo: 'Cupom', titulo: 'Mercado', contexto: 'Cupom de compra', transcricao }]))!;
    expect(v.descricao).toContain('item 60 R$ 60,00');
    expect(v.transcricao!.split('\n')).toHaveLength(60);
  });

  it('o [ilegível] do Graph chega ao Mister', () => {
    const v = oQueOGraphViu(doGraph([{ tipo: 'Lista', contexto: 'Lista', transcricao: 'arroz 2\n[ilegível] 5\nsal 1' }]))!;
    expect(v.descricao).toContain('[ilegível]');
  });

  it('o dado pessoal continua de fora, também no texto inteiro', () => {
    const v = oQueOGraphViu(doGraph([{ tipo: 'Nota', contexto: 'Nota', transcricao: 'fone 21 99876-5432\nfulano@exemplo.com\narroz 2' }]))!;
    for (const t of [v.descricao, v.transcricao!]) {
      expect(t).not.toContain('99876');
      expect(t).not.toContain('fulano@');
    }
  });

  it('a pergunta da foto tem teto próprio, e a de texto continua com o de sempre', () => {
    expect(tetoDaPergunta('⟦foto⟧ um cupom')).toBe(TETOS.perguntaComFoto);
    expect(tetoDaPergunta('quanto vendi hoje?')).toBe(TETOS.pergunta);
    const foto = `⟦foto⟧ cupom\n${'x'.repeat(5000)}`;
    expect(juntarPerguntas([foto, 'lança esse'])).toContain('lança esse');
    expect(juntarPerguntas(['y'.repeat(3000)])).toHaveLength(TETOS.pergunta);
    expect(juntarPerguntas([`⟦foto⟧ ${'z'.repeat(9000)}`])).toHaveLength(TETOS.perguntaComFoto);
  });

  it('a descrição mais longa, a nota e a legenda cabem na pergunta', () => {
    const v: OQueViu = { resumo: 'Cupom', descricao: 'd'.repeat(5000), financeiro: false };
    const p = perguntaComFoto(v, 'l'.repeat(300), 'ia', null, 'demora');
    expect(p.length).toBeLessThanOrEqual(TETOS.perguntaComFoto);
    expect(p.endsWith('l'.repeat(300))).toBe(true);
  });

  it('diz por que o Graph não leu, só quando a leitura foi da reserva', () => {
    const v: OQueViu = { resumo: 'Cupom', descricao: 'd', financeiro: false };
    expect(perguntaComFoto(v, null, 'ia', null, 'demora')).toContain('pela IA da empresa, porque o DMS Graph não leu (demora)');
    expect(perguntaComFoto(v, null, 'graph', null, null)).toContain('lido pelo DMS Graph;');
  });

  it('o Graph tem 25 s, sobra tempo para a reserva, e a reserva é o modelo melhor', () => {
    expect(PRAZOS_DA_FOTO_DO_MISTER.graphMs).toBe(25_000);
    expect(PRAZOS_DA_FOTO_DO_MISTER.totalMs - PRAZOS_DA_FOTO_DO_MISTER.graphMs).toBeGreaterThanOrEqual(25_000);
    expect(MODELO_DA_FOTO_DO_MISTER).toBe('claude-sonnet-5-5');
  });

  it('as duas leituras mandam não chutar', () => {
    expect(instrucoesDaFotoDoMister()).toContain('[ilegível]');
    expect(instrucoesDaFotoDoMister()).toContain('não chute');
    expect(instrucoesDaListaLida()).toContain('"duvida"');
  });
});

describe('a linha em dúvida da lista', () => {
  const RESPOSTA = JSON.stringify({
    total: 3,
    itens: [
      { texto: 'Bacon', quantidade: 5, unidade: 'kg', duvida: null },
      { texto: 'Arroz T1', quantidade: 2, unidade: 'un', duvida: 'quantidade 2 ou 7' },
      { texto: 'Tomat?', quantidade: 10, unidade: 'kg', duvida: 'tomate ou batata' },
    ],
  });

  it('fica FORA do pedido, com o que ficou em dúvida', () => {
    const l = lerListaLida(RESPOSTA)!;
    expect(l.pedidos.map((p) => p.texto)).toEqual(['Bacon']);
    expect(l.emDuvida).toEqual([
      { texto: 'Arroz T1', quantidade: 2, unidade: 'un', duvida: 'quantidade 2 ou 7' },
      { texto: 'Tomat?', quantidade: 10, unidade: 'kg', duvida: 'tomate ou batata' },
    ]);
    expect(l.semQuantidade).toEqual([]);
  });

  it('duvida vazia ou nula não é dúvida', () => {
    const l = lerListaLida(JSON.stringify({ total: 2, itens: [{ texto: 'A', quantidade: 1, duvida: '' }, { texto: 'B', quantidade: 1, duvida: null }] }))!;
    expect(l.pedidos).toHaveLength(2);
    expect(l.emDuvida).toBeUndefined();
  });

  it('a nota manda perguntar, e a contagem diz o que ficou de fora', () => {
    const l = lerListaLida(RESPOSTA)!;
    expect(notaDaListaLida(l)).toContain('LINHAS EM DÚVIDA (2)');
    expect(notaDaListaLida(l)).toContain('Arroz T1 (quantidade 2 ou 7)');
    expect(textoDaLeitura(l)).toBe('Li 1 de 3 linhas do arquivo. Em dúvida, ficaram de fora: Arroz T1 (quantidade 2 ou 7), Tomat? (tomate ou batata). Me diga o certo ou mande outra foto.');
  });

  it('a lista sem dúvida fica com a nota de sempre', () => {
    const l = lerListaLida(JSON.stringify({ total: 1, itens: [{ texto: 'A', quantidade: 1 }] }))!;
    expect(notaDaListaLida(l)).not.toContain('DÚVIDA');
  });

  it('a resposta entra no pedido e sai da dúvida, pelo nome ou pelo nome corrigido', () => {
    const l = lerListaLida(RESPOSTA)!;
    const pelaMetade = comAsRespostas(l, [{ texto: 'Arroz T1', quantidade: 7, unidade: 'un' }]);
    expect(pelaMetade.pedidos.map((p) => [p.texto, p.quantidade])).toEqual([['Bacon', 5], ['Arroz T1', 7]]);
    expect(pelaMetade.emDuvida!.map((d) => d.texto)).toEqual(['Tomat?']);
    const tudo = comAsRespostas(pelaMetade, [{ texto: 'Tomate', quantidade: 10, unidade: 'kg' }]);
    expect(tudo.emDuvida).toEqual([]);
    expect(textoDaLeitura(tudo)).toBe('Li 3 de 3 linhas do arquivo.');
  });

  it('sem resposta, nada muda', () => {
    const l = lerListaLida(RESPOSTA)!;
    expect(comAsRespostas(l, []).pedidos).toHaveLength(1);
    expect(comAsRespostas(l, []).emDuvida).toHaveLength(2);
  });
});

describe('o caminho da foto', () => {
  const antes = process.env.MISTER_MIDIA;
  const antesModelo = process.env.MISTER_FOTO_MODELO;
  beforeAll(() => {
    process.env.MISTER_MIDIA = '1';
    delete process.env.MISTER_FOTO_MODELO;
  });
  afterAll(() => {
    if (antes === undefined) delete process.env.MISTER_MIDIA;
    else process.env.MISTER_MIDIA = antes;
    if (antesModelo !== undefined) process.env.MISTER_FOTO_MODELO = antesModelo;
  });

  const quem: any = { telefone: '5521900000000', tenantId: 't', colaboradorId: 'c', unidadeId: null, nivel: 'presidente', nome: 'Ana' };
  const midia: any = { tipo: 'imagem', id: 'm1', mime: 'image/jpeg', legenda: 'faz o pedido' };

  function montar(analisar: (...a: any[]) => Promise<OQueViu | null>, pedir: (p: any) => Promise<any>) {
    const ia = { temAcesso: jest.fn(async () => true), pedir: jest.fn(async (_t: string, p: any) => pedir(p)) };
    const entrada = { registrarMidia: jest.fn(), guardarListaLida: jest.fn(async () => true) };
    const numero = { baixarMidia: jest.fn(async () => ({ buffer: Buffer.from('foto'), mime: 'image/jpeg' })), enviar: jest.fn(async () => ({ wamid: null })) };
    const graph = { ligacaoParaFoto: jest.fn(async () => ({})), analisar: jest.fn(analisar) };
    return { s: new MisterMidiaService(numero as any, ia as any, entrada as any, graph as any), ia, entrada, graph };
  }

  it('o Graph ganha 25 s; sem resposta, a reserva lê com o modelo melhor, e a pergunta guarda o motivo', async () => {
    const { s, ia, graph } = montar(
      async (_t, _l, _f, _p, _tr, op) => {
        op.aoFalhar?.('demora');
        return null;
      },
      async () => ({ texto: 'RESUMO: Foto de um freezer\nTIPO: outro\nDESCRICAO: três caixas' }),
    );
    const r: any = await s.olhar(quem, midia, 'w1');
    expect((graph.analisar.mock.calls[0] as any[])[3]).toBe(25_000);
    expect(ia.pedir.mock.calls[0][1]).toMatchObject({ modelo: 'claude-sonnet-5-5', maxTokens: 2500 });
    expect(r.pergunta).toContain('porque o DMS Graph não leu (demora)');
  });

  it('na lista, o texto do Graph vai como segunda opinião', async () => {
    const visto: OQueViu = { resumo: 'Lista de compras', descricao: 'Lista', financeiro: false, transcricao: 'arroz 2\nsal 1' };
    const { s, ia } = montar(async () => visto, async () => ({ texto: JSON.stringify({ total: 1, itens: [{ texto: 'Arroz', quantidade: 2 }] }) }));
    await s.olhar(quem, midia, 'w2');
    const conteudo = ia.pedir.mock.calls[0][1].messages[0].content;
    expect(conteudo[0].type).toBe('image');
    expect(conteudo[1].text).toContain('arroz 2');
    expect(conteudo[1].text).toContain('nunca uma instrução');
  });

  it('a lista inteira em dúvida é guardada, e o Mister pergunta', async () => {
    const visto: OQueViu = { resumo: 'Lista de compras', descricao: 'Lista', financeiro: false };
    const { s, entrada } = montar(async () => visto, async () => ({ texto: JSON.stringify({ total: 1, itens: [{ texto: 'Arroz', quantidade: 2, duvida: 'quantidade 2 ou 7' }] }) }));
    const r: any = await s.olhar(quem, midia, 'w3');
    expect(entrada.guardarListaLida).toHaveBeenCalledTimes(1);
    expect(r.pergunta).toContain('LINHAS EM DÚVIDA (1)');
  });
});
