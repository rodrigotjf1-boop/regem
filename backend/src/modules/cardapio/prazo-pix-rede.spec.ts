import { decidirPrazoPixRede, ESPERA_SEM_RESPOSTA_MS, FOLGA_DEPOIS_DO_QR_MS } from './prazo-pix-rede';

// O PRAZO DO PIX DA REDE: antes de cancelar o pedido de 10 min sem pagar, a rotina pergunta à Rede (ela não
// avisa sozinha nem deixa cancelar o QR). Pago no último minuto entra; QR ainda valendo espera; sem resposta espera
// até 1 h.

const criado = new Date('2026-11-05T12:00:00Z');
const t = (min: number) => criado.getTime() + min * 60_000;

describe('decidirPrazoPixRede', () => {
  it('pago no prazo: APROVA em vez de cancelar', () => {
    expect(decidirPrazoPixRede({ id: '1', status: 'paid', expiraEm: null }, t(11), criado)).toBe('aprovar');
  });

  it('pendente com o QR ainda valendo (gerado depois do pedido): espera', () => {
    expect(decidirPrazoPixRede({ id: '1', status: 'pending', expiraEm: new Date(t(14)) }, t(12), criado)).toBe('esperar');
  });

  it('QR vencido há menos que a folga: espera (a Rede pode estar refletindo um pagamento de última hora)', () => {
    const vence = new Date(t(10));
    expect(decidirPrazoPixRede({ id: '1', status: 'pending', expiraEm: vence }, vence.getTime() + FOLGA_DEPOIS_DO_QR_MS - 1, criado)).toBe('esperar');
    expect(decidirPrazoPixRede({ id: '1', status: 'pending', expiraEm: vence }, vence.getTime() + FOLGA_DEPOIS_DO_QR_MS, criado)).toBe('cancelar');
  });

  it('pendente sem a validade na resposta: conta 10 min a partir do pedido', () => {
    expect(decidirPrazoPixRede({ id: '1', status: 'pending', expiraEm: null }, t(11), criado)).toBe('esperar');
    expect(decidirPrazoPixRede({ id: '1', status: 'pending', expiraEm: null }, t(12), criado)).toBe('cancelar');
  });

  it('devolvido ou outra situação: cancela', () => {
    expect(decidirPrazoPixRede({ id: '1', status: 'canceled', expiraEm: null }, t(11), criado)).toBe('cancelar');
    expect(decidirPrazoPixRede({ id: '1', status: 'outro', expiraEm: null }, t(11), criado)).toBe('cancelar');
  });

  it('a Rede não respondeu: espera até 1 h depois do pedido; depois cancela', () => {
    expect(decidirPrazoPixRede(null, criado.getTime() + ESPERA_SEM_RESPOSTA_MS, criado)).toBe('esperar');
    expect(decidirPrazoPixRede(null, criado.getTime() + ESPERA_SEM_RESPOSTA_MS + 1, criado)).toBe('cancelar');
  });
});
