import { createHash } from 'crypto';
import {
  NECESSARIAS_DO_CLIQUE,
  OPCIONAIS_DO_CLIQUE,
  codigoValido,
  emissorDoOrzuni,
  estadoValido,
  fraseDaVolta,
  lerVolta,
  novoPedido,
  numeroValido,
  permissoesDoPedido,
  resumoDoEstado,
  urlDaPagina,
  voltaDoRegem,
} from './orzuni-clique.regras';

// O CLIQUE REGEM → ORZUNI (mig 416) — as peças sem banco: o pedido, o PKCE, a volta e as frases.

describe('o clique Regem → Orzuni (regras)', () => {
  it('o pedido novo: state e verificador de 43 caracteres, o desafio é o SHA-256 do verificador', () => {
    const p = novoPedido();
    expect(estadoValido(p.estado)).toBe(true);
    expect(p.verificador).toHaveLength(43);
    expect(p.desafio).toBe(createHash('sha256').update(p.verificador, 'ascii').digest('base64url'));
    expect(novoPedido().estado).not.toBe(p.estado);
    expect(resumoDoEstado(p.estado)).toMatch(/^[0-9a-f]{64}$/);
    expect(resumoDoEstado(p.estado)).not.toContain(p.estado);
  });

  it('as formas: o código e o número do Orzuni; o resto não', () => {
    expect(codigoValido(`orz_ac_${'a'.repeat(43)}`)).toBe(true);
    expect(codigoValido(`rgm_ac_${'a'.repeat(43)}`)).toBe(false);
    expect(numeroValido(`urn:ietf:params:oauth:request_uri:orz_${'b'.repeat(43)}`)).toBe(true);
    expect(numeroValido(`urn:ietf:params:oauth:request_uri:rgm_${'b'.repeat(43)}`)).toBe(false);
    expect(estadoValido('curto')).toBe(false);
  });

  it('a volta do Regem é a que o Orzuni tem cadastrada; APP_URL vazio cai no padrão (V58)', () => {
    expect(voltaDoRegem({})).toBe('https://app.dmsregem.com/integracoes/orzuni/volta');
    expect(voltaDoRegem({ APP_URL: '' })).toBe('https://app.dmsregem.com/integracoes/orzuni/volta');
    expect(voltaDoRegem({ APP_URL: 'https://homolog.exemplo.com/' })).toBe('https://homolog.exemplo.com/integracoes/orzuni/volta');
  });

  it('o emissor que a volta tem de trazer é a origem da porta do Orzuni', () => {
    expect(emissorDoOrzuni('https://api.orzuni.com/v1/mcp')).toBe('https://api.orzuni.com');
  });

  it('modo novo pede tudo (o dono liga as opcionais no Orzuni); "pedir mais" só as opcionais novas marcadas', () => {
    expect(permissoesDoPedido('novo', [], undefined)).toEqual([...NECESSARIAS_DO_CLIQUE, ...OPCIONAIS_DO_CLIQUE]);
    expect(permissoesDoPedido('mais', ['catalogo.ler', 'preco.escrever', 'status.escrever', 'loja.ler'], ['loja.ler', 'loja.escrever', 'vigia.ler'])).toEqual([
      'loja.escrever',
    ]);
    expect(permissoesDoPedido('mais', [], 'loja.escrever')).toEqual([]);
  });

  it('a página: o endereço que o Orzuni devolveu, só https; senão o padrão — com o aplicativo e o número', () => {
    const numero = `urn:ietf:params:oauth:request_uri:orz_${'c'.repeat(43)}`;
    const u = new URL(urlDaPagina('https://app.orzuni.com/autorizar', 'app-1', numero, {}));
    expect(`${u.origin}${u.pathname}`).toBe('https://app.orzuni.com/autorizar');
    expect(u.searchParams.get('client_id')).toBe('app-1');
    expect(u.searchParams.get('request_uri')).toBe(numero);
    expect(urlDaPagina('http://malicioso.example/x', 'app-1', numero, {}).startsWith('https://app.orzuni.com/autorizar?')).toBe(true);
    expect(urlDaPagina('https://user:senha@outro.example/x', 'app-1', numero, {}).startsWith('https://app.orzuni.com/autorizar?')).toBe(true);
    expect(urlDaPagina(undefined, 'app-1', numero, { ORZUNI_APP_URL: 'https://homolog.orzuni.test' }).startsWith('https://homolog.orzuni.test/autorizar?')).toBe(true);
  });

  it('a volta lida sem confiar: só textos curtos', () => {
    expect(lerVolta({ code: 'c', state: 's', iss: 'i', error: undefined })).toEqual({ code: 'c', state: 's', iss: 'i', error: null });
    expect(lerVolta({ code: ['a'], state: 1, iss: 'x'.repeat(500) })).toEqual({ code: null, state: null, iss: null, error: null });
    expect(lerVolta(null)).toEqual({ code: null, state: null, iss: null, error: null });
  });

  it('cada volta sem ligação tem a sua frase (mockup aprovado, vista 6)', () => {
    expect(fraseDaVolta('access_denied')).toContain('não autorizou');
    expect(fraseDaVolta('invalid_request_uri')).toContain('venceu');
    expect(fraseDaVolta('outra_sessao')).toContain('não é de um pedido aberto por você');
    expect(fraseDaVolta('emissor')).toContain('não veio do Orzuni');
  });
});
