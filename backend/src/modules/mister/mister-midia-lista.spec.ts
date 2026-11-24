import { TETOS } from './mister-agente.regras';
import { MisterMidiaService } from './mister-midia.service';
import { OQueViu } from './mister-midia.regras';

/* eslint-disable @typescript-eslint/no-explicit-any */

// ERR-584: o PDF com cerca de 36 itens virou uma lista de 11, porque a IA montava com o resumo de 600 letras da foto.
describe('a lista de compras lida de um arquivo', () => {
  const antes = process.env.MISTER_MIDIA;
  beforeAll(() => {
    process.env.MISTER_MIDIA = '1';
  });
  afterAll(() => {
    if (antes === undefined) delete process.env.MISTER_MIDIA;
    else process.env.MISTER_MIDIA = antes;
  });

  const quem: any = { telefone: '5521900000000', tenantId: 't', colaboradorId: 'c', unidadeId: null, nivel: 'presidente', nome: 'Ana' };
  const midia: any = { tipo: 'documento', id: 'm1', mime: 'application/pdf', legenda: 'consegue ler ?' };
  const lista = (n: number) => ({ total: n, itens: Array.from({ length: n }, (_, i) => ({ texto: `Produto ${i + 1}`, quantidade: i + 1, unidade: 'caixas' })) });

  function montar(visto: OQueViu, pedir: (p: any) => Promise<any>, guardou = true) {
    const ia = { temAcesso: jest.fn(async () => true), pedir: jest.fn(pedir) };
    const entrada = { registrarMidia: jest.fn(), guardarListaLida: jest.fn(async () => guardou) };
    const numero = { baixarMidia: jest.fn(async () => ({ buffer: Buffer.from('pdf'), mime: 'application/pdf' })), enviar: jest.fn(async () => ({ wamid: null })) };
    const graph = { ligacaoParaFoto: jest.fn(async () => ({})), analisar: jest.fn(async () => visto) };
    return { s: new MisterMidiaService(numero as any, ia as any, entrada as any, graph as any), ia, entrada };
  }
  const VISTO: OQueViu = { resumo: 'Lista de compras em PDF com cerca de 36 itens', descricao: `Itens: ${'Produto, '.repeat(70)}…`, financeiro: false };

  it('lê todas as linhas à parte, guarda e avisa o agente, sem cortar o que a pessoa escreveu', async () => {
    const { s, ia, entrada } = montar(VISTO, async () => ({ texto: JSON.stringify(lista(36)) }));
    const r: any = await s.olhar(quem, midia, 'w1');
    expect(ia.pedir).toHaveBeenCalledTimes(1);
    expect((ia.pedir.mock.calls as any[])[0][1]).toMatchObject({ maxTokens: 12_000 });
    const guardada = (entrada.guardarListaLida.mock.calls as any[])[0][1];
    expect(guardada.total).toBe(36);
    expect(guardada.pedidos).toHaveLength(36);
    expect(r.pergunta).toContain('LISTA LIDA DO ARQUIVO: 36 de 36 linhas guardadas');
    expect(r.pergunta.length).toBeLessThanOrEqual(TETOS.perguntaComFoto);
    expect(r.pergunta).toContain('A pessoa escreveu junto: consegue ler ?');
  });

  it('a leitura que falha com o resumo cortado diz que não leu tudo: a IA não monta com o trecho', async () => {
    const { s, entrada } = montar(VISTO, async () => ({ texto: '{"total": 36, "itens": [{"texto": "cor' }));
    const r: any = await s.olhar(quem, midia, 'w2');
    expect(entrada.guardarListaLida).not.toHaveBeenCalled();
    expect(r.pergunta).toContain('LISTA NÃO LIDA INTEIRA');
  });

  it('sem conseguir guardar, também avisa', async () => {
    const { s } = montar(VISTO, async () => ({ texto: JSON.stringify(lista(3)) }), false);
    expect(((await s.olhar(quem, midia, 'w3')) as any).pergunta).toContain('LISTA NÃO LIDA INTEIRA');
  });

  it('a leitura que diz "não é lista" não muda a pergunta', async () => {
    const { s, entrada } = montar(VISTO, async () => ({ texto: '{"total": 0, "itens": []}' }));
    expect(((await s.olhar(quem, midia, 'w4')) as any).pergunta).not.toContain('LISTA');
    expect(entrada.guardarListaLida).not.toHaveBeenCalled();
  });

  it('foto que não é lista, boleto ou nota não paga a segunda leitura', async () => {
    const foto = montar({ resumo: 'Freezer com caixas', descricao: 'Prateleiras', financeiro: false }, async () => ({ texto: '' }));
    await foto.s.olhar(quem, { ...midia, legenda: 'está cheio?' }, 'w5');
    expect(foto.ia.pedir).not.toHaveBeenCalled();
    const boleto = montar({ resumo: 'Boleto da lista de compras', descricao: 'Valor', financeiro: true }, async () => ({ texto: '' }));
    await boleto.s.olhar(quem, midia, 'w6');
    expect(boleto.ia.pedir).not.toHaveBeenCalled();
  });
});
