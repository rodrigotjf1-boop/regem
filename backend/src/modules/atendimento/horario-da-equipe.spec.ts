import { BadRequestException } from '@nestjs/common';
import {
  AJUSTE_DA_EQUIPE_PADRAO,
  FRASE_FORA_PADRAO,
  VOLTA_SEM_DATA,
  ajusteDaLinha,
  fraseForaDoHorario,
  janelasDeOnde,
  lerAjusteDaEquipe,
  lerRecado,
  recadoAtivo,
  respostaDoRecado,
  situacaoPura,
  textoDaVolta,
} from './horario-da-equipe';
import { situacaoDo, posicoes } from './fila';

// O HORÁRIO DA EQUIPE (mig 379 — protótipo `mockups/regem-central-atendimento.html` v10): a conta pura. Toda data entra
// em UTC (`...Z`) e a conta é no fuso da operação — o processo pode estar em qualquer fuso (V46).

// 2026-11-09 é segunda-feira; São Paulo = UTC−3 (sem horário de verão).
const sp = (diaHora: string) => new Date(`${diaHora}-03:00`);
const loja = (janelas: unknown[], extra: Partial<typeof AJUSTE_DA_EQUIPE_PADRAO> = {}) => ({
  janelas,
  ajuste: { ...AJUSTE_DA_EQUIPE_PADRAO, atende: 'loja' as const, ...extra },
});
const SEG_18_23 = [{ dia: 1, ativo: true, abre: '18:00', fecha: '23:00' }];

describe('horário da equipe — a conta', () => {
  it('"Sempre (como hoje)": sempre atendendo, qualquer hora', () => {
    expect(situacaoPura(SEG_18_23, AJUSTE_DA_EQUIPE_PADRAO, sp('2026-11-09T03:00'))).toEqual({ atendendo: true, voltaEm: null });
  });

  it('no horário da loja SEM nenhuma janela ativa cadastrada: atendendo (como hoje)', () => {
    const { ajuste } = loja([]);
    expect(situacaoPura([], ajuste, sp('2026-11-09T03:00')).atendendo).toBe(true);
    expect(situacaoPura(null, ajuste, sp('2026-11-09T03:00')).atendendo).toBe(true);
    expect(situacaoPura([{ dia: 1, ativo: false, abre: '18:00', fecha: '23:00' }], ajuste, sp('2026-11-09T03:00')).atendendo).toBe(true);
    // lixo no jsonb não conta como janela
    expect(situacaoPura([{ dia: 9, ativo: true, abre: '18:00', fecha: '23:00' }, { dia: 1, ativo: true, abre: '8h', fecha: '23:00' }], ajuste, sp('2026-11-09T03:00')).atendendo).toBe(true);
  });

  it('começa ANTES de abrir e para DEPOIS de fechar (30 min antes, 1 h depois — o padrão)', () => {
    const { janelas, ajuste } = loja(SEG_18_23);
    const s1729 = situacaoPura(janelas, ajuste, sp('2026-11-09T17:29'));
    expect(s1729.atendendo).toBe(false);
    expect(s1729.voltaEm?.toISOString()).toBe(sp('2026-11-09T17:30').toISOString());
    expect(situacaoPura(janelas, ajuste, sp('2026-11-09T17:30')).atendendo).toBe(true);
    expect(situacaoPura(janelas, ajuste, sp('2026-11-09T23:59')).atendendo).toBe(true);
    const meiaNoite = situacaoPura(janelas, ajuste, sp('2026-11-10T00:00'));
    expect(meiaNoite.atendendo).toBe(false);
    // a próxima segunda (6 dias depois), 17:30
    expect(meiaNoite.voltaEm?.toISOString()).toBe(sp('2026-11-16T17:30').toISOString());
  });

  it('"quando a loja abre" e "quando a loja fecha" (0 e 0): a janela exata', () => {
    const { janelas, ajuste } = loja(SEG_18_23, { antesMin: 0, depoisMin: 0 });
    expect(situacaoPura(janelas, ajuste, sp('2026-11-09T17:59')).atendendo).toBe(false);
    expect(situacaoPura(janelas, ajuste, sp('2026-11-09T18:00')).atendendo).toBe(true);
    expect(situacaoPura(janelas, ajuste, sp('2026-11-09T22:59')).atendendo).toBe(true);
    expect(situacaoPura(janelas, ajuste, sp('2026-11-09T23:00')).atendendo).toBe(false);
  });

  it('janela que passa da meia-noite pertence ao dia em que ABRE (sexta 18:00–02:00, 2 h depois)', () => {
    const { janelas, ajuste } = loja([{ dia: 5, ativo: true, abre: '18:00', fecha: '02:00' }], { antesMin: 60, depoisMin: 120 });
    // sábado 03:59 ainda é a sexta (fecha 02:00 + 2 h)
    expect(situacaoPura(janelas, ajuste, sp('2026-11-14T03:59')).atendendo).toBe(true);
    const s = situacaoPura(janelas, ajuste, sp('2026-11-14T04:00'));
    expect(s.atendendo).toBe(false);
    expect(s.voltaEm?.toISOString()).toBe(sp('2026-11-20T17:00').toISOString()); // a próxima sexta, 1 h antes
    // no sábado em si não há janela: a de sábado 18:00 não existe
    expect(situacaoPura(janelas, ajuste, sp('2026-11-14T18:30')).atendendo).toBe(false);
  });

  it('a volta é o começo da PRÓXIMA janela (dois turnos no mesmo dia, e o dia seguinte)', () => {
    const { janelas, ajuste } = loja(
      [
        { dia: 1, ativo: true, abre: '11:00', fecha: '14:00' },
        { dia: 1, ativo: true, abre: '18:00', fecha: '23:00' },
        { dia: 2, ativo: true, abre: '11:00', fecha: '14:00' },
      ],
      { antesMin: 30, depoisMin: 30 },
    );
    expect(situacaoPura(janelas, ajuste, sp('2026-11-09T15:00')).voltaEm?.toISOString()).toBe(sp('2026-11-09T17:30').toISOString());
    expect(situacaoPura(janelas, ajuste, sp('2026-11-09T23:45')).voltaEm?.toISOString()).toBe(sp('2026-11-10T10:30').toISOString());
  });

  it('o instante entra em UTC e a conta não depende do fuso do processo (V46)', () => {
    const antes = process.env.TZ;
    try {
      const { janelas, ajuste } = loja(SEG_18_23);
      const agora = new Date('2026-11-09T20:29:00Z'); // 17:29 em São Paulo
      for (const tz of ['UTC', 'Asia/Tokyo', 'America/Los_Angeles', 'America/Sao_Paulo']) {
        process.env.TZ = tz;
        const s = situacaoPura(janelas, ajuste, agora);
        expect({ tz, ...s, voltaEm: s.voltaEm?.toISOString() }).toEqual({ tz, atendendo: false, voltaEm: '2026-11-09T20:30:00.000Z' });
        expect(textoDaVolta(s.voltaEm, agora)).toBe('hoje às 17:30');
      }
    } finally {
      if (antes === undefined) delete process.env.TZ;
      else process.env.TZ = antes;
    }
  });

  it('o deslocamento do fuso vem da DATA, não de um −3 fixo (nov/2018 tinha horário de verão: UTC−2)', () => {
    const { janelas, ajuste } = loja(SEG_18_23, { antesMin: 0 });
    // 2018-11-05 (segunda): 18:00 em São Paulo com horário de verão = 20:00 UTC (com −3 fixo daria 21:00)
    const s = situacaoPura(janelas, ajuste, new Date('2018-11-05T19:00:00Z'));
    expect(s.voltaEm?.toISOString()).toBe('2018-11-05T20:00:00.000Z');
  });

  it('ignora o interruptor manual da loja (a equipe trabalha com a loja pausada) — só as janelas contam', () => {
    const { janelas, ajuste } = loja(SEG_18_23.map((j) => ({ ...j, aberto: false })));
    expect(situacaoPura(janelas, ajuste, sp('2026-11-09T19:00')).atendendo).toBe(true);
  });
});

describe('horário da equipe — de que linha vem o horário', () => {
  const linhas = [
    { id: '00000000-0000-4000-8000-000000000001', unidadeId: null, horarios: [{ dia: 1, ativo: true, abre: '10:00', fecha: '12:00' }], horariosRetirada: [], horarioUnico: true },
    {
      id: '00000000-0000-4000-8000-000000000002',
      unidadeId: '00000000-0000-4000-8000-0000000000aa',
      horarios: [{ dia: 1, ativo: true, abre: '18:00', fecha: '23:00' }],
      horariosRetirada: [{ dia: 1, ativo: true, abre: '11:00', fecha: '14:00' }],
      horarioUnico: false,
    },
    {
      id: '00000000-0000-4000-8000-000000000003',
      unidadeId: '00000000-0000-4000-8000-0000000000bb',
      horarios: [{ dia: 2, ativo: true, abre: '18:00', fecha: '23:00' }],
      horariosRetirada: [{ dia: 2, ativo: true, abre: '06:00', fecha: '07:00' }],
      horarioUnico: true,
    },
  ];
  const dias = (j: unknown[]) => (j as any[]).map((x) => `${x.dia} ${x.abre}`);

  it('o cardápio informado vale antes da loja', () => {
    expect(dias(janelasDeOnde(linhas, { cardapioId: linhas[2].id, unidadeId: linhas[1].unidadeId }))).toEqual(['2 18:00']);
  });
  it('a loja: entrega + retirada quando o horário NÃO é único (a equipe atende os dois); horário único = só a entrega', () => {
    expect(dias(janelasDeOnde(linhas, { unidadeId: linhas[1].unidadeId }))).toEqual(['1 18:00', '1 11:00']);
    expect(dias(janelasDeOnde(linhas, { unidadeId: linhas[2].unidadeId }))).toEqual(['2 18:00']);
  });
  it('loja sem linha própria → a da empresa (unidade nula); sem loja → a da empresa', () => {
    expect(dias(janelasDeOnde(linhas, { unidadeId: '00000000-0000-4000-8000-0000000000cc' }))).toEqual(['1 10:00']);
    expect(dias(janelasDeOnde(linhas, {}))).toEqual(['1 10:00']);
  });
  it('sem a da loja nem a da empresa → a UNIÃO de todas as lojas', () => {
    const semEmpresa = linhas.slice(1);
    expect(dias(janelasDeOnde(semEmpresa, { unidadeId: null }))).toEqual(['1 18:00', '1 11:00', '2 18:00']);
    expect(dias(janelasDeOnde([], {}))).toEqual([]);
  });
  it('a união com a retirada entra na conta: às 11:30 de segunda a equipe da loja A está (retirada), sem a retirada não', () => {
    const ajuste = { ...AJUSTE_DA_EQUIPE_PADRAO, atende: 'loja' as const, antesMin: 0, depoisMin: 0 };
    expect(situacaoPura(janelasDeOnde(linhas, { unidadeId: linhas[1].unidadeId }), ajuste, sp('2026-11-09T11:30')).atendendo).toBe(true);
    expect(situacaoPura(linhas[1].horarios, ajuste, sp('2026-11-09T11:30')).atendendo).toBe(false);
  });
});

describe('horário da equipe — o que o cliente lê', () => {
  const agora = sp('2026-11-09T02:14'); // segunda de madrugada
  it('hoje, amanhã, o dia da semana (na/no) e sem data', () => {
    expect(textoDaVolta(sp('2026-11-09T17:30'), agora)).toBe('hoje às 17:30');
    expect(textoDaVolta(sp('2026-11-10T17:30'), agora)).toBe('amanhã às 17:30');
    expect(textoDaVolta(sp('2026-11-11T09:05'), agora)).toBe('na quarta às 09:05');
    expect(textoDaVolta(sp('2026-11-14T17:30'), agora)).toBe('no sábado às 17:30');
    expect(textoDaVolta(sp('2026-11-15T17:30'), agora)).toBe('no domingo às 17:30');
    expect(textoDaVolta(sp('2026-11-16T17:30'), agora)).toBe('na segunda às 17:30');
    expect(textoDaVolta(null, agora)).toBe(VOLTA_SEM_DATA);
    expect(textoDaVolta(new Date('x'), agora)).toBe(VOLTA_SEM_DATA);
  });
  it('"amanhã" vira o dia certo perto da meia-noite de São Paulo (23:50 de domingo = 02:50 UTC de segunda)', () => {
    expect(textoDaVolta(sp('2026-11-09T17:30'), sp('2026-11-08T23:50'))).toBe('amanhã às 17:30');
  });
  it('a frase: a padrão, a da loja com {volta} (uma ou mais vezes), sem {volta}, e vazia = padrão', () => {
    expect(fraseForaDoHorario(null, 'hoje às 17:30')).toBe('Nossa equipe volta hoje às 17:30. Já deixei o seu recado aqui e respondemos assim que começarmos.');
    expect(FRASE_FORA_PADRAO).toContain('{volta}');
    expect(fraseForaDoHorario('Voltamos {volta}! Até {volta}.', 'amanhã às 18:00')).toBe('Voltamos amanhã às 18:00! Até amanhã às 18:00.');
    expect(fraseForaDoHorario('Estamos fechados.', 'hoje às 17:30')).toBe('Estamos fechados.');
    expect(fraseForaDoHorario('   ', 'hoje às 17:30')).toBe(fraseForaDoHorario(null, 'hoje às 17:30'));
    // "$&" no texto da loja não vira padrão de troca
    expect(fraseForaDoHorario('Volta {volta} $&', 'hoje às 17:30')).toBe('Volta hoje às 17:30 $&');
  });
  it('a resposta do recado: foraDoHorario, a volta pelo `ate` do recado e a frase, sem posição', () => {
    const r = respostaDoRecado({ ate: sp('2026-11-09T17:30').toISOString(), em: agora.toISOString() }, null, agora);
    expect(r).toEqual({
      foraDoHorario: true,
      equipeVolta: 'hoje às 17:30',
      paraOCliente: 'Nossa equipe volta hoje às 17:30. Já deixei o seu recado aqui e respondemos assim que começarmos.',
      posicao: null,
    });
  });
});

describe('horário da equipe — o ajuste (V15/V16)', () => {
  it('ausente fica de fora; cada campo só com as opções', () => {
    expect(lerAjusteDaEquipe({})).toEqual({});
    expect(lerAjusteDaEquipe(undefined)).toEqual({});
    expect(lerAjusteDaEquipe({ atende: 'loja', antesMin: 60, depoisMin: 120, textoFora: ' Voltamos {volta}. ' })).toEqual({
      atende: 'loja',
      antesMin: 60,
      depoisMin: 120,
      textoFora: 'Voltamos {volta}.',
    });
    expect(lerAjusteDaEquipe({ antesMin: 0, depoisMin: 0 })).toEqual({ antesMin: 0, depoisMin: 0 });
  });
  it.each([
    [{ atende: 'nunca' }, 'A equipe atende'],
    [{ atende: true }, 'A equipe atende'],
    [{ antesMin: 45 }, 'Começa a atender'],
    [{ antesMin: '30' }, 'Começa a atender'],
    [{ depoisMin: 90 }, 'Para de atender'],
    [{ depoisMin: null }, 'Para de atender'],
    [{ textoFora: 12 }, 'Fora do horário, o robô diz'],
    [{ textoFora: 'x'.repeat(301) }, 'no máximo 300'],
  ])('%j → 400 com a mensagem do campo', (dto, msg) => {
    expect(() => lerAjusteDaEquipe(dto)).toThrow(BadRequestException);
    expect(() => lerAjusteDaEquipe(dto)).toThrow(msg);
  });
  it('texto vazio (ou só espaços, ou null) volta ao padrão: null', () => {
    expect(lerAjusteDaEquipe({ textoFora: '' })).toEqual({ textoFora: null });
    expect(lerAjusteDaEquipe({ textoFora: '   ' })).toEqual({ textoFora: null });
    expect(lerAjusteDaEquipe({ textoFora: null })).toEqual({ textoFora: null });
    expect(lerAjusteDaEquipe({ textoFora: 'x'.repeat(300) }).textoFora).toHaveLength(300);
  });
  it('a linha do banco com os padrões no que faltar ou vier fora', () => {
    expect(ajusteDaLinha(null)).toEqual(AJUSTE_DA_EQUIPE_PADRAO);
    expect(ajusteDaLinha({ atende: 'loja', antesMin: '60', depoisMin: '0', textoFora: '' })).toEqual({ atende: 'loja', antesMin: 60, depoisMin: 0, textoFora: null });
    expect(ajusteDaLinha({ atende: 'outro', antesMin: 7, depoisMin: null })).toEqual(AJUSTE_DA_EQUIPE_PADRAO);
  });
});

describe('horário da equipe — o recado na fila', () => {
  const agora = new Date('2026-11-09T05:14:00Z');
  const recado = { ate: '2026-11-09T20:30:00.000Z', em: '2026-11-09T05:14:00.000Z' };
  it('ativo até o `ate`; lido mesmo depois (o selo); torto = sem recado', () => {
    expect(recadoAtivo({ recado }, agora)).toBe(true);
    expect(recadoAtivo({ recado }, new Date('2026-11-09T20:30:00Z'))).toBe(false);
    expect(lerRecado({ recado, outro: 1 })).toEqual(recado);
    expect(lerRecado({ recado: { ate: 'x', em: recado.em } })).toBeNull();
    expect(lerRecado(null)).toBeNull();
    expect(recadoAtivo(null, agora)).toBe(false);
  });
  it('situação "abertura" só para o recado ativo SEM ninguém; com alguém, aguardando ou depois do `ate`, o ciclo comum', () => {
    expect(situacaoDo({ status: 'aberto', detalhe: { recado } }, agora)).toBe('abertura');
    expect(situacaoDo({ status: 'aberto', recadoAtivo: true })).toBe('abertura');
    expect(situacaoDo({ status: 'aberto', recadoAtivo: false, detalhe: { recado } }, agora)).toBe('fila'); // vale o do banco
    expect(situacaoDo({ status: 'aberto', responsavelId: 'x', detalhe: { recado } }, agora)).toBe('com_alguem');
    expect(situacaoDo({ status: 'aberto', aguardandoDesde: new Date(), detalhe: { recado } }, agora)).toBe('aguardando');
    expect(situacaoDo({ status: 'aberto', detalhe: { recado } }, new Date('2026-11-09T21:00:00Z'))).toBe('fila');
  });
  it('o recado não tem posição nem empurra quem está na fila', () => {
    const lista = [
      { id: 'r', status: 'aberto', recadoAtivo: true },
      { id: 'a', status: 'aberto', recadoAtivo: false },
      { id: 'b', status: 'aberto' },
    ];
    expect(posicoes(lista).map((c) => [c.id, c.posicao])).toEqual([
      ['r', null],
      ['a', 1],
      ['b', 2],
    ]);
  });
});
