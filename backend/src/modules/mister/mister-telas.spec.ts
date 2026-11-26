import { TEXTOS_DAS_TELAS, pedidoDaLeitura, procurarTelas, recusaDaTela, resultadoDaLeitura } from './mister-telas.service';
import { MOTIVO_NAO_TEM } from './mister-motivo';
import { funcaoDoMapa } from './mapa/busca-no-mapa';
import { FERRAMENTAS, ferramentasDaConversa, podeRodarJunto } from './mister-agente.regras';

/* eslint-disable @typescript-eslint/no-explicit-any */

// Ler qualquer tela (versão 10, C3): a conferência do pedido, sem rede. A leitura de verdade (bilhete, guarda, banco) está
// em `auth/bilhete-do-mister-pg.spec.ts`.

describe('C3 · o pedido de leitura', () => {
  it('só as leituras do Mister: fora do mapa, pessoal, escrita e interna recusam', () => {
    expect(pedidoDaLeitura({ rota: 'GET /api/v1/nao-existe' })).toEqual({ erro: TEXTOS_DAS_TELAS.rotaFora });
    expect(pedidoDaLeitura({ rota: 'GET /api/v1/delivery/pedidos' })).toEqual({ erro: TEXTOS_DAS_TELAS.pessoal });
    expect(pedidoDaLeitura({ rota: 'GET /api/v1/atendimento/fila' })).toEqual({ erro: TEXTOS_DAS_TELAS.pessoal });
    expect(pedidoDaLeitura({ rota: 'POST /api/v1/unidades' })).toEqual({ erro: TEXTOS_DAS_TELAS.naoELeitura });
    expect(pedidoDaLeitura({ rota: 'GET /api/v1/catalogo/publicado' })).toEqual({ erro: TEXTOS_DAS_TELAS.rotaFora });
    expect(pedidoDaLeitura({})).toEqual({ erro: TEXTOS_DAS_TELAS.rotaFora });
  });

  it('o parâmetro do caminho: obrigatório, simples e codificado ("..", barra e espaço recusam)', () => {
    expect(pedidoDaLeitura({ rota: 'GET /api/v1/fichas/{id}' })).toEqual({ erro: expect.stringContaining('"id"') });
    for (const ruim of ['..', '.', 'a/b', 'a b', '%2e%2e', '', 'x'.repeat(81)]) expect(pedidoDaLeitura({ rota: 'GET /api/v1/fichas/{id}', parametros: { id: ruim } })).toHaveProperty('erro');
    expect(pedidoDaLeitura({ rota: 'GET /api/v1/fichas/{id}', parametros: { id: '7d1e-aa_01.x' } })).toMatchObject({ caminho: '/api/v1/fichas/7d1e-aa_01.x' });
  });

  it('a consulta: só os nomes que a tela aceita, em ordem de nome; valor simples', () => {
    expect(pedidoDaLeitura({ rota: 'GET /api/v1/desperdicios', consulta: { tudo: '1' } })).toEqual({ erro: expect.stringContaining('não aceita "tudo"') });
    expect(pedidoDaLeitura({ rota: 'GET /api/v1/desperdicios', consulta: { inicio: { $ne: 1 } } })).toEqual({ erro: expect.stringContaining('simples') });
    expect(pedidoDaLeitura({ rota: 'GET /api/v1/desperdicios', consulta: { fim: '2026-11-26', inicio: '2026-11-01', vazio: '' } })).toMatchObject({
      caminho: '/api/v1/desperdicios?fim=2026-11-26&inicio=2026-11-01',
    });
    expect(pedidoDaLeitura({ rota: 'GET /api/v1/cardapio/cupons' })).toMatchObject({ caminho: '/api/v1/cardapio/cupons', pares: [] });
  });

  it('a busca: sem palavras pede o assunto; achou, manda ler; só pessoal, diz que não sai', () => {
    expect(procurarTelas({})).toEqual({ ok: false, dados: { erro: TEXTOS_DAS_TELAS.semBusca } });
    const achou = procurarTelas({ busca: 'cupons do cardápio' });
    expect(achou.ok).toBe(true);
    expect((achou.dados.achadas as any[])[0].rota).toBe('GET /api/v1/cardapio/cupons');
    // C6: sem tela que sirva, o motivo é "o Regem ainda não tem", com os caminhos.
    expect(procurarTelas({ busca: 'xyzw qwerty' }).dados).toEqual({ achadas: [], siga: TEXTOS_DAS_TELAS.nadaAchado, motivo: 'nao_tem', caminhos: MOTIVO_NAO_TEM.caminhos });
  });

  it('C6: as recusas das telas voltam com o motivo e os caminhos (perfil, dado de pessoa, só na tela, PIN)', () => {
    expect(recusaDaTela(TEXTOS_DAS_TELAS.semPermissao).dados).toMatchObject({ motivo: 'perfil', quemPode: expect.stringContaining('presidente'), caminhos: expect.arrayContaining([expect.stringContaining('Configurações › Acessos & perfis')]) });
    expect(recusaDaTela(TEXTOS_DAS_TELAS.pessoal).dados).toMatchObject({ motivo: 'seguranca' });
    expect(recusaDaTela(TEXTOS_DAS_TELAS.naoELeitura).dados).toMatchObject({ motivo: 'so_na_tela' });
    expect(recusaDaTela(TEXTOS_DAS_TELAS.esperaOPin).dados).toMatchObject({ motivo: 'seguranca' });
    // O que não tem motivo volta só com a frase, como antes.
    expect(recusaDaTela(TEXTOS_DAS_TELAS.semServidor)).toEqual({ ok: false, dados: { erro: TEXTOS_DAS_TELAS.semServidor } });
  });

  it('o resultado vai filtrado, com a frase da tela; sem valores, avisa', () => {
    const f = funcaoDoMapa('GET /api/v1/fornecedores/pendencias')!;
    const r = resultadoDaLeitura(f, 'Loja Centro', [], [{ fornecedor: 'Hortifruti', telefone: '21987654321', valor: 120 }], false);
    expect(r).toEqual({
      ok: true,
      dados: { tela: f.frase, loja: 'Loja Centro', resposta: [{ fornecedor: 'Hortifruti' }], valores: 'Os valores em reais ficam de fora para esta pessoa.' },
    });
  });

  it('as ferramentas: nascem desligadas na conversa (MISTER_LER_TELAS=1 liga); procurar roda junto, ler é consulta', () => {
    const antes = process.env.MISTER_LER_TELAS;
    try {
      delete process.env.MISTER_LER_TELAS;
      expect(ferramentasDaConversa().map((t) => t.name)).not.toEqual(expect.arrayContaining(['procurar_no_regem']));
      expect(ferramentasDaConversa().map((t) => t.name)).not.toContain('ler_no_regem');
      process.env.MISTER_LER_TELAS = '1';
      expect(ferramentasDaConversa().map((t) => t.name)).toEqual(expect.arrayContaining(['procurar_no_regem', 'ler_no_regem']));
    } finally {
      if (antes === undefined) delete process.env.MISTER_LER_TELAS;
      else process.env.MISTER_LER_TELAS = antes;
    }
    expect(FERRAMENTAS.map((t) => t.name)).toEqual(expect.arrayContaining(['procurar_no_regem', 'ler_no_regem']));
    expect(podeRodarJunto('procurar_no_regem')).toBe(true);
    expect(podeRodarJunto('ler_no_regem')).toBe(true);
  });
});
