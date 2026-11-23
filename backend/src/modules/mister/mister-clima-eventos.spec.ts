import { alcanceDoEvento, diaDoEvento, leituraDaChuva, montarAgenda, periodoDaAgenda, previsaoDaFonte } from './mister-clima-eventos';

/* eslint-disable @typescript-eslint/no-explicit-any */

// Versão 8, E1: clima e eventos na conversa. As formas abaixo são as gravadas em produção em 23/11/2026.
const RIO = 3304557;
const nacional = [{ nivel: 'nacional', valor: 'BR' }];
const jogoDoRio = [
  { nivel: 'municipio', valor: String(RIO) },
  { nivel: 'municipio', valor: '3550308' },
  { nivel: 'time', valor: 'botafogo' },
];
const fonte = (chuva: boolean | null, resumo = 'Parcialmente Nublado') => ({ maxima: 34, minima: 25, resumo, chuva_prevista: chuva, credito: 'x', lido_em: 'y' });
const base = { de: '2026-11-23', ate: '2026-11-29', hoje: '2026-11-23', loja: 'Centro', cidade: { situacao: 'ok' as const, municipio: RIO, uf: 'RJ' }, daBase: [], daLoja: [], clima: [] };
const evento = (o: any) => ({ tipo: 'comemorativa', nome: 'Black Friday', dia_inteiro: true, inicio: '2026-11-27', fuso: 'America/Sao_Paulo', abrangencia: nacional, situacao: 'confirmado', ...o });

describe('o período da agenda', () => {
  it('sem pedido, 7 dias; com pedido, até 16; um dia só', () => {
    expect(periodoDaAgenda({}, '2026-11-23')).toEqual({ de: '2026-11-23', ate: '2026-11-29' });
    expect(periodoDaAgenda({ dias: 40 }, '2026-11-23')).toEqual({ de: '2026-11-23', ate: '2026-12-08' });
    expect(periodoDaAgenda({ dia: '2026-11-27' }, '2026-11-23')).toEqual({ de: '2026-11-27', ate: '2026-11-27' });
  });
  it('dia passado, torto ou longe demais volta o motivo', () => {
    expect(periodoDaAgenda({ dia: '2026-11-22' }, '2026-11-23')).toHaveProperty('erro');
    expect(periodoDaAgenda({ dia: 'sexta' }, '2026-11-23')).toHaveProperty('erro');
    expect(periodoDaAgenda({ dia: '2027-06-01' }, '2026-11-23')).toHaveProperty('erro');
  });
});

describe('o dia e a hora do evento', () => {
  it('o jogo das 21h de segunda é de segunda, mesmo gravado como terça em UTC', () => {
    expect(diaDoEvento({ dia_inteiro: false, inicio: '2026-11-24T00:00:00.000Z', fuso: 'America/Sao_Paulo' })).toEqual({ dia: '2026-11-23', hora: '21:00' });
  });
  it('o dia inteiro fica no dia escrito; o torto não entra; fuso inválido cai no da loja', () => {
    expect(diaDoEvento({ dia_inteiro: true, inicio: '2026-11-27', fuso: 'America/Sao_Paulo' })).toEqual({ dia: '2026-11-27', hora: null });
    expect(diaDoEvento({ dia_inteiro: false, inicio: 'xx', fuso: null })).toBeNull();
    expect(diaDoEvento({ dia_inteiro: false, inicio: '2026-11-24T00:00:00.000Z', fuso: 'Lugar/Nenhum' })).toEqual({ dia: '2026-11-23', hora: '21:00' });
  });
});

describe('onde o evento vale', () => {
  it('na cidade, no estado, no país; de outra cidade ou só de um time, não', () => {
    expect(alcanceDoEvento(jogoDoRio, RIO, 'RJ')).toBe('cidade');
    expect(alcanceDoEvento([{ nivel: 'uf', valor: 'rj' }], RIO, 'RJ')).toBe('estado');
    expect(alcanceDoEvento(nacional, RIO, 'RJ')).toBe('nacional');
    expect(alcanceDoEvento(jogoDoRio, 3106200, 'MG')).toBeNull();
    expect(alcanceDoEvento([{ nivel: 'time', valor: 'botafogo' }], RIO, 'RJ')).toBeNull();
    expect(alcanceDoEvento(null, RIO, 'RJ')).toBeNull();
  });
});

describe('as duas previsões', () => {
  it('concordam, discordam, uma só, nenhuma: quando discordam, nenhuma vence', () => {
    const c = previsaoDaFonte(fonte(true));
    const s = previsaoDaFonte(fonte(false));
    const nada = previsaoDaFonte({ resumo: 'Nublado' });
    expect(leituraDaChuva(c, c)).toBe('as_duas_dao_chuva');
    expect(leituraDaChuva(s, s)).toBe('as_duas_sem_chuva');
    expect(leituraDaChuva(c, s)).toBe('discordam');
    expect(leituraDaChuva(c, null)).toBe('so_uma_fonte');
    expect(leituraDaChuva(nada, c)).toBe('so_uma_fonte');
    expect(leituraDaChuva(null, null)).toBe('sem_dado');
  });
  it('só o que a fonte diz, sem o resto do registro', () => {
    expect(previsaoDaFonte(fonte(true, ' Chuva '))).toEqual({ resumo: 'Chuva', minima: 25, maxima: 34, chuva: true });
    expect(previsaoDaFonte({})).toBeNull();
    expect(previsaoDaFonte(null)).toBeNull();
  });
});

describe('a agenda', () => {
  it('junta eventos e previsão por dia, em ordem, e tira os dias vazios', () => {
    const r: any = montarAgenda({
      ...base,
      daBase: [
        evento({}),
        evento({ tipo: 'jogo', nome: 'Santos x Grêmio', dia_inteiro: false, inicio: '2026-11-24T00:00:00.000Z' }),
        evento({ tipo: 'jogo', nome: 'Botafogo x São Paulo', dia_inteiro: false, inicio: '2026-11-23T23:00:00.000Z', abrangencia: jogoDoRio }),
      ],
      clima: [{ dia: '2026-11-27', inmet: fonte(true, 'Pancadas isoladas'), cptec: fonte(false) }],
    });
    expect(r.periodo).toBe('de 23/11 a 29/11');
    expect(r.situacaoDaPrevisao).toBe('ok');
    expect(r.dias.map((d: any) => d.rotulo)).toEqual(['segunda, 23/11', 'sexta, 27/11']);
    expect(r.dias[0].ehHoje).toBe(true);
    expect(r.dias[0].eventos).toEqual([
      { tipo: 'Jogo', nome: 'Botafogo x São Paulo', hora: '20:00', alcance: 'cidade' },
      { tipo: 'Jogo', nome: 'Santos x Grêmio', hora: '21:00', alcance: 'nacional' },
    ]);
    expect(r.dias[1].eventos).toEqual([{ tipo: 'Data comemorativa', nome: 'Black Friday' }]);
    expect(r.dias[1].previsao.chuva).toBe('discordam');
    expect(r.avisos).toEqual(['A previsão só vai até 27/11.']);
    expect(JSON.stringify(r)).not.toMatch(/mm|milímetro/i);
  });

  it('o evento da base fora do período, de outra cidade ou sem nome não entra', () => {
    const r: any = montarAgenda({
      ...base,
      daBase: [evento({ inicio: '2026-12-25' }), evento({ abrangencia: [{ nivel: 'municipio', valor: '3106200' }] }), evento({ nome: null })],
    });
    expect(r.dias).toEqual([]);
  });

  it('com a base no período, a regra fixa não repete; o que a loja cadastrou entra, sem duplicar o nome', () => {
    const r: any = montarAgenda({
      ...base,
      daBase: [evento({})],
      daLoja: [
        { dia: '2026-11-27', grupo: 'comemorativa', tipo: 'comemorativa', nome: 'Black Friday', origem: 'regra' },
        { dia: '2026-11-26', grupo: 'dinheiro', tipo: 'dinheiro', nome: 'Outra da regra', origem: 'regra' },
        { dia: '2026-11-27', grupo: 'loja', tipo: 'show', nome: 'Show da casa', origem: 'loja', hora: '22:00' },
        { dia: '2026-11-27', grupo: 'loja', tipo: 'outro', nome: 'BLACK friday', origem: 'loja' },
      ],
    });
    expect(r.dias).toHaveLength(1);
    expect(r.dias[0].eventos.map((e: any) => e.nome)).toEqual(['Black Friday', 'Show da casa']);
    expect(r.dias[0].eventos[1]).toEqual({ tipo: 'Da loja', nome: 'Show da casa', hora: '22:00' });
  });

  it('sem a base (Pulso desligado), o calendário da regra responde', () => {
    const r: any = montarAgenda({ ...base, daLoja: [{ dia: '2026-11-27', grupo: 'comemorativa', tipo: 'comemorativa', nome: 'Black Friday', origem: 'regra' }] });
    expect(r.dias[0].eventos).toEqual([{ tipo: 'Data comemorativa', nome: 'Black Friday' }]);
  });

  it('o que não está confirmado vem marcado', () => {
    const r: any = montarAgenda({ ...base, daBase: [evento({ situacao: 'previsto' })] });
    expect(r.dias[0].eventos[0].aConfirmar).toBe(true);
  });

  it('um dia só aparece mesmo sem nada, e a resposta diz por que não tem previsão', () => {
    const semCidade: any = montarAgenda({ ...base, de: '2026-11-27', ate: '2026-11-27', cidade: { situacao: 'sem_cidade', municipio: null, uf: null } });
    expect(semCidade.dias).toEqual([{ dia: '2026-11-27', rotulo: 'sexta, 27/11', eventos: [], previsao: null }]);
    expect(semCidade.situacaoDaPrevisao).toBe('sem_cidade');
    expect(semCidade.avisos[0]).toContain('Financeiro › Configuração');
    const varias: any = montarAgenda({ ...base, cidade: { situacao: 'varias_cidades', municipio: null, uf: null } });
    expect(varias.situacaoDaPrevisao).toBe('varias_cidades');
    const semLeitura: any = montarAgenda(base);
    expect(semLeitura.situacaoDaPrevisao).toBe('sem_leitura');
    expect(semLeitura).not.toHaveProperty('fontesDaPrevisao');
  });
});
