import { motivoDaMensagem, textoDaResposta } from './aviso-ao-entregador';

// OS AVISOS AO ENTREGADOR (mig 391): o que na mensagem do cliente faz o entregador ficar sabendo, e o texto que o
// cliente recebe quando o entregador responde com um toque.
describe('aviso ao entregador — a mensagem do cliente', () => {
  it('pergunta pelo pedido → "onde_esta"', () => {
    for (const t of ['Cadê meu pedido?', 'onde está o pedido', 'Já saiu?', 'Que horas chega?', 'tá chegando?', 'quanto tempo falta'])
      expect([t, motivoDaMensagem(t)]).toEqual([t, 'onde_esta']);
  });

  it('demora → "demora" (mesmo junto de um "cadê")', () => {
    for (const t of ['Está demorando muito', 'cadê? já tá atrasado', 'ainda não chegou', 'falta muito?', 'Estou esperando até agora', 'DEMOROU DEMAIS'])
      expect([t, motivoDaMensagem(t)]).toEqual([t, 'demora']);
  });

  it('o resto não avisa o entregador: agradecimento, cardápio, conversa, vazio, texto longo demais', () => {
    for (const t of ['obrigado!', 'quero fazer um pedido', 'tem coca?', 'ok', '', null, 'x '.repeat(200)])
      expect([t, motivoDaMensagem(t)]).toEqual([t, null]);
  });
});

describe('aviso ao entregador — o texto da resposta ao cliente', () => {
  it('a caminho, voltando com o que faltou, cheguei, imprevisto — sem link nem telefone (vai também ao chat da plataforma)', () => {
    expect(textoDaResposta('a_caminho', { ref: ' #81', depoisDaEntrega: false }).texto).toBe(
      'Seu pedido #81 está a caminho! 🛵 O entregador já está indo até você.',
    );
    expect(textoDaResposta('a_caminho', { ref: ' #81', depoisDaEntrega: true }).texto).toBe('O entregador está voltando com o que faltou no seu pedido #81. 🛵');
    expect(textoDaResposta('cheguei', { ref: ' #81', depoisDaEntrega: false }).texto).toBe(
      'O entregador chegou com o seu pedido #81! 📍 Ele está no endereço de entrega.',
    );
    expect(textoDaResposta('imprevisto', { ref: '', depoisDaEntrega: false }).texto).toBe(
      'O entregador teve um imprevisto no caminho, mas já está chegando com o seu pedido. Obrigado pela paciência! 🙏',
    );
  });
});
