import { ENVIO_PARADO_APOS_MS, SEM_NUVEM_APOS_MS, semConexaoComANuvem } from './conexao-nuvem';

// F1.4: a faixa "sem conexão com a nuvem" do servidor da loja.
describe('semConexaoComANuvem', () => {
  const agora = Date.parse('2026-11-14T22:00:00Z');
  const ha = (ms: number) => new Date(agora - ms).toISOString();

  it('falhando há 2 min ou mais: sem conexão desde a primeira falha', () => {
    expect(semConexaoComANuvem(ha(SEM_NUVEM_APOS_MS), ha(SEM_NUVEM_APOS_MS + 60_000), agora)).toBe(ha(SEM_NUVEM_APOS_MS));
    expect(semConexaoComANuvem(ha(12 * 60_000), null, agora)).toBe(ha(12 * 60_000));
  });

  it('falhando há menos de 2 min: ainda não acusa (um ciclo ruim é um piscar da rede)', () => {
    expect(semConexaoComANuvem(ha(SEM_NUVEM_APOS_MS - 1000), ha(10 * 60_000), agora)).toBeNull();
  });

  it('sem falha marcada, mas nenhum ciclo certo há 5 min: o envio parou (o daemon caiu)', () => {
    expect(semConexaoComANuvem('', ha(ENVIO_PARADO_APOS_MS), agora)).toBe(ha(ENVIO_PARADO_APOS_MS));
    expect(semConexaoComANuvem(null, ha(ENVIO_PARADO_APOS_MS - 1000), agora)).toBeNull();
  });

  it('falando normalmente, ou sem nada anotado (servidor recém-instalado): nada', () => {
    expect(semConexaoComANuvem('', ha(30_000), agora)).toBeNull();
    expect(semConexaoComANuvem(null, null, agora)).toBeNull();
    expect(semConexaoComANuvem('lixo', 'lixo', agora)).toBeNull();
  });
});
