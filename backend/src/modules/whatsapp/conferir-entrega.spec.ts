import { OPCOES_DA_CONFERENCIA, classificarResposta, textoDaPergunta } from './conferir-entrega';

// "CHEGOU TUDO CERTO?" (B1): o texto da pergunta e a leitura da resposta (botão ou frase curta).
describe('a pergunta', () => {
  it('o primeiro nome e o número do pedido', () => {
    expect(textoDaPergunta('Renata Lima', '1180')).toBe('Oi, Renata! Seu pedido #1180 chegou tudo certo? 🙂');
    expect(textoDaPergunta(null, null)).toBe('Oi! Seu pedido chegou tudo certo? 🙂');
  });

  it('os 3 botões cabem nos 20 caracteres da Meta', () => {
    expect(OPCOES_DA_CONFERENCIA.map((o) => o.titulo)).toEqual(['Tudo certo 👍', 'Tive um problema', 'Não chegou']);
    for (const o of OPCOES_DA_CONFERENCIA) expect([...o.titulo].length).toBeLessThanOrEqual(20);
  });
});

describe('a resposta', () => {
  it('pelo botão (o id vence o texto)', () => {
    expect(classificarResposta('qualquer coisa', 'conferir_ok')).toBe('ok');
    expect(classificarResposta('', 'conferir_problema')).toBe('problema');
    expect(classificarResposta('', 'conferir_nao_chegou')).toBe('nao_chegou');
  });

  it('por frase curta, sem acento nem pontuação, ou pelo número do menu', () => {
    expect(classificarResposta('Tudo certo!!')).toBe('ok');
    expect(classificarResposta('chegou sim 😊')).toBe('ok');
    expect(classificarResposta('1')).toBe('ok');
    expect(classificarResposta('Tive um problema')).toBe('problema');
    expect(classificarResposta('2')).toBe('problema');
    expect(classificarResposta('NÃO CHEGOU')).toBe('nao_chegou');
    expect(classificarResposta('ainda não chegou')).toBe('nao_chegou');
    expect(classificarResposta('3')).toBe('nao_chegou');
  });

  it('texto longo ou outra conversa: nada (vai ao robô)', () => {
    expect(classificarResposta('chegou frio e faltou a coca, quero o dinheiro de volta por favor')).toBeNull();
    expect(classificarResposta('quero pedir de novo')).toBeNull();
    expect(classificarResposta('')).toBeNull();
    expect(classificarResposta('qualquer', 'outro_botao')).toBeNull();
  });
});
