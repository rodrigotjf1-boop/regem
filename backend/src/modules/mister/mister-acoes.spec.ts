import { instanteDeSaoPaulo } from '../../common/pedido-agendado';
import { ACOES, ACOES_DO_MISTER, conferirAcao, ehAcaoDoMister, lerCanal, nomesDosCanais, pedidoAndou, pedidoServe, resumoDoPedido } from './mister-acoes';

// Versão 6, M6j (lote 1, o Delivery): a porta `propor_acao` — as regras puras.

const AGORA = instanteDeSaoPaulo('2026-11-20T20:00')!;

describe('Mister · ações — o catálogo e os canais', () => {
  it('o lote 1: os canais e os pedidos, de botão, pela permissão do Delivery', () => {
    expect([...ACOES_DO_MISTER]).toEqual(['pausar_canal', 'reabrir_canal', 'aceitar_pedido', 'pedido_pronto', 'despachar_pedido']);
    for (const a of ACOES_DO_MISTER) expect(ACOES[a]).toMatchObject({ id: a, nivel: 'botao', permissao: 'delivery' });
    expect(ehAcaoDoMister('cancelar_pedido')).toBe(false);
    expect(ehAcaoDoMister('pausar_canal')).toBe(true);
  });

  it('o canal como a pessoa diz', () => {
    expect(['99', 'food99', 'iFood', 'Cardápio', 'cardapio digital', 'keeta'].map(lerCanal)).toEqual(['food99', 'food99', 'ifood', 'cardapio', 'cardapio', null]);
    expect(nomesDosCanais(['ifood'])).toBe('o iFood');
    expect(nomesDosCanais(['cardapio', 'ifood', 'food99'])).toBe('o cardápio digital, o iFood e a 99');
  });
});

describe('Mister · ações — a conferência (os limites da tela)', () => {
  it('pausar o iFood e a 99 por 30 min, com o motivo: o resumo diz até quando cada um volta', () => {
    const r = conferirAcao('pausar_canal', { canais: ['99', 'ifood'], motivo: 'pedidos', minutos: 30 }, AGORA);
    expect(r).toEqual({
      parametros: { acao: 'pausar_canal', canais: ['ifood', 'food99'], motivo: 'pedidos', motivoTexto: null, minutos: 30, ate: null, fimDoDia: false },
      resumo: 'Pausar o iFood e a 99 (motivo: Muitos pedidos agora). Volta: o iFood às 20:30; a 99 às 20:30.',
    });
  });

  it('os tempos de cada canal são os da tela: 1 hora não serve para a 99; "até 22:00" serve para o cardápio', () => {
    const r = conferirAcao('pausar_canal', { canais: ['99'], motivo: 'cozinha', minutos: 60 }, AGORA);
    expect('erro' in r && r.erro).toContain('99: A 99 aceita 10, 20 ou 30 min');
    const c = conferirAcao('pausar_canal', { canais: ['cardapio'], motivo: 'fechando', ate: '22:00' }, AGORA);
    expect('resumo' in c && c.resumo).toBe('Pausar o cardápio digital (motivo: Perto de fechar). Volta: o cardápio digital às 22:00.');
    const fim = conferirAcao('pausar_canal', { canais: ['99'], motivo: 'energia', fimDoDia: true }, AGORA);
    expect('resumo' in fim && fim.resumo).toContain('a 99 às 23:59');
  });

  it('sem motivo, sem canal ou com canal desconhecido: a pergunta volta à pessoa', () => {
    expect(conferirAcao('pausar_canal', { canais: ['ifood'], minutos: 30 }, AGORA)).toEqual({ erro: expect.stringContaining('Escolha o motivo da pausa.') });
    expect(conferirAcao('pausar_canal', { canais: ['ifood'], motivo: 'outro', minutos: 30 }, AGORA)).toEqual({ erro: expect.stringContaining('Escreva o motivo da pausa.') });
    expect(conferirAcao('pausar_canal', { motivo: 'pedidos', minutos: 30 }, AGORA)).toEqual({ erro: 'Diga qual canal: cardapio, ifood ou 99 (um ou mais).' });
    expect(conferirAcao('reabrir_canal', { canais: ['keeta'] }, AGORA)).toEqual({ erro: 'Diga qual canal: cardapio, ifood ou 99 (um ou mais).' });
    expect(conferirAcao('apagar_tudo', {}, AGORA)).toEqual({ erro: expect.stringContaining('Essa ação não existe.') });
  });

  it('reabrir e as ações de pedido', () => {
    expect(conferirAcao('reabrir_canal', { canal: 'ifood' }, AGORA)).toEqual({ parametros: { acao: 'reabrir_canal', canais: ['ifood'] }, resumo: 'Reabrir o iFood agora.' });
    expect(conferirAcao('aceitar_pedido', { numero: '#4821' }, AGORA)).toEqual({ parametros: { acao: 'aceitar_pedido', numero: '4821' }, resumo: '' });
    expect(conferirAcao('despachar_pedido', {}, AGORA)).toEqual({ erro: 'Diga o número do pedido como aparece no painel do Delivery.' });
  });
});

describe('Mister · ações — o pedido: a situação que serve e a conferência do efeito', () => {
  it('cada ação na situação certa', () => {
    expect(pedidoServe('aceitar_pedido', { status: 'novo', tipo: 'entrega' })).toBeNull();
    expect(pedidoServe('aceitar_pedido', { status: 'confirmado', tipo: 'entrega' })).toBe('Esse pedido já foi aceito.');
    expect(pedidoServe('pedido_pronto', { status: 'novo', tipo: 'entrega' })).toBe('Esse pedido ainda não foi aceito: aceite antes.');
    expect(pedidoServe('pedido_pronto', { status: 'confirmado', tipo: 'retirada' })).toBeNull();
    expect(pedidoServe('despachar_pedido', { status: 'pronto', tipo: 'entrega' })).toBeNull();
    expect(pedidoServe('despachar_pedido', { status: 'confirmado', tipo: 'entrega' })).toBeNull();
    expect(pedidoServe('despachar_pedido', { status: 'pronto', tipo: 'retirada' })).toBe('Esse pedido é para retirar: ele não sai para entrega.');
    expect(pedidoServe('despachar_pedido', { status: 'despachado', tipo: 'entrega' })).toBe('Esse pedido já saiu para a entrega.');
    expect(pedidoServe('aceitar_pedido', { status: 'cancelado', tipo: 'entrega' })).toBe('Esse pedido está cancelado.');
  });

  it('o "feito" só com o pedido na situação de depois', () => {
    expect(pedidoAndou('aceitar_pedido', 'confirmado')).toBe(true);
    expect(pedidoAndou('aceitar_pedido', 'novo')).toBe(false);
    expect(pedidoAndou('pedido_pronto', 'confirmado')).toBe(false);
    expect(pedidoAndou('despachar_pedido', 'despachado')).toBe(true);
    expect(resumoDoPedido('despachar_pedido', '#4821 (iFood)')).toBe('Despachar o pedido #4821 (iFood) (saiu para a entrega).');
  });
});
