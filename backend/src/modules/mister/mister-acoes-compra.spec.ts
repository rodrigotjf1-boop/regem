import { conferirEnvio, lerCanalDoEnvio, resumoDoEnvio } from './mister-acoes-compra';
import { ACOES, conferirAcao } from './mister-acoes';

describe('o pedido de compra enviado pela conversa (etapa 6 de 24/11)', () => {
  it('é de botão, pela permissão da rota "Marcar como enviado" (estoque.criar)', () => {
    expect(ACOES.pedido_enviado).toMatchObject({ nivel: 'botao', permissao: 'estoque', crud: 'criar' });
  });

  it('o canal: só os dois da tela', () => {
    expect(lerCanalDoEnvio('whatsapp')).toBe('whatsapp');
    expect(lerCanalDoEnvio('pelo zap')).toBe('whatsapp');
    expect(lerCanalDoEnvio('WPP')).toBe('whatsapp');
    expect(lerCanalDoEnvio('e-mail')).toBe('email');
    expect(lerCanalDoEnvio('email')).toBe('email');
    expect(lerCanalDoEnvio('liguei')).toBeNull();
    expect(lerCanalDoEnvio('')).toBeNull();
  });

  it('a conferência pede o pedido e o canal', () => {
    expect(conferirEnvio({ canalDoEnvio: 'whatsapp' })).toEqual({ erro: 'Diga qual pedido de compra (o nome dele ou o fornecedor).' });
    expect(conferirEnvio({ pedidoDeCompra: 'Felipão', canalDoEnvio: 'telefone' })).toEqual({ erro: 'Diga por onde o pedido foi mandado ao fornecedor: WhatsApp ou e-mail (os dois da tela).' });
    expect(conferirEnvio({ pedidoDeCompra: '  Felipão ', canalDoEnvio: 'zap' })).toEqual({
      parametros: { acao: 'pedido_enviado', pedido: 'Felipão', canal: 'whatsapp' },
      resumo: 'Marcar o pedido "Felipão" como enviado ao fornecedor pelo WhatsApp.',
    });
    expect(conferirAcao('pedido_enviado', { pedidoDeCompra: 'Felipão', canalDoEnvio: 'email' })).toMatchObject({ parametros: { canal: 'email' } });
  });

  it('o resumo diz que quem enviou é a pessoa, e a marca de antes', () => {
    expect(resumoDoEnvio('Semanal (Felipão), criado em 24/11 10:00', 'whatsapp', { enviadoEm: null, canal: null })).toBe(
      'Marcar o pedido "Semanal (Felipão), criado em 24/11 10:00" como enviado ao fornecedor pelo WhatsApp. Quem diz que enviou é você: o Regem só registra quando e por onde.',
    );
    expect(resumoDoEnvio('Semanal', 'email', { enviadoEm: '24/11 10:05', canal: 'whatsapp' })).toContain('Ele já estava marcado como enviado pelo WhatsApp em 24/11 10:05: fica a marca nova.');
  });
});
