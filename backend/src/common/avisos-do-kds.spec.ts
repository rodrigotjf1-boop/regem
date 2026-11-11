import { TIPOS_DE_AVISO, avisosDoKds, avisosPadrao, ehTipoDeAviso, lerAvisosDoKds } from './avisos-do-kds';

// Os avisos que cada KDS recebe (auditoria do KDS de 11/11/2026, onda 2 — A13; decisão do dono, a recomendada: os de
// gestão desligados nas telas de preparo e ligados no despacho).
describe('avisos do KDS', () => {
  it('preparo: sem os avisos de gestão e sem o "cliente chegou"; o resto ligado', () => {
    expect(avisosPadrao('producao')).toEqual({ loja: true, farol: true, pausa: true, estoque: true, chegou: false, gestao: false });
  });

  it('despacho, entrega e a tela de avisos: tudo ligado', () => {
    for (const escopo of ['despacho', 'entrega', 'avisos'])
      expect(avisosPadrao(escopo)).toEqual({ loja: true, farol: true, pausa: true, estoque: true, chegou: true, gestao: true });
  });

  it('loja com um KDS só (nenhum escolhido): preparo e entrega ao mesmo tempo — só sem os de gestão', () => {
    expect(avisosPadrao(null)).toEqual({ loja: true, farol: true, pausa: true, estoque: true, chegou: true, gestao: false });
    expect(avisosPadrao('')).toEqual(avisosPadrao(undefined));
  });

  it('o salvo vale por cima do padrão; só verdadeiro/falso dos tipos conhecidos', () => {
    expect(avisosDoKds('producao', { gestao: true, chegou: true })).toMatchObject({ gestao: true, chegou: true });
    expect(avisosDoKds('despacho', { estoque: false })).toMatchObject({ estoque: false, gestao: true });
    // lixo não muda nada: tipo desconhecido, valor que não é booleano, lista, nulo
    expect(avisosDoKds('producao', { gestao: 'sim', xyz: false, cancelado: false })).toEqual(avisosPadrao('producao'));
    expect(avisosDoKds('producao', [true])).toEqual(avisosPadrao('producao'));
    expect(avisosDoKds('producao', null)).toEqual(avisosPadrao('producao'));
  });

  it('salvar: cada tipo ligado ou desligado (V15); cancelado e alterado não desligam; ausente fica como está', () => {
    expect(lerAvisosDoKds({ avisos: { gestao: true, pausa: false } })).toEqual({ ok: true, avisos: { gestao: true, pausa: false } });
    expect(lerAvisosDoKds({ avisos: {} })).toEqual({ ok: true, avisos: {} });
    expect(lerAvisosDoKds({ avisos: { gestao: 'true' } })).toMatchObject({ ok: false });
    expect(lerAvisosDoKds({ avisos: { gestao: 1 } })).toMatchObject({ ok: false });
    expect(lerAvisosDoKds({ avisos: { qualquer: true } })).toMatchObject({ ok: false, erro: expect.stringContaining('desconhecido') });
    expect(lerAvisosDoKds({ avisos: { cancelado: false } })).toMatchObject({ ok: false, erro: expect.stringContaining('não desligam') });
    expect(lerAvisosDoKds({ avisos: { alterado: true } })).toMatchObject({ ok: false });
    expect(lerAvisosDoKds({})).toMatchObject({ ok: false });
    expect(lerAvisosDoKds({ avisos: [] })).toMatchObject({ ok: false });
  });

  it('os tipos', () => {
    expect([...TIPOS_DE_AVISO]).toEqual(['loja', 'farol', 'pausa', 'estoque', 'chegou', 'gestao']);
    expect(ehTipoDeAviso('gestao')).toBe(true);
    expect(ehTipoDeAviso('cancelado')).toBe(false);
    expect(ehTipoDeAviso(undefined)).toBe(false);
  });
});
