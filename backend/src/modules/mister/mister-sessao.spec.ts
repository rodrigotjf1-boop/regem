import { CONVERSA_PADRAO, conferirConversa } from './mister-conversa-config.service';
import { PROCEDIMENTOS, TEXTOS_DA_SESSAO, apresentacaoDaProposta } from './mister-procedimentos';
import { estadoDaSessao } from './mister-sessao';

// A SESSÃO COM PIN DO MISTER (versão 6, M6d; mig 476) — o que é puro: o ajuste do presidente (6, 12 ou 24 horas, ou
// desligado), o procedimento do catálogo e o estado lido do banco (com o banco antes da migration). O caminho inteiro
// (o escopo, o link, o PIN do gerente, o botão) está na suíte do Mister com Postgres.

describe('o ajuste da sessão com PIN', () => {
  it('nasce desligado; aceita 6, 12, 24 ou null; recusa o resto', () => {
    expect(CONVERSA_PADRAO.pinACadaH).toBeNull();
    expect(conferirConversa({ pinACadaH: 12 })).toEqual({ pinACadaH: 12 });
    expect(conferirConversa({ pinACadaH: null })).toEqual({ pinACadaH: null });
    for (const torto of [0, 3, 48, '12', true]) expect(conferirConversa({ pinACadaH: torto })).toEqual({ erro: 'Pedir o PIN: escolha 6, 12 ou 24 horas, ou desligado.' });
  });

  it('o procedimento é de PIN, nasce da conversa e tem o texto do link e do botão', () => {
    expect(PROCEDIMENTOS.abrir_sessao).toMatchObject({ nivel: 'pin', tipoDoAviso: null, prazoMin: 15 });
    expect(apresentacaoDaProposta('abrir_sessao').titulo).toBe('Autorizar: liberar os valores e os dados de pessoas no Mister?');
    expect(TEXTOS_DA_SESSAO.link(12, '21:30')).toContain('vale por 12 horas. O link vale até 21:30.');
  });
});

describe('o estado da sessão (a leitura do banco)', () => {
  const banco = (linha: any, erro?: any) => ({ execute: async () => (erro ? Promise.reject(erro) : { rows: linha ? [linha] : [] }) });
  it('desligada, ligada sem PIN e ligada com o PIN valendo', async () => {
    expect(await estadoDaSessao(banco({ horas: null, valida: false }) as any, 't', 'c')).toEqual({ exigida: false, horas: null, valida: true });
    expect(await estadoDaSessao(banco({ horas: 12, valida: false }) as any, 't', 'c')).toEqual({ exigida: true, horas: 12, valida: false });
    expect(await estadoDaSessao(banco({ horas: 6, valida: true }) as any, 't', 'c')).toEqual({ exigida: true, horas: 6, valida: true });
    // um número fora da lista no banco vale como desligado
    expect(await estadoDaSessao(banco({ horas: 7, valida: false }) as any, 't', 'c')).toEqual({ exigida: false, horas: null, valida: true });
  });
  it('sem a migration (coluna ou tabela faltando): não exige — o comportamento de antes; outro erro sobe', async () => {
    expect(await estadoDaSessao(banco(null, { code: '42703' }) as any, 't', 'c')).toEqual({ exigida: false, horas: null, valida: true });
    expect(await estadoDaSessao(banco(null, { code: '42P01' }) as any, 't', 'c')).toEqual({ exigida: false, horas: null, valida: true });
    await expect(estadoDaSessao(banco(null, new Error('banco fora')) as any, 't', 'c')).rejects.toThrow('banco fora');
  });
});
