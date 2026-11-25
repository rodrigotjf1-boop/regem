import { apresentacaoDoPonto, conferirPonto, lerHora, lerTipoDeMarcacao, marcacoesDoDia, resumoDoPonto } from './mister-acoes-ponto';
import { ACOES, conferirAcao } from './mister-acoes';

const AGORA = { hoje: '2026-11-24', hora: '22:00' };
const base = { pessoaDoPonto: 'Bruna', tipoDaMarcacao: 'saida', diaDaMarcacao: '2026-11-23', horaDaMarcacao: '23:10', motivoDoPonto: 'esqueceu de bater' };

describe('o ajuste de ponto pela conversa (etapa 5 de 24/11)', () => {
  it('as duas são de PIN, pelas permissões de Gerenciamento de ponto (incluir = criar; desconsiderar = editar)', () => {
    expect(ACOES.incluir_marcacao).toMatchObject({ nivel: 'pin', permissao: 'ponto', crud: 'criar' });
    expect(ACOES.desconsiderar_marcacao).toMatchObject({ nivel: 'pin', permissao: 'ponto', crud: 'editar' });
  });

  it('o tipo e a hora pelo que a pessoa diz', () => {
    expect(lerTipoDeMarcacao('entrada')).toBe('entrada');
    expect(lerTipoDeMarcacao('chegada')).toBe('entrada');
    expect(lerTipoDeMarcacao('saída')).toBe('saida');
    expect(lerTipoDeMarcacao('saida')).toBe('saida');
    expect(lerTipoDeMarcacao('saída para o almoço')).toBe('intervalo_inicio');
    expect(lerTipoDeMarcacao('intervalo_inicio')).toBe('intervalo_inicio');
    expect(lerTipoDeMarcacao('volta do intervalo')).toBe('intervalo_fim');
    expect(lerTipoDeMarcacao('intervalo_fim')).toBe('intervalo_fim');
    expect(lerTipoDeMarcacao('café')).toBeNull();
    expect(lerHora('9:05')).toBe('09:05');
    expect(lerHora('21h30')).toBe('21:30');
    expect(lerHora('24:00')).toBeNull();
    expect(lerHora('amanhã')).toBeNull();
  });

  it('a conferência: pessoa, tipo para incluir, dia (nem futuro nem mais de 31 dias), hora (nem depois de agora) e motivo', () => {
    expect(conferirPonto('incluir_marcacao', base, AGORA)).toEqual({
      parametros: { acao: 'incluir_marcacao', pessoa: 'Bruna', tipo: 'saida', dia: '2026-11-23', hora: '23:10', motivo: 'esqueceu de bater' },
      resumo: 'Incluir a saída de Bruna em 23/11 às 23:10 (motivo: esqueceu de bater).',
    });
    expect(conferirPonto('incluir_marcacao', { ...base, tipoDaMarcacao: undefined }, AGORA)).toEqual({ erro: 'Diga qual marcação incluir: entrada, saída, saída para o intervalo ou volta do intervalo.' });
    expect(conferirPonto('incluir_marcacao', { ...base, pessoaDoPonto: '' }, AGORA)).toEqual({ erro: 'Diga de quem é o ponto (o nome da pessoa).' });
    expect(conferirPonto('incluir_marcacao', { ...base, diaDaMarcacao: '2026-11-25' }, AGORA)).toEqual({ erro: 'O ponto não se ajusta para um dia que ainda não chegou.' });
    expect(conferirPonto('incluir_marcacao', { ...base, diaDaMarcacao: '2026-10-20' }, AGORA)).toEqual({ erro: 'Ajuste de mais de 31 dias atrás fica na tela (Pessoas › Gerenciamento de ponto).' });
    expect(conferirPonto('incluir_marcacao', { ...base, diaDaMarcacao: undefined, horaDaMarcacao: '22:30' }, AGORA)).toEqual({ erro: 'A hora ainda não chegou: o ponto não se ajusta para depois de agora.' });
    expect(conferirPonto('incluir_marcacao', { ...base, horaDaMarcacao: 'à noite' }, AGORA)).toEqual({ erro: 'Diga a hora da marcação (ex.: 18:05).' });
    expect(conferirPonto('incluir_marcacao', { ...base, motivoDoPonto: 'ok' }, AGORA)).toEqual({ erro: 'Diga o motivo do ajuste (ele vai para o registro do ponto e para a auditoria).' });
    // Desconsiderar: o tipo é opcional (quando há duas na mesma hora).
    expect(conferirPonto('desconsiderar_marcacao', { ...base, tipoDaMarcacao: undefined, motivoDoPonto: 'bateu duas vezes' }, AGORA)).toEqual({
      parametros: { acao: 'desconsiderar_marcacao', pessoa: 'Bruna', tipo: null, dia: '2026-11-23', hora: '23:10', motivo: 'bateu duas vezes' },
      resumo: 'Desconsiderar a marcação de Bruna de 23/11 às 23:10 (motivo: bateu duas vezes).',
    });
    expect(conferirAcao('incluir_marcacao', { ...base, diaDaMarcacao: '2020-01-01' })).toMatchObject({ erro: expect.stringContaining('fica na tela') });
  });

  it('as marcações do dia, o resumo (Portaria 671) e a página do PIN', () => {
    const doDia = marcacoesDoDia([
      { tipo: 'entrada', hora: '18:02', origem: 'terminal' },
      { tipo: 'saida', hora: '23:40', origem: 'ajuste' },
      { tipo: 'saida', hora: '23:41', origem: 'terminal', desconsiderada: true },
    ]);
    expect(doDia).toBe('entrada 18:02, saída 23:40 (ajuste), saída 23:41 (desconsiderada)');
    expect(marcacoesDoDia([])).toBe('nenhuma marcação');
    const incluir = conferirPonto('incluir_marcacao', base, AGORA) as any;
    expect(resumoDoPonto(incluir.parametros, 'Bruna Lima', 'entrada 18:02')).toBe(
      'Incluir a saída de Bruna Lima em 23/11 às 23:10 (motivo: esqueceu de bater). No dia já tem: entrada 18:02. Entra como marcação de ajuste, com o seu NSR; as que já existem ficam como estão.',
    );
    const descons = { acao: 'desconsiderar_marcacao' as const, pessoa: 'Bruna', tipo: 'saida' as const, dia: '2026-11-23', hora: '23:41', motivo: 'bateu duas vezes' };
    expect(resumoDoPonto(descons, 'Bruna Lima', doDia)).toContain('A marcação continua no registro do ponto (AFD); só deixa de contar no espelho.');
    expect(apresentacaoDoPonto({ ...incluir.parametros, nomeDaPessoa: 'Bruna Lima', doDia: 'entrada 18:02' })).toEqual({
      titulo: 'Incluir a marcação de ponto',
      itens: ['Pessoa: Bruna Lima', 'Marcação: saída', 'Dia e hora: 23/11 às 23:10', 'Motivo: esqueceu de bater', 'No dia: entrada 18:02'],
      detalhe: 'Portaria 671: entra como marcação nova de ajuste, com NSR; nenhuma marcação é apagada.',
      valor: null,
      botao: 'Incluir',
    });
    expect(apresentacaoDoPonto({ ...descons, nomeDaPessoa: 'Bruna Lima', doDia })).toMatchObject({ titulo: 'Desconsiderar a marcação de ponto', botao: 'Desconsiderar' });
  });
});
