import { montarAviso, primeiroNome, temContatoProibido, TEXTO_PADRAO } from './texto-do-chat';

// O texto dos avisos no chat do iFood e da 99 (ponte do chat, parte A2) e a trava do que a plataforma proíbe.
describe('texto dos avisos no chat', () => {
  it('saiu: com a previsão, a hora; sem previsão, sai a frase da hora (nada de promessa vazia)', () => {
    expect(montarAviso(TEXTO_PADRAO.saiu, { hora: '20h15' })).toBe('Seu pedido saiu para entrega! Chega por volta das 20h15.');
    expect(montarAviso(TEXTO_PADRAO.saiu, { hora: null })).toBe('Seu pedido saiu para entrega!');
    expect(montarAviso('Chega por volta das {hora}. Bom apetite!', {})).toBe('Bom apetite!');
    expect(montarAviso('{nome}, saiu! Previsão: {hora}', { nome: 'ANA', hora: null })).toBe('Ana, saiu!');
  });

  it('nome: o primeiro, com só a inicial maiúscula; sem nome, a vírgula vai junto e a frase começa maiúscula', () => {
    expect(montarAviso(TEXTO_PADRAO.chegando, { nome: 'MARIA S.' })).toBe('Maria, o entregador está chegando! Já pode ir até a porta.');
    expect(montarAviso(TEXTO_PADRAO.chegando, { nome: '' })).toBe('O entregador está chegando! Já pode ir até a porta.');
    expect(montarAviso(TEXTO_PADRAO.obrigado, { nome: null })).toBe('Obrigado pelo pedido! Bom apetite.');
    expect(montarAviso(TEXTO_PADRAO.obrigado, { nome: 'joão pedro' })).toBe('Obrigado pelo pedido, João! Bom apetite.');
    // nome com $& não vira texto de substituição
    expect(montarAviso('Oi {nome}!', { nome: '$&x' })).toBe('Oi $&x!');
    expect(primeiroNome('  ')).toBe('');
    expect(primeiroNome('123')).toBe('');
  });

  it('trava: telefone, WhatsApp, Instagram, @ e link — os avisos padrão passam', () => {
    for (const t of ['Me chama no whats', 'Pede pelo (21) 99999-1234', 'Siga @mister.burguer', 'Veja www.loja.com.br', 'https://wa.me/55', 'nosso insta', 'chama no zap', 'ligue 21 3333-4444'])
      expect(temContatoProibido(t)).toBe(true);
    for (const t of Object.values(TEXTO_PADRAO)) expect(temContatoProibido(t)).toBe(false);
    expect(temContatoProibido('Seu pedido nº 4821 saiu às 20h05')).toBe(false);
    expect(temContatoProibido('Em instantes alguém responde aqui.')).toBe(false);
    expect(temContatoProibido('Pedido 123456 de 1 de novembro')).toBe(false);
  });
});
