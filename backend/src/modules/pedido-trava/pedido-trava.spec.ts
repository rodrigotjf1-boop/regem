import {
  CODIGO_PEDIDO_EM_ALTERACAO,
  VALIDADE_DA_TRAVA_MIN,
  ateDaTrava,
  horaDaTrava,
  linhaDaTravaNaConferencia,
  motivoDoLiberar,
  recusaDaTrava,
  textoDaTravaVencida,
  textoDoPedidoLiberado,
  travaVale,
} from './pedido-trava';
import { VALIDADE_DO_PIX_DO_ADICIONAL_MIN } from '../cardapio/adicional-pix';

// A TRAVA DO PEDIDO ENQUANTO O CLIENTE ALTERA (mig 517) — as regras puras. Protótipo aprovado em 28/11/2026:
// `mockups/regem-pedido-em-alteracao.html` (TR-1 a TR-8).
describe('trava do pedido em alteração — regras', () => {
  const agora = Date.parse('2026-11-28T22:50:00Z'); // 19:50 em São Paulo

  it('TR-3: vale 10 minutos sem resposta — o MESMO prazo do Pix do item novo (a trava acompanha o Pix)', () => {
    expect(VALIDADE_DA_TRAVA_MIN).toBe(10);
    expect(VALIDADE_DA_TRAVA_MIN).toBe(VALIDADE_DO_PIX_DO_ADICIONAL_MIN);
    expect(ateDaTrava(agora).getTime()).toBe(agora + 10 * 60_000);
  });

  it('só a ativa e dentro do prazo segura o pedido (o fim por tempo não depende de ninguém gravar)', () => {
    const ate = new Date(agora + 60_000).toISOString();
    expect(travaVale({ situacao: 'ativa', ate }, agora)).toBe(true);
    expect(travaVale({ situacao: 'ativa', ate }, agora + 61_000)).toBe(false);
    for (const s of ['confirmada', 'desistiu', 'vencida', 'liberada', 'descartada'] as const)
      expect(travaVale({ situacao: s, ate }, agora)).toBe(false);
    expect(travaVale(null, agora)).toBe(false);
  });

  it('a hora sai no fuso da operação, não no do servidor (a nuvem roda em UTC)', () => {
    expect(horaDaTrava(new Date(agora + 10 * 60_000))).toBe('20:00');
  });

  it('TR-2: a recusa diz o motivo e leva o código, a hora e o que o cliente quer (a tela monta o diálogo)', () => {
    const r = recusaDaTrava({ id: 't1', ate: new Date(agora + 10 * 60_000).toISOString(), quer: '➕ 1 Batata frita média' });
    expect(r).toEqual({
      statusCode: 409,
      code: CODIGO_PEDIDO_EM_ALTERACAO,
      message: 'O cliente está alterando este pedido pelo WhatsApp (até 20:00). Espere a resposta dele ou libere o pedido.',
      trava: { id: 't1', ate: '2026-11-28T23:00:00.000Z', quer: '➕ 1 Batata frita média' },
    });
  });

  it('TR-8: a conferência diz que o Regem PEDIU para a cozinha segurar — nunca que a cozinha parou', () => {
    const linha = linhaDaTravaNaConferencia(new Date(agora + 10 * 60_000));
    expect(linha).toBe('⏸ Pedi para a cozinha segurar o seu pedido enquanto você confere (até 20:00).');
    expect(linha).not.toMatch(/parou|não sai/i);
  });

  it('TR-5 e TR-4: os avisos ao cliente — segue como estava; a loja liberou (com e sem o Pix cancelado)', () => {
    expect(textoDaTravaVencida('123')).toBe(
      'Como não tive a sua resposta, o pedido nº 123 *segue como estava* ✅ e a cozinha continuou.\n\n' +
        'Se ainda quiser mudar, é só me dizer — enquanto ele não sair, dá para mudar.',
    );
    expect(textoDoPedidoLiberado('123', false)).toBe(
      'A loja precisou seguir com o pedido nº 123 *como estava*, sem a mudança.\n\nSe quiser, alguém da equipe fala com você por aqui.',
    );
    expect(textoDoPedidoLiberado('123', true)).toContain('O Pix do item novo foi cancelado — nada foi cobrado.');
  });

  it('TR-4: o motivo do "Liberar o pedido" é obrigatório, sem espaço sobrando e com limite', () => {
    expect(motivoDoLiberar('  entregador   já está aqui ')).toBe('entregador já está aqui');
    expect(motivoDoLiberar('   ')).toBeNull();
    expect(motivoDoLiberar(undefined)).toBeNull();
    expect(motivoDoLiberar('x'.repeat(500))).toHaveLength(200);
  });
});
