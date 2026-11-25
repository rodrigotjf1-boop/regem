import { conferirEnvio, conferirValidadeInformada, lerCanalDoEnvio, resumoDaValidade, resumoDoEnvio } from './mister-acoes-compra';
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

describe('a validade pendente informada pela conversa (P1 de "Pedidos e recebimento", 25/11)', () => {
  it('é de botão, pela permissão da rota "Informar a validade" (estoque.editar)', () => {
    expect(ACOES.informar_validade).toMatchObject({ nivel: 'botao', permissao: 'estoque', crud: 'editar' });
  });

  it('o item e a data OU "sem validade"; o pedido é opcional', () => {
    expect(conferirValidadeInformada({ validadeInformada: '2026-12-02' })).toEqual({ erro: 'Diga de qual item é a validade (o nome do produto).' });
    expect(conferirValidadeInformada({ insumoDaValidade: 'Carne 56 g' })).toEqual({ erro: 'Diga a data da validade (ex.: "vence 02/12"), ou que o item não tem validade.' });
    expect(conferirValidadeInformada({ insumoDaValidade: 'Carne 56 g', validadeInformada: '02/12' })).toEqual({ erro: 'A validade vai no formato AAAA-MM-DD.' });
    expect(conferirValidadeInformada({ insumoDaValidade: 'Carne 56 g', validadeInformada: '2026-12-02', semValidadeInformada: true })).toEqual({
      erro: 'Ou a validade tem data, ou é "sem validade" — não os dois.',
    });
    expect(conferirValidadeInformada({ insumoDaValidade: ' Carne 56 g ', validadeInformada: '2026-12-02' })).toEqual({
      parametros: { acao: 'informar_validade', insumo: 'Carne 56 g', pedido: null, validade: '2026-12-02', semValidade: false },
      resumo: 'Informar a validade de "Carne 56 g": vence em 02/12/2026.',
    });
    expect(conferirAcao('informar_validade', { insumoDaValidade: 'Guardanapo', semValidadeInformada: true, pedidoDaValidade: 'Semanal' })).toMatchObject({
      parametros: { pedido: 'Semanal', validade: null, semValidade: true },
    });
    expect(resumoDaValidade('Carne 56 g', 'Nota 48.213', '23/11', { acao: 'informar_validade', insumo: 'carne', pedido: null, validade: '2026-12-02', semValidade: false })).toBe(
      'Informar a validade de "Carne 56 g" (pedido "Nota 48.213", recebido em 23/11): vence em 02/12/2026. O item e o lote saem da validade pendente.',
    );
  });
});
