import {
  ConsultaIbptRecusada,
  IbptIndisponivel,
  URL_API_IBPT,
  consultarNcmIbpt,
  lerRespostaIbpt,
  tokenIbptPlausivel,
} from './ibpt-api';

/* eslint-disable @typescript-eslint/no-explicit-any */

// Cliente do webservice do IBPT (token do lojista, mig 292) — sem rede: o `fetch` é injetado.
const TOKEN = 'TokenSecretoDoLojista_1234567890abcdef';
const consulta = { token: TOKEN, cnpj: '12.345.678/0001-95', uf: 'rj', ncm: '2106.90.90' };

// Como o IBPT responde (PascalCase, datas DD/MM/AAAA).
const RESPOSTA = {
  Codigo: '21069090',
  UF: 'RJ',
  EX: 0,
  Descricao: 'Outras preparações alimentícias',
  Nacional: 13.45,
  Estadual: 22,
  Importado: 15.45,
  Municipal: 0,
  Tipo: '0',
  VigenciaInicio: '20/09/2026',
  VigenciaFim: '31/10/2026',
  Chave: 'C44399',
  Versao: '26.2.B',
  Fonte: 'IBPT/empresometro.com.br',
};

const resposta = (status: number, corpo?: any) =>
  new Response(corpo === undefined ? null : JSON.stringify(corpo), {
    status,
    headers: { 'content-type': 'application/json' },
  });

describe('webservice do IBPT (token do lojista)', () => {
  it('monta a consulta com o CNPJ só em dígitos, exceção 0 e dados genéricos do item', async () => {
    const buscar = jest.fn(async () => resposta(200, RESPOSTA));
    const r = await consultarNcmIbpt(consulta, buscar as any);
    const [url, init] = (buscar.mock.calls[0] as any[]) ?? [];
    const u = new URL(String(url));
    expect(`${u.origin}${u.pathname}`).toBe(URL_API_IBPT);
    expect(Object.fromEntries(u.searchParams)).toEqual({
      token: TOKEN,
      cnpj: '12345678000195',
      codigo: '21069090',
      uf: 'RJ',
      ex: '0',
      codigoInterno: '',
      descricao: 'ITEM',
      unidadeMedida: 'UN',
      valor: '1.00',
      gtin: 'SEM GTIN',
    });
    expect(init.headers).toEqual({ Accept: 'application/json' });
    expect(r).toEqual({
      ncm: '21069090',
      uf: 'RJ',
      ex: '',
      versao: '26.2.B',
      chave: 'C44399',
      fonte: 'IBPT/empresometro.com.br',
      vigenciaInicio: '2026-09-20',
      vigenciaFim: '2026-10-31',
      nacionalFederal: 13.45,
      importadosFederal: 15.45,
      estadual: 22,
      municipal: 0,
    });
  });

  it('aceita número com vírgula, data ISO, caixa diferente e resposta em lista', () => {
    const r = lerRespostaIbpt(
      [{ codigo: '22021000', uf: 'RJ', ex: '', nacional: '17,05', estadual: '20', importado: '19,05', municipal: '0',
         vigenciainicio: '2026-09-20T00:00:00', vigenciafim: '2026-10-31T00:00:00', chave: 'C44399', versao: '26.2.B', fonte: 'IBPT' }],
      { uf: 'RJ', ncm: '22021000' },
    );
    expect(r).toMatchObject({ nacionalFederal: 17.05, importadosFederal: 19.05, vigenciaInicio: '2026-09-20', vigenciaFim: '2026-10-31' });
  });

  it('NCM que o IBPT não conhece = null; recusa = ConsultaIbptRecusada; resto = IbptIndisponivel', async () => {
    expect(await consultarNcmIbpt(consulta, (async () => resposta(404)) as any)).toBeNull();
    expect(await consultarNcmIbpt(consulta, (async () => resposta(200, {})) as any)).toBeNull();
    for (const s of [400, 401, 403])
      await expect(consultarNcmIbpt(consulta, (async () => resposta(s, { Message: 'Dados da requisição inválidos.' })) as any))
        .rejects.toBeInstanceOf(ConsultaIbptRecusada);
    await expect(consultarNcmIbpt(consulta, (async () => resposta(503)) as any)).rejects.toBeInstanceOf(IbptIndisponivel);
    // Alíquota absurda ou NCM trocado: não grava lixo na tabela.
    await expect(consultarNcmIbpt(consulta, (async () => resposta(200, { ...RESPOSTA, Estadual: 'x' })) as any))
      .rejects.toBeInstanceOf(IbptIndisponivel);
    await expect(consultarNcmIbpt(consulta, (async () => resposta(200, { ...RESPOSTA, Codigo: '22021000' })) as any))
      .rejects.toBeInstanceOf(IbptIndisponivel);
  });

  it('o token NUNCA aparece na mensagem de erro — nem quando o fetch cita a URL', async () => {
    const erros: any[] = [];
    const vazaUrl = async (url: string) => {
      throw new TypeError(`fetch failed: ${url}`);
    };
    for (const buscar of [vazaUrl, async () => resposta(400, { Message: `token ${TOKEN} inválido` }), async () => resposta(500)]) {
      try {
        await consultarNcmIbpt(consulta, buscar as any);
      } catch (e) {
        erros.push(e);
      }
    }
    expect(erros).toHaveLength(3);
    for (const e of erros) {
      expect(String(e?.message)).not.toContain(TOKEN);
      expect(JSON.stringify(e)).not.toContain(TOKEN);
    }
    expect(erros[0]).toBeInstanceOf(IbptIndisponivel);
    expect(erros[0].message).toBe('Sem conexão com o IBPT.');
  });

  it('formato do token antes de gastar uma chamada', () => {
    expect(tokenIbptPlausivel(TOKEN)).toBe(true);
    expect(tokenIbptPlausivel('curto')).toBe(false);
    expect(tokenIbptPlausivel('tem espaço no meio do token 123456')).toBe(false);
    expect(tokenIbptPlausivel('')).toBe(false);
  });
});
