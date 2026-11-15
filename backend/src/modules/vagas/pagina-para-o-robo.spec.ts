import { paginaPadrao } from './vagas';
import { baseDoApp, resumoDasVagasParaORobo } from './pagina-para-o-robo';

// F3 de Vagas: o resumo que o robô explica no assunto "vaga" — só o que a página pública mostra.
describe('a página de vagas para o robô — o resumo', () => {
  it('as funções abertas com o salário, as escalas ligadas, os benefícios e a idade mínima', () => {
    const p = paginaPadrao();
    p.funcoes = [
      { codigo: 'chapeiro', nome: 'Chapeiro(a)', salario: 'R$ 1.900,00', lideranca: false, aberta: true },
      { codigo: 'auxiliar', nome: 'Auxiliar de cozinha', salario: '', lideranca: false, aberta: true },
      { codigo: 'gerencia', nome: 'Gerência', salario: 'R$ 2.500,00', lideranca: true, aberta: false },
    ];
    p.beneficios = ['Vale-refeição', ' ', 'Folga no aniversário'];
    p.horarios['12x36'] = { ativa: true, inicio: '15:00', fim: '03:00' };
    p.horarios['5x2'] = { ativa: false, inicio: '19:00', fim: '03:00' };
    p.horarios.horista = { ativa: true, inicio: '19:30', fim: '03:00', dias: ['sex', 'sab', 'dom'] };
    p.idadeMinima = 18;
    expect(resumoDasVagasParaORobo(p)).toBe(
      'Funções abertas: Chapeiro(a) (R$ 1.900,00), Auxiliar de cozinha. Escalas: 12x36, das 15h às 03h; horista (sex, sáb, dom), das 19h30 às 03h. Benefícios: Vale-refeição, Folga no aniversário. Idade mínima: 18 anos.',
    );
  });

  it('sem vaga fixa nem horista, sem benefícios: só as funções; o texto longo é cortado', () => {
    const p = paginaPadrao();
    p.vagaFixa = false;
    p.horista = false;
    p.beneficios = [];
    p.idadeMinima = 0;
    p.funcoes = [{ codigo: 'a', nome: 'Atendimento', salario: '', lideranca: false, aberta: true }];
    expect(resumoDasVagasParaORobo(p)).toBe('Funções abertas: Atendimento.');
    p.beneficios = ['x'.repeat(900)];
    const longo = resumoDasVagasParaORobo(p);
    expect(longo.length).toBeLessThanOrEqual(700);
    expect(longo.endsWith('…')).toBe(true);
  });

  it('o endereço do app vem do APP_URL, sem a barra do fim', () => {
    const antes = process.env.APP_URL;
    try {
      process.env.APP_URL = 'https://app.exemplo.test/';
      expect(baseDoApp()).toBe('https://app.exemplo.test');
      delete process.env.APP_URL;
      expect(baseDoApp()).toBe('https://app.dmsregem.com');
    } finally {
      if (antes === undefined) delete process.env.APP_URL;
      else process.env.APP_URL = antes;
    }
  });
});
