import { ENVIO_PARADO_APOS_MS, SEM_NUVEM_APOS_MS, situacaoDaNuvem } from './conexao-nuvem';

// F1.4: a MESMA regra para o ícone da bandeja e a faixa "sem conexão com a nuvem" (V74), sobre a anotação da batida.
describe('situacaoDaNuvem', () => {
  const agora = Date.parse('2026-11-14T22:00:00Z');
  const ha = (ms: number) => new Date(agora - ms).toISOString();
  const contato = (okEm: string | null, falhandoDesde: string | null) => JSON.stringify({ okEm, falhandoDesde });

  it('falhando há 2 min ou mais: sem conexão desde a primeira falha', () => {
    expect(situacaoDaNuvem(contato(ha(9 * 60_000), ha(SEM_NUVEM_APOS_MS)), agora)).toEqual({ situacao: 'falhando', motivo: 'falha', desde: agora - SEM_NUVEM_APOS_MS, semConexaoDesde: ha(SEM_NUVEM_APOS_MS) });
    expect(situacaoDaNuvem(contato(null, ha(12 * 60_000)), agora).semConexaoDesde).toBe(ha(12 * 60_000));
  });

  it('falhando há menos de 2 min, com contato certo recente: ainda ok (uma batida ruim é um piscar)', () => {
    expect(situacaoDaNuvem(contato(ha(90_000), ha(60_000)), agora)).toMatchObject({ situacao: 'ok', semConexaoDesde: null, desde: agora - 90_000 });
  });

  it('nenhum contato certo há 5 min, mesmo sem a falha anotada: o daemon caiu', () => {
    expect(situacaoDaNuvem(contato(ha(ENVIO_PARADO_APOS_MS), null), agora)).toMatchObject({ situacao: 'falhando', motivo: 'sem_noticia', semConexaoDesde: ha(ENVIO_PARADO_APOS_MS) });
    expect(situacaoDaNuvem(contato(ha(ENVIO_PARADO_APOS_MS + 60_000), ha(30_000)), agora)).toMatchObject({ situacao: 'falhando', motivo: 'sem_noticia' });
    expect(situacaoDaNuvem(contato(ha(ENVIO_PARADO_APOS_MS - 1000), null), agora).situacao).toBe('ok');
  });

  it('a falha antiga já superada por um contato certo não conta', () => {
    expect(situacaoDaNuvem(contato(ha(30_000), ha(20 * 60_000)), agora)).toMatchObject({ situacao: 'ok' });
  });

  it('sem anotação (servidor recém-instalado) ou ilegível: sem informação, sem faixa', () => {
    expect(situacaoDaNuvem(null, agora)).toEqual({ situacao: 'sem_informacao', motivo: null, desde: null, semConexaoDesde: null });
    expect(situacaoDaNuvem('lixo', agora).situacao).toBe('sem_informacao');
    expect(situacaoDaNuvem(contato(null, ha(30_000)), agora).situacao).toBe('sem_informacao');
    expect(situacaoDaNuvem({ okEm: ha(10_000), falhandoDesde: null }, agora).situacao).toBe('ok');
  });
});
