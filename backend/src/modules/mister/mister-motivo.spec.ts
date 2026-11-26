import { perfilPadrao } from '../../auth/permissoes';
import { TEXTOS_DAS_ACOES } from './mister-acoes';
import { podeFazer, recusaPeloPerfil } from './mister-acoes-perfil';
import { ACOES } from './mister-acoes';
import { CAMINHO_DO_PERFIL, MOTIVOS_DA_RECUSA, MOTIVO_DO_PIN, PORQUE_DA_RECUSA, comMotivo, motivoDoPerfil } from './mister-motivo';

/* eslint-disable @typescript-eslint/no-explicit-any */

// Versão 10, C6: quando não dá, o motivo e os caminhos — e a conferência do perfil das ações, pura (a avaliação usa a mesma).

const GERENTE = { nivel: 'gerente', verValores: false, permissoes: perfilPadrao('gerente').permissoes };
const PRESIDENTE = { nivel: 'presidente', verValores: true, permissoes: null };

describe('C6 · o motivo e os caminhos', () => {
  it('cada motivo tem o porquê; a recusa leva o motivo, o porquê, até 4 caminhos e quem pode', () => {
    for (const m of MOTIVOS_DA_RECUSA) expect(PORQUE_DA_RECUSA[m].length).toBeGreaterThan(10);
    const r = comMotivo('Não dá.', { motivo: 'perfil', quemPode: 'o presidente', caminhos: ['a', 'b', 'c', 'd', 'e'] });
    expect(r).toEqual({ ok: false, dados: { erro: 'Não dá.', motivo: 'perfil', porQue: PORQUE_DA_RECUSA.perfil, caminhos: ['a', 'b', 'c', 'd'], quemPode: 'o presidente' } });
    expect(comMotivo('x', MOTIVO_DO_PIN).dados).not.toHaveProperty('quemPode');
  });

  it('o perfil: quem pode e o caminho do menu de quem muda o perfil (conferido no shell.tsx)', () => {
    expect(motivoDoPerfil('o presidente')).toEqual({ motivo: 'perfil', quemPode: 'o presidente', caminhos: ['quem pode fazer: o presidente', CAMINHO_DO_PERFIL] });
    expect(CAMINHO_DO_PERFIL).toContain('Configurações › Acessos & perfis');
  });
});

describe('C6 · a conferência do perfil das ações (a mesma do serviço e da avaliação)', () => {
  it('o presidente faz tudo; o gerente padrão não faz o que pede financeiro ou valores', () => {
    for (const a of Object.keys(ACOES) as Array<keyof typeof ACOES>) expect([a, recusaPeloPerfil(PRESIDENTE, a)]).toEqual([a, null]);
    expect(podeFazer(GERENTE, ACOES.pausar_canal)).toBe(true);
    expect(recusaPeloPerfil(GERENTE, 'pausar_canal')).toBeNull();
  });

  it('o dado da empresa inteira é só do presidente: o gerente recebe o motivo do perfil, com quem pode', () => {
    expect(recusaPeloPerfil(GERENTE, 'informar_saldo')).toEqual({ erro: TEXTOS_DAS_ACOES.dadoSoPresidente, motivo: motivoDoPerfil('o presidente') });
    expect(recusaPeloPerfil({ ...PRESIDENTE, presa: 'loja-1' }, 'informar_saldo')).toEqual({ erro: TEXTOS_DAS_ACOES.dadoEmpresaInteira, motivo: motivoDoPerfil('o presidente da empresa inteira') });
  });

  it('sem a permissão da rota: a frase de sempre e o motivo do perfil', () => {
    const r = recusaPeloPerfil(GERENTE, 'pagar_conta');
    expect(r?.erro).toBe(TEXTOS_DAS_ACOES.semPermissaoConta);
    expect(r?.motivo).toMatchObject({ motivo: 'perfil', quemPode: expect.stringContaining('presidente') });
    expect(recusaPeloPerfil(GERENTE, 'mudar_preco')?.erro).toBe(TEXTOS_DAS_ACOES.semPermissaoPreco);
  });

  it('com a permissão, mas o PIN da sessão vencido (sem valores): o motivo é a segurança, com o link do PIN', () => {
    const comPermissao = { nivel: 'gerente', verValores: false, permissoes: { ...perfilPadrao('gerente').permissoes, financeiro: true, ver_financeiro: true } };
    expect(recusaPeloPerfil(comPermissao, 'pagar_conta')).toEqual({ erro: TEXTOS_DAS_ACOES.contaPedePin, motivo: MOTIVO_DO_PIN });
    expect(recusaPeloPerfil({ ...PRESIDENTE, verValores: false }, 'informar_folha')).toEqual({ erro: TEXTOS_DAS_ACOES.dadoPedePin, motivo: MOTIVO_DO_PIN });
  });

  it('Banco e repasses é só do presidente, mesmo com a permissão e os valores', () => {
    const comTudo = { nivel: 'gerente', verValores: true, permissoes: { ...perfilPadrao('gerente').permissoes, financeiro: true, ver_financeiro: true } };
    expect(recusaPeloPerfil(comTudo, 'classificar_banco')).toEqual({ erro: TEXTOS_DAS_ACOES.bancoSoPresidente, motivo: motivoDoPerfil('o presidente') });
  });
});
