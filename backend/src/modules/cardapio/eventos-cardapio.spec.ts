import {
  EVENTOS_PADRAO,
  EventosInvalidos,
  agendaDeEventos,
  aplicarEventos,
  blackFridayDe,
  diaEmBrasilia,
  domingoN,
  eventoEmPrevia,
  eventoNoAr,
  lerEventos,
  normalizarHorarioJogo,
  pascoaDe,
  proximaJanela,
  somarDias,
  termoProibidoNaChamada,
  type EventosConfig,
} from './eventos-cardapio';

// Meio-dia em Brasília do dia pedido.
const em = (dia: string, hora = '12:00') => new Date(`${dia}T${hora}:00-03:00`);
const ligados = (...chaves: string[]): EventosConfig =>
  lerEventos({ porEvento: Object.fromEntries(chaves.map((c) => [c, { ativo: true }])) });

describe('calendário dos eventos', () => {
  it('datas móveis (as do checklist da especificação)', () => {
    expect(pascoaDe(2026)).toBe('2026-04-05');
    expect(pascoaDe(2027)).toBe('2027-03-28');
    expect(somarDias(pascoaDe(2026), -47)).toBe('2026-02-17'); // terça de Carnaval
    expect(domingoN(2026, 5, 2)).toBe('2026-05-10'); // Mães
    expect(domingoN(2026, 8, 2)).toBe('2026-08-09'); // Pais
    expect(blackFridayDe(2026)).toBe('2026-11-27');
    expect(blackFridayDe(2030)).toBe('2030-11-29');
  });

  it('período padrão de cada evento', () => {
    const j = (c: any, hoje: string) => { const w = proximaJanela(c, hoje); return `${w.inicio}..${w.fim}`; };
    expect(j('carnaval', '2026-01-10')).toBe('2026-02-13..2026-02-18'); // sexta até a quarta de cinzas
    expect(j('pascoa', '2026-01-10')).toBe('2026-03-29..2026-04-05');
    expect(j('maes', '2026-01-10')).toBe('2026-05-03..2026-05-10');
    expect(j('hamburguer', '2026-01-10')).toBe('2026-05-21..2026-05-28');
    expect(j('namorados', '2026-01-10')).toBe('2026-06-05..2026-06-12');
    expect(j('junina', '2026-01-10')).toBe('2026-06-01..2026-06-30');
    expect(j('pais', '2026-01-10')).toBe('2026-08-02..2026-08-09');
    expect(j('criancas', '2026-01-10')).toBe('2026-10-01..2026-10-12');
    expect(j('halloween', '2026-01-10')).toBe('2026-10-20..2026-10-31');
    expect(j('blackfriday', '2026-01-10')).toBe('2026-11-23..2026-11-29'); // segunda a domingo
    expect(j('natal', '2026-01-10')).toBe('2026-12-01..2026-12-25');
  });

  it('o Réveillon cruza o ano: vale em 28/12 e em 01/01', () => {
    expect(proximaJanela('reveillon', '2026-12-28')).toEqual({ inicio: '2026-12-26', fim: '2027-01-01', dia: '2027-01-01' });
    expect(proximaJanela('reveillon', '2027-01-01')).toEqual({ inicio: '2026-12-26', fim: '2027-01-01', dia: '2027-01-01' });
    expect(proximaJanela('reveillon', '2027-01-02').inicio).toBe('2027-12-26');
  });

  it('depois que o período acaba, a próxima ocorrência é a do ano seguinte', () => {
    expect(proximaJanela('natal', '2026-12-26').dia).toBe('2027-12-25');
    expect(proximaJanela('pascoa', '2026-04-06').dia).toBe('2027-03-28');
  });

  it('"dias antes" e "dias depois" do presidente valem para data fixa e para data móvel', () => {
    expect(proximaJanela('natal', '2026-11-01', { ativo: true, diasAntes: 10, diasDepois: 1 })).toEqual({ inicio: '2026-12-15', fim: '2026-12-26', dia: '2026-12-25' });
    expect(proximaJanela('pascoa', '2027-01-01', { ativo: true, diasAntes: 14 })).toEqual({ inicio: '2027-03-14', fim: '2027-03-28', dia: '2027-03-28' });
  });

  it('o dia é o de Brasília, não o do servidor', () => {
    expect(diaEmBrasilia(new Date('2026-12-01T02:30:00Z'))).toBe('2026-11-30'); // 23:30 em Brasília
    expect(diaEmBrasilia(new Date('2026-12-01T03:00:00Z'))).toBe('2026-12-01');
  });
});

describe('qual evento está no ar', () => {
  it('nenhum evento liga sozinho: sem nada ligado, não há evento nem dentro do período', () => {
    expect(eventoNoAr(EVENTOS_PADRAO, em('2026-12-10'))).toBeNull();
    expect(eventoNoAr(lerEventos({}), em('2026-10-05'))).toBeNull();
    expect(eventoNoAr(lerEventos({ porEvento: { natal: { ativo: false } } }), em('2026-12-10'))).toBeNull();
  });

  it('ligado e dentro do período: vale; fora do período: não', () => {
    const cfg = ligados('natal');
    expect(eventoNoAr(cfg, em('2026-12-10'))?.chave).toBe('natal');
    expect(eventoNoAr(cfg, em('2026-12-01', '00:05'))?.chave).toBe('natal');
    expect(eventoNoAr(cfg, em('2026-12-25', '23:55'))?.chave).toBe('natal');
    expect(eventoNoAr(cfg, em('2026-11-30', '23:55'))).toBeNull();
    expect(eventoNoAr(cfg, em('2026-12-26', '00:05'))).toBeNull();
  });

  it('só os ligados concorrem: Crianças desligado não aparece em outubro', () => {
    expect(eventoNoAr(ligados('halloween', 'natal'), em('2026-10-05'))).toBeNull();
    expect(eventoNoAr(ligados('halloween', 'natal'), em('2026-10-25'))?.chave).toBe('halloween');
  });

  it('Namorados vence a Festa Junina de 05 a 12/06; antes e depois vale a Junina', () => {
    const cfg = ligados('junina', 'namorados');
    expect(eventoNoAr(cfg, em('2026-06-03'))?.chave).toBe('junina');
    expect(eventoNoAr(cfg, em('2026-06-08'))?.chave).toBe('namorados');
    expect(eventoNoAr(cfg, em('2026-06-13'))?.chave).toBe('junina');
  });

  it('empate de prioridade: vale a ordem da lista (Black Friday em 01/12/2030, não o Natal)', () => {
    expect(eventoNoAr(ligados('natal', 'blackfriday'), em('2030-12-01'))?.chave).toBe('blackfriday');
    expect(eventoNoAr(ligados('natal', 'blackfriday'), em('2030-12-02'))?.chave).toBe('natal');
  });

  it('devolve o que a loja personalizou e as chaves gerais', () => {
    const id = '11111111-1111-4111-8111-111111111111';
    const cfg = lerEventos({ animacoes: false, coresDoEvento: false, porEvento: { natal: { ativo: true, titulo: 'Natal da casa', colecao: [id, 'lixo'] } } });
    expect(eventoNoAr(cfg, em('2026-12-10'))).toEqual({
      chave: 'natal', inicio: '2026-12-01', fim: '2026-12-25', dia: '2026-12-25',
      titulo: 'Natal da casa', texto: null, colecao: [id], cores: false, animacoes: false,
      partida: null, cupomJogoId: null, previa: false,
    });
  });

  it('cupom do jogo só existe em Páscoa e Halloween', () => {
    const id = '22222222-2222-4222-8222-222222222222';
    const cfg = lerEventos({ porEvento: { halloween: { ativo: true, cupomJogo: id }, natal: { ativo: true, cupomJogo: id } } });
    expect(eventoNoAr(cfg, em('2026-10-25'))?.cupomJogoId).toBe(id);
    expect(eventoNoAr(cfg, em('2026-12-10'))?.cupomJogoId).toBeNull();
  });
});

describe('Dia de jogo', () => {
  const jogo = { inicio: '2026-10-01T21:30:00-03:00', chamada: 'Jogo das 21h30' };
  const cfg = lerEventos({ jogos: [jogo], porEvento: { jogo: { ativo: true }, criancas: { ativo: true } } });

  it('liga 3 h antes e desliga 2h30 depois; nesse período vence o evento do dia', () => {
    expect(eventoNoAr(cfg, em('2026-10-01', '18:29'))?.chave).toBe('criancas');
    expect(eventoNoAr(cfg, em('2026-10-01', '18:30'))?.chave).toBe('jogo');
    expect(eventoNoAr(cfg, em('2026-10-01', '23:59'))?.chave).toBe('jogo');
    expect(eventoNoAr(cfg, em('2026-10-02', '00:00'))?.chave).toBe('jogo'); // 21:30 + 2h30
    expect(eventoNoAr(cfg, em('2026-10-02', '00:01'))?.chave).toBe('criancas');
  });

  it('manda o horário do jogo, quando o tema sai do ar e a chamada', () => {
    expect(eventoNoAr(cfg, em('2026-10-01', '20:00'))?.partida).toEqual({ inicio: jogo.inicio, fim: '2026-10-02T03:00:00.000Z', chamada: 'Jogo das 21h30' });
  });

  it('jogo cadastrado com o Dia de jogo desligado não muda nada', () => {
    const desligado = lerEventos({ jogos: [jogo], porEvento: { criancas: { ativo: true } } });
    expect(eventoNoAr(desligado, em('2026-10-01', '21:00'))?.chave).toBe('criancas');
  });

  it('a chamada não aceita nome de time nem de campeonato', () => {
    for (const t of ['Final da Libertadores', 'Flamengo x Vasco', 'Jogo do Brasileirão', 'COPA DO BRASIL hoje', 'Clássico: Grêmio', 'Sul-Americana']) expect(termoProibidoNaChamada(t)).not.toBeNull();
    for (const t of ['Final do campeonato', 'Jogo das 21h30', 'Hoje tem clássico', 'Decisão na TV', 'Seleção em campo']) expect(termoProibidoNaChamada(t)).toBeNull();
  });

  it('horário do jogo: sempre de Brasília; data impossível é recusada', () => {
    expect(normalizarHorarioJogo('2026-10-01T21:30')).toBe('2026-10-01T21:30:00-03:00');
    expect(normalizarHorarioJogo('2026-10-01T21:30:00-03:00')).toBe('2026-10-01T21:30:00-03:00');
    expect(normalizarHorarioJogo('2026-02-31T21:30')).toBeNull();
    expect(normalizarHorarioJogo('amanhã')).toBeNull();
    expect(normalizarHorarioJogo(null)).toBeNull();
  });
});

describe('prévia pelo link', () => {
  it('mostra o evento desligado e fora do período, com a próxima data', () => {
    const p = eventoEmPrevia(lerEventos({}), 'natal', em('2026-10-01'));
    expect(p).toMatchObject({ chave: 'natal', inicio: '2026-12-01', fim: '2026-12-25', previa: true });
  });

  it('Dia de jogo sem jogo cadastrado simula um que começa em 45 minutos', () => {
    const agora = em('2026-10-01', '15:00');
    const p = eventoEmPrevia(lerEventos({}), 'jogo', agora);
    expect(Date.parse(p.partida!.inicio) - agora.getTime()).toBe(45 * 60_000);
    expect(p.previa).toBe(true);
  });
});

describe('leitura tolerante do que está gravado', () => {
  it('lixo vira configuração vazia, nunca erro', () => {
    for (const v of [null, undefined, 'x', 7, [], { porEvento: 'x', jogos: 'y' }, { porEvento: { natal: 'sim', inexistente: { ativo: true } } }]) {
      const c = lerEventos(v);
      expect(c.jogos).toEqual([]);
      expect(Object.values(c.porEvento).some((e) => e?.ativo)).toBe(false);
      expect(eventoNoAr(c, em('2026-12-10'))).toBeNull();
    }
  });

  it('"ativo" só vale com true de verdade', () => {
    for (const v of ['true', 1, 'sim', {}]) expect(lerEventos({ porEvento: { natal: { ativo: v } } }).porEvento.natal?.ativo).toBe(false);
    expect(lerEventos({ porEvento: { natal: { ativo: true } } }).porEvento.natal?.ativo).toBe(true);
  });
});

describe('gravação pelo presidente', () => {
  const agora = em('2026-10-01', '10:00');
  const id = '33333333-3333-4333-8333-333333333333';

  it('campo ausente mantém o que estava: ligar o Natal não apaga textos nem jogos', () => {
    const atual = lerEventos({ animacoes: false, jogos: [{ inicio: '2026-10-05T21:30' }], porEvento: { natal: { ativo: false, titulo: 'Natal da casa', diasAntes: 10 }, halloween: { ativo: true } } });
    const novo = aplicarEventos(atual, { porEvento: { natal: { ativo: true } } }, agora);
    expect(novo.porEvento.natal).toEqual({ ativo: true, titulo: 'Natal da casa', diasAntes: 10 });
    expect(novo.porEvento.halloween).toEqual({ ativo: true });
    expect(novo.animacoes).toBe(false);
    expect(novo.jogos).toHaveLength(1);
    // e o que estava guardado não foi alterado no lugar
    expect(atual.porEvento.natal?.ativo).toBe(false);
  });

  it('vazio ou nulo devolve o campo ao padrão', () => {
    const atual = lerEventos({ porEvento: { natal: { ativo: true, titulo: 'X', texto: 'Y', diasAntes: 10, colecao: [id] } } });
    const novo = aplicarEventos(atual, { porEvento: { natal: { titulo: '', texto: null, diasAntes: null, colecao: [] } } }, agora);
    expect(novo.porEvento.natal).toEqual({ ativo: true });
  });

  it('liga/desliga exige true ou false (ausente não vira "desligado")', () => {
    expect(() => aplicarEventos(EVENTOS_PADRAO, { porEvento: { natal: { ativo: 'sim' } } }, agora)).toThrow(EventosInvalidos);
    expect(() => aplicarEventos(EVENTOS_PADRAO, { animacoes: 1 }, agora)).toThrow(EventosInvalidos);
    expect(aplicarEventos(lerEventos({ porEvento: { natal: { ativo: true } } }), { porEvento: { natal: { titulo: 'Oi' } } }, agora).porEvento.natal?.ativo).toBe(true);
  });

  it('recusa com o motivo: evento desconhecido, período fora da faixa, texto longo, coleção torta', () => {
    const erro = (dto: any) => { try { aplicarEventos(EVENTOS_PADRAO, dto, agora); return ''; } catch (e) { return (e as Error).message; } };
    expect(erro({ porEvento: { pascoinha: { ativo: true } } })).toMatch(/Evento desconhecido/);
    expect(erro({ porEvento: { natal: { diasAntes: 61 } } })).toMatch(/dias antes.*0 a 60/);
    expect(erro({ porEvento: { natal: { diasDepois: -1 } } })).toMatch(/dias depois.*0 a 30/);
    expect(erro({ porEvento: { natal: { titulo: 'x'.repeat(41) } } })).toMatch(/no máximo 40/);
    expect(erro({ porEvento: { natal: { colecao: ['abc'] } } })).toMatch(/lista de produtos/);
    expect(erro({ porEvento: { natal: { cupomJogo: id } } })).toMatch(/não tem jogo com cupom/);
    expect(erro({ porEvento: { jogo: { diasAntes: 3 } } })).toMatch(/não tem período/);
    expect(erro({ jogos: [{ inicio: 'x' }] })).toMatch(/data e a hora/);
    expect(erro({ jogos: [{ inicio: '2026-10-05T21:30', chamada: 'Final da Libertadores' }] })).toMatch(/nome de time nem de campeonato/);
    expect(erro({ jogos: [{ inicio: '2026-10-05T21:30', chamada: 'x'.repeat(41) }] })).toMatch(/no máximo 40/);
    expect(erro(null)).toMatch(/Envie a configuração/);
  });

  it('jogos: a lista enviada substitui a anterior, sai o que já acabou e o repetido, e fica em ordem', () => {
    const atual = lerEventos({ jogos: [{ inicio: '2026-10-03T16:00' }] });
    const novo = aplicarEventos(atual, {
      jogos: [
        { inicio: '2026-10-08T21:30', chamada: 'Decisão' },
        { inicio: '2026-09-30T21:30' }, // já acabou
        { inicio: '2026-10-04T16:00' },
        { inicio: '2026-10-04T16:00:00-03:00' }, // repetido
      ],
    }, agora);
    expect(novo.jogos).toEqual([{ inicio: '2026-10-04T16:00:00-03:00' }, { inicio: '2026-10-08T21:30:00-03:00', chamada: 'Decisão' }]);
  });

  it('jogo de hoje que ainda está na janela continua', () => {
    const novo = aplicarEventos(EVENTOS_PADRAO, { jogos: [{ inicio: '2026-10-01T08:00' }] }, agora); // acabou às 10:30
    expect(novo.jogos).toHaveLength(1);
  });
});

describe('agenda do painel', () => {
  it('uma linha por evento (sem o Dia de jogo), em ordem de data, com o que está no ar', () => {
    const a = agendaDeEventos(ligados('criancas', 'natal'), em('2026-10-05'));
    expect(a).toHaveLength(12);
    expect(a[0]).toMatchObject({ chave: 'criancas', ativo: true, noPeriodo: true, noAr: true, inicio: '2026-10-01', fim: '2026-10-12' });
    expect(a.map((l) => l.chave).slice(0, 5)).toEqual(['criancas', 'halloween', 'blackfriday', 'natal', 'reveillon']);
    expect(a.find((l) => l.chave === 'halloween')).toMatchObject({ ativo: false, noAr: false, temJogo: true, periodoPadrao: { antes: 11, depois: 0 } });
    expect(a.every((l, i) => i === 0 || a[i - 1].inicio <= l.inicio)).toBe(true);
  });
});
